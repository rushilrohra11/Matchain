import { useEffect, useState } from 'react';
import { fetchJson, postJson } from '../lib/api';
import { registryConfigured } from '../services/contractClient';
import { registerGeneratedCandidate, type GeneratedCandidate } from '../services/registration';
import { useWallet } from '../services/wallet';

const initialForm = {
  objective: 'Lightweight alloy for aerospace application',
  formation_energy_per_atom: -1.5,
  band_gap: 0.0,
  density: 5.0,
  n_candidates: 200,
  tau: 0.15,
  top_k: 5,
  relax: false,
};

export default function DiscoveryPage() {
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState<string>('Ready');
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<DiscoveryJob | null>(null);
  const [requestError, setRequestError] = useState('');
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState('');
  const [registeringHash, setRegisteringHash] = useState<string | null>(null);
  const [storageConsent, setStorageConsent] = useState(false);
  const { connected, connect, getSigner, correctNetwork } = useWallet();

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const current = await fetchJson<DiscoveryJob>(`/api/discovery/jobs/${encodeURIComponent(jobId)}`);
        if (cancelled) return;
        setJob(current);
        if (current.status === 'completed') {
          setStatus('Generation completed');
          return;
        }
        if (current.status === 'failed') {
          setStatus('Generation failed');
          setRequestError(current.error ?? 'The scientific pipeline failed without a reported error.');
          return;
        }
        setStatus(current.status === 'running' ? `Generating (${Math.round((current.progress ?? 0) * 100)}%)` : 'Queued');
        timer = setTimeout(() => void poll(), 1500);
      } catch (error) {
        if (cancelled) return;
        setRequestError(error instanceof Error ? error.message : 'Could not read discovery job status.');
        setStatus('Status check failed');
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  const handleChange = (field: string, value: string | number | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setRequestError('');
    setJob(null);
    setJobId(null);
    setSelectedHash(null);
    setRegistrationStatus('');
    setStatus('Submitting job...');
    const payload = {
      objective: form.objective,
      target_condition: {
        formation_energy_per_atom: Number(form.formation_energy_per_atom),
        band_gap: Number(form.band_gap),
        density: Number(form.density),
      },
      n_candidates: Number(form.n_candidates),
      tau: Number(form.tau),
      top_k: Number(form.top_k),
      relax: !!form.relax,
    };

    try {
      const data = await postJson<{ job_id: string }>('/api/discovery/generate', payload);
      setStatus('Queued');
      setJobId(data.job_id);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Failed to start the scientific discovery job.');
      setStatus('Job failed to start');
    }
  };

  const registerCandidate = async (candidate: GeneratedCandidate) => {
    if (!storageConsent) {
      setRegistrationStatus('Review the storage disclosure and confirm before uploading this structure.');
      return;
    }
    setRegisteringHash(candidate.material_hash);
    setRegistrationStatus('Connect MetaMask and approve only after reviewing its transaction details.');
    try {
      if (!connected) await connect();
      const signer = await getSigner();
      const result = await registerGeneratedCandidate(signer, candidate);
      setRegistrationStatus(`${candidate.formula} registered as ${candidate.material_hash} in block ${result.blockNumber}; transaction ${result.transactionHash}; ${result.storageBackend}${result.isIpfs ? ' (IPFS)' : ' (not IPFS)'}.`);
      setSelectedHash(candidate.material_hash);
    } catch (error) {
      setRegistrationStatus(error instanceof Error ? error.message : 'Registration failed or was rejected.');
    } finally {
      setRegisteringHash(null);
    }
  };

  const metamaskInstalled = typeof window !== 'undefined' && Boolean(window.ethereum);
  const candidates = (job?.result?.results ?? []) as GeneratedCandidate[];
  const diagnostics = job?.result?.diagnostics;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">Material Discovery</h1>
        <p className="mt-2 text-slate-400">Run the MatChain inverse-design job from the backend engine.</p>
      </div>

      <form onSubmit={handleSubmit} className="card p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="md:col-span-2 text-sm text-slate-300">
            Research objective (descriptive; numerical target fields condition the current model)
            <input
              value={form.objective}
              onChange={(e) => handleChange('objective', e.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>

          <label className="text-sm text-slate-300">
            Formation energy (eV/atom)
            <input
              type="number"
              step="0.1"
              value={form.formation_energy_per_atom}
              onChange={(e) => handleChange('formation_energy_per_atom', e.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>

          <label className="text-sm text-slate-300">
            Band gap (eV)
            <input
              type="number"
              step="0.1"
              value={form.band_gap}
              onChange={(e) => handleChange('band_gap', e.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>

          <label className="text-sm text-slate-300">
            Density (g/cm³)
            <input
              type="number"
              step="0.1"
              value={form.density}
              onChange={(e) => handleChange('density', e.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>

          <label className="text-sm text-slate-300">
            Number of candidates
            <input
              type="number"
              min={20}
              value={form.n_candidates}
              onChange={(e) => handleChange('n_candidates', Number(e.target.value))}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>

          <label className="text-sm text-slate-300">
            Consensus threshold τ
            <input
              type="number"
              step="0.01"
              min={0.01}
              max={1}
              value={form.tau}
              onChange={(e) => handleChange('tau', Number(e.target.value))}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>

          <label className="text-sm text-slate-300">
            Top K results
            <input
              type="number"
              min={1}
              value={form.top_k}
              onChange={(e) => handleChange('top_k', Number(e.target.value))}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            />
          </label>

          <label className="flex items-center gap-3 self-end rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.relax}
              onChange={(e) => handleChange('relax', e.target.checked)}
            />
            Enable CHGNet relaxation
          </label>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button type="submit" disabled={status === 'Queued' || status.startsWith('Generating') || status === 'Submitting job...'} className="button-primary disabled:opacity-50">Run generation</button>
          <button type="button" className="button-secondary" onClick={() => setForm(initialForm)}>
            Reset
          </button>
        </div>

        <div className="mt-6 rounded-xl border border-slate-700 bg-slate-950/80 p-3 text-sm text-slate-300">
          Status: <span className="text-indigo-200">{status}</span>
          {jobId && <div className="mt-2 text-xs text-slate-400">Job ID: {jobId}</div>}
          {job && <div className="mt-2 text-xs text-slate-400">Updated {new Date(job.updated_at * 1000).toLocaleTimeString()} · progress {Math.round((job.progress ?? 0) * 100)}%</div>}
        </div>
      </form>

      {requestError && <p role="alert" className="break-all text-sm text-rose-300">{requestError}</p>}
      {registrationStatus && <p role="status" className="break-all text-sm text-indigo-200">{registrationStatus}</p>}
      {candidates.length > 0 && (
        <div className="space-y-3">
          <label className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-100">
            <input type="checkbox" checked={storageConsent} onChange={(event) => setStorageConsent(event.target.checked)} className="mt-1" />
            <span>Before registering, upload this structure and its metadata to configured storage. If that provider is public IPFS, uploaded content may be publicly retrievable and cannot be made confidential by this application. Do not upload confidential or restricted material data. With no IPFS provider configured, the backend uses its explicitly labelled local JSON fallback.</span>
          </label>
          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm">
            <p className="font-medium text-slate-200 mb-2">To register on-chain, you need:</p>
            <ol className="space-y-1 text-slate-400 list-decimal list-inside">
              <li className={storageConsent ? 'text-emerald-300' : 'text-amber-300'}>
                {storageConsent ? '✓ Storage consent given' : '✗ Check the consent box above'}
              </li>
              <li className={metamaskInstalled ? 'text-emerald-300' : 'text-rose-300'}>
                {metamaskInstalled ? '✓ MetaMask detected' : '✗ MetaMask not detected — install the MetaMask browser extension'}
              </li>
              <li className={connected ? 'text-emerald-300' : 'text-slate-400'}>
                {connected ? `✓ Wallet connected (${correctNetwork ? 'correct network' : 'wrong network — switch to chain 1337 in MetaMask'})` : '○ Click "Connect MetaMask" in the top bar, then switch to Ganache (chain 1337)'}
              </li>
            </ol>
          </div>
        </div>
      )}

      {diagnostics && <section className="card p-5">
        <h2 className="text-lg font-semibold text-white">Actual pipeline diagnostics</h2>
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-300">
          <span>Generated: {diagnostics.generated}</span>
          <span>Geometry valid: {diagnostics.geometry_valid}</span>
          <span>Thermodynamic pass: {diagnostics.e_hull_passed}</span>
          <span>Jury pass: {diagnostics.jury_passed}</span>
          <span>Final validated: {diagnostics.final_validated}</span>
          {job?.result?.elapsed != null && <span>Elapsed: {Number(job.result.elapsed).toFixed(2)} s</span>}
        </div>
        <p className="mt-3 text-xs text-amber-300">Model predictions and computed stability estimates are not experimental verification.</p>
        {job?.result?.model_availability && <p className="mt-2 text-xs text-slate-400">Model availability: {Object.entries(job.result.model_availability).map(([name, available]) => `${name}: ${available ? 'available' : 'unavailable'}`).join(' · ')}</p>}
      </section>}

      {job?.status === 'completed' && <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Validated candidate results ({candidates.length})</h2>
        {!candidates.length && <p className="card p-5 text-sm text-slate-400">The scientific pipeline completed but returned no candidates passing all validation stages.</p>}
        <div className="grid gap-4 xl:grid-cols-2">
          {candidates.map((candidate) => (
            <article key={candidate.material_hash} className={`card p-5 ${selectedHash === candidate.material_hash ? 'ring-1 ring-emerald-400' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-white">{candidate.formula}</h3>
                <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200">Scientifically pipeline-validated</span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-300">
                <div><dt className="text-slate-500">Density</dt><dd>{Number(candidate.density).toFixed(3)} g/cm³</dd></div>
                <div><dt className="text-slate-500">E above hull</dt><dd>{Number(candidate.e_hull).toFixed(4)} eV/atom</dd></div>
                <div><dt className="text-slate-500">Predicted formation energy</dt><dd>{Number(candidate.predicted_formation_energy).toFixed(4)} eV/atom</dd></div>
                <div><dt className="text-slate-500">Ensemble spread</dt><dd>{Number(candidate.consensus_spread).toFixed(4)}</dd></div>
              </dl>
              <p className="mt-3 break-all font-mono text-xs text-slate-500">Fingerprint: {candidate.material_hash}</p>
              <p className="mt-2 text-xs text-slate-400">Model predictions: {Object.entries(candidate.model_predictions ?? {}).map(([name, value]) => `${name} ${value == null ? 'unavailable' : Number(value).toFixed(4)}`).join(' · ')}</p>
              <details className="mt-3 text-xs text-slate-400"><summary className="cursor-pointer">View crystal structure data</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(candidate.structure_payload, null, 2)}</pre></details>
              <button
                type="button"
                disabled={!registryConfigured || registeringHash === candidate.material_hash || selectedHash === candidate.material_hash}
                onClick={() => void registerCandidate(candidate)}
                className="button-primary mt-4 w-full disabled:cursor-not-allowed disabled:opacity-50"
                title="Structure is uploaded to the configured storage provider before the wallet transaction. IPFS content may be public; do not register confidential structures."
              >
                {selectedHash === candidate.material_hash ? 'Registered on chain' : registeringHash === candidate.material_hash ? 'Waiting for MetaMask confirmation…' : 'Review and register with MetaMask'}
              </button>
            </article>
          ))}
        </div>
      </section>}
    </div>
  );
}

type DiscoveryJob = {
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  created_at: number;
  updated_at: number;
  progress?: number;
  error?: string | null;
  result?: {
    results?: GeneratedCandidate[];
    elapsed?: number;
    diagnostics?: Record<string, any>;
    model_availability?: Record<string, boolean>;
  } | null;
};
