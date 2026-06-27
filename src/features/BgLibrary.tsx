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

interface MinionHistoryPayload {
  history?: Array<{
    fetched_at: string;
    impact?: number;
    combat_winrate?: number;
    popularity?: number;
    games_with_minion?: number;
    avg_placement_with?: number;
    avg_placement_without?: number;
    tavern_tier?: number;
  }>;
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
  return `${slugify(card.name?.ru || card.name?.en || card.card_id)}-${card.dbf}`;
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
    card.card_id,
    card.dbf,
    card.text_ru,
    card.creature_type?.name_ru,
    card.creature_type?.slug,
    ...(card.mechanics || []).flatMap(mechanic => [mechanic.slug, mechanic.name_ru]),
  ].filter(Boolean).join(' '));
}

function cardMatchesStrategy(card: LibraryCard, strategy: StrategyEntry): boolean {
  return (strategy.cards || []).some(item => {
    if (Number(item.dbfId) === Number(card.dbf)) return true;
    if (item.id && item.id === card.card_id) return true;
    return false;
  });
}

function metricTone(value: unknown): string {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 'text-[#d6c4a3]';
  if (numberValue > 0.4) return 'text-[#9ee08f]';
  if (numberValue > 0) return 'text-[#f1d47b]';
  return 'text-[#f09a9a]';
}

function useLibraryData(kind: LibraryKind, pool: PoolMode) {
  const [cards, setCards] = useState<LibraryCard[]>([]);
  const [meta, setMeta] = useState<LibraryMeta>({});
  const [minionStats, setMinionStats] = useState<MinionStat[]>([]);
  const [spellStats, setSpellStats] = useState<FirestoneSpellStat[]>([]);
  const [strategies, setStrategies] = useState<StrategyEntry[]>([]);
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
      fetch('/bg-legacy/comps-data.js', { cache: 'force-cache' }).then(response => response.ok ? response.text() : ''),
    ];
    if (kind === 'minion' && pool === 'current') requests.push(fetchJson<{ minions: MinionStat[] }>('/api/bg/library/minion-stats'));
    if (kind === 'spell' && pool === 'current') requests.push(fetchJson<any>('/api/bg/library/spell-stats'));

    Promise.all(requests)
      .then(results => {
        if (!alive) return;
        setMeta(results[0] as LibraryMeta);
        setCards(((results[1] as { data?: LibraryCard[] }).data || []).filter(card => card?.dbf));
        setStrategies(parseStrategies(String(results[2] || '')));
        if (kind === 'minion' && pool === 'current') {
          setMinionStats(((results[3] as { minions?: MinionStat[] })?.minions || []));
          setSpellStats([]);
        } else if (kind === 'spell' && pool === 'current') {
          setSpellStats(flattenSpellStats(results[3]));
          setMinionStats([]);
        } else {
          setMinionStats([]);
          setSpellStats([]);
        }
      })
      .catch(errorValue => {
        if (alive) setError(errorValue?.message || 'Не удалось загрузить библиотеку');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
  }, [kind, pool]);

  return { cards, meta, minionStats, spellStats, strategies, loading, error };
}

function MetricCard({ label, value, caption, tone }: { label: string; value: string; caption?: string; tone?: string }) {
  return (
    <div className="rounded-md border border-[#2a3a55] bg-[#0d1728] px-4 py-3 shadow-inner">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8fa4c0]">{label}</p>
      <p className={`mt-1 font-hs text-2xl ${tone || 'text-[#f4d47d]'}`}>{value}</p>
      {caption && <p className="mt-1 text-xs text-[#9fb0c8]">{caption}</p>}
    </div>
  );
}

