import type { OcrWord, PiiMatch, PiiType, ShieldResult } from '../types';
import { GSTIN_PATTERN, gstinCheckChar } from './gstin';
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
// Aadhaar-shaped (exact and near-miss alike), and not a piece of a longer digit run: that is left whole to the long-run rule.
const AADHAAR = /(?<!\d[\s.,-]?)\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b(?![\s.,-]?\d)/g;
const IFSC = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;
/**
 * An IFSC as OCR may read it: the fifth character (always 0) as O, Q or D, and/or one character of the bank code in
 * its first three places read as a digit look-alike (SB1N, I0BA). The branch code must hold at least 3 digits.
 */
const NEAR_IFSC = /\b[A-Z0-9]{4}[0OQD][A-Z0-9]{6}\b/g;
const MIN_NEAR_IFSC_BRANCH_DIGITS = 3;
function isNearIfsc(t: string): boolean {
  const bank = t.slice(0, 4);
  const odd = [...bank].filter((c) => !/[A-Z]/.test(c));
  return odd.length <= 1 && odd.every((c) => TO_LETTER[c] !== undefined) && /[A-Z]/.test(bank[3])
    && digitCount(t.slice(5)) >= MIN_NEAR_IFSC_BRANCH_DIGITS;
}
/**
 * A mobile, with an optional country code (also in brackets: "(+91)", "(91)") or 0, its first five digits possibly in
 * brackets, and its two halves joined by nothing, a space, a hyphen or a comma.
 */
const MOBILE = /(?<!\d)(?:\(\+?91\)[\s-]?|\+?91[\s-]?|0)?\(?[6-9]\d{4}\)?[\s,-]?\d{5}(?!\d)/g;
const LANDLINE = /\b0\d{2,4}[\s-]?\d{3,4}[\s-]?\d{4}\b/g;
/**
 * A landline with its STD code in brackets, matched with or without a label: ( [ { | open, ) ] } | close (spaces
 * inside allowed, except after a | that opens: "| 0402 | 123456" is a table row), one of the two may be lost by OCR,
 * and the leading 0 may be read as O.
 */
const PAREN_LANDLINE = /(?:[([{]\s?[0O]\d{2,4}\s?[)\]}|]?|\|[0O]\d{2,4}[)\]}|]?|(?<!\d)[0O]\d{2,4}(?:\s?[)\]}]|\|))[\s-]?\d(?:[\s-]?\d){5,7}(?!\d)/g;
/** An STD code without its 0, in both brackets: a phone only on a phone-labelled line or when it makes 10 digits in all. */
const PAREN_NO_ZERO_LANDLINE = /[([{|]\s?[1-9]\d{1,3}\s?[)\]}|][\s-]?\d(?:[\s-]?\d){5,7}(?!\d)/g;
const NATIONAL_NUMBER_DIGITS = 10;
/** A landline without brackets or label: STD code, a hyphen (spaces around it allowed), 6 to 8 digits. */
const HYPHEN_LANDLINE = /(?<![\dA-Z])0\d{2,4}\s?-\s?\d{6,8}(?!\d)/g;
/** An STD code, a hyphen and a short group: a landline whose rest OCR lost (hidden as a possible id). */
const CUT_LANDLINE = /(?<![\dA-Z])0\d{2,4}-\d{3,5}(?!\d)/g;
const BANK = /\b\d(?:[\s-]?\d){8,17}\b/g;
/** An invoice or bill label right before `start` on the line (at most 12 characters and no digit after it). */
function invoiceLabelBefore(text: string, start: number): boolean {
  const before = text.slice(0, start);
  let end = -1;
  for (const m of before.matchAll(/\b(?:INVOICE|INV|BILL)\b/g)) end = m.index! + m[0].length;
  return end >= 0 && before.length - end <= 12 && !/\d/.test(before.slice(end));
}

/*
 * Digit runs. Groups of digits are joined by a separator that is followed by a digit:
 * - a hyphen, with one optional space on each side;
 * - a slash with a space on each side;
 * - one space or one dot;
 * - (ANY and LOOSE) a comma;
 * - (LOOSE) a comma and a space.
 * The run rules are scanned by hand (the same algorithm in Shield.kt), on a copy of the line where dates, times and
 * amounts are blanked out (see maskForRuns), so those never join a run; nothing else excuses a run.
 */
