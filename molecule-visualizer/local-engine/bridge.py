#!/usr/bin/env python3
"""Molecule Studio local energy bridge. Coordinates: Å, energies: eV, forces: eV/Å.

Only locally configured engines are executable. No commands or filesystem paths
are accepted over HTTP. Run --help; installation and numerical details: README.md.
"""
from __future__ import annotations

import argparse
from collections import OrderedDict
import copy
import importlib.metadata
import json
import math
import hashlib
import multiprocessing as mp
import os
from pathlib import Path
import queue
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, unquote, parse_qsl

import numpy as np
import psutil
from ase.data import atomic_numbers, covalent_radii
from ase.geometry import find_mic
from ase.units import Bohr, Hartree
from scipy.spatial import cKDTree

VERSION = '1.10.0'
UMA_MODELS = ('uma-s-1p2p1', 'uma-s-1p2', 'uma-s-1p1', 'uma-m-1p1')
ANYSOLV_MODELS = ('model_compact', 'model_moe')
MAX_BODY = 8 * 1024 * 1024
MODES = ('evaluate', 'optimize', 'perpendicular', 'neb', 'cineb', 'lup', 'afir', 'ts', 'vibrations', 'irc', 'scan')
PATH_MODES = ('perpendicular', 'neb', 'cineb', 'lup')


def number(value, name, lo, hi, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f'{name}: 数値が必要です。')
    if not math.isfinite(value) or not lo <= value <= hi or (integer and int(value) != value):
        raise ValueError(f'{name}: {lo}〜{hi} の範囲で指定してください。')
    return int(value) if integer else float(value)


def validate(data, engine):
    allowed = {'symbols', 'images', 'cell', 'charge', 'multiplicity', 'mode',
               'maxSteps', 'fmax', 'spring', 'maxMove', 'climbAfter', 'atomIds', 'afir', 'livePreview',
               'optimizer', 'trustRadius', 'vibrations', 'fixedAtoms', 'umaDevice', 'solvation',
               'irc', 'thermochemistry', 'internalConstraints', 'scan', 'adaptiveNEB', 'pathSplit', 'nodeIds', 'lup'}
    if not isinstance(data, dict) or set(data) - allowed:
        raise ValueError('未定義の入力項目があります。コマンド・パス指定は受け付けません。')
    if type(data.get('livePreview', False)) is not bool:
        raise ValueError('livePreviewには真偽値が必要です。')
    symbols = data.get('symbols')
    if not isinstance(symbols, list) or not 1 <= len(symbols) <= 500:
        raise ValueError('原子数は1〜500にしてください。')
    maximum_z = {'gxtb':103, 'tblite':86, 'uma':83}[engine]
    if any(not isinstance(s, str) or s not in atomic_numbers or not 1 <= atomic_numbers[s] <= maximum_z for s in symbols):
        raise ValueError(f'このエンジンの入力元素は原子番号{maximum_z}までです。対応パラメータの有無は計算時にも検査します。')
    images = np.asarray(data.get('images'), dtype=float)
    if images.ndim != 3 or images.shape[1:] != (len(symbols), 3) or not 1 <= len(images) <= 100:
        raise ValueError('構造列は1〜100構造、各構造は同じ原子数・File-orderのXYZ配列にしてください。')
    if not np.isfinite(images).all() or np.max(np.abs(images)) > 1e4:
        raise ValueError('座標は有限値、絶対値10000 Å以下にしてください。')
    mode = data.get('mode', 'evaluate')
    if mode not in MODES or (mode in PATH_MODES and len(images) < 3) or (mode in ('optimize', 'afir', 'ts', 'vibrations', 'irc', 'scan') and len(images) != 1):
        raise ValueError('経路緩和には端点を含む3〜100構造、単一最適化・振動解析には1構造が必要です。')
    charge = number(data.get('charge', 0), '電荷', -100, 100, True)
    multiplicity = number(data.get('multiplicity', 1), '多重度', 1, 100 if engine == 'uma' else 101, True)
    electrons = sum(atomic_numbers[s] for s in symbols) - charge
    if electrons < multiplicity - 1 or electrons <= 0 or (electrons - multiplicity + 1) % 2:
        raise ValueError('電子数・電荷・スピン多重度の偶奇または大きさが一致しません。')
    cell = data.get('cell')
    if cell is not None:
        if not isinstance(cell, dict) or set(cell) != {'vectors', 'pbc'}:
            raise ValueError('セルにはvectorsとpbcが必要です。')
        lattice = np.asarray(cell['vectors'], dtype=float)
        pbc = cell['pbc']
        if lattice.shape != (3, 3) or not np.isfinite(lattice).all() or np.max(np.abs(lattice)) > 1e4 or abs(np.linalg.det(lattice)) < 1e-6 or np.linalg.cond(lattice) > 1e6:
            raise ValueError('格子が退化しているか、数値範囲を超えています。')
        if not isinstance(pbc, list) or len(pbc) != 3 or any(type(v) is not bool for v in pbc):
            raise ValueError('pbcには3つの真偽値が必要です。')
        if any(pbc) and engine == 'gxtb':
            raise ValueError('このg-xTBアダプタは非周期系専用です。周期系にはtbliteを選んで起動してください。')
        if any(pbc) and engine == 'uma':
            raise ValueError('このUMA接続は分子用omol・非周期系専用です。周期系には対応していません。')
    for image in images:
        for i in range(len(symbols) - 1):
            vectors = image[i+1:] - image[i]
            distances = find_mic(vectors, cell['vectors'], cell['pbc'])[1] if cell and any(cell['pbc']) else np.linalg.norm(vectors, axis=1)
            if np.min(distances) < .1:
                raise ValueError('0.1 Å未満で重なった原子があります。初期経路の衝突を解消してください。')
    result = dict(symbols=symbols, images=images.tolist(), cell=cell, charge=charge,
                  multiplicity=multiplicity, mode=mode, livePreview=data.get('livePreview', False))
    step_default, step_limit = (10000 if mode == 'afir' else 100 if mode == 'lup' else 150), 10000
    for key, default, low, high, integer in [('maxSteps', step_default, 1, step_limit, True), ('fmax', .05, .00001, 10, False),
            ('spring', .1, .001, 10, False), ('maxMove', .03 if mode == 'lup' else .04, .001, .2, False), ('climbAfter', 5 if mode == 'lup' else 10, 0, 500, True)]:
        result[key] = number(data.get(key, default), key, low, high, integer)
    if mode in ('cineb', 'lup') and result['climbAfter'] >= result['maxSteps']:
        raise ValueError('CI開始ステップは最大ステップ数より小さくしてください。')
    if mode in PATH_MODES and any(np.linalg.norm(images[i+1]-images[i]) < 1e-10 for i in range(len(images)-1)):
        raise ValueError('隣接構造が同一です。重複フレームを除いてください。')
    if mode == 'afir':
        result['afir'], result['atomIds'] = validate_afir(data, result)
    elif 'afir' in data:
        raise ValueError('afirはAFIR専用の入力項目です。')
    elif 'atomIds' in data:
        ids = data['atomIds']
        if not isinstance(ids, list) or len(ids) != len(symbols) or any(not isinstance(i, str) or not i or len(i)>200 for i in ids) or len(set(ids)) != len(ids):
            raise ValueError('全原子の一意なIDが必要です。')
        result['atomIds'] = ids[:]
    optimizer = data.get('optimizer', 'sella-prfo' if mode == 'ts' else 'lbfgs' if mode == 'lup' else 'fire')
    choices = ('sella-prfo', 'sella-rfo') if mode == 'ts' else ('fire', 'lbfgs', 'bfgs') if mode in ('optimize', 'scan') else ('fire', 'lbfgs') if mode == 'lup' else ('fire',)
    if optimizer not in choices:
        raise ValueError('この操作では指定した最適化手法を使用できません。TSにはSella PRFO/RFOを指定してください。')
    result['optimizer'] = optimizer
    if mode == 'ts':
        result['trustRadius'] = number(data.get('trustRadius', .04), '初期信頼半径', .001, .2)
    elif 'trustRadius' in data:
        raise ValueError('trustRadiusはSella TS探索専用です。')
    vibration = data.get('vibrations')
    if mode == 'vibrations' and vibration is None:
        vibration = {}
    if vibration is not None:
        if mode not in ('ts', 'optimize', 'vibrations') or not isinstance(vibration, dict) or set(vibration)-{'delta','nfree','imaginaryThreshold'}:
            raise ValueError('振動解析設定が不正です。単一構造に対して指定してください。')
        if len(symbols)>200:
            raise ValueError('振動解析は最大200原子です（有限差分の計算回数に注意してください）。')
        nfree = number(vibration.get('nfree', 2), '有限差分点数', 2, 4, True)
        if nfree not in (2, 4):
            raise ValueError('有限差分点数は2または4です。')
        result['vibrations'] = dict(delta=number(vibration.get('delta', .001), '振動解析の変位幅', .0001, .1), nfree=nfree,
            imaginaryThreshold=number(vibration.get('imaginaryThreshold', 20), '虚振動の判定閾値', 0, 1000))
    if (mode=='ts' or vibration is not None) and cell and any(cell['pbc']):
        raise ValueError('Sella TS探索・振動モード表示は非周期分子用です。')
    if 'fixedAtoms' in data:
        fixed = data['fixedAtoms']
        if not isinstance(fixed, list) or any(type(i) is not int or not 0 <= i < len(symbols) for i in fixed) or len(set(fixed)) != len(fixed):
            raise ValueError('fixedAtomsは重複のない0始まりの原子インデックス配列にしてください。')
        if fixed and (mode not in ('optimize', 'afir', 'scan') or vibration is not None):
            raise ValueError('原子固定はMIN・AFIR-MIN専用です。TS・経路計算・振動解析との併用には対応していません。')
        if len(fixed) == len(symbols):
            raise ValueError('全原子は固定できません。可動原子を1個以上残してください。')
        result['fixedAtoms'] = sorted(fixed)
    if 'umaDevice' in data:
        if engine != 'uma':
            raise ValueError('umaDeviceはUMA専用です。')
        result['umaDevice'] = device_name(data['umaDevice'])
    if 'solvation' in data:
        s = data['solvation']
        if engine != 'uma' or not isinstance(s, dict) or set(s) != {'model', 'solvent', 'device'}:
            raise ValueError('AnySolvはUMA専用です。model・solvent・deviceを指定してください。')
        if s['model'] not in ANYSOLV_MODELS or not isinstance(s['solvent'], str) or not 1 <= len(s['solvent']) <= 100:
            raise ValueError('AnySolvのモデル・溶媒指定が不正です。')
        result['solvation'] = {**s, 'device':device_name(s['device'])}
    if 'internalConstraints' in data:
        result['internalConstraints'] = validate_internal_constraints(data, result)
    if mode == 'scan' or 'scan' in data:
        result['scan'] = validate_scan_settings(data, result)
    validate_lup(data, result)
    validate_adaptive_neb(data, result)
    validate_irc_settings(data, result)
    validate_thermochemistry_settings(data, result)
    return result


def alpha_from_gamma(gamma):
    """Ar calibration; gamma in kJ/mol, returned alpha in eV/Å. Zero disables bias."""
    number(gamma, 'gamma', 0, 1000)
    if gamma == 0:
        return 0.
    t = gamma / 1.0061
    log_ratio = math.log1p(t / (math.sqrt(1+t)+1) / 2)
    return gamma / 96.48533288249877 / (3.8164 * 2**(-1/6) * -math.expm1(-log_ratio/6))


def validate_afir(data, normalized):
    c, ids = data.get('afir'), data.get('atomIds')
    if not isinstance(ids, list) or len(ids) != len(normalized['symbols']) or any(not isinstance(i, str) or not i or len(i)>200 for i in ids) or len(set(ids)) != len(ids):
        raise ValueError('AFIRには全原子の一意なIDが必要です。')
    allowed = {'schema', 'fragments', 'pairs', 'charge', 'multiplicity', 'maxSteps', 'fmax', 'maxMove'}
    if not isinstance(c, dict) or set(c) != allowed or c['schema'] != 'molecule-afir/1':
        raise ValueError('AFIR設定の形式が一致しません。')
    for key in ('charge', 'multiplicity', 'maxSteps', 'fmax', 'maxMove'):
        if type(c[key]) is bool or c[key] != normalized[key]:
            raise ValueError('AFIRと計算条件が一致しません: '+key)
    if len(ids)<2 or any(atomic_numbers[s]>96 for s in normalized['symbols']):
        raise ValueError('AFIRは2〜500原子、H〜Cmです。')
    if normalized['cell'] and any(normalized['cell']['pbc']):
        raise ValueError('AFIRは非周期分子用です。')
    if not isinstance(c['fragments'], list) or not 2 <= len(c['fragments']) <= 64 or not isinstance(c['pairs'], list) or not 1 <= len(c['pairs']) <= 128:
        raise ValueError('AFIRには2〜64原子団と1〜128ペアが必要です。')
    groups = {}
    for f in c['fragments']:
        if not isinstance(f, dict) or set(f) != {'id', 'label', 'atomIds'} or not isinstance(f['id'], str) or not f['id'] or f['id'] in groups or not isinstance(f['label'], str) or not f['label'].strip() or len(f['label'])>40:
            raise ValueError('フラグメントのID・名前が不正です。')
        a = f['atomIds']
        if not isinstance(a, list) or not a or any(not isinstance(i, str) or i not in ids for i in a) or len(set(a))!=len(a):
            raise ValueError('原子団の原子IDが不正です。')
        groups[f['id']] = tuple(sorted(ids.index(i) for i in a))
    seen = set()
    for p in c['pairs']:
        if not isinstance(p, dict) or set(p) != {'a','b','mode','gamma'} or not isinstance(p['a'], str) or not isinstance(p['b'], str) or p['a'] not in groups or p['b'] not in groups or p['mode'] not in ('attract','repel'):
            raise ValueError('AFIRペアが不正です。')
        a, b = groups[p['a']], groups[p['b']]
        key = tuple(sorted((a, b)))
        if set(a)&set(b) or key in seen:
            raise ValueError('ペア内の原子重複または同じペアの重複があります。')
        seen.add(key)
        alpha_from_gamma(p['gamma'])
    return copy.deepcopy(c), ids[:]


def prepare_afir(symbols, ids, config):
    """Compile immutable fragment topology once; all coordinate dependence stays live."""
    indices = {identifier:i for i, identifier in enumerate(ids)}
    groups = {f['id']:[indices[i] for i in f['atomIds']] for f in config['fragments']}
    radii = np.array([covalent_radii[atomic_numbers[s]] for s in symbols])
    terms = []
    for pair in config['pairs']:
        a, b = np.meshgrid(groups[pair['a']], groups[pair['b']], indexing='ij')
        a, b = a.ravel(), b.ravel()
        coefficient = alpha_from_gamma(pair['gamma'])*(1 if pair['mode']=='attract' else -1)
        terms.append((a, b, radii[a]+radii[b], coefficient))
    return terms


def has_atomic_collision(positions, cell=None, threshold=.1):
    """Exact final distance check; a tree only rejects impossible gas-phase pairs."""
    if len(positions) < 2:
        return False
    if cell and any(cell['pbc']):
        for i in range(len(positions)-1):
            distances = find_mic(positions[i+1:]-positions[i], cell['vectors'], cell['pbc'])[1]
            if np.any(distances < threshold):
                return True
        return False
    if len(positions) < 64:
        a, b = np.triu_indices(len(positions), 1)
    else:
        pairs = cKDTree(positions).query_pairs(threshold*(1+1e-12), output_type='ndarray')
        if not len(pairs):
            return False
        a, b = pairs.T
    return bool(np.any(np.linalg.norm(positions[a]-positions[b], axis=1) < threshold))


def afir_bias(positions, symbols, ids, config, prepared=None):
    terms = prepare_afir(symbols, ids, config) if prepared is None else prepared
    total, forces = 0., np.zeros_like(positions)
    for a, b, radius_sum, coefficient in terms:
        vectors = positions[a]-positions[b]
        distances = np.linalg.norm(vectors, axis=1)
        if np.min(distances)<.1:
            raise ValueError('AFIRの原子団に0.1 Å未満の衝突があります。')
        logw = 6*np.log(radius_sum/distances)
        weights = np.exp(logw-logw.max()); weights /= weights.sum()
        distance = float(weights@distances)
        total += coefficient*distance
        force = -(coefficient*weights*(-5+6*distance/distances)/distances)[:,None]*vectors
        np.add.at(forces, a, force); np.add.at(forces, b, -force)
    return total, forces


def afir_relax(data, calculate, progress=lambda p:None):
    """FIRE minimizes physical energy plus independent pair biases; no TS claim."""
    positions = np.array(data['images'][0], dtype=float)
    fixed, anchors = data.get('fixedAtoms', []), positions.copy()
    velocity = np.zeros_like(positions)
    dt, mix, positive = .05, .1, 0
    result = dict(schema='molecule-afir-trajectory/1', mode='afir', atomIds=data['atomIds'],
        images=[], energies=[], biasEnergies=[], biasedEnergies=[], forces=[], imageFmax=[], physicalFmax=[], history=[],
        validation='biased-trajectory-not-ts', converged=False, reason='step_limit',
        units={'length':'angstrom','energy':'eV','force':'eV/angstrom'})
    bias_terms = prepare_afir(data['symbols'], data['atomIds'], data['afir'])
    for step in range(data['maxSteps']+1):
        if has_atomic_collision(positions):
            raise ValueError('AFIR探索中に0.1 Å未満の原子衝突を検出しました。')
        energy, force = calculate(0, positions)
        force = np.asarray(force, dtype=float)
        if not math.isfinite(energy) or force.shape!=positions.shape or not np.isfinite(force).all():
            raise ValueError('物理計算から有限のエネルギー・力を取得できません。')
        bias, artificial = afir_bias(positions, data['symbols'], data['atomIds'], data['afir'], bias_terms)
        effective = force+artificial
        effective[fixed] = 0
        constraint_correction = effective - force - artificial
        fmax = float(np.linalg.norm(effective, axis=1).max())
        result['images'].append(positions.tolist()); result['energies'].append(float(energy))
        result['biasEnergies'].append(bias); result['biasedEnergies'].append(float(energy+bias))
        result['forces'].append(force.tolist()); result['imageFmax'].append(fmax)
        result['physicalFmax'].append(float(np.linalg.norm(force, axis=1).max()))
        result.update(steps=step, evaluations=step+1, effectiveFmax=fmax)
        summary = {'step':step, 'fmax':fmax, 'rmsForce':float(np.sqrt(np.mean(np.sum(effective**2, axis=-1)))),
            'physicalFmax':result['physicalFmax'][-1], 'energies':[float(energy)], 'energyEV':float(energy), 'biasEnergyEV':bias,
            'energyChangeEV':0. if step == 0 else float(energy-result['energies'][-2]),
            'maxDisplacement':0. if step == 0 else force_max(positions-np.array(result['images'][-2])),
            'componentFmax':{'physical':force_max(force), 'artificial':force_max(artificial),
                             'constraintCorrection':force_max(constraint_correction), 'effective':fmax}}
        result['history'].append(summary)
        # One evaluated frame per checkpoint; no optimizer internals are claimed.
        progress({**summary,
                  'checkpoint':{'positions':positions.tolist(), 'force':force.tolist(),
                    'energy':float(energy), 'bias':bias, 'fmax':fmax, 'physicalFmax':result['physicalFmax'][-1], 'diagnostic':summary}})
        if fmax<=data['fmax']:
            result.update(converged=True, reason='converged'); break
        if step==data['maxSteps']:
            break
        velocity += dt*effective
        if float(np.vdot(velocity, effective))>0:
            positive += 1
            if positive>5:
                dt=min(dt*1.1,.5); mix*=.99
            velocity=(1-mix)*velocity+mix*effective*np.linalg.norm(velocity)/max(np.linalg.norm(effective),1e-300)
        else:
            positive=0; dt*=.5; mix=.1; velocity.fill(0)
        displacement=dt*velocity
        displacement *= min(1., data['maxMove']/max(float(np.linalg.norm(displacement,axis=1).max()),1e-300))
        positions += displacement
        positions[fixed] = anchors[fixed]
        velocity[fixed] = 0
    result['fixedAtoms'] = fixed
    result['forceComponents'] = {key:[value.tolist()] for key, value in
        {'physical':force, 'artificial':artificial, 'constraintCorrection':constraint_correction, 'effective':effective}.items()}
    result['forceComponentImageIndices'] = [len(result['images'])-1]
    return result


