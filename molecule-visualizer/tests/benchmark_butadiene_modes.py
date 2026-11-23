"""Check the unrestricted vibrational modes of a saved butadiene benchmark peak.

For each frequency below −20 cm⁻¹ report the two signed terminal-angle slopes
(°/Å), with the largest atom displacement normalized to 1 Å and the left
slope chosen positive if appreciable. Their signs describe the local motion,
not the endpoints reached by the path. Nearly degenerate modes can mix.
"""
import argparse
import json
import os
from pathlib import Path
import tempfile

import numpy as np
from ase import Atoms, units
from scipy.linalg import null_space

from benchmark_butadiene import MIRROR, bridge, terminal_angles


def terminal_angular_response(positions, mode):
    """Terminal angle derivatives per Å of largest Cartesian atom displacement."""
    direction = mode / bridge.force_max(mode)
    half_width = .001
    left = np.asarray(terminal_angles(positions - half_width*direction))
    right = np.asarray(terminal_angles(positions + half_width*direction))
    # Wrapping the difference also works when a labelled H crosses ±180°.
    slopes = ((right - left + 180.) % 360. - 180.) / (2.*half_width)
    # Eigenvector sign is arbitrary. Fix the phase for reproducible presentation.
    reference = slopes[0] if abs(slopes[0]) > 1e-8*max(abs(slopes)) else slopes[1]
    if reference < 0:
        slopes *= -1
    return slopes


def peak_modes(row, delta):
    """Use fresh electronic states for both sides of every Cartesian difference."""
    positions = np.array(row['peakCoordinatesA'], dtype=float)
    atoms = Atoms('C4H6', positions=positions)
    data = dict(symbols=atoms.get_chemical_symbols(), cell=None, charge=0, multiplicity=1, mode='ts')
    with tempfile.TemporaryDirectory() as directory:
        if row['engine'] == 'gxtb':
            binary = os.environ.get('GXTB_TEST_BINARY')
            if not binary:
                raise ValueError('Set GXTB_TEST_BINARY to the g-xTB executable')
            calculate = bridge.GXTBEngine(data, dict(binary=str(Path(binary).resolve()), evaluationTimeout=120), directory)
        else:
            def calculate(index, geometry):
                return bridge.TBLiteEngine(data, dict(method='GFN2-xTB'), directory)(index, geometry)

        energy, force = calculate(0, positions)
        differences = []
        energy_gradient = []
        for direction in np.eye(positions.size).reshape(-1, *positions.shape):
            energy_hi, force_hi = calculate(0, positions + delta*direction)
            energy_lo, force_lo = calculate(0, positions - delta*direction)
            differences.append((force_lo - force_hi).ravel() / (2*delta))
            energy_gradient.append((energy_hi - energy_lo) / (2*delta))

    hessian = np.array(differences).T
    masses = atoms.get_masses()
    root_mass = np.repeat(np.sqrt(masses), 3)
    centered = positions - np.average(positions, axis=0, weights=masses)
    rigid = [np.tile(axis, len(atoms))*root_mass for axis in np.eye(3)]
    rigid += [np.cross(axis, centered).ravel()*root_mass for axis in np.eye(3)]
    internal = null_space(rigid)
    dynamical = (hessian + hessian.T) / (2*np.outer(root_mass, root_mass))
    values, vectors = np.linalg.eigh(internal.T @ dynamical @ internal)
    to_wavenumber = units._hbar * 1e10 / np.sqrt(units._e * units._amu) / units.invcm
    frequencies = np.sign(values)*np.sqrt(np.abs(values))*to_wavenumber

    mass_modes = (internal @ vectors).T.reshape(-1, len(atoms), 3)
    # An individual eigenvector can mix with neighbours at (near) degeneracy.
    # Opposite/same derivatives measure only the local response of each end.
    angular_response = []
    for i in np.flatnonzero(frequencies < -20):
        cartesian = mass_modes[i] / np.sqrt(masses)[:, None]
        slopes = terminal_angular_response(positions, cartesian)
        angular_response.append(dict(frequencyCM=float(frequencies[i]),
                                     terminalSlopesDegPerA=slopes.tolist()))

    # The benchmark accepts C4H6 in the x=0 reference frame. Only a mirror-
    # symmetric peak admits a physical even/odd label in this frame.
    reflection = np.array([-1, 1, 1])
    mirror_error = bridge.force_max(positions - positions[MIRROR]*reflection)
    parity = None
    if mirror_error < 1e-6:
        parity = np.sum(mass_modes * mass_modes[:, MIRROR] * reflection, axis=(1, 2))[:3].tolist()

    return dict(engine=row['engine'], mode=row['mode'], case=row['case'], deltaA=delta,
                energyEV=energy, physicalFmaxEVPerA=bridge.force_max(force),
                forceEnergyErrorEVPerA=float(np.max(np.abs(force.ravel() + energy_gradient))),
                relativeHessianAsymmetry=float(np.linalg.norm(hessian-hessian.T)/np.linalg.norm(hessian)),
                imaginaryBelowMinus20CM=int(np.sum(frequencies < -20)),
                imaginaryModeAngularResponse=angular_response,
                lowestSignedFrequenciesCM=frequencies[:3].tolist(), lowestModeMirrorParity=parity)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, help='JSON written by benchmark_butadiene.py --json')
    parser.add_argument('--mode', choices=['neb', 'cineb', 'lup'], required=True)
    parser.add_argument('--case', choices=['free', 'mirror', 'con'], required=True)
    parser.add_argument('--delta', nargs='+', type=float, default=[.001, .002], help='Central difference half-widths in Å')
    args = parser.parse_args()
    matches = [row for row in json.loads(args.input.read_text()) if row['mode'] == args.mode and row['case'] == args.case]
    if len(matches) != 1 or not matches[0].get('peakCoordinatesA'):
        parser.error('Select one saved case and method with peak coordinates')
    if not all(np.isfinite(delta) and delta > 0 for delta in args.delta):
        parser.error('Each difference half-width must be finite and positive')
    for delta in args.delta:
        print(json.dumps(peak_modes(matches[0], delta)), flush=True)
