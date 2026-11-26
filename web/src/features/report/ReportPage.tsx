import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { fetchBillsByInvoiceDate, type Shop } from '../../adapters/store';
import { istDate } from '../../core/dates';
import { buildReport, formatLongDate, formatRupees, formatShare, parseReportRange, type ReportModel } from '../../core/report/report';
import { useAuth } from '../auth/AuthProvider';
import { useShop } from '../shops/useShop';

const th = 'p-2 font-semibold';
const td = 'p-2 tabular-nums';

/** Business Health Report: one printable page for a shop and an invoice-date range (FR-19). */
export default function ReportPage() {
  const { shopId } = useParams();
  const [params] = useSearchParams();
  const range = useMemo(() => parseReportRange(params.get('from'), params.get('to'), new Date()), [params]);
  const back = <Link to={shopId ? `/shops/${shopId}/bills` : '/shops'} className="underline">Back to the bills</Link>;

  if (!range.ok) return <p role="alert" className="text-red-700">{range.message} {back}</p>;
  return <Report key={`${shopId}|${range.from}|${range.to}`} shopId={shopId} from={range.from} to={range.to} back={back} />;
}

function Report({ shopId, from, to, back }: { shopId: string | undefined; from: string; to: string; back: JSX.Element }) {
  const { shop, failed: shopFailed } = useShop(shopId);
  const { user, profile } = useAuth();
  const [report, setReport] = useState<ReportModel | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!shopId) return;
    let alive = true;
    setError(false); setReport(null);
    fetchBillsByInvoiceDate(shopId, from, to)
      .then((b) => { if (alive) setReport(buildReport(b, from, to)); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [shopId, from, to, attempt]);

  if (shopFailed) return <p role="alert" className="text-red-700">This shop was not found, or it could not be loaded. <Link to="/shops" className="underline">Back to shops</Link></p>;

  const caName = profile?.name || user?.displayName || user?.email || 'the CA';
  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-3">
        {back}
        <button type="button" className="ml-auto px-4 py-2 rounded-lg bg-emerald-700 text-white disabled:opacity-50"
          disabled={!report || !shop} onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      {error && (
        <p role="alert" className="text-red-700">The report needs a connection: the bills for this period could not be loaded from the server.{' '}
          <button type="button" className="underline" onClick={() => setAttempt((a) => a + 1)}>Try again</button></p>
      )}
      {!error && (!report || !shop) && <p role="status" className="text-slate-600">Loading the report…</p>}
      {!error && report && shop && <ReportBody report={report} shop={shop} caName={caName} />}
    </div>
  );
}