def validate_lup(data, normalized):
    """Spring-free CI-String variant; not the proprietary GRRM LUP algorithm."""
    if normalized['mode'] != 'lup':
        if 'lup' in data:
            raise ValueError('lup設定はLUP系（CI-String）専用です。')
        return
    settings = data.get('lup', {})
    if not isinstance(settings, dict) or set(settings)-{'redistributeEvery', 'redistributionTolerance'}:
        raise ValueError('LUP系の再分布設定が不正です。')
    normalized['lup'] = {
        'redistributeEvery': number(settings.get('redistributeEvery', 5), '弧長再分布の間隔', 1, 100, True),
        'redistributionTolerance': number(settings.get('redistributionTolerance', .001), '再分布残差の収束閾値', .00001, .1),
    }


def validate_adaptive_neb(data, normalized):
    """Validate adaptive band settings; IDs survive insertion and continuation."""
    count = len(normalized['images'])
    if 'nodeIds' in data:
        ids = data['nodeIds']
        if (normalized['mode'] not in PATH_MODES or not isinstance(ids, list) or len(ids) != count
                or any(not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value) for value in ids)
                or len(set(ids)) != count):
            raise ValueError('nodeIdsは経路の各ノードに対応する一意な英数字IDにしてください。')
        normalized['nodeIds'] = ids[:]
    if 'adaptiveNEB' in data:
        settings = data['adaptiveNEB']
        if (normalized['mode'] not in ('cineb', 'lup') or not isinstance(settings, dict)
                or set(settings) - {'enabled', 'maxImages', 'interval', 'maxSpacing', 'energyGap'}
                or type(settings.get('enabled', True)) is not bool):
            raise ValueError('自動ノード追加はCI-NEB・LUP系専用です。設定を確認してください。')
        normalized['adaptiveNEB'] = {
            'enabled': settings.get('enabled', True),
            'maxImages': number(settings.get('maxImages', max(30, count)), '最大ノード数', count, 100, True),
            'interval': number(settings.get('interval', 10), 'ノード追加の確認間隔', 1, 10000, True),
            'maxSpacing': number(settings.get('maxSpacing', .5), '原子RMS変位の上限', .01, 20),
            'energyGap': number(settings.get('energyGap', .2), '隣接エネルギー差の上限', .0001, 100),
        }
    if 'pathSplit' in data:
        settings = data['pathSplit']
        if (normalized['mode'] not in PATH_MODES or not isinstance(settings, dict)
                or set(settings) - {'enabled', 'prominence', 'minSeparation', 'smoothingWindow'}
                or type(settings.get('enabled', True)) is not bool):
            raise ValueError('経路分割の設定が不正です。')
        window = number(settings.get('smoothingWindow', 3), '平滑化窓', 1, 21, True)
        if window % 2 != 1:
            raise ValueError('平滑化窓は1〜21の奇数にしてください。')
        normalized['pathSplit'] = {
            'enabled': settings.get('enabled', True),
            'prominence': number(settings.get('prominence', .05), '谷の突出度', 0, 100),
            'minSeparation': number(settings.get('minSeparation', 2), '分割点の最小間隔', 2, 99, True),
            'smoothingWindow': window,
        }
    return normalized


def path_segments(energies, physical, node_ids, settings, fmax):
    """Suggest minima boundaries; a profile minimum is not a verified intermediate.

    The moving mean only selects valleys. Original energies and coordinates are
    retained. Plateaus have one centre; topographic prominence rejects ripples.
    """
    values = np.asarray(energies, float)
    half = settings['smoothingWindow'] // 2
    smooth = np.array([np.mean(values[max(0, i-half):min(len(values), i+half+1)])
                       for i in range(len(values))])
    # Smoothing cannot change the actual endpoint reference energies.
    smooth[0], smooth[-1] = values[0], values[-1]
    candidates, i = [], 1
    while i < len(values)-1:
        end = i
        while end+1 < len(values)-1 and abs(smooth[end+1]-smooth[i]) < 1e-12:
            end += 1
        centre = (i+end)//2
        if smooth[i] < smooth[i-1] and smooth[end] < smooth[end+1]:
            left, right = i-1, end+1
            while left > 0 and smooth[left] >= smooth[i]:
                left -= 1
            while right < len(values)-1 and smooth[right] >= smooth[i]:
                right += 1
            prominence = min(float(np.max(smooth[left:i])), float(np.max(smooth[end+1:right+1]))) - float(smooth[i])
            if prominence >= settings['prominence']:
                # A moving mean may put its valley centre on a raw maximum.
                # Split only at an actual unsmoothed local minimum nearby.
                raw_minima = []
                for candidate in range(max(1, i-half), min(len(values)-1, end+half+1)):
                    raw_left = raw_right = candidate
                    while raw_left > 0 and abs(values[raw_left-1]-values[candidate]) < 1e-12:
                        raw_left -= 1
                    while raw_right < len(values)-1 and abs(values[raw_right+1]-values[candidate]) < 1e-12:
                        raw_right += 1
                    if (raw_left > 0 and raw_right < len(values)-1
                            and values[candidate] < values[raw_left-1] and values[candidate] < values[raw_right+1]):
                        raw_minima.append(candidate)
                if raw_minima:
                    selected = min(raw_minima, key=lambda index: (float(values[index]), abs(index-centre), index))
                    candidates.append((prominence, selected))
        i = end+1
    separation = settings['minSeparation']
    chosen = [0, len(values)-1]
    prominence_by_index = {}
    for prominence, index in sorted(candidates, reverse=True):
        if all(abs(index-existing) >= separation for existing in chosen):
            chosen.append(index)
            prominence_by_index[index] = prominence
    chosen.sort()
    force_values = [force_max(force) for force in physical]
    minima = [{'index': index, 'nodeId': node_ids[index], 'energyEV': float(values[index]),
               'smoothedEnergyEV': float(smooth[index]), 'prominenceEV': prominence_by_index[index],
               'physicalFmax': force_values[index], 'stationaryCandidate': force_values[index] <= fmax}
              for index in chosen[1:-1]]
    segments = [{'start': start, 'end': end,
                 'needsEndpointOptimization': force_values[start] > fmax or force_values[end] > fmax}
                for start, end in zip(chosen, chosen[1:])]
    return {'schema': 'molecule-path-segments/1', 'settings': settings.copy(), 'indices': chosen,
            'minima': minima, 'segments': segments,
            'note': 'エネルギーの谷に基づく分割候補です。物理力が未収束の端点はMINで緩和してからCI-NEBを再実行してください。'}


def adaptive_intervals(images, energies, settings):
    """Rank unresolved intervals by atom RMS displacement or absolute energy gap."""
    spacing = np.sqrt(np.mean(np.sum(np.diff(images, axis=0)**2, axis=-1), axis=-1))
    gaps = np.abs(np.diff(energies))
    scores = np.maximum(spacing/settings['maxSpacing'], gaps/settings['energyGap'])
    return sorted((i for i in range(len(scores)) if scores[i] > 1+1e-12),
                  key=lambda i: (-float(scores[i]), i))


def safe_band_midpoint(left, right, cell=None):
    """Linear interpolation never silently introduces a <0.1 Å atom collision."""
    point = (left+right)*.5
    if has_atomic_collision(point, cell):
        return None
    if np.linalg.norm(point-left) < 1e-10 or np.linalg.norm(right-point) < 1e-10:
        return None
    return point


def band_force_components(images, energies, physical, mode, spring, climbing, fixed=(), tangents=None):
    """An additive decomposition of the actual optimizer force, in eV/Å."""
    removal, springs, correction, constraints = (np.zeros_like(physical) for _ in range(4))
    perpendicular_force = physical.copy()
    if mode in PATH_MODES:
        constraints[[0, -1]] = -physical[[0, -1]]
        perpendicular_force[[0, -1]] = 0
        for i in range(1, len(images)-1):
            tau = tangent(images, energies, i) if tangents is None else tangents[i]
            projected = np.sum(physical[i]*tau)*tau
            perpendicular_force[i] -= projected
            if i == climbing:
                correction[i] = -2*projected
            else:
                removal[i] = -projected
                if mode in ('neb', 'cineb'):
                    springs[i] = spring*(np.linalg.norm(images[i+1]-images[i])-np.linalg.norm(images[i]-images[i-1]))*tau
    effective = physical+removal+springs+correction+constraints
    if fixed:
        constraints[:, fixed, :] -= effective[:, fixed, :]
        effective[:, fixed, :] = 0
    components = {'physical': physical, 'tangentRemoval': removal, 'spring': springs,
                  'climbingCorrection': correction, 'constraintCorrection': constraints, 'effective': effective}
    active_forces = effective[1:-1] if mode in PATH_MODES else effective
    if fixed:
        active_forces = np.delete(active_forces, fixed, axis=1)
    diagnostics = {'physicalFmax': force_max(physical), 'effectiveFmax': force_max(effective),
                   'rmsForce': float(np.sqrt(np.mean(np.sum(active_forces**2, axis=-1)))),
                   'perpendicularFmax': force_max(perpendicular_force), 'springFmax': force_max(springs),
                   'climbingFmax': force_max(correction),
                   'componentFmax': {name: force_max(value) for name, value in components.items()}}
    return components, diagnostics


def tangent(images, energies, i):
    """Improved energy-weighted tangent (Henkelman & Jónsson, 2000), in 3N.

    Use continuous/unwrapped Cartesian coordinates, including fixed-cell paths.
    Do not independently wrap atoms between images: that can change winding.
    """
    forward, backward = images[i+1] - images[i], images[i] - images[i-1]
    e0, e1, e2 = energies[i-1:i+2]
    if e2 > e1 > e0:
        vector = forward
    elif e2 < e1 < e0:
        vector = backward
    else:
        high, low = sorted((abs(e2-e1), abs(e0-e1)), reverse=True)
        vector = forward * (high if e2 > e0 else low) + backward * (low if e2 > e0 else high)
    length = np.linalg.norm(vector)
    if length < 1e-12:
        nf, nb = np.linalg.norm(forward), np.linalg.norm(backward)
        vector = forward / max(nf, 1e-15) + backward / max(nb, 1e-15)
        length = np.linalg.norm(vector)
        if length < 1e-12:
            vector = forward if nf >= nb else backward
            length = np.linalg.norm(vector)
    if length < 1e-12:
        raise ValueError('接線を定義できない重複構造があります。経路を作り直してください。')
    return vector / length


def perpendicular(vector, unit_tangent):
    return vector - np.sum(vector * unit_tangent) * unit_tangent


def band_forces(images, energies, physical, mode, spring, climbing=None):
    forces, tangents = np.zeros_like(physical), np.zeros_like(physical)
    if mode == 'optimize':
        return physical.copy(), tangents
    for i in range(1, len(images)-1):
        tau = tangents[i] = tangent(images, energies, i)
        parallel = np.sum(physical[i] * tau)
        if i == climbing:
            forces[i] = physical[i] - 2 * parallel * tau
        else:
            forces[i] = physical[i] - parallel * tau
            if mode in ('neb', 'cineb'):
                forces[i] += spring * (np.linalg.norm(images[i+1]-images[i]) - np.linalg.norm(images[i]-images[i-1])) * tau
    return forces, tangents


def force_max(forces):
    return float(np.max(np.linalg.norm(forces, axis=-1)))


def lup_redistribute(images, climbing=None):
    """Piecewise-linear equal-arclength redistribution, preserving CI and ends.

    Cartesian 3N arc length uses unwrapped coordinates. No mass weighting,
    alignment or periodic wrapping is introduced. Redistribution is a coordinate
    operation, never a fictitious force or an energy contribution.
    """
    images = np.asarray(images, dtype=float)
    answer = images.copy()
    anchors = [0, len(images)-1] if climbing is None else [0, climbing, len(images)-1]
    for start, end in zip(anchors, anchors[1:]):
        if end-start <= 1:
            continue
        segment = images[start:end+1].reshape(end-start+1, -1)
        arc = np.r_[0., np.cumsum(np.linalg.norm(np.diff(segment, axis=0), axis=1))]
        if arc[-1] < 1e-10:
            raise ValueError('LUP系の経路区間が縮退しました。異なる端点・TS候補で経路を作り直してください。')
        keep = np.r_[True, np.diff(arc)>1e-12]
        target = np.linspace(0., arc[-1], end-start+1)
        output = np.stack([np.interp(target, arc[keep], coordinate[keep]) for coordinate in segment.T], axis=1)
        answer[start:end+1] = output.reshape(end-start+1, *images.shape[1:])
    answer[anchors] = images[anchors]
    return answer


def lup_safe_geometry(images, cell=None):
    if not np.isfinite(images).all() or np.max(np.abs(images)) > 1e4:
        return False
    if any(np.linalg.norm(images[i+1]-images[i]) < 1e-10 for i in range(len(images)-1)):
        return False
    for image in images:
        if has_atomic_collision(image, cell):
            return False
    return True


def lup_lbfgs_direction(images, effective, tangents, climbing, states):
    """Image-local positive-curvature L-BFGS on the transverse subspaces.

    The CI reflected force is used only at the climbing image. Secants are
    projected onto the current tangent plane at other nodes. A changed CI,
    insertion or redistribution must clear states before the next call. This is
    a bounded quasi-Newton root search, not an energy-monotone minimization.
    """
    directions = np.zeros_like(images)
    for i in range(1, len(images)-1):
        position, force = images[i].ravel(), effective[i].ravel()
        state = states.setdefault(i, {'pairs': []})
        tau = tangents[i].ravel()
        project = (lambda vector: vector) if i == climbing else (lambda vector: vector-np.dot(vector, tau)*tau)
        if 'position' in state:
            s = project(position-state['position'])
            y = project(state['force']-force)
            sy, scale = float(np.dot(s, y)), float(np.linalg.norm(s)*np.linalg.norm(y))
            if sy > max(1e-12, 1e-8*scale):
                state['pairs'].append((s, y, 1./sy))
                state['pairs'] = state['pairs'][-6:]
            else:
                state['pairs'].clear()
        q, alphas = -force.copy(), []
        for s, y, rho in reversed(state['pairs']):
            coefficient = rho*np.dot(s, q)
            alphas.append(coefficient)
            q -= coefficient*y
        scale = .05
        if state['pairs']:
            s, y, _ = state['pairs'][-1]
            scale = float(np.clip(np.dot(s, y)/max(np.dot(y, y), 1e-300), 1e-4, 1.))
        z = scale*q
        for (s, y, rho), coefficient in zip(state['pairs'], reversed(alphas)):
            z += s*(coefficient-rho*np.dot(y, z))
        direction = project(-z)
        if not np.isfinite(direction).all() or (np.linalg.norm(force)>0 and np.dot(direction, force) <= 0):
            state['pairs'].clear()
            direction = .05*force
        directions[i] = direction.reshape(images.shape[1:])
        state['position'], state['force'] = position.copy(), force.copy()
    return directions


