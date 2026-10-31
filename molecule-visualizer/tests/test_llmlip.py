"""CPU adapter contracts + opt-in native .e3rs integration (no torch dependency).

LLMLIP_TEST_MODEL=/absolute/path/model.e3rs enables real Rust tests with H/O.
The upstream examples/model.e3rs is synthetic: this verifies wiring, not chemistry.
"""
import copy
import http.client
import json
import os
from pathlib import Path
import queue
import shutil
import sys
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from test_engine import b, CONFIG, WATER
from test_afir_engine import request as afir_request
from test_persistent_jobs import wait_for


MODEL = dict(id='water', available=True, architecture='synthetic-local-v1', species=['H','O'],
             heads=[], defaultHead=None, dtypes=['float64'], periodic='partial', charge=False,
             spin=False, synthetic=True, stress=False, sha256='a'*64)


def config(item=None, **kwargs):
    return {**CONFIG, 'engine':'llmlip', 'llmlipModels':[copy.deepcopy(item or MODEL)],
            'llmlipPaths':{'water':'/unused/model.e3rs'}, 'llmlipDefaultModel':'water',
            'threads':4, 'llmlipMaxThreads':4, 'workers':2, **kwargs}


def selection(**kwargs):
    return dict(model='water', head=None, dtype='float64', threads=4) | kwargs


class FakeModel:
    def __init__(self, path):
        self.requests=[]

    def predict(self, **request):
        self.requests.append(copy.deepcopy(request))
        p=request['positions']
        e=.5*np.sum(p*p)+10*(request['total_charge'] or 0)+(request['spin_multiplicity'] or 0)
        return SimpleNamespace(energy=e, forces=-p)


