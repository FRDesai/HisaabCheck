import type { Config } from '../types';

const FIELDS =
  'supplierName, supplierGstin (15 characters), invoiceNo, invoiceDate (YYYY-MM-DD), placeOfSupply (as printed, e.g. "29-Karnataka"), ' +
  'itemCount (number of line items), taxableValue, cgst, sgst, igst, total (numbers in rupees, no commas or symbols), ' +
  'confidence (0 to 1, how sure you are)';
const RULES = 'Use 0 for a missing tax and "" for missing text. Return ONLY one JSON object, no prose, no code fences.';

const V1 = {
  device: (max: number) =>
    `You read Indian GST purchase bills. Read this bill and return JSON with keys: ${FIELDS}. ` +
    `If itemCount is ${max} or fewer, also include "items": [{description, hsn, qty, rate, amount}]; otherwise omit "items". ${RULES}`,
  cloud: () =>
    `You read Indian GST purchase bills. Some private numbers are blacked out; ignore them. Return JSON with keys: ${FIELDS}, ` +
    `and "items": [{description, hsn, qty, rate, amount}] for every line item. ${RULES}`,
};
const VERSIONS: Record<string, typeof V1> = { v1: V1 };

const pick = (cfg: Config) => VERSIONS[cfg.extractionPromptVersion] ?? V1;
export const devicePrompt = (cfg: Config) => pick(cfg).device(cfg.maxDeviceLineItems);
export const cloudPrompt = (cfg: Config) => pick(cfg).cloud();