def relax(data, calculate, progress=lambda _: None):
    """Bounded FIRE with optional adaptive CI-NEB and evaluated-band checkpoints.

    Insertion uses Cartesian midpoints and resets the FIRE state. All old node
    identities and both endpoints survive. Criteria use physical energies only.
    No saddle claim follows from a profile peak or an unrelaxed valley.
    """
    images = np.array(data['images'], float)
    fixed, anchors = data.get('fixedAtoms', []), images.copy()
    energies, physical = np.zeros(len(images)), np.zeros_like(images)
    velocity = np.zeros_like(images)
    mode, max_steps = data['mode'], data['maxSteps']
    lup = {'redistributeEvery':5, 'redistributionTolerance':.001, **data.get('lup', {})}
    optimizer_method = data.get('optimizer', 'lbfgs' if mode == 'lup' else 'fire')
    lup_states, lup_cache = {}, {}
    lup_redistributions, cache_hits, redistribution_move = 0, 0, 0.
    dt, alpha, positive = .05, .1, 0
    previous_climbing = None
    history, max_parallel_step = [], 0.0
    trajectory = {'images': [], 'energies': []} if mode == 'optimize' else None
    node_ids = list(data.get('nodeIds', [f'node-{i}' for i in range(len(images))]))
    adaptive = data.get('adaptiveNEB', {})
    adaptive_on = mode in ('cineb', 'lup') and adaptive.get('enabled', False)
    insertion_events, blocked_intervals = [], []
    next_id, evaluations = 0, 0
    previous_positions, previous_energies = {}, {}
    for step in range((0 if mode == 'evaluate' else max_steps) + 1):
        for i in range(len(images)):
            if step and mode != 'optimize' and i in (0, len(images)-1):
                if mode == 'lup':
                    cache_hits += 1
                continue
            if mode == 'lup' and node_ids[i] in lup_cache and np.array_equal(images[i], lup_cache[node_ids[i]][0]):
                _, energies[i], physical[i] = lup_cache[node_ids[i]]
                cache_hits += 1
                continue
            progress({'step': step, 'image': i+1, 'images': len(images), 'evaluations': evaluations})
            energy, force = calculate(i, images[i])
            force = np.asarray(force, dtype=float)
            if not np.isfinite(energy) or force.shape != images[i].shape or not np.isfinite(force).all():
                raise ValueError('エンジンから有限なエネルギー・力を取得できませんでした。')
            energies[i], physical[i] = energy, force
            evaluations += 1
            if mode == 'lup':
                lup_cache[node_ids[i]] = (images[i].copy(), float(energy), force.copy())
        climbing = int(np.argmax(energies[1:-1]))+1 if mode in ('cineb', 'lup') and step >= data['climbAfter'] else None
        effective, tangents = band_forces(images, energies, physical, mode, data['spring'], climbing)
        if mode == 'evaluate':
            effective = physical.copy()
        if fixed:
            effective[:, fixed, :] = 0
        preliminary_converged = force_max(effective) <= data['fmax']
        if (adaptive_on and step < max_steps and len(images) < adaptive['maxImages']
                and (step % adaptive['interval'] == 0 or preliminary_converged)):
            candidates = adaptive_intervals(images, energies, adaptive)
            additions = {}
            for left in candidates:
                if len(images)+len(additions) >= adaptive['maxImages']:
                    break
                midpoint = safe_band_midpoint(images[left], images[left+1], data.get('cell'))
                if midpoint is None:
                    blocked = {'left': node_ids[left], 'right': node_ids[left+1], 'reason': 'midpoint_collision_or_duplicate'}
                    if blocked not in blocked_intervals:
                        blocked_intervals.append(blocked)
                    continue
                while f'inserted-{next_id}' in node_ids:
                    next_id += 1
                additions[left] = (midpoint, f'inserted-{next_id}')
                next_id += 1
            if additions:
                # Preserve the fully evaluated original band even when a newly
                # inserted midpoint fails or the user cancels during its SCF.
                _, insertion_diagnostics = band_force_components(images, energies, physical, mode, data['spring'], climbing, fixed, tangents)
                progress({'bandCheckpoint': {'images': images.tolist(), 'energies': energies.tolist(),
                    'forces': physical.tolist(), 'effectiveFmax': force_max(effective),
                    'imageFmax': [force_max(f) for f in effective], 'steps': step,
                    'evaluations': evaluations, 'climbingImage': climbing, 'nodeIds': node_ids[:],
                    'insertions': copy.deepcopy(insertion_events), 'history': copy.deepcopy(history[-100:]),
                    'diagnostics': insertion_diagnostics}})
                new_images, new_energies, new_forces, new_ids = [], [], [], []
                for i, image in enumerate(images):
                    new_images.append(image)
                    new_energies.append(energies[i])
                    new_forces.append(physical[i])
                    new_ids.append(node_ids[i])
                    if i in additions:
                        midpoint, identifier = additions[i]
                        index = len(new_images)
                        progress({'step': step, 'phase': 'adaptive_insertion', 'image': index+1,
                                  'images': len(images)+len(additions), 'evaluations': evaluations})
                        energy, force = calculate(index, midpoint)
                        force = np.asarray(force, dtype=float)
                        if not np.isfinite(energy) or force.shape != midpoint.shape or not np.isfinite(force).all():
                            raise ValueError('追加ノードのエネルギー・力が非有限値です。')
                        evaluations += 1
                        new_images.append(midpoint)
                        new_energies.append(float(energy))
                        new_forces.append(force)
                        new_ids.append(identifier)
                        if mode == 'lup':
                            lup_cache[identifier] = (midpoint.copy(), float(energy), force.copy())
                        insertion_events.append({'step': step, 'nodeId': identifier,
                                                 'left': node_ids[i], 'right': node_ids[i+1]})
                images, energies, physical = np.array(new_images), np.array(new_energies), np.array(new_forces)
                node_ids = new_ids
                anchors = images.copy()
                velocity = np.zeros_like(images)
                dt, alpha, positive, previous_climbing = .05, .1, 0, None
                lup_states.clear()
                climbing = int(np.argmax(energies[1:-1]))+1 if step >= data['climbAfter'] else None
                effective, tangents = band_forces(images, energies, physical, mode, data['spring'], climbing)
        components, diagnostics = band_force_components(images, energies, physical, mode, data['spring'], climbing, fixed, tangents)
        # Keep decomposition numerically identical to the force used by FIRE.
        if not np.allclose(components['effective'], effective, atol=1e-12, rtol=1e-12):
            raise ValueError('有効力と力成分の整合性を検証できませんでした。')
        diagnostics['energyChangeEV'] = max((abs(float(energies[i])-previous_energies[identifier])
                                            for i, identifier in enumerate(node_ids) if identifier in previous_energies), default=0.)
        diagnostics['maxDisplacement'] = max((force_max(images[i]-previous_positions[identifier])
                                              for i, identifier in enumerate(node_ids) if identifier in previous_positions), default=0.)
        previous_positions = {identifier: images[i].copy() for i, identifier in enumerate(node_ids)}
        previous_energies = {identifier: float(energies[i]) for i, identifier in enumerate(node_ids)}
        maximum = force_max(effective)
        redistribution_residual = force_max(lup_redistribute(images, climbing)-images) if mode == 'lup' else 0.
        if mode == 'lup':
            diagnostics.update(redistributionResidual=redistribution_residual,
                redistributionMove=redistribution_move, redistributions=lup_redistributions, cacheHits=cache_hits)
        remaining = adaptive_intervals(images, energies, adaptive) if adaptive_on else []
        # An unresolved interval requests a further insertion before convergence,
        # unless the node cap is reached or every interval is geometrically blocked.
        refinable = adaptive_on and len(images) < adaptive['maxImages'] and any(
            safe_band_midpoint(images[i], images[i+1], data.get('cell')) is not None for i in remaining)
        converged = (mode != 'evaluate' and maximum <= data['fmax']
                     and (mode not in ('cineb', 'lup') or climbing is not None) and not refinable
                     and (mode != 'lup' or redistribution_residual <= lup['redistributionTolerance']))
        summary = {'step': step, 'fmax': maximum, 'energies': energies.tolist(), 'climbingImage': climbing,
                   'evaluations': evaluations, 'diagnostics': diagnostics, 'nodeIds': node_ids[:]}
        history.append(summary)
        band_extra = {}
        if mode in PATH_MODES:
            band_extra = {'nodeIds': node_ids[:], 'insertions': copy.deepcopy(insertion_events),
                          'adaptiveStatus': {'enabled': adaptive_on, 'unresolvedIntervals': len(remaining),
                                             'nodeLimitReached': bool(adaptive_on and len(images) >= adaptive['maxImages']),
                                             'blockedIntervals': copy.deepcopy(blocked_intervals)}}
            if data.get('pathSplit', {}).get('enabled'):
                band_extra['pathSegments'] = path_segments(energies, physical, node_ids, data['pathSplit'], data['fmax'])
            if mode == 'lup':
                band_extra.update(pathMethod='lup-ci-string', optimizer=optimizer_method, lup=lup.copy(),
                    lupStatus={'redistributions':lup_redistributions, 'cacheHits':cache_hits,
                               'redistributionResidual':redistribution_residual})
        final_step = mode == 'evaluate' or converged or step == max_steps
        checkpoint = {}
        if trajectory is not None:
            positions = images[0].tolist()
            trajectory['images'].append(positions)
            trajectory['energies'].append(float(energies[0]))
            checkpoint = {'checkpoint': {'positions': positions, 'energy': float(energies[0]),
                'force': physical[0].tolist(), 'fmax': maximum, 'diagnostics': diagnostics}}
        elif mode in PATH_MODES:
            # Only completely evaluated bands are resumable. Histories have scalar
            # diagnostics, never one full set of component vectors per iteration.
            checkpoint = {'bandCheckpoint': {'images': images.tolist(), 'energies': energies.tolist(),
                'forces': physical.tolist(), 'effectiveFmax': maximum, 'imageFmax': [force_max(f) for f in effective],
                'steps': step, 'evaluations': evaluations, 'climbingImage': climbing,
                'history': copy.deepcopy(history[-100:]), 'diagnostics': diagnostics, **band_extra}}
        progress({**summary, **checkpoint, **({'preview': {'step': step, 'images': images.tolist(),
                  'energies': energies.tolist(), 'nodeIds': node_ids[:], 'diagnostics': diagnostics}}
                  if data.get('livePreview') else {})})
        if final_step:
            return {'images': images.tolist(), 'energies': energies.tolist(), 'forces': physical.tolist(),
                    'effectiveFmax': maximum, 'imageFmax': [force_max(f) for f in effective],
                    'converged': converged, 'reason': 'evaluated' if mode == 'evaluate' else 'converged' if converged else 'step_limit',
                    'steps': step, 'climbingImage': climbing, 'mode': mode, 'evaluations': evaluations,
                    'maxTangentialStep': max_parallel_step if mode == 'perpendicular' else None,
                    'history': history, 'fixedAtoms': fixed, **({'trajectory': trajectory} if trajectory is not None else {}),
                    'diagnostics': diagnostics, 'forceComponents': {key: value.tolist() for key, value in components.items()}, **band_extra,
                    'units': {'length': 'angstrom', 'energy': 'eV', 'force': 'eV/angstrom'}}
        if climbing != previous_climbing:
            velocity[:] = 0
            dt, alpha, positive = .05, .1, 0
            previous_climbing = climbing
            lup_states.clear()
        if mode == 'lup':
            if optimizer_method == 'lbfgs':
                displacement = lup_lbfgs_direction(images, effective, tangents, climbing, lup_states)
            else:
                # Transport momentum only in the allowed transverse subspace.
                for i in range(1, len(images)-1):
                    if i != climbing:
                        velocity[i] = perpendicular(velocity[i], tangents[i])
                power = float(np.sum(velocity*effective))
                if power > 0:
                    positive += 1
                    if positive > 5:
                        dt, alpha = min(dt*1.1, .5), alpha*.99
                else:
                    velocity[:] = 0
                    dt, alpha, positive = max(dt*.5, 1e-5), .1, 0
                vnorm, fnorm = np.linalg.norm(velocity), np.linalg.norm(effective)
                if fnorm > 0:
                    velocity = (1-alpha)*velocity+alpha*vnorm/fnorm*effective
                velocity += dt*effective
                displacement = dt*velocity
                for i in range(1, len(images)-1):
                    if i != climbing:
                        displacement[i] = perpendicular(displacement[i], tangents[i])
            displacement[[0, -1]] = 0
            for i in range(1, len(images)-1):
                displacement[i] *= min(1., data['maxMove']/max(force_max(displacement[i]), 1e-15))
            proposed = images+displacement
            redistribute = (step+1) % lup['redistributeEvery'] == 0 or maximum <= data['fmax']
            redistributed = lup_redistribute(proposed, climbing) if redistribute else proposed
            reparam = redistributed-proposed
            combined = redistributed-images
            factor = min(1., data['maxMove']/max(force_max(combined), 1e-15))
            candidate = None
            for fraction in (1., .5, .25, .125, .0625, .03125, .015625):
                trial = images+factor*fraction*combined
                trial[[0, -1]] = images[[0, -1]]
                if lup_safe_geometry(trial, data.get('cell')):
                    candidate = trial
                    factor *= fraction
                    break
            if candidate is None:
                raise ValueError('LUP系の更新で原子衝突・経路の縮退を検出しました。最後の評価済み経路を保持しています。')
            redistribution_move = force_max(factor*reparam)
            if redistribution_move > 1e-12:
                lup_redistributions += 1
                lup_states.clear()
                velocity[:] = 0
                dt, alpha, positive = max(dt, .1), .1, 0
            elif factor < 1.:
                # Bound/geometry damping invalidates momentum but not valid secants.
                velocity *= factor
            images = candidate
            continue
        active = range(len(images)) if mode == 'optimize' else range(1, len(images)-1)
        if mode == 'perpendicular':
            for i in active:
                velocity[i] = perpendicular(velocity[i], tangents[i])
        power = float(np.sum(velocity * effective))
        if power > 0:
            positive += 1
            if positive > 5:
                dt, alpha = min(dt * 1.1, .5), alpha * .99
        else:
            velocity[:] = 0
            dt, alpha, positive = max(dt * .5, 1e-5), .1, 0
        vnorm, fnorm = np.linalg.norm(velocity), np.linalg.norm(effective)
        if fnorm > 0:
            velocity = (1-alpha)*velocity + alpha*vnorm/fnorm*effective
        velocity += dt * effective
        for i in active:
            displacement = dt * velocity[i]
            if mode == 'perpendicular':
                displacement = perpendicular(displacement, tangents[i])
            displacement *= min(1.0, data['maxMove'] / max(force_max(displacement), 1e-15))
            if mode == 'perpendicular':
                max_parallel_step = max(max_parallel_step, abs(float(np.sum(displacement*tangents[i]))))
            images[i] += displacement
            images[i, fixed] = anchors[i, fixed]
            velocity[i, fixed] = 0
        if not np.isfinite(images).all() or np.max(np.abs(images)) > 1e4:
            raise ValueError('座標が数値範囲を超えました。初期構造を確認してください。')


def ase_atoms(data, calculate):
    """Use exactly the configured local potential, in ASE's eV/Å units."""
    from ase import Atoms
    from ase.calculators.calculator import Calculator, all_changes

    class LocalCalculator(Calculator):
        implemented_properties = ['energy', 'forces']
        evaluations = 0

        def calculate(self, atoms=None, properties=('energy', 'forces'), system_changes=all_changes):
            super().calculate(atoms, properties, system_changes)
            positions = self.atoms.positions
            if not np.isfinite(positions).all() or np.max(np.abs(positions))>1e4:
                raise ValueError('座標が数値範囲を超えました。')
            if len(positions)>1:
                left,right = np.triu_indices(len(positions),1)
                vectors = positions[right]-positions[left]
                distances = find_mic(vectors,cell['vectors'],cell['pbc'])[1] if cell and any(cell['pbc']) else np.linalg.norm(vectors,axis=-1)
                if np.min(distances)<.1:
                    raise ValueError('最適化・振動変位中に0.1 Å未満の原子衝突を検出しました。')
            energy, force = calculate(0, positions.copy())
            force = np.asarray(force, dtype=float)
            if not math.isfinite(energy) or force.shape!=positions.shape or not np.isfinite(force).all():
                raise ValueError('有限のエネルギー・力を取得できません。')
            self.evaluations += 1
            self.results = {'energy': float(energy), 'forces': force.copy()}

    cell = data.get('cell')
    atoms = Atoms(data['symbols'], positions=data['images'][0],
                  cell=None if cell is None else cell['vectors'], pbc=False if cell is None else cell['pbc'])
    atoms.calc = LocalCalculator()
    if data.get('internalConstraints'):
        atoms.set_constraint(internal_coordinate_constraint(data))
    elif data.get('fixedAtoms'):
        from ase.constraints import FixAtoms
        atoms.set_constraint(FixAtoms(indices=data['fixedAtoms']))
    return atoms


def internal_coordinate_key(coordinate):
    indices = tuple(coordinate['atoms'])
    return coordinate['type'], min(indices, indices[::-1])


def validate_internal_coordinate(value, atom_count, scan=False):
    fields = {'type', 'atoms', 'start', 'stop', 'points'} if scan else {'type', 'atoms', 'value'}
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError('内部座標にはtype・atoms・value、スキャン座標にはtype・atoms・start・stop・pointsを指定してください。')
    kind, indices = value['type'], value['atoms']
    sizes = {'distance':2, 'angle':3, 'dihedral':4}
    if not isinstance(kind, str) or kind not in sizes or not isinstance(indices, list) or len(indices) != sizes[kind]:
        raise ValueError('距離は2原子、角度は3原子、二面角は4原子を指定してください。')
    if any(type(i) is not int or not 0 <= i < atom_count for i in indices) or len(set(indices)) != len(indices):
        raise ValueError('内部座標の原子番号は重複のない0始まりのインデックスにしてください。')
    limits = {'distance':(.1,100.), 'angle':(1.,179.), 'dihedral':(-360.,360.)}
    lo, hi = limits[kind]
    result = {'type':kind, 'atoms':indices[:]}
    for key in ('start','stop') if scan else ('value',):
        result[key] = number(value[key], f'{kind}.{key}', lo, hi)
    if scan:
        result['points'] = number(value['points'], 'スキャン点数', 2, 100, True)
        if abs(result['stop']-result['start']) < 1e-10:
            raise ValueError('スキャンの始点と終点は異なる値にしてください。')
        if kind == 'dihedral' and abs(result['stop']-result['start']) > 360:
            raise ValueError('二面角スキャンの範囲は360度以内にしてください。')
    return result


def validate_internal_constraints(data, normalized):
    values = data.get('internalConstraints', [])
    if not isinstance(values, list) or len(values)>100:
        raise ValueError('内部座標の拘束は100個以内の配列にしてください。')
    if values and (normalized['mode'] not in ('optimize','afir','scan') or 'vibrations' in data):
        raise ValueError('距離・角度・二面角の拘束はMIN・AFIR-MIN・緩和スキャン用です。振動解析との併用には対応していません。')
    result = [validate_internal_coordinate(c, len(normalized['symbols'])) for c in values]
    keys = [internal_coordinate_key(c) for c in result]
    if len(set(keys)) != len(keys):
        raise ValueError('同じ内部座標が重複して指定されています。')
    if len(result) >= 3*(len(normalized['symbols'])-len(normalized.get('fixedAtoms',[]))):
        raise ValueError('拘束が多すぎます。最適化できる自由度を残してください。')
    return result


def validate_scan_settings(data, normalized):
    config = data.get('scan', {})
    if normalized['mode'] != 'scan' or not isinstance(config, dict) or set(config)-{'coordinates','stopOnFailure'}:
        raise ValueError('scanは緩和スキャン専用です。coordinates・stopOnFailureを指定してください。')
    coordinates = config.get('coordinates')
    if not isinstance(coordinates, list) or not 1 <= len(coordinates) <= 2:
        raise ValueError('緩和スキャンは1または2個の内部座標を指定してください。')
    coordinates = [validate_internal_coordinate(c, len(normalized['symbols']), scan=True) for c in coordinates]
    if math.prod(c['points'] for c in coordinates)>400:
        raise ValueError('スキャンの総点数は400以下にしてください。')
    if type(config.get('stopOnFailure', True)) is not bool:
        raise ValueError('stopOnFailureには真偽値が必要です。')
    existing = normalized.get('internalConstraints', [])
    keys = [internal_coordinate_key(c) for c in existing+coordinates]
    if len(set(keys)) != len(keys):
        raise ValueError('スキャン座標が別のスキャン軸または固定した内部座標と重複しています。')
    if 'afir' in data or 'vibrations' in data:
        raise ValueError('緩和スキャンは人工力・振動解析を加えず実行します。')
    return {'coordinates':coordinates, 'stopOnFailure':config.get('stopOnFailure',True)}


def internal_coordinate_values(positions, coordinates, cell=None):
    from ase import Atoms
    atoms = Atoms(numbers=np.ones(len(positions), dtype=int), positions=positions,
        cell=None if cell is None else cell['vectors'], pbc=False if cell is None else cell['pbc'])
    mic = bool(cell and any(cell['pbc']))
    methods = {'distance':atoms.get_distance, 'angle':atoms.get_angle, 'dihedral':atoms.get_dihedral}
    return np.array([methods[c['type']](*c['atoms'], mic=mic) for c in coordinates], dtype=float)


def internal_coordinate_jacobian(positions, coordinates, cell=None):
    """ASE analytic Wilson B matrix, with angular rows measured in degrees/Å."""
    from ase.geometry import get_distances_derivatives, get_angles_derivatives, get_dihedrals_derivatives
    p = np.asarray(positions, dtype=float)
    kwargs = {'cell':cell['vectors'], 'pbc':cell['pbc']} if cell and any(cell['pbc']) else {}
    rows = []
    for coordinate in coordinates:
        ids, kind = coordinate['atoms'], coordinate['type']
        q = p[ids]
        if kind == 'distance':
            derivatives = get_distances_derivatives([q[1]-q[0]], **kwargs)[0]
        elif kind == 'angle':
            derivatives = get_angles_derivatives([q[0]-q[1]], [q[2]-q[1]], **kwargs)[0]
        else:
            derivatives = get_dihedrals_derivatives([q[1]-q[0]], [q[2]-q[1]], [q[3]-q[2]], **kwargs)[0]
        row = np.zeros_like(p); row[ids] = derivatives
        rows.append(row.ravel())
    result = np.array(rows).reshape((len(coordinates), p.size))
    if not np.isfinite(result).all():
        raise ValueError('内部座標の微分が定義できません。直線角や重なった原子を避けてください。')
    return result


def internal_coordinate_residual(values, coordinates):
    residual = np.asarray(values)-np.array([c['value'] for c in coordinates])
    for i,c in enumerate(coordinates):
        if c['type']=='dihedral':
            residual[i] = (residual[i]+180)%360-180
    return residual


def internal_coordinate_constraint(data):
    """Joint holonomic projection: fixed Cartesian atoms and internal coordinates.

    Uses ASE analytical derivatives. A single SVD projection avoids the order
    dependence of sequential FixAtoms/FixInternals and does not remove physical
    rigid-body forces. The latter is essential for fixed atoms and linear systems.
    """
    from ase.constraints import FixConstraint
    coordinates = copy.deepcopy(data['internalConstraints'])
    fixed = data.get('fixedAtoms', [])
    anchors = np.array(data['images'][0], dtype=float)
    cell = data.get('cell')
    free = np.ones(anchors.shape, dtype=bool); free[fixed] = False
    free = free.ravel()

    class InternalConstraint(FixConstraint):
        def get_removed_dof(self, atoms):
            jacobian = internal_coordinate_jacobian(atoms.positions, coordinates, cell)[:,free]
            return len(fixed)*3+int(np.linalg.matrix_rank(jacobian))

        def residual(self, positions):
            return internal_coordinate_residual(internal_coordinate_values(positions, coordinates, cell), coordinates)

        def project(self, positions):
            candidate = np.array(positions, dtype=float, copy=True)
            candidate[fixed] = anchors[fixed]
            for _ in range(160):
                residual = self.residual(candidate)
                if np.max(np.abs(residual)) <= 1e-8:
                    return candidate
                jacobian = internal_coordinate_jacobian(candidate, coordinates, cell)[:,free]
                norms = np.linalg.norm(jacobian,axis=1)
                if np.any((norms<1e-12)&(np.abs(residual)>1e-8)):
                    raise ValueError('固定原子と内部座標の目標値が両立しません。拘束対象を確認してください。')
                scales = np.maximum(norms, 1e-12)
                correction, _, _, _ = np.linalg.lstsq(jacobian/scales[:,None], -residual/scales, rcond=1e-10)
                displacement = np.zeros(candidate.size); displacement[free] = correction
                displacement = displacement.reshape(candidate.shape)
                maximum = force_max(displacement)
                displacement *= min(1., .2/max(maximum,1e-300))
                previous = float(np.linalg.norm(residual/scales))
                accepted = False
                for fraction in (1.,.5,.25,.125,.0625,.03125,.015625):
                    proposed = candidate+fraction*displacement
                    proposed[fixed] = anchors[fixed]
                    try:
                        error = np.linalg.norm(self.residual(proposed)/scales)
                    except (ValueError, ZeroDivisionError):
                        continue
                    if error<previous:
                        candidate = proposed; accepted = True; break
                if not accepted:
                    break
            raise ValueError('内部座標の拘束を満たす構造を生成できません。矛盾した拘束・直線角・大きすぎる目標変化を確認してください。')

        def adjust_positions(self, atoms, newpositions):
            displacement = newpositions-atoms.positions
            last_error = None
            for fraction in (1.,.5,.25,.125,.0625,.03125,.015625,.0078125,.00390625,.001953125):
                try:
                    candidate = self.project(atoms.positions+fraction*displacement)
                except (ValueError, ZeroDivisionError) as error:
                    last_error = error
                    continue
                if force_max(candidate-atoms.positions)<=data.get('maxMove',.04)+1e-10:
                    newpositions[:] = candidate
                    return
            raise ValueError('拘束を保ったまま指定した最大原子変位で更新できません。') from last_error

        def adjust_forces(self, atoms, forces):
            jacobian = internal_coordinate_jacobian(atoms.positions, coordinates, cell)[:,free]
            scales = np.maximum(np.linalg.norm(jacobian,axis=1),1e-12)
            jacobian = jacobian/scales[:,None]
            values = forces.ravel()[free]
            # J F = 0 in the allowed Cartesian subspace, independent of masses.
            multipliers = np.linalg.lstsq(jacobian.T, values, rcond=1e-10)[0]
            projected = values-jacobian.T@multipliers
            forces[:] = 0
            forces.ravel()[free] = projected

    return InternalConstraint()


