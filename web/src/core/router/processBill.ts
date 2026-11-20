import type { Availability, BillStatus, CheckResult, Clock, CloudModel, Config, ConsentResult, DeviceModel, Extraction, ImageInput,
  Ocr, OcrWord, Painter, PathTaken, ProcessedBill, Reason, RedactionPlan, Step } from '../types';
import { CLOUD_COST_PER_CALL_USD, DEVICE_TIMEOUT_MS } from '../config/defaults';
import { cloudPrompt, devicePrompt } from '../extract/prompts';
import { parseExtraction } from '../extract/parse';
import { runChecks } from '../checks/checks';
import { runShield } from '../shield/shield';
import { planRedaction } from '../redact/planRedaction';
import { TimeoutError, withTimeout } from './timeout';

export interface RouterDeps {
  device: DeviceModel; cloud: CloudModel; ocr: Ocr; painter: Painter; config: Config; clock: Clock; deviceTimeoutMs?: number;
}
export interface RouterHooks {
  onStep(step: Step): void;
  askConsent(redacted: Blob, plan: RedactionPlan): Promise<ConsentResult>;
}

type OcrOutcome = { ok: true; words: OcrWord[] } | { ok: false };

export async function processBill(img: ImageInput, deps: RouterDeps, hooks: RouterHooks): Promise<ProcessedBill> {
  const { config: cfg, clock } = deps;
  const started = clock.now().getTime();
  // Start OCR at once so redaction is ready if we escalate.
  const ocrP: Promise<OcrOutcome> = deps.ocr.recognize(img.blob).then((words) => ({ ok: true, words }), () => ({ ok: false }));
  let ext: Extraction | null = null;
  let res: CheckResult | null = null;
  let plan: RedactionPlan = { boxes: [], piiTypes: [], piiMasked: 0 };
  let cloudCalled = false;
  let redacted: Blob | null = null;

  const finish = (path: PathTaken, reason: Reason, status: BillStatus): ProcessedBill => {
    hooks.onStep('done');
    return {
      status, extraction: ext, checks: res?.checks ?? null,
      route: { path, reason, confidence: res?.score ?? 0, promptVersion: cfg.extractionPromptVersion, modelName: path === 'cloud' ? cfg.cloudModel : 'gemini-nano' },
      piiTypes: plan.piiTypes, piiMasked: plan.piiMasked,
      latencyMs: clock.now().getTime() - started,
      estCostUsd: cloudCalled ? CLOUD_COST_PER_CALL_USD : 0,
      redactedImage: redacted,
    };
  };

  hooks.onStep('availability');
  let reason: Reason | null = null;
  if (cfg.routingMode === 'cloud_only') reason = 'cloud_only_mode';
  else {
    let avail: Availability = 'unavailable';
    try { avail = await deps.device.availability(); } catch { /* treat as unavailable */ }
    if (avail !== 'available') reason = 'no_device_model';
  }

  if (!reason) {
    hooks.onStep('device_read');
    try {
      const raw = await withTimeout(deps.device.extract(img, devicePrompt(cfg)), deps.deviceTimeoutMs ?? DEVICE_TIMEOUT_MS);
      ext = parseExtraction(raw);
      if (!ext) reason = 'invalid_json';
      else {
        hooks.onStep('checking');
        res = runChecks(ext, cfg, clock.now());
        if (!res.escalate) return finish('device', 'passed', 'draft');
        reason = res.hardFail ?? 'low_confidence';
      }
    } catch (e) {
      reason = e instanceof TimeoutError ? 'device_timeout' : 'device_error';
    }
  }

  if (cfg.routingMode === 'device_only') return finish('device', reason!, 'manual_entry');

  hooks.onStep('redacting');
  const ocr = await ocrP;
  if (!ocr.ok) return finish('device', 'ocr_error', 'manual_entry');
  let toSend = img.blob;
  if (cfg.maskPii) {
    const shield = runShield(ocr.words, cfg.consentOcrThreshold);
    plan = planRedaction(ocr.words, shield, img.width, img.height);
    try {
      toSend = await deps.painter.paint(img.blob, plan.boxes);
      if (shield.uncertain) {
        hooks.onStep('awaiting_consent');
        const c = await hooks.askConsent(toSend, plan);
        if (!c.send) return finish('device', 'user_kept_local', 'manual_entry');
        toSend = c.image;
      }
    } catch {
      return finish('device', 'redact_error', 'manual_entry');
    }
    // Fail closed: never send the original image when masking is on.
    if (toSend === img.blob) return finish('device', 'redact_error', 'manual_entry');
  }
  redacted = toSend;

  hooks.onStep('cloud_read');
  let raw: string;
  try {
    cloudCalled = true;
    raw = await deps.cloud.extract({ ...img, blob: toSend, mimeType: 'image/jpeg' }, cloudPrompt(cfg), cfg.cloudModel);
  } catch {
    return finish('device', 'cloud_error', 'manual_entry');
  }
  const cloudExt = parseExtraction(raw);
  if (!cloudExt) return finish('device', 'cloud_error', 'manual_entry');
  ext = cloudExt;
  hooks.onStep('checking');
  res = runChecks(ext, cfg, clock.now());
  return finish('cloud', reason!, 'draft');
}
