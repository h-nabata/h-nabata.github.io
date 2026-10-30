"""Run with OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1; argument: baseline bridge.py.
Synthetic public structures. Reports helper costs, not general quantum speedups.
"""
import importlib.util,json,sys,tempfile,time
from pathlib import Path
import numpy as np
from ase import Atoms
from ase.io.jsonio import encode
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local-engine'))
import bridge as new
spec=importlib.util.spec_from_file_location('before',sys.argv[1]);old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
def timing(fn):
    fn();samples=[]
    for _ in range(5):
        start=time.perf_counter();fn();samples.append(1000*(time.perf_counter()-start))
    return float(np.median(samples))
rows=[]
def measure(name,before,after,**details):
    a=timing(before);b=timing(after);rows.append(dict(name=name,beforeMS=a,afterMS=b,speedup=a/b,**details))
cell={'vectors':[[16.,0,0],[4.,16.,0],[2.,1.,16.]],'pbc':[True]*3}
p=np.array([[i/10,j/10,k/10] for i in range(10) for j in range(10) for k in range(10)])[:500]@np.array(cell['vectors'])
assert old.has_atomic_collision(p,cell)==new.has_atomic_collision(p,cell)
measure('periodic_collision_500',lambda:old.has_atomic_collision(p,cell),lambda:new.has_atomic_collision(p,cell))
rng=np.random.default_rng(831);p=rng.normal(size=(200,3))*4;forces=rng.normal(size=p.shape);atoms=Atoms('C200',positions=p)
for mixed in (False,True):
    d={'images':[p.tolist()],'rigidGroups':[list(range(50))],'cell':None}
    if mixed:d['fixedComponents']=[{'atom':0,'axes':[True,False,False]}]
    a=old.internal_coordinate_constraint(d);b=new.internal_coordinate_constraint(d)
    f=forces.copy();g=forces.copy();a.adjust_forces(atoms,f);b.adjust_forces(atoms,g)
    error=float(np.max(np.abs(f-g)));assert error<1e-10
    def run(c,reset=False):
        if reset:
            if hasattr(c,'cached'):c.cached=None
            if hasattr(c,'factor_cache'):c.factor_cache=None
        c.adjust_forces(atoms,forces.copy())
    measure('rigid50_of200'+('_mixed' if mixed else ''),lambda:run(a),lambda:run(b,True),maxForceDifference=error)
    if mixed:measure('mixed_same_geometry_projection',lambda:run(a),lambda:run(b),maxForceDifference=error)
array=rng.normal(size=(900,900))
compact=lambda:json.dumps(new.encode_restart(array),separators=(',',':'))
np.testing.assert_array_equal(array,new.decode_restart(json.loads(compact())))
measure('restart_dense900',lambda:encode(array),compact,beforeBytes=len(encode(array)),afterBytes=len(compact()))
# Elastic chain: strong relative motion and soft collective motion. Same energy,
# force threshold, positions and maximum step for both methods.
n=30;origin=np.column_stack((np.arange(n)*1.4,np.zeros(n),np.zeros(n)));start=origin+[0,.4,0]
def potential(i,p):
    q=p-origin;edges=q[1:]-q[:-1];f=-q.copy();f[:-1]+=20*edges;f[1:]-=20*edges
    return .5*float(np.sum(q*q))+10*float(np.sum(edges*edges)),f
iterations=[]
for method in ('lbfgs','precon-lbfgs'):
    data=new.validate({'symbols':['C']*n,'images':[start.tolist()],'mode':'optimize','optimizer':method,'maxSteps':500,'fmax':1e-5,'maxMove':.04},'tblite')
    t=time.perf_counter();r=new.calculate_job(data,potential,None);elapsed=time.perf_counter()-t
    assert r['converged'];np.testing.assert_allclose(r['images'][0],origin,atol=2e-5)
    iterations.append({'method':method,'steps':r['steps'],'evaluations':r['evaluations'],'seconds':elapsed})
extra={}
if '--native' in sys.argv:
    water=np.array([[0,0,0],[.96,0,0],[-.24,.93,0]])
    positions=np.concatenate([water+[4*(i%2),4*(i//2),0] for i in range(4)])
    raw={'symbols':['O','H','H']*4,'images':[positions.tolist()],'mode':'optimize','optimizer':'lbfgs',
         'rigidGroups':[list(range(3*i,3*i+3)) for i in range(4)],'maxSteps':100,'fmax':.01,'maxMove':.04}
    samples={'before':[],'after':[]};last={};final_positions={}
    for repetition in range(6):
        for label,module in [('before',old),('after',new)]:
            data=module.validate(raw,'tblite');engine=module.TBLiteEngine(data,{'method':'GFN2-xTB'},tempfile.gettempdir())
            cache=module.ExactEvaluationCache(engine);started=time.perf_counter()
            result=module.calculate_job(data,cache,tempfile.gettempdir());elapsed=time.perf_counter()-started
            assert result['converged']
            if repetition:samples[label].append(elapsed)
            last[label]={'evaluations':cache.calls,'steps':result['steps'],'energyEV':result['energies'][0]}
            final_positions[label]=np.array(result['images'][0])
            if hasattr(cache,'close'):cache.close()
    np.testing.assert_allclose(final_positions['before'],final_positions['after'],atol=1e-9,rtol=0)
    extra['nativeRigidWaterCluster']={label:{'medianSeconds':float(np.median(values)),**last[label]} for label,values in samples.items()}
    extra['nativeRigidWaterCluster']['maxCoordinateDifferenceAngstrom']=float(np.max(np.abs(final_positions['before']-final_positions['after'])))
print(json.dumps({'python':sys.version.split()[0],'numpy':np.__version__,'rows':rows,'syntheticElasticChain':iterations,**extra},indent=2))
