// =============================================
// TranZact QR Inventory System
// =============================================

var REPORTING_BASE   = 'https://reporting.letstranzact.com';
var QC_EMAIL         = 'atharv.swarge@flytbase.com,abhishlok99@gmail.com';
var PURCHASE_EMAIL   = 'abhishlok99@gmail.com';
var PRODUCTION_EMAIL = 'abhishlok99@gmail.com';

// ============ WEB APP ENTRY POINTS ============

function doGet(e) {
  if (e && e.parameter && e.parameter.action) {
    try {
      const p = e.parameter;
      let result;
      switch (p.action) {
        case 'lookupItem':        result = lookupItemByQR(p.qrCode); break;
        case 'getPendingInward':  result = getPendingInward(p.itemId); break;
        case 'processInward':     result = processInward(p.qrCode, p.quantity, p.challanNumber, p.poNumber, p.supplierCompanyId); break;
        case 'processQCApproval': result = processQCApproval(p.itemId, p.acceptedQty, p.qcResult, p.binLocation); break;
        case 'processOutward':    result = processOutward(p.qrCode, p.quantity, p.issueTo, p.purpose); break;
        default:                  result = { success: false, error: 'Unknown action: ' + p.action };
      }
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return HtmlService.createHtmlOutputFromFile('Scanner').setTitle('TranZact Scanner');
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📦 TranZact Inventory')
    .addItem('🔧 Setup System',              'setupSystem')
    .addItem('🔑 Authenticate TranZact',     'authenticateTranZact')
    .addSeparator()
    .addItem('📷 Scan QR - Inward (Stores)', 'openInwardScanner')
    .addItem('🔬 Scan QR - QC Approval',     'openQCScanner')
    .addItem('📤 Scan QR - Outward',         'openOutwardScanner')
    .addSeparator()
    .addItem('📊 View Audit Log',            'goToAuditLog')
    .addItem('⚠️ View Error Queue',          'goToErrorQueue')
    .addSeparator()
    .addItem('🔧 Fetch Config IDs',          'fetchConfigOptions')
    .addToUi();
}

// ============ SETUP ============

function setupSystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  function ensureSheet(name, headers, color) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length)
        .setValues([headers]).setFontWeight('bold').setBackground(color).setFontColor('white');
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  let cfg = ss.getSheetByName('Config');
  if (!cfg) cfg = ss.insertSheet('Config');
  cfg.getRange('A1:B1').setValues([['Setting','Value']]).setFontWeight('bold').setBackground('#4285f4').setFontColor('white');
  cfg.setColumnWidth(1, 260);
  cfg.setColumnWidth(2, 500);
  {
    const defaults = [
      ['TRANZACT_BASE_URL',           'https://be.letstranzact.com'],
      ['TRANZACT_TOKEN',              ''],
      ['COMPANY_ID',                  ''],
      ['DEFAULT_STORE_ID',            ''],
      ['DEFAULT_UNIT_ID',             ''],
      ['BUYER_BILLING_ADDRESS_ID',    ''],
      ['BUYER_DELIVERY_LOCATION_ID',  ''],
      ['SUPPLIER_BILLING_ADDRESS_ID', ''],
      ['DOC_NUMBER_SERIES_ID',        ''],
      ['DEFAULT_SUPPLIER_ID',         ''],
      ['DRY_RUN_MODE',                'TRUE'],
      ['ENABLE_QIR',                  'FALSE'],
      ['LOG_LEVEL',                   'INFO']
    ];
    defaults.forEach(([key, defaultVal], i) => {
      const row = i + 2;
      cfg.getRange(row, 1).setValue(key);
      if (!cfg.getRange(row, 2).getValue()) cfg.getRange(row, 2).setValue(defaultVal);
    });
  }

  ensureSheet('Scan_Inward',
    ['Timestamp','QR_Code','Item_ID','Item_Name','Received_Qty','Accepted_Qty',
     'Challan_Number','PO_Number','Supplier_ID','Bin_Location','QC_Status',
     'Inward_Doc_ID','Status','TranZact_Response','Notes'],
    '#34a853');

  ensureSheet('Scan_Outward',
    ['Timestamp','QR_Code','Item_ID','Item_Name','Quantity','Issue_To','Purpose',
     'Store_ID','Status','TranZact_Response','Notes'],
    '#fbbc04');

  ensureSheet('Scan_Rejected',
    ['Timestamp','QR_Code','Item_ID','Item_Name','Received_Qty','Challan_Number',
     'PO_Number','Rejection_Reason','Notified_To','Status','Notes'],
    '#e91e63');

  ensureSheet('Audit_Log',
    ['Timestamp','Operation','Item_ID','Quantity','User','Status',
     'API_Endpoint','Request_Payload','Response','Error_Message'],
    '#9e9e9e');

  ensureSheet('Error_Queue',
    ['Timestamp','Operation','Item_ID','Quantity','Error_Type',
     'Error_Message','Retry_Count','Resolved','Resolution_Notes'],
    '#ea4335');

  SpreadsheetApp.getUi().alert(
    '✅ Setup complete!\n\n' +
    'Next:\n' +
    '1. Authenticate TranZact (menu)\n' +
    '2. Run "Fetch Config IDs" to auto-fill Store, Unit, etc.\n' +
    '3. Keep DRY_RUN_MODE=TRUE until you have tested one scan end-to-end'
  );
}

