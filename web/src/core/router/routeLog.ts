import type { PathTaken, PiiType, ProcessedBill, Reason } from '../types';

export interface RouteLogDoc {
  billId: string; shopId: string; caUid: string; platform: 'web' | 'android'; path: PathTaken; reason: Reason;
  piiMasked: number; piiTypes: PiiType[]; latencyMs: number; estCostUsd: number; modelName: string; promptVersion: string; createdAt: Date;
}
export const ROUTE_LOG_KEYS = ['billId', 'shopId', 'caUid', 'platform', 'path', 'reason', 'piiMasked', 'piiTypes',
  'latencyMs', 'estCostUsd', 'modelName', 'promptVersion', 'createdAt'] as const;

export function toRouteLog(p: ProcessedBill, ids: { billId: string; shopId: string; caUid: string }, now: Date): RouteLogDoc {
  return {
    ...ids, platform: 'web', path: p.route.path, reason: p.route.reason, piiMasked: p.piiMasked, piiTypes: p.piiTypes,
    latencyMs: p.latencyMs, estCostUsd: p.estCostUsd, modelName: p.route.modelName, promptVersion: p.route.promptVersion, createdAt: now,
  };
}
