"""Adaptive CI-NEB retains node identities, endpoints and conservative forces."""
import copy
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'local-engine'))
import bridge as b


def well(index, positions):
    x, y, z = positions[0]
    return (x*x-1)**2 + 2*y*y + z*z, np.array([[-4*x*(x*x-1), -4*y, -2*z]])


def band():
    return {'images': [[[-1., 0., 0.]], [[.25, .15, 0.]], [[1., 0., 0.]]],
            'mode': 'cineb', 'maxSteps': 1000, 'fmax': 1e-4, 'spring': 1.,
            'maxMove': .03, 'climbAfter': 5, 'nodeIds': ['reactant', 'guess', 'product'],
            'adaptiveNEB': {'enabled': True, 'maxImages': 17, 'interval': 5,
                            'maxSpacing': .3, 'energyGap': .3}, 'livePreview': True}


class AdaptiveValidation(unittest.TestCase):
    def test_request_validation_and_defaults(self):
        normalized = {'images': band()['images'], 'mode': 'cineb'}
        result = b.validate_adaptive_neb({'adaptiveNEB': {}, 'pathSplit': {}}, normalized)
        self.assertIs(result, normalized)
        self.assertEqual(result['adaptiveNEB']['maxImages'], 30)
        self.assertEqual(result['pathSplit']['smoothingWindow'], 3)
        for patch in ({'adaptiveNEB': {'maxImages': 2}}, {'adaptiveNEB': {'interval': 0}},
                      {'adaptiveNEB': {'maxSpacing': 0}}, {'adaptiveNEB': {'energyGap': float('nan')}},
                      {'adaptiveNEB': {'enabled': 1}}, {'pathSplit': {'smoothingWindow': 2}},
                      {'pathSplit': {'minSeparation': 1}}, {'pathSplit': {'command': 'no'}},
                      {'nodeIds': ['a', 'a', 'b']}, {'nodeIds': ['a', '../b', 'c']}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                b.validate_adaptive_neb(patch, {'images': band()['images'], 'mode': 'cineb'})
        with self.assertRaises(ValueError):
            b.validate_adaptive_neb({'adaptiveNEB': {}}, {'images': band()['images'], 'mode': 'optimize'})

    def test_resume_ids_are_kept_and_new_ids_never_collide(self):
        data = band()
        data['nodeIds'] = ['inserted-0', 'inserted-1', 'inserted-2']
        data['maxSteps'] = 1
        data['climbAfter'] = 0
        result = b.relax(data, well)
        self.assertEqual(len(result['nodeIds']), len(set(result['nodeIds'])))
        self.assertTrue(set(data['nodeIds']).issubset(result['nodeIds']))
        self.assertEqual(result['nodeIds'][0], 'inserted-0')
        self.assertEqual(result['nodeIds'][-1], 'inserted-2')


class AdaptiveNumerics(unittest.TestCase):
    def test_adaptive_ci_finds_saddle_preserves_endpoints_and_evaluated_energies(self):
        data = band()
        checkpoints, previews = [], []
        def progress(value):
            if 'bandCheckpoint' in value:
                checkpoints.append(value['bandCheckpoint'])
            if 'preview' in value:
                previews.append(value['preview'])
        result = b.relax(data, well, progress)
        self.assertTrue(result['converged'])
        self.assertGreater(len(result['images']), 3)
        self.assertLessEqual(len(result['images']), 17)
        self.assertGreater(len(result['insertions']), 0)
        self.assertTrue(set(data['nodeIds']).issubset(result['nodeIds']))
        np.testing.assert_array_equal(np.array(result['images'])[[0, -1]], np.array(data['images'])[[0, -1]])
        np.testing.assert_allclose(result['images'][result['climbingImage']], [[0., 0., 0.]], atol=5e-5)
        for positions, energy in zip(result['images'], result['energies']):
            self.assertAlmostEqual(well(0, np.array(positions))[0], energy, places=12)
        for frame in checkpoints + previews:
            self.assertEqual(len(frame['images']), len(frame['nodeIds']))
            self.assertEqual(len(frame['images']), len(frame['energies']))
            self.assertEqual(frame['nodeIds'][0], 'reactant')
            self.assertEqual(frame['nodeIds'][-1], 'product')
        components = {key: np.array(value) for key, value in result['forceComponents'].items()}
        total = sum(components[key] for key in ('physical', 'tangentRemoval', 'spring', 'climbingCorrection', 'constraintCorrection'))
        np.testing.assert_allclose(total, components['effective'], atol=1e-12)
        self.assertLess(result['diagnostics']['effectiveFmax'], data['fmax'])
        self.assertTrue(all(np.isfinite(h['diagnostics']['rmsForce']) for h in result['history']))

    def test_failed_insert_retains_fully_evaluated_original_band(self):
        data = band()
        saved, calls = [], 0
        def calculate(index, positions):
            nonlocal calls
            calls += 1
            if calls == 4:
                raise RuntimeError('new node SCF failure')
            return well(index, positions)
        with self.assertRaisesRegex(RuntimeError, 'SCF failure'):
            b.relax(data, calculate, lambda p: saved.append(p['bandCheckpoint']) if 'bandCheckpoint' in p else None)
        self.assertEqual(saved[-1]['images'], data['images'])
        self.assertEqual(saved[-1]['nodeIds'], data['nodeIds'])

    def test_colliding_midpoint_is_skipped_and_reported(self):
        left = np.array([[-1., 0., 0.], [1., 0., 0.]])
        right = np.array([[1., 0., 0.], [-1., 0., 0.]])
        self.assertIsNone(b.safe_band_midpoint(left, right))
        cell = {'vectors': [[2.,0,0],[0,2.,0],[0,0,2.]], 'pbc': [True,True,True]}
        self.assertIsNone(b.safe_band_midpoint(np.array([[0.,0,0],[2.,0,0]]), np.array([[0.,0,0],[2.,.02,0]]), cell))
        data = band()
        data.update(images=[left.tolist(), right.tolist(), (right+np.array([0.,1.,0.])).tolist()],
                    maxSteps=1, climbAfter=0)
        result = b.relax(data, lambda i,p: (0., np.zeros_like(p)))
        self.assertTrue(result['adaptiveStatus']['blockedIntervals'])
        self.assertEqual(result['adaptiveStatus']['blockedIntervals'][0]['reason'], 'midpoint_collision_or_duplicate')
        for image in result['images']:
            self.assertGreaterEqual(np.linalg.norm(np.array(image)[0]-image[1]), .1)

    def test_force_limit_and_node_limit_are_distinct(self):
        data = band()
        data['adaptiveNEB'].update(maxImages=3, maxSpacing=.01, energyGap=.001)
        result = b.relax(data, well)
        self.assertTrue(result['converged'])
        self.assertTrue(result['adaptiveStatus']['nodeLimitReached'])
        self.assertGreater(result['adaptiveStatus']['unresolvedIntervals'], 0)
        self.assertEqual(len(result['images']), 3)

    def test_decomposition_matches_ci_neb_and_fixed_atom_force(self):
        images = np.array([[[-1.,0,0]], [[.2,.1,0]], [[1.,0,0]]])
        calculated = [well(i,p) for i,p in enumerate(images)]
        energies = np.array([x[0] for x in calculated])
        physical = np.array([x[1] for x in calculated])
        for mode, climbing in [('neb', None), ('cineb', 1), ('perpendicular', None), ('evaluate', None)]:
            components, diag = b.band_force_components(images, energies, physical, mode, 1., climbing)
            expected = physical if mode == 'evaluate' else b.band_forces(images, energies, physical, mode, 1., climbing)[0]
            np.testing.assert_allclose(components['effective'], expected, atol=1e-12)
            self.assertAlmostEqual(diag['effectiveFmax'], b.force_max(expected))


class PathSegmentation(unittest.TestCase):
    def test_two_barriers_split_at_intermediate_and_flag_unrelaxed_endpoint(self):
        energies = [0., .6, 1., .2, -.1, .2, 1.2, .7, -.2]
        forces = np.zeros((len(energies), 1, 3))
        forces[4,0,0] = .1
        settings = {'enabled': True, 'prominence': .5, 'minSeparation': 2, 'smoothingWindow': 1}
        result = b.path_segments(energies, forces, [f'n{i}' for i in range(len(energies))], settings, .05)
        self.assertEqual(result['indices'], [0,4,8])
        self.assertEqual(result['segments'], [{'start':0,'end':4,'needsEndpointOptimization':True},
                                              {'start':4,'end':8,'needsEndpointOptimization':True}])
        self.assertFalse(result['minima'][0]['stationaryCandidate'])
        self.assertEqual(result['minima'][0]['nodeId'], 'n4')
        self.assertEqual(result['minima'][0]['energyEV'], -.1)

    def test_smoothing_and_prominence_reject_small_ripples(self):
        energies = [0., .6, 1., .99, 1.01, .6, 0., .6, 1., .6, 0.]
        forces = np.zeros((len(energies),1,3))
        settings = {'enabled': True, 'prominence': .3, 'minSeparation': 2, 'smoothingWindow': 3}
        result = b.path_segments(energies, forces, [str(i) for i in range(len(energies))], settings, .05)
        self.assertEqual(len(result['minima']), 1)
        self.assertIn(result['minima'][0]['index'], (6,7))
        self.assertTrue(result['minima'][0]['stationaryCandidate'])
        self.assertEqual(result['minima'][0]['energyEV'], energies[result['minima'][0]['index']])

    def test_plateau_yields_one_minimum_with_sufficient_nodes_in_segments(self):
        energies = [0., 1., .1, .1, .1, 1., 0.]
        settings = {'enabled':True, 'prominence':.2, 'minSeparation':2, 'smoothingWindow':1}
        result = b.path_segments(energies, np.zeros((7,1,3)), [str(i) for i in range(7)], settings, .05)
        self.assertEqual(result['indices'], [0,3,6])
        self.assertTrue(all(segment['end']-segment['start'] >= 2 for segment in result['segments']))

    def test_smoothed_valley_does_not_use_unsmoothed_maximum_as_boundary(self):
        energies = [0., 2., 0., 1., 0., 2., 0.]
        settings = {'enabled':True, 'prominence':.05, 'minSeparation':2, 'smoothingWindow':3}
        result = b.path_segments(energies, np.zeros((7,1,3)), [str(i) for i in range(7)], settings, .05)
        self.assertEqual(len(result['minima']), 1)
        self.assertIn(result['minima'][0]['index'], (2,4))
        self.assertNotIn(3, result['indices'])


if __name__ == '__main__':
    unittest.main()
