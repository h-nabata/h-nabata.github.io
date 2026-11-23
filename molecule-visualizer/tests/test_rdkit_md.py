"""Native RDKit fixed-connectivity forces for the electronic-engine MD interface."""
from pathlib import Path
import importlib.util
import unittest

import numpy as np
from test_engine import b, CONFIG
from test_persistent_jobs import wait_for


def water(model='MMFF94'):
    return dict(mode='md', symbols=['O','H','H'], charge=0, multiplicity=1, cell=None,
                images=[[[0.,0.,0.],[.98,.01,0.],[-.22,.94,.03]]],
                forceField=dict(model=model, bonds=[[0,1,1],[0,2,1]], formalCharges=[0,0,0]))


def load_md_sdf(path, model):
    """Read the explicit all-atom graph and the supplied 3D conformer."""
    from rdkit import Chem
    mol = Chem.SDMolSupplier(str(path), removeHs=False)[0]
    if mol is None:
        raise ValueError(f'Invalid MD input: {path}')
    atoms = list(mol.GetAtoms())
    field = dict(model=model, formalCharges=[a.GetFormalCharge() for a in atoms],
                 bonds=[[bond.GetBeginAtomIdx(), bond.GetEndAtomIdx(), bond.GetBondTypeAsDouble()]
                        for bond in mol.GetBonds()])
    return dict(mode='md', symbols=[a.GetSymbol() for a in atoms],
                charge=sum(field['formalCharges']), images=[mol.GetConformer().GetPositions().tolist()],
                forceField=field)


def run_md_job(raw, steps, **settings):
    jobs = b.Jobs({**CONFIG, 'engine':'rdkit', 'jobTimeout':180, 'evaluationTimeout':30})
    try:
        request = b.validate({**raw, 'maxSteps':steps, 'md':settings}, 'rdkit')
        receipt = jobs.start(request)
        job = wait_for(jobs, receipt['id'], timeout=185)
        if job['status'] != 'completed':
            raise AssertionError((job['status'], job.get('error')))
        return job['result']
    finally:
        jobs.close()


