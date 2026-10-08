import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch } from 'undici';
import zlib from 'node:zlib';
import { CONAN_IMDB } from '../episode-id.js';

const OS_BASE = 'https://rest.opensubtitles.org';
const OS_HEADERS = {
  'User-Agent': 'TemporaryUserAgent',
  'X-User-Agent': 'TemporaryUserAgent',
  Accept: 'application/json',
};

const IMDB_NUM = CONAN_IMDB.replace(/^tt/i, '');
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DISK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DISK_PATH = path.join(__dirname, '..', '..', 'data', 'os-spanish-index.json');

/** @type {{ at: number, byAbs: Map<number, object[]> } | null} */
let indexCache = null;
/** @type {Promise<Map<number, object[]>> | null} */
let buildPromise = null;

/** Per-episode subtitle search memo (avoids repeat OS hits within a session). */
const findCache = new Map(); // key -> { at, value }
const FIND_TTL_MS = 30 * 60 * 1000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function osSearch(pathName) {
  const res = await fetch(`${OS_BASE}${pathName}`, {
    headers: OS_HEADERS,
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) return [];
  if (!res.ok) return [];
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

/**
 * Extract absolute Conan episode number from an OpenSubtitles entry.
 */
export function absoluteFromOsEntry(entry) {
  const name = `${entry.SubFileName || ''} ${entry.MovieReleaseName || ''}`;
  let m = name.match(
    /(?:Detective\s*Conan|Meitantei(?:\s*Conan)?|Case\s*Closed|DC)[^\d]{0,12}(\d{1,4})/i
  );
  if (m) return Number(m[1]);

  m = name.match(/(?:^|[^0-9])(\d{3,4})(?:\.español|\.espa|\.spa|[^\d]|$)/i);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 1500) return n;
  }

  const se = Number(entry.SeriesEpisode);
  const ss = Number(entry.SeriesSeason);
  if (Number.isFinite(se) && se >= 1 && se <= 1500) {
    if (se > 40 || ss === 1) return se;
  }
  return null;
}

function slimEntry(row) {
  return {
    IDSubtitleFile: row.IDSubtitleFile,
    SubFileName: row.SubFileName,
    MovieReleaseName: row.MovieReleaseName,
    SubFormat: row.SubFormat,
    SubDownloadLink: row.SubDownloadLink,
    ISO639: row.ISO639,
    SubLanguageID: row.SubLanguageID,
    SubRating: row.SubRating,
    SubDownloadsCnt: row.SubDownloadsCnt,
    SeriesSeason: row.SeriesSeason,
    SeriesEpisode: row.SeriesEpisode,
  };
}

