import { useEffect, useState } from 'react';
import { createListing as sendListing, createRpcProvider, marketplaceConfigured, purchaseListing as sendPurchase, readMarketplace, readRegistry, shortHash } from '../services/contractClient';
import { useWallet } from '../services/wallet';

type Listing = { material_hash: string; price_eth: string; license: string; sold: boolean; seller: string; buyer: string };
type RegisteredMaterial = { fingerprint: string; metadata: string; block_number: number; creator: string };

export default function MarketplacePage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [materials, setMaterials] = useState<RegisteredMaterial[]>([]);
  const [notice, setNotice] = useState('');
  const [busyHash, setBusyHash] = useState<string | null>(null);
  const [materialHash, setMaterialHash] = useState('');
  const [price, setPrice] = useState('0.1');
  const [license, setLicense] = useState('research-use');
  const [creating, setCreating] = useState(false);
  const { connected, correctNetwork, connect, getSigner, address } = useWallet();

  const refresh = async () => {
    const provider = createRpcProvider();
    const [currentListings, registeredMaterials] = await Promise.all([readMarketplace(provider), readRegistry(provider)]);
    setListings(currentListings);
    setMaterials(registeredMaterials);
    if (!materialHash && registeredMaterials.length) setMaterialHash(registeredMaterials[0].fingerprint);
  };
  useEffect(() => { refresh().catch((error: Error) => setNotice(error.message)); }, [address, correctNetwork]);

  const purchase = async (materialHash: string) => {
    setBusyHash(materialHash);
    setNotice('Confirm the purchase in MetaMask…');
    try {
      if (!connected) await connect();
      const signer = await getSigner();
      const result = await sendPurchase(signer, materialHash);
      await refresh();
      setNotice(`Purchase confirmed in block ${result.blockNumber}; transaction ${result.transactionHash}; recipient ${result.buyer}; seller ${result.seller}; event ${result.event?.name ?? 'not found'}. This contract records a single-sale licence; it does not transfer the registry record.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Purchase failed.');
    } finally {
      setBusyHash(null);
    }
  };

  const createListing = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setNotice('Confirm listing creation in MetaMask…');
    try {
      if (!connected) await connect();
      const signer = await getSigner();
      const selectedMaterial = materials.find((material) => material.fingerprint === materialHash);
      if (!selectedMaterial || selectedMaterial.creator.toLowerCase() !== (await signer.getAddress()).toLowerCase()) {
        throw new Error('Only the wallet recorded as the registered material creator may create this listing. Switch to the creator account.');
      }
      const result = await sendListing(signer, { materialHash, priceEth: price, license });
      setMaterialHash('');
      await refresh();
      setNotice(`Listing confirmed in block ${result.blockNumber}; transaction ${result.transactionHash}; seller ${result.seller}; event ${result.event?.name ?? 'not found'}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create listing.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">Marketplace</h1>
        <p className="mt-2 text-slate-400">Listings and purchases are signed in MetaMask. The contract implements one paid sale per registered material; the free-text licence terms are recorded but not enforced.</p>
      </div>

      {!correctNetwork && <p className="text-sm text-amber-300">Connect MetaMask and switch to chain {import.meta.env.VITE_CHAIN_ID || '1337'} to transact.</p>}

      {notice && <p role="status" className="text-sm text-indigo-200">{notice}</p>}

      <form onSubmit={createListing} className="card grid gap-3 p-5 md:grid-cols-[1fr_140px_200px_auto]">
        <select required value={materialHash} onChange={(event) => setMaterialHash(event.target.value)} aria-label="Registered material" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
          {!materials.length && <option value="">No registered materials on this contract</option>}
          {materials.map((material) => {
            const isCreator = Boolean(address && material.creator.toLowerCase() === address.toLowerCase());
            return <option key={material.fingerprint} value={material.fingerprint} disabled={connected && !isCreator}>{formulaFor(material.metadata)} · {shortHash(material.fingerprint)} · {isCreator ? 'your material' : `creator ${material.creator.slice(0, 8)}…`}</option>;
          })}
        </select>
        <input required type="number" min="0.000000000000000001" step="any" value={price} onChange={(event) => setPrice(event.target.value)} aria-label="Price in ETH" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        <input required value={license} onChange={(event) => setLicense(event.target.value)} aria-label="License terms" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        <button disabled={creating || !marketplaceConfigured || !connected || !correctNetwork || !materials.some((material) => material.fingerprint === materialHash && material.creator.toLowerCase() === address?.toLowerCase())} className="button-primary disabled:opacity-50">{creating ? 'Confirm in wallet…' : 'Create listing'}</button>
      </form>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {listings.map((item) => (
          <div key={item.material_hash} className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-lg font-semibold text-white">Single-sale material</div>
              <div className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200">
                {item.sold ? (item.buyer.toLowerCase() === address?.toLowerCase() ? 'Purchased by you' : 'Sold') : item.seller.toLowerCase() === address?.toLowerCase() ? 'Your listing' : 'Available'}
              </div>
            </div>
            <div className="space-y-2 text-sm text-slate-300">
              <div>Price: {item.price_eth} ETH</div>
              <div>License: {item.license}</div>
              <div>Seller: {item.seller.slice(0, 10)}…{item.seller.slice(-4)}</div>
              {item.sold && <div>Buyer: {item.buyer.slice(0, 10)}…{item.buyer.slice(-4)}</div>}
              <div className="break-all font-mono text-xs">Hash: {item.material_hash}</div>
            </div>
            <button disabled={item.sold || busyHash === item.material_hash || !marketplaceConfigured} onClick={() => purchase(item.material_hash)} className="button-primary mt-5 w-full disabled:cursor-not-allowed disabled:opacity-50">
              {item.sold ? 'Already purchased' : busyHash === item.material_hash ? 'Confirming…' : 'Purchase license'}
            </button>
          </div>
        ))}
        {!listings.length && <div className="card p-5 text-sm text-slate-400">No listings found at the configured marketplace contract. Generate and register a candidate first to make it eligible for listing.</div>}
      </div>
    </div>
  );
}

function formulaFor(metadata: string) {
  try {
    const parsed = JSON.parse(metadata) as { formula?: string };
    return parsed.formula ?? 'Registered material';
  } catch {
    return 'Registered material';
  }
}
