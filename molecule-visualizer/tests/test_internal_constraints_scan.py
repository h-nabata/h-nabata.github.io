"""Holonomic constraints, analytic derivatives and evaluated relaxed scan nodes."""
import copy
import tempfile
import unittest
import numpy as np
from test_engine import b, WATER, CONFIG
from test_afir_engine import request


def data_for(positions, constraints, optimizer='fire'):
    return {'symbols':['H']*len(positions),'images':[copy.deepcopy(positions)],'cell':None,
            'charge':0,'multiplicity':1,'mode':'optimize','maxSteps':500,'fmax':1e-6,
            'maxMove':.03,'optimizer':optimizer,'internalConstraints':constraints}


class InternalConstraints(unittest.TestCase):
    def test_validation_and_scan_bounds(self):
        normalized={'mode':'optimize','symbols':['H']*4}
        constraint={'type':'distance','atoms':[0,1],'value':1.}
        self.assertEqual(b.validate_internal_constraints({'internalConstraints':[constraint]},normalized),[constraint])
        for item in [None,{},'distance',[constraint,{**constraint,'atoms':[1,0]}],
                     [{**constraint,'atoms':[0,True]}],[{**constraint,'value':float('nan')}],
                     [{'type':'angle','atoms':[0,1,2],'value':180}],
                     [{'type':'dihedral','atoms':[0,1,1,3],'value':60}]]:
            with self.subTest(item=item),self.assertRaises(ValueError):
                b.validate_internal_constraints({'internalConstraints':item},normalized)
        coordinate={'type':'distance','atoms':[0,1],'start':.8,'stop':1.2,'points':5}
        normalized['mode']='scan'
        self.assertEqual(b.validate_scan_settings({'scan':{'coordinates':[coordinate]}},normalized)['stopOnFailure'],True)
        for config in [{'coordinates':[coordinate,coordinate]},
                       {'coordinates':[{**coordinate,'points':True}]},
                       {'coordinates':[{**coordinate,'points':21},{**coordinate,'atoms':[2,3],'points':21}]},
                       {'coordinates':[coordinate],'stopOnFailure':1}]:
            with self.subTest(config=config),self.assertRaises(ValueError):
                b.validate_scan_settings({'scan':config},normalized)

    def test_analytic_jacobian_matches_central_difference(self):
        positions=np.array([[0.,0.,0.],[1.1,.1,0.],[1.7,1.1,.2],[2.3,1.2,1.3]])
        coordinates=[{'type':'distance','atoms':[0,1],'value':1.},
                     {'type':'angle','atoms':[0,1,2],'value':110.},
                     {'type':'dihedral','atoms':[0,1,2,3],'value':60.}]
        analytic=b.internal_coordinate_jacobian(positions,coordinates)
        numerical=np.empty_like(analytic);delta=1e-6
        for k in range(positions.size):
            plus=positions.copy();minus=positions.copy();plus.flat[k]+=delta;minus.flat[k]-=delta
            difference=b.internal_coordinate_values(plus,coordinates)-b.internal_coordinate_values(minus,coordinates)
            difference[-1]=(difference[-1]+180)%360-180
            numerical[:,k]=difference/(2*delta)
        np.testing.assert_allclose(analytic,numerical,rtol=1e-6,atol=1e-6)

    def test_joint_force_projection_is_tangent_and_fixed_atoms_are_exact(self):
        coordinates=[{'type':'distance','atoms':[0,1],'value':1.2},
                     {'type':'angle','atoms':[1,0,2],'value':100.}]
        data=data_for(WATER['images'][0],coordinates);data['fixedAtoms']=[0]
        atoms=b.ase_atoms(data,lambda i,p:(0.,np.zeros_like(p)))
        constraint=atoms.constraints[0];atoms.positions[:]=constraint.project(atoms.positions)
        raw=np.random.default_rng(4).normal(size=atoms.positions.shape);projected=raw.copy()
        constraint.adjust_forces(atoms,projected)
        np.testing.assert_array_equal(projected[0],0)
        jacobian=b.internal_coordinate_jacobian(atoms.positions,coordinates)
        np.testing.assert_allclose(jacobian@projected.ravel(),0,atol=1e-10)
        np.testing.assert_allclose(b.internal_coordinate_values(atoms.positions,coordinates),[1.2,100.],atol=1e-8)
        direction=np.random.default_rng(3).normal(size=atoms.positions.shape);direction[0]=0
        h=1e-5
        plus=constraint.project(atoms.positions+h*direction)
        minus=constraint.project(atoms.positions-h*direction)
        derivative=-np.sum(raw*(plus-minus))/(2*h)
        self.assertAlmostEqual(derivative,-np.sum(projected*direction),places=6)

    def test_min_algorithms_and_projection_preserve_all_constraints(self):
        initial=[[0.,0.,0.],[1.1,.2,0.],[-.2,1.1,0.]]
        target=np.array([[0.,0.,0.],[1.,0.,0.],[0.,1.,0.]])
        coordinates=[{'type':'distance','atoms':[0,1],'value':1.2}]
        for optimizer in ('fire','lbfgs','bfgs'):
            with self.subTest(optimizer=optimizer):
                data=data_for(initial,coordinates,optimizer);data['fixedAtoms']=[0]
                def calculator(i,p):
                    np.testing.assert_array_equal(p[0],target[0])
                    return float(.5*np.sum((p-target)**2)),target-p
                result=b.constrained_minimize(data,calculator)
                self.assertTrue(result['converged']);self.assertLessEqual(result['effectiveFmax'],data['fmax'])
                self.assertGreater(result['constraintProjection']['maxDisplacement'],0)
                self.assertEqual(result['constraintProjection']['inputPositions'],initial)
                frames=np.array(result['trajectory']['images'])
                for p,e in zip(frames,result['trajectory']['energies']):
                    np.testing.assert_allclose(b.internal_coordinate_values(p,coordinates),[1.2],atol=1e-8)
                    self.assertAlmostEqual(calculator(0,p)[0],e,places=12)
                self.assertLessEqual(np.linalg.norm(np.diff(frames,axis=0),axis=2).max(),data['maxMove']+1e-10)
                self.assertAlmostEqual(result['energies'][0],.02,places=9)
                self.assertGreater(np.linalg.norm(np.array(result['forces'][0])[1]),.19)

    def test_angle_and_dihedral_targets_cross_periodic_boundary(self):
        initial=[[0.,0.,0.],[1.,0.,0.],[1.5,1.,0.],[2.,1.,1.]]
        coordinates=[{'type':'angle','atoms':[0,1,2],'value':110.},
                     {'type':'dihedral','atoms':[0,1,2,3],'value':-170.}]
        data=data_for(initial,coordinates);data['fixedAtoms']=[0,1]
        atoms=b.ase_atoms(data,lambda i,p:(0.,np.zeros_like(p)))
        projected=atoms.constraints[0].project(atoms.positions)
        np.testing.assert_array_equal(projected[:2],np.array(initial)[:2])
        values=b.internal_coordinate_values(projected,coordinates)
        np.testing.assert_allclose(b.internal_coordinate_residual(values,coordinates),0,atol=1e-8)
        # An impossible distance between two fixed atoms fails instead of drifting.
        data['internalConstraints']=[{'type':'distance','atoms':[0,1],'value':2.}]
        with self.assertRaisesRegex(ValueError,'両立'):
            b.internal_coordinate_constraint(data).project(np.array(initial))

    def test_singular_linear_angle_fails_before_potential_evaluation(self):
        data=data_for([[-1.,0.,0.],[0.,0.,0.],[1.,0.,0.]],
                      [{'type':'angle','atoms':[0,1,2],'value':90.}])
        calls=[]
        with self.assertRaises((ValueError,ZeroDivisionError)):
            b.constrained_minimize(data,lambda i,p:calls.append(p))
        self.assertEqual(calls,[])

    def test_projection_backtracks_from_singular_trial(self):
        data=data_for(WATER['images'][0],[{'type':'distance','atoms':[0,1],'value':.96}])
        atoms=b.ase_atoms(data,lambda i,p:(0.,np.zeros_like(p)))
        trial=atoms.positions.copy();trial[1]=trial[0]
        atoms.constraints[0].adjust_positions(atoms,trial)
        self.assertLessEqual(np.linalg.norm(trial-atoms.positions,axis=1).max(),data['maxMove']+1e-10)
        self.assertAlmostEqual(np.linalg.norm(trial[1]-trial[0]),.96,places=8)

    def test_periodic_collision_is_rejected_before_native_calculation(self):
        data=data_for([[0.,0.,0.],[9.95,0.,0.]],[])
        data['cell']={'vectors':[[10.,0.,0.],[0.,10.,0.],[0.,0.,10.]],'pbc':[True,True,True]}
        calls=[]
        atoms=b.ase_atoms(data,lambda i,p:calls.append(p))
        with self.assertRaisesRegex(ValueError,'衝突'):
            atoms.get_forces()
        self.assertEqual(calls,[])

    def test_afir_keeps_physical_and_artificial_terms_separate(self):
        data=b.validate(request(),'tblite');data['maxSteps']=5
        data['internalConstraints']=[{'type':'distance','atoms':[0,1],'value':.96}]
        initial=np.array(data['images'][0]);checkpoints=[]
        calc=lambda i,p:(float(.5*np.sum((p-initial)**2)),initial-p)
        result=b.constrained_minimize(data,calc,progress=checkpoints.append)
        self.assertEqual(result['schema'],'molecule-afir-trajectory/1')
        self.assertEqual(result['validation'],'biased-trajectory-not-ts')
        for i,p in enumerate(result['images']):
            p=np.array(p);energy,force=calc(0,p)
            bias,artificial=b.afir_bias(p,data['symbols'],data['atomIds'],data['afir'])
            self.assertAlmostEqual(result['energies'][i],energy)
            self.assertAlmostEqual(result['biasEnergies'][i],bias)
            self.assertAlmostEqual(result['biasedEnergies'][i],energy+bias)
            np.testing.assert_allclose(result['forces'][i],force)
            self.assertAlmostEqual(np.linalg.norm(p[1]-p[0]),.96,places=8)
        self.assertTrue(all('bias' in p['checkpoint'] for p in checkpoints))


