from typer.testing import CliRunner
from local_molsimplify_agent.cli import app

runner=CliRunner()

def test_help():
    result=runner.invoke(app,["--help"])
    assert result.exit_code==0

def test_doctor():
    result=runner.invoke(app,["doctor"])
    assert result.exit_code==0
