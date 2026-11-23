"""Check interchain forces and run 2 ps of MMFF94 MD on two finite PEG12 chains.

Run from the repository root with the bridge dependencies and RDKit installed:
python molecule-visualizer/tests/benchmark_polymer_interactions.py
"""
from pathlib import Path
import json

import numpy as np

from test_engine import b, CONFIG
from test_rdkit_md import load_md_sdf, run_md_job


def distance_between_chains(frame):
    first, second = np.split(frame, 2)
    return float(np.min(np.linalg.norm(first[:, None, :] - second[None, :, :], axis=-1)))


def verify_interactions(chain, pair, positions, close, far):
    """Compare two ways to construct the pair list and a rigid translation derivative."""
    cfg = {**CONFIG, 'engine': 'rdkit'}

    def engine(raw, xyz, model):
        settings = dict(raw['forceField'], model=model)
        data = b.validate(dict(raw, images=[xyz.tolist()], forceField=settings), 'rdkit')
        return b.RDKitEngine(data, cfg, '.')

    results = {}
    n = len(positions)
    delta = 1e-4
    shift = np.zeros_like(close)
    shift[n:, 1] = delta
    for model in ('MMFF94', 'MMFF94s', 'UFF'):
        field = engine(pair, far, model)
        energy, forces = field(0, close)
        fresh_e, fresh_f = engine(pair, close, model)(0, close)
        single_e, _ = engine(chain, positions, model)(0, positions)
        net_force = forces[n:, 1].sum()
        derivative = (field(0, close-shift)[0] - field(0, close+shift)[0])/(2*delta)
        np.testing.assert_allclose(fresh_e, energy, rtol=0., atol=1e-10)
        np.testing.assert_allclose(fresh_f, forces, rtol=0., atol=1e-10)
        np.testing.assert_allclose(net_force, derivative, rtol=0., atol=1e-6)
        assert abs(energy - 2*single_e) > 1e-3 and abs(net_force) > 1e-3
        results[model] = dict(interactionEnergyEV=energy-2*single_e, forceY_eV_A=net_force,
                              finiteDifferenceForceY_eV_A=derivative)
    return results


def main():
    path = Path(__file__).resolve().parents[1] / 'examples/polyethylene-glycol-12.sdf'
    chain = load_md_sdf(path, 'MMFF94')
    positions = np.array(chain['images'][0])
    n = len(positions)
    # Use the supplied extended conformation; translate chain 2 along y.
    far = np.vstack([positions, positions + [0., 150., 0.]])
    close = np.vstack([positions, positions + [0., 4.5, 0.]])
    ff = chain['forceField']
    bonds = ff['bonds'] + [[a+n, b+n, order] for a, b, order in ff['bonds']]
    pair = dict(chain, symbols=chain['symbols']*2, images=[close.tolist()],
                 forceField=dict(ff, bonds=bonds, formalCharges=ff['formalCharges']*2))
    interactions = verify_interactions(chain, pair, positions, close, far)
    result = run_md_job(pair, 4000, ensemble='nvt', thermostat='nose-hoover-chain',
                        timestepFs=.5, temperatureK=300., thermostatTimeFs=100.,
                        sampleEvery=40, seed=321, removeCOM=True)
    tr = result['trajectory']
    assert tr['timeFs'][-1] == 2000. and result['forceField'] == pair['forceField']
    temperatures = np.array(tr['temperatureK'])
    production = np.array(tr['timeFs']) >= 1000.
    minima = [distance_between_chains(np.array(frame)) for frame in tr['images']]
    print(json.dumps(dict(atoms=2*n, bonds=len(bonds), frames=len(minima), timeFs=tr['timeFs'][-1],
                          meanTemperatureLastPsK=float(temperatures[production].mean()),
                          firstMinimumDistanceA=minima[0],
                          sampledMinimumDistanceRangeA=[min(minima), max(minima)],
                          interactions=interactions), indent=2))


if __name__ == '__main__':
    main()