def constrained_minimize(data, calculate, directory=None, progress=lambda p: None):
    """ASE MIN/AFIR-MIN on an explicitly projected holonomic manifold."""
    from ase.optimize import FIRE, LBFGS, BFGS
    afir = data['mode']=='afir'
    bias_terms = prepare_afir(data['symbols'], data['atomIds'], data['afir']) if afir else None
    last = {}

    def evaluate(index, positions):
        energy, force = calculate(index, positions)
        force = np.asarray(force,dtype=float)
        bias, artificial = afir_bias(positions,data['symbols'],data['atomIds'],data['afir'],bias_terms) if afir else (0.,np.zeros_like(force))
        last.update(positions=positions.copy(),energy=float(energy),force=force.copy(),bias=float(bias),artificial=artificial)
        return energy+bias, force+artificial

    atoms = ase_atoms(data,evaluate)
    initial = atoms.positions.copy()
    if data.get('internalConstraints'):
        atoms.positions[:] = atoms.constraints[0].project(initial)
    projection = {'inputPositions':initial.tolist(),'positions':atoms.positions.tolist(),
                  'maxDisplacement':force_max(atoms.positions-initial)}
    optimizer = {'fire':FIRE,'lbfgs':LBFGS,'bfgs':BFGS}[data.get('optimizer','fire')](atoms,maxstep=data['maxMove'],logfile=None)
    trajectory = {'images':[],'energies':[]}
    forces, maxima, physical_maxima, biases, history = [],[],[],[],[]
    force_components = {}

    def checkpoint():
        effective = atoms.get_forces(); maximum = force_max(effective)
        energy = last['energy']; physical = last['force']; bias = last['bias']
        positions = atoms.positions.tolist(); step = len(trajectory['images'])
        values = internal_coordinate_values(atoms.positions,data.get('internalConstraints',[]),data.get('cell')).tolist()
        if data.get('internalConstraints') and np.max(np.abs(internal_coordinate_residual(values,data['internalConstraints'])))>1e-6:
            raise ValueError('最適化中に内部座標の拘束誤差を検出しました。')
        trajectory['images'].append(positions);trajectory['energies'].append(energy)
        if afir:
            forces.append(physical.tolist())
        else:
            forces[:]=[physical.tolist()]
        maxima.append(maximum);physical_maxima.append(force_max(physical));biases.append(bias)
        components = {'physical':physical,'artificial':last['artificial'],'effective':effective,
                      'constraintCorrection':effective-physical-last['artificial']}
        for key,component in components.items():
            force_components[key] = [component.tolist()]
        mobile = np.ones(len(effective),dtype=bool);mobile[data.get('fixedAtoms',[])]=False
        summary = {'step':step,'fmax':maximum,'rmsForce':float(np.sqrt(np.mean(np.sum(effective[mobile]**2,axis=-1)))),
                   'physicalFmax':force_max(physical),'energies':[energy],'energyEV':energy,
                   'biasEnergyEV':bias,'evaluations':atoms.calc.evaluations,'constraintValues':values,
                   'componentFmax':{key:force_max(component) for key,component in components.items()}}
        history.append(summary)
        saved = {'positions':positions,'energy':energy,'force':physical.tolist(),'fmax':maximum,
                 'physicalFmax':force_max(physical),'bias':bias,'internalConstraints':data.get('internalConstraints',[]),
                 'constraintProjection':projection,'componentFmax':summary['componentFmax']}
        progress({**summary,'phase':'optimization','checkpoint':saved,
                  **({'preview':{'step':step,'images':[positions],'energies':[energy]}} if data.get('livePreview') else {})})

    optimizer.attach(checkpoint,interval=1)
    converged = bool(optimizer.run(fmax=data['fmax'],steps=data['maxSteps']))
    converged = converged and maxima[-1]<=data['fmax']
    result = dict(mode=data['mode'],images=[trajectory['images'][-1]],energies=[trajectory['energies'][-1]],
        forces=[forces[-1]],imageFmax=[maxima[-1]],effectiveFmax=maxima[-1],
        converged=converged,reason='converged' if converged else 'step_limit',steps=len(trajectory['images'])-1,
        evaluations=atoms.calc.evaluations,optimizer=data.get('optimizer','fire'),climbingImage=None,maxTangentialStep=None,
        trajectory=trajectory,history=history,fixedAtoms=data.get('fixedAtoms',[]),internalConstraints=data.get('internalConstraints',[]),
        constraintProjection=projection,validation='constrained-minimum-candidate',
        forceComponents=force_components,forceComponentImageIndices=[0],
        units={'length':'angstrom','energy':'eV','force':'eV/angstrom','angle':'degree'})
    if afir:
        result.update(schema='molecule-afir-trajectory/1',atomIds=data['atomIds'],images=trajectory['images'],energies=trajectory['energies'],
            forces=forces,imageFmax=maxima,physicalFmax=physical_maxima,biasEnergies=biases,
            biasedEnergies=[e+b for e,b in zip(trajectory['energies'],biases)],validation='biased-trajectory-not-ts',
            forceComponents=force_components,forceComponentImageIndices=[len(trajectory['images'])-1])
        result.pop('trajectory')
    return result


def relaxed_scan(data, calculate, directory, progress=lambda p: None):
    """Serpentine 1D/2D constrained minima; resume only fully evaluated grid nodes."""
    config = data['scan']; coordinates = config['coordinates']
    axes = [np.linspace(c['start'],c['stop'],c['points']).tolist() for c in coordinates]
    grid = [[x] for x in axes[0]] if len(axes)==1 else [[x,y] for i,x in enumerate(axes[0]) for y in (axes[1] if i%2==0 else axes[1][::-1])]
    result = dict(mode='scan',images=[],energies=[],forces=[],imageFmax=[],history=[],steps=0,evaluations=0,
        converged=False,reason='running',effectiveFmax=0.,climbingImage=None,maxTangentialStep=None,
        fixedAtoms=data.get('fixedAtoms',[]),internalConstraints=data.get('internalConstraints',[]),
        forceComponents={key:[] for key in ('physical','artificial','effective','constraintCorrection')},
        scan={**copy.deepcopy(config),'nodes':[],'totalNodes':len(grid),'order':'serpentine'},
        units={'length':'angstrom','energy':'eV','force':'eV/angstrom','angle':'degree'},validation='constrained-minima-not-ts')
    seed = copy.deepcopy(data['images'][0])
    resume = data.get('_scanResume')
    if resume:
        if resume.get('mode')!='scan' or resume.get('scan',{}).get('coordinates')!=coordinates:
            raise ValueError('保存されたスキャン条件が一致しません。')
        nodes = resume.get('scan',{}).get('nodes',[])
        if resume.get('energyComponents'):
            result['energyComponents']={key:[] for key in resume['energyComponents']}
        for i,node in enumerate(nodes):
            if i>=len(grid) or node.get('index')!=i or not np.allclose(node.get('targets',[]),grid[i],rtol=0,atol=1e-10):
                raise ValueError('保存されたスキャン点の順序・目標値が不正です。')
            if not node.get('converged'):
                break
            for key in ('images','energies','forces','imageFmax'):
                result[key].append(copy.deepcopy(resume[key][i]))
            for key in result.get('energyComponents',{}):
                result['energyComponents'][key].append(resume['energyComponents'][key][i])
            for key in result['forceComponents']:
                if key not in resume.get('forceComponents',{}) or len(resume['forceComponents'][key])<=i:
                    raise ValueError('保存されたスキャンの力成分が不足しています。')
                result['forceComponents'][key].append(copy.deepcopy(resume['forceComponents'][key][i]))
            result['scan']['nodes'].append(copy.deepcopy(node))
            if i<len(resume.get('history',[])):
                result['history'].append(copy.deepcopy(resume['history'][i]))
            result['steps'] += node['steps'];result['evaluations'] += node['evaluations']
        if result['images']:
            seed=copy.deepcopy(result['images'][-1])
    for index in range(len(result['images']),len(grid)):
        targets = grid[index]
        constraints = copy.deepcopy(data.get('internalConstraints',[]))+[
            {'type':c['type'],'atoms':c['atoms'],'value':value} for c,value in zip(coordinates,targets)]
        node_data = {**data,'mode':'optimize','images':[seed],'internalConstraints':constraints}
        def node_progress(value):
            public = {k:v for k,v in value.items() if k not in ('checkpoint','structureCheckpoint')}
            public.update(phase='scan',scanNode=index,scanTotal=len(grid),scanTargets=targets)
            progress(public)
        optimized = constrained_minimize(node_data,calculate,directory,node_progress)
        node_positions = optimized['images'][0]
        if optimized['converged']:
            seed = copy.deepcopy(node_positions)
        actual = internal_coordinate_values(node_positions,coordinates,data.get('cell')).tolist()
        node = {'index':index,'targets':targets,'actual':actual,'converged':optimized['converged'],
                'reason':optimized['reason'],'steps':optimized['steps'],'evaluations':optimized['evaluations'],
                'effectiveFmax':optimized['effectiveFmax']}
        for key in ('images','energies','forces','imageFmax'):
            result[key].append(optimized[key][0])
        for key in result['forceComponents']:
            result['forceComponents'][key].append(optimized['forceComponents'][key][0])
        result['scan']['nodes'].append(node)
        result['forceComponentImageIndices']=list(range(len(result['images'])))
        result['steps'] += optimized['steps'];result['evaluations'] += optimized['evaluations']
        result['effectiveFmax'] = max(result['imageFmax'])
        result['history'].append({'step':result['steps'],'scanNode':index,'fmax':optimized['effectiveFmax'],
            'energyEV':optimized['energies'][0],'energies':result['energies'][:],'evaluations':result['evaluations'],
            'componentFmax':optimized['history'][-1]['componentFmax']})
        progress({'phase':'scan','scanNode':index,'scanTotal':len(grid),'scanTargets':targets,
            'structureCheckpoint':copy.deepcopy(result),
            **({'preview':{'step':result['steps'],'images':copy.deepcopy(result['images']),'energies':result['energies'][:]}} if data.get('livePreview') else {})})
        if not optimized['converged'] and config['stopOnFailure']:
            result['reason']='scan_node_unconverged'
            break
    else:
        result['converged']=all(n['converged'] for n in result['scan']['nodes'])
        result['reason']='converged' if result['converged'] else 'scan_nodes_unconverged'
    result['effectiveFmax']=max(result['imageFmax'],default=0.)
    result['forceComponentImageIndices']=list(range(len(result['images'])))
    return result


def ase_optimize(data, calculate, progress=lambda p: None):
    """Accepted optimization iterates only; Hessian probes are not trajectory frames."""
    atoms = ase_atoms(data, calculate)
    if data['mode']=='ts':
        try:
            from sella import Sella
        except ImportError as error:
            raise ValueError('SellaをこのPython環境に導入してください: python -m pip install "sella>=2.6,<3"') from error
        optimizer = Sella(atoms, order=1, method=data['optimizer'].removeprefix('sella-'),
                          delta0=data['trustRadius'], internal=False, logfile=None, trajectory=None)
    else:
        from ase.optimize import LBFGS, BFGS
        optimizer = (LBFGS if data['optimizer']=='lbfgs' else BFGS)(atoms, maxstep=data['maxMove'], logfile=None)
    trajectory, history = {'images': [], 'energies': []}, []

    def checkpoint():
        energy, force = atoms.get_potential_energy(), atoms.get_forces()
        physical = atoms.get_forces(apply_constraint=False)
        maximum = force_max(force)
        positions = atoms.positions.tolist()
        step = len(trajectory['images'])
        trajectory['images'].append(positions); trajectory['energies'].append(float(energy))
        summary = dict(step=step, fmax=maximum, energies=[float(energy)], evaluations=atoms.calc.evaluations,
            rmsForce=float(np.sqrt(np.mean(np.sum(force**2, axis=-1)))), physicalFmax=force_max(physical),
            energyChangeEV=0. if step==0 else float(energy-trajectory['energies'][-2]),
            maxDisplacement=0. if step==0 else force_max(atoms.positions-np.array(trajectory['images'][-2])),
            componentFmax={'physical':force_max(physical), 'effective':maximum, 'constraintCorrection':force_max(force-physical)})
        history.append(summary)
        progress({**summary, 'phase':'optimization', 'checkpoint':dict(positions=positions, energy=float(energy), force=physical.tolist(), fmax=maximum, diagnostic=summary),
            **({'preview':dict(step=step, images=[positions], energies=[float(energy)])} if data.get('livePreview') else {})})

    optimizer.attach(checkpoint, interval=1)
    converged = bool(optimizer.run(fmax=data['fmax'], steps=data['maxSteps']))
    force = atoms.get_forces(); maximum = force_max(force)
    converged = converged and maximum<=data['fmax']
    return dict(images=[atoms.positions.tolist()], energies=[float(atoms.get_potential_energy())], forces=[atoms.get_forces(apply_constraint=False).tolist()],
        imageFmax=[maximum], effectiveFmax=maximum, converged=converged, reason='converged' if converged else 'step_limit',
        steps=len(trajectory['images'])-1, evaluations=atoms.calc.evaluations, mode=data['mode'], optimizer=data['optimizer'],
        climbingImage=None, maxTangentialStep=None, trajectory=trajectory, history=history, fixedAtoms=data.get('fixedAtoms', []),
        forceComponents={'physical':[atoms.get_forces(apply_constraint=False).tolist()], 'effective':[force.tolist()],
                         'constraintCorrection':[(force-atoms.get_forces(apply_constraint=False)).tolist()]},
        validation='saddle-candidate-not-verified' if data['mode']=='ts' else 'minimum-candidate',
        units={'length':'angstrom', 'energy':'eV', 'force':'eV/angstrom'})


def vibration_analysis(data, calculate, directory, progress=lambda p: None):
    """Central force differences; ASE mass-weighted Hessian, all 3N modes retained."""
    from ase.vibrations import Vibrations
    settings = data['vibrations']
    total = 1 + len(data['symbols'])*3*settings['nfree']
    done = 0

    def evaluate(index, positions):
        nonlocal done
        answer = calculate(index, positions)
        done += 1
        progress({'phase':'vibrations', 'vibrationDone':done, 'vibrationTotal':total})
        return answer

    atoms = ase_atoms(data, evaluate)
    vibrations = Vibrations(atoms, name=str(Path(directory)/'vibrations'), delta=settings['delta'], nfree=settings['nfree'])
    try:
        vibrations.run()
        modes = vibrations.get_vibrations()
        frequencies, energies = modes.get_frequencies(), modes.get_energies()
        vectors = modes.get_modes(all_atoms=True)
        if not np.isfinite(frequencies).all() or not np.isfinite(energies).all() or not np.isfinite(vectors).all():
            raise ValueError('振動解析の結果が非有限値です。')
        imaginary = frequencies.imag>0
        return dict(schema='molecule-vibrations/1', status='completed', settings=settings,
            frequenciesCM=[float(abs(f)) for f in frequencies], imaginary=imaginary.tolist(),
            quantaMEV=[float(abs(e)*1000) for e in energies], modes=vectors.tolist(), masses=atoms.get_masses().tolist(),
            significantImaginaryCount=int(np.sum(frequencies.imag>settings['imaginaryThreshold'])),
            evaluations=done, positions=atoms.positions.tolist(), symbols=data['symbols'],
            units={'frequency':'cm^-1', 'quantum':'meV', 'displacement':'ASE Cartesian normal modes'},
            note='全3Nモード。並進・回転を射影除去していません。表示振幅は任意で、虚振動の動画は実時間の振動ではありません。')
    finally:
        vibrations.clean()


def calculate_job(data, calculate, directory, progress=lambda p: None):
    if data['mode']=='irc':
        result = irc_calculation(data, calculate, directory, progress)
    elif data['mode']=='scan':
        result = relaxed_scan(data, calculate, directory, progress)
    elif data.get('internalConstraints') and data['mode'] in ('optimize', 'afir'):
        result = constrained_minimize(data, calculate, directory, progress)
    elif data['mode']=='afir':
        result = afir_relax(data, calculate, progress)
    elif data['mode']=='ts' or (data['mode']=='optimize' and data.get('optimizer','fire')!='fire'):
        result = ase_optimize(data, calculate, progress)
    else:
        result = relax({**data, 'mode':'evaluate'} if data['mode']=='vibrations' else data, calculate, progress)
        result['mode'] = data['mode']
        if data['mode']=='optimize':
            result['optimizer'] = 'fire'
    if 'vibrations' in data:
        # A failed Hessian calculation must not discard a valid optimized structure.
        progress({'structureCheckpoint':copy.deepcopy(result)})
        try:
            result['vibrations'] = vibration_analysis({**data, 'images':result['images']}, calculate, directory, progress)
        except Exception as error:
            result['vibrations'] = {'status':'failed', 'error':str(error)[:2500]}
    if 'thermochemistry' in data:
        try:
            result['thermochemistry'] = thermochemistry_analysis(data, result)
        except Exception as error:
            result['thermochemistry'] = {'status':'failed', 'error':str(error)[:2500]}
    return result


def validate_irc_settings(data, normalized):
    """IRC has a mass-weighted path length, distinct from Cartesian maxMove."""
    if normalized['mode'] != 'irc':
        if 'irc' in data:
            raise ValueError('irc設定はIRC計算専用です。')
        return
    settings = data.get('irc', {})
    if not isinstance(settings, dict) or set(settings)-{'direction', 'stepSize', 'relaxEndpoints'}:
        raise ValueError('IRC設定が不正です。')
    direction = settings.get('direction', 'both')
    if direction not in ('both', 'forward', 'reverse') or type(settings.get('relaxEndpoints', True)) is not bool:
        raise ValueError('IRC方向はboth/forward/reverse、端点緩和は真偽値で指定してください。')
    if len(normalized['images']) != 1 or len(normalized['symbols']) > 200:
        raise ValueError('IRCは200原子以下の単一TS候補構造から開始します。')
    if normalized.get('fixedAtoms') or data.get('internalConstraints') or data.get('constraints') or data.get('afir') or data.get('vibrations'):
        raise ValueError('IRCには拘束・人工力・同時振動解析を指定できません。')
    if normalized.get('cell') and any(normalized['cell']['pbc']):
        raise ValueError('IRCは非周期分子用です。')
    normalized['irc'] = dict(direction=direction,
        stepSize=number(settings.get('stepSize', .1), 'IRCステップ幅 (Å√amu)', .005, .5),
        relaxEndpoints=settings.get('relaxEndpoints', True))


