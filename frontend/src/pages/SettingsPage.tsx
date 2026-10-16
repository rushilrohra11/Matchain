import { useEffect, useState } from 'react';
import { fetchJson } from '../lib/api';

type Health = {
  status: string;
  blockchain: string;
  chain_id: number | null;
  registry_contract: string | null;
  marketplace_contract: string | null;
  backend_signing_enabled: boolean;
  storage_backend: string;
  materials_project_configured: boolean;
};

type Analytics = {
  model_availability: Record<string, boolean>;
};

export default function SettingsPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [modelAvailability, setModelAvailability] = useState<Record<string, boolean> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchJson<Health>('/api/health').then(setHealth).catch((reason: Error) => setError(reason.message));
    fetchJson<Analytics>('/api/analytics').then((data) => setModelAvailability(data.model_availability)).catch(() => setModelAvailability(null));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">Settings & Administration</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 text-lg font-semibold text-white">Environment status</h2>
          <ul className="space-y-2 text-sm text-slate-300">
            <li>Backend: {health?.status ?? (error ? 'unavailable' : 'checking…')}</li>
            <li>Ganache RPC: {health?.blockchain ?? 'checking…'}{health?.chain_id ? ` (chain ${health.chain_id})` : ''}</li>
            <li>Registry contract: {health?.registry_contract ?? 'not deployed/configured'}</li>
            <li>Marketplace contract: {health?.marketplace_contract ?? 'not deployed/configured'}</li>
            <li>Backend signing: {health?.backend_signing_enabled ? 'enabled (unlocked account configured)' : 'disabled; frontend MetaMask signing'}</li>
            <li>Storage: {health?.storage_backend ?? 'checking…'}</li>
            <li>Materials Project API key: {health ? (health.materials_project_configured ? 'configured' : 'not configured; synthetic dataset fallback') : 'checking…'}</li>
          </ul>
          {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
        </div>
        <div className="card p-5">
          <h2 className="mb-3 text-lg font-semibold text-white">Model availability</h2>
          <ul className="space-y-2 text-sm text-slate-300">
            {modelAvailability ? Object.entries(modelAvailability).map(([name, available]) => <li key={name}>{name}: {available ? 'available in latest completed run' : 'unavailable in latest completed run'}</li>) : <li>No completed run has reported model availability yet.</li>}
          </ul>
        </div>
      <div className="card p-5">
          <h2 className="mb-3 text-lg font-semibold text-white">MetaMask setup for local chain</h2>
          <ol className="space-y-2 text-sm text-slate-300 list-decimal list-inside">
            <li>Install the <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline">MetaMask browser extension</a>.</li>
            <li>Open MetaMask → Settings → Networks → Add a network manually.</li>
            <li>Fill in: Network name: <code className="text-indigo-200">Ganache Local</code> · RPC URL: <code className="text-indigo-200">http://127.0.0.1:8545</code> · Chain ID: <code className="text-indigo-200">1337</code> · Currency: <code className="text-indigo-200">ETH</code>.</li>
            <li>Save and switch to the new network in MetaMask.</li>
            <li>Import a test account: MetaMask → Import account → paste the private key below (Ganache account #0):</li>
            <li><code className="break-all text-xs text-amber-200">0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80</code></li>
            <li>Click <strong>"Connect MetaMask"</strong> in the MatChain top bar and approve.</li>
            <li>Go to Discovery, run generation, check the consent box, then click <strong>"Review and register with MetaMask"</strong>.</li>
          </ol>
          <p className="mt-3 text-xs text-amber-300">⚠️ These are test keys for local development only. Never use them on mainnet or with real funds.</p>
        </div>
      </div>
    </div>
  );
}