class Contract(unittest.TestCase):
    def test_strict_inputs_and_engine_separation(self):
        for value in (None, [], {'model':'/tmp/model'}, {'model':'x','path':'/tmp'}, {'model':'x','threads':True}, {'model':'x','dtype':'model-native'}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                b.validate({**WATER,'llmlip':value},'llmlip')
        with self.assertRaises(ValueError): b.validate({**WATER,'llmlip':selection()},'tblite')
        with self.assertRaises(ValueError): b.validate({**WATER,'umaDevice':'cpu'},'llmlip')

    def test_capabilities_preflight(self):
        data=b.validate({**WATER,'llmlip':selection()},'llmlip')
        for changes in ({'model':'missing'}, {'dtype':'float32'}, {'head':'fake'}, {'threads':5}, {'threads':1}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                b.job_config({**data,'llmlip':{**data['llmlip'],**changes}},config())
        for changes in ({'symbols':['C','H','H']}, {'charge':1,'multiplicity':2}, {'multiplicity':3}, {'modelF':{'x':1}}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):b.job_config({**data,**changes},config())
        for periodic in ('none','full'):
            with self.assertRaisesRegex(ValueError,'周期'):
                b.job_config({**data,'cell':{'vectors':np.eye(3).tolist(),'pbc':[True,False,False]}},config({**MODEL,'periodic':periodic}))
        with self.assertRaisesRegex(ValueError,'float64'):
            b.job_config({**data,'mode':'vibrations','llmlip':{**selection(),'dtype':'float32'}},config({**MODEL,'dtypes':['float64','float32']}))
        self.assertEqual(b.job_config(b.validate(WATER,'llmlip'),config({**MODEL,'dtypes':['float32']}))['llmlipSelection']['dtype'],'float32')

    def test_catalog_uses_native_capabilities_and_disables_incomplete_models(self):
        caps=SimpleNamespace(architecture='synthetic-local-v1',supports_energy=True,supports_forces=True,
            supported_species=[],supported_heads=[],supports_float64=True,supports_float32=False,
            input_requirements=SimpleNamespace(total_charge=False,spin_multiplicity=False))
        with tempfile.TemporaryDirectory() as tmp,patch.object(b,'llmlip_model_class') as factory:
            p=Path(tmp);(p/'manifest.toml').write_text('length_unit="angstrom"\nenergy_unit="eV"\nforce_unit="eV/angstrom"\n[species]\nsymbols=["H","O"]\n')
            factory.return_value.return_value.capabilities.return_value=caps
            paths,models=b.llmlip_catalog(['valid='+tmp,'broken='+tmp+'/missing'])
            self.assertTrue(models[0]['available']);self.assertFalse(models[1]['available'])
            self.assertEqual(models[0]['species'],['H','O']);self.assertTrue(models[0]['synthetic'])
            self.assertNotIn(tmp,json.dumps(models))
            for edit in ({'supports_forces':False},{'architecture':'unknown-new-architecture'}):
                factory.return_value.return_value.capabilities.return_value=SimpleNamespace(**(vars(caps)|edit))
                with self.assertRaisesRegex(ValueError,'利用可能'):b.llmlip_catalog(['invalid='+tmp])
            for specs in (['x='+tmp,'x='+tmp],['x=relative/model.e3rs']):
                with self.assertRaises(ValueError):b.llmlip_catalog(specs)

    def test_units_ownership_charge_spin_and_reset(self):
        item={**MODEL,'architecture':'orb-v3-conservative-omol-v1','charge':True,'spin':True,'periodic':'none'}
        data=b.validate({**WATER,'charge':1,'multiplicity':2},'llmlip')
        with patch.object(b,'llmlip_model_class',return_value=FakeModel), patch.object(b,'llmlip_artifact',return_value='a'*64):
            calc=b.make_calculator(data,config(item),tempfile.gettempdir())
            p=np.array(data['images'][0]);e,f=calc(0,p)
            self.assertAlmostEqual(e,.5*(p*p).sum()+12)
            np.testing.assert_array_equal(f,-p)
            args=calc.model.requests[-1]
            self.assertEqual(args['species'],['O','H','H'])
            self.assertEqual(args['total_charge'],1.)
            self.assertEqual(args['spin_multiplicity'],2.)  # 2S+1, never multiplicity-1
            self.assertEqual(args['pbc'],(False,)*3)
            for atom in range(3):
                for axis in range(3):
                    plus=p.copy();minus=p.copy();plus[atom,axis]+=1e-5;minus[atom,axis]-=1e-5
                    self.assertAlmostEqual(f[atom,axis],-(calc(0,plus)[0]-calc(0,minus)[0])/2e-5,places=8)
            loaded=calc.model
            calc.reset(b.validate(WATER,'llmlip'),config(item),tempfile.gettempdir())
            self.assertIs(calc.model,loaded)
            self.assertAlmostEqual(calc(0,p)[0],.5*(p*p).sum()+1)
            self.assertEqual(os.environ['RAYON_NUM_THREADS'],'2')
            self.assertEqual(os.environ['OPENBLAS_NUM_THREADS'],'1')
            self.assertEqual(os.environ['LLMLIP_MACE_METAL'],'0')

    def test_uma_requires_head_specific_charge_policy(self):
        item={**MODEL,'architecture':'uma-v1','heads':['omat','omol'],'defaultHead':'omol'}
        data=b.validate({**WATER,'charge':1,'multiplicity':2},'llmlip')
        c=b.job_config(data,config(item))
        self.assertTrue(c['llmlipCharge']);self.assertTrue(c['llmlipSpin'])
        with self.assertRaises(ValueError):b.job_config({**data,'llmlip':{**selection(),'head':'omat'}},config(item))

    def test_model_identity_includes_hash_head_precision_threads(self):
        data=b.validate(WATER,'llmlip');c=config();original=b.residency_key(data,c)
        self.assertNotEqual(original,b.residency_key({**data,'llmlip':selection(threads=2)},c))
        self.assertNotEqual(original,b.residency_key(data,config({**MODEL,'sha256':'b'*64})))
        identity=b.calculation_identity(data,c)
        self.assertNotEqual(identity,b.calculation_identity(data,config({**MODEL,'sha256':'b'*64})))
        serialized=json.dumps(b.provenance(c,data))
        self.assertNotIn('/unused',serialized)
        self.assertIn('"backend": "direct"',serialized)

    def test_invalid_predictions_and_modified_weights_fail(self):
        data=b.validate(WATER,'llmlip')
        with patch.object(b,'llmlip_model_class',return_value=FakeModel), patch.object(b,'llmlip_artifact',return_value='a'*64):
            calc=b.LLMLIPEngine(data,config(),tempfile.gettempdir())
            for prediction in (SimpleNamespace(energy=float('nan'),forces=np.zeros((3,3))), SimpleNamespace(energy=0,forces=np.zeros((2,3))), SimpleNamespace(energy=0,forces=None)):
                with patch.object(calc.model,'predict',return_value=prediction),self.assertRaises(ValueError):calc(0,np.array(data['images'][0]))
            with patch.object(calc.model,'predict',side_effect=RuntimeError('/private/model')),self.assertRaises(ValueError) as caught:
                calc(0,np.array(data['images'][0]))
            self.assertNotIn('/private',str(caught.exception))
            with patch.object(b,'llmlip_artifact',return_value='changed'),self.assertRaises(ValueError):
                calc.reset(data,config(),tempfile.gettempdir())

    def test_artifact_digest_tracks_all_weights_and_rejects_links(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);(p/'manifest.toml').write_text('test');(p/'weights').mkdir();w=p/'weights'/'a.bin';w.write_bytes(b'123')
            old=b.llmlip_artifact(p,True);w.write_bytes(b'124')
            self.assertNotEqual(old,b.llmlip_artifact(p,True))
            (p/'linked').symlink_to(w)
            with self.assertRaises(ValueError):b.llmlip_artifact(p,True)

    def test_analytic_ts_and_irc_use_the_same_adapter(self):
        if not b.sella_version():self.skipTest('Sella not installed')
        from test_ts_vibrations import H2, saddle
        from test_irc_thermochemistry import irc_input
        class SaddleModel(FakeModel):
            def predict(self, **request):
                energy,forces=saddle(0,request['positions'])
                return SimpleNamespace(energy=energy,forces=forces)
        for data in (b.validate({**H2,'mode':'ts','fmax':1e-5,'maxSteps':40},'llmlip'),irc_input()):
            with self.subTest(mode=data['mode']),tempfile.TemporaryDirectory() as tmp,patch.object(b,'llmlip_model_class',return_value=SaddleModel),patch.object(b,'llmlip_artifact',return_value='a'*64):
                calc=b.LLMLIPEngine(data,config(),tmp)
                result=b.calculate_job(data,calc,tmp)
                self.assertTrue(result['converged'])
                for p,e in zip(result['images'],result['energies']):self.assertAlmostEqual(calc(0,p)[0],e)
                if data['mode']=='irc':
                    distances=[np.linalg.norm(np.diff(p,axis=0)) for p in (result['images'][0],result['images'][-1])]
                    np.testing.assert_allclose(sorted(distances),[1-1/np.sqrt(2),1+1/np.sqrt(2)],atol=.003)


@unittest.skipUnless(os.environ.get('LLMLIP_TEST_MODEL'),'native llmlip model not supplied; set LLMLIP_TEST_MODEL (synthetic != chemical validation)')
class Native(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path=str(Path(os.environ['LLMLIP_TEST_MODEL']).resolve())
        paths,models=b.llmlip_catalog(['water='+cls.path])
        cls.config=config(llmlipPaths=paths,llmlipModels=models,historyDir=None,residentModels=True)

    def engine(self, source=WATER):
        data=b.validate(source,'llmlip')
        return data,b.LLMLIPEngine(data,self.config,tempfile.gettempdir())

    def test_real_rust_single_point_force_difference_and_ase_parity(self):
        data,calc=self.engine();p=np.array(data['images'][0]);energy,force=calc(0,p)
        from llmlip.ase import LlmlipCalculator
        from ase import Atoms
        atoms=Atoms(data['symbols'],positions=p)
        atoms.calc=LlmlipCalculator(self.path,backend='direct',dtype='float64',head=calc.config['llmlipSelection']['head'])
        self.assertAlmostEqual(energy,atoms.get_potential_energy(),places=10)
        np.testing.assert_allclose(force,atoms.get_forces(),atol=1e-10,rtol=1e-10)
        differences=[]
        for atom in range(3):
            for axis in range(3):
                plus=p.copy();minus=p.copy();plus[atom,axis]+=1e-4;minus[atom,axis]-=1e-4
                differences.append(abs(force[atom,axis]+(calc(1,plus)[0]-calc(2,minus)[0])/2e-4))
        self.assertLess(max(differences),2e-4)
        print('llmlip native finite-difference max error (eV/A):',max(differences))
        self.assertNotIn('torch',sys.modules)

    def test_real_rust_pbc_and_parallel_images(self):
        if self.config['llmlipModels'][0]['periodic']=='none':self.skipTest('selected model does not support PBC')
        lattice=np.array([[16.,0,0],[1.,16,0],[.5,.7,16]])
        boundaries=[[True,True,True]]+([[True,False,False]] if self.config['llmlipModels'][0]['periodic']=='partial' else [])
        for pbc in boundaries:
            with self.subTest(pbc=pbc):
                data,calc=self.engine({**WATER,'cell':{'vectors':lattice.tolist(),'pbc':pbc}})
                p=np.array(data['images'][0]);translated=p.copy();translated[1]+=lattice[0]
                e,f=calc(0,p);ee,ff=calc(1,translated)
                self.assertAlmostEqual(e,ee,places=7);np.testing.assert_allclose(f,ff,atol=1e-7)
                cache=b.ExactEvaluationCache(calc,workers=2)
                try:
                    results=cache.map([(0,p),(1,translated)])
                    for actual in results:np.testing.assert_allclose(actual[1],f,atol=1e-7)
                finally:cache.close()

    def test_learned_model_converged_water_minimum(self):
        if self.config['llmlipModels'][0]['synthetic']:self.skipTest('synthetic fixture is not a learned molecular potential')
        data,calc=self.engine({**WATER,'mode':'optimize','optimizer':'lbfgs','maxSteps':100,'fmax':.01})
        with tempfile.TemporaryDirectory() as tmp:result=b.calculate_job(data,calc,tmp)
        self.assertTrue(result['converged'],result['reason'])
        self.assertLessEqual(result['effectiveFmax'],.01)
        self.assertLess(result['energies'][0],calc(0,data['images'][0])[0])
        print('llmlip learned H2O MIN:',result['steps'],'steps; max force:',result['effectiveFmax'],'eV/A')

    def test_real_rust_min_afir_cineb_lup_vibrations(self):
        path=[(np.array(WATER['images'][0])*scale).tolist() for scale in (0.9,1.,1.1)]
        sources=[{**WATER,'mode':'optimize'},{**afir_request()},
                 {**WATER,'mode':'cineb','images':path,'climbAfter':0},
                 {**WATER,'mode':'lup','images':path,'climbAfter':0},
                 {**WATER,'mode':'vibrations'}]
        for source in sources:
            with self.subTest(mode=source['mode']),tempfile.TemporaryDirectory() as tmp:
                source={**source,'maxSteps':2,'fmax':.00001}
                if 'afir' in source:source['afir'].update(maxSteps=2,fmax=.00001)
                data,calc=self.engine(source);out=queue.Queue()
                b.execute_with_calculator(data,b.job_config(data,self.config),tmp,out,calc)
                records=[]
                while not out.empty():records.append(out.get())
                result=next(v for k,v in records if k=='result')
                self.assertTrue(np.isfinite(result['energies']).all())
                self.assertEqual(result['provenance']['llmlip']['device'],'cpu')
                for i,(p,e) in enumerate(zip(result['images'],result['energies'])):
                    self.assertAlmostEqual(calc(i,p)[0],e,places=9)
                if data['mode'] in ('cineb','lup'):
                    self.assertEqual(result['images'][0],data['images'][0]);self.assertEqual(result['images'][-1],data['images'][-1])
                if data['mode']=='optimize':self.assertLessEqual(result['energies'][-1],calc(0,data['images'][0])[0]+1e-10)
                if data['mode']=='vibrations':self.assertEqual(result['vibrations']['status'],'completed')
                if data['mode']=='afir':np.testing.assert_allclose(np.array(result['energies'])+result['biasEnergies'],result['biasedEnergies'])

    def test_native_jobs_reuse_restart_threads_and_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            jobs=b.Jobs({**self.config,'historyDir':tmp})
            try:
                first=jobs.start(b.validate(WATER,'llmlip'));r=wait_for(jobs,first['id'])
                self.assertEqual(r['status'],'completed',r)
                process=jobs.resident['process']
                second=jobs.start(b.validate({**WATER,'images':[(np.array(WATER['images'][0])*1.01).tolist()]},'llmlip'))
                r=wait_for(jobs,second['id']);self.assertEqual(r['status'],'completed',r)
                self.assertIs(process,jobs.resident['process'])
                third=jobs.start(b.validate({**WATER,'llmlip':{**selection(),'threads':2,'head':self.config['llmlipModels'][0]['defaultHead']}},'llmlip'))
                r=wait_for(jobs,third['id']);self.assertEqual(r['status'],'completed',r)
                self.assertIsNot(process,jobs.resident['process'])
                self.assertEqual(r['result']['provenance']['llmlip']['threads'],2)
                self.assertEqual(r['data']['llmlip']['model'],'water')
                self.assertNotIn(self.path,json.dumps(r))
            finally:jobs.close()
            restored=b.Jobs({**self.config,'historyDir':tmp})
            try:self.assertEqual(restored.get(first['id'])['result']['engine'],'llmlip')
            finally:restored.close()

    def test_native_irc_rejects_unconverged_input(self):
        if not b.sella_version():self.skipTest('Sella not installed')
        data,calc=self.engine({**WATER,'mode':'irc','fmax':.00001,'maxSteps':1})
        with tempfile.TemporaryDirectory() as tmp,self.assertRaisesRegex(ValueError,'収束閾値'):
            b.calculate_job(data,calc,tmp)

    def test_native_http_catalog_jobs_and_model_switch(self):
        cfg={**self.config,'llmlipModels':self.config['llmlipModels']+[{**self.config['llmlipModels'][0],'id':'second'}],
             'llmlipPaths':{**self.config['llmlipPaths'],'second':self.path}}
        server=b.make_server(cfg,'llmlip-test-token',0,['https://h-nabata.github.io'])
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def call(method,path,body=None):
            connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=20)
            connection.request(method,path,body=None if body is None else json.dumps(body),headers={
                'Authorization':'Bearer llmlip-test-token','Origin':'https://h-nabata.github.io','Content-Type':'application/json'})
            response=connection.getresponse();out=response.status,json.loads(response.read());connection.close();return out
        try:
            status,info=call('GET','/api/info');self.assertEqual(status,200)
            self.assertEqual(info['engine'],'llmlip');self.assertTrue(info['llmlip']['beta'])
            self.assertFalse(info['cellOptimization']);self.assertIsNone(info['modelF'])
            self.assertNotIn(self.path,json.dumps(info))
            for changes in ({'model':'unknown'},{'threads':99},{'path':self.path}):
                self.assertEqual(call('POST','/api/jobs',{**WATER,'llmlip':changes})[0],400)
            processes=[]
            for identifier in ('water','second'):
                status,job=call('POST','/api/jobs',{**WATER,'llmlip':{'model':identifier}})
                self.assertEqual(status,202)
                record=wait_for(server.jobs,job['id']);self.assertEqual(record['status'],'completed',record)
                self.assertEqual(record['result']['provenance']['llmlip']['model'],identifier)
                processes.append(server.jobs.resident['process'])
            self.assertIsNot(*processes)
        finally:
            server.jobs.close();server.shutdown();server.server_close();thread.join()

    def test_native_cancellation_releases_resident_and_runs_next_job(self):
        jobs=b.Jobs(self.config)
        try:
            job=jobs.start(b.validate({**WATER,'mode':'optimize','maxSteps':10000,'fmax':1e-5},'llmlip'))
            process=jobs.resident['process']
            jobs.cancel(job['id'])
            self.assertEqual(wait_for(jobs,job['id'])['status'],'cancelled')
            self.assertFalse(process.is_alive())
            next_job=jobs.start(b.validate(WATER,'llmlip'))
            self.assertEqual(wait_for(jobs,next_job['id'])['status'],'completed')
            self.assertIsNot(process,jobs.resident['process'])
        finally:jobs.close()


if __name__=='__main__':unittest.main()
