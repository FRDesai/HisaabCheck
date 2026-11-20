import type { RouteLogDoc } from '../router/routeLog';

export type RouteStats = {
  total: number; device: number; cloud: number;
  /** device-path logs with reason 'passed': bills actually read on device */
  readOnDevice: number;
  /** device-path logs with any other reason: saved for manual entry, no successful read */
  manual: number;
  /** readOnDevice / total, rounded percent */
  devicePct: number;
  reasons: Record<string, number>; piiByType: Record<string, number>; piiTotal: number; costUsd: number; savedUsd: number;
};

export type RouteStatsInput = Pick<RouteLogDoc, 'billId' | 'path' | 'reason' | 'piiMasked' | 'piiTypes' | 'estCostUsd'>;

export function routeStats(logs: RouteStatsInput[], costPerCall: number): RouteStats {
  const seen = new Set<string>();
  const unique = logs.filter((l) => (seen.has(l.billId) ? false : (seen.add(l.billId), true)));
  const s: RouteStats = { total: unique.length, device: 0, cloud: 0, readOnDevice: 0, manual: 0, devicePct: 0,
    reasons: {}, piiByType: {}, piiTotal: 0, costUsd: 0, savedUsd: 0 };
  for (const l of unique) {
    if (l.path === 'device') {
      s.device++;
      if (l.reason === 'passed') s.readOnDevice++; else s.manual++;
    } else s.cloud++;
    s.reasons[l.reason] = (s.reasons[l.reason] ?? 0) + 1;
    for (const t of l.piiTypes) s.piiByType[t] = (s.piiByType[t] ?? 0) + 1;
    s.piiTotal += l.piiMasked;
    s.costUsd += l.estCostUsd;
  }
  s.devicePct = s.total ? Math.round((s.readOnDevice / s.total) * 100) : 0;
  s.savedUsd = Math.max(0, s.total * costPerCall - s.costUsd);
  return s;
}
