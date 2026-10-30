"""AMF mathematics, electronic-state isolation, native forces and recovery."""
import copy
import json
import queue
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
from test_engine import b, CONFIG


def settings(surface='lower', alpha=30.):
    return {'model':'amf','surface':surface,'alphaKJMol':alpha,'multiplicities':[1,3]}


class State:
    def __init__(self, multiplicity):self.sign=-1 if multiplicity==1 else 1
    def __call__(self,index,p):
        displacement=np.asarray(p)-[self.sign,0,0]
        return .5*float(np.sum(displacement**2)),-displacement


class ModelF(unittest.TestCase):
    def data(self,**changes):
        return b.validate({'symbols':['He'],'images':[[[-1.3,.2,.1]]],'mode':'optimize','optimizer':'lbfgs',
                           'maxSteps':150,'fmax':1e-5,'modelF':settings(),**changes},'tblite')

    def toy(self,data):
        with patch.object(b,'make_calculator',lambda d,c,path:State(d['multiplicity'])):
            return b.ModelFEngine(data,CONFIG,None)

    def test_eigenvalues_and_gap_derivative_by_independent_finite_difference(self):
        for surface in ('lower','upper'):
            for alpha in (1e-6,.1,30.,10000.):
                s=settings(surface,alpha);a=alpha/b.KJ_MOL_PER_EV
                for t in (-30,-2,-.8,-.2,0,.2,.8,2,30):
                    e=np.array([a*t/2,-a*t/2]);row=b.model_f_components(*e,s)
                    def eigen(values):
                        coupling=a/2*np.exp(-((values[0]-values[1])/a)**2)
                        return np.linalg.eigvalsh([[values[0],coupling],[coupling,values[1]]])[int(surface=='upper')]
                    self.assertAlmostEqual(row[surface+'EV'],eigen(e),delta=max(1e-14,a*1e-13))
                    h=a*1e-5
                    for i in range(2):
                        step=np.eye(2)[i]*h;numeric=(eigen(e+step)-eigen(e-step))/(2*h)
                        self.assertAlmostEqual(row['weight'+str(i+1)],numeric,delta=2e-8)
                    self.assertAlmostEqual(row['weight1']+row['weight2'],1.)
        row=b.model_f_components(-1000000.,-999999.,settings(alpha=1e-300))
        self.assertEqual(row['lowerEV'],-1000000.)

    def test_zero_coupling_and_nondifferentiable_crossing(self):
        d=self.data(modelF=settings(alpha=0));c=self.toy(d)
        for x in (-.1,.1):
            p=np.array([[x,0,0]]);values=[State(m)(0,p) for m in (1,3)]
            e,f=c(0,p);lowest=min(values,key=lambda v:v[0]);self.assertEqual(e,lowest[0]);np.testing.assert_array_equal(f,lowest[1])
        with self.assertRaisesRegex(ValueError,'一意'):c(0,np.zeros((1,3)))

    def test_input_validation_charge_parity_capability_and_thermochemistry(self):
        for bad in ({'multiplicities':[1,1]}, {'multiplicities':[1,2]}, {'multiplicities':[3,1]},
                    {'alphaKJMol':-1}, {'surface':'seam'}, {'model':'unknown'}, {'multiplicities':[1,True]}):
            with self.assertRaises(ValueError):self.data(modelF={**settings(),**bad})
        with self.assertRaisesRegex(ValueError,'熱化学'):
            b.validate({**self.data(),'vibrations':{},'thermochemistry':{}},'tblite')

    def test_minimum_both_surfaces_records_and_restarts(self):
        for surface in ('lower','upper'):
            d=self.data(modelF=settings(surface));c=self.toy(d)
            full=b.calculate_job(d,c,None);c.annotate(full)
            self.assertTrue(full['converged']);self.assertEqual(full['modelF'],d['modelF'])
            for i,e in enumerate(full['trajectory']['energies']):
                row={k:v[i] for k,v in full['trajectory']['surfaceComponents'].items()};c.check_row(row,e)
            short=b.calculate_job({**d,'maxSteps':3},self.toy(d),None)
            resumed_data={**d,'images':short['images'],'_optimizerResume':short['optimizerState']}
            resumed=b.calculate_job(resumed_data,self.toy(resumed_data),None)
            np.testing.assert_allclose(full['images'],resumed['images'],atol=1e-11,rtol=0)

    def test_partial_and_serialized_history_keep_model_surface_components(self):
        d=self.data(maxSteps=3);messages=queue.Queue();c=self.toy(d)
        b.execute_with_calculator(d,CONFIG,None,messages,c)
        checkpoints=[];result=None
        while not messages.empty():
            kind,value=messages.get()
            if kind=='progress' and 'checkpoint' in value:checkpoints.append(value['checkpoint'])
            if kind=='result':result=value
        self.assertEqual(result['performance']['engineCalls'],sum(result['performance']['stateEngineCalls']))
        job={'id':'a'*32,'data':d,'status':'cancelled','checkpoints':checkpoints,'progress':{}}
        partial=b.Jobs(CONFIG).partial_optimization(job)
        self.assertEqual(partial['modelF'],settings());self.assertEqual(len(partial['trajectory']['surfaceComponents']['gapEV']),len(checkpoints))
        json.loads(json.dumps(partial,allow_nan=False))

    def test_failed_second_state_never_returns_first_state_or_records_partial_pair(self):
        d=self.data();c=self.toy(d)
        c(0,np.array(d['images'][0]));before=len(c.records)
        def fail(i,p):raise ValueError('intentional SCF failure')
        c.secondary=fail
        with self.assertRaisesRegex(ValueError,'状態2'):c(0,np.zeros((1,3)))
        self.assertEqual(len(c.records),before)

    def test_native_tblite_two_spin_forces_and_variable_cell_stress(self):
        p=np.array([[0.,0,0],[1.1,.1,0]])
        for surface in ('lower','upper'):
            raw={'symbols':['H','H'],'images':[p.tolist()],'mode':'evaluate','modelF':settings(surface,100)}
            d=b.validate(raw,'tblite');c=b.ModelFEngine(d,CONFIG,tempfile.gettempdir());e,f=c(0,p)
            h=1e-4;shift=np.zeros_like(p);shift[1,0]=h
            numeric=-(c(1,p+shift)[0]-c(2,p-shift)[0])/(2*h)
            self.assertAlmostEqual(f[1,0],numeric,delta=3e-4)
            self.assertEqual(c.primary.data['multiplicity'],1);self.assertEqual(c.secondary.data['multiplicity'],3)
            self.assertIsNot(c.primary.calculators,c.secondary.calculators)
        cell=np.eye(3)*6;d=b.validate({**raw,'mode':'optimize','optimizer':'lbfgs','maxSteps':2,
                    'cell':{'vectors':cell.tolist(),'pbc':[True]*3},'cellOptimization':{'mode':'isotropic'}},'tblite')
        c=b.ModelFEngine(d,CONFIG,tempfile.gettempdir());e,f,stress=c.with_cell(0,p,cell)
        h=1e-5
        numeric=(c.with_cell(1,p*(1+h),cell*(1+h))[0]-c.with_cell(2,p*(1-h),cell*(1-h))[0])/(2*h)
        self.assertAlmostEqual(numeric,float(np.trace(stress))*abs(np.linalg.det(cell)),delta=2e-3)

    def run_job(self,d,c,config=CONFIG):
        messages=queue.Queue()
        with tempfile.TemporaryDirectory() as path:b.execute_with_calculator(d,config,path,messages,c)
        entries=[]
        while not messages.empty():entries.append(messages.get())
        return next(v for k,v in entries if k=='result'),[v for k,v in entries if k=='progress']

    def test_path_both_surfaces_parallel_endpoints_and_partial_band(self):
        images=[[[x,.2*(1-x*x),0]] for x in (-1.,-.5,0.,.5,1.)]
        for surface in ('lower','upper'):
            for mode in ('perpendicular','neb','cineb','lup'):
                with self.subTest(surface=surface,mode=mode):
                    d=self.data(mode=mode,optimizer='lbfgs' if mode=='lup' else 'fire',images=images,maxSteps=3,climbAfter=0,livePreview=True,modelF=settings(surface))
                    serial,_=self.run_job(d,self.toy(d))
                    parallel,updates=self.run_job(d,self.toy(d),{**CONFIG,'workers':3})
                    np.testing.assert_allclose(serial['images'],parallel['images'],atol=1e-12)
                    np.testing.assert_array_equal(np.array(parallel['images'])[[0,-1]],np.array(images)[[0,-1]])
                    for i,p in enumerate(parallel['images']):
                        e,f=self.toy(d)(0,np.array(p));self.assertAlmostEqual(e,parallel['energies'][i],places=12)
                    saved=next(v['bandCheckpoint'] for v in reversed(updates) if 'bandCheckpoint' in v)
                    partial=b.Jobs(CONFIG).partial_structure({'data':d,'bandCheckpoint':saved,'status':'cancelled'})
                    self.assertEqual(partial['surfaceComponents'],parallel['surfaceComponents'])
                    self.assertFalse(partial['converged'])

    def test_afir_constraints_bias_and_partial_are_separate_from_model_surface(self):
        from test_afir_engine import request
        raw=request();raw.update(modelF=settings(),maxSteps=3,livePreview=True,fixedAtoms=[0])
        raw['afir'].update(maxSteps=3,fmax=.00001);d=b.validate(raw,'tblite')
        c=self.toy(d);r,updates=self.run_job(d,c)
        np.testing.assert_array_equal(np.array(r['images'])[:,0],np.broadcast_to(d['images'][0][0],(len(r['images']),3)))
        np.testing.assert_allclose(np.array(r['energies'])+r['biasEnergies'],r['biasedEnergies'])
        for i,e in enumerate(r['energies']):c.check_row({k:v[i] for k,v in r['surfaceComponents'].items()},e)
        frames=[u['checkpoint'] for u in updates if 'checkpoint' in u]
        partial=b.Jobs(CONFIG).partial_afir({'data':d,'status':'cancelled','checkpoints':frames})
        self.assertEqual(r['surfaceComponents'],partial['surfaceComponents'])
        self.assertEqual(partial['validation'],'biased-trajectory-not-ts')

    def test_scan_resume_prefix_has_two_state_values_without_reevaluation(self):
        d=b.validate({'symbols':['H','H'],'images':[[[0,0,0],[1.2,.1,0]]],'mode':'scan','optimizer':'lbfgs',
           'maxSteps':80,'modelF':settings(),'scan':{'coordinates':[{'type':'distance','atoms':[0,1],'start':1.,'stop':1.4,'points':3}]}},'tblite')
        full,_=self.run_job(d,self.toy(d));self.assertTrue(full['converged'])
        saved=copy.deepcopy(full)
        for key in ('images','energies','forces','imageFmax','history'):saved[key]=saved[key][:1]
        saved['scan']['nodes']=saved['scan']['nodes'][:1]
        for name in ('surfaceComponents','forceComponents'):
            for key in saved.get(name,{}):saved[name][key]=saved[name][key][:1]
        resumed_data={**d,'_scanResume':saved};c=self.toy(resumed_data)
        self.assertEqual(c.state_calls,[0,0]);self.assertEqual(len(c.records),1)
        resumed,_=self.run_job(resumed_data,c)
        np.testing.assert_allclose(resumed['images'],full['images'],atol=1e-8)
        np.testing.assert_allclose(resumed['surfaceComponents']['state2EV'],full['surfaceComponents']['state2EV'],atol=1e-8)
        with self.assertRaisesRegex(ValueError,'条件'):self.toy({**resumed_data,'modelF':settings('upper')})
        saved['surfaceComponents']['state1EV'][0]+=.1
        with self.assertRaisesRegex(ValueError,'成分'):self.toy(resumed_data)

    def test_variable_cell_trajectory_and_native_vibrations_keep_components(self):
        p=[[0,0,0],[1.1,.1,0]]
        d=b.validate({'symbols':['H','H'],'images':[p],'mode':'optimize','optimizer':'lbfgs','maxSteps':2,
              'modelF':settings(),'cell':{'vectors':(np.eye(3)*6).tolist(),'pbc':[True]*3},
              'cellOptimization':{'mode':'c'},'livePreview':True},'tblite')
        r,_=self.run_job(d,b.ModelFEngine(d,CONFIG,tempfile.gettempdir()))
        self.assertEqual(len(r['trajectory']['surfaceComponents']['gapEV']),r['steps']+1)
        np.testing.assert_array_equal(np.array(r['cell']['vectors'])[:2],np.array(d['cell']['vectors'])[:2])
        d=b.validate({'symbols':['H','H'],'images':[p],'mode':'vibrations','modelF':settings(),
                      'vibrations':{'delta':.001,'nfree':2}},'tblite')
        r,_=self.run_job(d,b.ModelFEngine(d,CONFIG,tempfile.gettempdir()),{**CONFIG,'workers':2})
        self.assertEqual(r['vibrations']['status'],'completed')
        self.assertEqual(len(r['vibrations']['frequenciesCM']),6)
        self.assertEqual(r['performance']['stateEngineCalls'][0],r['performance']['stateEngineCalls'][1])

    def test_uma_weights_shared_but_charge_spin_and_geometry_caches_isolated(self):
        from unittest.mock import Mock
        from test_uma import UMA,FakeCalculator
        predictor=SimpleNamespace(calls=[]);pretrained=SimpleNamespace(get_predict_unit=Mock(return_value=predictor))
        packages=(SimpleNamespace(set_num_threads=Mock()),FakeCalculator,pretrained,SimpleNamespace)
        d=self.data();p=np.array(d['images'][0])
        with patch.object(b,'uma_packages',return_value=packages):
            c=b.ModelFEngine(d,UMA,tempfile.gettempdir());c(0,p);c(1,p+.1)
            self.assertIs(c.primary.predictor,c.secondary.predictor);self.assertIsNot(c.primary.atoms,c.secondary.atoms)
            self.assertEqual([a.info['spin'] for a in predictor.calls],[1,3,1,3])
            old=c.primary.atoms
            c.reset({**d,'modelF':settings('upper',80)},UMA,tempfile.gettempdir())
            self.assertEqual(c.records,{});self.assertIsNot(c.primary.atoms,old);c(0,p)
            pretrained.get_predict_unit.assert_called_once()
            self.assertEqual(c.state_calls,[1,1])

    def test_anysolv_shared_process_switches_spin_and_preserves_each_state_components(self):
        from unittest.mock import Mock
        from test_uma import FakeCalculator
        from test_anysolv import CONFIG as AC,SOLVATION
        predictor=SimpleNamespace(calls=[]);pretrained=SimpleNamespace(get_predict_unit=Mock(return_value=predictor))
        packages=(SimpleNamespace(set_num_threads=Mock()),FakeCalculator,pretrained,SimpleNamespace)
        trace=[];spins=[];responses=[]
        class Pipe:
            def send(self,request):
                trace.append(request)
                if isinstance(request,dict):spins.append(request['data']['multiplicity']);responses.append(('ready',None))
                else:
                    i,p=request;responses.append(('result',(-.1*spins[-1]-.05*float(np.sum(p*p)),.1*p)))
            def poll(self,t):return bool(responses)
            def recv(self):return responses.pop(0)
        def start(s,d,c,path):
            s.data,s.config,s.directory=d,c,path;s.shared_state={'active':(d['charge'],d['multiplicity'])}
            s.owns_process=True;s.components={};s.timeout=1;s.pipe=Pipe();s.process=SimpleNamespace(is_alive=lambda:True)
            s.uma=b.UMAEngine(d,c,path);spins.append(d['multiplicity'])
        d=b.validate({**self.data(),'solvation':SOLVATION},'uma');config={**AC,'solvation':SOLVATION}
        with patch.object(b,'uma_packages',return_value=packages),patch.object(b.SolvatedUMAEngine,'__init__',start):
            c=b.ModelFEngine(d,config,'unused');p=np.array(d['images'][0])
            energies=[c(0,p+delta)[0] for delta in (0,.02)]
            self.assertIs(c.primary.pipe,c.secondary.pipe);self.assertIs(c.primary.shared_state,c.secondary.shared_state)
            self.assertIs(c.primary.uma.predictor,c.secondary.uma.predictor)
            self.assertEqual(spins,[1,3,1,3]);pretrained.get_predict_unit.assert_called_once()
            r={'images':[p.tolist()],'energies':[energies[0]]};c.annotate(r)
            for state in (1,2):self.assertAlmostEqual(r['surfaceComponents'][f'state{state}EV'][0],r['surfaceComponents'][f'state{state}UmaEV'][0]+r['surfaceComponents'][f'state{state}SolvationEV'][0])
            c.reset({**d,'modelF':settings('upper',60)},config,'unused');self.assertEqual(c.records,{})
            e,f=c(0,p);self.assertAlmostEqual(e,c.records[c.key(p,energy=e)]['upperEV'])
            h=1e-5;shift=np.zeros_like(p);shift[0,0]=h
            self.assertAlmostEqual(f[0,0],-(c(0,p+shift)[0]-c(0,p-shift)[0])/(2*h),places=8)

    def test_disk_interruption_recovery_and_resume_keep_surface_identity(self):
        d=self.data(maxSteps=3,livePreview=True);result,updates=self.run_job(d,self.toy(d))
        checkpoints=[u['checkpoint'] for u in updates if 'checkpoint' in u]
        with tempfile.TemporaryDirectory() as path:
            config={**CONFIG,'historyDir':path};jobs=b.Jobs(config)
            with patch.object(jobs,'_launch_next'):created=jobs.start(d)
            job=jobs.jobs[created['id']];job.update(status='running',checkpoints=checkpoints);jobs._persist(job,force=True)
            recovered=b.Jobs(config);saved=recovered.get(created['id'])
            self.assertEqual(saved['status'],'interrupted');self.assertEqual(saved['result']['modelF'],d['modelF'])
            self.assertEqual(saved['result']['surfaceComponents'],result['surfaceComponents'])
            with patch.object(recovered,'_launch_next'):resumed=recovered.resume(created['id'])
            self.assertEqual(resumed['data']['modelF'],d['modelF']);self.assertEqual(resumed['resumeKind'],'optimizer_state')
            job=recovered.jobs[created['id']];job['data']['modelF']['surface']='upper'
            with self.assertRaisesRegex(RuntimeError,'異なります'):recovered.resume(created['id'])

    def test_repeated_geometry_keeps_pair_for_each_reported_scc_energy(self):
        d=self.data();c=self.toy(d);p=np.zeros((1,3));e1=c(0,p)[0]
        c.secondary=lambda i,p:(State(3)(i,p)[0]+.001,State(3)(i,p)[1]);e2=c(1,p)[0]
        r={'images':[p.tolist(),p.tolist()],'energies':[e1,e2]};c.annotate(r)
        self.assertAlmostEqual(r['surfaceComponents']['state2EV'][1]-r['surfaceComponents']['state2EV'][0],.001)

    def test_ts_and_irc_differentiate_the_same_model_surface(self):
        from test_ts_vibrations import H2,saddle
        for surface in ('lower','upper'):
            def factory(d,c,path):
                offset=0 if d['multiplicity']==1 else .1
                def evaluate(i,p):
                    e,f=saddle(i,p);return e+offset,f
                return evaluate
            d=b.validate({**H2,'mode':'ts','modelF':settings(surface),'maxSteps':50,'fmax':.001,'livePreview':True},'tblite')
            with patch.object(b,'make_calculator',factory):c=b.ModelFEngine(d,CONFIG,'unused')
            r,_=self.run_job(d,c);self.assertTrue(r['converged'])
            self.assertAlmostEqual(np.linalg.norm(np.array(r['images'][0][1])-r['images'][0][0]),1.,delta=.001)
            irc=b.validate({**H2,'images':[[[0,0,0],[1,0,0]]],'mode':'irc','modelF':settings(surface),'maxSteps':5,
                            'fmax':.01,'irc':{'direction':'both','relaxEndpoints':False},'livePreview':True},'tblite')
            with patch.object(b,'make_calculator',factory):c=b.ModelFEngine(irc,CONFIG,'unused')
            r,_=self.run_job(irc,c);self.assertGreater(len(r['images']),2)
            self.assertEqual(len(r['surfaceComponents']['state2EV']),len(r['images']))


if __name__=='__main__':unittest.main()
