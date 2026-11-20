import type { Config, RoutingMode } from '../types';
import { DEFAULT_REMOTE_VALUES as D } from './defaults';

function num(v: string | undefined, def: string, min: number, max: number): number {
  const n = Number(v);
  return v !== undefined && v.trim() !== '' && Number.isFinite(n) && n >= min && n <= max ? n : Number(def);
}

export function parseConfig(values: Record<string, string>, isProd: boolean): Config {
  const mode = values.routing_mode;
  const routingMode: RoutingMode =
    mode === 'smart' || mode === 'device_only' || mode === 'cloud_only' ? mode : (D.routing_mode as RoutingMode);
  return {
    routingMode,
    confidenceThreshold: num(values.confidence_threshold, D.confidence_threshold, 0, 1),
    consentOcrThreshold: num(values.consent_ocr_threshold, D.consent_ocr_threshold, 0, 1),
    totalToleranceInr: num(values.total_tolerance_inr, D.total_tolerance_inr, 0, 100),
    maxDeviceLineItems: Math.round(num(values.max_device_line_items, D.max_device_line_items, 0, 100)),
    cloudModel: values.cloud_model?.trim() || D.cloud_model,
    extractionPromptVersion: values.extraction_prompt_version?.trim() || D.extraction_prompt_version,
    maskPii: isProd ? true : (values.mask_pii ?? D.mask_pii) !== 'false',
  };
}
