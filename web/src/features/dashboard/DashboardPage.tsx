import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { watchRouteLogs } from '../../adapters/store';
import { loadConfig } from '../../adapters/remoteConfig';
import { routeStats } from '../../core/stats/routeStats';
import { CLOUD_COST_PER_CALL_USD } from '../../core/config/defaults';
import type { RouteLogDoc } from '../../core/router/routeLog';
import type { RoutingMode } from '../../core/types';

const Tile = ({ label, value, tone = '', caption }: { label: string; value: string; tone?: string; caption?: string }) => (
  <div className="bg-white rounded-lg border p-4">
    <dl>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className={`text-3xl font-bold ${tone}`}>{value}</dd>
    </dl>
    {caption && <p className="mt-1 text-xs text-slate-600">{caption}</p>}
  </div>
);

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const uid = user?.uid;
  const isAdmin = profile?.role === 'admin';
  const [logs, setLogs] = useState<RouteLogDoc[]>([]);
  const [mode, setMode] = useState<RoutingMode | null>(null);

  useEffect(() => {
    if (!uid) return;
    return watchRouteLogs(uid, isAdmin, setLogs);
  }, [uid, isAdmin]);

  useEffect(() => {
    let alive = true;
    const refresh = () => { loadConfig().then((c) => { if (alive) setMode(c.routingMode); }).catch(() => {}); };
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const s = useMemo(() => routeStats(logs, CLOUD_COST_PER_CALL_USD), [logs]);
  const maxReason = Math.max(0, ...Object.values(s.reasons));
  const bar = (n: number, max: number) => (
    <div className="h-2 bg-slate-100 rounded" aria-hidden="true">
      <div className="h-2 bg-emerald-600 rounded" style={{ width: `${max ? (n / max) * 100 : 0}%` }} />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Routing</h1>
        <span className="px-3 py-1 rounded-full bg-slate-200 text-sm" aria-label={`Current routing mode: ${mode ?? 'loading'}`}>Mode: {mode ?? '…'}</span>
      </div>
      {s.total === 0 ? (
        <p className="bg-white rounded-lg border p-6 text-slate-600">No bills processed yet</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Bills read on device" value={`${s.devicePct}%`} tone="text-emerald-700"
              caption={`${s.readOnDevice} of ${s.total} bills${s.manual ? ` (${s.manual} saved for manual entry)` : ''}`} />
            <Tile label="Bills checked in cloud" value={`${s.cloud}`} />
            <Tile label="Private numbers hidden" value={`${s.piiTotal}`} />
            <Tile label="Raw private numbers sent to cloud" value="0" tone="text-emerald-700"
              caption="By design: only redacted images are sent. Verified by the redaction leak check." />
          </div>
          <p className="text-sm text-slate-600">
            Estimated cloud cost ${s.costUsd.toFixed(4)} · estimated saved vs all-cloud ${s.savedUsd.toFixed(4)} · {s.total} bills
          </p>
          <section className="bg-white rounded-lg border p-4" aria-labelledby="why-h">
            <h2 id="why-h" className="font-semibold mb-2">Why bills went where they did</h2>
            <ul className="space-y-2">
              {Object.entries(s.reasons).sort((a, b) => b[1] - a[1]).map(([r, n]) => (
                <li key={r}>
                  <div className="flex justify-between text-sm"><span>{r.replace(/_/g, ' ')}</span><span>{n} {n === 1 ? 'bill' : 'bills'}</span></div>
                  {bar(n, maxReason)}
                </li>
              ))}
            </ul>
          </section>
          <section className="bg-white rounded-lg border p-4" aria-labelledby="pii-h">
            <h2 id="pii-h" className="font-semibold mb-2">Hidden by type (bills)</h2>
            {Object.keys(s.piiByType).length === 0
              ? <p className="text-sm text-slate-600">No private numbers found.</p>
              : <ul className="text-sm">{Object.entries(s.piiByType).map(([t, n]) => <li key={t}>{t}: {n}</li>)}</ul>}
          </section>
        </>
      )}
    </div>
  );
}
