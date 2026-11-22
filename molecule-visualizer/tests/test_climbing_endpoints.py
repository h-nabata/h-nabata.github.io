"""Physical forces, free endpoints, and the highest image on analytic surfaces."""
import unittest

import numpy as np

from test_engine import b, well
from test_lup import curved_well


def request(mode, images, **settings):
    return dict(symbols=['He'], mode=mode, images=np.asarray(images).tolist(),
                maxSteps=1000, climbAfter=5, fmax=2e-4, maxMove=.04, spring=1.,
                **settings)


def straight_band(xs):
    return [[[x, 0., 0.]] for x in xs]


def curvature(positions):
    # Differentiate the analytic physical force independently of the path solver.
    positions = np.asarray(positions)
    changes = np.eye(3)[:, None, :] * 1e-5
    hessian = [(curved_well(0, positions-d)[1]-curved_well(0, positions+d)[1]).ravel()/2e-5
               for d in changes]
    return np.linalg.eigvalsh(hessian)


class ClimbingEndpoints(unittest.TestCase):
    def test_endpoint_mode_validates_and_defaults_to_fixed(self):
        images = straight_band([-1., 0., 1.])
        for mode in ('cineb', 'lup'):
            base = request(mode, images)
            self.assertEqual(b.validate(base, 'tblite')['endpointMode'], 'fixed')
            for choice in ('fixed', 'relax'):
                self.assertEqual(b.validate({**base, 'endpointMode':choice}, 'tblite')['endpointMode'], choice)
            for invalid in (None, False, True, 'free', []):
                with self.subTest(mode=mode, invalid=invalid), self.assertRaises(ValueError):
                    b.validate({**base, 'endpointMode':invalid}, 'tblite')
        for mode in ('evaluate', 'perpendicular', 'neb'):
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                b.validate(request(mode, images, endpointMode='relax'), 'tblite')

    def test_displaced_crest_and_endpoints_on_curved_double_well(self):
        # (±1, 0, 0) are minima. The first-order saddle is (0, 0.4, 0).
        xs = np.array([-1.16, -.85, -.57, -.30, .16, .53, .83, 1.13])
        ys = .4*(1-xs*xs) + .05
        ys[[0, -1]] += [.18, -.23]
        images = np.stack((xs, ys, .07*xs), axis=1)[:, None, :]
        ends = [0, len(images)-1]
        initial_ends = [curved_well(0, images[i])[0] for i in ends]
        for mode, optimizer in [('cineb', 'fire'), ('lup', 'lbfgs'), ('lup', 'fire')]:
            for choice in ('fixed', 'relax'):
                with self.subTest(mode=mode, optimizer=optimizer, endpoints=choice):
                    data = b.validate(request(mode, images, endpointMode=choice, optimizer=optimizer), 'tblite')
                    result = b.relax(data, curved_well)
                    self.assertTrue(result['converged'], result['reason'])
                    self.assertEqual(result['endpointMode'], choice)
                    final = np.array(result['images'])
                    energies = np.array(result['energies'])
                    crest = result['climbingImage']
                    self.assertEqual(crest, np.argmax(energies))
                    np.testing.assert_allclose(final[crest], [[0., .4, 0.]], atol=1e-4)
                    np.testing.assert_allclose(curvature(final[crest]), [-4., 2., 6.], atol=1e-3)
                    self.assertLessEqual(result['diagnostics']['climbingPhysicalFmax'], data['fmax'])
                    self.assertTrue(result['diagnostics']['climbingBracketed'])
                    self.assertEqual(result['nodeIds'][0], 'node-0')
                    self.assertEqual(result['nodeIds'][-1], f'node-{len(images)-1}')
                    # Re-evaluate coordinates independently so a stale endpoint cache cannot pass.
                    for i, pos in enumerate(final):
                        energy, force = curved_well(i, pos)
                        self.assertAlmostEqual(energy, energies[i], places=12)
                        np.testing.assert_allclose(force, result['forces'][i], atol=1e-12)
                    physical = np.array(result['forces'])[ends]
                    end_forces = np.linalg.norm(physical[:, 0, :], axis=1)
                    np.testing.assert_allclose(result['diagnostics']['endpointPhysicalFmax'], end_forces)
                    active = np.array(result['forceComponents']['effective'])[ends]
                    if choice == 'relax':
                        np.testing.assert_allclose(active, physical, atol=1e-12)
                        np.testing.assert_allclose(final[ends, 0], [[-1., 0., 0.], [1., 0., 0.]], atol=2e-4)
                        self.assertTrue(np.all(energies[ends] < np.array(initial_ends)-.05))
                        self.assertTrue(np.all(end_forces <= data['fmax']))
                        self.assertTrue(all(curvature(final[i]).min() > 0. for i in ends))
                    else:
                        np.testing.assert_array_equal(active, 0.)
                        np.testing.assert_array_equal(final[ends], images[ends])
                        self.assertTrue(np.all(end_forces > .1))

    def test_zero_preclimb_band_force_still_activates_and_moves_off_saddle_crest(self):
        images = straight_band([-.8, -.3, .2, .7, 1.2])
        for mode in ('cineb', 'lup'):
            with self.subTest(mode=mode):
                data = b.validate(request(mode, images), 'tblite')
                result = b.relax(data, well)
                before = result['history'][0]
                self.assertIsNone(before['climbingImage'])
                self.assertLess(before['fmax'], 1e-12)
                self.assertTrue(result['converged'])
                self.assertGreater(result['steps'], data['climbAfter'])
                self.assertEqual(result['climbingImage'], 2)
                self.assertGreater(result['energies'][2], well(2, np.array(images[2]))[0]+.05)
                np.testing.assert_allclose(result['images'][2], [[0., 0., 0.]], atol=6e-5)

    def test_string_redistribution_respects_updated_ends_and_climbing_image(self):
        images = straight_band([-1.10, -.70, -.24, .18, .44, .85, 1.12])
        base = {**request('lup', images, endpointMode='relax'), 'maxSteps':1, 'climbAfter':0, 'maxMove':.2}
        def single_step(every):
            data = b.validate({**base, 'lup':{'redistributeEvery':every}}, 'tblite')
            return b.relax(data, well)
        redistributed = single_step(1)
        reference = single_step(2)
        self.assertEqual(redistributed['history'][0]['climbingImage'], 3)
        new, old = np.array(redistributed['images']), np.array(images)
        anchors, other = [0, 3, 6], [1, 2, 4, 5]
        np.testing.assert_allclose(new[anchors], np.array(reference['images'])[anchors], atol=1e-12)
        self.assertTrue(np.all(np.abs(new[anchors, 0, 0] - old[anchors, 0, 0]) > 1e-3))
        self.assertGreater(np.max(np.abs(new[other] - np.array(reference['images'])[other])), .01)

    def test_resumed_band_keeps_endpoint_setting_and_its_optimizer_state(self):
        images = straight_band([-1.12, -.50, .18, .65, 1.13])
        for mode in ('cineb', 'lup'):
            for choice in ('fixed', 'relax'):
                with self.subTest(mode=mode, endpoints=choice):
                    raw = {**request(mode, images, endpointMode=choice), 'maxSteps':8, 'climbAfter':1}
                    data = b.validate(raw, 'tblite')
                    expected = b.relax(data, well)
                    saved = []
                    b.relax({**data, 'maxSteps':4}, well,
                            lambda event: saved.append(event['bandCheckpoint']) if 'bandCheckpoint' in event else None)
                    checkpoint = saved[-1]
                    self.assertEqual(checkpoint['endpointMode'], choice)
                    state = checkpoint['optimizerState'].copy()
                    self.assertEqual(state['endpointMode'], choice)
                    if choice == 'fixed':
                        del state['endpointMode']  # Legacy checkpoint created before this setting existed.
                    restart = {**data, 'images':checkpoint['images'], 'nodeIds':checkpoint['nodeIds'],
                               'maxSteps':4, '_optimizerResume':state}
                    resumed = b.relax(restart, well)
                    np.testing.assert_allclose(resumed['images'], expected['images'], atol=1e-12, rtol=0.)
                    wrong_mode = 'fixed' if choice == 'relax' else 'relax'
                    with self.assertRaises(ValueError):
                        b.relax({**restart, 'endpointMode':wrong_mode}, well)

    def test_unbracketed_stationary_band_is_not_a_resolved_peak(self):
        def monotone(_, image):
            x = image[0, 0]
            return x**7/7-2*x**5/5+x**3/3, np.array([[-x*x*(x*x-1)**2, 0., 0.]])
        def flat(_, image):
            return 0., np.zeros_like(image)
        images = straight_band([-1., 0., 1.])
        for mode in ('cineb', 'lup'):
            for potential in (flat, monotone):
                with self.subTest(mode=mode, potential=potential.__name__):
                    data = b.validate(request(mode, images), 'tblite')
                    result = b.relax(data, potential)
                    self.assertFalse(result['converged'])
                    self.assertEqual(result['reason'], 'no_resolved_peak')
                    self.assertFalse(result['diagnostics']['climbingBracketed'])
                    self.assertEqual(result['diagnostics']['climbingPhysicalFmax'], 0.)

    def test_ci_force_reflection_does_not_hide_an_excess_per_atom_force(self):
        # Reflection in a 3N tangent preserves the global norm, but can distribute
        # one atom's force over two atoms and reduce the maximum per-atom norm.
        theta = np.pi/8
        tangent = np.array([np.cos(theta), np.sin(theta)])
        normal = np.array([-tangent[1], tangent[0]])
        target_force = np.array([.118, 0.])
        q = target_force @ tangent / 2
        r = -target_force @ normal / 2
        centre = np.array([[0., 0., 0.], [0., 2., 0.]])
        images = np.array([centre.copy() for _ in range(3)])
        for image, position in zip(images, (-1., q, 1.)):
            image[:, 0] = position*tangent + r*normal
        def saddle(_, image):
            q, r = image[:, 0] @ tangent, image[:, 0] @ normal
            force = np.zeros_like(image)
            force[:, 0] = 2*q*tangent - 2*r*normal
            return -q*q+r*r, force
        for mode in ('cineb', 'lup'):
            with self.subTest(mode=mode):
                raw = {**request(mode, images), 'climbAfter':0, 'symbols':['He','He'], 'fmax':.1}
                result = b.relax(b.validate(raw,'tblite'), saddle)
                first = result['history'][0]
                self.assertLess(first['fmax'], .1)
                self.assertAlmostEqual(first['diagnostics']['climbingPhysicalFmax'], .118)
                self.assertTrue(result['converged'])
                self.assertGreater(result['steps'], 0)
                self.assertLessEqual(b.force_max(np.array(result['forces'][1])), .1)


if __name__ == '__main__':
    unittest.main()
