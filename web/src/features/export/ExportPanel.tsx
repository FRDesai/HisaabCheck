import { useEffect, useState } from 'react';
import { fetchBillsByInvoiceDate, type Shop } from '../../adapters/store';
import { isIsoDate, istMonth, monthRange } from '../../core/dates';
import { toCsv } from '../../core/export/csv';
import { exportable, fileSlug, notApprovedInRange } from '../../core/export/rows';
import type { BillDoc } from '../../core/review/billDoc';
import { downloadText } from './download';

type Found = { ready: BillDoc[]; leftOut: number };

/** Export of approved bills for a date range. refreshKey changes when the inbox sees an approval, so the count stays right. */
export default function ExportPanel({ shop, month, refreshKey }: { shop: Shop; month: string | null; refreshKey: number }) {
  const [range, setRange] = useState(() => monthRange(month ?? istMonth(new Date())));
  useEffect(() => { setRange(monthRange(month ?? istMonth(new Date()))); }, [month]);
  const { from, to } = range;
  const rangeOk = isIsoDate(from) && isIsoDate(to) && from <= to;

  const [found, setFound] = useState<Found | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  useEffect(() => {
    setFound(null);
    if (!rangeOk) { setState('idle'); return; }
    let alive = true;
    setState('loading');
    fetchBillsByInvoiceDate(shop.id, from, to)
      .then((b) => { if (alive) { setFound({ ready: exportable(b, from, to), leftOut: notApprovedInRange(b, from, to) }); setState('idle'); } })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [shop.id, from, to, rangeOk, refreshKey]);

  const name = `hisaabcheck-${fileSlug(shop.shopName)}-${from}-to-${to}`;
  const none = !found || found.ready.length === 0;

  return (
    <section aria-labelledby="export-heading" className="bg-white rounded-lg border p-4 space-y-3">
      <h2 id="export-heading" className="font-semibold">Export approved bills</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">From (invoice date)
          <input type="date" className="block mt-1 border rounded p-2" value={from} max={to} onChange={(e) => setRange({ from: e.target.value, to })} />
        </label>
        <label className="text-sm">To
          <input type="date" className="block mt-1 border rounded p-2" value={to} min={from} onChange={(e) => setRange({ from, to: e.target.value })} />
        </label>
        <button type="button" className="px-4 py-2 rounded-lg bg-emerald-700 text-white disabled:opacity-50" disabled={none}
          onClick={() => found && downloadText(`${name}.csv`, 'text/csv;charset=utf-8', toCsv(found.ready))}>Download CSV</button>
        {/* TALLY BUTTONS (Task 9) */}
      </div>
      {!rangeOk && <p role="alert" className="text-sm text-red-700">Choose a From date that is on or before the To date.</p>}
      {state === 'loading' && <p role="status" className="text-sm text-slate-600">Counting bills…</p>}
      {state === 'error' && <p role="alert" className="text-sm text-red-700">The bills for this range could not be loaded. Check your connection and change a date to try again.</p>}
      {found && (
        <p role="status" className="text-sm text-slate-700">
          {found.ready.length} approved bill{found.ready.length === 1 ? '' : 's'} in this range.
          {found.leftOut > 0 && ` ${found.leftOut} more ${found.leftOut === 1 ? 'is' : 'are'} not approved and will be left out.`}
        </p>
      )}
    </section>
  );
}
