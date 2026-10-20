#!/usr/bin/env python3
"""Reproducible, non-gating comparison of projected paths, CI-NEB and CI-string.

Run from the repository root, after installing numpy/ASE/psutil (tblite optional):
  python molecule-visualizer/tests/benchmark_lup.py --native --json /tmp/lup.json

This is not a benchmark of the proprietary GRRM LUP implementation. The
``perpendicular`` baseline is this application's unreparametrized perpendicular
relaxation, which neither redistributes images nor converges a climbing image.
Its projected-force convergence therefore does not establish a TS. All methods
receive exactly the same endpoints/images, force threshold, displacement cap,
step budget and (where applicable) climbing-image start. CI-NEB alone uses the
reported spring constant. LUP FIRE/L-BFGS use identical redistribution settings.

Analytic potentials have known stationary points but are not molecular models.
The optional native NH3 inversion uses GFN2-xTB and an independently optimized
planar reference with one significant imaginary frequency. Reference TS/minimum
preparation, validation Hessians, final metrics and report writing are excluded
from path force-evaluation counts and path timing. No hardware speed claim is
made from these small, mostly Python-dominated systems.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import sys
import tempfile
import time

os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('MKL_NUM_THREADS', '1')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'local-engine'))
import bridge as b
import numpy as np


METHODS = {
    'projection': ('perpendicular', 'fire'),
    'cineb': ('cineb', 'fire'),
    'lup-fire': ('lup', 'fire'),
    'lup-lbfgs': ('lup', 'lbfgs'),
}


class CurvedWell:
    """U=(1-x²)²+a(x³/3-x)+k/2[y-c(1-x²)]²+kz/2 z².

    Minima are exactly x=±1,y=z=0. The unique connecting index-one saddle
    lies at x=-a/4, y=c(1-x²), z=0 for |a|<4. Along the curved valley, y=g(x)
    is not generally an exact MEP; only stationary points are asserted exactly.
    """
    def __init__(self, name, curve, transverse, asymmetry):
        self.name, self.c, self.k, self.a = name, curve, transverse, asymmetry
        self.kz = max(2., transverse/2)
        x = -self.a/4
        self.ts = np.array([[x, self.c*(1-x*x), 0.]])

    def __call__(self, index, positions):
        x, y, z = np.asarray(positions)[0]
        offset = y-self.c*(1-x*x)
        energy = (1-x*x)**2+self.a*(x**3/3-x)+.5*self.k*offset**2+.5*self.kz*z*z
        gx = (x*x-1)*(4*x+self.a)+2*self.k*self.c*x*offset
        return float(energy), -np.array([[gx, self.k*offset, self.kz*z]])

    def check_gradient(self):
        for p in (np.array([[.31, -.21, .07]]), np.array([[-.62, .4, -.08]])):
            _, force = self(0, p)
            finite = np.zeros_like(p)
            for axis in range(3):
                plus, minus = p.copy(), p.copy()
                plus[0, axis] += 1e-6
                minus[0, axis] -= 1e-6
                finite[0, axis] = -(self(0, plus)[0]-self(0, minus)[0])/2e-6
            np.testing.assert_allclose(force, finite, rtol=1e-6, atol=1e-7)

    def case(self, nodes, initialization):
        t = np.linspace(0., 1., nodes)
        # Even node counts and a nonlinear spacing avoid placing the exact TS
        # in the initial band, including the symmetric cases.
        x = -1+2*t**(1.0+.3*initialization)
        y = (.12+.07*initialization)*np.sin(math.pi*t)+.06*np.sin(2*math.pi*t)
        z = .04*np.sin(math.pi*t)
        positions = np.stack((x, y, z), axis=1)[:, None, :]
        positions[[0, -1]] = [[[-1., 0., 0.]], [[1., 0., 0.]]]
        nearest = min(b.force_max(p-self.ts) for p in positions)
        if nearest <= 1e-4:
            raise ValueError('The initial band accidentally contains the reference TS.')
        return dict(name=self.name, kind='analytic-single-particle', initialization=initialization,
            symbols=['He'], multiplicity=1, images=positions.tolist(), potential=self,
            referenceTS=self.ts.tolist(), referenceTSEnergy=self(0, self.ts)[0],
            reference=dict(type='analytic-exact', curve=self.c, transverse=self.k, asymmetry=self.a,
                           initialNearestTSDistanceAngstrom=nearest))


def ammonia_case(nodes):
    """Prepare one common NH3 band and an independent planar index-one TS."""
    from scipy.optimize import minimize_scalar
    angles = np.array([0, 2*math.pi/3, 4*math.pi/3])

    def planar(radius):
        return np.vstack(([0., 0., 0.], np.column_stack((radius*np.cos(angles), radius*np.sin(angles), np.zeros(3)))))

    symbols = ['N', 'H', 'H', 'H']
    data = b.validate(dict(symbols=symbols, images=[planar(1.).tolist()], mode='vibrations',
        vibrations={'delta':.001, 'nfree':4}), 'tblite')
    with tempfile.TemporaryDirectory(prefix='lup-reference-') as directory:
        calculator = b.TBLiteEngine(data, {'method':'GFN2-xTB'}, directory)
        optimum = minimize_scalar(lambda radius:calculator(0, planar(radius))[0], bounds=(.8, 1.3),
                                  method='bounded', options={'xatol':1e-9})
        if not optimum.success:
            raise RuntimeError('Independent planar NH3 reference did not converge.')
        ts = planar(optimum.x)
        ts_energy, ts_force = calculator(0, ts)
        if b.force_max(ts_force) > 1e-4:
            raise RuntimeError('Planar NH3 reference is not stationary.')
        vibration = b.vibration_analysis({**data, 'images':[ts.tolist()]}, calculator, directory)
        if vibration['significantImaginaryCount'] != 1:
            raise RuntimeError('NH3 reference must have exactly one significant imaginary frequency.')
        guess = ts.copy()
        guess[0, 2] = .3
        minimum_input = b.validate(dict(symbols=symbols, images=[guess.tolist()], mode='optimize',
            optimizer='bfgs', fmax=1e-5, maxMove=.03, maxSteps=300), 'tblite')
        minimum = b.ase_optimize(minimum_input, calculator)
        if not minimum['converged']:
            raise RuntimeError('Common NH3 endpoint did not converge.')
        left = np.array(minimum['images'][0])
        left -= np.mean(left, axis=0)
        right = left.copy()
        right[:, 2] *= -1
        left_energy = calculator(0, left)[0]
        right_energy = calculator(0, right)[0]
        endpoint_vibration = b.vibration_analysis({**data, 'images':[left.tolist()]}, calculator, directory)
        endpoint_quanta, _, _ = b.projected_vibrational_quanta(endpoint_vibration)
        if np.any(endpoint_quanta <= 0):
            raise RuntimeError('Independent NH3 endpoint is not a verified molecular minimum.')
    t = np.linspace(0., 1., nodes)
    images = left[None]*(1-t[:, None, None])+right[None]*t[:, None, None]
    return dict(name='ammonia-inversion-gfn2xtb', kind='native-molecule', initialization=0,
        symbols=symbols, multiplicity=1, images=images.tolist(), potential=None,
        referenceTS=ts.tolist(), referenceTSEnergy=float(ts_energy), reference=dict(
            type='independent-planar-stationary-point', bondLengthAngstrom=float(optimum.x),
            physicalFmax=b.force_max(ts_force), significantImaginaryCount=1,
            imaginaryFrequencyCM=max(f for f, imag in zip(vibration['frequenciesCM'], vibration['imaginary']) if imag),
            endpointEnergiesEV=[float(left_energy), float(right_energy)],
            endpointProjectedImaginaryCount=0,
            initialNearestTSDistanceAngstrom=min(b.force_max(p-ts) for p in images),
            preparationExcludedFromPathCost=True, nativeAccuracy=.01))


def benchmark(case, method, args):
    mode, optimizer = METHODS[method]
    inputs = dict(symbols=case['symbols'], multiplicity=case['multiplicity'], images=case['images'],
        mode=mode, optimizer=optimizer, maxSteps=args.max_steps, fmax=args.fmax,
        maxMove=args.max_move, spring=args.spring, climbAfter=args.climb_after)
    if mode == 'lup':
        inputs['lup'] = dict(redistributeEvery=args.redistribute_every, redistributionTolerance=args.redistribution_tolerance)
    data = b.validate(inputs, 'tblite')
    calls = 0
    with tempfile.TemporaryDirectory(prefix='lup-benchmark-') as directory:
        # Same tight SCF accuracy for every native method; mode influences only
        # accuracy in TBLiteEngine, while the actual optimizer receives data above.
        calculator = case['potential'] or b.TBLiteEngine({**data, 'mode':'ts'}, {'method':'GFN2-xTB'}, directory)

        def counted(index, positions):
            nonlocal calls
            calls += 1
            return calculator(index, positions)

        begin = time.perf_counter()
        try:
            result = b.relax(data, counted)
        except Exception as error:
            return dict(case=case['name'], initialization=case['initialization'], method=method,
                        converged=False, reason='error', error=str(error), evaluations=calls,
                        elapsedSeconds=time.perf_counter()-begin)
        elapsed = time.perf_counter()-begin
    positions = np.asarray(result['images'])
    energies = np.asarray(result['energies'])
    peak = int(np.argmax(energies[1:-1]))+1
    barrier = float(energies[peak]-energies[0])
    reference = case['referenceTSEnergy']-float(energies[0])
    endpoint_exact = np.array_equal(positions[[0, -1]], np.array(case['images'])[[0, -1]])
    if not endpoint_exact:
        raise AssertionError('A benchmark method changed a fixed endpoint.')
    if result['evaluations'] != calls:
        raise AssertionError(f'Force count mismatch: result={result["evaluations"]}, actual={calls}')
    initial_energies = [case['potential'](i, np.array(p))[0] for i, p in enumerate(case['images'])] if case['potential'] else None
    return dict(case=case['name'], kind=case['kind'], initialization=case['initialization'], method=method,
        converged=bool(result['converged']), reason=result['reason'], steps=result['steps'], evaluations=calls,
        elapsedSeconds=elapsed, effectiveFmax=result['effectiveFmax'], peakPhysicalFmax=b.force_max(np.array(result['forces'][peak])),
        peakIndex=peak, climbingImage=result.get('climbingImage'), barrierEV=barrier, referenceBarrierEV=reference,
        signedBarrierErrorEV=barrier-reference, absoluteBarrierErrorEV=abs(barrier-reference),
        peakDistanceToReferenceTSAngstrom=b.force_max(positions[peak]-case['referenceTS']),
        endpointExact=endpoint_exact, initialPeakIndex=int(np.argmax(initial_energies[1:-1]))+1 if initial_energies else None,
        redistributionResidual=result.get('diagnostics', {}).get('redistributionResidual'),
        pathDiagnostics=result.get('diagnostics', {}))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--modes', default=','.join(METHODS), help='Comma-separated '+','.join(METHODS))
    parser.add_argument('--native', action='store_true', help='Also run tblite NH3 inversion with independent TS/reference checks')
    parser.add_argument('--nodes', type=int, default=10)
    parser.add_argument('--initializations', type=int, default=1)
    parser.add_argument('--max-steps', type=int, default=1000)
    parser.add_argument('--fmax', type=float, default=.001)
    parser.add_argument('--max-move', type=float, default=.03)
    parser.add_argument('--spring', type=float, default=1.)
    parser.add_argument('--climb-after', type=int, default=5)
    parser.add_argument('--redistribute-every', type=int, default=5)
    parser.add_argument('--redistribution-tolerance', type=float, default=.001)
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    methods = args.modes.split(',')
    if args.nodes < 4 or args.nodes > 100 or args.initializations < 1 or args.initializations > 4:
        parser.error('nodes must be 4..100 and initializations 1..4')
    if any(method not in METHODS for method in methods):
        parser.error('Unknown mode name')
    if any(METHODS[method][0] not in b.MODES for method in methods):
        parser.error('This bridge does not yet implement every requested mode.')
    potentials = [CurvedWell('curved-soft', .5, 2., 0.), CurvedWell('curved-stiff', .35, 30., 0.),
                  CurvedWell('asymmetric-curved', .3, 6., .7), CurvedWell('straight-stiff', 0., 80., .5)]
    cases = []
    for potential in potentials:
        potential.check_gradient()
        cases.extend(potential.case(args.nodes, index) for index in range(args.initializations))
    if args.native:
        cases.append(ammonia_case(args.nodes))
    rows = []
    print('case / initialization / method | converged | evaluations | steps | barrier error (eV) | peak force (eV/Å)', flush=True)
    for case in cases:
        for method in methods:
            row = benchmark(case, method, args)
            rows.append(row)
            print(f'{case["name"]} / {case["initialization"]} / {method} | {row["converged"]} | {row["evaluations"]} | '
                  f'{row.get("steps", "-")} | {row.get("absoluteBarrierErrorEV", math.nan):.7g} | '
                  f'{row.get("peakPhysicalFmax", math.nan):.7g}', flush=True)
            if row.get('error'):
                print('  error:', row['error'], flush=True)
    report = dict(schema='molecule-path-benchmark/1', settings={key:(str(value) if isinstance(value, Path) else value) for key, value in vars(args).items()},
        versions={key:importlib.metadata.version(key) for key in ('numpy', 'ase', 'psutil')},
        sourceSHA256={'bridge':hashlib.sha256(Path(b.__file__).read_bytes()).hexdigest(),
                      'benchmark':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},
        cases=[{key:value for key, value in case.items() if key not in ('potential', 'images')} for case in cases], results=rows,
        notes=[
            'Projection-only convergence is not TS convergence. It has no climbing image or redistribution.',
            'Ratios of evaluations are meaningful only with comparable convergence and barrier accuracy. Do not include two failed runs in speedup aggregates.',
            'Small-system elapsed times include Python overhead and are not representative GPU/DFT speedups.',
            'Native endpoint/TS preparation and Hessian verification are excluded from path costs.',
            'This is not a comparison with the proprietary GRRM LUP implementation.',
        ])
    if args.native:
        report['versions']['tblite'] = importlib.metadata.version('tblite')
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)+'\n')
        print('JSON:', args.json)
    return 0 if all(not row.get('error') for row in rows) else 1


if __name__ == '__main__':
    raise SystemExit(main())
