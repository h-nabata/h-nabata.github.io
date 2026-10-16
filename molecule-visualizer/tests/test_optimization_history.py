"""Evaluated optimization coordinates must match every reported energy."""
import copy
import unittest
import numpy as np
from test_engine import b, band, well, CONFIG


class OptimizationHistory(unittest.TestCase):
    def data(self):
        return {**band('optimize'), 'images': [[[-.5,.35,0]]], 'maxSteps': 4, 'fmax': 1e-8}

    def test_initial_and_final_frames_and_energies_with_live_on_and_off(self):
        data=self.data(); before=copy.deepcopy(data); progress=[]
        result=b.relax(data, well, progress.append)
        self.assertEqual(data,before)
        self.assertEqual(result,b.relax({**data,'livePreview':True},well))
        trajectory=result['trajectory']
        self.assertEqual(len(trajectory['images']),5)
        self.assertEqual(trajectory['images'][0],data['images'][0])
        self.assertEqual(trajectory['images'][-1],result['images'][0])
        self.assertNotEqual(trajectory['images'][0],trajectory['images'][-1])
        self.assertEqual(result['energies'][0],trajectory['energies'][-1])
        self.assertEqual(result['evaluations'],len(trajectory['images']))
        for positions,energy in zip(trajectory['images'],trajectory['energies']):
            self.assertAlmostEqual(well(0,np.array(positions))[0],energy,places=12)
        frames=[p['checkpoint'] for p in progress if 'checkpoint' in p]
        self.assertEqual([p['positions'] for p in frames],trajectory['images'])
        jobs=b.Jobs(CONFIG)
        jobs.job={'id':'c'*32,'data':data,'status':'running','progress':{'step':4},'checkpoints':frames}
        self.assertNotIn('checkpoints',jobs.get('c'*32))
        self.assertNotIn('result',jobs.get('c'*32))

    def test_immediate_convergence_and_non_optimization_modes(self):
        result=b.relax({**self.data(),'fmax':10},well)
        self.assertTrue(result['converged']);self.assertEqual(len(result['trajectory']['images']),1)
        for mode in ['evaluate','neb','cineb','perpendicular']:
            self.assertNotIn('trajectory',b.relax({**band(mode),'maxSteps':1},well))

    def test_partial_optimization_keeps_only_evaluated_frames_and_never_claims_convergence(self):
        data={**self.data(),'symbols':['He'],'cell':None,'charge':0,'multiplicity':1};progress=[]
        result=b.relax(data,well,progress.append)
        checkpoints=[p['checkpoint'] for p in progress if 'checkpoint' in p][:3]
        for status in ['cancelled','error']:
            partial=b.Jobs(CONFIG).partial_optimization({'data':data,'checkpoints':checkpoints,'status':status})
            self.assertFalse(partial['converged']);self.assertEqual(partial['steps'],2)
            self.assertEqual(partial['trajectory']['images'],result['trajectory']['images'][:3])
            self.assertEqual(partial['images'][0],result['trajectory']['images'][2])
            self.assertEqual(partial['energies'][0],result['trajectory']['energies'][2])

