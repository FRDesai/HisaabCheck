import { useRef, useState } from 'react';
import { deviceModel, cloudModel } from '../../adapters/firebaseAi';
import { tesseractOcr } from '../../adapters/tesseractOcr';
import { canvasPainter } from '../../adapters/canvasPainter';
import { resizeImage } from '../../adapters/imageResize';
import { loadConfig } from '../../adapters/remoteConfig';
import { devicePrompt, cloudPrompt } from '../../core/extract/prompts';
import { parseExtraction } from '../../core/extract/parse';
import { runShield } from '../../core/shield/shield';
import { ocrAdequate } from '../../core/shield/adequacy';
import { planRedaction } from '../../core/redact/planRedaction';
import { compareFields, type Truth } from '../../core/accuracy/compareFields';
import { summarize, type AccuracyRow, type Selection } from '../../core/accuracy/summary';

const FIELDS = 7;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const csvCell = (v: string | number | boolean | null) => (v === null ? '' : `"${String(v).replace(/"/g, '""')}"`);

export default function AccuracyPage() {
  const [rows, setRows] = useState<AccuracyRow[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  // Off by default: unsure bills would get a human preview in the app, and this tool has none.
  const [sendUnsure, setSendUnsure] = useState(false);
  const running = useRef(false);

  async function run(files: FileList, includeUnsure: boolean) {
    if (running.current) { setMessage('A run is already in progress.'); return; }
    running.current = true;
    setMessage('');
    try {
      const list = [...files];
      const truthFile = list.find((f) => f.name === 'truth.json');
      if (!truthFile) { setMessage('Include truth.json in the selection.'); return; }
      let truth: Record<string, Truth>;
      try {
        const parsed: unknown = JSON.parse(await truthFile.text());
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('top level must be an object');
        truth = parsed as Record<string, Truth>;
      } catch (e) { setMessage(`truth.json is malformed: ${errMsg(e)}`); return; }
      const images = list.filter((x) => x !== truthFile);
      const toScore = images.filter((x) => truth[x.name]);
      const names = new Set(images.map((x) => x.name));
      const sel: Selection = {
        scored: toScore.length,
        skippedNoTruth: images.filter((x) => !truth[x.name]).map((x) => x.name),
        truthWithoutFile: Object.keys(truth).filter((k) => !names.has(k)),
      };
      setSelection(sel);
      setRows([]);
      const cfg = await loadConfig();
      const hasDevice = (await deviceModel.availability()) === 'available';
      const out: AccuracyRow[] = [];
      for (const f of toScore) {
        setBusy(f.name);
        const row: AccuracyRow = { file: f.name, status: 'ok', deviceOk: null, deviceMs: null, cloudOk: null, cloudMs: null, piiMasked: 0, piiLeft: null, uncertain: false, cloudSkipped: false };
        const notes: string[] = [];
        try {
          const img = await resizeImage(f);
          if (hasDevice) {
            const t = performance.now();
            try { row.deviceOk = Object.values(compareFields(truth[f.name], parseExtraction(await deviceModel.extract(img, devicePrompt(cfg))))).filter(Boolean).length; }
            catch (e) { notes.push(`device: ${errMsg(e)}`); }
            row.deviceMs = row.deviceOk === null ? null : performance.now() - t;
          }
          const words = await tesseractOcr.recognize(img.blob);
          const shield = runShield(words, cfg.consentOcrThreshold);
          const plan = planRedaction(words, shield, img.width, img.height);
          row.piiMasked = plan.piiMasked;
          // Same rule as the app: an unsure shield OR too little OCR text would need a human preview.
          row.uncertain = shield.uncertain || !ocrAdequate(words);
          const redacted = await canvasPainter.paint(img.blob, plan.boxes);
          if (redacted === img.blob) throw new Error('painter returned the original image');
          if (row.uncertain && !includeUnsure) {
            row.cloudSkipped = true; // no preview here, so do not send it
          } else {
            const t2 = performance.now();
            try { row.cloudOk = Object.values(compareFields(truth[f.name], parseExtraction(await cloudModel.extract({ ...img, blob: redacted }, cloudPrompt(cfg), cfg.cloudModel)))).filter(Boolean).length; }
            catch (e) { notes.push(`cloud: ${errMsg(e)}`); }
            row.cloudMs = row.cloudOk === null ? null : performance.now() - t2;
          }
          row.piiLeft = runShield(await tesseractOcr.recognize(redacted), cfg.consentOcrThreshold).matches.length;
        } catch (e) {
          row.status = 'error';
          row.piiLeft = null;
          notes.push(errMsg(e));
        }
        if (notes.length) row.error = notes.join('; ');
        out.push(row);
        setRows([...out]);
      }
    } catch (e) {
      setMessage(`Run aborted: ${errMsg(e)}`);
    } finally {
      setBusy('');
      running.current = false;
    }
  }

  function downloadCsv() {
    const head = 'file,status,error,device_fields_ok,device_ms,cloud_fields_ok,cloud_ms,cloud_skipped,pii_masked,pii_left,uncertain';
    const body = rows.map((r) => [csvCell(r.file), r.status, csvCell(r.error ?? ''), r.deviceOk ?? '', r.deviceMs === null ? '' : r.deviceMs.toFixed(0), r.cloudOk ?? '', r.cloudMs === null ? '' : r.cloudMs.toFixed(0), r.cloudSkipped, r.piiMasked, r.piiLeft ?? '', r.uncertain].join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([[head, ...body].join('\n')], { type: 'text/csv' }));
    a.download = 'accuracy.csv';
    a.click();
  }

  const sum = summarize(rows, FIELDS, selection ?? { scored: 0, skippedNoTruth: [], truthWithoutFile: [] });
  const fmt = (p: number | null, bills: number, why: string) => (p === null ? `n/a (${why})` : `${p.toFixed(1)}% (${bills} bills)`);
  const leakDone = sum.leakChecked === sum.total && sum.total > 0;
  const leakClass = !sum.total ? 'text-slate-600' : leakDone && sum.leakTotal === 0 ? 'text-green-700 font-bold' : sum.leakTotal > 0 ? 'text-red-600 font-bold' : 'text-amber-600 font-bold';
  const leakText = !sum.total && !busy ? 'PII left after redaction: not run yet'
    : `PII left after redaction: ${sum.leakTotal} in ${sum.leakedBills} of ${sum.leakChecked} bills checked (of ${sum.total} processed)${leakDone ? '' : ' - NOT ALL BILLS WERE CHECKED'}`;
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Accuracy & leak check (dev only)</h1>
      <input type="file" multiple accept="image/*,application/json" aria-label="Bills and truth.json" disabled={!!busy} onChange={(e) => e.target.files && run(e.target.files, sendUnsure)} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={sendUnsure} disabled={!!busy} onChange={(e) => setSendUnsure(e.target.checked)} />
        Also send unsure bills to the cloud (redacted, no preview)
      </label>
      {message && <p role="alert" className="text-red-600">{message}</p>}
      {busy && <p>Processing {busy}…</p>}
      {selection && <div className="text-sm">
        <p>{selection.scored} bills scored, {selection.skippedNoTruth.length} skipped (no truth entry), {selection.truthWithoutFile.length} truth entries with no file</p>
        {selection.skippedNoTruth.length > 0 && <p>Skipped: {selection.skippedNoTruth.join(', ')}</p>}
        {selection.truthWithoutFile.length > 0 && <p>Truth without file: {selection.truthWithoutFile.join(', ')}</p>}
      </div>}
      <p>Device field accuracy: {fmt(sum.devicePct, sum.deviceBills, 'on-device model not available')} · Cloud field accuracy: {fmt(sum.cloudPct, sum.cloudBills, 'no cloud reads succeeded')}</p>
      <p>Failed bills: {sum.failed} · Unsure: {sum.unsure} · Cloud read skipped (unsure): {sum.cloudSkipped}</p>
      <p className={leakClass}>{leakText}</p>
      <button className="px-4 py-2 rounded bg-slate-800 text-white" onClick={downloadCsv} disabled={!rows.length}>Download CSV</button>
      <table className="text-sm"><tbody>
        {rows.map((r) => <tr key={r.file} className={r.piiLeft ? 'bg-red-100' : r.status === 'error' ? 'bg-amber-100' : ''}>
          <td className="pr-4">{r.file}</td><td className="pr-4">dev {r.deviceOk === null ? '-' : `${r.deviceOk}/${FIELDS}`}</td><td className="pr-4">cloud {r.cloudSkipped ? 'skipped (unsure)' : r.cloudOk === null ? '-' : `${r.cloudOk}/${FIELDS}`}</td>
          <td className="pr-4">masked {r.piiMasked}</td><td className="pr-4">leak {r.piiLeft === null ? 'unchecked' : r.piiLeft}</td><td className="pr-4">{r.uncertain ? 'unsure' : ''}</td><td>{r.error ?? ''}</td></tr>)}
      </tbody></table>
    </div>
  );
}