type SepKind = 'long' | 'any' | 'loose';
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isWs = (c: string | undefined) => c !== undefined && /\s/.test(c);
/** Length of a separator of `kind` starting at `j` whose next character satisfies `next`, or 0. */
function sepLen(t: string, j: number, kind: SepKind, next: (c: string | undefined) => boolean = isDigit): number {
  const forms: Array<(k: number) => number> = [
    (k) => (isWs(t[k]) && t[k + 1] === '-' && isWs(t[k + 2]) ? 3 : 0),
    (k) => (isWs(t[k]) && t[k + 1] === '-' ? 2 : 0),
    (k) => (t[k] === '-' && isWs(t[k + 1]) ? 2 : 0),
    (k) => (t[k] === '-' ? 1 : 0),
    (k) => (isWs(t[k]) && t[k + 1] === '/' && isWs(t[k + 2]) ? 3 : 0),
    (k) => (isWs(t[k]) || t[k] === '.' ? 1 : 0),
  ];
  if (kind !== 'long') forms.push((k) => (t[k] === ',' ? 1 : 0));
  if (kind === 'loose') forms.push((k) => (t[k] === ',' && isWs(t[k + 1]) ? 2 : 0));
  for (const f of forms) {
    const n = f(j);
    if (n > 0 && next(t[j + n])) return n;
  }
  return 0;
}
const digitBlockEnd = (t: string, i: number) => { let j = i; while (isDigit(t[j])) j++; return j; };
/** Every maximal run of digits joined by separators of `kind`, as [start, end) ranges. */
function runs(t: string, kind: SepKind): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = 0;
  while (i < t.length) {
    if (!isDigit(t[i])) { i++; continue; }
    let j = i + 1;
    for (;;) {
      if (isDigit(t[j])) { j++; continue; }
      const n = sepLen(t, j, kind);
      if (n === 0) break;
      j += n + 1;
    }
    out.push([i, j]);
    i = j;
  }
  return out;
}
/**
 * A number that may be a bank account even though no label was read (OCR mangles labels: "A/C" came back as "AJC"):
 * contiguous digits, or groups of at least 3 digits (the last may have 2) joined by `long` separators; 9 or more digits
 * in all (checked by the caller). Letters may touch it.
 */
function longRuns(t: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = 0;
  while (i < t.length) {
    if (!isDigit(t[i]) || isDigit(t[i - 1])) { i++; continue; }
    const first = digitBlockEnd(t, i);
    if (first - i < 3) { i = first; continue; }
    let e = first;
    for (;;) {
      const n = sepLen(t, e, 'long');
      if (n === 0) break;
      const m = digitBlockEnd(t, e + n);
      const len = m - (e + n);
      if (len >= 3) { e = m; continue; }
      if (len === 2) e = m;
      break;
    }
    out.push([i, e]);
    i = e;
  }
  return out;
}
const MIN_RUN_DIGITS = 9;
const digitCount = (t: string) => t.replace(/\D/g, '').length;
/**
 * True when the amount starting at `i` is the third or later group of a digit run: right before it, a separator, a
 * group of 3 to 40 digits, a separator and at least 3 digits (any `loose` separators). There it is an account's tail.
 */
function afterTwoGroups(t: string, i: number): boolean {
  for (let l2 = 1; l2 <= 3; l2++) {
    const p = i - l2;
    if (p < 1 || sepLen(t, p, 'loose') !== l2 || !isDigit(t[p - 1])) continue;
    let b = p;
    while (b > 0 && isDigit(t[b - 1])) b--;
    if (p - b < 3 || p - b > 40) continue;
    for (let l1 = 1; l1 <= 3; l1++) {
      const q = b - l1;
      if (q >= 3 && sepLen(t, q, 'loose') === l1 && isDigit(t[q - 1]) && isDigit(t[q - 2]) && isDigit(t[q - 3])) return true;
    }
  }
  return false;
}
/*
 * What maskForRuns blanks out, in this order: dates (day-month-year or year-month-day with plausible day and month),
 * times, and amounts. An amount has grouping commas (at most 9 digits before its decimal part) or a decimal part with
 * at most 8 digits before it. An amount that is the third or later group of a digit run is not blanked.
 */
