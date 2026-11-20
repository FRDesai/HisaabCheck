# Sub-project A (Web Core + Hybrid Routing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

HisaabCheck turns GST bill photos into checked accounting data. This plan builds sub-project A of the approved spec `docs/superpowers/specs/2026-11-19-subproject-a-web-core-design.md` (requirements in the gitignored `PRD1.md`). Hackathon deadline is 30 Nov 2026; the web entry must be hosted by 23 Nov so a complete submission exists even if Android slips. The repo currently holds only the spec, `.gitignore` and the PRD — everything here is new code. On approval, this plan is also copied to `docs/superpowers/plans/2026-11-20-subproject-a-web-core.md` and committed.

**Goal:** A hosted Chrome web app where a CA signs in, picks a client shop, uploads bill photos, and each bill is read on-device (Gemini Nano) or — only after PII is blacked out of the image — in cloud Gemini, checked, saved, and counted on a live routing dashboard.

**Architecture:** A framework-free TypeScript core (`web/src/core/`) holds every rule: PII shield, redaction planning, prompts, parsing, checks, confidence and the `processBill()` cascade. It talks to the world only through adapter interfaces, so it is fully unit-tested with fakes. Thin adapters wrap Firebase AI Logic, Tesseract.js, canvas, Remote Config and Firestore; React features call `processBill()`.

**Tech Stack:** React 18 + Vite 5 + TypeScript (strict), Tailwind 3, React Router 6, Vitest 2, Firebase JS SDK 12 (`firebase/ai` hybrid), Tesseract.js 5, Firebase CLI + emulators, `@firebase/rules-unit-testing`.

## Global Constraints

- Never use `InferenceMode.PREFER_ON_DEVICE` or `PREFER_IN_CLOUD` anywhere. Device step = `ONLY_ON_DEVICE` on the raw image; cloud step = `ONLY_IN_CLOUD` on the redacted image only. A test enforces this.
- The cloud adapter must never receive the original image blob. Router tests assert it in every scenario.
- `src/core/**` must not import `react` or `firebase`.
- No PII values are ever written to Firestore or logs: route logs store counts and types only. OCR words/text live in memory for one bill.
- GSTINs are never redacted; PAN pattern must not match inside a GSTIN.
- `mask_pii` is forced `true` when `import.meta.env.PROD`.
- Remote Config defaults are bundled; fetch failure uses them; `minimumFetchIntervalMillis = 30000`.
- Device read timeout: 8000 ms. Image max side: 1600 px JPEG.
- Region asia-south1. Firebase project for this plan: `hisaabcheck-dev`.
- Exact dependency versions: install with `--save-exact`; Tesseract.js pinned to `5.1.1` (v6 changed the word output shape).
- Node 20+. Java 11+ is needed for the Firestore emulator.
- Deviation from PRD (deliberate): "GSTIN state code matches place of supply" is implemented as tax-split consistency (same state ⇒ CGST+SGST, different state ⇒ IGST), because inter-state purchases legitimately differ.

## File structure

```
.gitignore  (add node_modules, dist, .env.local, firebase debug logs)
shared/test-vectors/pii.json          PII shield fixtures (reused by Kotlin in C)
shared/test-vectors/bills.json        checks/confidence fixtures
firebase/firebase.json, .firebaserc, firestore.rules, firestore.indexes.json,
         storage.rules, remoteconfig.template.json
web/
  package.json, vite.config.ts, vitest.config.ts, vitest.rules.config.ts,
  tsconfig*.json, tailwind.config.js, postcss.config.js, index.html, .env.example
  src/core/types.ts                    shared types + adapter interfaces
  src/core/config/defaults.ts          bundled RC defaults + cost constant
  src/core/config/parseConfig.ts       string map -> Config (prod mask lock)
  src/core/shield/gstin.ts             GSTIN regex, checksum, isValidGstin, stateCode
  src/core/shield/verhoeff.ts          Aadhaar Verhoeff validation
  src/core/shield/shield.ts            runShield(words, cfg) -> ShieldResult
  src/core/redact/planRedaction.ts     matches -> padded boxes
  src/core/extract/prompts.ts          versioned prompts
  src/core/extract/parse.ts            tolerant JSON -> Extraction
  src/core/checks/checks.ts            runChecks -> CheckResult
  src/core/router/timeout.ts           withTimeout + TimeoutError
  src/core/router/processBill.ts       the cascade
  src/core/router/routeLog.ts          ProcessedBill -> RouteLogDoc (PII-free)
  src/core/stats/routeStats.ts         dashboard aggregation
  src/core/accuracy/compareFields.ts   ground truth vs extraction
  src/firebase.ts                      app, App Check, auth, db, storage, ai, rc
  src/adapters/firebaseAi.ts           DeviceModel + CloudModel
  src/adapters/tesseractOcr.ts         Ocr (lazy)
  src/adapters/canvasPainter.ts        Painter
  src/adapters/imageResize.ts          File -> ImageInput (≤1600 px)
  src/adapters/remoteConfig.ts         loadConfig()
  src/adapters/store.ts                Firestore/Storage operations
  src/features/auth/*                  AuthProvider, LoginPage, ConsentPage, RequireAuth
  src/features/shops/ShopsPage.tsx
  src/features/upload/*                UploadPage, BillCard, useBillProcessor, AiStatusChip
  src/features/preview/ConsentPreview.tsx
  src/features/result/ResultPanel.tsx
  src/features/dashboard/DashboardPage.tsx
  src/dev/accuracy/AccuracyPage.tsx    dev-only
  src/App.tsx, src/main.tsx, src/index.css
  tests/helpers.ts                     wordsFromLines
  tests/core/**.test.ts, tests/no-prefer.test.ts, tests/rules/firestore.rules.test.ts
```

---

### Task 1: Scaffold, types and config

**Files:**
- Create: `web/` (Vite scaffold), `web/vitest.config.ts`, `web/src/core/types.ts`, `web/src/core/config/defaults.ts`, `web/src/core/config/parseConfig.ts`, `web/tests/core/parseConfig.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: all types below; `DEFAULT_REMOTE_VALUES`, `CLOUD_COST_PER_CALL_USD`, `parseConfig(values: Record<string,string>, isProd: boolean): Config`

- [ ] **Step 1: Branch and scaffold**

```bash
cd /Users/fathimardesai/Desktop/Personal/HisaabCheck
git checkout -b feat/subproject-a
npm create vite@5 web -- --template react-ts
cd web
npm install --save-exact
npm install --save-exact firebase@12 react-router-dom@6 tesseract.js@5.1.1
npm install --save-exact -D vitest@2 tailwindcss@3 postcss autoprefixer @firebase/rules-unit-testing firebase-tools
npx tailwindcss init -p
```

Append to repo-root `.gitignore`:

```
node_modules/
dist/
.env.local
*-debug.log
.firebase/
```

`web/tailwind.config.js`: set `content: ['./index.html', './src/**/*.{ts,tsx}']`. Replace `web/src/index.css` with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Delete `web/src/App.css` and the Vite demo assets. In `web/tsconfig.app.json` ensure `"strict": true` and add `"resolveJsonModule": true`.

`web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/rules/**'], environment: 'node' },
});
```

Add to `web/package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 2: Write `web/src/core/types.ts`**

```ts
export type PathTaken = 'device' | 'cloud';
export type Reason =
  | 'passed' | 'total_mismatch' | 'invalid_gstin' | 'low_confidence'
  | 'device_timeout' | 'device_error' | 'invalid_json' | 'no_device_model'
  | 'cloud_only_mode' | 'cloud_error' | 'ocr_error' | 'user_kept_local';
export type BillStatus = 'draft' | 'approved' | 'rejected' | 'manual_entry';
export type RoutingMode = 'smart' | 'device_only' | 'cloud_only';
export type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';
export type PiiType = 'PAN' | 'AADHAAR' | 'PHONE' | 'BANK_ACCOUNT' | 'IFSC';

export interface LineItem { description: string; hsn: string; qty: number; rate: number; amount: number }
export interface Extraction {
  supplierName: string; supplierGstin: string; invoiceNo: string; invoiceDate: string;
  placeOfSupply: string; items?: LineItem[]; itemCount?: number;
  taxableValue: number; cgst: number; sgst: number; igst: number; total: number; confidence: number;
}
export interface Checks { total: boolean; gstin: boolean; taxSplit: boolean; date: boolean; required: boolean }
export interface CheckResult { checks: Checks; score: number; hardFail: Reason | null; escalate: boolean }

export interface Config {
  routingMode: RoutingMode; confidenceThreshold: number; consentOcrThreshold: number;
  totalToleranceInr: number; maxDeviceLineItems: number; cloudModel: string;
  extractionPromptVersion: string; maskPii: boolean;
}

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface OcrWord { text: string; bbox: Box; confidence: number /* 0–100 */; line: number }
export interface PiiMatch { type: PiiType; wordIndexes: number[] }
export interface ShieldResult { gstinWordIndexes: number[]; matches: PiiMatch[]; uncertain: boolean; uncertainReasons: string[] }
export interface RedactionPlan { boxes: Box[]; piiTypes: PiiType[]; piiMasked: number }

export interface ImageInput { blob: Blob; mimeType: 'image/jpeg' | 'image/png'; width: number; height: number }

export interface DeviceModel {
  availability(): Promise<Availability>;
  download(onProgress: (fraction: number) => void): Promise<void>;
  extract(image: ImageInput, prompt: string): Promise<string>;
}
export interface CloudModel { extract(redacted: ImageInput, prompt: string, model: string): Promise<string> }
export interface Ocr { recognize(image: Blob): Promise<OcrWord[]> }
export interface Painter { paint(image: Blob, boxes: Box[]): Promise<Blob> }
export interface Clock { now(): Date }

export interface RouteInfo { path: PathTaken; reason: Reason; confidence: number; promptVersion: string; modelName: string }
export interface ProcessedBill {
  status: BillStatus; extraction: Extraction | null; checks: Checks | null; route: RouteInfo;
  piiTypes: PiiType[]; piiMasked: number; latencyMs: number; estCostUsd: number; redactedImage: Blob | null;
}
export type Step = 'availability' | 'device_read' | 'checking' | 'redacting' | 'awaiting_consent' | 'cloud_read' | 'done';
export type ConsentResult = { send: true; image: Blob } | { send: false };
```

- [ ] **Step 3: Write the failing config test** `web/tests/core/parseConfig.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseConfig } from '../../src/core/config/parseConfig';

describe('parseConfig', () => {
  it('uses bundled defaults for an empty map', () => {
    expect(parseConfig({}, false)).toEqual({
      routingMode: 'smart', confidenceThreshold: 0.8, consentOcrThreshold: 0.6,
      totalToleranceInr: 1, maxDeviceLineItems: 10, cloudModel: 'gemini-3.1-flash-lite',
      extractionPromptVersion: 'v1', maskPii: true,
    });
  });
  it('reads valid overrides', () => {
    const c = parseConfig({ routing_mode: 'device_only', confidence_threshold: '0.7', max_device_line_items: '5' }, false);
    expect(c.routingMode).toBe('device_only');
    expect(c.confidenceThreshold).toBe(0.7);
    expect(c.maxDeviceLineItems).toBe(5);
  });
  it('falls back per key on invalid values', () => {
    const c = parseConfig({ routing_mode: 'yolo', confidence_threshold: '7', total_tolerance_inr: 'abc' }, false);
    expect(c.routingMode).toBe('smart');
    expect(c.confidenceThreshold).toBe(0.8);
    expect(c.totalToleranceInr).toBe(1);
  });
  it('allows mask_pii=false only outside prod', () => {
    expect(parseConfig({ mask_pii: 'false' }, false).maskPii).toBe(false);
    expect(parseConfig({ mask_pii: 'false' }, true).maskPii).toBe(true);
  });
});
```

- [ ] **Step 4: Run it, expect FAIL** — `cd web && npx vitest run tests/core/parseConfig.test.ts` → "Cannot find module".

- [ ] **Step 5: Implement**

`web/src/core/config/defaults.ts`:

```ts
export const DEFAULT_REMOTE_VALUES: Record<string, string> = {
  routing_mode: 'smart',
  confidence_threshold: '0.8',
  consent_ocr_threshold: '0.6',
  total_tolerance_inr: '1',
  max_device_line_items: '10',
  cloud_model: 'gemini-3.1-flash-lite',
  extraction_prompt_version: 'v1',
  mask_pii: 'true',
};
/** Estimated cost of one cloud read; replace with the measured value from the accuracy run. */
export const CLOUD_COST_PER_CALL_USD = 0.0003;
export const DEVICE_TIMEOUT_MS = 8000;
```

`web/src/core/config/parseConfig.ts`:

```ts
import type { Config, RoutingMode } from '../types';
import { DEFAULT_REMOTE_VALUES as D } from './defaults';

function num(v: string | undefined, def: string, min: number, max: number): number {
  const n = Number(v);
  return v !== undefined && v.trim() !== '' && Number.isFinite(n) && n >= min && n <= max ? n : Number(def);
}

export function parseConfig(values: Record<string, string>, isProd: boolean): Config {
  const mode = values.routing_mode;
  const routingMode: RoutingMode =
    mode === 'smart' || mode === 'device_only' || mode === 'cloud_only' ? mode : (D.routing_mode as RoutingMode);
  return {
    routingMode,
    confidenceThreshold: num(values.confidence_threshold, D.confidence_threshold, 0, 1),
    consentOcrThreshold: num(values.consent_ocr_threshold, D.consent_ocr_threshold, 0, 1),
    totalToleranceInr: num(values.total_tolerance_inr, D.total_tolerance_inr, 0, 100),
    maxDeviceLineItems: Math.round(num(values.max_device_line_items, D.max_device_line_items, 0, 100)),
    cloudModel: values.cloud_model?.trim() || D.cloud_model,
    extractionPromptVersion: values.extraction_prompt_version?.trim() || D.extraction_prompt_version,
    maskPii: isProd ? true : (values.mask_pii ?? D.mask_pii) !== 'false',
  };
}
```

- [ ] **Step 6: Run, expect PASS** — `npx vitest run tests/core/parseConfig.test.ts`.

- [ ] **Step 7: Commit**

```bash
cd .. && git add .gitignore web && git commit -m "chore: scaffold web app, core types and config parsing"
```

---

### Task 2: GSTIN and Verhoeff checksums + shared vectors

**Files:**
- Create: `web/src/core/shield/gstin.ts`, `web/src/core/shield/verhoeff.ts`, `web/tests/core/checksums.test.ts`

**Interfaces:**
- Produces: `GSTIN_PATTERN: RegExp` (global, unanchored), `gstinCheckChar(first14: string): string`, `isValidGstin(g: string): boolean`, `gstinStateCode(g: string): number`, `placeOfSupplyCode(pos: string): number | null`, `isValidVerhoeff(digits: string): boolean`

- [ ] **Step 1: Failing test** `web/tests/core/checksums.test.ts` (values below were computed and verified)

```ts
import { describe, it, expect } from 'vitest';
import { isValidGstin, gstinCheckChar, gstinStateCode, placeOfSupplyCode } from '../../src/core/shield/gstin';
import { isValidVerhoeff } from '../../src/core/shield/verhoeff';

