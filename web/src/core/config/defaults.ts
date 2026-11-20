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
/** Fewer OCR words than this means OCR could not really read the bill, so "no private numbers found" proves nothing. */
export const MIN_OCR_WORDS = 15;
/** Median OCR word confidence (Tesseract 0–100 scale) below this means the read is too poor to trust the shield. */
export const MIN_OCR_MEDIAN_CONFIDENCE = 50;
