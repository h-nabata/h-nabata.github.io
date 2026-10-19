"""UMA adapter contract tests use a real ASE wrapper and a fake ML predictor.

No gated weights or credentials are required by CI. UMA_TEST_MODEL explicitly
opts into the separate native test; a skip is not evidence of model accuracy.
"""
import copy
import http.client
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import numpy as np
from ase.calculators.calculator import Calculator, all_changes
from test_engine import b, WATER, CONFIG
from test_afir_engine import request as afir_request

UMA = {**CONFIG, 'engine':'uma', 'umaModel':'uma-s-1p2p1', 'umaDevice':'cpu', 'umaPrecision':'float64'}


class FakeCalculator(Calculator):
    implemented_properties = ['energy', 'forces']

    def __init__(self, predictor, task_name):
        super().__init__()
        assert task_name == 'omol'
        self.predictor = predictor

    def calculate(self, atoms=None, properties=('energy',), system_changes=all_changes):
        super().calculate(atoms, properties, system_changes)
        self.predictor.calls.append(atoms.copy())
        # A smooth known potential in ASE units, with distinct charge/spin dependence.
        p = atoms.positions
        self.results = {'energy':float(.5*(p*p).sum()+10*atoms.info['charge']+atoms.info['spin']), 'forces':-p.copy()}


class Adapter(unittest.TestCase):
    def setUp(self):
        self.predictor = SimpleNamespace(calls=[])
        self.pretrained = SimpleNamespace(get_predict_unit=Mock(return_value=self.predictor))
        self.torch = SimpleNamespace(set_num_threads=Mock())
        self.packages = patch.object(b, 'uma_packages', return_value=(self.torch,FakeCalculator,self.pretrained,SimpleNamespace))
        self.packages.start()
        self.addCleanup(self.packages.stop)

    def test_units_charge_spin_reuse_and_finite_difference(self):
        data = b.validate({**WATER,'charge':1,'multiplicity':2}, 'uma')
        engine = b.UMAEngine(data, UMA, tempfile.gettempdir())
        p = np.array(data['images'][0]);e,f = engine(0,p)
        self.assertAlmostEqual(e,.5*(p*p).sum()+12)
        np.testing.assert_array_equal(f,-p)
        self.assertEqual(engine.atoms[0].info, {'charge':1,'spin':2})
        self.assertFalse(engine.atoms[0].pbc.any())
        plus=p.copy();minus=p.copy();plus[1,0]+=.001;minus[1,0]-=.001
        self.assertAlmostEqual(-(engine(1,plus)[0]-engine(2,minus)[0])/.002,f[1,0],places=10)
        engine(0,plus)
        np.testing.assert_array_equal(engine.atoms[0].positions,plus)
        np.testing.assert_array_equal(engine.atoms[2].positions,minus)
        self.pretrained.get_predict_unit.assert_called_once()
        kwargs = self.pretrained.get_predict_unit.call_args.kwargs
        self.assertEqual(kwargs['device'],'cpu')
        self.assertEqual(vars(kwargs['inference_settings']),b.uma_settings(UMA))
        self.assertFalse(kwargs['inference_settings'].tf32)
        self.assertFalse(kwargs['inference_settings'].compile)
        self.assertEqual(kwargs['inference_settings'].base_precision_dtype,'float64')

    def test_min_and_afir_constraints_band_endpoints_and_vibrations(self):
        requests = [{**WATER,'mode':'optimize','optimizer':o,'fixedAtoms':[0,2]} for o in ['fire','lbfgs','bfgs']]
        requests.append({**afir_request(),'fixedAtoms':[0,2]})
        requests.append({**WATER,'mode':'cineb','climbAfter':0,'images':[
            (np.array(WATER['images'][0])+x).tolist() for x in (0,.1,.2)]})
        requests.append({**WATER,'mode':'vibrations','vibrations':{'delta':.001,'nfree':2,'imaginaryThreshold':20}})
        for source in requests:
            with self.subTest(mode=source['mode'],optimizer=source.get('optimizer')),tempfile.TemporaryDirectory() as directory:
                if 'afir' in source:
                    source['afir'].update(maxSteps=2,fmax=.00001)
                data=b.validate({**source,'maxSteps':2,'fmax':.00001},'uma')
                r=b.calculate_job(data,b.UMAEngine(data,UMA,directory),directory)
                self.assertTrue(np.isfinite(r['energies']).all())
                if data.get('fixedAtoms'):
                    frames=r['images'] if data['mode']=='afir' else r['trajectory']['images']
                    for p in frames:np.testing.assert_array_equal(np.array(p)[[0,2]],np.array(data['images'][0])[[0,2]])
                if data['mode']=='cineb':
                    np.testing.assert_array_equal(np.array(r['images'])[[0,-1]],np.array(data['images'])[[0,-1]])
                if data['mode']=='vibrations':
                    self.assertEqual(r['vibrations']['status'],'completed')
                    self.assertEqual(len(r['vibrations']['frequenciesCM']),9)

    def test_worker_and_partial_results_keep_uma_identity(self):
        data=b.validate({**WATER,'mode':'optimize','maxSteps':2,'fmax':.00001},'uma')
        messages=queue.Queue()
        with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ):b.worker(data,UMA,directory,messages)
        entries=[]
        while not messages.empty():entries.append(messages.get_nowait())
        self.assertEqual(entries[0],('progress',{'phase':'loading_model'}))
        self.assertEqual(entries[1],('progress',{'phase':'calculating'}))
        result=next(v for k,v in entries if k=='result')
        checkpoints=[v['checkpoint'] for k,v in entries if k=='progress' and 'checkpoint' in v]
        partial=b.Jobs(UMA).partial_optimization({'data':data,'checkpoints':checkpoints,'status':'cancelled'})
        for r in (result,partial):
            self.assertEqual(r['method'],'UMA / uma-s-1p2p1 / omol')
            self.assertEqual(r['provenance']['uma']['device'],'cpu')
            self.assertEqual(r['provenance']['uma']['inference']['base_precision_dtype'],'float64')
            self.assertEqual(r['engine'],'uma')

    def test_loading_errors_do_not_expose_credentials(self):
        self.pretrained.get_predict_unit.side_effect=RuntimeError('Authorization: hf_private-token URL?token=secret')
        with self.assertRaises(ValueError) as error:b.UMAEngine(b.validate(WATER,'uma'),UMA,'/tmp')
        self.assertNotIn('private-token',str(error.exception))
        self.assertNotIn('secret',str(error.exception))
        self.assertIn('Hugging Face',str(error.exception))

    def test_bad_model_outputs_stop_the_job(self):
        engine=b.UMAEngine(b.validate(WATER,'uma'),UMA,'/tmp')
        engine(0,np.array(WATER['images'][0]))
        engine.atoms[0].calc.results['forces']=np.full((3,3),np.nan)
        with self.assertRaisesRegex(ValueError,'不正'):engine(0,np.array(WATER['images'][0]))


