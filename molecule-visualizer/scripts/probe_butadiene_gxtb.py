"""Measure geometry and SCF-root continuity on two nearby Cs geometries of C4H6.

Run with GXTB_TEST_BINARY=/absolute/path/to/xtb and OMP_NUM_THREADS=1.
The second pair of calculations seeds each geometry with the other one's
wavefunction. This diagnostic does not change how the application runs jobs.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from ase.io import read

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'local-engine'))
from bridge import parse_gradient, path_work_discrepancy


def evaluate(binary, frame, directory, seed=None):
    directory.mkdir()
    symbols = frame.get_chemical_symbols()
    with (directory / 'input.xyz').open('w') as file:
        file.write(f'{len(frame)}\nMolecule Studio\n')
        for symbol, (x, y, z) in zip(symbols, frame.positions):
            file.write(f'{symbol} {x:.12f} {y:.12f} {z:.12f}\n')
    if seed:
        shutil.copyfile(seed / 'xtbrestart', directory / 'xtbrestart')
    # Match the native bridge command, using a separate directory for each call.
    command = [str(binary), 'input.xyz', '--gxtb', '--grad', '--chrg', '0']
    result = subprocess.run(command, cwd=directory, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            stdin=subprocess.DEVNULL, timeout=120, encoding='utf-8', errors='replace')
    if result.returncode or re.search(r'failed\s+to\s+converge|not\s+converged|abnormal\s+termination',
                                     result.stdout, re.I):
        raise RuntimeError(result.stdout[-2000:])
    if seed and 'Wavefunction read from restart file' not in result.stdout:
        raise RuntimeError('g-xTB did not report reading the supplied xtbrestart.')
    return parse_gradient((directory / 'gradient').read_text(), symbols, frame.positions)


def main():
    configured = os.environ.get('GXTB_TEST_BINARY')
    if not configured:
        sys.exit('Set GXTB_TEST_BINARY to the g-xTB-enabled xtb executable.')
    binary = Path(configured).resolve()
    frames = read(ROOT / 'tests' / 'fixtures' / 'butadiene-gxtb-scf-probe.xyz', index=':')
    displacement = frames[1].positions - frames[0].positions
    directions = displacement / np.linalg.norm(displacement)
    with tempfile.TemporaryDirectory() as work:
        work = Path(work)
        fresh_dirs = [work / 'fresh-a', work / 'fresh-b']
        fresh = [evaluate(binary, frame, directory) for frame, directory in zip(frames, fresh_dirs)]
        seeded = [evaluate(binary, frame, work / f'seeded-{i}', fresh_dirs[1-i])
                  for i, frame in enumerate(frames)]
    digest = hashlib.sha256()
    with binary.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(chunk)
    delta = fresh[1][0] - fresh[0][0]
    print(json.dumps({
        'binarySHA256': digest.hexdigest(),
        'maxAtomDisplacementA': float(np.max(np.linalg.norm(displacement, axis=1))),
        'freshEnergyEV': [energy for energy, _ in fresh],
        'freshEnergyDifferenceEV': delta,
        'freshSlopeEVPerA': [-float(np.sum(force * directions)) for _, force in fresh],
        'pathConsistencyWarning': path_work_discrepancy(displacement, delta, fresh[0][1],
                                                        fresh[1][1], 'probe', 1),
        'crossSeededEnergyEV': [energy for energy, _ in seeded],
    }, indent=2))


if __name__ == '__main__':
    main()
