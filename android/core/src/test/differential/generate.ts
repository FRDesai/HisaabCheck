/**
 * Generates the differential corpora in ../resources/differential/ by running the web's TypeScript core
 * (the specification) on seeded random inputs. The Kotlin DifferentialTest replays them and demands identical output.
 *
 * Run from web/:  npx vite-node ../android/core/src/test/differential/generate.ts
 * Deterministic: the same seed always gives the same files.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runShield } from '../../../../../web/src/core/shield/shield';
import { ocrAdequate } from '../../../../../web/src/core/shield/adequacy';
import { planRedaction } from '../../../../../web/src/core/redact/planRedaction';
import { parseExtraction } from '../../../../../web/src/core/extract/parse';
import { parseConfig } from '../../../../../web/src/core/config/parseConfig';
import { runChecks } from '../../../../../web/src/core/checks/checks';
import { gstinCheckChar } from '../../../../../web/src/core/shield/gstin';
import type { Extraction, OcrWord } from '../../../../../web/src/core/types';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../resources/differential');

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261126);
const int = (n: number) => Math.floor(rnd() * n);
const pick = <T>(a: readonly T[]): T => a[int(a.length)];
const chance = (p: number) => rnd() < p;

/** Numbers are written as String(n) (with "-0" kept) so the Kotlin side can compare bit for bit. */
const num = (n: number) => (Object.is(n, -0) ? '-0' : String(n));

// ---------------------------------------------------------------- shield

const JS_WS = ['\t', '\n', '\u000B', '\u000C', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿'];
const NOT_WS = ['\u0085', '᠎', '​', '\u001C'];
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIG = '0123456789';
const rs = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[int(alphabet.length)]).join('');

function verhoeffCheck(d: string): string {
  const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  const INV = [0,4,3,2,1,5,6,7,8,9];
  let c = 0;
  const a = d.split('').reverse().map(Number);
  for (let i = 0; i < a.length; i++) c = D[c][P[(i + 1) % 8][a[i]]];
  return String(INV[c]);
}
const pan = () => rs(UPPER, 3) + pick('ABCFGHLJPT'.split('')) + rs(UPPER, 1) + rs(DIG, 4) + rs(UPPER, 1);
const aadhaarDigits = (valid: boolean) => {
  const body = pick('23456789'.split('')) + rs(DIG, 10);
  return body + (valid ? verhoeffCheck(body) : rs(DIG, 1));
};
const gstin = (valid: boolean) => {
  const s = String(1 + int(38)).padStart(2, '0') + pan() + pick('123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')) + 'Z';
  return s + (valid ? gstinCheckChar(s) : rs(DIG + UPPER, 1));
};
const sep = () => pick(['', '', ' ', ' ', '-', pick(JS_WS), pick(NOT_WS)]);
const group = (s: string, sizes: number[]) => {
  const out: string[] = []; let i = 0;
  for (const n of sizes) { out.push(s.slice(i, i + n)); i += n; }
  if (i < s.length) out.push(s.slice(i));
  return out;
};
const joinWith = (parts: string[]) => parts.reduce((a, p, i) => (i === 0 ? p : a + sep() + p), '');
const lookAlike = (s: string, k: number) => {
  const m: Record<string, string> = { '0': 'O', '1': pick(['I', 'L']), '5': 'S', '8': 'B', '2': 'Z', O: '0', I: '1', S: '5', B: '8', Z: '2', L: '1' };
  const a = s.split('');
  for (let j = 0; j < k; j++) { const i = int(a.length); if (m[a[i]]) a[i] = m[a[i]]; }
  return a.join('');
};
const mobile = () => pick(['6', '7', '8', '9']) + rs(DIG, 9);
const LABEL_WORDS = ['PAN', 'PAN:', 'Pan No', 'Aadhaar', 'AADHAR No:', 'IFSC', 'IFSC Code:', 'Mob', 'Mobile:', 'Ph:', 'Phone', 'Tel', 'Cell', 'Contact',
  'A/c', 'A/c No:', 'Acc No.', 'Account Number', 'Account', 'Acct', 'AC NO', 'Acc#', 'Bank Account Details', 'GSTIN:', 'GSTIN/UIN'];
