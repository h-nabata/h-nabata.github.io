#!/usr/bin/env python3
"""Molecule Studio local energy bridge. Coordinates: Å, energies: eV, forces: eV/Å.

Only locally configured engines are executable. No commands or filesystem paths
are accepted over HTTP. Run --help; installation and numerical details: README.md.
"""
from __future__ import annotations

import argparse
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
from urllib.parse import urlsplit, unquote

import numpy as np
import psutil
from ase.data import atomic_numbers, covalent_radii
from ase.geometry import find_mic
from ase.units import Bohr, Hartree

VERSION = '1.6.0'
UMA_MODELS = ('uma-s-1p2p1', 'uma-s-1p2', 'uma-s-1p1', 'uma-m-1p1')
MAX_BODY = 8 * 1024 * 1024
MODES = ('evaluate', 'optimize', 'perpendicular', 'neb', 'cineb', 'afir', 'ts', 'vibrations')
PATH_MODES = ('perpendicular', 'neb', 'cineb')


def number(value, name, lo, hi, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f'{name}: 数値が必要です。')
    if not math.isfinite(value) or not lo <= value <= hi or (integer and int(value) != value):
        raise ValueError(f'{name}: {lo}〜{hi} の範囲で指定してください。')
    return int(value) if integer else float(value)


def validate(data, engine):
    allowed = {'symbols', 'images', 'cell', 'charge', 'multiplicity', 'mode',
               'maxSteps', 'fmax', 'spring', 'maxMove', 'climbAfter', 'atomIds', 'afir', 'livePreview',
               'optimizer', 'trustRadius', 'vibrations', 'fixedAtoms'}
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
    if mode not in MODES or (mode in PATH_MODES and len(images) < 3) or (mode in ('optimize', 'afir', 'ts', 'vibrations') and len(images) != 1):
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
    step_default, step_limit = (10000 if mode == 'afir' else 150), 10000
    for key, default, low, high, integer in [('maxSteps', step_default, 1, step_limit, True), ('fmax', .05, .00001, 10, False),
            ('spring', .1, .001, 10, False), ('maxMove', .04, .001, .2, False), ('climbAfter', 10, 0, 500, True)]:
        result[key] = number(data.get(key, default), key, low, high, integer)
    if mode == 'cineb' and result['climbAfter'] >= result['maxSteps']:
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
    optimizer = data.get('optimizer', 'sella-prfo' if mode == 'ts' else 'fire')
    choices = ('sella-prfo', 'sella-rfo') if mode == 'ts' else ('fire', 'lbfgs', 'bfgs') if mode == 'optimize' else ('fire',)
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
        result['vibrations'] = dict(delta=number(vibration.get('delta', .01), '振動解析の変位幅', .0001, .1), nfree=nfree,
            imaginaryThreshold=number(vibration.get('imaginaryThreshold', 20), '虚振動の判定閾値', 0, 1000))
    if (mode=='ts' or vibration is not None) and cell and any(cell['pbc']):
        raise ValueError('Sella TS探索・振動モード表示は非周期分子用です。')
    if 'fixedAtoms' in data:
        fixed = data['fixedAtoms']
        if not isinstance(fixed, list) or any(type(i) is not int or not 0 <= i < len(symbols) for i in fixed) or len(set(fixed)) != len(fixed):
            raise ValueError('fixedAtomsは重複のない0始まりの原子インデックス配列にしてください。')
        if fixed and (mode not in ('optimize', 'afir') or vibration is not None):
            raise ValueError('原子固定はMIN・AFIR-MIN専用です。TS・経路計算・振動解析との併用には対応していません。')
        if len(fixed) == len(symbols):
            raise ValueError('全原子は固定できません。可動原子を1個以上残してください。')
        result['fixedAtoms'] = sorted(fixed)
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


