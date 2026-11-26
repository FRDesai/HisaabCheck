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
  // The shop's newest bills; null until the list has loaded, or after it failed.
  const queue = useRef<BillDoc[] | null>(null);

  useEffect(() => {
    setBill(undefined); setFailed(false);
    if (!shopId || !billId) { setFailed(true); return; }
    return watchBill(shopId, billId, (b) => { setBill(b); setFailed(false); }, () => setFailed(true));
  }, [shopId, billId]);

  // The shop's bill list, only to know which bill comes next. A failure here just ends the run at the inbox.
  useEffect(() => {
    queue.current = null;
    if (!shopId) return;
    return watchBills(shopId, BILL_PAGE, (b) => { queue.current = b; }, () => { queue.current = null; });
  }, [shopId]);

  const inbox = `/shops/${shopId}/bills`;
  function onReviewed() {
    const list = queue.current;
    const next = list && billId ? nextToReview(list, billId) : null;
    if (next) navigate(`${inbox}/${next}`);
    // "All bills reviewed" only when the whole list is known: loaded, and shorter than the page limit.
    else if (list && list.length < BILL_PAGE) navigate(inbox, { state: { notice: 'All bills reviewed.' } });
    else navigate(inbox);
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
