from pydantic import BaseModel, Field
from pathlib import Path

class LLMConfig(BaseModel):
    enabled: bool = False
    backend: str = "ollama"
    endpoint: str = "http://localhost:11434"
    model: str = ""

class AppConfig(BaseModel):
    outputs_dir: Path = Path("outputs")
    max_retries: int = Field(default=1, ge=0, le=5)
    llm: LLMConfig = LLMConfig()
