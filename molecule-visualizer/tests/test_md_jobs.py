"""MD as an ordinary bridge job: potential selection, component history and durable sampling."""
import copy
import importlib.util
from pathlib import Path
import queue
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from test_engine import b, CONFIG, well
from test_model_f import State, settings
from test_anysolv import CONFIG as SOLVATED_CONFIG, SOLVATION, fake_init


def md_request(steps=13):
    return dict(symbols=['He'], atomIds=['atom-he'], images=[[[.7, .1, 0.]]],
                mode='md', maxSteps=steps, livePreview=True,
                md=dict(ensemble='nve', timestepFs=.25, temperatureK=100., sampleEvery=5, seed=13))


def messages_list(messages):
    entries = []
    while not messages.empty():
        entries.append(messages.get_nowait())
    return entries


class MolecularDynamicsJob(unittest.TestCase):
    def test_bridge_without_supported_ase_chain_announces_its_actual_default(self):
        raw = md_request()
        raw['md']['ensemble'] = 'nvt'
        with patch.object(b, 'md_nose_hoover_class', return_value=None):
            caps = b.md_capabilities(CONFIG)
            self.assertEqual(caps['thermostats'], ['langevin','bussi'])
            data = b.validate(raw, 'tblite')
            self.assertEqual(data['md']['thermostat'], caps['defaultThermostat'])
            result = b.molecular_dynamics(data, well)
            self.assertEqual(result['reason'], 'completed')
            raw['md']['thermostat'] = 'nose-hoover-chain'
            with self.assertRaisesRegex(ValueError, 'ASE 3.25'):
                b.validate(raw, 'tblite')

    def test_variable_cell_md_recovery_keeps_the_last_measured_geometry_and_state_energies(self):
        class PeriodicState(State):
            def with_cell(self, index, positions, cell):
                energy, force = self(index, positions)
                volume = np.linalg.det(cell)
                density = self.sign * 1e-5
                return energy + density * volume, force, density * np.eye(3)

        raw = md_request(18)
        raw.update(cell={'vectors':(6*np.eye(3)).tolist(),'pbc':[True]*3}, modelF=settings())
        raw['md'].update(ensemble='npt', thermostat='bussi', barostatInterval=1, sampleEvery=3)
        data = b.validate(raw, 'tblite')
        with tempfile.TemporaryDirectory() as directory:
            config = {**CONFIG, 'historyDir':directory}
            jobs = b.Jobs(config)
            with patch.object(b,'make_calculator',lambda d,c,path:PeriodicState(d['multiplicity'])):
                calc = b.ModelFEngine(data,config,None)
            messages = queue.Queue()
            b.execute_with_calculator(data,config,directory,messages,calc)
            entries = messages_list(messages)
            issued = next(value for kind,value in entries if kind == 'result')
            checkpoints = [p['checkpoint'] for k,p in entries if k=='progress' and 'checkpoint' in p]
            previews = [p['preview'] for k,p in entries if k=='progress' and 'preview' in p]
            for frame, preview in zip(checkpoints, previews, strict=True):
                self.assertEqual(preview['cell'], frame['cell'])
                self.assertEqual(preview['cells'], [frame['cell']])
                for key in ('timeFs','temperatureK','volumeA3','pressureBar'):
                    self.assertEqual(preview[key], [frame[key]])
                for i in (1,2):
                    state = PeriodicState(data['modelF']['multiplicities'][i-1])
                    expected, _, _ = state.with_cell(0,np.array(frame['positions']),frame['cell']['vectors'])
                    self.assertAlmostEqual(expected,frame['surfaceComponents'][f'state{i}EV'])
            self.assertGreater(issued['volumeAccepted'], 0)
            self.assertEqual(issued['evaluations'], 37)
            self.assertEqual(issued['cells'], [checkpoints[-1]['cell']])
            self.assertEqual(issued['history'][-1]['pressureBar'], issued['pressureBar'])
            with patch.object(jobs, '_launch_next'):
                identifier = jobs.start(data)['id']
            job = jobs.jobs[identifier]
            job.update(status='running', checkpoints=copy.deepcopy(checkpoints[:-1]))
            jobs._persist(job, force=True)
            restored_jobs = b.Jobs(config)
            restored = restored_jobs.get(identifier)['result']
            last = checkpoints[-2]
            self.assertNotEqual(last['cell'], raw['cell'])
            self.assertEqual(restored['cell'], last['cell'])
            self.assertEqual(restored['cells'], [last['cell']])
            for key in ('volumeA3','pressureBar','volumeAccepted','volumeAttempts','evaluations'):
                self.assertEqual(restored[key], last[key])
            for key in ('cells','images','pressureBar','volumeA3'):
                self.assertEqual(restored['trajectory'][key], issued['trajectory'][key][:-1])
            self.assertEqual(restored_jobs.listing()['jobs'][0]['md'], {'ensemble':'npt','thermostat':'bussi'})

    def test_rebuild_legacy_md_history_summary_with_original_thermostat(self):
        with tempfile.TemporaryDirectory() as directory:
            config = {**CONFIG, 'historyDir':directory}
            jobs = b.Jobs(config)
            data = b.validate(md_request(), 'tblite')
            data['md'].update(ensemble='nvt', frictionPerPs=8.)
            with patch.object(jobs, '_launch_next'):
                identifier = jobs.start(data)['id']
            job = jobs.jobs[identifier]
            job.update(status='completed',result={'steps':2})
            jobs._persist(job, force=True)
            path = Path(directory) / (identifier + '.summary')
            summary = jobs._read_record(path)
            del summary['job']['data']['md']
            jobs._atomic_record(path, summary)
            for _ in range(2):
                jobs = b.Jobs(config)
                self.assertEqual(jobs.listing()['jobs'][0]['md'], {'ensemble':'nvt','thermostat':'langevin'})
                self.assertTrue(jobs.jobs[identifier]['_lazy'])
            self.assertEqual(jobs.get(identifier)['data']['md'],data['md'])

    def test_validation_and_revalidation_for_connected_engines(self):
        for engine in ('gxtb', 'tblite', 'uma', 'llmlip'):
            data = b.validate(md_request(), engine)
            self.assertEqual(b.validate(data, engine), data)
            self.assertNotIn('optimizer', data)
            self.assertEqual(b.cpu_plan(data, {**CONFIG,'engine':engine,'workers':4})['evaluationWorkers'], 1)
        cell = dict(vectors=(5*np.eye(3)).tolist(), pbc=[True]*3)
        self.assertEqual(b.validate({**md_request(), 'cell':cell}, 'tblite')['cell'], cell)
        for invalid in ({'mode':'evaluate'}, {'maxMove':.01}, {'optimizer':'fire'}, {'fixedAtoms':[0]},
                        {'images':md_request()['images']*2}, {'pathSymmetry':{'type':'mirror'}}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                b.validate({**md_request(), **invalid}, 'tblite')
        for engine in ('uma','gxtb'):
            with self.assertRaises(ValueError):
                b.validate({**md_request(), 'cell':cell}, engine)

    @unittest.skipUnless(importlib.util.find_spec('tblite'), 'optional native tblite')
    def test_fixed_cell_md_keeps_a_continuous_trajectory_across_periodic_boundary(self):
        raw = dict(symbols=['He'], images=[[[3.95,.2,.2]]], mode='md', maxSteps=20,
                   cell=dict(vectors=(4*np.eye(3)).tolist(),pbc=[True]*3),
                   md=dict(timestepFs=.5,temperatureK=0,sampleEvery=4,
                           initialVelocitiesAngstromPerFs=[[.05,0.,0.]]))
        data = b.validate(raw,'tblite')
        with tempfile.TemporaryDirectory() as directory:
            calculator = b.make_calculator(data,CONFIG,directory)
            trajectory = b.calculate_job(data,calculator,directory)['trajectory']
        positions = np.asarray(trajectory['images'])[:,0,0]
        np.testing.assert_allclose(positions,3.95+.05*np.asarray(trajectory['timeFs']),atol=1e-12)
        self.assertGreater(positions[-1],4.)
        self.assertLess(np.ptp(trajectory['totalEV']),1e-10)

    def test_interruption_recovers_the_sampled_trajectory_and_a_new_run_uses_the_original_input(self):
        with tempfile.TemporaryDirectory() as directory:
            config = {**CONFIG, 'historyDir':directory}
            jobs = b.Jobs(config)
            data = b.validate(md_request(), 'tblite')
            messages = queue.Queue()
            b.execute_with_calculator(data, config, directory, messages, well)
            entries = messages_list(messages)
            checkpoints = [p['checkpoint'] for k,p in entries if k=='progress' and 'checkpoint' in p]
            self.assertEqual([p['step'] for p in checkpoints], [0,5,10,13])
            issued = [p for k,p in entries if k=='result'][0]
            self.assertEqual(issued['steps'], 13)
            with patch.object(jobs, '_launch_next'):
                identifier = jobs.start(data)['id']
            job = jobs.jobs[identifier]
            job.update(status='running', checkpoints=copy.deepcopy(checkpoints[:-1]))
            jobs._persist(job, force=True)
            restored = b.Jobs(config)
            partial = restored.get(identifier)
            result = partial['result']
            self.assertEqual(partial['status'], 'interrupted')
            self.assertEqual(result['reason'], 'interrupted')
            self.assertEqual(result['steps'], 10)
            self.assertEqual(result['atomIds'], ['atom-he'])
            self.assertEqual(result['trajectory']['images'], issued['trajectory']['images'][:-1])
            self.assertEqual(result['trajectory']['timeFs'], [0.,1.25,2.5])
            expected, force = well(0, np.asarray(result['images'][0]))
            self.assertAlmostEqual(expected, result['energies'][0])
            np.testing.assert_allclose(force,result['forces'][0])
            self.assertEqual(restored.listing()['jobs'][0]['resumeKind'], 'restart')
            with patch.object(restored, '_launch_next'):
                restarted = restored.resume(identifier)
            self.assertEqual(restarted['data'],data)
            self.assertEqual(restarted['resumeKind'],'restart')

    def test_model_f_long_md_keeps_only_bounded_state_records_and_all_sampled_components(self):
        raw = md_request(2055)
        raw['md']['sampleEvery'] = 525
        data = b.validate({**raw,'modelF':settings()},'tblite')
        with patch.object(b,'make_calculator',lambda d,c,path:State(d['multiplicity'])):
            calculator = b.ModelFEngine(data,CONFIG,None)
        messages = queue.Queue()
        b.execute_with_calculator(data,CONFIG,None,messages,calculator)
        entries = messages_list(messages)
        frames = [p['checkpoint'] for k,p in entries if k=='progress' and 'checkpoint' in p]
        result = [p for k,p in entries if k=='result'][0]
        self.assertLessEqual(len(calculator.records),2048)
        self.assertEqual(result['performance']['stateEngineCalls'], [2056,2056])
        for index, energy in enumerate(result['trajectory']['energies']):
            calculator.check_row(frames[index]['surfaceComponents'],energy)
            self.assertEqual(result['trajectory']['surfaceComponents']['state1EV'][index],
                             frames[index]['surfaceComponents']['state1EV'])
        job = dict(data=data, status='cancelled',checkpoints=frames[:-1])
        b.Jobs(CONFIG)._recover_partial(job)
        partial = job['result']
        self.assertEqual(partial['trajectory']['surfaceComponents']['state1EV'],
                         result['trajectory']['surfaceComponents']['state1EV'][:-1])

    def test_solvated_md_retains_complete_sampled_energy_decomposition_for_long_trajectories(self):
        raw = md_request(315)
        raw['md']['sampleEvery'] = 150
        data = b.validate({**raw,'solvation':SOLVATION},'uma')
        config = b.job_config(data,SOLVATED_CONFIG)
        with patch.object(b.SolvatedUMAEngine,'__init__',fake_init):
            calculator = b.SolvatedUMAEngine(data,config,None)
        messages = queue.Queue()
        b.execute_with_calculator(data,config,None,messages,calculator)
        entries = messages_list(messages)
        result = [p for k,p in entries if k=='result'][0]
        self.assertLessEqual(len(calculator.components),256)
        tr = result['trajectory']
        np.testing.assert_allclose(np.sum(list(tr['energyComponents'].values()),axis=0), tr['energies'])


if __name__ == '__main__':
    unittest.main()