function MiniChart({ points, color = '#f1d47b', unit = '', invert = false }: { points: Array<{ x: string | number; y: number }>; color?: string; unit?: string; invert?: boolean }) {
  const clean = points.filter(point => Number.isFinite(Number(point.y)));
  if (clean.length < 2) return <div className="flex h-44 items-center justify-center text-sm text-[#8fa4c0]">Недостаточно точек для графика</div>;
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
  return (
    <div className="overflow-hidden rounded-md border border-[#22324b] bg-[#080f1d]">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" className="h-48 w-full">
        {[0, 1, 2, 3].map(line => {
          const y = padY + (line / 3) * (height - padY * 2);
          return <line key={line} x1={padX} x2={width - padX} y1={y} y2={y} stroke="rgba(217,227,242,0.12)" />;
        })}
        <path d={path} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {clean.map((point, index) => (
          <circle key={`${point.x}-${index}`} cx={xFor(index)} cy={yFor(Number(point.y))} r="4" fill={color} stroke="#080f1d" strokeWidth="2" />
        ))}
        <text x={padX} y={height - 6} fill="#8fa4c0" fontSize="13">{String(clean[0].x).slice(0, 10)}</text>
        <text x={width - padX} y={height - 6} textAnchor="end" fill="#8fa4c0" fontSize="13">{String(last.x).slice(0, 10)}</text>
        <text x={width - padX} y={padY - 7} textAnchor="end" fill="#d9e3f2" fontSize="14">{formatDecimal(last.y, unit === '%' ? 1 : 2)}{unit}</text>
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
          : 'border-[#293a55] bg-[#101b2e] text-[#d9e3f2] hover:border-[#e4c675] hover:text-[#fff3c4]'
      }`}
    >
      {children}
    </button>
  );
}

function LibraryCardTile({
  card,
  pool,
  minionStat,
  spellStat,
  strategyCount,
  navigatePath,
}: {
  key?: React.Key;
  card: LibraryCard;
  pool: PoolMode;
  minionStat?: MinionStat;
  spellStat?: FirestoneSpellStat;
  strategyCount: number;
  navigatePath: (path: string) => void;
}) {
  const href = cardPath(card, pool);
  const average = card.card_type.slug === 'spell' ? spellStat?.average_placement : minionStat?.avg_placement_with;
  const impact = card.card_type.slug === 'spell' ? spellStat?.impact : minionStat?.impact;
  const popularity = card.card_type.slug === 'spell' ? spellStat?.total_played : minionStat?.popularity;
  return (
    <a
      href={href}
      onClick={(event) => { event.preventDefault(); navigatePath(href); }}
      className="group flex flex-col rounded-lg border border-[#23344e] bg-[#0b1424] p-2 text-left shadow-[0_10px_24px_rgba(0,0,0,0.26)] transition-transform hover:-translate-y-1 hover:border-[#e4c675]"
      style={{ textDecoration: 'none' }}
    >
      <div className="relative aspect-[0.72] overflow-hidden rounded-md bg-[#050a13]">
        <img
          src={card.images?.card || card.images?.framed || spellStat?.image_url || '/arena-logo-icon.webp?v=mana-swirl-20260624'}
          alt={card.name.ru}
          className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"
          loading="lazy"
        />
        {card.tavern_tier && (
          <img src={tavernIcon(card.tavern_tier)} alt={`Таверна ${card.tavern_tier}`} className="absolute left-1 top-1 h-9 w-9 drop-shadow-lg" loading="lazy" />
        )}
      </div>
      <div className="mt-2 min-h-[4.8rem]">
        <h3 className="line-clamp-2 font-hs text-base leading-tight text-[#fff3c4]">{card.name.ru}</h3>
        <p className="mt-1 line-clamp-1 text-xs text-[#8fa4c0]">{card.name.en}</p>
      </div>
      <div className="mt-auto grid grid-cols-2 gap-1.5 text-xs">
        <span className="rounded bg-[#101d31] px-2 py-1 text-[#c8d5e8]">Место {formatDecimal(average, 2)}</span>
        <span className={`rounded bg-[#101d31] px-2 py-1 ${metricTone(impact)}`}>Impact {formatDecimal(impact, 2)}</span>
        <span className="rounded bg-[#101d31] px-2 py-1 text-[#c8d5e8]">{card.creature_type?.name_ru || 'Заклинание'}</span>
        <span className="rounded bg-[#101d31] px-2 py-1 text-[#c8d5e8]">{card.card_type.slug === 'spell' ? formatCount(popularity) : `${formatDecimal(popularity, 1)}%`}</span>
      </div>
      {strategyCount > 0 && (
        <div className="mt-2 rounded-md border border-[#37527a] bg-[#14223a] px-2 py-1 text-xs font-semibold text-[#f1d47b]">
          В стратегиях: {strategyCount}
        </div>
      )}
    </a>
  );
}

