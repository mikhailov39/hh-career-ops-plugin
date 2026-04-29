---
name: auto-apply
description: "Multi-tenant automated batch apply for hh.ru via AdsPower. Searches, filters, applies, dual-tracks (per-user markdown + per-user Google Sheet via service account), commits to git. Use when user says 'auto-apply', 'автоприменение', 'батч откликов', 'давай N откликов для {user}', '/auto-apply'. Designed to run on Sonnet/Haiku with arguments: user, profile_id, count."
---

# Auto-Apply: мультитенантный авто-откликатор для hh.ru

## Что делает

Полный цикл откликов **для конкретного hh.ru-юзера** через залогиненный AdsPower-профиль:
- Подключается к AdsPower
- Ищет вакансии по запросам из конфига юзера
- Дедупликация по персональному Google Sheet
- Откликается с генерацией сопроводительных где требуется
- **Двойной трекинг:** `users/{user}/data/tracker.md` (audit log в git) + персональный Google Sheet (через service account)
- Коммит markdown в git

**Мультитенант:** каждый hh-юзер — папка `users/{user}/` со своим CV, профилем, трекером, Sheet.

## Как использовать

```
/auto-apply user=mikhailov39 profile=373 count=10
/auto-apply user=katyahh profile=42 count=20
/auto-apply mikhailov39 373 10
/auto-apply mikhailov39        # count=10, profile из profile.yml
```

**Аргументы:**
- `user` — обязательно. Имя hh.ru-аккаунта = папка `users/{user}/`
- `profile` — номер профиля AdsPower. Иначе из profile.yml
- `count` — сколько откликов (default 10, max 30)

## Структура

```
{repo_root}/
├── secrets/
│   ├── google-sa.json            # Service account JSON (gitignored)
│   └── hh-cookies-{user}.txt     # cookie header для синка истории (gitignored)
├── users/
│   ├── mikhailov39/
│   │   ├── profile.yml          # adspower.profile_id, sheets.spreadsheet_id
│   │   ├── cv.md
│   │   ├── queries.yml          # опционально
│   │   ├── data/
│   │   │   ├── tracker.md       # markdown audit log
│   │   │   └── applications.json # snapshot истории с hh.ru
│   │   ├── reports/
│   │   └── output/
│   └── katyahh/...
├── templates/queries.yml         # fallback запросы
└── plugin/hh-career-ops/scripts/
    ├── search-hh.mjs
    ├── generate-pdf.mjs
    ├── sheets-helper.mjs         # create-sheet/append/read через SA
    ├── hh-fetch-applications.mjs # парсинг истории hh.ru через cookies
    ├── local-receiver.mjs        # one-shot HTTP receiver (для browser→file)
    └── sync-history-to-sheet.mjs # one-shot: applications.json → Sheet
```

## profile.yml — секция Sheets

```yaml
sheets:
  spreadsheet_id: "1XXe..."                       # ID Google Sheet
  spreadsheet_url: "https://docs.google.com/..."
  tab: "Tracker"
  service_account_email: "lobster@lobster-tools.iam.gserviceaccount.com"
adspower:
  profile_id: "373"
  user_id: "k1bhhbio"
  account: "mikhailov39"
```

## Инструкции

### Шаг 1: Резолв воркспейса

1. Запарсь аргументы. Если `user` не передан — спроси.
2. `USER_DIR = users/{user}/`
3. Если папки нет — создай (`data/`, `reports/`, `output/`), скопируй шаблоны:
   ```bash
   cp config/profile.example.yml users/{user}/profile.yml
   cp cv.example.md users/{user}/cv.md
   ```
4. Если новый юзер — нужно **создать Google Sheet** (см. Шаг 1.5).
5. Прочитай:
   - `users/{user}/profile.yml`
   - `users/{user}/cv.md`
   - `users/{user}/data/tracker.md` — собери set HH ID для дедупа

### Шаг 1.5: Создание Sheet для нового юзера

Service account `lobster@lobster-tools.iam.gserviceaccount.com` **не может создавать Sheets сам** (нет Drive quota без Workspace). Поэтому для каждого нового юзера один раз вручную:

