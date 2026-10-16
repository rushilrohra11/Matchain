const hre = require('hardhat');
const fs = require('node:fs');
const path = require('node:path');
const { BrowserProvider, ContractFactory, JsonRpcProvider } = require('ethers');

async function main() {
  const networkName = hre.network.name;
  const configuredNetwork = hre.config.networks[networkName];
  const rpcUrl = configuredNetwork?.url || process.env.GANACHE_RPC_URL || 'http://127.0.0.1:8545';
  const provider = networkName === 'hardhat'
    ? new BrowserProvider(hre.network.provider, 'any')
    : new JsonRpcProvider(rpcUrl, configuredNetwork?.chainId || 1337);
  const signer = await provider.getSigner(0);
  const registryArtifact = await hre.artifacts.readArtifact('MatChainRegistry');
  const marketplaceArtifact = await hre.artifacts.readArtifact('MatChainMarketplace');
  const registry = await new ContractFactory(registryArtifact.abi, registryArtifact.bytecode, signer).deploy();
  await registry.waitForDeployment();

  const marketplace = await new ContractFactory(marketplaceArtifact.abi, marketplaceArtifact.bytecode, signer)
    .deploy(await registry.getAddress());
  await marketplace.waitForDeployment();

  console.log('MatChainRegistry deployed to:', await registry.getAddress());
  console.log('MatChainMarketplace deployed to:', await marketplace.getAddress());

  const deploymentDirectory = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(deploymentDirectory, { recursive: true });
  const network = await provider.getNetwork();
  const deployment = {
    network: networkName,
    chainId: Number(network.chainId),
    rpcUrl,
    registry: await registry.getAddress(),
    marketplace: await marketplace.getAddress(),
  };
  fs.writeFileSync(path.join(deploymentDirectory, `${networkName}.json`), JSON.stringify(deployment, null, 2));
  const frontendContracts = path.join(__dirname, '..', '..', 'frontend', 'src', 'contracts');
  fs.mkdirSync(frontendContracts, { recursive: true });
  for (const contractName of ['MatChainRegistry', 'MatChainMarketplace']) {
    const artifact = contractName === 'MatChainRegistry' ? registryArtifact : marketplaceArtifact;
    const filename = contractName === 'MatChainRegistry' ? 'registryAbi.json' : 'marketplaceAbi.json';
    fs.writeFileSync(path.join(frontendContracts, filename), JSON.stringify(artifact.abi, null, 2));
  }

  if (networkName === 'localhost' || networkName === 'ganache') {
    const frontendEnv = path.join(__dirname, '..', '..', 'frontend', '.env.local');
    fs.writeFileSync(frontendEnv, [
      `VITE_CHAIN_ID=${deployment.chainId}`,
      `VITE_CHAIN_NAME=${networkName === 'ganache' ? 'Ganache Local' : 'Local EVM'}`,
      `VITE_GANACHE_RPC_URL=${deployment.rpcUrl}`,
      `VITE_CONTRACT_REGISTRY_ADDRESS=${deployment.registry}`,
      `VITE_CONTRACT_MARKETPLACE_ADDRESS=${deployment.marketplace}`,
      'VITE_API_URL=http://localhost:8000',
      '',
    ].join('\n'));
    console.log('Updated frontend/.env.local for the persistent local network. Restart Vite to load it.');
    if (network.chainId === 1337n) {
      const backendEnvPath = path.join(__dirname, '..', '..', '.env');
      let existingEnv = fs.existsSync(backendEnvPath) ? fs.readFileSync(backendEnvPath, 'utf8') : '';
      for (const [key, value] of Object.entries({
        GANACHE_RPC_URL: deployment.rpcUrl,
        GANACHE_CHAIN_ID: String(deployment.chainId),
        CONTRACT_REGISTRY_ADDRESS: deployment.registry,
        CONTRACT_MARKETPLACE_ADDRESS: deployment.marketplace,
      })) {
        const line = `${key}=${value}`;
        const expression = new RegExp(`^${key}=.*$`, 'm');
        existingEnv = expression.test(existingEnv) ? existingEnv.replace(expression, line) : `${existingEnv.trimEnd()}${existingEnv ? '\n' : ''}${line}\n`;
      }
      fs.writeFileSync(backendEnvPath, existingEnv);
      console.log('Updated .env with matching backend Ganache/contract settings. Restart the backend to reload them.');
    }
  } else {
    console.log(`Saved ${networkName} deployment only; it is not a persistent Ganache deployment.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
