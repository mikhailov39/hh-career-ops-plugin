#!/usr/bin/env node
/**
 * Fetch hh.ru application history (negotiations) using session cookies.
 *
 * Usage:
 *   node hh-fetch-applications.mjs --cookies-file=path [--max-pages=12] [--out=file.json]
 *
 * Provide cookies as a file containing the raw `Cookie:` header value
 * (e.g. `name1=value1; name2=value2`). Get from browser devtools or
 * `document.cookie` in the AdsPower profile.
 *
 * Output: prints JSON array to stdout (or saves to --out).
 */

import fs from 'node:fs';
import { JSDOM } from 'jsdom';

function parseArgs(argv) {
  const args = {};
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) args[a.slice(2, eq)] = a.slice(eq + 1);
      else args[a.slice(2)] = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const cookiesFile = args['cookies-file'];
const maxPages = parseInt(args['max-pages'] || '12', 10);
const outFile = args.out;

if (!cookiesFile) {
  console.error('--cookies-file required');
  process.exit(1);
}

const cookies = fs.readFileSync(cookiesFile, 'utf8').trim();

const headers = {
  'Cookie': cookies,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'ru,en;q=0.9',
};

async function fetchPage(page) {
  const url = `https://hh.ru/applicant/negotiations?page=${page}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} on page ${page}`);
  return await res.text();
}

function parseHTML(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const cards = doc.querySelectorAll('[data-qa="negotiations-item"]');
  const items = [];
  cards.forEach(c => {
    const vacLink = c.querySelector('[data-qa="negotiations-item-vacancy"]');
    const company = c.querySelector('[data-qa="negotiations-item-company"]')?.textContent?.trim() || '';
    const date = c.querySelector('[data-qa="negotiations-item-date"]')?.textContent?.trim() || '';
    const tagEl = c.querySelector('[data-qa^="negotiations-tag negotiations-item-"]');
    const tag = tagEl?.textContent?.trim() || '';
    const href = vacLink?.getAttribute('href') || '';
    const id = href.match(/vacancy\/(\d+)/)?.[1] || '';
    const title = vacLink?.textContent?.trim() || '';
    items.push({ id, title, company, date, status: tag, url: href ? `https://hh.ru${href.startsWith('/') ? '' : '/'}${href.replace(/^https?:\/\/hh\.ru/, '')}` : '' });
  });
  return items;
}

const all = [];
for (let p = 0; p < maxPages; p++) {
  try {
    const html = await fetchPage(p);
    const items = parseHTML(html);
    if (items.length === 0) break;
    all.push(...items);
    process.stderr.write(`page ${p}: +${items.length} (total ${all.length})\n`);
    await new Promise(r => setTimeout(r, 200));
  } catch (e) {
    process.stderr.write(`page ${p}: ${e.message}\n`);
    break;
  }
}

const out = JSON.stringify(all, null, 2);
if (outFile) {
  fs.writeFileSync(outFile, out);
  console.log(`Saved ${all.length} items to ${outFile}`);
} else {
  console.log(out);
}
