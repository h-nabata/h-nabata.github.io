"""DS-AFIR on analytic surfaces, including the curved Müller–Brown path."""
from pathlib import Path
import importlib.util
import json
import threading
import time
from urllib.request import Request, urlopen
import sys
import tempfile
from unittest.mock import patch
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'local-engine'))
import bridge
from test_engine import CONFIG


def endpoints(start, end):
    return {
        'mode': 'dsafir',
        'symbols': ['H'] * len(start),
        'atomIds': [f'atom-{index}' for index in range(len(start))],
        'images': np.asarray([start, end]).tolist(),
    }


def run(job, energy_force, progress=lambda values: None):
    data = bridge.validate(job, 'tblite')
    with tempfile.TemporaryDirectory() as directory:
        return bridge.calculate_job(data, energy_force, directory, progress)


# Embed the two MB coordinates in two independent bond stretches. Equal and
# opposite motion of each pair leaves the center and the optimal orientation
# fixed. A unit displacement in either MB coordinate is a unit 3N displacement.
def mb_geometry(x, y):
    a, b = 3 + x / np.sqrt(2), 3 + y / np.sqrt(2)
    return np.array([[a, 0, 0], [-a, 0, 0], [0, b, 0], [0, -b, 0]])


def mb_coordinates(positions):
    return np.sqrt(2) * (np.array([np.linalg.norm(positions[i] - positions[i+1]) / 2
                                   for i in (0, 2)]) - 3)


def mb_potential(index, positions):
    x, y = mb_coordinates(positions)
    a = np.array([-1, -1, -6.5, .7])
    b = np.array([0, 0, 11, .6])
    c = np.array([-10, -10, -6.5, .7])
    dx, dy = x - np.array([1, 0, -.5, -1]), y - np.array([0, .5, 1.5, 1])
    # A common energy scaling keeps delta inside the bridge's eV/Å range.
    terms = .01 * np.array([-200, -100, -170, 15]) * np.exp(a*dx**2 + b*dx*dy + c*dy**2)
    gradient = [terms @ (2*a*dx + b*dy), terms @ (b*dx + 2*c*dy)]
    forces = np.zeros_like(positions)
    for i, derivative in zip((0, 2), gradient):
        direction = positions[i] - positions[i+1]
        forces[i] = -derivative * direction / (np.sqrt(2) * np.linalg.norm(direction))
        forces[i+1] = -forces[i]
    return float(terms.sum()), forces


