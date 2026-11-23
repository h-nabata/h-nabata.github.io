"""Unconstrained tests on a curved analytic saddle and an independent molecular torsion."""
import os
from pathlib import Path
import tempfile
import unittest

import numpy as np
from ase import Atoms

from test_dsafir import mb_coordinates, mb_geometry, mb_potential
from test_engine import b


def muller_brown_input(mode, optimizer, endpoints):
    left = np.array([-.5582236346, 1.441725842])
    right = np.array([-.050010823, .466694104])
    if endpoints == 'relax':
        left += [.04, -.04]
        right += [.055, -.05]
    fraction = np.linspace(0., 1., 9)
    coordinates = left + (right-left)*fraction[:, None] + np.sin(np.pi*fraction[:, None])*[-.11, .13]
    images = np.stack([mb_geometry(x, y) for x, y in coordinates])
    return dict(symbols=['He']*4, images=images.tolist(), mode=mode, optimizer=optimizer,
                maxSteps=300, climbAfter=5, spring=1., maxMove=.03, fmax=.005, endpointMode=endpoints)


def ethane_input(mode, optimizer):
    # Track one H from each methyl group through the eclipsed (0°) geometry.
    # Both endpoint geometries, both methyl groups and the C-C stretch are mobile.
    images = []
    for phase, dihedral in zip(np.linspace(0., np.pi, 9), np.linspace(-62., 65., 9)):
        cc = 1.57 + .06*np.sin(phase)
        frame = [[-cc/2, 0., 0.], [cc/2, 0., 0.]]
        for side in (-1., 1.):
            for hydrogen in range(3):
                theta = np.deg2rad(120.*hydrogen + side*dihedral/2)
                radius = 1.1*np.sqrt(8./9.)
                frame.append([side*(cc/2 + 1.1/3.), radius*np.cos(theta), radius*np.sin(theta)])
        images.append(frame)
    return dict(symbols=list('CCHHHHHH'), images=images, mode=mode, optimizer=optimizer,
                maxSteps=450, climbAfter=5, spring=1., maxMove=.03, fmax=.01, endpointMode='relax')


def ethane_result(mode, optimizer, binary):
    job = b.validate(ethane_input(mode, optimizer), 'gxtb')
    with tempfile.TemporaryDirectory() as directory:
        calculator = b.GXTBEngine(job, {'binary':str(Path(binary).resolve()), 'evaluationTimeout':120}, directory)
        cache = b.ExactEvaluationCache(calculator, workers=2)
        try:
            return b.calculate_job(job, cache, directory)
        finally:
            cache.close()


class UnrestrictedPathControls(unittest.TestCase):
    def test_curved_saddle_fixed_and_mobile_ends(self):
        for mode in ('cineb', 'lup'):
            for endpoints in ('fixed', 'relax'):
                with self.subTest(mode=mode, endpoints=endpoints):
                    raw = muller_brown_input(mode, 'band-lbfgs', endpoints)
                    result = b.relax(b.validate(raw, 'tblite'), mb_potential)
                    self.assertTrue(result['converged'], result['reason'])
                    positions = np.asarray(result['images'])
                    peak = result['climbingImage']
                    np.testing.assert_allclose(mb_coordinates(positions[peak]), [-.822002, .624313], atol=.001)
                    self.assertAlmostEqual(result['energies'][peak], -.4066484, delta=3e-5)
                    self.assertLessEqual(result['effectiveFmax'], raw['fmax'])
                    if endpoints == 'fixed':
                        np.testing.assert_array_equal(positions[[0,-1]], np.array(raw['images'])[[0,-1]])
                    else:
                        self.assertLessEqual(max(result['diagnostics']['endpointPhysicalFmax']), raw['fmax'])
                        np.testing.assert_allclose(mb_coordinates(positions[0]), [-.558224, 1.441726], atol=.002)
                        np.testing.assert_allclose(mb_coordinates(positions[-1]), [-.050011, .466694], atol=.004)
                    if mode == 'cineb':
                        previous = b.relax(b.validate({**raw, 'optimizer':'fire'}, 'tblite'), mb_potential)
                        self.assertTrue(previous['converged'])
                        self.assertLess(result['evaluations'], previous['evaluations'])

    def test_rotating_and_translating_the_band_preserves_the_updates(self):
        raw = muller_brown_input('cineb', 'band-lbfgs', 'relax')
        data = b.validate(raw, 'tblite')
        direct = b.relax(data, mb_potential)
        rotation = np.array([[0., 1., 0.], [-1., 0., 0.], [0., 0., 1.]])
        translation = np.array([.82, -1.33, 2.24])
        raw['images'] = (np.asarray(raw['images']) @ rotation + translation).tolist()
        rotated = b.relax(b.validate(raw, 'tblite'), mb_potential)
        self.assertTrue(rotated['converged'])
        self.assertEqual(direct['steps'], rotated['steps'])
        np.testing.assert_allclose(np.asarray(direct['images']) @ rotation + translation,
                                   rotated['images'], atol=2e-9, rtol=0)

    @unittest.skipUnless(os.environ.get('GXTB_TEST_BINARY'), 'requires official native g-xTB binary')
    def test_gxtb_mobile_end_ethane_torsion(self):
        for mode in ('cineb', 'lup'):
            with self.subTest(mode=mode):
                result = ethane_result(mode, 'band-lbfgs', os.environ['GXTB_TEST_BINARY'])
                self.assertTrue(result['converged'], result['reason'])
                fmax = .01
                self.assertLessEqual(result['effectiveFmax'], fmax)
                self.assertLessEqual(result['diagnostics']['climbingPhysicalFmax'], fmax)
                self.assertLessEqual(max(result['diagnostics']['endpointPhysicalFmax']), fmax)
                peak = result['climbingImage']
                images = np.asarray(result['images'])
                angles = [Atoms('C2H6', positions=images[i]).get_dihedral(2, 0, 1, 5) for i in (0, peak, -1)]
                self.assertAlmostEqual(angles[0], 300., delta=4.)
                self.assertAlmostEqual(angles[-1], 60., delta=4.)
                self.assertLess(min(angles[1], 360.-angles[1]), 4.)
                self.assertGreater(result['energies'][peak] - result['energies'][0], .03)
