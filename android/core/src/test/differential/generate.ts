/**
 * Generates the differential corpora in ../resources/differential/ by running the web's TypeScript core
 * (the specification) on seeded random inputs plus a deterministic edge section per area. The Kotlin
 * DifferentialTest replays them and demands identical output.
 *
 * Regenerate (from the repository root):
 *   cd web && npx vite-node ../android/core/src/test/differential/generate.ts
 *
 * Deterministic: the same seed always gives the same files. It also writes manifest.json: the SHA-256 of the raw
 * bytes of every TypeScript source the corpora come from (SOURCES below) and of this file. The Kotlin
 * DifferentialManifestTest fails when any of them changes, so stale fixtures cannot pass silently.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

const JS_WS = ['\t', '\n', '\u000B', '\u000C', '\r', ' ', '\u00A0', '\u1680', '\u2000', '\u2005', '\u200A', '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF'];
const NOT_WS = ['\u0085', '\u180E', '\u200B', '\u001C'];
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
  'CGST', '9%', 'Karnataka', '29-Karnataka', 'smudge', '____', 'No', 'No.', '#', ':', 'stra\u00DFe', '\u00E9t\u00E9', '\u0661\u0662\u0663',
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

function shieldCase(words: OcrWord[], threshold: number, cat?: string) {
  const r = runShield(words, threshold);
  const plan = planRedaction(words, r, 1000, 120);
  return {
    ...(cat ? { cat } : {}),
    // [text, line, confidence as String(n) (so NaN, Infinity and -0 survive), x0, y0, x1, y1]
    words: words.map((w) => [w.text, w.line, num(w.confidence), w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1]),
    threshold,
    gstinWordIndexes: r.gstinWordIndexes,
    matches: r.matches.map((m) => ({ type: m.type, wordIndexes: m.wordIndexes })),
    uncertainReasons: r.uncertainReasons,
    uncertain: r.uncertain,
    adequate: ocrAdequate(words),
    boxes: plan.boxes.map((b) => [num(b.x0), num(b.y0), num(b.x1), num(b.y1)]),
    piiTypes: plan.piiTypes,
  };
}

const randomShieldCases = Array.from({ length: 1450 }, () => shieldCase(randomWords(), pick([0.6, 0.6, 0.6, 0.5, 0.9])));

// ---- shield edge section: inputs the random bulk never produces

/** Words from [text, line, confidence] triples; boxes advance per line like the web helper. Empty texts are kept. */
function place(entries: Array<[string, number, number]>): OcrWord[] {
  const xs = new Map<number, number>();
  return entries.map(([text, line, confidence]) => {
    const x = xs.get(line) ?? 0;
    xs.set(line, x + text.length * 10 + 10);
    return { text, confidence, line, bbox: { x0: x, y0: line * 20, x1: x + text.length * 10, y1: line * 20 + 16 } };
  });
}
const tokensOfLine = () => {
  const out: string[] = [];
  for (let k = 0, n = 1 + int(5); k < n; k++) out.push(...pick([() => pick(LABEL_WORDS), piiToken, piiToken, () => pick(FILLER)])().split(' ').filter(Boolean));
  return out;
};
/** Random lines of tokens, each token transformed by `f`. */
const linesOf = (nLines: number, f: (t: string) => string, conf: () => number = () => 95): Array<[string, number, number]> => {
  const out: Array<[string, number, number]> = [];
  for (let li = 0; li < nLines; li++) for (const t of tokensOfLine()) out.push([f(t), li, conf()]);
  return out;
};
const insertAt = (t: string, s: string) => { const i = int(t.length + 1); return t.slice(0, i) + s + t.slice(i); };
/** Astral (non-BMP) characters, each a valid surrogate pair: a real emoji, a regional-indicator flag pair, a mathematical digit. */
const EMOJI_GRINNING = '\u{1F600}';
const FLAG_INDIA = '\u{1F1EE}\u{1F1F3}';
const MATH_BOLD_ONE = '\u{1D7CF}';
const ASTRAL = [EMOJI_GRINNING, FLAG_INDIA, MATH_BOLD_ONE];
/** Unpaired or reversed surrogate code units: kept apart from the astral set. */
const LONE_SURROGATES = ['\uD800', '\uDBFF', '\uDC00', '\uDFFF', '\uDE00\uD83D'];
/** Other BMP marks seen next to numbers: zero-width joiner, variation selector 16, rupee sign. */
const MARKS = ['\u200D', '\uFE0F', '\u20B9'];
const FI_LIGATURE = '\uFB01';
const DOTLESS_I = '\u0131';
const LONG_S = '\u017F';
const SHARP_S = '\u00DF';
const caseFold = (t: string) => t.toLowerCase()
  .replace(/fi/g, () => (chance(0.5) ? FI_LIGATURE : 'fi'))
  .replace(/i/g, () => (chance(0.5) ? DOTLESS_I : 'i'))
  .replace(/s/g, () => (chance(0.5) ? LONG_S : 's'))
  .replace(/n/g, () => (chance(0.1) ? '\u0149' : 'n'));
const DIGIT_BASES = [0xff10, 0x0966, 0x0660, 0x06f0];
const foreignDigits = (t: string) => t.replace(/\d/g, (d) => {
  if (!chance(0.35)) return d;
  return chance(0.2) ? '\uD835' + String.fromCharCode(0xdfce + Number(d)) : String.fromCharCode(pick(DIGIT_BASES) + Number(d));
});
const EXTREME_CONF = [0, -0, 100, 100.5, 150, 1e9, -5, Number.NaN, Infinity, -Infinity, 60, 60.00000000000001, 59.99999999999999, 50, 49.99];

const edgeShield: Array<ReturnType<typeof shieldCase>> = [];
const edge = (cat: string, words: OcrWord[], threshold = 0.6) => edgeShield.push(shieldCase(words, threshold, cat));
// Negative line indexes (JavaScript drops them: never scanned, never a previous line).
for (const w of [[['AAPFU0939F', -1, 95]], [['Account', -1, 95], ['50100234567890', 0, 95]], [['PAN', -1, 95], ['AAPFU0939F', 0, 95]],
  [['Mob', 0, 95], ['98450', -1, 95], ['12345', 0, 95]], [['ABCDE12', -3, 10], ['Ref1234', -1, 10]]] as Array<Array<[string, number, number]>>) edge('negative_line', place(w));