def afir_bias(positions, symbols, ids, config):
    groups = {f['id']:[ids.index(i) for i in f['atomIds']] for f in config['fragments']}
    radii = np.array([covalent_radii[atomic_numbers[s]] for s in symbols])
    total, forces = 0., np.zeros_like(positions)
    for pair in config['pairs']:
        a, b = np.meshgrid(groups[pair['a']], groups[pair['b']], indexing='ij')
        a, b = a.ravel(), b.ravel()
        vectors = positions[a]-positions[b]
        distances = np.linalg.norm(vectors, axis=1)
        if np.min(distances)<.1:
            raise ValueError('AFIRの原子団に0.1 Å未満の衝突があります。')
        logw = 6*np.log((radii[a]+radii[b])/distances)
        weights = np.exp(logw-logw.max()); weights /= weights.sum()
        distance = float(weights@distances)
        coefficient = alpha_from_gamma(pair['gamma'])*(1 if pair['mode']=='attract' else -1)
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
        images=[], energies=[], biasEnergies=[], biasedEnergies=[], forces=[], imageFmax=[], physicalFmax=[],
        validation='biased-trajectory-not-ts', converged=False, reason='step_limit',
        units={'length':'angstrom','energy':'eV','force':'eV/angstrom'})
    for step in range(data['maxSteps']+1):
        distances = np.linalg.norm(positions[:,None,:]-positions[None,:,:], axis=-1)
        if np.any(distances[np.triu_indices(len(positions),1)]<.1):
            raise ValueError('AFIR探索中に0.1 Å未満の原子衝突を検出しました。')
        energy, force = calculate(0, positions)
        force = np.asarray(force, dtype=float)
        if not math.isfinite(energy) or force.shape!=positions.shape or not np.isfinite(force).all():
            raise ValueError('物理計算から有限のエネルギー・力を取得できません。')
        bias, artificial = afir_bias(positions, data['symbols'], data['atomIds'], data['afir'])
        effective = force+artificial
        effective[fixed] = 0
        fmax = float(np.linalg.norm(effective, axis=1).max())
        result['images'].append(positions.tolist()); result['energies'].append(float(energy))
        result['biasEnergies'].append(bias); result['biasedEnergies'].append(float(energy+bias))
        result['forces'].append(force.tolist()); result['imageFmax'].append(fmax)
        result['physicalFmax'].append(float(np.linalg.norm(force, axis=1).max()))
        result.update(steps=step, evaluations=step+1, effectiveFmax=fmax)
        # One evaluated frame per checkpoint; no optimizer internals are claimed.
        progress({'step':step, 'fmax':fmax, 'energyEV':float(energy), 'biasEnergyEV':bias,
                  'checkpoint':{'positions':positions.tolist(), 'force':force.tolist(),
                    'energy':float(energy), 'bias':bias, 'fmax':fmax, 'physicalFmax':result['physicalFmax'][-1]}})
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
    return result


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


