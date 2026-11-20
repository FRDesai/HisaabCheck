import { useEffect, useState } from 'react';
import { deviceModel } from '../../adapters/firebaseAi';
import type { Availability } from '../../core/types';

const LABEL: Record<Availability, string> = {
  available: 'On-device AI ready', downloadable: 'On-device AI not downloaded', downloading: 'Downloading on-device AI…',
  unavailable: 'No on-device AI on this computer — cloud with redaction',
};

export default function AiStatusChip() {
  const [a, setA] = useState<Availability | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { deviceModel.availability().then(setA, () => setA('unavailable')); }, []);
  return (
    <div className="flex items-center gap-3">
      <span role="status" className={`px-3 py-1 rounded-full text-sm ${a === 'available' ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>
        {a ? LABEL[a] : 'Checking on-device AI…'}{progress !== null && progress < 1 && a === 'downloading' ? ` ${Math.round(progress * 100)}%` : ''}
      </span>
      {a === 'downloadable' && (
        <button className="px-3 py-1 rounded border text-sm" onClick={async () => {
          setErr(false);
          setA('downloading');
          try { await deviceModel.download(setProgress); } catch { setErr(true); }
          setA(await deviceModel.availability().catch(() => 'unavailable' as const));
        }}>Download on-device AI</button>
      )}
      {err && <span role="alert" className="text-sm text-red-700">Download failed. Try again.</span>}
    </div>
  );
}
