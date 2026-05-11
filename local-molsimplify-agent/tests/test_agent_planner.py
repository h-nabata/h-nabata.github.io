from local_molsimplify_agent.agent.planner import plan_from_structured
from local_molsimplify_agent.schemas import MoleculeBuildRequest

def test_plan():
    req=MoleculeBuildRequest.model_validate({"complex":{"metal":"Fe","oxidation_state":2,"spin_state":"high","geometry":"octahedral","ligands":[{"name":"water","count":6}]},"options":{"output_format":"xyz","relax":False}})
    p=plan_from_structured(req)
    assert p["tool"]=="molsimplify"