// ============ AUTH ============

function authenticateTranZact() {
  const configSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Config');
  if (!configSheet) { SpreadsheetApp.getUi().alert('Run Setup System first.'); return false; }

  try {
    const r = UrlFetchApp.fetch('https://be.letstranzact.com/main/login/password-login/', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ email: 'stores@tecnik.in', password: 'mitesh' }),
      muteHttpExceptions: true
    });
    const d = JSON.parse(r.getContentText());
    if (d.status === 1 && d.data && d.data.access_token) {
      configSheet.getRange('B3').setValue(d.data.access_token);
      if (d.data.company_id) configSheet.getRange('B4').setValue(d.data.company_id);
      SpreadsheetApp.getUi().alert('✅ Authentication successful! Token saved.');
      return true;
    }
    throw new Error(JSON.stringify(d));
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ Authentication failed: ' + e.toString());
    return false;
  }
}

// ============ CONFIG ============

function loadConfig() {
  const cfg = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Config');
  if (!cfg) throw new Error('Config sheet not found. Run Setup System first.');

  const rows = cfg.getRange(2, 1, 13, 2).getValues();
  const c = {};
  rows.forEach(r => { if (r[0]) c[r[0]] = r[1]; });

  if (!c.TRANZACT_TOKEN) throw new Error('Missing token. Run Authenticate TranZact first.');

  return {
    baseUrl:                  c.TRANZACT_BASE_URL || 'https://be.letstranzact.com',
    token:                    c.TRANZACT_TOKEN,
    companyId:                String(c.COMPANY_ID || ''),
    defaultStoreId:           c.DEFAULT_STORE_ID || '',
    defaultUnitId:            c.DEFAULT_UNIT_ID || '',
    buyerBillingAddressId:    c.BUYER_BILLING_ADDRESS_ID || '',
    buyerDeliveryLocationId:  c.BUYER_DELIVERY_LOCATION_ID || '',
    supplierBillingAddressId: c.SUPPLIER_BILLING_ADDRESS_ID || '',
    docNumberSeriesId:        c.DOC_NUMBER_SERIES_ID || '',
    defaultSupplierId:        c.DEFAULT_SUPPLIER_ID || '',
    dryRun:    String(c.DRY_RUN_MODE).toUpperCase() === 'TRUE',
    enableQIR: String(c.ENABLE_QIR).toUpperCase() === 'TRUE'
  };
}

// ============ ITEM LOOKUP ============

function lookupItemByQR(qrCode) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  if (!sheet) return { success: false, error: 'Item_Master sheet (Sheet1) not found' };

  let itemId = qrCode;
  if (qrCode.includes('data=')) {
    itemId = decodeURIComponent(qrCode.split('data=')[1].split('&')[0]);
  }

  const data = sheet.getDataRange().getValues();
  const h = data[0];
  const cols = {
    id:    h.indexOf('Item ID'),
    name:  h.indexOf('Item Name'),
    uom:   h.indexOf('Unit of Measurement'),
    type:  h.indexOf('Item Type (Buy/Sell/Both)'),
    hsn:   h.indexOf('HSN Code'),
    price: h.indexOf('Default Price')
  };

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][cols.id]).trim() === String(itemId).trim()) {
      return {
        success: true,
        item: {
          itemId:       String(data[i][cols.id]),
          itemName:     data[i][cols.name],
          uom:          data[i][cols.uom],
          itemType:     data[i][cols.type],
          hsnCode:      String(data[i][cols.hsn] || ''),
          defaultPrice: parseFloat(data[i][cols.price]) || 0
        }
      };
    }
  }
  return { success: false, error: `Item "${itemId}" not found in Item Master` };
}

