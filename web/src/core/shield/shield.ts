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
// Aadhaar-shaped (exact and near-miss alike), and not a piece of a longer digit run: that is left whole to LONG_RUN.
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
/** A mobile, with an optional country code (also in brackets: "(+91)", "(91)") or 0, and its first five digits possibly in brackets. */
const MOBILE = /(?<!\d)(?:\(\+?91\)[\s-]?|\+?91[\s-]?|0)?\(?[6-9]\d{4}\)?[\s-]?\d{5}(?!\d)/g;
const LANDLINE = /\b0\d{2,4}[\s-]?\d{3,4}[\s-]?\d{4}\b/g;
/**
 * A landline with its STD code in brackets, matched with or without a label: ( [ { | open, ) ] } | close, one of the
 * two may be lost by OCR, and the leading 0 may be read as O. An STD code without its 0 needs both brackets.
 */
const PAREN_LANDLINE = /(?:[([{|][0O]\d{2,4}[)\]}|]?|[([{|][1-9]\d{1,3}[)\]}|]|(?<!\d)[0O]\d{2,4}[)\]}|])[\s-]?\d(?:[\s-]?\d){5,7}(?!\d)/g;
/** A landline without brackets or label: STD code, a hyphen (spaces around it allowed), 6 to 8 digits. */
const HYPHEN_LANDLINE = /(?<![\dA-Z])0\d{2,4}\s?-\s?\d{6,8}(?!\d)/g;
const BANK = /\b\d(?:[\s-]?\d){8,17}\b/g;
/*
 * Long digit runs are looked for in a copy of the line where amounts, dates and times are blanked out (see
 * maskForRuns), so they never join a run; nothing else excuses a run.
 * LONG_RUN: a number that may be a bank account even though no label was read (OCR mangles labels: "A/C" came back as
 * "AJC"). Contiguous digits, or groups of at least 3 digits (the last may have 2) joined by one space, hyphen, dot or comma;
 * 9 or more digits in all (checked in code). Letters may touch it.
 */
const LONG_RUN = /(?<!\d)\d{3,}(?:[\s.,-]\d{3,})*(?:[\s.,-]\d{2})?(?!\d)/g;
/** Any grouping: a run OCR may have split in pieces LONG_RUN does not accept. */
const LOOSE_RUN = /(?<!\d)\d(?:[\s.,-]?\d){8,}(?!\d)/g;
/** Every maximal digit run, any length: a match inside one must not leave the rest of it visible. */
const ANY_RUN = /\d(?:[\s.,-]?\d)*/g;
const MIN_RUN_DIGITS = 9;
const digitCount = (t: string) => t.replace(/\D/g, '').length;
/*
 * What maskForRuns blanks out, in this order: dates (day-month-year or year-month-day with plausible day and month),
 * times, and amounts. An amount has grouping commas (at most 9 digits before its decimal part) or a decimal part with
 * at most 8 digits before it. An amount that is the third or later group of a digit run (two groups of 3 or more
 * digits, each followed by one space or hyphen, right before it) is not blanked: there it is the tail of an account.
 */
const AFTER_TWO_GROUPS = String.raw`(?<!\d{3}[\s-]\d{3,40}[\s-])`;
const DATE_MASK = /(?<!\d|\d[.,/-])(?:(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.](?:\d{4}|\d{2})|\d{4}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01]))(?!\d|[.,/-]\d)/g;
const TIME_MASK = /(?<!\d|\d[.,:])\d{1,2}:\d{2}(?::\d{2})?(?!\d|[.,:]\d)/g;
const COMMA_AMOUNT_MASK = new RegExp(String.raw`(?<!\d|\d[.,])${AFTER_TWO_GROUPS}\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?(?!\d|[.,]\d)`, 'g');
const DECIMAL_AMOUNT_MASK = new RegExp(String.raw`(?<!\d|\d[.,])${AFTER_TWO_GROUPS}\d{1,8}[.,]\d{1,2}(?!\d|[.,]\d)`, 'g');
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
    .replace(new RegExp(TIME_MASK.source, 'g'), blank(DATE_TIME_MARK))
    .replace(new RegExp(COMMA_AMOUNT_MASK.source, 'g'), (m) => (integerDigits(m) <= MAX_COMMA_AMOUNT_DIGITS ? COMMA_AMOUNT_MARK.repeat(m.length) : m));
  return decimalAmounts ? t.replace(new RegExp(DECIMAL_AMOUNT_MASK.source, 'g'), blank(DECIMAL_AMOUNT_MARK)) : t;
}
const MIN_JOINED_TAIL_DIGITS = 4;
/**
 * In masked text: a digit group of 3 or more joined by one space or hyphen to a blanked decimal amount without grouping
 * commas right after it (an amount with grouping commas is never the tail of an account).
 */
