"""CI-String/LUP-family numerics: saddle ascent, redistribution and bounded steps."""
import copy
import unittest

import numpy as np
from test_engine import b, WATER, well


def path(optimizer='lbfgs', curved=False):
    xs = np.array([-1., -.84, -.61, -.28, .12, .39, .62, .87, 1.])
    height = .4 if curved else 0.
    return dict(images=[[[x, height*(1-x*x)+.15*np.sin(np.pi*(x+1)/2), 0.]] for x in xs],
                mode='lup', maxSteps=1000, fmax=2e-4, maxMove=.03, spring=1., climbAfter=5,
                optimizer=optimizer, lup={'redistributeEvery':5,'redistributionTolerance':.001},
                livePreview=True, nodeIds=[f'original-{i}' for i in range(len(xs))])


def curved_well(index, positions):
    x, y, z = positions[0]
    q = y-.4*(1-x*x)
    return (x*x-1)**2+3*q*q+z*z, np.array([[-4*x*(x*x-1)-4*3*.4*x*q, -6*q, -2*z]])


class LUPValidation(unittest.TestCase):
    def request(self):
        return {**WATER, 'mode':'lup', 'images':[(np.array(WATER['images'][0])+shift).tolist() for shift in (0., .1, .3)]}

    def test_defaults_and_allowed_optimizers_are_mode_specific(self):
        data = b.validate(self.request(), 'tblite')
        self.assertEqual(data['optimizer'], 'lbfgs')
        self.assertEqual(data['maxSteps'], 100)
        self.assertEqual(data['maxMove'], .03)
        self.assertEqual(data['climbAfter'], 5)
        self.assertEqual(data['lup'], {'redistributeEvery':5,'redistributionTolerance':.001})
        self.assertEqual(b.validate({**self.request(), 'optimizer':'fire'},'tblite')['optimizer'],'fire')
        self.assertEqual(b.validate({**self.request(), 'mode':'cineb'},'tblite')['optimizer'],'fire')
        with self.assertRaises(ValueError):
            b.validate({**self.request(),'mode':'cineb','optimizer':'lbfgs'},'tblite')
        with self.assertRaises(ValueError):
            b.validate({**self.request(),'optimizer':'bfgs'},'tblite')

    def test_invalid_settings_and_unsupported_constraints_are_rejected(self):
        for patch in ({'lup':None}, {'lup':{'redistributeEvery':0}}, {'lup':{'redistributeEvery':1.5}},
                      {'lup':{'redistributionTolerance':float('nan')}}, {'lup':{'redistributionTolerance':0}},
                      {'lup':{'command':'no'}}, {'climbAfter':100}, {'fixedAtoms':[0]},
                      {'internalConstraints':[{'type':'distance','atoms':[0,1],'value':1.}]}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                b.validate({**self.request(),**patch},'tblite')
        with self.assertRaisesRegex(ValueError,'専用'):
            b.validate({**WATER,'lup':{}},'tblite')

    def test_adaptive_and_split_settings_work_for_lup(self):
        checked = b.validate({**self.request(),'adaptiveNEB':{'maxImages':15},'pathSplit':{},
                              'nodeIds':['a','b','c']},'tblite')
        self.assertTrue(checked['adaptiveNEB']['enabled'])
        self.assertTrue(checked['pathSplit']['enabled'])
        self.assertEqual(checked['nodeIds'],['a','b','c'])


class Redistribution(unittest.TestCase):
    def test_equal_arc_on_both_sides_preserves_climbing_anchor(self):
        source = np.array([[[x,0.,0.]] for x in (-1.,-.98,-.6,.3,.4,.9,1.)])
        result = b.lup_redistribute(source,3)
        np.testing.assert_array_equal(result[[0,3,6]],source[[0,3,6]])
        np.testing.assert_allclose(result[:4,0,0],np.linspace(-1.,.3,4),atol=1e-14)
        np.testing.assert_allclose(result[3:,0,0],np.linspace(.3,1.,4),atol=1e-14)
        np.testing.assert_allclose(b.lup_redistribute(source)[:,0,0],np.linspace(-1.,1.,7),atol=1e-14)
        # Redistribution preserves the unwrapped path, not a minimum-image shortcut.
        periodic = source+np.array([2.,0,0])
        np.testing.assert_allclose(b.lup_redistribute(periodic),b.lup_redistribute(source)+[2.,0,0])

    def test_collision_checks_include_periodic_images_and_degenerate_bands(self):
        collision = np.array([[[0.,0.,0.],[2.,.01,0.]],[[.1,0.,0.],[2.1,.02,0.]],[[.2,0.,0.],[2.2,.01,0.]]])
        cell={'vectors':[[2.,0,0],[0,2.,0],[0,0,2.]],'pbc':[True,True,True]}
        self.assertTrue(b.lup_safe_geometry(collision))
        self.assertFalse(b.lup_safe_geometry(collision,cell))
        self.assertFalse(b.lup_safe_geometry(np.zeros((3,1,3))))
        with self.assertRaises(ValueError):
            b.lup_redistribute(np.zeros((3,1,3)))


class LUPNumerics(unittest.TestCase):
    def test_fire_and_lbfgs_climb_from_off_saddle_guess_to_the_saddle(self):
        for optimizer in ('fire','lbfgs'):
            with self.subTest(optimizer=optimizer):
                data=path(optimizer)
                result=b.relax(data,well)
                self.assertTrue(result['converged'])
                self.assertGreaterEqual(result['steps'],data['climbAfter'])
                saddle=result['images'][result['climbingImage']]
                np.testing.assert_allclose(saddle,[[0.,0.,0.]],atol=6e-5)
                self.assertAlmostEqual(result['energies'][result['climbingImage']],1.,places=7)
                self.assertEqual(result['nodeIds'],data['nodeIds'])
                np.testing.assert_array_equal(np.array(result['images'])[[0,-1]],np.array(data['images'])[[0,-1]])
                self.assertEqual(result['pathMethod'],'lup-ci-string')
                self.assertLessEqual(result['diagnostics']['redistributionResidual'],data['lup']['redistributionTolerance'])

    def test_curved_path_combined_moves_are_bounded_and_energy_force_match_coordinates(self):
        data=path(curved=True);frames=[];evaluations=[]
        def calculate(i,p):
            evaluations.append((i,p.copy()))
            return curved_well(i,p)
        def progress(value):
            if 'preview' in value:
                frames.append(value['preview'])
        result=b.relax(data,calculate,progress)
        self.assertTrue(result['converged'])
        np.testing.assert_allclose(result['images'][result['climbingImage']],[[0.,.4,0.]],atol=5e-5)
        self.assertEqual(len(evaluations),result['evaluations'])
        for before,after in zip(frames,frames[1:]):
            displacement=np.array(after['images'])-before['images']
            self.assertLessEqual(b.force_max(displacement),data['maxMove']+1e-12)
        self.assertTrue(any(frame['diagnostics']['redistributionMove']>0 for frame in frames))
        self.assertGreater(result['lupStatus']['redistributions'],0)
        self.assertGreater(result['lupStatus']['cacheHits'],0)
        for i,(positions,energy,force) in enumerate(zip(result['images'],result['energies'],result['forces'])):
            actual_energy,actual_force=curved_well(i,np.array(positions))
            self.assertAlmostEqual(energy,actual_energy,places=12)
            np.testing.assert_allclose(force,actual_force,atol=1e-12)
        components={name:np.array(value) for name,value in result['forceComponents'].items()}
        np.testing.assert_array_equal(components['spring'],0)
        np.testing.assert_allclose(sum(components[key] for key in ('physical','tangentRemoval','spring','climbingCorrection','constraintCorrection')),
                                   components['effective'],atol=1e-12)
        np.testing.assert_array_equal(components['tangentRemoval'][result['climbingImage']],0)

    def test_zero_force_with_unredistributed_spacing_is_not_declared_converged(self):
        data=path();data.update(images=[[[x,0.,0.]] for x in (-1.,-.95,-.94,-.9,1.)],
                               nodeIds=[str(i) for i in range(5)],maxSteps=1,maxMove=.001,climbAfter=0)
        result=b.relax(data,lambda i,p:(0.,np.zeros_like(p)))
        self.assertEqual(result['effectiveFmax'],0.)
        self.assertGreater(result['diagnostics']['redistributionResidual'],data['lup']['redistributionTolerance'])
        self.assertFalse(result['converged'])
        self.assertEqual(result['reason'],'step_limit')

    def test_climbing_node_can_move_uphill_despite_being_redistribution_anchor(self):
        data=path();data.update(images=[[[-1.,0.,0.]],[[.3,0.,0.]],[[1.,0.,0.]]],nodeIds=['a','ci','b'])
        initial_energy=well(1,np.array(data['images'][1]))[0]
        result=b.relax(data,well)
        self.assertTrue(result['converged'])
        self.assertGreater(result['energies'][1],initial_energy+.1)
        self.assertLess(abs(result['images'][1][0][0]),5e-5)
        self.assertGreater(abs(result['images'][1][0][0]-data['images'][1][0][0]),.25)

    def test_identical_geometry_cache_never_repeats_evaluations(self):
        data=path();data.update(images=[[[x,0.,0.]] for x in (-1.,0.,1.)],nodeIds=['a','b','c'])
        calls=[]
        def zero(i,p):
            calls.append((i,p.copy()))
            return 0.,np.zeros_like(p)
        result=b.relax(data,zero)
        self.assertTrue(result['converged'])
        self.assertEqual(result['steps'],data['climbAfter'])
        self.assertEqual(len(calls),3)
        self.assertEqual(result['evaluations'],3)
        self.assertEqual(result['lupStatus']['cacheHits'],3*data['climbAfter'])

    def test_adaptive_nodes_keep_original_ids_and_recover_saddle(self):
        data=path(curved=True)
        data['images']=[data['images'][i] for i in (0,4,8)]
        data['nodeIds']=['reactant','guess','product']
        data['adaptiveNEB']={'enabled':True,'maxImages':15,'interval':5,'maxSpacing':.35,'energyGap':.35}
        data['pathSplit']={'enabled':True,'prominence':.05,'minSeparation':2,'smoothingWindow':3}
        result=b.relax(data,curved_well)
        self.assertTrue(result['converged'])
        self.assertGreater(len(result['images']),3)
        self.assertLessEqual(len(result['images']),15)
        self.assertTrue(set(data['nodeIds']).issubset(result['nodeIds']))
        self.assertEqual(result['nodeIds'][0],'reactant')
        self.assertEqual(result['nodeIds'][-1],'product')
        np.testing.assert_allclose(result['images'][result['climbingImage']],[[0.,.4,0.]],atol=5e-5)
        self.assertIn('pathSegments',result)
        for p,e in zip(result['images'],result['energies']):
            self.assertAlmostEqual(curved_well(0,np.array(p))[0],e,places=12)

    def test_lbfgs_default_for_programmatic_call_matches_explicit_choice(self):
        data=path();data.pop('optimizer')
        actual=b.relax(data,well)
        expected=b.relax({**data,'optimizer':'lbfgs'},well)
        self.assertEqual(actual['optimizer'],'lbfgs')
        self.assertEqual(actual['images'],expected['images'])
        self.assertEqual(actual['evaluations'],expected['evaluations'])


if __name__=='__main__':
    unittest.main()
