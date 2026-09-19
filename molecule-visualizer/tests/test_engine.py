"""Numerical, native-engine, HTTP boundary and cancellation regressions."""
import copy
import http.client
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest

os.environ['OMP_NUM_THREADS'] = os.environ['OPENBLAS_NUM_THREADS'] = '1'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'local-engine'))
import bridge as b
import numpy as np
from ase import Atoms
from ase.calculators.singlepoint import SinglePointCalculator
from ase.mep import NEB

CONFIG = {'engine': 'tblite', 'method': 'GFN2-xTB', 'binary': None, 'threads': 1,
          'jobTimeout': 60, 'evaluationTimeout': 10}
WATER = {'symbols': ['O', 'H', 'H'], 'images': [[[0,0,0],[.96,0,0],[-.24,.93,0]]]}


def well(i, p):
    x, y, z = p[0]
    return (x*x-1)**2+2*y*y+z*z, np.array([[-4*x*(x*x-1), -4*y, -2*z]])


def band(mode='perpendicular'):
    return {'images': [[[x,.35*np.sin(np.pi*(x+1)/2),0]] for x in np.linspace(-1,1,7)],
            'mode': mode, 'maxSteps': 400, 'fmax': 1e-4, 'spring': 1., 'maxMove': .04, 'climbAfter': 10}


class Numerics(unittest.TestCase):
    def test_projection_uses_all_3n_components(self):
        tau = np.array([[1.,2,3],[4,5,6]])
        tau /= np.linalg.norm(tau)
        force = np.array([[3.,-.4,1],[7,.6,-4]])
        projected = b.perpendicular(force,tau)
        self.assertLess(abs(np.sum(projected*tau)),1e-12)
        self.assertGreater(abs(np.dot(projected[0],tau[0])),.01)  # not per-atom orthogonality
        np.testing.assert_allclose(b.perpendicular(2*tau,tau),0,atol=1e-12)

    def test_neb_and_ci_forces_match_ase_improved_tangent(self):
        coords = np.array([[[0,0,0],[.7,0,0]],[[.1,.2,0],[.9,.1,0]],[[.2,.1,0],[1.2,.2,0]],[[.4,.1,0],[1.4,0,0]],[[.5,0,0],[1.6,.1,0]]])
        energies = np.array([-3.,-1.,2.,.5,-2.])
        physical = np.random.default_rng(4).normal(size=coords.shape)
        for climb in (False,True):
            atoms=[]
            for positions,energy,force in zip(coords,energies,physical):
                a=Atoms('H2',positions=positions)
                a.calc=SinglePointCalculator(a,energy=energy,forces=force)
                atoms.append(a)
            reference=NEB(atoms,k=.15,climb=climb,method='improvedtangent').get_forces().reshape(3,2,3)
            actual,_=b.band_forces(coords,energies,physical,'cineb' if climb else 'neb',.15,2 if climb else None)
            np.testing.assert_allclose(actual[1:-1],reference,atol=1e-12)
            np.testing.assert_array_equal(actual[[0,-1]],0)

    def test_every_actual_step_is_perpendicular_to_current_tangent(self):
        data=band(); snapshots=[]; current=np.array(data['images'])
        def calculator(i,p):
            current[i]=p
            return well(i,p)
        def progress(p):
            if 'energies' in p:
                snapshots.append((current.copy(),p['energies']))
        result=b.relax(data,calculator,progress)
        self.assertTrue(result['converged'])
        self.assertLess(result['maxTangentialStep'],1e-12)
        for (before,energies),(after,_) in zip(snapshots,snapshots[1:]):
            for i in range(1,len(before)-1):
                tau=b.tangent(before,energies,i)
                self.assertLess(abs(np.sum((after[i]-before[i])*tau)),1e-12)
                self.assertLessEqual(b.force_max(after[i]-before[i]),data['maxMove']+1e-12)
        np.testing.assert_array_equal(np.array(result['images'])[[0,-1]],np.array(data['images'])[[0,-1]])
        self.assertLess(abs(result['images'][3][0][1]),3e-5)

    def test_parallel_force_does_not_relax_or_artificially_lower_energy(self):
        data=band();data['images']=[[[x,0,0]] for x in np.linspace(-1,1,7)]
        result=b.relax(data,well)
        np.testing.assert_array_equal(result['images'],data['images'])
        self.assertEqual(result['steps'],0)
        self.assertGreater(np.max(np.abs(result['forces'])),1)

    def test_neb_ci_converge_and_final_energies_match_final_coordinates(self):
        for mode in ('neb','cineb'):
            data=band(mode);result=b.relax(data,well)
            self.assertTrue(result['converged'])
            if mode=='cineb':
                ci=result['climbingImage']
                np.testing.assert_allclose(result['images'][ci],[[0,0,0]],atol=3e-5)
                self.assertGreaterEqual(result['steps'],data['climbAfter'])
            np.testing.assert_array_equal(np.array(result['images'])[[0,-1]],np.array(data['images'])[[0,-1]])
            for p,e in zip(result['images'],result['energies']):
                self.assertAlmostEqual(well(0,np.array(p))[0],e,places=12)
        data=band();data['maxSteps']=1
        result=b.relax(data,well)
        self.assertFalse(result['converged']);self.assertEqual(result['reason'],'step_limit')

    def test_degenerate_and_flat_tangents(self):
        images=np.array([[[0.,0,0]],[[1.,0,0]],[[1.,1,0]]])
        tau=b.tangent(images,[0,0,0],1)
        np.testing.assert_allclose(tau,[[2**-.5,2**-.5,0]])
        with self.assertRaises(ValueError):b.tangent(np.zeros((3,1,3)),[0,0,0],1)
        with self.assertRaises(ValueError):b.relax(band(),lambda i,p:(float('nan'),np.zeros_like(p)))


