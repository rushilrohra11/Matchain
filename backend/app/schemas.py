from typing import Any, Dict, Optional
from pydantic import BaseModel, Field


class TargetCondition(BaseModel):
    formation_energy_per_atom: float = Field(-1.5, ge=-10, le=5)
    band_gap: float = Field(0.0, ge=0, le=20)
    density: float = Field(5.0, ge=0.5, le=30)


class DiscoveryRequest(BaseModel):
    objective: str = "Lightweight alloy for aerospace application"
    target_condition: TargetCondition = TargetCondition()
    n_candidates: int = Field(200, ge=20, le=1000)
    tau: float = Field(0.15, ge=0.01, le=1.0)
    top_k: int = Field(5, ge=1, le=20)
    relax: bool = False


class DiscoveryJobStatus(BaseModel):
    job_id: str
    status: str
    created_at: float
    updated_at: float
    progress: Optional[float] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class ListingCreate(BaseModel):
    material_hash: str
    price: float = Field(1.5, gt=0)
    license_terms: str = "research-use"


class RegistryCreate(BaseModel):
    material_hash: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class StorageUpload(BaseModel):
    content: Dict[str, Any]


