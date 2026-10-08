import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeAll, scrapeLive } from './scraper.js';
import { enrichIndexRoles } from './hosts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.join(__dirname, '..', 'data', 'index.json');

const FULL_TTL_MS = 12 * 60 * 60 * 1000;
const LIVE_TTL_MS = 60 * 60 * 1000;

let index = null;
let lastFull = 0;
let lastLive = 0;
let refreshPromise = null;
let livePromise = null;
let lastError = null;

export function loadSnapshot() {
  try {
    if (fs.existsSync(SNAPSHOT_PATH)) {
      const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
      return enrichIndexRoles(JSON.parse(raw));
    }
  } catch (err) {
    console.warn('[cache] snapshot load failed:', err.message);
  }
  return null;
}

export function saveSnapshot(data) {
  try {
    const dir = path.dirname(SNAPSHOT_PATH);
    fs.mkdirSync(dir, { recursive: true });
    // Don't persist huge pretty JSON in prod writes on every live tick if huge —
    // but we want readable dumps for git; keep pretty.
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(data));
    console.log('[cache] snapshot written');
  } catch (err) {
    console.warn('[cache] snapshot save failed:', err.message);
  }
}

export function getIndexSync() {
  if (index) return index;
  index = loadSnapshot();
  return index;
}

export function getStats() {
  return {
    hasIndex: !!index,
    episodeCount: index?.stats?.episodeCount ?? 0,
    movieCount: index?.stats?.movieCount ?? 0,
    specialCount: index?.stats?.specialCount ?? 0,
    scrapedAt: index?.scrapedAt ?? null,
    lastFull: lastFull ? new Date(lastFull).toISOString() : null,
    lastLive: lastLive ? new Date(lastLive).toISOString() : null,
    lastError,
    refreshing: !!(refreshPromise || livePromise),
  };
}

async function doFullRefresh() {
  console.log('[cache] full scrape starting…');
  const data = enrichIndexRoles(
    await scrapeAll({
      concurrency: 2,
      onProgress: (p) => {
        if (p.phase === 'discovered') console.log(`[cache] pages: ${p.pages}`);
        if (p.phase === 'scraping' && p.done % 4 === 0) {
          console.log(`[cache] scraped ${p.done}/${p.total}`);
        }
      },
    })
  );
  // Don't replace a good index with a clearly broken scrape
  if (
    index &&
    data.stats.episodeCount < Math.floor((index.stats?.episodeCount || 0) * 0.5)
  ) {
    throw new Error(
      `scrape too small (${data.stats.episodeCount} vs ${index.stats.episodeCount}), keeping old index`
    );
  }
  index = data;
  lastFull = Date.now();
  lastLive = Date.now();
  lastError = null;
  saveSnapshot(data);
  console.log(
    `[cache] full scrape done: ${data.stats.episodeCount} eps, ${data.stats.movieCount} movies, ${data.stats.specialCount} specials`
  );
  return data;
}

async function doLiveRefresh() {
  if (!index) return doFullRefresh();
  console.log('[cache] live refresh starting…');
  const data = enrichIndexRoles(await scrapeLive(index));
  index = data;
  lastLive = Date.now();
  lastError = null;
  saveSnapshot(data);
  console.log(
    `[cache] live refresh done: ${data.stats.episodeCount} eps, ${data.stats.movieCount} movies`
  );
  return data;
}

export async function ensureIndex({ force = false } = {}) {
  const now = Date.now();
  if (!index) {
    index = loadSnapshot();
    if (index) {
      lastFull = Date.parse(index.scrapedAt) || 0;
      lastLive = lastFull;
      console.log(
        `[cache] loaded snapshot (${index.stats?.episodeCount ?? '?'} eps)`
      );
    }
  }

  if (force || !index || now - lastFull > FULL_TTL_MS) {
    if (!refreshPromise) {
      refreshPromise = doFullRefresh()
        .catch((err) => {
          lastError = String(err.message || err);
          console.error('[cache] full scrape failed:', lastError);
          return index;
        })
        .finally(() => {
          refreshPromise = null;
        });
    }
    if (!index) return refreshPromise;
  } else if (now - lastLive > LIVE_TTL_MS) {
    if (!livePromise) {
      livePromise = doLiveRefresh()
        .catch((err) => {
          lastError = String(err.message || err);
          console.error('[cache] live refresh failed:', lastError);
          return index;
        })
        .finally(() => {
          livePromise = null;
        });
    }
  }

  return index;
}

export async function getIndex() {
  const data = await ensureIndex();
  if (!data) throw new Error('Index not available yet');
  return data;
}

export function startBackgroundRefresh() {
  ensureIndex().catch((err) => console.error('[cache] init failed:', err));
  setInterval(() => {
    ensureIndex().catch((err) => console.error('[cache] tick failed:', err));
  }, 15 * 60 * 1000).unref?.();
}

export { SNAPSHOT_PATH };
