import { useEffect, useMemo, useState } from 'react';
import type { Checks, Extraction, ProcessedBill, Reason } from '../../core/types';
import { runChecks } from '../../core/checks/checks';
import { parseConfig } from '../../core/config/parseConfig';
import { updateBillFields } from '../../adapters/store';

const REASON: Record<Reason, string> = {
  passed: '', total_mismatch: 'total mismatch', invalid_gstin: 'invalid GSTIN', low_confidence: 'low confidence',
  device_timeout: 'on-device read too slow', device_error: 'on-device error', invalid_json: 'unreadable answer',
  no_device_model: 'no on-device AI', cloud_only_mode: 'cloud-only mode', cloud_error: 'cloud unavailable',
  ocr_error: 'could not check for private numbers', user_kept_local: 'kept on device',
  redact_error: 'could not hide private numbers safely',
};
const CHECK_MSG: Record<keyof Checks, string> = { total: 'Items + tax ≠ total', gstin: 'GSTIN invalid', taxSplit: 'Tax split does not match states', date: 'Date invalid or in the future', required: 'Required field missing' };
const EMPTY: Extraction = { supplierName: '', supplierGstin: '', invoiceNo: '', invoiceDate: '', placeOfSupply: '', taxableValue: 0, cgst: 0, sgst: 0, igst: 0, total: 0, confidence: 0 };
const FIELDS: Array<[keyof Extraction, string, 'text' | 'number']> = [
  ['supplierName', 'Supplier', 'text'], ['supplierGstin', 'Supplier GSTIN', 'text'], ['invoiceNo', 'Invoice no.', 'text'],
  ['invoiceDate', 'Invoice date', 'text'], ['placeOfSupply', 'Place of supply', 'text'], ['taxableValue', 'Taxable value', 'number'],
  ['cgst', 'CGST', 'number'], ['sgst', 'SGST', 'number'], ['igst', 'IGST', 'number'], ['total', 'Total', 'number'],
];
const FIELD_CHECK: Partial<Record<keyof Extraction, keyof Checks>> = { supplierGstin: 'gstin', invoiceDate: 'date', total: 'total', cgst: 'taxSplit', sgst: 'taxSplit', igst: 'taxSplit' };

export default function ResultPanel({ shopId, billId, result, originalUrl }: { shopId: string; billId: string; result: ProcessedBill; originalUrl: string }) {
  const [e, setE] = useState<Extraction>(result.extraction ?? EMPTY);
  const [checks, setChecks] = useState<Checks | null>(result.checks);
  const [showSent, setShowSent] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // originalUrl is a local object URL (owned by the processor hook); sentUrl is the redacted copy, revoked on change/unmount.
  const sentUrl = useMemo(() => (result.redactedImage ? URL.createObjectURL(result.redactedImage) : null), [result.redactedImage]);
  useEffect(() => () => { if (sentUrl) URL.revokeObjectURL(sentUrl); }, [sentUrl]);
  const { path, reason } = result.route;
  const badge = path === 'device' && reason === 'passed' ? 'Read on device'
    : path === 'cloud' ? `Checked in cloud: ${REASON[reason]}` : `Manual entry: ${REASON[reason]}`;

  async function save() {
    setSaveError(false);
    try {
      const c = runChecks(e, parseConfig({}, true), new Date()).checks;
      setChecks(c);
      await updateBillFields(shopId, billId, e, c);
      setSaved(true);
    } catch {
      setSaveError(true);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 mt-3">
      <div>
        <img src={showSent && sentUrl ? sentUrl : originalUrl} alt={showSent ? 'Image sent to cloud (redacted)' : 'Original bill (stays on this computer)'} className="w-full rounded border" />
        {sentUrl && <button className="text-sm underline mt-1" onClick={() => setShowSent(!showSent)}>{showSent ? 'Show original' : 'Show what the cloud saw'}</button>}
      </div>
      <div className="space-y-2">
        <span className={`inline-block px-3 py-1 rounded-full text-sm ${path === 'device' && reason === 'passed' ? 'bg-emerald-100 text-emerald-900' : path === 'cloud' ? 'bg-sky-100 text-sky-900' : 'bg-amber-100 text-amber-900'}`}>{badge}</span>
        {result.piiMasked > 0 && <p className="text-sm text-slate-600">{result.piiMasked} private number(s) hidden: {result.piiTypes.join(', ')}</p>}
        {checks && (Object.keys(CHECK_MSG) as (keyof Checks)[]).filter((k) => !checks[k]).map((k) => <p key={k} className="text-red-700 text-sm">⚠ {CHECK_MSG[k]}</p>)}
        {FIELDS.map(([k, label, type]) => {
          const bad = checks && FIELD_CHECK[k] && !checks[FIELD_CHECK[k]!];
          return (
            <label key={k} className="block text-sm">{label}
              <input type={type} step="0.01" className={`mt-1 w-full border rounded p-2 ${bad ? 'border-red-600 bg-red-50' : ''}`} aria-invalid={!!bad}
                value={String(e[k] ?? '')} onChange={(ev) => { setSaved(false); setE({ ...e, [k]: type === 'number' ? Number(ev.target.value) : ev.target.value }); }} />
            </label>
          );
        })}
        <button className="px-5 py-3 rounded-lg bg-emerald-700 text-white" onClick={save}>{saved ? 'Saved ✓' : 'Save changes'}</button>
        {saveError && <p role="alert" className="text-sm text-red-700">Could not save your changes. Check your connection and try again.</p>}
      </div>
    </div>
  );
}