// ============ TRANZACT PRODUCT LOOKUP ============

function getProductFromTranZact(itemId, config) {
  try {
    const r = UrlFetchApp.fetch(
      `${config.baseUrl}/settings/product/get-products/?itemid=${encodeURIComponent(itemId)}`,
      { headers: authHeaders(config), muteHttpExceptions: true }
    );
    const body = JSON.parse(r.getContentText());
    if (r.getResponseCode() === 200 && body.data && body.data.length > 0) {
      return { success: true, product: body.data[0] };
    }
    return { success: false, error: `Product API ${r.getResponseCode()}: ${r.getContentText()}` };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ============ PO VALIDATION ============

function validatePO(poNumber, itemId, requestedQty, config) {
  if (!poNumber || !poNumber.trim()) return { valid: true, skipped: true };

  try {
    const r = UrlFetchApp.fetch(
      `${config.baseUrl}/documents/document/get-document-data/?doc_type=po&doc_id=${encodeURIComponent(poNumber)}`,
      { headers: authHeaders(config), muteHttpExceptions: true }
    );

    if (r.getResponseCode() !== 200) {
      return { valid: false, reason: `PO "${poNumber}" not found (HTTP ${r.getResponseCode()})` };
    }

    const body = JSON.parse(r.getContentText());
    if (!body.data) return { valid: false, reason: 'PO response has no data' };

    const items = (body.data.item_details && body.data.item_details.items) || [];
    const poItem = items.find(i =>
      (i.itemid && String(i.itemid).toLowerCase() === String(itemId).toLowerCase()) ||
      (i.item_id && String(i.item_id).toLowerCase() === String(itemId).toLowerCase())
    );

    if (!poItem) return { valid: false, reason: `Item "${itemId}" not found on PO "${poNumber}"` };

    const poQty       = parseFloat(poItem.quantity || poItem.qty || 0);
    const receivedQty = parseFloat(poItem.received_quantity || poItem.delivered_quantity || 0);
    const remaining   = poQty - receivedQty;

    if (parseFloat(requestedQty) > remaining) {
      return { valid: false, reason: `Qty ${requestedQty} exceeds PO balance ${remaining}` };
    }

    return { valid: true, poItem, remaining };
  } catch (e) {
    // ponytail: PO validation failure is non-fatal — log and continue
    return { valid: true, warning: 'PO validation error (continuing): ' + e.toString() };
  }
}

// ============ INWARD PROCESSING ============

function processInward(qrCode, quantity, challanNumber, poNumber, supplierCompanyId) {
  try {
    const config = loadConfig();
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) throw new Error('Invalid quantity');
    if (!challanNumber || !String(challanNumber).trim()) throw new Error('Challan number is required');

    const itemLookup = lookupItemByQR(qrCode);
    if (!itemLookup.success) throw new Error('Item lookup failed: ' + itemLookup.error);
    const item = itemLookup.item;

    if (isDuplicateInward(item.itemId, qty, poNumber)) {
      throw new Error('Duplicate: same item/qty/PO already processed in last 5 minutes');
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Scan_Inward');
    if (sheet) sheet.appendRow([
      new Date(), qrCode, item.itemId, item.itemName,
      qty, '',
      challanNumber, poNumber || '',
      supplierCompanyId || config.defaultSupplierId || '',
      '', 'QC_PENDING', '', 'LOGGED', '', ''
    ]);

    logAudit('INWARD_RECEIVED', item.itemId, qty, activeUser(), 'QC_PENDING', '', '', '', '');

    const qcLink = `https://abhishlok99.github.io/tecnik-scanner/ScannerQC.html?itemId=${encodeURIComponent(item.itemId)}`;
    MailApp.sendEmail({
      to: QC_EMAIL,
      subject: `QC Check Required — ${item.itemId}`,
      body: `Item received at stores. Please inspect and approve.\n\n` +
            `Item ID:  ${item.itemId}\n` +
            `Item:     ${item.itemName}\n` +
            `Received: ${qty} ${item.uom}\n` +
            `Challan:  ${challanNumber}\n` +
            `PO:       ${poNumber || 'N/A'}\n` +
            `Time:     ${new Date().toLocaleString()}\n\n` +
            `── QC Actions ──\n` +
            `On PC:    ${qcLink}\n` +
            `On Phone: Scan the QR code on the item in the QC Scanner app`
    });

    return { success: true, message: `Logged. QC notified at ${QC_EMAIL}.`, item };
  } catch (e) {
    logError('INWARD', qrCode, quantity, 'EXCEPTION', e.toString());
    return { success: false, error: e.toString() };
  }
}

function isDuplicateInward(itemId, quantity, poNumber) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Scan_Inward');
  if (!sheet || sheet.getLastRow() < 2) return false;
  const lastRow = sheet.getLastRow();
  const rows = Math.min(50, lastRow - 1);
  const data = sheet.getRange(lastRow - rows + 1, 1, rows, 15).getValues();
  const fiveMin = 5 * 60 * 1000;
  const now = Date.now();
  return data.some(r =>
    now - new Date(r[0]).getTime() < fiveMin &&
    r[2] === itemId && r[4] === quantity && r[7] === poNumber
  );
}

// ============ QC LOOKUP ============

function getPendingInward(itemId) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Scan_Inward');
    if (!sheet) throw new Error('Scan_Inward sheet not found');
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][2]).trim() === String(itemId).trim() && data[i][10] === 'QC_PENDING') {
        return {
          success:     true,
          itemId:      data[i][2],
          itemName:    data[i][3],
          receivedQty: data[i][4],
          challan:     data[i][6],
          po:          data[i][7],
          timestamp:   new Date(data[i][0]).toLocaleString()
        };
      }
    }
    return { success: false, error: `No pending inward found for "${itemId}"` };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ============ QC APPROVAL ============

