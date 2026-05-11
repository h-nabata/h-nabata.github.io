from pathlib import Path
from local_molsimplify_agent.validation.geometry_checks import validate_structure

def evaluate_structure(path: Path):
    return validate_structure(path)
