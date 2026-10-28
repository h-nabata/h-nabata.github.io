"""Mass-weighted centers, joint holonomic projection, and persistent references."""
import copy
import tempfile
import unittest
import numpy as np
from test_engine import b, WATER, CONFIG
from test_afir_engine import request


POSITIONS = [[0.,0.,0.],[1.,.2,0.],[.2,1.1,.1],[3.,0.,0.],[4.,.3,.2],[3.2,1.,-.1]]
MASSES = [16.,1.,2.,12.,1.,1.]


def fixture(groups, mode='relative', optimizer='lbfgs'):
    data = dict(symbols=['O','H','H','C','H','H'], images=[copy.deepcopy(POSITIONS)],
                mode='optimize', cell=None, charge=0, multiplicity=1, maxSteps=500,
                fmax=1e-7, maxMove=.05, optimizer=optimizer)
    data['groupConstraints'] = b.validate_group_constraints(
        dict(mode=mode, groups=groups, masses=MASSES), data)
    target = np.array(POSITIONS)+np.array([[.4,.2,.1],[.1,-.2,.3],[-.2,.1,0.],
                                         [.6,.2,-.1],[.2,.4,.2],[.1,-.1,.3]])
    def calculate(i, p):
        return float(.5*np.sum((p-target)**2)), target-p
    return data, target, calculate


