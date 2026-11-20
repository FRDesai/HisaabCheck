import type { PiiType } from '../types';

export const PII_LABEL: Record<PiiType, string> = {
  PAN: 'PAN', AADHAAR: 'Aadhaar', PHONE: 'Phone', BANK_ACCOUNT: 'Bank account', IFSC: 'IFSC', POSSIBLE_ID: 'Possible ID number',
};
/** Display name for a PII type; unknown strings (e.g. old or malformed logs) are shown as-is. */
export const piiLabel = (t: string): string => (Object.prototype.hasOwnProperty.call(PII_LABEL, t) ? PII_LABEL[t as PiiType] : t);
