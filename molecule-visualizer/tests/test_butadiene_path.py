"""Mapped electrocyclic paths: classification and real engine band regression."""
import importlib.util
import os
import unittest
from unittest.mock import patch

import numpy as np

import benchmark_butadiene as b


class ButadienePaths(unittest.TestCase):
    def test_terminal_labels_and_geometry_invariance(self):
        _, dis = b.band('free', 0)
        _, con = b.band('con', 0)
        np.testing.assert_array_equal(dis[0], con[0])
        np.testing.assert_allclose(dis[-1], con[-1][[0, 1, 2, 3, 4, 5, 6, 7, 9, 8]], atol=1e-8)
        mirror = dis[:, b.MIRROR]*[-1, 1, 1]
        np.testing.assert_array_equal(dis, mirror)
        p = np.arange(len(dis), dtype=float)
        p[4] += 10
        self.assertEqual(b.geometry(dis, p)['bandClass'], 'dis')
        self.assertEqual(b.geometry(con, p)['bandClass'], 'con')
        rotation = [[0, 1, 0], [0, 0, 1], [1, 0, 0]]
        for band in (dis, con):
            angles = b.terminal_angles(band[4])
            np.testing.assert_allclose(angles, b.terminal_angles(band[4]@rotation + [7., -2., 3.]))
            self.assertAlmostEqual(b.geometry(band, p)['maxMirrorErrorA'],
                                   b.geometry(band@rotation + [7., -2., 3.], p)['maxMirrorErrorA'])
            self.assertEqual(b.branch(b.terminal_angles(band[0])), 'unresolved')

    def test_twist_perturbs_only_the_interior_and_preserves_initial_branch(self):
        _, reference = b.band('free', 0)
        _, perturbed = b.band('free', 0, 35.)
        np.testing.assert_array_equal(reference[[0, -1]], perturbed[[0, -1]])
        profile = b.geometry(perturbed, np.arange(len(perturbed)))
        self.assertEqual(profile['bandClass'], 'dis')
        self.assertGreater(profile['maxMirrorErrorA'], .05)

    def test_asymmetric_native_regression_starts_with_seven_disrotatory_nodes(self):
        _, reference = b.band('free', 0)
        source = b.ROOT / 'tests/fixtures/butadiene-disrotatory-asymmetric.xyz'
        _, asymmetric = b.band('free', 0, source=source)
        np.testing.assert_array_equal(reference[[0, -1]], asymmetric[[0, -1]])
        profile = b.geometry(asymmetric, np.arange(len(asymmetric)))
        self.assertEqual(profile['imageClasses'][1:-1], ['dis'] * 7)
        self.assertGreaterEqual(np.min(profile['imageAnglesDeg'][1:-1]), 11. - 1e-7)

    def test_mixed_profile_is_localised_to_the_measured_node(self):
        _, dis = b.band('free', 0)
        _, con = b.band('con', 0)
        dis[3] = con[3]
        profile = [0., 1., 2., 3., 4., 5., 4., 3., 2.]
        sample = {'step':7, **b.geometry(dis, profile)}
        self.assertEqual(sample['bandClass'], 'mixed')
        self.assertEqual(sample['peakClass'], 'dis')
        self.assertEqual(b.first_event([sample], 'con')['images'], [4])
        self.assertIsNone(b.first_event([sample], 'peak'))

    def test_engine_failure_retains_last_fully_evaluated_band(self):
        def fail_after_checkpoint(data, cache, directory, progress):
            energies = [0., 1., 2., 3., 4., 3., 2., 1., 0.]
            progress({'step':0, 'bandCheckpoint':{'steps':0, 'evaluations':9,
                      'images':data['images'], 'energies':energies, 'effectiveFmax':2.}})
            progress({'step':1, 'phase':'path_step_failed','evaluations':44,'scfStepRetries':4})
            raise ValueError('single point calculation terminated\nSCF not converged in 250 cycles')
        with patch.object(b.bridge, 'TBLiteEngine'), patch.object(b.bridge, 'calculate_job', fail_after_checkpoint):
            result = b.run('lup', 'free', engine='tblite', distortion=0, steps=10, endpoint_mode='relax')
        self.assertEqual(result['reason'], 'failed')
        self.assertEqual(result['failure']['error'], 'SCF not converged in 250 cycles')
        self.assertEqual(len(result['failure']['lastCompleteBandA']), 9)
        self.assertEqual(result['steps'], 0)
        self.assertEqual(result['peakImage'], 5)
        self.assertEqual(result['evaluations'], 44)
        self.assertEqual(result['failure']['lastCompleteEvaluations'], 9)
        self.assertEqual(result['failure']['scfFailedStep'], 1)
        self.assertEqual(result['scfStepRetries'], 4)

    def test_large_labelled_turn_is_reported_separately_from_opposite_tilt(self):
        def sample(angles):
            classes = ['unresolved', b.branch(angles), 'dis', 'unresolved']
            return dict(peakImage=2, imageClasses=classes, peakClass=classes[1],
                        imageAnglesDeg=[[0.,0.], angles, [60.,60.], [90.,90.]])
        summary = b.rotation_summary([sample([46.,134.]), sample([65.,-145.]), sample([170.,-175.])])
        self.assertEqual(summary['conrotatoryPeakSteps'], 1)
        self.assertEqual(summary['anyConrotatoryInteriorSteps'], 1)
        self.assertEqual(summary['peakTurnOver100DegSteps'], 3)
        self.assertEqual(summary['maxAbsPeakTurnDeg'], 175.)
        self.assertAlmostEqual(summary['maxOppositePeakTiltDeg'], 35.)

    def test_posthoc_comparison_allows_equivalent_hydrogens_and_proper_rotation(self):
        reference = np.random.default_rng(74).normal(size=(10, 3))
        order = list(range(10))
        order[8], order[9] = order[9], order[8]
        rotation = np.array([[0., 1., 0.], [-1., 0., 0.], [0., 0., 1.]])
        peak = reference[order] @ rotation + [3., -2., 4.]
        match = b.reference_rmsd(peak, reference)
        self.assertLess(match['equivalentAtomRmsdA'], 1e-12)
        self.assertGreater(match['mappedRmsdA'], .1)
        self.assertEqual(match['matchedReferenceAtoms'], [i+1 for i in order])
        self.assertGreater(b.reference_rmsd(-peak, reference)['equivalentAtomRmsdA'], .1)

    def check_native_path(self, engine):
        options = dict(engine=engine, distortion=.015, steps=100, endpoint_mode='fixed')
        result = b.run('neb', 'mirror', **options)
        self.assertEqual(result['reason'], 'converged')
        self.assertLessEqual(result['fmaxEVPerA'], .05)
        self.assertEqual(result['bandClass'], 'dis')
        self.assertIsNone(result['firstConrotatoryInterior'])
        self.assertLess(result['maxMirrorErrorA'], 1e-8)
        self.assertGreater(result['barrierEV'], 1.)
        comparison = b.run('cineb', 'con', **options)
        self.assertEqual(comparison['reason'], 'converged')
        self.assertEqual(comparison['peakClass'], 'con')
        self.assertLess(comparison['barrierEV']+.3, result['barrierEV'])

    @unittest.skipUnless(importlib.util.find_spec('tblite'), 'native tblite required')
    def test_gfn2_mapped_paths(self):
        self.check_native_path('tblite')

    @unittest.skipUnless(os.environ.get('GXTB_TEST_BINARY'), 'explicit native g-xTB executable required')
    def test_gxtb_mapped_paths(self):
        self.check_native_path('gxtb')

    @unittest.skipUnless(os.environ.get('GXTB_TEST_BINARY'), 'explicit native g-xTB executable required')
    def test_gxtb_unrestricted_perturbed_neb(self):
        settings = dict(engine='gxtb', distortion=.015, steps=110, endpoint_mode='fixed')
        fire = b.run('neb', 'free', optimizer='fire', **settings)
        band = b.run('neb', 'free', optimizer='band-lbfgs', **settings)
        for result in (fire, band):
            self.assertEqual(result['reason'], 'converged')
            self.assertLessEqual(result['fmaxEVPerA'], .05)
            self.assertEqual(result['maxEndpointDisplacementA'], 0.)
            self.assertIsNone(result['initialMirrorCorrectionA'])
            self.assertIsNone(result['firstConrotatoryInterior'])
            self.assertEqual(result['peakClass'], 'dis')
        self.assertLess(band['calculatorCalls'], fire['calculatorCalls'])
        self.assertLess(abs(band['closingDistanceA'] - fire['closingDistanceA']), .03)
        self.assertLess(abs(band['barrierEV'] - fire['barrierEV']), .03)

    @unittest.skipUnless(os.environ.get('GXTB_TEST_BINARY'), 'explicit native g-xTB executable required')
    def test_gxtb_explicitly_projects_asymmetric_string(self):
        options = dict(engine='gxtb', distortion=0., steps=50, endpoint_mode='fixed',
                       source=b.ROOT / 'tests/fixtures/butadiene-disrotatory-asymmetric.xyz')
        rejected = b.run('lup', 'mirror', **options)
        self.assertEqual(rejected['reason'], 'failed')
        self.assertEqual(rejected['trace'], [])
        projected = b.run('lup', 'mirror', **options, mirror_tolerance=.71)
        self.assertIn(projected['reason'], ('step_limit', 'converged'))
        self.assertGreater(projected['initialMirrorCorrectionA'], .69)
        self.assertEqual(projected['maxEndpointDisplacementA'], 0.)
        self.assertEqual(projected['bandClass'], 'dis')
        self.assertIsNone(projected['firstConrotatoryInterior'])
        self.assertLess(max(node['maxMirrorErrorA'] for node in projected['trace']), 1e-8)