for (let k = 0; k < 35; k++) edge('negative_line', place(linesOf(1 + int(3), (t) => t).map(([t, li, c]) => [t, chance(0.4) ? -1 - int(3) : li, c])));
// Surrogate pairs, emoji, lone surrogates, joiners next to and inside numbers.
// Every case carries one named astral character (in turn) in its first token, more at random elsewhere.
for (let k = 0; k < 40; k++) {
  const w = linesOf(1 + int(3), (t) => (chance(0.4) ? insertAt(t, pick([...ASTRAL, ...MARKS])) : t));
  w[0][0] = insertAt(w[0][0], ASTRAL[k % ASTRAL.length]);
  edge('surrogates_emoji', place(w));
}
// Lone and reversed surrogate code units inside and next to numbers.
for (let k = 0; k < 20; k++) {
  const w = linesOf(1 + int(3), (t) => (chance(0.4) ? insertAt(t, pick(LONE_SURROGATES)) : t));
  w[0][0] = insertAt(w[0][0], LONE_SURROGATES[k % LONE_SURROGATES.length]);
  edge('lone_surrogates', place(w));
}
// Upper-casing that maps into ASCII or changes length (dotless i, long s, fi ligature, sharp s, n preceded by apostrophe).
// The fi ligature is also injected directly: as a prefix, inside a token, or replacing one character.
const ligature = (t: string) => pick([() => FI_LIGATURE + t, () => insertAt(t, FI_LIGATURE), () => { const i = int(t.length); return t.slice(0, i) + FI_LIGATURE + t.slice(i + 1); }])();
const CASE_STEPS = [caseFold, (t: string) => SHARP_S + t, ligature, (t: string) => t];
const NAMED_CASE_STEPS = [ligature, (t: string) => insertAt(t, DOTLESS_I), (t: string) => insertAt(t, LONG_S), (t: string) => SHARP_S + t];
for (let k = 0; k < 48; k++) {
  const w = linesOf(1 + int(3), (t) => pick(CASE_STEPS)(t));
  // Each case carries at least one named character, in turn: fi ligature, dotless i, long s, sharp s.
  w[0][0] = NAMED_CASE_STEPS[k % 4](w[0][0]);
  // Labels spelled with the same characters (they upper-case to MOBILE:, ACCOUNT and FIPAN).
  if (k % 3 === 0) w.unshift(['M' + DOTLESS_I + 'ob' + DOTLESS_I + 'le:', 0, 95], ['Acc' + LONG_S + 'ount', 0, 95], [FI_LIGATURE + 'PAN', 0, 95]);
  edge('case_mapping', place(w));
}
// Full-width, Devanagari, Arabic-Indic, Persian and mathematical (non-BMP) digits.
for (let k = 0; k < 40; k++) edge('foreign_digits', place(linesOf(1 + int(3), foreignDigits)));
// Confidence 0, -0, above 100, NaN, infinities, and the 0.6 * 100 = 60.00000000000001 boundary; enough words for ocrAdequate.
for (let k = 0; k < 40; k++) edge('confidence_extremes', place(linesOf(4 + int(4), (t) => t, () => pick(EXTREME_CONF))), pick([0.6, 0.5, 0, 1]));
// Very long lines: hundreds of words, and single words thousands of characters long.
for (let k = 0; k < 6; k++) edge('long_lines', place(Array.from({ length: 300 + int(300) }, () => [pick([piiToken, () => pick(FILLER), () => pick(LABEL_WORDS)])().replace(/ /g, ''), 0, 95] as [string, number, number])));
for (let k = 0; k < 4; k++) edge('long_lines', place([['Account', 0, 95], [rs(DIG, 3000 + int(2000)), 0, 95], ['Mob', 0, 95], [rs(DIG + UPPER + ' -', 4000), 0, 95]]));
// Empty and whitespace-only word texts (the web helper's filter(Boolean) never produces them).
for (let k = 0; k < 40; k++) {
  const w = linesOf(1 + int(3), (t) => t);
  for (let j = 0, n = 1 + int(4); j < n; j++) w.splice(int(w.length + 1), 0, [pick(['', '', ' ', '\u00A0', '\t']), int(3), 95]);
  edge('empty_words', place(w));
}

// Long digit runs: bank accounts behind OCR look-alikes of A/C, with no label, grouped, and the non-private long runs
// around them (amounts, times, GSTINs). Its own seeded generator, so the other corpora keep their bytes.
const lr = mulberry32(20261127);
const lrInt = (n: number) => Math.floor(lr() * n);
const lrPick = <T>(a: readonly T[]): T => a[lrInt(a.length)];
const lrDigits = (n: number) => Array.from({ length: n }, () => DIG[lrInt(10)]).join('');
const LOOKALIKE_LABELS = ['AJC No:', 'AJC', 'A1C No:', 'AIC No', 'AlC No:', 'A|C', 'A\\C No:', 'A!C', 'A7C No', 'A/C', 'A/c No',
  'Acct', 'Account No', 'Acc. Number', 'ACC#', 'Bank A/c', 'SB A/c', 'Current A/c', 'CA No', 'AC', 'AC No', 'HbA1c', 'ALCOHOL'];
const LR_FILLER = ['Beneficiary', 'Ref', 'Total', 'Rs.', 'Qty', 'Kg', 'HSN', '1006', '10063010', 'Date:', '02-11-2026', '10:30', 'Invoice', 'No:',
  '452156', 'E-Way', 'Bill', 'Ack', 'IRN', '560001', '22AAAAA0000A1Z5', '27AAPFU0939F1ZV', '1,23,45,678.00', '240', '12'];
const LR_SEP = ['', '', ' ', ' ', ' ', '-', '\u00A0', '\u2007', '\u0085', '.', ',', ':'];
/** n digits cut into groups of random sizes (1 to 6, or 4 like a printed account), joined by a random separator each. */
const lrGrouped = (n: number) => {
  const d = lrDigits(n);
  const fours = lr() < 0.4;
  let out = ''; let i = 0;
  while (i < d.length) {
    const g = fours ? 4 : 1 + lrInt(6);
    out += (i === 0 ? '' : lrPick(LR_SEP)) + d.slice(i, i + g);
    i += g;
  }
  return out;
};
const lrRun = () => {
  const n = lrPick([7, 8, 9, 9, 10, 11, 12, 12, 13, 14, 14, 15, 16, 17, 18, 18, 19, 20, 24]);
  return lrPick([() => lrDigits(n), () => lrDigits(n), () => lrGrouped(n),
    () => lrDigits(n) + lrPick(['.00', '.5', ',78', ':30']), () => lrPick(['.', ',', ':', '7.', '9,']) + lrDigits(n),
    () => lrPick(['AJC', 'AC', 'INV', 'X']) + lrDigits(n), () => lrDigits(n) + lrPick(['A', 'Z'])])();
};
const lrLine = (li: number, k: number): Array<[string, number, number]> => {
  const toks: string[] = [];
  for (let j = 0, n = lrInt(3); j < n; j++) toks.push(lrPick(LR_FILLER));
  if (k % 3 !== 2) toks.push(lrPick(LOOKALIKE_LABELS)); // a third of the cases have no label at all
  toks.push(lrRun());
  for (let j = 0, n = lrInt(3); j < n; j++) toks.push(lrPick([...LR_FILLER, lrRun()]));
  return toks.join(' ').split(' ').filter(Boolean).map((t) => [t, li, lrPick([95, 92, 93, 70, 40])] as [string, number, number]);
};
for (let k = 0; k < 240; k++) {
  const w = lrLine(0, k);
  // Sometimes the label sits alone on the line before (label-on-previous-line path), or a second line follows.
  if (k % 5 === 0) w.forEach((e) => { e[1] = 1; });
  if (k % 5 === 0) w.unshift([lrPick(LOOKALIKE_LABELS), 0, 95]);
  else if (k % 5 === 1) w.push(...lrLine(1, k + 1));
  edge('long_digit_runs', place(w.flatMap(([t, li, c]) => t.split(' ').map((x) => [x, li, c] as [string, number, number]))));
}
// The exact reading from the first real run (AJC 92, No: 93, the account 92) and its fixed boundaries.
edge('long_digit_runs', place([['AJC', 0, 92], ['No:', 0, 93], ['50100234567891', 0, 92]]));
for (const line of ['Beneficiary 5010 0234 5678 91', 'Ref 123456789', 'Ref 123456789012345678', 'Ref 12345678', 'Ref 1234567890123456789',
  'Total 50100234567.00', 'Invoice No: 452156', 'GSTIN 27AAPFU0939F1ZV 50100234567891', 'Beneficiary 50100 2 34567891', 'Rice 1006 2 120 240']) {
  edge('long_digit_runs', place(line.split(' ').map((t) => [t, 0, 95] as [string, number, number])));
}