const FILLER = ['Ref', 'Total', 'Rs.', '1,770.00', 'Qty', '12', 'ABCDE12', 'Invoice', 'INV-2026-001', '2026-11-02', 'Rice', 'HSN', '1006',
  'CGST', '9%', 'Karnataka', '29-Karnataka', 'smudge', '____', 'No', 'No.', '#', ':', 'straße', 'été', '١٢٣',
  'aapfu0939f', 'Thank', 'you', 'ABCDEFGHIJ', 'A1B2C3D4E5', 'INV/123/45678', '080', '2345', '6789', '22AAAAA0000A1Z5'];

function piiToken(): string {
  switch (int(13)) {
    case 0: return chance(0.3) ? pan().toLowerCase() : pan();
    case 1: { const d = aadhaarDigits(chance(0.6)); return joinWith(group(d, [4, 4, 4])); }
    case 2: return joinWith([pick(['+91', '91', '0', '', '']), ...group(mobile(), [5, 5])].filter(Boolean));
    case 3: return joinWith(['0' + rs(DIG, 2 + int(3)), rs(DIG, 3 + int(2)), rs(DIG, 4)]);
    case 4: return joinWith(group(rs(DIG, 9 + int(10)), [int(6) + 1, int(6) + 1, int(6) + 1]));
    case 5: return rs(UPPER, 4) + '0' + rs(UPPER + DIG, 6);
    case 6: return gstin(chance(0.7));
    case 7: return lookAlike(pan(), 1 + int(3));
    case 8: return lookAlike(joinWith(group(mobile(), [5, 5])), 1 + int(2));
    case 9: return lookAlike(aadhaarDigits(true), 1 + int(2));
    case 10: return rs(UPPER, 5) + rs(DIG, 1 + int(3));
    case 11: return rs(UPPER + DIG + '-/:#.', 1 + int(14));
    default: return rs(DIG, 1 + int(14));
  }
}

function randomWords(): OcrWord[] {
  const nLines = 1 + int(4);
  const words: OcrWord[] = [];
  let line = chance(0.15) ? int(3) : 0;
  const conf = () => pick([95, 95, 95, 90, 70, 60, 59.9, 40, 10, Number.NaN]);
  for (let l = 0; l < nLines; l++) {
    const tokens: string[] = [];
    const n = 1 + int(6);
    for (let k = 0; k < n; k++) tokens.push(...pick([() => [pick(LABEL_WORDS)], () => [piiToken()], () => [piiToken()], () => [pick(FILLER)]])().map(String));
    // Split into OCR words on spaces, sometimes also inside a token.
    let x = 0;
    for (const t of tokens.join(' ').split(' ').filter(Boolean)) {
      const parts = chance(0.15) && t.length > 2 ? (() => { const c = 1 + int(t.length - 1); return [t.slice(0, c), t.slice(c)]; })() : [t];
      for (const text of parts) {
        words.push({ text, confidence: conf(), line, bbox: { x0: x, y0: line * 20, x1: x + text.length * 10, y1: line * 20 + 16 } });
        x += text.length * 10 + 10;
      }
    }
    line += chance(0.1) ? 2 + int(3) : 1;
  }
  if (chance(0.1) && words.length > 1) { const i = int(words.length); const j = int(words.length); [words[i], words[j]] = [words[j], words[i]]; }
  return words;
}

