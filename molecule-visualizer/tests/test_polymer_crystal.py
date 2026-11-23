"""Periodic all-trans polyethylene through the native GFN2-xTB MD queue."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

import numpy as np
from ase.io import read

from test_engine import b, CONFIG
from test_persistent_jobs import wait_for


PE_CELL = Path(__file__).resolve().parents[1] / 'examples' / 'polyethylene-periodic.xyz'


@unittest.skipUnless(importlib.util.find_spec('tblite'), 'requires native periodic tblite')
class PolyethyleneCrystal(unittest.TestCase):
    def test_periodic_backbone_and_pressure_moves(self):
        atoms = read(PE_CELL)
        vectors = atoms.cell.array
        positions = atoms.positions
        # Each of the two strands contains four CH2 groups; the final C bonds
        # to the first C of the next periodic repeat, one c vector above it.
        carbons = np.array([[0, 3, 6, 9], [12, 15, 18, 21]])
        self.assertEqual(atoms.get_chemical_formula(), 'C8H16')
        self.assertTrue(atoms.pbc.all())
        source = dict(mode='md', symbols=atoms.get_chemical_symbols(), images=[positions.tolist()],
                      cell=dict(vectors=vectors.tolist(), pbc=[True]*3), maxSteps=8)
        config = {**CONFIG, 'jobTimeout':180, 'evaluationTimeout':60}
        jobs = b.Jobs(config)
        try:
            for ensemble in ('nve', 'npt'):
                with self.subTest(ensemble=ensemble):
                    md = dict(ensemble=ensemble, timestepFs=.5, sampleEvery=2, temperatureK=300, seed=731)
                    if ensemble == 'nve':
                        md['recordPressure'] = True
                    else:
                        md.update(pressureBar=1, barostatInterval=2, volumeStepPercent=.8)
                    data = b.validate({**source, 'md':md}, 'tblite')
                    receipt = jobs.start(data)
                    job = wait_for(jobs, receipt['id'], timeout=180)
                    self.assertEqual(job['status'], 'completed', job.get('error'))
                    result = job['result']
                    tr = result['trajectory']
                    self.assertEqual(tr['stepNumbers'], [0, 2, 4, 6, 8])
                    self.assertEqual(tr['timeFs'][-1], 4.)
                    self.assertTrue(np.isfinite(tr['pressureBar']).all())
                    for xyz, cell, vol in zip(tr['images'], tr['cells'], tr['volumeA3']):
                        h = np.asarray(cell['vectors'])
                        coordinates = np.asarray(xyz)
                        cc = coordinates[carbons]
                        hydrogen = coordinates[carbons[:, :, None] + [1, 2]]
                        ch = np.linalg.norm(hydrogen - cc[:, :, None, :], axis=3)
                        self.assertTrue(np.all((ch > .90) & (ch < 1.23)), ch)
                        tail = cc[:, :1] + h[2]
                        distances = np.linalg.norm(np.diff(np.concatenate((cc, tail), axis=1), axis=1), axis=2)
                        self.assertTrue(np.all((distances > 1.35) & (distances < 1.70)), distances)
                        self.assertAlmostEqual(vol, abs(np.linalg.det(h)), places=8)
                    if ensemble == 'nve':
                        np.testing.assert_allclose(tr['volumeA3'], atoms.get_volume())
                        self.assertLess(np.ptp(tr['totalEV']), .01)
                    else:
                        self.assertEqual(result['volumeAttempts'], 4)
                        self.assertGreater(result['volumeAccepted'], 0)
                        self.assertGreater(np.ptp(tr['volumeA3']), 0.)
        finally:
            jobs.close()

        with tempfile.TemporaryDirectory() as tmp:
            calc = b.TBLiteEngine(data, config, tmp)
            energy, force, stress = calc.with_cell(0, positions, vectors)
            translated = positions.copy()
            translated[0] += vectors[2]
            e_other, f_other, s_other = calc.with_cell(1, translated, vectors)
            self.assertAlmostEqual(e_other, energy, delta=2e-6)
            np.testing.assert_allclose(f_other, force, atol=1e-4, rtol=0.)
            np.testing.assert_allclose(s_other, stress, atol=1e-5, rtol=0.)
            # At fixed fractional coordinates dE/d(ln V) = V trace(stress)/3.
            eps = 1e-4
            plus, minus = np.exp(np.array([eps, -eps])/3.)
            e_hi = calc.with_cell(0, plus*positions, plus*vectors)[0]
            e_lo = calc.with_cell(0, minus*positions, minus*vectors)[0]
            self.assertAlmostEqual((e_hi-e_lo)/(2*eps), atoms.get_volume()*np.trace(stress)/3, delta=.002)


if __name__ == '__main__':
    unittest.main()