class Validation(unittest.TestCase):
    def test_charge_spin_bounds_and_no_commands(self):
        self.assertEqual(b.validate(WATER,'tblite')['multiplicity'],1)
        for patch in ({'charge':0.5},{'multiplicity':2},{'images':[[[float('nan'),0,0]]]},
                      {'command':'rm -rf /'},{'binary':'/tmp/something'},{'maxSteps':1001},{'mode':'cineb','maxSteps':2,'climbAfter':3}):
            with self.assertRaises((ValueError,TypeError)):b.validate({**WATER,**patch},'tblite')
        with self.assertRaises(ValueError):b.validate({**WATER,'mode':'perpendicular'},'tblite')
        with self.assertRaises(ValueError):b.validate({**WATER,'images':WATER['images']*21},'tblite')

    def test_periodic_validation_and_minimum_image_collisions(self):
        cell={'vectors':[[8,0,0],[2,8,0],[0,0,8]],'pbc':[True]*3}
        data={**WATER,'cell':cell}
        self.assertEqual(b.validate(data,'tblite')['cell'],cell)
        with self.assertRaises(ValueError):b.validate(data,'gxtb')
        with self.assertRaises(ValueError):b.validate({**data,'cell':{'vectors':[[0,0,0]]*3,'pbc':[True]*3}},'tblite')
        near={**data,'symbols':['H','H'],'images':[[[0,0,0],[2,8.01,0]]]}
        with self.assertRaises(ValueError):b.validate(near,'tblite')

    def test_turbomole_gradient_parser_units_and_rejection(self):
        positions=np.array([[0,0,0],[b.Bohr,0,0]])
        text='$grad\n cycle = 1 SCF energy = -1.25 |dE/dxyz| = 0.2\n 0 0 0 h\n 1 0 0 h\n 1.0D-2 0 0\n -1.0D-2 0 0\n$end\n'
        energy,force=b.parse_gradient(text,['H','H'],positions)
        self.assertAlmostEqual(energy,-1.25*b.Hartree)
        self.assertAlmostEqual(force[0,0],-.01*b.Hartree/b.Bohr)
        for source in (text.replace('1 0 0 h','2 0 0 h'),text.replace('h','o'),text.replace('1.0D-2','nan'),text.replace('$grad','$other')):
            with self.assertRaises(ValueError):b.parse_gradient(source,['H','H'],positions)


