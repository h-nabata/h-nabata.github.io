"""Numerical equivalence, bounded resources and recovery under new fast paths."""
import copy
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from ase import Atoms
from test_engine import b, CONFIG, WATER, band, well

class Resources(unittest.TestCase):
    def test_periodic_candidates_match_exhaustive_including_skew_partial_and_boundary(self):
        rng=np.random.default_rng(191)
        for vectors in ([[9,0,0],[4,8,0],[-2,3,10]],[[1,0,0],[.999,.003,0],[.1,.2,8]]):
            for pbc in ([True]*3,[True,False,True],[False,True,False]):
                cell={'vectors':vectors,'pbc':pbc}
                for distance in (.099999999,.1,.100000001):
                    p=rng.normal(size=(45,3))*12
                    p[1]=p[0]+np.array(vectors)[np.flatnonzero(pbc)[0]]+[distance,0,0]
                    a,c=np.triu_indices(len(p),1)
                    expected=bool(np.any(b.find_mic(p[c]-p[a],vectors,pbc)[1]<.1))
                    self.assertEqual(b.has_atomic_collision(p,cell),expected)
        self.assertLessEqual(b.cell_search_geometry.cache_info().currsize,32)

    def test_periodic_wrapping_roundoff_at_exact_cell_faces(self):
        cell={'vectors':[[16.,0,0],[4.,16.,0],[2.,1.,16.]],'pbc':[True]*3}
        grid=np.array([[i/10,j/10,k/10] for i in range(10) for j in range(10) for k in range(10)])[:500]@np.array(cell['vectors'])
        self.assertFalse(b.has_atomic_collision(grid,cell))
        grid[1]=grid[0]+np.array(cell['vectors'][1])+[.01,0,0]
        self.assertTrue(b.has_atomic_collision(grid,cell))

    def test_rigid_six_column_projection_matches_all_pair_reference_and_preserves_chirality(self):
        rng=np.random.default_rng(78)
        for k in (2,4,20,50):
            p=rng.normal(size=(70,3))*3
            if k==2:p[:2]=[[0,0,0],[1,0,0]]
            d={'images':[p.tolist()],'rigidGroups':[list(range(k))],'maxMove':.04}
            atoms=Atoms('C'*len(p),positions=p);constraint=b.internal_coordinate_constraint(d)
            pairs=[{'type':'distance','atoms':[i,j],'value':np.linalg.norm(p[i]-p[j])} for i in range(k) for j in range(i+1,k)]
            jac=b.internal_coordinate_jacobian(p,pairs)
            force=rng.normal(size=p.shape);expected=force.ravel()-jac.T@np.linalg.lstsq(jac.T,force.ravel(),rcond=1e-10)[0]
            actual=force.copy();constraint.adjust_forces(atoms,actual)
            np.testing.assert_allclose(actual.ravel(),expected,atol=2e-12)
            moved=constraint.project(p+rng.normal(size=p.shape)*.1)
            np.testing.assert_allclose(np.linalg.norm(moved[:k,None]-moved[None,:k],axis=-1),np.linalg.norm(p[:k,None]-p[None,:k],axis=-1),atol=1e-12)
            if k>=4:self.assertGreater(np.linalg.det(p[1:4]-p[0])*np.linalg.det(moved[1:4]-moved[0]),0)

    def test_mixed_constraint_factorization_is_reused_and_invalidated(self):
        p=np.array([[0.,0,0],[1.,0,0],[0,1.,0],[4,4,0]])
        d={'images':[p.tolist()],'rigidGroups':[[0,1,2]],'fixedComponents':[{'atom':0,'axes':[True,False,False]}]}
        constraint=b.internal_coordinate_constraint(d);atoms=Atoms('C4',positions=p)
        f=np.ones_like(p);constraint.adjust_forces(atoms,f)
        first=constraint.factor_cache
        constraint.adjust_forces(atoms,np.ones_like(p));self.assertIs(first,constraint.factor_cache)
        self.assertEqual(first[-1].shape[1],8) # only 3 participating atoms, one fixed component
        atoms.positions[1,1]+=.01;constraint.adjust_forces(atoms,np.ones_like(p));self.assertIsNot(first,constraint.factor_cache)

    def test_restart_arrays_are_lossless_nonexecutable_and_legacy_compatible(self):
        value=[np.random.default_rng(2).normal(size=(70,70)),np.arange(5),{'a':np.zeros((0,3))}]
        decoded=b.decode_restart(json.loads(json.dumps(b.encode_restart(value))))
        np.testing.assert_array_equal(decoded[0],value[0]);np.testing.assert_array_equal(decoded[1],value[1])
        with self.assertRaises(ValueError):b.decode_restart({'array':'AA==','shape':[2],'dtype':'<f8'})
        with self.assertRaises(ValueError):b.decode_restart({'array':'AA==','shape':[1],'dtype':'O'})
        from ase.optimize import LBFGS
        from ase.io.jsonio import encode
        a=Atoms('H',positions=[[1.,0,0]]);o=LBFGS(a,logfile=None)
        # A genuine pre-1.13 payload is still read by ASE.
        d={'images':a.positions.tolist()}
        data={'images':[a.positions.tolist()]}
        snapshot=b.install_optimizer_state(o,data,'lbfgs');payload=(0,[],[],[],None,None,None,'START')
        old={**snapshot(),'payload':encode(payload)};old.pop('payloadEncoding')
        b.install_optimizer_state(LBFGS(a,logfile=None),{**data,'_optimizerResume':old},'lbfgs')

    def test_preconditioned_minimum_and_exact_resume(self):
        p=np.array([[0,0,0],[1.1,.3,0],[2.2,0,.2],[3.3,0,0]],float)
        target=p+np.array([.15,-.2,.1]);target[1,1]+=.1
        def harmonic(i,q):
            v=q-target
            return float((v*v).sum()/2),-v
        data=b.validate({'symbols':['C']*4,'images':[p.tolist()],'mode':'optimize','optimizer':'precon-lbfgs','maxSteps':150,'fmax':1e-5,'maxMove':.1},'tblite')
        full=b.calculate_job(data,harmonic,None)
        self.assertTrue(full['converged']);np.testing.assert_allclose(full['images'][0],target,atol=2e-5)
        short=b.calculate_job({**data,'maxSteps':4},harmonic,None)
        resumed=b.calculate_job({**data,'images':short['images'],'_optimizerResume':short['optimizerState']},harmonic,None)
        np.testing.assert_allclose(resumed['images'],full['images'],atol=1e-12)
        self.assertLessEqual(max(np.diff(full['trajectory']['energies'])),1e-12)

    def test_parallel_band_is_identical_and_has_bounded_overlap(self):
        active=0;maximum=0;lock=threading.Lock();barrier=threading.Barrier(2)
        def concurrent(i,p):
            nonlocal active,maximum
            with lock:active+=1;maximum=max(maximum,active)
            # The first pair proves actual concurrency without relying on timings.
            if i<2:barrier.wait(timeout=5)
            answer=well(i,p)
            with lock:active-=1
            return answer
        c=b.ExactEvaluationCache(concurrent,workers=2)
        try:
            answers=c.map([(i,np.array([[x,.2,0]])) for i,x in enumerate((-.5,.5))])
            self.assertEqual(maximum,2)
        finally:c.close()
        data={**band('cineb'),'maxSteps':10}
        c=b.ExactEvaluationCache(well,workers=2)
        try:parallel=b.relax(data,c)
        finally:c.close()
        serial=b.relax(data,well)
        self.assertEqual(parallel,serial)

    def test_append_journal_recovers_only_committed_prefix_and_lazy_history(self):
        with tempfile.TemporaryDirectory() as directory:
            jobs=b.Jobs({**CONFIG,'historyDir':directory})
            data=b.validate({**WATER,'mode':'optimize'},'tblite')
            with patch.object(jobs,'_launch_next'):created=jobs.start(data)
            job=jobs.jobs[created['id']];job['status']='running'
            for i in range(3):
                job['checkpoints'].append({'positions':WATER['images'][0],'energy':float(i),'force':np.zeros((3,3)).tolist(),'fmax':1.,'optimizerState':{'step':i}})
                jobs._persist(job,force=True)
            path=Path(directory)/(job['id']+'.json');manifest=json.loads(path.read_text())
            self.assertNotIn('checkpoints',manifest)
            with open(path.with_suffix('.frames'),'ab') as stream:stream.write(b'{torn uncommitted data')
            restored=b.Jobs(jobs.config);result=restored.get(job['id'])
            self.assertEqual(result['result']['trajectory']['energies'],[0.,1.,2.])
            self.assertEqual(result['result']['optimizerState'],{'step':2})
            cold=b.Jobs(jobs.config);self.assertTrue(cold.jobs[job['id']]['_lazy'])
            self.assertTrue(cold.listing()['jobs'][0]['hasResult']);self.assertNotIn('result',cold.jobs[job['id']])
            self.assertEqual(cold.get(job['id'])['result'],result['result'])

    def test_balanced_cell_metric_preserves_equilibrium_and_exact_resume(self):
        reference=np.eye(3)*4
        class Elastic:
            def with_cell(self,i,p,cell):
                delta=cell-reference*1.05
                return .5*float(np.sum(delta**2)),np.zeros_like(p),cell.T@delta/abs(np.linalg.det(cell))
        data=b.validate({**WATER,'mode':'optimize','optimizer':'lbfgs','maxSteps':100,'fmax':1e-5,
            'cell':{'vectors':reference.tolist(),'pbc':[True]*3},'cellOptimization':{'mode':'isotropic','metric':'balanced','stressTolerance':1e-6}},'tblite')
        result=b.calculate_job(data,Elastic(),None)
        self.assertTrue(result['converged']);np.testing.assert_allclose(result['cell']['vectors'],reference*1.05,atol=1e-4)
        first=b.calculate_job({**data,'maxSteps':3},Elastic(),None)
        resumed=b.calculate_job({**data,'images':first['images'],'cell':first['cell'],'_optimizerResume':first['optimizerState']},Elastic(),None)
        np.testing.assert_allclose(resumed['cell']['vectors'],result['cell']['vectors'],atol=1e-12)
        self.assertAlmostEqual(result['optimizerState']['scale'],4*np.sqrt(3))

    def test_preconditioned_native_minimum_and_periodic_fixed_atom(self):
        for cell,fixed in [(None,[]),({'vectors':(np.eye(3)*8).tolist(),'pbc':[True]*3},[0])]:
            data=b.validate({**WATER,'mode':'optimize','optimizer':'precon-lbfgs','maxSteps':200,'fmax':.001,'cell':cell,'fixedAtoms':fixed},'tblite')
            engine=b.TBLiteEngine(data,CONFIG,tempfile.gettempdir())
            result=b.calculate_job(data,engine,tempfile.gettempdir())
            self.assertTrue(result['converged'])
            if fixed:np.testing.assert_array_equal(result['images'][0][0],WATER['images'][0][0])

    def test_native_parallel_vibrations_match_serial(self):
        data=b.validate({**WATER,'mode':'vibrations'},'tblite')
        outputs=[]
        for workers in (1,2):
            with tempfile.TemporaryDirectory() as directory:
                cache=b.ExactEvaluationCache(b.TBLiteEngine(data,CONFIG,directory),workers=workers)
                try:outputs.append(b.vibration_analysis(data,cache,directory))
                finally:cache.close()
        np.testing.assert_allclose(outputs[0]['frequenciesCM'],outputs[1]['frequenciesCM'],atol=.02,rtol=2e-5)
        self.assertEqual(outputs[0]['imaginary'],outputs[1]['imaginary'])
