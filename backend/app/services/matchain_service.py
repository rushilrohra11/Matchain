from __future__ import annotations

import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from matchain_colab_corrected import (
    get_dataset,
    load_all_models,
    matchain_pipeline,
    sha256_hash,
    structure_payload,
)
from app.services.jobs_store import JobsStore


class MatchainService:
    def __init__(self, database_path: Path | None = None) -> None:
        self.jobs_store = JobsStore(database_path) if database_path else JobsStore()
        self._dataset_cache: Optional[Any] = None
        self._models_cache: Optional[Dict[str, Any]] = None

    def _get_dataset(self, api_key: str | None = None):
        if self._dataset_cache is None:
            self._dataset_cache = get_dataset(api_key=api_key or os.getenv("MP_API_KEY"))
        return self._dataset_cache

    def _get_models(self, dataset_df):
        if self._models_cache is None:
            self._models_cache = load_all_models(dataset_df)
        return self._models_cache

    def create_job(self, payload: Dict[str, Any]) -> str:
        job_id = uuid.uuid4().hex
        now = time.time()
        self.jobs_store.create(job_id, payload, now)
        return job_id

    def get_job(self, job_id: str) -> Dict[str, Any]:
        job = self.jobs_store.get(job_id)
        if not job:
            raise KeyError(f"Unknown job id: {job_id}")
        return job

    def run_job(self, job_id: str, payload: Dict[str, Any]) -> None:
        now = time.time()
        self.jobs_store.update(job_id, now, status="running", progress=0.25, error=None)
        try:
            dataset_df = self._get_dataset(api_key=os.getenv("MP_API_KEY"))
            models = self._get_models(dataset_df)

            self.jobs_store.update(job_id, time.time(), progress=0.6)
            result, elapsed, diagnostics = matchain_pipeline(
                target_condition=payload["target_condition"],
                n_candidates=int(payload.get("n_candidates", 200)),
                tau=float(payload.get("tau", 0.15)),
                top_k=int(payload.get("top_k", 5)),
                models=models,
                dataset_df=dataset_df,
                relax=bool(payload.get("relax", False)),
                verbose=False,
            )
            candidate_rows = []
            for candidate in result:
                structure = candidate.get("structure")
                if structure is None:
                    continue
                serialized_structure = structure_payload(structure)
                candidate_rows.append({
                    **candidate,
                    "material_hash": f"0x{sha256_hash(serialized_structure)}",
                    "formula": structure.composition.reduced_formula,
                    "density": float(structure.density),
                    "structure_payload": serialized_structure,
                })
            output = {
                "results": candidate_rows,
                "elapsed": elapsed,
                "diagnostics": diagnostics,
                "model_availability": models.get("model_availability", {}),
                "model_evaluation": {
                    name: ({key: value.get(key) for key in ("r2", "mae", "rmse", "n_test")} if value else None)
                    for name, value in models.get("eval_results", {}).items()
                },
                "vae_history": {
                    "epochs": models.get("vae_history", {}).get("epochs", []),
                    "total_loss": models.get("vae_history", {}).get("total_loss", []),
                },
            }
            self.jobs_store.update(job_id, time.time(), status="completed", progress=1.0, result=output)
        except Exception as exc:  # Keep failures queryable across backend restarts.
            self.jobs_store.update(job_id, time.time(), status="failed", error=str(exc))

    def get_dashboard_stats(self) -> Dict[str, Any]:
        completed_jobs = self.jobs_store.all_completed()
        diagnostics = [(job.get("result") or {}).get("diagnostics", {}) for job in completed_jobs]
        return {
            "total_candidates_generated": sum(int(item.get("generated", 0)) for item in diagnostics),
            "structurally_valid_candidates": sum(int(item.get("geometry_valid", 0)) for item in diagnostics),
            "thermodynamically_accepted": sum(int(item.get("e_hull_passed", 0)) for item in diagnostics),
            "registered_materials": 0,
            "active_marketplace_listings": 0,
            "completed_licenses": 0,
            "recent_jobs": [
                {"id": job["job_id"], "status": job["status"], "created_at": job["created_at"]}
                for job in self.jobs_store.recent()
            ],
            "recent_transactions": [],
        }

    def get_analytics(self) -> Dict[str, Any]:
        recent_jobs = self.jobs_store.recent(limit=50)
        completed = next((job for job in recent_jobs if job["status"] == "completed" and job.get("result")), None)
        if completed is None:
            return {"job_id": None, "model_availability": {}, "model_evaluation": {}, "vae_history": {"epochs": [], "total_loss": []}}
        result = completed["result"]
        return {
            "job_id": completed["job_id"],
            "model_availability": result.get("model_availability", {}),
            "model_evaluation": result.get("model_evaluation", {}),
            "vae_history": result.get("vae_history", {"epochs": [], "total_loss": []}),
        }

    def get_materials(self) -> List[Dict[str, Any]]:
        from pymatgen.core import Structure

        material_rows: List[Dict[str, Any]] = []
        for job in self.jobs_store.all_completed():
            for result in (job.get("result") or {}).get("results", []) or []:
                structure = result.get("structure")
                if isinstance(structure, dict) and "__matchain_pymatgen_structure__" in structure:
                    structure = Structure.from_dict(structure["__matchain_pymatgen_structure__"])
                elif isinstance(structure, dict) and "lattice" in structure:
                    structure = Structure.from_dict(structure)
                if structure is None or not hasattr(structure, "composition"):
                    continue
                material_rows.append({
                    "id": result.get("material_hash", structure.composition.reduced_formula),
                    "material_hash": result.get("material_hash"),
                    "job_id": job["job_id"],
                    "formula": structure.composition.reduced_formula,
                    "composition": structure.composition.as_dict(),
                    "density": float(structure.density),
                    "e_hull": float(result.get("e_hull", 0.0)),
                    "predicted_formation_energy": float(result.get("predicted_formation_energy", 0.0)),
                    "consensus_spread": float(result.get("consensus_spread", 0.0)),
                    "model_predictions": result.get("model_predictions", {}),
                    "structure_payload": result.get("structure_payload"),
                    "status": "validated",
                })
        return material_rows