function ChartPanel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[#263955] bg-[#0d1728] p-4">
      <h3 className="font-hs text-xl text-[#fff3c4]">{title}</h3>
      {subtitle && <p className="mb-3 mt-1 text-sm text-[#9fb0c8]">{subtitle}</p>}
      {children}
    </div>
  );
}

function LibraryListPage({ kind, pool, navigatePath }: { kind: LibraryKind; pool: PoolMode; navigatePath: (path: string) => void }) {
  const { cards, meta, minionStats, spellStats, strategies, loading, error } = useLibraryData(kind, pool);
  const [query, setQuery] = useState('');
  const [tavern, setTavern] = useState('ALL');
  const [race, setRace] = useState('ALL');
  const [mechanic, setMechanic] = useState('ALL');
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_CARDS);

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
  }, [query, tavern, race, mechanic, kind, pool]);

  const minionStatByDbf = useMemo(() => new Map(minionStats.map(item => [Number(item.dbf_id), item])), [minionStats]);
  const spellStatByDbf = useMemo(() => new Map(spellStats.map(item => [Number(item.dbfId), item])), [spellStats]);
  const strategyCountByDbf = useMemo(() => {
    const map = new Map<number, number>();
    cards.forEach(card => {
      const count = strategies.filter(strategy => cardMatchesStrategy(card, strategy)).length;
      if (count) map.set(card.dbf, count);
    });
    return map;
  }, [cards, strategies]);

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
    return cards
      .filter(card => !needle || searchText(card).includes(needle))
      .filter(card => tavern === 'ALL' || String(card.tavern_tier || '') === tavern)
      .filter(card => kind !== 'minion' || race === 'ALL' || card.creature_type?.slug === race)
      .filter(card => mechanic === 'ALL' || (card.mechanics || []).some(item => item.slug === mechanic))
      .sort((a, b) => Number(a.tavern_tier || 99) - Number(b.tavern_tier || 99) || a.name.ru.localeCompare(b.name.ru, 'ru'));
  }, [cards, kind, mechanic, query, race, tavern]);

  const visible = filtered.slice(0, visibleCount);
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

  return (
    <div className="space-y-6 text-[#d9e3f2]">
      <section className="rounded-lg border border-[#263955] bg-[#07101f] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.28)] sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-hs text-xs uppercase tracking-[0.18em] text-[#e4c675]">Battlegrounds</p>
            <h1 className="mt-2 font-hs text-3xl text-[#fff3c4] sm:text-4xl">{pool === 'archive' ? 'Архив карт' : 'Библиотека'}</h1>
            <p className="mt-2 max-w-3xl text-sm text-[#9fb0c8]">
              {pool === 'archive'
                ? 'Существа и заклинания, которые уже были в Полях сражений, но сейчас не находятся в активном пуле.'
                : 'Актуальные существа и заклинания активного пула: фильтры по таверне, типу, механикам и переход на подробную статистику.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/library" onClick={(e) => { e.preventDefault(); navigatePath('/library'); }} className={`rounded-md border px-4 py-2 font-hs text-sm ${pool === 'current' ? 'border-[#e4c675] bg-[#e4c675] text-[#101827]' : 'border-[#304563] bg-[#101b2e] text-[#d9e3f2]'}`} style={{ textDecoration: 'none' }}>
              <BookOpen size={16} className="mr-2 inline" />В пуле
            </a>
            <a href="/library/archive" onClick={(e) => { e.preventDefault(); navigatePath('/library/archive'); }} className={`rounded-md border px-4 py-2 font-hs text-sm ${pool === 'archive' ? 'border-[#e4c675] bg-[#e4c675] text-[#101827]' : 'border-[#304563] bg-[#101b2e] text-[#d9e3f2]'}`} style={{ textDecoration: 'none' }}>
              <Archive size={16} className="mr-2 inline" />Архив
            </a>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[#263955] bg-[#0a1323] p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_auto]">
          <label className="relative block">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8fa4c0]" size={20} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              type="search"
              placeholder="Поиск: например, Боевой клич, Мурлок, Ривендер, Banana"
              className="h-12 w-full rounded-md border border-[#2d405d] bg-[#101b2e] pl-12 pr-4 text-base font-semibold text-[#fff3c4] outline-none transition-colors placeholder:text-[#7487a3] focus:border-[#e4c675]"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <a href={`${basePath}/minions`} onClick={(e) => { e.preventDefault(); navigatePath(`${basePath}/minions`); }} className={`rounded-md border px-4 py-3 font-hs text-sm ${kind === 'minion' ? 'border-[#e4c675] bg-[#e4c675] text-[#101827]' : 'border-[#304563] bg-[#101b2e] text-[#d9e3f2]'}`} style={{ textDecoration: 'none' }}>Существа</a>
            <a href={`${basePath}/spells`} onClick={(e) => { e.preventDefault(); navigatePath(`${basePath}/spells`); }} className={`rounded-md border px-4 py-3 font-hs text-sm ${kind === 'spell' ? 'border-[#e4c675] bg-[#e4c675] text-[#101827]' : 'border-[#304563] bg-[#101b2e] text-[#d9e3f2]'}`} style={{ textDecoration: 'none' }}>Заклинания</a>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <details className="rounded-md border border-[#22324b] bg-[#0d1728] p-3" open>
            <summary className="flex cursor-pointer list-none items-center justify-between font-hs text-sm text-[#fff3c4]">
              <span className="flex items-center gap-2"><Filter size={16} />Уровень таверны</span><ChevronDown size={16} />
            </summary>
            <div className="mt-3 flex flex-wrap gap-2">
              <FilterChip active={tavern === 'ALL'} onClick={() => setTavern('ALL')}>Все уровни</FilterChip>
              {TAVERN_TIERS.map(tier => (
                <FilterChip key={tier} active={tavern === String(tier)} onClick={() => setTavern(String(tier))} title={`Таверна ${tier}`}>
                  <img src={tavernIcon(tier)} alt="" className="h-7 w-7" loading="lazy" />Таверна {tier}
                </FilterChip>
              ))}
            </div>
          </details>

          {kind === 'minion' && (
            <details className="rounded-md border border-[#22324b] bg-[#0d1728] p-3" open>
              <summary className="flex cursor-pointer list-none items-center justify-between font-hs text-sm text-[#fff3c4]">
                <span>Тип существа</span><ChevronDown size={16} />
              </summary>
              <div className="mt-3 flex flex-wrap gap-2">
                <FilterChip active={race === 'ALL'} onClick={() => setRace('ALL')}>Все типы</FilterChip>
                {creatureTypes.map(([slug, label]) => (
                  <FilterChip key={slug} active={race === slug} onClick={() => setRace(slug)}>
                    {RACE_ICON_BY_SLUG[slug] && <img src={RACE_ICON_BY_SLUG[slug]} alt="" className="h-7 w-7 rounded-full" loading="lazy" />}{label}
                  </FilterChip>
                ))}
              </div>
            </details>
          )}

          <details className="rounded-md border border-[#22324b] bg-[#0d1728] p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between font-hs text-sm text-[#fff3c4]">
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

      <section className="rounded-lg border border-[#263955] bg-[#07101f] p-4 sm:p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-hs text-xl text-[#fff3c4]">{kindTitle} · {poolTitle}</p>
            <p className="text-sm text-[#9fb0c8]">Показано {Math.min(visibleCount, filtered.length)} из {filtered.length}. Всего загружено {cards.length}.</p>
          </div>
          {loading && <span className="font-hs text-[#e4c675]">Загружаю...</span>}
        </div>

        {error && <div className="rounded-md border border-[#7f1d1d] bg-[#2a0f16] p-4 text-[#fecaca]">{error}</div>}
        {!loading && !error && filtered.length === 0 && <div className="rounded-md border border-[#2d405d] bg-[#0d1728] p-8 text-center text-[#9fb0c8]">По выбранным фильтрам ничего не найдено.</div>}

        <div className="space-y-8">
          {grouped.map(([tier, items]) => (
            <div key={tier}>
              <div className="mb-4 flex items-center gap-3">
                {tier !== 'none' && <img src={tavernIcon(tier)} alt="" className="h-10 w-10" loading="lazy" />}
                <h2 className="font-hs text-2xl text-[#fff3c4]">{tier === 'none' ? 'Без уровня таверны' : `Таверна ${tier}`}</h2>
                <div className="h-px flex-1 bg-[#304563]" />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {items.map(card => (
                  <LibraryCardTile
                    key={card.dbf}
                    card={card}
                    pool={pool}
                    minionStat={minionStatByDbf.get(card.dbf)}
                    spellStat={spellStatByDbf.get(card.dbf)}
                    strategyCount={strategyCountByDbf.get(card.dbf) || 0}
                    navigatePath={navigatePath}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {visibleCount < filtered.length && (
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
  const [history, setHistory] = useState<MinionHistoryPayload | null>(null);
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
      fetchJson<{ data: LibraryCard[] }>(`/api/bg/library/cards?card_type=${kind}&in_pool=1`),
    ];
    if (kind === 'minion') {
      baseRequests.push(fetchJson<MinionDetail>(`/api/bg/library/minions/${dbfId}`));
      baseRequests.push(fetchJson<MinionHistoryPayload>(`/api/bg/library/minions/${dbfId}/history`));
    } else {
      baseRequests.push(fetchJson<any>('/api/bg/library/spell-stats'));
    }

    Promise.all(baseRequests)
      .then(results => {
        if (!alive) return;
        const loadedCard = results[0] as LibraryCard;
        setCard(loadedCard);
        setStrategies(parseStrategies(String(results[1] || '')));
        setRelatedCards(((results[2] as { data?: LibraryCard[] }).data || []).filter(item => item.dbf !== loadedCard.dbf));
        if (kind === 'minion') {
          setDetail(results[3] as MinionDetail);
          setHistory(results[4] as MinionHistoryPayload);
          setSpellStats([]);
        } else {
          setSpellStats(flattenSpellStats(results[3]));
          setDetail(null);
          setHistory(null);
        }
        const title = `${loadedCard.name.ru} — статистика ${kind === 'minion' ? 'существа' : 'заклинания'} BG Hearthstone | HS-Manacost`;
        const description = `${loadedCard.name.ru}: таверна ${loadedCard.tavern_tier || '—'}, ${loadedCard.creature_type?.name_ru || 'заклинание'}, механики и актуальная статистика Полей сражений.`;
        setLibraryMeta(title, description, cardPath(loadedCard, pool), loadedCard.images?.card || loadedCard.images?.art);
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
    return relatedCards
      .map(item => {
        const raceMatch = card.creature_type?.slug && item.creature_type?.slug === card.creature_type.slug ? 2 : 0;
        const tierMatch = card.tavern_tier && item.tavern_tier === card.tavern_tier ? 1 : 0;
        const mechanicMatch = (item.mechanics || []).filter(mechanic => mechanicSet.has(mechanic.slug)).length;
        return { item, score: raceMatch + tierMatch + mechanicMatch };
      })
      .filter(row => row.score > 0)
      .sort((a, b) => b.score - a.score || a.item.name.ru.localeCompare(b.item.name.ru, 'ru'))
      .slice(0, 6)
      .map(row => row.item);
  }, [card, relatedCards]);

  if (loading) return <div className="py-16 text-center font-hs text-[#6b4c2a]">Загружаем страницу карты...</div>;
  if (error || !card) return <div className="rounded-lg border border-[#7f1d1d] bg-[#2a0f16] p-6 text-[#fecaca]">{error || 'Карта не найдена'}</div>;

  const backPath = pool === 'archive' ? `/library/archive/${kind === 'spell' ? 'spells' : 'minions'}` : `/library/${kind === 'spell' ? 'spells' : 'minions'}`;
  const rounds = detail?.rounds || [];
  const historyRows = history?.history || [];
  const mainImpact = kind === 'spell' ? spellStat?.impact : detail?.impact;
  const mainAverage = kind === 'spell' ? spellStat?.average_placement : detail?.avg_placement_with;
  const mainPopularity = kind === 'spell' ? spellStat?.total_played : detail?.popularity;

  return (
    <div className="space-y-6 text-[#d9e3f2]">
      <button type="button" onClick={() => navigatePath(backPath)} className="inline-flex items-center gap-2 rounded-md border border-[#2d405d] bg-[#101b2e] px-4 py-2 text-sm font-semibold text-[#d9e3f2] hover:border-[#e4c675]">
        <ArrowLeft size={16} /> Назад в {pool === 'archive' ? 'архив' : 'библиотеку'}
      </button>

      <section className="overflow-hidden rounded-lg border border-[#263955] bg-[#07101f] shadow-[0_18px_48px_rgba(0,0,0,0.3)]">
        <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[320px_1fr]">
          <div className="relative mx-auto w-full max-w-xs">
            <img src={card.images?.card || card.images?.framed || '/arena-logo-icon.webp?v=mana-swirl-20260624'} alt={card.name.ru} className="w-full drop-shadow-[0_24px_32px_rgba(0,0,0,0.45)]" />
          </div>
          <div className="space-y-5">
            <div>
              <p className="font-hs text-xs uppercase tracking-[0.18em] text-[#e4c675]">{kind === 'minion' ? 'Существо' : 'Заклинание'} · {pool === 'archive' ? 'Архив' : 'Активный пул'}</p>
              <h1 className="mt-2 font-hs text-4xl text-[#fff3c4] sm:text-5xl">{card.name.ru}</h1>
              <p className="mt-1 text-lg text-[#9fb0c8]">{card.name.en}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {card.tavern_tier && <span className="inline-flex items-center gap-2 rounded-md bg-[#17243a] px-3 py-2 font-semibold"><img src={tavernIcon(card.tavern_tier)} alt="" className="h-8 w-8" />Таверна {card.tavern_tier}</span>}
              {card.creature_type && <span className="inline-flex items-center gap-2 rounded-md bg-[#17243a] px-3 py-2 font-semibold">{RACE_ICON_BY_SLUG[card.creature_type.slug] && <img src={RACE_ICON_BY_SLUG[card.creature_type.slug]} alt="" className="h-8 w-8 rounded-full" />} {card.creature_type.name_ru}</span>}
              {card.mechanics.map(mechanic => <span key={mechanic.slug} className="rounded-md bg-[#2a1d35] px-3 py-2 font-semibold text-[#f0d2ff]">{mechanic.name_ru}</span>)}
              {card.duos_only && <span className="rounded-md bg-[#1f3a5f] px-3 py-2 font-semibold text-[#bfdbfe]">Дуо</span>}
            </div>

            <div className="rounded-md border border-[#263955] bg-[#0d1728] p-4">
              <p className="whitespace-pre-line text-base leading-7 text-[#e9eef8]">{card.text_ru}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Impact" value={formatDecimal(mainImpact, 2)} tone={metricTone(mainImpact)} />
              <MetricCard label="Среднее место" value={formatDecimal(mainAverage, 2)} />
              <MetricCard label={kind === 'spell' ? 'Сыграно' : 'Популярность'} value={kind === 'spell' ? formatCount(mainPopularity) : formatPercent(mainPopularity, 1)} />
              <MetricCard label="Стратегии" value={String(usedStrategies.length)} caption="где карта встречается" />
            </div>
          </div>
        </div>
      </section>

      {kind === 'minion' && detail && (
        <section className="rounded-lg border border-[#263955] bg-[#07101f] p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-3">
            <BarChart3 className="text-[#e4c675]" />
            <h2 className="font-hs text-2xl text-[#fff3c4]">Раунды и динамика</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartPanel title="Влияние по раундам" subtitle="Насколько наличие существа меняет среднее место">
              <MiniChart points={rounds.map(row => ({ x: row.combat_round, y: row.impact }))} color="#f1d47b" />
            </ChartPanel>
            <ChartPanel title="Доля побед в боях" subtitle="Combat winrate по раундам">
              <MiniChart points={rounds.map(row => ({ x: row.combat_round, y: row.combat_winrate }))} color="#9ee08f" unit="%" />
            </ChartPanel>
            <ChartPanel title="Среднее место" subtitle="Меньше значение лучше">
              <MiniChart points={rounds.map(row => ({ x: row.combat_round, y: row.avg_placement_with }))} color="#8ec5ff" invert />
            </ChartPanel>
            <ChartPanel title="Размер выборки" subtitle="Сколько игр включено в раундовую точку">
              <MiniChart points={rounds.map(row => ({ x: row.combat_round, y: row.games_with_minion }))} color="#d6b4ff" />
            </ChartPanel>
          </div>

          <div className="mt-5 overflow-hidden rounded-md border border-[#22324b]">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-[#101b2e] text-left text-[#fff3c4]">
                <tr>
                  <th className="px-3 py-2">Раунд</th>
                  <th className="px-3 py-2">Impact</th>
                  <th className="px-3 py-2">Combat WR</th>
                  <th className="px-3 py-2">Среднее место</th>
                  <th className="px-3 py-2">Игры с картой</th>
                  <th className="px-3 py-2">W/L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#22324b] bg-[#0b1424]">
                {rounds.map(row => (
                  <tr key={row.combat_round}>
                    <td className="px-3 py-2 font-semibold text-[#e4c675]">{row.combat_round}</td>
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

      {kind === 'minion' && historyRows.length > 1 && (
        <section className="rounded-lg border border-[#263955] bg-[#07101f] p-4 sm:p-5">
          <h2 className="mb-4 font-hs text-2xl text-[#fff3c4]">История меты</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartPanel title="Impact по обновлениям"><MiniChart points={historyRows.map(row => ({ x: row.fetched_at, y: Number(row.impact) }))} color="#f1d47b" /></ChartPanel>
            <ChartPanel title="Популярность"><MiniChart points={historyRows.map(row => ({ x: row.fetched_at, y: Number(row.popularity) }))} color="#d6b4ff" unit="%" /></ChartPanel>
          </div>
        </section>
      )}

      {kind === 'spell' && (
        <section className="rounded-lg border border-[#263955] bg-[#07101f] p-4 sm:p-5">
          <h2 className="mb-4 font-hs text-2xl text-[#fff3c4]">Статистика Firestone</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Impact" value={formatDecimal(spellStat?.impact, 2)} tone={metricTone(spellStat?.impact)} />
            <MetricCard label="Среднее место" value={formatDecimal(spellStat?.average_placement, 2)} />
            <MetricCard label="Среднее место без карты" value={formatDecimal(spellStat?.average_placement_other, 2)} />
            <MetricCard label="Сыграно" value={formatCount(spellStat?.total_played)} />
          </div>
        </section>
      )}

      <section className="rounded-lg border border-[#263955] bg-[#07101f] p-4 sm:p-5">
        <h2 className="mb-4 font-hs text-2xl text-[#fff3c4]">Используется в стратегиях</h2>
        {usedStrategies.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {usedStrategies.map(strategy => (
              <a key={strategy.key} href="/classes" onClick={(event) => { event.preventDefault(); navigatePath('/classes'); }} className="rounded-md border border-[#2d405d] bg-[#0d1728] p-4 transition-colors hover:border-[#e4c675]" style={{ textDecoration: 'none' }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#e4c675]">{strategy.source} · {strategy.tier || 'meta'}</p>
                    <h3 className="mt-1 font-hs text-xl text-[#fff3c4]">{strategy.title}</h3>
                  </div>
                  <ExternalLink size={18} className="text-[#8fa4c0]" />
                </div>
                {strategy.description && <p className="mt-2 line-clamp-2 text-sm text-[#9fb0c8]">{strategy.description}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(strategy.cards || []).slice(0, 8).map(item => (
                    <span key={`${strategy.key}-${item.id}-${item.dbfId}`} className={`rounded px-2 py-1 text-xs ${Number(item.dbfId) === Number(card.dbf) || item.id === card.card_id ? 'bg-[#e4c675] text-[#101827]' : 'bg-[#14223a] text-[#c8d5e8]'}`}>
                      {item.ruName || item.name || item.id}
                    </span>
                  ))}
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-[#22324b] bg-[#0d1728] p-6 text-center text-[#9fb0c8]">
            В текущих мета-сборках эта карта не найдена.
          </div>
        )}
      </section>

      {similar.length > 0 && (
        <section className="rounded-lg border border-[#263955] bg-[#07101f] p-4 sm:p-5">
          <h2 className="mb-4 font-hs text-2xl text-[#fff3c4]">Похожие карты</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {similar.map(item => (
              <a key={item.dbf} href={cardPath(item, 'current')} onClick={(event) => { event.preventDefault(); navigatePath(cardPath(item, 'current')); }} className="rounded-md border border-[#22324b] bg-[#0d1728] p-2 text-center hover:border-[#e4c675]" style={{ textDecoration: 'none' }}>
                <img src={item.images?.card || item.images?.framed || '/arena-logo-icon.webp?v=mana-swirl-20260624'} alt={item.name.ru} className="mx-auto h-40 object-contain" loading="lazy" />
                <p className="mt-2 line-clamp-2 font-hs text-sm text-[#fff3c4]">{item.name.ru}</p>
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
