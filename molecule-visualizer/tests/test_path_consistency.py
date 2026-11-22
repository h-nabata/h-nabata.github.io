"""Check the energy/force consistency indicator independently of solver convergence."""
import unittest
from unittest.mock import patch

import numpy as np

from test_engine import b, CONFIG


def path(mode='cineb', **settings):
    request = dict(symbols=['He'], mode=mode, images=[[[x, 0., 0.]] for x in [-1., 0., 1.]],
                   maxSteps=4, climbAfter=1, maxMove=.01, nodeIds=['left', 'peak', 'right'], livePreview=True)
    return b.validate({**request, **settings}, 'tblite')


def surface(_index, positions):
    x, y, z = positions[0]
    return 1.-x*x + (y+1.)**2 + z*z, np.array([[2*x, -2*(y+1.), -2*z]])


def jump(index, positions):
    energy, force = surface(index, positions)
    return energy + (.888 if positions[0, 1] < -.001 else 0.), force


class EnergyForceConsistency(unittest.TestCase):
    def test_energy_work_matches_on_smooth_quadratic_surface(self):
        for mode in ('neb', 'cineb', 'lup'):
            with self.subTest(mode=mode):
                result = b.relax(path(mode), surface)
                self.assertNotIn('pathConsistencyWarning', result)
                self.assertGreater(result['evaluations'], len(result['images']))

    def test_small_displacement_with_a_jump_records_the_worst_event_and_continues(self):
        for mode in ('neb', 'cineb', 'lup'):
            with self.subTest(mode=mode):
                data = path(mode)
                events = []
                result = b.relax(data, jump, events.append)
                warning = result['pathConsistencyWarning']
                self.assertEqual(warning['nodeId'], 'peak')
                self.assertEqual(warning['step'], 1)
                self.assertAlmostEqual(warning['errorEV'], .888, places=10)
                self.assertAlmostEqual(warning['energyChangeEV'] - warning['predictedEnergyChangeEV'], .888)
                self.assertTrue(0. < warning['maxDisplacementAngstrom'] <= data['maxMove'])
                self.assertEqual(result['steps'], data['maxSteps'])
                self.assertEqual(result['reason'], 'step_limit')
                self.assertEqual(result['optimizerState']['pathConsistencyWarning'], warning)
                for event in events:
                    if event['step'] >= 1 and 'bandCheckpoint' in event:
                        self.assertEqual(event['bandCheckpoint']['pathConsistencyWarning'], warning)
                        self.assertEqual(event['preview']['pathConsistencyWarning'], warning)
                resumed = b.relax({**data, 'images':result['images'], '_optimizerResume':result['optimizerState']}, surface)
                self.assertEqual(resumed['pathConsistencyWarning'], warning)

    def test_warning_is_filtered_by_displacement_and_work_magnitude(self):
        ones = np.ones((1, 3))
        zero = np.zeros_like(ones)
        self.assertIsNone(b.path_work_discrepancy(zero, 3., zero, zero, 'a', 5))
        self.assertIsNone(b.path_work_discrepancy(.04*ones, 3., zero, zero, 'a', 5))
        self.assertIsNone(b.path_work_discrepancy(.01*ones, .09, zero, zero, 'a', 5))
        # Predicted change 0.6 eV, actual change 1.0 eV; discrepancy < 2|prediction|.
        self.assertIsNone(b.path_work_discrepancy(.01*ones, 1., -20*ones, -20*ones, 'a', 5))

    def test_largest_of_several_inconsistencies_is_retained(self):
        def several_jumps(i, positions):
            energy, force = surface(i, positions)
            y = positions[0, 1]
            offset = sum(height for threshold, height in [(-.001, .2), (-.003, .8), (-.007, .3)] if y < threshold)
            return energy+offset, force

        result = b.relax(path('neb'), several_jumps)
        self.assertAlmostEqual(result['pathConsistencyWarning']['errorEV'], .8)
        self.assertEqual(result['pathConsistencyWarning']['step'], 2)

    def test_adaptive_insertions_and_index_shifts_do_not_compare_different_nodes(self):
        # Each side has its own constant energy, with zero forces. Refining
        # the crossing produces different energies less than 0.05 Å apart.
        data = path(images=[[[x, 0., 0.]] for x in [-.02, .005, .02]],
                    adaptiveNEB={'maxImages':8, 'interval':1, 'maxSpacing':.01, 'energyGap':.1})
        result = b.relax(data, lambda i, p: (float(p[0, 0] >= 0.), np.zeros_like(p)))
        self.assertGreater(len(result['images']), 3)
        self.assertIn('peak', result['nodeIds'])
        self.assertNotEqual(result['nodeIds'].index('peak'), 1)
        self.assertNotIn('pathConsistencyWarning', result)

    def test_geometry_only_restart_retains_warning_after_interrupted_insertion(self):
        data = path(adaptiveNEB={'maxImages':5, 'interval':1, 'energyGap':1.4, 'maxSpacing':20.})
        events = []
        b.relax(data, jump, events.append)
        cp = next(e['bandCheckpoint'] for e in events if 'bandCheckpoint' in e
                  and 'optimizerState' not in e['bandCheckpoint'])
        warning = cp['pathConsistencyWarning']
        jobs = b.Jobs(CONFIG)
        with patch.object(jobs, '_launch_next'):
            record = jobs.start(data)
            job = jobs.jobs[record['id']]
            job.update(status='interrupted', bandCheckpoint=cp)
            jobs._recover_partial(job)
            resumed = jobs.resume(job['id'])
        self.assertEqual(resumed['resumeKind'], 'geometry')
        self.assertEqual(b.relax(resumed['data'], surface)['pathConsistencyWarning'], warning)


if __name__ == '__main__':
    unittest.main()
