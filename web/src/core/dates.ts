const IST_OFFSET_MS = 5.5 * 3600e3;

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

/** IST calendar date (YYYY-MM-DD) of an instant. */
export const istDate = (at: Date): string => new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
/** IST calendar month (YYYY-MM) of an instant. */
export const istMonth = (at: Date): string => istDate(at).slice(0, 7);

/** First and last day of a YYYY-MM month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