const DATE_MASK = /(?<!\d|\d[.,/-])(?:(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.](?:\d{4}|\d{2})|\d{4}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01]))(?!\d|[.,/-]\d)/g;
const TIME_MASK = /(?<!\d|\d[.,:])\d{1,2}:\d{2}(?::\d{2})?(?!\d|[.,:]\d)/g;
const COMMA_AMOUNT_MASK = /(?<!\d|\d[.,])\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?(?!\d|[.,]\d)/g;
const DECIMAL_AMOUNT_MASK = /(?<!\d|\d[.,])\d{1,8}[.,]\d{1,2}(?!\d|[.,]\d)/g;
const MAX_COMMA_AMOUNT_DIGITS = 9;
const DATE_TIME_MARK = '~';
const COMMA_AMOUNT_MARK = '=';
const DECIMAL_AMOUNT_MARK = '#';
/** Digits before the decimal part of an amount with grouping commas (its decimal point is a dot). */
const integerDigits = (amount: string) => digitCount(amount.replace(/\.\d{1,2}$/, ''));
/** Digits before the decimal part of an amount without grouping commas (a dot or a comma). */
const decimalIntegerDigits = (amount: string) => digitCount(amount.replace(/[.,]\d{1,2}$/, ''));
/** The line with dates and times replaced by '~', comma amounts by '=' and decimal amounts by '#' (same length, so spans still line up). */
function maskForRuns(text: string, decimalAmounts = true): string {
  const blank = (mark: string) => (m: string) => mark.repeat(m.length);
  const t = text.replace(new RegExp(DATE_MASK.source, 'g'), blank(DATE_TIME_MARK))
    .replace(new RegExp(TIME_MASK.source, 'g'), blank(DATE_TIME_MARK));
  const c = t.replace(new RegExp(COMMA_AMOUNT_MASK.source, 'g'), (m: string, at: number) =>
    (integerDigits(m) <= MAX_COMMA_AMOUNT_DIGITS && !afterTwoGroups(t, at) ? COMMA_AMOUNT_MARK.repeat(m.length) : m));
  return decimalAmounts
    ? c.replace(new RegExp(DECIMAL_AMOUNT_MASK.source, 'g'), (m: string, at: number) => (afterTwoGroups(c, at) ? m : DECIMAL_AMOUNT_MARK.repeat(m.length)))
    : c;
}
/** A digit group joined to a decimal amount asks when the amount has this many integer digits or more (and 9+ in all). */
const MIN_JOINED_TAIL_DIGITS = 3;
/**
 * In masked text: each blanked decimal amount (without grouping commas, which is never an account's tail) with a group
 * of 3 or more digits joined to it by a `loose` separator right before it, as [group start, amount end).
 */
