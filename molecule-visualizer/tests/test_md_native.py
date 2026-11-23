"""Fixed-duration MD comparisons through the production job queue and native engines."""
import importlib.util
import os
import unittest

import numpy as np
from ase import units
from ase.data import atomic_masses, atomic_numbers
from test_engine import b, CONFIG, WATER
from test_persistent_jobs import wait_for


def water_run(engine, steps, dt, cold_start=False, stride=1, thermostat=None):
    md = dict(ensemble='nvt' if cold_start or thermostat is not None else 'nve', timestepFs=dt, temperatureK=300, sampleEvery=stride,
              seed=731, removeCOM=True)
    if thermostat is not None and thermostat != 'default':
        md['thermostat'] = thermostat
    if cold_start:
        md.update(frictionPerPs=50, initialVelocitiesAngstromPerFs=[[0, 0, 0]]*3)
    # Stretch one O–H bond to excite a fast vibration in both NVE trajectories.
    request = {**WATER, 'images':[[[0, 0, 0], [1.02, 0, 0], [-.24, .93, 0]]],
               'mode':'md', 'maxSteps':steps, 'md':md}
    if engine == 'rdkit':
        request['forceField'] = {'model':'MMFF94', 'formalCharges':[0, 0, 0],
                                 'bonds':[[0, 1, 1], [0, 2, 1]]}
    config = {**CONFIG, 'engine':engine, 'binary':os.environ.get('GXTB_TEST_BINARY'),
              'jobTimeout':120, 'evaluationTimeout':30}
    jobs = b.Jobs(config)
    try:
        receipt = jobs.start(b.validate(request, engine))
        job = wait_for(jobs, receipt['id'], timeout=120)
        if job['status'] != 'completed':
            raise AssertionError((job['status'], job.get('error')))
        return job['result']
    finally:
        jobs.close()


class NativeMolecularDynamics(unittest.TestCase):
    def check_second_order_energy(self, engine):
        fine = water_run(engine, 96, .25)
        coarse = water_run(engine, 48, .5)
        deviations = []
        for result, steps in [(fine, 96), (coarse, 48)]:
            self.assertEqual(result['engine'], engine)
            self.assertEqual(result['steps'], steps)
            tr = result['trajectory']
            np.testing.assert_array_equal(tr['stepNumbers'], np.arange(steps + 1))
            np.testing.assert_allclose(tr['timeFs'], np.linspace(0., 24., steps + 1))
            total = np.asarray(tr['totalEV'])
            np.testing.assert_allclose(total, np.add(tr['energies'], tr['kineticEV']),
                                       rtol=0., atol=1e-10)
            mass = atomic_masses[[atomic_numbers[s] for s in WATER['symbols']]]
            com = np.einsum('ijc,j->ic', tr['images'], mass) / mass.sum()
            np.testing.assert_allclose(com-com[0], 0., atol=2e-7)
            np.testing.assert_allclose(tr['temperatureK'],
                                       2*np.asarray(tr['kineticEV']) / (6*units.kB), rtol=1e-9)
            np.testing.assert_array_equal(result['images'][0], tr['images'][-1])
            deviations.append(float(np.max(np.abs(total - total[0]))))
        self.assertAlmostEqual(fine['trajectory']['kineticEV'][0],
                               coarse['trajectory']['kineticEV'][0], places=12)
        self.assertGreater(deviations[1], 1e-7)  # a moving oscillator, not a frozen test.
        self.assertLess(deviations[0], .45 * deviations[1], deviations)
        self.assertLess(deviations[1], .015)
        print(f'{engine} NVE H2O, 24 fs, max |E(t)-E(0)| = {deviations[1]:.8g} eV '
              f'(0.5 fs), {deviations[0]:.8g} eV (0.25 fs)')

    @unittest.skipUnless(os.environ.get('GXTB_TEST_BINARY'), 'requires official g-xTB')
    def test_gxtb_water_timestep_halving(self):
        self.check_second_order_energy('gxtb')

    @unittest.skipUnless(importlib.util.find_spec('tblite'), 'optional native tblite')
    def test_gfn2_water_timestep_halving(self):
        self.check_second_order_energy('tblite')

    @unittest.skipUnless(importlib.util.find_spec('rdkit'), 'optional RDKit force field')
    def test_mmff94_water_timestep_halving(self):
        self.check_second_order_energy('rdkit')

    @unittest.skipUnless(importlib.util.find_spec('rdkit'), 'optional RDKit force field')
    def test_native_canonical_baths_and_legacy_implicit_langevin(self):
        # The job submission path normalizes new NVT requests and old saved settings alike.
        for selected, expected in [('default','nose-hoover-chain'), ('bussi','bussi')]:
            result = water_run('rdkit', 16000, .5, stride=20, thermostat=selected)
            self.assertEqual(result['md']['thermostat'], expected)
            tr = result['trajectory']
            sample = np.asarray(tr['temperatureK'])[np.asarray(tr['timeFs'])>=2000.]
            mean = float(np.mean(sample))
            self.assertAlmostEqual(mean, 300., delta=36.)
            self.assertGreater(np.std(sample), 20.)
            print(f'MMFF94 water NVT {expected}, 8 ps, mean T over 2–8 ps {mean:.2f} K')

        legacy = water_run('rdkit', 20, .5, cold_start=True)
        explicit = water_run('rdkit', 20, .5, cold_start=True, thermostat='langevin')
        self.assertEqual(legacy['md']['thermostat'], 'langevin')
        self.assertEqual(legacy['trajectory'], explicit['trajectory'])

    @unittest.skipUnless(importlib.util.find_spec('rdkit'), 'optional RDKit force field')
    def test_mmff94_langevin_heats_cold_water(self):
        result = water_run('rdkit', 10000, .5, cold_start=True, stride=20)
        trajectory = result['trajectory']
        temperature = np.asarray(trajectory['temperatureK'])
        self.assertEqual(temperature[0], 0.)
        self.assertEqual(trajectory['timeFs'][-1], 5000.)
        # Discard the first 1 ps, then compare the 4 ps mean rather than any snapshot.
        mean = float(np.mean(temperature[np.asarray(trajectory['timeFs']) >= 1000.]))
        self.assertAlmostEqual(mean, 300., delta=45.)
        self.assertGreater(np.std(temperature), 20.)
        print(f'MMFF94 NVT H2O from zero velocities, 50 /ps, 5 ps, mean T over 1–5 ps: {mean:.2f} K')
