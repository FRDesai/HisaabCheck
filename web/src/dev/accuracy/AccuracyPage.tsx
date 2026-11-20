import { useState } from 'react';
import { deviceModel, cloudModel } from '../../adapters/firebaseAi';
import { tesseractOcr } from '../../adapters/tesseractOcr';
import { canvasPainter } from '../../adapters/canvasPainter';
import { resizeImage } from '../../adapters/imageResize';
import { loadConfig } from '../../adapters/remoteConfig';
import { devicePrompt, cloudPrompt } from '../../core/extract/prompts';
import { parseExtraction } from '../../core/extract/parse';
import { runShield } from '../../core/shield/shield';
import { planRedaction } from '../../core/redact/planRedaction';
import { compareFields, type Truth } from '../../core/accuracy/compareFields';

interface Row { file: string; deviceOk: number; deviceMs: number; cloudOk: number; cloudMs: number; piiMasked: number; piiLeft: number; uncertain: boolean }
const FIELDS = 7;

export default function AccuracyPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState('');

  async function run(files: FileList) {
    const list = [...files];
    const truthFile = list.find((f) => f.name === 'truth.json');
    if (!truthFile) { alert('Include truth.json'); return; }
    const truth: Record<string, Truth> = JSON.parse(await truthFile.text());
    const cfg = await loadConfig();
    const hasDevice = (await deviceModel.availability()) === 'available';
    const out: Row[] = [];
    for (const f of list.filter((x) => x !== truthFile && truth[x.name])) {
      setBusy(f.name);
      const img = await resizeImage(f);
      let deviceOk = 0, deviceMs = 0;
      if (hasDevice) {
        const t = performance.now();
        try { deviceOk = Object.values(compareFields(truth[f.name], parseExtraction(await deviceModel.extract(img, devicePrompt(cfg))))).filter(Boolean).length; } catch { /* counts as 0 */ }
        deviceMs = performance.now() - t;
      }
      const words = await tesseractOcr.recognize(img.blob);
      const shield = runShield(words, cfg.consentOcrThreshold);
      const plan = planRedaction(words, shield, img.width, img.height);
      const redacted = await canvasPainter.paint(img.blob, plan.boxes);
      const t2 = performance.now();
      let cloudOk = 0;
      try { cloudOk = Object.values(compareFields(truth[f.name], parseExtraction(await cloudModel.extract({ ...img, blob: redacted }, cloudPrompt(cfg), cfg.cloudModel)))).filter(Boolean).length; } catch { /* 0 */ }
      const cloudMs = performance.now() - t2;
      const piiLeft = runShield(await tesseractOcr.recognize(redacted), cfg.consentOcrThreshold).matches.length;
      out.push({ file: f.name, deviceOk, deviceMs, cloudOk, cloudMs, piiMasked: plan.piiMasked, piiLeft, uncertain: shield.uncertain });
      setRows([...out]);
    }
    setBusy('');
  }

  function downloadCsv() {
    const head = 'file,device_fields_ok,device_ms,cloud_fields_ok,cloud_ms,pii_masked,pii_left,uncertain';
    const body = rows.map((r) => [r.file, r.deviceOk, r.deviceMs.toFixed(0), r.cloudOk, r.cloudMs.toFixed(0), r.piiMasked, r.piiLeft, r.uncertain].join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([[head, ...body].join('\n')], { type: 'text/csv' }));
    a.download = 'accuracy.csv';
    a.click();
  }

  const n = rows.length || 1;
  const pct = (k: 'deviceOk' | 'cloudOk') => ((rows.reduce((s, r) => s + r[k], 0) / (n * FIELDS)) * 100).toFixed(1);
  const leaks = rows.reduce((s, r) => s + r.piiLeft, 0);
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Accuracy & leak check (dev only)</h1>
      <input type="file" multiple accept="image/*,application/json" aria-label="Bills and truth.json" onChange={(e) => e.target.files && run(e.target.files)} />
      {busy && <p>Processing {busy}…</p>}
      <p>Device field accuracy: {pct('deviceOk')}% · Cloud field accuracy: {pct('cloudOk')}% ·{' '}
        <span className={leaks ? 'text-red-600 font-bold' : 'text-green-700 font-bold'}>PII left after redaction: {leaks}</span></p>
      <button className="px-4 py-2 rounded bg-slate-800 text-white" onClick={downloadCsv} disabled={!rows.length}>Download CSV</button>
      <table className="text-sm"><tbody>
        {rows.map((r) => <tr key={r.file} className={r.piiLeft ? 'bg-red-100' : ''}>
          <td className="pr-4">{r.file}</td><td className="pr-4">dev {r.deviceOk}/{FIELDS}</td><td className="pr-4">cloud {r.cloudOk}/{FIELDS}</td>
          <td className="pr-4">masked {r.piiMasked}</td><td>{r.uncertain ? 'unsure' : ''}</td></tr>)}
      </tbody></table>
    </div>
  );
}
