import numpy as np
from pathlib import Path
from ase.io import read
from local_molsimplify_agent.schemas import ValidationReport

def validate_structure(path: Path, expected_elements: list[str] | None = None) -> ValidationReport:
    issues=[]
    try: atoms=read(path)
    except Exception as e: return ValidationReport(valid=False, issues=[f"read_error:{e}"])
    n=len(atoms)
    if n==0: issues.append("zero_atoms")
    if n>1:
        d=atoms.get_all_distances(mic=False)
        d=d[np.triu_indices(n,1)]
        if len(d) and float(d.min())<0.5: issues.append("very_short_distance")
    syms=set(atoms.get_chemical_symbols())
    if expected_elements:
        for e in expected_elements:
            if e not in syms: issues.append(f"missing_element:{e}")
    return ValidationReport(valid=not issues, atom_count=n, issues=issues, metadata={"elements":sorted(syms)})