// Digit-run edges (round 2): matches inside longer runs, parenthesised landlines, amounts and times next to long runs,
// dotted groups, runs of 19 or more digits, IFSC look-alikes, border characters and amount- or GSTIN-shaped
// low-confidence words. Its own seeded generator, so the other corpora keep their bytes.
const dr = mulberry32(20261128);
const drInt = (n: number) => Math.floor(dr() * n);
const drPick = <T>(a: readonly T[]): T => a[drInt(a.length)];
const drDigits = (n: number) => Array.from({ length: n }, () => DIG[drInt(10)]).join('');
const drSep = () => drPick([' ', ' ', '-', '.', '', '\u00A0', '\u3000', '\u0085', ':', ',']);
const drMobile = () => drPick(['6', '7', '8', '9']) + drDigits(9);
const drAadhaar = () => { const b = drPick('23456789'.split('')) + drDigits(10); return b + verhoeffCheck(b); };
const DR_TOKENS: Array<() => string> = [
  () => drMobile().slice(0, 5) + ' ' + drMobile().slice(5) + drSep() + drDigits(1 + drInt(5)), // mobile and more digits
  () => { const a = drAadhaar(); return a.slice(0, 4) + ' ' + a.slice(4, 8) + ' ' + a.slice(8) + drSep() + drDigits(1 + drInt(6)); },
  () => drDigits(1 + drInt(3)) + drSep() + drAadhaar(),
  () => drPick(['(', '', '(']) + '0' + drDigits(2 + drInt(3)) + drPick([')', ')', '']) + drPick([' ', '', '-']) + drDigits(3 + drInt(2)) + drPick([' ', '', '-']) + drDigits(3 + drInt(2)),
  () => drDigits(1 + drInt(20)) + drPick(['.00', '.5', ',78', '.0', '']),
  () => drDigits(1 + drInt(3)) + ':' + drDigits(2 + drInt(14)),
  () => Array.from({ length: 2 + drInt(4) }, () => drDigits(1 + drInt(5))).join(drPick(['.', ' ', '-'])),
  () => drDigits(19 + drInt(12)),
  () => drPick(['SBIN', 'HDFC', 'CNRB', 'PROM', 'KKBK']) + drPick(['O', 'o', 'Q', 'D', '0']) + drPick([drDigits(6), 'TIONAL', drDigits(3) + 'ABC', 'G' + drDigits(5)]),
  () => drPick(['|', '[', ']', '!', '', '|[']) + drPick([drDigits(1 + drInt(3)) + ',' + drDigits(3) + '.00', drDigits(4 + drInt(6)), drDigits(1) + ',' + drDigits(2) + ',' + drDigits(3) + '.00']) + drPick(['', '|', ']', '!']),
  () => drDigits(2) + drPick(['JRFE', 'KBSFKO', 'EATCM', 'ABCDE']) + drDigits(4 + drInt(3)) + drPick(['1Z8', 'Z', '128', '1ZXY']),
  () => drPick(['M8', 'J29', 'A4', '25kg']) + ' ' + drDigits(4 + drInt(5)),
  () => drPick(['02-11-2026', '2026-11-02', '10:30', '09.06.2026']) + ' ' + drDigits(1 + drInt(12)),
  () => drPick(['Account Number:', 'Pay', 'Ref', 'Tel:', 'IFSC:', 'Aadhaar', 'Mob', 'GSTIN', 'Total', 'Rs.']),
];
for (let k = 0; k < 300; k++) {
  const entries: Array<[string, number, number]> = [];
  for (let li = 0, nl = 1 + drInt(2); li < nl; li++) {
    for (let j = 0, n = 1 + drInt(4); j < n; j++) {
      for (const t of drPick(DR_TOKENS)().split(' ').filter(Boolean)) entries.push([t, li, drPick([95, 95, 92, 70, 40, 10])]);
    }
  }
  edge('digit_run_edges', place(entries));
}

// The 64 real Tesseract bills of shared/test-vectors/ocr-real.json, replayed word for word.
const OCR_REAL = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../shared/test-vectors/ocr-real.json');
for (const b of JSON.parse(readFileSync(OCR_REAL, 'utf8')).bills as Array<{ words: Array<[string, number, number, number, number, number, number]> }>) {
  edge('real_ocr', b.words.map(([text, x0, y0, x1, y1, confidence, line]) => ({ text, confidence, line, bbox: { x0, y0, x1, y1 } })));
}
// The 36 fresh bills of shared/test-vectors/ocr-real-fresh.json (the round-3 re-review), replayed word for word.
const OCR_FRESH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../shared/test-vectors/ocr-real-fresh.json');
for (const b of JSON.parse(readFileSync(OCR_FRESH, 'utf8')).bills as Array<{ words: Array<[string, number, number, number, number, number, number]> }>) {
  edge('real_ocr_fresh', b.words.map(([text, x0, y0, x1, y1, confidence, line]) => ({ text, confidence, line, bbox: { x0, y0, x1, y1 } })));
}

// The 30 bills of shared/test-vectors/ocr-real-review3.json (the round-4 review), replayed word for word.
const OCR_REVIEW3 = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../shared/test-vectors/ocr-real-review3.json');
for (const b of JSON.parse(readFileSync(OCR_REVIEW3, 'utf8')).bills as Array<{ words: Array<[string, number, number, number, number, number, number]> }>) {
  edge('real_ocr_review3', b.words.map(([text, x0, y0, x1, y1, confidence, line]) => ({ text, confidence, line, bbox: { x0, y0, x1, y1 } })));
}

