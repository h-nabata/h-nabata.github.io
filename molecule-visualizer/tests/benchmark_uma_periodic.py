"""Exercise bulk Si and O/Cu(111) through the normal UMA job queue.

Install fairchem-core in the bridge environment and enable access to facebook/UMA,
or pass the official small checkpoint via --checkpoint. No weights are bundled.

    python molecule-visualizer/tests/benchmark_uma_periodic.py --model uma-s-1p2p1
    python molecule-visualizer/tests/benchmark_uma_periodic.py --model uma-s-1p2 \
        --checkpoint /path/to/uma-s-1p2.pt --json results.json
"""
import argparse
import hashlib
import json
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from ase import units
from ase.build import add_adsorbate, bulk, fcc111
from ase.geometry import find_mic

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'local-engine'))
import bridge


# Official model card: https://huggingface.co/facebook/UMA#model-checkpoints
SMALL_CHECKSUMS = {
    'uma-s-1p1': '36a2f071350be0ee4c15e7ebdd16dde1',
    'uma-s-1p2': '26ac47f57e7d68af9f031077cdc2cbe9',
    'uma-s-1p2p1': '3497615fd30a24c5b35cd3b41a682e6e',
}


def geometry(atoms, task):
    return dict(symbols=atoms.get_chemical_symbols(), atomIds=[f'a{i}' for i in range(len(atoms))],
                images=[atoms.positions.tolist()], cell=dict(vectors=atoms.cell.tolist(), pbc=atoms.pbc.tolist()),
                charge=0, multiplicity=1, umaTask=task)


def submit(jobs, request):
    validated = bridge.validate(request, 'uma')
    record = jobs.start(validated)
    while record['status'] not in jobs.TERMINAL:
        time.sleep(.25)
        record = jobs.get(record['id'])
    if record['status'] != 'completed':
        raise RuntimeError(f"{request['umaTask']} {request['mode']}: {record.get('error', record['status'])}")
    result = record['result']
    if result['provenance']['uma']['task'] != request['umaTask'] or result['cell'] != request['cell']:
        raise ValueError('The returned UMA task or periodic cell differs from the submission.')
    for key in ('energies', 'forces', 'images'):
        if not np.isfinite(result[key]).all():
            raise ValueError(f'Nonfinite {key} for {request["umaTask"]} {request["mode"]}')
    return result