def irc_calculation(data, calculate, directory, progress=lambda p: None):
    """Sella mass-weighted IRC; only accepted outer iterates are path frames."""
    try:
        from sella import IRC
    except ImportError as error:
        raise ValueError('IRCにはSellaが必要です: python -m pip install "sella>=2.6,<3"') from error
    from ase.optimize import BFGS
    settings = data['irc']
    directions = ('reverse', 'forward') if settings['direction'] == 'both' else (settings['direction'],)
    initial = np.asarray(data['images'][0], dtype=float)
    energy0, force0 = calculate(0, initial.copy())
    force0 = np.asarray(force0, dtype=float)
    if not math.isfinite(energy0) or force0.shape != initial.shape or not np.isfinite(force0).all():
        raise ValueError('IRC初期構造のエネルギー・力が不正です。')
    if force_max(force0) > data['fmax']:
        raise ValueError('IRC初期構造の最大力が収束閾値を超えています。先にTS最適化を収束させてください。')
    origin = dict(positions=initial.tolist(), energy=float(energy0), force=force0.tolist(), fmax=force_max(force0), phase='ts')
    branch_frames = {direction:[copy.deepcopy(origin)] for direction in directions}
    branches, history, evaluations = {}, [], 1
    active_atoms = None

    def force_diagnostics(force):
        maximum = force_max(force)
        return dict(physicalFmax=maximum, rmsForce=float(np.sqrt(np.mean(np.sum(force**2, axis=-1)))),
                    componentFmax={'physical':maximum}, forceMeaning='physical-force-not-irc-update')

    def assembled(reason='running'):
        reverse = list(reversed(branch_frames.get('reverse', [origin])))
        forward = branch_frames.get('forward', [origin])
        frames = reverse + forward[1:] if settings['direction'] == 'both' else (reverse if settings['direction'] == 'reverse' else forward)
        ts_index = len(reverse)-1 if settings['direction'] in ('both', 'reverse') else 0
        end_forces = [items[-1]['fmax'] for items in branch_frames.values()]
        count = evaluations + (active_atoms.calc.evaluations if active_atoms is not None else 0)
        endpoints = sorted(set((0, len(frames)-1)))
        return dict(mode='irc', images=[f['positions'] for f in frames], energies=[f['energy'] for f in frames],
            forces=[f['force'] for f in frames], imageFmax=[f['fmax'] for f in frames],
            effectiveFmax=max(end_forces), steps=sum(len(items)-1 for items in branch_frames.values()), evaluations=count,
            converged=reason == 'converged', reason=reason, climbingImage=None, tsIndex=ts_index,
            history=copy.deepcopy(history), branches=copy.deepcopy(branches), irc=settings, fixedAtoms=[],
            diagnostics=copy.deepcopy(history[-1]['diagnostics']) if history else force_diagnostics(force0),
            forceComponents={'physical':[frames[i]['force'] for i in endpoints]}, forceComponentImageIndices=endpoints,
            forceComponentNote='物理力のみ。IRCの質量重み付き経路追跡による更新方向ではありません。',
            framePhases=[f['phase'] for f in frames], masses=active_atoms.get_masses().tolist() if active_atoms is not None else [],
            validation='irc-from-stationary-saddle-candidate-endpoint-identities-not-verified',
            units={'length':'angstrom', 'energy':'eV', 'force':'eV/angstrom', 'ircStep':'angstrom*sqrt(amu)'})

    for direction in directions:
        atoms = active_atoms = ase_atoms(data, calculate)
        # Preserve ASE masses explicitly; Sella otherwise selects isotope masses.
        atoms.set_masses(atoms.get_masses())
        optimizer = IRC(atoms, dx=settings['stepSize'], ninner_iter=50,
                        keep_going=False, logfile=None, trajectory=None)
        phase = 'irc'

        def checkpoint():
            p = atoms.positions.tolist()
            f, e = atoms.get_forces(), float(atoms.get_potential_energy())
            if p == branch_frames[direction][-1]['positions']:
                return
            maximum = force_max(f)
            previous = branch_frames[direction][-1]
            diagnostics = force_diagnostics(f)
            diagnostics.update(energyChangeEV=abs(e-previous['energy']),
                maxDisplacement=force_max(np.asarray(p)-previous['positions']))
            branch_frames[direction].append(dict(positions=p, energy=e, force=f.tolist(), fmax=maximum, phase=phase))
            history.append(dict(step=len(history)+1, phase=phase, direction=direction,
                fmax=maximum, energies=[e], evaluations=evaluations+atoms.calc.evaluations, diagnostics=diagnostics))
            partial = assembled()
            progress({**history[-1], 'structureCheckpoint':partial,
                **({'preview':dict(step=partial['steps'], images=partial['images'], energies=partial['energies'])} if data.get('livePreview') else {})})

        optimizer.attach(checkpoint, interval=1)
        run = optimizer.irun(fmax=data['fmax'], fmax_inner=min(.01, data['fmax']), steps=data['maxSteps'], direction=direction)
        # Sella initializes its approximate Hessian before returning the iterator.
        # This detects an unsuitable minimum but is not a full frequency verification.
        weighted = optimizer.H0 / np.outer(optimizer.sqrtm, optimizer.sqrtm)
        if float(np.linalg.eigvalsh(weighted)[0]) >= -1e-8:
            raise ValueError('IRC初期Hessianに負曲率がありません。振動解析でTS候補を確認してください。')
        converged = False
        try:
            for converged in run:
                pass
        except RuntimeError as error:
            if type(error).__name__ == 'IRCInnerLoopConvergenceFailure':
                raise ValueError('IRCの内部反復が収束しませんでした。直前までの経路を保持しています。IRCステップ幅を小さくしてTSから再実行してください。') from error
            raise
        irc_steps = len(branch_frames[direction])-1
        # Endpoint minimization is separate from the IRC and clearly tagged.
        endpoint_converged = bool(converged)
        endpoint_steps = 0
        if settings['relaxEndpoints'] and irc_steps and force_max(atoms.get_forces()) > data['fmax']:
            phase = 'endpoint_minimization'
            minimizer = BFGS(atoms, maxstep=data['maxMove'], logfile=None, trajectory=None)
            minimizer.attach(checkpoint, interval=1)
            endpoint_converged = bool(minimizer.run(fmax=data['fmax'], steps=data['maxSteps']))
            endpoint_steps = len(branch_frames[direction])-1-irc_steps
        elif irc_steps:
            endpoint_converged = force_max(atoms.get_forces()) <= data['fmax']
        branches[direction] = dict(converged=bool(converged), steps=irc_steps,
            endpointConverged=endpoint_converged, endpointSteps=endpoint_steps,
            endpoint=copy.deepcopy(branch_frames[direction][-1]),
            endpointVerifiedMinimum=False)
        evaluations += atoms.calc.evaluations
        active_atoms = None
        progress({'phase':'irc', 'direction':direction, 'structureCheckpoint':assembled()})
    completed = all(branches[d]['converged'] for d in directions)
    answer = assembled('converged' if completed else 'step_limit')
    answer['masses'] = atoms.get_masses().tolist()
    return answer


def validate_thermochemistry_settings(data, normalized):
    if 'thermochemistry' not in data:
        return
    settings = data['thermochemistry']
    keys = {'temperature', 'pressure', 'symmetryNumber', 'state', 'standardState', 'lowFrequency', 'frequencyCutoff'}
    if not isinstance(settings, dict) or set(settings)-keys or normalized['mode'] not in ('optimize', 'ts', 'vibrations'):
        raise ValueError('熱化学量は単一構造の最適化・TS・振動解析で指定してください。')
    if 'vibrations' not in normalized or normalized.get('fixedAtoms') or data.get('internalConstraints') or data.get('constraints'):
        raise ValueError('熱化学量には拘束のない分子全体の振動解析が必要です。')
    state = settings.get('state', 'ts' if normalized['mode'] == 'ts' else 'minimum')
    standard = settings.get('standardState', 'gas')
    low = settings.get('lowFrequency', 'harmonic')
    if state not in ('minimum', 'ts') or standard not in ('gas', '1M') or low not in ('harmonic', 'floor'):
        raise ValueError('熱化学量の構造種別・標準状態・低振動数処理が不正です。')
    if normalized['mode'] == 'ts' and state != 'ts':
        raise ValueError('TS最適化後の熱化学量はstate=tsにしてください。')
    if normalized.get('cell') and any(normalized['cell']['pbc']):
        raise ValueError('この熱化学量計算は非周期分子の理想気体近似です。')
    normalized['thermochemistry'] = dict(
        temperature=number(settings.get('temperature', 298.15), '温度 (K)', 1, 5000),
        pressure=number(settings.get('pressure', 101325), '圧力 (Pa)', .001, 1e9),
        symmetryNumber=number(settings.get('symmetryNumber', 1), '回転対称数', 1, 10000, True),
        state=state, standardState=standard, lowFrequency=low,
        frequencyCutoff=number(settings.get('frequencyCutoff', 100), '低振動数の下限 (cm⁻¹)', 1, 1000))


def projected_vibrational_quanta(vibration):
    """Reconstruct energy-squared dynamical matrix and remove rigid motions.

    ASE Cartesian modes are mass-normalized. Projecting their reconstructed
    Hessian avoids deleting the lowest absolute frequencies, which can delete a
    genuine soft vibration while retaining a spurious rotation.
    """
    positions = np.asarray(vibration['positions'], dtype=float)
    masses = np.asarray(vibration['masses'], dtype=float)
    n = len(masses)
    modes = np.asarray(vibration['modes'], dtype=float).reshape(3*n, 3*n)
    energies = np.asarray(vibration['quantaMEV'], dtype=float)/1000
    imaginary = np.asarray(vibration['imaginary'], dtype=bool)
    if positions.shape != (n, 3) or np.any(masses <= 0) or energies.shape != (3*n,) or imaginary.shape != (3*n,):
        raise ValueError('振動解析の質量・モード数が不正です。')
    if not all(np.isfinite(value).all() for value in (positions, masses, modes, energies)):
        raise ValueError('振動解析に非有限値があります。')
    root_mass = np.sqrt(masses)
    eigenvectors = modes*np.repeat(root_mass, 3)[None, :]
    if not np.allclose(eigenvectors@eigenvectors.T, np.eye(3*n), atol=1e-5):
        raise ValueError('振動モードが質量規格化されていません。')
    dynamical = (eigenvectors.T*(np.where(imaginary, -1., 1.)*energies**2))@eigenvectors
    centered = positions-np.average(positions, axis=0, weights=masses)
    rigid = []
    for axis in np.eye(3):
        rigid.append((root_mass[:, None]*axis).reshape(-1))
        rigid.append((root_mass[:, None]*np.cross(axis, centered)).reshape(-1))
    u, singular, _ = np.linalg.svd(np.asarray(rigid).T, full_matrices=True)
    rank = int(np.sum(singular > max(singular[0]*1e-7, 1e-10)))
    expected = 3 if n == 1 else 5 if rank == 5 else 6
    if rank != expected:
        raise ValueError('並進・回転自由度を決定できません。退化した分子構造を確認してください。')
    basis = u[:, rank:]
    values = np.linalg.eigvalsh(basis.T@dynamical@basis)
    signed = np.sign(values)*np.sqrt(np.abs(values))
    return signed, 'monatomic' if n == 1 else 'linear' if rank == 5 else 'nonlinear', rank


def thermochemistry_analysis(data, result):
    """Molecular RRHO with explicit stationary-point and imaginary-mode checks."""
    from ase import Atoms
    from ase.thermochemistry import IdealGasThermo
    from ase.units import kB, invcm, _k, _Nav
    import inspect
    settings = data['thermochemistry']
    vibration = result.get('vibrations', {})
    if vibration.get('status') != 'completed':
        raise ValueError('熱化学量には完了した振動解析が必要です。')
    if len(result.get('energies', [])) != 1 or result.get('effectiveFmax', math.inf) > data['fmax']:
        raise ValueError('未収束構造の熱化学量は計算しません。先に最大力を指定閾値まで収束させてください。')
    if not np.allclose(vibration['positions'], result['images'][0], rtol=0, atol=1e-10):
        raise ValueError('振動解析とエネルギーの構造が一致しません。')
    quanta, geometry, rigid_count = projected_vibrational_quanta(vibration)
    significant = quanta < -max(vibration.get('settings', {}).get('imaginaryThreshold', 20), .001)*invcm
    expected = 1 if settings['state'] == 'ts' else 0
    if int(np.sum(significant)) != expected:
        raise ValueError(f'射影後の有意な虚振動は{int(np.sum(significant))}個です。{settings["state"]}には{expected}個必要です。')
    retained = quanta[~significant]
    if np.any(retained < -.001*invcm):
        raise ValueError('微小な虚振動が残っています。差分幅・精度・収束を確認し、実振動として確認してください。')
    if len(retained) and np.min(retained) <= 1e-6*invcm:
        raise ValueError('内部振動にゼロ周波数があります。非結合フラグメントを分けるか、構造と振動解析を確認してください。')
    atoms = Atoms(data['symbols'], positions=result['images'][0], masses=vibration['masses'])
    energy = float(result['energies'][0])
    if not math.isfinite(energy):
        raise ValueError('熱化学量の基準エネルギーが非有限値です。')
    common = dict(geometry=geometry, potentialenergy=energy, atoms=atoms,
                  symmetrynumber=settings['symmetryNumber'], spin=(data['multiplicity']-1)/2,
                  ignore_imag_modes=False)
    # Newer ASE can explicitly keep the 3N-7 TS spectrum. Older ASE only slices
    # spectra longer than 3N-6, so the already projected list is unchanged.
    if 'vib_selection' in inspect.signature(IdealGasThermo).parameters:
        common['vib_selection'] = 'all'
    thermo = IdealGasThermo(vib_energies=retained.tolist(), **common)
    temperature, pressure = settings['temperature'], settings['pressure']
    enthalpy = float(thermo.get_enthalpy(temperature, verbose=False))
    entropy = float(thermo.get_entropy(temperature, pressure, verbose=False))
    notes = ['並進・回転を質量重み付きHessianから射影除去した分子RRHO近似です。',
             '回転対称数は入力値を使用します。電子状態の熱励起は含めません。']
    if settings['lowFrequency'] == 'floor':
        entropy_thermo = IdealGasThermo(vib_energies=np.maximum(retained, settings['frequencyCutoff']*invcm).tolist(), **common)
        entropy = float(entropy_thermo.get_entropy(temperature, pressure, verbose=False))
        notes.append('低振動数の下限は振動エントロピーのみに適用し、ZPEとエンタルピーは元の実振動数を使用します。')
    standard_correction = 0.
    if settings['standardState'] == '1M':
        # 1 mol/L = 1000 mol/m³, ideal reference pressure cRT.
        standard_correction = kB*temperature*math.log(1000*_Nav*_k*temperature/pressure)
        entropy -= standard_correction/temperature
        notes.append('1 mol/Lへの標準状態換算を理想気体の並進項に適用しています。')
    if data.get('solvation'):
        notes.append('基準値はUMA+AnySolvです。溶媒補正と分子RRHO補正の和による推定であり、溶液中の全自由エネルギーを厳密に与えるものではありません。標準状態の整合性を確認してください。')
    gibbs = enthalpy-temperature*entropy
    answer = dict(schema='molecule-thermochemistry/1', status='completed', **settings, geometry=geometry,
        electronicEnergyEV=energy, zpeEV=float(np.sum(retained)/2), enthalpyEV=enthalpy,
        entropyEVPerK=entropy, gibbsEV=gibbs, thermalCorrectionEV=gibbs-energy,
        standardStateCorrectionEV=float(standard_correction), frequenciesCM=(quanta/invcm).tolist(),
        retainedVibrations=len(retained), removedRigidMotions=rigid_count, imaginaryModesRemoved=expected,
        notes=notes, units={'energy':'eV', 'entropy':'eV/K', 'temperature':'K', 'pressure':'Pa', 'frequency':'cm^-1'})
    if not all(math.isfinite(answer[key]) for key in ('enthalpyEV', 'entropyEVPerK', 'gibbsEV', 'zpeEV')):
        raise ValueError('熱化学量が非有限値です。振動数と温度を確認してください。')
    return answer


def sella_version():
    try:
        return importlib.metadata.version('sella')
    except importlib.metadata.PackageNotFoundError:
        return None


class TBLiteEngine:
    def __init__(self, data, config, directory):
        from tblite.interface import Calculator
        self.Calculator, self.data, self.config = Calculator, data, config
        self.calculators, self.results = {}, {}

    def __call__(self, index, positions):
        if index not in self.calculators:
            cell = self.data['cell']
            calc = self.Calculator(self.config['method'], np.array([atomic_numbers[s] for s in self.data['symbols']]),
                positions / Bohr, charge=float(self.data['charge']), uhf=self.data['multiplicity']-1,
                lattice=None if cell is None else np.array(cell['vectors']) / Bohr,
                periodic=None if cell is None else np.array(cell['pbc'], dtype=bool))
            calc.set('verbosity', 0)
            calc.set('max-iter', 250)
            calc.set('accuracy', .01 if self.data['mode'] in ('ts', 'irc') or 'vibrations' in self.data else 1.0)
            self.calculators[index] = calc
        calc = self.calculators[index]
        calc.update(positions / Bohr)
        result = calc.singlepoint(self.results.get(index))
        self.results[index] = result
        return float(result.get('energy')) * Hartree, -np.asarray(result.get('gradient')) * Hartree / Bohr


def parse_gradient(text, symbols, positions):
    """Strict reader for the Turbomole $grad output of xtb --gxtb --grad."""
    blocks = re.findall(r'cycle\s*=.*?(?=\n\s*cycle\s*=|\n\s*\$end|\Z)', text, re.S | re.I)
    if '$grad' not in text or not blocks:
        raise ValueError('g-xTBのgradient出力を読み取れません。--grad対応版を確認してください。')
    lines = [line.strip() for line in blocks[-1].splitlines() if line.strip()]
    match = re.search(r'(?:SCF\s+)?energy\s*=\s*([-+\d.eEdD]+)', lines[0], re.I)
    n = len(symbols)
    if not match or len(lines) != 1 + 2*n:
        raise ValueError('g-xTB gradientの原子数またはエネルギーが不正です。')
    convert = lambda token: float(token.replace('D', 'E').replace('d', 'e'))
    coords, gradient = [], []
    for i in range(n):
        fields = lines[1+i].split()
        if len(fields) != 4 or fields[3].lower() != symbols[i].lower():
            raise ValueError('g-xTB gradientの元素・File-orderが一致しません。')
        coords.append([convert(v) for v in fields[:3]])
        fields = lines[1+n+i].split()
        if len(fields) != 3:
            raise ValueError('g-xTB gradientの成分数が不正です。')
        gradient.append([convert(v) for v in fields])
    if not np.allclose(np.array(coords)*Bohr, positions, atol=2e-5, rtol=0):
        raise ValueError('g-xTBが返した座標が入力と一致しません。')
    energy, force = convert(match[1])*Hartree, -np.array(gradient)*Hartree/Bohr
    if not math.isfinite(energy) or not np.isfinite(force).all():
        raise ValueError('g-xTBが非有限値を返しました。')
    return energy, force


class GXTBEngine:
    def __init__(self, data, config, directory):
        self.data, self.config, self.directory = data, config, Path(directory)

    def __call__(self, index, positions):
        # Fresh directory per evaluation prevents stale gradients/restart files.
        with tempfile.TemporaryDirectory(prefix='image-', dir=self.directory) as name:
            work = Path(name)
            symbols = self.data['symbols']
            (work/'input.xyz').write_text(str(len(symbols))+'\nMolecule Studio\n'+''.join(
                f'{s} {p[0]:.12f} {p[1]:.12f} {p[2]:.12f}\n' for s, p in zip(symbols, positions)))
            command = [self.config['binary'], 'input.xyz', '--gxtb', '--grad', '--chrg', str(self.data['charge'])]
            if self.data['multiplicity'] > 1:
                command += ['--uhf', str(self.data['multiplicity']-1)]
            with (work/'engine.log').open('w+') as log:
                completed = subprocess.run(command, cwd=work, stdin=subprocess.DEVNULL, stdout=log,
                                           stderr=subprocess.STDOUT, shell=False, timeout=self.config['evaluationTimeout'])
                log.seek(0, 2)
                size = log.tell()
                log.seek(max(0, size-16000))
                output = log.read()
            if completed.returncode != 0 or re.search(r'(?:failed\s+to\s+converge|not\s+converged|abnormal\s+termination|SCF\s+NOT\s+CONVERGED)', output, re.I):
                raise ValueError('g-xTB計算に失敗しました。'+output[-1500:])
            gradient = work/'gradient'
            if not gradient.is_file() or gradient.stat().st_size > 1024*1024:
                raise ValueError('g-xTBのgradientファイルがありません。--gxtb --grad対応のxtb実行ファイルを指定してください。'+output[-500:])
            return parse_gradient(gradient.read_text(), symbols, positions)


def device_name(value):
    if not isinstance(value, str) or not re.fullmatch(r'cpu|cuda(?::(?:0|[1-9][0-9]?))?', value):
        raise ValueError('デバイスはcpuまたはcuda:0、cuda:1の形式で指定してください。')
    return 'cuda:0' if value == 'cuda' else value


