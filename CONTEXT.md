# Tecnik QR Inventory System — Project Context

## What This Is
QR-code-based inventory management for Tecnik (stores@tecnik.in) built on top of TranZact ERP.
Stores scans a QR on goods arrival → QC inspects → on Pass, inward is created in TranZact automatically.
Outward scanner handles material issue tracking.

---

## Files in This Folder

| File | Purpose |
|---|---|
| `Code.gs` | Google Apps Script backend — paste into Apps Script editor bound to Item_Master sheet |
| `Scanner.html` | Inward scanner (purple) — Stores team, goods arrival |
| `ScannerQC.html` | QC scanner (green) — QC team, inspect and pass/fail |
| `ScannerOutward.html` | Outward scanner (pink/red) — Stores team, material issue |
| `CONTEXT.md` | This file |

---

## Live URLs

| | URL |
|---|---|
| **Inward Scanner** | https://abhishlok99.github.io/tecnik-scanner/Scanner.html |
| **QC Scanner** | https://abhishlok99.github.io/tecnik-scanner/ScannerQC.html |
| **Outward Scanner** | https://abhishlok99.github.io/tecnik-scanner/ScannerOutward.html |
| **GitHub Repo** | https://github.com/abhishlok99/tecnik-scanner |
| **Google Sheet** | Item_Master (ask Abhishlok for share link) |

---

## Architecture

```
Mobile browser (GitHub Pages HTML)
        |
        | fetch() with query params
        v
Google Apps Script (doGet)  <-- bound to Item_Master Google Sheet
        |
        |-- lookupItem        → reads Sheet1 (50,997 items)
        |-- processInward     → writes Scan_Inward, emails QC with direct PC link
        |-- getPendingInward  → reads Scan_Inward for QC_PENDING rows
        |-- processQCApproval → on PASS: calls TranZact inward API (skipped in dry run)
        |                       on PASS partial: logs rejected qty to Scan_Rejected
        |                       on FAIL: writes Scan_Rejected, emails Purchase+Production
        |-- processOutward    → writes Scan_Outward
        v
TranZact ERP (be.letstranzact.com) — only called on QC Pass (live mode only)
```

**Why GitHub Pages?** Google's script.google.com domain blocks camera access (`getUserMedia`).
Hosting HTML on GitHub Pages gives a trusted HTTPS origin that mobile browsers allow.

---

## Features Implemented (as of 14 July 2026)

- Inward scanning with challan, PO, supplier fields
- QC Pass / Fail with optional bin/storage location
- QC email includes direct PC link (`?itemId=`) — auto-loads item on PC without QR scan
- Partial acceptance: if accepted < received, rejected qty logged to Scan_Rejected with email to Purchase + Production
- Full QC Fail: entire qty logged to Scan_Rejected with email
- Outward scanning (log only, no TranZact automation yet)
- Dry run mode (default TRUE) — skips TranZact API calls entirely
- Duplicate detection: 5-min window, last 50 rows

---

## Google Sheet — Item_Master

### Sheet1 (Item Master — 50,997 rows)
Columns: Item ID, Item Name, Unit of Measurement, Item Type (Buy/Sell/Both), HSN Code, Default Price, QR_Code_URL, Google_Sheets_QR

### Config (key settings)
| Setting | Current Value | Notes |
|---|---|---|
| TRANZACT_BASE_URL | https://be.letstranzact.com | |
| TRANZACT_TOKEN | (auto-filled by Authenticate) | expires, re-run Authenticate if 401 |
| COMPANY_ID | 13877 | Tecnik's TranZact company ID |
| DEFAULT_STORE_ID | (blank) | fill after running Fetch Config IDs |
| DEFAULT_UNIT_ID | (blank) | fill after running Fetch Config IDs |
| BUYER_BILLING_ADDRESS_ID | (blank) | fill after running Fetch Config IDs |
| BUYER_DELIVERY_LOCATION_ID | (blank) | fill after running Fetch Config IDs |
| SUPPLIER_BILLING_ADDRESS_ID | (blank) | fill after running Fetch Config IDs |
| DOC_NUMBER_SERIES_ID | (blank) | fill after running Fetch Config IDs |
| DRY_RUN_MODE | TRUE | **flip to FALSE to go live** |

### Scan_Inward (15 cols)
Timestamp, QR_Code, Item_ID, Item_Name, Received_Qty, Accepted_Qty, Challan_Number, PO_Number, Supplier_ID, Bin_Location, QC_Status, Inward_Doc_ID, Status, TranZact_Response, Notes

QC_Status lifecycle: `QC_PENDING` → `QC_PASSED` or `QC_FAILED`