const shieldCases = Array.from({ length: 2500 }, () => {
  const words = randomWords();
  const threshold = pick([0.6, 0.6, 0.6, 0.5, 0.9]);
  const r = runShield(words, threshold);
  const plan = planRedaction(words, r, 1000, 120);
  return {
    // [text, line, confidence (null for NaN), x0, y0, x1, y1]
    words: words.map((w) => [w.text, w.line, Number.isNaN(w.confidence) ? null : w.confidence, w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1]),
    threshold,
    gstinWordIndexes: r.gstinWordIndexes,
    matches: r.matches.map((m) => ({ type: m.type, wordIndexes: m.wordIndexes })),
    uncertainReasons: r.uncertainReasons,
    uncertain: r.uncertain,
    adequate: ocrAdequate(words),
    boxes: plan.boxes.map((b) => [num(b.x0), num(b.y0), num(b.x1), num(b.y1)]),
    piiTypes: plan.piiTypes,
  };
});

// ---------------------------------------------------------------- parseExtraction

const NUMERIC_STRINGS = ['₹1,770.00', '1770/-', '₹1,770/-', 'Rs. 12', 'rs.12', 'RS 5', '0x1f', '0X1F', '-0x1f', '0o17', '0b101', ' 12 ', '', '  ',
  '1e3', '1E-3', '.5', '5.', '+5', '-5', '- 5', 'Infinity', '-Infinity', '+Infinity', 'NaN', '-', '1_000', '١٢', '12 34', '1,2,3',
  '12/-/-', '12/- ', ' 12/-', '1e400', '00012', '0.1e1', '1.2.3', 'abc', '12abc', '﻿7　', '7\u001C', '1 2', 'R s 5', 'Rs.Rs.9',
  '₹₹', '/-', '9/-x', '0', '-0', '29', '14', 'many', '1e21', '123456789012345678901234567890'];
const TEXT_STRINGS = ['Ravi Traders', ' 29aagcb7383j1z4 ', '29AAG CB7383J1Z4', '29AAG CB7383 J1Z4﻿', '4521', '2026-11-02', '29-Karnataka',
  '', '\u001CRavi\u001F', '﻿ Ravi　', 'straße', 'a,}', 'x\ny', 'é', 'Rice', '1006'];
const NUMBERS = [0, -0, 1, 1770, 1770.8, 0.9, 1.5, -3, 7, 1e21, 1e-7, 123e-20, 0.1, 2.5, 14, 1e300, 4521, 29, 100, 135, 0.30000000000000004, 5e-324, 1.7976931348623157e308];

function randomValue(depth = 0): unknown {
  switch (int(depth > 1 ? 5 : 7)) {
    case 0: case 1: return pick(NUMBERS);
    case 2: return pick(NUMERIC_STRINGS);
    case 3: return pick(TEXT_STRINGS);
    case 4: return pick([null, true, false]);
    case 5: return Array.from({ length: int(3) }, () => randomValue(depth + 1));
    default: return randomItem(depth + 1);
  }
}
function randomItem(depth: number): unknown {
  const o: Record<string, unknown> = {};
  for (const k of ['description', 'hsn', 'qty', 'rate', 'amount']) if (chance(0.7)) o[k] = randomValue(depth + 1);
  return o;
}
const FIELDS = ['supplierName', 'supplierGstin', 'invoiceNo', 'invoiceDate', 'placeOfSupply', 'taxableValue', 'cgst', 'sgst', 'igst', 'total', 'confidence', 'itemCount'];

function mutate(s: string): string {
  switch (int(12)) {
    case 0: return s.replace(/([}\]])/g, (m) => (chance(0.5) ? ',' + pick(['', ' ', '\n', ' ', '　']) + m : m));
    case 1: return 'Here you go:\n```json\n' + s + '\n```';
    case 2: return s.slice(0, int(s.length + 1));
    case 3: { const i = int(s.length); return s.slice(0, i) + pick(['"', ',', '{', '}', '[', ']', ':', '0', '\t', ' ', '01', '+', '.', '\\x']) + s.slice(i + 1); }
    case 4: return s.replace(/:/g, () => pick([':', ': ', ' :\t', ':\r\n']));
    case 5: return s.replace(/(\d)(?=[,}\]])/g, (m) => m + pick(['', '', '.', 'e', '.0', 'e5']));
    case 6: return s + ' {"total": 1}';
    case 7: return s.replace(/"(\w+)":/, (m, k) => (chance(0.5) ? k + ':' : "'" + k + "':"));
    case 8: return s.replace(/"total":[^,}]*/, '"total":1,"total":2');
    default: return s;
  }
}

