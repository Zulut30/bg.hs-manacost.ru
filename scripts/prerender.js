import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';

const SITE_URL = 'https://bg.hs-manacost.ru';

const PAGES = {
  '/': {
    title: 'Поля сражений Hearthstone — тир-листы и конструкторы | HS-Manacost',
    description: 'Поля сражений от Манакоста: тир-листы существ, стратегий, заклинаний, аксессуаров, героев, библиотека карт и конструкторы для Battlegrounds.',
    h1: 'Поля сражений Hearthstone от Манакоста',
    canonical: '/',
    ogType: 'website',
    structuredData: [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        "url": SITE_URL,
          "name": "Поля сражений от Манакоста",
          "description": "Тир-листы, библиотека карт и конструкторы для режима Поля сражений Hearthstone",
        "inLanguage": "ru",
        "publisher": {
          "@type": "Organization",
          "name": "Manacost",
          "url": "https://t.me/manacost_ru",
          "logo": { "@type": "ImageObject", "url": `${SITE_URL}/assets/arena_icon.webp` }
        }
      },
      {
        "@type": "WebApplication",
        "@id": `${SITE_URL}/#app`,
        "name": "Поля сражений от Манакоста",
        "url": SITE_URL,
        "description": "Тир-листы существ, стратегий, заклинаний, аксессуаров, героев, библиотека карт и конструкторы для Battlegrounds.",
        "applicationCategory": "GameApplication",
        "operatingSystem": "Web",
        "inLanguage": "ru",
        "offers": { "@type": "Offer", "price": "0", "priceCurrency": "RUB" },
        "featureList": [
          "Тир-лист существ, стратегий, заклинаний и аксессуаров",
          "Тир-лист героев Полей сражений",
          "Библиотека актуальных и архивных карт Battlegrounds",
          "Конструктор стратегий и конструктор тир-листов с экспортом изображений"
        ]
      },
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
        ]
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "Что есть на сайте Полей сражений от Манакоста?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "На сайте есть тир-листы существ, стратегий, заклинаний, аксессуаров и героев, библиотека карт, архив и конструкторы для Battlegrounds."
            }
          },
          {
            "@type": "Question",
            "name": "Как пользоваться тир-листом Полей сражений?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Откройте раздел «Тир-лист» и переключайтесь между существами, стратегиями, заклинаниями и аксессуарами. В карточках доступны среднее место, источники и подробности."
            }
          },
          {
            "@type": "Question",
            "name": "Где смотреть подробности по картам Battlegrounds?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "В разделе «Библиотека» доступны существа и заклинания с фильтрами, отдельными страницами, статистикой и связью со стратегиями."
            }
          },
          {
            "@type": "Question",
            "name": "Можно ли собрать свою стратегию или тир-лист?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Да. В меню «Конструкторы» доступны конструктор стратегий и конструктор тир-листов с полотном, фильтрами и экспортом PNG/WebP."
            }
          }
        ]
      }
    ],
    noscript: `
      <h1>Поля сражений Hearthstone от Манакоста</h1>
      <p>Тир-листы, библиотека карт и конструкторы для режима Поля сражений Hearthstone.</p>
      <ul>
        <li><a href="/classes">Конструктор стратегий</a> — полотно, карты, аннотации и экспорт PNG/WebP для Полей сражений</li>
        <li><a href="/tierlist">Тир-лист</a> — существа, стратегии, заклинания и аксессуары</li>
        <li><a href="/legendaries">Конструктор тир-листов</a> — drag-and-drop распределение карт Полей сражений</li>
        <li><a href="/heroes">Герои</a> — тир-лист героев Полей сражений</li>
        <li><a href="/library">Библиотека</a> — актуальные и архивные карты Battlegrounds</li>
      </ul>`
  },
  '/classes': {
    title: 'Конструктор стратегий — Battlegrounds | HS-Manacost',
    description: 'Конструктор стратегий Полей сражений: существа, герои, заклинания, аксессуары, быстрые слоты, аннотации и экспорт PNG/WebP.',
    h1: 'Конструктор стратегий Полей сражений',
    canonical: '/classes',
    ogType: 'website',
    structuredData: [
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
          { "@type": "ListItem", "position": 2, "name": "Конструктор стратегий", "item": `${SITE_URL}/classes` }
        ]
      },
      {
        "@type": "WebApplication",
        "@id": `${SITE_URL}/classes#strategy-builder`,
        "name": "Конструктор стратегий Полей сражений",
        "description": "Интерактивный конструктор стратегий Battlegrounds с библиотекой карт, фильтрами, полотном, аннотациями и экспортом.",
        "url": `${SITE_URL}/classes`,
        "applicationCategory": "GameApplication",
        "operatingSystem": "Web",
        "creator": { "@type": "Organization", "name": "Manacost" }
      }
    ],
    noscript: `
      <h1>Конструктор стратегий Полей сражений</h1>
      <p>Полотно стратегий Battlegrounds с библиотекой карт, фильтрами, быстрыми слотами, аннотациями и экспортом PNG/WebP.</p>
      <p><a href="/">На главную</a> | <a href="/tierlist">Тир-лист</a> | <a href="/legendaries">Конструктор тир-листов</a> | <a href="/heroes">Герои</a></p>`
  },
  '/tierlist': {
    title: 'Тир-лист Полей сражений — существа, стратегии и аксессуары | HS-Manacost',
    description: 'Актуальный тир-лист Полей сражений: существа, стратегии, заклинания и аксессуары с данными HSReplay, Firestone и базы Манакоста.',
    canonical: '/tierlist',
    ogType: 'website',
    h1: 'Тир-лист Полей сражений',
    structuredData: [
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
          { "@type": "ListItem", "position": 2, "name": "Тир-лист", "item": `${SITE_URL}/tierlist` }
        ]
      },
      {
        "@type": "ItemList",
        "@id": `${SITE_URL}/tierlist#tierlist`,
        "name": "Тир-лист Полей сражений",
        "description": "Существа, стратегии, заклинания и аксессуары Battlegrounds, распределённые по актуальным тирам.",
        "numberOfItems": 500,
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Тир S — Отлично (авто-пик)", "url": `${SITE_URL}/tierlist` },
          { "@type": "ListItem", "position": 2, "name": "Тир A — Хорошо", "url": `${SITE_URL}/tierlist` },
          { "@type": "ListItem", "position": 3, "name": "Тир B — Выше среднего", "url": `${SITE_URL}/tierlist` },
          { "@type": "ListItem", "position": 4, "name": "Тир C — Средне", "url": `${SITE_URL}/tierlist` },
          { "@type": "ListItem", "position": 5, "name": "Тир D — Ниже среднего", "url": `${SITE_URL}/tierlist` },
          { "@type": "ListItem", "position": 6, "name": "Тир E — Плохо", "url": `${SITE_URL}/tierlist` },
          { "@type": "ListItem", "position": 7, "name": "Тир F — Ужасно", "url": `${SITE_URL}/tierlist` }
        ]
      },
      {
        "@type": "Dataset",
        "@id": `${SITE_URL}/tierlist#dataset`,
        "name": "Тир-лист Полей сражений Hearthstone",
        "description": "Актуальный тир-лист существ, стратегий, заклинаний и аксессуаров режима Поля сражений.",
        "url": `${SITE_URL}/tierlist`,
        "creator": { "@type": "Organization", "name": "Manacost" },
        "about": {
          "@type": "VideoGame",
          "name": "Hearthstone",
          "gameMode": "Battlegrounds"
        }
      }
    ],
    noscript: `
      <h1>Тир-лист Полей сражений Hearthstone</h1>
      <p>Актуальный тир-лист существ, стратегий, заклинаний и аксессуаров Battlegrounds.</p>
      <p>Переключайтесь между типами тир-листа, источниками HSReplay и Firestone, и открывайте карты в подробном просмотре.</p>
      <p><a href="/">На главную</a> | <a href="/classes">Конструктор стратегий</a> | <a href="/library">Библиотека</a></p>`
  },
  '/legendaries': {
    title: 'Конструктор тир-листов — Battlegrounds | HS-Manacost',
    description: 'Drag-and-drop конструктор тир-листов Полей сражений: герои, существа, заклинания, аксессуары, фоны и экспорт PNG/WebP.',
    canonical: '/legendaries',
    ogType: 'website',
    h1: 'Конструктор тир-листов Полей сражений',
    structuredData: [
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
          { "@type": "ListItem", "position": 2, "name": "Конструктор тир-листов", "item": `${SITE_URL}/legendaries` }
        ]
      },
      {
        "@type": "WebApplication",
        "@id": `${SITE_URL}/legendaries#tier-builder`,
        "name": "Конструктор тир-листов Полей сражений",
        "description": "Интерактивный drag-and-drop конструктор тир-листов Battlegrounds с экспортом изображений.",
        "url": `${SITE_URL}/legendaries`,
        "applicationCategory": "GameApplication",
        "operatingSystem": "Web"
      }
    ],
    noscript: `
      <h1>Конструктор тир-листов Полей сражений</h1>
      <p>Распределяйте героев, существ, заклинания и аксессуары по тирам, выбирайте фон и экспортируйте готовый тир-лист.</p>
      <p><a href="/">На главную</a> | <a href="/classes">Конструктор стратегий</a> | <a href="/heroes">Герои</a></p>`
  },
  '/heroes': {
    title: 'Тир-лист героев — Battlegrounds | HS-Manacost',
    description: 'Тир-лист героев Полей сражений: портреты, среднее место, популярность и распределение по тирам.',
    canonical: '/heroes',
    ogType: 'website',
    h1: 'Тир-лист героев Полей сражений',
    structuredData: [
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
          { "@type": "ListItem", "position": 2, "name": "Герои", "item": `${SITE_URL}/heroes` }
        ]
      },
      {
        "@type": "ItemList",
        "@id": `${SITE_URL}/heroes#hero-tier-list`,
        "name": "Тир-лист героев Полей сражений",
        "description": "Герои Battlegrounds, отсортированные по тирам, среднему месту и популярности.",
        "url": `${SITE_URL}/heroes`
      }
    ],
    noscript: `
      <h1>Тир-лист героев Полей сражений</h1>
      <p>Герои Battlegrounds по тирам со средним местом и популярностью.</p>
      <p><a href="/">На главную</a> | <a href="/classes">Конструктор стратегий</a> | <a href="/tierlist">Тир-лист</a></p>`
  },
  '/library': {
    title: 'Библиотека карт Полей сражений — BG Hearthstone | HS-Manacost',
    description: 'Актуальная библиотека существ и заклинаний Полей сражений Hearthstone: фильтры по таверне, типу существ, механикам и подробная статистика карт.',
    canonical: '/library',
    ogType: 'website',
    h1: 'Библиотека карт Полей сражений',
    structuredData: [
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
          { "@type": "ListItem", "position": 2, "name": "Библиотека", "item": `${SITE_URL}/library` }
        ]
      },
      {
        "@type": "Dataset",
        "@id": `${SITE_URL}/library#dataset`,
        "name": "Библиотека карт Полей сражений",
        "description": "Актуальные существа и заклинания активного пула Battlegrounds с русскими названиями, механиками и статистикой.",
        "url": `${SITE_URL}/library`,
        "creator": { "@type": "Organization", "name": "Manacost" },
        "about": { "@type": "VideoGame", "name": "Hearthstone Battlegrounds" }
      }
    ],
    noscript: `
      <h1>Библиотека карт Полей сражений</h1>
      <p>Актуальные существа и заклинания активного пула Battlegrounds: таверна, тип существа, механики, текст карты и статистика.</p>
      <p><a href="/library/minions">Существа</a> | <a href="/library/spells">Заклинания</a> | <a href="/library/archive">Архив карт вне пула</a></p>`
  },
  '/library/minions': {
    title: 'Существа Полей сражений — библиотека BG Hearthstone | HS-Manacost',
    description: 'Все актуальные существа Полей сражений Hearthstone: фильтры по таверне, типу существ, механикам и подробная статистика по раундам.',
    canonical: '/library/minions',
    ogType: 'website',
    h1: 'Существа Полей сражений',
    structuredData: [
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
          { "@type": "ListItem", "position": 2, "name": "Библиотека", "item": `${SITE_URL}/library` },
          { "@type": "ListItem", "position": 3, "name": "Существа", "item": `${SITE_URL}/library/minions` }
        ]
      },
      {
        "@type": "ItemList",
        "@id": `${SITE_URL}/library/minions#minions`,
        "name": "Существа Полей сражений",
        "description": "Актуальные существа Battlegrounds, сгруппированные по уровням таверны."
      }
    ],
    noscript: `
      <h1>Существа Полей сражений</h1>
      <p>Актуальный пул существ Battlegrounds с фильтрами по таверне, типу и механикам.</p>
      <p><a href="/library">Библиотека</a> | <a href="/library/spells">Заклинания</a> | <a href="/library/archive/minions">Архив существ</a></p>`
  },
  '/library/spells': {
    title: 'Заклинания Полей сражений — библиотека BG Hearthstone | HS-Manacost',
    description: 'Все актуальные заклинания таверны Полей сражений Hearthstone с русскими названиями, механиками и статистикой Firestone.',
    canonical: '/library/spells',
    ogType: 'website',
    h1: 'Заклинания Полей сражений',
    structuredData: [
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
          { "@type": "ListItem", "position": 2, "name": "Библиотека", "item": `${SITE_URL}/library` },
          { "@type": "ListItem", "position": 3, "name": "Заклинания", "item": `${SITE_URL}/library/spells` }
        ]
      },
      {
        "@type": "ItemList",
        "@id": `${SITE_URL}/library/spells#spells`,
        "name": "Заклинания Полей сражений",
        "description": "Актуальные заклинания таверны Battlegrounds, сгруппированные по уровням таверны."
      }
    ],
    noscript: `
      <h1>Заклинания Полей сражений</h1>
      <p>Актуальный пул заклинаний Battlegrounds со статистикой Firestone.</p>
      <p><a href="/library">Библиотека</a> | <a href="/library/minions">Существа</a> | <a href="/library/archive/spells">Архив заклинаний</a></p>`
  },
  '/library/archive': {
    title: 'Архив карт Полей сражений — карты вне пула | HS-Manacost',
    description: 'Архив существ и заклинаний Полей сражений Hearthstone, которые были в режиме ранее, но сейчас не находятся в активном пуле.',
    canonical: '/library/archive',
    ogType: 'website',
    h1: 'Архив карт Полей сражений',
    structuredData: [
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
          { "@type": "ListItem", "position": 2, "name": "Библиотека", "item": `${SITE_URL}/library` },
          { "@type": "ListItem", "position": 3, "name": "Архив", "item": `${SITE_URL}/library/archive` }
        ]
      },
      {
        "@type": "Dataset",
        "@id": `${SITE_URL}/library/archive#dataset`,
        "name": "Архив карт Полей сражений",
        "description": "Существа и заклинания Battlegrounds вне текущего активного пула."
      }
    ],
    noscript: `
      <h1>Архив карт Полей сражений</h1>
      <p>Карты Battlegrounds, которые сейчас не находятся в активном пуле: старые существа и заклинания для справки и поиска.</p>
      <p><a href="/library">Актуальная библиотека</a> | <a href="/library/archive/minions">Архив существ</a> | <a href="/library/archive/spells">Архив заклинаний</a></p>`
  },
  '/library/archive/minions': {
    title: 'Архив существ Полей сражений — карты вне пула | HS-Manacost',
    description: 'Архив существ Полей сражений Hearthstone, которые сейчас не находятся в активном пуле, но доступны для справки и поиска.',
    canonical: '/library/archive/minions',
    ogType: 'website',
    h1: 'Архив существ Полей сражений',
    structuredData: [
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
          { "@type": "ListItem", "position": 2, "name": "Библиотека", "item": `${SITE_URL}/library` },
          { "@type": "ListItem", "position": 3, "name": "Архив", "item": `${SITE_URL}/library/archive` },
          { "@type": "ListItem", "position": 4, "name": "Существа вне пула", "item": `${SITE_URL}/library/archive/minions` }
        ]
      }
    ],
    noscript: `
      <h1>Архив существ Полей сражений</h1>
      <p>Существа Battlegrounds, которые сейчас не находятся в активном пуле.</p>
      <p><a href="/library">Актуальная библиотека</a> | <a href="/library/archive">Архив</a> | <a href="/library/archive/spells">Архив заклинаний</a></p>`
  },
  '/library/archive/spells': {
    title: 'Архив заклинаний Полей сражений — карты вне пула | HS-Manacost',
    description: 'Архив заклинаний таверны Полей сражений Hearthstone, которые сейчас не находятся в активном пуле.',
    canonical: '/library/archive/spells',
    ogType: 'website',
    h1: 'Архив заклинаний Полей сражений',
    structuredData: [
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
          { "@type": "ListItem", "position": 2, "name": "Библиотека", "item": `${SITE_URL}/library` },
          { "@type": "ListItem", "position": 3, "name": "Архив", "item": `${SITE_URL}/library/archive` },
          { "@type": "ListItem", "position": 4, "name": "Заклинания вне пула", "item": `${SITE_URL}/library/archive/spells` }
        ]
      }
    ],
    noscript: `
      <h1>Архив заклинаний Полей сражений</h1>
      <p>Заклинания Battlegrounds, которые сейчас не находятся в активном пуле.</p>
      <p><a href="/library">Актуальная библиотека</a> | <a href="/library/archive">Архив</a> | <a href="/library/archive/minions">Архив существ</a></p>`
  },
  '/articles': {
    title: 'Статьи и гайды по Полям сражений Hearthstone | HS-Manacost',
    description: 'Гайды, разборы меты и советы по режиму Поля сражений Hearthstone от команды Манакоста.',
    canonical: '/articles',
    ogType: 'website',
    h1: 'Статьи и гайды по Полям сражений Hearthstone',
    structuredData: [
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Главная", "item": SITE_URL },
          { "@type": "ListItem", "position": 2, "name": "Статьи", "item": `${SITE_URL}/articles` }
        ]
      },
      {
        "@type": "CollectionPage",
        "@id": `${SITE_URL}/articles#collection`,
        "name": "Статьи и гайды по Полям сражений Hearthstone",
        "description": "Гайды, разборы и советы по режиму Поля сражений Hearthstone от команды Манакоста.",
        "url": `${SITE_URL}/articles`
      }
    ],
    noscript: `
      <h1>Статьи и гайды по Полям сражений Hearthstone</h1>
      <p>Гайды, разборы меты и советы по режиму Поля сражений от команды Манакоста.</p>
      <p><a href="/">На главную</a> | <a href="/tierlist">Тир-лист</a> | <a href="/classes">Конструктор стратегий</a></p>`
  }
};