class DoubleSphere(unittest.TestCase):
    def test_projection_of_force_and_reference_reset(self):
        q = np.array([[0., 0, 0], [1., 1, 0]])
        p = np.array([[0., 1, 0], [0., 0, 0]])
        f = np.array([[.4, -1, 2], [3., 2, -.2]])
        # Test both the initial sphere and a displaced reference that gives
        # positive weights to both sphere directions.
        for reference in (q, q - np.array([[0., .3, 0], [.7, -.2, .4]])):
            delta = 1.2
            d, r = q-p, q-reference
            d_unit = d / np.linalg.norm(d)
            if np.linalg.norm(r):
                r_unit = r / np.linalg.norm(r)
                z = max(0., np.linalg.norm(r)/np.linalg.norm(d) + np.sum(d_unit*r_unit))
                direction = z*d_unit - r_unit
                direction /= np.linalg.norm(direction)
            else:
                direction = d_unit
            actual = bridge.dsafir_force(q, p, reference, f, delta)
            self.assertAlmostEqual(np.sum(actual*direction), -delta)
            np.testing.assert_allclose(actual, f - (np.sum(f*direction) + delta)*direction)

    def test_two_ended_search_follows_curved_muller_brown_pass(self):
        q, p = mb_geometry(-.558, 1.442), mb_geometry(-.050, .467)
        data = endpoints(q, p)
        data.update(dsafir={'delta': 3., 'stepSize': .025, 'threshold': .05}, maxSteps=200)
        updates = []
        result = run(data, mb_potential, updates.append)
        self.assertTrue(result['converged'])
        self.assertTrue(result['dsafir']['connected'])
        self.assertLessEqual(result['dsafir']['gap'], .05)
        self.assertLess(result['steps'], 100)
        np.testing.assert_allclose(result['images'][0], q)
        np.testing.assert_allclose(result['images'][-1], p, atol=1e-12)
        frames = np.asarray(result['images'])
        measured_paths = [mb_potential(i, frame)[0] for i, frame in enumerate(frames)]
        np.testing.assert_allclose(result['energies'], measured_paths)
        i = np.argmax(measured_paths)
        # The straight connection would miss this saddle along the valley wall.
        np.testing.assert_allclose(mb_coordinates(frames[i]), [-.822, .624], atol=.05)
        self.assertAlmostEqual(measured_paths[i], -.405, delta=.02)
        self.assertEqual({update.get('side') for update in updates} & {'reactant', 'product'},
                         {'reactant', 'product'})

    def test_step_limit_keeps_two_physical_fronts_with_measurable_gap(self):
        q, p = mb_geometry(-.558, 1.442), mb_geometry(-.050, .467)
        rotation = np.array([[0, -1, 0], [1, 0, 0], [0, 0, 1]])
        data = endpoints(q, p @ rotation + [8, -3, 2])
        result = run({**data, 'maxSteps': 1}, mb_potential)
        self.assertFalse(result['converged'])
        ds = result['dsafir']
        self.assertFalse(ds['connected'])
        frames = np.asarray(result['images'])
        self.assertEqual(len(frames), 3)
        i = ds['joinIndex']
        self.assertAlmostEqual(np.linalg.norm(frames[i+1]-frames[i]), ds['gap'])
        self.assertGreater(ds['gap'], ds['threshold'])
        # Only the lower-energy reactant frontier gets a step.
        self.assertEqual(i, 1)
        np.testing.assert_allclose(frames[0], q, atol=1e-12)
        np.testing.assert_allclose(frames[-1], p, atol=1e-12)

    def test_flat_stretch_connects_without_a_duplicate_seam(self):
        # The gap becomes shorter than the requested step before connection.
        data = endpoints([[-.4, 0, 0], [.4, 0, 0]], [[-1., 0, 0], [1., 0, 0]])
        data['dsafir'] = {'stepSize': .2, 'threshold': .001}
        result = run(data, lambda lane, x: (0., np.zeros_like(x)))
        seam = result['dsafir']
        self.assertTrue(seam['connected'])
        self.assertGreater(seam['gap'], 0.)
        self.assertLessEqual(seam['gap'], .001)
        self.assertGreater(seam['joinIndex'], 0)
        self.assertLess(seam['joinIndex'], len(result['images']) - 2)
        distances = np.linalg.norm(np.diff(result['images'], axis=0), axis=(1, 2))
        self.assertTrue(np.all(distances > 1.e-12))
        self.assertTrue(np.all(distances <= .2 + 1.e-12))

    def test_alignment_rejects_rigid_motion_and_preserves_chirality(self):
        p = np.array([[0., 0, 0], [1., .1, 0], [0., 1.2, 0], [.1, .2, 1.5]])
        rotated = p @ np.array([[0, -1, 0], [1, 0, 0], [0, 0, 1]]) + [8, -4, 3]
        energy_force = lambda i, x: (0., np.zeros_like(x))
        with self.assertRaises(ValueError):
            run(endpoints(p, rotated), energy_force)
        mirrored = p * [-1, 1, 1]
        result = run({**endpoints(p, mirrored), 'maxSteps': 1}, energy_force)
        signed_volume = lambda x: np.linalg.det(x[1:] - x[0])
        start, end = np.asarray(result['images'])[[0, -1]]
        self.assertAlmostEqual(signed_volume(start), -signed_volume(end))

    def test_interrupted_journal_preserves_two_fronts_and_restarts_from_original_ends(self):
        raw = {**endpoints(mb_geometry(-.558, 1.442), mb_geometry(-.050, .467)), 'maxSteps': 3}
        data = bridge.validate(raw, 'tblite')
        updates = []
        expected = run(raw, mb_potential, updates.append)
        frames = [update['checkpoint'] for update in updates if 'checkpoint' in update]
        with tempfile.TemporaryDirectory() as directory:
            config = {**CONFIG, 'historyDir': directory}
            jobs = bridge.Jobs(config)
            with patch.object(jobs, '_launch_next'):
                job = jobs.start(data)
            record = jobs.jobs[job['id']]
            record.update(status='running', checkpoints=frames)
            jobs._persist(record, force=True)
            restored = bridge.Jobs(config)
            detail = restored.get(job['id'])
            self.assertEqual(detail['status'], 'interrupted')
            result = detail['result']
            self.assertEqual(result['reason'], 'interrupted')
            for name in ('images', 'energies', 'imageFmax', 'atomIds', 'dsafir', 'history'):
                self.assertEqual(result[name], expected[name])
            with patch.object(restored, '_launch_next'):
                restarted = restored.resume(job['id'])
            self.assertEqual(restarted['resumeKind'], 'restart')
            self.assertEqual(restored.jobs[restarted['id']]['data']['images'], data['images'])

    @unittest.skipUnless(importlib.util.find_spec('tblite'), 'native tblite required')
    def test_malonaldehyde_path_relaxes_on_the_physical_surface(self):
        from ase.io import read
        example = Path(__file__).resolve().parents[1] / 'examples/malonaldehyde-proton-transfer.xyz'
        a, b = read(example, index=':')
        reactant_product = [a.positions.tolist(), b.positions.tolist()]
        atoms = dict(symbols=a.get_chemical_symbols(), atomIds=[f'a{i}' for i in range(len(a))])

        def calculate(mode, images, **settings):
            data = bridge.validate(dict(**atoms, mode=mode, images=images, **settings), 'tblite')
            with tempfile.TemporaryDirectory() as directory:
                calculator = bridge.TBLiteEngine(data, CONFIG, directory)
                cache = bridge.ExactEvaluationCache(calculator)
                try:
                    return bridge.calculate_job(data, cache, directory)
                finally:
                    cache.close()

        initial = calculate('dsafir', reactant_product)
        self.assertTrue(initial['dsafir']['connected'])
        initial_barrier = max(initial['energies']) - initial['energies'][0]
        # Transferring H is atom 9, between oxygen atoms 4 and 5.
        for mode in ('cineb', 'lup'):
            with self.subTest(mode=mode):
                band = calculate(mode, initial['images'], maxSteps=150, fmax=.05,
                                 maxMove=.03, spring=1., climbAfter=5)
                self.assertTrue(band['converged'])
                self.assertLessEqual(band['effectiveFmax'], .05)
                energy = np.asarray(band['energies'])
                self.assertLess(energy.max()-energy[0], initial_barrier-.05)
                np.testing.assert_array_equal(np.asarray(band['images'])[[0, -1]],
                                              np.asarray(initial['images'])[[0, -1]])
                positions = np.asarray(band['images'])
                oh = np.linalg.norm(positions[:, 3:5]-positions[:, 8:9], axis=2)
                asymmetry = oh[:, 0]-oh[:, 1]
                self.assertLess(asymmetry[0], -.5)
                self.assertGreater(asymmetry[-1], .5)
                self.assertLess(abs(asymmetry[energy.argmax()]), .18)

    @unittest.skipUnless(importlib.util.find_spec('tblite'), 'native tblite required')
    def test_local_service_example_and_actual_ammonia_jobs(self):
        from ase.io import read
        root = Path(__file__).resolve().parents[1]
        example = root / 'examples/ammonia-inversion.xyz'
        frames = read(example, index=':')
        job = endpoints(frames[1].positions, frames[0].positions)
        job.update(symbols=frames[0].get_chemical_symbols(),
                   dsafir={'delta': 1.8, 'stepSize': .025, 'threshold': .05})
        server = bridge.make_server(CONFIG, 'ds-test', 0, [], root)
        service = threading.Thread(target=server.serve_forever, daemon=True)
        service.start()
        base = f'http://127.0.0.1:{server.server_port}'

        def api(resource, payload=None):
            request = Request(base + resource, headers={'Authorization': 'Bearer ds-test',
                              'Content-Type': 'application/json'},
                              data=None if payload is None else json.dumps(payload).encode())
            with urlopen(request, timeout=10) as response:
                return json.load(response)

        try:
            with urlopen(base + '/examples/ammonia-inversion.xyz', timeout=10) as response:
                self.assertEqual(response.read(), example.read_bytes())
            for limit, connected in ((1, False), (300, True)):
                with self.subTest(max_steps=limit):
                    job_id = api('/api/jobs', {**job, 'maxSteps': limit})['id']
                    deadline = time.monotonic() + 30
                    while time.monotonic() < deadline:
                        status = api('/api/jobs/' + job_id)
                        if status['status'] in server.jobs.TERMINAL:
                            break
                        time.sleep(.05)
                    self.assertEqual(status['status'], 'completed', status.get('error'))
                    result = status['result']
                    self.assertEqual(result['dsafir']['connected'], connected)
                    self.assertEqual(result['dsafir']['gap'] <= .05, connected)
                    self.assertEqual(result['atomIds'], job['atomIds'])
                    if connected:
                        energies = result['energies']
                        self.assertGreater(max(energies), max(energies[0], energies[-1]) + .01)
        finally:
            server.shutdown()
            server.jobs.close()
            server.server_close()
            service.join()

    def test_reject_bad_endpoint_count_periodicity_controls_and_extraneous_mode(self):
        q, p = mb_geometry(-.558, 1.442), mb_geometry(-.050, .467)
        good = endpoints(q, p)
        cell = {'vectors': (np.eye(3)*10).tolist(), 'pbc': [True]*3}
        for patch in ({'images': [q.tolist()]}, {'images': good['images'] + [q.tolist()]},
                      {'cell': cell}, {'dsafir': {'delta': 0}}, {'dsafir': {'stepSize': -1}},
                      {'dsafir': {'threshold': float('nan')}}, {'dsafir': {'gamma': 2}},
                      {'mode': 'evaluate', 'dsafir': {}}, {'atomIds': ['H']*4}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                bridge.validate({**good, **patch}, 'tblite')
