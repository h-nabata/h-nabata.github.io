"""Temperature baths: old request replay, canonical kinetic variance, NHC reference."""
import unittest

import numpy as np
from ase import Atoms, units
from ase.calculators.harmonic import SpringCalculator
from ase.md.nose_hoover_chain import NoseHooverChainNVT

from test_engine import b
from test_md_dynamics import no_force, request


class Thermostats(unittest.TestCase):
    def test_default_and_stored_langevin_trajectory(self):
        self.assertEqual(request(ensemble='nvt')['md']['thermostat'], 'nose-hoover-chain')
        data = request(ensemble='nvt', frictionPerPs=28, sampleEvery=1, steps=9, seed=421)
        self.assertEqual(data['md']['thermostat'], 'langevin')
        baseline = b.molecular_dynamics(data, no_force)
        # 1.21 stored (and might pass directly to an interrupted worker) this shape.
        data['md'].pop('thermostat')
        restart = b.molecular_dynamics(data, no_force)
        self.assertEqual(baseline['trajectory'], restart['trajectory'])

    def test_incompatible_options_and_zero_temperature(self):
        for options in ({'ensemble':'nve', 'thermostat':'bussi'},
                        {'ensemble':'nve', 'thermostatTimeFs':1},
                        {'ensemble':'nvt', 'thermostat':'unknown'},
                        {'ensemble':'nvt', 'thermostat':'bussi', 'frictionPerPs':20},
                        {'ensemble':'nvt', 'thermostat':'langevin', 'thermostatTimeFs':10},
                        {'ensemble':'nvt', 'thermostat':'nose-hoover-chain', 'thermostatTimeFs':0},
                        {'ensemble':'nvt', 'thermostat':'bussi', 'temperatureK':0},
                        {'ensemble':'nvt', 'thermostat':'nose-hoover-chain', 'temperatureK':0}):
            with self.subTest(md=options), self.assertRaises(ValueError):
                request(**options)
        self.assertEqual(request(ensemble='nvt', thermostat='langevin', temperatureK=0)['md']['temperatureK'],0)

    def test_nhc_matches_ase_in_three_internal_degrees_of_freedom(self):
        # The relative coordinates of an isolated two-atom harmonic well evolve
        # as one Cartesian particle of reduced mass. The bath therefore sees
        # three modes, while the atom-resolved bridge still integrates both atoms.
        masses = np.array([4., 20.])
        mu = np.prod(masses) / masses.sum()
        eq = np.array([1.,0,0])
        coords = np.array([[1.,.6,0.],[2.4,.3,.2]])
        velocities = np.array([[-.013,.004,.009],[.003,-.009,.01]])
        def pair(i, x):
            displacement = x[1] - x[0] - eq
            return 2.5*np.dot(displacement, displacement), np.array([5*displacement,-5*displacement])
        dt, steps, tau = .4, 120, 7.
        data = request(symbols=['He','Ne'], positions=coords, massesAmu=masses.tolist(), steps=steps,
                       ensemble='nvt', thermostat='nose-hoover-chain', thermostatTimeFs=tau, temperatureK=333,
                       timestepFs=dt, sampleEvery=steps, initialVelocitiesAngstromPerFs=velocities.tolist())
        out = b.molecular_dynamics(data, pair)
        self.assertEqual(out['degreesOfFreedom'], 3)
        ref = Atoms('He', positions=[coords[1]-coords[0]], masses=[mu])
        ref.set_velocities([(velocities[1]-velocities[0])/units.fs])
        ref.calc = SpringCalculator(eq[None,:], 5.)
        dyn = NoseHooverChainNVT(ref, timestep=dt*units.fs, temperature_K=333, tdamp=tau*units.fs)
        dyn.run(steps)
        x = np.array(out['images'][0])
        v = np.array(out['velocitiesAngstromPerFs'])
        np.testing.assert_allclose(x[1]-x[0], ref.positions[0], atol=1e-12, rtol=1e-12)
        np.testing.assert_allclose(v[1]-v[0], ref.get_velocities()[0]*units.fs, atol=1e-13)
        np.testing.assert_allclose(np.dot(masses,v), np.zeros(3), atol=1e-13)
        self.assertAlmostEqual(out['trajectory']['kineticEV'][-1], ref.get_kinetic_energy(), places=12)

    def test_bussi_mixed_masses_start_at_rest_and_sample_canonical_variance(self):
        # Rapid relaxation gives effectively independent samples on a flat PES.
        # With one internal relative vector K follows kT/2 times chi-squared(3).
        data = request(symbols=['He','Ne'], positions=[[0,0,0],[2.,0,0]], steps=4000,
                       ensemble='nvt', thermostat='bussi', thermostatTimeFs=.25, timestepFs=1,
                       temperatureK=310., seed=802, sampleEvery=5, initialVelocitiesAngstromPerFs=[[0.]*3]*2)
        out = b.molecular_dynamics(data, no_force)
        samples = 2*np.array(out['trajectory']['kineticEV'][1:])/(units.kB * 310)
        self.assertLess(abs(samples.mean()-3), .27)
        self.assertLess(abs(samples.var()-6), 1.25)
        np.testing.assert_allclose(np.dot(out['masses'], np.array(out['velocitiesAngstromPerFs'])), 0, atol=1e-14)
        self.assertEqual(out['trajectory']['kineticEV'][0], 0.)
        self.assertEqual(out, b.molecular_dynamics(data, no_force))

    def test_bussi_single_particle_is_canonical_without_com_projection(self):
        data = request(ensemble='nvt', thermostat='bussi', thermostatTimeFs=.1, timestepFs=.5,
                       steps=3000, sampleEvery=4, temperatureK=240., seed=899)
        out = b.molecular_dynamics(data, no_force)
        self.assertEqual(out['degreesOfFreedom'], 3)
        self.assertFalse(out['md']['removeCOM'])
        T = np.array(out['trajectory']['temperatureK'][1:])
        self.assertLess(abs(T.mean()-240), 20)
        self.assertLess(abs(T.var()/(2*240**2/3)-1), .25)

    def test_nhc_at_rest_requires_real_force_or_initial_motion(self):
        data = request(ensemble='nvt', initialVelocitiesAngstromPerFs=[[0.]*3])
        with self.assertRaisesRegex(ValueError, 'Maxwell'):
            b.molecular_dynamics(data, no_force)

        def constant_force(index, x):
            return -x[0, 0], np.array([[1., 0., 0.]])
        result = b.molecular_dynamics(data, constant_force)
        self.assertGreater(result['trajectory']['kineticEV'][-1], 0.)

    def test_chain_and_bussi_sample_harmonic_canonical_fluctuations(self):
        # Equipartition gives the same chi-square(12) law for twice the
        # kinetic and potential energies in units of kT. Twelve distinct
        # frequencies exercise both the bath and the positional integrator.
        centers = np.zeros((4, 3))
        centers[:, 0] = np.arange(4) * 2
        springs = 1 + .6 * np.arange(12).reshape(4, 3)
        def harmonic(index, x):
            displacement = x - centers
            return .5 * np.sum(springs * displacement**2), -springs * displacement

        temperature = 310.
        for thermostat in ('nose-hoover-chain', 'bussi'):
            with self.subTest(thermostat=thermostat):
                data = request(symbols=['He']*4, positions=centers, massesAmu=[4,9,14,20],
                               ensemble='nvt', thermostat=thermostat, thermostatTimeFs=20,
                               timestepFs=.7, temperatureK=temperature, steps=16000,
                               sampleEvery=20, seed=29401, removeCOM=False)
                trajectory = b.molecular_dynamics(data, harmonic)['trajectory']
                for field in ('kineticEV', 'energies'):
                    # Discard the first 2200 steps to equilibrate from the minima.
                    samples = 2 * np.array(trajectory[field][110:]) / (units.kB * temperature)
                    self.assertLess(abs(samples.mean() / 12 - 1), .12)
                    self.assertLess(abs(samples.var() / 24 - 1), .30)
