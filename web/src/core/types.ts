export type PathTaken = 'device' | 'cloud';
export type Reason =
  | 'passed' | 'total_mismatch' | 'invalid_gstin' | 'low_confidence'
  | 'device_timeout' | 'device_error' | 'invalid_json' | 'no_device_model'
  | 'cloud_only_mode' | 'cloud_error' | 'ocr_error' | 'user_kept_local' | 'redact_error';
export type BillStatus = 'draft' | 'approved' | 'rejected' | 'manual_entry';
export type RoutingMode = 'smart' | 'device_only' | 'cloud_only';
export type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';
/** POSSIBLE_ID: a near-miss (OCR look-alike or failed checksum) of PAN/Aadhaar/mobile; hidden as a precaution. */
export type PiiType = 'PAN' | 'AADHAAR' | 'PHONE' | 'BANK_ACCOUNT' | 'IFSC' | 'POSSIBLE_ID';

export interface LineItem { description: string; hsn: string; qty: number; rate: number; amount: number }
export interface Extraction {
  supplierName: string; supplierGstin: string; invoiceNo: string; invoiceDate: string;
  placeOfSupply: string; items?: LineItem[]; itemCount?: number;
  taxableValue: number; cgst: number; sgst: number; igst: number; total: number; confidence: number;
}
export interface Checks { total: boolean; gstin: boolean; taxSplit: boolean; date: boolean; required: boolean }
export interface CheckResult { checks: Checks; score: number; hardFail: Reason | null; escalate: boolean }

export interface Config {
  routingMode: RoutingMode; confidenceThreshold: number; consentOcrThreshold: number;
  totalToleranceInr: number; maxDeviceLineItems: number; cloudModel: string;
  extractionPromptVersion: string; maskPii: boolean;
}

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface OcrWord { text: string; bbox: Box; confidence: number /* 0–100 */; line: number }
export interface PiiMatch { type: PiiType; wordIndexes: number[] }
export interface ShieldResult { gstinWordIndexes: number[]; matches: PiiMatch[]; uncertain: boolean; uncertainReasons: string[] }
export interface RedactionPlan { boxes: Box[]; piiTypes: PiiType[]; piiMasked: number }

export interface ImageInput { blob: Blob; mimeType: 'image/jpeg' | 'image/png'; width: number; height: number }

export interface DeviceModel {
  availability(): Promise<Availability>;
  download(onProgress: (fraction: number) => void): Promise<void>;
  extract(image: ImageInput, prompt: string): Promise<string>;
}
export interface CloudModel { extract(redacted: ImageInput, prompt: string, model: string): Promise<string> }
export interface Ocr { recognize(image: Blob): Promise<OcrWord[]> }
export interface Painter { paint(image: Blob, boxes: Box[]): Promise<Blob> }
export interface Clock { now(): Date }

export interface RouteInfo { path: PathTaken; reason: Reason; confidence: number; promptVersion: string; modelName: string }
export interface ProcessedBill {
  status: BillStatus; extraction: Extraction | null; checks: Checks | null; route: RouteInfo;
  piiTypes: PiiType[]; piiMasked: number; latencyMs: number; estCostUsd: number; redactedImage: Blob | null;
}
export type Step = 'availability' | 'device_read' | 'checking' | 'redacting' | 'awaiting_consent' | 'cloud_read' | 'done';
export type ConsentResult = { send: true; image: Blob } | { send: false };