function groupThenAmount(t: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let a = 0; a < t.length; a++) {
    if (t[a] !== DECIMAL_AMOUNT_MARK || t[a - 1] === DECIMAL_AMOUNT_MARK) continue;
    let end = a;
    while (t[end] === DECIMAL_AMOUNT_MARK) end++;
    for (let l = 1; l <= 3; l++) {
      const p = a - l;
      if (p < 1 || sepLen(t, p, 'loose', (c) => c === DECIMAL_AMOUNT_MARK) !== l || !isDigit(t[p - 1])) continue;
      let b = p;
      while (b > 0 && isDigit(t[b - 1])) b--;
      if (p - b >= 3) { out.push([b, end]); break; }
    }
  }
  return out;
}
const NEAR_PAN = /\b[A-Z0-9]{10}\b/g;
// Digit look-alikes, used to un-confuse OCR misreads.
const TO_DIGIT: Record<string, string> = { O: '0', I: '1', L: '1', S: '5', B: '8', Z: '2' };
const TO_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z' };
const PAN_SHAPE = /^[A-Z]{5}\d{4}[A-Z]$/;
/** At most this many look-alike swaps for a near-PAN; real misreads are 1 to 2 characters, invoice numbers need more. */
const MAX_NEAR_PAN_SWAPS = 2;
const MIN_NEAR_MOBILE_DIGIT_SHARE = 0.7;
type LabelledType = Exclude<PiiType, 'POSSIBLE_ID'>;
const LABELS: Record<LabelledType, RegExp> = {
  PAN: /\bPAN\b/g,
  AADHAAR: /\bAADHAA?R\b/g,
  IFSC: /\bIFSC\b/g,
  PHONE: /\b(?:MOB(?:ILE)?|PH(?:ONE)?|TEL|CELL|CONTACT)\b/g,
  // A/C also as OCR reads it: the slash as | \ 1 I J L ! 7 (lower-case l is upper-cased to L before matching).
  BANK_ACCOUNT: /\bACC(?:OUNT|T)?\.?\s*(?:NO|NUMBER)\b|\bACC\s*#|\bACCOUNT\b|\bACCT\b|\bA\/C(?:\s*(?:NO|NUMBER)\b)?|\bA[|\\1IJL!7]C\b(?:\s*(?:NO|NUMBER)\b)?|\b(?:AC|CA)\s*NO\b/g,
};
/** Words that mean the bill carries bank details (besides an account label or an IFSC). */
const BANK_CUE = /\b(?:BANK|BRANCH|NEFT|RTGS|IMPS|BENEFICIARY|REMIT(?:TANCE)?)\b/;
const PARTIAL = /\b[A-Z]{5}\d{1,3}\b/;
const PII_LIKE = /\d{3,}|[A-Z]{3,}\d/;
/** Table-border characters OCR glues to the start or end of a cell's word. */
const BORDER_EDGES = /^[|[\]!]+|[|[\]!]+$/g;
/** A money value: grouping commas (at most 9 integer digits) and/or a 2-digit decimal part, under 9 integer digits without commas. */
const AMOUNT_SHAPE = /^\d{1,3}(?:,\d{2,3})+(?:\.\d{2})?$|^\d{1,8}\.\d{2}$/;
/** The GSTIN skeleton: state code, PAN (5 letters, 4 digits, letter), entity code, Z, check character. */
const GSTIN_SKELETON = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;
/** Per position of a GSTIN: D wants a digit, L a letter, Z the letter Z, A either. */
const GSTIN_CLASSES = 'DDLLLLLDDDDLAZA';
/**
 * True when the word has the GSTIN skeleton once digit/letter look-alikes are swapped for what each position wants
 * (Z also read as 2 or 7). A 16-character word qualifies only when dropping one character (an OCR insertion) leaves a
 * skeleton whose check character is right: without that, about 1 in 100 look-alike-heavy account numbers fit.
 */
function hasGstinSkeleton(s: string): boolean {
  const fixed = (w: string) => [...w].map((c, i) => {
    const want = GSTIN_CLASSES[i];
    if (want === 'D') return TO_DIGIT[c] ?? c;
    if (want === 'L') return TO_LETTER[c] ?? c;
    if (want === 'Z') return c === '2' || c === '7' ? 'Z' : c;
    return c;
  }).join('');
  const fits = (w: string) => w.length === GSTIN_CLASSES.length && GSTIN_SKELETON.test(fixed(w));
  if (s.length === GSTIN_CLASSES.length + 1) {
    return [...s].some((_, i) => {
      const w = s.slice(0, i) + s.slice(i + 1);
      return fits(w) && gstinCheckChar(fixed(w).slice(0, 14)) === fixed(w)[14];
    });
  }
  return fits(s);
}
/**
 * A low-confidence word that is only an amount (not next to a word that is a bare digit group) or only a GSTIN, once
 * border characters are dropped, does not ask on its own.
 */
function harmlessShape(t: string, joinedToDigits: boolean): boolean {
  const s = t.replace(BORDER_EDGES, '');
  return (AMOUNT_SHAPE.test(s) && integerDigits(s) <= MAX_COMMA_AMOUNT_DIGITS && !joinedToDigits) || hasGstinSkeleton(s);
}

function hasLabel(text: string, type: LabelledType): boolean {
  return new RegExp(LABELS[type].source).test(text);
}

/** A 10-character token that is PAN-shaped after at most MAX_NEAR_PAN_SWAPS look-alike swaps (0 swaps = PAN shape with an unusual 4th letter). */
function isNearPan(t: string): boolean {
  let swaps = 0;
  const fixed = t.split('').map((ch, i) => {
    const wantDigit = i >= 5 && i <= 8;
    const sub = wantDigit ? TO_DIGIT[ch] : TO_LETTER[ch];
    if (sub) { swaps++; return sub; }
    return ch;
  }).join('');
  return swaps <= MAX_NEAR_PAN_SWAPS && PAN_SHAPE.test(fixed);
}

const toDigits = (text: string) => text.replace(/[OILSBZ]/g, (c) => TO_DIGIT[c]);

