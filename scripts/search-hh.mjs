#!/usr/bin/env node

/**
 * Поиск вакансий через API hh.ru
 * Использование: node scripts/search-hh.mjs [--query "текст"] [--all] [--limit N]
 */

import { readFileSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';
const { load: parse } = yaml;
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const API_BASE = 'https://api.hh.ru';
const USER_AGENT = 'HHCareerOps/1.0 (job-search-automation)';

// Парсинг аргументов
const args = process.argv.slice(2);
const singleQuery = args.includes('--query') ? args[args.indexOf('--query') + 1] : null;
const runAll = args.includes('--all');
const limitArg = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 5;

// Загрузка конфига
const queriesConfig = parse(readFileSync(resolve(ROOT, 'templates/queries.yml'), 'utf8'));
const defaults = queriesConfig.defaults;
const filters = queriesConfig.filters;

// Загрузка трекера для дедупликации
function loadTrackerIds() {
  try {
    const tracker = readFileSync(resolve(ROOT, 'data/tracker.md'), 'utf8');
    const ids = new Set();
    for (const line of tracker.split('\n')) {
      const match = line.match(/\|\s*(\d{5,})\s*\|?\s*$/);
      if (match) ids.add(match[1]);
    }
    return ids;
  } catch {
    return new Set();
  }
}

// Запрос к API hh.ru
async function fetchVacancies(text, page = 0) {
  const params = new URLSearchParams({
    text,
    area: String(defaults.area),
    salary: String(defaults.salary_from),
    per_page: String(defaults.per_page),
    order_by: defaults.order_by,
    page: String(page),
  });

  const url = `${API_BASE}/vacancies?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!res.ok) {
    console.error(`API error ${res.status}: ${await res.text()}`);
    return null;
  }

  return res.json();
}

// Получить полное описание вакансии
async function fetchVacancyDetails(id) {
  const res = await fetch(`${API_BASE}/vacancies/${id}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) return null;
  return res.json();
}

// Фильтрация по title keywords
function matchesFilters(vacancy) {
  const title = vacancy.name.toLowerCase();

  // Проверка негативных фильтров
  for (const neg of filters.title_negative) {
    if (title.includes(neg.toLowerCase())) return false;
  }

  return true;
}

// Форматирование зарплаты
function formatSalary(salary) {
  if (!salary) return 'не указана';
  const from = salary.from ? `${(salary.from / 1000).toFixed(0)}к` : '';
  const to = salary.to ? `${(salary.to / 1000).toFixed(0)}к` : '';
  const gross = salary.gross ? ' gross' : ' net';
  if (from && to) return `${from}-${to}${gross}`;
  if (from) return `от ${from}${gross}`;
  if (to) return `до ${to}${gross}`;
  return 'не указана';
}

// Форматирование формата работы
function formatWorkFormat(vacancy) {
  if (vacancy.work_format && vacancy.work_format.length > 0) {
    return vacancy.work_format.map(f => f.name).join(', ');
  }
  if (vacancy.schedule) return vacancy.schedule.name;
  return '';
}

// Основной поиск
async function search() {
  const trackerIds = loadTrackerIds();
  const allResults = [];
  const seenIds = new Set();

  const queries = singleQuery
    ? [{ text: singleQuery, priority: 0 }]
    : queriesConfig.queries;

  const maxPages = singleQuery ? 3 : 1;

  for (const q of queries) {
    console.error(`\n🔍 Поиск: "${q.text}" (приоритет ${q.priority ?? '?'})...`);

    for (let page = 0; page < maxPages; page++) {
      const data = await fetchVacancies(q.text, page);
      if (!data || !data.items || data.items.length === 0) break;

      console.error(`  Страница ${page + 1}: ${data.items.length} вакансий (всего найдено: ${data.found})`);

      for (const v of data.items) {
        if (seenIds.has(v.id) || trackerIds.has(v.id)) continue;
        if (!matchesFilters(v)) continue;

        seenIds.add(v.id);
        allResults.push({
          id: v.id,
          title: v.name,
          company: v.employer?.name ?? 'N/A',
          salary: formatSalary(v.salary),
          format: formatWorkFormat(v),
          area: v.area?.name ?? '',
          url: v.alternate_url,
          published: v.published_at?.slice(0, 10) ?? '',
          snippet: v.snippet?.requirement?.replace(/<[^>]*>/g, '') ?? '',
          query: q.text,
          priority: q.priority ?? 99,
        });
      }

      // Пауза между запросами
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Сортировка: по приоритету запроса, потом по дате
  allResults.sort((a, b) => a.priority - b.priority || b.published.localeCompare(a.published));

  // Лимит
  const limited = runAll ? allResults : allResults.slice(0, limitArg);

  // Вывод в JSON
  const output = {
    total_found: allResults.length,
    showing: limited.length,
    new_since_tracker: allResults.length,
    results: limited,
  };

  console.log(JSON.stringify(output, null, 2));

  // Также сохранить полные результаты
  writeFileSync(
    resolve(ROOT, 'data/last-search.json'),
    JSON.stringify(output, null, 2),
    'utf8'
  );
  console.error(`\n✅ Найдено ${allResults.length} новых вакансий, показано ${limited.length}`);
  console.error(`📄 Результаты сохранены в data/last-search.json`);
}

search().catch(err => {
  console.error('Ошибка:', err.message);
  process.exit(1);
});
