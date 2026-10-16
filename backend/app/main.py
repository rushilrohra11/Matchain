import asyncio
import json
from typing import Any, Dict

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.config import DATABASE_PATH, FRONTEND_URL, MP_API_KEY
from app.schemas import DiscoveryRequest, ListingCreate, RegistryCreate, StorageUpload
from app.services.blockchain_service import BlockchainService
from app.services.matchain_service import MatchainService
from app.services.storage_service import StorageService

app = FastAPI(title="MatChain API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(dict.fromkeys([FRONTEND_URL, "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"])),
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
service = MatchainService(database_path=DATABASE_PATH)
blockchain = BlockchainService()
storage = StorageService()


@app.get("/api/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "MatChain",
        "version": "0.1.0",
        "blockchain": "connected" if blockchain.available else "unavailable",
        "chain_id": blockchain.web3.eth.chain_id if blockchain.available else None,
        "registry_contract": blockchain.registry.address if blockchain.deployment_matches() and blockchain.registry else None,
        "marketplace_contract": blockchain.marketplace.address if blockchain.deployment_matches() and blockchain.marketplace else None,
        "backend_signing_enabled": blockchain.transactions_enabled,
        "deployment_matches": blockchain.deployment_matches(),
        "storage_backend": "ipfs" if storage.provider_configured else "local-json-fallback (not IPFS)",
        "materials_project_configured": bool(MP_API_KEY),
    }


@app.get("/api/dashboard/stats")
def dashboard_stats() -> Dict[str, Any]:
    stats = service.get_dashboard_stats()
    stats["recent_transactions"] = blockchain.get_recent_events()
    if blockchain.deployment_matches() and blockchain.registry is not None:
        stats["registered_materials"] = len(blockchain.get_registry())
    if blockchain.deployment_matches() and blockchain.marketplace is not None:
        listings = blockchain.get_marketplace()
        stats["active_marketplace_listings"] = sum(not item["sold"] for item in listings)
        stats["completed_licenses"] = sum(item["sold"] for item in listings)
    return stats


@app.get("/api/analytics")
def analytics() -> Dict[str, Any]:
    return service.get_analytics()


@app.post("/api/discovery/generate")
async def generate_discovery(payload: DiscoveryRequest):
    payload_data = payload.model_dump(mode="json")
    job_id = service.create_job(payload_data)
    asyncio.create_task(asyncio.to_thread(service.run_job, job_id, payload_data))
    return {"job_id": job_id, "status": "queued"}


@app.get("/api/discovery/jobs/{job_id}")
def get_job(job_id: str):
    try:
        return service.get_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/materials")
def get_materials() -> list[dict[str, Any]]:
    return service.get_materials()


@app.get("/api/materials/{material_id}")
def get_material(material_id: str):
    for material in service.get_materials():
        if material["id"] == material_id:
            return material
    raise HTTPException(status_code=404, detail="Material not found")


@app.get("/api/registry")
def get_registry():
    if not blockchain.deployment_matches() or blockchain.registry is None:
        raise HTTPException(status_code=503, detail="Registry contract is not available on the configured local chain")
    return blockchain.get_registry()


@app.post("/api/storage/upload")
def upload_storage(payload: StorageUpload):
    try:
        return storage.upload_json(payload.content)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Storage upload failed: {exc}") from exc


@app.post("/api/registry")
def register_discovery(payload: RegistryCreate):
    if not blockchain.deployment_matches() or not blockchain.transactions_enabled or blockchain.registry is None:
        raise HTTPException(status_code=503, detail="A configured unlocked backend account and deployed registry are required; otherwise sign this transaction using MetaMask")
    try:
        stored = storage.upload_json({"metadata": payload.metadata, "material_hash": payload.material_hash})
        result = blockchain.register_discovery(
            payload.material_hash,
            stored["storage_reference"],
            json.dumps(payload.metadata, sort_keys=True),
        )
        return {**result, "storage_backend": stored["storage_backend"], "is_ipfs": stored["is_ipfs"]}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/marketplace/listings")
def get_marketplace_listings():
    if not blockchain.deployment_matches() or blockchain.marketplace is None:
        raise HTTPException(status_code=503, detail="Marketplace contract is not available on the configured local chain")
    return blockchain.get_marketplace()


@app.post("/api/marketplace/listings")
def create_listing(payload: ListingCreate):
    if not blockchain.deployment_matches() or not blockchain.transactions_enabled or blockchain.marketplace is None:
        raise HTTPException(status_code=503, detail="A configured unlocked backend account and deployed marketplace are required; otherwise use MetaMask")
    try:
        return blockchain.create_listing(payload.material_hash, payload.price, payload.license_terms)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/marketplace/listings/{listing_id}/purchase")
def purchase_listing(listing_id: str):
    if not blockchain.deployment_matches() or not blockchain.transactions_enabled or blockchain.marketplace is None:
        raise HTTPException(status_code=503, detail="A configured unlocked backend account and deployed marketplace are required; otherwise use MetaMask")
    try:
        return blockchain.purchase_listing(listing_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/users/me/materials")
def my_materials(wallet_address: str = Query(..., description="Wallet address to match against public registry creator records")):
    if not blockchain.deployment_matches():
        raise HTTPException(status_code=503, detail="Registry contract is not available on the configured deployment")
    try:
        address = blockchain.web3.to_checksum_address(wallet_address)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Invalid wallet address") from exc
    return [item for item in blockchain.get_registry() if item["creator"].lower() == address.lower()]


@app.get("/api/users/me/licenses")
def my_licenses(wallet_address: str = Query(..., description="Wallet address to match against public marketplace buyer records")):
    if not blockchain.deployment_matches():
        raise HTTPException(status_code=503, detail="Marketplace contract is not available on the configured deployment")
    try:
        address = blockchain.web3.to_checksum_address(wallet_address)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Invalid wallet address") from exc
    return [
        item for item in blockchain.get_marketplace()
        if item["sold"] and item["buyer"].lower() == address.lower()
    ]


@app.get("/")
def root() -> Dict[str, str]:
    return {"message": "MatChain API running"}