const parseCases = Array.from({ length: 2000 }, () => {
  const o: Record<string, unknown> = {};
  for (const f of FIELDS) if (chance(0.75)) o[f] = randomValue();
  if (chance(0.6)) o.items = chance(0.8) ? Array.from({ length: int(4) }, () => (chance(0.8) ? randomItem(1) : randomValue(2))) : randomValue();
  const raw = mutate(JSON.stringify(o));
  const e = parseExtraction(raw);
  return {
    raw,
    expected: e === null ? null : {
      supplierName: e.supplierName, supplierGstin: e.supplierGstin, invoiceNo: e.invoiceNo, invoiceDate: e.invoiceDate, placeOfSupply: e.placeOfSupply,
      items: e.items === undefined ? null : e.items.map((i) => ({ description: i.description, hsn: i.hsn, qty: num(i.qty), rate: num(i.rate), amount: num(i.amount) })),
      itemCount: 'itemCount' in e ? num(e.itemCount!) : null,
      taxableValue: num(e.taxableValue), cgst: num(e.cgst), sgst: num(e.sgst), igst: num(e.igst), total: num(e.total), confidence: num(e.confidence),
    },
  };
});

// ---------------------------------------------------------------- parseConfig

const CONFIG_VALUES = ['smart', 'device_only', 'cloud_only', ' smart', 'SMART', 'yolo', '', ' ', ' ', '0', '0.5', '0.7', '1', '1.5', '-0', '-0.1', '7', '100', '100.5', '99.5',
  '2.5', '3.5', '0.49999999999999994', '2.4999999999999996', '0x1', '0x10', '0b1', '0o7', '1e-1', '1e2', '.5', '5.', ' 0.7 ', '﻿0.6　', '0.6\u001C', 'NaN',
  'Infinity', 'abc', '1_0', 'true', 'false', 'FALSE', ' false', 'v1', 'v2', ' v2 ', 'gemini-x', ' m ', 'toString', '__proto__'];
const CONFIG_KEYS = ['routing_mode', 'confidence_threshold', 'consent_ocr_threshold', 'total_tolerance_inr', 'max_device_line_items', 'cloud_model', 'extraction_prompt_version', 'mask_pii'];
const configCases = Array.from({ length: 600 }, () => {
  const values: Record<string, string> = {};
  for (const k of CONFIG_KEYS) if (chance(0.6)) values[k] = pick(CONFIG_VALUES);
  const isProd = chance(0.3);
  const c = parseConfig(values, isProd);
  return {
    values, isProd,
    expected: { ...c, confidenceThreshold: num(c.confidenceThreshold), consentOcrThreshold: num(c.consentOcrThreshold), totalToleranceInr: num(c.totalToleranceInr), maxDeviceLineItems: num(c.maxDeviceLineItems) },
  };
});

// ---------------------------------------------------------------- runChecks

const base: Extraction = { supplierName: 'Ravi Traders', supplierGstin: '29AAGCB7383J1Z4', invoiceNo: '4521', invoiceDate: '2026-11-02', placeOfSupply: '29-Karnataka',
  items: [{ description: 'Rice', hsn: '1006', qty: 10, rate: 100, amount: 1000 }, { description: 'Dal', hsn: '0713', qty: 5, rate: 100, amount: 500 }],
  taxableValue: 1500, cgst: 135, sgst: 135, igst: 0, total: 1770, confidence: 0.9 };
const DATES = ['2026-11-02', '2026-11-20', '2026-11-21', '2026-11-22', '2023-11-20', '2023-11-19', '2023-11-21', '2026-02-30', '2024-02-29', '2025-02-29', '2026-13-01',
  '2026-00-10', '2026-11-00', '2026-11-2', '02-11-2026', '', '2026-11-02\n', '0000-01-01', '9999-12-31', '2026-04-31', '2026-12-31', '2027-01-01'];
