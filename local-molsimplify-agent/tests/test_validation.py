from pathlib import Path
from local_molsimplify_agent.validation.geometry_checks import validate_structure

def test_validate_example_xyz():
    rep=validate_structure(Path("examples/example.xyz"))
    assert rep.atom_count==3
