import json
from pathlib import Path

import pytest
from pymatgen.core import Lattice, Structure

from app.services.jobs_store import JobsStore
from app.services.storage_service import StorageService


def test_jobs_survive_restart_and_running_jobs_are_marked_interrupted(tmp_path: Path):
    database = tmp_path / "jobs.sqlite3"
    first = JobsStore(database)
    first.create("done", {"target_condition": {"density": 3.0}}, 100.0)
    structure = Structure(Lattice.cubic(4), ["Si"], [[0, 0, 0]])
    first.update("done", 101.0, status="completed", progress=1.0, result={"results": [{"structure": structure}]})
    first.create("in-flight", {}, 102.0)
    first.update("in-flight", 103.0, status="running", progress=0.6)

    reopened = JobsStore(database)
    completed = reopened.get("done")
    interrupted = reopened.get("in-flight")
    assert completed is not None and completed["status"] == "completed"
    assert completed["result"]["results"][0]["structure"]["__matchain_pymatgen_structure__"]["@module"] == "pymatgen.core.structure"
    assert interrupted is not None and interrupted["status"] == "failed"
    assert "restarted" in interrupted["error"]


def test_discovery_service_persists_completed_results_and_material_views(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import app.services.matchain_service as service_module
    from app.services.matchain_service import MatchainService

    database = tmp_path / "service.sqlite3"
    service = MatchainService(database)
    structure = Structure(Lattice.cubic(4), ["Si"], [[0, 0, 0]])
    service._get_dataset = lambda api_key=None: object()
    service._get_models = lambda dataset: {"model_availability": {"xgboost": True}}
    monkeypatch.setattr(
        service_module,
        "matchain_pipeline",
        lambda **kwargs: ([{"structure": structure, "e_hull": 0.01, "consensus_spread": 0.02}], 0.5, {"generated": 4}),
    )
    job_id = service.create_job({"target_condition": {"density": 2.3}})
    service.run_job(job_id, {"target_condition": {"density": 2.3}, "n_candidates": 20})

    reopened = MatchainService(database)
    result = reopened.get_job(job_id)
    assert result["status"] == "completed"
    assert result["request"]["target_condition"]["density"] == 2.3
    assert reopened.get_materials()[0]["formula"] == "Si"
    assert reopened.get_materials()[0]["material_hash"].startswith("0x")
    assert reopened.get_materials()[0]["structure_payload"]["formula"] == "Si"


def test_storage_uses_explicit_local_json_fallback(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import app.services.storage_service as module

    target = tmp_path / "content.json"
    monkeypatch.setattr(module, "LOCAL_STORE_PATH", target)
    monkeypatch.setenv("IPFS_API_URL", "")
    result = StorageService().upload_json({"formula": "TiVAl"})
    stored = json.loads(target.read_text(encoding="utf-8"))
    assert result["is_ipfs"] is False
    assert result["storage_backend"] == "local-json-fallback (not IPFS)"
    assert result["storage_reference"].startswith("local-sha256:")
    assert stored[result["storage_reference"].split(":", 1)[1]] == {"formula": "TiVAl"}


def test_storage_uses_configured_ipfs_api(monkeypatch: pytest.MonkeyPatch):
    import app.services.storage_service as module

    class MockResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"Hash": "bafy-test-cid"}

    calls = {}

    def fake_post(url, **kwargs):
        calls["url"] = url
        calls["kwargs"] = kwargs
        return MockResponse()

    monkeypatch.setattr(module.httpx, "post", fake_post)
    monkeypatch.setenv("IPFS_API_URL", "http://ipfs.test:5001/api/v0")
    monkeypatch.setenv("IPFS_API_AUTH_HEADER", "Bearer test-token")
    result = StorageService().upload_json({"formula": "TiVAl"})
    assert result == {"storage_reference": "bafy-test-cid", "storage_backend": "ipfs", "is_ipfs": True}
    assert calls["url"] == "http://ipfs.test:5001/api/v0/add"
    assert calls["kwargs"]["headers"]["Authorization"] == "Bearer test-token"
