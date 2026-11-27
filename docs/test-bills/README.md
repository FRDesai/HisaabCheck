# Test bills

Six made-up GST bills for trying the app. Every business, address, number and name on them is invented; none belongs to a real person or company. The PANs, phone numbers, Aadhaar number, bank account and IFSC are made up too (they have the right format and obvious fake patterns). Each supplier GSTIN has a valid checksum (checked with `gstinCheckChar` in `web/src/core/shield/gstin.ts`), and the Aadhaar-format number passes the Verhoeff checksum (`web/src/core/shield/verhoeff.ts`). All invoice dates are in November 2026.

The PNG files are 1000 px wide, each under 140 KB. The HTML sources are in `src/`. To regenerate one:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --screenshot=bill1.png --window-size=1000,1400 file://$PWD/src/bill1.html
```

| Bill | Supplier and GSTIN | Meant to show | Made-up private numbers printed on it | Amounts |
|---|---|---|---|---|
| `bill1.png` | Demo Stationers (Fictional), `29AAAPX0001X1Z4`, Karnataka | A clean intra-state bill (CGST + SGST), 3 items | PAN `AAAPX0001X`; mobile `90000 00001` | Taxable 1,450.00; CGST 130.50; SGST 130.50; total 1,711.00 |
| `bill2.png` | Imaginary Hardware Pvt Ltd, `24AAACX0002X1Z4`, Gujarat; place of supply Maharashtra | An inter-state bill (IGST) with bank details, 3 items | A/C `11112222333344`; IFSC `FAKE0001234` | Taxable 12,300.00; IGST 2,214.00; total 14,514.00 |
| `bill3.png` | Fictional Foods & Co, `27AAAFX0003X1ZR`, Maharashtra | The maths check failing: items plus tax come to 2,360.00 but the printed total is 2,630.00 | none | Taxable 2,000.00; CGST 180.00; SGST 180.00; printed total 2,630.00 (should be 2,360.00) |
| `bill4.png` | Make-Believe Mobiles, `27AAAFX0004X1ZQ`, Maharashtra | A valid-checksum Aadhaar-format number and a labelled landline | Aadhaar `2222 2222 2227`; telephone `022 2222 2222` | Taxable 3,300.00; CGST 297.00; SGST 297.00; total 3,894.00 |
| `bill5.png` | Example Textiles Ltd, `33AAACX0005X1Z2`, Tamil Nadu | More than 10 line items (12) | none | Taxable 12,404.50; CGST 1,116.41; SGST 1,116.41; total 14,637.32 |
| `bill6.png` | Notional Medicals (Fictional), `07AAAFX0006X1ZQ`, Delhi | A "PAN:" label with no value, to show the "Send to cloud?" preview | none (the PAN line is empty) | Taxable 1,800.00; CGST 162.00; SGST 162.00; total 2,124.00 |

Except bill 3, every bill's items, tax and total add up. These images were checked by eye and by arithmetic.

**What the OCR and shield do with them** (Tesseract.js 5.1.1 and the shield of 27 November 2026, run on these PNG files):

| Bill | Hidden | Preview | Why the preview appears |
|---|---|---|---|
| `bill1.png` | PAN, mobile | yes | a rate in the table read as `4500]` with low confidence |
| `bill2.png` | bank account, IFSC | yes | the invoice number and a rate read with low confidence |
| `bill3.png` | nothing (none printed) | no | |
| `bill4.png` | Aadhaar-format number, landline | yes | a table cell read as `2000` with low confidence (not a missing value) |
| `bill5.png` | nothing (none printed) | no | |
| `bill6.png` | nothing (the PAN line is empty) | yes | the "PAN:" label has no value: this is the "label without a value" demo |

The previews on bills 1, 2 and 4 come from how OCR reads table cells and can differ on another run, browser or photo; bill 6's does not.