def device_inventory(torch):
    """UI ordinals refer to the parent's visible CUDA devices, including masks/UUIDs."""
    devices = [{'id':'cpu', 'label':'CPU'}]
    masks = {}
    visible = os.environ.get('CUDA_VISIBLE_DEVICES')
    tokens = visible.split(',') if visible is not None else None
    for i in range(torch.cuda.device_count() if torch.cuda.is_available() else 0):
        key = f'cuda:{i}'
        devices.append({'id':key, 'label':f'{key} · {torch.cuda.get_device_name(i)}'})
        masks[key] = tokens[i].strip() if tokens is not None else str(i)
    return devices, masks


def isolate_device(config, key):
    """Call in a freshly spawned process BEFORE torch/fairchem imports."""
    device = device_name(config[key])
    if device == 'cpu':
        os.environ['CUDA_VISIBLE_DEVICES'] = ''
        return 'cpu'
    os.environ['CUDA_VISIBLE_DEVICES'] = config['cudaMasks'][device]
    return 'cuda'  # fairchem accepts only cpu/cuda; this process sees one GPU.


def anysolv_catalog(config, checkpoint=None):
    if package_version('anysolv') != '0.1.0':
        raise ValueError('AnySolvには anysolv==0.1.0 を同じPython環境へ導入してください。')
    try:
        import anysolv
        from anysolv.solvent import list_solvents
        root = Path(anysolv.__file__).resolve().parent / 'models'
        paths = {m:str(root/f'{m}.pt') for m in ANYSOLV_MODELS if (root/f'{m}.pt').is_file()}
        if checkpoint:
            path = Path(checkpoint)
            if not path.is_absolute() or not path.is_file():
                raise ValueError('checkpoint')
            paths[config['anysolvModel']] = str(path.resolve())
        if config['anysolvModel'] not in paths:
            raise ValueError('model missing')
        config['anysolvPaths'] = paths
        config['anysolvHashes'] = {}
        for model, path in paths.items():
            digest = hashlib.sha256()
            with open(path, 'rb') as stream:
                for chunk in iter(lambda:stream.read(1024*1024), b''):
                    digest.update(chunk)
            config['anysolvHashes'][model] = digest.hexdigest()
        config['anysolvSolvents'] = list_solvents()
    except Exception as error:
        raise ValueError('AnySolvの溶媒表・モデルを確認できません。--anysolv-model と --anysolv-checkpoint のローカルファイルを確認してください。モデルの自動切り替えは行いません。') from error


def job_config(data, config):
    result = dict(config)
    if 'umaDevice' in data:
        if data['umaDevice'] not in [d['id'] for d in config.get('devices', [])]:
            raise ValueError('選択したUMAデバイスを利用できません。再接続してください。')
        result['umaDevice'] = data['umaDevice']
    if 'solvation' in data:
        s = data['solvation']
        if not config.get('anysolv') or s['model'] not in config.get('anysolvPaths', {}):
            raise ValueError('AnySolvモデルが有効ではありません。--anysolv で起動し、モデルを導入して再接続してください。')
        if s['solvent'] not in config['anysolvSolvents']:
            raise ValueError('AnySolvの溶媒一覧から選択してください。')
        if s['device'] not in [d['id'] for d in config['devices']]:
            raise ValueError('選択したAnySolvデバイスを利用できません。')
        result['solvation'] = dict(s)
    return result


class AnySolvEngine:
    def __init__(self, data, config, directory):
        import torch
        from anysolv.predict import predict_solvation_energy
        torch.set_num_threads(config['threads'])
        self.predict, self.data = predict_solvation_energy, data
        s = config['solvation']
        self.kwargs = dict(charge=data['charge'], spin=data['multiplicity'], solvent=s['solvent'],
            checkpoint=config['anysolvPaths'][s['model']], device=config['anysolvRuntimeDevice'],
            dtype=getattr(torch, config['umaPrecision']), inference_settings='default')
        self.numbers = np.array([atomic_numbers[s] for s in data['symbols']])

    def __call__(self, index, positions):
        # Reference conservative forces; no no_grad/TF32/compile/MoE merge.
        energy, forces = self.predict((self.numbers, positions), **self.kwargs)
        return float(energy), np.asarray(forces, dtype=float)


def anysolv_worker(data, config, directory, pipe):
    watch_parent_lifetime()
    try:
        local = dict(config, anysolvDevice=config['solvation']['device'])
        local['anysolvRuntimeDevice'] = isolate_device(local, 'anysolvDevice')
        engine = AnySolvEngine(data, local, directory)
        pipe.send(('ready', None))
        while True:
            request = pipe.recv()
            if request is None:
                break
            if isinstance(request, dict) and request.get('command') == 'configure':
                # The AnySolv prediction module retains its loaded model in this
                # process; molecule/solvent inputs are reset between jobs.
                local['solvation'] = request['config']['solvation']
                engine = AnySolvEngine(request['data'], local, request['directory'])
                pipe.send(('ready', None))
                continue
            pipe.send(('result', engine(*request)))
    except EOFError:
        pass
    except Exception:
        # Never expose package exceptions containing checkpoint paths or hub credentials.
        try:
            pipe.send(('error', 'AnySolvの読み込み・計算に失敗しました。選択モデル、溶媒、GPUメモリ、PyTorch環境を確認してください。補正なしの計算には切り替えません。'))
        except (EOFError, BrokenPipeError):
            pass
    finally:
        pipe.close()


class SolvatedUMAEngine:
    """UMA in the job process, AnySolv in a persistent spawn child on another GPU.

    Send the delta request before UMA evaluation, allowing concurrent inference.
    Only CPU coordinates/energies/forces cross the process boundary.
    """
    def __init__(self, data, config, directory):
        self.process = self.pipe = None
        self.components = {}
        self.timeout = config['jobTimeout']  # Includes first checkpoint load.
        context = mp.get_context('spawn')
        self.pipe, child = context.Pipe()
        self.process = context.Process(target=anysolv_worker, args=(data, config, directory, child))
        try:
            self.process.start()
            child.close()
            self._receive('ready')
            self.uma = UMAEngine(data, config, directory)
        except BaseException:
            child.close()
            self.close()
            raise

    def _receive(self, expected):
        started = time.monotonic()
        while not self.pipe.poll(.1):
            if not self.process.is_alive():
                raise ValueError('AnySolvプロセスが終了しました。GPUメモリと導入状態を確認してください。')
            if time.monotonic()-started > self.timeout:
                raise ValueError('AnySolvの計算時間上限に達しました。')
        kind, value = self.pipe.recv()
        if kind != expected:
            raise ValueError(value if kind == 'error' else 'AnySolvの応答が不正です。')
        return value

    def reset(self, data, config, directory):
        self.pipe.send({'command':'configure', 'data':data, 'config':config, 'directory':directory})
        self._receive('ready')
        self.uma.reset(data, config, directory)
        self.components.clear()
        for name in ('component_forces', 'component_maxima'):
            getattr(self, name, {}).clear()

    @staticmethod
    def key(positions):
        return hashlib.sha256(np.asarray(positions, dtype=np.float64).tobytes()).digest()

    def __call__(self, index, positions):
        self.pipe.send((index, np.asarray(positions, dtype=float)))
        gas, force = self.uma(index, positions)
        delta, correction = self._receive('result')
        correction = np.asarray(correction, dtype=float)
        if not math.isfinite(delta) or correction.shape != np.shape(positions) or not np.isfinite(correction).all():
            raise ValueError('AnySolvが不正なエネルギー・力を返しました。計算を停止しました。')
        key = self.key(positions)
        self.components[key] = dict(uma=gas, solvation=delta)
        if not hasattr(self, 'component_forces'):
            self.component_forces, self.component_maxima = {}, {}
        self.component_maxima[key] = {'uma':force_max(force), 'solvation':force_max(correction)}
        self.component_forces[key] = {'uma':np.asarray(force).tolist(), 'solvation':correction.tolist()}
        # Keep vectors for one complete band, not every finite-difference probe.
        if len(self.component_forces) > 200:
            del self.component_forces[next(iter(self.component_forces))]
        return gas+delta, force+correction

    def annotate(self, result):
        if 'positions' in result:
            key = self.key(result['positions'])
            result['energyComponents'] = self.components[key].copy()
            if key in getattr(self, 'component_maxima', {}):
                result.setdefault('componentFmax', {}).update(self.component_maxima[key])
        elif 'images' in result:
            keys = [self.key(p) for p in result['images']]
            previous = result.get('energyComponents', {})
            rows = []
            for i, key in enumerate(keys):
                if key in self.components:
                    rows.append(self.components[key])
                else:
                    # Resumed scans retain evaluated prefix nodes without recalculation.
                    try:
                        row = {name:previous[name][i] for name in ('uma', 'solvation')}
                        if not all(math.isfinite(v) for v in row.values()) or abs(sum(row.values())-result['energies'][i])>1e-7:
                            raise ValueError('component mismatch')
                    except (KeyError, IndexError, TypeError, ValueError) as error:
                        raise ValueError('保存した構造のUMA・溶媒補正成分が一致しません。') from error
                    rows.append(row)
            result['energyComponents'] = {key:[r[key] for r in rows] for key in ('uma', 'solvation')}
            maxima = getattr(self, 'component_maxima', {})
            if keys and all(key in maxima for key in keys):
                result.setdefault('componentFmax', {}).update({name:max(maxima[key][name] for key in keys) for name in ('uma', 'solvation')})
            vectors = getattr(self, 'component_forces', {})
            vector_keys = [keys[i] for i in result.get('forceComponentImageIndices', range(len(keys)))]
            if vector_keys and all(key in vectors for key in vector_keys):
                result.setdefault('forceComponents', {}).update({name:[vectors[key][name] for key in vector_keys] for name in ('uma', 'solvation')})
        if 'trajectory' in result:
            self.annotate(result['trajectory'])

    def close(self):
        if self.pipe:
            try:
                self.pipe.send(None)
            except (EOFError, BrokenPipeError, OSError):
                pass
            self.pipe.close()
        if self.process and self.process.pid:
            self.process.join(timeout=1)
            stop_process(self.process)


def uma_settings(config):
    # A fixed numerical surface across MIN, AFIR, CI-NEB, TS and finite differences.
    # Do not use the changing upstream default/turbo presets or direct-force models.
    return dict(tf32=False, compile=False, merge_mole=False,
                base_precision_dtype=config['umaPrecision'], execution_mode='general',
                torch_num_threads=config['threads'])


def uma_packages(config):
    version = package_version('fairchem-core')
    parts = re.match(r'^(\d+)\.(\d+)\.(\d+)', version or '')
    if not parts or not ( (2,23,0) <= tuple(map(int, parts.groups())) < (3,0,0) ):
        raise ValueError('UMAにはfairchem-core >=2.23,<3が必要です。専用環境で python -m pip install "fairchem-core>=2.23,<3" を実行してください。')
    try:
        import torch
        from fairchem.core import FAIRChemCalculator, pretrained_mlip
        from fairchem.core.units.mlip_unit.api.inference import InferenceSettings
    except Exception as error:
        raise ValueError('fairchem-core/PyTorchを読み込めません。UMA用Python環境の導入状態を確認してください。') from error
    if config['umaDevice'].startswith('cuda') and not torch.cuda.is_available():
        raise ValueError('CUDAを利用できません。対応するPyTorch・GPUドライバーを確認するか、--uma-device cpu で起動してください。')
    if config['umaModel'] not in pretrained_mlip.available_models:
        raise ValueError('指定したUMAモデルがfairchem-coreに登録されていません。パッケージを更新するか別の --uma-model を選んでください。')
    return torch, FAIRChemCalculator, pretrained_mlip, InferenceSettings


def uma_failure(error):
    # Upstream HTTP errors can contain credentials/URLs. Never send those to the UI/export.
    name = type(error).__name__
    if 'outofmemory' in name.lower() or 'out of memory' in str(error).lower():
        return 'UMAのメモリが不足しました。原子数を減らすか、--uma-device cpu を選んで再起動してください。'
    return ('UMAのモデル読み込み・計算に失敗しました。Hugging Faceのfacebook/UMA利用承認と、'
            '同じ端末環境での hf auth login、モデルのキャッシュ・通信・PyTorchの導入を確認してください。'
            '認証情報はページへ入力しないでください。')


class UMAEngine:
    """Local conservative UMA/OMol inference; ASE returns eV and eV/angstrom already."""
    def __init__(self, data, config, directory):
        from ase import Atoms
        torch, Calculator, pretrained, Settings = uma_packages(config)
        torch.set_num_threads(config['threads'])
        os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
        try:
            self.predictor = pretrained.get_predict_unit(config['umaModel'],
                device=config.get('umaRuntimeDevice', config['umaDevice']), inference_settings=Settings(**uma_settings(config)))
        except Exception as error:
            raise ValueError(uma_failure(error)) from error
        self.Atoms, self.Calculator, self.data = Atoms, Calculator, data
        self.atoms = {}

    def reset(self, data, config, directory):
        """Keep the predictor, discard all geometry/charge-dependent ASE state."""
        self.data, self.atoms = data, {}

    def __call__(self, index, positions):
        try:
            if index not in self.atoms:
                cell = self.data['cell']
                atoms = self.Atoms(self.data['symbols'], positions=positions,
                    cell=None if cell is None else cell['vectors'], pbc=False)
                # UMA spin is 2S+1, NOT g-xTB's number of unpaired electrons (2S).
                atoms.info.update(charge=self.data['charge'], spin=self.data['multiplicity'])
                atoms.calc = self.Calculator(self.predictor, task_name='omol')
                self.atoms[index] = atoms
            atoms = self.atoms[index]
            atoms.set_positions(positions)
            # Autograd must remain enabled for the conservative forces.
            energy, force = float(atoms.get_potential_energy()), np.asarray(atoms.get_forces(), dtype=float)
        except Exception as error:
            raise ValueError(uma_failure(error)) from error
        if not math.isfinite(energy) or force.shape != (len(self.data['symbols']), 3) or not np.isfinite(force).all():
            raise ValueError('UMAが不正なエネルギー・力を返しました。計算を停止しました。')
        return energy, force.copy()


def engine_method(config, data=None):
    if data is not None:
        config = job_config(data, config)
    if config['engine'] == 'uma':
        s = config.get('solvation')
        return f"UMA / {config['umaModel']} / omol" + (f" + AnySolv / {s['model']} / {s['solvent']}" if s else '')
    return config['method'] if config['engine'] == 'tblite' else 'g-xTB'


def package_version(name):
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def watch_parent_lifetime():
    """Do not leave resident models/native children alive after a server crash."""
    parent = mp.parent_process()
    if parent is None:
        return
    def watch():
        while parent.is_alive():
            time.sleep(1)
        try:
            for child in psutil.Process(os.getpid()).children(recursive=True):
                try:
                    child.kill()
                except psutil.NoSuchProcess:
                    pass
        except psutil.NoSuchProcess:
            pass
        os._exit(1)
    threading.Thread(target=watch, daemon=True).start()


def residency_key(data, config):
    """Only immutable model/runtime settings; molecule state is reset each job."""
    c = job_config(data, config)
    s = c.get('solvation')
    identity = {'engine':c['engine'], 'model':c.get('umaModel'), 'device':c.get('umaDevice'),
                'precision':c.get('umaPrecision'), 'threads':c['threads'],
                'cudaMasks':c.get('cudaMasks', {}),
                'solvation':None if not s else {'model':s['model'], 'device':s['device'],
                    'hash':c.get('anysolvHashes', {}).get(s['model'])}}
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


def calculation_identity(data, config):
    """Reproducibility identity without executable paths, tokens or hub credentials."""
    c = job_config(data, config)
    value = {'provenance':provenance(c), 'method':engine_method(c),
             'tbliteVersion':package_version('tblite') if c['engine']=='tblite' else None}
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


class ExactEvaluationCache:
    """Job-local, bounded, exact-coordinate reuse; no tolerance/rounded geometries."""
    def __init__(self, calculate, capacity=128):
        self.calculate, self.capacity = calculate, capacity
        self.values = OrderedDict()
        self.calls = self.hits = 0
        self.seconds = 0.

    def __call__(self, index, positions):
        array = np.asarray(positions, dtype=np.float64)
        key = (index, array.shape, array.tobytes())
        if key in self.values:
            self.hits += 1
            energy, force = self.values.pop(key)
            self.values[key] = (energy, force)
            return energy, force.copy()
        started = time.perf_counter()
        energy, force = self.calculate(index, positions)
        self.seconds += time.perf_counter()-started
        self.calls += 1
        force = np.asarray(force, dtype=float)
        if math.isfinite(energy) and force.shape == array.shape and np.isfinite(force).all():
            self.values[key] = (float(energy), force.copy())
            while len(self.values) > self.capacity:
                self.values.popitem(last=False)
        return energy, force.copy()


def execute_with_calculator(data, config, directory, messages, calculator):
    component_history = {}
    last_notification, last_phase = 0., None
    def progress(p):
        nonlocal last_notification, last_phase
        now = time.monotonic()
        phase = p.get('phase')
        if (not any(k in p for k in ('checkpoint', 'bandCheckpoint', 'structureCheckpoint', 'preview'))
                and now-last_notification < .1 and phase == last_phase):
            return
        last_notification, last_phase = now, phase
        if isinstance(calculator, SolvatedUMAEngine):
            for key in ('checkpoint', 'bandCheckpoint', 'structureCheckpoint', 'preview'):
                if key in p:
                    if key == 'preview' and p.get('structureCheckpoint', {}).get('images') == p[key].get('images') and 'energyComponents' in p['structureCheckpoint']:
                        p[key]['energyComponents'] = copy.deepcopy(p['structureCheckpoint']['energyComponents'])
                    calculator.annotate(p[key])
            source = p.get('checkpoint') or p.get('bandCheckpoint') or p.get('structureCheckpoint') or p.get('preview') or {}
            if 'componentFmax' in source:
                p.setdefault('componentFmax', {}).update(source['componentFmax'])
            if 'energyComponents' in source:
                values = source['energyComponents']
                p['energyComponents'] = {key:value if isinstance(value,list) else [value] for key,value in values.items()}
            if p.get('fmax') is not None and ('energies' in p or 'energyEV' in p):
                key = (p.get('step'), tuple(p.get('energies', [p.get('energyEV')])))
                component_history[key] = {name:copy.deepcopy(p[name]) for name in ('energyComponents','componentFmax') if name in p}
        messages.put(('progress', p))
    cached = ExactEvaluationCache(calculator)
    result = calculate_job(data, cached, directory, progress)
    result['performance'] = {'engineCalls':cached.calls, 'exactCacheHits':cached.hits,
                             'engineSeconds':cached.seconds}
    if isinstance(calculator, SolvatedUMAEngine):
        calculator.annotate(result)
        for row in result.get('history', []):
            key = (row.get('step'), tuple(row.get('energies', [row.get('energyEV')])))
            additions = component_history.get(key, {})
            row.setdefault('componentFmax', {}).update(additions.get('componentFmax', {}))
            if 'energyComponents' in additions:
                row['energyComponents'] = additions['energyComponents']
    result['engine'] = config['engine']
    result['method'] = engine_method(config)
    result['symbols'], result['cell'] = data['symbols'], data['cell']
    result['charge'], result['multiplicity'] = data['charge'], data['multiplicity']
    if 'atomIds' in data:
        result['atomIds'] = data['atomIds']
    result['conditionId'] = hashlib.sha256(json.dumps({'data':data, 'identity':calculation_identity(data, config)}, sort_keys=True).encode()).hexdigest()
    result['provenance'] = provenance(config)
    messages.put(('result', result))


def worker(data, config, directory, messages):
    watch_parent_lifetime()
    calculator = None
    try:
        config = job_config(data, config)
        for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
            os.environ[key] = str(config['threads'])
        if config['engine'] == 'uma':
            messages.put(('progress', {'phase':'loading_model'}))
            config['umaRuntimeDevice'] = isolate_device(config, 'umaDevice')
        cls = SolvatedUMAEngine if config.get('solvation') else {'tblite':TBLiteEngine, 'gxtb':GXTBEngine, 'uma':UMAEngine}[config['engine']]
        calculator = cls(data, config, directory)
        if config['engine'] == 'uma':
            messages.put(('progress', {'phase':'calculating'}))
        execute_with_calculator(data, config, directory, messages, calculator)
    except Exception as error:
        messages.put(('error', str(error)[:2500]))
    finally:
        if isinstance(calculator, SolvatedUMAEngine):
            calculator.close()


class JobMessages:
    def __init__(self, queue_, identifier):
        self.queue, self.identifier = queue_, identifier

    def put(self, item):
        self.queue.put((self.identifier, *item))


