from __future__ import annotations
import json, shutil
from pathlib import Path
import typer
from local_molsimplify_agent.config import AppConfig
from local_molsimplify_agent.io.files import create_run_dir
from local_molsimplify_agent.io.converters import load_request
from local_molsimplify_agent.validation.geometry_checks import validate_structure
from local_molsimplify_agent.agent.executor import execute_plan

app=typer.Typer()

@app.command()
def doctor() -> None:
    checks={k: bool(shutil.which(k)) for k in ["molsimplify","xtb","obabel","ollama"]}
    try:
        import ase  # noqa
        checks["ase_python"]=True
    except Exception:
        checks["ase_python"]=False
    typer.echo(json.dumps(checks,indent=2))

@app.command("generate")
def generate_cmd(input_file: Path) -> None:
    req=load_request(input_file)
    run=create_run_dir(AppConfig().outputs_dir)
    (run/"request.yaml").write_text(input_file.read_text())
    (run/"normalized_request.json").write_text(req.model_dump_json(indent=2))
    result=execute_plan(req,run)
    (run/"tool_result.json").write_text(result.model_dump_json(indent=2))
    typer.echo(result.message)

@app.command("validate")
def validate_cmd(structure: Path) -> None:
    rep=validate_structure(structure)
    typer.echo(rep.model_dump_json(indent=2))

@app.command("run-agent")
def run_agent(prompt: str) -> None:
    raise typer.Exit("LLM not configured. Use YAML/JSON mode or configure local LLM endpoint.")

@app.command("inspect-run")
def inspect_run(run_dir: Path) -> None:
    for p in sorted(run_dir.glob('*')):
        typer.echo(p.name)

@app.command("relax")
def relax(structure: Path, method: str="xtb") -> None:
    typer.echo(f"Relaxation adapter for {method} is not enabled in MVP.")

if __name__=="__main__":
    app()
