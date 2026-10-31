"""python benchmark_cpu_efficiency.py BASELINE_BRIDGE; public analytic ModelF data."""
import importlib.util
import json
from pathlib import Path
import sys
import time
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local-engine'))
import bridge as current
spec=importlib.util.spec_from_file_location('baseline',sys.argv[1]);baseline=importlib.util.module_from_spec(spec);spec.loader.exec_module(baseline)


def run(module,count):
    data={'mode':'optimize','cell':None,'modelF':{'model':'amf','surface':'lower','alphaKJMol':30.,'multiplicities':[1,3]}}
    calculator=module.ModelFEngine.__new__(module.ModelFEngine);calculator._start(data)
    p=[[0.,0.,0.]];row=module.model_f_components(-1.,-.8,data['modelF']);energy=row['lowerEV']
    calculator.records[calculator.key(p,energy=energy)]=row
    result={'images':[p]*count,'energies':[energy]*count}
    times=[]
    for _ in range(6):
        start=time.perf_counter();calculator.annotate(result);times.append(time.perf_counter()-start)
    assert all(x==energy for x in result['surfaceComponents']['lowerEV'])
    return {'medianMS':float(np.median(times[1:]))*1000,'lastComponents':{k:v[-1] for k,v in result['surfaceComponents'].items()}}


rows=[]
for count in (1000,10000):
    before=run(baseline,count);after=run(current,count);assert before.pop('lastComponents')==after.pop('lastComponents')
    rows.append({'frames':count,'before':before,'after':after,'speedup':before['medianMS']/after['medianMS']})
print(json.dumps({'python':sys.version.split()[0],'numpy':np.__version__,'modelFAnnotation':rows},indent=2))