def check_bulk(jobs):
    silicon = bulk('Si', 'diamond', a=5.45, cubic=True)
    silicon.positions[0] += [.12, -.05, .08]
    structure = geometry(silicon, 'omat')
    reference = silicon.positions.copy()
    translated = reference.copy()
    translated[0] += silicon.cell[0]
    step = .01
    minus, plus = reference.copy(), reference.copy()
    minus[0, 0] -= step
    plus[0, 0] += step
    single = submit(jobs, dict(structure, mode='evaluate', images=[xyz.tolist() for xyz in (reference, translated, minus, plus)]))
    energies = np.asarray(single['energies'])
    forces = np.asarray(single['forces'])
    np.testing.assert_allclose(energies[0], energies[1], atol=.002, rtol=0)
    np.testing.assert_allclose(forces[0], forces[1], atol=.010, rtol=0)
    gradient_error = abs(forces[0, 0, 0] + (energies[3]-energies[2]) / (2*step))
    if gradient_error > .06:
        raise AssertionError(f'Force/energy derivative mismatch: {gradient_error} eV/Å')
    # With zero initial velocities, the initial MD pressure is minus the hydrostatic stress.
    options = dict(ensemble='nve', timestepFs=.25, sampleEvery=1, recordPressure=True, removeCOM=False,
                   initialVelocitiesAngstromPerFs=np.zeros_like(reference).tolist())
    dynamics = submit(jobs, dict(structure, mode='md', maxSteps=2, md=options))
    pressures = dynamics['trajectory']['pressureBar']
    if len(pressures) != 3 or not np.isfinite(pressures).all():
        raise ValueError('Missing finite OMat stress in the bulk MD trajectory.')
    energies_strained, volumes = [], []
    for scale in (.999, 1.001):
        strained = silicon.copy()
        strained.set_cell(silicon.cell * scale, scale_atoms=True)
        strained_result = submit(jobs, dict(geometry(strained, 'omat'), mode='evaluate'))
        energies_strained.append(strained_result['energies'][0])
        volumes.append(strained.get_volume())
    pressure_from_energy = -(energies_strained[1] - energies_strained[0]) / (volumes[1] - volumes[0])
    pressure_from_stress = pressures[0] * units.bar
    if abs(pressure_from_stress - pressure_from_energy) > .002:
        raise AssertionError(f'OMat pressure {pressure_from_stress} differs from −dE/dV {pressure_from_energy} eV/Å³.')
    minimum = submit(jobs, dict(structure, mode='optimize', optimizer='lbfgs', fmax=.05, maxMove=.04, maxSteps=80))
    if not minimum['converged'] or minimum['energies'][0] >= energies[0]:
        raise AssertionError(f"Distorted Si failed to relax: {minimum['reason']}")
    return dict(model=single['provenance']['uma'], n_atoms=len(silicon), initial_energy_eV=energies[0],
                wrap_difference_eV=abs(energies[1]-energies[0]), force_error_eV_A=gradient_error,
                initial_pressure_bar=pressures[0], pressure_finite_difference_eV_A3=pressure_from_energy,
                relaxed_energy_eV=minimum['energies'][0], final_fmax_eV_A=minimum['effectiveFmax'], steps=minimum['steps'])


