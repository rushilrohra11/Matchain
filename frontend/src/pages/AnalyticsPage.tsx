import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchJson } from '../lib/api';

type Analytics = {
  job_id: string | null;
  model_availability: Record<string, boolean>;
  model_evaluation: Record<string, { r2: number; mae: number; rmse: number; n_test: number } | null>;
  vae_history: { epochs: number[]; total_loss: number[] };
};

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchJson<Analytics>('/api/analytics').then(setAnalytics).catch((reason: Error) => setError(reason.message));
  }, []);

  const modelData = Object.entries(analytics?.model_evaluation ?? {})
    .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => entry[1] !== null)
    .map(([name, metrics]) => ({ name: name.toUpperCase(), ...metrics }));
  const trend = (analytics?.vae_history.epochs ?? []).map((epoch, index) => ({ epoch, loss: analytics?.vae_history.total_loss[index] ?? null }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">Validation & AI Analytics</h1>
        <p className="mt-2 text-slate-400">Metrics from the latest completed discovery job and its held-out model evaluation.</p>
      </div>

      {error && <p role="alert" className="text-sm text-rose-300">Could not load actual analytics: {error}</p>}
      {analytics?.job_id && <p className="text-xs text-slate-500">Source job: {analytics.job_id}. Model metrics use held-out dataset predictions; they are not experimental validation.</p>}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Model performance</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={modelData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" stroke="#cbd5e1" />
                <YAxis stroke="#cbd5e1" />
                <Tooltip />
                <Bar dataKey="r2" name="Held-out R²" fill="#818cf8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-slate-400">{modelData.length ? modelData.map((item) => `${item.name}: MAE ${item.mae.toFixed(4)} eV/atom, n=${item.n_test}`).join(' · ') : 'No model evaluation metrics are available from a completed run.'}</p>
        </div>

        <div className="card p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">VAE loss trend</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="epoch" stroke="#cbd5e1" />
                <YAxis stroke="#cbd5e1" />
                <Tooltip />
                <Line type="monotone" dataKey="loss" stroke="#22d3ee" connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {!trend.length && <p className="mt-2 text-xs text-slate-400">Training history is available after a completed model-training run.</p>}
        </div>
      </div>
    </div>
  );
}