class RelaxedScans(unittest.TestCase):
    def scan(self,dimensions=1):
        initial=[[0.,0.,0.],[1.,.2,0.],[-.2,1.,0.]]
        data=data_for(initial,[],optimizer='lbfgs');data.update(mode='scan',fixedAtoms=[0])
        coordinates=[{'type':'distance','atoms':[0,1],'start':.8,'stop':1.2,'points':3}]
        if dimensions==2:
            coordinates.append({'type':'distance','atoms':[0,2],'start':.9,'stop':1.1,'points':3})
        data['scan']={'coordinates':coordinates,'stopOnFailure':True}
        target=np.array([[0.,0.,0.],[1.,0.,0.],[0.,1.,0.]])
        def calc(i,p):return float(.5*np.sum((p-target)**2)),target-p
        return data,calc

    def test_1d_and_2d_scan_have_expected_relaxed_minima(self):
        for dimensions in (1,2):
            with self.subTest(dimensions=dimensions):
                data,calc=self.scan(dimensions);progress=[]
                result=b.relaxed_scan(data,calc,None,progress.append)
                self.assertTrue(result['converged']);self.assertEqual(len(result['images']),3**dimensions)
                for node,positions,energy in zip(result['scan']['nodes'],result['images'],result['energies']):
                    np.testing.assert_allclose(node['actual'],node['targets'],atol=1e-8)
                    self.assertAlmostEqual(energy,.5*sum((x-1)**2 for x in node['targets']),places=8)
                    self.assertAlmostEqual(energy,calc(0,np.array(positions))[0],places=12)
                if dimensions==2:
                    self.assertEqual([n['targets'][1] for n in result['scan']['nodes']],[.9,1.,1.1,1.1,1.,.9,.9,1.,1.1])
                checkpoints=[p for p in progress if 'structureCheckpoint' in p]
                self.assertEqual(len(checkpoints),3**dimensions)

    def test_scan_resume_uses_completed_nodes_and_preserves_values(self):
        data,calc=self.scan();progress=[]
        complete=b.relaxed_scan(data,calc,None,progress.append)
        partial=[p['structureCheckpoint'] for p in progress if 'structureCheckpoint' in p][0]
        data['_scanResume']=partial;updates=[]
        resumed=b.relaxed_scan(data,calc,None,updates.append)
        self.assertTrue(resumed['converged'])
        np.testing.assert_allclose(resumed['images'],complete['images'],atol=1e-12)
        np.testing.assert_allclose(resumed['energies'],complete['energies'],atol=1e-12)
        self.assertEqual({p['scanNode'] for p in updates},{1,2})
        self.assertEqual(resumed['evaluations'],complete['evaluations'])

    def test_crash_mid_second_scan_node_can_resume_checkpoint(self):
        data,calc=self.scan(2);progress=[];completed=[]
        def monitor(p):
            progress.append(p)
            if 'structureCheckpoint' in p:
                completed.append(p['structureCheckpoint'])
        def failing(i,p):
            if completed:
                raise RuntimeError('synthetic model interruption')
            return calc(i,p)
        with self.assertRaisesRegex(RuntimeError,'interruption'):
            b.relaxed_scan(data,failing,None,monitor)
        self.assertEqual(len(completed),1)
        data['_scanResume']=completed[0]
        restored=b.relaxed_scan(data,calc,None)
        reference=b.relaxed_scan({k:v for k,v in data.items() if k!='_scanResume'},calc,None)
        self.assertTrue(restored['converged'])
        np.testing.assert_allclose(restored['images'],reference['images'],atol=1e-12)
        self.assertEqual(restored['scan']['nodes'],reference['scan']['nodes'])

    def test_scan_stops_at_unconverged_node(self):
        data,calc=self.scan();data['maxSteps']=1;data['fmax']=1e-10
        result=b.relaxed_scan(data,calc,None)
        self.assertFalse(result['converged']);self.assertEqual(result['reason'],'scan_node_unconverged')
        self.assertEqual(len(result['images']),1)
        self.assertFalse(result['scan']['nodes'][0]['converged'])

    def test_native_tblite_via_validated_job_dispatch(self):
        for mode in ('optimize','scan'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as directory:
                request_data={**WATER,'mode':mode,'optimizer':'lbfgs','fixedAtoms':[0],
                              'maxSteps':2,'fmax':.00001,'maxMove':.03}
                if mode=='optimize':
                    request_data['internalConstraints']=[{'type':'distance','atoms':[0,1],'value':1.05}]
                else:
                    request_data['scan']={'coordinates':[{'type':'distance','atoms':[0,1],'start':1.,'stop':1.05,'points':2}],
                                          'stopOnFailure':False}
                data=b.validate(request_data,'tblite');calc=b.TBLiteEngine(data,CONFIG,directory)
                result=b.calculate_job(data,calc,directory)
                self.assertEqual(result['mode'],mode)
                self.assertTrue(np.isfinite(result['energies']).all())
                for p in result['images']:
                    np.testing.assert_array_equal(p[0],WATER['images'][0][0])
                if mode=='scan':
                    np.testing.assert_allclose([n['actual'][0] for n in result['scan']['nodes']],[1.,1.05],atol=1e-8)
                else:
                    self.assertAlmostEqual(np.linalg.norm(np.array(result['images'][0])[1]),1.05,places=8)


if __name__=='__main__':
    unittest.main()
