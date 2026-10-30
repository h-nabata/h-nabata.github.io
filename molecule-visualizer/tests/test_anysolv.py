"""Additive surface, protocol, isolation and optional native AnySolv checks."""
import copy
import os
import queue
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from test_engine import b, WATER
from test_uma import UMA
from test_afir_engine import request as afir_request

CONFIG = {**UMA, 'anysolv':True, 'anysolvModel':'model_compact', 'anysolvDevice':'cuda:1',
          'devices':[{'id':v,'label':v} for v in ('cpu','cuda:0','cuda:1')],
          'cudaMasks':{'cuda:0':'3','cuda:1':'GPU-test-uuid'},
          'anysolvPaths':{'model_compact':'/local/model_compact.pt'},
          'anysolvHashes':{'model_compact':'a'*64}, 'anysolvSolvents':['water','ethanol']}
SOLVATION = {'model':'model_compact', 'solvent':'water', 'device':'cuda:1'}


def fake_init(self, data, config, directory):
    self.data,self.config,self.directory=data,config,directory
    self.shared_state={'active':(data['charge'],data['multiplicity'])}
    self.owns_process=True
    self.components, self.trace = {}, []
    self.timeout = 1
    self.process = SimpleNamespace(is_alive=lambda:True)
    self.pipe = SimpleNamespace(send=lambda request:self.trace.append(('delta', request)),
        poll=lambda timeout:True, recv=lambda:('result', delta(self.trace[-2][1][1])))
    def gas(i, positions):
        self.trace.append(('gas',(i,positions)))
        return .5*(positions**2).sum()+data['multiplicity']+10*data['charge'], -positions
    self.uma = gas


def delta(p):
    return -.25*(p*p).sum()-2, .5*p


class AdditiveSurface(unittest.TestCase):
    def setUp(self):
        patcher=patch.object(b.SolvatedUMAEngine,'__init__',fake_init)
        patcher.start();self.addCleanup(patcher.stop)
        patcher=patch.object(b.SolvatedUMAEngine,'close')
        patcher.start();self.addCleanup(patcher.stop)

    def test_sum_units_force_difference_and_parallel_request_order(self):
        data=b.validate({**WATER,'charge':1,'multiplicity':2,'solvation':SOLVATION},'uma')
        c=b.SolvatedUMAEngine(data,CONFIG,'unused');p=np.array(data['images'][0])
        e,f=c(0,p)
        self.assertAlmostEqual(e,.25*(p*p).sum()+10)
        np.testing.assert_allclose(f,-.5*p)
        self.assertEqual([k for k,v in c.trace],['delta','gas'])
        plus=p.copy();minus=p.copy();plus[1,0]+=.001;minus[1,0]-=.001
        self.assertAlmostEqual(-(c(1,plus)[0]-c(2,minus)[0])/.002,f[1,0],places=10)

    def test_all_calculation_paths_components_constraints_and_partials(self):
        cases=[{**WATER,'mode':'optimize','optimizer':o,'fixedAtoms':[0,2]} for o in ('fire','lbfgs','bfgs')]
        cases.extend([{**afir_request(),'fixedAtoms':[0,2]},
            {**WATER,'mode':'cineb','climbAfter':0,'images':[(np.array(WATER['images'][0])+x).tolist() for x in (0,.1,.2)]},
            {**WATER,'mode':'vibrations','vibrations':{'delta':.001,'nfree':2}},
            {**WATER,'mode':'ts','optimizer':'sella-prfo'}])
        for source in cases:
            if source['mode']=='ts' and not b.sella_version():continue
            with self.subTest(mode=source['mode'],optimizer=source.get('optimizer')):
                if 'afir' in source:source['afir'].update(maxSteps=2,fmax=.00001)
                data=b.validate({**source,'maxSteps':2,'fmax':.00001,'umaDevice':'cuda:0','solvation':SOLVATION},'uma')
                messages=queue.Queue()
                with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ):
                    b.worker(data,CONFIG,directory,messages)
                entries=[]
                while not messages.empty():entries.append(messages.get_nowait())
                self.assertFalse([v for k,v in entries if k=='error'],entries)
                result=next(v for k,v in entries if k=='result')
                checkpoints=[v['checkpoint'] for k,v in entries if k=='progress' and 'checkpoint' in v]
                results=[result]
                if checkpoints:
                    method=b.Jobs(CONFIG).partial_afir if source['mode']=='afir' else b.Jobs(CONFIG).partial_optimization
                    results.append(method({'data':data,'checkpoints':checkpoints,'status':'cancelled'}))
                for r in results:
                    self.assertEqual(r['provenance']['solvent'],'water')
                    self.assertEqual(r['provenance']['uma']['device'],'cuda:0')
                    self.assertEqual(r['provenance']['anysolv']['device'],'cuda:1')
                    self.assertNotIn('/local/',str(r['provenance']))
                    for seq in [r]+([r['trajectory']] if 'trajectory' in r else []):
                        components=seq['energyComponents']
                        np.testing.assert_allclose(seq['energies'],np.array(components['uma'])+components['solvation'])
                        for p,e in zip(seq['images'],seq['energies']):
                            self.assertAlmostEqual(e,.25*(np.array(p)**2).sum()+data['multiplicity']+10*data['charge']-2)
                    if data.get('fixedAtoms'):
                        for p in (r.get('trajectory') or r)['images']:
                            np.testing.assert_array_equal(np.array(p)[[0,2]],np.array(data['images'][0])[[0,2]])
                    if data['mode']=='afir':
                        np.testing.assert_allclose(r['biasedEnergies'],np.array(r['energies'])+r['biasEnergies'])
                if data['mode']=='cineb':np.testing.assert_array_equal(np.array(result['images'])[[0,-1]],np.array(data['images'])[[0,-1]])
                if data['mode']=='vibrations':self.assertEqual(result['vibrations']['status'],'completed')

    def test_failure_never_returns_gas_only(self):
        c=b.SolvatedUMAEngine(b.validate(WATER,'uma'),CONFIG,'unused')
        for value in [('error','AnySolv failed'),('result',(np.nan,np.zeros((3,3)))),('result',(0,np.zeros((2,3))))]:
            c.pipe.recv=lambda:value
            with self.subTest(value=value[0]),self.assertRaises(ValueError):c(0,np.array(WATER['images'][0]))
        self.assertFalse(c.components)

    def test_resumed_scan_preview_retains_checked_components_for_saved_prefix(self):
        data=b.validate({**WATER,'solvation':SOLVATION},'uma')
        c=b.SolvatedUMAEngine(data,CONFIG,'unused');p=np.array(data['images'][0]);q=queue.Queue()
        old_energy,old_force=c(0,p)
        prefix=copy.deepcopy(c.components[c.key(p)])
        c.components.clear();c.component_forces.clear();c.component_maxima.clear()
        def job(data,calculator,directory,progress):
            nextp=p+.02;energy,force=calculator(0,nextp)
            result={'images':[p.tolist(),nextp.tolist()],'energies':[old_energy,energy],
                    'energyComponents':{name:[prefix[name]] for name in ('uma','solvation')}}
            progress({'structureCheckpoint':copy.deepcopy(result),
                      'preview':{'images':copy.deepcopy(result['images']),'energies':result['energies'][:]}})
            return result
        with patch.object(b,'calculate_job',job):
            b.execute_with_calculator(data,b.job_config(data,CONFIG),'unused',q,c)
        progress=q.get_nowait()[1];result=q.get_nowait()[1]
        self.assertEqual(progress['preview']['energyComponents'],result['energyComponents'])
        np.testing.assert_allclose(np.sum(list(result['energyComponents'].values()),axis=0),result['energies'])
        corrupted=copy.deepcopy(result);corrupted['energyComponents']['uma'][0]+=1
        with self.assertRaisesRegex(ValueError,'成分'):
            c.annotate(corrupted)


