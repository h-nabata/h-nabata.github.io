"""Compare electrocyclic pathways with the same images, numerical settings and PES.

OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 python molecule-visualizer/tests/benchmark_butadiene.py
GXTB_TEST_BINARY=/path/to/xtb OMP_NUM_THREADS=1 python molecule-visualizer/tests/benchmark_butadiene.py --engine gxtb
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

import numpy as np
from ase.io import read

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'local-engine'))
import bridge

PAIRS = [[0, 3], [1, 2], [4, 8], [5, 9], [6, 7]]
MIRROR = np.array([3, 2, 1, 0, 8, 9, 7, 6, 4, 5])
EXAMPLE = ROOT/'examples/butadiene-disrotatory.xyz'


def band(case, distortion, twist=0., source=EXAMPLE):
    frames = read(source, index=':')
    symbols = list('CCCCHHHHHH')
    if len(frames) < 3 or any(frame.get_chemical_symbols() != symbols for frame in frames):
        raise ValueError('Expected at least three C4H6 images with the example atom order.')
    images = np.stack([frame.positions for frame in frames])
    if case == 'con':
        # The two methylene H atoms are equivalent in cyclobutene. Reverse the
        # *mapped* right-hand rotation using the same molecular endpoints.
        if not np.allclose(images[:, :4, 2], 0., atol=1e-8):
            raise ValueError('The conrotatory control requires an xy-planar carbon backbone.')
        images[:, 8:10, 2] *= -1
    else:
        # Twist the left and right terminal groups oppositely about C2-C3.
        # The sine envelope gives exactly the same endpoints in all dis runs.
        phase = np.sin(np.linspace(0, np.pi, len(images)))[1:-1, None]
        images[1:-1, [0, 4, 5], 2] += distortion*phase
        images[1:-1, [3, 8, 9], 2] -= distortion*phase
        # A second disturbance breaks the paired methylene rotations directly.
        # Equal signed rotations about the two outward C-C axes are mirror-odd.
        for image, envelope in zip(images[1:-1], phase[:, 0]):
            angle = np.deg2rad(twist)*envelope
            for end, middle, hydrogens in [(0, 1, [4, 5]), (3, 2, [8, 9])]:
                axis = image[end]-image[middle]
                axis /= np.linalg.norm(axis)
                vectors = image[hydrogens]-image[end]
                rotated = (np.cos(angle)*vectors + np.sin(angle)*np.cross(axis, vectors)
                           + (1-np.cos(angle))*(vectors@axis)[:,None]*axis)
                image[hydrogens] = image[end]+rotated
    return symbols, images


def terminal_angles(p):
    # Each terminal CH2 has one labelled inner H (image 1). Its separation
    # vector from the outer H is projected perpendicular to the terminal bond.
    # Using a common sense for the two normals makes mirror-related rotations
    # have identical angles. Rigid translations/rotations leave them unchanged.
    def unit(x):
        return x/np.linalg.norm(x)
    spine = unit(p[2]-p[1])
    angles = []
    for end, middle, inner, outer, sign in [(0, 1, 4, 5, 1), (3, 2, 8, 9, -1)]:
        axis = unit(p[end]-p[middle])
        normal = unit(np.cross(spine, axis))
        lateral = sign*np.cross(axis, normal)
        hydrogens = p[inner]-p[outer]
        angles.append(float(np.degrees(np.arctan2(hydrogens@normal, hydrogens@lateral))))
    return angles


def branch(angles):
    # Both labelled methylenes must have appreciable signed out-of-plane tilt.
    # sin(theta) also excludes a planar group with the H labels reversed.
    tilt = np.sin(np.deg2rad(angles))
    if min(abs(tilt)) < np.sin(np.deg2rad(10.)):
        return 'unresolved'
    return 'dis' if tilt[0]*tilt[1] > 0 else 'con'


def geometry(images, energies):
    peak = int(np.argmax(energies[1:-1]))+1
    angles = [terminal_angles(p) for p in images]
    classes = [branch(pair) for pair in angles]
    labels = set(classes[1:-1]) - {'unresolved'}
    if len(labels) > 1:
        channel = 'mixed'
    elif labels:
        channel = labels.pop()
    else:
        channel = 'unresolved'
    # Fit a *single* plane to all frames and fixed atom correspondences. This
    # geometry-based diagnostic works also on unrestrained translated/rotated
    # bands and is independent of the solver's projector or force residuals.
    origin = images.mean(axis=(0, 1))
    partners = images[:, MIRROR]
    mid = ((images+partners)/2 - origin).reshape(-1, 3)
    halfdiff = ((images-partners)/2).reshape(-1, 3)
    normal = np.linalg.eigh(mid.T@mid - halfdiff.T@halfdiff)[1][:, 0]
    reflected = partners - 2*((partners-origin)@normal)[..., None]*normal
    error = np.max(np.linalg.norm(images-reflected, axis=2), axis=1)
    return {'peakImage':peak+1, 'terminalAnglesDeg':angles[peak], 'imageAnglesDeg':angles, 'peakClass':classes[peak],
            'bandClass':channel, 'imageClasses':classes, 'maxMirrorErrorA':float(max(error)),
            'worstMirrorImage':int(np.argmax(error))+1,
            'barrierEV':float(energies[peak]-energies[0]),
            'closingDistanceA':float(np.linalg.norm(images[peak, 0]-images[peak, 3]))}


def first_event(trace, kind):
    for sample in trace:
        if kind == 'mirror':
            if sample['maxMirrorErrorA'] <= .05:
                continue
            indices = [sample['worstMirrorImage']]
        elif kind == 'peak':
            if sample['peakClass'] != 'con':
                continue
            indices = [sample['peakImage']]
        else:
            indices = [i+1 for i, cls in enumerate(sample['imageClasses'][1:-1], 1) if cls == 'con']
            if not indices:
                continue
        return {'step':sample['step'], 'images':indices, 'peakImage':sample['peakImage'],
                'terminalAnglesDeg': [sample['imageAnglesDeg'][i-1] for i in indices],
                'peakClass':sample['peakClass'], 'bandClass':sample['bandClass']}
    return None


def run(mode, case, *, engine, distortion, steps, endpoint_mode, workers=1, twist=0., source=EXAMPLE, max_move=.03, climb_after=5, pre_relax=False):
    symbols, images = band(case, distortion, twist, source)
    job = {'symbols':symbols, 'images':images.tolist(), 'mode':mode, 'fmax':.05, 'maxMove':max_move,
           'spring':1., 'climbAfter':climb_after, 'maxSteps':steps}
    if case == 'mirror':
        job['pathSymmetry'] = {'type':'mirror', 'pairs':PAIRS}
    if mode in ('cineb', 'lup'):
        job['endpointMode'] = endpoint_mode
    trace = []
    last_band = None
    def record(event):
        nonlocal last_band
        snapshot = event.get('bandCheckpoint')
        if snapshot and 'steps' in snapshot:
            last_band = snapshot
            result = geometry(np.asarray(snapshot['images']), np.asarray(snapshot['energies']))
            trace.append({'step':event['step'], **result})
    def evaluate(payload, directory, progress=lambda event: None):
        data = bridge.validate(payload, engine)
        if engine == 'gxtb':
            binary = os.environ.get('GXTB_TEST_BINARY')
            if not binary:
                raise ValueError('Set GXTB_TEST_BINARY to the g-xTB executable')
            config = {'binary':str(Path(binary).resolve()), 'evaluationTimeout':120}
            calculator = bridge.GXTBEngine(data, config, directory)
        else:
            calculator = bridge.TBLiteEngine(data, {'method':'GFN2-xTB'}, directory)
        cache = bridge.ExactEvaluationCache(calculator, workers=workers)
        try:
            return bridge.calculate_job(data, cache, directory, progress)
        finally:
            cache.close()

    pre = None
    stage = 'preRelaxation' if pre_relax else 'path'
    failure = None
    with tempfile.TemporaryDirectory() as directory:
        try:
            if pre_relax:
                seed_job = dict(job, mode='neb', maxMove=.03)
                seed_job.pop('endpointMode', None)
                seed = evaluate(seed_job, directory, record)
                pre = {k:seed[k] for k in ('reason','steps','effectiveFmax','evaluations')}
                if not seed['converged']:
                    raise RuntimeError('NEB seed failed to converge: '+str(pre))
                job['images'] = seed['images']
                stage, last_band = 'path', None
                trace.clear()
            result = evaluate(job, directory, record)
        except (ValueError, RuntimeError, OSError) as exc:
            lines = [line.strip() for line in str(exc).splitlines() if line.strip()]
            detail = next((line for line in lines if 'SCF not converged' in line), str(exc)[:350])
            failure = {'stage':stage, 'error':detail}
            result = {**(last_band or {}), 'reason':'failed'}
    final = {}
    if 'images' in result:
        final = geometry(np.array(result['images']), np.array(result['energies']))
        final['peakCoordinatesA'] = result['images'][final['peakImage']-1]
        if failure:
            failure.update(lastCompleteBandA=result['images'], lastCompleteEnergiesEV=result['energies'])
    initial = geometry(images, np.zeros(len(images)))
    return {'mode':mode, 'case':case, 'engine':engine, 'inputFile':Path(source).name, 'preRelaxation':pre,
            'inputSHA256':hashlib.sha256(Path(source).read_bytes()).hexdigest(),
            'inputBandClass':initial['bandClass'], 'inputMaxMirrorErrorA':initial['maxMirrorErrorA'],
            'pathConsistencyWarning':result.get('pathConsistencyWarning'), 'failure':failure,
            'maxMoveA':max_move, 'climbAfter':climb_after, 'maxSteps':steps, 'endpointMode':job.get('endpointMode','fixed'),
            'inputBendA':0. if case=='con' else distortion, 'inputTerminalTwistDeg':0. if case=='con' else twist, 'steps':result.get('steps'),
            'evaluations':result.get('evaluations'), 'reason':result['reason'], 'fmaxEVPerA':result.get('effectiveFmax'),
            **final, 'firstMirrorErrorOver0.05A':first_event(trace,'mirror'),
            'firstConrotatoryInterior':first_event(trace,'con'), 'firstConrotatoryPeak':first_event(trace,'peak'),
            'trace':trace}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', choices=['tblite','gxtb'], default='tblite')
    parser.add_argument('--mode', choices=['neb','cineb','lup'], nargs='+', default=['neb','cineb','lup'])
    parser.add_argument('--case', choices=['free','mirror','con'], nargs='+', default=['free','mirror','con'])
    parser.add_argument('--input', type=Path, default=EXAMPLE, help='Matched C4H6 XYZ with the same atom order and x=0 mirror plane')
    parser.add_argument('--distortion', type=float, default=.015)
    parser.add_argument('--twist-deg', type=float, default=0., help='Additional mirror-breaking terminal twist (degrees)')
    parser.add_argument('--pre-relax', action='store_true', help='Converge a fixed-end ordinary NEB seed before starting the requested method')
    parser.add_argument('--max-move', type=float, default=.03)
    parser.add_argument('--climb-after', type=int, default=5)
    parser.add_argument('--steps', type=int, default=200)
    parser.add_argument('--endpoint-mode', choices=['relax','fixed'], default='fixed')
    parser.add_argument('--workers', type=int, default=1)
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    results = []
    for mode in args.mode:
        for case in args.case:
            try:
                result = run(mode, case, engine=args.engine, distortion=args.distortion, steps=args.steps,
                             endpoint_mode=args.endpoint_mode, workers=args.workers, twist=args.twist_deg, source=args.input,
                             max_move=args.max_move, climb_after=args.climb_after, pre_relax=args.pre_relax)
            except (OSError, ValueError) as exc:
                result = {'mode':mode, 'case':case, 'engine':args.engine, 'reason':'failed',
                          'failure':{'stage':'input', 'error':str(exc)}}
            results.append(result)
            summary = {k:v for k,v in result.items() if k not in ('trace','peakCoordinatesA','imageAnglesDeg')}
            if result.get('failure'):
                summary['failure'] = {k:result['failure'][k] for k in ('stage','error')}
            print(json.dumps(summary), flush=True)
            if args.json:
                args.json.write_text(json.dumps(results, indent=2)+'\n')
    return int(any(row['reason'] == 'failed' for row in results))


if __name__ == '__main__':
    sys.exit(main())
