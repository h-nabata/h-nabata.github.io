from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Any, Literal

class LigandSpec(BaseModel):
    name: str
    count: int = Field(ge=1)

class BuildOptions(BaseModel):
    output_format: Literal["xyz", "mol2"] = "xyz"
    relax: bool = False
    max_retries: int = 1

class MetalComplexRequest(BaseModel):
    metal: str
    oxidation_state: int
    spin_state: str
    geometry: str
    ligands: list[LigandSpec]

class MoleculeBuildRequest(BaseModel):
    complex: MetalComplexRequest
    options: BuildOptions = BuildOptions()

class ToolResult(BaseModel):
    success: bool
    command: list[str] = []
    returncode: int = 0
    stdout: str = ""
    stderr: str = ""
    workdir: str = ""
    output_files: list[str] = []
    message: str = ""

class ValidationReport(BaseModel):
    valid: bool
    atom_count: int = 0
    issues: list[str] = []
    metadata: dict[str, Any] = {}

class AgentRunRecord(BaseModel):
    request_text: str
    attempts: int
    success: bool
    notes: list[str] = []
