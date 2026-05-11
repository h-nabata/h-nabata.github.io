from local_molsimplify_agent.schemas import MoleculeBuildRequest

def plan_from_structured(req: MoleculeBuildRequest) -> dict:
    return {"tool":"molsimplify","geometry":req.complex.geometry,"ligands":[l.model_dump() for l in req.complex.ligands]}
