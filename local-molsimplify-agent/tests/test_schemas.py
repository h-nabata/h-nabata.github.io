from local_molsimplify_agent.schemas import LigandSpec

def test_ligand_count_positive():
    x=LigandSpec(name="water",count=1)
    assert x.count==1
