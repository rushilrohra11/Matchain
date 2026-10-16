from __future__ import annotations

import hashlib
import json
import os
import threading
from pathlib import Path
from typing import Any

import httpx

PROJECT_ROOT = Path(__file__).resolve().parents[3]
LOCAL_STORE_PATH = PROJECT_ROOT / "matchain_ipfs_store.json"
_local_store_lock = threading.Lock()


class StorageService:
    """Kubo-compatible IPFS JSON upload with an explicit local JSON fallback."""

    def __init__(self) -> None:
        self.api_url = os.getenv("IPFS_API_URL", "").rstrip("/")
        self.auth_header = os.getenv("IPFS_API_AUTH_HEADER", "")
        self.timeout = float(os.getenv("IPFS_TIMEOUT_SECONDS", "20"))

    @property
    def provider_configured(self) -> bool:
        return bool(self.api_url)

    def upload_json(self, content: dict[str, Any]) -> dict[str, str | bool]:
        serialized = json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        if self.provider_configured:
            endpoint = self.api_url
            if not endpoint.endswith("/api/v0"):
                endpoint = f"{endpoint}/api/v0"
            headers = {"Authorization": self.auth_header} if self.auth_header else {}
            try:
                response = httpx.post(
                    f"{endpoint}/add",
                    params={"pin": "true", "cid-version": "1"},
                    files={"file": ("matchain-metadata.json", serialized, "application/json")},
                    headers=headers,
                    timeout=self.timeout,
                )
                response.raise_for_status()
                result = response.json()
                cid = result.get("Hash") or result.get("Cid", {}).get("/")
                if not isinstance(cid, str) or not cid:
                    raise RuntimeError("IPFS provider response did not include a content identifier")
                return {"storage_reference": cid, "storage_backend": "ipfs", "is_ipfs": True}
            except Exception as exc:
                raise RuntimeError(f"Configured IPFS provider failed; local fallback is disabled for this request: {exc}") from exc

        digest = hashlib.sha256(serialized).hexdigest()
        with _local_store_lock:
            if LOCAL_STORE_PATH.exists():
                try:
                    store = json.loads(LOCAL_STORE_PATH.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    store = {}
            else:
                store = {}
            store[digest] = content
            temp_path = LOCAL_STORE_PATH.with_suffix(".json.tmp")
            temp_path.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
            temp_path.replace(LOCAL_STORE_PATH)
        return {
            "storage_reference": f"local-sha256:{digest}",
            "storage_backend": "local-json-fallback (not IPFS)",
            "is_ipfs": False,
        }