function generatePageHtml(baseHtml, pageData, path) {
  const { title, description, canonical, ogType, structuredData, noscript, h1 } = pageData;
  const fullCanonical = `${SITE_URL}${canonical}`;
  const ogImage = `${SITE_URL}/assets/og-preview.png`;

  const sdJson = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": structuredData
  });

  let html = baseHtml;

  html = html.replace(
    /<title>.*?<\/title>/,
    `<title>${title}</title>`
  );

  html = html.replace(
    /<meta\s+name="description"\s+content="[^"]*"/,
    `<meta name="description" content="${description}"`
  );

  html = html.replace(
    /<link\s+rel="canonical"\s+href="[^"]*"/,
    `<link rel="canonical" href="${fullCanonical}"`
  );

  html = html.replace(
    /<meta\s+property="og:url"\s+content="[^"]*"/,
    `<meta property="og:url" content="${fullCanonical}"`
  );

  html = html.replace(
    /<meta\s+property="og:title"\s+content="[^"]*"/,
    `<meta property="og:title" content="${title}"`
  );

  html = html.replace(
    /<meta\s+property="og:description"\s+content="[^"]*"/,
    `<meta property="og:description" content="${description}"`
  );

  html = html.replace(
    /<meta\s+name="twitter:title"\s+content="[^"]*"/,
    `<meta name="twitter:title" content="${title}"`
  );

  html = html.replace(
    /<meta\s+name="twitter:description"\s+content="[^"]*"/,
    `<meta name="twitter:description" content="${description}"`
  );

  html = html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script type="application/ld+json">\n    ${sdJson}\n    </script>`
  );

  html = html.replace(
    '<div id="root"></div>',
    `<div id="root"><noscript>${noscript}</noscript></div>`
  );

  return html;
}

function makePublicReadable(path) {
  const stats = statSync(path);

  if (stats.isDirectory()) {
    chmodSync(path, 0o755);
    for (const child of readdirSync(path)) {
      makePublicReadable(resolve(path, child));
    }
    return;
  }

  if (stats.isFile()) {
    chmodSync(path, 0o644);
  }
}

function main() {
  const distDir = resolve(process.cwd(), 'dist');

  if (!existsSync(distDir)) {
    console.error('[prerender] dist/ not found. Run "vite build" first.');
    process.exit(1);
  }

  const indexPath = resolve(distDir, 'index.html');
  const baseHtml = readFileSync(indexPath, 'utf-8');

  const today = new Date().toISOString().split('T')[0];

  console.log('[prerender] Generating per-route HTML...');

  for (const [path, pageData] of Object.entries(PAGES)) {
    const routeDir = path === '/' ? distDir : resolve(distDir, path.slice(1));
    const filePath = resolve(routeDir, 'index.html');

    if (!existsSync(routeDir)) {
      mkdirSync(routeDir, { recursive: true });
    }

    const pageHtml = generatePageHtml(baseHtml, pageData, path);
    writeFileSync(filePath, pageHtml, 'utf-8');
    console.log(`[prerender] ✓ ${path} → ${filePath}`);
  }

  const sitemapPath = resolve(distDir, 'sitemap.xml');
  if (existsSync(sitemapPath)) {
    let sitemap = readFileSync(sitemapPath, 'utf-8');
    sitemap = sitemap.replace(/<lastmod>[^<]*<\/lastmod>/g, `<lastmod>${today}</lastmod>`);
    if (!sitemap.includes('<lastmod>')) {
      sitemap = sitemap.replace(/<\/url>/g, `</url>`); // already has lastmod from source
    }
    writeFileSync(sitemapPath, sitemap, 'utf-8');
    console.log('[prerender] ✓ Updated sitemap.xml lastmod dates');
  }

  makePublicReadable(distDir);
  console.log('[prerender] ✓ Fixed dist/ permissions');
  console.log('[prerender] Done! All routes pre-rendered.');
}

main();
