import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Box, ConsentResult } from '../../core/types';
import { canvasPainter } from '../../adapters/canvasPainter';
import { normBox, pointToImage, boxToPercent, bottomThird } from './boxes';

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Shows ONLY the redacted image. Extra boxes are painted onto that redacted image and returned; the original is never available here.
export default function ConsentPreview({ redacted, onDone }: { redacted: Blob; onDone(r: ConsentResult): void }) {
  const url = useMemo(() => URL.createObjectURL(redacted), [redacted]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const imgRef = useRef<HTMLImageElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [drag, setDrag] = useState<Box | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [nat, setNat] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const toImg = (e: PointerEvent) => {
    const el = imgRef.current!;
    return pointToImage(e.clientX, e.clientY, el.getBoundingClientRect(), el.naturalWidth, el.naturalHeight);
  };

  async function send() {
    setBusy(true); setError(false);
    try {
      onDone({ send: true, image: await canvasPainter.paint(redacted, boxes.map(normBox)) });
    } catch {
      setBusy(false); setError(true);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); onDone({ send: false }); return; }
    if (e.key !== 'Tab') return;
    const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="cp-title" aria-describedby="cp-desc" ref={dialogRef} tabIndex={-1} onKeyDown={onKeyDown}
      className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-3xl w-full p-6 space-y-4 max-h-full overflow-auto">
        <h2 id="cp-title" className="text-xl font-bold">Send to cloud?</h2>
        <p id="cp-desc" className="text-slate-700">We couldn't be sure every private number was found. Check the image — black boxes will be hidden from the cloud. Drag over anything else to hide it, or use "Black out bottom third". Press Escape to keep this bill on your device.</p>
        <div className="relative select-none touch-none"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); const p = toImg(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
          onPointerMove={(e) => { if (drag) { const p = toImg(e); setDrag({ ...drag, x1: p.x, y1: p.y }); } }}
          onPointerUp={() => { if (drag) { const n = normBox(drag); if (n.x1 - n.x0 > 2 && n.y1 - n.y0 > 2) setBoxes([...boxes, n]); } setDrag(null); }}
          onPointerCancel={() => setDrag(null)}>
          <img ref={imgRef} src={url} alt="Bill with private numbers blacked out. This is what would be sent." className="w-full" draggable={false}
            onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
          {[...boxes, ...(drag ? [drag] : [])].map((b, i) => <div key={i} className="absolute bg-black" style={boxToPercent(b, nat.w, nat.h)} />)}
        </div>
        <p role="status" className="text-sm text-slate-600">{boxes.length} extra box{boxes.length === 1 ? '' : 'es'} added</p>
        {error && <p role="alert" className="text-sm text-red-700">Could not prepare the image. Try again or keep it on device.</p>}
        <div className="flex flex-wrap gap-3">
          <button className="px-5 py-3 rounded-lg bg-emerald-700 text-white disabled:opacity-60" onClick={send} disabled={busy}>Send to cloud</button>
          <button className="px-5 py-3 rounded-lg border" onClick={() => onDone({ send: false })}>Keep on device</button>
          <button className="px-3 py-3 text-sm underline disabled:opacity-50" onClick={() => setBoxes([])} disabled={!boxes.length}>Undo my boxes</button>
          <button className="px-3 py-3 text-sm underline" onClick={() => { const i = imgRef.current!; setBoxes([...boxes, bottomThird(i.naturalWidth, i.naturalHeight)]); }}>
            Black out bottom third</button>
        </div>
      </div>
    </div>
  );
}