// Round-4 edges: phone lists (comma, slash, suffixes, amounts after them), every run separator with JavaScript
// whitespace around it, two-group numbers with 2- to 5-digit decimal tails, bank cues with and without an account,
// 16-character GSTIN look-alikes, bracketed codes without a 0, IFSC digits next to amounts, invoice labels. Own seed.
const r4 = mulberry32(20261130);
const r4Int = (n: number) => Math.floor(r4() * n);
const r4Pick = <T>(a: readonly T[]): T => a[r4Int(a.length)];
const r4Digits = (n: number) => Array.from({ length: n }, () => DIG[r4Int(10)]).join('');
const R4_SEPS = [' ', '-', ' - ', ' -', '- ', ' / ', '/', '.', ',', ', ', '\u3000-\u3000', '\u00A0/\u00A0', '\u0085-'];
const R4_TOKENS: Array<() => string> = [
  () => '0' + r4Digits(2 + r4Int(3)) + r4Pick(['-', ' ']) + r4Digits(6 + r4Int(3)) + r4Pick([', ', ',', ' / ', '/', ' ,']) + r4Digits(r4Pick([2, 3, 4, 5, 6, 7, 8, 9])) + r4Pick(['', '.00', ' Total 4500.00', ', 4500.00']),
  () => r4Pick(['6', '7', '8', '9']) + r4Digits(9) + r4Pick([' / ', ', ']) + r4Digits(r4Pick([2, 4, 8, 10])),
  () => Array.from({ length: 2 + r4Int(4) }, () => r4Digits(2 + r4Int(4))).join(r4Pick(R4_SEPS)) + r4Pick(['', '.00', ',00']),
  () => r4Digits(4 + r4Int(5)) + r4Pick([' ', '-', ' - ', ', ']) + r4Digits(2 + r4Int(4)) + '.' + r4Digits(2),
  () => r4Pick(['Bank: Example Bank', 'Branch: Sample Nagar', 'NEFT', 'RTGS details', 'Beneficiary', 'Remittance', 'A/c No:', 'IFSC:']),
  () => r4Digits(2) + r4Pick(['ZB', 'AB', 'OI']) + r4Digits(8) + r4Pick(['O', 'Z', '1']) + r4Digits(r4Pick([3, 4])),
  () => r4Pick(['(', '[', '( ']) + r4Pick(['', '0', 'O']) + r4Digits(1 + r4Int(4)) + r4Pick([')', ']', ' )']) + ' ' + r4Digits(6 + r4Int(3)),
  () => r4Pick(['IDIB', 'HDFC', 'SBIN']) + '0' + r4Digits(6) + ' ' + r4Digits(4 + r4Int(3)) + r4Pick(['.00', '']),
  () => r4Pick(['Invoice No', 'INV', 'Bill No.', 'office', 'Ph:']) + ' 0' + r4Digits(3) + '-' + r4Digits(3 + r4Int(5)),
  () => r4Pick(['Pay to', 'Tel', 'Mob:', 'HSN', 'Total', 'Rs.']),
];
for (let k = 0; k < 300; k++) {
  const entries: Array<[string, number, number]> = [];
  for (let li = 0, nl = 1 + r4Int(3); li < nl; li++) {
    for (let j = 0, n = 1 + r4Int(4); j < n; j++) {
      for (const t of r4Pick(R4_TOKENS)().split(' ').filter(Boolean)) entries.push([t, li, r4Pick([95, 95, 92, 70, 40])]);
    }
  }
  edge('round4_edges', place(entries));
}

// Round-3 edges: decimal and comma tails on grouped runs, bracket variants and spaced hyphens on landlines, bracketed
// country codes, two-group numbers next to amounts, dates of every plausibility, comma groups, GSTIN skeleton misreads,
// IFSC bank-code look-alikes and low-confidence amounts next to digit groups. Its own seed.
const r3 = mulberry32(20261129);
const r3Int = (n: number) => Math.floor(r3() * n);
const r3Pick = <T>(a: readonly T[]): T => a[r3Int(a.length)];
const r3Digits = (n: number) => Array.from({ length: n }, () => DIG[r3Int(10)]).join('');
const r3Grouped = (n: number, sep: string) => { const d = r3Digits(n); let o = ''; for (let i = 0; i < d.length; i += 4) o += (i ? sep : '') + d.slice(i, i + 4); return o; };
const R3_TOKENS: Array<() => string> = [
  () => r3Grouped(r3Pick([8, 12, 14, 16, 18]), r3Pick([' ', ' ', '-'])) + r3Pick(['.00', ',00', '.5', '']),
  () => r3Digits(4 + r3Int(8)) + ' ' + r3Digits(1 + r3Int(6)) + r3Pick(['.00', '.50', ',75']),
  () => r3Pick(['(', '[', '{', '|', '', 'C']) + r3Pick(['0', 'O', '']) + r3Digits(2 + r3Int(3)) + r3Pick([')', ']', '}', '|', '']) + r3Pick([' ', '', '-']) + r3Digits(3 + r3Int(2)) + r3Pick([' ', '', '-', '.']) + r3Digits(3 + r3Int(2)),
  () => '0' + r3Digits(2 + r3Int(3)) + r3Pick([' - ', '-', ' -', '- ', ' ']) + r3Digits(5 + r3Int(5)),
  () => r3Pick(['(+91)', '(91)', '(+91', '+91)', '(+9l)']) + r3Pick([' ', '']) + r3Pick(['6', '7', '8', '9']) + r3Digits(9),
  () => '(' + r3Pick(['6', '7', '8', '9']) + r3Digits(4) + ')' + r3Pick([' ', '']) + r3Digits(5),
  () => [r3Digits(1 + r3Int(4)), r3Digits(1 + r3Int(2)), r3Digits(1 + r3Int(4))].join(r3Pick(['-', '/', '.'])) + r3Pick(['', ' ' + r3Digits(4), ' 10:30']),
  () => Array.from({ length: 2 + r3Int(6) }, (_, i) => (i === 0 ? r3Digits(1 + r3Int(3)) : r3Digits(r3Pick([2, 3, 3])))).join(',') + r3Pick(['', '.00']),
  () => r3Digits(2) + r3Pick(['ABCPE', 'KBSFK', 'IJRFE', 'STWPD', 'B0SPS']) + r3Pick(['1234', 'I234', 'O9O9', '12S4']) + r3Pick(['F', '8', 'E']) + r3Pick(['1', 'I', 'A']) + r3Pick(['Z', '2', '7', 'X']) + r3Pick(['5', 'V', 'E']) + r3Pick(['', '', 'Z']),
  () => r3Pick(['SB1N', 'I0BA', 'HDFC', 'INV2', 'CARD', 'ICIC', '5BIN']) + r3Pick(['0', 'O', 'Q', 'D', '6']) + r3Pick([r3Digits(6), 'A' + r3Digits(5), 'ABC' + r3Digits(3)]),
  () => r3Pick(['|', '[', '']) + r3Pick([r3Digits(1 + r3Int(3)) + ',' + r3Digits(3) + '.00', r3Digits(4 + r3Int(5)) + '.00']),
  () => r3Pick(['Pay to', 'Office', 'Call', 'Ph:', 'Tel', 'GSTIN', 'A/C No', 'Remit to', 'Total', 'HSN', 'Ref']),
];
for (let k = 0; k < 300; k++) {
  const entries: Array<[string, number, number]> = [];
  for (let li = 0, nl = 1 + r3Int(2); li < nl; li++) {
    for (let j = 0, n = 1 + r3Int(4); j < n; j++) {
      for (const t of r3Pick(R3_TOKENS)().split(' ').filter(Boolean)) entries.push([t, li, r3Pick([95, 95, 92, 70, 40, 36])]);
    }
  }
  edge('round3_edges', place(entries));
}

