"""Exercise native FAIR-Chem's cell and derivative handling without downloading weights.

This random, miniature UMA architecture tests software integration only. The
separate benchmark_uma_periodic.py requires an actual trained UMA-small model.
"""
from pathlib import Path
import tempfile
import unittest

import numpy as np
from packaging.version import Version
from ase import units
from ase.build import add_adsorbate, bulk, fcc111

from benchmark_uma_periodic import bridge, geometry, submit


def write_fixture(path):
    import torch
    from hydra.utils import instantiate
    from fairchem.core.units.mlip_unit.api.inference import MLIPInferenceCheckpoint

    tasks = []
    for dataset in ['oc20', 'omat']:
        for name, level, dimensions in [('energy', 'system', [1]), ('forces', 'atom', [3]), ('stress', 'system', [1, 9])]:
            tasks.append(dict(_target_='fairchem.core.units.mlip_unit.mlip_unit.Task',
                              name=f'{dataset}_{name}', level=level, property=name, datasets=[dataset],
                              out_spec=dict(dim=dimensions, dtype='float32'),
                              normalizer=dict(_target_='fairchem.core.modules.normalization.normalizer.Normalizer',
                                              mean=0., rmsd=1.)))
    base = 'fairchem.core.models.uma.'
    model_config = dict(
        _target_='fairchem.core.models.base.HydraModel', model_id='random-umatest',
        pass_through_head_outputs=True, supports_single_atoms=True,
        backbone=dict(model=base+'escn_moe.eSCNMDMoeBackbone', num_experts=2, moe_layer_type='pytorch',
                      num_layers=1, sphere_channels=8, edge_channels=8, hidden_channels=8, lmax=2, mmax=2,
                      cutoff=4.5, max_neighbors=48, otf_graph=True, use_pbc=True, use_pbc_single=True,
                      act_type='gate', ff_type='spectral', regress_stress=True, direct_forces=False,
                      dataset_mapping={'omat':'omat', 'oc20':'oc20'}),
        heads=dict(energy_forces=dict(module=base+'escn_moe.DatasetSpecificSingleHeadWrapper',
                                     head_cls=base+'escn_md.MLP_EFS_Head', head_kwargs=dict(wrap_property=False),
                                     dataset_names=['omat', 'oc20'])))
    with torch.random.fork_rng(devices=[]):
        torch.manual_seed(42)
        model = instantiate(model_config)
    ema = torch.optim.swa_utils.AveragedModel(model)
    torch.save(MLIPInferenceCheckpoint(model_config, model.state_dict(), ema.state_dict(), tasks), path)


@unittest.skipUnless(Version('2.23') <= Version(bridge.package_version('fairchem-core') or '0') < Version('3'),
                     'requires fairchem-core >=2.23,<3')
class PeriodicUMARuntime(unittest.TestCase):
    def test_bulk_stress_and_partial_slab_through_real_library(self):
        with tempfile.TemporaryDirectory() as scratch:
            checkpoint = Path(scratch)/'random-fixture.pt'
            write_fixture(checkpoint)
            config = dict(engine='uma', umaModel='uma-s-1p2p1', umaCheckpoint=str(checkpoint),
                          umaDevice='cpu', umaPrecision='float32', threads=1, workers=1,
                          jobTimeout=180, evaluationTimeout=120, historyDir=str(Path(scratch)/'jobs'))
            jobs = bridge.Jobs(config)
            try:
                self.check_bulk_stress(jobs)
                self.check_slab_directions(jobs)
            finally:
                jobs.close()

    def check_bulk_stress(self, jobs):
        atoms = bulk('Si', 'diamond', a=5.45, cubic=True)
        atoms.positions[0] += [.12, -.05, .08]
        options = dict(ensemble='nve', timestepFs=.1, sampleEvery=1, recordPressure=True, removeCOM=False,
                       initialVelocitiesAngstromPerFs=np.zeros_like(atoms.positions).tolist())
        md = submit(jobs, dict(geometry(atoms, 'omat'), mode='md', maxSteps=2, md=options))
        energies, volumes = [], []
        for scale in (.999, 1.001):
            strained = atoms.copy()
            strained.set_cell(atoms.cell * scale, scale_atoms=True)
            result = submit(jobs, dict(geometry(strained, 'omat'), mode='evaluate'))
            energies.append(result['energies'][0])
            volumes.append(strained.get_volume())
        pressure = md['trajectory']['pressureBar'][0] * units.bar
        self.assertAlmostEqual(pressure, -(energies[1]-energies[0])/(volumes[1]-volumes[0]), delta=.001)

    def check_slab_directions(self, jobs):
        slab = fcc111('Cu', size=(2, 2, 3), a=3.62, vacuum=8., orthogonal=True)
        add_adsorbate(slab, 'O', 1.55, 'fcc')
        structure = geometry(slab, 'oc20')
        images = [slab.positions.copy() for _ in range(3)]
        images[1][-1] += slab.cell[0]
        images[2][-1] += slab.cell[2]
        result = submit(jobs, dict(structure, mode='evaluate', images=np.asarray(images).tolist()))
        en = result['energies']
        self.assertAlmostEqual(en[0], en[1], delta=1e-4)
        np.testing.assert_allclose(result['forces'][0], result['forces'][1], atol=1e-4, rtol=0)
        self.assertGreater(abs(en[2]-en[0]), 1e-4)
        end = slab.positions.copy()
        end[-1] += [.7, 1.2, 0.]
        initial = np.linspace(slab.positions, end, 3)
        fixed = np.flatnonzero(slab.get_tags() > 1).tolist()
        band = submit(jobs, dict(structure, mode='cineb', images=initial.tolist(), fixedAtoms=fixed,
                                 endpointMode='relax', optimizer='fire', fmax=.00001, maxSteps=2, climbAfter=0))
        np.testing.assert_array_equal(np.asarray(band['images'])[:, fixed], initial[:, fixed])
        self.assertGreater(np.abs(np.asarray(band['images'])[:, -1] - initial[:, -1]).max(), 0.)
