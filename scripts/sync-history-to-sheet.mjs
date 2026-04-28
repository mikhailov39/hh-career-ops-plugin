#!/usr/bin/env node
// One-shot: read applications.json and append all rows to a Sheet via sheets-helper.
// Usage: node sync-history-to-sheet.mjs --json=path --id=SHEET_ID [--tab=Tracker] [--include-header]

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const eq = a.indexOf('=');
  if (a.startsWith('--') && eq > 0) return [a.slice(2, eq), a.slice(eq + 1)];
  return [a.replace(/^--/, ''), true];
}));

if (!args.json || !args.id) {
  console.error('Usage: node sync-history-to-sheet.mjs --json=path --id=SHEET_ID [--tab=Tracker] [--include-header]');
  process.exit(1);
}

const items = JSON.parse(fs.readFileSync(args.json, 'utf8'));
const tab = args.tab || 'Tracker';

// Normalize relative Russian dates to ISO YYYY-MM-DD
const MONTHS_RU = {
  'январ': '01', 'феврал': '02', 'март': '03', 'апрел': '04',
  'мая': '05', 'мае': '05', 'июн': '06', 'июл': '07', 'август': '08',
  'сентябр': '09', 'октябр': '10', 'ноябр': '11', 'декабр': '12',
};
function normalizeDate(s, today = new Date()) {
  if (!s) return '';
  const lo = s.toLowerCase().trim();
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (lo === 'сегодня') return t.toISOString().slice(0, 10);
  if (lo === 'вчера') {
    const y = new Date(t); y.setDate(y.getDate() - 1);
    return y.toISOString().slice(0, 10);
  }
  if (lo === 'позавчера') {
    const y = new Date(t); y.setDate(y.getDate() - 2);
    return y.toISOString().slice(0, 10);
  }
  // Match "DD месяц" like "26 апреля"
  const m = lo.match(/^(\d{1,2})\s+([а-яё]+)/);
  if (m) {
    const day = m[1].padStart(2, '0');
    const monKey = Object.keys(MONTHS_RU).find(k => m[2].startsWith(k));
    if (monKey) {
      const mon = MONTHS_RU[monKey];
      let year = t.getFullYear();
      // If parsed date is in the future relative to today, assume previous year
      const candidate = new Date(`${year}-${mon}-${day}T00:00:00`);
      if (candidate > t) year -= 1;
      return `${year}-${mon}-${day}`;
    }
  }
  // Already YYYY-MM-DD or unknown — return as is
  return s;
}

const rows = [];
if (args['include-header']) {
  rows.push(['#', 'Date', 'Company', 'Title', 'Status', 'HH ID', 'URL']);
}
items.forEach((item, idx) => {
  rows.push([
    idx + 1,
    normalizeDate(item.date),
    item.company || '',
    item.title || '',
    item.status || '',
    item.id || '',
    item.url || '',
  ]);
});

const mode = args.mode === 'replace' ? 'replace' : 'append';
console.error(`${mode === 'replace' ? 'Replacing' : 'Appending'} ${rows.length} rows in sheet ${args.id} (tab: ${tab})...`);

const helper = path.join(__dirname, 'sheets-helper.mjs');
const result = spawnSync('node', [helper, mode, `--id=${args.id}`, `--tab=${tab}`, `--rows=${JSON.stringify(rows)}`], {
  stdio: ['ignore', 'inherit', 'inherit'],
});

process.exit(result.status || 0);