class GroupCenters(unittest.TestCase):
    def test_validation_rejects_overlap_stale_indices_invalid_masses_and_modes(self):
        data, _, _ = fixture([[0,1,2],[3,4,5]])
        valid = data['groupConstraints']
        invalid = [None, {}, {**valid,'mode':'distance'}, {**valid,'groups':[]},
                   {**valid,'groups':[[0,0]]}, {**valid,'groups':[[0,1],[1,2]]},
                   {**valid,'groups':[[True]]}, {**valid,'groups':[[6]]},
                   {**valid,'masses':[1.]}, {**valid,'masses':[0.]+MASSES[1:]},
                   {**valid,'masses':[float('nan')]+MASSES[1:]},
                   {**valid,'referenceCenters':[[0,0,0]]}, {**valid,'extra':1}]
        for config in invalid:
            with self.subTest(config=config), self.assertRaises(ValueError):
                b.validate_group_constraints(config, data)
        for patch in [{'mode':'ts'}, {'mode':'irc'}, {'mode':'cineb'}, {'vibrations':{}},
                      {'cell':{'vectors':np.eye(3).tolist(),'pbc':[True,False,False]}}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                b.validate_group_constraints(valid, {**data,**patch})
        wrong=copy.deepcopy(valid);wrong['referenceCenters'][1][0]+=.01
        with self.assertRaisesRegex(ValueError,'参照'):
            b.validate_group_constraints(wrong,data)

    def test_mass_weighted_centers_and_linear_jacobian(self):
        data, _, _ = fixture([[0,1,2],[3,4,5]])
        c=data['groupConstraints'];p=np.array(data['images'][0]);centers=b.group_centers(p,c)
        np.testing.assert_allclose(centers[0],(16*p[0]+p[1]+2*p[2])/19,atol=1e-14)
        self.assertGreater(np.linalg.norm(centers[0]-p[:3].mean(axis=0)),.1)
        matrix=b.group_coordinate_matrix(c);numeric=np.empty_like(matrix);h=1e-5
        for k in range(p.size):
            plus=p.copy();minus=p.copy();plus.flat[k]+=h;minus.flat[k]-=h
            numeric[:,k]=(b.group_coordinates(b.group_centers(plus,c),c)-b.group_coordinates(b.group_centers(minus,c),c))/(2*h)
        np.testing.assert_allclose(matrix,numeric,atol=1e-10)

    def test_all_optimizers_match_closed_form_minima(self):
        for groups,mode in [([[0,1,2]],'relative'), ([[0,1,2],[3,4,5]],'absolute'),
                            ([[0,1,2],[3,4,5]],'relative'), ([[0,1],[2,3],[4,5]],'relative')]:
            for optimizer in ('fire','lbfgs','bfgs'):
                with self.subTest(groups=groups,mode=mode,optimizer=optimizer):
                    data,target,calculate=fixture(groups,mode,optimizer)
                    # Independent equality-constrained quadratic solution.
                    rows=[]
                    weights=[]
                    for group in groups:
                        row=np.zeros(6)
                        for i in group:row[i]=MASSES[i]/sum(MASSES[j] for j in group)
                        weights.append(row)
                    if mode=='relative' and len(groups)>1:weights=[row-weights[0] for row in weights[1:]]
                    for weights_row in weights:
                        for axis in range(3):
                            row=np.zeros((6,3));row[:,axis]=weights_row;rows.append(row.ravel())
                    A=np.array(rows);p0=np.array(POSITIONS).ravel();t=target.ravel()
                    expected=t-A.T@np.linalg.solve(A@A.T,A@(t-p0))
                    result=b.calculate_job(data,calculate,None)
                    self.assertTrue(result['converged'])
                    np.testing.assert_allclose(np.array(result['images'][0]).ravel(),expected,atol=3e-7,rtol=0)
                    self.assertAlmostEqual(result['energies'][0],.5*np.sum((expected-t)**2),places=10)
                    self.assertGreater(result['steps'],0)
                    for p in result['trajectory']['images']:
                        np.testing.assert_allclose(A@(np.array(p).ravel()-p0),0,atol=1e-8)
                    raw=target-np.array(result['images'][0])
                    np.testing.assert_allclose(result['forces'][0],raw,atol=1e-12)
                    self.assertEqual(result['groupConstraints'],data['groupConstraints'])
                    if mode=='relative' and len(groups)>1:
                        self.assertGreater(np.linalg.norm(b.group_centers(result['images'][0],data['groupConstraints'])[0]-data['groupConstraints']['referenceCenters'][0]),.01)

    def test_joint_internal_and_fixed_atoms_project_once_without_drift(self):
        data, target, calculate=fixture([[0,1,2],[3,4,5]])
        data['fixedAtoms']=[0]
        data['internalConstraints']=[{'type':'distance','atoms':[0,1],'value':1.1}]
        result=b.calculate_job(data,calculate,None)
        self.assertTrue(result['converged'])
        for p in result['trajectory']['images']:
            np.testing.assert_array_equal(p[0],POSITIONS[0])
            self.assertLessEqual(b.group_constraint_error(p,data['groupConstraints']),1e-8)
            self.assertLessEqual(abs(np.linalg.norm(np.array(p[1])-p[0])-1.1),1e-8)
        positions=np.array(result['images'][0]);atoms=b.ase_atoms(data,calculate);atoms.positions[:]=positions
        projected=np.random.default_rng(2).normal(size=positions.shape)
        atoms.constraints[0].adjust_forces(atoms,projected)
        np.testing.assert_array_equal(projected[0],0)
        np.testing.assert_allclose(b.group_coordinate_matrix(data['groupConstraints'])@projected.ravel(),0,atol=1e-11)
        np.testing.assert_allclose(b.internal_coordinate_jacobian(positions,data['internalConstraints'])@projected.ravel(),0,atol=1e-11)
        # Two fixed atoms and a fixed center of their partner leave no motion.
        blocked,_,calc=fixture([[5]],'absolute');blocked['fixedAtoms']=[0,1,2,3,4]
        with self.assertRaisesRegex(ValueError,'全自由度'):
            b.constrained_minimize(blocked,calc)
        angular,_,calc=fixture([[0,1,2],[3,4,5]])
        angular['fixedAtoms']=[0]
        coordinates=[{'type':'angle','atoms':[0,1,2]}, {'type':'dihedral','atoms':[0,1,2,3]}]
        for coordinate,value in zip(coordinates,b.internal_coordinate_values(POSITIONS,coordinates)):
            coordinate['value']=value
        angular['internalConstraints']=coordinates
        angular['maxSteps']=20
        result=b.calculate_job(angular,calc,None)
        for p in result['trajectory']['images']:
            np.testing.assert_array_equal(p[0],POSITIONS[0])
            self.assertLessEqual(b.group_constraint_error(p,angular['groupConstraints']),1e-8)
            np.testing.assert_allclose(b.internal_coordinate_residual(b.internal_coordinate_values(p,coordinates),coordinates),0,atol=1e-8)
        impossible,_,calc=fixture([[1]],'absolute');impossible['fixedAtoms']=[0]
        impossible['internalConstraints']=[{'type':'distance','atoms':[0,1],'value':2.}]
        with self.assertRaisesRegex(ValueError,'両立|矛盾'):
            b.constrained_minimize(impossible,calc)

    def test_afir_and_partial_results_keep_centers_and_raw_physical_forces(self):
        data=b.validate(request(),'tblite');data['maxSteps']=3
        data['groupConstraints']=b.validate_group_constraints(
            {'mode':'relative','groups':[[0,1],[2]],'masses':[16.,1.,1.]},data)
        initial=np.array(data['images'][0]);checkpoints=[]
        calc=lambda i,p:(float(.5*np.sum((p-initial)**2)),initial-p)
        result=b.calculate_job(data,calc,None,checkpoints.append)
        self.assertEqual(result['validation'],'biased-trajectory-not-ts')
        for p,e,force,bias,total in zip(result['images'],result['energies'],result['forces'],result['biasEnergies'],result['biasedEnergies']):
            self.assertLessEqual(b.group_constraint_error(p,data['groupConstraints']),1e-8)
            np.testing.assert_allclose(force,initial-np.array(p),atol=1e-12)
            self.assertAlmostEqual(e+bias,total,places=12)
        jobs=b.Jobs({**CONFIG,'historyDir':None})
        job={'data':data,'checkpoints':[p['checkpoint'] for p in checkpoints], 'status':'cancelled'}
        partial=jobs.partial_afir(job)
        self.assertEqual(partial['groupConstraints'],data['groupConstraints'])
        self.assertFalse(partial['converged'])
        jobs.close()

    def test_scan_and_resume_keep_original_center_reference(self):
        data,_,calc=fixture([[0,1,2],[3,4,5]],'absolute')
        data.update(mode='scan',fmax=1e-6,scan={'coordinates':[{'type':'distance','atoms':[0,1],'start':1.,'stop':1.2,'points':3}], 'stopOnFailure':True})
        progress=[];result=b.relaxed_scan(data,calc,None,progress.append)
        self.assertTrue(result['converged'])
        for p in result['images']:self.assertLessEqual(b.group_constraint_error(p,data['groupConstraints']),1e-8)
        data['_scanResume']=next(p['structureCheckpoint'] for p in progress if 'structureCheckpoint' in p)
        resumed=b.relaxed_scan(data,calc,None)
        np.testing.assert_allclose(resumed['images'],result['images'],atol=1e-12)
        self.assertEqual(resumed['groupConstraints'],data['groupConstraints'])
        # MIN restart with the last geometry retains the original reference.
        restarted=b.validate({k:v for k,v in {**data,'mode':'optimize','fmax':1e-5,'images':[result['images'][-1]]}.items() if k not in ('scan','_scanResume')},'tblite')
        self.assertEqual(restarted['groupConstraints'],data['groupConstraints'])

    def test_native_tblite_conserves_single_water_center(self):
        data=b.validate({**WATER,'mode':'optimize','optimizer':'lbfgs','maxSteps':3,
                         'groupConstraints':{'mode':'relative','groups':[[0,1,2]],'masses':[16.,1.,1.]}},'tblite')
        with tempfile.TemporaryDirectory() as directory:
            result=b.calculate_job(data,b.TBLiteEngine(data,CONFIG,directory),directory)
        for p in result['trajectory']['images']:self.assertLessEqual(b.group_constraint_error(p,data['groupConstraints']),1e-8)
        self.assertGreater(np.linalg.norm(np.array(result['images'][0])-data['images'][0]),1e-5)
        self.assertTrue(np.isfinite(result['energies']).all())


if __name__=='__main__':unittest.main()