/** The original run had at least one look-alike letter and is mostly digits. */
function isNearMobile(original: string): boolean {
  const alnum = original.replace(/[^A-Z0-9]/g, '');
  const digits = original.replace(/\D/g, '').length;
  return /[OILSBZ]/.test(original) && alnum.length > 0 && digits / alnum.length >= MIN_NEAR_MOBILE_DIGIT_SHARE;
}

/**
 * The next number of a phone list ending at `e`: an optional space, a comma or slash, an optional space, then 6 to 8
 * digits (another local number) or 2 to 4 digits (an alternative ending), not followed by a decimal part. Its digits
 * as [start, end), or null.
 */
function phoneListNext(t: string, e: number): [number, number] | null {
  let k = e;
  if (isWs(t[k])) k++;
  if (t[k] !== ',' && t[k] !== '/') return null;
  k++;
  if (isWs(t[k])) k++;
  const m = digitBlockEnd(t, k);
  const len = m - k;
  if (!((len >= 6 && len <= 8) || (len >= 2 && len <= 4))) return null;
  if ((t[m] === '.' || t[m] === ',') && isDigit(t[m + 1])) return null;
  return [k, m];
}

/** Types whose digits sit inside a letter code: their words never pull a neighbouring number into a run. */
const CODE_TYPES = new Set<PiiType>(['IFSC', 'PAN']);

/** A word that could be (part of) a private number: any digit at all (OCR may split a number into short pieces). */
const SUSPICIOUS = (t: string) => /\d/.test(t);

