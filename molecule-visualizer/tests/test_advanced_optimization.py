import copy, importlib.util, pathlib, tempfile, unittest
import numpy as np
spec=importlib.util.spec_from_file_location('advanced_bridge',pathlib.Path(__file__).parents[1]/'local-engine/bridge.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)

def data(**kw):
    raw=dict(symbols=['H','H'],images=[[[0.,0.,0.],[1.2,.1,.2]]],charge=0,multiplicity=1,mode='optimize',maxSteps=400,fmax=1e-5,maxMove=.08)
    raw.update(kw);return b.validate(raw,'tblite')

def potential(i,p):
    target=np.array([[.2,.3,.4],[1.1,.5,.7]]);delta=p-target
    return float(.5*np.sum(delta**2)),-delta

class Advanced(unittest.TestCase):
    def test_cartesian_components_and_rigid_shape_joint_projection(self):
        d=data(fixedComponents=[{'atom':0,'axes':[False,False,True]}],rigidGroups=[[0,1]],optimizer='lbfgs')
        result=b.calculate_job(d,potential,tempfile.gettempdir())
        self.assertTrue(result['converged'])
        for p in result['trajectory']['images']:
            self.assertAlmostEqual(p[0][2],0,places=12)
            self.assertAlmostEqual(np.linalg.norm(np.array(p[1])-p[0]),np.linalg.norm(np.array(d['images'][0][1])-d['images'][0][0]),places=7)
        self.assertGreater(abs(result['images'][0][0][0]),.01)
    def test_center_distances_allow_rotations(self):
        d=data(groupConstraints={'mode':'distances','groups':[[0],[1]],'masses':[1.,2.]},optimizer='lbfgs')
        p=np.array(d['images'][0]);j=b.group_distance_jacobian(p,d['groupConstraints']);numeric=np.zeros_like(j)
        for k in range(p.size):
            plus=p.copy();minus=p.copy();plus.flat[k]+=1e-5;minus.flat[k]-=1e-5
            numeric[:,k]=(b.group_coordinates(b.group_centers(plus,d['groupConstraints']),d['groupConstraints'])-b.group_coordinates(b.group_centers(minus,d['groupConstraints']),d['groupConstraints']))/2e-5
        np.testing.assert_allclose(j,numeric,atol=1e-10)
        r=b.calculate_job(d,potential,tempfile.gettempdir());self.assertTrue(r['converged']);self.assertLess(r['groupConstraintError'],1e-7)
    def test_restart_matches_uninterrupted_minimization(self):
        for method in ('fire','lbfgs','bfgs','staged'):
            for constrained in (False,True):
                with self.subTest(method=method,constrained=constrained):
                    d=data(optimizer=method,maxSteps=20,**({'fixedComponents':[{'atom':0,'axes':[False,False,True]}]} if constrained else {}))
                    whole=b.calculate_job(d,potential,tempfile.gettempdir())
                    part=b.calculate_job({**d,'maxSteps':8},potential,tempfile.gettempdir())
                    resumed={**d,'images':part['images'],'maxSteps':12,'_optimizerResume':part['optimizerState']}
                    r=b.calculate_job(resumed,potential,tempfile.gettempdir())
                    np.testing.assert_allclose(r['images'],whole['images'],atol=1e-10)
    def test_adaptive_round_trip_and_scan_restart(self):
        d=data(mode='scan',optimizer='lbfgs',scan={'coordinates':[{'type':'distance','atoms':[0,1],'start':1.,'stop':2.,'points':3}], 'bidirectional':True,'adaptive':{'maxPoints':30,'energyGap':.001,'rmsGap':.01,'levels':2}})
        r=b.calculate_job(d,potential,tempfile.gettempdir());self.assertTrue(r['converged']);self.assertGreater(len(r['images']),6)
        self.assertEqual(set(n['direction'] for n in r['scan']['nodes']),{'forward','reverse'})
        saved=copy.deepcopy(r)
        for key in ('images','energies','forces','imageFmax','history'):saved[key]=saved[key][:4]
        saved['scan']['nodes']=saved['scan']['nodes'][:4]
        for key in saved['forceComponents']:saved['forceComponents'][key]=saved['forceComponents'][key][:4]
        rr=b.calculate_job({**d,'_scanResume':saved},potential,tempfile.gettempdir())
        np.testing.assert_allclose(rr['images'],r['images'],atol=1e-8)
    def test_cell_geometry_derivatives_and_exact_constraints(self):
        reference=np.array([[4.,.2,.1],[.8,5.,.3],[.4,.7,6.]])
        for mode,size in [('isotropic',1),('fixed_angles',3),('a',1),('b',1),('c',1),('ab',1),('c_vector',3),('full',6)]:
            q=np.arange(1,size+1)*.01;cell,deriv=b.cell_geometry(reference,mode,q)
            for k in range(size):
                plus=q.copy();minus=q.copy();plus[k]+=1e-6;minus[k]-=1e-6
                np.testing.assert_allclose(deriv[k],(b.cell_geometry(reference,mode,plus)[0]-b.cell_geometry(reference,mode,minus)[0])/2e-6,atol=2e-8)
            if mode in ('isotropic','fixed_angles','a','b','c','ab'):
                norm=lambda a:a/np.linalg.norm(a,axis=1)[:,None]
                np.testing.assert_allclose(norm(cell)@norm(cell).T,norm(reference)@norm(reference).T,atol=1e-14)
            if mode in ('c','c_vector'):np.testing.assert_array_equal(cell[:2],reference[:2])
    def test_cell_optimization_gradient_and_resume(self):
        # Analytic quadratic in lattice/Cartesian positions: stress contains the
        # atomic virial because the cell derivative holds fractional positions fixed.
        ref=np.array([[4.,0,0],[.3,5,0],[.2,.4,6.]])
        p=np.array([[0.,0,0],[1.2,.1,.2]])
        class Elastic:
            def with_cell(self,i,positions,lattice):
                delta=lattice-ref*1.04;dp=positions-p;energy=.5*np.sum(delta**2)+.5*np.sum(dp**2)
                sigma=(lattice.T@delta+positions.T@dp)/abs(np.linalg.det(lattice))
                return energy,-dp,(sigma+sigma.T)/2
        for mode in ('isotropic','fixed_angles','a','b','c','ab','c_vector','full'):
            d=data(cell={'vectors':ref.tolist(),'pbc':[True]*3},cellOptimization={'mode':mode,'stressTolerance':1e-6},optimizer='lbfgs',maxSteps=300)
            r=b.calculate_job(d,Elastic(),tempfile.gettempdir());self.assertTrue(r['converged'],(mode,r['effectiveFmax'],r['stressResidual']))
            if mode=='c':np.testing.assert_array_equal(np.array(r['cell']['vectors'])[:2],ref[:2])
            part=b.calculate_job({**d,'maxSteps':5},Elastic(),tempfile.gettempdir())
            rr=b.calculate_job({**d,'images':part['images'],'cell':part['cell'],'_optimizerResume':part['optimizerState']},Elastic(),tempfile.gettempdir())
            np.testing.assert_allclose(rr['cell']['vectors'],r['cell']['vectors'],atol=1e-8)
    def test_staged_late_resume_preserves_switch_and_stall_window(self):
        d=data(optimizer='staged',maxSteps=45,fmax=.00001,stagedOptimization={'switchForce':.15,'stallSteps':20})
        whole=b.calculate_job(d,potential,tempfile.gettempdir())
        part=b.calculate_job({**d,'maxSteps':23},potential,tempfile.gettempdir())
        resumed=b.calculate_job({**d,'images':part['images'],'maxSteps':22,'_optimizerResume':part['optimizerState']},potential,tempfile.gettempdir())
        np.testing.assert_allclose(resumed['images'],whole['images'],atol=1e-10)
        self.assertEqual(resumed['optimizationStages'],whole['optimizationStages'])
    def test_path_restart_matches_uninterrupted(self):
        from test_lup_history import request,well
        for mode in ('cineb','lup','perpendicular'):
            for optimizer in ('fire','lbfgs') if mode=='lup' else ('fire',):
                raw={**request(),'mode':mode,'optimizer':optimizer,'maxSteps':12}
                if mode!='lup':raw.pop('lup')
                d=b.validate(raw,'tblite');whole=b.calculate_job(d,well,tempfile.gettempdir())
                part=b.calculate_job({**d,'maxSteps':5},well,tempfile.gettempdir())
                resumed=b.calculate_job({**d,'images':part['images'],'nodeIds':part['nodeIds'],'maxSteps':7,'_optimizerResume':part['optimizerState']},well,tempfile.gettempdir())
                np.testing.assert_allclose(resumed['images'],whole['images'],atol=1e-10,err_msg=mode+' '+optimizer)
    def test_afir_restart_matches_uninterrupted(self):
        d=data(mode='afir',atomIds=['a','b'],maxSteps=25,afir={'schema':'molecule-afir/1','fragments':[{'id':'A','label':'A','atomIds':['a']},{'id':'B','label':'B','atomIds':['b']}],'pairs':[{'a':'A','b':'B','mode':'attract','gamma':1.}],'charge':0,'multiplicity':1,'maxSteps':25,'fmax':1e-5,'maxMove':.08})
        whole=b.calculate_job(d,potential,tempfile.gettempdir());part=b.calculate_job({**d,'maxSteps':9},potential,tempfile.gettempdir())
        r=b.calculate_job({**d,'images':[part['images'][-1]],'maxSteps':16,'_optimizerResume':part['optimizerState']},potential,tempfile.gettempdir())
        np.testing.assert_allclose(r['images'][-1],whole['images'][-1],atol=1e-12)
    def test_cell_cache_includes_lattice_and_copies_stress(self):
        class Calc:
            def with_cell(self,i,p,cell):return np.linalg.det(cell),p.copy(),cell.copy()
        c=b.ExactEvaluationCache(Calc());p=np.zeros((2,3));a=np.eye(3)
        one=c.with_cell(0,p,a);one[2][:]=9
        self.assertEqual(c.with_cell(0,p,a)[2][0,0],1)
        self.assertAlmostEqual(c.with_cell(0,p,2*a)[0],8)
        self.assertEqual((c.calls,c.hits),(2,1))
    def test_real_tblite_stress_matches_cell_energy_derivative(self):
        try:import tblite
        except ImportError:self.skipTest('tblite is not installed')
        reference=np.array([[4.5,0,0],[.2,4.7,0],[.3,.1,4.9]])
        d=data(images=[[[1.,1.,1.],[1.8,1.1,1.]]],cell={'vectors':reference.tolist(),'pbc':[True]*3},cellOptimization={'mode':'full'})
        engine=b.TBLiteEngine(d,{'method':'GFN2-xTB'},tempfile.gettempdir())
        p=np.array(d['images'][0]);energy,force,stress=engine.with_cell(0,p,reference)
        for mode,size in [('isotropic',1),('fixed_angles',3),('c_vector',3),('full',6)]:
            q=np.arange(size)*.003;cell,derivatives=b.cell_geometry(reference,mode,q);pp=p@np.linalg.solve(reference,cell)
            _,_,stress=engine.with_cell(0,pp,cell);analytic,_=b.cell_derivatives(cell,derivatives,stress)
            numeric=[]
            for i in range(size):
                plus=q.copy();minus=q.copy();plus[i]+=1e-4;minus[i]-=1e-4
                c1=b.cell_geometry(reference,mode,plus)[0];c2=b.cell_geometry(reference,mode,minus)[0]
                e1=engine.with_cell(0,p@np.linalg.solve(reference,c1),c1)[0];e2=engine.with_cell(0,p@np.linalg.solve(reference,c2),c2)[0]
                numeric.append((e1-e2)/2e-4)
            np.testing.assert_allclose(analytic,numeric,atol=3e-4,rtol=2e-3,err_msg=mode)
    def test_interrupted_cell_keeps_last_lattice_and_restart_state(self):
        from test_engine import CONFIG
        d=data(cell={'vectors':(np.eye(3)*4).tolist(),'pbc':[True]*3},cellOptimization={'mode':'c'},optimizer='lbfgs',maxSteps=3)
        class Elastic:
            def with_cell(self,i,p,cell):
                delta=cell-np.eye(3)*4.2
                return .5*np.sum(delta**2),np.zeros_like(p),(cell.T@delta)/abs(np.linalg.det(cell))
        events=[];r=b.calculate_job(d,Elastic(),tempfile.gettempdir(),events.append)
        self.assertTrue(all('checkpoint' in e and 'structureCheckpoint' not in e for e in events))
        jobs=b.Jobs.__new__(b.Jobs);jobs.config=CONFIG
        job={'data':d,'status':'interrupted','checkpoints':[e['checkpoint'] for e in events],'diagnosticsHistory':[],'configFingerprint':'public-test'}
        partial=jobs.partial_optimization(job)
        self.assertEqual(partial['cell'],r['cell']);self.assertEqual(partial['trajectory']['cells'],r['trajectory']['cells'])
        self.assertEqual(partial['optimizerState'],r['optimizerState']);self.assertFalse(partial['converged'])

    def test_cell_invalid_combinations(self):
        base=dict(cell={'vectors':(np.eye(3)*4).tolist(),'pbc':[True]*3},cellOptimization={'mode':'c'})
        for patch in ({'fixedAtoms':[0]},{'vibrations':{}},{'cell':{'vectors':(np.eye(3)*4).tolist(),'pbc':[True,True,False]}}):
            with self.assertRaises(ValueError):data(**{**base,**patch})

if __name__=='__main__':unittest.main()
