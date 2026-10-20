"""Local atomic history, recoverable queues and molecule-safe model residency."""
import copy
import importlib.util
import http.client
import json
import os
from pathlib import Path
import queue
import socket
import subprocess
import sys
import threading
import tempfile
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import numpy as np
from test_engine import b, CONFIG, WATER
from test_uma import UMA, FakeCalculator


def wait_for(jobs, identifier, timeout=25):
    limit = time.monotonic()+timeout
    while time.monotonic()<limit:
        result = jobs.get(identifier)
        if result['status'] in jobs.TERMINAL:
            if jobs._find(identifier).get('thread'):
                jobs._find(identifier)['thread'].join(timeout=5)
            return jobs.get(identifier)
        time.sleep(.02)
    raise AssertionError('job did not complete')


class PersistentHistory(unittest.TestCase):
    def test_launch_failure_is_terminal_not_stranded_in_queue(self):
        with tempfile.TemporaryDirectory() as directory:
            jobs = b.Jobs({**CONFIG,'historyDir':directory})
            with patch.object(b.tempfile,'mkdtemp',side_effect=OSError('disk full')):
                created = jobs.start(b.validate(WATER,'tblite'))
            self.assertEqual(created['status'],'error')
            self.assertEqual(jobs.pending,[])
            self.assertIn('起動できません',created['error'])
            restored = b.Jobs(jobs.config)
            self.assertEqual(restored.get(created['id'])['status'],'error')

    def test_finishing_job_cannot_be_deleted_resumed_or_unloaded(self):
        jobs = b.Jobs(CONFIG)
        with patch.object(jobs, '_launch_next'):
            public = jobs.start(b.validate(WATER, 'tblite'))
        job = jobs.jobs[public['id']]
        job.update(status='completed', _active=True)
        jobs.job = job
        for action in (lambda:jobs.delete(job['id']), lambda:jobs.resume(job['id']),
                       lambda:jobs.archive(job['id']), jobs.unload):
            with self.assertRaises(RuntimeError): action()
        self.assertEqual(jobs.get(job['id'])['status'], 'running')
        self.assertFalse(jobs.listing()['jobs'][0]['resumable'])

    def test_history_directory_lock_prevents_two_writers_and_releases(self):
        with tempfile.TemporaryDirectory() as directory:
            first = b.lock_history_directory(directory)
            try:
                with self.assertRaises(OSError): b.lock_history_directory(directory)
            finally:
                first.close()
            second = b.lock_history_directory(directory)
            second.close()

    def make_record(self, jobs, mode='optimize'):
        data = b.validate({**WATER, 'mode':mode, 'maxSteps':2, 'fmax':.00001}, 'tblite')
        points = []
        result = b.relax(data, lambda i,p:(float((p*p).sum()), -2*p), points.append)
        with patch.object(jobs, '_launch_next'):
            created = jobs.start(data)
        job = jobs.jobs[created['id']]
        job.update(status='running', checkpoints=[p['checkpoint'] for p in points if 'checkpoint' in p])
        jobs._persist(job, force=True)
        return job, result

    def test_interrupted_recovery_geometry_resume_and_config_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            config = {**CONFIG, 'historyDir':directory}
            original = b.Jobs(config)
            job, result = self.make_record(original)
            restored = b.Jobs(config)
            public = restored.get(job['id'])
            self.assertEqual(public['status'], 'interrupted')
            self.assertEqual(public['result']['images'], result['images'])
            self.assertEqual(public['result']['trajectory'], result['trajectory'])
            with patch.object(restored, '_launch_next'):
                resumed = restored.resume(job['id'])
            self.assertEqual(resumed['resumeKind'], 'geometry')
            self.assertEqual(resumed['parentId'], job['id'])
            self.assertEqual(resumed['data']['images'], result['images'])
            self.assertEqual(resumed['data']['maxSteps'], 2)
            self.assertEqual(restored.get(job['id'])['result'], public['result'])
            changed = b.Jobs({**config, 'method':'GFN1-xTB'})
            self.assertEqual(changed.get(job['id'])['result']['method'], 'GFN2-xTB')
            with self.assertRaisesRegex(RuntimeError, '異なり'):
                changed.resume(job['id'])
            restored.close()

    def test_archive_delete_atomic_checksum_and_no_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            jobs = b.Jobs({**CONFIG, 'historyDir':directory, 'token':'never-persist-me', 'binary':'/private/executable'})
            job, _ = self.make_record(jobs)
            job['status'] = 'cancelled'
            jobs.archive(job['id'], True)
            path = Path(directory)/(job['id']+'.json')
            text = path.read_text()
            self.assertNotIn('never-persist-me', text)
            self.assertNotIn('/private/executable', text)
            self.assertFalse(list(Path(directory).glob('*.tmp')))
            self.assertTrue(b.Jobs(jobs.config).listing()['jobs'][0]['archived'])
            saved = json.loads(text); saved['data']['charge'] = 999
            path.write_text(json.dumps(saved))
            damaged = b.Jobs(jobs.config)
            self.assertEqual(damaged.listing()['jobs'], [])
            self.assertIsNotNone(damaged.storage_error)
            self.assertTrue(path.exists())
            jobs.delete(job['id'])
            self.assertFalse(path.exists())

    def test_irc_and_scan_partials_are_not_vibration_failures(self):
        jobs = b.Jobs(CONFIG)
        for mode in ('irc', 'scan'):
            data = b.validate(WATER, 'tblite'); data['mode'] = mode
            partial = {'mode':mode, 'images':WATER['images'], 'energies':[1.], 'forces':[np.zeros((3,3)).tolist()],
                       'effectiveFmax':0., 'imageFmax':[0.], 'steps':1, 'evaluations':1, 'history':[{'step':1}]}
            r = jobs.partial_structure({'data':data, 'status':'cancelled', 'structureCheckpoint':partial})
            self.assertNotIn('vibrations', r)
            self.assertEqual(r['history'], [{'step':1}])
            self.assertFalse(r['converged'])

    @unittest.skipUnless(importlib.util.find_spec('tblite'), 'native tblite required')
    def test_fifo_completion_cancel_queued_and_persisted_results(self):
        with tempfile.TemporaryDirectory() as directory:
            jobs = b.Jobs({**CONFIG, 'historyDir':directory})
            try:
                data = b.validate(WATER, 'tblite')
                first = jobs.start(data)
                second = jobs.start(data)
                third = jobs.start(data)
                self.assertEqual(second['status'], 'queued')
                self.assertEqual(third['status'], 'queued')
                jobs.cancel(third['id'])
                self.assertEqual(jobs.get(third['id'])['status'], 'cancelled')
                with self.assertRaises(RuntimeError): jobs.delete(first['id'])
                a, c = wait_for(jobs, first['id']), wait_for(jobs, second['id'])
                self.assertEqual((a['status'], c['status']), ('completed','completed'))
                self.assertEqual(a['result']['energies'], c['result']['energies'])
                self.assertFalse(Path(jobs.jobs[first['id']]['directory']).exists())
                self.assertFalse(Path(jobs.jobs[second['id']]['directory']).exists())
            finally:
                jobs.close()
            restored = b.Jobs({**CONFIG, 'historyDir':directory})
            self.assertEqual(len(restored.listing()['jobs']), 3)
            self.assertEqual(restored.get(first['id'])['result'], a['result'])