def resident_worker(config, requests, messages):
    """One GPU visibility/model key per process; reuse weights across job boundaries."""
    calculator = None
    watch_parent_lifetime()
    try:
        for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
            os.environ[key] = str(config['threads'])
        while True:
            request = requests.get()
            if request is None:
                break
            identifier, data, directory = request
            output = JobMessages(messages, identifier)
            local = job_config(data, config)
            try:
                if calculator is None:
                    output.put(('progress', {'phase':'loading_model', 'modelReused':False}))
                    local['umaRuntimeDevice'] = isolate_device(local, 'umaDevice')
                    cls = SolvatedUMAEngine if local.get('solvation') else UMAEngine
                    calculator = cls(data, local, directory)
                else:
                    calculator.reset(data, local, directory)
                    output.put(('progress', {'phase':'calculating', 'modelReused':True}))
                output.put(('progress', {'phase':'calculating'}))
                execute_with_calculator(data, local, directory, output, calculator)
            except Exception as error:
                output.put(('error', str(error)[:2500]))
                # A failed CUDA/autograd/child state cannot serve another job.
                break
    finally:
        if isinstance(calculator, SolvatedUMAEngine):
            calculator.close()


def provenance(config, data=None):
    if data is not None:
        config = job_config(data, config)
    s = config.get('solvation')
    return {'bridgeVersion':VERSION, 'engine':config['engine'], 'binarySHA256':config.get('binarySHA256'),
        'threads':config['threads'], 'solvent':s['solvent'] if s else 'gas', 'aseVersion':importlib.metadata.version('ase'),
        'numpyVersion':np.__version__, 'sellaVersion':sella_version(),
        **({'uma':{'model':config['umaModel'], 'task':'omol', 'device':config['umaDevice'],
                   'inference':uma_settings(config), 'fairchemVersion':package_version('fairchem-core'),
                   'torchVersion':package_version('torch')}} if config['engine']=='uma' else {}),
        **({'anysolv':{**s, 'version':package_version('anysolv'), 'precision':config['umaPrecision'],
                       'inference':'default', 'checkpointSHA256':config['anysolvHashes'][s['model']]}} if s else {}),
        'afirReference':{'R0_A':3.8164,'epsilon_kJ_mol':1.0061,'power':6,'radii':'ASE covalent radii H-Cm'}}


def stop_process(process):
    if not process or not process.is_alive():
        return
    try:
        parent = psutil.Process(process.pid)
        parent.suspend()  # prevent new native children while collecting the tree
        children = parent.children(recursive=True)
        for child in children:
            try:
                child.kill()
            except psutil.NoSuchProcess:
                pass
        parent.kill()
        psutil.wait_procs(children, timeout=2)
    except psutil.NoSuchProcess:
        # Some containers expose a different PID namespace through psutil.
        # multiprocessing still owns a valid handle to the worker itself.
        if process.is_alive():
            process.kill()
    process.join(timeout=3)


def checkpoint_components(frames):
    if not all('energyComponents' in p for p in frames):
        return {}
    return {'energyComponents':{key:[p['energyComponents'][key] for p in frames] for key in ('uma', 'solvation')}}


def default_history_directory():
    if os.name == 'nt':
        base = Path(os.environ.get('LOCALAPPDATA', Path.home()/'AppData'/'Local'))
    elif __import__('sys').platform == 'darwin':
        base = Path.home()/'Library'/'Application Support'
    else:
        base = Path(os.environ.get('XDG_DATA_HOME', Path.home()/'.local'/'share'))
    return base/'molecule-studio'/'jobs'


def lock_history_directory(directory):
    """OS-owned lock releases automatically on exit, including an abrupt crash."""
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    stream = open(root/'.bridge.lock', 'a+b')
    try:
        if os.name == 'nt':
            import msvcrt
            if stream.seek(0, os.SEEK_END) == 0:
                stream.write(b'0'); stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        stream.close()
        raise
    return stream


