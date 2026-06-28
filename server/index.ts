import express from 'express';
import cron from 'node-cron';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import sharp from 'sharp';
import { createClient } from 'redis';
import { createReadStream, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import { createHash, createHmac, createPublicKey, randomBytes, randomInt, scryptSync, timingSafeEqual, verify } from 'crypto';
// @ts-ignore: node:sqlite is available in the production Node 22 runtime.
import { DatabaseSync } from 'node:sqlite';
import { scrapeAll, loadData } from './scraper.js';
import { HSREPLAY_NO_ARENASMITH_TIER, normalizeArenasmithTier, tierFromArenasmithScore } from './hsreplayArenasmith.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const DATA_DIR   = join(__dirname, 'data');
const CARD_IMAGE_CACHE_DIR = join(DATA_DIR, 'card-images');
const CARD_IMAGE_CACHE_VERSION = 'card_img_v1';
const MAX_CARD_IMAGE_JOBS = 4;

// ─── In-memory data cache (avoids disk I/O on every request) ──────────────────
interface CacheEntry { data: any; etag: string; mtime: number }
const dataCache = new Map<string, CacheEntry>();
interface MemoryCacheEntry { data: any; etag: string; expiresAt: number }
let classMatchupsCache: MemoryCacheEntry | null = null;
const winratesApiCache = new Map<string, MemoryCacheEntry>();
const tierlistApiCache = new Map<string, MemoryCacheEntry>();
const legendariesApiCache = new Map<string, MemoryCacheEntry>();
let homeSummaryApiCache: MemoryCacheEntry | null = null;
let arenaDecksCache: MemoryCacheEntry | null = null;
const cardImageJobs = new Map<string, Promise<string>>();
let activeCardImageJobs = 0;
const cardImageQueue: Array<() => void> = [];

function loadDataCached(filename: string): CacheEntry | null {
  const filePath = join(DATA_DIR, filename);
  try {
    const mtime = statSync(filePath).mtimeMs;
    const cached = dataCache.get(filename);
    if (cached && cached.mtime === mtime) return cached;
    const data = loadData(filename);
    if (!data) return null;
    const entry: CacheEntry = { data, etag: `"${mtime.toString(36)}-${filename}"`, mtime };
    dataCache.set(filename, entry);
    return entry;
  } catch { return null; }
}

/** Call after scrape to invalidate stale cache entries */
function invalidateDataCache() {
  dataCache.clear();
  winratesApiCache.clear();
  tierlistApiCache.clear();
  legendariesApiCache.clear();
  homeSummaryApiCache = null;
  classMatchupsCache = null;
  arenaDecksCache = null;
  void clearRedisDataCache();
}
const AUTH_FILE = join(DATA_DIR, 'admin_auth.json');
const ECOSYSTEM_DIR = process.env.ECOSYSTEM_DIR || '/var/lib/manacost-ecosystem';
const ECOSYSTEM_DB_FILE = process.env.ECOSYSTEM_DB_FILE || join(ECOSYSTEM_DIR, 'users.sqlite');
const ECOSYSTEM_INTERNAL_KEY = process.env.ECOSYSTEM_INTERNAL_KEY || '';
const ADMIN_USER_IDS = new Set(
  (process.env.ADMIN_USER_IDS || 'user_42368c85b8de')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
);
const APP_URL = (process.env.APP_URL || 'https://bg.hs-manacost.ru').replace(/\/$/, '');
const AUTH_COOKIE_NAME = 'manacost_auth_token';
const AUTH_FROM = process.env.AUTH_FROM || 'noreply@hs-manacost.ru';
const AUTH_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const AUTH_CODE_TTL_MS = 10 * 60 * 1000;
const TELEGRAM_AUTH_BOT_TOKEN = process.env.TELEGRAM_AUTH_BOT_TOKEN || '';
const TELEGRAM_AUTH_BOT_USERNAME = (process.env.TELEGRAM_AUTH_BOT_USERNAME || '').trim().replace(/^@/, '');
const TELEGRAM_AUTH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TELEGRAM_OIDC_CLIENT_ID = (process.env.TELEGRAM_OIDC_CLIENT_ID || process.env.TELEGRAM_AUTH_CLIENT_ID || '').trim();
const TELEGRAM_OIDC_CLIENT_SECRET = (process.env.TELEGRAM_OIDC_CLIENT_SECRET || process.env.TELEGRAM_AUTH_CLIENT_SECRET || '').trim();
const TELEGRAM_OIDC_ISSUER = 'https://oauth.telegram.org';
const TELEGRAM_OIDC_DISCOVERY_URL = `${TELEGRAM_OIDC_ISSUER}/.well-known/openid-configuration`;
const TELEGRAM_OIDC_COOKIE_NAME = 'manacost_tg_oidc';
const TELEGRAM_OIDC_STATE_TTL_MS = 10 * 60 * 1000;
const BOOSTY_AUTH_API_URL = (process.env.BOOSTY_AUTH_API_URL || 'http://127.0.0.1:18082').replace(/\/$/, '');
const BOOSTY_MIN_PRICE = Number(process.env.BOOSTY_MIN_PRICE || 199);
const KHA_VIP_BOT_TOKEN = process.env.KHA_VIP_BOT_TOKEN || '';
const KHA_VIP_PROFILES_FILE = process.env.KHA_VIP_PROFILES_FILE || '/var/lib/docker/volumes/kha-vip-bot_bot_cache/_data/profiles.json';
const KHA_VIP_WP_BASE_URL = (process.env.KHA_VIP_WP_BASE_URL || process.env.WP_BASE_URL || 'https://kolodahearthstone.ru').replace(/\/$/, '');
const KHA_VIP_WP_BEARER = process.env.KHA_VIP_WP_BEARER || process.env.WP_BEARER || '';
const KHA_VIP_LOCKERS_CACHE_MS = Math.max(60_000, Number(process.env.KHA_VIP_LOCKERS_CACHE_MS || 5 * 60 * 1000));
const KHA_VIP_ARTICLE_HOSTS = new Set(['kolodahearthstone.ru', 'www.kolodahearthstone.ru']);
const SUBSCRIPTION_TELEGRAM_CHAT_IDS = (process.env.SUBSCRIPTION_TELEGRAM_CHAT_IDS || '-5001968053,-1002311131780,-5077378176')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);
const SUBSCRIPTION_REFRESH_MS = 30 * 60 * 1000;
const REDIS_URL = (process.env.REDIS_URL || 'redis://127.0.0.1:6379').trim();
const REDIS_ENABLED = process.env.REDIS_ENABLED !== '0' && REDIS_URL !== '';
const REDIS_CACHE_PREFIX = process.env.REDIS_CACHE_PREFIX || 'hs-arena:v2';
const REDIS_DATASET_TTL_SECONDS = Math.max(60, Number(process.env.REDIS_DATASET_TTL_SECONDS || 6 * 60 * 60));
const REDIS_HOME_SUMMARY_TTL_SECONDS = Math.max(60, Number(process.env.REDIS_HOME_SUMMARY_TTL_SECONDS || 5 * 60));
const DATASET_MEMORY_CACHE_MS = Math.max(60_000, Number(process.env.DATASET_MEMORY_CACHE_MS || 5 * 60 * 1000));
const HOME_SUMMARY_CACHE_MS = REDIS_HOME_SUMMARY_TTL_SECONDS * 1000;

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  country?: string;
  newsletterOptIn?: boolean;
  avatarInitials?: string;
  telegramId?: string;
  telegramUsername?: string;
  photoUrl?: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

interface SubscriptionStatus {
  hasAccess: boolean;
  source: string;
  checkedAt: string | null;
  stale: boolean;
  message: string;
  boosty: Record<string, any>;
  telegram: Record<string, any>;
}

interface PendingCode {
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

interface AdminSession {
  tokenHash: string;
  email: string;
  expiresAt: number;
  createdAt: string;
}

interface AdminAuthStore {
  users: AdminUser[];
  pendingCodes: PendingCode[];
  sessions: AdminSession[];
  updatedAt: string;
}

interface RedisCachePayload<T = any> {
  data: T;
  etag: string;
  cachedAt: string;
}

interface KhaVipLocker {
  post_id: number;
  code: string;
  title: string;
  url: string;
  image?: string;
  excerpt?: string;
  date?: string;
  type?: string;
}

let redisClientPromise: Promise<any | null> | null = null;
let redisDisabledUntil = 0;
let redisWarningPrinted = false;
let khaVipLockersCache: { items: KhaVipLocker[]; expiresAt: number } | null = null;

function redisDataKey(kind: string, source = 'default'): string {
  return `${REDIS_CACHE_PREFIX}:data:${kind}:${source}`;
}

async function getRedisClient(): Promise<any | null> {
  if (!REDIS_ENABLED || Date.now() < redisDisabledUntil) return null;
  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      const client = createClient({ url: REDIS_URL });
      client.on('error', (err: any) => {
        if (!redisWarningPrinted) {
          console.warn('[redis] client error:', err?.message ?? err);
          redisWarningPrinted = true;
        }
      });
      client.on('end', () => {
        redisClientPromise = null;
      });
      await client.connect();
      return client;
    })().catch((err: any) => {
      console.warn('[redis] unavailable, falling back to memory cache:', err?.message ?? err);
      redisClientPromise = null;
      redisDisabledUntil = Date.now() + 60_000;
      return null;
    });
  }
  return redisClientPromise;
}

async function redisGetCache<T = any>(key: string): Promise<RedisCachePayload<T> | null> {
  try {
    const client = await getRedisClient();
    if (!client) return null;
    const raw = await client.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RedisCachePayload<T>;
    if (!parsed?.etag || parsed.data === undefined) return null;
    return parsed;
  } catch (err: any) {
    console.warn('[redis] read failed:', err?.message ?? err);
    return null;
  }
}

async function redisSetCache(key: string, data: any, etag: string, ttlSeconds: number): Promise<void> {
  try {
    const client = await getRedisClient();
    if (!client) return;
    const payload: RedisCachePayload = { data, etag, cachedAt: new Date().toISOString() };
    await client.set(key, JSON.stringify(payload), { EX: ttlSeconds });
  } catch (err: any) {
    console.warn('[redis] write failed:', err?.message ?? err);
  }
}

