const fs = require('node:fs');
const path = require('node:path');
const { Contract, Interface, JsonRpcProvider, id, parseEther } = require('ethers');

async function main() {
  const deploymentPath = path.join(__dirname, '..', 'deployments', 'localhost.json');
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  const frontendEnv = Object.fromEntries(
    fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', '.env.local'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  if (Number(frontendEnv.VITE_CHAIN_ID) !== deployment.chainId) throw new Error('Frontend chain ID does not match the deployment manifest');
  if (frontendEnv.VITE_GANACHE_RPC_URL !== deployment.rpcUrl) throw new Error('Frontend RPC URL does not match the deployment manifest');
  if (frontendEnv.VITE_CONTRACT_REGISTRY_ADDRESS?.toLowerCase() !== deployment.registry.toLowerCase()) throw new Error('Frontend registry address does not match the deployment manifest');
  if (frontendEnv.VITE_CONTRACT_MARKETPLACE_ADDRESS?.toLowerCase() !== deployment.marketplace.toLowerCase()) throw new Error('Frontend marketplace address does not match the deployment manifest');
  const provider = new JsonRpcProvider(deployment.rpcUrl, deployment.chainId);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== deployment.chainId) throw new Error('RPC chain ID does not match deployment manifest');

  const [seller, buyer] = await Promise.all([provider.getSigner(0), provider.getSigner(1)]);
  const [sellerAddress, buyerAddress] = await Promise.all([seller.getAddress(), buyer.getAddress()]);
  const registryArtifact = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'artifacts', 'contracts', 'MatChainRegistry.sol', 'MatChainRegistry.json'), 'utf8'));
  const marketplaceArtifact = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'artifacts', 'contracts', 'MatChainMarketplace.sol', 'MatChainMarketplace.json'), 'utf8'));
  const registryFrontendAbi = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'contracts', 'registryAbi.json'), 'utf8'));
  const marketplaceFrontendAbi = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'contracts', 'marketplaceAbi.json'), 'utf8'));
  if (JSON.stringify(registryFrontendAbi) !== JSON.stringify(registryArtifact.abi)) throw new Error('Frontend registry ABI is not the ABI from the deployed build artifact');
  if (JSON.stringify(marketplaceFrontendAbi) !== JSON.stringify(marketplaceArtifact.abi)) throw new Error('Frontend marketplace ABI is not the ABI from the deployed build artifact');
  const registry = new Contract(deployment.registry, registryFrontendAbi, seller);
  const marketplace = new Contract(deployment.marketplace, marketplaceFrontendAbi, seller);
  const registryInterface = new Interface(registryFrontendAbi);
  const marketplaceInterface = new Interface(marketplaceFrontendAbi);

  const materialFingerprint = id(`ganache-e2e-${Date.now()}`);
  const registrationTx = await registry.registerDiscovery(materialFingerprint, 'local-sha256:e2e', '{"formula":"TiVAl"}');
  const registrationReceipt = await registrationTx.wait();
  if (registrationReceipt.status !== 1 || registrationReceipt.from.toLowerCase() !== sellerAddress.toLowerCase()) throw new Error('Registry transaction receipt was not successful or used an unexpected account');
  const registrationEvent = registrationReceipt.logs.map((log) => { try { return registryInterface.parseLog(log); } catch { return null; } }).find((event) => event?.name === 'DiscoveryRegistered');
  const registryRecord = await registry.discoveries(materialFingerprint);
  if (!registrationEvent || registryRecord.creator.toLowerCase() !== sellerAddress.toLowerCase()) throw new Error('Registry state/event did not match submitted transaction');

  const listingHash = materialFingerprint;
  const price = parseEther('0.01');
  const listingTx = await marketplace.listMaterial(listingHash, price, 'e2e-research');
  const listingReceipt = await listingTx.wait();
  const listingEvent = listingReceipt.logs.map((log) => { try { return marketplaceInterface.parseLog(log); } catch { return null; } }).find((event) => event?.name === 'ListingCreated');
  if (listingReceipt.status !== 1 || !listingEvent) throw new Error('Marketplace listing receipt/event validation failed');

  const sellerBalanceBefore = BigInt(await provider.send('eth_getBalance', [sellerAddress, 'latest']));
  const buyerContract = marketplace.connect(buyer);
  const purchaseTx = await buyerContract.purchaseMaterial(listingHash, { value: price });
  const purchaseReceipt = await purchaseTx.wait();
  const purchaseEvent = purchaseReceipt.logs.map((log) => { try { return marketplaceInterface.parseLog(log); } catch { return null; } }).find((event) => event?.name === 'ListingPurchased');
  const sellerBalanceAfter = BigInt(await provider.send('eth_getBalance', [sellerAddress, 'latest']));
  const listingRecord = await marketplace.listings(listingHash);
  if (purchaseReceipt.status !== 1 || purchaseReceipt.from.toLowerCase() !== buyerAddress.toLowerCase()) throw new Error('Purchase was not mined from the second development account');
  if (!purchaseEvent || !listingRecord.sold || listingRecord.buyer.toLowerCase() !== buyerAddress.toLowerCase() || sellerBalanceAfter !== sellerBalanceBefore + price) {
    throw new Error(`Purchase verification mismatch (event=${Boolean(purchaseEvent)}, sold=${listingRecord.sold}, sellerDelta=${sellerBalanceAfter - sellerBalanceBefore}, expected=${price})`);
  }

  console.log(JSON.stringify({
    network: deployment.network,
    chainId: Number(network.chainId),
    registry: deployment.registry,
    marketplace: deployment.marketplace,
    seller: sellerAddress,
    buyer: buyerAddress,
    registration: { hash: registrationReceipt.hash, block: registrationReceipt.blockNumber, event: registrationEvent.name },
    listing: { hash: listingReceipt.hash, block: listingReceipt.blockNumber, event: listingEvent.name },
    purchase: { hash: purchaseReceipt.hash, block: purchaseReceipt.blockNumber, from: purchaseReceipt.from, buyer: listingRecord.buyer, licenceTerms: listingRecord.licenseTerms, event: purchaseEvent.name, sellerPaid: true, listingSold: listingRecord.sold },
  }, null, 2));
  await provider.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
