"""Step control, retries and exact restarts of the coupled-band optimizer."""
import copy
import unittest

import numpy as np
from test_engine import b, well
from test_lup import curved_well


def band(mode, **extra):
    x = np.array([-1.1, -.66, -.25, .13, .70, 1.1])
    y = .4*(1-x*x) + .13
    coordinates = np.stack((x, y, .07*x), axis=1)[:, None, :]
    options = dict(symbols=['He'], images=coordinates.tolist(), mode=mode, optimizer='band-lbfgs',
                   spring=1., maxSteps=45, fmax=1e-5, climbAfter=4, maxMove=.03)
    if mode != 'neb':
        options['endpointMode'] = 'relax'
    return b.validate({**options, **extra}, 'tblite')


class BandStepControl(unittest.TestCase):
    def test_sign_change_shrinks_trust_and_bounds_invalid_secants(self):
        method = b.BandLBFGS(.03)
        x = np.zeros((3, 1, 3))
        f = np.zeros_like(x)
        f[1, 0, 0] = 2.
        step = method.direction(x, f, np.zeros_like(f), None, False)
        self.assertGreater(step[1, 0, 0], 0)
        method.direction(x+step, -f, np.zeros_like(f), None, False)
        self.assertLess(method.radius, .03)
        self.assertEqual(method.pairs, [])

    def test_resume_reproduces_band_memories_and_redistribution(self):
        for mode in ('neb', 'cineb', 'lup'):
            d = band(mode)
            d['maxSteps'] = 11
            direct = b.relax(d, curved_well)
            checkpoints = []
            first = b.relax({**d, 'maxSteps':7}, curved_well,
                            lambda event: checkpoints.append(event['bandCheckpoint'])
                            if 'bandCheckpoint' in event else None)
            self.assertIn('bandLBFGS', first['optimizerState'])
            latest = copy.deepcopy(checkpoints[-1])
            # Force the disk representation (lists) into a new solver instance.
            continued = b.relax({**d, 'maxSteps':4, 'images':latest['images'],
                                 '_optimizerResume':latest['optimizerState']}, curved_well)
            np.testing.assert_allclose(continued['images'], direct['images'], atol=1e-13, rtol=0)
            np.testing.assert_allclose(continued['energies'], direct['energies'], atol=1e-13, rtol=0)
            self.assertEqual(continued['optimizer'], 'band-lbfgs')
            if mode == 'neb':
                np.testing.assert_array_equal(np.array(continued['images'])[[0, -1]],
                                              np.array(d['images'])[[0, -1]])
            else:
                self.assertGreater(np.max(np.abs(np.array(d['images'])[[0,-1]] -
                                                 np.array(continued['images'])[[0,-1]])), .01)

    def test_scf_retry_accepts_only_a_complete_smaller_step(self):
        d = band('lup', climbAfter=0, maxSteps=1, lup={'redistributeEvery':1})
        initial = np.array(d['images'])
        seen, checkpoints = [], []
        raw = b.relax(d, curved_well)
        def transient(i, p):
            seen.append((i, p.copy()))
            if i == 1 and np.allclose(p, raw['images'][i], rtol=0, atol=1e-14):
                raise b.SCFConvergenceError('SCF did not converge at this trial')
            return curved_well(i, p)
        with_cache = b.ExactEvaluationCache(transient, workers=3)
        try:
            result = b.relax(d, with_cache, lambda event: checkpoints.append(event['bandCheckpoint'])
                             if 'bandCheckpoint' in event else None)
            self.assertEqual(with_cache.calls, len(seen))
        finally:
            with_cache.close()
        self.assertEqual(result['scfStepRetries'], 1)
        self.assertEqual(len(checkpoints), 2)
        final = np.array(result['images'])
        self.assertGreater(b.force_max(final-initial), 0)
        self.assertLessEqual(b.force_max(final-initial), d['maxMove']*.5 + 1e-12)
        self.assertEqual(result['evaluations'], 3*len(final))
        for i,p in enumerate(final):
            energy, forces = curved_well(i, p)
            self.assertEqual(energy, result['energies'][i])
            np.testing.assert_array_equal(forces, result['forces'][i])

    def test_exhausted_retry_preserves_last_evaluated_checkpoint(self):
        d = band('cineb', climbAfter=0, maxSteps=1)
        initial = np.array(d['images'])
        saved, events = [], []
        def unavailable(i, p):
            if not np.array_equal(p, initial[i]):
                raise b.SCFConvergenceError('trial did not converge')
            return curved_well(i, p)
        def progress(event):
            if 'bandCheckpoint' in event:
                saved.append(event['bandCheckpoint'])
            if event.get('phase'):
                events.append(event)
        with self.assertRaises(b.SCFConvergenceError):
            b.relax(d, unavailable, progress)
        self.assertEqual(len(saved), 1)
        np.testing.assert_array_equal(saved[0]['images'], initial)
        self.assertEqual(events[-1]['scfStepRetries'], 4)
        self.assertEqual(events[-1]['evaluations'], 6*len(initial))
        self.assertEqual(events[-1]['phase'], 'path_step_failed')

    def test_initial_failure_and_other_exceptions_are_not_retried(self):
        d = band('neb')
        for exception, fail_on_trial in [(b.SCFConvergenceError, False), (ValueError, True),
                                         (TimeoutError, True), (RuntimeError, True)]:
            calls, retries = [], []
            def fail(i, p):
                calls.append(i)
                if not fail_on_trial or not np.array_equal(p, d['images'][i]):
                    raise exception('error')
                return well(i, p)
            with self.assertRaises(exception):
                b.relax(d, fail, lambda event: retries.append(event)
                        if event.get('phase') == 'path_step_retry' else None)
            self.assertFalse(retries)
            self.assertEqual(len(calls), len(d['images']) + 1 if fail_on_trial else 1)