1. Юзер создаёт пустой Sheet: https://sheets.new
2. Переименовывает вкладку в `Tracker`
3. Share → editor: `lobster@lobster-tools.iam.gserviceaccount.com`
4. Копирует URL → вставляет в `users/{user}/profile.yml > sheets.spreadsheet_url`

Дальше скилл пишет туда автоматом через Sheets API.

**Если нужна полная автоматика создания** — настрой Workspace + Shared Drive (Manager-доступ для SA), тогда:
```bash
node plugin/hh-career-ops/scripts/sheets-helper.mjs create-sheet \
  --title="HH Tracker — {user}" \
  --share-with={user}@gmail.com
```

### Шаг 2: AdsPower

1. `profile_id` из аргументов или `users/{user}/profile.yml > adspower.profile_id`
2. `mcp__adspower-local-api__get-opened-browser`
3. Если профиля нет — попроси открыть, дождись подтверждения
4. `connect-browser-with-ws` с `ws.puppeteer`
5. CDP timeout → попроси перезапустить профиль

### Шаг 3: Сбор пула вакансий

Запросы из `users/{user}/queries.yml` или fallback `templates/queries.yml`.

Для каждого:
1. URL: `https://hh.ru/search/vacancy?text={URL_ENCODED}&area={area_id}&salary={salary_from}&order_by=publication_time&search_period=7&items_on_page=50`
2. `navigate` → `evaluate-script`:
   ```js
   const cards = Array.from(document.querySelectorAll('[data-qa="vacancy-serp__vacancy"]'));
   cards.map(c => {
     const link = c.querySelector('[data-qa="serp-item__title"]');
     const id = link?.href?.match(/vacancy\/(\d+)/)?.[1];
     return { id, title: link?.textContent?.trim(), company: c.querySelector('[data-qa="vacancy-serp__vacancy-employer"]')?.textContent?.trim(), salary: c.querySelector('[data-qa="vacancy-serp__vacancy-compensation"]')?.textContent?.trim(), alreadyApplied: c.innerText.includes('Вы откликнулись') };
   });
   ```
3. Стоп при `count * 3` кандидатов

### Шаг 4: Фильтрация

- ID в персональном трекере → drop
- `alreadyApplied` → drop
- Negative keywords → drop
- Title явно вне target_roles → drop

Возьми первые `count`.

### Шаг 5: Цикл откликов

Для каждой вакансии:
1. `navigate https://hh.ru/vacancy/{id}`
2. Считай title, company, salary
3. `click-element [data-qa="vacancy-response-link-top"]`
4. Modal:
   ```js
   const m = document.querySelector('[data-qa="modal-overlay"]');
   ({ text: m?.innerText, letterRequired: m?.innerText?.includes('обязательное'), languageBlocker: !!m?.innerText?.match(/(Арабский|Китайский|Иврит|Турецкий|Корейский) язык.*ниже обязательного/) });
   ```
5. languageBlocker → `Escape`, skipped, next
6. letterRequired → сгенерируй сопроводительное (см. ниже), `fill-input [data-qa="vacancy-response-popup-form-letter-input"]`
7. `click-element [data-qa="vacancy-response-submit-popup"]`
8. Verify `Вы откликнулись`. Если нет с 2 попыток — failed, continue
9. Локально буферь: `{ id, title, company, salary, hadLetter, status, date }`

### Шаг 6: Сопроводительное

База: `users/{user}/profile.yml > positioning.strengths` и `proof_points`. Каркас:

> Здравствуйте! [1 предл. про релевантный опыт + ключевая метрика]. [1 предл. про AI-стек если в title есть AI/автоматизация]. Готов созвониться. {first_name}, {website или telegram}

**Жёсткое правило:** только реальное из cv.md. Не выдумывай.

### Шаг 7: Markdown трекер

`users/{user}/data/tracker.md`. Найди max N. Добавь строки:
```
| {N+i} | {YYYY-MM-DD} | {Компания} | {Должность} | {ЗП или —} | — | {Отклик / Отклик+письмо} | {имя hh-резюме} | — | {HH_ID} |
```

### Шаг 8: Google Sheet

Если в profile.yml есть `sheets.spreadsheet_id`:

