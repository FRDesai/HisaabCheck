import { describe, it, expect, vi } from 'vitest';
import { processBill, type RouterDeps } from '../../src/core/router/processBill';
import { parseConfig } from '../../src/core/config/parseConfig';
import type { Availability, Config, ImageInput, OcrWord } from '../../src/core/types';
import { wordsFromLines } from '../helpers';

const RAW = new Blob(['raw'], { type: 'image/jpeg' });
const REDACTED = new Blob(['redacted'], { type: 'image/jpeg' });
const CONSENTED = new Blob(['consented'], { type: 'image/jpeg' });
const IMG: ImageInput = { blob: RAW, mimeType: 'image/jpeg', width: 1000, height: 1000 };
const GOOD = JSON.stringify({ supplierName: 'Ravi Traders', supplierGstin: '29AAGCB7383J1Z4', invoiceNo: '4521',
  invoiceDate: '2026-11-02', placeOfSupply: '29-Karnataka', taxableValue: 1500, cgst: 135, sgst: 135, igst: 0, total: 1770, confidence: 0.9 });
const BAD_TOTAL = GOOD.replace('"total":1770', '"total":1870');

interface Opts { avail?: Availability; deviceOut?: string; deviceThrows?: boolean; deviceDelayMs?: number;
  cloudOut?: string; cloudThrows?: boolean; ocrWords?: OcrWord[]; ocrThrows?: boolean; config?: Partial<Config> }

function setup(o: Opts = {}) {
  const calls = { device: 0, cloud: [] as Blob[], paint: 0 };
  const deps: RouterDeps = {
    device: {
      availability: async () => o.avail ?? 'available',
      download: async () => {},
      extract: async () => {
        calls.device++;
        if (o.deviceDelayMs) await new Promise((r) => setTimeout(r, o.deviceDelayMs));
        if (o.deviceThrows) throw new Error('boom');
        return o.deviceOut ?? GOOD;
      },
    },
    cloud: { extract: async (img) => { calls.cloud.push(img.blob); if (o.cloudThrows) throw new Error('net'); return o.cloudOut ?? GOOD; } },
    ocr: { recognize: async () => { if (o.ocrThrows) throw new Error('ocr'); return o.ocrWords ?? wordsFromLines(['PAN: AAPFU0939F']); } },
    painter: { paint: async () => { calls.paint++; return REDACTED; } },
    config: { ...parseConfig({}, false), ...o.config },
    clock: { now: () => new Date('2026-11-20T10:00:00+05:30') },
    deviceTimeoutMs: 50,
  };
  const hooks = { onStep: vi.fn(), askConsent: vi.fn(async () => ({ send: true as const, image: CONSENTED })) };
  return { deps, hooks, calls };
}

const neverRaw = (calls: { cloud: Blob[] }) => expect(calls.cloud).not.toContain(RAW);