function processQCApproval(itemId, acceptedQty, qcResult, binLocation) {
  try {
    const config = loadConfig();
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Scan_Inward');
    if (!sheet) throw new Error('Scan_Inward sheet not found');

    const data = sheet.getDataRange().getValues();
    let targetRow = -1;
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][2]).trim() === String(itemId).trim() && data[i][10] === 'QC_PENDING') {
        targetRow = i + 1;
        break;
      }
    }
    if (targetRow === -1) throw new Error(`No pending inward found for item "${itemId}"`);

    const row         = data[targetRow - 1];
    const receivedQty = row[4];
    const challan     = row[6];
    const poNumber    = row[7];
    const supplierId  = row[8];
    const qrCode      = row[1];

    if (qcResult === 'FAIL') {
      sheet.getRange(targetRow, 10).setValue(binLocation || '');
      sheet.getRange(targetRow, 11).setValue('QC_FAILED');
      sheet.getRange(targetRow, 13).setValue('QC_FAILED');

      const rejSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Scan_Rejected');
      if (rejSheet) rejSheet.appendRow([
        new Date(), qrCode, itemId, row[3], receivedQty,
        challan, poNumber, '', PURCHASE_EMAIL + ',' + PRODUCTION_EMAIL, 'OPEN', ''
      ]);

      const msg = `QC FAILED for item ${itemId} (${row[3]}).\n\n` +
                  `Received: ${receivedQty}\nChallan: ${challan}\nPO: ${poNumber || 'N/A'}\n\n` +
                  `Action required: initiate return or rejection flow.`;
      MailApp.sendEmail({ to: PURCHASE_EMAIL,   subject: `QC Failed — ${itemId}`, body: msg });
      MailApp.sendEmail({ to: PRODUCTION_EMAIL, subject: `QC Failed — ${itemId}`, body: msg });

      logAudit('QC_FAIL', itemId, receivedQty, activeUser(), 'QC_FAILED', '', '', '', '');
      return { success: true, message: 'QC Failed recorded. Purchase and production notified.' };
    }

    // QC PASS
    const qty = parseFloat(acceptedQty);
    if (!qty || qty <= 0) throw new Error('Invalid accepted quantity');

    if (config.dryRun) {
      sheet.getRange(targetRow, 6).setValue(qty);
      sheet.getRange(targetRow, 10).setValue(binLocation || '');
      sheet.getRange(targetRow, 11).setValue('QC_PASSED');
      sheet.getRange(targetRow, 13).setValue('DRY_RUN');
      logPartialRejection(qrCode, itemId, row[3], receivedQty, qty, challan, poNumber);
      logAudit('QC_PASS_DRY_RUN', itemId, qty, activeUser(), 'DRY_RUN', '', '', 'NOT SENT', '');
      const partialMsg = qty < receivedQty ? ` ${receivedQty - qty} units logged as partially rejected.` : '';
      return { success: true, dryRun: true, message: 'DRY RUN — QC pass logged. Set DRY_RUN_MODE=FALSE to go live.' + partialMsg };
    }

    const productResult = getProductFromTranZact(itemId, config);
    if (!productResult.success) throw new Error('TranZact product lookup failed: ' + productResult.error);
    const product = productResult.product;

    const unitId = (product.units && product.units.length > 0)
      ? (product.units.find(u => u.base_unit)?.id || product.units[0].id)
      : config.defaultUnitId;

    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');

    const payload = {
      details: { doc_type: 'inward', service: 0 },
      item_details: {
        items: [{
          product:               product.id,
          hsn_code:              String(product.hsn_code || ''),
          price:                 product.default_price || 0,
          quantity:              String(qty),
          unit:                  { id: unitId },
          product_delivered_now: qty
        }]
      },
      buyer_details: {
        buyer_company_details:            { company_id: config.companyId },
        selected_buyer_billing_address:   { id: config.buyerBillingAddressId },
        selected_buyer_delivery_location: { id: config.buyerDeliveryLocationId }
      },
      supplier_details: {
        supplier_company_details:          { company_id: supplierId || config.defaultSupplierId },
        selected_supplier_billing_address: { id: config.supplierBillingAddressId }
      },
      primary_document_details: {
        doc_number:    { id: config.docNumberSeriesId },
        delivery_date: today,
        po_details:    { po_number: poNumber || '', po_date: '' }
      },
      save_action: 'save_as_draft',
      action: 'create'
    };

    const apiUrl = `${config.baseUrl}/documents/inward/create-document-data/`;
    const resp = UrlFetchApp.fetch(apiUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: authHeaders(config),
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = resp.getResponseCode();
    const body = resp.getContentText();
    if (code !== 200 && code !== 201) throw new Error(`Inward API ${code}: ${body}`);

    const inwardResp  = JSON.parse(body);
    const inwardDocId = (inwardResp.data && (inwardResp.data.id || inwardResp.data.doc_id)) || '';

    sheet.getRange(targetRow, 6).setValue(qty);
    sheet.getRange(targetRow, 10).setValue(binLocation || '');
    sheet.getRange(targetRow, 11).setValue('QC_PASSED');
    sheet.getRange(targetRow, 12).setValue(inwardDocId);
    sheet.getRange(targetRow, 13).setValue('SUCCESS');
    sheet.getRange(targetRow, 14).setValue(body);

    logPartialRejection(qrCode, itemId, row[3], receivedQty, qty, challan, poNumber);
    logAudit('QC_PASS_INWARD', itemId, qty, activeUser(), 'SUCCESS', apiUrl, JSON.stringify(payload), body, '');
    const partialNote = qty < receivedQty ? ` ${receivedQty - qty} units logged as partially rejected.` : '';
    return { success: true, message: `Inward created in TranZact. Doc ID: ${inwardDocId}` + partialNote, inwardDocId };

  } catch (e) {
    logError('QC_APPROVAL', itemId, acceptedQty, 'EXCEPTION', e.toString());
    return { success: false, error: e.toString() };
  }
}