@unittest.skipUnless(importlib.util.find_spec('tblite'),'tblite is optional locally; required by CI')
class NativeTBLite(unittest.TestCase):
    def test_real_energy_gradient_units_finite_difference_and_optimization(self):
        data=b.validate({**WATER,'mode':'optimize','maxSteps':150,'fmax':.02},'tblite')
        engine=b.TBLiteEngine(data,CONFIG,tempfile.gettempdir())
        p=np.array(data['images'][0]);energy,force=engine(0,p)
        plus=p.copy();minus=p.copy();plus[1,0]+=.0001;minus[1,0]-=.0001
        numerical=-(engine(1,plus)[0]-engine(2,minus)[0])/.0002
        self.assertAlmostEqual(force[1,0],numerical,delta=.001)
        result=b.relax(data,engine)
        self.assertTrue(result['converged']);self.assertLess(result['energies'][0],energy)
        final_energy,_=engine(4,np.array(result['images'][0]))
        self.assertAlmostEqual(final_energy,result['energies'][0],places=5)

    def test_real_fixed_cell_path_and_endpoints(self):
        water=np.array(WATER['images'][0]);images=[]
        for offset in (0,.2,.4):
            p=water.copy();p[1,0]+=offset;images.append(p.tolist())
        cell={'vectors':[[9,0,0],[1,9,0],[0,0,9]],'pbc':[True]*3}
        data=b.validate({**WATER,'images':images,'cell':cell,'mode':'perpendicular','maxSteps':2,'fmax':.00001},'tblite')
        engine=b.TBLiteEngine(data,CONFIG,tempfile.gettempdir())
        result=b.relax(data,engine)
        self.assertTrue(np.isfinite(result['energies']).all())
        np.testing.assert_array_equal(np.array(result['images'])[[0,-1]],np.array(images)[[0,-1]])
        self.assertLess(result['maxTangentialStep'],1e-12)
        self.assertGreater(np.linalg.norm(np.array(result['images'])[1]-images[1]),1e-8)


@unittest.skipUnless(os.getenv('GXTB_TEST_BINARY'),'optional native g-xTB binary not installed')
class NativeGXTB(unittest.TestCase):
    def test_gxtb_water_and_finite_difference(self):
        data=b.validate(WATER,'gxtb')
        with tempfile.TemporaryDirectory() as directory:
            engine=b.GXTBEngine(data,{**CONFIG,'binary':str(Path(os.environ['GXTB_TEST_BINARY']).resolve()),'evaluationTimeout':120},directory)
            p=np.array(data['images'][0]);energy,force=engine(0,p)
            self.assertTrue(math_is_finite(energy));self.assertEqual(force.shape,(3,3))
            plus=p.copy();minus=p.copy();plus[1,0]+=.001;minus[1,0]-=.001
            numerical=-(engine(1,plus)[0]-engine(2,minus)[0])/.002
            self.assertAlmostEqual(force[1,0],numerical,delta=.01)


def math_is_finite(value):return bool(np.isfinite(value))


