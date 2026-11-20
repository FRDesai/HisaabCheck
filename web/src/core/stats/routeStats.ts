import type { RouteLogDoc } from '../router/routeLog';

export type RouteStats = {
  total: number; device: number; cloud: number;
  /** device-path logs with reason 'passed': bills actually read on device */
  readOnDevice: number;
  /** device-path logs with any other reason: saved for manual entry, no successful read */
  manual: number;
  /** readOnDevice / total, rounded percent */
  devicePct: number;
  /** logs where an image was actually sent to the cloud (estCostUsd > 0) */
  sentToCloud: number;
  reasons: Record<string, number>; piiByType: Record<string, number>; piiTotal: number; costUsd: number; savedUsd: number;
};

export type RouteStatsInput = Pick<RouteLogDoc, 'billId' | 'path' | 'reason' | 'piiMasked' | 'piiTypes' | 'estCostUsd'>;

// Logs come from Firestore and may be malformed (old clients, bad writes): never let one row break the dashboard.
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const types = (v: unknown): string[] => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : []);

export function routeStats(logs: RouteStatsInput[], costPerCall: number): RouteStats {
  const seen = new Set<string>();
  const unique = logs.filter((l) => {
    if (!l.billId) return true;
    if (seen.has(l.billId)) return false;
    seen.add(l.billId);
    return true;
  });
  const s: RouteStats = { total: unique.length, device: 0, cloud: 0, readOnDevice: 0, manual: 0, devicePct: 0, sentToCloud: 0,
    reasons: {}, piiByType: {}, piiTotal: 0, costUsd: 0, savedUsd: 0 };
  for (const l of unique) {
    if (l.path === 'device') {
      s.device++;
      if (l.reason === 'passed') s.readOnDevice++; else s.manual++;
    } else s.cloud++;
    s.reasons[l.reason] = (s.reasons[l.reason] ?? 0) + 1;
    const cost = num(l.estCostUsd);
    if (cost > 0) {
      s.sentToCloud++;
      for (const t of types(l.piiTypes)) s.piiByType[t] = (s.piiByType[t] ?? 0) + 1;
      s.piiTotal += num(l.piiMasked);
    }
    s.costUsd += cost;
  }
  s.devicePct = s.total ? Math.round((s.readOnDevice / s.total) * 100) : 0;
  s.savedUsd = Math.max(0, s.total * costPerCall - s.costUsd);
  return s;
}
