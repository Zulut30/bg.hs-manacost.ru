import React, { useEffect, useMemo, useState } from 'react';
import { Archive, ArrowLeft, BarChart3, BookOpen, ChevronDown, ExternalLink, Filter, Search } from 'lucide-react';

type LibraryKind = 'minion' | 'spell';
type PoolMode = 'current' | 'archive';

interface LibraryCard {
  id: number;
  card_id: string;
  dbf: number;
  card_type: { slug: LibraryKind; name_ru: string };
  name: { ru: string; en: string };
  tavern_tier: number | null;
  creature_type: { slug: string; name_ru: string } | null;
  attack: number | null;
  health: number | null;
  in_pool: boolean;
  duos_only: boolean;
  mechanics: Array<{ slug: string; name_ru: string }>;
  text_ru: string;
  images: { card?: string | null; golden?: string | null; art?: string | null; framed?: string | null };
  asset_status?: {
    base_card_id?: string;
    local_card?: boolean;
    local_framed?: boolean;
    local_golden?: boolean;
    local_art?: boolean;
    golden_variant_tavern_tier?: number | null;
    golden_tier_mismatch?: boolean;
  };
  updated_at?: string;
}

interface LibraryMeta {
  creature_types?: Array<{ slug: string | null; name_ru: string | null }>;
  mechanics?: Array<{ slug: string; name_ru: string }>;
}

interface MinionStat {
  dbf_id: number;
  card_id: string;
  name: string;
  name_ru: string;
  tavern_tier: number;
  impact: number | null;
  combat_winrate: number | null;
  popularity: number | null;
  games_with_minion: number | null;
  games_without_minion: number | null;
  avg_placement_with: number | null;
  avg_placement_without: number | null;
}

interface MinionRoundStat {
  combat_round: number;
  games_with_minion: number;
  games_without_minion: number;
  avg_placement_with: number;
  avg_placement_without: number;
  impact: number;
  combat_winrate: number;
  wins: number;
  losses: number;
}

interface MinionDetail extends MinionStat {
  rounds?: MinionRoundStat[];
}

interface FirestoneSpellStat {
  id: string;
  card_id: string;
  dbfId: number;
  name: string;
  image_url?: string;
  tavern_tier: number;
  total_played: number;
  average_placement: number;
  average_placement_other: number;
  impact: number;
}

interface StrategyCard {
  id?: string;
  dbfId?: number | null;
  name?: string;
  ruName?: string;
  role?: string;
}

interface StrategyEntry {
  key: string;
  source: string;
  title: string;
  description?: string;
  tier?: string;
  difficulty?: string;
  avgPlacement?: string;
  cards?: StrategyCard[];
}

interface BgLibraryProps {
  currentPath: string;
  navigatePath: (path: string) => void;
}

const SITE_URL = 'https://bg.hs-manacost.ru';
const TAVERN_TIERS = [1, 2, 3, 4, 5, 6, 7];
const INITIAL_VISIBLE_CARDS = 96;
const MORE_VISIBLE_CARDS = 96;
const ARCHIVE_PAGE_SIZE = 72;

const CARD_NAME_OVERRIDES: Record<string, string> = {
  'bacon blood gem': 'Кровавые самоцветы',
  'bacon pass tooltip': 'Передача карт',
  'bacon refresh': 'Обновление таверны',
};

const RACE_ICON_BY_SLUG: Record<string, string> = {
  all: '/bg-legacy/assset/общее.webp',
  beast: '/bg-legacy/assset/зверь.webp',
  demon: '/bg-legacy/assset/демоны.webp',
  dragon: '/bg-legacy/assset/драконы.webp',
  elemental: '/bg-legacy/assset/элементали.webp',
  mech: '/bg-legacy/assset/механизмы.webp',
  murloc: '/bg-legacy/assset/мурлоки.webp',
  naga: '/bg-legacy/assset/наги.webp',
  pirate: '/bg-legacy/assset/пираты.webp',
  quilboar: '/bg-legacy/assset/свинобразы.webp',
  undead: '/bg-legacy/assset/нежить.webp',
};

function tavernIcon(tier: number | string): string {
  return `/bg-legacy/assset/tier${tier}.png`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
  return payload as T;
}

function formatDecimal(value: unknown, digits = 2): string {
  if (!Number.isFinite(Number(value))) return '—';
  return Number(value).toFixed(digits).replace('.', ',');
}

function formatPercent(value: unknown, digits = 1): string {
  if (!Number.isFinite(Number(value))) return '—';
  return `${formatDecimal(value, digits)}%`;
}

