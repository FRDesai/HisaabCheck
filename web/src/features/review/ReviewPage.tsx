import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BILL_PAGE, watchBill, watchBills } from '../../adapters/store';
import type { BillDoc } from '../../core/review/billDoc';
import { nextToReview } from '../../core/review/filters';
import { useAuth } from '../auth/AuthProvider';
import BillPhoto from './BillPhoto';
import ReviewForm from './ReviewForm';

export default function ReviewPage() {
  const { shopId, billId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  // undefined = still loading, null = no such bill
  const [bill, setBill] = useState<BillDoc | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const queue = useRef<BillDoc[]>([]);

  useEffect(() => {
    setBill(undefined); setFailed(false);
    if (!shopId || !billId) { setFailed(true); return; }
    return watchBill(shopId, billId, (b) => { setBill(b); setFailed(false); }, () => setFailed(true));
  }, [shopId, billId]);

  // The shop's bill list, only to know which bill comes next. A failure here just ends the run at the inbox.
  useEffect(() => {
    if (!shopId) return;
    return watchBills(shopId, BILL_PAGE, (b) => { queue.current = b; }, () => { queue.current = []; });
  }, [shopId]);

  const inbox = `/shops/${shopId}/bills`;
  function onReviewed() {
    const next = billId ? nextToReview(queue.current, billId) : null;
    if (next) navigate(`${inbox}/${next}`);
    else navigate(inbox, { state: { notice: 'All bills reviewed.' } });
  }

  return (
    <div className="space-y-4">
      <Link to={inbox} className="text-sm underline">← Bills</Link>
      <h1 className="text-2xl font-bold">Review bill</h1>
      {failed && <p role="alert" className="text-red-700">This bill could not be loaded. <Link to={inbox} className="underline">Back to bills</Link></p>}
      {!failed && bill === undefined && <p role="status" className="text-slate-600">Loading bill…</p>}
      {!failed && bill === null && <p role="alert" className="text-red-700">This bill does not exist. <Link to={inbox} className="underline">Back to bills</Link></p>}
      {!failed && bill && user && (
        <div className="grid gap-6 md:grid-cols-2">
          <BillPhoto imagePath={bill.imagePath} />
          <ReviewForm key={bill.id} shopId={shopId!} bill={bill} uid={user.uid} onReviewed={onReviewed} />
        </div>
      )}
    </div>
  );
}
