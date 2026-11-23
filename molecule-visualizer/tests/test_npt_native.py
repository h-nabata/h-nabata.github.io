"""Hydrostatic pressure response of a real GFN2-xTB diamond silicon cell."""
import importlib.util
import tempfile
import unittest

import numpy as np
from ase import units
from ase.build import bulk

from test_engine import b, CONFIG
from test_persistent_jobs import wait_for


@unittest.skipUnless(importlib.util.find_spec('tblite'), 'requires native periodic tblite')
class NativePressureControl(unittest.TestCase):
    def test_compression_and_sampled_virial_on_gfn2_silicon(self):
        si = bulk('Si', 'diamond', a=5.43)
        initial_cell = np.asarray(si.cell)
        initial_volume = si.get_volume()
        request = dict(mode='md', symbols=si.get_chemical_symbols(), images=[si.positions.tolist()],
                       cell={'vectors':initial_cell.tolist(), 'pbc':[True]*3}, maxSteps=45)
        means = []
        config = {**CONFIG, 'jobTimeout':180, 'evaluationTimeout':30}
        jobs = b.Jobs(config)
        try:
            for pressure in [1., 100000.]:
                with self.subTest(pressure=pressure):
                    md = dict(ensemble='npt', thermostat='bussi', thermostatTimeFs=15.,
                              temperatureK=200., pressureBar=pressure, timestepFs=.5,
                              barostatInterval=1, volumeStepPercent=2., seed=731,
                              removeCOM=False, sampleEvery=3)
                    data = b.validate({**request, 'md':md}, 'tblite')
                    receipt = jobs.start(data)
                    job = wait_for(jobs, receipt['id'], timeout=180)
                    self.assertEqual(job['status'], 'completed', job.get('error'))
                    result = job['result']
                    tr = result['trajectory']
                    volumes = np.array(tr['volumeA3'])
                    self.assertAlmostEqual(volumes[0], initial_volume)
                    self.assertGreater(np.ptp(volumes), .15)
                    self.assertEqual(tr['stepNumbers'], list(range(0,46,3)))
                    self.assertEqual(tr['timeFs'][-1], 22.5)
                    for frame, v in zip(tr['cells'], volumes):
                        self.assertEqual(frame['pbc'], [True]*3)
                        h = np.array(frame['vectors'])
                        self.assertAlmostEqual(abs(np.linalg.det(h)), v, places=9)
                        np.testing.assert_allclose(h, initial_cell*(v/initial_volume)**(1/3))
                    # Independently finite-difference E(V) instead of calling the integrator's stress conversion.
                    i = len(volumes)//2
                    v = volumes[i]
                    x, h = np.array(tr['images'][i]), np.array(tr['cells'][i]['vectors'])
                    calc = b.TBLiteEngine(data, config, tempfile.gettempdir())
                    energy = calc.with_cell(0,x,h)[0]
                    self.assertAlmostEqual(energy, tr['energies'][i], delta=1.e-5)
                    eps = 1.e-4
                    plus, minus = (1 + eps)**(1/3), (1 - eps)**(1/3)
                    e_plus = calc.with_cell(0,x*plus,h*plus)[0]
                    e_minus = calc.with_cell(0,x*minus,h*minus)[0]
                    expected = (2*tr['kineticEV'][i]/(3*v) - (e_plus-e_minus)/(2*eps*v))/units.bar
                    self.assertAlmostEqual(tr['pressureBar'][i], expected, delta=25.)
                    means.append(np.mean(volumes[8:]))
                    print(f'GFN2-xTB Si2: target {pressure:g} bar, 22.5 fs, '
                          f'mean V (12–22.5 fs) {means[-1]:.4f} Å³, '
                          f'range {min(volumes):.4f}–{max(volumes):.4f} Å³')
        finally:
            jobs.close()
        self.assertEqual(len(means), 2)
        self.assertLess(means[1], .95*means[0])


if __name__ == '__main__':
    unittest.main()
