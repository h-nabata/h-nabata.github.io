"""Correctness guards for bounded reuse, collision pruning and polling."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
from test_engine import b, CONFIG, WATER, band, well

class Performance(unittest.TestCase):
    def test_exact_cache_preserves_forces_and_does_not_round_coordinates(self):
        calls=[]
        def calculate(i,p):
            calls.append((i,p.copy()))
            return float(np.sum(p*p)), -2*p
        cache=b.ExactEvaluationCache(calculate,capacity=2)
        p=np.array([[1.,2.,3.]])
        energy,force=cache(0,p);force[:]=123
        e,f=cache(0,p)
        self.assertEqual(energy,e);np.testing.assert_array_equal(f,-2*p)
        changed=p.copy();changed[0,0]+=1e-12
        cache(0,changed);cache(1,p)
        self.assertEqual((cache.calls,cache.hits),(3,1))
        cache(0,p)
        self.assertEqual(cache.calls,4)  # evicted; no unbounded trajectory cache
        self.assertEqual(len(cache.values),2)

    def test_collision_tree_matches_exhaustive_distances_at_cutoff(self):
        rng=np.random.default_rng(824)
        for count in (2,63,64,500):
            for _ in range(8):
                p=rng.normal(size=(count,3))*20
                p[1]=p[0]+[rng.choice([.099999999,.1,.100000001]),0,0]
                a,c=np.triu_indices(count,1)
                expected=bool(np.any(np.linalg.norm(p[a]-p[c],axis=1)<.1))
                self.assertEqual(b.has_atomic_collision(p),expected)
        cell={'vectors':[[10.,0,0],[3,9,0],[0,0,10]],'pbc':[True,False,True]}
        self.assertTrue(b.has_atomic_collision(np.array([[0.,0,0],[9.99,0,0]]),cell))

    def test_supplied_band_tangents_preserve_all_force_components(self):
        data=band('cineb');images=np.array(data['images'])
        values=[well(i,p) for i,p in enumerate(images)]
        energies=np.array([v[0] for v in values]);physical=np.array([v[1] for v in values])
        for mode in ('cineb','lup','perpendicular'):
            _,tangents=b.band_forces(images,energies,physical,mode,1.,3)
            ref,diagnostics=b.band_force_components(images,energies,physical,mode,1.,3)
            fast,fast_diagnostics=b.band_force_components(images,energies,physical,mode,1.,3,tangents=tangents)
            self.assertEqual(diagnostics,fast_diagnostics)
            for key in ref:np.testing.assert_array_equal(ref[key],fast[key])

    def test_compact_poll_and_unchanged_preview_do_not_copy_geometry(self):
        jobs=b.Jobs(CONFIG)
        jobs.job={'id':'b'*32,'status':'running','data':{'mode':'optimize',**copy.deepcopy(WATER)},'progress':{'step':2},
                  'previewVersion':4,'preview':{'step':2,'images':WATER['images'],'energies':[1.]}}
        plain=jobs.get('b'*32,True)
        self.assertIn('data',plain);self.assertIn('preview',plain)
        same=jobs.get('b'*32,True,since=4,compact=True)
        self.assertNotIn('data',same);self.assertNotIn('preview',same)
        changed=jobs.get('b'*32,True,since=3,compact=True)
        self.assertEqual(changed['previewVersion'],4)
        changed['preview']['images'][0][0][0]=99
        self.assertEqual(jobs.job['preview']['images'][0][0][0],0)

    def test_terminal_history_reloads_without_duplicate_checkpoints(self):
        with tempfile.TemporaryDirectory() as directory:
            jobs=b.Jobs({**CONFIG,'historyDir':directory})
            job={'id':'c'*32,'status':'completed','data':copy.deepcopy(WATER),'progress':{},
                 'createdAt':1,'updatedAt':1,'result':{'trajectory':{'images':WATER['images']}},
                 'checkpoints':[{'positions':WATER['images'][0]}],
                 'bandCheckpoint':{'images':WATER['images']},'diagnosticsHistory':[{'step':0}]}
            jobs._persist(job,force=True)
            text=(Path(directory)/(job['id']+'.json')).read_text(encoding='utf-8')
            saved=json.loads(text)
            for key in ('checkpoints','bandCheckpoint','diagnosticsHistory'):self.assertNotIn(key,saved)
            restored=b.Jobs({**CONFIG,'historyDir':directory})
            self.assertIsNone(restored.storage_error)
            self.assertEqual(restored.get(job['id'])['result'],job['result'])
