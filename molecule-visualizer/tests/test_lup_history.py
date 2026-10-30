"""LUP checkpoints remain evaluated, attributable and resumable after restart."""
import copy
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from test_engine import b, CONFIG


def request():
    return {
        'symbols': ['He'], 'atomIds': ['helium-1'],
        'images': [[[-1., 0., 0.]], [[-.35, .2, 0.]], [[.25, .1, 0.]], [[1., 0., 0.]]],
        'nodeIds': ['left', 'first', 'second', 'right'],
        'mode': 'lup', 'optimizer': 'fire', 'maxSteps': 3, 'climbAfter': 1,
        'fmax': .0001, 'maxMove': .03,
        'lup': {'redistributeEvery': 2, 'redistributionTolerance': .002},
        'livePreview': True,
    }


def well(index, positions):
    x, y, z = positions[0]
    return (x*x-1)**2 + 2*y*y + z*z, np.array([[-4*x*(x*x-1), -4*y, -2*z]])


class LUPHistory(unittest.TestCase):
    def test_interruption_restores_last_evaluated_band_and_lup_conditions(self):
        with tempfile.TemporaryDirectory() as directory:
            config = {**CONFIG, 'historyDir': directory}
            jobs = b.Jobs(config)
            data = b.validate(request(), 'tblite')
            checkpoints = []
            result = b.calculate_job(data, well, directory, checkpoints.append)
            last = [p['bandCheckpoint'] for p in checkpoints if 'bandCheckpoint' in p][-1]
            with patch.object(jobs, '_launch_next'):
                created = jobs.start(data)
            job = jobs.jobs[created['id']]
            job.update(status='running', bandCheckpoint=copy.deepcopy(last))
            jobs._persist(job, force=True)

            restored = b.Jobs(config)
            recovered = restored.get(created['id'])
            self.assertEqual(recovered['status'], 'interrupted')
            self.assertEqual(recovered['result']['mode'], 'lup')
            self.assertFalse(recovered['result']['converged'])
            self.assertEqual(recovered['result']['images'], result['images'])
            self.assertEqual(recovered['result']['nodeIds'], data['nodeIds'])
            for image, energy in zip(recovered['result']['images'], recovered['result']['energies']):
                self.assertAlmostEqual(well(0, np.array(image))[0], energy, places=12)
            with patch.object(restored, '_launch_next'):
                resumed = restored.resume(created['id'])
            self.assertEqual(resumed['resumeKind'], 'optimizer_state')
            self.assertEqual(resumed['parentId'], created['id'])
            for key in ('mode', 'optimizer', 'lup', 'climbAfter', 'atomIds', 'nodeIds'):
                self.assertEqual(resumed['data'][key], data[key])
            self.assertEqual(resumed['data']['images'], result['images'])
            self.assertEqual(restored.get(created['id'])['result'], recovered['result'])
            self.assertEqual(restored.listing()['jobs'][-1]['resumeKind'], 'optimizer_state')

    def test_failure_after_redistribution_keeps_old_evaluated_coordinates(self):
        data = b.validate({**request(), 'lup': {'redistributeEvery': 1}}, 'tblite')
        completed = []
        calls = 0

        def failing(index, positions):
            nonlocal calls
            calls += 1
            if calls > len(data['images']):
                raise RuntimeError('SCF failed after path displacement')
            return well(index, positions)

        with self.assertRaisesRegex(RuntimeError, 'SCF failed'):
            b.relax(data, failing, completed.append)
        last = [p['bandCheckpoint'] for p in completed if 'bandCheckpoint' in p][-1]
        self.assertEqual(last['images'], data['images'])
        jobs = b.Jobs(CONFIG)
        partial = jobs.partial_structure({'data': data, 'status': 'error',
                                         'bandCheckpoint': last, 'error': 'SCF failed'})
        self.assertFalse(partial['converged'])
        self.assertEqual(partial['reason'], 'failed')
        self.assertEqual(partial['nodeIds'], data['nodeIds'])
        self.assertEqual(partial['images'], data['images'])
        for image, energy in zip(partial['images'], partial['energies']):
            self.assertAlmostEqual(well(0, np.array(image))[0], energy, places=12)


if __name__ == '__main__':
    unittest.main()
