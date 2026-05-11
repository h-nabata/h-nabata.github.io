from __future__ import annotations
import shutil, subprocess
from pathlib import Path
from local_molsimplify_agent.schemas import MoleculeBuildRequest, ToolResult

def detect_molsimplify_cli() -> str | None:
    for exe in ("molsimplify", "molsimplify-cli"):
        p = shutil.which(exe)
        if p:
            return p
    return None

def generate_with_molsimplify(req: MoleculeBuildRequest, run_dir: Path) -> ToolResult:
    cli = detect_molsimplify_cli()
    if not cli:
        return ToolResult(success=False, message="molSimplify CLI not found. Install molSimplify and ensure PATH is set.")
    if req.complex.geometry.lower() != "octahedral":
        return ToolResult(success=False, message="Only octahedral geometry is supported in MVP.")
    cmd=[cli, "--help"]
    probe=subprocess.run(cmd,capture_output=True,text=True)
    if probe.returncode != 0:
        return ToolResult(success=False, command=cmd, returncode=probe.returncode, stdout=probe.stdout, stderr=probe.stderr, workdir=str(run_dir), message="molSimplify exists but help probe failed")
    return ToolResult(success=False, command=cmd, returncode=0, stdout=probe.stdout, workdir=str(run_dir), message="TODO: map request to stable molSimplify CLI options safely")
