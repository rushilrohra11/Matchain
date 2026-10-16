
import {
  Contract,
  formatEther,
  getAddress,
  isAddress,
  JsonRpcProvider,
  isHexString,
  keccak256,
  parseEther,
  toUtf8Bytes,
  type InterfaceAbi,
  type Provider,
  type Signer,
} from 'ethers';

import registryAbiJson from '../contracts/registryAbi.json';
import marketplaceAbiJson from '../contracts/marketplaceAbi.json';
import { verifyTransaction } from './transactionService';

const registryAbi = registryAbiJson as InterfaceAbi;
const marketplaceAbi = marketplaceAbiJson as InterfaceAbi;

export const networkConfig = {
  chainId: Number(import.meta.env.VITE_CHAIN_ID || 1337),
  rpcUrl:
    import.meta.env.VITE_GANACHE_RPC_URL ||
    'http://127.0.0.1:8545',
  chainName: import.meta.env.VITE_CHAIN_NAME || 'Ganache Local',
  registryAddress: (
    import.meta.env.VITE_CONTRACT_REGISTRY_ADDRESS || ''
  ).trim(),
  marketplaceAddress: (
    import.meta.env.VITE_CONTRACT_MARKETPLACE_ADDRESS || ''
  ).trim(),
};

export const registryConfigured = Boolean(
  networkConfig.registryAddress,
);

export const marketplaceConfigured = Boolean(
  networkConfig.marketplaceAddress,
);

export const walletConfigured =
  registryConfigured && marketplaceConfigured;

export function fingerprintOf(value: string): string {
  return isHexString(value, 32)
    ? value
    : keccak256(toUtf8Bytes(value));
}

/**
 * Creates a read-only JSON-RPC provider for the configured Ganache node.
 * Wallet transactions should still use the user's signer.
 */
export function createRpcProvider(): JsonRpcProvider {
  return new JsonRpcProvider(
    networkConfig.rpcUrl,
    networkConfig.chainId,
  );
}

/**
 * Validates the contract against the provider actually supplied by the
 * caller. Logs diagnostics to help distinguish a wrong provider from a
 * missing deployment.
 */
async function assertContract(
  provider: Provider,
  address: string,
  name: string,
): Promise<void> {
  const trimmedAddress = (address || '').trim();

  if (!trimmedAddress || !isAddress(trimmedAddress)) {
    throw new Error(
      `Invalid ${name} address: "${address}". ` +
        `Check VITE_CONTRACT_${name.toUpperCase()}_ADDRESS in .env.local.`,
    );
  }

  const checksumAddress = getAddress(trimmedAddress);

  let network;
  try {
    network = await provider.getNetwork();
  } catch (error) {
    console.error(`[MatChain] Cannot read provider network for ${name}`, {
      providerType: provider.constructor?.name,
      configuredRpcUrl: networkConfig.rpcUrl,
      configuredChainId: networkConfig.chainId,
      address: checksumAddress,
      error,
    });

    throw new Error(
      `Cannot connect to the blockchain while checking ${name}. ` +
        `Check that Ganache is running and the wallet is connected.`,
    );
  }

  let blockNumber = -1;
  let code = '';

  try {
    blockNumber = await provider.getBlockNumber();
    code = await provider.getCode(checksumAddress);
  } catch (error) {
    console.error(`[MatChain] Contract lookup failed for ${name}`, {
      providerType: provider.constructor?.name,
      configuredRpcUrl: networkConfig.rpcUrl,
      configuredChainId: networkConfig.chainId,
      actualChainId: network.chainId.toString(),
      address: checksumAddress,
      blockNumber,
      error,
    });

    throw new Error(
      `Unable to check ${name} bytecode at ${checksumAddress}. ` +
        `Check the provider connection and retry.`,
    );
  }

  // Diagnostic logging: inspect the provider used by this exact operation.
  console.info(`[MatChain] Contract diagnostic: ${name}`, {
    providerType: provider.constructor?.name ?? 'unknown',
    configuredRpcUrl: networkConfig.rpcUrl,
    configuredChainId: networkConfig.chainId,
    actualChainId: network.chainId.toString(),
    blockNumber,
    address: checksumAddress,
    bytecodeLength: code.length,
    bytecodePrefix: code.slice(0, 18),
    hasBytecode: code !== '0x' && code.length > 2,
  });

  if (network.chainId !== BigInt(networkConfig.chainId)) {
    throw new Error(
      `Connected to chain ${network.chainId}, but MatChain expects ` +
        `${networkConfig.chainId}. Check your MetaMask network settings.`,
    );
  }

  if (!code || code === '0x' || code === '0x0' || code.length <= 2) {
    throw new Error(
      `No ${name} bytecode at ${checksumAddress} ` +
        `(chain ${network.chainId}, block ${blockNumber}). ` +
        `Provider: ${provider.constructor?.name ?? 'unknown'}. ` +
        `Configured RPC: ${networkConfig.rpcUrl}. ` +
        `Check whether this provider is connected to the Ganache instance ` +
        `where the contracts were deployed. See the browser console for diagnostics.`,
    );
  }
}