class Configuration(unittest.TestCase):
    def test_mask_mapping_restores_original_visible_devices(self):
        torch=SimpleNamespace(cuda=SimpleNamespace(is_available=lambda:True,device_count=lambda:2,get_device_name=lambda i:f'GPU {i}'))
        with patch.dict(os.environ,{'CUDA_VISIBLE_DEVICES':'3,GPU-test-uuid'}):
            devices,masks=b.device_inventory(torch)
            self.assertEqual(masks,CONFIG['cudaMasks'])
            self.assertEqual([d['id'] for d in devices],['cpu','cuda:0','cuda:1'])
            self.assertEqual(b.isolate_device({**CONFIG,'umaDevice':'cuda:0'},'umaDevice'),'cuda')
            self.assertEqual(os.environ['CUDA_VISIBLE_DEVICES'],'3')
            self.assertEqual(b.isolate_device({**CONFIG,'anysolvDevice':'cuda:1'},'anysolvDevice'),'cuda')
            self.assertEqual(os.environ['CUDA_VISIBLE_DEVICES'],'GPU-test-uuid')
            b.isolate_device({**CONFIG,'umaDevice':'cpu'},'umaDevice')
            self.assertEqual(os.environ['CUDA_VISIBLE_DEVICES'],'')

    def test_strict_runtime_validation(self):
        good={**WATER,'umaDevice':'cuda:0','solvation':SOLVATION}
        data=b.validate(good,'uma');self.assertEqual(b.job_config(data,CONFIG)['solvation'],SOLVATION)
        for s in [{**SOLVATION,'model':'/tmp/a.pt'},{**SOLVATION,'checkpoint':'/tmp/a.pt'},
                  {**SOLVATION,'solvent':None},{**SOLVATION,'device':'cuda:0;cmd'}]:
            with self.subTest(s=s),self.assertRaises(ValueError):b.validate({**WATER,'solvation':s},'uma')
        for s in [{**SOLVATION,'model':'model_moe'},{**SOLVATION,'solvent':'gas'},{**SOLVATION,'device':'cuda:9'}]:
            with self.subTest(s=s),self.assertRaises(ValueError):b.job_config(b.validate({**WATER,'solvation':s},'uma'),CONFIG)
        with self.assertRaises(ValueError):b.validate(good,'tblite')
        with self.assertRaises(ValueError):b.Jobs(UMA).start(data)


@unittest.skipUnless(os.environ.get('ANYSOLV_TEST_MODEL'),'AnySolv native model not supplied')
class NativeAnySolv(unittest.TestCase):
    def test_compact_energy_gradient_and_vacuum(self):
        config={**CONFIG,'solvation':{**SOLVATION,'device':'cpu'},'anysolvRuntimeDevice':'cpu',
                'anysolvPaths':{'model_compact':os.environ.get('ANYSOLV_TEST_MODEL')}}
        c=b.AnySolvEngine(b.validate(WATER,'uma'),config,'unused');p=np.array(WATER['images'][0])
        e,f=c(0,p);plus=p.copy();minus=p.copy();plus[1,0]+=.001;minus[1,0]-=.001
        self.assertTrue(np.isfinite(e));self.assertTrue(np.isfinite(f).all())
        self.assertAlmostEqual(-(c(0,plus)[0]-c(0,minus)[0])/.002,f[1,0],delta=1e-3)
        c.kwargs['solvent']=None;e,f=c(0,p)
        self.assertAlmostEqual(e,0,delta=1e-7);np.testing.assert_allclose(f,0,atol=1e-7)


if __name__=='__main__':unittest.main()
