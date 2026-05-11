from local_molsimplify_agent.config import AppConfig

def test_config_defaults():
    c=AppConfig()
    assert c.max_retries>=0
