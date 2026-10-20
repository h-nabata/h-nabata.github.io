"""Public analytic IRC and mass-projected molecular thermochemistry checks."""
import copy
import importlib.util
import math
import os
from pathlib import Path
import sys
import tempfile
import unittest

os.environ['OMP_NUM_THREADS'] = os.environ['OPENBLAS_NUM_THREADS'] = '1'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'local-engine'))
import bridge as b
import numpy as np
from ase import Atoms
from ase.units import invcm, kB, _k, _Nav


def saddle(index, positions):
    vector = positions[1]-positions[0]
    distance = np.linalg.norm(vector)
    offset = distance-1
    gradient = (4*offset**3-2*offset)*vector/distance
    return offset**4-offset**2, np.array([gradient, -gradient])


def irc_input(**options):
    data = b.validate(dict(symbols=['H', 'H'], images=[[[0, 0, 0], [1, 0, 0]]],
                           mode='evaluate', fmax=.01, maxSteps=30), 'tblite')
    data['mode'] = 'irc'
    b.validate_irc_settings({'irc':options}, data)
    return data


def molecular_modes(quanta=(.01, .02, .03), rigid_quanta=0.):
    """Known mass-normalized modes with clean rigid/vibrational subspaces."""
    atoms = Atoms('OH2', positions=[[0, 0, 0], [.96, 0, 0], [-.24, .93, 0]])
    masses, positions = atoms.get_masses(), atoms.positions
    root = np.sqrt(masses)
    center = positions-np.average(positions, axis=0, weights=masses)
    rigid = []
    for axis in np.eye(3):
        rigid.extend([(root[:, None]*axis).ravel(), (root[:, None]*np.cross(axis, center)).ravel()])
    vectors = np.linalg.svd(np.array(rigid).T, full_matrices=True)[0]
    energies = np.array([rigid_quanta]*6+list(quanta))
    modes = (vectors.T/np.repeat(root, 3)).reshape(9, 3, 3)
    vibration = dict(status='completed', positions=positions.tolist(), masses=masses.tolist(),
                     modes=modes.tolist(), quantaMEV=(np.abs(energies)*1000).tolist(),
                     imaginary=(energies < 0).tolist(), settings={'imaginaryThreshold':20})
    data = b.validate(dict(symbols=list(atoms.symbols), images=[positions.tolist()], mode='vibrations',
                           vibrations={'delta':.001}), 'tblite')
    b.validate_thermochemistry_settings({'thermochemistry':{}}, data)
    result = dict(images=data['images'], energies=[-10.], effectiveFmax=0., vibrations=vibration)
    return data, result