class Configuration(unittest.TestCase):
    def test_uma_bounds_and_no_remote_engine_configuration(self):
        self.assertEqual(b.validate(WATER,'uma')['multiplicity'],1)
        for extra in [{'umaModel':'file.pt'},{'umaTask':'omat'},{'hfToken':'private'},
                      {'multiplicity':101},{'symbols':['Po'],'images':[[[0,0,0]]]},
                      {'cell':{'vectors':np.eye(3).tolist(),'pbc':[True]*3}}]:
            with self.subTest(extra=extra),self.assertRaises(ValueError):b.validate({**WATER,**extra},'uma')

    def test_incompatible_cli_options_fail_before_model_loading(self):
        for args in [['--engine','uma','--method','GFN2-xTB'],['--engine','uma','--binary','/tmp/xtb'],
                     ['--engine','tblite','--uma-device','cpu'],['--engine','uma','--uma-model','/tmp/unsafe.pt']]:
            r=subprocess.run([sys.executable,b.__file__,*args],text=True,capture_output=True,timeout=15)
            self.assertEqual(r.returncode,2)
            self.assertNotIn('Token:',r.stdout)

    def test_old_package_is_rejected_without_importing_or_downloading(self):
        for version in [None,'1.10.0','2.0.0','3.0.0']:
            with patch.object(b,'package_version',return_value=version),self.assertRaisesRegex(ValueError,'fairchem-core'):
                b.uma_packages(UMA)

    def test_info_exposes_configuration_without_loading_weights(self):
        server=b.make_server(UMA,'test-token',0,['https://h-nabata.github.io'])
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with patch.object(b,'UMAEngine',side_effect=AssertionError('must not load')):
                c=http.client.HTTPConnection('127.0.0.1',server.server_port)
                c.request('GET','/api/info',headers={'Authorization':'Bearer test-token','Origin':'https://h-nabata.github.io'})
                response=c.getresponse();info=json.loads(response.read());c.close()
                self.assertEqual(response.status,200)
                self.assertEqual(info['uma']['task'],'omol')
                self.assertEqual(info['uma']['precision'],'float64')
                self.assertFalse(info['periodic'])
                self.assertTrue(info['fixedAtoms'])
                self.assertIn('ts',info['modes'])
                self.assertNotIn('test-token',json.dumps(info))
        finally:
            server.shutdown();server.server_close();thread.join();server.jobs.close()


@unittest.skipUnless(os.environ.get('UMA_TEST_MODEL'),'UMA weights not supplied; set UMA_TEST_MODEL for native inference')
class NativeUMA(unittest.TestCase):
    def test_water_force_matches_energy_difference(self):
        config={**UMA,'umaModel':os.environ['UMA_TEST_MODEL'],'umaDevice':os.environ.get('UMA_TEST_DEVICE','cpu')}
        self.assertIn(config['umaModel'],b.UMA_MODELS)
        data=b.validate(WATER,'uma')
        with tempfile.TemporaryDirectory() as directory:
            engine=b.UMAEngine(data,config,directory);p=np.array(data['images'][0]);e,f=engine(0,p)
            plus=p.copy();minus=p.copy();plus[1,0]+=.001;minus[1,0]-=.001
            self.assertTrue(np.isfinite(e));self.assertTrue(np.isfinite(f).all())
            self.assertAlmostEqual(-(engine(1,plus)[0]-engine(2,minus)[0])/.002,f[1,0],delta=.01)


if __name__=='__main__':unittest.main()
