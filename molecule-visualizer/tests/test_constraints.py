"""Fixed Cartesian atoms retain their initial positions; only free forces converge."""
import copy
import tempfile
import unittest
import numpy as np
from test_engine import b, WATER, CONFIG
from test_afir_engine import request


class FixedAtoms(unittest.TestCase):
    def data(self, optimizer='fire'):
        return b.validate({**WATER, 'mode':'optimize', 'images':[[[0.,0.,0.],[1.2,0.,0.],[-.24,.93,0.]]],
            'fixedAtoms':[0,2], 'optimizer':optimizer, 'maxSteps':200, 'fmax':.00001, 'maxMove':.03}, 'tblite')

    def test_validation_rejects_ambiguous_or_unsupported_constraints(self):
        for value in [None,'1',[True],[.5],[-1],[3],[0,0],[0,1,2]]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                b.validate({**WATER,'mode':'optimize','fixedAtoms':value}, 'tblite')
        for mode in ['evaluate','ts','vibrations','cineb']:
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                b.validate({**WATER,'mode':mode,'fixedAtoms':[0]}, 'tblite')
        with self.assertRaisesRegex(ValueError,'振動'):
            b.validate({**WATER,'mode':'optimize','fixedAtoms':[0],'vibrations':{'delta':.001,'nfree':2,'imaginaryThreshold':20}},'tblite')
        self.assertEqual(b.validate({**WATER,'mode':'optimize','fixedAtoms':[2,0]},'tblite')['fixedAtoms'],[0,2])

    def harmonic(self, data):
        initial=np.array(data['images'][0]);target=initial.copy();target[1,0]=.95
        # Fixed atoms have large nonzero reaction forces at the constrained minimum.
        target[0]+=2;target[2]+=2
        def calc(i,p):
            np.testing.assert_array_equal(p[data['fixedAtoms']],initial[data['fixedAtoms']])
            return float(.5*((p-target)**2).sum()),target-p
        return calc

    def test_all_min_optimizers_preserve_every_fixed_coordinate_and_raw_force(self):
        for optimizer in ['fire','lbfgs','bfgs']:
            with self.subTest(optimizer=optimizer):
                data=self.data(optimizer);initial=copy.deepcopy(data);points=[];calc=self.harmonic(data)
                fn=b.relax if optimizer=='fire' else b.ase_optimize
                r=fn(data,calc,points.append)
                self.assertEqual(data,initial);self.assertTrue(r['converged']);self.assertEqual(r['fixedAtoms'],[0,2])
                self.assertGreater(b.force_max(np.array(r['forces'][0])),3)
                self.assertLessEqual(r['effectiveFmax'],data['fmax'])
                frames=np.array(r['trajectory']['images'])
                for p,e in zip(frames,r['trajectory']['energies']):
                    self.assertAlmostEqual(calc(0,p)[0],e,places=12)
                self.assertLessEqual(np.linalg.norm(np.diff(frames,axis=0),axis=2).max(),data['maxMove']+1e-12)
                self.assertAlmostEqual(frames[-1,1,0],.95,delta=1e-5)
                checkpoints=[p['checkpoint'] for p in points if 'checkpoint' in p]
                for status in ['cancelled','error']:
                    partial=b.Jobs(CONFIG).partial_optimization({'data':data,'checkpoints':checkpoints[:3],'status':status})
                    self.assertEqual(partial['fixedAtoms'],[0,2]);self.assertFalse(partial['converged'])
                    np.testing.assert_array_equal(np.array(partial['images'][0])[[0,2]],frames[0,[0,2]])

    def test_initially_converged_free_atoms_ignore_fixed_reaction_force(self):
        for optimizer in ['fire','lbfgs','bfgs']:
            data=self.data(optimizer);p=np.array(data['images'][0]);f=np.zeros_like(p);f[[0,2]]=100
            fn=b.relax if optimizer=='fire' else b.ase_optimize
            r=fn(data,lambda i,p:(1.,f.copy()))
            self.assertTrue(r['converged']);self.assertEqual(r['steps'],0);self.assertEqual(r['effectiveFmax'],0)

    def test_afir_keeps_full_bias_but_masks_fixed_forces_and_recovers_partial(self):
        data=b.validate({**request(),'fixedAtoms':[0,2]},'tblite');initial=np.array(data['images'][0]);points=[]
        def calc(i,p):
            np.testing.assert_array_equal(p[[0,2]],initial[[0,2]])
            force=-2*(p-initial);force[[0,2]]=10
            return float(((p-initial)**2).sum()),force
        r=b.afir_relax(data,calc,points.append)
        self.assertEqual(r['fixedAtoms'],[0,2]);self.assertNotEqual(r['images'][-1][1],r['images'][0][1])
        for k,p in enumerate(r['images']):
            p=np.array(p);bias,artificial=b.afir_bias(p,data['symbols'],data['atomIds'],data['afir'])
            energy,force=calc(0,p)
            self.assertAlmostEqual(r['imageFmax'][k],np.linalg.norm((force+artificial)[1]),places=12)
            self.assertAlmostEqual(r['biasedEnergies'][k],energy+bias,places=12)
            self.assertGreater(r['physicalFmax'][k],10)
        partial=b.Jobs(CONFIG).partial_afir({'data':data,'checkpoints':[p['checkpoint'] for p in points][:2],'status':'cancelled'})
        self.assertEqual(partial['fixedAtoms'],[0,2]);self.assertFalse(partial['converged'])
        np.testing.assert_array_equal(np.array(partial['images'])[:,[0,2]],np.array(r['images'])[:2,[0,2]])

    def test_real_tblite_fixed_water_min_and_afir(self):
        for optimizer in ['fire','lbfgs','bfgs','afir']:
            with self.subTest(optimizer=optimizer),tempfile.TemporaryDirectory() as directory:
                data=self.data(optimizer) if optimizer!='afir' else b.validate({**request(),'fixedAtoms':[0,2]},'tblite')
                data['maxSteps']=3
                calc=b.TBLiteEngine(data,CONFIG,directory)
                fn=b.afir_relax if optimizer=='afir' else b.relax if optimizer=='fire' else b.ase_optimize
                r=fn(data,calc)
                frames=r['images'] if optimizer=='afir' else r['trajectory']['images']
                for p in frames:np.testing.assert_array_equal(np.array(p)[[0,2]],np.array(data['images'][0])[[0,2]])
                self.assertTrue(np.isfinite(r['energies']).all())
                self.assertNotEqual(frames[-1][1],frames[0][1])
