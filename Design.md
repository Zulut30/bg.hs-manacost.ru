# HS-Arena Design System

## Product Direction

HS-Arena should feel like a modern Hearthstone statistics dashboard: fast, readable, premium, and game-aware without becoming an old parchment fan site.

Primary design goals:
- Lead with data clarity: stats, filters, tiers, and updates must scan quickly.
- Keep Hearthstone flavor through real assets, card art, class icons, and display typography. Do not use warm gold/yellow as a general UI color.
- Avoid heavy brown panels as the default surface. Use dark navy glass and light dashboard surfaces.
- Preserve existing interactive engines: tier grids, card preview, lightbox, filters, and download flows.

## Visual Language

Core palette:
- Deep shell: `#040a14`, `#081020`, `#12233f`
- Dashboard surface: `#f8faff`, `#ebf1fc`
- Primary accent: `#2563eb`, `#38bdf8`, `#93c5fd`
- Text on dark: `#e5eefc`, `#c8d5e8`, `#9fb1ca`
- Text on light: `#1e293b`, `#334155`, legacy brown only where Hearthstone flavor is needed

Surfaces:
- Main shell uses blurred Hearthstone artwork behind dark overlays.
- Navigation and modal panels use dark glass with thin, low-opacity borders.
- Content panels use soft light surfaces with subtle cool shadows.
- Avoid yellow/gold borders and parchment fills in UI surfaces. Use blue-gray borders and blue/cyan active states.
- Home page should start with a compact product summary, not a large hero billboard. The useful section cards and data previews should appear immediately.
- Section banners should share one clean top radius and keep background art centered lower in the frame so character art does not look cropped upward.

## Typography

Use `HSDisplay` for brand, section titles, tier labels, and primary action text.

Use body sans for descriptions, helper text, metadata, and long-form text.

Rules:
- Letter spacing should stay `0` for most UI.
- Do not overuse uppercase. Reserve uppercase for small labels such as source names.
- Mobile headings must not wrap awkwardly. Brand text should stay readable and compact.

## Shadows

Current shadow model:
- App chrome: large but soft dark shadow, low opacity.
- Cards in tier grids: no artificial drop-shadow on the card artwork. Let the real card frame carry depth.
- Hover states can increase depth but should not create muddy halos.
- Modal card art remains hero-sized and shadowed, but the stat panel should carry the structured UI.

Avoid:
- `rgba(0,0,0,0.85)` on small cards unless the asset needs strong separation.
- Multiple brown shadows layered together.
- Heavy inset shadows on dashboard controls.
- Drop-shadows behind gallery card images. They create a dirty gray field on light backgrounds and make the grid feel blurry.

## Motion And Performance

Motion should make the interface feel alive, not slower.

Rules:
- Prefer opacity, transform, and background-position for animations.
- Avoid permanent `will-change` on repeated card elements; enable it only for hover/focus states.
- Infinite animation is allowed only for very subtle, low-frequency atmosphere such as section banner art drift or active-tab glow.
- Respect `prefers-reduced-motion`.
- Heavy data that is not required for the first visible screen should load in idle time.
- Avoid `content-visibility: auto` on visible card grids and long export/QA pages; on mobile and full-page screenshots it can leave blank blocks until scroll paints them.

## Navigation

The current menu is approved. Do not rework its structure unless specifically requested.

Rules:
- Active tab is dark navy with blue/cyan text/icon treatment.
- Menu is a separate floating panel, not attached to the content card.
- Mobile keeps a compact dark nav bar with info and menu buttons.
- Header includes a Manacost site switcher: `Koloda`, `HS-Manacost`, `HS-Arena`.
- The current site pill should glow subtly; external site pills should stay quieter and use favicon imagery.
- On mobile, the site switcher stacks below the brand and scrolls horizontally if space is tight.
- Favicon direction: minimalist monogram, dark rounded square, thin cyan rim, geometric `A` strokes, no shield or nested emblem so it stays clear at 16-32px.
- External network-site pills open in a new tab; the current `HS-Arena` pill stays in the same tab and routes home.

## Lightbox

Lightbox must match the current dashboard shell:
- Backdrop: dark blurred glass with subtle blue/cyan radial light.
- Card image: large, clean, no extra frame, soft premium shadow.
- Stats panel: dark navy glass or cool light glass, thin blue-gray border, rounded 20-24px.
- Chips: subdued glass pills, not parchment.
- Stat rows: compact dark rows with readable labels and colored metric values.
- Mobile: image first, stats below, max height constrained so scrolling is comfortable.

Do not:
- Return to heavy brown panels.
- Add decorative text explaining how the lightbox works.
- Change card data logic or source fallback order while doing visual work.

## Hover Card Tooltip

The card hover tooltip should feel like a compact stats popover, not a brown Hearthstone parchment.

Current direction:
- Width around 340px on desktop.
- Light glass dashboard panel with blue-gray border.
- Rows use quiet white pills with strong right-aligned metric values.
- Source label is metadata, not a visual headline.
- Tooltip must not obscure the card more than necessary and must stay pointer-events none.

## Tier Lists

