from ase.io import read
from pathlib import Path

def read_atoms(path: Path):
    return read(path)
