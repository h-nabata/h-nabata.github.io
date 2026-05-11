from __future__ import annotations
import requests

class LLMError(RuntimeError):
    pass

class BaseLLMClient:
    def generate_json(self, prompt: str) -> dict:
        raise NotImplementedError

class OllamaClient(BaseLLMClient):
    def __init__(self, endpoint:str, model:str):
        self.endpoint=endpoint
        self.model=model
    def generate_json(self, prompt:str)->dict:
        if not self.model:
            raise LLMError("Model name is empty")
        r=requests.post(f"{self.endpoint}/api/generate",json={"model":self.model,"prompt":prompt,"format":"json","stream":False},timeout=30)
        r.raise_for_status()
        return r.json()

class MockLLMClient(BaseLLMClient):
    def __init__(self, payload:dict): self.payload=payload
    def generate_json(self,prompt:str)->dict: return self.payload
