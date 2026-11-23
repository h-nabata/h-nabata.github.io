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
        assert task_name in b.UMA_TASKS
        self.task = task_name
        self.predictor = predictor

    def calculate(self, atoms=None, properties=('energy',), system_changes=all_changes):
        super().calculate(atoms, properties, system_changes)
        self.predictor.calls.append(atoms.copy())
        # A smooth known potential in ASE units, with distinct charge/spin dependence.
        p = atoms.positions
        conditioning = 10*atoms.info['charge']+atoms.info['spin'] if self.task == 'omol' else 0
        self.results = {'energy':float(.5*(p*p).sum()+conditioning), 'forces':-p.copy()}


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
        self.assertFalse(kwargs['inference_settings'].auto_add_default_untrained_tasks)
        self.assertEqual(kwargs['inference_settings'].base_precision_dtype,'float64')

    def test_material_heads_periodicity_cell_updates_and_pressure(self):
        class MaterialCalculator(Calculator):
            implemented_properties = ['energy', 'forces', 'stress']

            def __init__(self, predictor, task_name):
                super().__init__()
                self.task = task_name

            def calculate(self, atoms=None, properties=('energy',), system_changes=all_changes):
                super().calculate(atoms, properties, system_changes)
                # A smooth elastic solid with a known isotropic stress in eV/Å³.
                volume = atoms.get_volume()
                k = .0001
                self.results = dict(energy=.5*k*(volume-200)**2, forces=np.zeros_like(atoms.positions),
                                    stress=np.array([1.,1.,1.,0.,0.,0.])*k*(volume-200))

        h = np.diag([4., 5., 11.])
        xyz = np.array([[0., 0., 0.]])
        source = dict(symbols=['Cu'], images=[xyz.tolist()], cell=dict(vectors=h.tolist(), pbc=[True]*3))
        with tempfile.TemporaryDirectory() as directory, patch.object(b, 'uma_packages', return_value=(
                self.torch, MaterialCalculator, self.pretrained, SimpleNamespace)):
            bulk = b.validate(dict(source, umaTask='omat'), 'uma')
            engine = b.UMAEngine(bulk, UMA, directory)
            energy, _, stress = engine.with_cell(0, xyz, h)
            self.assertAlmostEqual(energy,.02)
            np.testing.assert_allclose(stress, np.eye(3)*.002)
            stretched = h.copy()
            stretched[2, 2] = 12.
            e2, _, stress2 = engine.with_cell(0, xyz, stretched)
            self.assertGreater(e2, energy)
            np.testing.assert_allclose(stress2, np.eye(3)*.004)
            self.assertAlmostEqual(engine(0,xyz)[0],energy)
            self.assertEqual(engine.atoms[0].calc.task,'omat')
            self.assertNotIn('spin',engine.atoms[0].info)
            slab = b.validate(dict(source, umaTask='oc20', cell=dict(vectors=h.tolist(),pbc=[True,True,False])), 'uma')
            engine.reset(slab, UMA, directory)
            engine(0, xyz)
            np.testing.assert_array_equal(engine.atoms[0].pbc, [True,True,False])
            self.assertEqual(engine.atoms[0].calc.task,'oc20')
            self.assertNotEqual(b.calculation_identity(bulk, UMA), b.calculation_identity(slab, UMA))
            self.assertEqual(b.provenance(UMA,slab)['uma']['task'], 'oc20')
            self.assertEqual(b.engine_method(UMA,bulk), 'UMA / uma-s-1p2p1 / omat')

    def test_reject_incompatible_material_settings_and_foreign_checkpoint_fields(self):
        full = dict(vectors=np.diag([5.,6.,12.]).tolist(),pbc=[True]*3)
        for extra in [dict(umaTask='omat', multiplicity=3), dict(umaTask='oc20', charge=1),
                      dict(umaTask='omat', modelF={'multiplicities':[1,3]}),
                      dict(umaTask='oc20', solvation={'model':'model_compact','solvent':'water','device':'cpu'}),
                      dict(umaTask='omol'), dict(umaTask='omat', cell={**full,'pbc':[True,True,False]}),
                      dict(umaTask='omat', umaCheckpoint='/tmp/wrong.pt'),dict(umaTask='oc20', mode='md',
                           md={'ensemble':'npt','pressureBar':1,'temperatureK':300})]:
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                b.validate({**WATER,'cell':full,**extra}, 'uma')
        with self.assertRaises(ValueError): b.validate({**WATER,'umaTask':'omol'},'tblite')
        self.assertIn('npt',b.md_capabilities(UMA)['ensembles'])

    def test_domain_and_version_specific_material_tasks(self):
        source = dict(symbols=['Cu'], images=[[[1.,1.,1.]]])
        full = dict(vectors=np.diag([5.,6.,12.]).tolist(), pbc=[True]*3)
        slab = dict(full, pbc=[True,True,False])
        for task in ('oc20','oc22','oc25'):
            data = b.validate(dict(source, cell=slab, umaTask=task), 'uma')
            self.assertEqual(b.job_config(data, UMA)['umaTask'],task)
        omc = dict(source, cell=full, umaTask='omc', mode='optimize', cellOptimization={'mode':'full'})
        self.assertEqual(b.validate(omc,'uma')['cellOptimization']['mode'],'full')
        for task in ('oc22','oc25'):
            with self.assertRaisesRegex(ValueError,'1.2'):
                b.job_config(dict(data, umaTask=task), dict(UMA,umaModel='uma-s-1p1'))
        for task in ('omat','omc','odac'):
            self.assertEqual(b.validate(dict(source, cell=full, umaTask=task),'uma')['umaTask'],task)
            with self.assertRaises(ValueError):
                b.validate(dict(source, cell=slab, umaTask=task),'uma')

    def test_local_checkpoint_load_uses_startup_path_only(self):
        data=b.validate(WATER,'uma')
        cfg=dict(UMA,umaCheckpoint='/local/approved.pt', umaCheckpointSHA256='a'*64)
        self.pretrained.load_predict_unit = Mock(return_value=self.predictor)
        b.UMAEngine(data,cfg,tempfile.gettempdir())
        self.pretrained.get_predict_unit.assert_not_called()
        self.assertEqual(self.pretrained.load_predict_unit.call_args.args, ('/local/approved.pt',))
        recorded = b.provenance(cfg,data)
        self.assertEqual(recorded['uma']['checkpointSHA256'],'a'*64)
        self.assertNotIn('/local',json.dumps(recorded))
        self.assertNotEqual(b.calculation_identity(data,cfg),b.calculation_identity(data,UMA))

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
        server=b.make_server({**UMA, 'anysolvHashes':{'model_compact':'f'*64}},'test-token',0,['https://h-nabata.github.io'])
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with patch.object(b,'UMAEngine',side_effect=AssertionError('must not load')):
                c=http.client.HTTPConnection('127.0.0.1',server.server_port)
                c.request('GET','/api/info',headers={'Authorization':'Bearer test-token','Origin':'https://h-nabata.github.io'})
                response=c.getresponse();info=json.loads(response.read());c.close()
                self.assertEqual(response.status,200)
                self.assertEqual(info['uma']['task'],'omol')
                self.assertEqual(info['uma']['precision'],'float64')
                self.assertEqual(info['anysolv']['checkpointSHA256'],{'model_compact':'f'*64})
                self.assertTrue(info['periodic'])
                self.assertEqual(info['uma']['tasks'], ['omol','oc20','omat','omc','odac','oc22','oc25'])
                self.assertEqual(info['uma']['stressTasks'], ['omat','omc'])
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
