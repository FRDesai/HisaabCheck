import { describe, it, expect } from 'vitest';
import vectors from '../../../shared/test-vectors/bills.json';
import { runChecks } from '../../src/core/checks/checks';
import { parseConfig } from '../../src/core/config/parseConfig';
import type { Extraction } from '../../src/core/types';

const cfg = parseConfig({}, false);
const today = new Date('2026-11-20T10:00:00+05:30');
type V = { name: string; bill?: Extraction; patch?: Record<string, unknown>; checks: object; score: number; hardFail: string | null; escalate: boolean };
const all = vectors as V[];
const base = all[0].bill!;

describe('runChecks vectors', () => {
  for (const v of all) {
    it(v.name, () => {
      const bill: Record<string, unknown> = { ...(v.bill ?? base) };
      for (const [k, val] of Object.entries(v.patch ?? {})) { if (val === null) delete bill[k]; else bill[k] = val; }
      const r = runChecks(bill as unknown as Extraction, cfg, today);
      expect(r.checks).toEqual(v.checks);
      expect(r.score).toBeCloseTo(v.score, 5);
      expect(r.hardFail).toBe(v.hardFail);
      expect(r.escalate).toBe(v.escalate);
    });
  }
});