export function runShield(words: OcrWord[], consentOcrThreshold: number): ShieldResult {
  const lines = buildLines(words);
  const gstinWords = new Set<number>();
  const claimed = new Map<number, PiiType>();
  const matches: PiiMatch[] = [];
  // kind: which label a match can satisfy. Exact matches use their own type; a POSSIBLE_ID uses the type it nearly is.
  const meta: Array<{ kind: LabelledType; li: number; start: number }> = [];
  // Words hidden only because they are a long digit run: for label checks they still count as a possibly missed value.
  const longRunWords = new Set<number>();
  const reasons: string[] = [];
  let phoneEnds: number[] = [];

  const claim = (li: number, start: number, idx: number[], type: PiiType, kind: LabelledType) => {
    idx.forEach((i) => claimed.set(i, type));
    matches.push({ type, wordIndexes: idx });
    meta.push({ kind, li, start });
  };
  // `hits` are [start, end) ranges of the line (or of a same-length transform of it); `ok` gets the ORIGINAL text.
  const findIn = (li: number, hits: Array<[number, number]>, type: PiiType, kind: LabelledType, ok: (m: string, start: number) => boolean): number[] => {
    const found: number[] = [];
    const line = lines[li];
    for (const [start, end] of hits) {
      const idx = wordsIn(line, start, end);
      const original = line.text.slice(start, end);
      if (idx.some((i) => claimed.has(i) || gstinWords.has(i)) || !ok(original, start)) continue;
      claim(li, start, idx, type, kind);
      if (type === 'PHONE') phoneEnds.push(end);
      found.push(...idx);
    }
    return found;
  };
  // `searchText`, if given, is a same-length transform of the line (look-alike swaps).
  const find = (li: number, re: RegExp, type: PiiType, kind: LabelledType, ok: (m: string, start: number) => boolean = () => true, searchText?: string) =>
    findIn(li, [...(searchText ?? lines[li].text).matchAll(new RegExp(re.source, 'g'))].map((m) => [m.index!, m.index! + m[0].length] as [number, number]), type, kind, ok);

  lines.forEach((line) => {
    for (const m of line.text.matchAll(new RegExp(GSTIN_PATTERN.source, 'g'))) {
      wordsIn(line, m.index!, m.index! + m[0].length).forEach((i) => gstinWords.add(i));
    }
  });

  lines.forEach((line, li) => {
    const prev = lines[li - 1]?.text ?? '';
    const runText = maskForRuns(line.text);
    const phoneLabel = hasLabel(line.text, 'PHONE');
    const notAfterInvoice = (_: string, start: number) => !invoiceLabelBefore(line.text, start);
    phoneEnds = [];
    find(li, AADHAAR, 'AADHAAR', 'AADHAAR', (s) => isValidVerhoeff(s.replace(/[\s-]/g, '')));
    find(li, IFSC, 'IFSC', 'IFSC');
    find(li, NEAR_IFSC, 'IFSC', 'IFSC', isNearIfsc);
    find(li, PAN, 'PAN', 'PAN');
    find(li, MOBILE, 'PHONE', 'PHONE');
    find(li, PAREN_LANDLINE, 'PHONE', 'PHONE');
    find(li, PAREN_NO_ZERO_LANDLINE, 'PHONE', 'PHONE', (s) => phoneLabel || digitCount(s) === NATIONAL_NUMBER_DIGITS);
    find(li, HYPHEN_LANDLINE, 'PHONE', 'PHONE', notAfterInvoice);
    if (phoneLabel) find(li, LANDLINE, 'PHONE', 'PHONE');
    // The rest of a phone list: "040-53850486, 53850487", "080 41055291 / 41055215", "080-41055291 / 92".
    for (let k = 0; k < phoneEnds.length; k++) {
      const next = phoneListNext(line.text, phoneEnds[k]);
      if (next) findIn(li, [next], 'PHONE', 'PHONE', () => true);
    }
    if (hasLabel(line.text, 'BANK_ACCOUNT') || hasLabel(prev, 'BANK_ACCOUNT')) find(li, BANK, 'BANK_ACCOUNT', 'BANK_ACCOUNT');
    // Near-misses, after every exact matcher so a real type always wins. Over-redaction is harmless; a miss is a leak.
    find(li, AADHAAR, 'POSSIBLE_ID', 'AADHAAR'); // Aadhaar-shaped but failing Verhoeff (valid ones were claimed above)
    find(li, NEAR_PAN, 'POSSIBLE_ID', 'PAN', isNearPan);
    find(li, MOBILE, 'POSSIBLE_ID', 'PHONE', isNearMobile, toDigits(line.text));
    find(li, CUT_LANDLINE, 'POSSIBLE_ID', 'PHONE', notAfterInvoice);
    // Last: any other run that could be a bank account is hidden too. A miss is a leak; this only hides a reference
    // number or two from the model, and the maths checks never use such numbers.
    findIn(li, longRuns(runText), 'POSSIBLE_ID', 'BANK_ACCOUNT', (t) => digitCount(t) >= MIN_RUN_DIGITS).forEach((i) => longRunWords.add(i));
  });

  // No match may leave the rest of its digit run visible: the unclaimed digit-bearing words of a run that holds a
  // match are hidden too, as one POSSIBLE_ID per run (simpler than widening a match and changing its type). Decimal
  // amounts are not blanked here, so a decimal tail joined to a hidden number is hidden with it; dates, times and
  // amounts with grouping commas still are (they are never the tail of an account). The digits of an IFSC or PAN do
  // not count as a match here: they are part of a letter code, not of a number that continues.
  lines.forEach((line) => {
    for (const [from, to] of runs(maskForRuns(line.text, false), 'any')) {
      const inRun = line.spans.filter((s) => s.start < to && s.end > from && !gstinWords.has(s.word));
      if (!inRun.some((s) => claimed.has(s.word) && !CODE_TYPES.has(claimed.get(s.word)!))) continue;
      const rest = inRun.filter((s) => !claimed.has(s.word) && SUSPICIOUS(line.text.slice(Math.max(s.start, from), Math.min(s.end, to))))
        .map((s) => s.word);
      if (rest.length === 0) continue;
      rest.forEach((i) => { claimed.set(i, 'POSSIBLE_ID'); longRunWords.add(i); });
      matches.push({ type: 'POSSIBLE_ID', wordIndexes: rest });
    }
  });

  const nearMissWords = new Set(matches.filter((m) => m.type === 'POSSIBLE_ID').flatMap((m) => m.wordIndexes));
  // Unclaimed digit-bearing words of line `li` whose span lies within [from, to): something that may be a missed value.
  const suspiciousIn = (li: number, from: number, to: number) => (lines[li]?.spans ?? []).some((s) =>
    s.start >= from && s.end <= to && (!claimed.has(s.word) || longRunWords.has(s.word)) && SUSPICIOUS(lines[li].text.slice(s.start, s.end)));

  lines.forEach((line, li) => {
    // Each label occurrence needs its own value of the SAME kind, after it on the line or on the next line, and that
    // value must be the first suspicious thing after the label: a visible digit-bearing word in between means the
    // label's real value may have been missed, so a later match does not count.
    for (const type of Object.keys(LABELS) as LabelledType[]) {
      const occ = [...line.text.matchAll(new RegExp(LABELS[type].source, 'g'))];
      occ.forEach((o, k) => {
        const from = o.index! + o[0].length;
        const to = occ[k + 1]?.index ?? Infinity;
        const last = k === occ.length - 1;
        const ok = meta.some((m) => m.kind === type && (
          (m.li === li && m.start >= from && m.start < to && !suspiciousIn(li, from, m.start))
          || (last && m.li === li + 1 && !suspiciousIn(li, from, Infinity) && !suspiciousIn(li + 1, 0, m.start))));
        if (!ok) reasons.push(`label_without_value:${li}`);
      });
    }
    // A digit run whose visible (unclaimed, non-GSTIN) pieces still hold enough digits to be an account number.
    const masked = maskForRuns(line.text);
    const visibleDigits = (from: number, to: number) => line.spans
      .filter((s) => s.start < to && s.end > from && !claimed.has(s.word) && !gstinWords.has(s.word))
      .reduce((sum, s) => sum + digitCount(line.text.slice(Math.max(s.start, from), Math.min(s.end, to))), 0);
    for (const [from, to] of runs(masked, 'loose')) {
      if (digitCount(masked.slice(from, to)) >= MIN_RUN_DIGITS && visibleDigits(from, to) >= MIN_RUN_DIGITS) reasons.push(`long_digit_run:${li}`);
    }
    // A digit group joined to a decimal amount: a two-group account with a decimal tail cannot be told from an HSN code
    // next to an amount whose commas OCR dropped, so when the amount has 3 or more integer digits, the two make 9 or more
    // digits and nothing of them is hidden, ask.
    for (const [from, to] of groupThenAmount(masked)) {
      const groupEnd = digitBlockEnd(masked, from);
      const tail = decimalIntegerDigits(line.text.slice(masked.indexOf(DECIMAL_AMOUNT_MARK, groupEnd), to));
      const inRange = line.spans.filter((s) => s.start < to && s.end > from && !gstinWords.has(s.word));
      if (tail >= MIN_JOINED_TAIL_DIGITS && (groupEnd - from) + tail >= MIN_RUN_DIGITS && !inRange.some((s) => claimed.has(s.word))) {
        reasons.push(`long_digit_run:${li}`);
      }
    }
    const bareDigits = (k: number) => k >= 0 && k < line.spans.length
      && /^\d+$/.test(line.text.slice(line.spans[k].start, line.spans[k].end).replace(BORDER_EDGES, ''));
    line.spans.forEach((s, k) => {
      // A near-miss is hidden, but a low-confidence read of it still asks the human (it may be something else).
      if (gstinWords.has(s.word) || (claimed.has(s.word) && !nearMissWords.has(s.word))) return;
      const t = line.text.slice(s.start, s.end);
      if (PARTIAL.test(t)) reasons.push(`partial_match:${s.word}`);
      else if (words[s.word].confidence < consentOcrThreshold * 100 && PII_LIKE.test(t) && !harmlessShape(t, bareDigits(k - 1) || bareDigits(k + 1))) {
        reasons.push(`low_ocr_confidence:${s.word}`);
      }
    });
  });

  // Bank details with no account found: OCR may have dropped the account's row (it does, on bank and payment tables).
  // A bank cue is an account label or a BANK_CUE word (an IFSC alone is not one: it is often printed without an account);
  // an account is a BANK_ACCOUNT match or a hidden possible id of 9 or more digits.
  // (lines can have holes where OCR returned no words for a line number: skip them, as forEach does.)
  const cueLine = lines.findIndex((l) => l !== undefined && (BANK_CUE.test(l.text) || hasLabel(l.text, 'BANK_ACCOUNT')));
  const accountFound = matches.some((m) => m.type === 'BANK_ACCOUNT'
    || (m.type === 'POSSIBLE_ID' && digitCount(m.wordIndexes.map((i) => words[i].text).join('')) >= MIN_RUN_DIGITS));
  if (cueLine >= 0 && !accountFound) reasons.push(`bank_details_without_account:${cueLine}`);

  return { gstinWordIndexes: [...gstinWords], matches, uncertain: reasons.length > 0, uncertainReasons: reasons };
}
