import { useEffect, useState, type DragEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Shop } from '../../adapters/store';
import { warmUpOcr } from '../../adapters/tesseractOcr';
import { useBillProcessor } from './useBillProcessor';
import AiStatusChip from './AiStatusChip';
import BillCard from './BillCard';

export default function UploadPage() {
  const { shopId } = useParams();
  const [shop, setShop] = useState<Shop | null>(null);
  const [over, setOver] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    if (!shopId) { setLoadFailed(true); return; }
    return onSnapshot(doc(db, 'shops', shopId),
      (s) => { setLoadFailed(!s.exists()); setShop(s.exists() ? ({ id: s.id, ...s.data() } as Shop) : null); },
      () => { setLoadFailed(true); setShop(null); });
  }, [shopId]);
  useEffect(() => { warmUpOcr(); }, []);
  const { bills, addFiles, retry, retrySave, resolveConsent } = useBillProcessor(shop);
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (loadFailed) return; addFiles([...e.dataTransfer.files]); };

  return (
    <div className="space-y-4">
      <Link to="/shops" className="text-sm underline">← Shops</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{shop?.shopName ?? '…'}</h1>
        <AiStatusChip />
      </div>
      {loadFailed && (
        <p role="alert" className="text-red-700">This shop could not be loaded. <Link to="/shops" className="underline">Back to shops</Link></p>
      )}
      {!loadFailed && <label onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
        className={`block border-2 border-dashed rounded-xl p-10 text-center cursor-pointer focus-within:ring-2 focus-within:ring-emerald-600 ${over ? 'border-emerald-600 bg-emerald-50' : 'border-slate-300 bg-white'}`}>
        <span className="text-lg">Drop bill photos here, or click to choose (JPEG/PNG)</span>
        <input type="file" multiple accept="image/jpeg,image/png" className="sr-only" aria-label="Choose bill photos (JPEG or PNG)"
          onChange={(e) => { if (e.target.files) addFiles([...e.target.files]); e.target.value = ''; }} />
      </label>}
      <ul className="space-y-3" aria-label="Bills">
        {bills.map((b) => <BillCard key={b.id} job={b} shopId={shopId!} onRetry={() => retry(b.id)} onRetrySave={() => retrySave(b.id)} onConsent={(r) => resolveConsent(b.id, r)} />)}
      </ul>
    </div>
  );
}
