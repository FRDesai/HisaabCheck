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
