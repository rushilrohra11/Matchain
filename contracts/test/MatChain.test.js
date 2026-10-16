const assert = require('node:assert/strict');
const hre = require('hardhat');
const { BrowserProvider, ContractFactory, Interface, id, parseEther } = require('ethers');

async function deploy(name, signer, ...args) {
  const artifact = await hre.artifacts.readArtifact(name);
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

function decodeEvent(receipt, abi, name) {
  const contractInterface = new Interface(abi);
  for (const log of receipt.logs) {
    try {
      const parsed = contractInterface.parseLog(log);
      if (parsed?.name === name) return parsed;
    } catch {
      // Ignore logs not emitted by this contract interface.
    }
  }
  return null;
}

async function expectRevert(promise, message) {
  let error;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, `Expected transaction to revert with ${message}`);
  assert.match(error.message, new RegExp(message));
}

describe('MatChain local registry and marketplace', function () {
  async function deployFixture() {
    const provider = new BrowserProvider(hre.network.provider, 'any');
    const [owner, seller, buyer, other] = await Promise.all([0, 1, 2, 3].map((index) => provider.getSigner(index)));
    const [ownerAddress, sellerAddress, buyerAddress, otherAddress] = await Promise.all([
      owner.getAddress(), seller.getAddress(), buyer.getAddress(), other.getAddress(),
    ]);
    const registry = await deploy('MatChainRegistry', owner);
    const marketplace = await deploy('MatChainMarketplace', seller, await registry.getAddress());
    return {
      provider,
      owner,
      seller,
      buyer,
      other,
      ownerAddress,
      sellerAddress,
      buyerAddress,
      otherAddress,
      registry,
      marketplace,
    };
  }

  it('registers material, records provenance and emits a transaction event', async function () {
    const { ownerAddress, registry } = await deployFixture();
    const artifact = await hre.artifacts.readArtifact('MatChainRegistry');
    const fingerprint = id('TiVAl-fixture');
    const tx = await registry.registerDiscovery(fingerprint, 'local-sha256:abc', '{"formula":"TiVAl"}');
    const receipt = await tx.wait();
    assert.equal(receipt.status, 1);
    const event = decodeEvent(receipt, artifact.abi, 'DiscoveryRegistered');
    assert.ok(event);
    assert.equal(event.args.fingerprint, fingerprint);
    assert.equal(event.args.creator, ownerAddress);
    const record = await registry.discoveries(fingerprint);
    assert.equal(record.creator, ownerAddress);
    assert.equal(record.ipfsCid, 'local-sha256:abc');
    assert.equal(await registry.getDiscoveryCount(), 1n);
  });

  it('restricts verification to the registry deployer', async function () {
    const { owner, other, registry } = await deployFixture();
    const fingerprint = id('verified-fixture');
    await (await registry.registerDiscovery(fingerprint, '', '{}')).wait();
    await expectRevert(registry.connect(other).verifyDiscovery(fingerprint), 'Only owner');
    const receipt = await (await registry.connect(owner).verifyDiscovery(fingerprint)).wait();
    assert.equal(receipt.status, 1);
    assert.equal(decodeEvent(receipt, await hre.artifacts.readArtifact('MatChainRegistry').then((item) => item.abi), 'DiscoveryVerified')?.args.verified, true);
    assert.equal((await registry.discoveries(fingerprint)).verified, true);
  });

  it('creates a listing and settles exact payment to the seller', async function () {
    const { provider, seller, buyer, sellerAddress, buyerAddress, registry, marketplace } = await deployFixture();
    const artifact = await hre.artifacts.readArtifact('MatChainMarketplace');
    const fingerprint = id('market-fixture');
    await (await registry.connect(seller).registerDiscovery(fingerprint, '', '{"formula":"TiVAl"}')).wait();
    const price = parseEther('0.01');
    const listReceipt = await (await marketplace.listMaterial(fingerprint, price, 'research-use')).wait();
    assert.equal(listReceipt.status, 1);
    assert.equal(decodeEvent(listReceipt, artifact.abi, 'ListingCreated')?.args.seller, sellerAddress);

    const before = BigInt(await provider.send('eth_getBalance', [sellerAddress, 'latest']));
    const purchaseReceipt = await (await marketplace.connect(buyer).purchaseMaterial(fingerprint, { value: price })).wait();
    assert.equal(purchaseReceipt.status, 1);
    const purchaseEvent = decodeEvent(purchaseReceipt, artifact.abi, 'ListingPurchased');
    assert.ok(purchaseEvent);
    assert.equal(purchaseEvent.args.buyer, buyerAddress);
    const after = BigInt(await provider.send('eth_getBalance', [sellerAddress, 'latest']));
    assert.equal(after, before + price);
    const storedListing = await marketplace.listings(fingerprint);
    assert.equal(storedListing.sold, true);
    assert.equal(storedListing.buyer, buyerAddress);
    assert.equal(storedListing.licenseTerms, 'research-use');
  });

  it('rejects incorrect payment and repeat purchases', async function () {
    const { seller, buyer, registry, marketplace } = await deployFixture();
    const fingerprint = id('guard-fixture');
    const price = parseEther('0.01');
    await (await registry.connect(seller).registerDiscovery(fingerprint, '', '{}')).wait();
    await (await marketplace.connect(seller).listMaterial(fingerprint, price, 'research-use')).wait();
    await expectRevert(marketplace.connect(buyer).purchaseMaterial(fingerprint, { value: price - 1n }), 'Incorrect payment');
    await (await marketplace.connect(buyer).purchaseMaterial(fingerprint, { value: price })).wait();
    await expectRevert(marketplace.connect(buyer).purchaseMaterial(fingerprint, { value: price }), 'Already sold');
  });

  it('rejects listings for unregistered materials and zero prices', async function () {
    const { seller, registry, marketplace } = await deployFixture();
    const fingerprint = id('unregistered-fixture');
    await expectRevert(marketplace.connect(seller).listMaterial(fingerprint, parseEther('0.01'), 'research-use'), 'Material not registered');
    await (await registry.connect(seller).registerDiscovery(fingerprint, '', '{}')).wait();
    await expectRevert(marketplace.connect(seller).listMaterial(fingerprint, 0n, 'research-use'), 'Price must be positive');
  });

  it('only allows the registered material creator to list it', async function () {
    const { seller, buyer, registry, marketplace } = await deployFixture();
    const fingerprint = id('creator-authorization-fixture');
    await (await registry.connect(seller).registerDiscovery(fingerprint, '', '{}')).wait();
    await expectRevert(marketplace.connect(buyer).listMaterial(fingerprint, parseEther('0.01'), 'research-use'), 'Only material creator');
    await (await marketplace.connect(seller).listMaterial(fingerprint, parseEther('0.01'), 'research-use')).wait();
  });
});