// ============ PARTIAL REJECTION HELPER ============

function logPartialRejection(qrCode, itemId, itemName, receivedQty, acceptedQty, challan, poNumber) {
  const rejected = parseFloat(receivedQty) - parseFloat(acceptedQty);
  if (rejected <= 0) return;
  const rejSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Scan_Rejected');
  if (rejSheet) rejSheet.appendRow([
    new Date(), qrCode, itemId, itemName, rejected,
    challan, poNumber, `Partial acceptance — ${acceptedQty} of ${receivedQty} accepted`,
    PURCHASE_EMAIL + ',' + PRODUCTION_EMAIL, 'OPEN', ''
  ]);
  const msg = `Partial QC rejection for item ${itemId} (${itemName}).\n\n` +
              `Received: ${receivedQty}\nAccepted: ${acceptedQty}\nRejected: ${rejected}\n` +
              `Challan: ${challan}\nPO: ${poNumber || 'N/A'}\n\nAction required: return or dispose rejected units.`;
  MailApp.sendEmail({ to: PURCHASE_EMAIL,   subject: `Partial Rejection — ${itemId}`, body: msg });
  MailApp.sendEmail({ to: PRODUCTION_EMAIL, subject: `Partial Rejection — ${itemId}`, body: msg });
}

// ============ OUTWARD PROCESSING ============