```bash
node plugin/hh-career-ops/scripts/sheets-helper.mjs append \
  --id={spreadsheet_id} \
  --tab={tab} \
  --rows='[["YYYY-MM-DD", "Компания", "Должность", "Статус", "HH_ID", "URL"], ...]'
```

Колонки Sheet (6): `Date | Company | Title | Status | HH ID | URL` (без `#` — порядок строк = порядок добавления).

Для больших батчей (>50 строк) используй `--rows-file=path/to/rows.json` вместо `--rows='...'` (Windows command-line limit).

Скрипт использует service account из `secrets/google-sa.json` (или `GOOGLE_SA_PATH` env).

Если ошибка `PERMISSION_DENIED` — юзер не зашарил Sheet с SA email. Сообщи и не падай.

### Шаг 9: Git commit

```bash
cd "{repo_root}"
git add users/{user}/data/tracker.md
git commit -m "Auto-apply [{user}]: {N} applications sent (profile={profile_id}, {date})"
git pull --rebase origin master
git push origin master
```

### Шаг 10: Итог

```
✅ Auto-apply для {user}
Профиль AdsPower: {profile_id}

Отправлено: {N} из {count}
- С сопроводительным: {L}
- Пропущено по языку: {K}
- Failed: {F}

| # | Компания | Роль | ЗП | Письмо |
|---|----------|------|----|--------|
...

Markdown трекер: users/{user}/data/tracker.md (всего {total})
Google Sheet: {spreadsheet_url}
Коммит: {hash}
```

## Импорт истории откликов с hh.ru

Если у юзера уже есть отклики на hh.ru (до использования скилла):

1. Получи cookies из его залогиненного AdsPower-профиля:
   ```js
   // в browser dev tools или через evaluate-script
   document.cookie
   ```
2. Сохрани в `secrets/hh-cookies-{user}.txt`
3. Запусти one-shot receiver:
   ```bash
   node plugin/hh-career-ops/scripts/local-receiver.mjs \
     --port=9999 --out=users/{user}/data/applications.json --timeout=120000 &
   ```
4. Через AdsPower выполни fetch + POST:
   ```js
   // evaluate-script в браузере
   (async () => {
     const items = [];
     for (let p = 0; p < 12; p++) {
       const html = await fetch(`https://hh.ru/applicant/negotiations?page=${p}`, { credentials: 'include' }).then(r => r.text());
       const doc = new DOMParser().parseFromString(html, 'text/html');
       doc.querySelectorAll('[data-qa="negotiations-item"]').forEach(c => {
         const link = c.querySelector('[data-qa="negotiations-item-vacancy"]');
         items.push({
           id: link?.href?.match(/vacancy\/(\d+)/)?.[1] || '',
           title: link?.textContent?.trim() || '',
           company: c.querySelector('[data-qa="negotiations-item-company"]')?.textContent?.trim() || '',
           date: c.querySelector('[data-qa="negotiations-item-date"]')?.textContent?.trim() || '',
           status: c.querySelector('[data-qa^="negotiations-tag negotiations-item-"]')?.textContent?.trim() || '',
           url: link?.href || '',
         });
       });
     }
     return await fetch('http://127.0.0.1:9999/save', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(items) }).then(r=>r.text());
   })();
   ```
5. Залей в Sheet:
   ```bash
   node plugin/hh-career-ops/scripts/sync-history-to-sheet.mjs \
     --json=users/{user}/data/applications.json \
     --id={spreadsheet_id} --tab=Tracker --include-header
   ```

## Важные правила

1. **Изоляция юзеров:** только `users/{user}/`. Не смешивай.
2. **Дедуп** по HH ID из персонального трекера.
3. **Не придумывай опыт** — только реальное из `users/{user}/cv.md`.
4. **Двойной трекинг:** markdown в git + Google Sheet через SA.
5. **Max count=30** за прогон.
6. **secrets/** должно быть в `.gitignore`.
7. **Если SA не имеет доступа** к Sheet — сообщи юзеру, не падай.

## Запасные планы

- 403 от hh.ru API → всё через AdsPower-браузер
- Мало вакансий → расширь search_period до 14, добавь запасные запросы
- SA Drive quota exceeded → юзеру создавать Sheet вручную и шарить с SA