describe('GSTIN', () => {
  it.each(['27AAPFU0939F1ZV', '29AAGCB7383J1Z4', '07AAACR5055K1Z9', '33ABCDE1234F1Z7'])('accepts %s', (g) => {
    expect(isValidGstin(g)).toBe(true);
  });
  it.each(['29AAGCB7383J1Z5', '27AAPFU0939F1Z', '99AAPFU0939F1ZV', '27aapfu0939f1zv0'])('rejects %s', (g) => {
    expect(isValidGstin(g)).toBe(false);
  });
  it('computes the check character', () => expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V'));
  it('reads state code', () => expect(gstinStateCode('29AAGCB7383J1Z4')).toBe(29));
  it('parses place of supply', () => {
    expect(placeOfSupplyCode('29-Karnataka')).toBe(29);
    expect(placeOfSupplyCode(' 07 Delhi')).toBe(7);
    expect(placeOfSupplyCode('Karnataka')).toBeNull();
  });
});

describe('Verhoeff', () => {
  it.each(['234123412346', '498765432102', '567812345678'])('accepts %s', (d) => expect(isValidVerhoeff(d)).toBe(true));
  it.each(['234123412340', '234123412341'])('rejects %s', (d) => expect(isValidVerhoeff(d)).toBe(false));
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/core/checksums.test.ts`.

- [ ] **Step 3: Implement**

`web/src/core/shield/gstin.ts`:

```ts
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** Unanchored, for finding GSTINs in upper-cased text. Create a new RegExp per use (global state). */
export const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;

export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export function gstinStateCode(g: string): number {
  return Number(g.slice(0, 2));
}

function validState(code: number): boolean {
  return (code >= 1 && code <= 38) || code === 97;
}

export function isValidGstin(g: string): boolean {
  if (!SHAPE.test(g)) return false;
  if (!validState(gstinStateCode(g))) return false;
  return gstinCheckChar(g.slice(0, 14)) === g[14];
}

export function placeOfSupplyCode(pos: string): number | null {
  const m = /^\s*(\d{2})/.exec(pos ?? '');
  return m ? Number(m[1]) : null;
}
```

`web/src/core/shield/verhoeff.ts`:

```ts
const D = [
  [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],
  [4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],
  [8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0],
];
const P = [
  [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
  [9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8],
];

export function isValidVerhoeff(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  const a = digits.split('').reverse().map(Number);
  for (let i = 0; i < a.length; i++) c = D[c][P[i % 8][a[i]]];
  return c === 0;
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git add web && git commit -m "feat(core): GSTIN and Verhoeff checksums"`

---

### Task 3: Privacy shield

**Files:**
- Create: `shared/test-vectors/pii.json`, `web/tests/helpers.ts`, `web/src/core/shield/shield.ts`, `web/tests/core/shield.test.ts`

**Interfaces:**
- Consumes: `GSTIN_PATTERN`, `isValidVerhoeff`, types `OcrWord`, `ShieldResult`, `Config`
- Produces: `runShield(words: OcrWord[], consentOcrThreshold: number): ShieldResult`; test helper `wordsFromLines(lines: string[], confidence?: number): OcrWord[]`

- [ ] **Step 1: Write `shared/test-vectors/pii.json`**

```json
[
  { "name": "gstin only", "lines": ["GSTIN: 27AAPFU0939F1ZV"], "types": [], "gstinWords": 1, "uncertain": false },
  { "name": "pan alone", "lines": ["PAN: AAPFU0939F"], "types": ["PAN"], "gstinWords": 0, "uncertain": false },
  { "name": "gstin next to pan", "lines": ["GSTIN 27AAPFU0939F1ZV PAN AAPFU0939F"], "types": ["PAN"], "gstinWords": 1, "uncertain": false },
  { "name": "spaced aadhaar", "lines": ["Aadhaar No 2341 2341 2346"], "types": ["AADHAAR"], "gstinWords": 0, "uncertain": false },
  { "name": "invalid verhoeff is not aadhaar", "lines": ["Ref 2341 2341 2340"], "types": [], "gstinWords": 0, "uncertain": false },
  { "name": "mobile with country code", "lines": ["Mob: +91 98450 12345"], "types": ["PHONE"], "gstinWords": 0, "uncertain": false },
  { "name": "labelled landline", "lines": ["Ph: 080-2345 6789"], "types": ["PHONE"], "gstinWords": 0, "uncertain": false },
  { "name": "bank and ifsc", "lines": ["A/c No: 123456789012", "IFSC: HDFC0001234"], "types": ["BANK_ACCOUNT", "IFSC"], "gstinWords": 0, "uncertain": false },
  { "name": "bank number on line after label", "lines": ["Bank Account Details", "50100234567890"], "types": ["BANK_ACCOUNT"], "gstinWords": 0, "uncertain": false },
  { "name": "label without value", "lines": ["PAN No: ____"], "types": [], "gstinWords": 0, "uncertain": true },
  { "name": "partial pan", "lines": ["ABCDE12 smudge"], "types": [], "gstinWords": 0, "uncertain": true },
  { "name": "low confidence digits", "lines": ["Contact 98450 1Z345"], "confidence": 40, "types": [], "gstinWords": 0, "uncertain": true },
  { "name": "invoice number and date are not pii", "lines": ["Invoice No: 4521 Date: 2026-11-02"], "types": [], "gstinWords": 0, "uncertain": false }
]
```

- [ ] **Step 2: Write `web/tests/helpers.ts`**

```ts
import type { OcrWord } from '../src/core/types';

/** Splits each line on spaces; each word gets a 10px-per-char box on its own row. */
export function wordsFromLines(lines: string[], confidence = 95): OcrWord[] {
  const out: OcrWord[] = [];
  lines.forEach((line, li) => {
    let x = 0;
    for (const text of line.split(' ').filter(Boolean)) {
      out.push({ text, confidence, line: li, bbox: { x0: x, y0: li * 20, x1: x + text.length * 10, y1: li * 20 + 16 } });
      x += text.length * 10 + 10;
    }
  });
  return out;
}
```

- [ ] **Step 3: Failing test** `web/tests/core/shield.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import vectors from '../../../shared/test-vectors/pii.json';
import { runShield } from '../../src/core/shield/shield';
import { wordsFromLines } from '../helpers';

describe('runShield vectors', () => {
  for (const v of vectors as Array<{ name: string; lines: string[]; confidence?: number; types: string[]; gstinWords: number; uncertain: boolean }>) {
    it(v.name, () => {
      const r = runShield(wordsFromLines(v.lines, v.confidence ?? 95), 0.6);
      expect(r.matches.map((m) => m.type).sort()).toEqual([...v.types].sort());
      expect(r.gstinWordIndexes.length).toBe(v.gstinWords);
      expect(r.uncertain).toBe(v.uncertain);
    });
  }
  it('never puts a GSTIN word inside a PII match', () => {
    const r = runShield(wordsFromLines(['GSTIN 27AAPFU0939F1ZV PAN AAPFU0939F']), 0.6);
    const piiWords = r.matches.flatMap((m) => m.wordIndexes);
    expect(piiWords).not.toContain(r.gstinWordIndexes[0]);
  });
  it('maps a spaced aadhaar to all three words', () => {
    const r = runShield(wordsFromLines(['Aadhaar No 2341 2341 2346']), 0.6);
    expect(r.matches[0].wordIndexes).toEqual([2, 3, 4]);
  });
});
```

- [ ] **Step 4: Run, expect FAIL.**

- [ ] **Step 5: Implement `web/src/core/shield/shield.ts`**

```ts
import type { OcrWord, PiiMatch, PiiType, ShieldResult } from '../types';
import { GSTIN_PATTERN } from './gstin';
import { isValidVerhoeff } from './verhoeff';

interface Line { text: string; spans: Array<{ word: number; start: number; end: number }> }

function buildLines(words: OcrWord[]): Line[] {
  const lines: Line[] = [];
  words.forEach((w, i) => {
    const line = (lines[w.line] ??= { text: '', spans: [] });
    if (line.text) line.text += ' ';
    const start = line.text.length;
    line.text += w.text.toUpperCase();
    line.spans.push({ word: i, start, end: line.text.length });
  });
  return lines.map((l) => l ?? { text: '', spans: [] });
}

function wordsIn(line: Line, start: number, end: number): number[] {
  return line.spans.filter((s) => s.start < end && s.end > start).map((s) => s.word);
}

const PAN = /\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b/g;
const AADHAAR = /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/g;
const IFSC = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;
const MOBILE = /(?:\+?91[\s-]?)?\b[6-9]\d{4}\s?\d{5}\b/g;
const LANDLINE = /\b0\d{2,4}[\s-]?\d{3,4}[\s-]?\d{4}\b/g;
const BANK = /\b\d{9,18}\b/g;
const PHONE_LABEL = /\b(MOB(ILE)?|PH(ONE)?|TEL|CONTACT)\b/;
const BANK_LABEL = /(\bA\/C\b|\bACCOUNT\b|\bACC\.?\s*NO\b)/;
const ANY_LABEL = /(\bPAN\b|\bAADHAA?R\b|\bA\/C\b|\bACCOUNT\b|\bMOB(ILE)?\b|\bPH(ONE)?\b|\bTEL\b|\bCONTACT\b|\bIFSC\b)/;
const PARTIAL = /\b[A-Z]{5}\d{1,3}\b/;
const PII_LIKE = /\d{3,}|[A-Z]{3,}\d/;

export function runShield(words: OcrWord[], consentOcrThreshold: number): ShieldResult {
  const lines = buildLines(words);
  const gstinWords = new Set<number>();
  const claimed = new Set<number>();
  const matches: PiiMatch[] = [];
  const reasons: string[] = [];

  const find = (li: number, re: RegExp, type: PiiType, ok: (m: string) => boolean = () => true) => {
    const line = lines[li];
    for (const m of line.text.matchAll(new RegExp(re.source, 'g'))) {
      const idx = wordsIn(line, m.index!, m.index! + m[0].length);
      if (idx.some((i) => claimed.has(i) || gstinWords.has(i)) || !ok(m[0])) continue;
      idx.forEach((i) => claimed.add(i));
      matches.push({ type, wordIndexes: idx });
    }
  };

  lines.forEach((line) => {
    for (const m of line.text.matchAll(new RegExp(GSTIN_PATTERN.source, 'g'))) {
      wordsIn(line, m.index!, m.index! + m[0].length).forEach((i) => gstinWords.add(i));
    }
  });

  lines.forEach((line, li) => {
    const prev = lines[li - 1]?.text ?? '';
    find(li, AADHAAR, 'AADHAAR', (s) => isValidVerhoeff(s.replace(/\s/g, '')));
    find(li, IFSC, 'IFSC');
    find(li, PAN, 'PAN');
    find(li, MOBILE, 'PHONE');
    if (PHONE_LABEL.test(line.text)) find(li, LANDLINE, 'PHONE');
    if (BANK_LABEL.test(line.text) || BANK_LABEL.test(prev)) find(li, BANK, 'BANK_ACCOUNT');
  });

  const lineHasMatch = (li: number) =>
    matches.some((m) => m.wordIndexes.some((i) => words[i].line === li));
  lines.forEach((line, li) => {
    if (ANY_LABEL.test(line.text) && !lineHasMatch(li) && !lineHasMatch(li + 1)) reasons.push(`label_without_value:${li}`);
    for (const s of line.spans) {
      if (claimed.has(s.word) || gstinWords.has(s.word)) continue;
      const t = line.text.slice(s.start, s.end);
      if (PARTIAL.test(t)) reasons.push(`partial_match:${s.word}`);
      else if (words[s.word].confidence < consentOcrThreshold * 100 && PII_LIKE.test(t)) reasons.push(`low_ocr_confidence:${s.word}`);
    }
  });

  return { gstinWordIndexes: [...gstinWords], matches, uncertain: reasons.length > 0, uncertainReasons: reasons };
}
```

Note: the "bank number on line after label" vector depends on the previous line containing `ACCOUNT`; the label-without-value rule checks the same line and the next line, so that vector is not flagged uncertain.

- [ ] **Step 6: Run, expect PASS.** If a vector fails, fix the code, not the vector, unless the vector contradicts the spec (then stop and report).
- [ ] **Step 7: Commit** — `git add shared web && git commit -m "feat(core): privacy shield with GSTIN allow-list and uncertainty"`

---

### Task 4: Redaction planning

**Files:**
- Create: `web/src/core/redact/planRedaction.ts`, `web/tests/core/planRedaction.test.ts`

**Interfaces:**
- Produces: `planRedaction(words: OcrWord[], shield: ShieldResult, width: number, height: number, pad?: number): RedactionPlan`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { planRedaction } from '../../src/core/redact/planRedaction';
import { runShield } from '../../src/core/shield/shield';
import { wordsFromLines } from '../helpers';

describe('planRedaction', () => {
  it('unions the words of one match and pads, clamped to the image', () => {
    const words = wordsFromLines(['Aadhaar No 2341 2341 2346']);
    const plan = planRedaction(words, runShield(words, 0.6), 1000, 1000);
    expect(plan.boxes).toHaveLength(1);
    const first = words[2].bbox, last = words[4].bbox;
    expect(plan.boxes[0]).toEqual({ x0: first.x0 - 4 < 0 ? 0 : first.x0 - 4, y0: 0, x1: last.x1 + 4, y1: last.y1 + 4 });
    expect(plan.piiTypes).toEqual(['AADHAAR']);
    expect(plan.piiMasked).toBe(1);
  });
  it('produces no boxes for a GSTIN-only bill', () => {
    const words = wordsFromLines(['GSTIN 27AAPFU0939F1ZV']);
    expect(planRedaction(words, runShield(words, 0.6), 1000, 1000).boxes).toEqual([]);
  });
  it('lists each type once', () => {
    const words = wordsFromLines(['PAN AAPFU0939F', 'PAN BBBPB1234C']);
    const plan = planRedaction(words, runShield(words, 0.6), 1000, 1000);
    expect(plan.piiTypes).toEqual(['PAN']);
    expect(plan.piiMasked).toBe(2);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**

```ts
import type { Box, OcrWord, PiiType, RedactionPlan, ShieldResult } from '../types';

export function planRedaction(words: OcrWord[], shield: ShieldResult, width: number, height: number, pad = 4): RedactionPlan {
  const boxes: Box[] = shield.matches.map((m) => {
    const bs = m.wordIndexes.map((i) => words[i].bbox);
    return {
      x0: Math.max(0, Math.min(...bs.map((b) => b.x0)) - pad),
      y0: Math.max(0, Math.min(...bs.map((b) => b.y0)) - pad),
      x1: Math.min(width, Math.max(...bs.map((b) => b.x1)) + pad),
      y1: Math.min(height, Math.max(...bs.map((b) => b.y1)) + pad),
    };
  });
  const piiTypes = [...new Set(shield.matches.map((m) => m.type))] as PiiType[];
  return { boxes, piiTypes, piiMasked: shield.matches.length };
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git add web && git commit -m "feat(core): redaction planning"`

---

### Task 5: Prompts and tolerant parsing

**Files:**
- Create: `web/src/core/extract/prompts.ts`, `web/src/core/extract/parse.ts`, `web/tests/core/parse.test.ts`

**Interfaces:**
- Produces: `devicePrompt(cfg: Config): string`, `cloudPrompt(cfg: Config): string`, `parseExtraction(raw: string): Extraction | null`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseExtraction } from '../../src/core/extract/parse';
import { devicePrompt, cloudPrompt } from '../../src/core/extract/prompts';
import { parseConfig } from '../../src/core/config/parseConfig';

const base = { supplierName: 'Ravi Traders', supplierGstin: '29AAGCB7383J1Z4', invoiceNo: '4521', invoiceDate: '2026-11-02',
  placeOfSupply: '29-Karnataka', taxableValue: 1500, cgst: 135, sgst: 135, igst: 0, total: 1770, confidence: 0.9 };

describe('parseExtraction', () => {
  it('parses plain JSON', () => expect(parseExtraction(JSON.stringify(base))?.total).toBe(1770));
  it('strips code fences and prose', () => {
    expect(parseExtraction('Here you go:\n```json\n' + JSON.stringify(base) + '\n```')?.invoiceNo).toBe('4521');
  });
  it('removes trailing commas', () => {
    expect(parseExtraction('{"supplierName":"A","total":5,}')?.total).toBe(5);
  });
  it('coerces numeric strings with commas and ₹', () => {
    expect(parseExtraction(JSON.stringify({ ...base, total: '₹1,770.00' }))?.total).toBe(1770);
  });
  it('defaults missing fields', () => {
    const e = parseExtraction('{"total": 10}')!;
    expect(e.supplierGstin).toBe('');
    expect(e.cgst).toBe(0);
    expect(e.items).toBeUndefined();
  });
  it('upper-cases and trims the GSTIN', () => {
    expect(parseExtraction(JSON.stringify({ ...base, supplierGstin: ' 29aagcb7383j1z4 ' }))?.supplierGstin).toBe('29AAGCB7383J1Z4');
  });
  it('returns null for garbage', () => expect(parseExtraction('sorry, cannot read')).toBeNull());
  it('parses items', () => {
    const e = parseExtraction(JSON.stringify({ ...base, items: [{ description: 'Rice', hsn: '1006', qty: '2', rate: 50, amount: '100' }] }))!;
    expect(e.items).toEqual([{ description: 'Rice', hsn: '1006', qty: 2, rate: 50, amount: 100 }]);
  });
});

describe('prompts', () => {
  it('device prompt mentions the item limit', () => {
    expect(devicePrompt({ ...parseConfig({}, false), maxDeviceLineItems: 7 })).toContain('7 or fewer');
  });
  it('cloud prompt always asks for items', () => expect(cloudPrompt(parseConfig({}, false))).toContain('"items"'));
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**

`web/src/core/extract/prompts.ts`:

```ts
import type { Config } from '../types';

const FIELDS =
  'supplierName, supplierGstin (15 characters), invoiceNo, invoiceDate (YYYY-MM-DD), placeOfSupply (as printed, e.g. "29-Karnataka"), ' +
  'itemCount (number of line items), taxableValue, cgst, sgst, igst, total (numbers in rupees, no commas or symbols), ' +
  'confidence (0 to 1, how sure you are)';
const RULES = 'Use 0 for a missing tax and "" for missing text. Return ONLY one JSON object, no prose, no code fences.';

const V1 = {
  device: (max: number) =>
    `You read Indian GST purchase bills. Read this bill and return JSON with keys: ${FIELDS}. ` +
    `If itemCount is ${max} or fewer, also include "items": [{description, hsn, qty, rate, amount}]; otherwise omit "items". ${RULES}`,
  cloud: () =>
    `You read Indian GST purchase bills. Some private numbers are blacked out; ignore them. Return JSON with keys: ${FIELDS}, ` +
    `and "items": [{description, hsn, qty, rate, amount}] for every line item. ${RULES}`,
};
const VERSIONS: Record<string, typeof V1> = { v1: V1 };

const pick = (cfg: Config) => VERSIONS[cfg.extractionPromptVersion] ?? V1;
export const devicePrompt = (cfg: Config) => pick(cfg).device(cfg.maxDeviceLineItems);
export const cloudPrompt = (cfg: Config) => pick(cfg).cloud();
```

`web/src/core/extract/parse.ts`:

```ts
import type { Extraction, LineItem } from '../types';

const toNum = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') { const n = Number(v.replace(/[₹,\s]|Rs\.?/gi, '')); return Number.isFinite(n) ? n : 0; }
  return 0;
};
const toStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

export function parseExtraction(raw: string): Extraction | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const body = raw.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
  let o: Record<string, unknown>;
  try { o = JSON.parse(body); } catch { return null; }
  if (typeof o !== 'object' || o === null) return null;
  const items = Array.isArray(o.items)
    ? (o.items as Record<string, unknown>[]).map((it): LineItem => ({
        description: toStr(it.description), hsn: toStr(it.hsn), qty: toNum(it.qty), rate: toNum(it.rate), amount: toNum(it.amount),
      }))
    : undefined;
  return {
    supplierName: toStr(o.supplierName),
    supplierGstin: toStr(o.supplierGstin).toUpperCase().replace(/\s/g, ''),
    invoiceNo: toStr(o.invoiceNo),
    invoiceDate: toStr(o.invoiceDate),
    placeOfSupply: toStr(o.placeOfSupply),
    ...(items ? { items } : {}),
    ...(o.itemCount !== undefined ? { itemCount: toNum(o.itemCount) } : {}),
    taxableValue: toNum(o.taxableValue), cgst: toNum(o.cgst), sgst: toNum(o.sgst), igst: toNum(o.igst),
    total: toNum(o.total), confidence: Math.min(1, Math.max(0, toNum(o.confidence))),
  };
}
```

- [ ] **Step 4: Run, expect PASS.** — **Step 5: Commit** `feat(core): versioned prompts and tolerant JSON parsing`

---

### Task 6: Checks and confidence

**Files:**
- Create: `shared/test-vectors/bills.json`, `web/src/core/checks/checks.ts`, `web/tests/core/checks.test.ts`

**Interfaces:**
- Consumes: `isValidGstin`, `gstinStateCode`, `placeOfSupplyCode`
- Produces: `runChecks(e: Extraction, cfg: Config, today: Date): CheckResult`, `WEIGHTS`

- [ ] **Step 1: Write `shared/test-vectors/bills.json`** (today = 2026-11-20, threshold 0.8, tolerance 1)

```json
[
  { "name": "intra-state valid", "bill": { "supplierName": "Ravi Traders", "supplierGstin": "29AAGCB7383J1Z4", "invoiceNo": "4521", "invoiceDate": "2026-11-02", "placeOfSupply": "29-Karnataka", "items": [{"description":"Rice","hsn":"1006","qty":10,"rate":100,"amount":1000},{"description":"Dal","hsn":"0713","qty":5,"rate":100,"amount":500}], "taxableValue": 1500, "cgst": 135, "sgst": 135, "igst": 0, "total": 1770, "confidence": 0.9 },
    "checks": { "total": true, "gstin": true, "taxSplit": true, "date": true, "required": true }, "score": 0.995, "hardFail": null, "escalate": false },
  { "name": "total mismatch", "patch": { "total": 1870 }, "checks": { "total": false, "gstin": true, "taxSplit": true, "date": true, "required": true }, "score": 0.645, "hardFail": "total_mismatch", "escalate": true },
  { "name": "bad gstin checksum", "patch": { "supplierGstin": "29AAGCB7383J1Z5" }, "checks": { "total": true, "gstin": false, "taxSplit": false, "date": true, "required": true }, "score": 0.595, "hardFail": "invalid_gstin", "escalate": true },
  { "name": "inter-state igst", "patch": { "supplierGstin": "27AAPFU0939F1ZV", "cgst": 0, "sgst": 0, "igst": 270 }, "checks": { "total": true, "gstin": true, "taxSplit": true, "date": true, "required": true }, "score": 0.995, "hardFail": null, "escalate": false },
  { "name": "inter-state wrongly split", "patch": { "supplierGstin": "27AAPFU0939F1ZV" }, "checks": { "total": true, "gstin": true, "taxSplit": false, "date": true, "required": true }, "score": 0.845, "hardFail": null, "escalate": false },
  { "name": "future date", "patch": { "invoiceDate": "2026-12-01" }, "checks": { "total": true, "gstin": true, "taxSplit": true, "date": false, "required": true }, "score": 0.895, "hardFail": null, "escalate": false },
  { "name": "totals only read", "patch": { "items": null, "itemCount": 14, "taxableValue": 10000, "cgst": 900, "sgst": 900, "total": 11800 }, "checks": { "total": true, "gstin": true, "taxSplit": true, "date": true, "required": true }, "score": 0.995, "hardFail": null, "escalate": false },
  { "name": "rounding within tolerance", "patch": { "total": 1770.8 }, "checks": { "total": true, "gstin": true, "taxSplit": true, "date": true, "required": true }, "score": 0.995, "hardFail": null, "escalate": false },
  { "name": "two soft failures escalate", "patch": { "invoiceDate": "2026-12-01", "invoiceNo": "" }, "checks": { "total": true, "gstin": true, "taxSplit": true, "date": false, "required": false }, "score": 0.795, "hardFail": null, "escalate": true },
  { "name": "exempt bill with zero tax", "patch": { "cgst": 0, "sgst": 0, "total": 1500 }, "checks": { "total": true, "gstin": true, "taxSplit": true, "date": true, "required": true }, "score": 0.995, "hardFail": null, "escalate": false }
]
```

Score arithmetic: total .35, gstin .25, taxSplit .15, date .10, required .10, plus .05 × model confidence (0.9 → .045). A bad GSTIN also fails taxSplit when the state cannot be derived — see implementation: taxSplit uses the GSTIN state only when the GSTIN is valid, otherwise it requires a valid GSTIN and returns false. (Patch semantics: start from vector 1's bill; a `null` value deletes the key.)

- [ ] **Step 2: Failing test** `web/tests/core/checks.test.ts`

```ts
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
```

- [ ] **Step 3: Run, expect FAIL.**
- [ ] **Step 4: Implement `web/src/core/checks/checks.ts`**

```ts
import type { CheckResult, Checks, Config, Extraction, Reason } from '../types';
import { gstinStateCode, isValidGstin, placeOfSupplyCode } from '../shield/gstin';

export const WEIGHTS = { total: 0.35, gstin: 0.25, taxSplit: 0.15, date: 0.1, required: 0.1, model: 0.05 } as const;

function totalOk(e: Extraction, tol: number): boolean {
  const tax = e.cgst + e.sgst + e.igst;
  const base = e.items && e.items.length > 0 ? e.items.reduce((s, i) => s + i.amount, 0) : e.taxableValue;
  return e.total > 0 && Math.abs(base + tax - e.total) <= tol;
}

function taxSplitOk(e: Extraction, gstinValid: boolean): boolean {
  if (!gstinValid) return false;
  const allZero = e.cgst === 0 && e.sgst === 0 && e.igst === 0;
  const split = e.cgst > 0 && Math.abs(e.cgst - e.sgst) <= 1 && e.igst === 0;
  const igstOnly = e.cgst === 0 && e.sgst === 0 && e.igst > 0;
  const pos = placeOfSupplyCode(e.placeOfSupply);
  if (pos === null) return allZero || split || igstOnly;
  const sameState = pos === gstinStateCode(e.supplierGstin);
  return allZero || (sameState ? split : igstOnly);
}

function dateOk(d: string, today: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d) return false;
  const todayStr = today.toISOString().slice(0, 10);
  const minStr = `${today.getUTCFullYear() - 3}${todayStr.slice(4)}`;
  return d <= todayStr && d >= minStr;
}

export function runChecks(e: Extraction, cfg: Config, today: Date): CheckResult {
  const gstin = isValidGstin(e.supplierGstin);
  const checks: Checks = {
    total: totalOk(e, cfg.totalToleranceInr),
    gstin,
    taxSplit: taxSplitOk(e, gstin),
    date: dateOk(e.invoiceDate, today),
    required: [e.supplierName, e.supplierGstin, e.invoiceNo, e.invoiceDate].every((s) => s.length > 0) && e.total > 0,
  };
  let score = WEIGHTS.model * e.confidence;
  for (const k of Object.keys(checks) as (keyof Checks)[]) if (checks[k]) score += WEIGHTS[k];
  const hardFail: Reason | null = !checks.total ? 'total_mismatch' : !checks.gstin ? 'invalid_gstin' : null;
  return { checks, score, hardFail, escalate: hardFail !== null || score < cfg.confidenceThreshold };
}
```

Note on `today`: tests use `2026-11-20T10:00:00+05:30` (= 04:30 UTC same day). Date comparison uses UTC date strings; IST bills dated "today" are accepted because the UTC date at 05:30+ IST is the same calendar day.

- [ ] **Step 5: Run, expect PASS.** If a score differs, recheck vector arithmetic against `WEIGHTS` before changing code.
- [ ] **Step 6: Commit** — `feat(core): GST checks and check-based confidence`

---

### Task 7: Router cascade + PII-free route log + no-PREFER guard

**Files:**
- Create: `web/src/core/router/timeout.ts`, `web/src/core/router/processBill.ts`, `web/src/core/router/routeLog.ts`, `web/tests/core/processBill.test.ts`, `web/tests/core/routeLog.test.ts`, `web/tests/no-prefer.test.ts`

**Interfaces:**
- Consumes: everything in Tasks 1–6
- Produces:
  - `interface RouterDeps { device: DeviceModel; cloud: CloudModel; ocr: Ocr; painter: Painter; config: Config; clock: Clock; deviceTimeoutMs?: number }`
  - `interface RouterHooks { onStep(step: Step): void; askConsent(redacted: Blob, plan: RedactionPlan): Promise<ConsentResult> }`
  - `processBill(img: ImageInput, deps: RouterDeps, hooks: RouterHooks): Promise<ProcessedBill>`
  - `interface RouteLogDoc { billId: string; shopId: string; caUid: string; platform: 'web'; path: PathTaken; reason: Reason; piiMasked: number; piiTypes: PiiType[]; latencyMs: number; estCostUsd: number; modelName: string; promptVersion: string; createdAt: Date }`
  - `ROUTE_LOG_KEYS: readonly string[]`, `toRouteLog(p: ProcessedBill, ids: { billId: string; shopId: string; caUid: string }, now: Date): RouteLogDoc`

- [ ] **Step 1: Failing router test** `web/tests/core/processBill.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { processBill, type RouterDeps } from '../../src/core/router/processBill';
import { parseConfig } from '../../src/core/config/parseConfig';
import type { Availability, Config, ImageInput, OcrWord } from '../../src/core/types';
import { wordsFromLines } from '../helpers';

const RAW = new Blob(['raw'], { type: 'image/jpeg' });
const REDACTED = new Blob(['redacted'], { type: 'image/jpeg' });
const CONSENTED = new Blob(['consented'], { type: 'image/jpeg' });
const IMG: ImageInput = { blob: RAW, mimeType: 'image/jpeg', width: 1000, height: 1000 };
const GOOD = JSON.stringify({ supplierName: 'Ravi Traders', supplierGstin: '29AAGCB7383J1Z4', invoiceNo: '4521',
  invoiceDate: '2026-11-02', placeOfSupply: '29-Karnataka', taxableValue: 1500, cgst: 135, sgst: 135, igst: 0, total: 1770, confidence: 0.9 });
const BAD_TOTAL = GOOD.replace('"total":1770', '"total":1870');

interface Opts { avail?: Availability; deviceOut?: string; deviceThrows?: boolean; deviceDelayMs?: number;
  cloudOut?: string; cloudThrows?: boolean; ocrWords?: OcrWord[]; ocrThrows?: boolean; config?: Partial<Config> }

function setup(o: Opts = {}) {
  const calls = { device: 0, cloud: [] as Blob[], paint: 0 };
  const deps: RouterDeps = {
    device: {
      availability: async () => o.avail ?? 'available',
      download: async () => {},
      extract: async () => {
        calls.device++;
        if (o.deviceDelayMs) await new Promise((r) => setTimeout(r, o.deviceDelayMs));
        if (o.deviceThrows) throw new Error('boom');
        return o.deviceOut ?? GOOD;
      },
    },
    cloud: { extract: async (img) => { calls.cloud.push(img.blob); if (o.cloudThrows) throw new Error('net'); return o.cloudOut ?? GOOD; } },
    ocr: { recognize: async () => { if (o.ocrThrows) throw new Error('ocr'); return o.ocrWords ?? wordsFromLines(['PAN: AAPFU0939F']); } },
    painter: { paint: async () => { calls.paint++; return REDACTED; } },
    config: { ...parseConfig({}, false), ...o.config },
    clock: { now: () => new Date('2026-11-20T10:00:00+05:30') },
    deviceTimeoutMs: 50,
  };
  const hooks = { onStep: vi.fn(), askConsent: vi.fn(async () => ({ send: true as const, image: CONSENTED })) };
  return { deps, hooks, calls };
}

const neverRaw = (calls: { cloud: Blob[] }) => expect(calls.cloud).not.toContain(RAW);

describe('processBill', () => {
  it('saves a passing device read without touching the cloud', async () => {
    const { deps, hooks, calls } = setup();
    const r = await processBill(IMG, deps, hooks);
    expect(r.route).toMatchObject({ path: 'device', reason: 'passed' });
    expect(r.status).toBe('draft');
    expect(calls.cloud).toHaveLength(0);
    expect(r.estCostUsd).toBe(0);
  });
  it('escalates a total mismatch with the redacted image', async () => {
    const { deps, hooks, calls } = setup({ deviceOut: BAD_TOTAL });
    const r = await processBill(IMG, deps, hooks);
    expect(r.route).toMatchObject({ path: 'cloud', reason: 'total_mismatch' });
    expect(calls.cloud).toEqual([REDACTED]);
    expect(r.piiTypes).toEqual(['PAN']);
    expect(r.piiMasked).toBe(1);
    expect(r.redactedImage).toBe(REDACTED);
    expect(r.estCostUsd).toBeGreaterThan(0);
  });
  it.each(['unavailable', 'downloadable', 'downloading'] as const)('goes to cloud when device is %s', async (avail) => {
    const { deps, hooks, calls } = setup({ avail });
    const r = await processBill(IMG, deps, hooks);
    expect(r.route.reason).toBe('no_device_model');
    expect(calls.device).toBe(0);
    neverRaw(calls);
  });
  it('cloud_only mode skips the device', async () => {
    const { deps, hooks, calls } = setup({ config: { routingMode: 'cloud_only' } });
    const r = await processBill(IMG, deps, hooks);
    expect(r.route.reason).toBe('cloud_only_mode');
    expect(calls.device).toBe(0);
    neverRaw(calls);
  });
  it('device_only mode saves failures as manual entry and never calls cloud', async () => {
    const { deps, hooks, calls } = setup({ deviceOut: BAD_TOTAL, config: { routingMode: 'device_only' } });
    const r = await processBill(IMG, deps, hooks);
    expect(r.status).toBe('manual_entry');
    expect(r.route).toMatchObject({ path: 'device', reason: 'total_mismatch' });
    expect(r.extraction?.total).toBe(1870);
    expect(calls.cloud).toHaveLength(0);
  });
  it('device_only with no model is manual entry', async () => {
    const { deps, hooks, calls } = setup({ avail: 'unavailable', config: { routingMode: 'device_only' } });
    const r = await processBill(IMG, deps, hooks);
    expect(r).toMatchObject({ status: 'manual_entry', extraction: null });
    expect(r.route.reason).toBe('no_device_model');
    expect(calls.cloud).toHaveLength(0);
  });
  it('times out the device read', async () => {
    const { deps, hooks, calls } = setup({ deviceDelayMs: 200 });
    expect((await processBill(IMG, deps, hooks)).route.reason).toBe('device_timeout');
    neverRaw(calls);
  });
  it('handles a device error', async () => {
    const { deps, hooks } = setup({ deviceThrows: true });
    expect((await processBill(IMG, deps, hooks)).route.reason).toBe('device_error');
  });
  it('handles invalid device JSON', async () => {
    const { deps, hooks } = setup({ deviceOut: 'no idea' });
    expect((await processBill(IMG, deps, hooks)).route.reason).toBe('invalid_json');
  });
  it('asks consent when OCR is unsure and sends the consented image', async () => {
    const { deps, hooks, calls } = setup({ deviceOut: BAD_TOTAL, ocrWords: wordsFromLines(['PAN No: ____']) });
    const r = await processBill(IMG, deps, hooks);
    expect(hooks.askConsent).toHaveBeenCalledWith(REDACTED, expect.anything());
    expect(calls.cloud).toEqual([CONSENTED]);
    expect(r.redactedImage).toBe(CONSENTED);
    expect(hooks.onStep).toHaveBeenCalledWith('awaiting_consent');
  });
  it('keeps the bill local when the user declines', async () => {
    const { deps, hooks, calls } = setup({ deviceOut: BAD_TOTAL, ocrWords: wordsFromLines(['PAN No: ____']) });
    hooks.askConsent.mockResolvedValueOnce({ send: false } as never);
    const r = await processBill(IMG, deps, hooks);
    expect(r).toMatchObject({ status: 'manual_entry' });
    expect(r.route).toMatchObject({ path: 'device', reason: 'user_kept_local' });
    expect(calls.cloud).toHaveLength(0);
  });
  it('saves manual entry on cloud error, keeping device fields', async () => {
    const { deps, hooks } = setup({ deviceOut: BAD_TOTAL, cloudThrows: true });
    const r = await processBill(IMG, deps, hooks);
    expect(r.status).toBe('manual_entry');
    expect(r.route.reason).toBe('cloud_error');
    expect(r.extraction?.total).toBe(1870);
  });
  it('blocks the cloud when OCR fails', async () => {
    const { deps, hooks, calls } = setup({ deviceOut: BAD_TOTAL, ocrThrows: true });
    const r = await processBill(IMG, deps, hooks);
    expect(r.route.reason).toBe('ocr_error');
    expect(r.status).toBe('manual_entry');
    expect(calls.cloud).toHaveLength(0);
  });
  it('keeps a failing cloud read as a draft with red checks', async () => {
    const { deps, hooks } = setup({ deviceOut: BAD_TOTAL, cloudOut: BAD_TOTAL });
    const r = await processBill(IMG, deps, hooks);
    expect(r.status).toBe('draft');
    expect(r.checks?.total).toBe(false);
  });
  it('reports steps in order for an escalated bill', async () => {
    const { deps, hooks } = setup({ deviceOut: BAD_TOTAL });
    await processBill(IMG, deps, hooks);
    expect(hooks.onStep.mock.calls.map((c) => c[0])).toEqual(['availability', 'device_read', 'checking', 'redacting', 'cloud_read', 'checking', 'done']);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

`web/src/core/router/timeout.ts`:

```ts
export class TimeoutError extends Error {}
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(`timed out after ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
```

`web/src/core/router/processBill.ts`:

```ts
import type { BillStatus, CheckResult, Clock, CloudModel, Config, ConsentResult, DeviceModel, Extraction, ImageInput,
  Ocr, OcrWord, Painter, PathTaken, ProcessedBill, Reason, RedactionPlan, Step } from '../types';
import { CLOUD_COST_PER_CALL_USD, DEVICE_TIMEOUT_MS } from '../config/defaults';
import { cloudPrompt, devicePrompt } from '../extract/prompts';
import { parseExtraction } from '../extract/parse';
import { runChecks } from '../checks/checks';
import { runShield } from '../shield/shield';
import { planRedaction } from '../redact/planRedaction';
import { TimeoutError, withTimeout } from './timeout';

export interface RouterDeps {
  device: DeviceModel; cloud: CloudModel; ocr: Ocr; painter: Painter; config: Config; clock: Clock; deviceTimeoutMs?: number;
}
export interface RouterHooks {
  onStep(step: Step): void;
  askConsent(redacted: Blob, plan: RedactionPlan): Promise<ConsentResult>;
}

type OcrOutcome = { ok: true; words: OcrWord[] } | { ok: false };

export async function processBill(img: ImageInput, deps: RouterDeps, hooks: RouterHooks): Promise<ProcessedBill> {
  const { config: cfg, clock } = deps;
  const started = clock.now().getTime();
  // Start OCR at once so redaction is ready if we escalate.
  const ocrP: Promise<OcrOutcome> = deps.ocr.recognize(img.blob).then((words) => ({ ok: true, words }), () => ({ ok: false }));
  let ext: Extraction | null = null;
  let res: CheckResult | null = null;
  let plan: RedactionPlan = { boxes: [], piiTypes: [], piiMasked: 0 };
  let cloudCalled = false;
  let redacted: Blob | null = null;

  const finish = (path: PathTaken, reason: Reason, status: BillStatus): ProcessedBill => {
    hooks.onStep('done');
    return {
      status, extraction: ext, checks: res?.checks ?? null,
      route: { path, reason, confidence: res?.score ?? 0, promptVersion: cfg.extractionPromptVersion, modelName: path === 'cloud' ? cfg.cloudModel : 'gemini-nano' },
      piiTypes: plan.piiTypes, piiMasked: plan.piiMasked,
      latencyMs: clock.now().getTime() - started,
      estCostUsd: cloudCalled ? CLOUD_COST_PER_CALL_USD : 0,
      redactedImage: redacted,
    };
  };

  hooks.onStep('availability');
  let reason: Reason | null = null;
  if (cfg.routingMode === 'cloud_only') reason = 'cloud_only_mode';
  else if ((await deps.device.availability()) !== 'available') reason = 'no_device_model';

  if (!reason) {
    hooks.onStep('device_read');
    try {
      const raw = await withTimeout(deps.device.extract(img, devicePrompt(cfg)), deps.deviceTimeoutMs ?? DEVICE_TIMEOUT_MS);
      ext = parseExtraction(raw);
      if (!ext) reason = 'invalid_json';
      else {
        hooks.onStep('checking');
        res = runChecks(ext, cfg, clock.now());
        if (!res.escalate) return finish('device', 'passed', 'draft');
        reason = res.hardFail ?? 'low_confidence';
      }
    } catch (e) {
      reason = e instanceof TimeoutError ? 'device_timeout' : 'device_error';
    }
  }

  if (cfg.routingMode === 'device_only') return finish('device', reason!, 'manual_entry');

  hooks.onStep('redacting');
  const ocr = await ocrP;
  if (!ocr.ok) return finish('device', 'ocr_error', 'manual_entry');
  let toSend = img.blob;
  if (cfg.maskPii) {
    const shield = runShield(ocr.words, cfg.consentOcrThreshold);
    plan = planRedaction(ocr.words, shield, img.width, img.height);
    toSend = await deps.painter.paint(img.blob, plan.boxes);
    if (shield.uncertain) {
      hooks.onStep('awaiting_consent');
      const c = await hooks.askConsent(toSend, plan);
      if (!c.send) return finish('device', 'user_kept_local', 'manual_entry');
      toSend = c.image;
    }
  }
  redacted = toSend;

  hooks.onStep('cloud_read');
  let raw: string;
  try {
    cloudCalled = true;
    raw = await deps.cloud.extract({ ...img, blob: toSend, mimeType: 'image/jpeg' }, cloudPrompt(cfg), cfg.cloudModel);
  } catch {
    return finish('device', 'cloud_error', 'manual_entry');
  }
  const cloudExt = parseExtraction(raw);
  if (!cloudExt) return finish('cloud', 'invalid_json', 'manual_entry');
  ext = cloudExt;
  hooks.onStep('checking');
  res = runChecks(ext, cfg, clock.now());
  return finish('cloud', reason!, 'draft');
}
```

Note: `maskPii=false` only exists in dev builds (parseConfig locks prod). In that case the raw blob is sent; the no-raw assertions in tests use the default config where `maskPii` is true.

- [ ] **Step 4: Run, expect PASS** — `npx vitest run tests/core/processBill.test.ts`.

- [ ] **Step 5: Route log test** `web/tests/core/routeLog.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { toRouteLog, ROUTE_LOG_KEYS } from '../../src/core/router/routeLog';
import type { ProcessedBill } from '../../src/core/types';

const p: ProcessedBill = {
  status: 'draft', checks: null, redactedImage: new Blob(['x']),
  extraction: { supplierName: 'Ravi', supplierGstin: '29AAGCB7383J1Z4', invoiceNo: '1', invoiceDate: '2026-11-02', placeOfSupply: '', taxableValue: 1, cgst: 0, sgst: 0, igst: 0, total: 1, confidence: 1 },
  route: { path: 'cloud', reason: 'total_mismatch', confidence: 0.6, promptVersion: 'v1', modelName: 'gemini-3.1-flash-lite' },
  piiTypes: ['PAN'], piiMasked: 1, latencyMs: 4200, estCostUsd: 0.0003,
};

describe('toRouteLog', () => {
  it('contains only allowed keys and no bill content', () => {
    const log = toRouteLog(p, { billId: 'b1', shopId: 's1', caUid: 'u1' }, new Date('2026-11-20'));
    expect(Object.keys(log).sort()).toEqual([...ROUTE_LOG_KEYS].sort());
    const s = JSON.stringify(log);
    expect(s).not.toContain('29AAGCB7383J1Z4');
    expect(s).not.toContain('Ravi');
    expect(log).toMatchObject({ path: 'cloud', reason: 'total_mismatch', piiMasked: 1, piiTypes: ['PAN'], platform: 'web' });
  });
});
```

- [ ] **Step 6: Implement `web/src/core/router/routeLog.ts`**

```ts
import type { PathTaken, PiiType, ProcessedBill, Reason } from '../types';

export interface RouteLogDoc {
  billId: string; shopId: string; caUid: string; platform: 'web'; path: PathTaken; reason: Reason;
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
```

- [ ] **Step 7: No-PREFER + core-purity guard** `web/tests/no-prefer.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}
const SRC = join(__dirname, '..', 'src');

describe('privacy guards', () => {
  it('never uses PREFER_* inference modes', () => {
    const bad = files(SRC).filter((f) => /PREFER_(ON_DEVICE|IN_CLOUD)|prefer_on_device|prefer_in_cloud/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  it('core imports neither react nor firebase', () => {
    const bad = files(join(SRC, 'core')).filter((f) => /from ['"](react|firebase)/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
```

- [ ] **Step 8: Run all tests, expect PASS** — `npm test`.
- [ ] **Step 9: Commit** — `feat(core): hybrid routing cascade, PII-free route log, privacy guards`

---

### Task 8: Firebase setup, Remote Config template, rules + rules tests

**Files:**
- Create: `firebase/firebase.json`, `firebase/.firebaserc`, `firebase/firestore.rules`, `firebase/firestore.indexes.json`, `firebase/storage.rules`, `firebase/remoteconfig.template.json`, `web/vitest.rules.config.ts`, `web/tests/rules/firestore.rules.test.ts`, `web/.env.example`

**Manual prerequisite (user):** create `hisaabcheck-dev` (Blaze, Firestore + Storage in asia-south1), enable AI Logic with the Gemini Developer API, Authentication → Google provider, App Check with a reCAPTCHA Enterprise key, Remote Config; register a web app and put its config in `web/.env.local`. Run `npx firebase login` once. Stop and ask the user if these aren't done.

- [ ] **Step 1: Config files**

`firebase/.firebaserc`:

```json
{ "projects": { "default": "hisaabcheck-dev", "dev": "hisaabcheck-dev", "prod": "hisaabcheck-prod" } }
```

`firebase/firebase.json`:

```json
{
  "hosting": {
    "public": "../web/dist",
    "ignore": ["firebase.json", "**/.*"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  },
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage": { "rules": "storage.rules" },
  "remoteconfig": { "template": "remoteconfig.template.json" },
  "emulators": { "firestore": { "port": 8080 }, "auth": { "port": 9099 }, "ui": { "enabled": false } }
}
```

`firebase/firestore.indexes.json`:

```json
{
  "indexes": [
    { "collectionGroup": "routeLogs", "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "caUid", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" }] }
  ],
  "fieldOverrides": []
}
```

`firebase/remoteconfig.template.json` — one entry per key in `DEFAULT_REMOTE_VALUES`:

```json
{
  "conditions": [],
  "parameters": {
    "routing_mode": { "defaultValue": { "value": "smart" }, "valueType": "STRING", "description": "smart | device_only | cloud_only" },
    "confidence_threshold": { "defaultValue": { "value": "0.8" }, "valueType": "NUMBER" },
    "consent_ocr_threshold": { "defaultValue": { "value": "0.6" }, "valueType": "NUMBER" },
    "total_tolerance_inr": { "defaultValue": { "value": "1" }, "valueType": "NUMBER" },
    "max_device_line_items": { "defaultValue": { "value": "10" }, "valueType": "NUMBER" },
    "cloud_model": { "defaultValue": { "value": "gemini-3.1-flash-lite" }, "valueType": "STRING" },
    "extraction_prompt_version": { "defaultValue": { "value": "v1" }, "valueType": "STRING" },
    "mask_pii": { "defaultValue": { "value": "true" }, "valueType": "BOOLEAN" }
  }
}
```

`web/.env.example`:

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=hisaabcheck-dev
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_RECAPTCHA_ENTERPRISE_SITE_KEY=
# true in local dev: prints an App Check debug token to the console; register it in the console
VITE_APPCHECK_DEBUG=true
```

- [ ] **Step 2: Failing rules test** `web/tests/rules/firestore.rules.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';

let env: RulesTestEnvironment;
const log = (caUid: string) => ({ billId: 'b', shopId: 's1', caUid, platform: 'web', path: 'device', reason: 'passed',
  piiMasked: 0, piiTypes: [], latencyMs: 1, estCostUsd: 0, modelName: 'gemini-nano', promptVersion: 'v1', createdAt: new Date() });

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-hisaabcheck',
    firestore: { rules: readFileSync(join(__dirname, '../../../firebase/firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'shops/s1'), { caUid: 'alice', shopName: 'A', gstin: '', state: '', storeImages: false });
    await setDoc(doc(c.firestore(), 'shops/s1/bills/b1'), { total: 1 });
    await setDoc(doc(c.firestore(), 'users/admin'), { role: 'admin' });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('firestore rules', () => {
  it('lets a CA read their own shop and bills', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'shops/s1')));
    await assertSucceeds(getDoc(doc(as('alice'), 'shops/s1/bills/b1')));
  });
  it('blocks other CAs', async () => {
    await assertFails(getDoc(doc(as('bob'), 'shops/s1')));
    await assertFails(getDoc(doc(as('bob'), 'shops/s1/bills/b1')));
    await assertFails(setDoc(doc(as('bob'), 'shops/s1/bills/b2'), { total: 1 }));
  });
  it('blocks creating a shop for someone else and changing caUid', async () => {
    await assertFails(setDoc(doc(as('bob'), 'shops/s2'), { caUid: 'alice' }));
    await assertFails(updateDoc(doc(as('alice'), 'shops/s1'), { caUid: 'bob' }));
  });
  it('users can only create themselves as ca', async () => {
    await assertSucceeds(setDoc(doc(as('carol'), 'users/carol'), { role: 'ca', name: 'C' }));
    await assertFails(setDoc(doc(as('dave'), 'users/dave'), { role: 'admin' }));
  });
  it('route logs are append-only, own-only, and PII-key-free', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'routeLogs/l1'), log('alice')));
    await assertFails(setDoc(doc(as('alice'), 'routeLogs/l2'), log('bob')));
    await assertFails(setDoc(doc(as('alice'), 'routeLogs/l3'), { ...log('alice'), pan: 'AAPFU0939F' }));
    await assertFails(updateDoc(doc(as('alice'), 'routeLogs/l1'), { reason: 'x' }));
    await assertFails(deleteDoc(doc(as('alice'), 'routeLogs/l1')));
    await assertSucceeds(getDocs(query(collection(as('alice'), 'routeLogs'), where('caUid', '==', 'alice'))));
    await assertFails(getDocs(collection(as('bob'), 'routeLogs')));
    await assertSucceeds(getDocs(collection(as('admin'), 'routeLogs')));
  });
});
```

`web/vitest.rules.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/rules/**/*.test.ts'], environment: 'node', fileParallelism: false } });
```

Add script to `web/package.json`: `"test:rules": "cd ../firebase && firebase emulators:exec --only firestore --project demo-hisaabcheck \"cd ../web && vitest run --config vitest.rules.config.ts\""`.

- [ ] **Step 3: Run, expect FAIL** (rules file missing) — `npm run test:rules`.

- [ ] **Step 4: Write `firebase/firestore.rules`**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function signedIn() { return request.auth != null; }
    function uid() { return request.auth.uid; }
    function isAdmin() {
      return signedIn() && exists(/databases/$(db)/documents/users/$(uid()))
        && get(/databases/$(db)/documents/users/$(uid())).data.role == 'admin';
    }
    function ownsShop(shopId) {
      return signedIn() && get(/databases/$(db)/documents/shops/$(shopId)).data.caUid == uid();
    }

    match /users/{userId} {
      allow read: if signedIn() && (uid() == userId || isAdmin());
      allow create: if signedIn() && uid() == userId && request.resource.data.role == 'ca';
      allow update: if signedIn() && uid() == userId && request.resource.data.role == resource.data.role;
    }

    match /shops/{shopId} {
      allow read, delete: if signedIn() && resource.data.caUid == uid();
      allow create: if signedIn() && request.resource.data.caUid == uid();
      allow update: if signedIn() && resource.data.caUid == uid() && request.resource.data.caUid == uid();

      match /bills/{billId} {
        allow read, write: if ownsShop(shopId);
      }
    }

    match /routeLogs/{logId} {
      allow create: if signedIn() && request.resource.data.caUid == uid()
        && request.resource.data.keys().hasOnly(['billId','shopId','caUid','platform','path','reason','piiMasked',
             'piiTypes','latencyMs','estCostUsd','modelName','promptVersion','createdAt']);
      allow read: if signedIn() && (resource.data.caUid == uid() || isAdmin());
      allow update, delete: if false;
    }
  }
}
```

`firebase/storage.rules`:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /shops/{shopId}/bills/{file} {
      allow read, write: if request.auth != null
        && firestore.get(/databases/(default)/documents/shops/$(shopId)).data.caUid == request.auth.uid
        && (request.resource == null || (request.resource.size < 3 * 1024 * 1024 && request.resource.contentType == 'image/jpeg'));
    }
  }
}
```

- [ ] **Step 5: Run, expect PASS** — `npm run test:rules`.
- [ ] **Step 6: Deploy rules, indexes and RC template to dev**

```bash
cd firebase && npx firebase deploy --only firestore,storage,remoteconfig --project hisaabcheck-dev
```

Expected: "Deploy complete!". (Remote Config deploy overwrites the template — fine on a fresh project.)

- [ ] **Step 7: Commit** — `feat(firebase): rules with tests, indexes, Remote Config template`

---

### Task 9: Firebase client + adapters

**Files:**
- Create: `web/src/firebase.ts`, `web/src/adapters/firebaseAi.ts`, `web/src/adapters/tesseractOcr.ts`, `web/src/adapters/canvasPainter.ts`, `web/src/adapters/imageResize.ts`, `web/src/adapters/remoteConfig.ts`, `web/src/vite-env.d.ts` (extend)

**Interfaces:**
- Produces: `app, auth, db, storage, ai, rc` from `firebase.ts`; `deviceModel: DeviceModel`, `cloudModel: CloudModel`, `tesseractOcr: Ocr`, `canvasPainter: Painter`, `resizeImage(file: File, maxSide?: number): Promise<ImageInput>`, `loadConfig(): Promise<Config>`

These are thin I/O wrappers, verified manually in Task 10 (accuracy page) rather than unit-tested.

- [ ] **Step 1: Verify SDK names before writing code**

```bash
cd web && grep -n "ONLY_ON_DEVICE\|ONLY_IN_CLOUD\|onDeviceParams\|inCloudParams" node_modules/@firebase/ai/dist/ai-public.d.ts | head -20
```

Expected: `InferenceMode` has `ONLY_ON_DEVICE` and `ONLY_IN_CLOUD`; `HybridParams` has `mode`, `onDeviceParams`, `inCloudParams`. If `ONLY_ON_DEVICE` is missing, use the fallback in Step 3 for device extraction (cloud still goes through Firebase AI Logic, satisfying the hackathon rule). Record which path was used in the commit message.

- [ ] **Step 2: `web/src/firebase.ts`**

```ts
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAI, GoogleAIBackend } from 'firebase/ai';
import { getRemoteConfig } from 'firebase/remote-config';
import { DEFAULT_REMOTE_VALUES } from './core/config/defaults';

const env = import.meta.env;
export const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET, messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: env.VITE_FIREBASE_APP_ID,
});

if (env.VITE_APPCHECK_DEBUG === 'true') {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}
initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY), isTokenAutoRefreshEnabled: true });

export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true, // extraction.items may be absent
});
export const storage = getStorage(app);
export const ai = getAI(app, { backend: new GoogleAIBackend() });
export const rc = getRemoteConfig(app);
rc.settings.minimumFetchIntervalMillis = 30_000;
rc.defaultConfig = DEFAULT_REMOTE_VALUES;
```

- [ ] **Step 3: `web/src/adapters/firebaseAi.ts`**

```ts
import { getGenerativeModel, InferenceMode, type GenerativeModel } from 'firebase/ai';
import { ai } from '../firebase';
import type { Availability, CloudModel, DeviceModel, ImageInput } from '../core/types';

/** Chrome built-in Prompt API global (Chrome 138+). Used for availability + download only. */
declare global {
  // eslint-disable-next-line no-var
  var LanguageModel: undefined | {
    availability(opts: object): Promise<Availability>;
    create(opts: object): Promise<{ destroy(): void }>;
  };
}
const DEVICE_OPTS = { expectedInputs: [{ type: 'image' }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

async function toPart(blob: Blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { inlineData: { data: btoa(bin), mimeType: blob.type || 'image/jpeg' } };
}

let deviceGen: GenerativeModel | null = null;
export const deviceModel: DeviceModel = {
  async availability() {
    if (typeof globalThis.LanguageModel === 'undefined') return 'unavailable';
    try { return await globalThis.LanguageModel.availability(DEVICE_OPTS); } catch { return 'unavailable'; }
  },
  async download(onProgress) {
    if (!globalThis.LanguageModel) return;
    const s = await globalThis.LanguageModel.create({
      ...DEVICE_OPTS,
      monitor(m: EventTarget) { m.addEventListener('downloadprogress', (e) => onProgress((e as ProgressEvent).loaded)); },
    });
    s.destroy();
  },
  async extract(image: ImageInput, prompt: string) {
    deviceGen ??= getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: { createOptions: DEVICE_OPTS },
    });
    const res = await deviceGen.generateContent([prompt, await toPart(image.blob)]);
    return res.response.text();
  },
};

const cloudGens = new Map<string, GenerativeModel>();
export const cloudModel: CloudModel = {
  async extract(redacted: ImageInput, prompt: string, model: string) {
    let g = cloudGens.get(model);
    if (!g) {
      g = getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: { model, generationConfig: { responseMimeType: 'application/json', temperature: 0 } },
      });
      cloudGens.set(model, g);
    }
    const res = await g.generateContent([prompt, await toPart(redacted.blob)]);
    return res.response.text();
  },
};
```

Fallback if Step 1 found no `ONLY_ON_DEVICE`: replace `deviceModel.extract` with

```ts
  async extract(image, prompt) {
    const s = await (globalThis.LanguageModel as any).create(DEVICE_OPTS);
    try {
      return await s.prompt([{ role: 'user', content: [{ type: 'text', value: prompt }, { type: 'image', value: image.blob }] }]);
    } finally { s.destroy(); }
  },
```

If TypeScript rejects option names (experimental SDK), match them to `ai-public.d.ts` from Step 1 — do not switch to a `PREFER_*` mode.

- [ ] **Step 4: `web/src/adapters/tesseractOcr.ts`** (lazy import keeps it out of the first bundle)

```ts
import type { Ocr, OcrWord } from '../core/types';

type W = { recognize(img: Blob): Promise<{ data: { lines: Array<{ words: Array<{ text: string; confidence: number; bbox: OcrWord['bbox'] }> }> } }> };
let worker: Promise<W> | null = null;
const getWorker = () => (worker ??= import('tesseract.js').then((t) => t.createWorker('eng') as unknown as Promise<W>));

export const tesseractOcr: Ocr = {
  async recognize(image) {
    const { data } = await (await getWorker()).recognize(image);
    return data.lines.flatMap((line, li) => line.words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox, line: li })));
  },
};
export const warmUpOcr = () => void getWorker();
```

- [ ] **Step 5: `web/src/adapters/canvasPainter.ts` and `imageResize.ts`**

```ts
// canvasPainter.ts
import type { Painter } from '../core/types';
export const canvasPainter: Painter = {
  async paint(image, boxes) {
    const bmp = await createImageBitmap(image);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    ctx.fillStyle = '#000';
    for (const b of boxes) ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    return c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  },
};
```

```ts
// imageResize.ts
import type { ImageInput } from '../core/types';
export async function resizeImage(file: Blob, maxSide = 1600): Promise<ImageInput> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const width = Math.round(bmp.width * scale), height = Math.round(bmp.height * scale);
  const c = new OffscreenCanvas(width, height);
  c.getContext('2d')!.drawImage(bmp, 0, 0, width, height);
  return { blob: await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }), mimeType: 'image/jpeg', width, height };
}
```

- [ ] **Step 6: `web/src/adapters/remoteConfig.ts`**

```ts
import { fetchAndActivate, getAll } from 'firebase/remote-config';
import { rc } from '../firebase';
import { parseConfig } from '../core/config/parseConfig';
import type { Config } from '../core/types';

export async function loadConfig(): Promise<Config> {
  try { await fetchAndActivate(rc); } catch { /* bundled defaults stay active */ }
  const values = Object.fromEntries(Object.entries(getAll(rc)).map(([k, v]) => [k, v.asString()]));
  return parseConfig(values, import.meta.env.PROD);
}
```

- [ ] **Step 7: Verify** — `npm run build` (type-check + bundle) succeeds and `npm test` still passes; `npx vite build` output shows tesseract in a separate chunk.
- [ ] **Step 8: Commit** — `feat(web): Firebase client and AI/OCR/canvas/config adapters`

---

### Task 10: Accuracy + leak-check page (day-1 gate: lock the prompt)

**Files:**
- Create: `web/src/core/accuracy/compareFields.ts`, `web/tests/core/compareFields.test.ts`, `web/src/dev/accuracy/AccuracyPage.tsx`
- Modify: `web/src/App.tsx` (temporary minimal router with the dev route; Task 11 extends it), `web/src/main.tsx`

**Interfaces:**
- Produces: `type Truth = Pick<Extraction,'supplierGstin'|'invoiceDate'|'taxableValue'|'cgst'|'sgst'|'igst'|'total'>`, `compareFields(truth: Truth, got: Extraction | null): Record<keyof Truth, boolean>`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { compareFields } from '../../src/core/accuracy/compareFields';

const truth = { supplierGstin: '29AAGCB7383J1Z4', invoiceDate: '2026-11-02', taxableValue: 1500, cgst: 135, sgst: 135, igst: 0, total: 1770 };
describe('compareFields', () => {
  it('matches strings case-insensitively and numbers within ₹1', () => {
    const r = compareFields(truth, { ...truth, supplierGstin: '29aagcb7383j1z4', total: 1770.6, supplierName: '', invoiceNo: '', placeOfSupply: '', confidence: 1 });
    expect(Object.values(r).every(Boolean)).toBe(true);
  });
  it('flags mismatches', () => {
    const r = compareFields(truth, { ...truth, cgst: 150, supplierName: '', invoiceNo: '', placeOfSupply: '', confidence: 1 });
    expect(r.cgst).toBe(false);
  });
  it('marks everything false for a null read', () => {
    expect(Object.values(compareFields(truth, null)).some(Boolean)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, FAIL. Step 3: Implement**

```ts
import type { Extraction } from '../types';
export type Truth = Pick<Extraction, 'supplierGstin' | 'invoiceDate' | 'taxableValue' | 'cgst' | 'sgst' | 'igst' | 'total'>;
const KEYS: (keyof Truth)[] = ['supplierGstin', 'invoiceDate', 'taxableValue', 'cgst', 'sgst', 'igst', 'total'];

export function compareFields(truth: Truth, got: Extraction | null): Record<keyof Truth, boolean> {
  return Object.fromEntries(KEYS.map((k) => {
    if (!got) return [k, false];
    const a = truth[k], b = got[k];
    return [k, typeof a === 'number' ? Math.abs(a - Number(b)) <= 1 : String(a).trim().toUpperCase() === String(b).trim().toUpperCase()];
  })) as Record<keyof Truth, boolean>;
}
```

Run, PASS.

- [ ] **Step 4: `web/src/dev/accuracy/AccuracyPage.tsx`**

The page takes many image files plus one `truth.json` (`{ "<filename>": Truth }`), and for each bill: resizes, runs the device read (if available) and the cloud read on the redacted image independently, scores both, then re-OCRs the redacted image and counts any remaining PII. It shows a table and downloads a CSV.

```tsx
import { useState } from 'react';
import { deviceModel, cloudModel } from '../../adapters/firebaseAi';
import { tesseractOcr } from '../../adapters/tesseractOcr';
import { canvasPainter } from '../../adapters/canvasPainter';
import { resizeImage } from '../../adapters/imageResize';
import { loadConfig } from '../../adapters/remoteConfig';
import { devicePrompt, cloudPrompt } from '../../core/extract/prompts';
import { parseExtraction } from '../../core/extract/parse';
import { runShield } from '../../core/shield/shield';
import { planRedaction } from '../../core/redact/planRedaction';
import { compareFields, type Truth } from '../../core/accuracy/compareFields';

interface Row { file: string; deviceOk: number; deviceMs: number; cloudOk: number; cloudMs: number; piiMasked: number; piiLeft: number; uncertain: boolean }
const FIELDS = 7;

export default function AccuracyPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState('');

  async function run(files: FileList) {
    const list = [...files];
    const truthFile = list.find((f) => f.name === 'truth.json');
    if (!truthFile) { alert('Include truth.json'); return; }
    const truth: Record<string, Truth> = JSON.parse(await truthFile.text());
    const cfg = await loadConfig();
    const hasDevice = (await deviceModel.availability()) === 'available';
    const out: Row[] = [];
    for (const f of list.filter((x) => x !== truthFile && truth[x.name])) {
      setBusy(f.name);
      const img = await resizeImage(f);
      let deviceOk = 0, deviceMs = 0;
      if (hasDevice) {
        const t = performance.now();
        try { deviceOk = Object.values(compareFields(truth[f.name], parseExtraction(await deviceModel.extract(img, devicePrompt(cfg))))).filter(Boolean).length; } catch { /* counts as 0 */ }
        deviceMs = performance.now() - t;
      }
      const words = await tesseractOcr.recognize(img.blob);
      const shield = runShield(words, cfg.consentOcrThreshold);
      const plan = planRedaction(words, shield, img.width, img.height);
      const redacted = await canvasPainter.paint(img.blob, plan.boxes);
      const t2 = performance.now();
      let cloudOk = 0;
      try { cloudOk = Object.values(compareFields(truth[f.name], parseExtraction(await cloudModel.extract({ ...img, blob: redacted }, cloudPrompt(cfg), cfg.cloudModel)))).filter(Boolean).length; } catch { /* 0 */ }
      const cloudMs = performance.now() - t2;
      const piiLeft = runShield(await tesseractOcr.recognize(redacted), cfg.consentOcrThreshold).matches.length;
      out.push({ file: f.name, deviceOk, deviceMs, cloudOk, cloudMs, piiMasked: plan.piiMasked, piiLeft, uncertain: shield.uncertain });
      setRows([...out]);
    }
    setBusy('');
  }

  function downloadCsv() {
    const head = 'file,device_fields_ok,device_ms,cloud_fields_ok,cloud_ms,pii_masked,pii_left,uncertain';
    const body = rows.map((r) => [r.file, r.deviceOk, r.deviceMs.toFixed(0), r.cloudOk, r.cloudMs.toFixed(0), r.piiMasked, r.piiLeft, r.uncertain].join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([[head, ...body].join('\n')], { type: 'text/csv' }));
    a.download = 'accuracy.csv';
    a.click();
  }

  const n = rows.length || 1;
  const pct = (k: 'deviceOk' | 'cloudOk') => ((rows.reduce((s, r) => s + r[k], 0) / (n * FIELDS)) * 100).toFixed(1);
  const leaks = rows.reduce((s, r) => s + r.piiLeft, 0);
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Accuracy & leak check (dev only)</h1>
      <input type="file" multiple accept="image/*,application/json" aria-label="Bills and truth.json" onChange={(e) => e.target.files && run(e.target.files)} />
      {busy && <p>Processing {busy}…</p>}
      <p>Device field accuracy: {pct('deviceOk')}% · Cloud field accuracy: {pct('cloudOk')}% ·{' '}
        <span className={leaks ? 'text-red-600 font-bold' : 'text-green-700 font-bold'}>PII left after redaction: {leaks}</span></p>
      <button className="px-4 py-2 rounded bg-slate-800 text-white" onClick={downloadCsv} disabled={!rows.length}>Download CSV</button>
      <table className="text-sm"><tbody>
        {rows.map((r) => <tr key={r.file} className={r.piiLeft ? 'bg-red-100' : ''}>
          <td className="pr-4">{r.file}</td><td className="pr-4">dev {r.deviceOk}/{FIELDS}</td><td className="pr-4">cloud {r.cloudOk}/{FIELDS}</td>
          <td className="pr-4">masked {r.piiMasked}</td><td>{r.uncertain ? 'unsure' : ''}</td></tr>)}
      </tbody></table>
    </div>
  );
}
```

`web/src/App.tsx` (temporary):

```tsx
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
const AccuracyPage = import.meta.env.DEV ? lazy(() => import('./dev/accuracy/AccuracyPage')) : null;
export default function App() {
  return (
    <BrowserRouter><Suspense fallback={null}><Routes>
      {AccuracyPage && <Route path="/dev/accuracy" element={<AccuracyPage />} />}
      <Route path="*" element={<p className="p-6">HisaabCheck</p>} />
    </Routes></Suspense></BrowserRouter>
  );
}
```

`web/src/main.tsx`: import `./index.css` and render `<App />` in `StrictMode` (keep Vite's default otherwise).

- [ ] **Step 5: Run on real bills (user + agent, on the Nano-capable Chrome machine)** — `npm run dev`, open `http://localhost:5173/dev/accuracy`, register the printed App Check debug token in the console, select the 40 bills + `truth.json`. Record: device %, cloud %, PII left (must be 0), count of `unsure`. If PII left > 0, add the missed pattern as a vector in `pii.json`, fix `shield.ts` (TDD), re-run. If device accuracy is poor, iterate on the `v1` prompt text (or add `v2` and set the RC key) until it stabilises; then freeze it. Save the CSV outside the repo (bills are private); put only the summary numbers in the README later.
- [ ] **Step 6: Commit** — `feat(dev): accuracy and redaction leak-check page`

---

### Task 11: Store, auth, consent and shops

**Files:**
- Create: `web/src/adapters/store.ts`, `web/src/features/auth/AuthProvider.tsx`, `web/src/features/auth/LoginPage.tsx`, `web/src/features/auth/ConsentPage.tsx`, `web/src/features/auth/RequireAuth.tsx`, `web/src/features/shops/ShopsPage.tsx`, `web/src/features/Layout.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `db`, `auth`, `storage`, `toRouteLog`, `isValidGstin`
- Produces (store.ts):
  - `CONSENT_VERSION = '2026-11-v1'`
  - `ensureUser(u: User): Promise<UserDoc>`; `recordConsent(uid: string): Promise<void>`; `type UserDoc = { role: 'ca' | 'admin'; name: string; email: string; consentVersion?: string }`
  - `type Shop = { id: string; caUid: string; shopName: string; gstin: string; state: string; storeImages: boolean }`
  - `watchShops(caUid: string, cb: (s: Shop[]) => void): () => void`; `createShop(caUid: string, s: Omit<Shop,'id'|'caUid'>): Promise<string>`
  - `saveProcessedBill(shop: Shop, caUid: string, p: ProcessedBill): Promise<string>` (returns billId); `updateBillFields(shopId: string, billId: string, e: Extraction, checks: Checks): Promise<void>`
  - `watchRouteLogs(caUid: string, isAdmin: boolean, cb: (logs: RouteLogDoc[]) => void): () => void`
- Produces (AuthProvider): `useAuth(): { user: User | null; profile: UserDoc | null; loading: boolean; refresh(): Promise<void> }`

- [ ] **Step 1: `web/src/adapters/store.ts`**

```ts
import type { User } from 'firebase/auth';
import { addDoc, collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch, limit } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import type { Checks, Extraction, ProcessedBill } from '../core/types';
import { toRouteLog, type RouteLogDoc } from '../core/router/routeLog';

export const CONSENT_VERSION = '2026-11-v1';
export type UserDoc = { role: 'ca' | 'admin'; name: string; email: string; consentVersion?: string };
export type Shop = { id: string; caUid: string; shopName: string; gstin: string; state: string; storeImages: boolean };

export async function ensureUser(u: User): Promise<UserDoc> {
  const r = doc(db, 'users', u.uid);
  const snap = await getDoc(r);
  if (snap.exists()) return snap.data() as UserDoc;
  const d: UserDoc = { role: 'ca', name: u.displayName ?? '', email: u.email ?? '' };
  await setDoc(r, { ...d, createdAt: serverTimestamp() });
  return d;
}
export const recordConsent = (uid: string) =>
  updateDoc(doc(db, 'users', uid), { consentVersion: CONSENT_VERSION, consentAt: serverTimestamp() });

export function watchShops(caUid: string, cb: (s: Shop[]) => void) {
  return onSnapshot(query(collection(db, 'shops'), where('caUid', '==', caUid)), (q) =>
    cb(q.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Shop, 'id'>) }))));
}
export async function createShop(caUid: string, s: Omit<Shop, 'id' | 'caUid'>) {
  return (await addDoc(collection(db, 'shops'), { ...s, caUid, createdAt: serverTimestamp() })).id;
}

export async function saveProcessedBill(shop: Shop, caUid: string, p: ProcessedBill): Promise<string> {
  const billRef = doc(collection(db, 'shops', shop.id, 'bills'));
  let imagePath: string | null = null;
  if (shop.storeImages && p.redactedImage) {
    imagePath = `shops/${shop.id}/bills/${billRef.id}.jpg`;
    await uploadBytes(ref(storage, imagePath), p.redactedImage, { contentType: 'image/jpeg' });
  }
  const batch = writeBatch(db);
  batch.set(billRef, {
    ...(p.extraction ?? {}), checks: p.checks, status: p.status, route: p.route,
    ...(imagePath ? { imagePath } : {}), createdAt: serverTimestamp(),
  });
  batch.set(doc(collection(db, 'routeLogs')), toRouteLog(p, { billId: billRef.id, shopId: shop.id, caUid }, new Date()));
  void batch.commit(); // offline cache queues it; do not block the UI on the server ack
  return billRef.id;
}

export const updateBillFields = (shopId: string, billId: string, e: Extraction, checks: Checks) =>
  updateDoc(doc(db, 'shops', shopId, 'bills', billId), { ...e, checks, editedAt: serverTimestamp() });

export function watchRouteLogs(caUid: string, isAdmin: boolean, cb: (logs: RouteLogDoc[]) => void) {
  const base = collection(db, 'routeLogs');
  const q = isAdmin ? query(base, orderBy('createdAt', 'desc'), limit(1000))
                    : query(base, where('caUid', '==', caUid), orderBy('createdAt', 'desc'), limit(1000));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => d.data() as RouteLogDoc)));
}
```

- [ ] **Step 2: Auth pieces**

`AuthProvider.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../firebase';
import { ensureUser, type UserDoc } from '../../adapters/store';

type Ctx = { user: User | null; profile: UserDoc | null; loading: boolean; refresh(): Promise<void> };
const AuthCtx = createContext<Ctx>({ user: null, profile: null, loading: true, refresh: async () => {} });
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => { if (auth.currentUser) setProfile(await ensureUser(auth.currentUser)); };
  useEffect(() => onAuthStateChanged(auth, async (u) => {
    setUser(u); setProfile(u ? await ensureUser(u) : null); setLoading(false);
  }), []);
  return <AuthCtx.Provider value={{ user, profile, loading, refresh }}>{children}</AuthCtx.Provider>;
}
```

`LoginPage.tsx`:

```tsx
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { Navigate } from 'react-router-dom';
import { auth } from '../../firebase';
import { useAuth } from './AuthProvider';

export default function LoginPage() {
  const { user } = useAuth();
  if (user) return <Navigate to="/shops" replace />;
  return (
    <main className="min-h-screen grid place-items-center bg-slate-50">
      <div className="max-w-md text-center space-y-4 p-8">
        <h1 className="text-3xl font-bold">HisaabCheck</h1>
        <p className="text-slate-600">Bill photos to checked GST data. Private numbers are hidden on your computer before anything goes to the cloud.</p>
        <button className="px-6 py-3 rounded-lg bg-emerald-700 text-white text-lg" onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}>
          Sign in with Google
        </button>
      </div>
    </main>
  );
}
```

`ConsentPage.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../../firebase';
import { recordConsent } from '../../adapters/store';
import { useAuth } from './AuthProvider';

export default function ConsentPage() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  return (
    <main className="max-w-xl mx-auto p-8 space-y-4">
      <h1 className="text-2xl font-bold">Before you start</h1>
      <p>HisaabCheck processes bill photos you upload to extract supplier, invoice and tax details for your clients.</p>
      <ul className="list-disc pl-6 space-y-1 text-slate-700">
        <li>Bills are read on this computer when possible.</li>
        <li>If a bill needs the cloud, PAN, Aadhaar, phone and bank numbers are blacked out first.</li>
        <li>Photos are not stored unless you turn that on for a shop. Data is kept in India (Mumbai).</li>
        <li>You can withdraw consent by signing out and asking us to delete your data.</li>
      </ul>
      <div className="flex gap-3">
        <button className="px-5 py-3 rounded-lg bg-emerald-700 text-white"
          onClick={async () => { await recordConsent(user!.uid); await refresh(); nav('/shops'); }}>I agree</button>
        <button className="px-5 py-3 rounded-lg border" onClick={() => signOut(auth)}>Not now</button>
      </div>
    </main>
  );
}
```

`RequireAuth.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { CONSENT_VERSION } from '../../adapters/store';

export function RequireAuth({ children, consent = true }: { children: ReactNode; consent?: boolean }) {
  const { user, profile, loading } = useAuth();
  if (loading) return <p className="p-6">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (consent && profile?.consentVersion !== CONSENT_VERSION) return <Navigate to="/consent" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 3: Layout + Shops**

`Layout.tsx`:

```tsx
import { NavLink, Outlet } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';

export default function Layout() {
  const link = ({ isActive }: { isActive: boolean }) => `px-3 py-2 rounded ${isActive ? 'bg-emerald-100 text-emerald-900' : ''}`;
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center gap-2 px-6 py-3 bg-white border-b">
        <span className="font-bold mr-4">HisaabCheck</span>
        <NavLink to="/shops" className={link}>Shops</NavLink>
        <NavLink to="/dashboard" className={link}>Routing</NavLink>
        <button className="ml-auto text-sm underline" onClick={() => signOut(auth)}>Sign out</button>
      </header>
      <main className="p-6"><Outlet /></main>
    </div>
  );
}
```

`ShopsPage.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { createShop, watchShops, type Shop } from '../../adapters/store';
import { isValidGstin } from '../../core/shield/gstin';

export default function ShopsPage() {
  const { user } = useAuth();
  const [shops, setShops] = useState<Shop[]>([]);
  const [form, setForm] = useState({ shopName: '', gstin: '', state: '', storeImages: false });
  useEffect(() => watchShops(user!.uid, setShops), [user]);
  const gstinOk = form.gstin === '' || isValidGstin(form.gstin.toUpperCase());

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!form.shopName || !gstinOk) return;
    await createShop(user!.uid, { ...form, gstin: form.gstin.toUpperCase() });
    setForm({ shopName: '', gstin: '', state: '', storeImages: false });
  }

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section>
        <h1 className="text-2xl font-bold mb-4">Client shops</h1>
        {shops.length === 0 && <p className="text-slate-600">No shops yet. Add your first client.</p>}
        <ul className="space-y-2">
          {shops.map((s) => (
            <li key={s.id}><Link className="block p-4 bg-white rounded-lg border hover:border-emerald-600" to={`/shops/${s.id}/upload`}>
              <span className="font-semibold">{s.shopName}</span> <span className="text-slate-500 text-sm">{s.gstin}</span></Link></li>
          ))}
        </ul>
      </section>
      <form onSubmit={add} className="bg-white p-6 rounded-lg border space-y-3">
        <h2 className="text-lg font-semibold">Add client shop</h2>
        <label className="block">Shop name<input required className="mt-1 w-full border rounded p-2" value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} /></label>
        <label className="block">GSTIN<input className={`mt-1 w-full border rounded p-2 ${gstinOk ? '' : 'border-red-600'}`} value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} aria-invalid={!gstinOk} /></label>
        {!gstinOk && <p className="text-red-700 text-sm">This GSTIN fails the format or checksum check.</p>}
        <label className="block">State<input className="mt-1 w-full border rounded p-2" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.storeImages} onChange={(e) => setForm({ ...form, storeImages: e.target.checked })} />
          Store redacted bill photos (off by default)</label>
        <button className="px-5 py-3 rounded-lg bg-emerald-700 text-white">Add shop</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Routes in `App.tsx`** (Upload and Dashboard pages are created in Tasks 12–13; add their routes then)

```tsx
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './features/auth/AuthProvider';
import { RequireAuth } from './features/auth/RequireAuth';
import LoginPage from './features/auth/LoginPage';
import ConsentPage from './features/auth/ConsentPage';
import Layout from './features/Layout';
import ShopsPage from './features/shops/ShopsPage';
const AccuracyPage = import.meta.env.DEV ? lazy(() => import('./dev/accuracy/AccuracyPage')) : null;

export default function App() {
  return (
    <AuthProvider><BrowserRouter><Suspense fallback={null}><Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/consent" element={<RequireAuth consent={false}><ConsentPage /></RequireAuth>} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/shops" element={<ShopsPage />} />
      </Route>
      {AccuracyPage && <Route path="/dev/accuracy" element={<AccuracyPage />} />}
      <Route path="*" element={<Navigate to="/shops" replace />} />
    </Routes></Suspense></BrowserRouter></AuthProvider>
  );
}
```

- [ ] **Step 5: Verify** — `npm run build && npm test`; `npm run dev`: sign in with Google → consent screen → agree → shops page; add a shop with `29AAGCB7383J1Z4` (accepted) and `29AAGCB7383J1Z5` (red error); confirm in the Firestore console that `users/{uid}` has `consentVersion` and the shop has your `caUid`.
- [ ] **Step 6: Commit** — `feat(web): Google sign-in, consent, client shops and Firestore store`

---

### Task 12: Upload, processing cards, consent preview, result

**Files:**
- Create: `web/src/features/upload/useBillProcessor.ts`, `web/src/features/upload/AiStatusChip.tsx`, `web/src/features/upload/BillCard.tsx`, `web/src/features/upload/UploadPage.tsx`, `web/src/features/preview/ConsentPreview.tsx`, `web/src/features/result/ResultPanel.tsx`
- Modify: `web/src/App.tsx` (add `<Route path="/shops/:shopId/upload" element={<UploadPage />} />` inside the Layout route)

**Interfaces:**
- Consumes: `processBill`, adapters, `saveProcessedBill`, `updateBillFields`, `runChecks`, `loadConfig`
- Produces: `useBillProcessor(shop: Shop | null): { bills: BillJob[]; addFiles(files: File[]): void; retry(id: string): void; resolveConsent(id: string, r: ConsentResult): void }` where
  `type BillJob = { id: string; file: File; originalUrl: string; step: Step | 'queued' | 'error'; result?: ProcessedBill; billId?: string; consent?: { redacted: Blob; plan: RedactionPlan }; error?: string }`

- [ ] **Step 1: `useBillProcessor.ts`** (bills are processed one at a time so the on-device model is not overloaded)

```ts
import { useCallback, useRef, useState } from 'react';
import { processBill } from '../../core/router/processBill';
import type { ConsentResult, ProcessedBill, RedactionPlan, Step } from '../../core/types';
import { deviceModel, cloudModel } from '../../adapters/firebaseAi';
import { tesseractOcr } from '../../adapters/tesseractOcr';
import { canvasPainter } from '../../adapters/canvasPainter';
import { resizeImage } from '../../adapters/imageResize';
import { loadConfig } from '../../adapters/remoteConfig';
import { saveProcessedBill, type Shop } from '../../adapters/store';
import { useAuth } from '../auth/AuthProvider';

export type BillJob = { id: string; file: File; originalUrl: string; step: Step | 'queued' | 'error';
  result?: ProcessedBill; billId?: string; consent?: { redacted: Blob; plan: RedactionPlan }; error?: string };

export function useBillProcessor(shop: Shop | null) {
  const { user } = useAuth();
  const [bills, setBills] = useState<BillJob[]>([]);
  const queue = useRef<string[]>([]);
  const running = useRef(false);
  const jobs = useRef(new Map<string, BillJob>());
  const consentWaiters = useRef(new Map<string, (r: ConsentResult) => void>());

  const patch = useCallback((id: string, p: Partial<BillJob>) => {
    const j = { ...jobs.current.get(id)!, ...p };
    jobs.current.set(id, j);
    setBills((bs) => bs.map((b) => (b.id === id ? j : b)));
  }, []);

  const pump = useCallback(async () => {
    if (running.current || !shop || !user) return;
    running.current = true;
    while (queue.current.length) {
      const id = queue.current.shift()!;
      const job = jobs.current.get(id)!;
      try {
        const img = await resizeImage(job.file);
        const config = await loadConfig();
        const result = await processBill(img, { device: deviceModel, cloud: cloudModel, ocr: tesseractOcr, painter: canvasPainter, config, clock: { now: () => new Date() } }, {
          onStep: (step) => patch(id, { step }),
          askConsent: (redacted, plan) => new Promise<ConsentResult>((resolve) => {
            consentWaiters.current.set(id, resolve);
            patch(id, { consent: { redacted, plan } });
          }),
        });
        const billId = await saveProcessedBill(shop, user.uid, result);
        patch(id, { result, billId, consent: undefined, step: 'done' });
      } catch (e) {
        patch(id, { step: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }
    running.current = false;
  }, [shop, user, patch]);

  const addFiles = useCallback((files: File[]) => {
    const fresh = files.filter((f) => /image\/(jpeg|png)/.test(f.type)).map((file): BillJob =>
      ({ id: crypto.randomUUID(), file, originalUrl: URL.createObjectURL(file), step: 'queued' }));
    fresh.forEach((j) => { jobs.current.set(j.id, j); queue.current.push(j.id); });
    setBills((bs) => [...fresh, ...bs]);
    void pump();
  }, [pump]);

  const retry = useCallback((id: string) => { patch(id, { step: 'queued', error: undefined, result: undefined }); queue.current.push(id); void pump(); }, [patch, pump]);

  const resolveConsent = useCallback((id: string, r: ConsentResult) => {
    consentWaiters.current.get(id)?.(r);
    consentWaiters.current.delete(id);
    patch(id, { consent: undefined });
  }, [patch]);

  return { bills, addFiles, retry, resolveConsent };
}
```

Note: retrying a `manual_entry`/`cloud_error` bill creates a new bill doc; acceptable for A (inbox de-dupe is sub-project B).

- [ ] **Step 2: `AiStatusChip.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { deviceModel } from '../../adapters/firebaseAi';
import type { Availability } from '../../core/types';

export default function AiStatusChip() {
  const [a, setA] = useState<Availability | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => { void deviceModel.availability().then(setA); }, []);
  const label = { available: 'On-device AI ready', downloadable: 'On-device AI not downloaded', downloading: 'Downloading on-device AI…', unavailable: 'No on-device AI on this computer — cloud with redaction' };
  return (
    <div className="flex items-center gap-3" role="status">
      <span className={`px-3 py-1 rounded-full text-sm ${a === 'available' ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>
        {a ? label[a] : 'Checking on-device AI…'}{progress !== null && progress < 1 ? ` ${Math.round(progress * 100)}%` : ''}
      </span>
      {a === 'downloadable' && (
        <button className="px-3 py-1 rounded border text-sm" onClick={async () => {
          setA('downloading');
          await deviceModel.download(setProgress);
          setA(await deviceModel.availability());
        }}>Download on-device AI</button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `ConsentPreview.tsx`** — shows the redacted image; the user drags rectangles to add black boxes (or clicks "Black out whole bottom third" as a keyboard-accessible fallback), then sends or keeps.

```tsx
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Box, ConsentResult } from '../../core/types';
import { canvasPainter } from '../../adapters/canvasPainter';

export default function ConsentPreview({ redacted, onDone }: { redacted: Blob; onDone(r: ConsentResult): void }) {
  const url = useMemo(() => URL.createObjectURL(redacted), [redacted]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const imgRef = useRef<HTMLImageElement>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [drag, setDrag] = useState<Box | null>(null);

  const toImg = (e: PointerEvent) => {
    const el = imgRef.current!, r = el.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * el.naturalWidth, y: ((e.clientY - r.top) / r.height) * el.naturalHeight };
  };
  const norm = (b: Box): Box => ({ x0: Math.min(b.x0, b.x1), y0: Math.min(b.y0, b.y1), x1: Math.max(b.x0, b.x1), y1: Math.max(b.y0, b.y1) });
  const pct = (b: Box) => { const el = imgRef.current; if (!el) return {}; const n = norm(b);
    return { left: `${(n.x0 / el.naturalWidth) * 100}%`, top: `${(n.y0 / el.naturalHeight) * 100}%`, width: `${((n.x1 - n.x0) / el.naturalWidth) * 100}%`, height: `${((n.y1 - n.y0) / el.naturalHeight) * 100}%` }; };

  async function send() { onDone({ send: true, image: await canvasPainter.paint(redacted, boxes.map(norm)) }); }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="cp-title" className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-3xl w-full p-6 space-y-4 max-h-full overflow-auto">
        <h2 id="cp-title" className="text-xl font-bold">Send to cloud?</h2>
        <p className="text-slate-700">We couldn't be sure every private number was found. Check the image — black boxes will be hidden from the cloud. Drag over anything else to hide it.</p>
        <div className="relative select-none touch-none"
          onPointerDown={(e) => { const p = toImg(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
          onPointerMove={(e) => drag && setDrag({ ...drag, x1: toImg(e).x, y1: toImg(e).y })}
          onPointerUp={() => { if (drag) setBoxes([...boxes, norm(drag)]); setDrag(null); }}>
          <img ref={imgRef} src={url} alt="Bill with private numbers blacked out" className="w-full" draggable={false} />
          {[...boxes, ...(drag ? [drag] : [])].map((b, i) => <div key={i} className="absolute bg-black" style={pct(b)} />)}
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="px-5 py-3 rounded-lg bg-emerald-700 text-white" onClick={send}>Send to cloud</button>
          <button className="px-5 py-3 rounded-lg border" onClick={() => onDone({ send: false })}>Keep on device</button>
          <button className="px-3 py-3 text-sm underline" onClick={() => setBoxes([])} disabled={!boxes.length}>Undo my boxes</button>
          <button className="px-3 py-3 text-sm underline" onClick={() => { const el = imgRef.current!; setBoxes([...boxes, { x0: 0, y0: el.naturalHeight * 0.66, x1: el.naturalWidth, y1: el.naturalHeight }]); }}>
            Black out bottom third</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `ResultPanel.tsx`**

```tsx
import { useState } from 'react';
import type { Checks, Extraction, ProcessedBill } from '../../core/types';
import { runChecks } from '../../core/checks/checks';
import { parseConfig } from '../../core/config/parseConfig';
import { updateBillFields } from '../../adapters/store';

const REASON: Record<string, string> = {
  passed: '', total_mismatch: 'total mismatch', invalid_gstin: 'invalid GSTIN', low_confidence: 'low confidence',
  device_timeout: 'on-device read too slow', device_error: 'on-device error', invalid_json: 'unreadable answer',
  no_device_model: 'no on-device AI', cloud_only_mode: 'cloud-only mode', cloud_error: 'cloud unavailable',
  ocr_error: 'could not check for private numbers', user_kept_local: 'kept on device',
};
const CHECK_MSG: Record<keyof Checks, string> = { total: 'Items + tax ≠ total', gstin: 'GSTIN invalid', taxSplit: 'Tax split does not match states', date: 'Date invalid or in the future', required: 'Required field missing' };
const EMPTY: Extraction = { supplierName: '', supplierGstin: '', invoiceNo: '', invoiceDate: '', placeOfSupply: '', taxableValue: 0, cgst: 0, sgst: 0, igst: 0, total: 0, confidence: 0 };
const FIELDS: Array<[keyof Extraction, string, 'text' | 'number']> = [
  ['supplierName', 'Supplier', 'text'], ['supplierGstin', 'Supplier GSTIN', 'text'], ['invoiceNo', 'Invoice no.', 'text'],
  ['invoiceDate', 'Invoice date', 'text'], ['placeOfSupply', 'Place of supply', 'text'], ['taxableValue', 'Taxable value', 'number'],
  ['cgst', 'CGST', 'number'], ['sgst', 'SGST', 'number'], ['igst', 'IGST', 'number'], ['total', 'Total', 'number'],
];
const FIELD_CHECK: Partial<Record<keyof Extraction, keyof Checks>> = { supplierGstin: 'gstin', invoiceDate: 'date', total: 'total', cgst: 'taxSplit', sgst: 'taxSplit', igst: 'taxSplit' };

export default function ResultPanel({ shopId, billId, result, originalUrl }: { shopId: string; billId: string; result: ProcessedBill; originalUrl: string }) {
  const [e, setE] = useState<Extraction>(result.extraction ?? EMPTY);
  const [checks, setChecks] = useState<Checks | null>(result.checks);
  const [showSent, setShowSent] = useState(false);
  const [saved, setSaved] = useState(false);
  const sentUrl = result.redactedImage ? URL.createObjectURL(result.redactedImage) : null;
  const { path, reason } = result.route;
  const badge = path === 'device' && reason === 'passed' ? 'Read on device'
    : path === 'cloud' ? `Checked in cloud: ${REASON[reason]}` : `Manual entry: ${REASON[reason]}`;

  async function save() {
    const c = runChecks(e, parseConfig({}, true), new Date()).checks;
    setChecks(c);
    await updateBillFields(shopId, billId, e, c);
    setSaved(true);
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 mt-3">
      <div>
        <img src={showSent && sentUrl ? sentUrl : originalUrl} alt={showSent ? 'Image sent to cloud (redacted)' : 'Original bill (stays on this computer)'} className="w-full rounded border" />
        {sentUrl && <button className="text-sm underline mt-1" onClick={() => setShowSent(!showSent)}>{showSent ? 'Show original' : 'Show what the cloud saw'}</button>}
      </div>
      <div className="space-y-2">
        <span className={`inline-block px-3 py-1 rounded-full text-sm ${path === 'device' && reason === 'passed' ? 'bg-emerald-100 text-emerald-900' : path === 'cloud' ? 'bg-sky-100 text-sky-900' : 'bg-amber-100 text-amber-900'}`}>{badge}</span>
        {result.piiMasked > 0 && <p className="text-sm text-slate-600">{result.piiMasked} private number(s) hidden: {result.piiTypes.join(', ')}</p>}
        {checks && (Object.keys(CHECK_MSG) as (keyof Checks)[]).filter((k) => !checks[k]).map((k) => <p key={k} className="text-red-700 text-sm">⚠ {CHECK_MSG[k]}</p>)}
        {FIELDS.map(([k, label, type]) => {
          const bad = checks && FIELD_CHECK[k] && !checks[FIELD_CHECK[k]!];
          return (
            <label key={k} className="block text-sm">{label}
              <input type={type} step="0.01" className={`mt-1 w-full border rounded p-2 ${bad ? 'border-red-600 bg-red-50' : ''}`} aria-invalid={!!bad}
                value={String(e[k] ?? '')} onChange={(ev) => { setSaved(false); setE({ ...e, [k]: type === 'number' ? Number(ev.target.value) : ev.target.value }); }} />
            </label>
          );
        })}
        <button className="px-5 py-3 rounded-lg bg-emerald-700 text-white" onClick={save}>{saved ? 'Saved ✓' : 'Save changes'}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `BillCard.tsx` and `UploadPage.tsx`**

```tsx
// BillCard.tsx
import type { BillJob } from './useBillProcessor';
import ResultPanel from '../result/ResultPanel';
import ConsentPreview from '../preview/ConsentPreview';
import type { ConsentResult, Step } from '../../core/types';

const STEPS: Array<[Step, string]> = [['availability', 'Checking device AI'], ['device_read', 'Reading on device'], ['checking', 'Checking maths'],
  ['redacting', 'Hiding private numbers'], ['awaiting_consent', 'Waiting for you'], ['cloud_read', 'Reading in cloud'], ['done', 'Saved']];

export default function BillCard({ job, shopId, onRetry, onConsent }: { job: BillJob; shopId: string; onRetry(): void; onConsent(r: ConsentResult): void }) {
  const current = STEPS.findIndex(([s]) => s === job.step);
  return (
    <li className="bg-white rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{job.file.name}</span>
        {job.step === 'error' && <button className="text-sm underline" onClick={onRetry}>Retry</button>}
        {job.result?.route.reason === 'cloud_error' && <button className="text-sm underline" onClick={onRetry}>Retry cloud</button>}
      </div>
      {job.step !== 'done' && job.step !== 'error' && (
        <ol className="flex flex-wrap gap-2 mt-2 text-xs" aria-live="polite">
          {STEPS.map(([s, label], i) => <li key={s} className={i === current ? 'font-bold text-emerald-800' : i < current ? 'text-slate-400 line-through' : 'text-slate-400'}>{label}</li>)}
        </ol>
      )}
      {job.step === 'queued' && <p className="text-sm text-slate-500 mt-2">Queued</p>}
      {job.error && <p className="text-red-700 text-sm mt-2">Something went wrong: {job.error}. The photo is still here — try again.</p>}
      {job.consent && <ConsentPreview redacted={job.consent.redacted} onDone={onConsent} />}
      {job.result && job.billId && <ResultPanel shopId={shopId} billId={job.billId} result={job.result} originalUrl={job.originalUrl} />}
    </li>
  );
}
```

```tsx
// UploadPage.tsx
import { useEffect, useState, type DragEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Shop } from '../../adapters/store';
import { warmUpOcr } from '../../adapters/tesseractOcr';
import { useBillProcessor } from './useBillProcessor';
import AiStatusChip from './AiStatusChip';
import BillCard from './BillCard';

export default function UploadPage() {
  const { shopId } = useParams();
  const [shop, setShop] = useState<Shop | null>(null);
  const [over, setOver] = useState(false);
  useEffect(() => onSnapshot(doc(db, 'shops', shopId!), (s) => setShop(s.exists() ? ({ id: s.id, ...s.data() } as Shop) : null)), [shopId]);
  useEffect(() => warmUpOcr(), []);
  const { bills, addFiles, retry, resolveConsent } = useBillProcessor(shop);
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); addFiles([...e.dataTransfer.files]); };

  return (
    <div className="space-y-4">
      <Link to="/shops" className="text-sm underline">← Shops</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{shop?.shopName ?? '…'}</h1>
        <AiStatusChip />
      </div>
      <label onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
        className={`block border-2 border-dashed rounded-xl p-10 text-center cursor-pointer ${over ? 'border-emerald-600 bg-emerald-50' : 'border-slate-300 bg-white'}`}>
        <span className="text-lg">Drop bill photos here, or click to choose (JPEG/PNG)</span>
        <input type="file" multiple accept="image/jpeg,image/png" className="sr-only" onChange={(e) => e.target.files && addFiles([...e.target.files])} />
      </label>
      <ul className="space-y-3">
        {bills.map((b) => <BillCard key={b.id} job={b} shopId={shopId!} onRetry={() => retry(b.id)} onConsent={(r) => resolveConsent(b.id, r)} />)}
      </ul>
    </div>
  );
}
```

- [ ] **Step 6: Verify manually on the Nano-capable machine** (`npm run dev`):
  1. Clean bill → steps run → badge "Read on device"; Firestore has the bill + a route log with `path: device`.
  2. Set RC `routing_mode=cloud_only` (console, publish, wait ≥30 s) → bill shows "Checked in cloud: cloud-only mode"; "Show what the cloud saw" shows PAN/phone blacked out, GSTIN visible.
  3. A bill with a smudged PAN (or a "PAN:" label with nothing readable) → preview opens; draw a box; Send → cloud result. Repeat with Keep on device → "Manual entry: kept on device".
  4. `routing_mode=device_only` with a blurry bill → manual entry, and DevTools Network shows no `generativelanguage`/`firebasevertexai` request.
  5. DevTools offline mid-upload on a cloud bill → manual entry "cloud unavailable" with Retry; back online → Retry works.
  6. Edit a red field to the right value → Save → red mark clears.
- [ ] **Step 7: Commit** — `feat(web): upload flow with live steps, consent preview and result panel`

---

### Task 13: Routing dashboard

**Files:**
- Create: `web/src/core/stats/routeStats.ts`, `web/tests/core/routeStats.test.ts`, `web/src/features/dashboard/DashboardPage.tsx`
- Modify: `web/src/App.tsx` (add `<Route path="/dashboard" element={<DashboardPage />} />` inside Layout)

**Interfaces:**
- Produces: `routeStats(logs: Pick<RouteLogDoc,'path'|'reason'|'piiMasked'|'piiTypes'|'estCostUsd'>[], costPerCall: number): RouteStats` where
  `RouteStats = { total: number; device: number; cloud: number; devicePct: number; reasons: Record<string, number>; piiByType: Record<string, number>; piiTotal: number; costUsd: number; savedUsd: number }`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { routeStats } from '../../src/core/stats/routeStats';

describe('routeStats', () => {
  it('aggregates paths, reasons, PII and cost saved', () => {
    const s = routeStats([
      { path: 'device', reason: 'passed', piiMasked: 0, piiTypes: [], estCostUsd: 0 },
      { path: 'device', reason: 'passed', piiMasked: 0, piiTypes: [], estCostUsd: 0 },
      { path: 'cloud', reason: 'total_mismatch', piiMasked: 2, piiTypes: ['PAN', 'PHONE'], estCostUsd: 0.0003 },
      { path: 'device', reason: 'user_kept_local', piiMasked: 1, piiTypes: ['PAN'], estCostUsd: 0 },
    ], 0.0003);
    expect(s).toMatchObject({ total: 4, device: 3, cloud: 1, devicePct: 75, piiTotal: 3, costUsd: 0.0003 });
    expect(s.reasons).toEqual({ passed: 2, total_mismatch: 1, user_kept_local: 1 });
    expect(s.piiByType).toEqual({ PAN: 2, PHONE: 1 });
    expect(s.savedUsd).toBeCloseTo(0.0009);
  });
  it('handles no logs', () => expect(routeStats([], 0.0003)).toMatchObject({ total: 0, devicePct: 0 }));
});
```

Note: `piiByType` counts bills containing each type (types are stored, not per-type counts).

- [ ] **Step 2: FAIL. Step 3: Implement**

```ts
import type { RouteLogDoc } from '../router/routeLog';
export type RouteStats = { total: number; device: number; cloud: number; devicePct: number; reasons: Record<string, number>;
  piiByType: Record<string, number>; piiTotal: number; costUsd: number; savedUsd: number };

export function routeStats(logs: Pick<RouteLogDoc, 'path' | 'reason' | 'piiMasked' | 'piiTypes' | 'estCostUsd'>[], costPerCall: number): RouteStats {
  const s: RouteStats = { total: logs.length, device: 0, cloud: 0, devicePct: 0, reasons: {}, piiByType: {}, piiTotal: 0, costUsd: 0, savedUsd: 0 };
  for (const l of logs) {
    if (l.path === 'device') s.device++; else s.cloud++;
    s.reasons[l.reason] = (s.reasons[l.reason] ?? 0) + 1;
    for (const t of l.piiTypes) s.piiByType[t] = (s.piiByType[t] ?? 0) + 1;
    s.piiTotal += l.piiMasked;
    s.costUsd += l.estCostUsd;
  }
  s.devicePct = s.total ? Math.round((s.device / s.total) * 100) : 0;
  s.savedUsd = s.total * costPerCall - s.costUsd;
  return s;
}
```

PASS.

- [ ] **Step 4: `DashboardPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { watchRouteLogs } from '../../adapters/store';
import { loadConfig } from '../../adapters/remoteConfig';
import { routeStats } from '../../core/stats/routeStats';
import { CLOUD_COST_PER_CALL_USD } from '../../core/config/defaults';
import type { RouteLogDoc } from '../../core/router/routeLog';
import type { RoutingMode } from '../../core/types';

const Tile = ({ label, value, tone = '' }: { label: string; value: string; tone?: string }) => (
  <div className="bg-white rounded-lg border p-4"><div className="text-sm text-slate-500">{label}</div><div className={`text-3xl font-bold ${tone}`}>{value}</div></div>
);

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const [logs, setLogs] = useState<RouteLogDoc[]>([]);
  const [mode, setMode] = useState<RoutingMode | null>(null);
  useEffect(() => watchRouteLogs(user!.uid, profile?.role === 'admin', setLogs), [user, profile]);
  useEffect(() => { const t = setInterval(() => loadConfig().then((c) => setMode(c.routingMode)), 30_000); void loadConfig().then((c) => setMode(c.routingMode)); return () => clearInterval(t); }, []);
  const s = routeStats(logs, CLOUD_COST_PER_CALL_USD);
  const bar = (n: number, max: number) => <div className="h-2 bg-emerald-600 rounded" style={{ width: `${max ? (n / max) * 100 : 0}%` }} />;
  const maxReason = Math.max(0, ...Object.values(s.reasons));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Routing</h1>
        <span className="px-3 py-1 rounded-full bg-slate-200 text-sm">Mode: {mode ?? '…'}</span></div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Bills read on device" value={`${s.devicePct}%`} tone="text-emerald-700" />
        <Tile label="Bills checked in cloud" value={`${s.cloud}`} />
        <Tile label="Private numbers hidden" value={`${s.piiTotal}`} />
        <Tile label="Raw private numbers sent to cloud" value="0" tone="text-emerald-700" />
      </div>
      <p className="text-sm text-slate-600">Estimated cloud cost ${s.costUsd.toFixed(4)} · saved vs all-cloud ${s.savedUsd.toFixed(4)} · {s.total} bills</p>
      <section className="bg-white rounded-lg border p-4">
        <h2 className="font-semibold mb-2">Why bills went where they did</h2>
        <ul className="space-y-2">{Object.entries(s.reasons).sort((a, b) => b[1] - a[1]).map(([r, n]) =>
          <li key={r}><div className="flex justify-between text-sm"><span>{r.replace(/_/g, ' ')}</span><span>{n}</span></div>{bar(n, maxReason)}</li>)}</ul>
      </section>
      <section className="bg-white rounded-lg border p-4">
        <h2 className="font-semibold mb-2">Hidden by type (bills)</h2>
        <ul className="text-sm">{Object.entries(s.piiByType).map(([t, n]) => <li key={t}>{t}: {n}</li>)}</ul>
      </section>
    </div>
  );
}
```

The "Raw private numbers sent to cloud: 0" tile is backed by the redaction guarantee and the leak-check run (Task 10); the README must cite that run.

- [ ] **Step 5: Verify** — `npm test`; in dev, process a few bills and watch tiles update live without reload; flip RC mode and see the chip change within ~30 s.
- [ ] **Step 6: Commit** — `feat(web): live routing dashboard`

---

### Task 14: Deploy to Hosting + README

**Files:**
- Create: `README.md`, `LICENSE` (Apache-2.0 text)
- Modify: `web/package.json` (add `"deploy": "npm run build && cd ../firebase && firebase deploy --only hosting --project hisaabcheck-dev"`)

- [ ] **Step 1: Pre-deploy checks** — `cd web && npm test && npm run test:rules && npm run build`. All pass. Confirm `dist/` contains no `AccuracyPage` chunk: `grep -rl "Accuracy & leak check" dist || echo "dev page excluded"` → prints `dev page excluded`.
- [ ] **Step 2: Production App Check** — register the Hosting domain (`hisaabcheck-dev.web.app`) on the reCAPTCHA Enterprise key, and in the console enforce App Check for Firebase AI Logic. Build without the debug flag: `VITE_APPCHECK_DEBUG=false npm run build`.
- [ ] **Step 3: Deploy** — `npm run deploy` → note the Hosting URL.
- [ ] **Step 4: Smoke test on the hosted URL** — repeat Task 12 Step 6 items 1–4 on the hosted site; open `/dashboard`.
- [ ] **Step 5: README** — sections: what it is (one paragraph from the PRD overview), how hybrid routing works (the 6 cascade steps, the never-`PREFER_*` rule, Remote Config keys table), privacy proof (leak-check numbers from Task 10), setup (`.env.example`, Firebase steps from Task 8, App Check debug token for judges), tests (`npm test`, `npm run test:rules`), measured accuracy (only real numbers). Add Apache-2.0 `LICENSE`. Do **not** push to a public remote until the user confirms the Pacewisdom code-ownership check (PRD checklist).
- [ ] **Step 6: Commit** — `docs: README, license, hosting deploy script`

---

## Verification (end to end)

1. `cd web && npm test` — all core suites pass (parseConfig, checksums, shield vectors, planRedaction, parse, checks vectors, processBill, routeLog, compareFields, routeStats, privacy guards).
2. `npm run test:rules` — Firestore rules suite passes on the emulator.
3. `npm run build` — strict type-check passes; Tesseract is a separate lazy chunk; no dev accuracy page in `dist`.
4. Accuracy page on 40 real bills: PII left after redaction = 0; device and cloud field accuracy recorded (target ≥ 90%).
5. Hosted URL manual run: device pass, cloud escalation with redacted "what the cloud saw", consent preview send/keep, `device_only` kill switch with no AI network calls, cloud failure → manual entry + retry, dashboard updates live.

## Spec coverage notes

- Spec §1–§12 map to Tasks: foundation (8, 9, 14), core (1–7), screens (11–13), accuracy tool (10), error table (7 router + 12 UI), testing (all), build order (task order; Task 10 is the day-1 gate).
- Deferred to sub-project B: storing redacted images for device-path bills (so the CA can see a photo later), inbox de-dupe on retry, approve/reject.
