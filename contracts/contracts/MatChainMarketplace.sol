// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMatChainRegistry {
    function discoveries(bytes32 fingerprint)
        external
        view
        returns (bytes32, address, uint256, string memory, string memory, bool);
}

contract MatChainMarketplace {
    struct Listing {
        bytes32 materialHash;
        address seller;
        address buyer;
        uint256 price;
        string licenseTerms;
        bool sold;
    }

    IMatChainRegistry public immutable registry;
    mapping(bytes32 => Listing) public listings;
    bytes32[] public listingHashes;

    event ListingCreated(bytes32 indexed materialHash, address seller, uint256 price);
    event ListingPurchased(bytes32 indexed materialHash, address buyer, uint256 price);

    constructor(address registryAddress) {
        require(registryAddress != address(0), 'Invalid registry');
        registry = IMatChainRegistry(registryAddress);
    }

    function listMaterial(bytes32 materialHash, uint256 price, string memory licenseTerms) external {
        require(listings[materialHash].seller == address(0), 'Listing exists');
        (, address creator, , , , ) = registry.discoveries(materialHash);
        require(creator != address(0), 'Material not registered');
        require(creator == msg.sender, 'Only material creator');
        require(price > 0, 'Price must be positive');
        listings[materialHash] = Listing({
            materialHash: materialHash,
            seller: msg.sender,
            buyer: address(0),
            price: price,
            licenseTerms: licenseTerms,
            sold: false
        });
        listingHashes.push(materialHash);
        emit ListingCreated(materialHash, msg.sender, price);
    }

    function purchaseMaterial(bytes32 materialHash) external payable {
        Listing storage item = listings[materialHash];
        require(item.seller != address(0), 'No listing');
        require(!item.sold, 'Already sold');
        require(msg.value == item.price, 'Incorrect payment');

        item.sold = true;
        item.buyer = msg.sender;
        (bool paid, ) = payable(item.seller).call{value: item.price}("");
        require(paid, 'Payment failed');
        emit ListingPurchased(materialHash, msg.sender, item.price);
    }

    function getListingCount() external view returns (uint256) {
        return listingHashes.length;
    }
}