describe('processBill', () => {
  it('saves a passing device read without touching the cloud', async () => {
    const { deps, hooks, calls } = setup();
    const r = await processBill(IMG, deps, hooks);
    expect(r.route).toMatchObject({ path: 'device', reason: 'passed' });
    expect(r.status).toBe('draft');
    expect(calls.cloud).toHaveLength(0);
    expect(r.estCostUsd).toBe(0);
  });
  it('escalates a total mismatch with the redacted image', async () => {
    const { deps, hooks, calls } = setup({ deviceOut: BAD_TOTAL });
    const r = await processBill(IMG, deps, hooks);
    expect(r.route).toMatchObject({ path: 'cloud', reason: 'total_mismatch' });
    expect(calls.cloud).toEqual([REDACTED]);
    expect(r.piiTypes).toEqual(['PAN']);
    expect(r.piiMasked).toBe(1);
    expect(r.redactedImage).toBe(REDACTED);
    expect(r.estCostUsd).toBeGreaterThan(0);
  });
  it.each(['unavailable', 'downloadable', 'downloading'] as const)('goes to cloud when device is %s', async (avail) => {
    const { deps, hooks, calls } = setup({ avail });
    const r = await processBill(IMG, deps, hooks);
    expect(r.route.reason).toBe('no_device_model');
    expect(calls.device).toBe(0);
    neverRaw(calls);
  });
  it('cloud_only mode skips the device', async () => {
    const { deps, hooks, calls } = setup({ config: { routingMode: 'cloud_only' } });
    const r = await processBill(IMG, deps, hooks);
    expect(r.route.reason).toBe('cloud_only_mode');
    expect(calls.device).toBe(0);
    neverRaw(calls);
  });
  it('device_only mode saves failures as manual entry and never calls cloud', async () => {
    const { deps, hooks, calls } = setup({ deviceOut: BAD_TOTAL, config: { routingMode: 'device_only' } });
    const r = await processBill(IMG, deps, hooks);
    expect(r.status).toBe('manual_entry');
    expect(r.route).toMatchObject({ path: 'device', reason: 'total_mismatch' });
    expect(r.extraction?.total).toBe(1870);
    expect(calls.cloud).toHaveLength(0);
  });
  it('device_only with no model is manual entry', async () => {
    const { deps, hooks, calls } = setup({ avail: 'unavailable', config: { routingMode: 'device_only' } });
    const r = await processBill(IMG, deps, hooks);
    expect(r).toMatchObject({ status: 'manual_entry', extraction: null });
    expect(r.route.reason).toBe('no_device_model');
    expect(calls.cloud).toHaveLength(0);
  });
  it('times out the device read', async () => {
    const { deps, hooks, calls } = setup({ deviceDelayMs: 200 });
    expect((await processBill(IMG, deps, hooks)).route.reason).toBe('device_timeout');
    neverRaw(calls);
  });
  it('handles a device error', async () => {
    const { deps, hooks } = setup({ deviceThrows: true });
    expect((await processBill(IMG, deps, hooks)).route.reason).toBe('device_error');
  });
  it('handles invalid device JSON', async () => {
    const { deps, hooks } = setup({ deviceOut: 'no idea' });
    expect((await processBill(IMG, deps, hooks)).route.reason).toBe('invalid_json');
  });
  it('asks consent when OCR is unsure and sends the consented image', async () => {
    const { deps, hooks, calls } = setup({ deviceOut: BAD_TOTAL, ocrWords: wordsFromLines(['PAN No: ____']) });
    const r = await processBill(IMG, deps, hooks);
    expect(hooks.askConsent).toHaveBeenCalledWith(REDACTED, expect.anything());
    expect(calls.cloud).toEqual([CONSENTED]);
    expect(r.redactedImage).toBe(CONSENTED);
    expect(hooks.onStep).toHaveBeenCalledWith('awaiting_consent');
  });
  it('keeps the bill local when the user declines', async () => {
    const { deps, hooks, calls } = setup({ deviceOut: BAD_TOTAL, ocrWords: wordsFromLines(['PAN No: ____']) });
    hooks.askConsent.mockResolvedValueOnce({ send: false } as never);
    const r = await processBill(IMG, deps, hooks);
    expect(r).toMatchObject({ status: 'manual_entry' });
    expect(r.route).toMatchObject({ path: 'device', reason: 'user_kept_local' });
    expect(calls.cloud).toHaveLength(0);
  });
  it('saves manual entry on cloud error, keeping device fields', async () => {
    const { deps, hooks } = setup({ deviceOut: BAD_TOTAL, cloudThrows: true });
    const r = await processBill(IMG, deps, hooks);
    expect(r.status).toBe('manual_entry');
    expect(r.route.reason).toBe('cloud_error');
    expect(r.extraction?.total).toBe(1870);
  });
  it('blocks the cloud when OCR fails', async () => {
    const { deps, hooks, calls } = setup({ deviceOut: BAD_TOTAL, ocrThrows: true });
    const r = await processBill(IMG, deps, hooks);
    expect(r.route.reason).toBe('ocr_error');
    expect(r.status).toBe('manual_entry');
    expect(calls.cloud).toHaveLength(0);
  });
  it('keeps a failing cloud read as a draft with red checks', async () => {
    const { deps, hooks } = setup({ deviceOut: BAD_TOTAL, cloudOut: BAD_TOTAL });
    const r = await processBill(IMG, deps, hooks);
    expect(r.status).toBe('draft');
    expect(r.checks?.total).toBe(false);
  });
  it('reports steps in order for an escalated bill', async () => {
    const { deps, hooks } = setup({ deviceOut: BAD_TOTAL });
    await processBill(IMG, deps, hooks);
    expect(hooks.onStep.mock.calls.map((c) => c[0])).toEqual(['availability', 'device_read', 'checking', 'redacting', 'cloud_read', 'checking', 'done']);
  });
});
