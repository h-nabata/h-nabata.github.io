"""Reflection-constrained bands in arbitrary Cartesian coordinates.

Atoms 0/1 exchange across the mirror. Atom 2 lies on it. Its y coordinate
crosses a double well, and x breaks reflection symmetry. At (0,0,1.2)
the unbiased PES has two negative curvatures, one within the mirror and
one outside it. These are analytic tests of the path solver, not a model
of the electronic energy of butadiene.
"""
import copy
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from scipy.spatial.transform import Rotation

from test_engine import b, CONFIG


MIRROR = {'type': 'mirror', 'pairs': [[0, 1]]}
ROTATION = Rotation.from_rotvec([.4, -.77, .35]).as_matrix()
ORIGIN = np.array([1.1, -3.5, 2.7])
PAIR = np.array([[-1., 0., 0.], [1., 0., 0.]])


def request(mode, ys, odd=0., **options):
    frames = []
    for y in ys:
        frame = np.vstack((PAIR, [odd * (1 - y*y), y, 1.2]))
        frames.append((frame @ ROTATION.T + ORIGIN).tolist())
    return dict(symbols=['H', 'H', 'He'], images=frames, mode=mode, spring=1.,
                maxMove=.05, maxSteps=550, fmax=.0003, climbAfter=2,
                pathSymmetry=copy.deepcopy(MIRROR), **options)


def surface(field=0.):
    def calculate(i, positions):
        local = (positions - ORIGIN) @ ROTATION
        x, y, z = local[2]
        offsets = local[:2] - PAIR
        energy = .5*np.sum(offsets**2) + (y*y-1)**2 + .5*(3*y*y-1)*x*x + .25*x**4 + (z-1.2)**2 - field*x
        force = np.vstack((-offsets, [field-(3*y*y-1)*x-x**3, -4*y*(y*y-1)-3*y*x*x, -2*(z-1.2)]))
        return float(energy), force @ ROTATION.T
    return calculate


def residual(frames):
    local = (np.asarray(frames) - ORIGIN) @ ROTATION
    reflected = local[..., 0, :] * [-1., 1., 1.]
    return max(.5*np.max(np.linalg.norm(reflected - local[..., 1, :], axis=-1)),
               np.max(np.abs(local[..., 2, 0])))


