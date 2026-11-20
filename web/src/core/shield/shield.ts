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
