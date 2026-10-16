import { useEffect, useState } from 'react';
import { ArrowRight, Blocks, BrainCircuit, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { fetchJson } from '../lib/api';
import type { Stats } from '../types';

const features = [
  { icon: BrainCircuit, title: 'Generative inverse design', subtitle: 'Property-conditioned crystal generation and exploration.' },
  { icon: Workflow, title: 'Ensemble validation', subtitle: 'Available model predictions and thermodynamic filtering gate candidates.' },
  { icon: Blocks, title: 'Blockchain provenance', subtitle: 'Registry integrity checks with local chain operations.' },
  { icon: ShieldCheck, title: 'Single-sale marketplace', subtitle: 'The contract records one paid sale and free-text terms; it does not enforce legal licence conditions.' },
];

export default function LandingPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetchJson<Stats>('/api/dashboard/stats').then(setStats).catch(() => setStats(null));
  }, []);

  const latestJob = stats?.recent_jobs[0];

  return (
    <div className="space-y-10">
      <section className="overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-indigo-950/40 to-slate-900 p-8 md:p-12">
        <div className="grid gap-8 lg:grid-cols-[1.3fr_0.7fr]">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-indigo-200">
              <Sparkles className="h-3.5 w-3.5" />
              Discover • Validate • Protect
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-white md:text-6xl">
              MatChain — <span className="text-indigo-300">Discover. Validate. Protect.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base text-slate-300 md:text-lg">
              AI-powered inverse materials design with a scientific validation stack and blockchain-backed provenance for advanced material innovation.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="/discovery" className="button-primary">
                Start Discovering <ArrowRight className="ml-2 h-4 w-4" />
              </a>
              <a href="/marketplace" className="button-secondary">
                Explore Marketplace
              </a>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-700 bg-slate-950/60 p-5">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="grid-panel">
                  <div className="text-slate-400">Candidates generated</div>
                  <div className="mt-2 text-2xl font-semibold text-white">{stats?.total_candidates_generated ?? '—'}</div>
                </div>
                <div className="grid-panel">
                  <div className="text-slate-400">Geometry-valid structures</div>
                  <div className="mt-2 text-2xl font-semibold text-white">{stats?.structurally_valid_candidates != null ? stats.structurally_valid_candidates : '—'}</div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
                <div className="mb-3 flex items-center justify-between text-sm text-slate-300">
                  <span>Latest discovery job</span>
                  <span className="text-indigo-300">{latestJob?.status ?? 'No completed activity'}</span>
                </div>
                <p className="text-xs text-slate-400">{latestJob ? `Job ${latestJob.id.slice(0, 8)} · ${new Date(latestJob.created_at * 1000).toLocaleString()}` : 'Run a discovery job to populate pipeline metrics.'}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {features.map(({ icon: Icon, title, subtitle }) => (
          <div key={title} className="card p-5">
            <div className="mb-4 inline-flex rounded-xl bg-indigo-500/10 p-3 text-indigo-300">
              <Icon className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            <p className="mt-2 text-sm text-slate-300">{subtitle}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
