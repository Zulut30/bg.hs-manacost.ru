# BG HS-Manacost

Battlegrounds-раздел Manacost на базе React, TypeScript, Vite и Express. Проект объединяет дизайн и авторизацию HS-Arena с инструментами для Полей сражений: тир-листы, конструктор стратегий, конструктор тир-листов и отдельный тир-лист героев.

## Что внутри

- **Главная**: навигационная точка для BG-разделов.
- **Конструкторы**: выпадающее меню с `/classes` и `/legendaries`.
- **`/classes`**: нативно встроенный конструктор стратегий с библиотекой карт, фильтрами, быстрыми слотами, слотами сообщества, аннотациями, фонами и экспортом PNG/WebP.
- **`/legendaries`**: drag-and-drop конструктор тир-листов для героев, существ, заклинаний и аксессуаров.
- **`/tierlist`**: тир-листы существ, стратегий, заклинаний и аксессуаров с лайтбоксами и фильтрами.
- **`/heroes`**: тир-лист героев Полей сражений по тирам со средним местом и популярностью.
- **`/articles`**: статьи и гайды с общей системой авторизации.

## Технологии

| Слой | Стек |
| --- | --- |
| Frontend | React 19, TypeScript 5.8, Vite 6, Tailwind CSS 4, Lucide React |
| Backend | Express, Redis, cron jobs, proxy endpoints для BG-данных |
| Assets | Legacy BG card data, hero portraits, trinkets, tavern/race icons, board wallpapers |
| Auth | Telegram/OpenID flow через общий Manacost backend |
| Build | `npm run build` + prerender статических маршрутов |

## Основные команды

```bash
npm install
npm run dev
npm run lint
npm run build
```

Production-сборка создаёт `dist/` и prerender-страницы для:

```text
/
/classes
/tierlist
/legendaries
/heroes
/articles
```

## Структура

```text
.
├── api/                    # serverless/API compatibility layer
├── public/
│   ├── bg-legacy/          # BG assets and legacy builder engines
│   ├── class_icon/         # arena/class icons kept for shared UI
│   ├── main_assets/        # shared site imagery
│   ├── robots.txt
│   └── sitemap.xml
├── scripts/
│   └── prerender.js        # route HTML/SEO prerender
├── server/
│   ├── index.ts            # Express API and proxy routes
│   └── scraper.ts          # Arena-era scraper utilities still used by shared code
├── src/
│   ├── App.tsx             # main BG app shell and routes
│   ├── index.css           # global site styling
│   └── features/           # deferred legacy Arena components
├── design.md               # product/design notes and constraints
└── package.json
```

## BG Legacy Layer

The BG tools reuse the working mechanics from the old Battlegrounds site while being embedded into the current HS-Manacost shell:

- `public/bg-legacy/strategy-builder.js`: strategy canvas, filters, quick slots, community slots, annotations and export.
- `public/bg-legacy/hero-tier-builder.js`: tier-list builder, card pool filters, board rows and export.
- `public/bg-legacy/tier-data.js`: hero tier source used by `/heroes`.
- `public/bg-legacy/accessories-data.js`: trinket/accessory data.
- `public/bg-legacy/comps-data.js`: meta composition data for ready-made strategy builds.

Keep these files lightweight and avoid adding heavy runtime dependencies. Most UI controls are plain DOM/CSS for fast load and low re-render cost.

## Design Rules

- Dark BG tool surfaces must keep text readable: avoid bright blue active states on dark panels unless text contrast is checked.
- Filters should be compact and collapsible where possible.
- Tavern filters use tavern icons, creature filters use race icons.
- Cards and trinkets should remain individual objects, not flattened screenshots, so future statistics and lightboxes can attach to them.
- Background chips must preview the actual board wallpaper.

## Verification Checklist

Before pushing changes:

```bash
npm run lint
npm run build
```

Recommended browser smoke checks:

- `/classes`: card library loads, filters collapse, board backgrounds preview, export buttons are present.
- `/legendaries`: card pool loads, filters collapse, row-count slider changes pool columns, background previews work.
- `/tierlist`: minions, strategies, spells and accessories switch smoothly and lightboxes open.
- `/heroes`: hero tiers render with portraits, average placement and popularity.

## Deployment Notes

The current production host is:

```text
https://bg.hs-manacost.ru
```

`robots.txt`, `sitemap.xml`, `vercel.json` and `scripts/prerender.js` should stay aligned whenever a route is added or renamed.
