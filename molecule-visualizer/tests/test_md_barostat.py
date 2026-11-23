"""Check variable-cell NPT sampling and fixed-cell pressure in three dimensions."""
import math
import unittest

import numpy as np
from ase import units
from test_engine import b


BOX = [[4., 0., 0.], [.5, 4., 0.], [0., .5, 4.]]


class IdealGas:
    def with_cell(self, index, positions, lattice):
        return 0., np.zeros_like(positions), np.zeros((3,3))


def request(steps=8, **md):
    return b.validate(dict(symbols=['He','Ne'], images=[[[.5,.5,.5], [2.,2.,2.]]],
                           cell=dict(vectors=BOX, pbc=[True]*3), mode='md', maxSteps=steps,
                           md={'ensemble':'npt','sampleEvery':1,'seed':390,'temperatureK':300, **md}), 'tblite')


class VolumeSampling(unittest.TestCase):
    def test_pressure_settings_require_a_physical_volume_and_positive_target(self):
        options = request(recordPressure=False)['md']
        self.assertTrue(options['recordPressure'])
        self.assertEqual(options['barostat'], 'mc-isotropic')
        for invalid in ({'pressureBar':0}, {'barostatInterval':1.5}, {'volumeStepPercent':0},
                        {'barostat':'undefined'}, {'ensemble':'nve', 'pressureBar':1},
                        {'ensemble':'nvt', 'recordPressure':'yes'}):
            with self.subTest(options=invalid), self.assertRaises(ValueError):
                request(**invalid)
        raw = dict(symbols=['He'], images=[[[1, 0, 1]]], mode='md',
                   cell=dict(vectors=BOX, pbc=[True, True, False]))
        for ensemble in ('nve', 'nvt', 'npt'):
            with self.subTest(ensemble=ensemble), self.assertRaisesRegex(ValueError, '3方向'):
                b.validate({**raw, 'md':{'ensemble':ensemble, 'recordPressure':True}}, 'tblite')

    def test_ideal_gas_volume_distribution_and_kinetic_pressure(self):
        # For two independently translating particles the normalized volume density
        # in y = beta*P*V is Gamma(shape=3), including with COM momenta integrated out.
        for remove in (False, True):
            with self.subTest(removeCOM=remove):
                data = request(steps=30500, sampleEvery=61, barostatInterval=1, volumeStepPercent=30.,
                               pressureBar=2000., thermostat='langevin', frictionPerPs=600., removeCOM=remove)
                volumes, pressures = [], []
                def observe(event):
                    if event['step'] > 1500 and event['step'] % 10 == 0:
                        volumes.append(event['volumeA3'])
                        pressures.append(event['pressureBar'])
                result = b.molecular_dynamics(data, IdealGas(), observe)
                y = np.array(volumes) * (2000 * units.bar) / (300 * units.kB)
                self.assertAlmostEqual(y.mean(), 3., delta=.16)
                self.assertAlmostEqual(y.var(), 3., delta=.55)
                self.assertAlmostEqual(np.mean(pressures), 2000., delta=170.)
                self.assertEqual(result['volumeAttempts'], 30500)
                self.assertTrue(0 < result['volumeAccepted'] < result['volumeAttempts'])
                self.assertEqual(result['evaluations'], 61001)
                boxes = np.array([cell['vectors'] for cell in result['trajectory']['cells']])
                volumes_saved = np.linalg.det(boxes)
                np.testing.assert_allclose(result['trajectory']['volumeA3'], volumes_saved, rtol=1e-12)
                np.testing.assert_allclose(boxes / boxes[:,0,0,None,None], np.broadcast_to(np.array(BOX)/4,boxes.shape), atol=1e-13)
                print('Ideal-gas NPT, removeCOM=',remove, 'mean/variance(beta*P*V)=', y.mean(), y.var(),
                      'mean(P/bar)=',np.mean(pressures))

    def test_rejected_volume_proposal_keeps_force_stress_velocity_and_electronic_lane(self):
        class Wall:
            def __init__(self):
                self.lanes = []

            def with_cell(self, index, xyz, box):
                self.lanes.append(index)
                candidate = not np.array_equal(BOX, box)
                if candidate:
                    return 1.e6, np.ones_like(xyz), np.eye(3)*10
                return 0., np.zeros_like(xyz), np.zeros((3,3))

        velocities = [[.005,.001,0.],[-.005,-.001,0.]]
        data = request(steps=4, barostatInterval=2, thermostat='nose-hoover-chain', removeCOM=False,
                       initialVelocitiesAngstromPerFs=velocities)
        wall = Wall()
        result = b.molecular_dynamics(data, wall)
        self.assertEqual(wall.lanes, [0,0,0,1,0,0,1])
        self.assertEqual(result['volumeAttempts'], 2)
        self.assertEqual(result['volumeAccepted'], 0)
        np.testing.assert_equal(result['trajectory']['volumeA3'], np.full(5, np.linalg.det(BOX)))
        reference = request(steps=4, ensemble='nvt', thermostat='nose-hoover-chain', recordPressure=True,
                            removeCOM=False, initialVelocitiesAngstromPerFs=velocities)
        expected = b.molecular_dynamics(reference, Wall())
        for key in ('images','totalEV','kineticEV','pressureBar','temperatureK'):
            np.testing.assert_array_equal(expected['trajectory'][key], result['trajectory'][key])
        np.testing.assert_array_equal(expected['velocitiesAngstromPerFs'], result['velocitiesAngstromPerFs'])

    def test_metropolis_reciprocity_and_fixed_volume_pressure_sign(self):
        n, volume, delta = 2, 35., .02
        beta_inv, pressure = 315*units.kB, 1.2e3*units.bar
        values = b.md_log_volume_acceptance(n,delta,volume,.003,pressure,beta_inv)
        reverse = b.md_log_volume_acceptance(n,-delta,volume*math.exp(delta),-.003,pressure,beta_inv)
        self.assertAlmostEqual(values, -reverse, places=14)
        self.assertAlmostEqual(b.md_log_volume_acceptance(1,.03,volume,0.,0.,beta_inv),.06)
        # ASE's tensile-positive convention assigns a negative trace to compression.
        stress = np.diag([-900.,-1100.,-1300.]) * units.bar
        thermo = {'kineticEnergyEV':.008,'temperatureK':8.}
        reading = b.md_pressure_observation({'ensemble':'nve','removeCOM':True},3,np.eye(3)*3,stress,thermo)
        self.assertAlmostEqual(reading['pressureBar'], 1100 + .016/(3*27*units.bar))
        self.assertAlmostEqual(reading['volumeA3'], 27.)

    def test_volume_trial_failure_retains_consistent_uncommitted_step(self):
        class Broken(IdealGas):
            def with_cell(self,index,positions,lattice):
                if index == 1:
                    raise ValueError('volume trial SCF failed')
                return super().with_cell(index,positions,lattice)
        data = request(steps=6, sampleEvery=5, barostatInterval=3)
        samples = []
        def progress(event):
            if 'mdCheckpoint' in event:
                samples.append(event['mdCheckpoint'])
        with self.assertRaisesRegex(ValueError, 'SCF failed'):
            b.molecular_dynamics(data,Broken(),progress)
        self.assertEqual([p['step'] for p in samples],[0,2])
        partial = b.md_result(data,samples,'failed')
        self.assertEqual(partial['cell'], data['cell'])
        self.assertEqual(partial['volumeAttempts'], 0)
        self.assertEqual(partial['steps'], 2)


if __name__ == '__main__':
    unittest.main()
