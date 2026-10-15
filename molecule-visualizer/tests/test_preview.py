"""Live display does not change the numerical path or expose large histories by default."""
import copy
import unittest
import numpy as np
from test_engine import b, band, well, CONFIG, WATER
from test_afir_engine import request


class Preview(unittest.TestCase):
    def test_opt_in_band_snapshots_are_complete_and_match_energies(self):
        data = {**band('neb'), 'maxSteps': 3}
        off, on = [], []
        result_off = b.relax(data, well, off.append)
        result_on = b.relax({**data, 'livePreview': True}, well, on.append)
        self.assertEqual(result_off, result_on)
        self.assertTrue(all('preview' not in p for p in off))
        snapshots = [p['preview'] for p in on if 'preview' in p]
        self.assertEqual(len(snapshots), 4)
        for p in snapshots:
            self.assertEqual(len(p['images']), 7)
            for i, positions in enumerate(p['images']):
                self.assertAlmostEqual(p['energies'][i], well(i, np.array(positions))[0])
        self.assertEqual(snapshots[-1]['images'], result_on['images'])
        self.assertEqual(snapshots[0]['images'], data['images'])
        self.assertFalse(b.validate(WATER, 'tblite')['livePreview'])
        for invalid in (1, 'yes', None):
            with self.assertRaises(ValueError):
                b.validate({**WATER, 'livePreview': invalid}, 'tblite')

    def test_afir_preview_is_incremental_bounded_and_opt_in(self):
        data = b.validate(request(), 'tblite')
        initial = np.array(data['images'][0])
        progress = []
        result = b.afir_relax(data, lambda i,p:(float(((p-initial)**2).sum()), -2*(p-initial)), progress.append)
        frames = [p['checkpoint'] for p in progress]
        jobs = b.Jobs(CONFIG)
        jobs.job = {'id':'a'*32, 'status':'running', 'data':data, 'progress':{'step':4},
                    'checkpoints':frames}
        plain = jobs.get('a'*32)
        self.assertNotIn('preview', plain)
        self.assertNotIn('checkpoints', plain)
        part = jobs.get('a'*32, True, 2)['preview']
        self.assertEqual(part['energies'], result['energies'][2:])
        self.assertEqual(part['biasEnergies'], result['biasEnergies'][2:])
        self.assertEqual(part['positions'], result['images'][-1])
        self.assertEqual((part['from'], part['next']), (2,5))
        self.assertNotIn('preview', jobs.get('a'*32, True, 5))
        jobs.job['checkpoints'] = [copy.deepcopy(frames[0]) for _ in range(1002)]
        part = jobs.get('a'*32, True, 0)['preview']
        self.assertEqual(len(part['energies']), 1000)
        self.assertEqual(len(part['positions']), 3)  # one geometry, not 1000
        self.assertEqual(jobs.get('a'*32, True, part['next'])['preview']['next'], 1002)

    def test_default_job_status_excludes_latest_band_geometry(self):
        jobs = b.Jobs(CONFIG)
        jobs.job = {'id':'b'*32, 'status':'running', 'progress':{'step':2},
                    'data':{'mode':'neb'}, 'preview':{'step':1,'images':WATER['images'],'energies':[1.]}}
        self.assertNotIn('preview', jobs.get('b'*32))
        snapshot = jobs.get('b'*32, True)['preview']
        self.assertEqual(snapshot['step'], 1)
        snapshot['images'][0][0][0] = 10
        self.assertEqual(jobs.job['preview']['images'][0][0][0], 0)
