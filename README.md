# HH Career Ops — Cowork Plugin

AI-powered job search system for hh.ru (HeadHunter) — поиск вакансий через API, 6-блочная оценка, генерация PDF-резюме, отклики через AdsPower.

## Установка

В Claude Code/Cowork:
```
/plugin add ./hh-career-ops.plugin
```

Или из GitHub:
```
/plugin add github:mikhailov39/hh-career-ops
```

## Скиллы

| Скилл | Триггер | Что делает |
|-------|---------|-----------|
| `setup` | `/setup`, "настрой" | Первичная настройка: profile.yml, cv.md, тест API, AdsPower |
| `hh-search` | `/hh-search`, "найди вакансии" | Поиск через API hh.ru, фильтрация, дедупликация |
| `evaluate` | `/evaluate`, "оцени вакансию" | 6-блочная оценка с скорингом 1-5 |
| `cv-gen` | `/cv-gen`, "сгенерируй резюме" | PDF-резюме под конкретную вакансию |
| `tracker` | `/tracker`, "покажи трекер" | Управление трекером, статусы |
| `apply` | `/apply`, "откликнись" | Отклик через AdsPower с подтверждением |
| `batch` | `/batch`, "пакетный поиск" | Полный цикл: поиск → оценка → CV |

## Требования

**Обязательно:**
- Node.js 18+
- `npm install` (js-yaml, playwright)

**Для откликов:**
- AdsPower с MCP-подключением
- Залогиненный профиль hh.ru в AdsPower
- ID профиля прописан в `config/profile.yml`

## Первый запуск

1. Установи plugin
2. Создай рабочую папку для вакансий
3. Скопируй `profile.example.yml` → `config/profile.yml` и заполни
4. Скопируй `cv.example.md` → `cv.md` и заполни опытом
5. Запусти `/setup` для проверки
6. Готово: `/hh-search` для поиска

## Модели

Работает на любой модели Claude:
- **Opus** — лучший текст для `/evaluate`, `/cv-gen`
- **Sonnet** — достаточно для `/apply`, `/hh-search`
- **Haiku** — для простого поиска

## Файлы в рабочей папке

```
твой-проект/
├── config/profile.yml      # профиль кандидата
├── cv.md                   # резюме (источник правды)
├── data/tracker.md         # трекер вакансий
├── reports/                # отчёты оценки
└── output/                 # сгенерированные PDF
```

Плагин приносит: скиллы, скрипты, шаблоны. Все данные остаются в рабочей папке.

## Лицензия

MIT
