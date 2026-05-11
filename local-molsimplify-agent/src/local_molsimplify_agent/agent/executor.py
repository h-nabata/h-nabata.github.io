from pathlib import Path
from local_molsimplify_agent.schemas import MoleculeBuildRequest, ToolResult
from local_molsimplify_agent.tools.molsimplify_tool import generate_with_molsimplify

def execute_plan(req: MoleculeBuildRequest, run_dir: Path) -> ToolResult:
    return generate_with_molsimplify(req, run_dir)
