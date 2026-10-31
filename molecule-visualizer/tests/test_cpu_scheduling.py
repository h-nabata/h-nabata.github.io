"""CPU budgets must agree before spawn, inside the worker and in reported results."""
import copy
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
from test_engine import b, CONFIG, WATER
from test_persistent_jobs import wait_for
from test_llmlip import config as llmlip_config


class CPUScheduling(unittest.TestCase):
    def test_budget_is_bounded_by_available_work_and_preserves_requested_total(self):
        for engine in ('tblite','gxtb','llmlip'):
            c={**CONFIG,'engine':engine,'threads':8,'workers':4}
            for mode,count,expected in [('optimize',1,1),('afir',1,1),('ts',1,1),('irc',1,1),('scan',1,1),
                                        ('evaluate',1,1),('evaluate',2,2),('evaluate',9,4),('cineb',3,3),('lup',7,4),('vibrations',1,4)]:
                d={'mode':mode,'images':[[]]*count,'symbols':['H']*3}
                plan=b.cpu_plan(d,c)
                self.assertEqual(plan,{'evaluationWorkers':expected,'threadsPerEvaluation':8//expected})
                self.assertLessEqual(plan['evaluationWorkers']*plan['threadsPerEvaluation'],8)
            adaptive={'mode':'cineb','images':[[]]*3,'adaptiveNEB':{'enabled':True,'maxImages':10}}
            self.assertEqual(b.cpu_plan(adaptive,c)['evaluationWorkers'],4)
            self.assertEqual(b.cpu_plan({'mode':'optimize','symbols':['H'],'vibrations':{'nfree':4}},c)['evaluationWorkers'],4)
            self.assertEqual(c['threads'],8)
        self.assertEqual(b.cpu_plan({'mode':'vibrations'},{**CONFIG,'engine':'uma','threads':8,'workers':4})['evaluationWorkers'],1)

    def test_native_environment_is_set_before_process_start(self):
        for engine in ('tblite','llmlip'):
            for count in (1,2):
                c={**CONFIG,'threads':4,'workers':2} if engine=='tblite' else llmlip_config()
                data=b.validate({**WATER,'images':WATER['images']*count},engine)
                observed=[]
                process=SimpleNamespace(start=lambda:observed.append(dict(os.environ)))
                context=SimpleNamespace(Queue=lambda:SimpleNamespace(put=lambda _:None),Process=lambda **_:process)
                jobs=b.Jobs(c)
                with patch.object(jobs,'_launch_next'):
                    identifier=jobs.start(data)['id']
                with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ),patch.object(b.mp,'get_context',return_value=context),patch.object(b.tempfile,'mkdtemp',return_value=directory),patch.object(b.threading,'Thread',return_value=SimpleNamespace(start=lambda:None)):
                    jobs._launch_job(jobs.jobs[identifier])
                self.assertEqual(len(observed),1)
                native='RAYON_NUM_THREADS' if engine=='llmlip' else 'OPENBLAS_NUM_THREADS'
                self.assertEqual(observed[0][native],str(4//count))
                self.assertEqual(observed[0]['OMP_MAX_ACTIVE_LEVELS'],'1')
                if engine=='llmlip':self.assertEqual(observed[0]['OPENBLAS_NUM_THREADS'],'1')
                self.assertEqual(jobs.config['threads'],4)

    def test_native_tblite_single_and_parallel_jobs_report_and_preserve_results(self):
        c={**CONFIG,'threads':2,'workers':2}
        with tempfile.TemporaryDirectory() as directory:
            jobs=b.Jobs({**c,'historyDir':directory})
            try:
                results=[]
                for count in (1,2):
                    created=jobs.start(b.validate({**WATER,'images':WATER['images']*count},'tblite'))
                    saved=wait_for(jobs,created['id']);self.assertEqual(saved['status'],'completed',saved)
                    result=saved['result'];results.append(result)
                    self.assertEqual(result['performance']['evaluationWorkers'],count)
                    self.assertEqual(result['performance']['threadsPerEvaluation'],2//count)
                    self.assertEqual(result['provenance']['threads'],2)
                    self.assertEqual(result['provenance']['cpuPlan']['evaluationWorkers'],count)
                np.testing.assert_allclose(results[1]['energies'],results[0]['energies']*2,rtol=0,atol=1e-8)
                np.testing.assert_allclose(results[1]['forces'],results[0]['forces']*2,rtol=0,atol=1e-8)
                created=jobs.start(b.validate({**WATER,'mode':'optimize','optimizer':'lbfgs','maxSteps':100,'fmax':.01},'tblite'))
                saved=wait_for(jobs,created['id']);self.assertEqual(saved['status'],'completed',saved)
                self.assertTrue(saved['result']['converged']);self.assertEqual(saved['result']['performance']['threadsPerEvaluation'],2)
            finally:jobs.close()


if __name__=='__main__':unittest.main()
