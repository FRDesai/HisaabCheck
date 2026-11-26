import { useState } from 'react';
import { signOutAndClear } from '../../session';

/** Every sign-out button is this component, so each one asks before throwing away changes that were not sent. */
export default function SignOutControl({ label = 'Sign out', className }: { label?: string; className: string }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  async function click() {
    if (busy) return;
    setBusy(true);
    const r = await signOutAndClear();
    if (r === 'pending') { setConfirming(true); setBusy(false); }
  }
  return (
    <>
      <button className={className} disabled={busy} onClick={() => void click()}>{label}</button>
      {confirming && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="signout-msg" className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="bg-white rounded-lg border p-6 max-w-md space-y-4 text-left">
            <p id="signout-msg">Some changes have not been sent yet because you are offline. If you sign out now they will be lost.</p>
            <div className="flex gap-3">
              <button autoFocus className="px-4 py-2 rounded-lg bg-emerald-700 text-white" onClick={() => setConfirming(false)}>Stay signed in</button>
              <button className="px-4 py-2 rounded-lg border" onClick={() => { setConfirming(false); void signOutAndClear(true); }}>Sign out anyway</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