const shieldCases = [...edgeShield, ...randomShieldCases];

// ---------------------------------------------------------------- parseExtraction

const NUMERIC_STRINGS = ['\u20B91,770.00', '1770/-', '\u20B91,770/-', 'Rs. 12', 'rs.12', 'RS 5', '0x1f', '0X1F', '-0x1f', '0o17', '0b101', ' 12 ', '', '  ',
  '1e3', '1E-3', '.5', '5.', '+5', '-5', '- 5', 'Infinity', '-Infinity', '+Infinity', 'NaN', '-', '1_000', '\u0661\u0662', '12\u00A034', '1,2,3',
  '12/-/-', '12/- ', ' 12/-', '1e400', '00012', '0.1e1', '1.2.3', 'abc', '12abc', '\uFEFF7\u3000', '7\u001C', '1\u20082', 'R s 5', 'Rs.Rs.9',
  '\u20B9\u20B9', '/-', '9/-x', '0', '-0', '29', '14', 'many', '1e21', '123456789012345678901234567890'];
const TEXT_STRINGS = ['Ravi Traders', ' 29aagcb7383j1z4 ', '29AAG CB7383J1Z4', '29AAG\u00A0CB7383\u2009J1Z4\uFEFF', '4521', '2026-11-02', '29-Karnataka',
  '', '\u001CRavi\u001F', '\uFEFF Ravi\u3000', 'stra\u00DFe', 'a,}', 'x\ny', '\u00E9', 'Rice', '1006',
  'Ravi ' + EMOJI_GRINNING, FLAG_INDIA + ' Traders', '29' + MATH_BOLD_ONE + '-Karnataka'];
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
    case 0: return s.replace(/([}\]])/g, (m) => (chance(0.5) ? ',' + pick(['', ' ', '\n', '\u00A0', '\u3000']) + m : m));
    case 1: return 'Here you go:\n```json\n' + s + '\n```';
    case 2: return s.slice(0, int(s.length + 1));
    case 3: { const i = int(s.length); return s.slice(0, i) + pick(['"', ',', '{', '}', '[', ']', ':', '0', '\t', '\u00A0', '01', '+', '.', '\\x']) + s.slice(i + 1); }
    case 4: return s.replace(/:/g, () => pick([':', ': ', ' :\t', ':\r\n']));
    case 5: return s.replace(/(\d)(?=[,}\]])/g, (m) => m + pick(['', '', '.', 'e', '.0', 'e5']));
    case 6: return s + ' {"total": 1}';
    case 7: return s.replace(/"(\w+)":/, (m, k) => (chance(0.5) ? k + ':' : "'" + k + "':"));
    case 8: return s.replace(/"total":[^,}]*/, '"total":1,"total":2');
    default: return s;
  }
}

function randomObject(): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const f of FIELDS) if (chance(0.75)) o[f] = randomValue();
  if (chance(0.6)) o.items = chance(0.8) ? Array.from({ length: int(4) }, () => (chance(0.8) ? randomItem(1) : randomValue(2))) : randomValue();
  return o;
}

const randomParseCases = Array.from({ length: 1200 }, () => parseCase(mutate(JSON.stringify(randomObject()))));

// ---- parser edge section

/** A JSON value whose objects may repeat keys: { entries } keeps every [key, value] pair in order. */
type J = null | boolean | number | string | J[] | { entries: Array<[string, J]> };
const hex4 = (code: number) => {
  const h = code.toString(16).padStart(4, '0');
  return chance(0.5) ? h : h.toUpperCase(); // JSON allows either case
};
/** JSON text for a string; each code unit is written as a backslash-u escape with probability `p` (raw otherwise, lone surrogates included). */
const encStr = (s: string, p: number) => {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]; const code = c.charCodeAt(0);
    if (chance(p)) out += '\\u' + hex4(code);
    else if (c === '"') out += '\\"';
    else if (c === '\\') out += '\\\\';
    else if (code < 0x20) out += pick(['\\u' + hex4(code), JSON.stringify(c).slice(1, -1)]);
    else if (c === '/' && chance(0.5)) out += '\\/';
    else out += c;
  }
  return out + '"';
};
function enc(v: J, p: number): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'number') return JSON.stringify(v);
  if (typeof v === 'string') return encStr(v, p);
  if (Array.isArray(v)) return '[' + v.map((x) => enc(x, p)).join(',') + ']';
  return '{' + v.entries.map(([k, x]) => encStr(k, p) + ':' + enc(x, p)).join(',') + '}';
}
/** Plain JS value to J (keys in order, no duplicates). */
const toJ = (v: unknown): J => {
  if (Array.isArray(v)) return v.map(toJ);
  if (v !== null && typeof v === 'object') return { entries: Object.entries(v).map(([k, x]) => [k, toJ(x)]) };
  return v as J;
};
const FOREIGN_NUMERIC = ['\uFF11\uFF17\uFF17\uFF10', '\u0967\u096D\u096D\u0966', '\u0661\u0667', MATH_BOLD_ONE + '\u{1D7D0}', '17' + EMOJI_GRINNING + '70',
  '\u20B9\uFF11,770', '1770\u200D', '\uFF10x10'];

