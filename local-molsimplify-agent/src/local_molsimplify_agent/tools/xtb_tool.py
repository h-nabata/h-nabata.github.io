import shutil
from pathlib import Path
from local_molsimplify_agent.schemas import ToolResult

def relax_with_xtb(structure: Path, run_dir: Path) -> ToolResult:
    if not shutil.which("xtb"):
        return ToolResult(success=False, message="xTB is not installed")
    return ToolResult(success=False, message="xTB execution adapter TODO")
