#!/usr/bin/env node
// Local HTTP receiver — single-shot. Listens on port, writes posted body to file, exits.
// Usage: node local-receiver.mjs --port=9999 --out=path/to/file.json [--timeout=120000]

import http from 'node:http';
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const eq = a.indexOf('=');
  if (a.startsWith('--') && eq > 0) return [a.slice(2, eq), a.slice(eq + 1)];
  return [a.replace(/^--/, ''), true];
}));

const port = parseInt(args.port || '9999', 10);
const out = args.out || 'received.json';
const timeout = parseInt(args.timeout || '120000', 10);

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.end(); return; }
  if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    fs.writeFileSync(out, buf);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, bytes: buf.length }));
    console.log(`Saved ${buf.length} bytes to ${out}`);
    setTimeout(() => server.close(() => process.exit(0)), 200);
  });
});

server.listen(port, () => console.log(`listening on ${port}, will save to ${out}`));

setTimeout(() => {
  console.error('Timeout');
  server.close(() => process.exit(2));
}, timeout);