const edgeParse: Array<ReturnType<typeof parseCase>> = [];
const pEdge = (cat: string, raw: string) => edgeParse.push({ cat, ...parseCase(raw) });
// Backslash-u escapes everywhere, keys included (the escape of "t" followed by "otal" is the key total).
for (let k = 0; k < 120; k++) pEdge('unicode_escapes', enc(toJ(randomObject()), pick([0.05, 0.3, 1])));
// Lone and reversed surrogates, raw and escaped, in text, GSTIN, numeric strings and keys.
for (let k = 0; k < 50; k++) {
  const o = toJ(randomObject()) as { entries: Array<[string, J]> };
  o.entries.push([pick(['supplierName', 'supplierGstin', 'total']), insertAt('29aagcb7383j1z4', LONE_SURROGATES[k % LONE_SURROGATES.length])]);
  for (const f of ['supplierName', 'supplierGstin', 'invoiceNo', 'total', 'cgst']) if (chance(0.5)) o.entries.push([f, insertAt(pick(['29aagcb7383j1z4', '1770', 'Ravi', '']), pick(LONE_SURROGATES))]);
  if (chance(0.3)) o.entries.push([pick(LONE_SURROGATES) + 'total', 5]);
  pEdge('lone_surrogates', enc(o, pick([0, 0, 0.3])));
}
// Astral characters (valid surrogate pairs): each object is written twice, once with the character raw inside the JSON
// strings and once with every code unit escaped (the pair becomes two six-character escapes).
for (let k = 0; k < 30; k++) {
  const ch = ASTRAL[k % ASTRAL.length];
  const o = toJ(randomObject()) as { entries: Array<[string, J]> };
  for (const f of ['supplierName', 'supplierGstin', 'invoiceNo', 'total', 'itemCount', 'placeOfSupply']) if (chance(0.5) || f === 'supplierName') o.entries.push([f, insertAt(pick(['29aagcb7383j1z4', '1770', 'Ravi', '29-Karnataka']), ch)]);
  o.entries.push(['items', [{ entries: [['description', 'Rice' + ch], ['amount', '1' + ch + '0']] }]]);
  pEdge('astral_raw', enc(o, 0));
  pEdge('astral_escaped', enc(o, 1));
}
// Duplicate keys with different types; JSON.parse keeps the last.
for (let k = 0; k < 60; k++) {
  const o = toJ(randomObject()) as { entries: Array<[string, J]> };
  for (let j = 0, n = 1 + int(4); j < n; j++) o.entries.splice(int(o.entries.length + 1), 0, [pick([...FIELDS, 'items']), toJ(chance(0.3) ? randomItem(1) : randomValue(1))]);
  pEdge('duplicate_keys', enc(o, 0));
}
// Deep nesting: valid at many depths, and broken by one bracket.
for (const depth of [100, 199, 200, 201, 1000, 5000, 10000]) {
  const arr = '['.repeat(depth) + ']'.repeat(depth);
  const obj = '{"a":'.repeat(depth) + '1' + '}'.repeat(depth);
  pEdge('deep_nesting', '{"total":5,"x":' + arr + '}');
  pEdge('deep_nesting', '{"total":5,"items":[' + arr + ',{"amount":3}],"y":' + obj + '}');
  pEdge('deep_nesting', '{"total":5,"x":' + arr.slice(1) + '}');
  pEdge('deep_nesting', '{"total":5,"x":' + '['.repeat(depth) + '{"amount":"1"}' + ']'.repeat(depth) + ']' + '}');
}
// Foreign digits, mathematical digits and emoji in numeric strings and counts.
for (let k = 0; k < 40; k++) {
  const o = toJ(randomObject()) as { entries: Array<[string, J]> };
  for (const f of ['total', 'cgst', 'itemCount', 'confidence', 'invoiceNo', 'placeOfSupply']) if (chance(0.5)) o.entries.push([f, pick(FOREIGN_NUMERIC)]);
  if (chance(0.5)) o.entries.push(['items', [{ entries: [['amount', pick(FOREIGN_NUMERIC)], ['hsn', pick(FOREIGN_NUMERIC)]] }]]);
  pEdge('foreign_digits', enc(o, pick([0, 0.2])));
}

const parseCases = [...edgeParse, ...randomParseCases];

function parseCase(raw: string) {
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
}

// ---------------------------------------------------------------- parseConfig

const CONFIG_VALUES = ['smart', 'device_only', 'cloud_only', ' smart', 'SMART', 'yolo', '', ' ', '\u00A0', '0', '0.5', '0.7', '1', '1.5', '-0', '-0.1', '7', '100', '100.5', '99.5',
  '2.5', '3.5', '0.49999999999999994', '2.4999999999999996', '0x1', '0x10', '0b1', '0o7', '1e-1', '1e2', '.5', '5.', ' 0.7 ', '\uFEFF0.6\u3000', '0.6\u001C', 'NaN',
  'Infinity', 'abc', '1_0', 'true', 'false', 'FALSE', ' false', 'v1', 'v2', ' v2 ', 'gemini-x', '\u2028m\u2029', 'toString', '__proto__',
  '\uff10.5', '\u0966', '\ud835\udfcf', '1\ud83d\ude00', '\uD800', 'f\u0131le', 'cloud_\u017fmart'];
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
  '2026-00-10', '2026-11-00', '2026-11-2', '02-11-2026', '', '2026-11-02\n', '0000-01-01', '9999-12-31', '2026-04-31', '2026-12-31', '2027-01-01',
  '\uFF12\uFF10\uFF12\uFF16-11-02', '2026-11-\u0966\u0968', '2026-11-02\uD83D\uDE00'];
const POS = ['29-Karnataka', '29', ' 29 Karnataka', '27-Maharashtra', 'Karnataka', '', '\u00A029', '07 Delhi', '2', '\u0662\u0669', '97',
  '\uFF12\uFF19', '\u0968\u096F', '\uD835\uDFD0\uD835\uDFD7', '\uFEFF\u300029'];
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

// ---- presence checks: each named code point must really occur in its category (a mis-escaped constant fails here)

const cp = (c: number) => String.fromCodePoint(c);
const caseTexts = (cases: Array<{ cat?: string; words?: unknown[][]; raw?: string }>, cat: string) =>
  cases.filter((c) => c.cat === cat).map((c) => (c.raw !== undefined ? c.raw : (c.words ?? []).map((w) => w[0]).join(' ')));
/** The JSON-escaped form of `s`: every code unit as backslash, u, four hex digits (either case). */
const escapedForm = (s: string) => new RegExp([...s].flatMap((ch) => Array.from({ length: ch.length }, (_, i) => ch.charCodeAt(i)))
  .map((u) => '\\\\u' + u.toString(16).padStart(4, '0')).join(''), 'i');
