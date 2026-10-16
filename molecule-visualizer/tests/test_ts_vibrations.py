"""Public analytic molecules: saddle vs minimum, normal modes and safe recovery."""
import copy
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest

os.environ['OMP_NUM_THREADS'] = os.environ['OPENBLAS_NUM_THREADS'] = '1'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'local-engine'))
import bridge as b
import numpy as np
from ase import Atoms
from ase.vibrations import VibrationsData

H2 = {'symbols':['H','H'], 'images':[[[0,0,0],[1.04,0,0]]], 'atomIds':['h-a','h-b']}


def saddle(index, p):
    vector=p[1]-p[0]; distance=np.linalg.norm(vector); d=distance-1
    gradient=(4*d**3-2*d)*vector/distance
    return d**4-d**2, np.array([gradient,-gradient])


class TSAndVibrations(unittest.TestCase):
    def test_validation_separates_minimum_and_saddle_and_vibrations_default_off(self):
        self.assertNotIn('vibrations',b.validate({**H2,'mode':'ts'},'tblite'))
        self.assertEqual(b.validate({**H2,'mode':'ts'},'tblite')['optimizer'],'sella-prfo')
        for edit in ({'mode':'ts','optimizer':'lbfgs'}, {'mode':'optimize','optimizer':'sella-prfo'},
                     {'mode':'neb','images':H2['images']*3,'vibrations':{}},
                     {'mode':'ts','trustRadius':0}, {'mode':'evaluate','vibrations':{}},
                     {'mode':'vibrations','vibrations':{'nfree':3}}, {'mode':'vibrations','vibrations':{'delta':0}},
                     {'mode':'vibrations','vibrations':{'imaginaryThreshold':-1}},
                     {'mode':'ts','cell':{'vectors':np.eye(3).tolist(),'pbc':[True,False,False]}}):
            with self.subTest(edit=edit), self.assertRaises(ValueError):b.validate({**H2,**edit},'tblite')
        self.assertEqual(b.validate({**H2,'mode':'vibrations'},'gxtb')['vibrations']['nfree'],2)
        self.assertEqual(b.validate(H2,'gxtb')['atomIds'],H2['atomIds'])
        data=b.validate({**H2,'mode':'evaluate','images':H2['images']*100},'tblite')
        self.assertEqual(len(data['images']),100)
        with self.assertRaises(ValueError):b.validate({**H2,'images':H2['images']*101},'tblite')

    @unittest.skipUnless(importlib.util.find_spec('sella'),'optional Sella not installed')
    def test_both_sella_methods_find_saddle_and_history_excludes_hessian_probes(self):
        for method in ('sella-prfo','sella-rfo'):
            with self.subTest(method=method):
                data=b.validate({**H2,'mode':'ts','optimizer':method,'fmax':1e-5,'maxSteps':40},'tblite')
                progress=[]
                result=b.ase_optimize(data,saddle,progress.append)
                self.assertTrue(result['converged'])
                self.assertAlmostEqual(np.linalg.norm(np.diff(result['images'][0],axis=0)),1,places=4)
                self.assertEqual(result['optimizer'],method)
                self.assertEqual(len(result['trajectory']['images']),result['steps']+1)
                self.assertGreater(result['evaluations'],len(result['trajectory']['images']))
                self.assertEqual(result['trajectory']['images'][0],H2['images'][0])
                self.assertEqual(result['trajectory']['images'][-1],result['images'][0])
                self.assertEqual(len(progress),result['steps']+1)
                self.assertNotIn('vibrations',result)

    def test_minimizers_keep_coordinates_and_energies_paired_and_bound_displacement(self):
        target=np.array([[0,0,0],[1.2,.1,0]])
        def harmonic(i,p):return float(np.sum((p-target)**2)), -2*(p-target)
        for method in ('lbfgs','bfgs'):
            data=b.validate({**H2,'mode':'optimize','optimizer':method,'fmax':1e-5},'tblite')
            result=b.ase_optimize(data,harmonic)
            self.assertTrue(result['converged'])
            np.testing.assert_allclose(result['images'][0],target,atol=1e-5)
            t=result['trajectory'];self.assertEqual(len(t['images']),result['steps']+1)
            for a,c in zip(t['images'],t['images'][1:]):self.assertLessEqual(b.force_max(np.array(c)-a),data['maxMove']+1e-12)
            for p,e in zip(t['images'],t['energies']):self.assertAlmostEqual(harmonic(0,np.array(p))[0],e)

    def test_ase_vibrations_matches_analytic_hessian_including_imaginary_mode_and_cleanup(self):
        positions=[[0,0,0],[1,0,0]]
        # Exact radial saddle Hessian: one negative stretching curvature; five zero modes.
        hessian=np.zeros((6,6));hessian[0,0]=hessian[3,3]=-2;hessian[0,3]=hessian[3,0]=2
        expected=VibrationsData.from_2d(Atoms('H2',positions=positions),hessian).get_frequencies()
        for nfree in (2,4):
            data=b.validate({**H2,'images':[positions],'mode':'vibrations','vibrations':{'delta':.001,'nfree':nfree}},'tblite')
            updates=[]
            with tempfile.TemporaryDirectory() as directory:
                result=b.vibration_analysis(data,saddle,directory,updates.append)
                self.assertEqual(list(Path(directory).rglob('*.json')),[])
            self.assertEqual(result['status'],'completed');self.assertEqual(result['positions'],positions)
            self.assertEqual(result['evaluations'],1+6*nfree)
            self.assertEqual(updates[-1]['vibrationDone'],updates[-1]['vibrationTotal'])
            self.assertEqual(np.shape(result['modes']),(6,2,3))
            self.assertTrue(result['imaginary'][0]);self.assertEqual(result['significantImaginaryCount'],1)
            self.assertAlmostEqual(result['frequenciesCM'][0],abs(expected[0]),delta=.02)
            self.assertAlmostEqual(result['quantaMEV'][0],result['frequenciesCM'][0]*.1239841984,delta=1e-5)
            mode=np.array(result['modes'][0]);self.assertLess(float(mode[0]@mode[1]),0)

    def test_failed_frequency_calculation_retains_evaluated_structure(self):
        data=b.validate({**H2,'mode':'vibrations'},'tblite');calls=0;updates=[]
        def fail(i,p):
            nonlocal calls
            calls+=1
            if calls>2:raise ValueError('SCF test failure')
            return saddle(i,p)
        with tempfile.TemporaryDirectory() as directory:result=b.calculate_job(data,fail,directory,updates.append)
        self.assertEqual(result['vibrations']['status'],'failed')
        self.assertIn('SCF test failure',result['vibrations']['error'])
        self.assertEqual(result['images'],data['images'])
        self.assertTrue(any('structureCheckpoint' in p for p in updates))

    def test_neb_checkpoint_is_complete_and_partial_result_keeps_endpoints(self):
        images=[[[0,0,0],[x,0,0]] for x in (.8,.9,1.,1.1,1.2)]
        data=b.validate({**H2,'images':images,'mode':'neb','maxSteps':2,'fmax':1e-5},'tblite');updates=[]
        result=b.relax(data,saddle,updates.append)
        saved=[p['bandCheckpoint'] for p in updates if 'bandCheckpoint' in p]
        self.assertTrue(saved)
        for frame in saved:
            self.assertEqual(len(frame['energies']),len(images));self.assertEqual(frame['images'][0],images[0]);self.assertEqual(frame['images'][-1],images[-1])
            for p,e in zip(frame['images'],frame['energies']):self.assertAlmostEqual(saddle(0,np.array(p))[0],e)
        self.assertNotIn('preview',updates[-1])
        config={'engine':'tblite','method':'GFN2-xTB','threads':1}
        job={'data':data,'status':'cancelled','bandCheckpoint':saved[-1]}
        partial=b.Jobs(config).partial_structure(job)
        self.assertEqual(partial['images'],result['images']);self.assertEqual(partial['reason'],'cancelled');self.assertFalse(partial['converged'])
        job['structureCheckpoint']={**result,'reason':'converged','converged':True}
        partial=b.Jobs(config).partial_structure(job)
        self.assertTrue(partial['converged']);self.assertEqual(partial['vibrations']['status'],'cancelled')


if __name__=='__main__':unittest.main()
