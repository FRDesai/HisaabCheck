export const DEFAULT_REMOTE_VALUES: Record<string, string> = {
  routing_mode: 'smart',
  confidence_threshold: '0.8',
  consent_ocr_threshold: '0.6',
  total_tolerance_inr: '1',
  max_device_line_items: '10',
  cloud_model: 'gemini-3.1-flash-lite',
  extraction_prompt_version: 'v1',
  mask_pii: 'true',
};
/** Estimated cost of one cloud read; replace with the measured value from the accuracy run. */
export const CLOUD_COST_PER_CALL_USD = 0.0003;
export const DEVICE_TIMEOUT_MS = 8000;
