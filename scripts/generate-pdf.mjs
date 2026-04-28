#!/usr/bin/env node

/**
 * Генерация PDF-резюме из HTML-шаблона
 * Использование: node scripts/generate-pdf.mjs <html-file> <output-pdf>
 */

import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const htmlFile = process.argv[2];
const outputPdf = process.argv[3];

if (!htmlFile || !outputPdf) {
  console.error('Использование: node scripts/generate-pdf.mjs <html-file> <output-pdf>');
  process.exit(1);
}

async function generatePdf() {
  const htmlPath = resolve(ROOT, htmlFile);
  const pdfPath = resolve(ROOT, outputPdf);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const html = readFileSync(htmlPath, 'utf8');
  await page.setContent(html, { waitUntil: 'networkidle' });

  await page.pdf({
    path: pdfPath,
    format: 'A4',
    margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
    printBackground: true,
  });

  await browser.close();
  console.log(`✅ PDF сохранён: ${pdfPath}`);
}

generatePdf().catch(err => {
  console.error('Ошибка генерации PDF:', err.message);
  process.exit(1);
});
