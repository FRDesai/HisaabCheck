import { useEffect, useState } from 'react';
import { billImageUrl } from '../../adapters/store';

/** The stored bill photo. Only the redacted copy is ever stored, and only for shops that opted in. */
export default function BillPhoto({ imagePath }: { imagePath: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUrl(null); setFailed(false);
    if (!imagePath) return;
    let alive = true;
    billImageUrl(imagePath).then((u) => { if (alive) setUrl(u); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [imagePath]);

  if (!imagePath) {
    return <p className="p-6 bg-white rounded border text-slate-600">No photo stored. This shop keeps bill data only — check against the paper bill.</p>;
  }
  if (failed) return <p role="alert" className="p-6 bg-white rounded border text-red-700">The stored photo could not be loaded. Check against the paper bill.</p>;
  if (!url) return <p role="status" className="p-6 bg-white rounded border text-slate-600">Loading photo…</p>;
  return (
    <figure>
      <img src={url} alt="Stored bill photo with private numbers blacked out" className="w-full rounded border" onError={() => setFailed(true)} />
      <figcaption className="text-xs text-slate-600 mt-1">Stored copy. Private numbers were blacked out before it left the device.</figcaption>
    </figure>
  );
}