Tier-list grid and export/download behavior are protected. Visual edits should be made through CSS around existing classes unless the user explicitly asks for behavior changes.

Rules:
- Keep card images high quality and large enough for recognition.
- Keep filters compact and scannable.
- Use light dashboard filter surfaces with dark active states.
- Tier badges can be game-like, but their shadows should be soft.
- Do not add shadows to raw card images in gallery mode.
- Tier rank badges must own their foreground color. Global heading/font overrides must not recolor `S/A/B` letters.
- Rarity and mana filter icons should render as source assets. Avoid brightness/saturation filters that make the icons look damaged.

## Articles

The articles page should feel like a modern arena magazine section inside the same dashboard shell.

Rules:
- Use cool white/blue-gray article cards, not parchment.
- Article tags are dark glass chips with readable light text.
- Cover images should carry the visual energy; body panels stay quiet and readable.
- Do not add an extra intro/status panel above the article grid; after breadcrumbs, the card grid should start immediately.
- Keep card titles high contrast and excerpts muted; links use blue/cyan.

## Home Page

The home page is an index/dashboard, not a landing page.

Rules:
- No oversized hero block with mascot/card artwork.
- Use a compact intro strip with two primary actions.
- Put navigation cards, top classes, top cards, and legendaries close to the first viewport.
- Keep home surfaces light and crisp so they bridge the dark navigation and data-heavy pages.

## Community Promo Cards

Telegram and Boosty promo cards must sit inside the same cool dashboard system.

Rules:
- Use dark navy/slate glass surfaces with blue/cyan borders and readable light text.
- Source brand colors may appear only as small icon accents, not as full-card brown/orange panels.
- Titles must define their own high-contrast foreground color.
- On mobile, promo cards may stack their CTA below the text so labels do not become cramped.

## Design Audit 2026-06-23

Findings:
- Tier-list card gallery had heavy gray shadows behind every card. On the light content surface this read as blur/noise rather than depth.
- Hover stats tooltip still used the old brown/gold palette and was too narrow for current dashboard spacing.
- Legendary group cards, FAQ rows, and top-class cards leaned too far into yellow parchment. This conflicted with the newer dark navy + cool light dashboard direction.
- Some metric colors used amber for neutral/medium performance, making whole sections feel yellow even after larger surfaces were modernized.

Changes made:
- Removed artificial drop-shadows from tier-list and legendary card images.
- Rebuilt hover tooltip as a larger light glass stats panel.
- Shifted shared `hs-card`, FAQ, legendary group cards, source panels, and home cards toward cool white/blue-gray surfaces.
- Changed medium winrate badges and home progress bars away from amber toward blue/green data colors.
- Locked legendary winrate badge text to high-contrast white so global small-text rules cannot make metric pills unreadable.
- Lowered section-banner background art to `center 78%` so characters sit deeper in the frame instead of floating too high.
- Protected tier rank letters from global font color overrides.
- Reworked article cards and the articles intro into the cool dashboard/editorial style.
- Removed destructive brightness/saturation filters from tier-list rarity and mana filter icons.
- Added ETag/localStorage caching for articles.
- Deferred secondary data warmups and legendaries to idle time.
- Added subtle active-tab glow, brand hover sweep, and slow section-banner art drift with reduced-motion safeguards.
- Removed permanent `will-change` from repeated card art and added `content-visibility` to repeated card blocks.
- Added a new SVG favicon and a compact Manacost network switcher to the header.

Remaining watchlist:
- Inline styles still exist in older components. Prefer adding semantic classes before future visual work.
- Class icon filters and tier badges should avoid yellow active rings; use blue/cyan active rings. Gold/yellow is allowed only when it is baked into external game art or the logo asset.
- Any colored metric pill must define its own foreground color. Do not rely on inherited text utilities inside data badges.

## Color Unification 2026-06-23

New rule:
- No yellow/gold as a UI system color across the site.
- Do not use parchment yellow for cards, FAQ rows, filter strips, source toggles, count pills, empty states, or active controls.
- Use cool surfaces: white, blue-gray, slate, navy.
- Use blue/cyan for active states, links, progress, rings, and primary actions.
- Existing inline legacy colors should be overridden or replaced when touched.

Allowed exceptions:
- Card artwork and class icons may contain yellow because they are source assets.
- The brand mark image may keep its original colors unless a full rebrand asset is created.
- Screenshot QA should include `/`, `/tierlist/`, `/legendaries/`, and the hover tooltip after every design pass.

## Footer

Footer should act as a product close, not only a legal strip.

Current direction:
- Dark glass section over faint footer art.
- Three columns: sections, community, project summary/update status.
- Low-contrast legal text in the bottom bar.

Future improvement:
- Add compact brand lockup and source/status chips if footer needs more authority.

## Implementation Notes

Primary files:
- `src/App.tsx` for structure and component classes.
- `src/index.css` for the modern shell, tier-list visuals, and modal styling.

Before handoff:
- Run `npm run lint`.
- Run `npm run build`.
- Reload nginx if production `dist` is updated.
- Capture desktop and mobile screenshots for visual QA when touching major surfaces.
