from __future__ import annotations

import json
import os
from decimal import Decimal
from pathlib import Path
from typing import Any

from web3 import Web3

from app.config import GANACHE_CHAIN_ID, GANACHE_RPC_URL

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEPLOYMENT_FILE = PROJECT_ROOT / "contracts" / "deployments" / "localhost.json"
ARTIFACTS = PROJECT_ROOT / "contracts" / "artifacts" / "contracts"


class BlockchainService:
    """Client for the local MatChain registry and marketplace contracts."""

    def __init__(self) -> None:
        self.web3 = Web3(Web3.HTTPProvider(GANACHE_RPC_URL, request_kwargs={"timeout": 3}))
        deployment: dict[str, Any] = {}
        if DEPLOYMENT_FILE.exists():
            deployment = json.loads(DEPLOYMENT_FILE.read_text(encoding="utf-8"))
        self.deployment = deployment

        self.account = os.getenv("BLOCKCHAIN_ACCOUNT", "")

        self.registry = self._load_contract(
            "MatChainRegistry",
            os.getenv("CONTRACT_REGISTRY_ADDRESS", deployment.get("registry", "")),
        )
        self.marketplace = self._load_contract(
            "MatChainMarketplace",
            os.getenv("CONTRACT_MARKETPLACE_ADDRESS", deployment.get("marketplace", "")),
        )

    @property
    def available(self) -> bool:
        """Whether reads can reach the expected local chain."""
        try:
            return (
                self.web3.is_connected()
                and self.web3.eth.chain_id == GANACHE_CHAIN_ID
            )
        except Exception:
            return False

    @property
    def transactions_enabled(self) -> bool:
        if not self.deployment_matches() or not self.account:
            return False
        try:
            return self.web3.to_checksum_address(self.account) in self.web3.eth.accounts
        except Exception:
            return False

    def _load_contract(self, name: str, address: str):
        artifact_path = ARTIFACTS / f"{name}.sol" / f"{name}.json"
        if not address or not artifact_path.exists():
            return None
        
        if not self.web3.is_connected():
            print(f"Warning: Web3 is not connected to {GANACHE_RPC_URL}")
            return None
            
        if self.web3.eth.chain_id != GANACHE_CHAIN_ID:
            print(f"Warning: Connected to chain {self.web3.eth.chain_id}, expected {GANACHE_CHAIN_ID}")
            return None
            
        artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        checksum_address = Web3.to_checksum_address(address.strip())
        
        code = self.web3.eth.get_code(checksum_address)
        if not code or code == b'\x00' or code == '0x':
            print(f"Warning: No bytecode found for {name} at {checksum_address} on chain {GANACHE_CHAIN_ID}")
            return None
            
        return self.web3.eth.contract(address=checksum_address, abi=artifact["abi"])

    def deployment_matches(self) -> bool:
        try:
            if not self.available or not self.deployment:
                return False
            if int(self.deployment.get("chainId", -1)) != self.web3.eth.chain_id:
                return False
            if self.deployment.get("rpcUrl", "").rstrip("/") != GANACHE_RPC_URL.rstrip("/"):
                return False
            registry_address = os.getenv("CONTRACT_REGISTRY_ADDRESS", self.deployment.get("registry", ""))
            marketplace_address = os.getenv("CONTRACT_MARKETPLACE_ADDRESS", self.deployment.get("marketplace", ""))
            if registry_address.lower() != str(self.deployment.get("registry", "")).lower():
                return False
            if marketplace_address.lower() != str(self.deployment.get("marketplace", "")).lower():
                return False
            if self.registry is None or self.marketplace is None:
                return False
            if not self.web3.eth.get_code(self.registry.address) or not self.web3.eth.get_code(self.marketplace.address):
                return False
            linked_registry = self.marketplace.functions.registry().call()
            return linked_registry.lower() == self.registry.address.lower()
        except Exception:
            return False

    @staticmethod
    def fingerprint(value: str) -> bytes:
        if value.startswith("0x") and len(value) == 66:
            return bytes.fromhex(value[2:])
        return Web3.keccak(text=value)

    def _send(self, function, value: int = 0, event=None, validate_args=None):
        if not self.transactions_enabled:
            raise RuntimeError("Backend signing is disabled; configure an unlocked BLOCKCHAIN_ACCOUNT or sign from MetaMask")
        
        tx_hash = function.transact({"from": self.account, "value": value})
        receipt = self.web3.eth.wait_for_transaction_receipt(tx_hash)
        
        if receipt["status"] != 1:
            raise RuntimeError(f"Transaction {tx_hash.hex()} failed on chain")
            
        found_events = []
        if event:
            # process_receipt automatically filters by the event's contract address
            all_events = event().process_receipt(receipt)
            for item in all_events:
                args = {key: str(value) for key, value in item["args"].items()}
                if not validate_args or validate_args(item["args"]):
                    found_events.append({"name": item["event"], "args": args})
            
            if not found_events:
                raise RuntimeError(f"Transaction {tx_hash.hex()} mined, but the expected event was missing or invalid.")
        
        return {
            "transaction_hash": tx_hash.hex(),
            "block_number": receipt["blockNumber"],
            "receipt_status": receipt["status"],
            "gas_used": receipt["gasUsed"],
            "events": found_events,
        }

    def register_discovery(self, fingerprint: str, ipfs_cid: str, metadata: str) -> dict[str, Any]:
        if not self.deployment_matches() or self.registry is None:
            raise RuntimeError("Local blockchain contracts are not configured or reachable")
        
        digest = self.fingerprint(fingerprint)
        
        receipt = self._send(
            self.registry.functions.registerDiscovery(digest, ipfs_cid, metadata),
            event=self.registry.events.DiscoveryRegistered,
            validate_args=lambda args: args["fingerprint"] == digest
        )
        
        # Verify state
        record = self.registry.functions.discoveries(digest).call()
        if record[1] == "0x0000000000000000000000000000000000000000":
            raise RuntimeError(f"Transaction {receipt['transaction_hash']} mined, but registry record not found.")
            
        return {"fingerprint": Web3.to_hex(digest), **receipt}

    def verify_discovery(self, fingerprint: str) -> dict[str, Any]:
        if not self.deployment_matches() or self.registry is None:
            raise RuntimeError("Local blockchain contracts are not configured or reachable")
        
        digest = self.fingerprint(fingerprint)
        
        receipt = self._send(
            self.registry.functions.verifyDiscovery(digest),
            event=self.registry.events.DiscoveryVerified,
            validate_args=lambda args: args["fingerprint"] == digest
        )
        
        # Verify state
        record = self.registry.functions.discoveries(digest).call()
        if not record[5]: # verified boolean
            raise RuntimeError(f"Transaction {receipt['transaction_hash']} mined, but material remains unverified.")
            
        return {"fingerprint": Web3.to_hex(digest), **receipt}

    def get_registry(self) -> list[dict[str, Any]]:
        if not self.deployment_matches() or self.registry is None:
            raise RuntimeError("Local blockchain contracts are not configured or reachable")
        count = self.registry.functions.getDiscoveryCount().call()
        entries = []
        for index in range(count):
            digest = self.registry.functions.discoveryHashes(index).call()
            record = self.registry.functions.discoveries(digest).call()
            entries.append({
                "fingerprint": Web3.to_hex(digest),
                "creator": record[1],
                "block_number": record[2],
                "ipfs_cid": record[3],
                "metadata": record[4],
                "verified": record[5],
            })
        return entries

    def create_listing(self, material_hash: str, price: float, license_terms: str) -> dict[str, Any]:
        if not self.deployment_matches() or self.marketplace is None:
            raise RuntimeError("Local blockchain contracts are not configured or reachable")
        
        digest = self.fingerprint(material_hash)
        wei_price = self.web3.to_wei(Decimal(str(price)), "ether")
        
        receipt = self._send(
            self.marketplace.functions.listMaterial(digest, wei_price, license_terms),
            event=self.marketplace.events.ListingCreated,
            validate_args=lambda args: args["materialHash"] == digest
        )
        
        # Verify state
        listing = self.marketplace.functions.listings(digest).call()
        if listing[1] == "0x0000000000000000000000000000000000000000" or listing[5]: # seller empty or already sold
             raise RuntimeError(f"Transaction {receipt['transaction_hash']} mined, but listing state is invalid.")
             
        return {"material_hash": Web3.to_hex(digest), "price_wei": wei_price, "license": license_terms, **receipt}

    def get_marketplace(self) -> list[dict[str, Any]]:
        if not self.deployment_matches() or self.marketplace is None:
            raise RuntimeError("Local blockchain contracts are not configured or reachable")
        count = self.marketplace.functions.getListingCount().call()
        listings = []
        for index in range(count):
            digest = self.marketplace.functions.listingHashes(index).call()
            record = self.marketplace.functions.listings(digest).call()
            listings.append({
                "material_hash": Web3.to_hex(digest),
                "seller": record[1],
                "buyer": record[2],
                "price_wei": record[3],
                "price_eth": str(self.web3.from_wei(record[3], "ether")),
                "license": record[4],
                "sold": record[5],
            })
        return listings

    def purchase_listing(self, material_hash: str) -> dict[str, Any]:
        if not self.deployment_matches() or self.marketplace is None:
            raise RuntimeError("Local blockchain contracts are not configured or reachable")
        
        digest = self.fingerprint(material_hash)
        record = self.marketplace.functions.listings(digest).call()
        
        receipt = self._send(
            self.marketplace.functions.purchaseMaterial(digest),
            value=record[3],
            event=self.marketplace.events.ListingPurchased,
            validate_args=lambda args: args["materialHash"] == digest
        )
        
        # Verify state
        updated_listing = self.marketplace.functions.listings(digest).call()
        if not updated_listing[5]: # sold boolean
            raise RuntimeError(f"Transaction {receipt['transaction_hash']} mined, but listing is not marked as sold.")
            
        return {"material_hash": Web3.to_hex(digest), "price_wei": record[3], **receipt}

    def get_recent_events(self, limit: int = 10) -> list[dict[str, Any]]:
        if not self.deployment_matches():
            return []
        latest = self.web3.eth.block_number
        start = max(0, latest - 20_000)
        output: list[dict[str, Any]] = []
        event_specs = [
            (self.registry, "DiscoveryRegistered", "registration"),
            (self.registry, "DiscoveryVerified", "verification"),
            (self.marketplace, "ListingCreated", "listing"),
            (self.marketplace, "ListingPurchased", "purchase"),
        ]
        for contract, name, event_type in event_specs:
            if contract is None:
                continue
            try:
                logs = getattr(contract.events, name)().get_logs(from_block=start, to_block=latest)
                for log in logs:
                    output.append({
                        "hash": log["transactionHash"].hex(),
                        "type": event_type,
                        "status": "confirmed",
                        "block_number": log["blockNumber"],
                    })
            except Exception:
                continue
        return sorted(output, key=lambda item: item["block_number"], reverse=True)[:limit]
