"""Independent MD unit, ensemble, checkpoint and conservation tests."""
import unittest

import numpy as np
from ase import units
from test_engine import b


def request(symbols=('He',), positions=((0., 0., 0.),), steps=20, **settings):
    data = {'symbols':list(symbols), 'images':[np.asarray(positions).tolist()], 'mode':'md',
            'maxSteps':steps, 'md':settings}
    b.validate_md(data, data)
    return data


def no_force(index, positions):
    if index != 0:
        raise AssertionError('All dynamics steps must reuse one electronic calculator.')
    return 1.75, np.zeros_like(positions)


class Dynamics(unittest.TestCase):
    def test_prescribed_ballistic_pair_and_isotope_units(self):
        v = np.array([[.021, -.014, .007]])
        for sign in (1., -1.):
            data = request(steps=11, temperatureK=0, massesAmu=[4.001506], timestepFs=.35,
                           sampleEvery=3, initialVelocitiesAngstromPerFs=(sign*v).tolist())
            answer = b.molecular_dynamics(data, no_force)
            self.assertFalse(answer['md']['removeCOM'])
            self.assertEqual((answer['degreesOfFreedom'], answer['evaluations']), (3, 12))
            frames = answer['trajectory']
            self.assertEqual(frames['stepNumbers'], [0,3,6,9,11])
            kinetic = .5*4.001506*np.sum((v/units.fs)**2)
            np.testing.assert_allclose(frames['images'], np.array(frames['timeFs'])[:,None,None]*sign*v,
                                       rtol=1e-13, atol=1e-14)
            np.testing.assert_allclose(frames['kineticEV'], kinetic)
            np.testing.assert_allclose(frames['totalEV'], 1.75+kinetic)
            np.testing.assert_allclose(frames['temperatureK'], 2*kinetic/(3*units.kB))
            np.testing.assert_allclose(answer['velocitiesAngstromPerFs'], sign*v, atol=1e-15)
            np.testing.assert_array_equal(answer['images'][0], frames['images'][-1])

    def test_nve_second_order_energy_error_and_time_reversal(self):
        def harmonic(index, x):
            return .5*6*np.sum(x**2), -6*x
        errors = []
        for dt in (.6, .3):
            data = request(positions=[[.51,-.12,.08]], steps=round(60/dt), timestepFs=dt,
                           massesAmu=[2.014], sampleEvery=1, temperatureK=0,
                           initialVelocitiesAngstromPerFs=[[0,0,0]])
            forward = b.molecular_dynamics(data, harmonic)
            energies = np.array(forward['trajectory']['totalEV'])
            errors.append(max(abs(energies - energies[0])))
            data['images'] = forward['images']
            data['md']['initialVelocitiesAngstromPerFs'] = (-np.array(forward['velocitiesAngstromPerFs'])).tolist()
            backward = b.molecular_dynamics(data, harmonic)
            np.testing.assert_allclose(backward['images'][0], [[.51,-.12,.08]], atol=1e-13)
            np.testing.assert_allclose(backward['velocitiesAngstromPerFs'], 0., atol=1e-13)
        self.assertGreater(errors[0]/errors[1], 3.9)
        self.assertLess(errors[0]/errors[1], 4.1)

    def test_langevin_relaxes_cold_mixed_masses_to_the_requested_internal_temperature(self):
        data = request(symbols=['He','Ne','Ar'], positions=[[0,0,0],[3,0,0],[0,3,0]],
                       ensemble='nvt', frictionPerPs=600., timestepFs=.5, temperatureK=270.,
                       initialVelocitiesAngstromPerFs=[[0,0,0]]*3, steps=7000, sampleEvery=10)
        result = b.molecular_dynamics(data, no_force)
        self.assertEqual(result['degreesOfFreedom'], 6)
        traj = result['trajectory']
        np.testing.assert_allclose(traj['temperatureK'][0], 0)
        temperature = np.array(traj['temperatureK'][40:])
        self.assertLess(abs(temperature.mean()/270.-1), .08)
        self.assertLess(abs(temperature.var()/(2*270.**2/6)-1), .21)
        masses = np.array(result['masses'])
        center = np.average(traj['images'], weights=masses, axis=1)
        np.testing.assert_allclose(center, np.broadcast_to(center[0], center.shape), atol=2e-12)
        self.assertGreater(np.max(np.abs(np.diff(traj['images'], axis=0))), 0.01)

    def test_langevin_samples_configurational_equipartition_on_a_harmonic_surface(self):
        sites = np.zeros((12, 3))
        sites[:, 0] = 3 * np.arange(len(sites))
        data = request(symbols=['He'] * len(sites), positions=sites, steps=16000,
                       timestepFs=1.2, sampleEvery=20, ensemble='nvt', temperatureK=330.,
                       frictionPerPs=45., removeCOM=False)
        def harmonic(index, positions):
            q = positions - sites
            return .5 * 7 * np.sum(q**2), -7 * q
        traj = b.molecular_dynamics(data, harmonic)['trajectory']
        expected = .5 * sites.size * units.kB * 330.
        self.assertLess(abs(np.mean(traj['energies'][80:]) / expected - 1), .06)
        self.assertLess(abs(np.mean(traj['kineticEV'][80:]) / expected - 1), .06)

    def test_nvt_ou_damping_uses_inverse_picoseconds_and_preserves_translation_when_disabled(self):
        rate, dt, v0 = 45., 2., np.array([[.002, .017, -.031]])
        data = request(ensemble='nvt', temperatureK=0, frictionPerPs=rate, timestepFs=dt,
                       initialVelocitiesAngstromPerFs=v0.tolist(), removeCOM=False, steps=15)
        result = b.molecular_dynamics(data, no_force)
        # The first kick, both half-drifts, and the final kick leave velocity
        # unchanged on a flat surface. Only the exact OU decay remains.
        np.testing.assert_allclose(result['velocitiesAngstromPerFs'], v0*np.exp(-rate*15*dt/1000), rtol=1e-13)
        expected = .5*dt*v0*(1+np.exp(-rate*dt/1000))*sum(np.exp(-rate*dt*np.arange(15)/1000))
        np.testing.assert_allclose(result['images'][0], expected, rtol=1e-13)

    def test_randomized_initial_velocities_and_bath_are_reproducible(self):
        data = request(symbols=['He','Ne'], positions=[[1,0,0],[2,0,0]], steps=11,
                       ensemble='nvt', timestepFs=.2, sampleEvery=1, seed=70108, removeCOM=False)
        first = b.molecular_dynamics(data, no_force)
        self.assertEqual(first, b.molecular_dynamics(data, no_force))
        data['md']['seed'] += 1
        other = b.molecular_dynamics(data, no_force)
        self.assertNotEqual(first['trajectory']['images'], other['trajectory']['images'])
        self.assertNotEqual(first['trajectory']['temperatureK'][0], other['trajectory']['temperatureK'][0])
        # Removing the COM must use masses, including explicit isotopes.
        data['md'].update(removeCOM=True, massesAmu=[8., None],
                          initialVelocitiesAngstromPerFs=[[.3,.2,0],[.3,.2,0]])
        removed = b.molecular_dynamics(data, no_force)
        self.assertLess(removed['trajectory']['kineticEV'][0], 1e-25)
        self.assertEqual(removed['masses'][0], 8.)

    def test_failure_between_samples_flushes_the_last_integrated_state(self):
        data = request(steps=12, sampleEvery=5, timestepFs=.5, initialVelocitiesAngstromPerFs=[[.5,0,0]])
        data['livePreview'] = True
        checkpoints = []
        def failing(i, x):
            if x[0,0] >= 1.5:
                raise RuntimeError('native trial failed')
            return no_force(i, x)
        def observe(event):
            if 'mdCheckpoint' in event:
                check = event['mdCheckpoint']
                self.assertEqual(event['preview']['images'], [check['positions']])
                self.assertNotIn('trajectory', check)
                checkpoints.append(check)
        with self.assertRaisesRegex(RuntimeError, 'native trial failed'):
            b.molecular_dynamics(data, failing, observe)
        self.assertEqual([x['step'] for x in checkpoints], [0,5])
        data['md']['sampleEvery'] = 4
        checkpoints.clear()
        with self.assertRaisesRegex(RuntimeError, 'native trial failed'):
            b.molecular_dynamics(data, failing, observe)
        partial = b.md_result(data, checkpoints, 'failed')
        self.assertEqual(partial['trajectory']['stepNumbers'], [0,4,5])
        self.assertEqual(partial['steps'], 5)
        self.assertEqual(partial['velocitiesAngstromPerFs'], [[.5,0,0]])

    def test_reject_invalid_or_overlarge_input_and_sampling_boundaries(self):
        for invalid in ({'sampleEvery':0}, {'temperatureK':-1}, {'timestepFs':0},
                        {'frictionPerPs':1}, {'ensemble':'nvt','frictionPerPs':0},
                        {'massesAmu':[float('nan')]}, {'massesAmu':[0]},
                        {'seed':True}, {'removeCOM':'yes'}, {'initialVelocitiesAngstromPerFs':[]},
                        {'initialVelocitiesAngstromPerFs':[[False, 0, 0]]},
                        {'initialVelocitiesAngstromPerFs':[[float('inf'), 0, 0]]}):
            with self.subTest(settings=invalid), self.assertRaises(ValueError):
                request(**invalid)
        request(steps=999, sampleEvery=1)
        with self.assertRaisesRegex(ValueError, '1000フレーム'):
            request(steps=1000, sampleEvery=1)
        with self.assertRaisesRegex(ValueError, '100000原子'):
            request(symbols=['He']*500, positions=np.zeros((500,3)), steps=200, sampleEvery=1)


if __name__ == '__main__':
    unittest.main()