class MirrorPaths(unittest.TestCase):
    def test_initial_projection_limit_is_explicit_and_retains_the_original_correction(self):
        seed = request('cineb', [-1., -.5, 0., .5, 1.], odd=.42, livePreview=True)
        with self.assertRaisesRegex(ValueError, r'最大0\.4.*上限は0\.05 Å'):
            b.validate(seed, 'tblite')
        enlarged = {**seed, 'pathSymmetry': {**MIRROR, 'maxInitialCorrection':.45}}
        data = b.validate(enlarged, 'tblite')
        self.assertEqual(data['images'], seed['images'])
        events = []
        result = b.relax(data, surface(), events.append)
        projected = next(e['preview']['images'] for e in events if 'preview' in e)
        actual = np.linalg.norm(np.array(projected) - seed['images'], axis=-1).max()
        self.assertAlmostEqual(actual, .42)
        self.assertEqual(result['initialSymmetryCorrection'], actual)
        for event in events:
            for key in ('preview', 'bandCheckpoint'):
                if key in event:
                    self.assertEqual(event[key]['initialSymmetryCorrection'], actual)
        np.testing.assert_array_equal(np.array(result['images'])[[0, -1]], np.array(seed['images'])[[0, -1]])
        self.assertEqual(result['pathSymmetry'], enlarged['pathSymmetry'])
        resumed = b.relax({**data, 'images':result['images'], '_optimizerResume':result['optimizerState']}, surface())
        self.assertEqual(resumed['initialSymmetryCorrection'], actual)

        # The adjustable bound never permits altering fixed ends.
        bad_end = copy.deepcopy(enlarged)
        bad_end['images'][0][2] = (np.array(bad_end['images'][0][2]) + .03*ROTATION[:, 0]).tolist()
        with self.assertRaisesRegex(ValueError, '固定端点.*1e-6'):
            b.validate(bad_end, 'tblite')

    def test_zero_limit_accepts_symmetric_coordinates_and_bounds_must_be_finite(self):
        ideal = request('lup', [-1., 0., 1.])
        for limit in (0., 2.):
            spec = {**MIRROR, 'maxInitialCorrection':limit}
            self.assertEqual(b.validate({**ideal, 'pathSymmetry':spec}, 'tblite')['pathSymmetry'], spec)
        for limit in (-.01, 2.01, float('inf'), float('nan'), True, None, '0.2'):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                b.validate({**ideal, 'pathSymmetry':{**MIRROR, 'maxInitialCorrection':limit}}, 'tblite')
        # Sub-tolerance imperfections in the untouched fixed ends are not
        # counted towards the adjustable bound on actual coordinate changes.
        frames = np.array(ideal['images'])
        frames[0, :2] += 4e-7 * ROTATION[:, 0]
        frames[-1, :2] -= 4e-7 * ROTATION[:, 0]
        data = b.validate({**ideal, 'images':frames.tolist(), 'pathSymmetry':{**MIRROR, 'maxInitialCorrection':0.}}, 'tblite')
        result = b.relax(data, surface())
        self.assertLess(result['initialSymmetryCorrection'], 1e-13)
        self.assertGreater(result['diagnostics']['symmetryResidual'], 3e-7)
        np.testing.assert_array_equal(np.array(result['images'])[[0, -1]], frames[[0, -1]])

    def test_involution_and_merely_nearby_paths_are_validated(self):
        options = request('cineb', [-1., 0., 1.])
        self.assertEqual(b.validate(options, 'tblite')['pathSymmetry'], MIRROR)
        for pairs in ([], [[0, 0]], [[0, 2]], [[0, 1], [1, 0]],
                      [[0, 1], [1, 2]], [[0, 3]], [[-1, 1]], [[False, 1]], [[0]], [0, 1]):
            with self.subTest(pairs=pairs), self.assertRaises(ValueError):
                b.validate({**options, 'pathSymmetry': {'type':'mirror', 'pairs':pairs}}, 'tblite')
        for absolute_distortion in (.08, .7):
            with self.subTest(distortion=absolute_distortion), self.assertRaises(ValueError):
                b.validate(request('cineb', [-1., 0., 1.], odd=absolute_distortion), 'tblite')
        perturbed_end = copy.deepcopy(options)
        perturbed_end['images'][0][2] = (np.array(perturbed_end['images'][0][2]) + .03*ROTATION[:,0]).tolist()
        with self.assertRaises(ValueError):
            b.validate(perturbed_end, 'tblite')
        for extra in ({'cell': {'vectors':(10*np.eye(3)).tolist(), 'pbc':[True,False,False]}},
                      {'mode':'evaluate'}, {'mode':'perpendicular'}):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                b.validate({**options, **extra}, 'tblite')
        # Distinct adjacent frames can coincide after projecting onto the mirror.
        duplicated = request('cineb', [-1., 0., 0., 1.])
        duplicated['images'][1][2] = (np.array(duplicated['images'][1][2]) + .01*ROTATION[:,0]).tolist()
        with self.assertRaises(ValueError):
            b.validate(duplicated, 'tblite')
        # Both He atoms belong on the plane. Their actual distance is >0.1 Å;
        # projection would reduce it to 0.08 Å on the interior image.
        collide = request('neb', [-1., 0., 1.])
        collide['symbols'].append('He')
        for idx, frame in enumerate(collide['images']):
            local = (np.asarray(frame) - ORIGIN) @ ROTATION
            new_atom = local[2] + [0., .3, 0.]
            if idx == 1:
                new_atom = local[2] + [-.045, .08, 0.]
                local[2, 0] = .045
            collide['images'][idx] = (np.vstack([local, new_atom]) @ ROTATION.T + ORIGIN).tolist()
        unrestricted = {k:v for k,v in collide.items() if k != 'pathSymmetry'}
        b.validate(unrestricted, 'tblite')
        with self.assertRaises(ValueError):
            b.validate(collide, 'tblite')

    def test_rotated_band_remains_on_requested_branch_at_every_evaluation(self):
        xs = np.linspace(-1, 1, 7)
        for mode, optimizer in [('neb','fire'), ('cineb','fire'), ('lup','fire'), ('lup','lbfgs')]:
            with self.subTest(mode=mode, optimizer=optimizer):
                entry = request(mode, xs, odd=.014, livePreview=True)
                if mode == 'lup':
                    entry.update(optimizer=optimizer, lup={'redistributeEvery':1})
                data = b.validate(entry, 'tblite')
                steps = []
                calculate = surface(field=.18)

                def checked(i, pos):
                    self.assertLess(residual(pos), 2e-12)
                    return calculate(i, pos)

                result = b.relax(data, checked, steps.append)
                self.assertTrue(result['converged'], result['reason'])
                self.assertEqual(result['pathSymmetry'], MIRROR)
                np.testing.assert_array_equal(np.array(result['images'])[[0, -1]], np.array(entry['images'])[[0, -1]])
                for key in ('bandCheckpoint', 'preview'):
                    bands = [event[key]['images'] for event in steps if key in event]
                    self.assertEqual(len(bands), len(result['history']))
                    for band in bands:
                        self.assertLess(residual(band), 2e-12)
                diagnostics = result['diagnostics']
                self.assertLess(diagnostics['symmetryResidual'], 2e-12)
                self.assertGreater(diagnostics['symmetryRemovedFmax'], .17)
                if mode != 'neb':
                    self.assertLessEqual(diagnostics['climbingAllowedFmax'], data['fmax'])
                    self.assertGreater(diagnostics['climbingPhysicalFmax'], .17)
                    self.assertTrue(diagnostics['climbingBracketed'])
                forces = {name:np.array(values) for name,values in result['forceComponents'].items()}
                self.assertGreater(np.max(np.abs(forces['constraintCorrection'])), .05)
                total = sum(forces[name] for name in ('physical', 'tangentRemoval', 'spring',
                                                      'climbingCorrection', 'constraintCorrection'))
                np.testing.assert_allclose(total, forces['effective'], atol=1e-12)
                # The result and its energy are for the evaluated geometry; it
                # retains physical forces that are excluded from the search.
                for i, pos in enumerate(result['images']):
                    energy, force = calculate(i, np.array(pos))
                    self.assertAlmostEqual(result['energies'][i], energy, places=12)
                    np.testing.assert_allclose(result['forces'][i], force, atol=1e-12)

    def test_no_constraint_allows_the_unstable_transverse_mode_to_grow(self):
        for mode in ('cineb', 'lup'):
            entry = request(mode, np.linspace(-1, 1, 9), odd=.014)
            del entry['pathSymmetry']
            data = b.validate(entry, 'tblite')
            result = b.relax(data, surface())
            with self.subTest(mode=mode):
                self.assertNotIn('pathSymmetry', result)
                self.assertTrue(result['converged'], result['reason'])
                self.assertGreater(residual(result['images']), .6)
                self.assertLess(max(result['energies']), .85)

    def test_free_endpoints_follow_only_allowed_force(self):
        for mode in ('cineb', 'lup'):
            seed = request(mode, [-1.12, -.45, .08, .5, 1.15], endpointMode='relax')
            result = b.relax(b.validate(seed, 'tblite'), surface(field=.18))
            with self.subTest(mode=mode):
                self.assertTrue(result['converged'], result['reason'])
                self.assertLess(residual(result['images']), 2e-12)
                ends = (np.array(result['images'])[[0, -1], 2] - ORIGIN) @ ROTATION
                np.testing.assert_allclose(ends, [[0., -1., 1.2], [0., 1., 1.2]], atol=.0002)
                self.assertGreater(min(result['diagnostics']['endpointPhysicalFmax']), .17)
                self.assertLessEqual(max(result['diagnostics']['endpointAllowedFmax']), seed['fmax'])

    def test_string_resume_reuses_the_same_tilted_plane_and_dynamics(self):
        entry = request('lup', [-1.13, -.6, -.14, .23, .49, 1.11], odd=.013,
                        endpointMode='relax', optimizer='fire', lup={'redistributeEvery':2})
        entry['maxSteps'] = 8
        data = b.validate(entry, 'tblite')
        potential = surface(field=.18)
        reference = b.relax(data, potential)
        short = b.relax({**data, 'maxSteps':4}, potential)
        state = short['optimizerState']
        self.assertEqual(state['pathSymmetry'], MIRROR)
        restart = {**data, 'maxSteps':4, 'images':short['images'], 'nodeIds':short['nodeIds'],
                   '_optimizerResume':state}
        resumed = b.relax(restart, potential)
        self.assertEqual(state['mirrorPlane'], resumed['optimizerState']['mirrorPlane'])
        self.assertGreater(short['initialSymmetryCorrection'], .001)
        self.assertEqual(short['initialSymmetryCorrection'], resumed['initialSymmetryCorrection'])
        np.testing.assert_allclose(resumed['images'], reference['images'], atol=2e-12, rtol=0.)
        mismatch = copy.deepcopy(restart)
        del mismatch['pathSymmetry']
        with self.assertRaises(ValueError):
            b.relax(mismatch, potential)

    def test_adaptive_checkpoint_and_persistent_restart_preserve_the_constraint(self):
        source = request('cineb', [-1., .25, 1.], odd=.012, livePreview=True,
                         adaptiveNEB={'maxImages':7, 'interval':1, 'maxSpacing':.4, 'energyGap':.2})
        source['maxSteps'] = 4
        data = b.validate(source, 'tblite')
        states = []
        calculate = surface(field=.18)
        with tempfile.TemporaryDirectory() as directory:
            result = b.calculate_job(data, calculate, directory, states.append)
            cp = [s['bandCheckpoint'] for s in states if 'bandCheckpoint' in s][-1]
            self.assertGreater(len(cp['images']), len(source['images']))
            self.assertEqual(cp['pathSymmetry'], MIRROR)
            self.assertLess(residual(cp['images']), 2e-12)
            self.assertEqual(cp['images'], result['images'])
            config = {**CONFIG, 'historyDir':directory}
            jobs = b.Jobs(config)
            with patch.object(jobs, '_launch_next'):
                record = jobs.start(data)
            job = jobs.jobs[record['id']]
            job.update(status='running', bandCheckpoint=cp)
            jobs._persist(job, force=True)
            restored = b.Jobs(config)
            recovered = restored.get(record['id'])
            self.assertEqual(recovered['result']['pathSymmetry'], MIRROR)
            self.assertEqual(recovered['result']['images'], cp['images'])
            with patch.object(restored, '_launch_next'):
                resumed = restored.resume(record['id'])
            self.assertEqual(resumed['resumeKind'], 'optimizer_state')
            self.assertEqual(resumed['data']['pathSymmetry'], MIRROR)
            continued = b.calculate_job(resumed['data'], calculate, directory)
            self.assertLess(residual(continued['images']), 2e-12)
            self.assertEqual(continued['nodeIds'], result['nodeIds'])
            self.assertEqual(continued['initialSymmetryCorrection'], result['initialSymmetryCorrection'])
            pending = next(s['bandCheckpoint'] for s in states if 'bandCheckpoint' in s and 'optimizerState' not in s['bandCheckpoint'])
            job.update(status='interrupted', bandCheckpoint=pending)
            jobs._recover_partial(job)
            with patch.object(jobs, '_launch_next'):
                geometry_restart = jobs.resume(record['id'])
            self.assertEqual(geometry_restart['resumeKind'], 'geometry')
            continued = b.calculate_job(geometry_restart['data'], calculate, directory)
            self.assertEqual(continued['initialSymmetryCorrection'], result['initialSymmetryCorrection'])


if __name__ == '__main__':
    unittest.main()