/**
 * Reads all registered materials.
 */
export async function readRegistry(provider: Provider) {
  if (!registryConfigured) {
    throw new Error(
      'Registry contract address is not configured. ' +
        'Check .env.local and restart Vite.',
    );
  }

  await assertContract(
    provider,
    networkConfig.registryAddress,
    'registry',
  );

  const contract = new Contract(
    getAddress(networkConfig.registryAddress),
    registryAbi,
    provider,
  );

  const count = Number(await contract.getDiscoveryCount());
  const rows = [];

  for (let index = 0; index < count; index += 1) {
    const fingerprint = await contract.discoveryHashes(index);
    const record = await contract.discoveries(fingerprint);

    rows.push({
      fingerprint,
      creator: record.creator as string,
      block_number: Number(record.blockNumber),
      ipfs_cid: record.ipfsCid as string,
      metadata: record.metadata as string,
      verified: record.verified as boolean,
    });
  }

  return rows;
}

/**
 * Reads marketplace listings and validates the registry link.
 */
export async function readMarketplace(provider: Provider) {
  if (!marketplaceConfigured) {
    throw new Error(
      'Marketplace contract address is not configured. ' +
        'Check .env.local and restart Vite.',
    );
  }

  await assertContract(
    provider,
    networkConfig.marketplaceAddress,
    'marketplace',
  );

  await assertContract(
    provider,
    networkConfig.registryAddress,
    'registry',
  );

  const contract = new Contract(
    getAddress(networkConfig.marketplaceAddress),
    marketplaceAbi,
    provider,
  );

  const registryAddress = getAddress(
    (await contract.registry()) as string,
  );

  if (
    registryAddress.toLowerCase() !==
    getAddress(networkConfig.registryAddress).toLowerCase()
  ) {
    throw new Error(
      'Marketplace is linked to a different registry address than ' +
        'the configured deployment. Verify contracts/deployments/localhost.json.',
    );
  }

  const count = Number(await contract.getListingCount());
  const rows = [];

  for (let index = 0; index < count; index += 1) {
    const materialHash = await contract.listingHashes(index);
    const record = await contract.listings(materialHash);

    rows.push({
      material_hash: materialHash as string,
      seller: record.seller as string,
      price_eth: formatEther(record.price),
      price_wei: record.price.toString(),
      license: record.licenseTerms as string,
      sold: record.sold as boolean,
      buyer: record.buyer as string,
    });
  }

  return rows;
}

/**
 * Registers a material using the connected wallet.
 */
export async function registerMaterial(
  signer: Signer,
  input: {
    fingerprint: string;
    storageReference: string;
    metadata: string;
  },
) {
  if (!registryConfigured) {
    throw new Error(
      'Registry contract address is not configured. ' +
        'Check .env.local and restart Vite.',
    );
  }

  const provider = signer.provider;

  if (!provider) {
    throw new Error('Signer has no provider.');
  }

  await assertContract(
    provider,
    networkConfig.registryAddress,
    'registry',
  );

  const contract = new Contract(
    getAddress(networkConfig.registryAddress),
    registryAbi,
    signer,
  );

  const fingerprint = fingerprintOf(input.fingerprint);

  const tx = await contract.registerDiscovery(
    fingerprint,
    input.storageReference,
    input.metadata,
  );

  const result = await verifyTransaction(
    tx,
    {
      contractAddress: getAddress(networkConfig.registryAddress),
      abi: registryAbi,
      eventName: 'DiscoveryRegistered',
      validateArgs: (args) =>
        String(args.fingerprint).toLowerCase() ===
        fingerprint.toLowerCase(),
      checkState: async (c) => {
        const record = await c.discoveries(fingerprint);

        return (
          record.creator.toLowerCase() !==
          '0x0000000000000000000000000000000000000000'
        );
      },
    },
    provider,
  );

  if (!result.success) {
    throw new Error(
      result.error ||
        `Transaction ${tx.hash} was submitted, but verification failed.`,
    );
  }

  const creator = await signer.getAddress();

  return {
    transactionHash: tx.hash,
    blockNumber: result.blockNumber,
    creator,
    fingerprint,
    event: result.event,
  };
}