const presence: string[] = [];
const requirePresence = (cases: unknown[], cat: string, label: string, test: (t: string) => boolean, min: number) => {
  const n = caseTexts(cases as never, cat).filter(test).length;
  if (n < min) throw new Error(`presence check: ${label} occurs in ${n} ${cat} cases, need at least ${min}`);
  presence.push(`${cat} ${label}: ${n}`);
};
const NAMED_ASTRAL: Array<[string, string]> = [['U+1F600', cp(0x1f600)], ['U+1F1EE U+1F1F3', cp(0x1f1ee) + cp(0x1f1f3)], ['U+1D7CF', cp(0x1d7cf)]];
for (const [label, s] of NAMED_ASTRAL) {
  requirePresence(edgeShield, 'surrogates_emoji', label, (t) => t.includes(s), 10);
  requirePresence(edgeParse, 'astral_raw', label + ' raw', (t) => t.includes(s), 8);
  requirePresence(edgeParse, 'astral_escaped', label + ' escaped pair', (t) => escapedForm(s).test(t), 8);
}
for (const [label, c] of [['U+FB01', 0xfb01], ['U+0131', 0x131], ['U+017F', 0x17f], ['U+00DF', 0xdf]] as Array<[string, number]>) {
  requirePresence(edgeShield, 'case_mapping', label, (t) => t.includes(cp(c)), 10);
}
const hasLoneUnit = (t: string) => [...t].some((ch) => ch.length === 1 && ch.charCodeAt(0) >= 0xd800 && ch.charCodeAt(0) <= 0xdfff);
// Astral pairs also reach the escape and foreign-digit categories (escaped in the first, raw or escaped in the second).
const anyAstralEscaped = (t: string) => NAMED_ASTRAL.some(([, a]) => escapedForm(a).test(t));
const anyAstralRaw = (t: string) => NAMED_ASTRAL.some(([, a]) => t.includes(a));
requirePresence(edgeParse, 'unicode_escapes', 'an escaped astral pair', anyAstralEscaped, 10);
requirePresence(edgeParse, 'foreign_digits', 'an astral pair', (t) => anyAstralRaw(t) || anyAstralEscaped(t), 10);
requirePresence(edgeShield, 'lone_surrogates', 'lone surrogate', hasLoneUnit, 15);
requirePresence(edgeParse, 'lone_surrogates', 'lone surrogate (raw or escaped)', (t) => hasLoneUnit(t) || /\\u[dD][89a-fA-F][0-9a-fA-F]{2}/.test(t), 40);