class HTTPBoundary(unittest.TestCase):
    def setUp(self):
        self.server=b.make_server(CONFIG,'test-token',0,['https://h-nabata.github.io'])
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.server.jobs.close();self.server.shutdown();self.server.server_close();self.thread.join()
    def call(self,method,path,body=None,headers=None):
        c=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=10)
        h={'Authorization':'Bearer test-token','Origin':'https://h-nabata.github.io'}
        h.update(headers or {})
        raw=None if body is None else json.dumps(body)
        if body is not None:h.setdefault('Content-Type','application/json')
        c.request(method,path,body=raw,headers=h);response=c.getresponse();content=response.read()
        result=(response.status,dict(response.getheaders()),json.loads(content) if content else {})
        c.close();return result

    def test_auth_origin_host_and_preflight(self):
        self.assertEqual(self.call('GET','/api/info')[0],200)
        for h,status in [({'Authorization':''},401),({'Origin':'https://evil.example'},403),({'Origin':'null'},403),({'Host':'evil.example'},403)]:
            self.assertEqual(self.call('GET','/api/info',headers=h)[0],status)
        status,headers,_=self.call('OPTIONS','/api/jobs',headers={'Authorization':'','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type','Access-Control-Request-Private-Network':'true'})
        self.assertEqual(status,204);self.assertEqual(headers['Access-Control-Allow-Origin'],'https://h-nabata.github.io');self.assertEqual(headers['Access-Control-Allow-Private-Network'],'true')
        self.assertEqual(self.call('OPTIONS','/api/jobs',headers={'Origin':'https://evil.example','Access-Control-Request-Method':'POST'})[0],403)
        self.assertEqual(self.call('POST','/api/jobs',WATER,{'Content-Type':'text/plain'})[0],415)
        self.assertEqual(self.call('POST','/api/jobs',{**WATER,'binary':'/bin/sh'})[0],400)
        self.assertEqual(self.call('GET','/api/jobs')[0],404)
        self.assertEqual(self.call('POST','/api/jobs',WATER,{'Content-Length':str(b.MAX_BODY+1)})[0],413)

    @unittest.skipUnless(importlib.util.find_spec('tblite'),'tblite required')
    def test_actual_async_job_result_and_cleanup(self):
        status,_,job=self.call('POST','/api/jobs',WATER);self.assertEqual(status,202)
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            _,_,job=self.call('GET','/api/jobs/'+job['id'])
            if job['status']!='running':break
            time.sleep(.05)
        self.assertEqual(job['status'],'completed',job)
        self.assertEqual(job['result']['symbols'],WATER['symbols'])
        self.assertTrue(np.isfinite(job['result']['energies']).all())
        self.server.jobs.job['thread'].join(timeout=5)
        self.assertFalse(Path(self.server.jobs.job['directory']).exists())

    @unittest.skipIf(os.name=='nt','test fixture uses a POSIX executable script')
    def test_cancellation_and_timeout_kill_native_children(self):
        with tempfile.TemporaryDirectory() as directory:
            binary=Path(directory)/'slow-engine'
            binary.write_text('#!'+sys.executable+'\nimport time\ntime.sleep(30)\n');binary.chmod(0o755)
            for timeout in (60,1):
                config={**CONFIG,'engine':'gxtb','binary':str(binary),'jobTimeout':timeout,'evaluationTimeout':30}
                jobs=b.Jobs(config)
                try:
                    job=jobs.start(b.validate(WATER,'gxtb'))
                    deadline=time.monotonic()+5;children=[]
                    while time.monotonic()<deadline:
                        children=b.psutil.Process(jobs.job['process'].pid).children(recursive=True)
                        if children:break
                        time.sleep(.03)
                    self.assertTrue(children)
                    with self.assertRaises(RuntimeError):jobs.start(b.validate(WATER,'gxtb'))
                    if timeout==60:jobs.cancel(job['id'])
                    jobs.job['thread'].join(timeout=8)
                    self.assertFalse(jobs.job['thread'].is_alive())
                    self.assertFalse(jobs.job['process'].is_alive())
                    self.assertTrue(all(not c.is_running() or c.status()==b.psutil.STATUS_ZOMBIE for c in children))
                    self.assertEqual(jobs.get(job['id'])['status'],'cancelled' if timeout==60 else 'error')
                    self.assertFalse(Path(jobs.job['directory']).exists())
                finally:jobs.close()


if __name__=='__main__':unittest.main(verbosity=2)
