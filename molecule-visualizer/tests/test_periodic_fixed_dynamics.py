"""Frozen substrate regressions for fixed-cell path relaxation and dynamics."""
import unittest

import numpy as np
from test_engine import b, well


CELL = dict(vectors=[[5., 0., 0.], [1.5, 5., 0.], [0., 0., 18.]], pbc=[True, True, True])
SITE = np.array([2.75, 1.25, -.75])


def adsorbate_well(index, coordinates):
    np.testing.assert_array_equal(coordinates[0], SITE)
    energy, mobile_force = well(index, coordinates[1:])
    return energy + 6 * coordinates[0, 2], np.vstack(([0., 0., -6.], mobile_force))


def band(mode, optimizer='fire', adaptive=False):
    xs = np.array([-.98, -.4, .03, .6, 1.02])
    coordinates = [[SITE.tolist(), [x, .1*np.cos(x), .04]] for x in xs]
    request = dict(mode=mode, optimizer=optimizer, symbols=['Si', 'He'], atomIds=['substrate', 'adatom'],
                   fixedAtoms=[0], cell=CELL, images=coordinates, nodeIds=['a', 'b', 'c', 'd', 'e'],
                   maxSteps=1000, fmax=.001, maxMove=.05, spring=1., climbAfter=2)
    if mode in ('cineb', 'lup'):
        request['endpointMode'] = 'relax'
    if adaptive:
        request['adaptiveNEB'] = dict(enabled=True, interval=5, maxImages=7, maxSpacing=.4, energyGap=100)
    return b.validate(request, 'tblite')


class FrozenBand(unittest.TestCase):
    def test_fixed_band_reaches_saddle_with_nonzero_reaction_force(self):
        for mode, optimizer in [('neb','fire'), ('perpendicular','fire'), ('cineb','fire'),
                                ('cineb','band-lbfgs'), ('lup','fire'), ('lup','lbfgs'), ('lup','band-lbfgs')]:
            with self.subTest(mode=mode, optimizer=optimizer):
                data = band(mode, optimizer)
                result = b.relax(data, adsorbate_well)
                self.assertEqual(result['reason'], 'converged')
                self.assertEqual(result['nodeIds'], data['nodeIds'])
                self.assertEqual(result['fixedAtoms'], [0])
                diagnostics = result['diagnostics']
                self.assertEqual(diagnostics['physicalFmax'], 6.)
                self.assertLessEqual(diagnostics['perpendicularFmax'], data['fmax'] + 1e-10)
                components = result['forceComponents']
                raw, net = np.array(components['physical']), np.array(components['effective'])
                np.testing.assert_array_equal(raw[:, 0, 2], -6.)
                np.testing.assert_array_equal(net[:, 0], 0.)
                np.testing.assert_allclose(sum(np.array(v) for k, v in components.items() if k != 'effective'), net, atol=1e-12)
                if mode in ('cineb','lup'):
                    self.assertEqual(diagnostics['climbingPhysicalFmax'], 6.)
                    self.assertLessEqual(diagnostics['climbingAllowedFmax'], data['fmax'])
                    self.assertAlmostEqual(max(result['energies'])-result['energies'][0], 1., places=4)
                else:
                    np.testing.assert_array_equal(np.array(result['images'])[[0,-1]], np.array(data['images'])[[0,-1]])

    def test_mic_anchors_and_reject_genuinely_different_site(self):
        data = band('cineb')
        xyz = np.array(data['images'])
        xyz[1,0] += np.array(CELL['vectors'][0])-np.array(CELL['vectors'][1])
        xyz[2,0,0] += 2.e-9
        raw = dict(data, images=xyz.tolist())
        normalized = b.validate(raw, 'tblite')
        self.assertEqual(normalized['images'], data['images'])
        self.assertNotEqual(raw['images'], data['images'])
        xyz[1,0,2] += .01
        with self.assertRaisesRegex(ValueError, '固定原子1の位置'):
            b.validate(dict(data, images=xyz.tolist()), 'tblite')

    def test_adaptive_resumable_fixed_substrate(self):
        data = band('lup','band-lbfgs', adaptive=True)
        part = b.relax(dict(data,maxSteps=4), adsorbate_well)
        self.assertGreater(len(part['nodeIds']), len(data['nodeIds']))
        self.assertTrue(set(data['nodeIds']).issubset(part['nodeIds']))
        replay = dict(data, images=part['images'], nodeIds=part['nodeIds'], _optimizerResume=part['optimizerState'])
        result = b.relax(replay, adsorbate_well)
        self.assertEqual(result['reason'], 'converged')
        self.assertEqual(result['nodeIds'], part['nodeIds'])
        with self.assertRaisesRegex(ValueError, '再開時の固定原子'):
            b.relax(dict(replay, fixedAtoms=[]), adsorbate_well)


class FrozenMD(unittest.TestCase):
    def request(self, ensemble, bath=None):
        options = dict(ensemble=ensemble, timestepFs=.35, temperatureK=300., sampleEvery=1, seed=43)
        if bath:
            options['thermostat'] = bath
        return dict(mode='md', symbols=['Si', 'He'], images=[[SITE.tolist(), [.4,.06,0.]]],
                    md=options, fixedAtoms=[0], maxSteps=24, cell=CELL)

    def test_fixed_nve_and_every_thermostat(self):
        for bath in [None, *b.md_thermostats()]:
            with self.subTest(bath=bath):
                request = self.request('nvt' if bath else 'nve', bath)
                data = b.validate(request, 'tblite')
                self.assertEqual(data, b.validate(data, 'tblite'))
                result = b.molecular_dynamics(data, adsorbate_well)
                self.assertEqual(result['degreesOfFreedom'],3)
                self.assertEqual(result['fixedAtoms'],[0])
                frames = np.array(result['trajectory']['images'])
                np.testing.assert_array_equal(frames[:,0], np.broadcast_to(SITE, frames[:,0].shape))
                self.assertGreater(np.linalg.norm(frames[-1,1]-frames[0,1]), .001)
                np.testing.assert_array_equal(result['velocitiesAngstromPerFs'][0], [0.,0.,0.])
                self.assertTrue(np.all(np.isfinite(result['trajectory']['temperatureK'])))
                np.testing.assert_allclose(np.array(result['trajectory']['kineticEV'])*2/(3*b.ase_units.kB),
                                           result['trajectory']['temperatureK'])

    def test_npt_pressure_and_nonzero_frozen_velocities_rejected(self):
        request = self.request('npt')
        with self.assertRaisesRegex(ValueError, '固定原子を含むMD'):
            b.validate(request, 'tblite')
        for patch in [dict(recordPressure=True), dict(initialVelocitiesAngstromPerFs=[[.01,0,0],[0,0,0]])]:
            req = self.request('nve')
            req['md'].update(patch)
            with self.assertRaisesRegex(ValueError, '固定原子'):
                b.validate(req, 'tblite')
