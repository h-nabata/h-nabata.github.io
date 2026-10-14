"""Independent analytic + optional real g-xTB checks. No research structures."""
import copy
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
import numpy as np
from test_engine import b, WATER, CONFIG


def request():
    c = dict(schema='molecule-afir/1', fragments=[
        dict(id='o',label='oxygen',atomIds=['O']),dict(id='h1',label='hydrogen 1',atomIds=['H1']),
        dict(id='h2',label='hydrogen 2',atomIds=['H2'])], pairs=[
        dict(a='o',b='h1',mode='attract',gamma=40),dict(a='h1',b='h2',mode='repel',gamma=20)],
        charge=0,multiplicity=1,maxSteps=4,fmax=.00001,maxMove=.02)
    return {**WATER,'mode':'afir','atomIds':['O','H1','H2'],'afir':c,
            **{k:c[k] for k in ('charge','multiplicity','maxSteps','fmax','maxMove')}}


class AFIR(unittest.TestCase):
    def test_bias_finite_difference_and_independent_singleton_oracle(self):
        data=b.validate(request(),'gxtb');p=np.array(data['images'][0])
        e,f=b.afir_bias(p,data['symbols'],data['atomIds'],data['afir'])
        expected=b.alpha_from_gamma(40)*np.linalg.norm(p[0]-p[1])-b.alpha_from_gamma(20)*np.linalg.norm(p[1]-p[2])
        self.assertAlmostEqual(e,expected,places=12)
        for i in range(3):
            for k in range(3):
                plus=p.copy();minus=p.copy();plus[i,k]+=1e-5;minus[i,k]-=1e-5
                ep=b.afir_bias(plus,data['symbols'],data['atomIds'],data['afir'])[0]
                em=b.afir_bias(minus,data['symbols'],data['atomIds'],data['afir'])[0]
                self.assertAlmostEqual(f[i,k],-(ep-em)/2e-5,delta=1e-8)
        np.testing.assert_allclose(f.sum(axis=0),0,atol=1e-12)

    def test_input_failures(self):
        changes=[lambda r:r['atomIds'].reverse(),lambda r:r['afir']['pairs'].append(dict(a='h1',b='o',mode='repel',gamma=5))]
        # Reordered IDs are valid when provided by caller; duplicate IDs are not.
        r=request();r['atomIds'][1]='O'
        with self.assertRaises(ValueError):b.validate(r,'gxtb')

        for change in changes[1:]:
            r=request();change(r)
            with self.assertRaises(ValueError):b.validate(r,'gxtb')
        for key,value in [('charge',1),('maxSteps',501)]:
            r=request();r['afir'][key]=value
            with self.assertRaises(ValueError):b.validate(r,'gxtb')
        r=request();r['afir']['pairs'][0]['gamma']=float('nan')
        with self.assertRaises(ValueError):b.validate(r,'gxtb')
        r=request();r['afir']['fragments'][1]['atomIds'].append('O')
        with self.assertRaises(ValueError):b.validate(r,'gxtb')

    def test_weight_derivatives_for_multiatom_fragments(self):
        symbols=['H','C','O','N'];ids=['a','b','c','d']
        p=np.array([[0.,0,0],[1.5,.2,0],[.1,2.,.2],[2.4,1.8,-.3]])
        c=dict(fragments=[dict(id='a',atomIds=ids[:2]),dict(id='b',atomIds=ids[2:])],pairs=[dict(a='a',b='b',mode='attract',gamma=100)])
        e,f=b.afir_bias(p,symbols,ids,c)
        for i in range(4):
            for k in range(3):
                plus=p.copy();minus=p.copy();plus[i,k]+=1e-5;minus[i,k]-=1e-5
                numerical=-(b.afir_bias(plus,symbols,ids,c)[0]-b.afir_bias(minus,symbols,ids,c)[0])/2e-5
                self.assertAlmostEqual(f[i,k],numerical,delta=1e-8)
        np.testing.assert_allclose(f.sum(axis=0),0,atol=1e-12)

    def test_fire_separate_physical_bias_and_step_budget(self):
        data=b.validate(request(),'gxtb');initial=np.array(data['images'][0]);checkpoints=[]
        def physical(i,p):return float(((p-initial)**2).sum()),-2*(p-initial)
        result=b.afir_relax(data,physical,checkpoints.append)
        self.assertEqual(result['reason'],'step_limit');self.assertEqual(len(result['images']),5)
        self.assertEqual(result['validation'],'biased-trajectory-not-ts')
        for p,e in zip(result['images'],result['energies']):self.assertAlmostEqual(e,physical(0,np.array(p))[0],places=12)
        np.testing.assert_allclose(np.array(result['energies'])+result['biasEnergies'],result['biasedEnergies'])
        self.assertEqual(len(checkpoints),5)


@unittest.skipUnless(os.getenv('GXTB_TEST_BINARY'),'explicit local native g-xTB binary required')
class NativeAFIR(unittest.TestCase):
    def test_native_multipair_trajectory_and_stop_cleanup(self):
        data=b.validate(request(),'gxtb');config={**CONFIG,'engine':'gxtb','binary':str(Path(os.environ['GXTB_TEST_BINARY']).resolve()),'evaluationTimeout':120}
        with tempfile.TemporaryDirectory() as directory:
            engine=b.GXTBEngine(data,config,directory)
            result=b.afir_relax(data,engine)
            self.assertEqual(len(result['images']),5);self.assertTrue(np.isfinite(result['energies']).all())
            p=np.array(result['images'][-1]);energy,force=engine(0,p)
            self.assertAlmostEqual(energy,result['energies'][-1],delta=1e-7)
            np.testing.assert_allclose(force,result['forces'][-1],atol=1e-5)
            if os.getenv('AFIR_TEST_RECORD'):
                Path(os.environ['AFIR_TEST_RECORD']).write_text(json.dumps({'input':data,'result':result},indent=2),encoding='utf-8')
        # Windows-safe cancellation: use the real engine and stop after a checkpoint.
        longer=copy.deepcopy(data);longer['maxSteps']=longer['afir']['maxSteps']=500
        jobs=b.Jobs(config)
        try:
            created=jobs.start(longer);deadline=time.monotonic()+30
            while time.monotonic()<deadline and not jobs.job['checkpoints'] and jobs.get(created['id'])['status']=='running':time.sleep(.03)
            self.assertTrue(jobs.job['checkpoints'])
            with self.assertRaises(RuntimeError):jobs.start(longer)
            jobs.cancel(created['id']);jobs.job['thread'].join(timeout=10)
            state=jobs.get(created['id']);self.assertEqual(state['status'],'cancelled',state)
            self.assertEqual(state['result']['reason'],'cancelled');self.assertFalse(state['result']['converged'])
            self.assertGreater(len(state['result']['images']),0);self.assertFalse(jobs.job['process'].is_alive())
            self.assertFalse(Path(jobs.job['directory']).exists())
        finally:jobs.close()


if __name__=='__main__':unittest.main(verbosity=2)
