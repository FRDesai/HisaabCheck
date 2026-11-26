import { useEffect, useState } from 'react';
import type { Checks, Extraction, ProcessedBill } from '../../core/types';
import { runChecks } from '../../core/checks/checks';
import { parseConfig } from '../../core/config/parseConfig';
import { piiLabel } from '../../core/shield/piiLabels';
import { updateBillFields } from '../../adapters/store';
import { toFormText, parseForm, type FieldKey } from './fields';
import { EMPTY_EXTRACTION, badgeText, badgeTone } from './labels';
import FieldInputs, { CheckMessages } from './FieldInputs';


export default function ResultPanel({ shopId, billId, result, originalUrl }: { shopId: string; billId: string; result: ProcessedBill; originalUrl: string }) {
  const [base, setBase] = useState<Extraction>(result.extraction ?? EMPTY_EXTRACTION);
  const [text, setText] = useState(() => toFormText(result.extraction ?? EMPTY_EXTRACTION));
  const [invalid, setInvalid] = useState<FieldKey[]>([]);
  const [checks, setChecks] = useState<Checks | null>(result.checks);
  const [showSent, setShowSent] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // originalUrl is a local object URL (owned by the processor hook). sentUrl (redacted copy) is created inside the
  // effect so a StrictMode re-run gets a fresh URL rather than a revoked one.
  const [sentUrl, setSentUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!result.redactedImage) return;
    const u = URL.createObjectURL(result.redactedImage);
    setSentUrl(u);
    return () => { URL.revokeObjectURL(u); setSentUrl(null); };
  }, [result.redactedImage]);
  const badge = badgeText(result.route);

  async function save() {
    if (saving) return;
    setSaveError(false);
    const parsed = parseForm(text, base);
    if (!parsed.ok) { setInvalid(parsed.invalid); return; }
    setInvalid([]);
    setSaving(true);
    try {
      const c = runChecks(parsed.value, parseConfig({}, true), new Date()).checks;
      setChecks(c);
      await updateBillFields(shopId, billId, parsed.value, c);
      setBase(parsed.value);
      setText(toFormText(parsed.value));
      setSaved(true);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }


  return (
    <div className="grid gap-4 md:grid-cols-2 mt-3">
      <div>
        <img src={showSent && sentUrl ? sentUrl : originalUrl} alt={showSent ? 'Image sent to cloud (redacted)' : 'Original bill (stays on this computer)'} className="w-full rounded border" />
        {sentUrl && <button className="text-sm underline mt-1" onClick={() => setShowSent(!showSent)}>{showSent ? 'Show original' : 'Show what the cloud saw'}</button>}
      </div>
      <div className="space-y-2">
        <span className={`inline-block px-3 py-1 rounded-full text-sm ${badgeTone(result.route)}`}>{badge}</span>
        {result.piiMasked > 0 && <p className="text-sm text-slate-600">{result.piiMasked} private number(s) hidden: {result.piiTypes.map(piiLabel).join(', ')}</p>}
        <CheckMessages checks={checks} />
        <FieldInputs text={text} invalid={invalid} checks={checks} onChange={(k, v) => { setSaved(false); setText({ ...text, [k]: v }); }} />
        <button className="px-5 py-3 rounded-lg bg-emerald-700 text-white" onClick={save} disabled={saving}>{saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}</button>
        {saveError && <p role="alert" className="text-sm text-red-700">Could not save your changes. Check your connection and try again.</p>}
      </div>
    </div>
  );
}