def relax(data, calculate, progress=lambda _: None):
    """Bounded FIRE integration. Reproject velocity AND displacement in strict mode.

    Endpoints are evaluated once and never moved. Final energy/force values always
    belong to the returned coordinates. No hidden alignment or reparametrization.
    """
    images = np.array(data['images'], float)
    fixed, anchors = data.get('fixedAtoms', []), images.copy()
    energies, physical = np.zeros(len(images)), np.zeros_like(images)
    velocity = np.zeros_like(images)
    mode, max_steps = data['mode'], data['maxSteps']
    dt, alpha, positive = .05, .1, 0
    previous_climbing = None
    history, max_parallel_step = [], 0.0
    trajectory = {'images': [], 'energies': []} if mode == 'optimize' else None
    evaluations = 0
    for step in range((0 if mode == 'evaluate' else max_steps) + 1):
        for i in range(len(images)):
            if step and mode != 'optimize' and i in (0, len(images)-1):
                continue
            progress({'step': step, 'image': i+1, 'images': len(images), 'evaluations': evaluations})
            energy, force = calculate(i, images[i])
            force = np.asarray(force, dtype=float)
            if not np.isfinite(energy) or force.shape != images[i].shape or not np.isfinite(force).all():
                raise ValueError('エンジンから有限なエネルギー・力を取得できませんでした。')
            energies[i], physical[i] = energy, force
            evaluations += 1
        climbing = int(np.argmax(energies[1:-1]))+1 if mode == 'cineb' and step >= data['climbAfter'] else None
        effective, tangents = band_forces(images, energies, physical, mode, data['spring'], climbing)
        if mode == 'evaluate':
            effective = physical.copy()
        if fixed:
            effective[:, fixed, :] = 0
        maximum = force_max(effective)
        converged = mode != 'evaluate' and maximum <= data['fmax'] and (mode != 'cineb' or climbing is not None)
        summary = {'step': step, 'fmax': maximum, 'energies': energies.tolist(), 'climbingImage': climbing,
                   'evaluations': evaluations}
        history.append(summary)
        checkpoint = {}
        if trajectory is not None:
            positions = images[0].tolist()
            trajectory['images'].append(positions)
            trajectory['energies'].append(float(energies[0]))
            checkpoint = {'checkpoint': {'positions': positions, 'energy': float(energies[0]),
                'force': physical[0].tolist(), 'fmax': maximum}}
        elif mode in PATH_MODES:
            # Keep only the most recent completely evaluated band for pause/edit/resume.
            checkpoint = {'bandCheckpoint': {'images': images.tolist(), 'energies': energies.tolist(),
                'forces': physical.tolist(), 'effectiveFmax': maximum, 'imageFmax': [force_max(f) for f in effective],
                'steps': step, 'evaluations': evaluations, 'climbingImage': climbing}}
        # Checkpoints stay in the local service; progress responses omit coordinates.
        progress({**summary, **checkpoint, **({'preview': {'step': step, 'images': images.tolist(), 'energies': energies.tolist()}} if data.get('livePreview') else {})})
        if mode == 'evaluate' or converged or step == max_steps:
            return {'images': images.tolist(), 'energies': energies.tolist(), 'forces': physical.tolist(),
                    'effectiveFmax': maximum, 'imageFmax': [force_max(f) for f in effective],
                    'converged': converged, 'reason': 'evaluated' if mode == 'evaluate' else 'converged' if converged else 'step_limit',
                    'steps': step, 'climbingImage': climbing, 'mode': mode, 'evaluations': evaluations,
                    'maxTangentialStep': max_parallel_step if mode == 'perpendicular' else None,
                    'history': history, 'fixedAtoms': fixed, **({'trajectory': trajectory} if trajectory is not None else {}),
                    'units': {'length': 'angstrom', 'energy': 'eV', 'force': 'eV/angstrom'}}
        if climbing != previous_climbing:
            velocity[:] = 0
            dt, alpha, positive = .05, .1, 0
            previous_climbing = climbing
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
            # A single scalar per image preserves the 3N orthogonality.
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
                distances = np.linalg.norm(positions[:,None]-positions[None,:], axis=-1)
                if np.min(distances[np.triu_indices(len(positions),1)])<.1:
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
    if data.get('fixedAtoms'):
        from ase.constraints import FixAtoms
        atoms.set_constraint(FixAtoms(indices=data['fixedAtoms']))
    return atoms


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
        summary = dict(step=step, fmax=maximum, energies=[float(energy)], evaluations=atoms.calc.evaluations)
        history.append(summary)
        progress({**summary, 'phase':'optimization', 'checkpoint':dict(positions=positions, energy=float(energy), force=physical.tolist(), fmax=maximum),
            **({'preview':dict(step=step, images=[positions], energies=[float(energy)])} if data.get('livePreview') else {})})

    optimizer.attach(checkpoint, interval=1)
    converged = bool(optimizer.run(fmax=data['fmax'], steps=data['maxSteps']))
    force = atoms.get_forces(); maximum = force_max(force)
    converged = converged and maximum<=data['fmax']
    return dict(images=[atoms.positions.tolist()], energies=[float(atoms.get_potential_energy())], forces=[atoms.get_forces(apply_constraint=False).tolist()],
        imageFmax=[maximum], effectiveFmax=maximum, converged=converged, reason='converged' if converged else 'step_limit',
        steps=len(trajectory['images'])-1, evaluations=atoms.calc.evaluations, mode=data['mode'], optimizer=data['optimizer'],
        climbingImage=None, maxTangentialStep=None, trajectory=trajectory, history=history, fixedAtoms=data.get('fixedAtoms', []),
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
    if data['mode']=='afir':
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
    return result


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
            calc.set('accuracy', .01 if self.data['mode']=='ts' or 'vibrations' in self.data else 1.0)
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
    if config['umaDevice'] == 'cuda' and not torch.cuda.is_available():
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
                device=config['umaDevice'], inference_settings=Settings(**uma_settings(config)))
        except Exception as error:
            raise ValueError(uma_failure(error)) from error
        self.Atoms, self.Calculator, self.data = Atoms, Calculator, data
        self.atoms = {}

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