async function clearRedisDataCache(): Promise<void> {
  try {
    const client = await getRedisClient();
    if (!client) return;
    const keys = await client.keys(`${REDIS_CACHE_PREFIX}:data:*`);
    if (keys.length) await client.del(keys);
  } catch (err: any) {
    console.warn('[redis] clear failed:', err?.message ?? err);
  }
}

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashSecret(secret: string, salt = randomBytes(16).toString('hex')): string {
  const hash = scryptSync(secret, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifySecret(secret: string, stored: string): boolean {
  const [, salt, expectedHex] = stored.split(':');
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = scryptSync(secret, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

let ecosystemDb: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (ecosystemDb) return ecosystemDb;
  mkdirSync(ECOSYSTEM_DIR, { recursive: true });
  ecosystemDb = new DatabaseSync(ECOSYSTEM_DB_FILE);
  ecosystemDb.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  ecosystemDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      country TEXT,
      newsletter_opt_in INTEGER NOT NULL DEFAULT 0,
      avatar_initials TEXT,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      email TEXT,
      username TEXT,
      photo_url TEXT,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(provider, provider_user_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS pending_codes (
      email TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id TEXT PRIMARY KEY,
      has_access INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'none',
      message TEXT NOT NULL DEFAULT '',
      checked_at TEXT,
      stale INTEGER NOT NULL DEFAULT 0,
      boosty_json TEXT NOT NULL DEFAULT '{}',
      telegram_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS subscription_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      source TEXT NOT NULL,
      has_access INTEGER NOT NULL DEFAULT 0,
      detail_json TEXT NOT NULL DEFAULT '{}',
      checked_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  migrateLegacyAuthStore(ecosystemDb);
  syncKhaVipProfiles(ecosystemDb);
  return ecosystemDb;
}

function dbGet<T = any>(sql: string, ...params: any[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}

function dbAll<T = any>(sql: string, ...params: any[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}

function dbRun(sql: string, ...params: any[]) {
  db().prepare(sql).run(...params);
}

function migrateLegacyAuthStore(database: DatabaseSync) {
  const migrated = database.prepare('SELECT value FROM meta WHERE key = ?').get('legacy_auth_migrated') as { value?: string } | undefined;
  if (migrated?.value === '1') return;

  const legacy = existsSync(AUTH_FILE) ? loadData('admin_auth.json') as Partial<AdminAuthStore> | null : null;
  const nowIso = new Date().toISOString();
  try {
    database.exec('BEGIN IMMEDIATE');
    for (const user of Array.isArray(legacy?.users) ? legacy!.users as AdminUser[] : []) {
      upsertUserRow(database, user);
    }
    for (const code of Array.isArray(legacy?.pendingCodes) ? legacy!.pendingCodes as PendingCode[] : []) {
      if (code.expiresAt > Date.now() && code.attempts < 5) {
        database.prepare(`
          INSERT INTO pending_codes (email, code_hash, expires_at, attempts)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = excluded.attempts
        `).run(code.email, code.codeHash, code.expiresAt, code.attempts);
      }
    }
    for (const session of Array.isArray(legacy?.sessions) ? legacy!.sessions as AdminSession[] : []) {
      if (session.expiresAt <= Date.now()) continue;
      const user = database.prepare('SELECT id FROM users WHERE email = ?').get(session.email) as { id?: string } | undefined;
      if (!user?.id) continue;
      database.prepare(`
        INSERT OR REPLACE INTO sessions (token_hash, user_id, email, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(session.tokenHash, user.id, session.email, session.expiresAt, session.createdAt);
    }
    database.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('legacy_auth_migrated', '1');
    database.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('legacy_auth_migrated_at', nowIso);
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

function upsertUserRow(database: DatabaseSync, user: AdminUser) {
  const nowIso = new Date().toISOString();
  const createdAt = user.createdAt || nowIso;
  const updatedAt = user.updatedAt || nowIso;
  database.prepare(`
    INSERT INTO users (
      id, email, name, role, country, newsletter_opt_in, avatar_initials, password_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      role = excluded.role,
      country = excluded.country,
      newsletter_opt_in = excluded.newsletter_opt_in,
      avatar_initials = excluded.avatar_initials,
      password_hash = excluded.password_hash,
      updated_at = excluded.updated_at
  `).run(
    user.id,
    user.email,
    user.name,
    user.role,
    user.country ?? '',
    user.newsletterOptIn ? 1 : 0,
    user.avatarInitials ?? '',
    user.passwordHash,
    createdAt,
    updatedAt,
  );

  database.prepare("DELETE FROM identities WHERE user_id = ? AND provider = 'email' AND provider_user_id <> ?").run(user.id, user.email);
  database.prepare(`
    INSERT INTO identities (user_id, provider, provider_user_id, email, username, photo_url, verified_at, created_at, updated_at)
    VALUES (?, 'email', ?, ?, ?, '', ?, ?, ?)
    ON CONFLICT(provider, provider_user_id) DO UPDATE SET
      user_id = excluded.user_id,
      email = excluded.email,
      username = excluded.username,
      updated_at = excluded.updated_at
  `).run(user.id, user.email, user.email, user.email, createdAt, createdAt, updatedAt);

  if (user.telegramId) {
    database.prepare(`
      INSERT INTO identities (user_id, provider, provider_user_id, email, username, photo_url, verified_at, created_at, updated_at)
      VALUES (?, 'telegram', ?, '', ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_user_id) DO UPDATE SET
        user_id = excluded.user_id,
        username = excluded.username,
        photo_url = excluded.photo_url,
        updated_at = excluded.updated_at
    `).run(user.id, user.telegramId, user.telegramUsername ?? '', user.photoUrl ?? '', createdAt, createdAt, updatedAt);
  }
}

function authUserFromRow(row: any): AdminUser {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: row.role === 'admin' ? 'admin' : 'user',
    country: String(row.country ?? ''),
    newsletterOptIn: Boolean(row.newsletter_opt_in),
    avatarInitials: String(row.avatar_initials ?? ''),
    telegramId: row.telegram_id ? String(row.telegram_id) : undefined,
    telegramUsername: row.telegram_username ? String(row.telegram_username) : undefined,
    photoUrl: row.telegram_photo_url ? String(row.telegram_photo_url) : undefined,
    passwordHash: String(row.password_hash),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function loadAuthStore(): AdminAuthStore {
  const now = Date.now();
  dbRun('DELETE FROM pending_codes WHERE expires_at <= ? OR attempts >= 5', now);
  dbRun('DELETE FROM sessions WHERE expires_at <= ?', now);
  const users = dbAll(`
    SELECT
      u.*,
      tg.provider_user_id AS telegram_id,
      tg.username AS telegram_username,
      tg.photo_url AS telegram_photo_url
    FROM users u
    LEFT JOIN identities tg ON tg.user_id = u.id AND tg.provider = 'telegram'
    ORDER BY u.created_at ASC
  `).map(authUserFromRow);
  const pendingCodes = dbAll<any>('SELECT email, code_hash, expires_at, attempts FROM pending_codes')
    .map(row => ({
      email: String(row.email),
      codeHash: String(row.code_hash),
      expiresAt: Number(row.expires_at),
      attempts: Number(row.attempts),
    }));
  const sessions = dbAll<any>('SELECT token_hash, email, expires_at, created_at FROM sessions')
    .map(row => ({
      tokenHash: String(row.token_hash),
      email: String(row.email),
      expiresAt: Number(row.expires_at),
      createdAt: String(row.created_at),
    }));
  return { users, pendingCodes, sessions, updatedAt: new Date().toISOString() };
}

function saveAuthStore(store: AdminAuthStore) {
  const database = db();
  try {
    database.exec('BEGIN IMMEDIATE');
    const keepIds = store.users.map(user => user.id);
    if (keepIds.length) {
      database.prepare(`DELETE FROM users WHERE id NOT IN (${keepIds.map(() => '?').join(',')})`).run(...keepIds);
    }
    for (const user of store.users) upsertUserRow(database, user);
    database.prepare('DELETE FROM pending_codes').run();
    for (const code of store.pendingCodes) {
      if (code.expiresAt <= Date.now() || code.attempts >= 5) continue;
      database.prepare(`
        INSERT OR REPLACE INTO pending_codes (email, code_hash, expires_at, attempts)
        VALUES (?, ?, ?, ?)
      `).run(code.email, code.codeHash, code.expiresAt, code.attempts);
    }
    database.prepare('DELETE FROM sessions').run();
    for (const session of store.sessions) {
      if (session.expiresAt <= Date.now()) continue;
      const user = store.users.find(item => item.email === session.email);
      if (!user) continue;
      database.prepare(`
        INSERT OR REPLACE INTO sessions (token_hash, user_id, email, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(session.tokenHash, user.id, session.email, session.expiresAt, session.createdAt);
    }
    database.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('auth_updated_at', new Date().toISOString());
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

function publicUser(user: AdminUser) {
  return {
    id: user.id,
    profileId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    country: user.country ?? '',
    newsletterOptIn: Boolean(user.newsletterOptIn),
    avatarInitials: user.avatarInitials ?? user.name.slice(0, 2).toUpperCase(),
    telegramUsername: user.telegramUsername ?? '',
    photoUrl: user.photoUrl ?? '',
  };
}

function isRealEmail(email: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
    && !email.endsWith('@telegram.local')
    && !email.endsWith('.local');
}

function readKhaVipProfile(telegramId: string): Record<string, any> | null {
  try {
    if (!telegramId || !existsSync(KHA_VIP_PROFILES_FILE)) return null;
    const data = JSON.parse(readFileSync(KHA_VIP_PROFILES_FILE, 'utf-8'));
    const profile = data?.[telegramId];
    return profile && typeof profile === 'object' ? profile : null;
  } catch (err: any) {
    console.warn('[ecosystem] KHA VIP profile read failed:', err?.message ?? err);
    return null;
  }
}

function readKhaVipProfiles(): Record<string, any> {
  try {
    if (!existsSync(KHA_VIP_PROFILES_FILE)) return {};
    const data = JSON.parse(readFileSync(KHA_VIP_PROFILES_FILE, 'utf-8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (err: any) {
    console.warn('[ecosystem] KHA VIP profiles read failed:', err?.message ?? err);
    return {};
  }
}

function khaVerifiedEmail(profile: Record<string, any> | null): string {
  if (!profile?.email_verified_at) return '';
  const email = normalizeEmail(profile.email);
  return isRealEmail(email) ? email : '';
}

function syncKhaVipProfiles(database: DatabaseSync) {
  const profiles = readKhaVipProfiles();
  const now = new Date().toISOString();
  for (const [telegramIdRaw, profile] of Object.entries(profiles)) {
    const telegramId = String(telegramIdRaw).replace(/\D/g, '');
    const email = khaVerifiedEmail(profile as Record<string, any>);
    if (!telegramId || !email) continue;

    const telegramIdentity = database.prepare("SELECT user_id FROM identities WHERE provider = 'telegram' AND provider_user_id = ?")
      .get(telegramId) as { user_id?: string } | undefined;
    const emailUser = database.prepare('SELECT id FROM users WHERE email = ?')
      .get(email) as { id?: string } | undefined;

    if (telegramIdentity?.user_id && emailUser?.id && telegramIdentity.user_id !== emailUser.id) {
      const sourceUser = database.prepare('SELECT email FROM users WHERE id = ?')
        .get(telegramIdentity.user_id) as { email?: string } | undefined;
      database.prepare("UPDATE identities SET user_id = ?, email = ?, updated_at = ? WHERE provider = 'telegram' AND provider_user_id = ?")
        .run(emailUser.id, '', now, telegramId);
      if (sourceUser?.email) {
        database.prepare('UPDATE sessions SET user_id = ?, email = ? WHERE user_id = ? OR email = ?')
          .run(emailUser.id, email, telegramIdentity.user_id, sourceUser.email);
      }
      database.prepare('DELETE FROM users WHERE id = ?').run(telegramIdentity.user_id);
      const user = loadAuthStore().users.find(item => item.id === emailUser.id);
      if (user) applyKhaSubscriptionSnapshot(user, profile as Record<string, any>);
      continue;
    }

    if (telegramIdentity?.user_id && !emailUser?.id) {
      database.prepare('UPDATE users SET email = ?, updated_at = ? WHERE id = ?')
        .run(email, now, telegramIdentity.user_id);
      database.prepare("DELETE FROM identities WHERE user_id = ? AND provider = 'email'")
        .run(telegramIdentity.user_id);
      database.prepare(`
        INSERT INTO identities (user_id, provider, provider_user_id, email, username, photo_url, verified_at, created_at, updated_at)
        VALUES (?, 'email', ?, ?, ?, '', ?, ?, ?)
      `).run(telegramIdentity.user_id, email, email, email, now, now, now);
      database.prepare('UPDATE sessions SET email = ? WHERE user_id = ?').run(email, telegramIdentity.user_id);
      const user = loadAuthStore().users.find(item => item.id === telegramIdentity.user_id);
      if (user) applyKhaSubscriptionSnapshot(user, profile as Record<string, any>);
      continue;
    }

    if (!telegramIdentity?.user_id && emailUser?.id) {
      database.prepare(`
        INSERT INTO identities (user_id, provider, provider_user_id, email, username, photo_url, verified_at, created_at, updated_at)
        VALUES (?, 'telegram', ?, '', '', '', ?, ?, ?)
        ON CONFLICT(provider, provider_user_id) DO UPDATE SET user_id = excluded.user_id, updated_at = excluded.updated_at
      `).run(emailUser.id, telegramId, now, now, now);
      const user = loadAuthStore().users.find(item => item.id === emailUser.id);
      if (user) applyKhaSubscriptionSnapshot(user, profile as Record<string, any>);
    }
  }
}

function applyKhaSubscriptionSnapshot(user: AdminUser, profile: Record<string, any> | null) {
  if (!profile || profile.boosty_access !== true) return;
  const levelName = String(profile.boosty_level || '');
  const rawPrice = Number(profile.boosty_price || 0);
  const inferredPrice = rawPrice || (levelName.toLowerCase().includes('алмаз') ? BOOSTY_MIN_PRICE : rawPrice);
  const now = new Date().toISOString();
  const status: SubscriptionStatus = {
    hasAccess: true,
    source: 'boosty',
    checkedAt: now,
    stale: false,
    message: 'Boosty подписка подтверждена через Telegram-бот Манакоста.',
    boosty: {
      configured: true,
      checked: true,
      found: true,
      hasAccess: true,
      email: khaVerifiedEmail(profile) || user.email,
      levelName,
      price: inferredPrice,
      source: 'kha-vip-bot',
      message: 'Boosty подписка подтверждена через Telegram-бот Манакоста.',
    },
    telegram: {},
  };
  writeSubscriptionStatus(user, status);
  writeSubscriptionCheck(user, 'boosty:kha-vip-bot', true, status.boosty);
}

function mergeAuthUsers(store: AdminAuthStore, sourceUser: AdminUser, targetUser: AdminUser, patch: Partial<AdminUser> = {}): AdminUser {
  targetUser.role = targetUser.role === 'admin' || sourceUser.role === 'admin' ? 'admin' : 'user';
  targetUser.country = targetUser.country || sourceUser.country || '';
  targetUser.newsletterOptIn = Boolean(targetUser.newsletterOptIn || sourceUser.newsletterOptIn);
  targetUser.telegramId = patch.telegramId ?? targetUser.telegramId ?? sourceUser.telegramId;
  targetUser.telegramUsername = patch.telegramUsername ?? targetUser.telegramUsername ?? sourceUser.telegramUsername;
  targetUser.photoUrl = patch.photoUrl ?? targetUser.photoUrl ?? sourceUser.photoUrl;
  targetUser.avatarInitials = targetUser.avatarInitials || sourceUser.avatarInitials || targetUser.name.slice(0, 2).toUpperCase();
  targetUser.updatedAt = new Date().toISOString();
  store.sessions = store.sessions.map(session =>
    session.email === sourceUser.email ? { ...session, email: targetUser.email } : session
  );
  store.users = store.users.filter(user => user.id !== sourceUser.id);
  return targetUser;
}

function telegramAuthEnabled(): boolean {
  return Boolean(telegramOidcEnabled() || (TELEGRAM_AUTH_BOT_TOKEN && TELEGRAM_AUTH_BOT_USERNAME));
}

function telegramOidcEnabled(): boolean {
  return Boolean(TELEGRAM_OIDC_CLIENT_ID && TELEGRAM_OIDC_CLIENT_SECRET);
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecodeJson(value: string): any {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function verifyTelegramAuthPayload(payload: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  if (!TELEGRAM_AUTH_BOT_TOKEN || !TELEGRAM_AUTH_BOT_USERNAME) return { ok: false, error: 'Telegram-вход пока не настроен' };

  const hash = String(payload.hash ?? '');
  const authDate = Number(payload.auth_date ?? 0);
  if (!/^[a-f0-9]{64}$/i.test(hash) || !Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, error: 'Некорректные данные Telegram' };
  }
  if (Date.now() - authDate * 1000 > TELEGRAM_AUTH_MAX_AGE_MS) {
    return { ok: false, error: 'Сессия Telegram устарела. Попробуйте ещё раз.' };
  }

  const dataCheckString = Object.entries(payload)
    .filter(([key, value]) => key !== 'hash' && value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('\n');

  const secretKey = createHash('sha256').update(TELEGRAM_AUTH_BOT_TOKEN).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const expected = Buffer.from(expectedHash, 'hex');
  const actual = Buffer.from(hash, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, error: 'Telegram не подтвердил вход' };
  }

  return { ok: true };
}

type TelegramOidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

type TelegramOidcState = {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  expiresAt: number;
};

let telegramOidcDiscoveryCache: { data: TelegramOidcDiscovery; expiresAt: number } | null = null;
let telegramOidcJwksCache: { keys: any[]; expiresAt: number } | null = null;

async function fetchJsonWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error_description || data?.error || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function telegramOidcDiscovery(): Promise<TelegramOidcDiscovery> {
  if (telegramOidcDiscoveryCache && telegramOidcDiscoveryCache.expiresAt > Date.now()) return telegramOidcDiscoveryCache.data;
  const data = await fetchJsonWithTimeout(TELEGRAM_OIDC_DISCOVERY_URL);
  if (data?.issuer !== TELEGRAM_OIDC_ISSUER || !data.authorization_endpoint || !data.token_endpoint || !data.jwks_uri) {
    throw new Error('Telegram OIDC discovery вернул неполные данные');
  }
  telegramOidcDiscoveryCache = { data, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
  return data;
}

async function telegramOidcJwks(force = false): Promise<any[]> {
  if (!force && telegramOidcJwksCache && telegramOidcJwksCache.expiresAt > Date.now()) return telegramOidcJwksCache.keys;
  const discovery = await telegramOidcDiscovery();
  const data = await fetchJsonWithTimeout(discovery.jwks_uri);
  const keys = Array.isArray(data?.keys) ? data.keys : [];
  if (!keys.length) throw new Error('Telegram JWKS пустой');
  telegramOidcJwksCache = { keys, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
  return keys;
}

function createAuthSession(store: AdminAuthStore, user: AdminUser): string {
  const token = randomBytes(32).toString('hex');
  store.sessions = store.sessions
    .filter(item => item.expiresAt > Date.now() && item.email !== user.email)
    .concat({
      tokenHash: sha256(token),
      email: user.email,
      expiresAt: Date.now() + AUTH_SESSION_TTL_MS,
      createdAt: new Date().toISOString(),
    });
  return token;
}

function cookieValue(req: import('express').Request, name: string): string {
  const cookie = String(req.headers.cookie ?? '');
  for (const part of cookie.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rawValue.join('=') || '');
  }
  return '';
}

function authCookieDomain(req: import('express').Request): string {
  const host = String(req.headers.host ?? '').split(':')[0].toLowerCase();
  if (host === 'hs-manacost.ru' || host.endsWith('.hs-manacost.ru')) return 'Domain=.hs-manacost.ru';
  return host === 'hs-arena.ru' || host.endsWith('.hs-arena.ru') ? 'Domain=.hs-arena.ru' : '';
}

function setAuthCookie(req: import('express').Request, res: import('express').Response, token: string) {
  const maxAgeSeconds = Math.floor(AUTH_SESSION_TTL_MS / 1000);
  const secure = String(req.headers['x-forwarded-proto'] ?? req.protocol).includes('https') || (String(req.headers.host ?? '').includes('hs-arena.ru') || String(req.headers.host ?? '').includes('hs-manacost.ru'));
  const cookie = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    authCookieDomain(req),
  ].filter(Boolean).join('; ');
  res.append('Set-Cookie', cookie);
}

function clearAuthCookie(req: import('express').Request, res: import('express').Response) {
  const cookie = [
    `${AUTH_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
    authCookieDomain(req),
  ].filter(Boolean).join('; ');
  res.append('Set-Cookie', cookie);
}

function setTelegramOidcCookie(req: import('express').Request, res: import('express').Response, state: TelegramOidcState) {
  const secure = String(req.headers['x-forwarded-proto'] ?? req.protocol).includes('https')
    || (String(req.headers.host ?? '').includes('hs-arena.ru') || String(req.headers.host ?? '').includes('hs-manacost.ru'))
    || String(req.headers.host ?? '').includes('hs-manacost.ru');
  const cookie = [
    `${TELEGRAM_OIDC_COOKIE_NAME}=${encodeURIComponent(base64UrlEncode(JSON.stringify(state)))}`,
    'Path=/api/auth/telegram',
    `Max-Age=${Math.floor(TELEGRAM_OIDC_STATE_TTL_MS / 1000)}`,
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    authCookieDomain(req),
  ].filter(Boolean).join('; ');
  res.append('Set-Cookie', cookie);
}

function clearTelegramOidcCookie(req: import('express').Request, res: import('express').Response) {
  const cookie = [
    `${TELEGRAM_OIDC_COOKIE_NAME}=`,
    'Path=/api/auth/telegram',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
    authCookieDomain(req),
  ].filter(Boolean).join('; ');
  res.append('Set-Cookie', cookie);
}

function readTelegramOidcState(req: import('express').Request): TelegramOidcState | null {
  const raw = cookieValue(req, TELEGRAM_OIDC_COOKIE_NAME);
  if (!raw) return null;
  try {
    const parsed = base64UrlDecodeJson(raw);
    if (!parsed?.state || !parsed?.nonce || !parsed?.codeVerifier || !parsed?.expiresAt) return null;
    if (Number(parsed.expiresAt) <= Date.now()) return null;
    return {
      state: String(parsed.state),
      nonce: String(parsed.nonce),
      codeVerifier: String(parsed.codeVerifier),
      returnTo: String(parsed.returnTo || '/?login&telegram=ok'),
      expiresAt: Number(parsed.expiresAt),
    };
  } catch {
    return null;
  }
}

async function verifyTelegramOidcIdToken(idToken: string, expectedNonce: string): Promise<Record<string, any>> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Telegram вернул некорректный id_token');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = base64UrlDecodeJson(encodedHeader);
  const payload = base64UrlDecodeJson(encodedPayload);
  if (header?.alg !== 'RS256') throw new Error('Telegram id_token подписан неподдерживаемым алгоритмом');

  let keys = await telegramOidcJwks(false);
  let jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) {
    keys = await telegramOidcJwks(true);
    jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA');
  }
  if (!jwk) throw new Error('Не найден ключ Telegram для проверки id_token');

  const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
  const ok = verify('RSA-SHA256', Buffer.from(`${encodedHeader}.${encodedPayload}`), publicKey, Buffer.from(encodedSignature, 'base64url'));
  if (!ok) throw new Error('Telegram id_token не прошёл проверку подписи');

  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== TELEGRAM_OIDC_ISSUER) throw new Error('Некорректный issuer Telegram');
  if (!aud.includes(TELEGRAM_OIDC_CLIENT_ID)) throw new Error('Некорректный audience Telegram');
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('Telegram id_token устарел');
  if (typeof payload.iat === 'number' && payload.iat > now + 300) throw new Error('Telegram id_token из будущего');
  if (payload.nonce !== expectedNonce) throw new Error('Telegram nonce не совпал');
  if (!payload.sub) throw new Error('Telegram не передал ID пользователя');
  return payload;
}

function encodeMailHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

function sendAuthCodeEmail(to: string, code: string): Promise<void> {
  const recipient = normalizeEmail(to);
  if (!isRealEmail(recipient)) {
    return Promise.reject(new Error('Некорректный email получателя'));
  }
  const brandName = 'Экосистема Манакоста';
  const subject = 'Код входа в Экосистему Манакоста';
  const avatarUrl = 'https://bg.hs-manacost.ru/assets/manacost-avatar.jpeg';
  const artUrl = 'https://bg.hs-manacost.ru/wallpaper/wallpaper.jpg';
  const codeCells = code.split('').map(char => `
                    <td align="center" style="padding:0 3px;">
                      <div style="width:42px;height:50px;line-height:50px;background:#f8faff;border:1px solid #cbd7ea;border-radius:10px;color:#0f172a;font-size:25px;font-weight:800;font-family:Arial,Helvetica,sans-serif;text-align:center;box-shadow:0 6px 18px rgba(15,23,42,.10);">${char}</div>
                    </td>`).join('');
  const textBody = [
    `${brandName}`,
    '',
    `Ваш код входа: ${code}`,
    '',
    'Код действует 10 минут.',
    'Если вы не запрашивали вход, просто проигнорируйте это письмо.',
  ].join('\n');
  const htmlBody = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background:#040a14;color:#1e293b;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Ваш код входа: ${code}. Он действует 10 минут.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#040a14;padding:24px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;border-collapse:separate;border-spacing:0;background:#f8faff;border:1px solid #223655;border-radius:18px;overflow:hidden;box-shadow:0 24px 54px rgba(0,0,0,.34);">
            <tr>
              <td style="height:128px;background:#081020;">
                <img src="${artUrl}" width="560" height="128" alt="" style="display:block;width:100%;height:128px;object-fit:cover;object-position:center 47%;">
              </td>
            </tr>
            <tr>
              <td style="background:#081020;padding:18px 22px;border-bottom:1px solid #1d3557;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td width="58" valign="middle">
                      <img src="${avatarUrl}" width="46" height="46" alt="" style="display:block;width:46px;height:46px;border-radius:12px;border:1px solid rgba(56,189,248,.55);object-fit:cover;">
                    </td>
                    <td valign="middle" style="padding-left:14px;">
                      <div style="font-size:12px;line-height:1.2;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;">Manacost ID</div>
                      <div style="margin-top:4px;font-size:20px;line-height:1.15;font-weight:700;color:#e5eefc;">${brandName}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 28px 8px;background:#f8faff;">
                <div style="font-size:20px;line-height:1.3;color:#1e293b;font-weight:700;">Код подтверждения</div>
                <div style="margin-top:8px;font-size:14px;line-height:1.6;color:#475569;">Введите его на сайте, чтобы завершить вход или восстановление пароля.</div>
                <table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:24px auto 22px;">
                  <tr>${codeCells}
                  </tr>
                </table>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:4px;background:#ebf1fc;border:1px solid #cbd7ea;border-radius:14px;">
                  <tr>
                    <td style="padding:13px 15px;font-size:13px;line-height:1.55;color:#334155;">
                      Код действует <b>10 минут</b>. Никому его не передавайте, даже если человек представляется поддержкой.
                    </td>
                  </tr>
                </table>
                <div style="margin-top:15px;font-size:12px;line-height:1.55;color:#64748b;">Если запрос был не ваш, просто проигнорируйте письмо.</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 24px;background:#f8faff;">
                <div style="height:1px;background:#dbe6f5;margin:8px 0 14px;font-size:0;line-height:0;">&nbsp;</div>
                <div style="font-size:12px;line-height:1.5;color:#64748b;">HS-Arena · Hearthstone statistics · Manacost</div>
              </td>
            </tr>
            <tr>
              <td style="padding:13px 20px;background:#081020;border-top:1px solid #1d3557;font-size:11px;line-height:1.45;color:#9fb1ca;text-align:center;">
                Автоматическое письмо. Отвечать на него не нужно.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  const boundary = `hsarena_${randomBytes(12).toString('hex')}`;
  const message = [
    `From: ${encodeMailHeader(brandName)} <${AUTH_FROM}>`,
    `To: ${recipient}`,
    `Subject: ${encodeMailHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    textBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    htmlBody,
    '',
    `--${boundary}--`,
    '',
  ].join('\n');

  return new Promise((resolve, reject) => {
    const child = spawn('/usr/sbin/sendmail', ['-f', AUTH_FROM, '-t'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code: number) => code === 0 ? resolve() : reject(new Error(stderr || `sendmail exited ${code}`)));
    child.stdin.end(message);
  });
}

function adminTokenFromReq(req: import('express').Request): string {
  const header = String(req.headers.authorization ?? '');
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  const cookieToken = cookieValue(req, AUTH_COOKIE_NAME);
  if (cookieToken) return cookieToken;
  return String(req.body?.token ?? '').trim();
}

function userAuth(req: import('express').Request): AdminUser | null {
  const token = adminTokenFromReq(req);
  if (!token) return null;
  const store = loadAuthStore();
  const tokenHash = sha256(token);
  const session = store.sessions.find(item => item.tokenHash === tokenHash && item.expiresAt > Date.now());
  if (!session) return null;
  return store.users.find(user => user.email === session.email) ?? null;
}

function adminAuth(req: import('express').Request): AdminUser | null {
  const user = userAuth(req);
  return user && isAdminUser(user) ? user : null;
}

function isAdminUser(user: AdminUser | null | undefined): user is AdminUser {
  return Boolean(user && user.role === 'admin' && (ADMIN_USER_IDS.size === 0 || ADMIN_USER_IDS.has(user.id)));
}

function getClientIp(req: import('express').Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (raw ? raw.split(',')[0] : req.socket?.remoteAddress ?? '').trim();
}

function emptySubscriptionStatus(message = 'Подписка пока не подтверждена'): SubscriptionStatus {
  return {
    hasAccess: false,
    source: 'none',
    checkedAt: null,
    stale: true,
    message,
    boosty: {},
    telegram: {},
  };
}

function readSubscriptionStatus(userId: string): SubscriptionStatus | null {
  const row = dbGet<any>('SELECT * FROM subscriptions WHERE user_id = ?', userId);
  if (!row) return null;
  const checkedAt = row.checked_at ? String(row.checked_at) : null;
  const age = checkedAt ? Date.now() - Date.parse(checkedAt) : Number.POSITIVE_INFINITY;
  return {
    hasAccess: Boolean(row.has_access),
    source: String(row.source || 'none'),
    checkedAt,
    stale: Boolean(row.stale) || age > SUBSCRIPTION_REFRESH_MS,
    message: String(row.message || ''),
    boosty: safeJsonObject(row.boosty_json),
    telegram: safeJsonObject(row.telegram_json),
  };
}

function safeJsonObject(value: unknown): Record<string, any> {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeSubscriptionStatus(user: AdminUser, status: SubscriptionStatus) {
  const nowIso = new Date().toISOString();
  dbRun(`
    INSERT INTO subscriptions (
      user_id, has_access, source, message, checked_at, stale, boosty_json, telegram_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      has_access = excluded.has_access,
      source = excluded.source,
      message = excluded.message,
      checked_at = excluded.checked_at,
      stale = excluded.stale,
      boosty_json = excluded.boosty_json,
      telegram_json = excluded.telegram_json,
      updated_at = excluded.updated_at
  `, user.id, status.hasAccess ? 1 : 0, status.source, status.message, status.checkedAt, status.stale ? 1 : 0,
    JSON.stringify(status.boosty), JSON.stringify(status.telegram), nowIso);
}

function writeSubscriptionCheck(user: AdminUser, source: string, hasAccess: boolean, detail: Record<string, any>) {
  dbRun(`
    INSERT INTO subscription_checks (user_id, source, has_access, detail_json, checked_at)
    VALUES (?, ?, ?, ?, ?)
  `, user.id, source, hasAccess ? 1 : 0, JSON.stringify(detail), new Date().toISOString());
}

async function checkBoostySubscription(user: AdminUser): Promise<Record<string, any>> {
  if (!isRealEmail(user.email)) {
    return {
      configured: Boolean(BOOSTY_AUTH_API_URL),
      checked: false,
      hasAccess: false,
      found: false,
      message: 'Для проверки Boosty привяжите реальную почту в профиле.',
    };
  }
  try {
    const url = `${BOOSTY_AUTH_API_URL}/api/access/check?email=${encodeURIComponent(user.email)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.detail || data?.error || `HTTP ${response.status}`);
    const subscriber = data?.subscriber && typeof data.subscriber === 'object' ? data.subscriber : null;
    const money = subscriber?.money && typeof subscriber.money === 'object' ? subscriber.money : {};
    const level = subscriber?.level && typeof subscriber.level === 'object' ? subscriber.level : {};
    const price = Number(money.currentPrice ?? level.price ?? 0) || 0;
    const active = Boolean(subscriber?.active ?? subscriber?.hasActivePaidAccess ?? data?.hasAccess);
    const hasAccess = Boolean(data?.found && active && price >= BOOSTY_MIN_PRICE);
    return {
      configured: true,
      checked: true,
      found: Boolean(data?.found),
      hasAccess,
      stale: Boolean(data?.stale),
      email: user.email,
      minPrice: BOOSTY_MIN_PRICE,
      price,
      levelName: String(level.name || ''),
      message: hasAccess
        ? 'Boosty подписка подтверждена.'
        : data?.found
          ? 'Для доступа нужен уровень Алмаз или выше.'
          : 'Boosty не нашёл эту почту. Зайдите на Boosty и привяжите/откройте email, затем обновите проверку.',
    };
  } catch (err: any) {
    console.warn('[subscription] Boosty check failed:', err?.message ?? err);
    return {
      configured: true,
      checked: false,
      hasAccess: false,
      found: false,
      stale: true,
      email: user.email,
      message: err?.message ?? 'Boosty временно недоступен.',
    };
  }
}

async function checkTelegramSubscription(user: AdminUser): Promise<Record<string, any>> {
  if (!KHA_VIP_BOT_TOKEN) {
    return { configured: false, checked: false, hasAccess: false, message: 'VIP Telegram-бот не настроен.' };
  }
  if (!user.telegramId) {
    return { configured: true, checked: false, hasAccess: false, message: 'Для проверки Telegram войдите через Telegram.' };
  }

  const chats: Array<Record<string, any>> = [];
  let hasAccess = false;
  for (const chatId of SUBSCRIPTION_TELEGRAM_CHAT_IDS) {
    try {
      const url = `https://api.telegram.org/bot${KHA_VIP_BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(user.telegramId)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.description || `HTTP ${response.status}`);
      const member = data?.result ?? {};
      const status = String(member.status || '');
      const isMember = ['member', 'administrator', 'creator'].includes(status)
        || (status === 'restricted' && Boolean(member.is_member));
      hasAccess ||= isMember;
      chats.push({ chatId, ok: true, status, isMember });
    } catch (err: any) {
      console.warn(`[subscription] Telegram chat check failed chat=${chatId} user=${user.telegramId}:`, err?.message ?? err);
      chats.push({ chatId, ok: false, isMember: false, error: err?.message ?? 'Telegram check failed' });
    }
  }

  return {
    configured: true,
    checked: true,
    hasAccess,
    telegramId: user.telegramId,
    username: user.telegramUsername ?? '',
    chats,
    message: hasAccess
      ? 'Telegram VIP-канал подтверждён.'
      : 'Пользователь не найден в VIP Telegram-каналах.',
  };
}

async function refreshSubscriptionForUser(user: AdminUser, force = false): Promise<SubscriptionStatus> {
  if (!force) {
    const cached = readSubscriptionStatus(user.id);
    if (cached && !cached.stale) return cached;
  }

  const [boosty, telegram] = await Promise.all([
    checkBoostySubscription(user),
    checkTelegramSubscription(user),
  ]);
  writeSubscriptionCheck(user, 'boosty', Boolean(boosty.hasAccess), boosty);
  writeSubscriptionCheck(user, 'telegram', Boolean(telegram.hasAccess), telegram);

  const sources = [
    boosty.hasAccess ? 'boosty' : '',
    telegram.hasAccess ? 'telegram' : '',
  ].filter(Boolean);
  const hasAccess = sources.length > 0;
  const status: SubscriptionStatus = {
    hasAccess,
    source: hasAccess ? sources.join(',') : 'none',
    checkedAt: new Date().toISOString(),
    stale: Boolean(boosty.stale || telegram.stale),
    message: hasAccess
      ? 'Подписка Манакоста подтверждена.'
      : boosty.message || telegram.message || 'Подписка пока не подтверждена.',
    boosty,
    telegram,
  };
  writeSubscriptionStatus(user, status);
  return status;
}

function parseHttpUrl(rawUrl: unknown): URL | null {
  try {
    const url = new URL(String(rawUrl ?? '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function normalizeArticleUrlKey(rawUrl: unknown): string {
  const url = parseHttpUrl(rawUrl);
  if (!url) return '';
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const pathname = decodeURIComponent(url.pathname)
    .replace(/\/index\.html?$/i, '')
    .replace(/\/+$/, '');
  return `${host}${pathname || '/'}`;
}

function articleSlug(rawUrl: unknown): string {
  const url = parseHttpUrl(rawUrl);
  if (!url) return '';
  const parts = url.pathname.split('/').filter(Boolean);
  return decodeURIComponent(parts.at(-1) || '').toLowerCase();
}

function normalizeArticleTitle(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function isKhaVipArticleUrl(rawUrl: unknown): boolean {
  const url = parseHttpUrl(rawUrl);
  return Boolean(url && KHA_VIP_ARTICLE_HOSTS.has(url.hostname.toLowerCase()));
}

function dateOnly(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

async function fetchKhaVipLockers(force = false): Promise<KhaVipLocker[]> {
  if (!KHA_VIP_WP_BEARER) throw new Error('Koloda VIP API bearer is not configured');
  const now = Date.now();
  if (!force && khaVipLockersCache && khaVipLockersCache.expiresAt > now) {
    return khaVipLockersCache.items;
  }

  const response = await fetch(`${KHA_VIP_WP_BASE_URL}/wp-json/vip/v1/lockers`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${KHA_VIP_WP_BEARER}`,
      'User-Agent': 'HS-Arena VIP article bridge/1.0',
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Koloda lockers unavailable: HTTP ${response.status}${text ? ` ${text.slice(0, 120)}` : ''}`);
  }

  const data = await response.json().catch(() => null);
  if (!Array.isArray(data)) throw new Error('Koloda lockers returned invalid payload');
  const items = data
    .map((item: any): KhaVipLocker => ({
      post_id: Number(item?.post_id || 0),
      code: String(item?.code || ''),
      title: String(item?.title || ''),
      url: String(item?.url || ''),
      image: item?.image ? String(item.image) : '',
      excerpt: item?.excerpt ? String(item.excerpt) : '',
      date: item?.date ? String(item.date) : '',
      type: item?.type ? String(item.type) : '',
    }))
    .filter((item: KhaVipLocker) => item.post_id > 0 && item.code && item.url);

  khaVipLockersCache = { items, expiresAt: now + KHA_VIP_LOCKERS_CACHE_MS };
  return items;
}

async function findKhaVipLockerForArticle(rawUrl: unknown, title?: unknown): Promise<KhaVipLocker | null> {
  if (!isKhaVipArticleUrl(rawUrl)) return null;
  const lockers = await fetchKhaVipLockers();
  const wantedUrl = normalizeArticleUrlKey(rawUrl);
  const wantedSlug = articleSlug(rawUrl);
  const wantedTitle = normalizeArticleTitle(title);

  return lockers.find(item => normalizeArticleUrlKey(item.url) === wantedUrl)
    ?? lockers.find(item => wantedSlug && articleSlug(item.url) === wantedSlug)
    ?? lockers.find(item => wantedTitle && normalizeArticleTitle(item.title) === wantedTitle)
    ?? lockers.find(item => {
      const lockerTitle = normalizeArticleTitle(item.title);
      return Boolean(wantedTitle && lockerTitle && (lockerTitle.includes(wantedTitle) || wantedTitle.includes(lockerTitle)));
    })
    ?? null;
}

function wordpressIssueUserId(user: AdminUser): number {
  const telegramId = Number.parseInt(String(user.telegramId || ''), 10);
  if (Number.isFinite(telegramId) && telegramId > 0) return telegramId;
  const digest = Number.parseInt(sha256(user.id).slice(0, 8), 16);
  return 2_000_000_000 + (digest % 1_000_000_000);
}

async function issueKhaVipArticleLink(locker: KhaVipLocker, user: AdminUser): Promise<Record<string, any>> {
  if (!KHA_VIP_WP_BEARER) throw new Error('Koloda VIP API bearer is not configured');
  const response = await fetch(`${KHA_VIP_WP_BASE_URL}/wp-json/vip/v1/issue`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KHA_VIP_WP_BEARER}`,
      'User-Agent': 'HS-Arena VIP article bridge/1.0',
    },
    body: JSON.stringify({
      post_id: locker.post_id,
      code: locker.code,
      telegram_user_id: wordpressIssueUserId(user),
      ttl: 900,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Koloda issue failed: HTTP ${response.status}`);
  }
  if (!data?.url) throw new Error('Koloda issue did not return URL');
  return data;
}

async function resolveArticlePublishedDate(rawUrl: unknown, title?: unknown): Promise<string | null> {
  try {
    const locker = await findKhaVipLockerForArticle(rawUrl, title);
    const lockerDate = dateOnly(locker?.date);
    if (lockerDate) return lockerDate;
  } catch (err: any) {
    console.warn('[articles] Koloda publish date lookup failed:', err?.message ?? err);
  }

  const url = parseHttpUrl(rawUrl);
  if (!url) return null;
  try {
    const response = await fetch(url.href, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'HS-Arena article metadata lookup/1.0',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    const patterns = [
      /property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i,
      /content=["']([^"']+)["'][^>]*property=["']article:published_time["']/i,
      /itemprop=["']datePublished["'][^>]*content=["']([^"']+)["']/i,
      /<time[^>]+datetime=["']([^"']+)["']/i,
      /"datePublished"\s*:\s*"([^"]+)"/i,
    ];
    for (const pattern of patterns) {
      const matched = html.match(pattern);
      const resolved = dateOnly(matched?.[1]);
      if (resolved) return resolved;
    }
  } catch (err: any) {
    console.warn('[articles] publish date lookup failed:', err?.message ?? err);
  }
  return null;
}

async function refreshAllSubscriptions() {
  syncKhaVipProfiles(db());
  const store = loadAuthStore();
  for (const user of store.users) {
    try {
      await refreshSubscriptionForUser(user, true);
    } catch (err: any) {
      console.warn(`[subscription] scheduled refresh failed user=${user.id}:`, err?.message ?? err);
    }
  }
}

function internalApiGuard(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) {
  if (!ECOSYSTEM_INTERNAL_KEY) return res.status(503).json({ error: 'Internal ecosystem API is not configured' });
  if (String(req.headers['x-ecosystem-key'] ?? '') !== ECOSYSTEM_INTERNAL_KEY) {
    return res.status(401).json({ error: 'Invalid ecosystem key' });
  }
  next();
}

function resolveUserFromRequest(req: import('express').Request): AdminUser | null {
  const userId = String(req.query.userId ?? req.body?.userId ?? '').trim();
  const email = normalizeEmail(req.query.email ?? req.body?.email);
  const telegramId = String(req.query.telegramId ?? req.body?.telegramId ?? '').replace(/\D/g, '');
  const store = loadAuthStore();
  return store.users.find(user =>
    (userId && user.id === userId)
    || (email && user.email === email)
    || (telegramId && user.telegramId === telegramId)
  ) ?? null;
}

function loadClassPositionsData() {
  return loadData('class_positions.json') ?? { positions: {}, updatedAt: null };
}

function withClassPositions(data: any) {
  const positionsData = loadClassPositionsData();
  const positions = positionsData?.positions ?? {};
  return {
    ...data,
    classPositions: positions,
    sections: (data?.sections ?? []).map((section: any) => ({
      ...section,
      classPosition: positions[section.id] ?? '',
    })),
  };
}

const HSREPLAY_ARENA_DATASET_URL = 'https://api.hs-manacost.ru/datasets/hsreplay_arena';
const CLASS_MATCHUPS_CACHE_MS = 30 * 60 * 1000;
const KOLODA_ARENA_DECKS_URL = 'https://kolodahs.ru/arena/winning';
const ARENA_DECKS_CACHE_MS = 30 * 60 * 1000;
const ARENA_DECKS_MAX_LIMIT = 500;
const HSREPLAY_CLASS_ID: Record<string, string> = {
  deathknight: 'death-knight',
  demonhunter: 'demon-hunter',
  druid: 'druid',
  hunter: 'hunter',
  mage: 'mage',
  paladin: 'paladin',
  priest: 'priest',
  rogue: 'rogue',
  shaman: 'shaman',
  warlock: 'warlock',
  warrior: 'warrior',
};
const HSREPLAY_CLASS_INFO: Record<string, { id: string; name: string; color: string; textDark?: boolean }> = {
  deathknight: { id: 'death-knight', name: 'Рыцарь смерти',     color: '#1f252d' },
  demonhunter: { id: 'demon-hunter', name: 'Охотник на демонов', color: '#224722' },
  druid:       { id: 'druid',        name: 'Друид',              color: '#704a16' },
  hunter:      { id: 'hunter',       name: 'Охотник',            color: '#1d5921' },
  mage:        { id: 'mage',         name: 'Маг',                color: '#2b5c85' },
  paladin:     { id: 'paladin',      name: 'Паладин',            color: '#a88a45' },
  priest:      { id: 'priest',       name: 'Жрец',               color: '#d1d1d1', textDark: true },
  rogue:       { id: 'rogue',        name: 'Разбойник',          color: '#333333' },
  shaman:      { id: 'shaman',       name: 'Шаман',              color: '#2a2e6b' },
  warlock:     { id: 'warlock',      name: 'Чернокнижник',       color: '#5c265c' },
  warrior:     { id: 'warrior',      name: 'Воин',               color: '#7a1e1e' },
};

function normalizeHsReplayClassId(value: unknown): string | null {
  const key = String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return HSREPLAY_CLASS_ID[key] ?? null;
}

function parseWinrate(value: unknown): number | null {
  const raw = typeof value === 'string' ? value.replace('%', '').trim() : value;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  const pct = num > 0 && num <= 1 ? num * 100 : num;
  return Math.round(pct * 100) / 100;
}

async function fetchClassWinratesData() {
  const upstream = await fetch(HSREPLAY_ARENA_DATASET_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ManacostArena/1.0)' },
  });
  if (!upstream.ok) throw new Error(`Upstream HTTP ${upstream.status}`);

  const payload = await upstream.json() as any;
  const structured = payload?.data?.structured ?? payload?.structured ?? {};
  const rawClasses = Array.isArray(structured?.classes) ? structured.classes : [];
  const classes = rawClasses
    .map((row: any) => {
      const classId = normalizeHsReplayClassId(row.class ?? row.class_name ?? row.name);
      const infoKey = classId ? classId.replace(/-/g, '') : '';
      const info = HSREPLAY_CLASS_INFO[infoKey] ?? HSREPLAY_CLASS_INFO[classId ?? ''];
      const winrate = parseWinrate(row.win_rate ?? row.winrate);
      const games = Number(row.num_drafts ?? row.games ?? row.total_games ?? row.totalGames ?? 0);
      if (!info || winrate === null || !Number.isFinite(games) || games <= 0) return null;
      return { ...info, winrate: Math.round(winrate * 10) / 10, games };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.winrate - a.winrate);

  if (!classes.length) throw new Error('No classes in HSReplay arena dataset');

  return {
    classes,
    updatedAt: payload?.fetched_at ?? payload?.data?.updatedAt ?? payload?.data?.updated_at ?? null,
    source: 'api.hs-manacost.ru',
  };
}

async function fetchClassMatchupsData() {
  const upstream = await fetch(HSREPLAY_ARENA_DATASET_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ManacostArena/1.0)' },
  });
  if (!upstream.ok) throw new Error(`Upstream HTTP ${upstream.status}`);

  const payload = await upstream.json() as any;
  const structured = payload?.data?.structured ?? payload?.structured ?? {};
  const rawMatchups = Array.isArray(structured?.matchups) ? structured.matchups : [];
  const matchups = rawMatchups
    .map((row: any) => {
      const classAId = normalizeHsReplayClassId(row.class_a ?? row.classA);
      const classBId = normalizeHsReplayClassId(row.class_b ?? row.classB);
      const winrate = parseWinrate(row.win_rate ?? row.winrate);
      if (!classAId || !classBId || winrate === null) return null;
      return {
        classAId,
        classBId,
        winrate,
        classA: row.class_a ?? row.classA ?? classAId,
        classB: row.class_b ?? row.classB ?? classBId,
      };
    })
    .filter(Boolean);

  const updatedAt = payload?.fetched_at ?? payload?.data?.fetched_at ?? null;
  return {
    matchups,
    updatedAt,
    source: 'api.hs-manacost.ru',
  };
}

function decodeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function htmlText(value: unknown): string {
  return decodeHtml(String(value ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlAttr(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}=(["'])([\\s\\S]*?)\\1`, 'i'));
  return match ? decodeHtml(match[2]).trim() : '';
}

function absoluteKolodaUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  try {
    return new URL(url, KOLODA_ARENA_DECKS_URL).toString();
  } catch {
    return url;
  }
}

function cardIdFromImageUrl(url: string): string {
  const match = url.match(/\/(?:256x|512x)\/([^/.?]+)\.png/i)
    ?? url.match(/\/cards\/[^/]+\/([^/.?]+)\.png(?:[?#].*)?$/i);
  return match ? decodeURIComponent(match[1]) : '';
}

function parseDeckCards(block: string, ruCards: Record<string, any>) {
  const figures = block.match(/<figure\b[\s\S]*?<\/figure>/gi) ?? [];
  return figures
    .map((figure) => {
      const imgMatch = figure.match(/<img\b[\s\S]*?>/i);
      const img = imgMatch?.[0] ?? '';
      const sourceImage = absoluteKolodaUrl(htmlAttr(img, 'src'));
      const cardId = normalizeCardImageId(cardIdFromImageUrl(sourceImage)) ?? '';
      if (!cardId) return null;

      const fallbackName = htmlAttr(img, 'alt') || htmlAttr(figure, 'title') || cardId;
      const countMatch = figure.match(/<figcaption>\s*x?(\d+)\s*<\/figcaption>/i);
      const count = countMatch ? Math.max(1, Number(countMatch[1]) || 1) : 1;
      return {
        cardId,
        name: String(ruCards?.[cardId]?.name ?? htmlText(fallbackName) ?? cardId),
        cost: parseCount(ruCards?.[cardId]?.mana) ?? 0,
        count,
        image: cardImageProxyUrl(cardId),
      };
    })
    .filter(Boolean);
}

function sortDeckCardsByMana(cards: any[]) {
  return [...cards].sort((a, b) => {
    const aCost = typeof a?.cost === 'number' ? a.cost : 0;
    const bCost = typeof b?.cost === 'number' ? b.cost : 0;
    if (aCost !== bCost) return aCost - bCost;
    return String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'ru');
  });
}

function arenaDeckClassOptions(decks: any[]) {
  const map = new Map<string, any>();
  for (const deck of decks) {
    for (const cls of deck.classes ?? []) {
      if (cls?.name && !map.has(cls.name)) map.set(cls.name, cls);
    }
  }
  return Array.from(map.values()).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
}

function shapeArenaDecksPage(data: any, page: number, pageSize: number, className: string) {
  const allDecks = Array.isArray(data?.decks) ? data.decks : [];
  const filtered = className
    ? allDecks.filter((deck: any) => (deck.classes ?? []).some((cls: any) => cls?.name === className))
    : allDecks;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(totalPages, Math.max(1, page));
  const start = (safePage - 1) * pageSize;

  return {
    decks: filtered.slice(start, start + pageSize),
    totalDecks: data.totalDecks ?? allDecks.length,
    filteredDecks: filtered.length,
    page: safePage,
    pageSize,
    totalPages,
    activeClass: className || '',
    classOptions: arenaDeckClassOptions(allDecks),
    updatedAt: data.updatedAt ?? null,
    source: 'arena-decks',
    sourceUrl: '',
    warning: data.warning,
  };
}

function etagToken(value: string) {
  return encodeURIComponent(value).replace(/[^a-z0-9_.~-]/gi, '_') || 'all';
}

function parseKolodaUtcDate(value: string): string | null {
  const match = value.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})\s+UTC/i);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))).toISOString();
}

function extractFirstBlock(html: string, className: string): string {
  return html.match(new RegExp(`<section[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>[\\s\\S]*?<\\/section>`, 'i'))?.[0] ?? '';
}

function parseArenaDeckArticle(article: string, index: number, ruCards: Record<string, any>) {
  const header = article.match(/<header[^>]*class=["'][^"']*arena-deck-head[^"']*["'][^>]*>[\s\S]*?<\/header>/i)?.[0] ?? '';
  const id = header.match(/\/arena\/generate\/(\d+)/i)?.[1] ?? `deck-${index + 1}`;
  const classIcons = (header.match(/<img\b[^>]*class=["'][^"']*arena-class-icon[^"']*["'][^>]*>/gi) ?? [])
    .map((img) => ({
      name: htmlAttr(img, 'alt'),
      icon: absoluteKolodaUrl(htmlAttr(img, 'src')),
    }))
    .filter(cls => cls.name);

  const resultMatch = header.match(/<strong>\s*(\d+)\s*[-–]\s*(\d+)\s*<\/strong>\s*<span>\s*([\s\S]*?)\s*<\/span>/i);
  const wins = resultMatch ? Number(resultMatch[1]) : null;
  const losses = resultMatch ? Number(resultMatch[2]) : null;
  const player = htmlText(resultMatch?.[3] ?? '');

  const finalBlock = extractFirstBlock(article, 'arena-section-final');
  const legendaryBlock = extractFirstBlock(article, 'arena-block-legendary');
  const removedBlock = extractFirstBlock(article, 'arena-block-remove');
  const addedBlock = extractFirstBlock(article, 'arena-block-add');
  const finalCards = sortDeckCardsByMana(parseDeckCards(finalBlock, ruCards));

  return {
    id,
    rank: index + 1,
    classes: classIcons,
    classNames: classIcons.map(cls => cls.name).join(' / '),
    wins,
    losses,
    score: wins !== null && losses !== null ? `${wins}-${losses}` : null,
    player,
    cardCount: finalCards.reduce((sum: number, card: any) => sum + (card?.count ?? 1), 0),
    sourceUrl: '',
    generateUrl: '',
    finalCards,
    legendaryCards: sortDeckCardsByMana(parseDeckCards(legendaryBlock, ruCards)),
    removedCards: sortDeckCardsByMana(parseDeckCards(removedBlock, ruCards)),
    addedCards: sortDeckCardsByMana(parseDeckCards(addedBlock, ruCards)),
  };
}

async function fetchArenaDecksData(limit = ARENA_DECKS_MAX_LIMIT) {
  const safeLimit = Math.min(ARENA_DECKS_MAX_LIMIT, Math.max(1, Math.round(limit)));
  const url = `${KOLODA_ARENA_DECKS_URL}?limit=${safeLimit}`;
  const [ruCards, upstream] = await Promise.all([
    ensureRuCardsData(),
    fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 ManacostArena/1.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      },
    }),
  ]);
  if (!upstream.ok) throw new Error(`KolodaHS HTTP ${upstream.status}`);

  const html = await upstream.text();
  const totalDecks = parseCount(html.match(/Колод:\s*([\d\s]+)/i)?.[1]) ?? null;
  const updatedAtText = htmlText(html.match(/<div[^>]*class=["'][^"']*arena-source[^"']*["'][^>]*>[\s\S]*?<span>\s*([\s\S]*?)\s*<\/span>/i)?.[1] ?? '');
  const updatedAt = updatedAtText ? parseKolodaUtcDate(updatedAtText) : null;
  const articles = html.match(/<article\b[^>]*class=["'][^"']*arena-deck[^"']*["'][^>]*>[\s\S]*?<\/article>/gi) ?? [];
  const decks = articles
    .map((article, index) => parseArenaDeckArticle(article, index, ruCards))
    .filter((deck: any) => deck.finalCards.length > 0);

  return {
    decks,
    totalDecks,
    updatedAt,
    source: 'arena-decks',
    sourceUrl: '',
  };
}

const DATASET_API_ORIGIN = 'https://api.hs-manacost.ru';
const DATASET_API_BASE = `${DATASET_API_ORIGIN}/datasets`;
const BG_HEROES_API_URL = `${DATASET_API_ORIGIN}/demo/view/hsreplay_battlegrounds_heroes`;
const BG_HERO_DETAILS_API_BASE = `${DATASET_API_ORIGIN}/api/bg/heroes`;
const BG_LIBRARY_API_BASE = 'https://db.kolodahs.ru/api/v1';
const BG_CARD_ASSET_PUBLIC_BASE = 'https://db.kolodahs.ru/uploads';
const BG_CARD_ASSET_ROOT = '/var/www/koloda/data/www/db.kolodahs.ru/uploads';
const BG_FIRESTONE_SPELLS_API_URL = `${DATASET_API_ORIGIN}/demo/view/firestone_battlegrounds_spells`;
const HEARTHSTONEJSON_RU_CARDS_URL = 'https://api.hearthstonejson.com/v1/latest/ruRU/cards.collectible.json';
const EXTERNAL_DATASET_CACHE_MS = DATASET_MEMORY_CACHE_MS;
const TIERLIST_API_CACHE_MS = DATASET_MEMORY_CACHE_MS;
const TIERLIST_DATASET_BY_SOURCE = {
  hsreplay: 'demo/view/hsreplay_arena_cards_advanced',
  heartharena: 'heartharena_tierlist',
  firestone: 'firestone_arena_cards_normal',
} as const;
const LEGENDARIES_DATASET_BY_SOURCE = {
  hsreplay: 'hsreplay_arena_legendaries',
  firestone: 'firestone_arena_legendaries_normal',
} as const;
const TIER_SOURCE_LABEL: Record<keyof typeof TIERLIST_DATASET_BY_SOURCE, string> = {
  hsreplay: 'hsreplay.net',
  heartharena: 'heartharena.com',
  firestone: 'firestoneapp.com',
};
const LEGENDARY_SOURCE_LABEL: Record<keyof typeof LEGENDARIES_DATASET_BY_SOURCE, string> = {
  hsreplay: 'hsreplay.net',
  firestone: 'firestoneapp.com',
};

const ARENA_CLASSES = [
  { id: 'death-knight', name: 'Рыцарь смерти', color: '#1f252d', textDark: false },
  { id: 'demon-hunter', name: 'Охотник на демонов', color: '#224722', textDark: false },
  { id: 'druid', name: 'Друид', color: '#704a16', textDark: false },
  { id: 'hunter', name: 'Охотник', color: '#1d5921', textDark: false },
  { id: 'mage', name: 'Маг', color: '#2b5c85', textDark: false },
  { id: 'paladin', name: 'Паладин', color: '#a88a45', textDark: false },
  { id: 'priest', name: 'Жрец', color: '#d1d1d1', textDark: true },
  { id: 'rogue', name: 'Разбойник', color: '#333333', textDark: false },
  { id: 'shaman', name: 'Шаман', color: '#2a2e6b', textDark: false },
  { id: 'warlock', name: 'Чернокнижник', color: '#5c265c', textDark: false },
  { id: 'warrior', name: 'Воин', color: '#7a1e1e', textDark: false },
  { id: 'any', name: 'Нейтральные', color: '#4a4a4a', textDark: false },
];
const ARENA_CLASS_BY_ID = Object.fromEntries(ARENA_CLASSES.map(cls => [cls.id, cls]));
const CARD_CLASS_TO_ID: Record<string, string> = {
  DEATHKNIGHT: 'death-knight',
  DEATHKNIGHTCARD: 'death-knight',
  DEATH_KNIGHT: 'death-knight',
  DEMONHUNTER: 'demon-hunter',
  DEMON_HUNTER: 'demon-hunter',
  DRUID: 'druid',
  HUNTER: 'hunter',
  MAGE: 'mage',
  PALADIN: 'paladin',
  PRIEST: 'priest',
  ROGUE: 'rogue',
  SHAMAN: 'shaman',
  WARLOCK: 'warlock',
  WARRIOR: 'warrior',
  NEUTRAL: 'any',
  ALL: 'any',
};
const TIER_ORDER = ['S', 'A', 'B', 'C', 'D', 'E', 'F', HSREPLAY_NO_ARENASMITH_TIER];
const HEARTHARENA_TIER_TO_LETTER: Record<string, string> = {
  great: 'S',
  good: 'A',
  'above-average': 'B',
  aboveaverage: 'B',
  average: 'C',
  'below-average': 'D',
  belowaverage: 'D',
  bad: 'E',
  terrible: 'F',
};
const TIER_LABEL_FULL: Record<string, string> = {
  S: 'Отлично',
  A: 'Хорошо',
  B: 'Выше среднего',
  C: 'Средне',
  D: 'Ниже среднего',
  E: 'Плохо',
  F: 'Ужасно',
  [HSREPLAY_NO_ARENASMITH_TIER]: 'Без тира',
};
const TIER_DESC_MAP: Record<string, string> = {
  S: 'Авто-пик — доминирующие карты текущего метагейма.',
  A: 'Отличные карты, очень сильны в большинстве ситуаций.',
  B: 'Выше среднего — хороший выбор для стабильной колоды.',
  C: 'Средние карты, полезны при нехватке лучших вариантов.',
  D: 'Ниже среднего — берите только если нет лучших карт.',
  E: 'Плохие карты — последний выбор.',
  F: 'Ужасные карты — никогда не стоит брать.',
  [HSREPLAY_NO_ARENASMITH_TIER]: 'Карты без Arenasmith Score в текущем срезе HSReplay.',
};
const TIER_ALIAS_TO_LETTER: Record<string, string> = {
  GREAT: 'S',
  EXCELLENT: 'S',
  'AUTO-PICK': 'S',
  'AUTO-PICKS': 'S',
  'TIER-1': 'S',
  'TIER-2': 'A',
  'TIER-3': 'B',
  'TIER-4': 'C',
  'TIER-5': 'D',
  'TIER-6': 'E',
  'TIER-7': 'F',
  GOOD: 'A',
  'ABOVE-AVERAGE': 'B',
  ABOVEAVERAGE: 'B',
  AVERAGE: 'C',
  'BELOW-AVERAGE': 'D',
  BELOWAVERAGE: 'D',
  BAD: 'E',
  TERRIBLE: 'F',
};
let hearthstoneJsonRuCards: Record<string, any> | null = null;
let hearthstoneJsonRuCardsPromise: Promise<Record<string, any>> | null = null;

async function ensureRuCardsData(): Promise<Record<string, any>> {
  if (hearthstoneJsonRuCards) return hearthstoneJsonRuCards;
  if (!hearthstoneJsonRuCardsPromise) {
    hearthstoneJsonRuCardsPromise = fetch(HEARTHSTONEJSON_RU_CARDS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ManacostArena/1.0)' },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HearthstoneJSON HTTP ${res.status}`);
        const cards = await res.json() as any[];
        return Object.fromEntries((Array.isArray(cards) ? cards : []).map((card: any) => [card.id, {
          name: card.name,
          mana: card.cost,
          attack: card.attack,
          health: card.health,
          type: card.type,
          rarity: card.rarity,
          playerClass: card.cardClass,
          dbf: card.dbfId,
        }]));
      })
      .then((map) => {
        hearthstoneJsonRuCards = map;
        return map;
      })
      .catch((err) => {
        hearthstoneJsonRuCardsPromise = null;
        console.error('[Server] Failed to load ru card dictionary:', err?.message ?? err);
        return {};
      });
  }
  return hearthstoneJsonRuCardsPromise;
}

function normalizeSource<T extends Record<string, string>>(source: string | undefined, known: T, fallback: keyof T): keyof T {
  return Object.prototype.hasOwnProperty.call(known, source ?? '') ? source as keyof T : fallback;
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const raw = typeof value === 'string' ? value.replace('%', '').replace(/\s+/g, '').replace(',', '.') : value;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100) / 100;
}

function parsePercentish(value: unknown): number | null {
  return parseWinrate(value);
}

function parseCount(value: unknown): number | null {
  const num = parseNumber(value);
  if (num === null) return null;
  return Math.round(num);
}

function normalizeArenaClassId(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (raw && ARENA_CLASS_BY_ID[raw]) return raw;
  const hsReplayId = normalizeHsReplayClassId(raw);
  if (hsReplayId) return hsReplayId;
  const compact = raw.toUpperCase().replace(/[^A-Z]/g, '');
  return CARD_CLASS_TO_ID[compact] ?? 'any';
}

function normalizeRarity(value: unknown): string {
  const rarity = String(value ?? '').toLowerCase().replace(/[^a-z-]/g, '');
  return rarity || 'common';
}

function normalizeType(value: unknown): string | undefined {
  const type = String(value ?? '').toLowerCase().replace(/[^a-z-]/g, '');
  return type || undefined;
}

function safeCardId(row: any): string {
  return String(row?.card_id ?? row?.cardId ?? row?.id ?? '').trim();
}

function getRuCard(cardId: string): any | null {
  if (!cardId) return null;
  return hearthstoneJsonRuCards?.[cardId] ?? loadDataCached('cards_ru.json')?.data?.[cardId] ?? null;
}

function hsRenderUrl(cardId: string, size: '256x' | '512x' = '256x', locale = 'ruRU'): string {
  return `https://art.hearthstonejson.com/v1/render/latest/${locale}/${size}/${cardId}.png`;
}

function cardImageProxyUrl(cardId: string, variant: 'thumb' | 'full' = 'thumb'): string {
  return `/api/card-image/${encodeURIComponent(cardId)}/${variant}.webp?v=${CARD_IMAGE_CACHE_VERSION}`;
}

function normalizeCardImageId(value: unknown): string | null {
  const cardId = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_]+$/.test(cardId) || cardId.length > 80) return null;
  return cardId;
}

function cardImageCachePath(cardId: string, variant: 'thumb' | 'full'): string {
  return join(CARD_IMAGE_CACHE_DIR, `${cardId}-${variant}-${CARD_IMAGE_CACHE_VERSION}.webp`);
}

async function withCardImageSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeCardImageJobs >= MAX_CARD_IMAGE_JOBS) {
    await new Promise<void>(resolve => cardImageQueue.push(resolve));
  }

  activeCardImageJobs += 1;
  try {
    return await task();
  } finally {
    activeCardImageJobs -= 1;
    const next = cardImageQueue.shift();
    if (next) next();
  }
}

async function fetchRemoteCardImage(cardId: string, variant: 'thumb' | 'full'): Promise<Buffer> {
  const sourceSize = variant === 'full' ? '512x' : '256x';
  const locales = ['ruRU', 'enUS'];
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (const locale of locales) {
      try {
        const upstream = await fetch(hsRenderUrl(cardId, sourceSize, locale), {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ManacostArena/1.0)' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!upstream.ok) {
          lastError = new Error(`Hearthstone image ${locale} HTTP ${upstream.status}`);
          continue;
        }
        return Buffer.from(await upstream.arrayBuffer());
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  throw lastError ?? new Error('Card image unavailable');
}

async function ensureCardImage(cardId: string, variant: 'thumb' | 'full'): Promise<string> {
  mkdirSync(CARD_IMAGE_CACHE_DIR, { recursive: true });
  const outPath = cardImageCachePath(cardId, variant);
  if (existsSync(outPath)) return outPath;

  const jobKey = `${cardId}:${variant}`;
  const existingJob = cardImageJobs.get(jobKey);
  if (existingJob) return existingJob;

  const job = (async () => {
    return withCardImageSlot(async () => {
      const source = await fetchRemoteCardImage(cardId, variant);
      const width = variant === 'full' ? 360 : 180;
      await sharp(source)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: variant === 'full' ? 82 : 76, effort: 4 })
        .toFile(outPath);
      return outPath;
    });
  })().finally(() => cardImageJobs.delete(jobKey));

  cardImageJobs.set(jobKey, job);
  return job;
}

function displayCardName(row: any): string {
  const cardId = safeCardId(row);
  const ruCard = getRuCard(cardId);
  return String(ruCard?.name ?? row?.heartharena_name ?? row?.name ?? row?.card_name ?? cardId).trim();
}

function normalizeTierLetter(value: any): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  if (TIER_ORDER.includes(upper)) return upper;

  const normalized = upper
    .replace(/[._\s]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (TIER_ORDER.includes(normalized)) return normalized;
  if (TIER_ALIAS_TO_LETTER[normalized]) return TIER_ALIAS_TO_LETTER[normalized];
  if (TIER_ALIAS_TO_LETTER[normalized.replace(/-/g, '')]) return TIER_ALIAS_TO_LETTER[normalized.replace(/-/g, '')];

  const letterMatch = normalized.match(/(?:^|-)TIER-([SABCDEF])(?:-|$)/)
    ?? normalized.match(/(?:^|-)RANK-([SABCDEF])(?:-|$)/);
  if (letterMatch?.[1] && TIER_ORDER.includes(letterMatch[1])) return letterMatch[1];

  const numericMatch = normalized.match(/(?:^|-)TIER-([1-7])(?:-|$)/)
    ?? normalized.match(/(?:^|-)RANK-([1-7])(?:-|$)/)
    ?? normalized.match(/^([1-7])$/);
  if (numericMatch?.[1]) return TIER_ORDER[Number(numericMatch[1]) - 1] ?? null;

  return null;
}

function inferTier(row: any, deckWinrate: number | null, score: number | null, source: keyof typeof TIERLIST_DATASET_BY_SOURCE): string {
  if (source === 'hsreplay') {
    const directArenasmithTier = normalizeArenasmithTier(
      row?.arenasmith_tier
        ?? row?.arenasmithTier
        ?? row?.arenasmith_tier_position
        ?? row?.arenasmithTierPosition,
    );
    if (directArenasmithTier) return directArenasmithTier;
    return tierFromArenasmithScore(score) ?? HSREPLAY_NO_ARENASMITH_TIER;
  }

  const directTier = normalizeTierLetter(
    row?.tier
      ?? row?.tier_letter
      ?? row?.tierLetter
      ?? row?.card_tier
      ?? row?.cardTier
      ?? row?.hsreplay_tier
      ?? row?.hsreplayTier,
  );
  if (directTier) return directTier;

  if (source === 'heartharena') {
    const key = String(row?.tier_id ?? row?.tierName ?? row?.tier_name ?? '').trim().toLowerCase();
    const normalizedKey = key.replace(/\s+/g, '-');
    const tier = HEARTHARENA_TIER_TO_LETTER[normalizedKey] ?? HEARTHARENA_TIER_TO_LETTER[normalizedKey.replace(/-/g, '')];
    if (tier) return tier;
    if (score !== null) {
      if (score >= 85) return 'S';
      if (score >= 70) return 'A';
      if (score >= 55) return 'B';
      if (score >= 40) return 'C';
      if (score >= 25) return 'D';
      if (score >= 10) return 'E';
      return 'F';
    }
  }

  if (deckWinrate !== null) {
    if (deckWinrate >= 60) return 'S';
    if (deckWinrate >= 57) return 'A';
    if (deckWinrate >= 54) return 'B';
    if (deckWinrate >= 51) return 'C';
    if (deckWinrate >= 48) return 'D';
    if (deckWinrate >= 45) return 'E';
    return 'F';
  }
  return 'C';
}

function normalizeTierCard(row: any, source: keyof typeof TIERLIST_DATASET_BY_SOURCE): any | null {
  const cardId = safeCardId(row);
  if (!cardId) return null;
  const ruCard = getRuCard(cardId);
  const deckWinrate = parsePercentish(row?.win_rate ?? row?.deck_winrate ?? row?.deckWinrate);
  const arenaScore = source === 'hsreplay'
    ? parseNumber(row?.arenasmith_score ?? row?.arenasmithScore ?? row?.score)
    : parseNumber(row?.score ?? row?.arena_score ?? row?.arenaScore);
  const score = source === 'hsreplay'
    ? arenaScore
    : source === 'heartharena'
      ? arenaScore ?? 0
      : Math.round((deckWinrate ?? 0) * 10);
  return {
    name: displayCardName(row),
    score,
    rarity: normalizeRarity(ruCard?.rarity ?? row?.rarity),
    cardId,
    classKey: normalizeArenaClassId(row?.cardClass ?? row?.classKey ?? row?.arena_class),
    source,
    winrate: deckWinrate ?? undefined,
    deckWinrate,
    pickRate: parsePercentish(row?.pick_rate ?? row?.pickRate),
    playedWinrate: parsePercentish(row?.winrate_when_played ?? row?.played_winrate ?? row?.playedWinrate),
    inDecks: parsePercentish(row?.popularity ?? row?.in_runs ?? row?.inDecks),
    totalGames: parseCount(row?.total_games ?? row?.totalGames ?? row?.times_played ?? row?.timesPlayed),
    arenaScore,
    arenaSmithTier: normalizeArenasmithTier(row?.arenasmith_tier ?? row?.arenasmithTier),
    arenaSmithTierPosition: normalizeArenasmithTier(row?.arenasmith_tier_position ?? row?.arenasmithTierPosition),
    arenaSmithRank: parseCount(row?.arenasmith_rank ?? row?.arenasmithRank),
    offerRate: parsePercentish(row?.offer_rate ?? row?.offerRate),
    discardRate: parsePercentish(row?.discard_rate ?? row?.discardRate),
    drawnWinrate: parsePercentish(row?.winrate_when_drawn ?? row?.drawn_winrate ?? row?.drawnWinrate),
    mulliganWinrate: parsePercentish(row?.mulligan_winrate ?? row?.mulliganWinrate),
    keptRate: parsePercentish(row?.kept_rate ?? row?.keptRate),
    avgCopies: parseNumber(row?.avg_copies ?? row?.avgCopies),
  };
}

function normalizeCardLookup(row: any) {
  const cardId = safeCardId(row);
  const ruCard = getRuCard(cardId);
  const imageUrl = row?.image_url ?? row?.imageHa ?? row?.imageRu ?? '';
  const imageRu = cardId
    ? cardImageProxyUrl(cardId)
    : imageUrl && String(imageUrl).includes('/ruRU/')
      ? imageUrl
      : null;
  return {
    cost: parseCount(ruCard?.mana ?? row?.cost) ?? undefined,
    attack: parseCount(ruCard?.attack ?? row?.attack) ?? undefined,
    health: parseCount(ruCard?.health ?? row?.health) ?? undefined,
    type: normalizeType(ruCard?.type ?? row?.type),
    imageHa: imageUrl || '',
    imageRu,
    rarityDb: normalizeRarity(ruCard?.rarity ?? row?.rarity),
  };
}

function makeTierGroups(cards: any[], source: keyof typeof TIERLIST_DATASET_BY_SOURCE) {
  const grouped = new Map<string, any[]>();
  for (const card of cards) {
    const tier = inferTier(card.__raw ?? card, card.deckWinrate ?? null, card.arenaScore ?? null, source);
    if (!grouped.has(tier)) grouped.set(tier, []);
    grouped.get(tier)!.push(card);
  }

  return TIER_ORDER
    .filter(tier => grouped.has(tier))
    .map(tier => ({
      tier,
      label: TIER_LABEL_FULL[tier],
      description: TIER_DESC_MAP[tier],
      cards: grouped.get(tier)!.sort((a, b) => {
        if (source === 'heartharena') return (b.score ?? 0) - (a.score ?? 0);
        if (source === 'hsreplay') {
          return (b.arenaScore ?? Number.NEGATIVE_INFINITY) - (a.arenaScore ?? Number.NEGATIVE_INFINITY)
            || (a.arenaSmithRank ?? Number.POSITIVE_INFINITY) - (b.arenaSmithRank ?? Number.POSITIVE_INFINITY)
            || (b.deckWinrate ?? 0) - (a.deckWinrate ?? 0)
            || (b.totalGames ?? 0) - (a.totalGames ?? 0);
        }
        return (b.deckWinrate ?? 0) - (a.deckWinrate ?? 0)
          || (b.totalGames ?? 0) - (a.totalGames ?? 0)
          || (b.arenaScore ?? 0) - (a.arenaScore ?? 0);
      }).map(({ __raw, ...card }) => card),
    }));
}

function buildClassSections(sectionCards: Map<string, any[]>, source: keyof typeof TIERLIST_DATASET_BY_SOURCE) {
  return ARENA_CLASSES
    .map(cls => {
      const cards = sectionCards.get(cls.id) ?? [];
      return {
        ...cls,
        tiers: makeTierGroups(cards, source),
        totalCards: cards.length,
      };
    })
    .filter(section => section.totalCards > 0);
}

function normalizeFlatTierlist(structured: any, source: keyof typeof TIERLIST_DATASET_BY_SOURCE, updatedAt: string | null) {
  const rawCards = Array.isArray(structured?.cards) ? structured.cards : [];
  const cardsLookup: Record<string, any> = {};
  const sectionCards = new Map<string, any[]>();

  for (const row of rawCards) {
    const card = normalizeTierCard(row, source);
    if (!card) continue;
    const cardId = card.cardId;
    cardsLookup[cardId] = normalizeCardLookup(row);
    const classId = card.classKey;
    if (!sectionCards.has(classId)) sectionCards.set(classId, []);
    sectionCards.get(classId)!.push({ ...card, __raw: row });
  }

  return {
    sections: buildClassSections(sectionCards, source),
    cards: cardsLookup,
    updatedAt,
    source: TIER_SOURCE_LABEL[source],
  };
}

function normalizeHearthArenaTierlist(structured: any, updatedAt: string | null) {
  const classes = structured?.classes && typeof structured.classes === 'object' ? structured.classes : {};
  const classEntries = Array.isArray(classes)
    ? classes.map((classData: any) => [classData?.class_id ?? classData?.id ?? classData?.class_name, classData] as [string, any])
    : Object.entries(classes) as Array<[string, any]>;
  const cardsLookup: Record<string, any> = {};
  const sectionCards = new Map<string, any[]>();

  for (const [classIdRaw, classData] of classEntries) {
    const classId = normalizeArenaClassId(classIdRaw);
    const rawCards = Array.isArray(classData?.cards) ? classData.cards : [];
    for (const row of rawCards) {
      const card = normalizeTierCard(row, 'heartharena');
      if (!card) continue;
      cardsLookup[card.cardId] = normalizeCardLookup(row);
      if (!sectionCards.has(classId)) sectionCards.set(classId, []);
      sectionCards.get(classId)!.push({ ...card, __raw: row });
    }
  }

  return {
    sections: buildClassSections(sectionCards, 'heartharena'),
    cards: cardsLookup,
    updatedAt,
    source: TIER_SOURCE_LABEL.heartharena,
  };
}

function normalizeTierlistDataset(payload: any, source: keyof typeof TIERLIST_DATASET_BY_SOURCE) {
  const structured = payload?.view ?? payload?.data?.structured ?? payload?.data?.hsreplay_extracted ?? payload?.structured ?? {};
  const updatedAt = payload?.fetched_at ?? payload?.data?.fetched_at ?? structured?.last_update_date ?? null;
  if (source === 'heartharena') return normalizeHearthArenaTierlist(structured, updatedAt);
  return normalizeFlatTierlist(structured, source, updatedAt);
}

function normalizeLegendaryCard(row: any) {
  const cardId = safeCardId(row);
  const ruCard = getRuCard(cardId);
  const imageUrl = row?.image_url ?? row?.imageHa ?? '';
  const imageRu = cardId
    ? cardImageProxyUrl(cardId)
    : imageUrl && String(imageUrl).includes('/ruRU/')
      ? imageUrl
      : null;
  return {
    cardId,
    name: displayCardName(row),
    cost: parseCount(ruCard?.mana ?? row?.cost) ?? undefined,
    type: normalizeType(ruCard?.type ?? row?.type),
    rarity: normalizeRarity(ruCard?.rarity ?? row?.rarity),
    classKey: normalizeArenaClassId(row?.cardClass ?? row?.classKey),
    count: parseCount(row?.count) ?? undefined,
    imageHa: imageUrl,
    imageRu: row?.imageRu ?? imageRu,
  };
}

function normalizeLegendaryGroupStats(row: any, source: keyof typeof LEGENDARIES_DATASET_BY_SOURCE) {
  const winRate = parsePercentish(row?.winrate ?? row?.win_rate ?? row?.deck_winrate);
  return {
    source,
    winrate: winRate ?? undefined,
    deckWinrate: winRate,
    pickRate: parsePercentish(row?.pick_rate ?? row?.pickRate),
    offerRate: parsePercentish(row?.offer_rate ?? row?.offerRate),
    totalGames: parseCount(row?.total_games ?? row?.totalGames ?? row?.games),
    statsContext: 'legendary',
  };
}

function buildTierlistCardStatsMap(tierlistData: any) {
  const stats = new Map<string, any>();
  for (const section of tierlistData?.sections ?? []) {
    for (const tier of section?.tiers ?? []) {
      for (const card of tier?.cards ?? []) {
        if (!card?.cardId) continue;
        const lookup = tierlistData?.cards?.[card.cardId] ?? {};
        stats.set(card.cardId, {
          ...card,
          ...lookup,
          tier: tier.tier,
          source: 'hsreplay',
          statsContext: 'tierlist',
          rarity: lookup.rarityDb ?? card.rarity,
          classKey: card.classKey ?? section.id,
          imageHa: lookup.imageHa ?? card.imageHa ?? '',
          imageRu: lookup.imageRu ?? card.imageRu ?? null,
        });
      }
    }
  }
  return stats;
}

function enrichLegendaryCardWithTierlistStats(card: any, tierStatsByCardId: Map<string, any>) {
  const stats = card?.cardId ? tierStatsByCardId.get(card.cardId) : null;
  if (!stats) return card;
  return {
    ...card,
    ...stats,
    name: card.name ?? stats.name,
    cost: card.cost ?? stats.cost,
    imageHa: card.imageHa || stats.imageHa || '',
    imageRu: card.imageRu ?? stats.imageRu ?? null,
  };
}

function enrichLegendariesWithTierlistStats(legendariesData: any, tierlistData: any) {
  const tierStatsByCardId = buildTierlistCardStatsMap(tierlistData);
  if (!tierStatsByCardId.size) return legendariesData;
  return {
    ...legendariesData,
    groups: (legendariesData?.groups ?? []).map((group: any) => ({
      ...group,
      keyCard: enrichLegendaryCardWithTierlistStats(group.keyCard, tierStatsByCardId),
      cards: (group.cards ?? []).map((card: any) => enrichLegendaryCardWithTierlistStats(card, tierStatsByCardId)),
    })),
  };
}

function normalizeLegendariesDataset(
  payload: any,
  source: keyof typeof LEGENDARIES_DATASET_BY_SOURCE,
  packageCardsByKey = new Map<string, any[]>(),
) {
  const structured = payload?.data?.structured ?? payload?.structured ?? {};
  const updatedAt = payload?.fetched_at ?? payload?.data?.fetched_at ?? structured?.last_update_date ?? null;

  if (source === 'firestone') {
    const rawCards = Array.isArray(structured?.cards) ? structured.cards : [];
    return {
      groups: rawCards
        .map((row: any) => {
          const winRate = parsePercentish(row?.win_rate ?? row?.deck_winrate);
          const classKey = normalizeArenaClassId(row?.cardClass ?? row?.classKey);
          return {
            keyCard: {
              ...normalizeLegendaryCard(row),
              ...normalizeLegendaryGroupStats(row, source),
              winrate: winRate ?? undefined,
              deckWinrate: winRate,
              classKey,
            },
            cards: packageCardsByKey.get(safeCardId(row)) ?? [],
            winRate,
            pickRate: parsePercentish(row?.pick_rate ?? row?.pickRate),
            offerRate: parsePercentish(row?.offer_rate ?? row?.offerRate),
            classKey,
          };
        })
        .filter((group: any) => group.keyCard.cardId),
      updatedAt,
      source: LEGENDARY_SOURCE_LABEL.firestone,
    };
  }

  const rawGroups = Array.isArray(structured?.groups) ? structured.groups : [];
  return {
    groups: rawGroups
      .map((row: any) => {
        const keyCardRow = row?.key_card ?? row?.legendary_card ?? row?.keyCard;
        const winRate = parsePercentish(row?.winrate ?? row?.win_rate ?? row?.deck_winrate);
        const classKey = normalizeArenaClassId(row?.class ?? keyCardRow?.cardClass ?? row?.classKey);
        const keyCard = {
          ...normalizeLegendaryCard(keyCardRow),
          ...normalizeLegendaryGroupStats(row, source),
          winrate: winRate ?? undefined,
          deckWinrate: winRate,
          classKey,
        };
        return {
          keyCard,
          cards: (Array.isArray(row?.cards) ? row.cards : []).map(normalizeLegendaryCard).filter((card: any) => card.cardId),
          winRate,
          pickRate: parsePercentish(row?.pick_rate ?? row?.pickRate),
          offerRate: parsePercentish(row?.offer_rate ?? row?.offerRate),
          classKey,
        };
      })
      .filter((group: any) => group.keyCard.cardId),
    updatedAt,
    source: LEGENDARY_SOURCE_LABEL.hsreplay,
  };
}

function buildLegendaryPackageMap(payload: any) {
  const hsReplayData = normalizeLegendariesDataset(payload, 'hsreplay');
  return new Map<string, any[]>(
    (hsReplayData.groups ?? []).map((group: any) => [group.keyCard.cardId, group.cards ?? []]),
  );
}

function compactHomeTopCards(tierlistData: any) {
  const seen = new Set<string>();
  const result: any[] = [];
  for (const tier of ['S', 'A']) {
    for (const section of tierlistData?.sections ?? []) {
      const tierGroup = (section?.tiers ?? []).find((group: any) => group?.tier === tier);
      if (!tierGroup) continue;
      const cards = [...(tierGroup.cards ?? [])].sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));
      for (const card of cards) {
        if (!card?.cardId || seen.has(card.cardId)) continue;
        seen.add(card.cardId);
        const lookup = tierlistData?.cards?.[card.cardId] ?? {};
        result.push({
          cardId: card.cardId,
          name: card.name,
          score: card.score,
          rarity: card.rarity,
          tier,
          classKey: card.classKey,
          cost: lookup.cost,
          imageRu: lookup.imageRu ?? null,
          imageHa: lookup.imageHa ?? '',
        });
        if (result.length >= 10) return result;
      }
    }
  }
  return result;
}

function compactHomeTopLegendaries(legendariesData: any) {
  return [...(legendariesData?.groups ?? [])]
    .filter((group: any) => group?.keyCard?.cardId && group.winRate !== null && group.winRate !== undefined)
    .sort((a: any, b: any) => (b.winRate ?? 0) - (a.winRate ?? 0))
    .slice(0, 8)
    .map((group: any) => ({
      cardId: group.keyCard.cardId,
      name: group.keyCard.name,
      cost: group.keyCard.cost,
      imageRu: group.keyCard.imageRu ?? null,
      imageHa: group.keyCard.imageHa ?? '',
      winRate: group.winRate,
      classKey: group.classKey,
    }));
}

type ApiDataCacheSource = 'memory' | 'redis' | 'origin';

interface ApiDataResult<T = any> {
  data: T;
  etag: string;
  cacheSource: ApiDataCacheSource;
}

async function getTierlistApiData(
  source: keyof typeof TIERLIST_DATASET_BY_SOURCE,
  now: number,
  bypassCache = false,
): Promise<ApiDataResult> {
  const cached = tierlistApiCache.get(source);
  if (!bypassCache && cached && cached.expiresAt > now) {
    return { data: cached.data, etag: cached.etag, cacheSource: 'memory' };
  }

  const redisKey = redisDataKey('tierlist', source);
  if (!bypassCache) {
    const redisCached = await redisGetCache(redisKey);
    if (redisCached) {
      tierlistApiCache.set(source, {
        data: redisCached.data,
        etag: redisCached.etag,
        expiresAt: now + TIERLIST_API_CACHE_MS,
      });
      return { data: redisCached.data, etag: redisCached.etag, cacheSource: 'redis' };
    }
  }

  const [payload] = await Promise.all([
    fetchDataset(TIERLIST_DATASET_BY_SOURCE[source]),
    ensureRuCardsData(),
  ]);
  const data = normalizeTierlistDataset(payload, source);
  const etag = makeExternalEtag('tierlist', source, data, now);
  tierlistApiCache.set(source, { data, etag, expiresAt: now + TIERLIST_API_CACHE_MS });
  void redisSetCache(redisKey, data, etag, REDIS_DATASET_TTL_SECONDS);
  return { data, etag, cacheSource: 'origin' };
}

async function getLegendariesApiData(
  source: keyof typeof LEGENDARIES_DATASET_BY_SOURCE,
  now: number,
  bypassCache = false,
): Promise<ApiDataResult> {
  const cached = legendariesApiCache.get(source);
  if (!bypassCache && cached && cached.expiresAt > now) {
    return { data: cached.data, etag: cached.etag, cacheSource: 'memory' };
  }

  const redisKey = redisDataKey('legendaries', source);
  if (!bypassCache) {
    const redisCached = await redisGetCache(redisKey);
    if (redisCached) {
      legendariesApiCache.set(source, {
        data: redisCached.data,
        etag: redisCached.etag,
        expiresAt: now + EXTERNAL_DATASET_CACHE_MS,
      });
      return { data: redisCached.data, etag: redisCached.etag, cacheSource: 'redis' };
    }
  }

  const dataBase = source === 'firestone'
    ? await (async () => {
        const [firestonePayload, hsReplayPayload] = await Promise.all([
          fetchDataset(LEGENDARIES_DATASET_BY_SOURCE.firestone),
          fetchDataset(LEGENDARIES_DATASET_BY_SOURCE.hsreplay),
          ensureRuCardsData(),
        ]);
        return normalizeLegendariesDataset(firestonePayload, source, buildLegendaryPackageMap(hsReplayPayload));
      })()
    : normalizeLegendariesDataset((await Promise.all([
        fetchDataset(LEGENDARIES_DATASET_BY_SOURCE[source]),
        ensureRuCardsData(),
      ]))[0], source);
  let data = dataBase;
  try {
    const tierlistData = (await getTierlistApiData('hsreplay', now)).data;
    data = enrichLegendariesWithTierlistStats(dataBase, tierlistData);
  } catch (err: any) {
    console.warn('[api/legendaries] tierlist stats enrichment failed:', err?.message ?? err);
  }
  const etag = makeExternalEtag('legendaries-v2', source, data, now);
  legendariesApiCache.set(source, { data, etag, expiresAt: now + EXTERNAL_DATASET_CACHE_MS });
  void redisSetCache(redisKey, data, etag, REDIS_DATASET_TTL_SECONDS);
  return { data, etag, cacheSource: 'origin' };
}

async function loadTierlistForHomeSummary(now: number) {
  const source = 'hsreplay' as const;
  try {
    return (await getTierlistApiData(source, now)).data;
  } catch (err: any) {
    console.warn('[api/home/summary] tierlist source failed:', err?.message ?? err);
    return loadDataCached('hsreplay_tierlist.json')?.data
      ?? loadDataCached('tierlist.json')?.data
      ?? { sections: [], cards: {}, updatedAt: null, source: 'unavailable' };
  }
}

async function loadLegendariesForHomeSummary(now: number) {
  const source = 'hsreplay' as const;
  try {
    return (await getLegendariesApiData(source, now)).data;
  } catch (err: any) {
    console.warn('[api/home/summary] legendaries source failed:', err?.message ?? err);
    return loadDataCached('legendaries.json')?.data
      ?? { groups: [], updatedAt: null, source: 'unavailable' };
  }
}

async function buildHomeSummary(now: number) {
  const [winratesData, tierlistData, legendariesData] = await Promise.all([
    fetchClassWinratesData().catch((err: any) => {
      console.warn('[api/home/summary] winrates source failed:', err?.message ?? err);
      return loadDataCached('winrates.json')?.data
        ?? { classes: [], updatedAt: null, source: 'unavailable' };
    }),
    loadTierlistForHomeSummary(now),
    loadLegendariesForHomeSummary(now),
  ]);

  const topClasses = [...(winratesData?.classes ?? [])]
    .sort((a: any, b: any) => (b.winrate ?? 0) - (a.winrate ?? 0))
    .slice(0, 3);
  const topCards = compactHomeTopCards(tierlistData);
  const topLegendaries = compactHomeTopLegendaries(legendariesData);

  return {
    topClasses,
    topCards,
    topLegendaries,
    updatedAt: {
      winrates: winratesData?.updatedAt ?? null,
      tierlist: tierlistData?.updatedAt ?? null,
      legendaries: legendariesData?.updatedAt ?? null,
    },
    sources: {
      winrates: winratesData?.source ?? 'unknown',
      tierlist: tierlistData?.source ?? 'unknown',
      legendaries: legendariesData?.source ?? 'unknown',
    },
  };
}

function makeHomeSummaryEtag(data: any, now: number) {
  const updatedValues = Object.values(data?.updatedAt ?? {})
    .map(value => typeof value === 'string' ? Date.parse(value) : NaN)
    .filter(Number.isFinite) as number[];
  const updatedToken = (updatedValues.length ? Math.max(...updatedValues) : now).toString(36);
  return `"home-summary-${updatedToken}-${data.topClasses?.length ?? 0}-${data.topCards?.length ?? 0}-${data.topLegendaries?.length ?? 0}"`;
}

function datasetApiUrl(datasetId: string): string {
  if (/^https?:\/\//i.test(datasetId)) return datasetId;
  const path = datasetId.replace(/^\/+/, '');
  if (path.includes('/')) return `${DATASET_API_ORIGIN}/${path}`;
  return `${DATASET_API_BASE}/${path}`;
}

async function fetchDataset(datasetId: string) {
  const upstream = await fetch(datasetApiUrl(datasetId), {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ManacostArena/1.0)' },
  });
  if (!upstream.ok) throw new Error(`Upstream HTTP ${upstream.status}`);
  return upstream.json();
}

function makeExternalEtag(prefix: string, source: string, data: any, now: number): string {
  const rawUpdatedAt = data?.updatedAt;
  const updatedMs = rawUpdatedAt ? Date.parse(rawUpdatedAt) : NaN;
  const token = Number.isFinite(updatedMs) ? updatedMs.toString(36) : now.toString(36);
  const count = data?.sections?.reduce?.((sum: number, section: any) => sum + (section?.totalCards ?? 0), 0)
    ?? data?.groups?.length
    ?? 0;
  return `"${prefix}-${source}-${token}-${count}"`;
}

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST;

app.use(compression({ level: 6, threshold: 1024 }));
app.use(express.json());

// Rate limiting: max 120 req/min per IP for data API
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте через минуту.' },
  skip: (req) => req.path.startsWith('/card-image/') || req.ip === '127.0.0.1' || req.ip === '::1',
});
app.use('/api/', apiLimiter);

// CORS for Vite dev server
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── API Routes ───────────────────────────────────────────────────────────────

// 6 h cache (aligns with scrape schedule) — stale-while-revalidate keeps UX snappy
const CACHE_6H  = 'public, max-age=21600, stale-while-revalidate=3600';
const CACHE_1H  = 'public, max-age=3600,  stale-while-revalidate=600';
const CACHE_5M  = 'public, max-age=300, stale-while-revalidate=300';
const CACHE_TIERLIST = 'public, max-age=3600, stale-while-revalidate=3600';
const CACHE_TIERLIST_STALE = 'public, max-age=300, stale-while-revalidate=600';
const ARTICLE_COVER_ALLOWED_HOSTS = new Set([
  'hs-manacost.ru',
  'www.hs-manacost.ru',
  'manacost.ru',
  'www.manacost.ru',
  'kolodahearthstone.ru',
  'www.kolodahearthstone.ru',
]);
const ARTICLE_COVER_MAX_BYTES = 8 * 1024 * 1024;

// ─── ETag helper ──────────────────────────────────────────────────────────────
function sendCached(req: express.Request, res: express.Response, entry: CacheEntry, cacheHeader: string) {
  res.set('Cache-Control', cacheHeader);
  res.set('ETag', entry.etag);
  if (req.headers['if-none-match'] === entry.etag) return res.status(304).end();
  res.json(entry.data);
}

function sendJsonCached(req: express.Request, res: express.Response, data: any, etag: string, cacheHeader: string, cacheSource?: string) {
  res.set('Cache-Control', cacheHeader);
  res.set('ETag', etag);
  if (cacheSource) res.set('X-Data-Cache', cacheSource);
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.json(data);
}

app.get('/api/home/summary', async (req, res) => {
  const now = Date.now();
  if (homeSummaryApiCache && homeSummaryApiCache.expiresAt > now) {
    return sendJsonCached(req, res, homeSummaryApiCache.data, homeSummaryApiCache.etag, CACHE_5M, 'memory');
  }

  const redisKey = redisDataKey('home-summary');
  const redisCached = await redisGetCache(redisKey);
  if (redisCached) {
    homeSummaryApiCache = {
      data: redisCached.data,
      etag: redisCached.etag,
      expiresAt: now + HOME_SUMMARY_CACHE_MS,
    };
    return sendJsonCached(req, res, redisCached.data, redisCached.etag, CACHE_5M, 'redis');
  }

  try {
    const data = await buildHomeSummary(now);
    const etag = makeHomeSummaryEtag(data, now);
    homeSummaryApiCache = { data, etag, expiresAt: now + HOME_SUMMARY_CACHE_MS };
    void redisSetCache(redisKey, data, etag, REDIS_HOME_SUMMARY_TTL_SECONDS);
    return sendJsonCached(req, res, data, etag, CACHE_5M, 'origin');
  } catch (err: any) {
    if (homeSummaryApiCache) {
      return sendJsonCached(req, res, {
        ...homeSummaryApiCache.data,
        warning: 'stale',
      }, homeSummaryApiCache.etag, 'public, max-age=60, stale-while-revalidate=300', 'memory-stale');
    }
    return res.status(502).json({ error: err?.message ?? 'Home summary unavailable' });
  }
});

app.get('/api/card-image/:cardId/:variant.webp', async (req, res) => {
  const cardId = normalizeCardImageId(req.params.cardId);
  const variant = req.params.variant === 'full' ? 'full' : req.params.variant === 'thumb' ? 'thumb' : null;

  if (!cardId || !variant) {
    return res.status(400).json({ error: 'Invalid card image request' });
  }

  try {
    const imagePath = await ensureCardImage(cardId, variant);
    const stat = statSync(imagePath);
    const etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;

    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'public, max-age=2592000, immutable');
    res.set('ETag', etag);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();

    return createReadStream(imagePath).pipe(res);
  } catch (err: any) {
    return res.status(502).json({ error: err?.message ?? 'Card image unavailable' });
  }
});

app.get('/api/winrates', async (req, res) => {
  const source = (req.query.source as string) ?? 'hsreplay';
  const now = Date.now();
  const cached = winratesApiCache.get(source);
  if (cached && cached.expiresAt > now) {
    return sendJsonCached(req, res, cached.data, cached.etag, CACHE_1H);
  }

  // Firestone: proxy live zerotoheroes.com API
  if (source === 'firestone') {
    const CLASS_INFO: Record<string, { id: string; name: string; color: string; textDark?: boolean }> = {
      deathknight: { id: 'death-knight', name: 'Рыцарь смерти',     color: '#1f252d' },
      paladin:     { id: 'paladin',      name: 'Паладин',            color: '#a88a45' },
      shaman:      { id: 'shaman',       name: 'Шаман',              color: '#2a2e6b' },
      hunter:      { id: 'hunter',       name: 'Охотник',            color: '#1d5921' },
      mage:        { id: 'mage',         name: 'Маг',                color: '#2b5c85' },
      rogue:       { id: 'rogue',        name: 'Разбойник',          color: '#333333' },
      warlock:     { id: 'warlock',      name: 'Чернокнижник',       color: '#5c265c' },
      druid:       { id: 'druid',        name: 'Друид',              color: '#704a16' },
      warrior:     { id: 'warrior',      name: 'Воин',               color: '#7a1e1e' },
      priest:      { id: 'priest',       name: 'Жрец',               color: '#d1d1d1', textDark: true },
      demonhunter: { id: 'demon-hunter', name: 'Охотник на демонов', color: '#224722' },
    };
    try {
      const upstream = await fetch(
        'https://static.zerotoheroes.com/api/arena/stats/classes/arena/last-patch/overview.gz.json',
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ManacostArena/1.0)' } },
      );
      if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
      const raw = await upstream.json() as any;
      const classes = ((raw.stats ?? []) as any[])
        .map((s: any) => {
          const key  = String(s.playerClass ?? '').toLowerCase().replace(/\s+/g, '');
          const info = CLASS_INFO[key];
          if (!info || !s.totalGames) return null;
          const winrate = Math.round((s.totalsWins / s.totalGames) * 1000) / 10;
          return { ...info, winrate, games: s.totalGames };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => b.winrate - a.winrate);
      const data = { classes, updatedAt: raw.lastUpdated ?? null, source: 'firestoneapp.com' };
      const updatedToken = data.updatedAt ? Date.parse(data.updatedAt).toString(36) : now.toString(36);
      const etag = `"class-winrates-firestone-${updatedToken}-${classes.length}"`;
      winratesApiCache.set(source, { data, etag, expiresAt: now + CLASS_MATCHUPS_CACHE_MS });
      return sendJsonCached(req, res, data, etag, CACHE_1H);
    } catch {
      // fallback to snapshot on error
    }
  }

  // HSReplay (default): use the same live Manacost API dataset as class matchups.
  try {
    const data = await fetchClassWinratesData();
    const updatedToken = data.updatedAt ? new Date(data.updatedAt).getTime().toString(36) : Date.now().toString(36);
    const etag = `"class-winrates-${updatedToken}-${data.classes.length}"`;
    winratesApiCache.set(source, { data, etag, expiresAt: now + CLASS_MATCHUPS_CACHE_MS });
    return sendJsonCached(req, res, data, etag, CACHE_1H);
  } catch (err: any) {
    console.error('[api/winrates] HSReplay arena dataset failed:', err?.message ?? err);
  }

  // Fallback to the last scraper snapshot if the live dataset is unavailable.
  const entry = loadDataCached('winrates.json');
  if (!entry) return res.status(404).json({ error: 'No data available' });
  return sendCached(req, res, { ...entry, data: { ...entry.data, source: 'cached' } }, 'public, max-age=300, stale-while-revalidate=600');
});

app.get('/api/class-matchups', async (req, res) => {
  const now = Date.now();
  if (classMatchupsCache && classMatchupsCache.expiresAt > now) {
    return sendJsonCached(req, res, classMatchupsCache.data, classMatchupsCache.etag, CACHE_1H);
  }

  try {
    const data = await fetchClassMatchupsData();
    const updatedToken = data.updatedAt ? new Date(data.updatedAt).getTime().toString(36) : now.toString(36);
    const etag = `"class-matchups-${updatedToken}-${data.matchups.length}"`;
    classMatchupsCache = { data, etag, expiresAt: now + CLASS_MATCHUPS_CACHE_MS };
    return sendJsonCached(req, res, data, etag, CACHE_1H);
  } catch (err: any) {
    if (classMatchupsCache) {
      return sendJsonCached(req, res, {
        ...classMatchupsCache.data,
        warning: 'stale',
      }, classMatchupsCache.etag, 'public, max-age=300, stale-while-revalidate=600');
    }
    return res.status(502).json({ error: err?.message ?? 'Class matchups unavailable' });
  }
});

app.get('/api/tierlist', async (req, res) => {
  const source = normalizeSource(req.query.source as string | undefined, TIERLIST_DATASET_BY_SOURCE, 'hsreplay');
  const now = Date.now();
  const cached = tierlistApiCache.get(source);
  const bypassCache = req.query.t !== undefined
    || req.query.bust === '1';
  if (!bypassCache && cached && cached.expiresAt > now) {
    return sendJsonCached(req, res, withClassPositions(cached.data), cached.etag, CACHE_TIERLIST, 'memory');
  }

  try {
    const result = await getTierlistApiData(source, now, bypassCache);
    return sendJsonCached(req, res, withClassPositions(result.data), result.etag, CACHE_TIERLIST, result.cacheSource);
  } catch (err: any) {
    if (cached) {
      return sendJsonCached(req, res, withClassPositions({
        ...cached.data,
        warning: 'stale',
      }), cached.etag, CACHE_TIERLIST_STALE, 'memory-stale');
    }

    const fallbackFilename = source === 'hsreplay' ? 'hsreplay_tierlist.json' : source === 'heartharena' ? 'tierlist.json' : null;
    const fallback = fallbackFilename ? loadDataCached(fallbackFilename) : null;
    if (fallback) {
      return sendCached(req, res, {
        ...fallback,
        data: withClassPositions({
          ...fallback.data,
          warning: 'fallback',
        }),
      }, CACHE_6H);
    }

    return res.status(502).json({ error: err?.message ?? 'Tierlist unavailable' });
  }
});

app.get('/api/legendaries', async (req, res) => {
  const source = normalizeSource(req.query.source as string | undefined, LEGENDARIES_DATASET_BY_SOURCE, 'hsreplay');
  const now = Date.now();
  const cached = legendariesApiCache.get(source);
  const bypassCache = req.query.t !== undefined
    || req.query.bust === '1';
  if (!bypassCache && cached && cached.expiresAt > now) {
    return sendJsonCached(req, res, cached.data, cached.etag, CACHE_1H, 'memory');
  }

  try {
    const result = await getLegendariesApiData(source, now, bypassCache);
    return sendJsonCached(req, res, result.data, result.etag, CACHE_1H, result.cacheSource);
  } catch (err: any) {
    if (cached) {
      return sendJsonCached(req, res, {
        ...cached.data,
        warning: 'stale',
      }, cached.etag, 'public, max-age=300, stale-while-revalidate=600', 'memory-stale');
    }

    if (source === 'hsreplay') {
      const fallback = loadDataCached('legendaries.json');
      if (fallback) return sendCached(req, res, fallback, CACHE_6H);
    }

    return res.status(502).json({ error: err?.message ?? 'Legendaries unavailable' });
  }
});

app.get('/api/decks', async (req, res) => {
  const page = Math.max(1, parseCount(req.query.page) ?? 1);
  const pageSize = Math.min(20, Math.max(1, parseCount(req.query.pageSize) ?? 10));
  const className = String(req.query.class ?? '').trim();
  const now = Date.now();
  if (arenaDecksCache && arenaDecksCache.expiresAt > now) {
    const pageData = shapeArenaDecksPage(arenaDecksCache.data, page, pageSize, className);
    const etag = `"${arenaDecksCache.etag.replace(/^"|"$/g, '')}-p${pageData.page}-s${pageSize}-c${etagToken(className)}"`;
    return sendJsonCached(req, res, pageData, etag, CACHE_1H);
  }

  try {
    const data = await fetchArenaDecksData(ARENA_DECKS_MAX_LIMIT);
    const updatedToken = data.updatedAt ? Date.parse(data.updatedAt).toString(36) : now.toString(36);
    const etag = `"arena-decks-${updatedToken}-${data.decks.length}-${data.totalDecks ?? 0}"`;
    arenaDecksCache = { data, etag, expiresAt: now + ARENA_DECKS_CACHE_MS };
    const pageData = shapeArenaDecksPage(data, page, pageSize, className);
    const pageEtag = `"${etag.replace(/^"|"$/g, '')}-p${pageData.page}-s${pageSize}-c${etagToken(className)}"`;
    return sendJsonCached(req, res, pageData, pageEtag, CACHE_1H);
  } catch (err: any) {
    if (arenaDecksCache) {
      const pageData = shapeArenaDecksPage({ ...arenaDecksCache.data, warning: 'stale' }, page, pageSize, className);
      const etag = `"${arenaDecksCache.etag.replace(/^"|"$/g, '')}-p${pageData.page}-s${pageSize}-c${etagToken(className)}-stale"`;
      return sendJsonCached(req, res, pageData, etag, 'public, max-age=300, stale-while-revalidate=600');
    }

    return res.status(502).json({ error: err?.message ?? 'Arena decks unavailable' });
  }
});

app.get('/api/articles', (req, res) => {
  const entry = loadDataCached('articles.json');
  if (!entry) return res.status(404).json({ error: 'No data' });
  return sendCached(req, res, entry, CACHE_1H);
});

app.post('/api/articles/access-link', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const user = userAuth(req);
  if (!user) return res.status(401).json({ error: 'Требуется вход в профиль Манакоста' });

  const rawUrl = String(req.body?.url ?? '').trim();
  const title = String(req.body?.title ?? '').trim();
  const target = parseHttpUrl(rawUrl);
  if (!target) return res.status(400).json({ error: 'Некорректная ссылка на статью' });

  if (!isKhaVipArticleUrl(target.href)) {
    return res.json({ url: target.href, passthrough: true });
  }

  try {
    const subscription = await refreshSubscriptionForUser(user, false);
    if (!subscription.hasAccess && !isAdminUser(user)) {
      return res.status(403).json({
        error: 'Для доступа к VIP-статье нужна активная подписка Манакоста',
        subscription,
      });
    }

    const locker = await findKhaVipLockerForArticle(target.href, title);
    if (!locker) {
      return res.status(404).json({ error: 'VIP-материал не найден в каталоге Koloda' });
    }

    const issued = await issueKhaVipArticleLink(locker, user);
    return res.json({
      url: String(issued.url),
      target: String(issued.target || locker.url),
      expiresAt: issued.expires_at ?? null,
      ttl: Number(issued.ttl || 900),
      source: 'koloda-vip',
      article: {
        postId: locker.post_id,
        title: locker.title,
        url: locker.url,
      },
    });
  } catch (err: any) {
    console.error('[articles] access-link failed:', err?.message ?? err);
    return res.status(502).json({ error: err?.message ?? 'Не удалось выдать доступ к статье' });
  }
});

app.get('/api/article-cover', async (req, res) => {
  const rawUrl = String(req.query.url ?? '').trim();
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: 'Некорректный URL обложки' });
  }

  if (!['https:', 'http:'].includes(target.protocol) || !ARTICLE_COVER_ALLOWED_HOSTS.has(target.hostname.toLowerCase())) {
    return res.status(400).json({ error: 'Домен обложки не разрешён' });
  }

  try {
    const upstream = await fetch(target.href, {
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
        'User-Agent': 'HS-Arena article cover proxy/1.0',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'Обложка недоступна' });

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return res.status(415).json({ error: 'URL не ведёт на изображение' });
    }

    const contentLength = Number(upstream.headers.get('content-length') || 0);
    if (contentLength > ARTICLE_COVER_MAX_BYTES) {
      return res.status(413).json({ error: 'Обложка слишком большая' });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.byteLength > ARTICLE_COVER_MAX_BYTES) {
      return res.status(413).json({ error: 'Обложка слишком большая' });
    }

    const etag = `"article-cover-${createHash('sha1').update(target.href).update(String(buffer.byteLength)).digest('hex')}"`;
    res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.set('ETag', etag);
    res.set('Content-Type', contentType);
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    return res.send(buffer);
  } catch (err: any) {
    return res.status(502).json({ error: err?.message ?? 'Не удалось загрузить обложку' });
  }
});


function normalizeBattlegroundAssetUrls(value: any): any {
  if (typeof value === 'string') {
    return value
      .replaceAll('https://127.0.0.1:3107', 'https://bg.kolodahearthstone.ru')
      .replaceAll('http://127.0.0.1:3107', 'https://bg.kolodahearthstone.ru');
  }
  if (Array.isArray(value)) return value.map(item => normalizeBattlegroundAssetUrls(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeBattlegroundAssetUrls(item)]));
  }
  return value;
}

type BgCardLocaleEntry = {
  id?: string;
  cardId?: string;
  dbfId?: number | string;
  name?: string;
  localizedName?: string;
  baseName?: string;
  text?: string;
  race?: string;
  raceRu?: string;
  races?: string[];
  techLevel?: number;
  tier?: number;
  artUrl?: string;
};

type BgLocaleMap = {
  expiresAt: number;
  byId: Map<string, BgCardLocaleEntry>;
  byDbfId: Map<string, BgCardLocaleEntry>;
  byCardId: Map<string, BgCardLocaleEntry>;
  byStatsKey: Map<string, BgCardLocaleEntry>;
};

let battlegroundLocaleCache: BgLocaleMap | null = null;
let battlegroundSpellLocaleCache: BgLocaleMap | null = null;
let battlegroundTrinketLocaleCache: BgLocaleMap | null = null;

function stripBattlegroundHtml(value: any): string {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[x]/gi, '')
    .replace(/\$\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeBgLocaleMap(cards: BgCardLocaleEntry[]): BgLocaleMap {
  const byId = new Map<string, BgCardLocaleEntry>();
  const byDbfId = new Map<string, BgCardLocaleEntry>();
  const byCardId = new Map<string, BgCardLocaleEntry>();
  const byStatsKey = new Map<string, BgCardLocaleEntry>();

  for (const card of cards) {
    if (!card) continue;
    const normalized = { ...card, text: stripBattlegroundHtml(card.text) };
    if (card.id !== undefined && card.id !== null) byId.set(String(card.id), normalized);
    if (card.dbfId !== undefined && card.dbfId !== null) byDbfId.set(String(card.dbfId), normalized);
    if (card.cardId) byCardId.set(String(card.cardId), normalized);
    const statsKey = bgTrinketStatsKey(card);
    if (statsKey) byStatsKey.set(statsKey, normalized);
  }

  return {
    expiresAt: Date.now() + 6 * 60 * 60 * 1000,
    byId,
    byDbfId,
    byCardId,
    byStatsKey,
  };
}

function bgTrinketStatsKey(value: any): string {
  const id = String(value?.cardId || value?.trinket_id || value?.id || '').trim().toLowerCase();
  const size = String(value?.size || value?.trinket_tier || value?.type || '').trim().toLowerCase();
  const normalizeMetric = (metric: any) => {
    const raw = String(metric ?? '').trim().replace('%', '');
    if (!raw) return '';
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? String(parsed) : raw.toLowerCase();
  };
  const avg = normalizeMetric(value?.avgPlacement ?? value?.avg_placement);
  const pick = normalizeMetric(value?.pickRate ?? value?.pick_rate);
  if (!id || !size || !avg || !pick) return '';
  return `${id}|${size}|${avg}|${pick}`;
}

async function loadBattlegroundLocaleMap() {
  const now = Date.now();
  if (battlegroundLocaleCache && battlegroundLocaleCache.expiresAt > now) {
    return battlegroundLocaleCache;
  }

  const payload = await fetchJsonWithTimeout('http://127.0.0.1:3107/api/battlegrounds-library?locale=ruRU', {}, 20_000);
  const cards = Array.isArray(payload?.cards) ? payload.cards : [];
  battlegroundLocaleCache = makeBgLocaleMap(cards);
  return battlegroundLocaleCache;
}

async function loadBattlegroundSpellLocaleMap() {
  const now = Date.now();
  if (battlegroundSpellLocaleCache && battlegroundSpellLocaleCache.expiresAt > now) {
    return battlegroundSpellLocaleCache;
  }

  const payload = await fetchJsonWithTimeout('http://127.0.0.1:3107/api/battlegrounds-spells?locale=ruRU&pageSize=500', {}, 20_000);
  const cards = Array.isArray(payload?.cards) ? payload.cards : [];
  battlegroundSpellLocaleCache = makeBgLocaleMap(cards.map((card: any) => ({
    ...card,
    dbfId: card.id,
    techLevel: card.tier,
  })));
  return battlegroundSpellLocaleCache;
}

async function loadBattlegroundTrinketLocaleMap() {
  const now = Date.now();
  if (battlegroundTrinketLocaleCache && battlegroundTrinketLocaleCache.expiresAt > now) {
    return battlegroundTrinketLocaleCache;
  }

  const payload = await fetchJsonWithTimeout('http://127.0.0.1:3107/api/battlegrounds-accessories?locale=ruRU&pageSize=500', {}, 20_000);
  const cards = Array.isArray(payload?.accessories) ? payload.accessories : [];
  battlegroundTrinketLocaleCache = makeBgLocaleMap(cards);
  return battlegroundTrinketLocaleCache;
}

function findBattlegroundLocale(value: any, locales: BgLocaleMap[]): BgCardLocaleEntry | null {
  for (const locale of locales) {
    const statsKey = bgTrinketStatsKey(value);
    const localized = (statsKey ? locale.byStatsKey.get(statsKey) : null)
      || locale.byId.get(String(value.id || ''))
      || locale.byDbfId.get(String(value.dbfId || ''))
      || locale.byCardId.get(String(value.cardId || value.id || ''));
    if (localized) return localized;
  }
  return null;
}

function hasCyrillic(value: string): boolean {
  return /[А-Яа-яЁё]/.test(value);
}

function applyBattlegroundLocale(value: any, locales: BgLocaleMap[]): any {
  if (Array.isArray(value)) return value.map(item => applyBattlegroundLocale(item, locales));
  if (!value || typeof value !== 'object') return value;

  const localized = findBattlegroundLocale(value, locales);
  const enriched: Record<string, any> = {};

  for (const [key, item] of Object.entries(value)) {
    enriched[key] = applyBattlegroundLocale(item, locales);
  }

  const localizedName = localized?.name || localized?.localizedName || localized?.baseName || '';
  if (localizedName && hasCyrillic(localizedName)) {
    enriched.ruName = localizedName;
    enriched.localizedName = localizedName;
  } else if (enriched.localizedName && hasCyrillic(String(enriched.localizedName))) {
    enriched.ruName = enriched.localizedName;
  }
  const localizedText = stripBattlegroundHtml(localized?.text);
  if (localizedText && hasCyrillic(localizedText)) enriched.ruText = localizedText;
  if (localized?.race && !enriched.race) enriched.race = localized.race;
  if (localized?.raceRu && !enriched.raceRu) enriched.raceRu = localized.raceRu;
  if (localized?.races && !enriched.races) enriched.races = localized.races;
  if (localized?.techLevel && !enriched.tavernTier) enriched.tavernTier = localized.techLevel;
  if (localized?.artUrl && !enriched.image256) enriched.image256 = localized.artUrl;

  return enriched;
}

async function proxyLegacyBattlegroundEndpoint(req: express.Request, res: express.Response, upstreamPath: string) {
  try {
    const upstreamUrl = new URL(upstreamPath, 'http://127.0.0.1:3107');
    for (const [key, value] of Object.entries(req.query)) {
      if (Array.isArray(value)) {
        value.forEach(item => upstreamUrl.searchParams.append(key, String(item)));
      } else if (value !== undefined) {
        upstreamUrl.searchParams.set(key, String(value));
      }
    }

    const upstream = await fetch(upstreamUrl, { signal: AbortSignal.timeout(20_000) });
    const body = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', contentType.includes('image/')
      ? 'public, max-age=2592000, immutable'
      : 'public, max-age=300, stale-while-revalidate=900');
    res.send(body);
  } catch (err: any) {
    console.error('[bg legacy proxy] failed:', upstreamPath, err?.message ?? err);
    res.status(502).json({ error: 'BG legacy upstream unavailable' });
  }
}

app.get('/api/battlegrounds-library', (req, res) => proxyLegacyBattlegroundEndpoint(req, res, '/api/battlegrounds-library'));
app.get('/api/battlegrounds-spells', (req, res) => proxyLegacyBattlegroundEndpoint(req, res, '/api/battlegrounds-spells'));
app.get('/api/battlegrounds-card-names', (req, res) => proxyLegacyBattlegroundEndpoint(req, res, '/api/battlegrounds-card-names'));
app.get('/api/bg-comps', (req, res) => proxyLegacyBattlegroundEndpoint(req, res, '/api/bg-comps'));
app.get('/api/card-art', (req, res) => proxyLegacyBattlegroundEndpoint(req, res, '/api/card-art'));
app.get('/api/remote-image', (req, res) => proxyLegacyBattlegroundEndpoint(req, res, '/api/remote-image'));

function bgHeroLookupKey(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function bgHeroDetailKeys(hero: any): string[] {
  return [
    hero?.dbf,
    hero?.hero_id,
    hero?.card_id,
    hero?.name?.ru,
    hero?.name?.en,
  ].map(bgHeroLookupKey).filter(Boolean);
}

function bgHsReplayHeroKeys(hero: any): string[] {
  return [
    hero?.dbfId,
    hero?.id,
    hero?.hero,
    hero?.name,
  ].map(bgHeroLookupKey).filter(Boolean);
}

function bgCompactHeroRelatedCard(card: any): any {
  if (!card || typeof card !== 'object') return null;
  return {
    dbf: bgNumberOrNull(card.dbf),
    name: card.name || '',
    text: stripBattlegroundHtml(card.text),
    image: card.image || null,
    image_gold: card.image_gold || card.golden?.image || null,
    crop_image: card.crop_image || null,
  };
}

function bgLibraryLocalizedName(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.ru || value.en || value.name_ru || value.name || '';
}

function bgCompactLibraryCard(card: any): any {
  if (!card || typeof card !== 'object') return null;
  const images = card.images || {};
  const creatureType = card.creature_type || {};
  return {
    dbf: bgNumberOrNull(card.dbf),
    card_id: card.card_id || card.id || null,
    name: bgLibraryLocalizedName(card.name),
    text: stripBattlegroundHtml(card.text_ru || card.text),
    image: images.framed || images.card || card.image || null,
    image_gold: images.golden || card.image_gold || card.golden?.image || null,
    crop_image: images.art || card.crop_image || null,
    tavern_tier: bgNumberOrNull(card.tavern_tier || card.techLevel || card.tech_level),
    creature_type: creatureType.slug || card.race || null,
    creature_type_name: creatureType.name_ru || card.raceRu || null,
    card_type: card.card_type?.slug || card.card_type || card.type || null,
  };
}

function bgCompactHeroLibraryDetail(hero: any): any {
  if (!hero || typeof hero !== 'object') return null;
  const buddyCard = hero?.buddy?.card || null;
  const heroPowerCard = hero?.hero_power?.card || null;
  const compactBuddy = bgCompactHeroRelatedCard(buddyCard);
  const skins = (hero?.wiki?.hero_skins || [])
    .flatMap((group: any) => Array.isArray(group?.cards) ? group.cards : [])
    .map((skin: any) => ({
      card_id: skin.card_id || null,
      title: String(skin.title || '').replace(/^Battlegrounds\//, ''),
      image: skin.image_url || null,
      url: skin.url || null,
    }))
    .filter((skin: any) => skin.image);
  const goldenBuddy = buddyCard?.golden
    ? {
        dbf: bgNumberOrNull(buddyCard.golden.dbf),
        card_id: buddyCard.golden.card_id || null,
        name: buddyCard.golden.name || compactBuddy?.name || '',
        text: stripBattlegroundHtml(buddyCard.golden.text || ''),
        image: buddyCard.golden.image || buddyCard.image_gold || null,
      }
    : null;
  return {
    dbf: bgNumberOrNull(hero.dbf),
    card_id: hero.card_id || null,
    hero_id: hero.hero_id || null,
    name: hero.name || null,
    health: bgNumberOrNull(hero.health),
    armor: hero.armor ?? null,
    race: hero.race || null,
    images: hero.images || null,
    hero_power: {
      dbf: bgNumberOrNull(hero?.hero_power?.dbf),
      card: bgCompactHeroRelatedCard(heroPowerCard),
    },
    buddy: {
      dbf: bgNumberOrNull(hero?.buddy?.dbf),
      card: compactBuddy,
      golden: goldenBuddy,
    },
    skins,
    updated_at: hero.updated_at || null,
  };
}

function enrichBgHeroesWithLibraryData(payload: any, libraryHeroes: any[]): any {
  const byKey = new Map<string, any>();
  for (const hero of libraryHeroes) {
    for (const key of bgHeroDetailKeys(hero)) {
      if (!byKey.has(key)) byKey.set(key, hero);
    }
  }

  return {
    ...payload,
    view: {
      ...(payload?.view || {}),
      heroes: (payload?.view?.heroes || []).map((hero: any) => {
        const detail = bgHsReplayHeroKeys(hero).map(key => byKey.get(key)).find(Boolean);
        if (!detail) return hero;
        return {
          ...hero,
          hero_power: {
            dbf: bgNumberOrNull(detail?.hero_power?.dbf),
            card: bgCompactHeroRelatedCard(detail?.hero_power?.card),
          },
        };
      }),
    },
  };
}

app.get('/api/bg/heroes', async (req, res) => {
  try {
    const payload = await fetchJsonWithTimeout(BG_HEROES_API_URL, {
      headers: { Accept: 'application/json' },
    }, 20_000);
    if (!payload?.ok || !Array.isArray(payload?.view?.heroes)) {
      return res.status(502).json({ error: 'BG heroes source returned an invalid payload' });
    }

    const libraryPayload = await fetchJsonWithTimeout(`${BG_LIBRARY_API_BASE}/heroes?per_page=200`, {
      headers: { Accept: 'application/json' },
    }, 20_000).catch(() => null);
    const libraryHeroes = Array.isArray(libraryPayload?.data) ? libraryPayload.data : [];
    const data = libraryHeroes.length ? enrichBgHeroesWithLibraryData(payload, libraryHeroes) : payload;

    const libraryUpdated = libraryHeroes.map((hero: any) => hero?.updated_at || hero?.card_id || hero?.dbf).join('|');
    const etagBase = `${payload.fetched_at || Date.now()}-${payload.view.heroes.length}-${libraryHeroes.length}-${libraryUpdated}`;
    const etag = `"bg-heroes-${createHash('sha1').update(etagBase).digest('hex').slice(0, 16)}"`;
    return sendJsonCached(req, res, data, etag, 'public, max-age=300, stale-while-revalidate=900');
  } catch (err: any) {
    return res.status(502).json({ error: err?.message ?? 'BG heroes unavailable' });
  }
});

app.get('/api/bg/heroes/:dbfId/details', async (req, res) => {
  const dbfId = Number(req.params.dbfId);
  if (!Number.isFinite(dbfId) || dbfId <= 0) {
    return res.status(400).json({ error: 'Invalid hero dbfId' });
  }

  try {
    const [stats, libraryPayload] = await Promise.all([
      fetchJsonWithTimeout(`${BG_HERO_DETAILS_API_BASE}/${dbfId}`, {
        headers: { Accept: 'application/json' },
      }, 20_000),
      fetchJsonWithTimeout(`${BG_LIBRARY_API_BASE}/heroes?per_page=200`, {
        headers: { Accept: 'application/json' },
      }, 20_000).catch(() => null),
    ]);

    const libraryHeroes = Array.isArray(libraryPayload?.data) ? libraryPayload.data : [];
    const libraryHero = libraryHeroes.find((hero: any) => Number(hero?.dbf) === dbfId)
      || libraryHeroes.find((hero: any) => bgHeroLookupKey(hero?.name?.en) === bgHeroLookupKey(stats?.hero?.hero))
      || null;

    const cardDbfs = new Set<number>();
    const collectCard = (card: any) => {
      const value = Number(card?.dbfId || card?.dbf || card?.minion_dbf_id);
      if (Number.isFinite(value) && value > 0) cardDbfs.add(value);
    };
    (stats?.best_composition?.lineup || []).forEach(collectCard);
    (stats?.best_composition?.final_form_minions || []).slice(0, 16).forEach(collectCard);
    (stats?.hero?.key_minions_top3 || []).forEach(collectCard);

    const cards: Record<string, any> = {};
    await Promise.all(Array.from(cardDbfs).map(async cardDbf => {
      try {
        const payload = await fetchJsonWithTimeout(`${BG_LIBRARY_API_BASE}/cards/by-dbf/${cardDbf}`, {
          headers: { Accept: 'application/json' },
        }, 12_000);
        const compact = bgCompactLibraryCard(payload?.data || payload);
        if (compact) cards[String(cardDbf)] = compact;
      } catch {
        // Individual card art is non-critical; stats still render.
      }
    }));

    const etagBase = `${dbfId}-${stats?.as_of ? JSON.stringify(stats.as_of) : ''}-${libraryHero?.updated_at || ''}-${Object.keys(cards).join('|')}`;
    const etag = `"bg-hero-detail-${createHash('sha1').update(etagBase).digest('hex').slice(0, 16)}"`;
    return sendJsonCached(req, res, {
      ok: true,
      stats,
      libraryHero: bgCompactHeroLibraryDetail(libraryHero),
      cards,
      fetched_at: new Date().toISOString(),
    }, etag, 'public, max-age=300, stale-while-revalidate=900');
  } catch (err: any) {
    return res.status(502).json({ error: err?.message ?? 'BG hero detail unavailable' });
  }
});

function bgBaseCardId(cardId: string): string {
  return String(cardId || '').replace(/_Gt$/, 't').replace(/_G$/, '');
}

function bgIsGoldenCardId(cardId: string): boolean {
  return /_G($|t$)/.test(String(cardId || ''));
}

function bgNumberOrNull(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function bgAssetUrl(cardId: string, folder: 'cards' | 'framed' | 'golden' | 'art'): string | null {
  if (!cardId) return null;
  const ext = folder === 'art' ? 'jpg' : 'png';
  const filePath = join(BG_CARD_ASSET_ROOT, folder, `${cardId}.${ext}`);
  if (!existsSync(filePath)) return null;
  const version = encodeURIComponent(new Date(statSync(filePath).mtime).toISOString().replace('T', ' ').slice(0, 19));
  return `${BG_CARD_ASSET_PUBLIC_BASE}/${folder}/${encodeURIComponent(cardId)}.${ext}?v=${version}`;
}

function bgLibraryAssetIds(rawId: string, baseId: string): string[] {
  const ids: string[] = [];
  if (rawId) ids.push(rawId);
  if (baseId && baseId !== rawId) ids.push(baseId);
  return ids;
}

function bgFirstAssetUrl(ids: string[], folder: 'cards' | 'framed' | 'golden' | 'art'): string | null {
  for (const id of ids) {
    const url = bgAssetUrl(id, folder);
    if (url) return url;
  }
  return null;
}

function enrichBgLibraryCard(card: any): any {
  if (!card || typeof card !== 'object') return card;
  const rawId = String(card.card_id || '');
  const baseId = bgBaseCardId(rawId);
  const ids = bgLibraryAssetIds(rawId, baseId);
  const localCard = bgFirstAssetUrl(ids, 'cards');
  const localFramed = bgFirstAssetUrl(ids, 'framed');
  const localGolden = bgFirstAssetUrl(ids, 'golden');
  const localArt = bgFirstAssetUrl(ids, 'art');

  return {
    ...card,
    images: {
      ...(card.images || {}),
      ...(localCard ? { card: localCard } : {}),
      ...(localFramed ? { framed: localFramed } : {}),
      ...(localGolden ? { golden: localGolden } : {}),
      ...(localArt ? { art: localArt } : {}),
    },
    asset_status: {
      ...(card.asset_status || {}),
      base_card_id: baseId || rawId,
      local_card: Boolean(localCard),
      local_framed: Boolean(localFramed),
      local_golden: Boolean(localGolden),
      local_art: Boolean(localArt),
    },
  };
}

function annotateBgLibraryCardFamilies(cards: any[]): any[] {
  const groups = new Map<string, any[]>();
  for (const card of cards) {
    const baseId = String(card?.asset_status?.base_card_id || bgBaseCardId(card?.card_id || ''));
    if (!baseId) continue;
    const group = groups.get(baseId) || [];
    group.push(card);
    groups.set(baseId, group);
  }

  for (const group of groups.values()) {
    const baseCard = group.find(card => !bgIsGoldenCardId(String(card?.card_id || '')));
    const goldenCard = group.find(card => bgIsGoldenCardId(String(card?.card_id || '')));
    if (!baseCard || !goldenCard) continue;

    const baseTier = bgNumberOrNull(baseCard.tavern_tier);
    const goldenTier = bgNumberOrNull(goldenCard.tavern_tier);
    const mismatch = baseTier !== null && goldenTier !== null && baseTier !== goldenTier;
    for (const card of group) {
      card.asset_status = {
        ...(card.asset_status || {}),
        golden_variant_tavern_tier: goldenTier,
        golden_tier_mismatch: mismatch,
      };
    }
  }

  return cards;
}

app.get('/api/bg/library/meta', async (req, res) => {
  try {
    const payload = await fetchJsonWithTimeout(`${BG_LIBRARY_API_BASE}/meta`, {
      headers: { Accept: 'application/json' },
    }, 20_000);
    const etag = `"bg-library-meta-${createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 16)}"`;
    return sendJsonCached(req, res, payload, etag, 'public, max-age=300, stale-while-revalidate=900');
  } catch (err: any) {
    return res.status(502).json({ error: err?.message ?? 'BG library meta unavailable' });
  }
});

app.get('/api/bg/library/cards', async (req, res) => {
  const cardType = String(req.query.card_type || 'minion').toLowerCase();
  const inPool = String(req.query.in_pool ?? '1');
  const allowedTypes = new Set(['minion', 'spell', 'all']);
  const allowedPool = new Set(['0', '1', 'all']);
  if (!allowedTypes.has(cardType)) return res.status(400).json({ error: 'Unknown BG card type' });
  if (!allowedPool.has(inPool)) return res.status(400).json({ error: 'Unknown BG pool filter' });

  try {
    const allCards: any[] = [];
    let page = 1;
    let total = 0;
    let totalPages = 1;
    do {
      const params = new URLSearchParams({ per_page: '200', page: String(page) });
      if (cardType !== 'all') params.set('card_type', cardType);
      if (inPool !== 'all') params.set('in_pool', inPool);
      for (const name of ['q', 'tier', 'creature_type', 'mechanic', 'mechanics']) {
        const value = req.query[name];
        if (typeof value === 'string' && value.trim()) params.set(name, value.trim());
      }
      const payload = await fetchJsonWithTimeout(`${BG_LIBRARY_API_BASE}/cards?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      }, 20_000);
      const cards = Array.isArray(payload?.data) ? payload.data : [];
      allCards.push(...cards.map(enrichBgLibraryCard));
      total = Number(payload?.pagination?.total || allCards.length);
      totalPages = Math.min(30, Number(payload?.pagination?.total_pages || page));
      page += 1;
    } while (page <= totalPages);

    const data = {
      data: annotateBgLibraryCardFamilies(allCards),
      pagination: {
        page: 1,
        per_page: allCards.length,
        total,
        total_pages: 1,
        has_next: false,
        has_prev: false,
      },
      filters: { card_type: cardType, in_pool: inPool },
    };
    const etagBase = `${cardType}-${inPool}-${total}-${allCards.map(card => card.updated_at || card.card_id || card.dbf).join('|')}`;
    const etag = `"bg-library-cards-${createHash('sha1').update(etagBase).digest('hex').slice(0, 16)}"`;
    return sendJsonCached(req, res, data, etag, 'public, max-age=300, stale-while-revalidate=900');
  } catch (err: any) {
    return res.status(502).json({ error: err?.message ?? 'BG library cards unavailable' });
  }
});

app.get('/api/bg/library/cards/by-dbf/:dbfId', async (req, res) => {
  const dbfId = Number(req.params.dbfId);
  if (!Number.isFinite(dbfId)) return res.status(400).json({ error: 'Invalid dbf id' });
  try {
    const payload = await fetchJsonWithTimeout(`${BG_LIBRARY_API_BASE}/cards/by-dbf/${dbfId}`, {
      headers: { Accept: 'application/json' },
    }, 20_000);
    const card = enrichBgLibraryCard(payload?.data || payload);
    const etag = `"bg-library-card-${createHash('sha1').update(JSON.stringify(card)).digest('hex').slice(0, 16)}"`;
    return sendJsonCached(req, res, card, etag, 'public, max-age=300, stale-while-revalidate=900');
  } catch (err: any) {
    return res.status(502).json({ error: err?.message ?? 'BG library card unavailable' });
  }
});

app.get('/api/bg/library/minion-stats', async (req, res) => {
  try {
    const payload = await fetchJsonWithTimeout(`${DATASET_API_ORIGIN}/api/db/bg/minions?limit=500`, {
      headers: { Accept: 'application/json' },
    }, 20_000);
    const etagBase = `${payload?.latest_run?.completed_at || Date.now()}-${payload?.total || 0}`;
    const etag = `"bg-minion-stats-${createHash('sha1').update(etagBase).digest('hex').slice(0, 16)}"`;
    return sendJsonCached(req, res, payload, etag, 'public, max-age=300, stale-while-revalidate=900');
  } catch (err: any) {
    return res.status(502).json({ error: err?.message ?? 'BG minion stats unavailable' });
  }
});

app.get('/api/bg/library/minions/:dbfId', async (req, res) => {
  const dbfId = Number(req.params.dbfId);
  if (!Number.isFinite(dbfId)) return res.status(400).json({ error: 'Invalid dbf id' });
  try {
    const payload = await fetchJsonWithTimeout(`${DATASET_API_ORIGIN}/api/db/bg/minions/${dbfId}`, {
      headers: { Accept: 'application/json' },
    }, 20_000);
    const etag = `"bg-minion-detail-${createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 16)}"`;
    return sendJsonCached(req, res, payload, etag, 'public, max-age=300, stale-while-revalidate=900');
  } catch (err: any) {
    return res.status(502).json({ error: err?.message ?? 'BG minion detail unavailable' });
  }
});

app.get('/api/bg/library/minions/:dbfId/history', async (req, res) => {
  const dbfId = Number(req.params.dbfId);
  if (!Number.isFinite(dbfId)) return res.status(400).json({ error: 'Invalid dbf id' });
  try {
    const payload = await fetchJsonWithTimeout(`${DATASET_API_ORIGIN}/api/db/bg/minions/${dbfId}/history`, {
      headers: { Accept: 'application/json' },
    }, 20_000);
    const etag = `"bg-minion-history-${createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 16)}"`;
    return sendJsonCached(req, res, payload, etag, 'public, max-age=300, stale-while-revalidate=900');
  } catch (err: any) {
    return res.status(502).json({ error: err?.message ?? 'BG minion history unavailable' });
  }
});

app.get('/api/bg/library/spell-stats', async (req, res) => {
  try {
    const payload = await fetchJsonWithTimeout(BG_FIRESTONE_SPELLS_API_URL, {
      headers: { Accept: 'application/json' },
    }, 20_000);
    if (!payload?.ok || !payload?.view?.tiers) {
      return res.status(502).json({ error: 'Firestone spell source returned an invalid payload' });
    }
    const etagBase = `${payload.fetched_at || Date.now()}-${payload.view.total_data_points || 0}`;
    const etag = `"bg-spell-stats-${createHash('sha1').update(etagBase).digest('hex').slice(0, 16)}"`;
    return sendJsonCached(req, res, payload, etag, 'public, max-age=300, stale-while-revalidate=900');
  } catch (err: any) {
    return res.status(502).json({ error: err?.message ?? 'BG spell stats unavailable' });
  }
});

app.get('/api/bg/tier-lists', async (req, res) => {
  const allowedLists = new Set(['minions', 'strategies', 'spells', 'trinkets', 'all']);
  const allowedTiers = new Set(['S', 'A', 'B', 'C', 'D']);
  const list = String(req.query.list || 'all').toLowerCase();
  const tier = String(req.query.tier || '').toUpperCase();
  const source = String(req.query.source || '').toLowerCase();
  if (!allowedLists.has(list)) return res.status(400).json({ error: 'Unknown BG tier list' });
  if (tier && !allowedTiers.has(tier)) return res.status(400).json({ error: 'Unknown BG tier' });

  const params = new URLSearchParams({ list });
  if (tier) params.set('tier', tier);
  if (source === 'firestone' || source === 'hsreplay') params.set('source', source);

  try {
    const [data, minionLocale, spellLocale, trinketLocale] = await Promise.all([
      fetchJsonWithTimeout(`http://127.0.0.1:3107/api/tier-lists?${params.toString()}`, {}, 20_000),
      loadBattlegroundLocaleMap().catch(() => null),
      (list === 'spells' || list === 'all') ? loadBattlegroundSpellLocaleMap().catch(() => null) : Promise.resolve(null),
      (list === 'trinkets' || list === 'all') ? loadBattlegroundTrinketLocaleMap().catch(() => null) : Promise.resolve(null),
    ]);
    const locales = [minionLocale, spellLocale, trinketLocale].filter(Boolean) as BgLocaleMap[];
    const normalized = normalizeBattlegroundAssetUrls(locales.length ? applyBattlegroundLocale(data, locales) : data);
    const etagBase = `${normalized.generatedAt || Date.now()}-${list}-${tier || 'all'}-${source || 'default'}`;
    const etag = `"bg-tier-lists-${createHash('sha1').update(etagBase).digest('hex').slice(0, 16)}"`;
    return sendJsonCached(req, res, normalized, etag, 'public, max-age=300, stale-while-revalidate=900');
  } catch (err: any) {
    return res.status(502).json({ error: err?.message ?? 'BG tier lists unavailable' });
  }
});

app.get('/api/status', (req, res) => {
  const wr = loadDataCached('winrates.json');
  const tl = loadDataCached('tierlist.json');
  const data = {
    winrates: { updatedAt: wr?.data?.updatedAt ?? null, source: wr?.data?.source ?? null },
    tierlist: { updatedAt: tl?.data?.updatedAt ?? null, source: tl?.data?.source ?? null },
    nextScrape: 'каждые 6 часов',
  };
  const etag = `"status-${wr?.mtime?.toString(36) ?? '0'}-${tl?.mtime?.toString(36) ?? '0'}"`;
  return sendJsonCached(req, res, data, etag, CACHE_5M);
});

let isScraping = false;

app.post('/api/scrape', async (req, res) => {
  if (isScraping) {
    return res.status(409).json({ message: 'Парсинг уже запущен' });
  }
  isScraping = true;
  res.json({ message: 'Парсинг запущен' });
  try {
    const result = await scrapeAll();
    invalidateDataCache();
    console.log('[Server] Manual scrape result:', result);
  } finally {
    isScraping = false;
  }
});

// ─── IP check endpoint (mirrors api/check-ip.js for Vercel) ──────────────────

app.get('/api/check-ip', (req, res) => {
  const user = userAuth(req);
  res.json({
    allowed: isAdminUser(user),
    id: user?.id ?? null,
    ip: getClientIp(req),
  });
});

app.post('/api/auth/register', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  const name = String(req.body?.name ?? '').trim() || 'Пользователь Манакоста';
  const country = String(req.body?.country ?? '').trim();
  const newsletterOptIn = Boolean(req.body?.newsletterOptIn);
  if (!isRealEmail(email)) return res.status(400).json({ error: 'Укажите корректную почту' });
  if (password.length < 8) return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов' });
  if (!country) return res.status(400).json({ error: 'Укажите страну' });
  if (!newsletterOptIn) return res.status(400).json({ error: 'Подтвердите согласие на получение рассылки' });

  const store = loadAuthStore();
  if (store.users.some(item => item.email === email)) {
    return res.status(409).json({ error: 'Пользователь с такой почтой уже есть' });
  }

  const now = new Date().toISOString();
  store.users.push({
    id: `user_${sha256(email).slice(0, 12)}`,
    email,
    name,
    role: 'user',
    country,
    newsletterOptIn,
    avatarInitials: name.slice(0, 2).toUpperCase(),
    passwordHash: hashSecret(password),
    createdAt: now,
    updatedAt: now,
  });

  const code = randomInt(100000, 1000000).toString();
  store.pendingCodes = store.pendingCodes.filter(item => item.email !== email && item.expiresAt > Date.now());
  store.pendingCodes.push({
    email,
    codeHash: sha256(code),
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    attempts: 0,
  });
  saveAuthStore(store);

  try {
    await sendAuthCodeEmail(email, code);
    res.json({ success: true, email, message: 'Аккаунт создан. Код отправлен на почту' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Аккаунт создан, но код не удалось отправить' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  if (!isRealEmail(email)) return res.status(400).json({ error: 'Укажите корректную почту' });
  const store = loadAuthStore();
  const user = store.users.find(item => item.email === email);
  if (!user || !password || !verifySecret(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Неверная почта или пароль' });
  }

  const code = randomInt(100000, 1000000).toString();
  store.pendingCodes = store.pendingCodes.filter(item => item.email !== email && item.expiresAt > Date.now());
  store.pendingCodes.push({
    email,
    codeHash: sha256(code),
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    attempts: 0,
  });
  saveAuthStore(store);

  try {
    await sendAuthCodeEmail(email, code);
    res.json({ success: true, email, message: 'Код отправлен на почту' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Не удалось отправить код' });
  }
});

app.post('/api/auth/password-reset/request', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!isRealEmail(email)) return res.status(400).json({ error: 'Укажите корректную почту' });
  const store = loadAuthStore();
  const user = store.users.find(item => item.email === email);

  if (user) {
    const code = randomInt(100000, 1000000).toString();
    store.pendingCodes = store.pendingCodes.filter(item => item.email !== email && item.expiresAt > Date.now());
    store.pendingCodes.push({
      email,
      codeHash: sha256(code),
      expiresAt: Date.now() + AUTH_CODE_TTL_MS,
      attempts: 0,
    });
    saveAuthStore(store);

    try {
      await sendAuthCodeEmail(email, code);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Не удалось отправить код' });
    }
  }

  res.json({ success: true, email, message: 'Если аккаунт существует, код отправлен на почту' });
});

app.post('/api/auth/password-reset/confirm', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code ?? '').replace(/\D/g, '');
  const password = String(req.body?.password ?? '');
  if (!isRealEmail(email)) return res.status(400).json({ error: 'Укажите корректную почту' });
  if (password.length < 8) return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов' });

  const store = loadAuthStore();
  const user = store.users.find(item => item.email === email);
  const pending = store.pendingCodes.find(item => item.email === email && item.expiresAt > Date.now());
  if (!user || !pending) return res.status(401).json({ error: 'Код устарел. Запросите новый.' });

  pending.attempts += 1;
  if (pending.attempts > 5 || pending.codeHash !== sha256(code)) {
    saveAuthStore(store);
    return res.status(401).json({ error: 'Неверный код' });
  }

  user.passwordHash = hashSecret(password);
  user.updatedAt = new Date().toISOString();
  store.pendingCodes = store.pendingCodes.filter(item => item.email !== email);
  store.sessions = store.sessions.filter(item => item.email !== email);
  saveAuthStore(store);
  res.json({ success: true, message: 'Пароль обновлен' });
});

app.get('/api/auth/telegram/config', (_req, res) => {
  const enabled = telegramAuthEnabled();
  res.json({
    enabled,
    mode: telegramOidcEnabled() ? 'oidc' : 'legacy-widget',
    botUsername: enabled ? TELEGRAM_AUTH_BOT_USERNAME : '',
    authUrl: enabled ? `${APP_URL}/api/auth/telegram/start` : '',
    callbackUrl: enabled ? `${APP_URL}/api/auth/telegram/callback` : '',
  });
});

function upsertTelegramUser(payload: Record<string, unknown>) {
  const telegramId = String(payload.id ?? '').replace(/\D/g, '');
  const telegramOidcSub = String(payload.oidc_sub ?? '').trim();
  if (!telegramId && !telegramOidcSub) throw new Error('Telegram не передал ID пользователя');

  const khaProfile = readKhaVipProfile(telegramId);
  const verifiedBoostyEmail = khaVerifiedEmail(khaProfile);
  const firstName = String(payload.first_name ?? '').trim();
  const lastName = String(payload.last_name ?? '').trim();
  const username = String(payload.username ?? '').trim().replace(/^@/, '');
  const photoUrl = String(payload.photo_url ?? '').trim();
  const displayName = [firstName, lastName].filter(Boolean).join(' ').trim()
    || (username ? `@${username}` : `Telegram ${telegramId || sha256(telegramOidcSub).slice(0, 10)}`);
  const email = verifiedBoostyEmail || (telegramId
    ? `telegram_${telegramId}@telegram.local`
    : `telegram_oidc_${sha256(telegramOidcSub).slice(0, 16)}@telegram.local`);
  const now = new Date().toISOString();
  const store = loadAuthStore();
  const oidcIdentity = telegramOidcSub
    ? dbGet<{ user_id?: string }>("SELECT user_id FROM identities WHERE provider = 'telegram_oidc' AND provider_user_id = ?", telegramOidcSub)
    : null;
  const oidcUser = oidcIdentity?.user_id ? store.users.find(item => item.id === oidcIdentity.user_id) : undefined;
  const telegramUser = telegramId ? store.users.find(item => item.telegramId === telegramId) : undefined;
  const usernameTelegramUser = username
    ? store.users.find(item => String(item.telegramUsername || '').toLowerCase() === username.toLowerCase())
    : undefined;
  const emailUser = store.users.find(item => item.email === email);
  let user = oidcUser ?? telegramUser ?? usernameTelegramUser ?? emailUser;

  if (telegramUser && emailUser && telegramUser.id !== emailUser.id) {
    user = mergeAuthUsers(store, telegramUser, emailUser, {
      telegramId,
      telegramUsername: username,
      photoUrl: photoUrl || telegramUser.photoUrl,
    });
  } else if (!telegramUser && emailUser) {
    user = emailUser;
    user.telegramId = telegramId || user.telegramId;
    user.telegramUsername = username;
    user.photoUrl = photoUrl || user.photoUrl;
    user.updatedAt = now;
  } else if (telegramUser && verifiedBoostyEmail && telegramUser.email !== verifiedBoostyEmail) {
    telegramUser.email = verifiedBoostyEmail;
    telegramUser.updatedAt = now;
    user = telegramUser;
  }

  if (!user) {
    user = {
      id: `tg_${sha256(telegramId || telegramOidcSub).slice(0, 12)}`,
      email,
      name: displayName,
      role: 'user',
      country: '',
      newsletterOptIn: false,
      avatarInitials: displayName.slice(0, 2).toUpperCase(),
      telegramId: telegramId || undefined,
      telegramUsername: username,
      photoUrl,
      passwordHash: hashSecret(randomBytes(24).toString('hex')),
      createdAt: now,
      updatedAt: now,
    };
    store.users.push(user);
  } else {
    user.name = user.name && !user.name.startsWith('Telegram ') ? user.name : displayName;
    user.telegramId = telegramId || user.telegramId;
    user.telegramUsername = username;
    user.photoUrl = photoUrl || user.photoUrl;
    user.updatedAt = now;
  }
  return { store, user, khaProfile };
}

function linkTelegramOidcIdentity(user: AdminUser, claims: Record<string, any>) {
  const oidcSub = String(claims.sub ?? '').trim();
  if (!oidcSub) return;
  const now = new Date().toISOString();
  dbRun(`
    INSERT INTO identities (user_id, provider, provider_user_id, email, username, photo_url, verified_at, created_at, updated_at)
    VALUES (?, 'telegram_oidc', ?, '', ?, ?, ?, ?, ?)
    ON CONFLICT(provider, provider_user_id) DO UPDATE SET
      user_id = excluded.user_id,
      username = excluded.username,
      photo_url = excluded.photo_url,
      updated_at = excluded.updated_at
  `, user.id, oidcSub, String(claims.preferred_username || '').replace(/^@/, ''), String(claims.picture || ''), now, now, now);
}

app.get('/api/auth/telegram/start', async (req, res) => {
  if (!telegramOidcEnabled()) return res.redirect('/?login&telegram=error');
  try {
    const discovery = await telegramOidcDiscovery();
    const state = randomBytes(24).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    const codeVerifier = randomBytes(48).toString('base64url');
    const returnToRaw = String(req.query.returnTo ?? '/?login&telegram=ok');
    const returnTo = returnToRaw.startsWith('/') && !returnToRaw.startsWith('//') ? returnToRaw : '/?login&telegram=ok';
    setTelegramOidcCookie(req, res, {
      state,
      nonce,
      codeVerifier,
      returnTo,
      expiresAt: Date.now() + TELEGRAM_OIDC_STATE_TTL_MS,
    });

    const params = new URLSearchParams({
      client_id: TELEGRAM_OIDC_CLIENT_ID,
      response_type: 'code',
      scope: 'openid profile',
      redirect_uri: `${APP_URL}/api/auth/telegram/callback`,
      state,
      nonce,
      code_challenge: sha256Base64Url(codeVerifier),
      code_challenge_method: 'S256',
    });
    return res.redirect(`${discovery.authorization_endpoint}?${params.toString()}`);
  } catch (err) {
    console.warn('[auth] Telegram OIDC start failed:', err);
    return res.redirect('/?login&telegram=error');
  }
});

app.get('/api/auth/telegram/callback', async (req, res) => {
  if (telegramOidcEnabled() && req.query.code) {
    const oidcState = readTelegramOidcState(req);
    clearTelegramOidcCookie(req, res);
    if (!oidcState || String(req.query.state ?? '') !== oidcState.state) {
      return res.redirect('/?login&telegram=error');
    }
    try {
      const discovery = await telegramOidcDiscovery();
      const tokenParams = new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(req.query.code),
        redirect_uri: `${APP_URL}/api/auth/telegram/callback`,
        client_id: TELEGRAM_OIDC_CLIENT_ID,
        client_secret: TELEGRAM_OIDC_CLIENT_SECRET,
        code_verifier: oidcState.codeVerifier,
      });
      const tokenData = await fetchJsonWithTimeout(discovery.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams,
      });
      const claims = await verifyTelegramOidcIdToken(String(tokenData.id_token || ''), oidcState.nonce);
      const nameParts = String(claims.name || '').trim().split(/\s+/).filter(Boolean);
      const payload: Record<string, unknown> = {
        oidc_sub: String(claims.sub ?? ''),
        first_name: nameParts[0] || String(claims.name || '').trim(),
        last_name: nameParts.slice(1).join(' '),
        username: String(claims.preferred_username || '').replace(/^@/, ''),
        photo_url: String(claims.picture || ''),
      };
      const { store, user, khaProfile } = upsertTelegramUser(payload);
      const token = createAuthSession(store, user);
      saveAuthStore(store);
      linkTelegramOidcIdentity(user, claims);
      applyKhaSubscriptionSnapshot(user, khaProfile);
      setAuthCookie(req, res, token);
      return res.redirect(oidcState.returnTo || '/?login&telegram=ok');
    } catch (err) {
      console.warn('[auth] Telegram OIDC callback failed:', err);
      return res.redirect('/?login&telegram=error');
    }
  }

  const payload = req.query as Record<string, unknown>;
  const verification = verifyTelegramAuthPayload(payload);
  if (verification.ok === false) {
    return res.redirect('/?login&telegram=error');
  }
  try {
    const { store, user, khaProfile } = upsertTelegramUser(payload);
    const token = createAuthSession(store, user);
    saveAuthStore(store);
    applyKhaSubscriptionSnapshot(user, khaProfile);
    setAuthCookie(req, res, token);
    return res.redirect('/?login&telegram=ok');
  } catch (err) {
    console.warn('[auth] Telegram callback failed:', err);
    return res.redirect('/?login&telegram=error');
  }
});

app.post('/api/auth/telegram', (req, res) => {
  const payload = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const verification = verifyTelegramAuthPayload(payload);
  if (verification.ok === false) return res.status(401).json({ error: verification.error });

  let store: AdminAuthStore;
  let user: AdminUser;
  let khaProfile: Record<string, any> | null;
  try {
    ({ store, user, khaProfile } = upsertTelegramUser(payload));
  } catch (err: any) {
    return res.status(400).json({ error: err?.message ?? 'Telegram не передал пользователя' });
  }

  const token = createAuthSession(store, user);
  saveAuthStore(store);
  applyKhaSubscriptionSnapshot(user, khaProfile);
  setAuthCookie(req, res, token);
  res.json({ success: true, token, user: publicUser(user), adminAllowed: isAdminUser(user) });
});

app.post('/api/auth/verify', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code ?? '').replace(/\D/g, '');
  if (!isRealEmail(email)) return res.status(400).json({ error: 'Укажите корректную почту' });
  const store = loadAuthStore();
  const pending = store.pendingCodes.find(item => item.email === email && item.expiresAt > Date.now());
  if (!pending) return res.status(401).json({ error: 'Код устарел. Запросите новый.' });
  pending.attempts += 1;
  if (pending.attempts > 5 || pending.codeHash !== sha256(code)) {
    saveAuthStore(store);
    return res.status(401).json({ error: 'Неверный код' });
  }

  const user = store.users.find(item => item.email === email);
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });

  store.pendingCodes = store.pendingCodes.filter(item => item.email !== email);
  const token = createAuthSession(store, user);
  saveAuthStore(store);
  setAuthCookie(req, res, token);
  res.json({ success: true, token, user: publicUser(user), adminAllowed: isAdminUser(user) });
});

app.get('/api/auth/me', (req, res) => {
  const user = userAuth(req);
  if (!user) return res.status(401).json({ error: 'Требуется вход' });
  res.json({ user: publicUser(user), adminAllowed: isAdminUser(user) });
});

app.patch('/api/auth/profile', (req, res) => {
  const authedUser = userAuth(req);
  if (!authedUser) return res.status(401).json({ error: 'Требуется вход' });
  const store = loadAuthStore();
  const user = store.users.find(item => item.id === authedUser.id);
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });

  if (req.body?.country !== undefined) {
    user.country = String(req.body.country ?? '').trim();
  }
  if (req.body?.newsletterOptIn !== undefined) {
    user.newsletterOptIn = Boolean(req.body.newsletterOptIn);
  }
  user.updatedAt = new Date().toISOString();
  saveAuthStore(store);
  res.json({ success: true, user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = adminTokenFromReq(req);
  if (token) {
    const store = loadAuthStore();
    const tokenHash = sha256(token);
    store.sessions = store.sessions.filter(item => item.tokenHash !== tokenHash);
    saveAuthStore(store);
  }
  clearAuthCookie(req, res);
  res.json({ success: true });
});

app.get('/api/subscription/status', async (req, res) => {
  const user = userAuth(req);
  if (!user) return res.status(401).json({ error: 'Требуется вход' });
  try {
    const status = await refreshSubscriptionForUser(user, false);
    res.json(status);
  } catch (err: any) {
    res.status(500).json(emptySubscriptionStatus(err?.message ?? 'Не удалось проверить подписку'));
  }
});

app.post('/api/subscription/refresh', async (req, res) => {
  const user = userAuth(req);
  if (!user) return res.status(401).json({ error: 'Требуется вход' });
  try {
    const status = await refreshSubscriptionForUser(user, true);
    res.json(status);
  } catch (err: any) {
    res.status(500).json(emptySubscriptionStatus(err?.message ?? 'Не удалось проверить подписку'));
  }
});

app.post('/api/subscription/email/request', async (req, res) => {
  const user = userAuth(req);
  if (!user) return res.status(401).json({ error: 'Требуется вход' });
  const email = normalizeEmail(req.body?.email);
  if (!isRealEmail(email)) return res.status(400).json({ error: 'Укажите реальную почту Boosty' });

  const store = loadAuthStore();
  const authedStoreUser = store.users.find(item => item.id === user.id);
  const existing = store.users.find(item => item.email === email && item.id !== user.id);
  if (existing && !authedStoreUser?.telegramId && !existing.telegramId) {
    return res.status(409).json({ error: 'Эта почта уже привязана к другому профилю' });
  }

  const code = randomInt(100000, 1000000).toString();
  store.pendingCodes = store.pendingCodes.filter(item => item.email !== email && item.expiresAt > Date.now());
  store.pendingCodes.push({
    email,
    codeHash: sha256(code),
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    attempts: 0,
  });
  saveAuthStore(store);

  try {
    await sendAuthCodeEmail(email, code);
    res.json({ success: true, email, message: 'Код подтверждения отправлен на почту' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Не удалось отправить код' });
  }
});

app.post('/api/subscription/email/confirm', async (req, res) => {
  const authedUser = userAuth(req);
  if (!authedUser) return res.status(401).json({ error: 'Требуется вход' });
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code ?? '').replace(/\D/g, '');
  if (!isRealEmail(email)) return res.status(400).json({ error: 'Укажите реальную почту Boosty' });

  const store = loadAuthStore();
  let user = store.users.find(item => item.id === authedUser.id);
  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
  const existing = store.users.find(item => item.email === email && item.id !== user.id);
  if (existing) {
    if (!user.telegramId && !existing.telegramId) {
      return res.status(409).json({ error: 'Эта почта уже привязана к другому профилю' });
    }
    user = mergeAuthUsers(store, user, existing);
  }
  const pending = store.pendingCodes.find(item => item.email === email && item.expiresAt > Date.now());
  if (!pending) return res.status(401).json({ error: 'Код устарел. Запросите новый.' });

  pending.attempts += 1;
  if (pending.attempts > 5 || pending.codeHash !== sha256(code)) {
    saveAuthStore(store);
    return res.status(401).json({ error: 'Неверный код' });
  }

  const oldEmail = user.email;
  user.email = email;
  user.updatedAt = new Date().toISOString();
  store.pendingCodes = store.pendingCodes.filter(item => item.email !== email);
  store.sessions = store.sessions.map(session => session.email === oldEmail ? { ...session, email } : session);
  saveAuthStore(store);
  const status = await refreshSubscriptionForUser(user, true);
  res.json({ success: true, user: publicUser(user), subscription: status });
});

app.get('/api/ecosystem/internal/user', internalApiGuard, (req, res) => {
  const user = resolveUserFromRequest(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(user), subscription: readSubscriptionStatus(user.id) ?? emptySubscriptionStatus() });
});

app.get('/api/ecosystem/internal/subscription', internalApiGuard, async (req, res) => {
  const user = resolveUserFromRequest(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const force = String(req.query.force ?? '') === '1';
  const status = await refreshSubscriptionForUser(user, force);
  res.json({ user: publicUser(user), subscription: status });
});

app.post('/api/ecosystem/internal/subscription', internalApiGuard, async (req, res) => {
  const user = resolveUserFromRequest(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const status = await refreshSubscriptionForUser(user, true);
  res.json({ user: publicUser(user), subscription: status });
});

// ─── Admin API (/api/admin-articles — matches Vercel file api/admin-articles.js) ─

function adminIdGuard(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) {
  const user = userAuth(req);
  if (!user) return res.status(401).json({ error: 'Требуется вход' });
  if (!isAdminUser(user)) return res.status(403).json({ error: 'Доступ запрещён для этого ID' });
  next();
}

app.post('/api/admin-articles', adminIdGuard, async (req, res) => {
  if (!adminAuth(req)) return res.status(401).json({ error: 'Требуется вход' });
  const { article } = req.body ?? {};
  if (!article?.title?.trim()) return res.status(400).json({ error: 'Заголовок обязателен' });
  try {
    const filePath = join(DATA_DIR, 'articles.json');
    const existing: any = loadData('articles.json') ?? { articles: [], updatedAt: null };
    const publishedDate = await resolveArticlePublishedDate(article.url, article.title);
    const newArticle = {
      id:      Date.now().toString(),
      title:   article.title.trim(),
      date:    publishedDate ?? new Date().toISOString().split('T')[0],
      image:   article.image   ?? '',
      excerpt: article.excerpt ?? '',
      tag:     article.tag     ?? '',
      url:     article.url     ?? '#',
    };
    existing.articles.unshift(newArticle);
    existing.updatedAt = new Date().toISOString();
    writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');
    dataCache.delete('articles.json');
    res.json({ success: true, article: newArticle });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin-class-positions', adminIdGuard, (req, res) => {
  if (!adminAuth(req)) return res.status(401).json({ error: 'Требуется вход' });
  try {
    res.json(loadClassPositionsData());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin-class-positions', adminIdGuard, (req, res) => {
  if (!adminAuth(req)) return res.status(401).json({ error: 'Требуется вход' });
  const positions = req.body?.positions;
  if (!positions || typeof positions !== 'object' || Array.isArray(positions)) {
    return res.status(400).json({ error: 'positions must be an object' });
  }
  try {
    const normalized = Object.fromEntries(
      Object.entries(positions)
        .map(([key, value]) => [key, String(value ?? '').trim()])
        .filter(([, value]) => value.length > 0)
    );
    const payload = { positions: normalized, updatedAt: new Date().toISOString() };
    const filePath = join(DATA_DIR, 'class_positions.json');
    writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    res.json({ success: true, ...payload });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Image generation (/api/admin/gen-image) ──────────────────────────────────

let isGenerating = false;

app.post('/api/admin/gen-image', adminIdGuard, (req, res) => {
  if (!adminAuth(req)) return res.status(401).json({ error: 'Требуется вход' });

  const type = (req.body?.type as string) ?? 'legendaries';
  const scriptMap: Record<string, string> = {
    legendaries: join(__dirname, 'gen_legendary_image.py'),
  };
  const script = scriptMap[type];
  if (!script || !existsSync(script)) {
    return res.status(400).json({ error: `Скрипт для типа "${type}" не найден` });
  }
  if (isGenerating) {
    return res.status(409).json({ error: 'Генерация уже запущена' });
  }

  const outRel = `generated/${type === 'legendaries' ? 'top_legendaries' : type}.png`;
  const outAbs = join(__dirname, '..', 'public', outRel);

  isGenerating = true;
  const logs: string[] = [];

  const py = spawn('python', [script, outAbs], { cwd: __dirname });

  py.stdout.on('data', (d: Buffer) => {
    const line = d.toString().trim();
    if (line) { logs.push(line); console.log('[gen-image]', line); }
  });
  py.stderr.on('data', (d: Buffer) => {
    const line = d.toString().trim();
    if (line) { logs.push('ERR: ' + line); console.error('[gen-image]', line); }
  });

  py.on('close', (code: number) => {
    isGenerating = false;
    if (code === 0) {
      console.log('[gen-image] Done →', outAbs);
    } else {
      console.error('[gen-image] Failed, code:', code);
    }
  });

  // Respond immediately with task started; client polls /api/admin/gen-status
  res.json({ message: 'Генерация запущена', outUrl: '/' + outRel });
});

app.get('/api/admin/gen-status', adminIdGuard, (req, res) => {
  if (!adminAuth(req)) return res.status(401).json({ error: 'Требуется вход' });
  res.json({ busy: isGenerating });
});

app.delete('/api/admin-articles', adminIdGuard, (req, res) => {
  if (!adminAuth(req)) return res.status(401).json({ error: 'Требуется вход' });
  const id = req.body?.id;
  if (!id) return res.status(400).json({ error: 'id обязателен' });
  try {
    const filePath = join(DATA_DIR, 'articles.json');
    const existing: any = loadData('articles.json') ?? { articles: [], updatedAt: null };
    const before = existing.articles.length;
    existing.articles = existing.articles.filter((a: any) => a.id !== id);
    if (existing.articles.length === before) return res.status(404).json({ error: 'Статья не найдена' });
    existing.updatedAt = new Date().toISOString();
    writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');
    dataCache.delete('articles.json');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── Scheduled scraping every 6 hours ─────────────────────────────────────────
cron.schedule('0 */6 * * *', async () => {
  if (isScraping) return;
  isScraping = true;
  console.log('[Cron] Starting scheduled scrape...');
  try {
    const result = await scrapeAll();
    invalidateDataCache();
    console.log('[Cron] Scrape complete:', result);
  } catch (err) {
    console.error('[Cron] Scrape failed:', err);
  } finally {
    isScraping = false;
  }
});

cron.schedule('*/30 * * * *', async () => {
  console.log('[Subscription] Starting scheduled subscription refresh...');
  try {
    await refreshAllSubscriptions();
    console.log('[Subscription] Scheduled subscription refresh complete.');
  } catch (err) {
    console.error('[Subscription] Scheduled subscription refresh failed:', err);
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[Server] API server running on http://${HOST || 'localhost'}:${PORT}`);
  console.log('[Server] Scraping every 6 hours. Trigger manual: POST /api/scrape');

  // Initial scrape on startup (non-blocking)
  setTimeout(async () => {
    if (isScraping) return;
    isScraping = true;
    console.log('[Server] Running initial scrape...');
    try {
      const result = await scrapeAll();
      console.log('[Server] Initial scrape complete:', result);
    } catch (err) {
      console.error('[Server] Initial scrape failed:', err);
    } finally {
      isScraping = false;
    }
  }, 2000);
});