function formatCount(value: unknown): string {
  if (!Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('ru-RU');
}

function cleanSearch(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е').trim();
}

function slugify(value: string): string {
  return cleanSearch(value)
    .replace(/['’]/g, '')
    .replace(/[^a-zа-я0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'card';
}

function cardSlug(card: LibraryCard): string {
  return `${slugify(cardRuName(card) || card.name?.en || card.card_id)}-${card.dbf}`;
}

function dbfFromPath(path: string): number | null {
  const match = decodeURIComponent(path).match(/-(\d+)\/?$/);
  return match ? Number(match[1]) : null;
}

function libraryRoute(path: string): { page: 'list' | 'detail'; kind: LibraryKind; pool: PoolMode; dbfId: number | null } {
  const normalized = path.replace(/\/+$/, '') || '/library';
  const pool: PoolMode = normalized.startsWith('/library/archive') ? 'archive' : 'current';
  const kind: LibraryKind = normalized.includes('/spells') ? 'spell' : 'minion';
  const detailBase = pool === 'archive' ? `/library/archive/${kind === 'spell' ? 'spells' : 'minions'}/` : `/library/${kind === 'spell' ? 'spells' : 'minions'}/`;
  const isDetail = normalized.startsWith(detailBase) && normalized.length > detailBase.length;
  return { page: isDetail ? 'detail' : 'list', kind, pool, dbfId: isDetail ? dbfFromPath(normalized) : null };
}

function cardPath(card: LibraryCard, pool: PoolMode): string {
  const section = card.card_type.slug === 'spell' ? 'spells' : 'minions';
  const prefix = pool === 'archive' ? `/library/archive/${section}` : `/library/${section}`;
  return `${prefix}/${cardSlug(card)}`;
}

function cardRuName(card: LibraryCard): string {
  const keys = [card.name?.ru, card.name?.en, card.card_id].map(value => cleanSearch(String(value || '')));
  for (const key of keys) {
    if (CARD_NAME_OVERRIDES[key]) return CARD_NAME_OVERRIDES[key];
  }
  return card.name?.ru || card.name?.en || card.card_id;
}

function cardEnName(card: LibraryCard): string {
  return card.name?.en || card.card_id;
}

function isArtOnlyImage(url?: string | null): boolean {
  return Boolean(url && (/\/uploads\/art\//.test(url) || /\/v1\/orig\//.test(url)));
}

function properImage(url?: string | null): string | null {
  return url && !isArtOnlyImage(url) ? url : null;
}

function localDbImageUrl(cardId: string, folder: 'cards' | 'framed' | 'golden' | 'art'): string {
  const ext = folder === 'art' ? 'jpg' : 'png';
  return `https://db.kolodahs.ru/uploads/${folder}/${encodeURIComponent(cardId)}.${ext}`;
}

function isLikelyGoldenCardId(cardId: string): boolean {
  return /_G($|t$)/.test(cardId);
}

function baseCardId(cardId: string): string {
  return cardId.replace(/_Gt$/, 't').replace(/_G$/, '');
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach(value => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    result.push(value);
  });
  return result;
}

function cardImageCandidates(card: LibraryCard, includeArt = false): string[] {
  const id = card.card_id || '';
  const baseId = baseCardId(id);
  const isGoldenId = id && isLikelyGoldenCardId(id) && baseId !== id;
  const baseFallbacks = isGoldenId
    ? [
        localDbImageUrl(baseId, 'cards'),
        localDbImageUrl(baseId, 'framed'),
        localDbImageUrl(baseId, 'golden'),
        `https://art.hearthstonejson.com/v1/bgs/latest/ruRU/512x/${encodeURIComponent(baseId)}.png`,
      ]
    : [];
  return uniqueStrings([
    ...baseFallbacks,
    properImage(card.images?.card),
    properImage(card.images?.framed),
    properImage(card.images?.golden),
    includeArt ? card.images?.art : null,
  ]);
}

function primaryCardImage(card: LibraryCard): string | null {
  return cardImageCandidates(card, false)[0] || null;
}

function detailCardImage(card: LibraryCard): string | null {
  return cardImageCandidates(card, true)[0] || null;
}

function fallbackCardImages(card: LibraryCard, current: string, includeArt = false): string[] {
  return cardImageCandidates(card, includeArt).filter(candidate => candidate !== current);
}

function goldenCardImage(card: LibraryCard): string | null {
  const golden = properImage(card.images?.golden);
  return golden && golden !== primaryCardImage(card) ? golden : null;
}

function hasReliableGolden(card: LibraryCard): boolean {
  return Boolean(card.asset_status?.local_golden || properImage(card.images?.golden));
}

function isCompanionOrBuddy(card: LibraryCard): boolean {
  const cardId = card.card_id || '';
  const text = cleanSearch([cardId, card.name?.ru, card.name?.en, card.text_ru].filter(Boolean).join(' '));
  return /buddy|companion|компаньон|напарник|tb_baconshop_hero|_hero_.*buddy|hero_.*buddy/.test(text);
}

function isGeneratedArchiveToken(card: LibraryCard): boolean {
  const cardId = card.card_id || '';
  const text = cleanSearch([cardId, card.name?.ru, card.name?.en].filter(Boolean).join(' '));
  return (
    isLikelyGoldenCardId(cardId) ||
    /(^|_)magicitem_/i.test(cardId) ||
    /^TB_BaconUps_/i.test(cardId) ||
    /_HERO_/i.test(cardId) ||
    /(^|_)HERO_/i.test(cardId) ||
    /(^|_)Bacon(BloodGem|Refresh|Pass|Tooltip)(_|$)/i.test(cardId) ||
    /\bbacon blood gem\b|\bbacon pass tooltip\b|\bbacon refresh\b|кровавые самоцветы|передача карт|обновление таверны/.test(text) ||
    /(?:^|_)BG[^_]*_[A-Z0-9]+t\d*$/i.test(cardId) ||
    /(?:^|_)BGS?_[A-Z0-9]+t\d*$/i.test(cardId) ||
    /(?:^|_)TB_[A-Za-z0-9]+_[A-Za-z0-9]+t\d*$/i.test(cardId)
  );
}

function isArchiveDisplayCard(card: LibraryCard, kind: LibraryKind, pool: PoolMode): boolean {
  if (pool !== 'archive' || kind !== 'minion') return true;
  if (isCompanionOrBuddy(card)) return false;
  if (isGeneratedArchiveToken(card)) return false;
  return hasReliableGolden(card);
}

function hideBrokenTileImage(event: React.SyntheticEvent<HTMLImageElement>): void {
  const image = event.currentTarget;
  const fallbacks = (image.dataset.fallbacks || '').split('|').filter(Boolean);
  const index = Number(image.dataset.fallbackIndex || 0);
  const fallback = fallbacks[index];
  if (fallback) {
    image.dataset.fallbackIndex = String(index + 1);
    image.src = fallback;
    return;
  }
  const tile = image.closest('[data-library-card-tile]') as HTMLElement | null;
  if (tile) tile.style.display = 'none';
}

function hideBrokenImage(event: React.SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.style.display = 'none';
}

function fallbackBrokenHeroImage(event: React.SyntheticEvent<HTMLImageElement>): void {
  const image = event.currentTarget;
  const fallbacks = (image.dataset.fallbacks || '').split('|').filter(Boolean);
  const index = Number(image.dataset.fallbackIndex || 0);
  const fallback = fallbacks[index];
  if (fallback) {
    image.dataset.fallbackIndex = String(index + 1);
    image.src = fallback;
    return;
  }
  if (image.dataset.logoFallbackTried !== 'true') {
    image.dataset.logoFallbackTried = 'true';
    image.src = '/arena-logo-icon.webp?v=mana-swirl-20260624';
    return;
  }
  image.style.display = 'none';
}

function cardFamilyKey(card: LibraryCard): string {
  return [
    card.card_type.slug,
    cleanSearch(cardRuName(card) || card.name?.en || card.card_id),
    cleanSearch(card.name?.en || ''),
    card.tavern_tier || 'none',
    card.creature_type?.slug || 'none',
  ].join('|');
}

function cardQualityScore(card: LibraryCard): number {
  const cardId = cleanSearch(card.card_id || '');
  const isLikelyGolden = cardId.includes('_g') || cardId.includes('golden') || /_g$/.test(cardId);
  const statTotal = Number(card.attack || 0) + Number(card.health || 0);
  return (
    (card.in_pool ? 1000 : 0) +
    (primaryCardImage(card) ? 300 : 0) +
    (card.images?.card ? 60 : 0) +
    (goldenCardImage(card) ? 30 : 0) +
    (isLikelyGolden ? 0 : 25) -
    Math.max(0, statTotal) * 0.02
  );
}

function dedupeLibraryCards(cards: LibraryCard[]): LibraryCard[] {
  const byFamily = new Map<string, LibraryCard>();
  cards.forEach(card => {
    if (!card?.dbf) return;
    const key = cardFamilyKey(card);
    const current = byFamily.get(key);
    if (!current || cardQualityScore(card) > cardQualityScore(current)) {
      byFamily.set(key, card);
    }
  });
  return Array.from(byFamily.values());
}

async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  try {
    return await fetchJson<T>(url);
  } catch {
    return null;
  }
}

function setLibraryMeta(title: string, description: string, slug: string, image?: string | null): void {
  document.title = title;
  const metaDescription = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (metaDescription) metaDescription.content = description;
  const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
  if (ogTitle) ogTitle.content = title;
  const ogDesc = document.querySelector<HTMLMetaElement>('meta[property="og:description"]');
  if (ogDesc) ogDesc.content = description;
  const ogUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
  if (ogUrl) ogUrl.content = `${SITE_URL}${slug}`;
  const ogImage = document.querySelector<HTMLMetaElement>('meta[property="og:image"]');
  if (ogImage && image) ogImage.content = image;
  let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = `${SITE_URL}${slug}`;
}

function flattenSpellStats(payload: any): FirestoneSpellStat[] {
  const tiers = payload?.view?.tiers || {};
  return Object.values(tiers).flatMap((items: any) => Array.isArray(items) ? items : []) as FirestoneSpellStat[];
}

function parseStrategies(source: string): StrategyEntry[] {
  const match = source.match(/window\.compsStatic\s*=\s*([\s\S]*?);\s*$/);
  if (!match) return [];
  try {
    const payload = Function(`"use strict"; return (${match[1].replace(/;+\s*$/, '')});`)();
    return Array.isArray(payload?.comps) ? payload.comps : [];
  } catch {
    return [];
  }
}

function searchText(card: LibraryCard): string {
  return cleanSearch([
    card.name?.ru,
    card.name?.en,
    cardRuName(card),
    card.card_id,
    card.dbf,
    card.text_ru,
    card.creature_type?.name_ru,
    card.creature_type?.slug,
    ...(card.mechanics || []).flatMap(mechanic => [mechanic.slug, mechanic.name_ru]),
  ].filter(Boolean).join(' '));
}

function containsSearchText(value: string, needle: string): boolean {
  return value.includes(needle);
}

function cardMatchesStrategy(card: LibraryCard, strategy: StrategyEntry): boolean {
  return (strategy.cards || []).some(item => {
    if (Number(item.dbfId) === Number(card.dbf)) return true;
    if (item.id && item.id === card.card_id) return true;
    return false;
  });
}

function strategySourceParam(strategy: StrategyEntry): string {
  return cleanSearch(strategy.source).includes('hsreplay') ? 'hsreplay' : 'firestone';
}

function strategyTierListPath(strategy: StrategyEntry): string {
  const params = new URLSearchParams({
    list: 'strategies',
    source: strategySourceParam(strategy),
    strategy: strategy.key,
  });
  if (strategy.title) params.set('q', strategy.title);
  return `/tierlist?${params.toString()}#strategy`;
}

function metricTone(value: unknown): string {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 'text-[#826b49]';
  if (numberValue > 0.4) return 'text-[#2f7a3e]';
  if (numberValue > 0) return 'text-[#8a651f]';
  return 'text-[#a33a3a]';
}

function useLibraryData(kind: LibraryKind, pool: PoolMode) {
  const [cards, setCards] = useState<LibraryCard[]>([]);
  const [meta, setMeta] = useState<LibraryMeta>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const inPool = pool === 'current' ? '1' : '0';
    const requests: Array<Promise<unknown>> = [
      fetchJson<LibraryMeta>('/api/bg/library/meta'),
      fetchJson<{ data: LibraryCard[] }>(`/api/bg/library/cards?card_type=${kind}&in_pool=${inPool}`),
    ];

    Promise.all(requests)
      .then(results => {
        if (!alive) return;
        setMeta(results[0] as LibraryMeta);
        setCards(dedupeLibraryCards(((results[1] as { data?: LibraryCard[] }).data || []).filter(card => card?.dbf)));
      })
      .catch(errorValue => {
        if (alive) setError(errorValue?.message || 'Не удалось загрузить библиотеку');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
  }, [kind, pool]);

  return { cards, meta, loading, error };
}

function MetricCard({ label, value, caption, tone }: { label: string; value: string; caption?: string; tone?: string }) {
  return (
    <div className="rounded-md border border-[#cbd9ed] bg-[#f8fbff] px-4 py-3 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#60718a]">{label}</p>
      <p className={`mt-1 font-hs text-2xl ${tone || 'text-[#7c5b24]'}`}>{value}</p>
      {caption && <p className="mt-1 text-xs text-[#657893]">{caption}</p>}
    </div>
  );
}

function MiniChart({ points, color = '#f1d47b', unit = '', invert = false }: { points: Array<{ x: string | number; y: number }>; color?: string; unit?: string; invert?: boolean }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const clean = points.filter(point => Number.isFinite(Number(point.y)));
  if (clean.length < 2) return <div className="flex h-44 items-center justify-center text-sm text-[#657893]">Недостаточно точек для графика</div>;
  const width = 560;
  const height = 190;
  const padX = 34;
  const padY = 24;
  const values = clean.map(point => Number(point.y));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const xFor = (index: number) => padX + (index / Math.max(1, clean.length - 1)) * (width - padX * 2);
  const yFor = (value: number) => {
    const normalized = (value - min) / range;
    const plotted = invert ? normalized : 1 - normalized;
    return padY + plotted * (height - padY * 2);
  };
  const path = clean.map((point, index) => `${index === 0 ? 'M' : 'L'}${xFor(index).toFixed(1)} ${yFor(Number(point.y)).toFixed(1)}`).join(' ');
  const last = clean[clean.length - 1];
  const active = clean[activeIndex ?? clean.length - 1];
  const activeSafeIndex = Math.max(0, activeIndex ?? clean.length - 1);
  const activeX = xFor(activeSafeIndex);
  const activeY = yFor(Number(active.y));
  const activeValue = `${formatDecimal(active.y, unit === '%' ? 1 : 2)}${unit}`;
  const moveActivePoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const ratio = position / Math.max(1, rect.width);
    const index = Math.round(ratio * (clean.length - 1));
    setActiveIndex(Math.min(clean.length - 1, Math.max(0, index)));
  };
  return (
    <div className="relative overflow-hidden rounded-md border border-[#d3deef] bg-[#fbfdff]">
      <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-md border border-[#cbd9ed] bg-white/95 px-3 py-2 text-sm shadow-sm">
        <p className="font-semibold text-[#26374f]">Ход: {String(active.x).slice(0, 10)}</p>
        <p className="mt-1 text-[#657893]"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />{activeValue}</p>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        className="h-48 w-full touch-none cursor-crosshair"
        onPointerMove={moveActivePoint}
        onPointerLeave={() => setActiveIndex(null)}
        onPointerDown={moveActivePoint}
      >
        {[0, 1, 2, 3].map(line => {
          const y = padY + (line / 3) * (height - padY * 2);
          return <line key={line} x1={padX} x2={width - padX} y1={y} y2={y} stroke="rgba(89,103,126,0.18)" />;
        })}
        <line x1={activeX} x2={activeX} y1={padY} y2={height - padY} stroke="rgba(38,55,79,0.24)" strokeDasharray="4 6" />
        <path d={path} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {clean.map((point, index) => (
          <circle key={`${point.x}-${index}`} cx={xFor(index)} cy={yFor(Number(point.y))} r="4" fill={color} stroke="#fbfdff" strokeWidth="2" />
        ))}
        <circle cx={activeX} cy={activeY} r="7" fill={color} stroke="#26374f" strokeWidth="2" />
        <text x={padX} y={height - 6} fill="#657893" fontSize="13">{String(clean[0].x).slice(0, 10)}</text>
        <text x={width - padX} y={height - 6} textAnchor="end" fill="#657893" fontSize="13">{String(last.x).slice(0, 10)}</text>
        <text x={width - padX} y={padY - 7} textAnchor="end" fill="#26374f" fontSize="14">{formatDecimal(last.y, unit === '%' ? 1 : 2)}{unit}</text>
      </svg>
    </div>
  );
}

function FilterChip({ active, children, onClick, title }: { key?: React.Key; active: boolean; children: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
        active
          ? 'border-[#e4c675] bg-[#e4c675] text-[#101827] shadow-sm'
          : 'border-[#cbd9ed] bg-[#ffffff] text-[#34445c] hover:border-[#d3af55] hover:text-[#6d4f1c]'
      }`}
    >
      {children}
    </button>
  );
}

function LibraryCardTile({
  card,
  pool,
  navigatePath,
}: {
  key?: React.Key;
  card: LibraryCard;
  pool: PoolMode;
  navigatePath: (path: string) => void;
}) {
  const href = cardPath(card, pool);
  const image = primaryCardImage(card) || '/arena-logo-icon.webp?v=mana-swirl-20260624';
  const fallbacks = fallbackCardImages(card, image, false);
  const golden = goldenCardImage(card);
  return (
    <a
      href={href}
      onClick={(event) => { event.preventDefault(); navigatePath(href); }}
      data-library-card-tile
      className="group relative block overflow-visible rounded-md p-1 text-center transition-transform hover:-translate-y-1"
      style={{ textDecoration: 'none' }}
    >
      <div className="relative mx-auto aspect-[0.72] w-full max-w-[240px]">
        <img
          src={image}
          alt={cardRuName(card)}
          className="relative z-10 h-full w-full object-contain drop-shadow-[0_16px_20px_rgba(21,31,47,0.22)] transition duration-200 group-hover:scale-[1.03] sm:group-hover:-translate-x-5"
          loading="lazy"
          data-fallbacks={fallbacks.join('|') || undefined}
          onError={hideBrokenTileImage}
        />
        {golden && (
          <img
            src={golden}
            alt={`${cardRuName(card)}, золотая версия`}
            className="pointer-events-none absolute inset-0 z-20 h-full w-full translate-x-2 object-contain opacity-0 drop-shadow-[0_20px_26px_rgba(21,31,47,0.28)] transition duration-200 group-hover:translate-x-8 group-hover:opacity-100 sm:group-hover:translate-x-12"
            loading="lazy"
            onError={hideBrokenImage}
          />
        )}
      </div>
      <span className="sr-only">Открыть страницу карты {cardRuName(card)}</span>
    </a>
  );
}

function ChartPanel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[#cbd9ed] bg-[#f8fbff] p-4">
      <h3 className="font-hs text-xl text-[#26374f]">{title}</h3>
      {subtitle && <p className="mb-3 mt-1 text-sm text-[#657893]">{subtitle}</p>}
      {children}
    </div>
  );
}

function LibraryListPage({ kind, pool, navigatePath }: { kind: LibraryKind; pool: PoolMode; navigatePath: (path: string) => void }) {
  const { cards, meta, loading, error } = useLibraryData(kind, pool);
  const [query, setQuery] = useState('');
  const [tavernFilters, setTavernFilters] = useState<string[]>([]);
  const [raceFilters, setRaceFilters] = useState<string[]>([]);
  const [mechanic, setMechanic] = useState('ALL');
  const [includeDuos, setIncludeDuos] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_CARDS);
  const [archivePage, setArchivePage] = useState(1);

  useEffect(() => {
    const section = kind === 'spell' ? 'spells' : 'minions';
    const kindLabel = kind === 'spell' ? 'заклинаний' : 'существ';
    const slug = pool === 'archive' ? `/library/archive/${section}` : `/library/${section}`;
    const title = pool === 'archive'
      ? `Архив ${kindLabel} Полей сражений — BG Hearthstone | HS-Manacost`
      : `${kind === 'spell' ? 'Заклинания' : 'Существа'} Полей сражений — библиотека BG Hearthstone | HS-Manacost`;
    const description = pool === 'archive'
      ? `Архив ${kindLabel} Полей сражений Hearthstone, которые сейчас не находятся в активном пуле.`
      : `Актуальная библиотека ${kindLabel} Полей сражений Hearthstone с фильтрами по таверне, типу, механикам и статистикой.`;
    setLibraryMeta(title, description, slug);
  }, [kind, pool]);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_CARDS);
    setArchivePage(1);
  }, [query, tavernFilters, raceFilters, mechanic, includeDuos, kind, pool]);

  const imageReadyCards = useMemo(() => cards.filter(card => primaryCardImage(card)), [cards]);
  const hiddenWithoutImage = Math.max(0, cards.length - imageReadyCards.length);
  const hiddenArchiveMinions = useMemo(
    () => pool === 'archive' && kind === 'minion'
      ? imageReadyCards.filter(card => !isArchiveDisplayCard(card, kind, pool)).length
      : 0,
    [imageReadyCards, kind, pool]
  );

  const creatureTypes = useMemo(() => {
    const seen = new Map<string, string>();
    (meta.creature_types || []).forEach(item => {
      if (item.slug && item.name_ru) seen.set(item.slug, item.name_ru);
    });
    cards.forEach(card => {
      if (card.creature_type?.slug && card.creature_type?.name_ru) seen.set(card.creature_type.slug, card.creature_type.name_ru);
    });
    return Array.from(seen.entries()).filter(([slug]) => slug !== 'all');
  }, [cards, meta.creature_types]);

  const mechanics = useMemo(() => {
    const seen = new Map<string, string>();
    (meta.mechanics || []).forEach(item => seen.set(item.slug, item.name_ru));
    cards.forEach(card => (card.mechanics || []).forEach(item => seen.set(item.slug, item.name_ru)));
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  }, [cards, meta.mechanics]);

  const filtered = useMemo(() => {
    const needle = cleanSearch(query);
    const rows: LibraryCard[] = [];
    const tavernSet = new Set(tavernFilters);
    const raceSet = new Set(raceFilters);
    for (const card of imageReadyCards) {
      if (!isArchiveDisplayCard(card, kind, pool)) continue;
      if (needle && !containsSearchText(searchText(card), needle)) continue;
      if (!includeDuos && card.duos_only) continue;
      if (tavernSet.size > 0 && !tavernSet.has(String(card.tavern_tier || ''))) continue;
      if (kind === 'minion' && raceSet.size > 0 && !raceSet.has(card.creature_type?.slug || '')) continue;
      if (mechanic !== 'ALL' && !(card.mechanics || []).some(item => item.slug === mechanic)) continue;
      rows.push(card);
    }
    return rows.sort((a, b) => Number(a.tavern_tier || 99) - Number(b.tavern_tier || 99) || cardRuName(a).localeCompare(cardRuName(b), 'ru'));
  }, [imageReadyCards, includeDuos, kind, mechanic, pool, query, raceFilters, tavernFilters]);

  const archivePageCount = Math.max(1, Math.ceil(filtered.length / ARCHIVE_PAGE_SIZE));
  const normalizedArchivePage = Math.min(archivePage, archivePageCount);
  const archiveStart = (normalizedArchivePage - 1) * ARCHIVE_PAGE_SIZE;
  const visible = pool === 'archive'
    ? filtered.slice(archiveStart, archiveStart + ARCHIVE_PAGE_SIZE)
    : filtered.slice(0, visibleCount);
  const grouped = useMemo(() => {
    const groups = new Map<string, LibraryCard[]>();
    visible.forEach(card => {
      const key = card.tavern_tier ? String(card.tavern_tier) : 'none';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(card);
    });
    return Array.from(groups.entries());
  }, [visible]);

  const basePath = pool === 'archive' ? '/library/archive' : '/library';
  const kindTitle = kind === 'minion' ? 'Существа' : 'Заклинания';
  const poolTitle = pool === 'archive' ? 'Архив' : 'Актуальный пул';
  const toggleTavern = (tier: string) => {
    setTavernFilters(current => current.includes(tier) ? current.filter(item => item !== tier) : [...current, tier]);
  };
  const toggleRace = (slug: string) => {
    setRaceFilters(current => current.includes(slug) ? current.filter(item => item !== slug) : [...current, slug]);
  };
  const archivePages = useMemo(() => {
    const pages = new Set<number>([1, archivePageCount, normalizedArchivePage]);
    for (let page = normalizedArchivePage - 2; page <= normalizedArchivePage + 2; page += 1) {
      if (page >= 1 && page <= archivePageCount) pages.add(page);
    }
    return Array.from(pages).sort((a, b) => a - b);
  }, [archivePageCount, normalizedArchivePage]);

  return (
    <div className="space-y-6 text-[#26374f]">
      <section className="rounded-lg border border-[#cbd9ed] bg-[#f8fbff] p-4 shadow-[0_16px_38px_rgba(68,88,122,0.14)] sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-hs text-xs uppercase tracking-[0.18em] text-[#8a651f]">Battlegrounds</p>
            <h1 className="mt-2 font-hs text-3xl text-[#23314a] sm:text-4xl">{pool === 'archive' ? 'Архив карт' : 'Библиотека'}</h1>
            <p className="mt-2 max-w-3xl text-sm text-[#5e708a]">
              {pool === 'archive'
                ? 'Существа и заклинания, которые уже были в Полях сражений, но сейчас не находятся в активном пуле. В архиве показываем только визуальную карточку без статистики.'
                : 'Актуальные существа и заклинания активного пула: фильтры по таверне, типу, механикам и переход на подробную статистику.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/library" onClick={(e) => { e.preventDefault(); navigatePath('/library'); }} className={`rounded-md border px-4 py-2 font-hs text-sm ${pool === 'current' ? 'border-[#e4c675] bg-[#e4c675] text-[#101827]' : 'border-[#cbd9ed] bg-[#ffffff] text-[#33445d]'}`} style={{ textDecoration: 'none' }}>
              <BookOpen size={16} className="mr-2 inline" />В пуле
            </a>
            <a href="/library/archive" onClick={(e) => { e.preventDefault(); navigatePath('/library/archive'); }} className={`rounded-md border px-4 py-2 font-hs text-sm ${pool === 'archive' ? 'border-[#e4c675] bg-[#e4c675] text-[#101827]' : 'border-[#cbd9ed] bg-[#ffffff] text-[#33445d]'}`} style={{ textDecoration: 'none' }}>
              <Archive size={16} className="mr-2 inline" />Архив
            </a>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[#cbd9ed] bg-[#f3f7fe] p-4 shadow-sm sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_auto]">
          <label className="relative block">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7b8da6]" size={20} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              type="search"
              placeholder="Поиск: например, Боевой клич, Мурлок, Ривендер, Banana"
              className="h-12 w-full rounded-md border border-[#c5d4e9] bg-[#ffffff] pl-12 pr-4 text-base font-semibold text-[#26374f] outline-none transition-colors placeholder:text-[#8b9ab0] focus:border-[#d3af55]"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <a href={`${basePath}/minions`} onClick={(e) => { e.preventDefault(); navigatePath(`${basePath}/minions`); }} className={`rounded-md border px-4 py-3 font-hs text-sm ${kind === 'minion' ? 'border-[#e4c675] bg-[#e4c675] text-[#101827]' : 'border-[#cbd9ed] bg-[#ffffff] text-[#33445d]'}`} style={{ textDecoration: 'none' }}>Существа</a>
            <a href={`${basePath}/spells`} onClick={(e) => { e.preventDefault(); navigatePath(`${basePath}/spells`); }} className={`rounded-md border px-4 py-3 font-hs text-sm ${kind === 'spell' ? 'border-[#e4c675] bg-[#e4c675] text-[#101827]' : 'border-[#cbd9ed] bg-[#ffffff] text-[#33445d]'}`} style={{ textDecoration: 'none' }}>Заклинания</a>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <details className="rounded-md border border-[#cbd9ed] bg-[#ffffff] p-3" open>
            <summary className="flex cursor-pointer list-none items-center justify-between font-hs text-sm text-[#26374f]">
              <span>Формат</span><ChevronDown size={16} />
            </summary>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setIncludeDuos(value => !value)}
                className={`inline-flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
                  includeDuos ? 'border-[#e4c675] bg-[#e4c675] text-[#101827]' : 'border-[#cbd9ed] bg-white text-[#34445c] hover:border-[#d3af55]'
                }`}
              >
                <span className={`h-4 w-8 rounded-full p-0.5 transition-colors ${includeDuos ? 'bg-[#26374f]' : 'bg-[#cbd9ed]'}`}>
                  <span className={`block h-3 w-3 rounded-full bg-white transition-transform ${includeDuos ? 'translate-x-4' : ''}`} />
                </span>
                Показывать карты Duo
              </button>
              <span className="text-sm text-[#657893]">Выключено: список ближе к одиночному формату. Включено: добавляются карты дуо-режима.</span>
            </div>
          </details>

          <details className="rounded-md border border-[#cbd9ed] bg-[#ffffff] p-3" open>
            <summary className="flex cursor-pointer list-none items-center justify-between font-hs text-sm text-[#26374f]">
              <span className="flex items-center gap-2"><Filter size={16} />Уровень таверны</span><ChevronDown size={16} />
            </summary>
            <div className="mt-3 flex flex-wrap gap-2">
              <FilterChip active={tavernFilters.length === 0} onClick={() => setTavernFilters([])}>Все уровни</FilterChip>
              {TAVERN_TIERS.map(tier => (
                <FilterChip key={tier} active={tavernFilters.includes(String(tier))} onClick={() => toggleTavern(String(tier))} title={`Таверна ${tier}`}>
                  <img src={tavernIcon(tier)} alt="" className="h-7 w-7" loading="lazy" />Таверна {tier}
                </FilterChip>
              ))}
            </div>
          </details>

          {kind === 'minion' && (
            <details className="rounded-md border border-[#cbd9ed] bg-[#ffffff] p-3" open>
              <summary className="flex cursor-pointer list-none items-center justify-between font-hs text-sm text-[#26374f]">
                <span>Тип существа</span><ChevronDown size={16} />
              </summary>
              <div className="mt-3 flex flex-wrap gap-2">
                <FilterChip active={raceFilters.length === 0} onClick={() => setRaceFilters([])}>Все типы</FilterChip>
                {creatureTypes.map(([slug, label]) => (
                  <FilterChip key={slug} active={raceFilters.includes(slug)} onClick={() => toggleRace(slug)}>
                    {RACE_ICON_BY_SLUG[slug] && <img src={RACE_ICON_BY_SLUG[slug]} alt="" className="h-7 w-7 rounded-full" loading="lazy" />}{label}
                  </FilterChip>
                ))}
              </div>
            </details>
          )}

          <details className="rounded-md border border-[#cbd9ed] bg-[#ffffff] p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between font-hs text-sm text-[#26374f]">
              <span>Механики</span><ChevronDown size={16} />
            </summary>
            <div className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-auto pr-1">
              <FilterChip active={mechanic === 'ALL'} onClick={() => setMechanic('ALL')}>Все механики</FilterChip>
              {mechanics.map(([slug, label]) => (
                <FilterChip key={slug} active={mechanic === slug} onClick={() => setMechanic(slug)}>{label}</FilterChip>
              ))}
            </div>
          </details>
        </div>
      </section>

      <section className="overflow-visible rounded-lg border border-[#cbd9ed] bg-[#f8fbff] p-4 shadow-sm sm:p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-hs text-xl text-[#26374f]">{kindTitle} · {poolTitle}</p>
            <p className="text-sm text-[#657893]">
              Показано {pool === 'archive' ? visible.length : Math.min(visibleCount, filtered.length)} из {filtered.length}. Всего загружено {cards.length}.
              {hiddenWithoutImage > 0 && ` Без изображения скрыто: ${hiddenWithoutImage}.`}
              {hiddenArchiveMinions > 0 && ` Компаньоны, токены, повторы и карты без golden скрыты: ${hiddenArchiveMinions}.`}
            </p>
          </div>
          {loading && <span className="font-hs text-[#8a651f]">Загружаю...</span>}
        </div>

        {error && <div className="rounded-md border border-[#efb4b4] bg-[#fff1f1] p-4 text-[#8f2424]">{error}</div>}
        {!loading && !error && filtered.length === 0 && <div className="rounded-md border border-[#cbd9ed] bg-[#ffffff] p-8 text-center text-[#657893]">По выбранным фильтрам ничего не найдено.</div>}

        <div className="space-y-8">
          {grouped.map(([tier, items]) => (
            <div key={tier}>
              <div className="mb-4 flex items-center gap-3">
                {tier !== 'none' && <img src={tavernIcon(tier)} alt="" className="h-10 w-10" loading="lazy" />}
                <h2 className="font-hs text-2xl text-[#26374f]">{tier === 'none' ? 'Без уровня таверны' : `Таверна ${tier}`}</h2>
                <div className="h-px flex-1 bg-[#cbd9ed]" />
              </div>
              <div className="grid overflow-visible grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {items.map(card => (
                  <LibraryCardTile
                    key={card.dbf}
                    card={card}
                    pool={pool}
                    navigatePath={navigatePath}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {pool === 'archive' && filtered.length > ARCHIVE_PAGE_SIZE && (
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            <button type="button" disabled={normalizedArchivePage === 1} onClick={() => setArchivePage(page => Math.max(1, page - 1))} className="rounded-md border border-[#cbd9ed] bg-white px-4 py-2 font-semibold text-[#33445d] disabled:cursor-not-allowed disabled:opacity-45">
              Назад
            </button>
            {archivePages.map((page, index) => (
              <React.Fragment key={page}>
                {index > 0 && page - archivePages[index - 1] > 1 && <span className="px-1 text-[#657893]">...</span>}
                <button
                  type="button"
                  onClick={() => setArchivePage(page)}
                  className={`h-10 min-w-10 rounded-md border px-3 font-semibold ${page === normalizedArchivePage ? 'border-[#e4c675] bg-[#e4c675] text-[#101827]' : 'border-[#cbd9ed] bg-white text-[#33445d] hover:border-[#d3af55]'}`}
                >
                  {page}
                </button>
              </React.Fragment>
            ))}
            <button type="button" disabled={normalizedArchivePage === archivePageCount} onClick={() => setArchivePage(page => Math.min(archivePageCount, page + 1))} className="rounded-md border border-[#cbd9ed] bg-white px-4 py-2 font-semibold text-[#33445d] disabled:cursor-not-allowed disabled:opacity-45">
              Вперёд
            </button>
          </div>
        )}

        {pool !== 'archive' && visibleCount < filtered.length && (
          <div className="mt-8 text-center">
            <button type="button" onClick={() => setVisibleCount(count => count + MORE_VISIBLE_CARDS)} className="rounded-md border border-[#e4c675] bg-[#e4c675] px-6 py-3 font-hs text-[#101827]">
              Показать ещё
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function DetailPage({ kind, pool, dbfId, navigatePath }: { kind: LibraryKind; pool: PoolMode; dbfId: number; navigatePath: (path: string) => void }) {
  const [card, setCard] = useState<LibraryCard | null>(null);
  const [detail, setDetail] = useState<MinionDetail | null>(null);
  const [spellStats, setSpellStats] = useState<FirestoneSpellStat[]>([]);
  const [relatedCards, setRelatedCards] = useState<LibraryCard[]>([]);
  const [strategies, setStrategies] = useState<StrategyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const baseRequests: Array<Promise<unknown>> = [
      fetchJson<LibraryCard>(`/api/bg/library/cards/by-dbf/${dbfId}`),
      fetch('/bg-legacy/comps-data.js', { cache: 'force-cache' }).then(response => response.ok ? response.text() : ''),
      pool === 'current' ? fetchJson<{ data: LibraryCard[] }>(`/api/bg/library/cards?card_type=${kind}&in_pool=1`).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    ];
    if (kind === 'minion' && pool === 'current') {
      baseRequests.push(fetchJsonOrNull<MinionDetail>(`/api/bg/library/minions/${dbfId}`));
    } else if (kind === 'spell' && pool === 'current') {
      baseRequests.push(fetchJsonOrNull<any>('/api/bg/library/spell-stats'));
    } else {
      baseRequests.push(Promise.resolve(null));
    }

    Promise.all(baseRequests)
      .then(results => {
        if (!alive) return;
        const loadedCard = results[0] as LibraryCard;
        setCard(loadedCard);
        setStrategies(parseStrategies(String(results[1] || '')));
        setRelatedCards(dedupeLibraryCards(((results[2] as { data?: LibraryCard[] }).data || []).filter(item => item.dbf !== loadedCard.dbf)));
        if (kind === 'minion' && pool === 'current') {
          setDetail(results[3] as MinionDetail | null);
          setSpellStats([]);
        } else if (kind === 'spell' && pool === 'current') {
          setSpellStats(results[3] ? flattenSpellStats(results[3]) : []);
          setDetail(null);
        } else {
          setSpellStats([]);
          setDetail(null);
        }
        const loadedCardName = cardRuName(loadedCard);
        const title = pool === 'archive'
          ? `${loadedCardName} — архивная карта BG Hearthstone | HS-Manacost`
          : `${loadedCardName} — статистика ${kind === 'minion' ? 'существа' : 'заклинания'} BG Hearthstone | HS-Manacost`;
        const description = pool === 'archive'
          ? `${loadedCardName}: архивная карта Полей сражений Hearthstone вне активного пула.`
          : `${loadedCardName}: таверна ${loadedCard.tavern_tier || '—'}, ${loadedCard.creature_type?.name_ru || 'заклинание'}, механики и актуальная статистика Полей сражений.`;
        setLibraryMeta(title, description, cardPath(loadedCard, pool), detailCardImage(loadedCard));
      })
      .catch(errorValue => {
        if (alive) setError(errorValue?.message || 'Не удалось загрузить карту');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [dbfId, kind, pool]);

  const spellStat = useMemo(() => spellStats.find(item => Number(item.dbfId) === Number(dbfId)), [dbfId, spellStats]);
  const usedStrategies = useMemo(() => card ? strategies.filter(strategy => cardMatchesStrategy(card, strategy)).slice(0, 10) : [], [card, strategies]);
  const similar = useMemo(() => {
    if (!card) return [];
    const mechanicSet = new Set((card.mechanics || []).map(item => item.slug));
    const scored: Array<{ item: LibraryCard; score: number }> = [];
    for (const item of relatedCards) {
      const raceMatch = card.creature_type?.slug && item.creature_type?.slug === card.creature_type.slug ? 2 : 0;
      const tierMatch = card.tavern_tier && item.tavern_tier === card.tavern_tier ? 1 : 0;
      let mechanicMatch = 0;
      for (const mechanic of item.mechanics || []) {
        if (mechanicSet.has(mechanic.slug)) mechanicMatch += 1;
      }
      const score = raceMatch + tierMatch + mechanicMatch;
      if (score > 0) scored.push({ item, score });
    }
    return scored
      .sort((a, b) => b.score - a.score || cardRuName(a.item).localeCompare(cardRuName(b.item), 'ru'))
      .slice(0, 6)
      .map(row => row.item);
  }, [card, relatedCards]);

  if (loading) return <div className="py-16 text-center font-hs text-[#6b4c2a]">Загружаем страницу карты...</div>;
  if (error || !card) return <div className="rounded-lg border border-[#efb4b4] bg-[#fff1f1] p-6 text-[#8f2424]">{error || 'Карта не найдена'}</div>;

  const backPath = pool === 'archive' ? `/library/archive/${kind === 'spell' ? 'spells' : 'minions'}` : `/library/${kind === 'spell' ? 'spells' : 'minions'}`;
  const rounds = detail?.rounds || [];
  const mainImpact = kind === 'spell' ? spellStat?.impact : detail?.impact;
  const mainAverage = kind === 'spell' ? spellStat?.average_placement : detail?.avg_placement_with;
  const mainPopularity = kind === 'spell' ? spellStat?.total_played : detail?.popularity;
  const showStats = pool === 'current';
  const heroImage = detailCardImage(card) || '/arena-logo-icon.webp?v=mana-swirl-20260624';
  const currentCardName = cardRuName(card);

  return (
    <div className="space-y-6 text-[#26374f]">
      <button type="button" onClick={() => navigatePath(backPath)} className="inline-flex items-center gap-2 rounded-md border border-[#cbd9ed] bg-[#ffffff] px-4 py-2 text-sm font-semibold text-[#33445d] hover:border-[#d3af55]">
        <ArrowLeft size={16} /> Назад в {pool === 'archive' ? 'архив' : 'библиотеку'}
      </button>

      <section className="overflow-hidden rounded-lg border border-[#cbd9ed] bg-[#f8fbff] shadow-[0_16px_38px_rgba(68,88,122,0.14)]">
        <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[320px_1fr]">
          <div className="relative mx-auto w-full max-w-xs">
            <img src={heroImage} alt={currentCardName} className="w-full drop-shadow-[0_22px_30px_rgba(21,31,47,0.22)]" data-fallbacks={fallbackCardImages(card, heroImage, true).join('|') || undefined} onError={fallbackBrokenHeroImage} />
          </div>
          <div className="space-y-5">
            <div>
              <p className="font-hs text-xs uppercase tracking-[0.18em] text-[#8a651f]">{kind === 'minion' ? 'Существо' : 'Заклинание'} · {pool === 'archive' ? 'Архив' : 'Активный пул'}</p>
              <h1 className="mt-2 font-hs text-4xl text-[#23314a] sm:text-5xl">{currentCardName}</h1>
              <p className="mt-1 text-lg text-[#657893]">{cardEnName(card)}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {card.tavern_tier && <span className="inline-flex items-center gap-2 rounded-md border border-[#d6e1f1] bg-[#ffffff] px-3 py-2 font-semibold text-[#33445d]"><img src={tavernIcon(card.tavern_tier)} alt="" className="h-8 w-8" />Таверна {card.tavern_tier}</span>}
              {card.creature_type && <span className="inline-flex items-center gap-2 rounded-md border border-[#d6e1f1] bg-[#ffffff] px-3 py-2 font-semibold text-[#33445d]">{RACE_ICON_BY_SLUG[card.creature_type.slug] && <img src={RACE_ICON_BY_SLUG[card.creature_type.slug]} alt="" className="h-8 w-8 rounded-full" />} {card.creature_type.name_ru}</span>}
              {card.mechanics.map(mechanic => <span key={mechanic.slug} className="rounded-md border border-[#e5d3f1] bg-[#fbf4ff] px-3 py-2 font-semibold text-[#603f77]">{mechanic.name_ru}</span>)}
              {card.duos_only && <span className="rounded-md border border-[#bfdbfe] bg-[#eff6ff] px-3 py-2 font-semibold text-[#1f4e88]">Дуо</span>}
            </div>

            {showStats ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Impact" value={formatDecimal(mainImpact, 2)} tone={metricTone(mainImpact)} />
                <MetricCard label="Среднее место" value={formatDecimal(mainAverage, 2)} />
                <MetricCard label={kind === 'spell' ? 'Сыграно' : 'Популярность'} value={kind === 'spell' ? formatCount(mainPopularity) : formatPercent(mainPopularity, 1)} />
                <MetricCard label="Стратегии" value={String(usedStrategies.length)} caption="где карта встречается" />
              </div>
            ) : (
              <div className="rounded-md border border-[#d6e1f1] bg-[#ffffff] p-4 text-sm text-[#5e708a]">
                Карта вне активного пула. Для архива показываем справочную карточку без статистики, чтобы страница не зависела от мета-данных и не падала на старых dbf.
              </div>
            )}
          </div>
        </div>
      </section>

      {kind === 'minion' && showStats && detail && (
        <section className="rounded-lg border border-[#cbd9ed] bg-[#f8fbff] p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center gap-3">
            <BarChart3 className="text-[#8a651f]" />
            <h2 className="font-hs text-2xl text-[#26374f]">Раунды и динамика</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartPanel title="Влияние по раундам" subtitle="Насколько наличие существа меняет среднее место">
              <MiniChart points={rounds.map(row => ({ x: row.combat_round, y: row.impact }))} color="#b58a2d" />
            </ChartPanel>
            <ChartPanel title="Доля побед в боях" subtitle="Combat winrate по раундам">
              <MiniChart points={rounds.map(row => ({ x: row.combat_round, y: row.combat_winrate }))} color="#3f9b52" unit="%" />
            </ChartPanel>
            <ChartPanel title="Среднее место" subtitle="Меньше значение лучше">
              <MiniChart points={rounds.map(row => ({ x: row.combat_round, y: row.avg_placement_with }))} color="#3e7fc1" invert />
            </ChartPanel>
            <ChartPanel title="Размер выборки" subtitle="Сколько игр включено в раундовую точку">
              <MiniChart points={rounds.map(row => ({ x: row.combat_round, y: row.games_with_minion }))} color="#8a5fb8" />
            </ChartPanel>
          </div>

          <div className="mt-5 overflow-hidden rounded-md border border-[#cbd9ed]">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-[#eef4fd] text-left text-[#26374f]">
                <tr>
                  <th className="px-3 py-2">Раунд</th>
                  <th className="px-3 py-2">Impact</th>
                  <th className="px-3 py-2">Combat WR</th>
                  <th className="px-3 py-2">Среднее место</th>
                  <th className="px-3 py-2">Игры с картой</th>
                  <th className="px-3 py-2">W/L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d6e1f1] bg-[#ffffff]">
                {rounds.map(row => (
                  <tr key={row.combat_round}>
                    <td className="px-3 py-2 font-semibold text-[#8a651f]">{row.combat_round}</td>
                    <td className={`px-3 py-2 ${metricTone(row.impact)}`}>{formatDecimal(row.impact, 2)}</td>
                    <td className="px-3 py-2">{formatPercent(row.combat_winrate, 1)}</td>
                    <td className="px-3 py-2">{formatDecimal(row.avg_placement_with, 2)}</td>
                    <td className="px-3 py-2">{formatCount(row.games_with_minion)}</td>
                    <td className="px-3 py-2">{formatCount(row.wins)} / {formatCount(row.losses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {kind === 'spell' && showStats && (
        <section className="rounded-lg border border-[#cbd9ed] bg-[#f8fbff] p-4 shadow-sm sm:p-5">
          <h2 className="mb-4 font-hs text-2xl text-[#26374f]">Статистика Firestone</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Impact" value={formatDecimal(spellStat?.impact, 2)} tone={metricTone(spellStat?.impact)} />
            <MetricCard label="Среднее место" value={formatDecimal(spellStat?.average_placement, 2)} />
            <MetricCard label="Среднее место без карты" value={formatDecimal(spellStat?.average_placement_other, 2)} />
            <MetricCard label="Сыграно" value={formatCount(spellStat?.total_played)} />
          </div>
        </section>
      )}

      {showStats && (
      <section className="rounded-lg border border-[#cbd9ed] bg-[#f8fbff] p-4 shadow-sm sm:p-5">
        <h2 className="mb-4 font-hs text-2xl text-[#26374f]">Используется в стратегиях</h2>
        {usedStrategies.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {usedStrategies.map(strategy => {
              const href = strategyTierListPath(strategy);
              return (
              <a key={strategy.key} href={href} className="rounded-md border border-[#cbd9ed] bg-[#ffffff] p-4 transition-colors hover:border-[#d3af55]" style={{ textDecoration: 'none' }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#8a651f]">{strategy.source} · {strategy.tier || 'meta'}</p>
                    <h3 className="mt-1 font-hs text-xl text-[#26374f]">{strategy.title}</h3>
                  </div>
                  <ExternalLink size={18} className="text-[#7b8da6]" />
                </div>
                {strategy.description && <p className="mt-2 line-clamp-2 text-sm text-[#657893]">{strategy.description}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(strategy.cards || []).slice(0, 8).map(item => (
                    <span key={`${strategy.key}-${item.id}-${item.dbfId}`} className={`rounded px-2 py-1 text-xs ${Number(item.dbfId) === Number(card.dbf) || item.id === card.card_id ? 'bg-[#e4c675] text-[#101827]' : 'bg-[#eef4fd] text-[#33445d]'}`}>
                      {item.ruName || item.name || item.id}
                    </span>
                  ))}
                </div>
              </a>
              );
            })}
          </div>
        ) : (
          <div className="rounded-md border border-[#cbd9ed] bg-[#ffffff] p-6 text-center text-[#657893]">
            В текущих мета-сборках эта карта не найдена.
          </div>
        )}
      </section>
      )}

      {showStats && similar.length > 0 && (
        <section className="rounded-lg border border-[#cbd9ed] bg-[#f8fbff] p-4 shadow-sm sm:p-5">
          <h2 className="mb-4 font-hs text-2xl text-[#26374f]">Похожие карты</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {similar.map(item => (
              <a key={item.dbf} href={cardPath(item, 'current')} onClick={(event) => { event.preventDefault(); navigatePath(cardPath(item, 'current')); }} className="rounded-md p-2 text-center transition-transform hover:-translate-y-1" style={{ textDecoration: 'none' }}>
                <img src={primaryCardImage(item) || '/arena-logo-icon.webp?v=mana-swirl-20260624'} alt={cardRuName(item)} className="mx-auto h-40 object-contain drop-shadow-[0_12px_16px_rgba(21,31,47,0.18)]" loading="lazy" onError={hideBrokenImage} />
                <p className="mt-2 line-clamp-2 font-hs text-sm text-[#26374f]">{cardRuName(item)}</p>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default function BgLibrary({ currentPath, navigatePath }: BgLibraryProps) {
  const route = libraryRoute(currentPath);
  if (route.page === 'detail' && route.dbfId) {
    return <DetailPage kind={route.kind} pool={route.pool} dbfId={route.dbfId} navigatePath={navigatePath} />;
  }
  return <LibraryListPage kind={route.kind} pool={route.pool} navigatePath={navigatePath} />;
}
