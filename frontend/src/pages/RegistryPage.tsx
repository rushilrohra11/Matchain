import { useEffect, useState } from 'react';
import { postJson } from '../lib/api';
import { createRpcProvider, readRegistry, registerMaterial as registerOnchain, registryConfigured, shortHash } from '../services/contractClient';
import { useWallet } from '../services/wallet';

type RegistryEntry = {
  fingerprint?: string;
  structure_hash?: string;
  metadata?: string | Record<string, unknown>;
  block_number?: number;
  block_index?: number;
  verified?: boolean;
  creator?: string;
  ipfs_cid?: string;
};

export default function RegistryPage() {
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [error, setError] = useState('');
  const [materialHash, setMaterialHash] = useState('');
  const [formula, setFormula] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [transaction, setTransaction] = useState('');
  const [storageBackend, setStorageBackend] = useState('');
  const [storageConsent, setStorageConsent] = useState(false);
  const { connected, correctNetwork, connect, getSigner, address } = useWallet();

  const refresh = async () => setEntries(await readRegistry(createRpcProvider()));
  useEffect(() => { refresh().catch((reason: Error) => setError(reason.message)); }, [address, correctNetwork]);

  const formulaFor = (entry: RegistryEntry) => {
    if (typeof entry.metadata === 'object' && entry.metadata) return String(entry.metadata.formula ?? '—');
    if (typeof entry.metadata === 'string') {
      try { return String(JSON.parse(entry.metadata).formula ?? '—'); } catch { return '—'; }
    }
    return '—';
  };

  const registerMaterial = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!storageConsent) {
      setError('Confirm the public-storage disclosure before uploading registry metadata.');
      return;
    }
    setSubmitting(true);
    setError('');
    setTransaction('');
    try {
      if (!connected) await connect();
      if (!registryConfigured) throw new Error('Registry contract address is missing. Deploy the contracts and restart Vite.');
      const signer = await getSigner();
      const metadata = JSON.stringify({ formula });
      const stored = await postJson<{ storage_reference: string; storage_backend: string }>('/api/storage/upload', { content: { formula, material_hash: materialHash } });
      setStorageBackend(stored.storage_backend);
      const result = await registerOnchain(signer, { fingerprint: materialHash, storageReference: stored.storage_reference, metadata });
      setMaterialHash('');
      setFormula('');
      setTransaction(`Registered ID ${result.fingerprint}; block ${result.blockNumber}; transaction ${result.transactionHash}; event ${result.event?.name ?? 'not found'}. Storage: ${stored.storage_backend}.`);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not register material.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">Material Registry</h1>
        <p className="mt-2 text-slate-400">Register materials directly through MetaMask; receipts and event logs come from the deployed contract.</p>
      </div>

      {transaction && <p role="status" className="break-all text-sm text-emerald-300">{transaction}</p>}
      {error && <p role="alert" className="break-all text-sm text-rose-300">{error}</p>}
      {!correctNetwork && <p className="text-sm text-amber-300">Connect MetaMask and switch to chain {import.meta.env.VITE_CHAIN_ID || '1337'} to submit a transaction.</p>}
      {storageBackend && <p className="text-sm text-slate-400">Metadata storage: {storageBackend}.</p>}

      <label className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-100">
        <input type="checkbox" checked={storageConsent} onChange={(event) => setStorageConsent(event.target.checked)} className="mt-1" />
        <span>Registration uploads the fingerprint and formula metadata to the configured storage provider, then records its reference on chain. Public IPFS content can be retrieved by anyone. Do not enter confidential or restricted material data. The fallback, when used, is local JSON storage and is not IPFS.</span>
      </label>

      <form onSubmit={registerMaterial} className="card grid gap-3 p-5 md:grid-cols-[1fr_180px_auto]">
        <input required value={materialHash} onChange={(event) => setMaterialHash(event.target.value)} placeholder="Material fingerprint or hash" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        <input required value={formula} onChange={(event) => setFormula(event.target.value)} placeholder="Formula (e.g. TiVAl)" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        <button disabled={submitting || !registryConfigured} className="button-primary disabled:opacity-50">{submitting ? 'Confirm in wallet…' : 'Register on-chain'}</button>
      </form>

      <div className="card p-5">
        <table className="w-full text-left text-sm text-slate-300">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="pb-3">Block</th>
              <th className="pb-3">Formula</th>
              <th className="pb-3">Fingerprint / creator / storage</th>
              <th className="pb-3">Status</th>
            </tr>
          </thead>
          <tbody>
              {entries.map((entry, index) => (
                <tr key={entry.fingerprint ?? entry.structure_hash ?? index} className="border-b border-slate-800 last:border-b-0">
                  <td className="py-3">#{entry.block_number ?? entry.block_index ?? '—'}</td>
                  <td className="py-3">{formulaFor(entry)}</td>
                  <td className="py-3 font-mono" title={entry.ipfs_cid}>
                    {shortHash(entry.fingerprint ?? entry.structure_hash ?? '—')}
                    {entry.creator && <div className="break-all text-xs text-slate-400">Creator: {entry.creator}</div>}
                    <div className="break-all text-xs text-slate-500">{entry.ipfs_cid?.startsWith('local-sha256:') ? 'Local fallback (not IPFS)' : entry.ipfs_cid || 'No storage reference'}</div>
                  </td>
                  <td className="py-3">{entry.verified ? 'Verified' : 'Registered'}</td>
                </tr>
              ))}
              {!entries.length && !error && <tr><td className="py-5 text-slate-500" colSpan={4}>No materials registered at the configured contract address yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
