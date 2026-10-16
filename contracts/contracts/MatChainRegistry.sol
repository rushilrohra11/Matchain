// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MatChainRegistry {
    struct Discovery {
        bytes32 fingerprint;
        address creator;
        uint256 blockNumber;
        string ipfsCid;
        string metadata;
        bool verified;
    }

    mapping(bytes32 => Discovery) public discoveries;
    bytes32[] public discoveryHashes;
    address public immutable owner;

    event DiscoveryRegistered(bytes32 indexed fingerprint, address indexed creator, uint256 blockNumber);
    event DiscoveryVerified(bytes32 indexed fingerprint, bool verified);

    constructor() {
        owner = msg.sender;
    }

    function registerDiscovery(bytes32 fingerprint, string memory ipfsCid, string memory metadata) external {
        require(discoveries[fingerprint].creator == address(0), 'Already registered');
        discoveries[fingerprint] = Discovery({
            fingerprint: fingerprint,
            creator: msg.sender,
            blockNumber: block.number,
            ipfsCid: ipfsCid,
            metadata: metadata,
            verified: false
        });
        discoveryHashes.push(fingerprint);
        emit DiscoveryRegistered(fingerprint, msg.sender, block.number);
    }

    function verifyDiscovery(bytes32 fingerprint) external {
        require(msg.sender == owner, 'Only owner');
        require(discoveries[fingerprint].creator != address(0), 'Unknown discovery');
        discoveries[fingerprint].verified = true;
        emit DiscoveryVerified(fingerprint, true);
    }

    function getDiscoveryCount() external view returns (uint256) {
        return discoveryHashes.length;
    }
}