def engine_method(config):
    if config['engine'] == 'uma':
        return f"UMA / {config['umaModel']} / omol"
    return config['method'] if config['engine'] == 'tblite' else 'g-xTB'


def package_version(name):
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def worker(data, config, directory, messages):
    try:
        # Spawned before importing native tblite; bound CPU use for responsiveness.
        for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
            os.environ[key] = str(config['threads'])
        if config['engine'] == 'uma':
            messages.put(('progress', {'phase':'loading_model'}))
        calculator = {'tblite':TBLiteEngine, 'gxtb':GXTBEngine, 'uma':UMAEngine}[config['engine']](data, config, directory)
        if config['engine'] == 'uma':
            messages.put(('progress', {'phase':'calculating'}))
        result = calculate_job(data, calculator, directory, lambda p: messages.put(('progress', p)))
        result['engine'] = config['engine']
        result['method'] = engine_method(config)
        result['symbols'], result['cell'] = data['symbols'], data['cell']
        result['charge'], result['multiplicity'] = data['charge'], data['multiplicity']
        if 'atomIds' in data:
            result['atomIds'] = data['atomIds']
        result['conditionId'] = hashlib.sha256(json.dumps({'data':data, 'config':config}, sort_keys=True).encode()).hexdigest()
        result['provenance'] = provenance(config)
        messages.put(('result', result))
    except Exception as error:
        messages.put(('error', str(error)[:2500]))


