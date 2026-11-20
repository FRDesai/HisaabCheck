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
const MOBILE = /(?<!\d)(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;
const LANDLINE = /\b0\d{2,4}[\s-]?\d{3,4}[\s-]?\d{4}\b/g;
const BANK = /\b\d(?:[\s-]?\d){8,17}\b/g;
const LABELS: Record<Exclude<PiiType, never>, RegExp> = {
  PAN: /\bPAN\b/g,
  AADHAAR: /\bAADHAA?R\b/g,
  IFSC: /\bIFSC\b/g,
  PHONE: /\b(?:MOB(?:ILE)?|PH(?:ONE)?|TEL|CELL|CONTACT)\b/g,
  BANK_ACCOUNT: /\bACC(?:OUNT|T)?\.?\s*NO\b|\bACCOUNT\b|\bACCT\b|\bA\/C\b|\bAC\s*NO\b/g,
};
const PARTIAL = /\b[A-Z]{5}\d{1,3}\b/;
const PII_LIKE = /\d{3,}|[A-Z]{3,}\d/;

function hasLabel(text: string, type: PiiType): boolean {
  return new RegExp(LABELS[type].source).test(text);
}

export function runShield(words: OcrWord[], consentOcrThreshold: number): ShieldResult {
  const lines = buildLines(words);
  const gstinWords = new Set<number>();
  const claimed = new Set<number>();
  const matches: PiiMatch[] = [];
  const meta: Array<{ type: PiiType; li: number; start: number }> = [];
  const reasons: string[] = [];

  const find = (li: number, re: RegExp, type: PiiType, ok: (m: string) => boolean = () => true) => {
    const line = lines[li];
    for (const m of line.text.matchAll(new RegExp(re.source, 'g'))) {
      const idx = wordsIn(line, m.index!, m.index! + m[0].length);
      if (idx.some((i) => claimed.has(i) || gstinWords.has(i)) || !ok(m[0])) continue;
      idx.forEach((i) => claimed.add(i));
      matches.push({ type, wordIndexes: idx });
      meta.push({ type, li, start: m.index! });
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
    if (hasLabel(line.text, 'PHONE')) find(li, LANDLINE, 'PHONE');
    if (hasLabel(line.text, 'BANK_ACCOUNT') || hasLabel(prev, 'BANK_ACCOUNT')) find(li, BANK, 'BANK_ACCOUNT');
  });

  lines.forEach((line, li) => {
    // Each label occurrence needs its own value of the SAME type, after it on the line or on the next line.
    for (const type of Object.keys(LABELS) as PiiType[]) {
      const occ = [...line.text.matchAll(new RegExp(LABELS[type].source, 'g'))];
      occ.forEach((o, k) => {
        const from = o.index! + o[0].length;
        const to = occ[k + 1]?.index ?? Infinity;
        const last = k === occ.length - 1;
        const ok = meta.some(
          (m) => m.type === type && ((m.li === li && m.start >= from && m.start < to) || (last && m.li === li + 1)),
        );
        if (!ok) reasons.push(`label_without_value:${li}`);
      });
    }
    for (const s of line.spans) {
      if (claimed.has(s.word) || gstinWords.has(s.word)) continue;
      const t = line.text.slice(s.start, s.end);
      if (PARTIAL.test(t)) reasons.push(`partial_match:${s.word}`);
      else if (words[s.word].confidence < consentOcrThreshold * 100 && PII_LIKE.test(t)) reasons.push(`low_ocr_confidence:${s.word}`);
    }
  });

  return { gstinWordIndexes: [...gstinWords], matches, uncertain: reasons.length > 0, uncertainReasons: reasons };
}
