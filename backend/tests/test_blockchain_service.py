from pathlib import Path
from typing import Any

import pytest
from app.services.blockchain_service import BlockchainService


class FakeFunction:
    def __init__(self, tx_hash: bytes):
        self.tx_hash = tx_hash
        self.transact_params: dict[str, Any] | None = None

    def transact(self, params: dict[str, Any]):
        self.transact_params = params
        return self.tx_hash


class FakeEvent:
    def process_receipt(self, receipt):
        return [{"event": "ListingPurchased", "args": {"buyer": "0x123", "price": 10}}]


class FakeReceipt(dict):
    __getattr__ = dict.__getitem__


def test_transaction_requires_configured_signer_and_successful_mined_receipt(monkeypatch: pytest.MonkeyPatch):
    service = BlockchainService.__new__(BlockchainService)
    service.web3 = type("FakeWeb3", (), {"is_connected": lambda _self: True, "to_checksum_address": lambda _self, value: value, "eth": type("Eth", (), {"chain_id": 1337, "accounts": ["0x0000000000000000000000000000000000000001"]})()})()
    service.account = "0x0000000000000000000000000000000000000001"
    service.deployment_matches = lambda: True
    service.web3.eth.wait_for_transaction_receipt = lambda _tx_hash: FakeReceipt(status=1, blockNumber=9, gasUsed=30000)
    function = FakeFunction(bytes.fromhex("11" * 32))
    result = service._send(function, value=42, event=lambda: FakeEvent())
    assert function.transact_params == {"from": service.account, "value": 42}
    assert result["receipt_status"] == 1
    assert result["block_number"] == 9
    assert result["events"][0]["name"] == "ListingPurchased"

    service.web3.eth.wait_for_transaction_receipt = lambda _tx_hash: FakeReceipt(status=0, blockNumber=10, gasUsed=21000)
    with pytest.raises(RuntimeError, match="failed on chain"):
        service._send(FakeFunction(bytes.fromhex("22" * 32)))


def test_deployment_manifest_detects_chain_reset_and_wrong_marketplace_link(monkeypatch: pytest.MonkeyPatch):
    import app.services.blockchain_service as module

    registry_address = "0x0000000000000000000000000000000000000001"
    marketplace_address = "0x0000000000000000000000000000000000000002"

    class Registry:
        address = registry_address

    class ContractFunction:
        def __init__(self, address):
            self.address = address

        def call(self):
            return self.address

    class MarketplaceFunctions:
        def __init__(self, address):
            self.address = address

        def registry(self):
            return ContractFunction(self.address)

    class Marketplace:
        address = marketplace_address
        functions = MarketplaceFunctions(registry_address)

    eth = type("Eth", (), {
        "chain_id": 1337,
        "get_code": lambda _self, _address: b"runtime",
    })()
    service = BlockchainService.__new__(BlockchainService)
    service.web3 = type("FakeWeb3", (), {"is_connected": lambda _self: True, "eth": eth})()
    service.deployment = {
        "chainId": 1337,
        "rpcUrl": "http://127.0.0.1:8545",
        "registry": registry_address,
        "marketplace": marketplace_address,
    }
    service.registry = Registry()
    service.marketplace = Marketplace()
    monkeypatch.setattr(module, "GANACHE_CHAIN_ID", 1337)
    monkeypatch.setattr(module, "GANACHE_RPC_URL", "http://127.0.0.1:8545")
    monkeypatch.setenv("CONTRACT_REGISTRY_ADDRESS", registry_address)
    monkeypatch.setenv("CONTRACT_MARKETPLACE_ADDRESS", marketplace_address)

    assert service.deployment_matches()
    eth.chain_id = 1
    assert not service.deployment_matches()
    eth.chain_id = 1337
    Marketplace.functions = MarketplaceFunctions("0x0000000000000000000000000000000000000003")
    assert not service.deployment_matches()


def test_contract_loader_checks_address_has_code_and_chain(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    artifact = tmp_path / "MatChainRegistry.sol" / "MatChainRegistry.json"
    artifact.parent.mkdir(parents=True)
    artifact.write_text('{"abi":[]}', encoding="utf-8")
    service = BlockchainService.__new__(BlockchainService)
    service.web3 = type("FakeWeb3", (), {"is_connected": lambda _self: True, "to_checksum_address": lambda _self, value: value, "eth": type("Eth", (), {"chain_id": 1337, "get_code": lambda _self, _address: b"runtime-code", "contract": lambda _self, **kwargs: kwargs})()})()
    monkeypatch.setattr("app.services.blockchain_service.ARTIFACTS", tmp_path)
    contract = service._load_contract("MatChainRegistry", "0x0000000000000000000000000000000000000001")
    assert contract is not None

    service.web3.eth.chain_id = 1
    assert service._load_contract("MatChainRegistry", "0x0000000000000000000000000000000000000001") is None
