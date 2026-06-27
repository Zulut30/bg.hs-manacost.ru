import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';

const SITE_URL = 'https://bg.hs-manacost.ru';

const PAGES = {
  '/': {
    title: 'HS-Arena — Тир-лист и Винрейты для Арены Hearthstone',
    description: 'Актуальная статистика Арены Hearthstone: тир-лист карт по классам, винрейты, легендарные группы. Данные обновляются автоматически 4 раза в сутки.',
    h1: 'HS-Arena — Статистика Арены Hearthstone',
    canonical: '/',
    ogType: 'website',
    structuredData: [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        "url": SITE_URL,
        "name": "Manacost Arena",
        "description": "Актуальная статистика режима Арена в Hearthstone",
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
        "name": "Manacost Arena",
        "url": SITE_URL,
        "description": "Актуальная статистика режима Арена в Hearthstone: тир-лист карт по классам, винрейты, легендарные группы.",
        "applicationCategory": "GameApplication",
        "operatingSystem": "Web",
        "inLanguage": "ru",
        "offers": { "@type": "Offer", "price": "0", "priceCurrency": "RUB" },
        "featureList": [
          "Тир-лист карт Арены Hearthstone по всем классам",
          "Винрейты классов с актуального патча",
          "Группы легендарных карт для первого выбора",
          "Автоматическое обновление данных 4 раза в сутки"
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
            "name": "Какой класс лучший на Арене Hearthstone?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Актуальные винрейты всех классов обновляются автоматически на странице «Классы». Данные берутся с миллионов реальных Арена-партий."
            }
          },
          {
            "@type": "Question",
            "name": "Как пользоваться тир-листом карт для Арены?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Выберите класс в шапке тир-листа, затем используйте поиск и фильтр по редкости. Карты ранжированы от S (авто-пик) до F (не брать никогда)."
            }
          },
          {
            "@type": "Question",
            "name": "Как выбрать легендарку на Арене Hearthstone?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "На вкладке «Легендарки» показаны все возможные группы первого выбора с процентом побед. Выбирайте группу с наибольшим винрейтом для вашего класса."
            }
          },
          {
            "@type": "Question",
            "name": "Как часто обновляются данные Арены?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Данные обновляются автоматически 4 раза в сутки: в 00:15, 06:15, 12:15 и 18:15 UTC."
            }
          }
        ]
      }
    ],
    noscript: `
      <h1>HS-Arena — Статистика Арены Hearthstone</h1>
      <p>Актуальная статистика режима Арена в Hearthstone: тир-лист карт, винрейты классов, легендарные группы.</p>
      <ul>
        <li><a href="/classes">Конструктор стратегий</a> — полотно, карты, аннотации и экспорт PNG/WebP для Полей сражений</li>
        <li><a href="/tierlist">Тир-лист карт</a> — оценки карт от S до F по классам</li>
        <li><a href="/legendaries">Конструктор тир-листов</a> — drag-and-drop распределение карт Полей сражений</li>
        <li><a href="/heroes">Герои</a> — тир-лист героев Полей сражений</li>
        <li><a href="/articles">Статьи и гайды</a> — разборы и советы по Арене</li>
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
    title: 'Тир-лист карт — Арена Hearthstone | HS-Arena',
    description: 'Полный тир-лист карт для каждого класса в режиме Арена Hearthstone. Лучшие карты текущего патча с оценками от S (авто-пик) до F. Данные с HearthArena и HSReplay.',
    canonical: '/tierlist',
    ogType: 'website',
    h1: 'Тир-лист карт Арены Hearthstone',
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
        "name": "Тир-лист карт Арены Hearthstone",
        "description": "Оценки карт для режима Арена Hearthstone по всем классам от S до F.",
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
        "name": "Тир-лист карт Арены Hearthstone",
        "description": "Полный тир-лист карт для каждого класса в режиме Арена Hearthstone с оценками от S до F.",
        "url": `${SITE_URL}/tierlist`,
        "creator": { "@type": "Organization", "name": "Manacost" },
        "about": {
          "@type": "VideoGame",
          "name": "Hearthstone",
          "gameMode": "Arena"
        }
      }
    ],
    noscript: `
      <h1>Тир-лист карт Арены Hearthstone</h1>
      <p>Полный тир-лист карт для каждого класса в режиме Арена Hearthstone. Лучшие карты текущего патча с оценками от S (авто-пик) до F.</p>
      <p>Классы: Рыцарь смерти, Охотник на демонов, Друид, Охотник, Маг, Паладин, Жрец, Разбойник, Шаман, Чернокнижник, Воин, Нейтральные.</p>
      <p>Тиры: S — Отлично, A — Хорошо, B — Выше среднего, C — Средне, D — Ниже среднего, E — Плохо, F — Ужасно.</p>
      <p>Данные обновляются автоматически с HearthArena и HSReplay.</p>
      <p><a href="/">На главную</a> | <a href="/classes">Винрейты классов</a> | <a href="/legendaries">Легендарки</a></p>`
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
  '/articles': {
    title: 'Статьи и гайды по Арене Hearthstone | HS-Arena',
    description: 'Гайды, разборы мета и советы по режиму Арена в Hearthstone от команды Manacost. Актуальные статьи для игроков всех уровней.',
    canonical: '/articles',
    ogType: 'website',
    h1: 'Статьи и гайды по Арене Hearthstone',
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
        "name": "Статьи и гайды по Арене Hearthstone",
        "description": "Гайды, разборы и советы по режиму Арена в Hearthstone от команды Manacost.",
        "url": `${SITE_URL}/articles`
      }
    ],
    noscript: `
      <h1>Статьи и гайды по Арене Hearthstone</h1>
      <p>Гайды, разборы мета и советы по режиму Арена от команды Manacost.</p>
      <p><a href="/">На главную</a> | <a href="/tierlist">Тир-лист карт</a> | <a href="/classes">Винрейты классов</a></p>`
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
    /<meta name="description" content="[^"]*"/,
    `<meta name="description" content="${description}"`
  );

  html = html.replace(
    /<link rel="canonical" href="[^"]*"/,
    `<link rel="canonical" href="${fullCanonical}"`
  );

  html = html.replace(
    /<meta property="og:url" content="[^"]*"/,
    `<meta property="og:url" content="${fullCanonical}"`
  );

  html = html.replace(
    /<meta property="og:title" content="[^"]*"/,
    `<meta property="og:title" content="${title}"`
  );

  html = html.replace(
    /<meta property="og:description" content="[^"]*"/,
    `<meta property="og:description" content="${description}"`
  );

  html = html.replace(
    /<meta name="twitter:title" content="[^"]*"/,
    `<meta name="twitter:title" content="${title}"`
  );

  html = html.replace(
    /<meta name="twitter:description" content="[^"]*"/,
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
