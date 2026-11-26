import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { countToReview, createInvite, createShop, watchShops, type Shop } from '../../adapters/store';
import { isValidGstin } from '../../core/shield/gstin';

export default function ShopsPage() {
  const { user } = useAuth();
  const [shops, setShops] = useState<Shop[]>([]);
  const [form, setForm] = useState({ shopName: '', gstin: '', state: '', storeImages: false });
  useEffect(() => watchShops(user!.uid, setShops), [user]);
  const [toReview, setToReview] = useState<Record<string, number>>({});
  const shopIds = shops.map((s) => s.id).join(',');
  useEffect(() => {
    let alive = true;
    for (const id of shopIds ? shopIds.split(',') : []) {
      // A failed count (offline, rules) just shows no number.
      countToReview(id).then((n) => { if (alive) setToReview((t) => ({ ...t, [id]: n })); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [shopIds]);
  const [inviteError, setInviteError] = useState<Record<string, string>>({});
  const [inviteBusy, setInviteBusy] = useState<Record<string, boolean>>({});
  async function invite(s: Shop) {
    if (inviteBusy[s.id]) return;
    setInviteBusy((b) => ({ ...b, [s.id]: true }));
    setInviteError((e) => ({ ...e, [s.id]: '' }));
    try { await createInvite(s, user!.uid); }
    catch { setInviteError((e) => ({ ...e, [s.id]: 'Could not create the invite code. Please try again.' })); }
    finally { setInviteBusy((b) => ({ ...b, [s.id]: false })); }
  }
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gstinOk = form.gstin === '' || isValidGstin(form.gstin.toUpperCase());

  function add(e: FormEvent) {
    e.preventDefault();
    if (!form.shopName || !gstinOk || submitting) return;
    setSubmitting(true); setError(null);
    const pending = createShop(user!.uid, { ...form, gstin: form.gstin.toUpperCase() });
    setForm({ shopName: '', gstin: '', state: '', storeImages: false }); // do not wait for the server ack
    pending.catch(() => setError('Could not add the shop. Please try again.')).finally(() => setSubmitting(false));
  }

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section>
        <h1 className="text-2xl font-bold mb-4">Client shops</h1>
        {shops.length === 0 && <p className="text-slate-600">No shops yet. Add your first client.</p>}
        <ul className="space-y-2">
          {shops.map((s) => (
            <li key={s.id} className="p-4 bg-white rounded-lg border flex flex-wrap items-center gap-3">
              <div className="mr-auto"><span className="font-semibold">{s.shopName}</span> <span className="text-slate-500 text-sm">{s.gstin}</span></div>
              <Link className="px-3 py-1.5 rounded border hover:border-emerald-600" to={`/shops/${s.id}/bills`}>
                Bills{toReview[s.id] !== undefined && <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${toReview[s.id] > 0 ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{toReview[s.id]} to review</span>}
              </Link>
              <Link className="px-3 py-1.5 rounded border hover:border-emerald-600" to={`/shops/${s.id}/upload`}>Upload</Link>
              <div className="w-full text-sm">
                {s.ownerUid ? <span className="text-emerald-800">Owner linked</span>
                  : s.inviteCode ? (
                    <div>
                      <span id={`invite-${s.id}`} className="text-slate-600">Invite code for the owner's phone</span>
                      <div aria-labelledby={`invite-${s.id}`} role="group" className="mt-1 inline-block ml-2 px-3 py-1 rounded border bg-slate-50 font-mono text-base tracking-widest select-all">{s.inviteCode}</div>
                      <p className="text-slate-600 mt-1">This code works for 7 days.</p>
                      <button type="button" disabled={inviteBusy[s.id]} onClick={() => void invite(s)} className="mt-1 px-3 py-1.5 rounded border hover:border-emerald-600 disabled:opacity-60">New code</button>
                    </div>
                  ) : <button type="button" disabled={inviteBusy[s.id]} onClick={() => void invite(s)} className="px-3 py-1.5 rounded border hover:border-emerald-600 disabled:opacity-60">Invite owner</button>}
                {inviteError[s.id] && <p role="alert" className="text-red-700 mt-1">{inviteError[s.id]}</p>}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <form onSubmit={add} className="bg-white p-6 rounded-lg border space-y-3">
        <h2 className="text-lg font-semibold">Add client shop</h2>
        <label className="block">Shop name<input required className="mt-1 w-full border rounded p-2" value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} /></label>
        <label className="block">GSTIN<input className={`mt-1 w-full border rounded p-2 ${gstinOk ? '' : 'border-red-600'}`} value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} aria-invalid={!gstinOk} aria-describedby={gstinOk ? undefined : 'gstin-error'} /></label>
        {!gstinOk && <p id="gstin-error" className="text-red-700 text-sm">This GSTIN fails the format or checksum check.</p>}
        <label className="block">State<input className="mt-1 w-full border rounded p-2" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.storeImages} onChange={(e) => setForm({ ...form, storeImages: e.target.checked })} />
          Store redacted bill photos (off by default)</label>
        {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
        <button disabled={submitting} className="px-5 py-3 rounded-lg bg-emerald-700 text-white disabled:opacity-60">Add shop</button>
      </form>
    </div>
  );
}