class ModelResidency(unittest.TestCase):
    def test_two_process_models_reused_across_solvent_and_charge_changes(self):
        # Trained weights are not emulated: this tests real spawn/HTTP/reset IPC
        # using deterministic contract fixture calculators.
        with tempfile.TemporaryDirectory() as directory:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
            fixture = Path(__file__).with_name('anysolv_fixture_bridge.py')
            process = subprocess.Popen([sys.executable, str(fixture), '--engine','uma','--uma-device','cuda:0',
                '--anysolv','--anysolv-device','cuda:1','--port',str(port),'--history-dir',directory],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            output = queue.Queue()
            threading.Thread(target=lambda:[output.put(line) for line in process.stdout], daemon=True).start()
            try:
                token = None; deadline = time.monotonic()+15
                while token is None and time.monotonic()<deadline:
                    try: line = output.get(timeout=.2)
                    except queue.Empty: continue
                    if line.startswith('Token: '): token = line.removeprefix('Token: ').strip()
                self.assertIsNotNone(token, 'fixture service did not start')
                def request(method, path, data=None):
                    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
                    headers = {'Authorization':'Bearer '+token}
                    body = None
                    if data is not None:
                        body = json.dumps(data); headers['Content-Type']='application/json'
                    conn.request(method, path, body, headers)
                    response = conn.getresponse(); payload = json.loads(response.read()); conn.close()
                    self.assertLess(response.status, 300, payload)
                    return payload
                def run(data):
                    job = request('POST','/api/jobs',data)
                    deadline = time.monotonic()+20
                    while time.monotonic()<deadline:
                        job = request('GET','/api/jobs/'+job['id'])
                        if job['status'] in b.Jobs.TERMINAL: break
                        time.sleep(.03)
                    self.assertEqual(job['status'],'completed',job.get('error'))
                    return job
                first = run({**WATER,'umaDevice':'cuda:0',
                    'solvation':{'model':'model_compact','device':'cuda:1','solvent':'water'}})
                second = run({**WATER,'charge':1,'multiplicity':2,'umaDevice':'cuda:0',
                    'solvation':{'model':'model_compact','device':'cuda:1','solvent':'ethanol'}})
                state = request('GET','/api/runtime')
                self.assertTrue(state['modelLoaded']); self.assertEqual(state['reusedJobs'],1)
                self.assertTrue(second['progress']['modelReused'])
                self.assertEqual(second['result']['provenance']['solvent'],'ethanol')
                self.assertEqual(second['result']['charge'],1)
                expected = -.125*np.square(WATER['images'][0]).sum()-2
                self.assertAlmostEqual(second['result']['energyComponents']['solvation'][0],expected)
                self.assertNotEqual(first['result']['energies'],second['result']['energies'])
                self.assertFalse(request('POST','/api/runtime/unload',{})['modelLoaded'])
            finally:
                process.terminate()
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(timeout=5)
                process.stdout.close(); process.stderr.close()

    def test_predictor_loaded_once_but_molecular_charge_and_ase_state_reset(self):
        loads = []
        def packages(config):
            def predictor(*a, **kw):
                loads.append(kw)
                return SimpleNamespace(calls=[])
            return (SimpleNamespace(set_num_threads=lambda n:None), FakeCalculator,
                    SimpleNamespace(get_predict_unit=predictor), SimpleNamespace)
        requests, messages = queue.Queue(), queue.Queue()
        a = b.validate(WATER, 'uma')
        c = b.validate({**WATER, 'charge':1, 'multiplicity':2, 'images':[(np.array(WATER['images'][0])+.2).tolist()]}, 'uma')
        requests.put(('a', a, 'unused')); requests.put(('b', c, 'unused')); requests.put(None)
        with patch.object(b, 'uma_packages', packages), patch.dict(os.environ):
            b.resident_worker(UMA, requests, messages)
        results = {}; reused = []
        while not messages.empty():
            ident, kind, value = messages.get()
            self.assertNotEqual(kind, 'error', value)
            if kind == 'result': results[ident] = value
            if kind == 'progress' and 'modelReused' in value: reused.append(value['modelReused'])
        self.assertEqual(len(loads), 1)
        self.assertEqual(reused, [False, True])
        self.assertEqual(results['b']['charge'], 1)
        self.assertEqual(results['b']['multiplicity'], 2)
        self.assertNotEqual(results['a']['energies'], results['b']['energies'])
        self.assertEqual(results['b']['images'], c['images'])
        np.testing.assert_allclose(results['b']['forces'], -np.array(c['images']))

    def test_residency_key_changes_for_devices_precision_and_model_not_geometry(self):
        a = b.validate(WATER, 'uma')
        c = b.validate({**WATER, 'charge':1, 'multiplicity':2}, 'uma')
        self.assertEqual(b.residency_key(a, UMA), b.residency_key(c, UMA))
        for patch_ in ({'umaPrecision':'float32'}, {'umaDevice':'cuda:0'}, {'umaModel':'uma-m-1p1'}):
            self.assertNotEqual(b.residency_key(a, UMA), b.residency_key(a, {**UMA, **patch_}))


if __name__=='__main__': unittest.main()