function loadDiskIndex() {
  try {
    if (!fs.existsSync(DISK_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(DISK_PATH, 'utf8'));
    if (!raw?.at || !raw?.byAbs) return null;
    if (Date.now() - raw.at > DISK_TTL_MS) return null;
    const byAbs = new Map();
    for (const [k, rows] of Object.entries(raw.byAbs)) {
      byAbs.set(Number(k), rows);
    }
    console.log(
      `[subs/os] loaded disk index (${byAbs.size} eps, age ${Math.round((Date.now() - raw.at) / 3600000)}h)`
    );
    return { at: raw.at, byAbs };
  } catch (err) {
    console.warn('[subs/os] disk load failed:', err.message);
    return null;
  }
}

function saveDiskIndex(byAbs, at) {
  try {
    const obj = { at, byAbs: {} };
    for (const [k, rows] of byAbs) {
      obj.byAbs[k] = rows.map(slimEntry);
    }
    fs.mkdirSync(path.dirname(DISK_PATH), { recursive: true });
    fs.writeFileSync(DISK_PATH, JSON.stringify(obj));
    console.log(`[subs/os] disk index saved (${byAbs.size} eps)`);
  } catch (err) {
    console.warn('[subs/os] disk save failed:', err.message);
  }
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

async function buildSpanishIndex() {
  const byAbs = new Map();
  const seasons = Array.from({ length: 30 }, (_, i) => i + 1);
  await mapPool(seasons, 4, async (season) => {
    const rows = await osSearch(
      `/search/imdbid-${IMDB_NUM}/season-${season}/sublanguageid-spa`
    );
    if (!rows.length) return;
    for (const row of rows) {
      const abs = absoluteFromOsEntry(row);
      if (!abs) continue;
      if (!byAbs.has(abs)) byAbs.set(abs, []);
      byAbs.get(abs).push(slimEntry(row));
    }
    await sleep(80);
  });
  return byAbs;
}

async function getIndex() {
  if (indexCache && Date.now() - indexCache.at < CACHE_TTL_MS) {
    return indexCache.byAbs;
  }
  if (!indexCache) {
    const disk = loadDiskIndex();
    if (disk) {
      indexCache = disk;
      return disk.byAbs;
    }
  }
  if (!buildPromise) {
    buildPromise = (async () => {
      console.log('[subs/os] building Spanish Conan index…');
      const byAbs = await buildSpanishIndex();
      const at = Date.now();
      indexCache = { at, byAbs };
      saveDiskIndex(byAbs, at);
      console.log(`[subs/os] indexed ${byAbs.size} absolute episodes`);
      return byAbs;
    })().finally(() => {
      buildPromise = null;
    });
  }
  return buildPromise;
}

/** Prefetch index once at boot (single-flight). */
export function warmSpanishIndex() {
  return getIndex().catch((err) => {
    console.warn('[subs/os] warm failed:', err.message);
    return new Map();
  });
}

function pickDownloadUrl(entry) {
  return entry.SubDownloadLink || null;
}

function extFor(entry) {
  const fmt = String(entry.SubFormat || 'srt').toLowerCase();
  if (fmt === 'ssa' || fmt === 'ass') return 'ass';
  return 'srt';
}

export async function downloadOsSubtitle(downloadUrl) {
  const res = await fetch(downloadUrl, {
    headers: {
      'User-Agent': 'TemporaryUserAgent',
      'X-User-Agent': 'TemporaryUserAgent',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`OS download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let raw;
  try {
    raw = zlib.gunzipSync(buf);
  } catch {
    raw = buf;
  }
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    raw = raw.subarray(3);
  }
  return raw.toString('utf8');
}

/**
 * Find Spanish OpenSubtitles for an absolute Conan episode (+ optional S/E / hash).
 */
export async function findOpenSubtitlesSpanish({
  absolute,
  season,
  episode,
  videoHash,
  limit = 8,
} = {}) {
  const cacheKey = `${absolute || ''}|${season || ''}|${episode || ''}|${videoHash || ''}|${limit}`;
  const cached = findCache.get(cacheKey);
  if (cached && Date.now() - cached.at < FIND_TTL_MS) return cached.value;

  const results = [];
  const seen = new Set();

  const push = (entry, label) => {
    const id = entry.IDSubtitleFile;
    if (!id || seen.has(id)) return;
    const lang = String(entry.ISO639 || entry.SubLanguageID || '').toLowerCase();
    if (lang && !['es', 'spa', 'spl', 'sp'].includes(lang)) return;
    seen.add(id);
    const url = pickDownloadUrl(entry);
    if (!url) return;
    results.push({
      id: `os:${id}`,
      source: 'OpenSubtitles',
      label,
      lang: 'es',
      langLabel: 'Español',
      fileName: entry.SubFileName || `conan-${absolute || 'ep'}.srt`,
      format: extFor(entry),
      downloadUrl: url,
      rating: entry.SubRating,
      downloads: entry.SubDownloadsCnt,
    });
  };

  const tasks = [];

  if (videoHash && /^[a-f0-9]{16}$/i.test(videoHash)) {
    tasks.push(
      osSearch(
        `/search/moviehash-${videoHash.toLowerCase()}/sublanguageid-spa`
      ).then((rows) => {
        for (const row of rows) push(row, 'OS ES · archivo');
      })
    );
  }

  if (season != null && episode != null && season > 0) {
    tasks.push(
      osSearch(
        `/search/episode-${episode}/imdbid-${IMDB_NUM}/season-${season}/sublanguageid-spa`
      ).then((rows) => {
        for (const row of rows) push(row, `OS ES · S${season}E${episode}`);
      })
    );
  }

  // Prefer disk/memory index (fast) over another live season-1 query when possible
  if (absolute != null) {
    tasks.push(
      getIndex().then((byAbs) => {
        for (const row of byAbs.get(absolute) || []) {
          push(row, `OS ES · #${absolute}`);
        }
      })
    );
  }

  await Promise.all(tasks);

  // If index had nothing for this abs, try live S1 absolute as fallback
  if (absolute != null && !results.length) {
    const rowsAbs = await osSearch(
      `/search/episode-${absolute}/imdbid-${IMDB_NUM}/season-1/sublanguageid-spa`
    );
    for (const row of rowsAbs) push(row, `OS ES · #${absolute}`);
  }

  const value = results.slice(0, limit);
  findCache.set(cacheKey, { at: Date.now(), value });
  if (findCache.size > 500) {
    const first = findCache.keys().next().value;
    findCache.delete(first);
  }
  return value;
}