def check_surface(jobs, band_steps):
    scaffold = fcc111('Cu', size=(2, 2, 3), a=3.62, vacuum=8., orthogonal=True)
    fixed = np.flatnonzero(scaffold.get_tags() > 1).tolist()
    slab = scaffold.copy()
    add_adsorbate(slab, 'O', 1.55, 'fcc')
    end = scaffold.copy()
    add_adsorbate(end, 'O', 1.55, 'hcp')
    structure = geometry(slab, 'oc20')
    # Check that a translation of the adsorbate by an in-plane lattice vector is invisible.
    shifted = slab.positions.copy()
    shifted[-1] += slab.cell[1]
    outside = slab.positions.copy()
    outside[-1] += slab.cell[2]
    pair = submit(jobs, dict(structure, mode='evaluate', images=[slab.positions.tolist(), shifted.tolist(), outside.tolist()]))
    np.testing.assert_allclose(pair['energies'][0], pair['energies'][1], atol=.002, rtol=0)
    np.testing.assert_allclose(pair['forces'][0], pair['forces'][1], atol=.01, rtol=0)
    # Diagnostic only: removing O from its local environment must change the prediction.
    if abs(pair['energies'][2]-pair['energies'][0]) < .001 and np.max(np.abs(
            np.asarray(pair['forces'][2])-pair['forces'][0])) < .01:
        raise AssertionError('Translating O along the nonperiodic axis left energy and all forces unchanged.')
    minimum = submit(jobs, dict(structure, mode='optimize', fixedAtoms=fixed, optimizer='lbfgs',
                                fmax=.05, maxMove=.04, maxSteps=120))
    if not minimum['converged']:
        raise AssertionError(f"Fixed-layer O/Cu(111) MIN did not converge: {minimum['reason']}")
    np.testing.assert_array_equal(np.asarray(minimum['images'][0])[fixed], slab.positions[fixed])
    initial = np.linspace(slab.positions, end.positions, 5)
    band = submit(jobs, dict(structure, mode='cineb', images=initial.tolist(),
                             fixedAtoms=fixed, endpointMode='relax', optimizer='fire', maxMove=.03,
                             fmax=.05, maxSteps=band_steps, climbAfter=min(10, band_steps-1)))
    final = np.asarray(band['images'])
    np.testing.assert_array_equal(final[:, fixed], initial[:, fixed])
    if band['reason'] not in ('step_limit', 'converged'):
        raise AssertionError(f"CI-NEB stopped unexpectedly: {band['reason']}")
    _, site_separation = find_mic(final[-1, -1]-final[0, -1], slab.cell, slab.pbc)
    climbing = band['climbingImage']
    mobile = [i for i in range(len(slab)) if i not in fixed]
    peak_force = np.linalg.norm(np.asarray(band['forces'])[climbing, mobile], axis=-1).max() if climbing is not None else None
    if band['converged']:
        if site_separation < .5 or climbing != 1+int(np.argmax(band['energies'][1:-1])):
            raise AssertionError('The endpoints collapsed or the climbing image is not the internal energy maximum.')
        if peak_force > .05 or band['energies'][climbing] <= max(band['energies'][0], band['energies'][-1]):
            raise AssertionError('The climbing image requires a stationary peak above both endpoints.')
    return dict(model=band['provenance']['uma'], n_atoms=len(slab), fixed_layers=2, fixed_atoms=len(fixed),
                pbc=slab.pbc.tolist(), surface_min_energy_change_eV=minimum['energies'][0]-pair['energies'][0],
                adsorption_geometry_fmax_eV_A=minimum['effectiveFmax'],
                adsorption_geometry_steps=minimum['steps'], band_steps=band['steps'], band_reason=band['reason'],
                band_energies_eV=band['energies'], band_effective_fmax_eV_A=band['effectiveFmax'],
                endpoint_O_separation_A=site_separation, peak_mobile_fmax_eV_A=peak_force,
                converged_barrier_eV=max(band['energies']) - band['energies'][0] if band['converged'] else None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', choices=list(SMALL_CHECKSUMS), default='uma-s-1p2p1')
    parser.add_argument('--checkpoint', type=Path, help='Trusted official .pt file corresponding to --model.')
    parser.add_argument('--device', default='cpu')
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--band-steps', type=int, default=200, help='Maximum CI-NEB steps. A step-limit result exits nonzero.')
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    if not 1 <= args.band_steps <= 10000:
        parser.error('--band-steps must be between 1 and 10000.')
    device = bridge.device_name(args.device)
    config = dict(engine='uma', method='UMA', umaModel=args.model, umaDevice=device,
                  umaPrecision='float32', threads=args.threads, workers=1,
                  residentModels=True, jobTimeout=7200, evaluationTimeout=600)
    if args.checkpoint:
        with args.checkpoint.open('rb') as stream:
            if hashlib.file_digest(stream, 'md5').hexdigest() != SMALL_CHECKSUMS[args.model]:
                parser.error('Checkpoint bytes disagree with the official checksum for the selected UMA-small model.')
            stream.seek(0)
            config['umaCheckpointSHA256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
        config['umaCheckpoint'] = str(args.checkpoint.resolve())
    torch, *_ = bridge.uma_packages(config)
    config['devices'], config['cudaMasks'] = bridge.device_inventory(torch)
    if device not in {entry['id'] for entry in config['devices']}:
        parser.error(f'Unavailable device: {device}')
    with tempfile.TemporaryDirectory() as scratch:
        jobs = bridge.Jobs(dict(config, historyDir=scratch))
        try:
            report = dict(bridge_version=bridge.VERSION, bulk=check_bulk(jobs), surface=check_surface(jobs, args.band_steps))
        finally:
            jobs.close()
    output = json.dumps(report, indent=2, allow_nan=False)
    if args.json:
        args.json.write_text(output + '\n', encoding='utf-8')
    print(output)
    if report['surface']['band_reason'] != 'converged':
        raise SystemExit('The surface CI-NEB band did not converge within its step budget.')


if __name__ == '__main__':
    main()