/**
 * Creates a marketplace listing for a registered material.
 */
export async function createListing(
  signer: Signer,
  input: {
    materialHash: string;
    priceEth: string;
    license: string;
  },
) {
  if (!marketplaceConfigured || !registryConfigured) {
    throw new Error(
      'Registry or marketplace address is not configured. ' +
        'Check .env.local and restart Vite.',
    );
  }

  const provider = signer.provider;

  if (!provider) {
    throw new Error('Signer has no provider.');
  }

  await assertContract(
    provider,
    networkConfig.marketplaceAddress,
    'marketplace',
  );

  await assertContract(
    provider,
    networkConfig.registryAddress,
    'registry',
  );

  const contract = new Contract(
    getAddress(networkConfig.marketplaceAddress),
    marketplaceAbi,
    signer,
  );

  const materialHash = fingerprintOf(input.materialHash);
  const price = parseEther(input.priceEth);

  const registeredAddress = getAddress(
    (await contract.registry()) as string,
  );

  if (
    registeredAddress.toLowerCase() !==
    getAddress(networkConfig.registryAddress).toLowerCase()
  ) {
    throw new Error(
      'Marketplace is linked to a different registry address than configured.',
    );
  }

  const registry = new Contract(
    registeredAddress,
    registryAbi,
    provider,
  );

  const registeredMaterial = await registry.discoveries(materialHash);

  if (
    !registeredMaterial.creator ||
    registeredMaterial.creator.toLowerCase() ===
      '0x0000000000000000000000000000000000000000'
  ) {
    throw new Error(
      'Register this generated material on the registry contract ' +
        'before creating a marketplace listing.',
    );
  }

  const tx = await contract.listMaterial(
    materialHash,
    price,
    input.license,
  );

  const result = await verifyTransaction(
    tx,
    {
      contractAddress: getAddress(networkConfig.marketplaceAddress),
      abi: marketplaceAbi,
      eventName: 'ListingCreated',
      validateArgs: (args) =>
        String(args.materialHash).toLowerCase() ===
        materialHash.toLowerCase(),
      checkState: async (c) => {
        const listing = await c.listings(materialHash);

        return (
          listing.seller.toLowerCase() !==
            '0x0000000000000000000000000000000000000000' &&
          !listing.sold
        );
      },
    },
    provider,
  );

  if (!result.success) {
    throw new Error(
      result.error ||
        `Transaction ${tx.hash} was submitted, but verification failed.`,
    );
  }

  return {
    transactionHash: tx.hash,
    blockNumber: result.blockNumber,
    seller: await signer.getAddress(),
    event: result.event,
  };
}

/**
 * Purchases an existing marketplace listing.
 */
export async function purchaseListing(
  signer: Signer,
  materialHash: string,
) {
  if (!marketplaceConfigured) {
    throw new Error(
      'Marketplace contract address is not configured. ' +
        'Check .env.local and restart Vite.',
    );
  }

  const provider = signer.provider;

  if (!provider) {
    throw new Error('Signer has no provider.');
  }

  await assertContract(
    provider,
    networkConfig.marketplaceAddress,
    'marketplace',
  );

  const contract = new Contract(
    getAddress(networkConfig.marketplaceAddress),
    marketplaceAbi,
    signer,
  );

  const digest = fingerprintOf(materialHash);
  const listing = await contract.listings(digest);

  if (
    !listing.seller ||
    listing.seller.toLowerCase() ===
      '0x0000000000000000000000000000000000000000'
  ) {
    throw new Error('Listing not found on chain.');
  }

  if (listing.sold) {
    throw new Error('This listing has already been purchased.');
  }

  const tx = await contract.purchaseMaterial(digest, {
    value: listing.price,
  });

  const result = await verifyTransaction(
    tx,
    {
      contractAddress: getAddress(networkConfig.marketplaceAddress),
      abi: marketplaceAbi,
      eventName: 'ListingPurchased',
      validateArgs: (args) =>
        String(args.materialHash).toLowerCase() ===
        digest.toLowerCase(),
      checkState: async (c) => {
        const updatedListing = await c.listings(digest);
        return updatedListing.sold;
      },
    },
    provider,
  );

  if (!result.success) {
    throw new Error(
      result.error ||
        `Transaction ${tx.hash} was submitted, but verification failed.`,
    );
  }

  const buyer = await signer.getAddress();
  const finalListing = await contract.listings(digest);

  return {
    transactionHash: tx.hash,
    blockNumber: result.blockNumber,
    buyer,
    seller: finalListing.seller as string,
    license: finalListing.licenseTerms as string,
    event: result.event,
  };
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}