def provenance(config):
    return {'bridgeVersion':VERSION, 'engine':config['engine'], 'binarySHA256':config.get('binarySHA256'),
        'threads':config['threads'], 'solvent':'gas', 'aseVersion':importlib.metadata.version('ase'),
        'numpyVersion':np.__version__, 'sellaVersion':sella_version(),
        **({'uma':{'model':config['umaModel'], 'task':'omol', 'device':config['umaDevice'],
                   'inference':uma_settings(config), 'fairchemVersion':package_version('fairchem-core'),
                   'torchVersion':package_version('torch')}} if config['engine']=='uma' else {}),
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
        pass
    process.join(timeout=3)


class Jobs:
    def __init__(self, config):
        self.config, self.lock, self.job = config, threading.RLock(), None

    def start(self, data):
        with self.lock:
            if self.job and self.job['status'] in ('running', 'stopping'):
                raise RuntimeError('別の計算が実行中です。中止または完了後に実行してください。')
            if self.job:
                self.job['thread'].join(timeout=5)
                if self.job['thread'].is_alive():
                    raise RuntimeError('前の計算の終了処理中です。少し待ってください。')
            directory = tempfile.mkdtemp(prefix='molecule-engine-')
            for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
                os.environ[key] = str(self.config['threads'])
            context = mp.get_context('spawn')
            messages = context.Queue()
            process = context.Process(target=worker, args=(data, self.config, directory, messages), daemon=True)
            job = {'id': secrets.token_hex(16), 'status': 'running', 'progress': {}, 'process': process,
                   'directory': directory, 'queue': messages, 'started': time.monotonic(), 'data':data, 'checkpoints':[]}
            self.job = job
            process.start()
            thread = job['thread'] = threading.Thread(target=self.monitor, args=(job,), daemon=True)
            thread.start()
            return self.public(job)

    @staticmethod
    def public(job):
        return copy.deepcopy({k: v for k, v in job.items() if k in ('id', 'status', 'progress', 'result', 'error')})

    def monitor(self, job):
        try:
            while job['status'] == 'running':
                if time.monotonic()-job['started'] > self.config['jobTimeout']:
                    with self.lock:
                        job['status'], job['error'], job['terminalStatus'] = 'stopping', '計算時間の上限に達しました。', 'error'
                    break
                try:
                    kind, value = job['queue'].get(timeout=.2)
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
                        checkpoint = value.pop('checkpoint', None)
                        if checkpoint is not None:
                            job['checkpoints'].append(checkpoint)
                        for key in ('bandCheckpoint', 'structureCheckpoint'):
                            saved = value.pop(key, None)
                            if saved is not None:
                                job[key] = saved
                        preview = value.pop('preview', None)
                        if preview is not None:
                            job['preview'] = preview
                        job['progress'].update(value)
                    elif kind == 'result':
                        job['status'], job['result'] = 'completed', value
                    else:
                        job['status'], job['error'], job['terminalStatus'] = 'stopping', value, 'error'
        finally:
            # Always reap native processes, including timeout/cancel/SCF failures.
            stop_process(job['process'])
            job['process'].join(timeout=2)
            job['queue'].close()
            shutil.rmtree(job['directory'], ignore_errors=True)
            if job['status']=='stopping':
                with self.lock:
                    job['status'] = job.get('terminalStatus', 'cancelled')
                    if job.get('structureCheckpoint'):
                        job['result'] = self.partial_structure(job)
                    elif job['data']['mode']=='afir' and job['checkpoints']:
                        job['result'] = self.partial_afir(job)
                    elif job['data']['mode'] in ('optimize', 'ts') and job['checkpoints']:
                        job['result'] = self.partial_optimization(job)
                    elif job.get('bandCheckpoint'):
                        job['result'] = self.partial_structure(job)

    def partial_structure(self, job):
        data = job['data']
        result = copy.deepcopy(job.get('structureCheckpoint') or job['bandCheckpoint'])
        if 'structureCheckpoint' in job:
            result['vibrations'] = {'status':'cancelled' if job['status']=='cancelled' else 'failed',
                                    'error':job.get('error', '振動解析を中止しました。構造の結果は保持しています。')}
        else:
            result.update(converged=False, reason='cancelled' if job['status']=='cancelled' else 'failed',
                          maxTangentialStep=None, history=[], error=job.get('error'))
        result['conditionId'] = hashlib.sha256(json.dumps({'data':data, 'config':self.config}, sort_keys=True).encode()).hexdigest()
        result.update(mode=data['mode'], symbols=data['symbols'], cell=data['cell'], charge=data['charge'], multiplicity=data['multiplicity'],
            engine=self.config['engine'], method=engine_method(self.config),
            provenance=provenance(self.config), units={'length':'angstrom','energy':'eV','force':'eV/angstrom'})
        result['fixedAtoms'] = data.get('fixedAtoms', [])
        if 'atomIds' in data:
            result['atomIds'] = data['atomIds']
        return result

    def partial_optimization(self, job):
        data, frames = job['data'], job['checkpoints']
        last = frames[-1]
        return dict(mode=data['mode'], optimizer=data.get('optimizer','fire'), engine=self.config['engine'],
            fixedAtoms=data.get('fixedAtoms', []),
            **({'atomIds':data['atomIds']} if 'atomIds' in data else {}),
            method=engine_method(self.config),
            symbols=data['symbols'], cell=data['cell'], charge=data['charge'], multiplicity=data['multiplicity'],
            images=[last['positions']], energies=[last['energy']], forces=[last['force']],
            imageFmax=[last['fmax']], effectiveFmax=last['fmax'], steps=len(frames)-1, evaluations=len(frames),
            converged=False, reason='cancelled' if job['status']=='cancelled' else 'failed', error=job.get('error'),
            climbingImage=None, maxTangentialStep=None,
            trajectory={'images':[p['positions'] for p in frames], 'energies':[p['energy'] for p in frames]},
            history=[{'step':i, 'fmax':p['fmax'], 'energies':[p['energy']], 'climbingImage':None, 'evaluations':i+1} for i,p in enumerate(frames)],
            provenance=provenance(self.config),
            conditionId=hashlib.sha256(json.dumps({'data':data, 'config':self.config}, sort_keys=True).encode()).hexdigest(),
            units={'length':'angstrom', 'energy':'eV', 'force':'eV/angstrom'})

    def partial_afir(self, job):
        data, frames = job['data'], job['checkpoints']
        energies, biases = [p['energy'] for p in frames], [p['bias'] for p in frames]
        return dict(schema='molecule-afir-trajectory/1', mode='afir', engine=self.config['engine'],
            fixedAtoms=data.get('fixedAtoms', []),
            method=engine_method(self.config), atomIds=data['atomIds'],
            symbols=data['symbols'], cell=data['cell'], charge=data['charge'], multiplicity=data['multiplicity'],
            images=[p['positions'] for p in frames], energies=energies, biasEnergies=biases,
            biasedEnergies=[e+b for e,b in zip(energies,biases)], forces=[p['force'] for p in frames],
            imageFmax=[p['fmax'] for p in frames], physicalFmax=[p['physicalFmax'] for p in frames],
            effectiveFmax=frames[-1]['fmax'], steps=len(frames)-1, evaluations=len(frames),
            converged=False, reason='cancelled' if job['status']=='cancelled' else 'failed',
            error=job.get('error'), validation='biased-trajectory-not-ts',
            provenance=provenance(self.config),
            conditionId=hashlib.sha256(json.dumps({'data':data, 'config':self.config}, sort_keys=True).encode()).hexdigest(),
            units={'length':'angstrom','energy':'eV','force':'eV/angstrom'})

    def get(self, identifier, preview=False, after=0):
        with self.lock:
            if not self.job or self.job['id'] != identifier:
                raise KeyError('計算が見つかりません。サービス再起動後は再計算してください。')
            result = self.public(self.job)
            if preview:
                if self.job['data']['mode'] == 'afir':
                    frames = self.job['checkpoints']
                    end = min(len(frames), after + 1000)
                    if 0 <= after < end:
                        part = frames[after:end]
                        result['preview'] = {'mode': 'afir', 'from': after, 'next': end,
                            'energies': [p['energy'] for p in part], 'biasEnergies': [p['bias'] for p in part],
                            'positions': part[-1]['positions']}
                elif self.job.get('preview') is not None:
                    result['preview'] = copy.deepcopy(self.job['preview'])
            return result

    def cancel(self, identifier):
        with self.lock:
            if not self.job or self.job['id'] != identifier:
                raise KeyError('計算が見つかりません。')
            if self.job['status'] == 'running':
                self.job['status'] = 'stopping'
                self.job['terminalStatus'] = 'cancelled'
            return self.public(self.job)

    def close(self):
        if self.job:
            self.cancel(self.job['id'])
            self.job['thread'].join(timeout=8)


class Handler(BaseHTTPRequestHandler):
    server_version = 'MoleculeBridge/1'

    def log_message(self, *args):
        pass  # Never log tokens, coordinates, or full request paths.

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def response(self, status, payload, mime='application/json; charset=utf-8'):
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode() if isinstance(payload, dict) else payload
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
                        'maxMultiplicity':100, 'maxAtomicNumber':83} if config['engine']=='uma' else {}),
                    'sellaVersion':sella_version(), 'vibrations':1, 'maxVibrationAtoms':200, 'pathCheckpoint':1, 'fixedAtoms':True,
                    'modes': MODES, 'livePreview': 1, 'optimizationTrajectory': 1, 'maxSteps': 10000, 'maxAFIRSteps': 10000, 'jobTimeout': config['jobTimeout'],
                    'engineVersion': package_version('fairchem-core' if config['engine']=='uma' else 'tblite') if config['engine']!='gxtb' else 'locally configured binary'})
            elif re.fullmatch(r'/api/jobs/[a-f0-9]{32}(?:\?preview=1&after=[0-9]{1,5})?', self.path):
                try:
                    parts = self.path.rsplit('/', 1)[1].split('?', 1)
                    after = int(parts[1].rsplit('=', 1)[1]) if len(parts) == 2 else 0
                    self.response(200, self.server.jobs.get(parts[0], len(parts) == 2, after))
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
                self.response(200, self.server.jobs.cancel(self.path.split('/')[-2]))
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
    parser.add_argument('--uma-device', choices=('cpu', 'cuda'), help='UMA only; default cpu; cuda requires a compatible GPU/PyTorch')
    parser.add_argument('--uma-precision', choices=('float32', 'float64'), help='UMA only; default float64 for TS/finite differences; float32 uses less memory')
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--threads', type=int, default=1)
    parser.add_argument('--job-timeout', type=int, default=1800, help='Maximum seconds per job')
    parser.add_argument('--evaluation-timeout', type=int, default=120, help='Maximum seconds per g-xTB evaluation')
    parser.add_argument('--allow-origin', action='append', default=[], help='Exact trusted origin, e.g. https://h-nabata.github.io')
    parser.add_argument('--site-dir', help='Optional molecule-visualizer folder to serve the UI locally')
    args = parser.parse_args()
    if args.engine != 'tblite' and args.method is not None:
        parser.error('--method is for tblite only. UMA uses --uma-model and the molecular omol task.')
    if args.engine != 'gxtb' and args.binary is not None:
        parser.error('--binary is for gxtb only. UMA uses the locally installed fairchem-core package.')
    if args.engine != 'uma' and any(x is not None for x in (args.uma_model, args.uma_device, args.uma_precision)):
        parser.error('--uma-model/--uma-device/--uma-precision require --engine uma')
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
              'jobTimeout': args.job_timeout, 'evaluationTimeout': args.evaluation_timeout}
    if args.engine == 'uma':
        config.update(umaModel=args.uma_model or 'uma-s-1p2p1', umaDevice=args.uma_device or 'cpu',
                      umaPrecision=args.uma_precision or 'float64')
        config['method'] = engine_method(config)
        try:
            uma_packages(config)  # Check dependencies/device without downloading weights or running a molecule.
        except ValueError as error:
            parser.error(str(error))
    if args.engine=='gxtb':
        digest=hashlib.sha256()
        with open(args.binary,'rb') as source:
            for chunk in iter(lambda:source.read(1024*1024),b''):
                digest.update(chunk)
        config['binarySHA256']=digest.hexdigest()
    token = secrets.token_urlsafe(32)
    server = make_server(config, token, args.port, args.allow_origin, args.site_dir)
    print(f'Molecule Studio bridge {VERSION}\nURL: http://127.0.0.1:{args.port}\nToken: {token}\nEngine: {args.engine}', flush=True)
    if args.engine == 'uma':
        print(f"Model: {config['umaModel']} / omol / {config['umaDevice']} / {config['umaPrecision']} (TF32 off)\n"
              'The model is loaded on each job. First use may download weights from Hugging Face.\n'
              'Hugging Face credentials stay in the local environment; do not enter them in the web page.', flush=True)
    print('Only keep this service running while you use it. Ctrl+C to stop.', flush=True)
    try:
        server.serve_forever(poll_interval=.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.jobs.close()
        server.server_close()


if __name__ == '__main__':
    mp.freeze_support()
    main()