const GROUP_THEN_AMOUNT = /(?<!\d)\d{3,}[\s-]#+/g;
const NEAR_PAN = /\b[A-Z0-9]{10}\b/g;
// Digit look-alikes, used to un-confuse OCR misreads.
const TO_DIGIT: Record<string, string> = { O: '0', I: '1', L: '1', S: '5', B: '8', Z: '2' };
const TO_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z' };
const PAN_SHAPE = /^[A-Z]{5}\d{4}[A-Z]$/;
/** At most this many look-alike swaps for a near-PAN; real misreads are 1–2 characters, invoice numbers need more. */
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
 * (Z also read as 2 or 7). A 16-character word qualifies when dropping one character (an OCR insertion) leaves one.
 */
function hasGstinSkeleton(s: string): boolean {
  const fits = (w: string) => w.length === GSTIN_CLASSES.length && GSTIN_SKELETON.test([...w].map((c, i) => {
    const want = GSTIN_CLASSES[i];
    if (want === 'D') return TO_DIGIT[c] ?? c;
    if (want === 'L') return TO_LETTER[c] ?? c;
    if (want === 'Z') return c === '2' || c === '7' ? 'Z' : c;
    return c;
  }).join(''));
  if (s.length === GSTIN_CLASSES.length + 1) return [...s].some((_, i) => fits(s.slice(0, i) + s.slice(i + 1)));
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

/** A word that could be (part of) a private number: any digit at all (OCR may split a number into short pieces). */
const SUSPICIOUS = (t: string) => /\d/.test(t);

export function runShield(words: OcrWord[], consentOcrThreshold: number): ShieldResult {
  const lines = buildLines(words);
  const gstinWords = new Set<number>();
  const claimed = new Set<number>();
  const matches: PiiMatch[] = [];
  // kind: which label a match can satisfy. Exact matches use their own type; a POSSIBLE_ID uses the type it nearly is.
  const meta: Array<{ kind: LabelledType; li: number; start: number }> = [];
  // Words hidden only because they are a long digit run: for label checks they still count as a possibly missed value.
  const longRunWords = new Set<number>();
  const reasons: string[] = [];

  // `searchText`, if given, is a same-length transform of the line (look-alike swaps); `ok` gets the ORIGINAL text.
  const find = (li: number, re: RegExp, type: PiiType, kind: LabelledType, ok: (m: string) => boolean = () => true, searchText?: string): number[] => {
    const found: number[] = [];
    const line = lines[li];
    for (const m of (searchText ?? line.text).matchAll(new RegExp(re.source, 'g'))) {
      const idx = wordsIn(line, m.index!, m.index! + m[0].length);
      const original = line.text.slice(m.index!, m.index! + m[0].length);
      if (idx.some((i) => claimed.has(i) || gstinWords.has(i)) || !ok(original)) continue;
      idx.forEach((i) => claimed.add(i));
      matches.push({ type, wordIndexes: idx });
      meta.push({ kind, li, start: m.index! });
      found.push(...idx);
    }
    return found;
  };

  lines.forEach((line) => {
    for (const m of line.text.matchAll(new RegExp(GSTIN_PATTERN.source, 'g'))) {
      wordsIn(line, m.index!, m.index! + m[0].length).forEach((i) => gstinWords.add(i));
    }
  });

  lines.forEach((line, li) => {
    const prev = lines[li - 1]?.text ?? '';
    const runText = maskForRuns(line.text);
    find(li, AADHAAR, 'AADHAAR', 'AADHAAR', (s) => isValidVerhoeff(s.replace(/[\s-]/g, '')));
    find(li, IFSC, 'IFSC', 'IFSC');
    find(li, NEAR_IFSC, 'IFSC', 'IFSC', isNearIfsc);
    find(li, PAN, 'PAN', 'PAN');
    find(li, MOBILE, 'PHONE', 'PHONE');
    find(li, PAREN_LANDLINE, 'PHONE', 'PHONE');
    find(li, HYPHEN_LANDLINE, 'PHONE', 'PHONE');
    if (hasLabel(line.text, 'PHONE')) find(li, LANDLINE, 'PHONE', 'PHONE');
    if (hasLabel(line.text, 'BANK_ACCOUNT') || hasLabel(prev, 'BANK_ACCOUNT')) find(li, BANK, 'BANK_ACCOUNT', 'BANK_ACCOUNT');
    // Near-misses, after every exact matcher so a real type always wins. Over-redaction is harmless; a miss is a leak.
    find(li, AADHAAR, 'POSSIBLE_ID', 'AADHAAR'); // Aadhaar-shaped but failing Verhoeff (valid ones were claimed above)
    find(li, NEAR_PAN, 'POSSIBLE_ID', 'PAN', isNearPan);
    find(li, MOBILE, 'POSSIBLE_ID', 'PHONE', isNearMobile, toDigits(line.text));
    // Last: any other run that could be a bank account is hidden too. A miss is a leak; this only hides a reference
    // number or two from the model, and the maths checks never use such numbers.
    find(li, LONG_RUN, 'POSSIBLE_ID', 'BANK_ACCOUNT', (t) => digitCount(t) >= MIN_RUN_DIGITS, runText).forEach((i) => longRunWords.add(i));
  });

  // No match may leave the rest of its digit run visible: the unclaimed digit-bearing words of a run that holds a
  // match are hidden too, as one POSSIBLE_ID per run (simpler than widening a match and changing its type). Decimal
  // amounts are not blanked here, so a decimal tail joined to a hidden number is hidden with it; dates, times and
  // amounts with grouping commas still are (they are never the tail of an account).
  lines.forEach((line) => {
    for (const m of maskForRuns(line.text, false).matchAll(new RegExp(ANY_RUN.source, 'g'))) {
      const from = m.index!;
      const to = from + m[0].length;
      const inRun = line.spans.filter((s) => s.start < to && s.end > from && !gstinWords.has(s.word));
      if (!inRun.some((s) => claimed.has(s.word))) continue;
      const rest = inRun.filter((s) => !claimed.has(s.word) && SUSPICIOUS(line.text.slice(Math.max(s.start, from), Math.min(s.end, to))))
        .map((s) => s.word);
      if (rest.length === 0) continue;
      rest.forEach((i) => { claimed.add(i); longRunWords.add(i); });
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
    for (const m of masked.matchAll(new RegExp(LOOSE_RUN.source, 'g'))) {
      if (visibleDigits(m.index!, m.index! + m[0].length) >= MIN_RUN_DIGITS) reasons.push(`long_digit_run:${li}`);
    }
    // A digit group joined to a decimal amount: a two-group account with a decimal tail cannot be told from an HSN code
    // next to an amount whose commas OCR dropped, so when the amount has 4 or more integer digits (an account's groups
    // do; a rate of 784.00 next to an HSN code does not), the two make 9 or more digits and nothing of them is hidden, ask.
    for (const m of masked.matchAll(new RegExp(GROUP_THEN_AMOUNT.source, 'g'))) {
      const from = m.index!;
      const groupEnd = from + digitCount(m[0]);
      let to = from + m[0].length;
      while (masked[to] === DECIMAL_AMOUNT_MARK) to++;
      const tail = decimalIntegerDigits(line.text.slice(groupEnd + 1, to));
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

  return { gstinWordIndexes: [...gstinWords], matches, uncertain: reasons.length > 0, uncertainReasons: reasons };
}
