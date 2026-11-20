import type { BillJob } from './useBillProcessor';
import ResultPanel from '../result/ResultPanel';
import ConsentPreview from '../preview/ConsentPreview';
import type { ConsentResult, Step } from '../../core/types';

const STEPS: Array<[Step, string]> = [['availability', 'Checking device AI'], ['device_read', 'Reading on device'], ['checking', 'Checking maths'],
  ['redacting', 'Hiding private numbers'], ['awaiting_consent', 'Waiting for you'], ['cloud_read', 'Reading in cloud'], ['done', 'Saved']];

export default function BillCard({ job, shopId, onRetry, onRetrySave, onConsent }: { job: BillJob; shopId: string; onRetry(): void; onRetrySave(): void; onConsent(r: ConsentResult): void }) {
  const current = STEPS.findIndex(([s]) => s === job.step);
  const active = job.step !== 'done' && job.step !== 'error';
  return (
    <li className="bg-white rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{job.file.name}</span>
        {job.step === 'error' && <button className="text-sm underline" onClick={onRetry} aria-label={`Retry ${job.file.name}`}>Retry</button>}
        {job.result?.route.reason === 'cloud_error' && <button className="text-sm underline" onClick={onRetry} aria-label={`Retry cloud read for ${job.file.name}`}>Retry cloud</button>}
      </div>
      {active && (
        <>
          <p className="text-sm mt-2" aria-live="polite" role="status">
            {job.step === 'queued' ? 'Queued' : `Step: ${STEPS[current]?.[1] ?? ''}`}
          </p>
          <ol className="flex flex-wrap gap-2 mt-2 text-xs" aria-label={`Progress for ${job.file.name}`}>
            {STEPS.map(([s, label], i) => <li key={s} aria-current={i === current ? 'step' : undefined} className={i === current ? 'font-bold text-emerald-800' : i < current ? 'text-slate-400 line-through' : 'text-slate-400'}>{label}</li>)}
          </ol>
        </>
      )}
      {job.error && <p role="alert" className="text-red-700 text-sm mt-2">Something went wrong: {job.error}. The photo is still here — try again.</p>}
      {job.consent && <ConsentPreview redacted={job.consent.redacted} onDone={onConsent} />}
      {job.billId && job.sync && (
        <div className="mt-2 text-sm">
          {job.sync === 'pending' && <p role="status" className="text-slate-600">Will sync when online</p>}
          {job.sync === 'saved' && <p role="status" className="text-emerald-800">Saved</p>}
          {job.sync === 'failed' && <div role="alert" className="text-red-700">Not saved — check your connection and retry{' '}
            <button className="underline" onClick={onRetrySave} aria-label={`Retry save for ${job.file.name}`}>Retry save</button></div>}
          {job.photo === 'failed' && <p role="status" className="text-amber-800">Photo not stored</p>}
        </div>
      )}
      {job.result && job.billId && <ResultPanel shopId={shopId} billId={job.billId} result={job.result} originalUrl={job.originalUrl} />}
    </li>
  );
}
