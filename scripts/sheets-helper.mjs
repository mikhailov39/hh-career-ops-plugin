#!/usr/bin/env node
/**
 * Google Sheets helper for hh-career-ops via service account.
 *
 * Subcommands:
 *   create-sheet --title="..." --share-with=email1,email2 [--sa=path]
 *     Creates a new Sheet, shares with given emails as editors. Prints { id, url }.
 *
 *   append --id=SHEET_ID --rows='[[...],[...]]' [--tab=Tracker] [--sa=path]
 *     Appends rows to specified Sheet/tab. Creates tab if missing. Prints { added }.
 *
 *   read --id=SHEET_ID [--tab=Tracker] [--sa=path]
 *     Reads all rows from tab. Prints JSON array.
 *
 * --sa defaults to {repo_root}/secrets/google-sa.json
 */

import { google } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) args[a.slice(2, eq)] = a.slice(eq + 1);
      else args[a.slice(2)] = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'secrets', 'google-sa.json'))) return dir;
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

function getAuth(saPath) {
  const root = findRepoRoot(process.cwd());
  const keyFile = saPath || process.env.GOOGLE_SA_PATH || path.join(root, 'secrets', 'google-sa.json');
  if (!fs.existsSync(keyFile)) {
    console.error(`Service account JSON not found at: ${keyFile}`);
    console.error('Pass --sa=/path or set GOOGLE_SA_PATH env var.');
    process.exit(2);
  }
  return new google.auth.GoogleAuth({
    keyFile,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
}

async function createSheet({ title, shareWith, sa }) {
  const auth = getAuth(sa);
  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });

  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [{ properties: { title: 'Tracker' } }],
    },
    fields: 'spreadsheetId,spreadsheetUrl',
  });
  const id = res.data.spreadsheetId;
  const url = res.data.spreadsheetUrl;

  if (shareWith && shareWith.length) {
    for (const email of shareWith) {
      try {
        await drive.permissions.create({
          fileId: id,
          requestBody: { type: 'user', role: 'writer', emailAddress: email },
          sendNotificationEmail: false,
        });
      } catch (e) {
        console.error(`Failed to share with ${email}: ${e.message}`);
      }
    }
  }
  return { id, url };
}

async function ensureTab({ sheets, id, tab }) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties' });
  const exists = meta.data.sheets.some(s => s.properties.title === tab);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
  }
}

async function appendRows({ id, tab, rows, sa }) {
  const auth = getAuth(sa);
  const sheets = google.sheets({ version: 'v4', auth });
  await ensureTab({ sheets, id, tab });
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: id,
    range: `${tab}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
  return { added: rows.length, updates: res.data.updates };
}

async function readRows({ id, tab, sa }) {
  const auth = getAuth(sa);
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: tab,
  });
  return res.data.values || [];
}

async function replaceRows({ id, tab, rows, sa }) {
  const auth = getAuth(sa);
  const sheets = google.sheets({ version: 'v4', auth });
  await ensureTab({ sheets, id, tab });
  // Clear the entire tab first
  await sheets.spreadsheets.values.clear({
    spreadsheetId: id,
    range: tab,
  });
  // Write rows starting at A1
  const res = await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${tab}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
  return { written: rows.length, updates: res.data };
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

try {
  if (cmd === 'create-sheet') {
    const title = args.title || `HH Tracker — ${new Date().toISOString().slice(0,10)}`;
    const shareWith = (args['share-with'] || '').split(',').map(s => s.trim()).filter(Boolean);
    const out = await createSheet({ title, shareWith, sa: args.sa });
    console.log(JSON.stringify(out));
  } else if (cmd === 'append') {
    if (!args.id) { console.error('--id required'); process.exit(1); }
    if (!args.rows) { console.error('--rows JSON required'); process.exit(1); }
    const rows = JSON.parse(args.rows);
    const tab = args.tab || 'Tracker';
    const out = await appendRows({ id: args.id, tab, rows, sa: args.sa });
    console.log(JSON.stringify(out));
  } else if (cmd === 'read') {
    if (!args.id) { console.error('--id required'); process.exit(1); }
    const tab = args.tab || 'Tracker';
    const out = await readRows({ id: args.id, tab, sa: args.sa });
    console.log(JSON.stringify(out));
  } else if (cmd === 'replace') {
    if (!args.id) { console.error('--id required'); process.exit(1); }
    if (!args.rows) { console.error('--rows JSON required'); process.exit(1); }
    const rows = JSON.parse(args.rows);
    const tab = args.tab || 'Tracker';
    const out = await replaceRows({ id: args.id, tab, rows, sa: args.sa });
    console.log(JSON.stringify(out));
  } else {
    console.error('Usage:');
    console.error('  node sheets-helper.mjs create-sheet --title="..." --share-with=email1,email2');
    console.error('  node sheets-helper.mjs append --id=SHEET_ID --rows=\'[[...]]\' [--tab=Tracker]');
    console.error('  node sheets-helper.mjs read --id=SHEET_ID [--tab=Tracker]');
    process.exit(1);
  }
} catch (e) {
  console.error('Error:', e.message);
  if (e.response?.data) console.error(JSON.stringify(e.response.data, null, 2));
  process.exit(3);
}
