import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { BILL_PAGE, watchBills } from '../../adapters/store';
import type { BillDoc } from '../../core/review/billDoc';
import { failedChecks } from '../../core/review/decision';
import { BILL_FILTERS, countsByFilter, filterBills, monthsOf, type BillFilter } from '../../core/review/filters';
import type { BillStatus } from '../../core/types';
import { badgeText, badgeTone, CHECK_MSG } from '../result/labels';
import ExportPanel from '../export/ExportPanel';
import { useShop } from '../shops/useShop';

const FILTER_LABEL: Record<BillFilter, string> = { to_review: 'To review', failed_checks: 'Failed checks', manual_entry: 'Manual entry', approved: 'Approved', rejected: 'Rejected', all: 'All' };
const STATUS_LABEL: Record<BillStatus, string> = { draft: 'To review', manual_entry: 'Manual entry', approved: 'Approved', rejected: 'Rejected' };
const STATUS_TONE: Record<BillStatus, string> = { draft: 'bg-slate-200 text-slate-900', manual_entry: 'bg-amber-100 text-amber-900', approved: 'bg-emerald-100 text-emerald-900', rejected: 'bg-red-100 text-red-900' };
const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Remounts the page body per shop so no state from the previous shop can render. */
export default function InboxPage() {
  const { shopId } = useParams();
  return <Inbox key={shopId} shopId={shopId} />;
}

function Inbox({ shopId }: { shopId: string | undefined }) {
  const location = useLocation();
  const { shop, failed: shopFailed } = useShop(shopId);
  const [max, setMax] = useState(BILL_PAGE);
  const [bills, setBills] = useState<BillDoc[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<BillFilter>('to_review');
  const [month, setMonth] = useState<string | null>(null);

  useEffect(() => {
    if (!shopId) return;
    setError(false);
    return watchBills(shopId, max, (b) => { setBills(b); setError(false); }, () => setError(true));
  }, [shopId, max, attempt]);

  const all = useMemo(() => bills ?? [], [bills]);
  const months = useMemo(() => monthsOf(all), [all]);
  const counts = useMemo(() => countsByFilter(all, month), [all, month]);
  const shown = useMemo(() => filterBills(all, filter, month), [all, filter, month]);
  const approvedCount = useMemo(() => all.filter((b) => b.status === 'approved').length, [all]);
  const notice = (location.state as { notice?: string } | null)?.notice;

  if (shopFailed) {
    return <p role="alert" className="text-red-700">This shop could not be loaded. <Link to="/shops" className="underline">Back to shops</Link></p>;
  }

  return (
    <div className="space-y-4">
      <Link to="/shops" className="text-sm underline">← Shops</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{shop?.shopName ?? '…'} — bills</h1>
        <Link to={`/shops/${shopId}/upload`} className="px-4 py-2 rounded-lg bg-emerald-700 text-white">Upload bills</Link>
      </div>
      {notice && <p role="status" className="p-3 rounded bg-emerald-50 text-emerald-900">{notice}</p>}

      {shop && <ExportPanel shop={shop} month={month} refreshKey={approvedCount} />}

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter bills" className="flex flex-wrap gap-2">
          {BILL_FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-sm border ${filter === f ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white'}`}>
              {FILTER_LABEL[f]} <span className="tabular-nums">({counts[f]})</span>
            </button>
          ))}
        </div>
        <label className="ml-auto text-sm">Month{' '}
          <select className="border rounded p-1.5 bg-white" value={month ?? ''} onChange={(e) => setMonth(e.target.value || null)}>
            <option value="">All months</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
      </div>

      {error && (
        <p role="alert" className="text-red-700">The bills could not be loaded. Check your connection.{' '}
          <button type="button" className="underline" onClick={() => setAttempt((a) => a + 1)}>Try again</button></p>
      )}
      {!error && bills === null && <p role="status" className="text-slate-600">Loading bills…</p>}
      {!error && bills !== null && shown.length === 0 && (
        <p role="status" className="text-slate-600">{all.length === 0 ? 'No bills yet for this shop. Upload the first one.' : 'No bills match this filter.'}</p>
      )}
      {shown.length > 0 && (
        <div className="overflow-x-auto bg-white rounded-lg border">
          <table className="w-full text-sm">
            <caption className="sr-only">Bills for {shop?.shopName ?? 'this shop'}</caption>
            <thead className="text-left text-slate-600 border-b">
              <tr>
                <th scope="col" className="p-3">Invoice date</th><th scope="col" className="p-3">Supplier</th><th scope="col" className="p-3">Invoice no.</th>
                <th scope="col" className="p-3 text-right">Total</th><th scope="col" className="p-3">Read</th><th scope="col" className="p-3">Checks</th><th scope="col" className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => {
                const failed = failedChecks(b.checks);
                return (
                  <tr key={b.id} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="p-3 whitespace-nowrap">{b.extraction.invoiceDate || '—'}</td>
                    <td className="p-3"><Link className="underline font-medium" to={`/shops/${shopId}/bills/${b.id}`}>{b.extraction.supplierName || 'Unnamed supplier'}</Link></td>
                    <td className="p-3">{b.extraction.invoiceNo || '—'}</td>
                    <td className="p-3 text-right tabular-nums">{rupees(b.extraction.total)}</td>
                    <td className="p-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs ${badgeTone(b.route)}`}>{badgeText(b.route)}</span></td>
                    <td className="p-3">{failed.length === 0 ? <span className="text-emerald-800">All passed</span>
                      : <span className="text-red-700" title={failed.map((k) => CHECK_MSG[k]).join('; ')}>⚠ {failed.length} failed<span className="sr-only">: {failed.map((k) => CHECK_MSG[k]).join('; ')}</span></span>}</td>
                    <td className="p-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs ${STATUS_TONE[b.status]}`}>{STATUS_LABEL[b.status]}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {bills !== null && bills.length >= max && (
        <p className="text-sm text-slate-600">Showing the newest {max} bills.{' '}
          <button type="button" className="underline" onClick={() => setMax(max + BILL_PAGE)}>Load older bills</button></p>
      )}
    </div>
  );
}