// Long digit runs: every family is really present, and the cases exercise both outcomes of the new rule.
const LR_TEXT: Array<[string, (t: string) => boolean]> = [
  ['an OCR look-alike of A/C', (t) => /(?:^| )A[|\\1IJl!7]C(?: |$)/.test(t)],
  ['the exact AJC reading', (t) => /(?:^| )AJC /.test(t)],
  ['an unlabelled contiguous run of 9 to 18 digits', (t) => /(?<![\d.,:A-Za-z/|\\!#])\d{9,18}(?!\d)/.test(t) && !/A.C|AC|ACC|ACCOUNT/i.test(t)],
  ['a grouped run of 9 or more digits', (t) => /\d{3,}[ \u00A0\u2007-]\d{3,}[ \u00A0\u2007-]\d{2,}/.test(t)],
  ['a long run with a decimal part', (t) => /\d{9,}[.,]\d/.test(t)],
  ['a GSTIN next to a long run', (t) => /\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z] \d{9,}/.test(t)],
];
for (const [label, test] of LR_TEXT) requirePresence(edgeShield, 'long_digit_runs', label, test, 5);
const lrCases = edgeShield.filter((c) => c.cat === 'long_digit_runs');
const lrOutcomes: Array<[string, number]> = [
  ['a bank account found after a look-alike label', lrCases.filter((c) => c.matches.some((m) => m.type === 'BANK_ACCOUNT')).length],
  ['a long run hidden as a possible id', lrCases.filter((c) => c.matches.some((m) => m.type === 'POSSIBLE_ID')).length],
  ['a long_digit_run reason', lrCases.filter((c) => c.uncertainReasons.some((r) => r.startsWith('long_digit_run:'))).length],
  ['nothing hidden and certain', lrCases.filter((c) => c.matches.length === 0 && !c.uncertain).length],
];
for (const [label, n] of lrOutcomes) {
  // At least 5 (round 2 hides more of this section: decimal tails and runs of 19 or more digits no longer stay visible).
  if (n < 5) throw new Error(`presence check: ${label} occurs in ${n} long_digit_runs cases, need at least 5`);
  presence.push(`long_digit_runs ${label}: ${n}`);
}

// Digit-run edges: every family is present and both outcomes of each round-2 rule occur.
const DR_TEXT: Array<[string, (t: string) => boolean]> = [
  ['a parenthesised STD code', (t) => /\(0\d{2,4}\)/.test(t)],
  ['a run of 19 or more digits', (t) => /\d{19,}/.test(t)],
  ['dotted groups', (t) => /\d{3,}\.\d{3,}\.\d/.test(t)],
  ['digits after a digit and colon', (t) => /\d:\d{9,}/.test(t)],
  ['an IFSC look-alike', (t) => /[A-Z]{4}[OoQD]\d{6}/.test(t)],
  ['a bordered amount', (t) => /[|[\]!]\d{1,3},\d{3}\.00/.test(t)],
];
for (const [label, test] of DR_TEXT) requirePresence(edgeShield, 'digit_run_edges', label, test, 10);
const drCases = edgeShield.filter((c) => c.cat === 'digit_run_edges');
const drOutcomes: Array<[string, number]> = [
  ['a phone match', drCases.filter((c) => c.matches.some((m) => m.type === 'PHONE')).length],
  ['an IFSC match', drCases.filter((c) => c.matches.some((m) => m.type === 'IFSC')).length],
  ['an AADHAAR match', drCases.filter((c) => c.matches.some((m) => m.type === 'AADHAAR')).length],
  ['two or more possible ids', drCases.filter((c) => c.matches.filter((m) => m.type === 'POSSIBLE_ID').length >= 2).length],
  ['a long_digit_run reason', drCases.filter((c) => c.uncertainReasons.some((r) => r.startsWith('long_digit_run:'))).length],
  ['a low_ocr_confidence reason', drCases.filter((c) => c.uncertainReasons.some((r) => r.startsWith('low_ocr_confidence:'))).length],
  ['nothing hidden and certain', drCases.filter((c) => c.matches.length === 0 && !c.uncertain).length],
];
for (const [label, n] of drOutcomes) {
  if (n < 10) throw new Error(`presence check: ${label} occurs in ${n} digit_run_edges cases, need at least 10`);
  presence.push(`digit_run_edges ${label}: ${n}`);
}
if (edgeShield.filter((c) => c.cat === 'real_ocr').length !== 64) throw new Error('presence check: real_ocr must hold the 64 bills');
if (edgeShield.filter((c) => c.cat === 'real_ocr_fresh').length !== 36) throw new Error('presence check: real_ocr_fresh must hold the 36 bills');
if (edgeShield.filter((c) => c.cat === 'real_ocr_review3').length !== 30) throw new Error('presence check: real_ocr_review3 must hold the 30 bills');
// Round-4 edges: both outcomes of each round-4 rule occur.
const r4Cases = edgeShield.filter((c) => c.cat === 'round4_edges');
const r4Outcomes: Array<[string, number]> = [
  ['two phones in one line', r4Cases.filter((c) => c.matches.filter((m) => m.type === 'PHONE').length >= 2).length],
  ['a bank_details_without_account reason', r4Cases.filter((c) => c.uncertainReasons.some((r) => r.startsWith('bank_details_without_account:'))).length],
  ['a long_digit_run reason', r4Cases.filter((c) => c.uncertainReasons.some((r) => r.startsWith('long_digit_run:'))).length],
  ['a possible id', r4Cases.filter((c) => c.matches.some((m) => m.type === 'POSSIBLE_ID')).length],
  ['nothing hidden and certain', r4Cases.filter((c) => c.matches.length === 0 && !c.uncertain).length],
];
for (const [label, n] of r4Outcomes) {
  // Most round-4 tokens are private, so "nothing hidden and certain" is rarer there: at least 5.
  const min = label === 'nothing hidden and certain' ? 5 : 10;
  if (n < min) throw new Error(`presence check: ${label} occurs in ${n} round4_edges cases, need at least ${min}`);
  presence.push(`round4_edges ${label}: ${n}`);
}
// The two-group rule (a digit group joined to a decimal amount) both asks and stays quiet somewhere in the corpus.
const twoGroup = /(?<![\d.,])\d{3,}(?: - | -|- |[ \-,]|, )\d{2,5}[.,]\d{2}(?![\d])/;
const twoGroupCases = [...edgeShield, ...randomShieldCases].filter((c) => twoGroup.test(c.words.map((w) => w[0]).join(' ')));
const twoGroupAsks = twoGroupCases.filter((c) => c.uncertainReasons.some((r) => r.startsWith('long_digit_run:'))).length;
if (twoGroupAsks < 10 || twoGroupCases.length - twoGroupAsks < 10) {
  throw new Error(`presence check: the two-group outcome needs 10 asking and 10 quiet cases, has ${twoGroupAsks} and ${twoGroupCases.length - twoGroupAsks}`);
}
presence.push(`two-group number and amount: ${twoGroupCases.length} cases, ${twoGroupAsks} ask`);
// Round-3 edges: every family is present and both outcomes of the round-3 rules occur.
const R3_TEXT: Array<[string, (t: string) => boolean]> = [
  ['a grouped run with a decimal tail', (t) => /\d{4}[ -]\d{4}[ -]\d{4}[.,]\d/.test(t)],
  ['a square, curly or bar bracket before a code', (t) => /[[{|][0O]?\d{2,4}/.test(t)],
  ['a spaced hyphen', (t) => /\d \- \d/.test(t)],
  ['a bracketed country code', (t) => /\(\+?9[1l]\)/.test(t)],
  ['comma groups', (t) => /\d,\d\d\d?,\d/.test(t)],
  ['a GSTIN-like word', (t) => /\d\d[A-Z0-9]{5}[0-9OIS]{4}/.test(t)],
];
for (const [label, test] of R3_TEXT) requirePresence(edgeShield, 'round3_edges', label, test, 10);
const r3Cases = edgeShield.filter((c) => c.cat === 'round3_edges');
const r3Outcomes: Array<[string, number]> = [
  ['a phone match', r3Cases.filter((c) => c.matches.some((m) => m.type === 'PHONE')).length],
  ['an IFSC match', r3Cases.filter((c) => c.matches.some((m) => m.type === 'IFSC')).length],
  ['a possible id', r3Cases.filter((c) => c.matches.some((m) => m.type === 'POSSIBLE_ID')).length],
  ['a long_digit_run reason', r3Cases.filter((c) => c.uncertainReasons.some((r) => r.startsWith('long_digit_run:'))).length],
  ['a low_ocr_confidence reason', r3Cases.filter((c) => c.uncertainReasons.some((r) => r.startsWith('low_ocr_confidence:'))).length],
  ['nothing hidden and certain', r3Cases.filter((c) => c.matches.length === 0 && !c.uncertain).length],
];
for (const [label, n] of r3Outcomes) {
  if (n < 10) throw new Error(`presence check: ${label} occurs in ${n} round3_edges cases, need at least 10`);
  presence.push(`round3_edges ${label}: ${n}`);
}

mkdirSync(OUT, { recursive: true });
// Every non-ASCII character is written as a \u escape so the files stay plain ASCII.
const ascii = (s: string) => s.replace(/[\u007f-\uFFFF]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const write = (name: string, data: unknown) => writeFileSync(resolve(OUT, name), ascii(JSON.stringify(data)) + '\n');
write('shield.json', shieldCases);
write('parse.json', parseCases);
write('config.json', configCases);
write('checks.json', checksCases);
// ---- manifest: what the corpora were generated from

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
/** Every TypeScript source the corpora exercise (the imports above and their imports), and this generator. */
const SOURCES = [
  'android/core/src/test/differential/generate.ts',
  'web/src/core/checks/checks.ts',
  'web/src/core/config/defaults.ts',
  'web/src/core/config/parseConfig.ts',
  'web/src/core/extract/parse.ts',
  'web/src/core/redact/planRedaction.ts',
  'web/src/core/shield/adequacy.ts',
  'web/src/core/shield/gstin.ts',
  'web/src/core/shield/shield.ts',
  'web/src/core/shield/verhoeff.ts',
  'web/src/core/types.ts',
  'shared/test-vectors/ocr-real.json',
  'shared/test-vectors/ocr-real-fresh.json',
  'shared/test-vectors/ocr-real-review3.json',
].sort();
const REGENERATE = 'cd web && npx vite-node ../android/core/src/test/differential/generate.ts';
writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify({
  regenerate: REGENERATE,
  files: SOURCES.map((path) => ({ path, sha256: createHash('sha256').update(readFileSync(resolve(REPO, path))).digest('hex') })),
}, null, 2) + '\n');

const counts = (cases: Array<{ cat?: string }>) => {
  const m: Record<string, number> = {};
  for (const c of cases) if (c.cat) m[c.cat] = (m[c.cat] ?? 0) + 1;
  return JSON.stringify(m);
};
console.log(`shield ${shieldCases.length} (edge ${edgeShield.length}), parse ${parseCases.length} (edge ${edgeParse.length}, null ${parseCases.filter((c) => c.expected === null).length}), config ${configCases.length}, checks ${checksCases.length}`);
console.log(`shield: with matches ${shieldCases.filter((c) => c.matches.length).length}, uncertain ${shieldCases.filter((c) => c.uncertain).length}`);
console.log(`shield edges ${counts(edgeShield)}`);
console.log(`parse edges ${counts(edgeParse)}`);
console.log(`presence ${presence.join('; ')}`);