function processOutward(qrCode, quantity, issueTo, purpose) {
  try {
    const config = loadConfig();
    if (!quantity || parseFloat(quantity) <= 0) throw new Error('Invalid quantity');
    if (!issueTo || !issueTo.trim()) throw new Error('Issue To is required');

    const itemLookup = lookupItemByQR(qrCode);
    if (!itemLookup.success) throw new Error('Item lookup failed: ' + itemLookup.error);
    const item = itemLookup.item;

    const status = config.dryRun ? 'DRY_RUN' : 'LOGGED';
    const note   = config.dryRun ? 'Dry run' : 'Outward logged — process manually in TranZact';

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Scan_Outward');
    if (sheet) sheet.appendRow([new Date(), qrCode, item.itemId, item.itemName, quantity, issueTo, purpose, config.defaultStoreId, status, '', note]);
    logAudit('OUTWARD', item.itemId, quantity, activeUser(), status, '', '', '', '');

    return { success: true, message: note, item };
  } catch (e) {
    logError('OUTWARD', qrCode, quantity, 'EXCEPTION', e.toString());
    return { success: false, error: e.toString() };
  }
}

// ============ LOGGING ============

function logAudit(operation, itemId, qty, user, status, endpoint, payload, response, error) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Audit_Log');
  if (sheet) sheet.appendRow([new Date(), operation, itemId, qty, user, status, endpoint, payload, response, error]);
}

function logError(operation, itemId, qty, errorType, msg) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Error_Queue');
  if (sheet) sheet.appendRow([new Date(), operation, itemId, qty, errorType, msg, 0, 'NO', '']);
}

// ============ HELPERS ============

function authHeaders(config) {
  return { authorization: `Bearer ${config.token}`, accept: 'application/json' };
}

function activeUser() {
  try { return Session.getActiveUser().getEmail(); } catch(e) { return 'unknown'; }
}

// ============ UI (Sheets modal — desktop use) ============

function openInwardScanner() {
  const html = HtmlService.createHtmlOutputFromFile('Scanner').setTitle('Scan QR - Inward').setWidth(600).setHeight(750);
  SpreadsheetApp.getUi().showModalDialog(html, '📦 Inward Scanner');
}

function openQCScanner() {
  const html = HtmlService.createHtmlOutputFromFile('ScannerQC').setTitle('QC Inspection').setWidth(600).setHeight(750);
  SpreadsheetApp.getUi().showModalDialog(html, '🔬 QC Inspection Scanner');
}

function openOutwardScanner() {
  const html = HtmlService.createHtmlOutputFromFile('ScannerOutward').setTitle('Scan QR - Outward').setWidth(600).setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, '📤 Outward Scanner');
}

function goToAuditLog() {
  const s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Audit_Log');
  if (s) SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(s);
}

function goToErrorQueue() {
  const s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Error_Queue');
  if (s) SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(s);
}

// ============ ONE-TIME CONFIG FETCH ============

function fetchConfigOptions() {
  const config = loadConfig();
  const cid = config.companyId;

  function get(url) {
    try {
      const r = UrlFetchApp.fetch(url, { headers: authHeaders(config), muteHttpExceptions: true });
      return r.getContentText();
    } catch(e) { return e.toString(); }
  }

  const results = {
    billing_addresses:  get(`${config.baseUrl}/settings/billing-address/get-addresses/?company_id=${cid}`),
    delivery_locations: get(`${config.baseUrl}/settings/delivery-location/get-locations/?company_id=${cid}`),
    doc_number_series:  get(`${config.baseUrl}/settings/document-number/get-document-number/?doc_type=inward&is_service=0`),
    stores:             get(`${config.baseUrl}/settings/store/get-stores/?company_id=${cid}`),
    units:              get(`${config.baseUrl}/settings/unit/get-units/?company_id=${cid}`),
    counter_parties:    get(`${config.baseUrl}/profile/counter-party/list/?target_category=supplier&exclude_dummy=true`)
  };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Audit_Log');
  Object.entries(results).forEach(([key, val]) => {
    sheet.appendRow([new Date(), 'CONFIG_FETCH', key, '', '', '', '', '', val, '']);
  });

  SpreadsheetApp.getUi().alert('Done! Check Audit_Log for stores and other IDs.');
}