class ForceFieldInput(unittest.TestCase):
    def test_graph_is_explicit_and_checks_charge_indices_orders_and_duplicates(self):
        case = water()
        good = case['forceField']
        self.assertEqual(b.validate_force_field(good, case), good)
        for changes in ({'bonds':None}, {'bonds':[[0,1,1],[1,0,2]]}, {'bonds':[[0,1,True]]},
                        {'bonds':[[0,2,4]]}, {'bonds':[[0,3,2]]}, {'bonds':[[1,1,1]]},
                        {'formalCharges':[0,1,-2]}, {'formalCharges':[False,0,0]}, {'model':'auto'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                b.validate_force_field({**good, **changes}, case)
        for changes in ({'cell':{'pbc':[False,True,False]}}, {'multiplicity':3}, {'mode':'neb'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                b.validate_force_field(good, {**case, **changes})


@unittest.skipUnless(importlib.util.find_spec('rdkit'), 'native RDKit is not installed')
class NativeRDKit(unittest.TestCase):
    def calculator(self, data):
        return b.make_calculator(data, {**CONFIG, 'engine':'rdkit'}, '.')

    def check_gradient(self, calc, xyz):
        energy, forces = calc(0, xyz)
        self.assertTrue(np.isfinite(energy))
        np.testing.assert_allclose(forces.sum(axis=0), 0., atol=2e-10)
        self.assertGreater(np.linalg.norm(forces), .01)
        delta = 1e-5
        numerical = np.empty_like(xyz)
        for i,j in np.ndindex(xyz.shape):
            step = np.zeros_like(xyz)
            step[i,j] = delta
            numerical[i,j] = -(calc(0,xyz+step)[0]-calc(0,xyz-step)[0])/(2*delta)
        np.testing.assert_allclose(forces, numerical, rtol=2e-5, atol=2e-7)
        return energy

    def test_water_units_and_forces_all_models_against_rdkit(self):
        from rdkit import Chem
        from rdkit.Chem import AllChem
        for model in b.RDKIT_FORCE_FIELDS:
            with self.subTest(model=model):
                data = water(model)
                xyz = np.array(data['images'][0])
                calc = self.calculator(data)
                energy = self.check_gradient(calc, xyz)
                ref = Chem.AddHs(Chem.MolFromSmiles('O'))
                conf = Chem.Conformer(3)
                for i,p in enumerate(xyz):
                    conf.SetAtomPosition(i, tuple(p))
                ref.AddConformer(conf)
                if model == 'UFF':
                    field = AllChem.UFFGetMoleculeForceField(ref)
                else:
                    props = AllChem.MMFFGetMoleculeProperties(ref, mmffVariant=model)
                    field = AllChem.MMFFGetMoleculeForceField(ref, props)
                self.assertAlmostEqual(energy, field.CalcEnergy()/23.06054783, places=9)

    def test_aromatic_benzene_and_kekule_forms_agree(self):
        angles = np.arange(6)*np.pi/3
        ring = np.stack([np.cos(angles),np.sin(angles),np.zeros(6)],axis=1)
        xyz = np.concatenate([1.4*ring,2.49*ring])
        xyz[3,2] += .04
        base = dict(mode='md', symbols=['C']*6+['H']*6, images=[xyz.tolist()], charge=0, multiplicity=1, cell=None)
        to_h = [[i,i+6,1] for i in range(6)]
        values = []
        for orders in ([1.5]*6,[1,2]*3):
            ring_bonds = [[i,(i+1)%6,v] for i,v in enumerate(orders)]
            field = dict(model='MMFF94', bonds=ring_bonds+to_h, formalCharges=[0]*12)
            values.append(self.check_gradient(self.calculator({**base,'forceField':field}),xyz))
        self.assertAlmostEqual(values[0], values[1], places=10)

    def test_ammonium_uses_formal_charge_and_refuses_missing_hydrogens(self):
        xyz = np.array([[0,0,0],[.6,.6,.61],[-.6,-.6,.6],[-.6,.6,-.6],[.6,-.6,-.6]])
        base = dict(mode='md',symbols=['N']+['H']*4, images=[xyz.tolist()],charge=1,multiplicity=1,cell=None)
        settings = dict(model='MMFF94',bonds=[[0,i,1] for i in range(1,5)],formalCharges=[1,0,0,0,0])
        self.check_gradient(self.calculator({**base,'forceField':settings}),xyz)
        self.assertEqual(b.validate_force_field(settings, base)['formalCharges'][0],1)
        with self.assertRaisesRegex(ValueError,'水素'):
            self.calculator({**base,'forceField':{**settings, 'bonds':settings['bonds'][:-1]}})
        no_params = dict(model='MMFF94', bonds=[], formalCharges=[0])
        with self.assertRaisesRegex(ValueError,'パラメータ'):
            self.calculator({**base, 'symbols':['He'], 'charge':0, 'images':[[[0,0,0]]], 'forceField':no_params})

    def test_distant_fragments_interact_when_they_later_approach(self):
        d = water()
        first = np.array(d['images'][0])
        d['symbols'] *= 2
        d['forceField']['bonds'] += [[3,4,1],[3,5,1]]
        d['forceField']['formalCharges'] *= 2
        far = np.concatenate([first, first+[1000,0,0]])
        d['images'] = [far.tolist()]
        field = self.calculator(d)
        near = np.concatenate([first, first+[3.2,0,0]])
        energy, forces = field(0, near)
        self.assertGreater(abs(energy - field(0, far)[0]), .0001)
        self.assertGreater(np.linalg.norm(forces[:3].sum(axis=0)), .001)
        fresh = self.calculator({**d,'images':[near.tolist()]})
        new_energy, new_force = fresh(0, near)
        self.assertAlmostEqual(energy,new_energy,places=12)
        np.testing.assert_allclose(forces,new_force,atol=1e-11)

    def test_butadiene_fixed_topology_nve_energy_error_scales_quadratically(self):
        from rdkit import Chem
        fixture = Path(__file__).resolve().parents[1] / 'examples' / 'butadiene-md.sdf'
        mol = Chem.SDMolSupplier(str(fixture), removeHs=False)[0]
        atoms = list(mol.GetAtoms())
        xyz = mol.GetConformer().GetPositions().tolist()
        bonds = [[bond.GetBeginAtomIdx(),bond.GetEndAtomIdx(),bond.GetBondTypeAsDouble()]
                 for bond in mol.GetBonds()]
        self.assertEqual(sum(order == 2 for _,_,order in bonds), 2)
        self.assertEqual(len(atoms), 10)
        topology = dict(model='MMFF94', formalCharges=[a.GetFormalCharge() for a in atoms], bonds=bonds)
        raw = dict(mode='md', symbols=[a.GetSymbol() for a in atoms], images=[xyz], forceField=topology)
        errors = []
        for dt in (.5,.25):
            opts = dict(timestepFs=dt, ensemble='nve', seed=42, sampleEvery=1, temperatureK=300)
            data = b.validate({**raw,'md':opts, 'maxSteps':int(60/dt)}, 'rdkit')
            result = b.calculate_job(data, self.calculator(data), '.')
            self.assertEqual(result['reason'],'completed')
            self.assertEqual(result['forceField'],topology)
            self.assertEqual(result['trajectory']['timeFs'][-1],60.)
            total = np.array(result['trajectory']['totalEV'])
            errors.append(np.max(np.abs(total-total[0])))
        self.assertLess(errors[1], .0005)
        self.assertTrue(3.5 < errors[0]/errors[1] < 4.5, errors)

    def test_polyethylene_nve_energy_on_halving_timestep(self):
        path = Path(__file__).resolve().parents[1] / 'examples' / 'polyethylene-20.sdf'
        for model in b.RDKIT_FORCE_FIELDS:
            with self.subTest(model=model):
                raw = load_md_sdf(path, model)
                self.assertEqual(raw['symbols'].count('C'), 40)
                self.assertEqual(raw['symbols'].count('H'), 82)
                self.assertEqual(len(raw['forceField']['bonds']), 121)
                errors = []
                for dt in (.5, .25):
                    r = run_md_job(raw, int(48/dt), ensemble='nve', timestepFs=dt, temperatureK=300,
                                   seed=731, sampleEvery=1, removeCOM=True)
                    self.assertEqual(r['forceField'], raw['forceField'])
                    self.assertEqual(r['trajectory']['timeFs'][-1], 48.)
                    total = np.array(r['trajectory']['totalEV'])
                    errors.append(abs(total-total[0]).max())
                self.assertTrue(0. < errors[0] < .05, errors)
                self.assertTrue(3.5 < errors[0]/errors[1] < 4.5, errors)

    def test_isolated_polymer_baths_keep_geometry_and_sample_temperature(self):
        examples = Path(__file__).resolve().parents[1] / 'examples'
        cases = [('polyethylene-20', 'MMFF94', thermostat)
                 for thermostat in ('nose-hoover-chain', 'bussi', 'langevin')]
        cases += [('polyethylene-glycol-12', 'MMFF94s', 'nose-hoover-chain'),
                  ('polyethylene-glycol-12', 'UFF', 'langevin')]
        for name, model, thermostat in cases:
            with self.subTest(name=name, model=model, thermostat=thermostat):
                raw = load_md_sdf(examples / (name+'.sdf'), model)
                r = run_md_job(raw, 4000, ensemble='nvt', thermostat=thermostat, timestepFs=.5,
                               temperatureK=300, seed=731, sampleEvery=25, removeCOM=True)
                self.assertEqual(r['forceField'], raw['forceField'])
                tr = r['trajectory']
                np.testing.assert_array_equal(tr['timeFs'], np.arange(161) * 12.5)
                np.testing.assert_allclose(tr['totalEV'], np.add(tr['energies'], tr['kineticEV']), atol=1e-10, rtol=0)
                temperature = np.array(tr['temperatureK'])[np.array(tr['timeFs'])>=500]
                self.assertAlmostEqual(temperature.mean(), 300., delta=26.)
                self.assertGreater(temperature.std(), 3.)
                xyz = np.array(tr['images'])
                i, j, _ = np.array(raw['forceField']['bonds'], dtype=int).T
                distances = np.linalg.norm(xyz[:,i]-xyz[:,j], axis=2)
                self.assertGreater(distances.min(), .85)
                self.assertLess(distances.max(), 1.85)
                mass = np.array(r['masses'])
                com = np.einsum('fij,i->fj', xyz, mass)/mass.sum()
                np.testing.assert_allclose(com-com[0], 0., atol=1e-7)
                np.testing.assert_array_equal(r['images'][0], xyz[-1])

    def test_rdkit_job_provenance_and_strict_mode(self):
        raw = water()
        d = b.validate(raw, 'rdkit')
        cfg = {**CONFIG, 'engine':'rdkit'}
        self.assertEqual(b.engine_method(cfg, d), 'RDKit / MMFF94')
        pr = b.provenance(cfg, d)['rdkit']
        self.assertEqual(pr['model'], 'MMFF94')
        self.assertTrue(pr['version'] and pr['interfragmentInteractions'])
        with self.assertRaises(ValueError):
            b.validate({**raw,'mode':'evaluate'}, 'rdkit')
        with self.assertRaises(ValueError):
            b.validate(raw,'tblite')
