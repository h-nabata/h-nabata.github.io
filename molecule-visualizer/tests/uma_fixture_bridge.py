"""Browser contract fixture, NOT a UMA model or a user-facing calculation engine.

The real HTTP service/worker/optimizer/ASE path runs with a deterministic fake
predictor. Kept outside production bridge.py; no production fake-engine switch.
"""
from types import SimpleNamespace
from test_uma import b, FakeCalculator


def packages(config):
    def predictor(*args, **kwargs):
        return SimpleNamespace(calls=[])
    return (SimpleNamespace(set_num_threads=lambda n: None), FakeCalculator,
            SimpleNamespace(get_predict_unit=predictor), SimpleNamespace)


b.uma_packages = packages
b.device_inventory = lambda torch: ([{'id':'cpu', 'label':'CPU'}], {})

if __name__ == '__main__':
    b.mp.freeze_support()
    b.main()
