"""Public 36-atom / 12-image GFN2-xTB benchmark, equal total CPU thread budget.

Each case starts a separate process so native thread settings apply before imports.
Timings exclude process startup and include fresh calculator construction/evaluation.
Run: python molecule-visualizer/tests/benchmark_resource_parallel.py
"""
import json
import os
from pathlib import Path
import subprocess
import sys

if '--child' in sys.argv:
    import tempfile
    import time
    import numpy as np
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local-engine'))
    import bridge as b
    workers=int(sys.argv[-1])
    water=np.array([[0.,0,0],[.96,0,0],[-.24,.93,0]])
    positions=np.concatenate([water+[3.6*(i%4),3.6*(i//4),0] for i in range(12)])
    rng=np.random.default_rng(91)
    images=[positions+rng.normal(size=positions.shape)*.008 for _ in range(12)]
    data=b.validate({'symbols':['O','H','H']*12,'images':[p.tolist() for p in images],'mode':'evaluate'},'tblite')
    samples=[]
    for repetition in range(4):
        cache=b.ExactEvaluationCache(b.TBLiteEngine(data,{'method':'GFN2-xTB'},tempfile.gettempdir()),workers=workers)
        started=time.perf_counter()
        try:answers=cache.map(list(enumerate(images)))
        finally:cache.close()
        if repetition:samples.append(time.perf_counter()-started)
    print(json.dumps({'workers':workers,'threadsPerEvaluation':2//workers,'medianSeconds':float(np.median(samples)),
                     'energies':[e for e,f in answers],'forces':[f.tolist() for e,f in answers]}))
else:
    import numpy as np
    results=[]
    for workers in (1,2):
        environment={**os.environ,**{name:str(2//workers) for name in ('OMP_NUM_THREADS','OPENBLAS_NUM_THREADS','MKL_NUM_THREADS')},'OMP_MAX_ACTIVE_LEVELS':'1'}
        output=subprocess.check_output([sys.executable,__file__,'--child',str(workers)],env=environment,text=True)
        results.append(json.loads(output))
    errors={}
    for name in ('energies','forces'):
        a,c=(np.array(result.pop(name)) for result in results)
        np.testing.assert_allclose(a,c,atol=1e-8,rtol=0)
        errors[name+'MaxDifference']=float(np.max(np.abs(a-c)))
    print(json.dumps({'totalThreads':2,'atoms':36,'images':12,'samplesAfterWarmup':3,
                      'cases':results,'speedup':results[0]['medianSeconds']/results[1]['medianSeconds'],**errors},indent=2))