const POS = ['29-Karnataka', '29', ' 29 Karnataka', '27-Maharashtra', 'Karnataka', '', ' 29', '07 Delhi', '2', '٢٩', '97'];
const GSTINS = ['29AAGCB7383J1Z4', '27AAPFU0939F1ZV', '07AAACR5055K1Z9', '29AAGCB7383J1Z5', '', '29aagcb7383j1z4', '27AAPFU0939F1ZV\n', '99AAPFU0939F1ZV'];
const MONEY = [0, -0, 0.1, 0.2, 0.30000000000000004, 1, 9, 9.5, 18, 100, 118, 135, 135.5, 136, 1500, 1770, 1770.8, 1771, 1771.0000001, 1769, 270, -1, 1e-9];
const TODAYS = ['2026-11-20T10:00:00+05:30', '2026-11-21T02:00:00+05:30', '2026-11-20T18:29:59.999Z', '2026-11-20T18:30:00Z', '2026-11-21T18:29:59.999Z',
  '2024-02-29T00:00:00Z', '2027-01-01T00:00:00+05:30', '2001-01-01T00:00:00Z'];
const checksCases = Array.from({ length: 1200 }, () => {
  const e: Extraction = { ...base };
  if (chance(0.4)) e.supplierGstin = pick(GSTINS);
  if (chance(0.4)) e.placeOfSupply = pick(POS);
  if (chance(0.5)) e.invoiceDate = pick(DATES);
  if (chance(0.2)) e.invoiceNo = '';
  if (chance(0.1)) e.supplierName = '';
  if (chance(0.4)) e.items = chance(0.3) ? [] : chance(0.3) ? undefined : Array.from({ length: 1 + int(4) }, () => ({ description: 'x', hsn: '', qty: 1, rate: 1, amount: pick(MONEY) }));
  for (const k of ['taxableValue', 'cgst', 'sgst', 'igst', 'total'] as const) if (chance(0.35)) e[k] = pick(MONEY);
  if (chance(0.3)) e.confidence = pick([0, 0.1, 0.5, 0.9, 0.95, 1]);
  const today = pick(TODAYS);
  const cfg = parseConfig(chance(0.3) ? { confidence_threshold: pick(['0.5', '0.8', '0.9', '0.995']), total_tolerance_inr: pick(['0', '1', '0.5', '2']) } : {}, false);
  const r = runChecks(e, cfg, new Date(today));
  return {
    bill: { ...e, items: e.items === undefined ? null : e.items.map((i) => ({ ...i, amount: num(i.amount) })),
      taxableValue: num(e.taxableValue), cgst: num(e.cgst), sgst: num(e.sgst), igst: num(e.igst), total: num(e.total), confidence: num(e.confidence) },
    confidenceThreshold: num(cfg.confidenceThreshold), totalToleranceInr: num(cfg.totalToleranceInr), today: new Date(today).toISOString(),
    checks: r.checks, score: num(r.score), hardFail: r.hardFail, escalate: r.escalate,
  };
});

mkdirSync(OUT, { recursive: true });
// Every non-ASCII character is written as a \u escape so the files stay plain ASCII.
const ascii = (s: string) => s.replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const write = (name: string, data: unknown) => writeFileSync(resolve(OUT, name), ascii(JSON.stringify(data)) + '\n');
write('shield.json', shieldCases);
write('parse.json', parseCases);
write('config.json', configCases);
write('checks.json', checksCases);
console.log(`shield ${shieldCases.length}, parse ${parseCases.length} (null ${parseCases.filter((c) => c.expected === null).length}), config ${configCases.length}, checks ${checksCases.length}`);
console.log(`shield: with matches ${shieldCases.filter((c) => c.matches.length).length}, uncertain ${shieldCases.filter((c) => c.uncertain).length}`);
