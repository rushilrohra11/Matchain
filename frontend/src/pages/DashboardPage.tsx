import { useEffect, useState } from 'react';
import { AlertCircle, ArrowUpRight, FileText, ShieldCheck, ShoppingBag, Sparkles } from 'lucide-react';
import { fetchJson } from '../lib/api';
import type { Stats } from '../types';

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<Stats>('/api/dashboard/stats')
      .then(setStats)
      .catch(() => setError('Unable to reach the MatChain API. Make sure the backend is running.'));
  }, []);

  if (error) {
    return (
      <div className="card flex items-center gap-3 p-4 text-amber-200">
        <AlertCircle className="h-5 w-5" />
        {error}
      </div>
    );
  }

  if (!stats) {
    return <div className="card p-8 text-slate-300">Loading dashboard metrics...</div>;
  }

  const metrics = [
    { label: 'Candidates generated', value: stats.total_candidates_generated, icon: Sparkles },
    { label: 'Valid structures', value: stats.structurally_valid_candidates, icon: ShieldCheck },
    { label: 'Thermodynamic accepts', value: stats.thermodynamically_accepted, icon: FileText },
    { label: 'Registered materials', value: stats.registered_materials, icon: ArrowUpRight },
    { label: 'Marketplace listings', value: stats.active_marketplace_listings, icon: ShoppingBag },
    { label: 'Completed licenses', value: stats.completed_licenses, icon: ShieldCheck },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">Dashboard</h1>
        <p className="mt-2 text-slate-400">Live platform metrics from the backend discovery and registry services.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {metrics.map(({ label, value, icon: Icon }) => (
          <div key={label} className="metric-card">
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-400">{label}</div>
              <Icon className="h-4 w-4 text-indigo-300" />
            </div>
            <div className="mt-4 text-3xl font-semibold text-white">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Recent discovery jobs</h2>
          <div className="space-y-3">
            {stats.recent_jobs.map((job) => (
              <div key={job.id} className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-sm">
                <div>
                  <div className="text-white">{job.id.slice(0, 8)}</div>
                  <div className="text-slate-400">{new Date(job.created_at * 1000).toLocaleString()}</div>
                </div>
                <div className="rounded-full bg-indigo-500/15 px-2 py-1 text-indigo-200">{job.status}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Recent blockchain events</h2>
          <div className="space-y-3">
            {stats.recent_transactions.map((tx) => (
              <div key={tx.hash} className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-sm">
                <div>
                  <div className="text-white">{tx.hash}</div>
                  <div className="text-slate-400">{tx.type}</div>
                </div>
                <div className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-200">{tx.status}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
