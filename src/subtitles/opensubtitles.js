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
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** @type {{ at: number, byAbs: Map<number, object[]> } | null} */
let indexCache = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function osSearch(path) {
  const res = await fetch(`${OS_BASE}${path}`, {
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
 * Filenames like DetectiveConan-0334.español.srt or Case Closed S02E47.
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
  // Western Case Closed often puts absolute # in Episode field (E47, E63…)
  if (Number.isFinite(se) && se >= 1 && se <= 1500) {
    if (se > 40 || ss === 1) return se;
  }
  return null;
}

async function buildSpanishIndex() {
  const byAbs = new Map();
  for (let season = 1; season <= 30; season++) {
    const rows = await osSearch(
      `/search/imdbid-${IMDB_NUM}/season-${season}/sublanguageid-spa`
    );
    if (!rows.length) continue;
    for (const row of rows) {
      const abs = absoluteFromOsEntry(row);
      if (!abs) continue;
      if (!byAbs.has(abs)) byAbs.set(abs, []);
      byAbs.get(abs).push(row);
    }
    await sleep(120);
  }
  return byAbs;
}

async function getIndex() {
  if (indexCache && Date.now() - indexCache.at < CACHE_TTL_MS) {
    return indexCache.byAbs;
  }
  console.log('[subs/os] building Spanish Conan index…');
  const byAbs = await buildSpanishIndex();
  indexCache = { at: Date.now(), byAbs };
  console.log(`[subs/os] indexed ${byAbs.size} absolute episodes`);
  return byAbs;
}

function pickDownloadUrl(entry) {
  const raw = entry.SubDownloadLink;
  if (!raw) return null;
  return raw;
}

function extFor(entry) {
  const fmt = String(entry.SubFormat || 'srt').toLowerCase();
  if (fmt === 'ssa' || fmt === 'ass') return 'ass';
  return 'srt';
}

/**
 * Download + gunzip an OpenSubtitles file to UTF-8 text.
 */
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
  // Strip UTF-8 BOM
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    raw = raw.subarray(3);
  }
  return raw.toString('utf8');
}

/**
 * Find Spanish OpenSubtitles for an absolute Conan episode (+ optional S/E).
 */
export async function findOpenSubtitlesSpanish({
  absolute,
  season,
  episode,
  limit = 6,
} = {}) {
  const results = [];
  const seen = new Set();

  const push = (entry, label) => {
    const id = entry.IDSubtitleFile;
    if (!id || seen.has(id)) return;
    seen.add(id);
    const url = pickDownloadUrl(entry);
    if (!url) return;
    results.push({
      id: `os:${id}`,
      source: 'OpenSubtitles',
      label,
      lang: 'spa',
      langLabel: 'Español',
      fileName: entry.SubFileName || `conan-${absolute}.srt`,
      format: extFor(entry),
      downloadUrl: url,
      rating: entry.SubRating,
      downloads: entry.SubDownloadsCnt,
    });
  };

  // Direct season/episode search (Wikipedia / Stremio S/E)
  if (season != null && episode != null && season > 0) {
    const rows = await osSearch(
      `/search/episode-${episode}/imdbid-${IMDB_NUM}/season-${season}/sublanguageid-spa`
    );
    for (const row of rows) push(row, `OS ES · S${season}E${episode}`);
  }

  // Absolute via cached filename index
  if (absolute != null) {
    const byAbs = await getIndex();
    const rows = byAbs.get(absolute) || [];
    for (const row of rows) {
      push(row, `OS ES · #${absolute}`);
    }
  }

  return results.slice(0, limit);
}
