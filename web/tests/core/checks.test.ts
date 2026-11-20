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

describe('date check in IST', () => {
  const dateCases: [string, string, string, boolean][] = [
    ['just after IST midnight accepts today (IST date)', '2026-11-21T02:00:00+05:30', '2026-11-21', true],
    ['just after IST midnight rejects tomorrow', '2026-11-21T02:00:00+05:30', '2026-11-22', false],
    ['exact 3-year boundary accepted', '2026-11-20T10:00:00+05:30', '2023-11-20', true],
    ['older than 3 years rejected', '2026-11-20T10:00:00+05:30', '2023-11-19', false],
    ['impossible calendar date rejected', '2026-11-20T10:00:00+05:30', '2026-02-30', false],
  ];
  for (const [name, now, invoiceDate, expected] of dateCases) {
    it(name, () => {
      const bill = { ...base, invoiceDate };
      const r = runChecks(bill, cfg, new Date(now));
      expect(r.checks.date).toBe(expected);
    });
  }
});
