from pathlib import Path
from datetime import date

def create_run_dir(base: Path) -> Path:
    base.mkdir(parents=True, exist_ok=True)
    i=1
    while True:
        p=base/f"{date.today().isoformat()}_run_{i:04d}"
        if not p.exists():
            p.mkdir()
            return p
        i+=1
