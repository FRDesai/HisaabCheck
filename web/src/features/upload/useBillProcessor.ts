import { useCallback, useEffect, useRef, useState } from 'react';
import { processBill } from '../../core/router/processBill';
import type { ConsentResult, ProcessedBill, RedactionPlan, Step } from '../../core/types';
import { deviceModel, cloudModel } from '../../adapters/firebaseAi';
import { tesseractOcr } from '../../adapters/tesseractOcr';
import { canvasPainter } from '../../adapters/canvasPainter';
import { resizeImage } from '../../adapters/imageResize';
import { loadConfig } from '../../adapters/remoteConfig';
import { saveProcessedBill, type SavedBill, type Shop } from '../../adapters/store';
import { useAuth } from '../auth/AuthProvider';

export type BillJob = {
  id: string; file: File; originalUrl: string; step: Step | 'queued' | 'error';
  result?: ProcessedBill; billId?: string; consent?: { redacted: Blob; plan: RedactionPlan }; error?: string;
  sync?: 'pending' | 'saved' | 'failed'; photo?: 'stored' | 'skipped' | 'failed';
};

export function useBillProcessor(shop: Shop | null) {
  const { user } = useAuth();
  const [bills, setBills] = useState<BillJob[]>([]);
  const queue = useRef<string[]>([]);
  const running = useRef(false);
  const jobs = useRef(new Map<string, BillJob>());
  const consentWaiters = useRef(new Map<string, (r: ConsentResult) => void>());
  const alive = useRef(true);

  const patch = useCallback((id: string, p: Partial<BillJob>) => {
    const cur = jobs.current.get(id);
    if (!cur || !alive.current) return;
    const j = { ...cur, ...p };
    jobs.current.set(id, j);
    setBills((bs) => bs.map((b) => (b.id === id ? j : b)));
  }, []);

  const track = useCallback((id: string, saved: SavedBill) => {
    patch(id, { sync: 'pending', photo: undefined });
    saved.synced.then(() => patch(id, { sync: 'saved' }), () => patch(id, { sync: 'failed' }));
    saved.photo.then((p) => patch(id, { photo: p }), () => patch(id, { photo: 'failed' }));
  }, [patch]);

  const pump = useCallback(async () => {
    if (running.current || !shop || !user) return;
    running.current = true;
    try {
      while (queue.current.length && alive.current) {
        const id = queue.current.shift()!;
        const job = jobs.current.get(id);
        if (!job) continue;
        try {
          const img = await resizeImage(job.file);
          const config = await loadConfig();
          const result = await processBill(img, { device: deviceModel, cloud: cloudModel, ocr: tesseractOcr, painter: canvasPainter, config, clock: { now: () => new Date() } }, {
            onStep: (step) => patch(id, { step }),
            askConsent: (redacted, plan) => new Promise<ConsentResult>((resolve) => {
              consentWaiters.current.set(id, resolve);
              patch(id, { consent: { redacted, plan } });
            }),
          });
          // Only the redacted image (inside `result`) reaches the store; the original File never does.
          const saved = saveProcessedBill(shop, user.uid, result);
          patch(id, { result, billId: saved.billId, consent: undefined, step: 'done' });
          track(id, saved);
        } catch (e) {
          patch(id, { step: 'error', consent: undefined, error: e instanceof Error ? e.message : String(e) });
        }
      }
    } finally {
      running.current = false;
    }
  }, [shop, user, patch, track]);

  // Start (or resume) processing once the shop and user are known, e.g. files dropped before the shop loaded.
  useEffect(() => { void pump(); }, [pump]);

  useEffect(() => {
    alive.current = true;
    const map = jobs.current;
    const waiters = consentWaiters.current;
    return () => {
      alive.current = false;
      waiters.forEach((resolve) => resolve({ send: false })); // free the pump; nothing is sent
      waiters.clear();
      map.forEach((j) => URL.revokeObjectURL(j.originalUrl));
      map.clear();
    };
  }, []);

  const addFiles = useCallback((files: File[]) => {
    const fresh = files.filter((f) => /^image\/(jpeg|png)$/.test(f.type)).map((file): BillJob =>
      ({ id: crypto.randomUUID(), file, originalUrl: URL.createObjectURL(file), step: 'queued' }));
    if (!fresh.length) return;
    fresh.forEach((j) => { jobs.current.set(j.id, j); queue.current.push(j.id); });
    setBills((bs) => [...fresh, ...bs]);
    void pump();
  }, [pump]);

  const retry = useCallback((id: string) => {
    if (jobs.current.get(id)?.step === 'queued') return;
    patch(id, { step: 'queued', error: undefined, result: undefined, billId: undefined, sync: undefined, photo: undefined });
    queue.current.push(id);
    void pump();
  }, [patch, pump]);

  // Re-save the finished result to the SAME bill doc; the cascade is not re-run.
  const retrySave = useCallback((id: string) => {
    const j = jobs.current.get(id);
    if (!shop || !user || !j?.result || !j.billId || j.sync !== 'failed') return;
    track(id, saveProcessedBill(shop, user.uid, j.result, j.billId));
  }, [shop, user, track]);

  const resolveConsent = useCallback((id: string, r: ConsentResult) => {
    consentWaiters.current.get(id)?.(r);
    consentWaiters.current.delete(id);
    patch(id, { consent: undefined });
  }, [patch]);

  return { bills, addFiles, retry, retrySave, resolveConsent };
}