function ReportBody({ report: r, shop, caName }: { report: ReportModel; shop: Shop; caName: string }) {
  const none = r.counts.approved === 0;
  return (
    <article className="report-page bg-white rounded-lg border p-6 space-y-5 max-w-3xl text-slate-900">
      <header className="space-y-1 border-b pb-3">
        <p className="text-sm text-slate-600">Business Health Report</p>
        <h1 className="text-2xl font-bold">{shop.shopName}</h1>
        <p className="text-sm">GSTIN: {shop.gstin || 'not recorded'}</p>
        <p className="text-sm">Period (invoice date): {formatLongDate(r.from)} to {formatLongDate(r.to)}</p>
        <p className="text-sm">Prepared from bills approved by {caName} on {formatLongDate(istDate(new Date()))}.</p>
      </header>

      {none && <p role="status" className="font-medium">No approved bills in this period.</p>}

      <section aria-labelledby="r-months" className="report-block">
        <h2 id="r-months" className="text-lg font-semibold mb-2">Monthly purchases</h2>
        <table className="w-full text-sm">
          <caption className="sr-only">Purchase value and number of approved bills for each month. The bar shows the month against the highest month.</caption>
          <thead className="text-left border-b"><tr>
            <th scope="col" className={th}>Month</th><th scope="col" className={`${th} text-right`}>Bills</th>
            <th scope="col" className={`${th} text-right`}>Purchases</th><th scope="col" className={`${th} w-2/5`}><span className="sr-only">Bar</span></th>
          </tr></thead>
          <tbody>
            {r.months.map((m) => (
              <tr key={m.month} className="border-b last:border-0 report-row">
                <th scope="row" className={`${th} font-normal text-left whitespace-nowrap`}>{m.label}</th>
                <td className={`${td} text-right`}>{m.bills}</td>
                <td className={`${td} text-right whitespace-nowrap`}>{formatRupees(m.totalPaise)}</td>
                <td className="p-2">
                  <div role="img" aria-label={`${m.label}: ${m.barPct}% of the highest month`} className="report-bar-track h-3 bg-slate-100 rounded">
                    <div className="report-bar h-3 bg-emerald-700 rounded" style={{ width: `${m.barPct}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="r-suppliers" className="report-block">
        <h2 id="r-suppliers" className="text-lg font-semibold mb-2">Top suppliers</h2>
        {r.suppliers.length === 0 ? <p className="text-sm">No suppliers in this period.</p> : (
          <table className="w-full text-sm">
            <caption className="text-left text-xs text-slate-600 mb-1">
              The {r.suppliers.length} largest of {r.supplierCount} supplier{r.supplierCount === 1 ? '' : 's'} by purchase value. Bills with the same valid GSTIN are counted together; otherwise by supplier name.
            </caption>
            <thead className="text-left border-b"><tr>
              <th scope="col" className={th}>Supplier</th><th scope="col" className={th}>GSTIN</th>
              <th scope="col" className={`${th} text-right`}>Bills</th><th scope="col" className={`${th} text-right`}>Total</th>
              <th scope="col" className={`${th} text-right`}>Share</th>
            </tr></thead>
            <tbody>
              {r.suppliers.map((s) => (
                <tr key={s.key} className="border-b last:border-0 report-row">
                  <th scope="row" className={`${th} font-normal text-left`}>{s.name}</th>
                  <td className="p-2 font-mono text-xs">{s.gstin || '—'}</td>
                  <td className={`${td} text-right`}>{s.bills}</td>
                  <td className={`${td} text-right whitespace-nowrap`}>{formatRupees(s.totalPaise)}</td>
                  <td className={`${td} text-right`}>{formatShare(s.sharePermille)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid gap-5 sm:grid-cols-2 report-grid">
        <section aria-labelledby="r-gst" className="report-block">
          <h2 id="r-gst" className="text-lg font-semibold mb-2">GST paid</h2>
          <table className="w-full text-sm">
            <caption className="sr-only">GST paid and purchase totals for the period</caption>
            <tbody>
              {([['CGST', r.tax.cgstPaise], ['SGST', r.tax.sgstPaise], ['IGST', r.tax.igstPaise], ['Total GST', r.tax.gstPaise],
                ['Taxable value', r.tax.taxablePaise], ['Total purchases', r.tax.totalPaise]] as const).map(([label, v]) => (
                <tr key={label} className={`border-b last:border-0 ${label === 'Total GST' || label === 'Total purchases' ? 'font-semibold' : ''}`}>
                  <th scope="row" className={`${th} text-left ${label === 'Total GST' || label === 'Total purchases' ? '' : 'font-normal'}`}>{label}</th>
                  <td className={`${td} text-right whitespace-nowrap`}>{formatRupees(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-labelledby="r-bills" className="report-block">
          <h2 id="r-bills" className="text-lg font-semibold mb-2">Bills</h2>
          <table className="w-full text-sm">
            <caption className="sr-only">Bill counts for the period</caption>
            <tbody>
              <tr className="border-b"><th scope="row" className={`${th} font-normal text-left`}>Approved bills in this period</th><td className={`${td} text-right`}>{r.counts.approved}</td></tr>
              <tr className="border-b"><th scope="row" className={`${th} font-normal text-left`}>Of these, approved after checking against the paper copy (an automatic check had failed)</th><td className={`${td} text-right`}>{r.counts.approvedAfterPaperCheck}</td></tr>
              <tr><th scope="row" className={`${th} font-normal text-left`}>Bills dated in this period not yet approved (left out)</th><td className={`${td} text-right`}>{r.counts.notApproved}</td></tr>
            </tbody>
          </table>
        </section>
      </div>

      <footer className="border-t pt-3 text-xs text-slate-700 report-block">
        <p>These figures come from the purchase bills recorded in HisaabCheck for this period. This is not an audited statement.</p>
      </footer>
    </article>
  );
}
