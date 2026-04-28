#!/usr/bin/env node
// Append rows to Google Sheets via Apps Script webhook.
// Usage:
//   node append-to-sheet.mjs <webhook_url> '<json_array_of_rows>'
//   node append-to-sheet.mjs --webhook=URL --rows='[["a","b"],["c","d"]]'
//
// The Apps Script web app (deployed by the user once) should:
//   - Accept POST with JSON body { rows: [[...], [...]] }
//   - Append each row to the active sheet
//   - Return { ok: true, added: N }
//
// Setup template (Apps Script, paste into the linked Sheet → Extensions → Apps Script):
//
//   function doPost(e) {
//     const body = JSON.parse(e.postData.contents);
//     const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(body.tab || 'Tracker')
//                 || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
//     body.rows.forEach(r => sheet.appendRow(r));
//     return ContentService.createTextOutput(JSON.stringify({ ok: true, added: body.rows.length }))
//       .setMimeType(ContentService.MimeType.JSON);
//   }
//
// Then deploy → Web app → Execute as: Me, Access: Anyone → copy the /exec URL.

const args = process.argv.slice(2);
let webhook, rowsJson, tab;
for (const arg of args) {
  if (arg.startsWith('--webhook=')) webhook = arg.slice(10);
  else if (arg.startsWith('--rows=')) rowsJson = arg.slice(7);
  else if (arg.startsWith('--tab=')) tab = arg.slice(6);
  else if (!webhook) webhook = arg;
  else if (!rowsJson) rowsJson = arg;
}

if (!webhook || !rowsJson) {
  console.error('Usage: node append-to-sheet.mjs <webhook_url> <json_rows> [--tab=TabName]');
  process.exit(1);
}

let rows;
try { rows = JSON.parse(rowsJson); }
catch (e) { console.error('Invalid JSON for rows:', e.message); process.exit(1); }

if (!Array.isArray(rows) || !rows.every(Array.isArray)) {
  console.error('rows must be array of arrays');
  process.exit(1);
}

const body = { rows };
if (tab) body.tab = tab;

try {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'follow',
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${text}`);
    process.exit(2);
  }
  console.log(text);
} catch (e) {
  console.error('Request failed:', e.message);
  process.exit(3);
}