class IRCAndThermochemistry(unittest.TestCase):
    def test_strict_settings_and_incompatible_conditions(self):
        data = irc_input()
        self.assertEqual(data['irc']['direction'], 'both')
        for options in ({'direction':'sideways'}, {'stepSize':0}, {'stepSize':True},
                        {'relaxEndpoints':1}, {'command':'anything'}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                irc_input(**options)
        for key, value in (('fixedAtoms', [0]), ('constraints', [{}]),
                           ('internalConstraints', [{}]), ('cell', {'pbc':[True, False, False]})):
            invalid = copy.deepcopy(data)
            invalid[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                b.validate_irc_settings(invalid, invalid)
        thermo, _ = molecular_modes()
        for options in ({'temperature':0}, {'pressure':-1}, {'symmetryNumber':1.2},
                        {'state':'unknown'}, {'lowFrequency':'discard'}, {'standardState':'automatic'}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                b.validate_thermochemistry_settings({'thermochemistry':options}, thermo)

    @unittest.skipUnless(importlib.util.find_spec('sella'), 'optional Sella not installed')
    def test_real_sella_irc_connects_both_minima_and_preserves_ts_once(self):
        data = irc_input()
        events = []
        with tempfile.TemporaryDirectory() as directory:
            result = b.irc_calculation(data, saddle, directory, events.append)
        self.assertTrue(result['converged'])
        self.assertEqual(result['images'][result['tsIndex']], data['images'][0])
        self.assertEqual(sum(p == data['images'][0] for p in result['images']), 1)
        distances = [np.linalg.norm(np.array(p)[1]-p[0]) for p in (result['images'][0], result['images'][-1])]
        np.testing.assert_allclose(sorted(distances), [1-1/math.sqrt(2), 1+1/math.sqrt(2)], atol=.003)
        for p, e, f in zip(result['images'], result['energies'], result['forces']):
            expected_e, expected_f = saddle(0, np.array(p))
            self.assertAlmostEqual(expected_e, e)
            np.testing.assert_allclose(expected_f, f)
        self.assertGreater(result['evaluations'], len(result['images']))
        self.assertTrue(all(branch['endpointConverged'] for branch in result['branches'].values()))
        self.assertTrue(all(not branch['endpointVerifiedMinimum'] for branch in result['branches'].values()))
        self.assertTrue(any('structureCheckpoint' in event for event in events))
        self.assertTrue(all(row['diagnostics']['physicalFmax'] == row['fmax'] for row in result['history']))
        self.assertTrue(all(row['diagnostics']['rmsForce'] <= row['fmax']+1e-12 for row in result['history']))
        self.assertEqual(result['diagnostics']['forceMeaning'], 'physical-force-not-irc-update')
        self.assertEqual(set(result['forceComponents']), {'physical'})

    @unittest.skipUnless(importlib.util.find_spec('sella'), 'optional Sella not installed')
    def test_irc_rejects_nonstationary_and_stationary_minimum(self):
        data = irc_input(direction='forward')
        with tempfile.TemporaryDirectory() as directory:
            shifted = copy.deepcopy(data)
            shifted['images'][0][1][0] = 1.1
            with self.assertRaisesRegex(ValueError, '収束閾値'):
                b.irc_calculation(shifted, saddle, directory)
            target = np.array(data['images'][0])
            def minimum(i, p):
                return float(np.sum((p-target)**2)), -2*(p-target)
            with self.assertRaisesRegex(ValueError, '負曲率'):
                b.irc_calculation(data, minimum, directory)

    def test_projection_removes_rigid_motion_without_discarding_soft_vibration(self):
        data, result = molecular_modes((.0001, .02, .03), rigid_quanta=.2)
        quanta, geometry, count = b.projected_vibrational_quanta(result['vibrations'])
        np.testing.assert_allclose(quanta, [.0001, .02, .03], atol=1e-12)
        self.assertEqual((geometry, count), ('nonlinear', 6))
        thermo = b.thermochemistry_analysis(data, result)
        self.assertEqual(thermo['retainedVibrations'], 3)
        self.assertAlmostEqual(thermo['zpeEV'], .02505)
        self.assertAlmostEqual(thermo['gibbsEV'], thermo['enthalpyEV']-thermo['temperature']*thermo['entropyEVPerK'])

    def test_entropy_floor_and_standard_state_are_explicit_and_consistent(self):
        data, result = molecular_modes((.0001, .02, .03))
        raw = b.thermochemistry_analysis(data, result)
        data['thermochemistry']['lowFrequency'] = 'floor'
        floor = b.thermochemistry_analysis(data, result)
        self.assertAlmostEqual(floor['zpeEV'], raw['zpeEV'])
        self.assertAlmostEqual(floor['enthalpyEV'], raw['enthalpyEV'])
        self.assertLess(floor['entropyEVPerK'], raw['entropyEVPerK'])
        data['thermochemistry']['standardState'] = '1M'
        solution = b.thermochemistry_analysis(data, result)
        temperature, pressure = floor['temperature'], floor['pressure']
        expected = kB*temperature*math.log(1000*_Nav*_k*temperature/pressure)
        self.assertAlmostEqual(solution['gibbsEV']-floor['gibbsEV'], expected)
        self.assertAlmostEqual(solution['standardStateCorrectionEV'], expected)

    def test_ts_has_exactly_one_physical_imaginary_mode_and_stationary_gate(self):
        data, result = molecular_modes((-.03, .02, .04))
        with self.assertRaisesRegex(ValueError, '虚振動'):
            b.thermochemistry_analysis(data, result)
        data['thermochemistry']['state'] = 'ts'
        thermo = b.thermochemistry_analysis(data, result)
        self.assertEqual(thermo['retainedVibrations'], 2)
        self.assertEqual(thermo['imaginaryModesRemoved'], 1)
        self.assertAlmostEqual(thermo['zpeEV'], .03)
        result['effectiveFmax'] = .5
        with self.assertRaisesRegex(ValueError, '未収束'):
            b.thermochemistry_analysis(data, result)
        data2, result2 = molecular_modes((-.03, -.02, .04))
        data2['thermochemistry']['state'] = 'ts'
        with self.assertRaisesRegex(ValueError, '虚振動'):
            b.thermochemistry_analysis(data2, result2)

    def test_linear_molecule_real_finite_difference_modes(self):
        data = b.validate(dict(symbols=['H', 'H'], images=[[[0, 0, 0], [1, 0, 0]]], mode='vibrations',
                               vibrations={'delta':.001, 'nfree':4}), 'tblite')
        b.validate_thermochemistry_settings({'thermochemistry':{'state':'ts', 'symmetryNumber':2}}, data)
        with tempfile.TemporaryDirectory() as directory:
            vibration = b.vibration_analysis(data, saddle, directory)
        result = dict(images=data['images'], energies=[0.], effectiveFmax=0., vibrations=vibration)
        thermo = b.thermochemistry_analysis(data, result)
        self.assertEqual((thermo['geometry'], thermo['removedRigidMotions'], thermo['retainedVibrations']), ('linear', 5, 0))
        self.assertTrue(math.isfinite(thermo['gibbsEV']))

    def test_dispatch_preserves_structure_and_vibration_if_thermochemistry_fails(self):
        data = b.validate(dict(symbols=['H', 'H'], images=[[[0, 0, 0], [1, 0, 0]]], mode='vibrations',
                               vibrations={'delta':.001, 'nfree':4}, thermochemistry={'state':'minimum'}), 'tblite')
        with tempfile.TemporaryDirectory() as directory:
            result = b.calculate_job(data, saddle, directory)
        self.assertEqual(result['images'], data['images'])
        self.assertEqual(result['vibrations']['status'], 'completed')
        self.assertEqual(result['thermochemistry']['status'], 'failed')
        self.assertIn('虚振動', result['thermochemistry']['error'])

    @unittest.skipUnless(importlib.util.find_spec('tblite'), 'optional native tblite not installed')
    def test_native_tblite_minimum_vibrations_and_thermochemistry(self):
        for symbols, positions, count in [(['H', 'H'], [[0, 0, 0], [.8, 0, 0]], 1),
                (['O', 'H', 'H'], [[0, 0, 0], [.96, 0, 0], [-.24, .93, 0]], 3)]:
            with self.subTest(symbols=symbols):
                data = b.validate(dict(symbols=symbols, images=[positions], mode='optimize', optimizer='bfgs',
                    fmax=.0001, maxSteps=150, vibrations={'delta':.001, 'nfree':4},
                    thermochemistry={'symmetryNumber':2}), 'tblite')
                with tempfile.TemporaryDirectory() as directory:
                    calculator = b.TBLiteEngine(data, {'method':'GFN2-xTB'}, directory)
                    result = b.calculate_job(data, calculator, directory)
                self.assertTrue(result['converged'])
                self.assertEqual(result['vibrations']['status'], 'completed')
                thermo = result['thermochemistry']
                self.assertEqual(thermo['status'], 'completed')
                self.assertEqual(thermo['retainedVibrations'], count)
                self.assertTrue(all(value > 100 for value in thermo['frequenciesCM']))
                self.assertGreater(thermo['zpeEV'], 0)
                self.assertGreater(thermo['entropyEVPerK'], 0)
                self.assertEqual(thermo['electronicEnergyEV'], result['energies'][0])


if __name__ == '__main__':
    unittest.main()
