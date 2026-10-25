"""Usage: python benchmark_performance.py /path/to/baseline/bridge.py.

Analytic potentials and helper workloads only; no inference performance claims.
"""
import importlib.util
import json
from pathlib import Path
import sys
import time
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local-engine'))
import bridge as new

def load(path):
    spec=importlib.util.spec_from_file_location('baseline_bridge',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

def timing(function):
    function();samples=[]
    for _ in range(5):
        start=time.perf_counter();function();samples.append((time.perf_counter()-start)*1000)
    return float(np.median(samples))

old=load(sys.argv[1])
rng=np.random.default_rng(39)
positions=np.arange(500)[:,None]*np.array([[.8,.9,.7]])+rng.normal(size=(500,3))*.01
def collision_old():
    distances=np.linalg.norm(positions[:,None,:]-positions[None,:,:],axis=-1)
    return bool(np.any(distances[np.triu_indices(len(positions),1)]<.1))
assert new.has_atomic_collision(positions)==collision_old()
rows=[]
def measure(name,a,b):
    before=timing(a);after=timing(b)
    rows.append(dict(name=name,beforeMS=before,afterMS=after,speedup=before/after))
measure('collision500',collision_old,lambda:new.has_atomic_collision(positions))
symbols=['C']*500;ids=[f'a{i}' for i in range(500)]
config={'fragments':[{'id':'a','atomIds':ids[:250]},{'id':'b','atomIds':ids[250:]}],
        'pairs':[{'a':'a','b':'b','gamma':100,'mode':'attract'}]}
terms=new.prepare_afir(symbols,ids,config)
ref=old.afir_bias(positions,symbols,ids,config);fast=new.afir_bias(positions,symbols,ids,config,terms)
assert ref[0]==fast[0];np.testing.assert_array_equal(ref[1],fast[1])
measure('afir250x250',lambda:old.afir_bias(positions,symbols,ids,config),lambda:new.afir_bias(positions,symbols,ids,config,terms))
origins=np.array([[(i%5)*4,(i//5%4)*4,(i//20)*4] for i in range(80)],float)
def potential(i,p):
    q=p-origins
    return float(np.sum((q[:,0]**2-1)**2+q[:,1]**2+q[:,2]**2)),np.column_stack((-4*q[:,0]*(q[:,0]**2-1),-2*q[:,1],-2*q[:,2]))
images=[(origins+[x,.4*(1-x*x),0]).tolist() for x in np.linspace(-1,1,7)]
data=dict(images=images,mode='lup',maxSteps=10,fmax=.001,maxMove=.03,spring=1.,climbAfter=5,cell=None)
ref=old.relax(data,potential);fast=new.relax(data,potential)
np.testing.assert_array_equal(ref['images'],fast['images'])
np.testing.assert_array_equal(ref['energies'],fast['energies'])
measure('lup80-atoms7-nodes10-steps',lambda:old.relax(data,potential),lambda:new.relax(data,potential))
print(json.dumps(dict(python=sys.version,numpy=np.__version__,rows=rows),indent=2))
