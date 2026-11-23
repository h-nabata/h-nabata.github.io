"""Fixed-cell saddle, Gamma modes, and mass-weighted IRC on an analytic periodic potential."""
import importlib.util
import tempfile
import unittest

import numpy as np
from test_engine import b


LENGTH = 8.
CELL = {'vectors': [[LENGTH, 0., 0.], [1., 9., 0.], [0., 0., 18.]], 'pbc': [True]*3}
SADDLE = np.array([[1., 2., 3.], [5., 2., 3.]])


def potential(_, positions):
    d = positions[1] - positions[0]
    k = 2*np.pi/LENGTH
    # Adjacent adsorption minima are at relative x = L/4 and 3L/4, across a saddle at L/2.
    energy = .5*(1 + np.cos(2*k*d[0])) + np.dot(d[1:], d[1:]) / 2
    gradient = np.array([-k*np.sin(2*k*d[0]), d[1], d[2]])
    return float(energy), np.array([gradient, -gradient])


def input_for(mode, positions=SADDLE, **kw):
    return b.validate(dict(mode=mode, symbols=['Cl','H'], images=[positions.tolist()], cell=CELL,
                           fmax=.002, maxSteps=100, maxMove=.04, **kw), 'tblite')


class PeriodicGamma(unittest.TestCase):
    def test_projection_removes_only_translations_and_preserves_frozen_modes(self):
        from ase.data import atomic_masses, atomic_numbers
        from ase.units import invcm
        m = atomic_masses[[atomic_numbers['Cl'], atomic_numbers['H']]]
        for fixed in ([], [0]):
            expected = -2*(2*np.pi/LENGTH)**2*(1/m[1] + (0 if fixed else 1/m[0]))
            data = input_for('vibrations', fixedAtoms=fixed)
            with tempfile.TemporaryDirectory() as directory:
                result = b.calculate_job(data, potential, directory)['vibrations']
            self.assertEqual(result['status'], 'completed', result)
            self.assertEqual(result['significantImaginaryCount'], 1)
            self.assertEqual(result['projectedTranslations'], 0 if fixed else 3)
            self.assertEqual(result['evaluations'], 1+6*(2-len(fixed)))
            self.assertEqual(np.shape(result['modes']), (3, 2, 3))
            self.assertAlmostEqual(result['frequenciesCM'][0], abs(b.gamma_quanta(np.array([expected]))[0])/invcm, delta=.01)
            for mode in result['modes']:
                if fixed:
                    np.testing.assert_array_equal(mode[0], [0.]*3)
                else:
                    np.testing.assert_allclose(m @ np.array(mode), 0., atol=1.e-10)

    def test_harmonic_thermal_contribution_and_omitted_modes(self):
        from ase.units import invcm
        from ase.thermochemistry import HarmonicThermo
        settings = dict(temperatureK=300., cutoffCM=10.)
        trial = np.array([40j, 0., 2., 10., 400.]) * invcm
        ref = HarmonicThermo([400.*invcm])
        answer = b.gamma_harmonic_thermo(trial, settings)
        self.assertEqual([answer[k] for k in ('includedModes','omittedImaginary','omittedLowOrZero')], [1,1,3])
        self.assertAlmostEqual(answer['zpeEV'], 200.*invcm)
        self.assertAlmostEqual(answer['vibrationalHelmholtzEV'], ref.get_helmholtz_energy(300., verbose=False))
        self.assertAlmostEqual(answer['entropyEVPerK'], ref.get_entropy(300., verbose=False))
        empty = b.gamma_harmonic_thermo(trial[:3], settings)
        self.assertEqual((empty['vibrationalHelmholtzEV'], empty['zpeEV'], empty['entropyEVPerK']), (0.,0.,0.))
        data = input_for('vibrations', fixedAtoms=[0], vibrations={'harmonicThermo':settings})
        with tempfile.TemporaryDirectory() as directory:
            spectrum = b.calculate_job(data, potential, directory)['vibrations']
        self.assertEqual(spectrum['harmonicThermo']['omittedImaginary'], 1)
        self.assertEqual(spectrum['harmonicThermo']['includedModes'], 2)
        with self.assertRaisesRegex(ValueError, '周期セル'):
            b.validate(dict(mode='vibrations', symbols=['Cl','H'], images=[SADDLE.tolist()],
                            vibrations={'harmonicThermo':settings}), 'tblite')

    @unittest.skipUnless(importlib.util.find_spec('sella'), 'requires Sella')
    def test_sella_ts_with_frozen_substrate(self):
        positions = SADDLE.copy()
        positions[1] += [.08, .13, .07]
        with tempfile.TemporaryDirectory() as directory:
            r = b.calculate_job(input_for('ts', positions, fixedAtoms=[0]), potential, directory)
        self.assertTrue(r['converged'], r['history'][-1])
        np.testing.assert_allclose(r['images'][0], SADDLE, atol=.002)
        for frame in r['trajectory']['images']:
            np.testing.assert_allclose(frame[0], SADDLE[0], rtol=0, atol=1e-13)

    @unittest.skipUnless(importlib.util.find_spec('sella'), 'requires Sella')
    def test_both_irc_branches_in_free_mass_weighted_space(self):
        for fixed in ([], [0]):
            with tempfile.TemporaryDirectory() as directory:
                r = b.calculate_job(input_for('irc', fixedAtoms=fixed, irc=dict(stepSize=.15)), potential, directory)
            self.assertTrue(r['converged'], r['branches'])
            self.assertEqual(len(r['saddleGammaImaginaryCM']), 1)
            self.assertEqual(r['images'][r['tsIndex']], SADDLE.tolist())
            self.assertTrue(all(v['endpointVerifiedMinimum'] for v in r['branches'].values()))
            endpoints = [p[1][0]-p[0][0] for p in (r['images'][0], r['images'][-1])]
            np.testing.assert_allclose(sorted(endpoints), [2,6], atol=.003)
            for xyz, energy, force in zip(r['images'], r['energies'], r['forces']):
                if fixed:
                    np.testing.assert_array_equal(xyz[0], SADDLE[0])
                e, f = potential(0, np.asarray(xyz))
                self.assertAlmostEqual(e, energy)
                np.testing.assert_allclose(f, force, atol=1e-10)

    def test_minimum_higher_order_and_gas_thermochemistry_are_rejected(self):
        c = input_for('irc', fixedAtoms=[0])
        for stiffness in (1., -1.):
            def unsuitable(_, positions):
                delta = positions-SADDLE
                diag = [stiffness, stiffness, 1.]
                return .5*np.sum(delta**2*diag), -delta*diag

            with tempfile.TemporaryDirectory() as d, self.assertRaisesRegex(ValueError, '虚振動が1本'):
                b.irc_calculation(c, unsuitable, d)
        with self.assertRaisesRegex(ValueError, '理想気体'):
            input_for('vibrations', thermochemistry={})


if __name__ == '__main__':
    unittest.main()
