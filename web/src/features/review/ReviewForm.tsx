import { useEffect, useMemo, useRef, useState } from 'react';
import { approveBill, rejectBill, reopenBill, saveReviewFields } from '../../adapters/store';
import { runChecks } from '../../core/checks/checks';
import { parseConfig } from '../../core/config/parseConfig';
import type { BillDoc } from '../../core/review/billDoc';
import { allowedActions, approvalBlockers, confirmationItems, REJECT_NOTE_MAX, validRejectNote, type ConfirmItem } from '../../core/review/decision';
import type { BillStatus, Extraction } from '../../core/types';
import FieldInputs, { CheckMessages } from '../result/FieldInputs';
import { parseForm, toFormText, type FieldKey } from '../result/fields';
import { badgeText, badgeTone, CHECK_MSG, CONFIRM_MSG } from '../result/labels';

const STATUS_LABEL: Record<BillStatus, string> = { draft: 'To review', manual_entry: 'Manual entry — fill in the fields', approved: 'Approved', rejected: 'Rejected' };
type Busy = 'save' | 'approve' | 'reject' | 'reopen' | null;

/** Mounted once per bill id (the page passes key={bill.id}); `bill` keeps updating from the live listener. */
export default function ReviewForm({ shopId, bill, uid, onReviewed }: { shopId: string; bill: BillDoc; uid: string; onReviewed(): void }) {
  const [base, setBase] = useState<Extraction>(bill.extraction);
  const [text, setText] = useState(() => toFormText(bill.extraction));
  const [dirty, setDirty] = useState(false);
  const [dropItems, setDropItems] = useState(false);
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null); // the soft-check set the CA ticked for
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [elsewhere, setElsewhere] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);

  // The listener also fires for our own writes; ownWrite tells those apart from a change made elsewhere.
  // After a refused write the rollback snapshot can land late, so a failed write keeps ownWrite set for a moment (writeSeq guards newer writes).
  const ownWrite = useRef(false);
  const writeSeq = useRef(0);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A write can finish after the CA has left this bill (offline, then back online): it must not navigate or set state then.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(slowTimer.current); }; }, []);
  const incoming = JSON.stringify(bill.extraction);
  const seen = useRef(incoming);
  const seenStatus = useRef(bill.status);
  useEffect(() => {
    const fieldsChanged = incoming !== seen.current;
    const statusChanged = bill.status !== seenStatus.current;
    if (!fieldsChanged && !statusChanged) return;
    seen.current = incoming; seenStatus.current = bill.status;
    if (ownWrite.current) return;
    if (!allowedActions(bill.status).includes('edit')) {
      if (!statusChanged) return;
      // Approved or rejected elsewhere: show exactly the stored values beside the new status.
      setBase(bill.extraction); setText(toFormText(bill.extraction)); setDirty(false); setDropItems(false); setConfirmedKey(null); setRejecting(false);
      setElsewhere(`This bill was ${bill.status === 'approved' ? 'approved' : 'rejected'} somewhere else.${dirty ? ' Your unsaved edits were not saved.' : ''}`);
      return;
    }
    if (dirty) { setElsewhere('This bill was changed somewhere else. Your unsaved edits are still here; saving will replace the other changes.'); return; }
    setBase(bill.extraction); setText(toFormText(bill.extraction));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the stored fields or status change; dirty is read, not watched
  }, [incoming, bill.status]);

  const can = allowedActions(bill.status);
  const editable = can.includes('edit');
  const items = dropItems ? undefined : base.items;

  // Checks follow the form live, so red marks clear as the CA fixes a field.
  const parsed = useMemo(() => {
    const p = parseForm(text, base);
    if (!p.ok) return p;
    const value: Extraction = { ...p.value };
    if (dropItems) { delete value.items; delete value.itemCount; }
    return { ok: true as const, value, checks: runChecks(value, parseConfig({}, true), new Date()).checks };
  }, [text, base, dropItems]);
  const invalid: FieldKey[] = parsed.ok ? [] : parsed.invalid;
  const checks = !editable ? bill.checks : parsed.ok ? parsed.checks : null;
  const blockers = parsed.ok ? approvalBlockers(parsed.checks) : [];
  const soft: ConfirmItem[] = parsed.ok ? confirmationItems(parsed.checks, parsed.value) : [];
  const softKey = soft.join(',');
  const confirmed = softKey !== '' && confirmedKey === softKey;
  // A tick covers exactly the failures listed when it was made; any other set needs a fresh tick.
  useEffect(() => { if (confirmedKey !== null && confirmedKey !== softKey) setConfirmedKey(null); }, [softKey, confirmedKey]);
  const canApprove = parsed.ok && blockers.length === 0 && (soft.length === 0 || confirmed) && busy === null;

  async function run(kind: Exclude<Busy, null>, write: () => Promise<void>, after: () => void) {
    if (busy) return;
    setBusy(kind); setError(null); setSaved(false); setElsewhere(null);
    const seq = ++writeSeq.current;
    ownWrite.current = true;
    // The server acknowledges only when online; say so if it takes long.
    clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => setSlow(true), 4000);
    let failed = false;
    try { await write(); if (mounted.current) after(); }
    catch { failed = true; if (mounted.current) setError('Could not save. Check your connection and try again. Your changes are still here.'); }
    finally {
      clearTimeout(slowTimer.current);
      if (mounted.current) { setSlow(false); setBusy(null); }
      if (failed) setTimeout(() => { if (writeSeq.current === seq) ownWrite.current = false; }, 1500);
      else ownWrite.current = false;
    }
  }

  const save = () => { if (!parsed.ok) return; const p = parsed;
    void run('save', () => saveReviewFields(shopId, bill.id, p.value, p.checks), () => {
      setBase(p.value); setText(toFormText(p.value)); setDirty(false); setDropItems(false); setElsewhere(null); setSaved(true);
    }); };
  const approve = () => { if (!parsed.ok || !canApprove) return; const p = parsed;
    void run('approve', () => approveBill(shopId, bill.id, uid, p.value, p.checks, soft), onReviewed); };
  const reject = () => { if (!validRejectNote(note)) return;
    void run('reject', () => rejectBill(shopId, bill.id, uid, note), onReviewed); };
  const reopen = () => { void run('reopen', () => reopenBill(shopId, bill.id), () => { setRejecting(false); setNote(''); setConfirmedKey(null); }); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-block px-3 py-1 rounded-full text-sm ${badgeTone(bill.route)}`}>{badgeText(bill.route)}</span>
        <span className="inline-block px-3 py-1 rounded-full text-sm bg-slate-200">{STATUS_LABEL[bill.status]}</span>
      </div>
      {bill.status === 'rejected' && bill.rejectNote && <p className="p-3 rounded bg-red-50 text-red-900 text-sm">Note to the client: {bill.rejectNote}</p>}
      {bill.status === 'approved' && bill.approvedWithFailedChecks.length > 0 && (
        <p className="p-3 rounded bg-amber-50 text-amber-900 text-sm">Approved after checking against the paper copy, with: {bill.approvedWithFailedChecks.map((k) => CONFIRM_MSG[k as ConfirmItem] ?? k).join('; ')}</p>
      )}
      {elsewhere && <p role="status" className="p-3 rounded bg-amber-50 text-amber-900 text-sm">{elsewhere}</p>}

      <CheckMessages checks={checks} />
      {editable && soft.includes('taxable') && <p className="text-red-700 text-sm">⚠ {CONFIRM_MSG.taxable}</p>}
      <FieldInputs text={text} invalid={invalid} checks={checks} disabled={!editable || busy !== null}
        onChange={(k, v) => { setSaved(false); setDirty(true); setText({ ...text, [k]: v }); }} />

      {base.items && base.items.length > 0 && (
        <div className="text-sm">
          <table className="w-full bg-white border rounded">
            <caption className="text-left font-medium p-2">Line items read from the bill ({base.items.length})</caption>
            <thead className="text-left text-slate-600 border-b"><tr>
              <th scope="col" className="p-2">Description</th><th scope="col" className="p-2">HSN</th><th scope="col" className="p-2 text-right">Qty</th>
              <th scope="col" className="p-2 text-right">Rate</th><th scope="col" className="p-2 text-right">Amount</th></tr></thead>
            <tbody className={dropItems ? 'line-through text-slate-400' : ''}>
              {base.items.map((it, i) => <tr key={i} className="border-b last:border-0"><td className="p-2">{it.description}</td><td className="p-2">{it.hsn}</td>
                <td className="p-2 text-right tabular-nums">{it.qty}</td><td className="p-2 text-right tabular-nums">{it.rate}</td><td className="p-2 text-right tabular-nums">{it.amount}</td></tr>)}
            </tbody>
          </table>
          {editable && (
            <label className="flex items-center gap-2 mt-2">
              <input type="checkbox" checked={dropItems} disabled={busy !== null} onChange={(e) => { setDropItems(e.target.checked); setDirty(true); setSaved(false); }} />
              Ignore line items (check taxable value + tax = total instead)
            </label>
          )}
        </div>
      )}
      {items === undefined && base.items && <p className="text-xs text-slate-600">Line items will be removed from this bill when you save or approve.</p>}

      {editable && (
        <div className="space-y-3 pt-2">
          {blockers.length > 0 && <p role="alert" className="text-sm text-red-700">Cannot approve yet: {blockers.map((k) => CHECK_MSG[k]).join('; ')}.</p>}
          {!parsed.ok && <p role="alert" className="text-sm text-red-700">Fix the fields marked in red before saving or approving.</p>}
          {soft.length > 0 && blockers.length === 0 && (
            <label className="flex items-start gap-2 text-sm p-3 rounded bg-amber-50">
              <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmedKey(e.target.checked ? softKey : null)} />
              <span>I have checked this bill against the paper copy. ({soft.map((k) => CONFIRM_MSG[k]).join('; ')})</span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="px-5 py-3 rounded-lg bg-emerald-700 text-white disabled:opacity-50" disabled={!canApprove} onClick={approve}>{busy === 'approve' ? 'Approving…' : 'Approve'}</button>
            <button type="button" className="px-5 py-3 rounded-lg border border-red-700 text-red-800 disabled:opacity-50" disabled={busy !== null} aria-expanded={rejecting} onClick={() => setRejecting(!rejecting)}>Reject…</button>
            <button type="button" className="px-5 py-3 rounded-lg border disabled:opacity-50" disabled={!parsed.ok || busy !== null} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save changes'}</button>
          </div>
          {rejecting && (
            <div className="p-3 rounded border border-red-200 bg-red-50 space-y-2">
              <label className="block text-sm">Note to the client (why is this bill rejected?)
                <textarea className="mt-1 w-full border rounded p-2" rows={3} maxLength={REJECT_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <p className="text-xs text-slate-600">{note.trim().length}/{REJECT_NOTE_MAX}</p>
              <button type="button" className="px-5 py-3 rounded-lg bg-red-700 text-white disabled:opacity-50" disabled={!validRejectNote(note) || busy !== null} onClick={reject}>{busy === 'reject' ? 'Rejecting…' : 'Reject bill'}</button>
            </div>
          )}
        </div>
      )}
      {can.includes('reopen') && (
        <button type="button" className="px-5 py-3 rounded-lg border disabled:opacity-50" disabled={busy !== null} onClick={reopen}>{busy === 'reopen' ? 'Reopening…' : 'Reopen for changes'}</button>
      )}
      {slow && <p role="status" className="text-sm text-amber-900">Still saving — waiting for the connection. Your change is kept on this computer and will be sent when you are back online.</p>}
      {saved && <p role="status" className="text-sm text-emerald-800">Saved ✓</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