class Jobs:
    TERMINAL = ('completed', 'cancelled', 'error', 'interrupted')
    SAVED_KEYS = ('id', 'status', 'progress', 'result', 'error', 'data', 'createdAt', 'updatedAt',
                  'parentId', 'resumeKind', 'archived', 'configFingerprint', 'checkpoints',
                  'bandCheckpoint', 'structureCheckpoint', 'diagnosticsHistory', 'calculationProvenance', 'method', 'engine')

    def __init__(self, config):
        self.config, self.lock, self.job = config, threading.RLock(), None
        self.jobs, self.pending = {}, []
        self.resident = None
        self.closing = False
        configured = config.get('historyDir')
        self.history_dir = Path(configured).expanduser().resolve() if configured else None
        self.storage_error = None
        if self.history_dir:
            self.history_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            self._load_history()

    def _load_history(self):
        for path in sorted(self.history_dir.glob('*.json')):
            if not re.fullmatch(r'[a-f0-9]{32}\.json', path.name):
                continue
            try:
                saved = json.loads(path.read_text(encoding='utf-8'))
                if saved.get('schema') != 'molecule-job-history/1' or saved.get('id') != path.stem or not isinstance(saved.get('data'), dict):
                    raise ValueError('history format')
                digest = saved.pop('recordSHA256')
                if not secrets.compare_digest(digest, hashlib.sha256(json.dumps(saved, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()):
                    raise ValueError('history checksum')
                job = {k:saved[k] for k in self.SAVED_KEYS if k in saved}
                job.setdefault('progress', {})
                job.setdefault('checkpoints', [])
                if job['status'] not in self.TERMINAL:
                    job['status'], job['error'] = 'interrupted', 'サービス終了時に未完了でした。保存済みの構造・条件から再開できます。'
                    self._recover_partial(job)
                self.jobs[job['id']] = job
                self._persist(job, force=True)
            except (OSError, ValueError, KeyError, TypeError):
                # Never overwrite an unreadable original; surface the skipped file count.
                self.storage_error = '読み込めない履歴があります。元のファイルは保持しています。'

    def _persist(self, job, force=False):
        if not self.history_dir:
            return
        now = time.monotonic()
        if not force and now-job.get('_lastPersist', 0) < 1:
            return
        keys = self.SAVED_KEYS
        if job['status'] in self.TERMINAL and job.get('result'):
            # Terminal results already contain the complete retained trajectory.
            keys = tuple(k for k in keys if k not in ('checkpoints', 'bandCheckpoint', 'structureCheckpoint', 'diagnosticsHistory'))
        saved = {'schema':'molecule-job-history/1', **{k:job[k] for k in keys if k in job}}
        # Internal scan restart data may contain a large result; its original record
        # is already saved separately and is not an executable object.
        saved['updatedAt'] = time.time()*1000
        try:
            encoded = json.dumps(saved, sort_keys=True, ensure_ascii=False, allow_nan=False)
            digest = hashlib.sha256(encoded.encode()).hexdigest()
            target = self.history_dir/(job['id']+'.json')
            temporary = target.with_suffix('.tmp')
            with open(temporary, 'w', encoding='utf-8') as stream:
                try:
                    os.chmod(temporary, 0o600)
                except OSError:
                    pass
                # Reuse the canonical JSON used for the checksum (v1-reader compatible).
                stream.write(encoded[:-1]+', "recordSHA256": "'+digest+'"}')
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
            job['updatedAt'], job['_lastPersist'] = saved['updatedAt'], now
        except (OSError, ValueError) as error:
            self.storage_error = '計算履歴を保存できません。空き容量・保存先の権限を確認してください。'
            job['storageError'] = self.storage_error
            if force and job['status'] == 'queued':
                raise RuntimeError(self.storage_error) from error

    def _find(self, identifier):
        job = self.jobs.get(identifier)
        # Compatibility with programmatic preview fixtures predating the queue.
        if job is None and self.job and self.job['id'] == identifier:
            job = self.job
        if job is None:
            raise KeyError('計算が見つかりません。')
        return job

    def start(self, data, parent_id=None, resume_kind=None):
        job_config(data, self.config)
        with self.lock:
            if self.closing:
                raise RuntimeError('サービスの終了処理中です。')
            if len(self.pending) >= 100:
                raise RuntimeError('待機ジョブは最大100件です。')
            now = time.time()*1000
            job = {'id':secrets.token_hex(16), 'status':'queued', 'progress':{}, 'data':copy.deepcopy(data),
                   'checkpoints':[], 'createdAt':now, 'updatedAt':now, 'archived':False,
                   'configFingerprint':calculation_identity(data, self.config),
                   'calculationProvenance':provenance(self.config, data),
                   'method':engine_method(self.config, data), 'engine':self.config['engine']}
            if parent_id:
                job.update(parentId=parent_id, resumeKind=resume_kind)
            self._persist(job, force=True)
            self.jobs[job['id']] = job
            self.pending.append(job['id'])
            self._launch_next()
            return self.public(job)

    def _drop_resident(self):
        if self.resident:
            r, self.resident = self.resident, None
            stop_process(r['process'])
            r['process'].join(timeout=3)
            for q in (r['requests'], r['messages']):
                q.close()
                q.cancel_join_thread()

    def _launch_next(self):
        if self.closing or (self.job and (self.job.get('_active') or self.job.get('status') in ('running', 'stopping'))):
            return
        while self.pending:
            job = self.jobs[self.pending.pop(0)]
            if job['status'] != 'queued':
                continue
            try:
                self._launch_job(job)
                break
            except Exception:
                # A failed spawn/disk allocation must not strand an unlaunchable
                # queued job or leak a partially created model process.
                if self.resident and self.resident['process'] is job.get('process'):
                    self._drop_resident()
                process = job.get('process')
                if process and process.pid:
                    stop_process(process)
                    process.join(timeout=2)
                for key in ('queue', '_requests'):
                    resource = job.get(key)
                    if resource:
                        resource.close()
                        resource.cancel_join_thread()
                if job.get('directory'):
                    shutil.rmtree(job['directory'], ignore_errors=True)
                job.update(status='error', _active=False,
                           error='計算プロセスを起動できません。空き容量・メモリ・Python環境を確認してください。')
                self._persist(job, force=True)

    def _launch_job(self, job):
        context = mp.get_context('spawn')
        directory = job['directory'] = tempfile.mkdtemp(prefix='molecule-engine-')
        data = job['data']
        for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
            os.environ[key] = str(self.config['threads'])
        use_resident = self.config['engine'] == 'uma' and self.config.get('residentModels', True)
        if use_resident:
            key = residency_key(data, self.config)
            if self.resident and (self.resident['key'] != key or not self.resident['process'].is_alive()):
                self._drop_resident()
            if self.resident is None:
                requests, messages = context.Queue(), context.Queue()
                job['_requests'], job['queue'] = requests, messages
                process = context.Process(target=resident_worker, args=(self.config, requests, messages), daemon=False)
                job['process'] = process
                process.start()
                self.resident = {'key':key, 'requests':requests, 'messages':messages, 'process':process,
                                 'loadedAt':time.time()*1000, 'jobs':0, 'ready':False}
            r = self.resident
            process, messages = r['process'], r['messages']
            job['process'], job['queue'] = process, messages
            r['requests'].put((job['id'], data, directory))
            r['jobs'] += 1
        else:
            messages = job['queue'] = context.Queue()
            process = context.Process(target=worker, args=(data, self.config, directory, messages), daemon=False)
            job['process'] = process
            process.start()
        job.update(status='running', process=process, directory=directory, queue=messages,
                   started=time.monotonic(), resident=use_resident, _active=True)
        self.job = job
        self._persist(job, force=True)
        thread = job['thread'] = threading.Thread(target=self.monitor, args=(job,), daemon=True)
        thread.start()

    @staticmethod
    def public(job, compact=False):
        keys = ('id', 'status', 'progress', 'result', 'error', 'data', 'createdAt', 'updatedAt',
                'parentId', 'resumeKind', 'archived', 'storageError')
        result = copy.deepcopy({k:v for k,v in job.items() if k in keys and (k != 'data' or not compact)})
        if job.get('_active') and job['status'] in Jobs.TERMINAL:
            result['status'] = 'running'
        return result

    def listing(self):
        with self.lock:
            rows = []
            for job in sorted(self.jobs.values(), key=lambda j:j['createdAt'], reverse=True):
                row = {k:job[k] for k in ('id','status','createdAt','updatedAt','parentId','resumeKind','archived','error') if k in job}
                row.update(mode=job['data']['mode'], atoms=len(job['data']['symbols']),
                           steps=job.get('result', {}).get('steps', job.get('progress', {}).get('step', 0)),
                           hasResult=bool(job.get('result')), resumable=job['status'] in self.TERMINAL and not job.get('_active'))
                row['resumeKind'] = ('scan_remaining' if job['data']['mode']=='scan' and job.get('result') else
                                     'geometry' if job['data']['mode'] in ('optimize','afir','ts', *PATH_MODES) and job.get('result') else 'restart')
                if job.get('_active') and job['status'] in self.TERMINAL:
                    row['status'] = 'running'
                rows.append(row)
            return {'jobs':rows, 'storage':{'enabled':bool(self.history_dir),
                    'directory':str(self.history_dir) if self.history_dir else None, 'error':self.storage_error}}

    def runtime(self):
        with self.lock:
            r = self.resident
            return {'engine':self.config['engine'], 'modelLoaded':bool(r and r['process'].is_alive() and r['ready']),
                    'residentEnabled':self.config['engine']=='uma' and self.config.get('residentModels', True),
                    'runningId':self.job['id'] if self.job and (self.job.get('_active') or self.job['status'] in ('running','stopping')) else None,
                    'queuedCount':sum(self.jobs[i]['status']=='queued' for i in self.pending),
                    'residentKey':r['key'] if r else None, 'loadedAt':r['loadedAt'] if r else None,
                    'reusedJobs':max(0, r['jobs']-1) if r else 0,
                    'historyPath':str(self.history_dir) if self.history_dir else None,
                    'storageError':self.storage_error}

    def unload(self):
        with self.lock:
            if self.job and (self.job.get('_active') or self.job['status'] in ('running','stopping')):
                raise RuntimeError('モデルを解放する前に、実行中の計算を完了または中止してください。')
            self._drop_resident()
            return self.runtime()

    def monitor(self, job):
        try:
            while job['status'] == 'running':
                if time.monotonic()-job['started'] > self.config['jobTimeout']:
                    with self.lock:
                        job['status'], job['error'], job['terminalStatus'] = 'stopping', '計算時間の上限に達しました。', 'error'
                    break
                try:
                    item = job['queue'].get(timeout=.2)
                    if job.get('resident'):
                        identifier, kind, value = item
                        if identifier != job['id']:
                            continue
                    else:
                        kind, value = item
                except queue.Empty:
                    if not job['process'].is_alive():
                        with self.lock:
                            job['status'], job['error'], job['terminalStatus'] = 'stopping', '計算プロセスが終了しました。エンジンの導入状態を確認してください。', 'error'
                        break
                    continue
                with self.lock:
                    if job['status'] != 'running':
                        break
                    if kind == 'progress':
                        if 'step' in value and ('fmax' in value or 'energies' in value):
                            row = {k:copy.deepcopy(v) for k,v in value.items() if k not in
                                   ('checkpoint','bandCheckpoint','structureCheckpoint','preview')}
                            rows = job.setdefault('diagnosticsHistory', [])
                            if rows and rows[-1].get('step') == row['step'] and rows[-1].get('direction') == row.get('direction'):
                                rows[-1].update(row)
                            else:
                                rows.append(row)
                        checkpoint = value.pop('checkpoint', None)
                        if checkpoint is not None:
                            job['checkpoints'].append(checkpoint)
                        for key in ('bandCheckpoint','structureCheckpoint'):
                            saved = value.pop(key, None)
                            if saved is not None:
                                job[key] = saved
                        preview = value.pop('preview', None)
                        if preview is not None:
                            job['preview'] = preview
                            job['previewVersion'] = job.get('previewVersion', 0)+1
                        job['progress'].update(value)
                        if self.resident and value.get('phase') == 'calculating':
                            self.resident['ready'] = True
                        self._persist(job)
                    elif kind == 'result':
                        job['status'], job['result'] = 'completed', value
                    else:
                        job['status'], job['error'], job['terminalStatus'] = 'stopping', value, 'error'
        finally:
            with self.lock:
                keep_model = job.get('resident') and job['status'] == 'completed' and not self.closing
                if job.get('resident'):
                    if not keep_model:
                        self._drop_resident()
                else:
                    stop_process(job['process'])
                    job['process'].join(timeout=2)
                    job['queue'].close()
                    job['queue'].cancel_join_thread()
                shutil.rmtree(job['directory'], ignore_errors=True)
                if job['status'] == 'stopping':
                    job['status'] = job.get('terminalStatus', 'cancelled')
                    self._recover_partial(job)
                self._persist(job, force=True)
                job['_active'] = False
                self._launch_next()

    def _recover_partial(self, job):
        if job.get('structureCheckpoint') or job.get('bandCheckpoint'):
            job['result'] = self.partial_structure(job)
        elif job['data']['mode'] == 'afir' and job.get('checkpoints'):
            job['result'] = self.partial_afir(job)
        elif job['data']['mode'] in ('optimize','ts') and job.get('checkpoints'):
            job['result'] = self.partial_optimization(job)

    def _record_identity(self, job):
        if 'calculationProvenance' in job:
            return dict(provenance=job['calculationProvenance'], method=job['method'], engine=job['engine'])
        return dict(provenance=provenance(self.config, job['data']),
                    method=engine_method(self.config, job['data']), engine=self.config['engine'])

    def partial_structure(self, job):
        data = job['data']
        result = copy.deepcopy(job.get('structureCheckpoint') or job['bandCheckpoint'])
        if 'structureCheckpoint' in job and 'vibrations' in data:
            result['vibrations'] = {'status':'cancelled' if job['status']=='cancelled' else 'failed',
                                    'error':job.get('error', '振動解析を中止しました。構造の結果は保持しています。')}
        else:
            result.update(converged=False, reason='cancelled' if job['status']=='cancelled' else 'interrupted' if job['status']=='interrupted' else 'failed',
                          maxTangentialStep=None, error=job.get('error'))
            result.setdefault('history', [])
        result['conditionId'] = hashlib.sha256(json.dumps({'data':data, 'identity':job.get('configFingerprint') or calculation_identity(data, self.config)}, sort_keys=True).encode()).hexdigest()
        result.update(mode=data['mode'], symbols=data['symbols'], cell=data['cell'], charge=data['charge'], multiplicity=data['multiplicity'],
            **self._record_identity(job), units={'length':'angstrom','energy':'eV','force':'eV/angstrom'})
        result['fixedAtoms'] = data.get('fixedAtoms', [])
        if job.get('diagnosticsHistory'):
            result['iterationHistory' if data['mode']=='scan' else 'history'] = copy.deepcopy(job['diagnosticsHistory'])
        if 'atomIds' in data:
            result['atomIds'] = data['atomIds']
        return result

    def partial_optimization(self, job):
        data, frames = job['data'], job['checkpoints']
        last = frames[-1]
        return dict(mode=data['mode'], optimizer=data.get('optimizer','fire'), **self._record_identity(job),
            fixedAtoms=data.get('fixedAtoms', []),
            **{k:copy.deepcopy(last[k]) for k in ('internalConstraints','constraintProjection') if k in last},
            **({'atomIds':data['atomIds']} if 'atomIds' in data else {}),
            symbols=data['symbols'], cell=data['cell'], charge=data['charge'], multiplicity=data['multiplicity'],
            images=[last['positions']], energies=[last['energy']], forces=[last['force']],
            imageFmax=[last['fmax']], effectiveFmax=last['fmax'], steps=len(frames)-1, evaluations=len(frames),
            converged=False, reason='cancelled' if job['status']=='cancelled' else 'failed', error=job.get('error'),
            climbingImage=None, maxTangentialStep=None,
            trajectory={'images':[p['positions'] for p in frames], 'energies':[p['energy'] for p in frames], **checkpoint_components(frames)},
            **checkpoint_components([last]),
            history=copy.deepcopy(job.get('diagnosticsHistory')) or [{'step':i, 'fmax':p['fmax'], 'energies':[p['energy']], 'climbingImage':None, 'evaluations':i+1} for i,p in enumerate(frames)],
            **({'componentFmax':copy.deepcopy(last['componentFmax'])} if 'componentFmax' in last else {}),
            conditionId=hashlib.sha256(json.dumps({'data':data, 'identity':job.get('configFingerprint') or calculation_identity(data, self.config)}, sort_keys=True).encode()).hexdigest(),
            units={'length':'angstrom', 'energy':'eV', 'force':'eV/angstrom'})

    def partial_afir(self, job):
        data, frames = job['data'], job['checkpoints']
        energies, biases = [p['energy'] for p in frames], [p['bias'] for p in frames]
        return dict(schema='molecule-afir-trajectory/1', mode='afir', **self._record_identity(job),
            fixedAtoms=data.get('fixedAtoms', []),
            **{k:copy.deepcopy(frames[-1][k]) for k in ('internalConstraints','constraintProjection') if k in frames[-1]},
            atomIds=data['atomIds'],
            symbols=data['symbols'], cell=data['cell'], charge=data['charge'], multiplicity=data['multiplicity'],
            images=[p['positions'] for p in frames], energies=energies, biasEnergies=biases,
            **checkpoint_components(frames),
            biasedEnergies=[e+b for e,b in zip(energies,biases)], forces=[p['force'] for p in frames],
            imageFmax=[p['fmax'] for p in frames], physicalFmax=[p['physicalFmax'] for p in frames],
            effectiveFmax=frames[-1]['fmax'], steps=len(frames)-1, evaluations=len(frames),
            converged=False, reason='cancelled' if job['status']=='cancelled' else 'failed',
            error=job.get('error'), validation='biased-trajectory-not-ts',
            history=copy.deepcopy(job.get('diagnosticsHistory', [])),
            conditionId=hashlib.sha256(json.dumps({'data':data, 'identity':job.get('configFingerprint') or calculation_identity(data, self.config)}, sort_keys=True).encode()).hexdigest(),
            units={'length':'angstrom','energy':'eV','force':'eV/angstrom'})

    def get(self, identifier, preview=False, after=0, since=None, compact=False):
        with self.lock:
            job = self._find(identifier)
            result = self.public(job, compact)
            if preview:
                if job['data']['mode'] == 'afir':
                    frames = job['checkpoints']
                    end = min(len(frames), after + 1000)
                    if 0 <= after < end:
                        part = frames[after:end]
                        result['preview'] = {'mode':'afir', 'from':after, 'next':end,
                            'energies':[p['energy'] for p in part], 'biasEnergies':[p['bias'] for p in part],
                            'positions':part[-1]['positions']}
                elif job.get('preview') is not None and (since is None or since != job.get('previewVersion', 0)):
                    result['preview'] = copy.deepcopy(job['preview'])
                    result['previewVersion'] = job.get('previewVersion', 0)
            return result

    def cancel(self, identifier):
        with self.lock:
            job = self._find(identifier)
            if job['status'] == 'running':
                job['status'], job['terminalStatus'] = 'stopping', 'cancelled'
            elif job['status'] == 'queued':
                job['status'] = 'cancelled'
                self.pending.remove(identifier)
                self._persist(job, force=True)
            return self.public(job)

    def resume(self, identifier):
        with self.lock:
            job = self._find(identifier)
            if job.get('_active') or job['status'] not in self.TERMINAL:
                raise RuntimeError('実行中・待機中の計算は再開できません。')
            data = copy.deepcopy(job['data'])
            data.pop('_scanResume', None)
            if job.get('configFingerprint') != calculation_identity(data, self.config):
                raise RuntimeError('保存時とエンジン・モデル・パッケージ・計算設定が異なります。同じ環境で再開するか、結果を新しい入力として実行してください。')
            # Revalidate stored public settings; no arbitrary paths or code can be restored.
            data = validate(data, self.config['engine'])
            result, kind = job.get('result'), 'restart'
            if result and data['mode'] in ('optimize','afir','ts', *PATH_MODES):
                data['images'] = copy.deepcopy(result['images'] if data['mode'] in PATH_MODES else [result['images'][-1]])
                if data['mode'] in PATH_MODES and result.get('nodeIds'):
                    data['nodeIds'] = copy.deepcopy(result['nodeIds'])
                data = validate(data, self.config['engine'])
                kind = 'geometry'
            elif result and data['mode']=='scan' and result.get('scan', {}).get('nodes'):
                data['_scanResume'] = copy.deepcopy(result)
                kind = 'scan_remaining'
            return self.start(data, identifier, kind)

    def archive(self, identifier, archived=True):
        with self.lock:
            job = self._find(identifier)
            if job.get('_active') or job['status'] not in self.TERMINAL:
                raise RuntimeError('実行中・待機中の計算はアーカイブできません。')
            job['archived'] = archived
            self._persist(job, force=True)
            return self.public(job)

    def delete(self, identifier):
        with self.lock:
            job = self._find(identifier)
            if job.get('_active') or job['status'] not in self.TERMINAL:
                raise RuntimeError('実行中・待機中の計算は削除できません。')
            if self.history_dir:
                (self.history_dir/(identifier+'.json')).unlink(missing_ok=True)
            self.jobs.pop(identifier, None)
            if self.job is job:
                self.job = None
            return {'deleted':identifier}

    def close(self):
        with self.lock:
            self.closing = True
            for identifier in self.pending:
                job = self.jobs[identifier]
                job['status'] = 'interrupted'
                self._persist(job, force=True)
            self.pending.clear()
            current = self.job
            if current and current['status'] == 'running':
                current['status'], current['terminalStatus'] = 'stopping', 'interrupted'
        if current and current.get('thread'):
            current['thread'].join(timeout=8)
        with self.lock:
            self._drop_resident()



class Handler(BaseHTTPRequestHandler):
    server_version = 'MoleculeBridge/1'

    def log_message(self, *args):
        pass  # Never log tokens, coordinates, or full request paths.

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def response(self, status, payload, mime='application/json; charset=utf-8'):
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode() if isinstance(payload, dict) else payload
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        origin = self.headers.get('Origin')
        if origin in self.server.origins:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def allowed(self, auth=True):
        if self.headers.get('Host') not in self.server.hosts:
            self.response(403, {'error': 'Host rejected'})
            return False
        origin = self.headers.get('Origin')
        if origin is not None and origin not in self.server.origins:
            self.response(403, {'error': 'Origin rejected'})
            return False
        if auth and not secrets.compare_digest(self.headers.get('Authorization', ''), 'Bearer '+self.server.token):
            self.response(401, {'error': '接続トークンが一致しません。ローカルサービス起動時の値を入力してください。'})
            return False
        return True

    def do_OPTIONS(self):
        if not self.allowed(False):
            return
        if not self.path.startswith('/api/') or self.headers.get('Access-Control-Request-Method') not in ('GET', 'POST'):
            self.response(403, {'error': 'Preflight rejected'})
            return
        requested = {v.strip().lower() for v in self.headers.get('Access-Control-Request-Headers', '').split(',') if v.strip()}
        if requested - {'authorization', 'content-type'}:
            self.response(403, {'error': 'Headers rejected'})
            return
        self.send_response(204)
        origin = self.headers.get('Origin')
        if origin in self.server.origins:
            self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        if self.headers.get('Access-Control-Request-Private-Network') == 'true':
            self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api/'):
            if not self.allowed():
                return
            if self.path == '/api/info':
                config = self.server.config
                self.response(200, {'version': VERSION, 'engine': config['engine'],
                    'method': engine_method(config),
                    'periodic': config['engine'] == 'tblite', 'maxAtoms': 500, 'maxImages': 100,
                    **({'uma':{'model':config['umaModel'], 'task':'omol', 'device':config['umaDevice'],
                               'precision':config['umaPrecision'], 'tf32':False, 'compile':False, 'mergeMole':False},
                        'devices':config.get('devices', []),
                        'anysolv':{'enabled':bool(config.get('anysolv')), 'models':list(config.get('anysolvPaths', {})),
                                   'solvents':config.get('anysolvSolvents', []), 'model':config.get('anysolvModel'),
                                   'device':config.get('anysolvDevice'), 'precision':config['umaPrecision']},
                        'maxMultiplicity':100, 'maxAtomicNumber':83} if config['engine']=='uma' else {}),
                    'sellaVersion':sella_version(), 'vibrations':1, 'maxVibrationAtoms':200, 'pathCheckpoint':1, 'fixedAtoms':True,
                    'irc':bool(sella_version()), 'thermochemistry':True, 'internalConstraints':True, 'scan':True,
                    'adaptiveNEB':True, 'pathSplit':True, 'history':True, 'queue':True, 'residentModels':True,
                    'lup':True, 'pathOptimizers':{'cineb':['fire'], 'lup':['fire','lbfgs']},
                    'persistentHistory':bool(self.server.jobs.history_dir), 'jobQueue':True, 'modelResidency':True,
                    'modes': MODES, 'compactPolling':1, 'livePreview': 1, 'optimizationTrajectory': 1, 'maxSteps': 10000, 'maxAFIRSteps': 10000, 'jobTimeout': config['jobTimeout'],
                    'engineVersion': package_version('fairchem-core' if config['engine']=='uma' else 'tblite') if config['engine']!='gxtb' else 'locally configured binary'})
            elif self.path == '/api/jobs':
                self.response(200, self.server.jobs.listing())
            elif self.path == '/api/runtime':
                self.response(200, self.server.jobs.runtime())
            elif re.fullmatch(r'/api/jobs/[a-f0-9]{32}(?:\?(?:preview=1&after=[0-9]{1,5}(?:&since=[0-9]{1,9})?(?:&compact=1)?|compact=1))?', self.path):
                try:
                    parts = self.path.rsplit('/', 1)[1].split('?', 1)
                    options = dict(parse_qsl(parts[1])) if len(parts) == 2 else {}
                    self.response(200, self.server.jobs.get(parts[0], options.get('preview') == '1',
                        int(options.get('after', 0)), int(options['since']) if 'since' in options else None,
                        options.get('compact') == '1'))
                except KeyError as error:
                    self.response(404, {'error': str(error)})
            else:
                self.response(404, {'error': 'Not found'})
        else:
            if not self.allowed(False):
                return
            self.static()

    def static(self):
        root = self.server.site_dir
        if not root:
            self.response(404, {'error': 'UIをローカル配信するには --site-dir を指定してください。'})
            return
        path = unquote(urlsplit(self.path).path)
        target = (root / path.lstrip('/')).resolve()
        if target.is_dir():
            target = (target/'index.html').resolve()
        extensions = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.data': 'application/octet-stream',
            '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
            '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.py': 'text/plain; charset=utf-8', '.gz': 'application/gzip'}
        if not target.is_relative_to(root) or any(p.startswith('.') for p in target.relative_to(root).parts) or not target.is_file() or (target.suffix not in extensions and not re.search(r'\.gz\.part[0-9]+$', target.name)):
            self.response(404, {'error': 'Not found'})
            return
        content = target.read_bytes()
        if target == root/'index.html' and content.startswith(b'---'):
            content = b'<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body>'+content.split(b'---', 2)[2]+b'</body></html>'
        self.response(200, content, extensions.get(target.suffix, 'application/octet-stream'))

    def do_POST(self):
        if not self.allowed():
            return
        if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
            self.response(415, {'error': 'application/json required'})
            return
        try:
            size = int(self.headers.get('Content-Length', '-1'))
            if not 0 <= size <= MAX_BODY:
                self.response(413, {'error': 'Request too large or missing length'})
                return
            data = json.loads(self.rfile.read(size), parse_constant=lambda v: (_ for _ in ()).throw(ValueError(v)))
            if self.path == '/api/jobs':
                checked = validate(data, self.server.config['engine'])
                self.response(202, self.server.jobs.start(checked))
            elif re.fullmatch(r'/api/jobs/[a-f0-9]{32}/cancel', self.path):
                if data != {}:
                    raise ValueError('キャンセル操作の本文は空のJSONオブジェクトです。')
                self.response(200, self.server.jobs.cancel(self.path.split('/')[-2]))
            elif re.fullmatch(r'/api/jobs/[a-f0-9]{32}/resume', self.path):
                if data != {}:
                    raise ValueError('再開時の条件変更はできません。本文は空のJSONオブジェクトです。')
                self.response(202, self.server.jobs.resume(self.path.split('/')[-2]))
            elif re.fullmatch(r'/api/jobs/[a-f0-9]{32}/delete', self.path):
                if data != {}:
                    raise ValueError('削除操作の本文は空のJSONオブジェクトです。')
                self.response(200, self.server.jobs.delete(self.path.split('/')[-2]))
            elif re.fullmatch(r'/api/jobs/[a-f0-9]{32}/archive', self.path):
                if not isinstance(data, dict) or set(data) != {'archived'} or type(data['archived']) is not bool:
                    raise ValueError('archivedには真偽値が必要です。')
                self.response(200, self.server.jobs.archive(self.path.split('/')[-2], data['archived']))
            elif self.path == '/api/runtime/unload':
                if data != {}:
                    raise ValueError('モデル解放操作の本文は空のJSONオブジェクトです。')
                self.response(200, self.server.jobs.unload())
            else:
                self.response(404, {'error': 'Not found'})
        except RuntimeError as error:
            self.response(409, {'error': str(error)})
        except KeyError as error:
            self.response(404, {'error': str(error)})
        except (ValueError, TypeError, OverflowError) as error:
            self.response(400, {'error': str(error)[:500]})


def make_server(config, token, port=8766, origins=(), site_dir=None):
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    port = server.server_port
    server.hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
    server.origins = {f'http://127.0.0.1:{port}', f'http://localhost:{port}', *origins}
    server.token, server.config, server.jobs = token, config, Jobs(config)
    server.site_dir = Path(site_dir).resolve() if site_dir else None
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', choices=('tblite', 'gxtb', 'uma'), default='tblite')
    parser.add_argument('--method', choices=('GFN1-xTB', 'GFN2-xTB', 'IPEA1-xTB'), help='tblite only; default GFN2-xTB')
    parser.add_argument('--binary', help='Absolute path to the locally installed xtb with --gxtb --grad support')
    parser.add_argument('--uma-model', choices=UMA_MODELS, help='UMA only; default uma-s-1p2p1 (molecular omol task)')
    parser.add_argument('--uma-device', type=device_name, help='UMA only; cpu (default), cuda:0, cuda:1, ...')
    parser.add_argument('--uma-precision', choices=('float32', 'float64'), help='UMA only; default float64 for TS/finite differences; float32 uses less memory')
    parser.add_argument('--anysolv', action='store_true', help='Enable optional AnySolv solvent correction for UMA')
    parser.add_argument('--anysolv-model', choices=ANYSOLV_MODELS, help='Default UI selection; model_compact unless specified')
    parser.add_argument('--anysolv-checkpoint', help='Absolute local .pt path for --anysolv-model; never accepted over HTTP')
    parser.add_argument('--anysolv-device', type=device_name, help='Default AnySolv device; separate GPU when available, otherwise cpu')
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--threads', type=int, default=1)
    parser.add_argument('--job-timeout', type=int, default=1800, help='Maximum seconds per job')
    parser.add_argument('--evaluation-timeout', type=int, default=120, help='Maximum seconds per g-xTB evaluation')
    parser.add_argument('--allow-origin', action='append', default=[], help='Exact trusted origin, e.g. https://h-nabata.github.io')
    parser.add_argument('--site-dir', help='Optional molecule-visualizer folder to serve the UI locally')
    parser.add_argument('--history-dir', default=str(default_history_directory()), help='Local persistent job records; default OS user data/molecule-studio/jobs')
    parser.add_argument('--no-history', action='store_true', help='Keep job records only until this server exits')
    parser.add_argument('--no-resident-models', action='store_true', help='Release UMA/AnySolv model processes after each job')
    args = parser.parse_args()
    if args.engine != 'tblite' and args.method is not None:
        parser.error('--method is for tblite only. UMA uses --uma-model and the molecular omol task.')
    if args.engine != 'gxtb' and args.binary is not None:
        parser.error('--binary is for gxtb only. UMA uses the locally installed fairchem-core package.')
    if args.engine != 'uma' and any(x is not None for x in (args.uma_model, args.uma_device, args.uma_precision)):
        parser.error('--uma-model/--uma-device/--uma-precision require --engine uma')
    if args.anysolv and args.engine != 'uma':
        parser.error('--anysolv requires --engine uma')
    if not args.anysolv and any(x is not None for x in (args.anysolv_model, args.anysolv_checkpoint, args.anysolv_device)):
        parser.error('--anysolv-model/--anysolv-checkpoint/--anysolv-device require --anysolv')
    if not 1 <= args.threads <= 64 or not 1 <= args.port <= 65535 or not 1 <= args.job_timeout <= 86400 or not 1 <= args.evaluation_timeout <= 3600:
        parser.error('Port/threads/timeouts are out of range')
    for origin in args.allow_origin:
        url = urlsplit(origin)
        if url.scheme not in ('http', 'https') or not url.netloc or url.path or url.query or url.fragment or url.username or url.password or '*' in origin:
            parser.error('--allow-origin requires an exact http(s) origin without a path or wildcard')
    if args.engine == 'gxtb':
        if not args.binary or not Path(args.binary).is_absolute() or not Path(args.binary).is_file() or not os.access(args.binary, os.X_OK) or Path(args.binary).suffix.lower() in ('.bat', '.cmd'):
            parser.error('--binary must be an absolute executable path (not a shell script wrapper .bat/.cmd)')
    elif args.engine == 'tblite':
        try:
            importlib.metadata.version('tblite')
        except importlib.metadata.PackageNotFoundError:
            parser.error('Install tblite: python -m pip install tblite')
    if args.site_dir and not (Path(args.site_dir)/'index.html').is_file():
        parser.error('--site-dir must contain the Molecule Studio index.html')
    config = {'engine': args.engine, 'method': args.method or 'GFN2-xTB', 'binary': args.binary, 'threads': args.threads,
              'jobTimeout': args.job_timeout, 'evaluationTimeout': args.evaluation_timeout,
              'historyDir':None if args.no_history else str(Path(args.history_dir).expanduser().resolve()),
              'residentModels':not args.no_resident_models}
    if args.engine == 'uma':
        config.update(umaModel=args.uma_model or 'uma-s-1p2p1', umaDevice=args.uma_device or 'cpu',
                      umaPrecision=args.uma_precision or 'float64')
        config['method'] = engine_method(config)
        try:
            torch, *_ = uma_packages(config)  # No weights or molecular inference at startup.
            config['devices'], config['cudaMasks'] = device_inventory(torch)
            if config['umaDevice'] not in [d['id'] for d in config['devices']]:
                raise ValueError('指定したUMAのCUDAデバイスを利用できません。')
            if args.anysolv:
                other = next((d['id'] for d in config['devices'] if d['id'].startswith('cuda:') and d['id'] != config['umaDevice']), 'cpu')
                config.update(anysolv=True, anysolvModel=args.anysolv_model or 'model_compact', anysolvDevice=args.anysolv_device or other)
                if config['anysolvDevice'] not in [d['id'] for d in config['devices']]:
                    raise ValueError('指定したAnySolvのCUDAデバイスを利用できません。')
                anysolv_catalog(config, args.anysolv_checkpoint)
        except ValueError as error:
            parser.error(str(error))
    if args.engine=='gxtb':
        digest=hashlib.sha256()
        with open(args.binary,'rb') as source:
            for chunk in iter(lambda:source.read(1024*1024),b''):
                digest.update(chunk)
        config['binarySHA256']=digest.hexdigest()
    token = secrets.token_urlsafe(32)
    history_lock = None
    if config['historyDir']:
        try:
            history_lock = lock_history_directory(config['historyDir'])
        except OSError:
            parser.error('履歴保存先を使用できません。別のbridgeが使用中の場合は、終了するか別の --history-dir を指定してください。保存先の権限も確認してください。')
    server = make_server(config, token, args.port, args.allow_origin, args.site_dir)
    print(f'Molecule Studio bridge {VERSION}\nURL: http://127.0.0.1:{args.port}\nToken: {token}\nEngine: {args.engine}', flush=True)
    if args.engine == 'uma':
        print(f"Model: {config['umaModel']} / omol / {config['umaDevice']} / {config['umaPrecision']} (TF32 off)\n"
              'Models stay loaded between compatible jobs unless --no-resident-models is set. First use may download weights.\n'
              'Hugging Face credentials stay in the local environment; do not enter them in the web page.', flush=True)
    print('History: '+(config['historyDir'] or 'disabled (memory only)'), flush=True)
    print('Only keep this service running while you use it. Ctrl+C to stop.', flush=True)
    try:
        server.serve_forever(poll_interval=.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.jobs.close()
        server.server_close()
        if history_lock:
            history_lock.close()


if __name__ == '__main__':
    mp.freeze_support()
    main()
