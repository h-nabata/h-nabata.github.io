import yaml
from pathlib import Path
from local_molsimplify_agent.schemas import MoleculeBuildRequest

def load_request(path: Path) -> MoleculeBuildRequest:
    data=yaml.safe_load(path.read_text())
    if "complex" not in data:
        data={"complex": {k:v for k,v in data.items() if k not in ["output_format","relax"]}, "options": {"output_format": data.get("output_format","xyz"),"relax":data.get("relax",False)}}
    return MoleculeBuildRequest.model_validate(data)