### Other Sheets
- `Scan_Outward` — material issue log
- `Scan_Rejected` — QC-failed or partially rejected items (with rejected qty and reason)
- `Audit_Log` — every operation timestamped
- `Error_Queue` — API failures for manual retry

---

## Email Notifications (in Code.gs top section)

```javascript
var QC_EMAIL         = 'atharv.swarge@flytbase.com,abhishlok99@gmail.com'; // testing only
var PURCHASE_EMAIL   = 'abhishlok99@gmail.com';   // replace with actual Purchase email
var PRODUCTION_EMAIL = 'abhishlok99@gmail.com';   // replace with actual Production email
```

- Inward logged → email to QC_EMAIL with item details + direct PC link
- QC Fail → email to PURCHASE_EMAIL + PRODUCTION_EMAIL
- Partial acceptance → email to PURCHASE_EMAIL + PRODUCTION_EMAIL with rejected qty
- MailApp limit: 1,500 emails/day on Google Workspace

---

## TranZact Integration

- **Auth**: POST `https://be.letstranzact.com/main/login/password-login/` with `stores@tecnik.in` / `mitesh`
- **Item lookup**: GET `/settings/product/get-products/?itemid=<id>` (only in live mode)
- **Inward create**: POST `/documents/inward/create-document-data/` with `save_action: "save_as_draft"`
- Token saved to Config sheet B3. Refresh by running `Authenticate TranZact` from the sheet menu.
- **Important:** Token expires. If you get a 401 error, re-run Authenticate TranZact.

---

## Deployment Notes

- Every time Code.gs is changed, you must: paste into Apps Script → Save → Deploy → Manage Deployments → edit → New Version → Deploy
- Every new deployment creates a new URL — share it and update all 3 HTML files → push to GitHub
- HTML files on GitHub Pages auto-deploy within ~2 minutes of push
- Always verify live URLs with: `curl https://abhishlok99.github.io/tecnik-scanner/Scanner.html | grep SCRIPT_URL`

---

## Setup Steps (if starting fresh on a new sheet)

1. Open Item_Master Google Sheet
2. Extensions → Apps Script → paste `Code.gs` contents → Save
3. Deploy: Deploy → New Deployment → Web App → Execute as Me → Anyone → Deploy
4. Copy deployment URL, update `const SCRIPT_URL = '...'` in all 3 HTML files
5. Push updated HTML to GitHub → Pages auto-deploys
6. In sheet: TranZact Inventory menu → Setup System → Authenticate TranZact → Fetch Config IDs
7. Fill in blank Config IDs from Audit_Log output
8. Test with DRY_RUN_MODE=TRUE
9. Flip DRY_RUN_MODE=FALSE to go live

---

## Dry Run Completed — 14 July 2026

Full flow tested successfully in dry run mode:
- Act 1: Inward logged, QC email received with direct PC link
- Act 2A: QC Pass with partial acceptance (7 of 10) — Scan_Inward updated, Scan_Rejected logged 3 units
- Act 2B: QC Fail — Scan_Rejected logged full qty, rejection email sent
- Act 3: Outward logged to Scan_Outward

---

## Go-Live Plan

### Step 1 — Fill Config IDs
In Google Sheet → TranZact Inventory menu → **Fetch Config IDs**
Check Audit_Log and fill these in Config sheet:
- DEFAULT_STORE_ID
- DEFAULT_UNIT_ID
- BUYER_BILLING_ADDRESS_ID
- BUYER_DELIVERY_LOCATION_ID
- SUPPLIER_BILLING_ADDRESS_ID
- DOC_NUMBER_SERIES_ID

### Step 2 — Update Email Addresses
In Code.gs, update the 3 variables at the top:
```javascript
var QC_EMAIL         = 'actual-qc-team@tecnik.in';
var PURCHASE_EMAIL   = 'actual-purchase@tecnik.in';
var PRODUCTION_EMAIL = 'actual-production@tecnik.in';
```

### Step 3 — Deploy from Abhishlok's Account
Currently emails come from atharvswarge@gmail.com.
Abhishlok should open the sheet, paste Code.gs, deploy from his account so emails come from stores@tecnik.in or abhishlok99@gmail.com.

### Step 4 — Update HTML files with new URL
Share new deployment URL → update all 3 HTML files → push to GitHub.

### Step 5 — Flip DRY_RUN_MODE to FALSE
In Config sheet: DRY_RUN_MODE → FALSE

### Step 6 — Live Test
Do one full inward → QC Pass → verify TranZact inward draft is created in TranZact dashboard.

---

## Accounts & Access

| Resource | Account |
|---|---|
| Google Sheet + Apps Script | stores@tecnik.in (or Abhishlok) |
| GitHub repo | abhishlok99 |
| GitHub Pages | auto-deployed from main branch |
| TranZact | stores@tecnik.in / mitesh |
