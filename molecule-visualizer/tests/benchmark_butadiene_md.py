"""Unrestrained NVE trajectories from the same conrotatory g-xTB saddle.

Input is the JSON written by benchmark_butadiene.py --engine gxtb --case con
--mode cineb --optimizer band-lbfgs. Opposite initial velocities are parallel
to the single imaginary mode. The trajectories are a direction/energy check,
not a thermal distribution or branching-ratio measurement.
"""
import argparse
import json
import os
from pathlib import Path
import tempfile

import numpy as np
from ase import units
from ase.data import atomic_masses, atomic_numbers

from benchmark_butadiene import bridge, terminal_angles
from benchmark_butadiene_modes import peak_modes


def pair(row, timestep_fs, steps, kinetic_ev):
    positions = np.asarray(row['peakCoordinatesA'])
    symbols = list('CCCCHHHHHH')
    masses = np.array([atomic_masses[atomic_numbers[s]] for s in symbols])[:, None]
    modes = peak_modes(row, .005, include_directions=True)
    if modes['imaginaryBelowMinus20CM'] != 1:
        raise ValueError('The positive control requires one significant imaginary mode.')
    mode = modes['imaginaryModeAngularResponse'][0]
    velocity = np.array(mode['massNormalizedCartesianMode'])
    # Set the kinetic energy in ASE units first, then convert to Å/fs.
    velocity *= units.fs * np.sqrt(2 * kinetic_ev / np.sum(masses * velocity**2))
    if (positions[3] - positions[0]) @ (velocity[3] - velocity[0]) < 0:
        velocity *= -1
    results = {}
    for direction, sign in [('opening', 1), ('closing', -1)]:
        data = bridge.validate(dict(
            mode='md', symbols=symbols, images=[positions.tolist()], maxSteps=steps,
            md=dict(ensemble='nve', timestepFs=timestep_fs, sampleEvery=1, removeCOM=False,
                    initialVelocitiesAngstromPerFs=(sign * velocity).tolist())), 'gxtb')
        with tempfile.TemporaryDirectory() as directory:
            config = dict(binary=str(Path(os.environ['GXTB_TEST_BINARY']).resolve()), evaluationTimeout=120)
            engine = bridge.GXTBEngine(data, config, directory)
            result = bridge.calculate_job(data, engine, directory)
        if result['reason'] != 'completed':
            raise RuntimeError(f"{direction} NVE trajectory stopped: {result['reason']}")
        trajectory = result['trajectory']
        coords = np.asarray(trajectory['images'])
        distances = np.linalg.norm(coords[:, 0] - coords[:, 3], axis=1)
        total = np.array(trajectory['totalEV'])
        results[direction] = dict(
            maxAbsTotalEnergyChangeEV=float(np.max(np.abs(total-total[0]))),
            frames=[dict(timeFs=t, distanceC1C4A=d, terminalAnglesDeg=terminal_angles(p),
                         potentialEV=ep, kineticEV=ek, totalEV=et)
                    for t, d, p, ep, ek, et in zip(trajectory['timeFs'], distances, coords,
                        trajectory['energies'], trajectory['kineticEV'], total)],
            initialVelocitiesAngstromPerFs=(sign * velocity).tolist(), evaluations=result['evaluations'])
    return dict(timestepFs=timestep_fs, steps=steps, initialKineticEV=kinetic_ev,
                initialPositionsA=positions.tolist(), frequencyCM=mode['frequencyCM'],
                peakFmaxEVPerA=modes['physicalFmaxEVPerA'], trajectories=results)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--timestep-fs', type=float, default=.25)
    parser.add_argument('--steps', type=int, default=160)
    parser.add_argument('--kinetic-ev', type=float, default=.10)
    args = parser.parse_args()
    rows = [r for r in json.loads(args.input.read_text()) if
            r['engine'] == 'gxtb' and r['mode'] == 'cineb' and r['case'] == 'con'
            and r['reason'] == 'converged']
    if len(rows) != 1 or not np.isfinite(args.kinetic_ev) or args.kinetic_ev <= 0:
        parser.error('Provide one converged conrotatory g-xTB CI-NEB peak and positive kinetic energy.')
    print(json.dumps(pair(rows[0], args.timestep_fs, args.steps, args.kinetic_ev), indent=2))
