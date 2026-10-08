import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_PATH = path.join(__dirname, '..', 'data', 'season-map.json');

/** Known IDs for Detective Conan / Case Closed across meta providers. */
export const CONAN_IDS = new Set([
  'tt0131179', // IMDb / Cinemeta
  'bk:conan',
  'tvdb:72454',
  // Common TMDB ids used for Case Closed / Detective Conan
  'tmdb:30983',
  'tmdb:45782',
  'tmdb:900',
]);

export const CONAN_IMDB = 'tt0131179';

let seasonMap = null;

function loadSeasonMap() {
  if (seasonMap) return seasonMap;
  try {
    seasonMap = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
  } catch {
    seasonMap = { seasonEpisodeToAbsolute: {}, seasonStarts: {} };
  }
  return seasonMap;
}

/**
 * Parse a Stremio video/stream id into { seriesId, season, episode }.
 * Supports:
 *   bk:conan:525
 *   bk:conan:s0:3
 *   tt0131179:18:2
 *   tt0131179:1:525
 *   tmdb:12345:18:2
 *   seriesId:season:episode
 */
export function parseStremioId(id) {
  if (!id || typeof id !== 'string') return null;
  const raw = decodeURIComponent(id);

  // Our specials: bk:conan:s0:N
  let m = raw.match(/^bk:conan:s0:(\d+)$/i);
  if (m) return { seriesId: 'bk:conan', season: 0, episode: Number(m[1]), kind: 'special' };

  // Our absolute: bk:conan:N
  m = raw.match(/^bk:conan:(\d+)$/i);
  if (m) return { seriesId: 'bk:conan', season: 1, episode: Number(m[1]), kind: 'absolute' };

  // imdb:tt.. or bare tt..
  m = raw.match(/^(?:imdb:)?(tt\d+):(\d+):(\d+)$/i);
  if (m) return { seriesId: m[1].toLowerCase(), season: Number(m[2]), episode: Number(m[3]), kind: 'season' };

  // tmdb:ID:S:E
  m = raw.match(/^tmdb:(\d+):(\d+):(\d+)$/i);
  if (m) return { seriesId: `tmdb:${m[1]}`, season: Number(m[2]), episode: Number(m[3]), kind: 'season' };

  // tvdb:ID:S:E
  m = raw.match(/^tvdb:(\d+):(\d+):(\d+)$/i);
  if (m) return { seriesId: `tvdb:${m[1]}`, season: Number(m[2]), episode: Number(m[3]), kind: 'season' };

  // kitsu / mal with absolute often as :1:N or :N
  m = raw.match(/^(kitsu|mal|anilist):(\d+):(\d+):(\d+)$/i);
  if (m) return { seriesId: `${m[1]}:${m[2]}`, season: Number(m[3]), episode: Number(m[4]), kind: 'season' };

  m = raw.match(/^(kitsu|mal|anilist):(\d+):(\d+)$/i);
  if (m) return { seriesId: `${m[1]}:${m[2]}`, season: 1, episode: Number(m[3]), kind: 'absolute' };

  return null;
}

export function isConanSeriesId(seriesId) {
  if (!seriesId) return false;
  const s = String(seriesId).toLowerCase();
  if (CONAN_IDS.has(s)) return true;
  if (s.includes('tt0131179')) return true;
  if (s === 'bk:conan' || s.startsWith('bk:conan')) return true;
  return false;
}

/**
 * Convert Stremio season/episode to BiblioKudo absolute episode number.
 *
 * Schemes handled:
 * 1. Absolute (Cinemeta): season===1 && episode looks like absolute (> season length)
 *    or kind==='absolute'
 * 2. Wikipedia / Case Closed DVD seasons: S18 E2 → 525
 * 3. Year seasons (TVMaze): S2009 E5 → 525 via ordered year map fallback
 * 4. Season 0 → special index (caller handles)
 */
export function toAbsoluteEpisode(season, episode, { kind } = {}) {
  const map = loadSeasonMap();
  const seMap = map.seasonEpisodeToAbsolute || {};
  const starts = map.seasonStarts || {};

  if (season === 0) return { absolute: null, specialIndex: episode };

  // Explicit absolute ids
  if (kind === 'absolute') return { absolute: episode };

  // Cinemeta-style: everything in season 1 with absolute numbers
  if (season === 1 && episode >= 1) {
    // If episode is beyond a normal season length, treat as absolute
    // (Cinemeta has 1200+ in S1). Also S1 E1..28 are both absolute AND in-season.
    const dvd = seMap[`1:${episode}`];
    if (episode > 42) return { absolute: episode }; // definitely absolute
    // Prefer absolute interpretation when it matches our index range for S1 DVD start
    // For S1 E1-28, absolute == in-season under Wikipedia numbering. Good.
    if (dvd) return { absolute: dvd };
    return { absolute: episode };
  }

  // Direct Wikipedia DVD season map
  const key = `${season}:${episode}`;
  if (seMap[key]) return { absolute: seMap[key] };

  // Offset from season start
  const start = starts[String(season)] ?? starts[season];
  if (start != null) return { absolute: start + episode - 1 };

  // Year-as-season (1996, 1997, …) — approximate via TVMaze order built into starts as years
  if (season >= 1996 && season <= 2030) {
    // Build from seasonStarts if we stored years — else linear scan not available.
    // Fallback: treat episode as needing year map; use cumulative from known year sizes in map note.
    // For now try key with year
    if (seMap[key]) return { absolute: seMap[key] };
  }

  // Last resort: if season is large year-like already handled; else null
  return { absolute: null };
}

/**
 * Resolve any Stremio stream id to an absolute Conan episode (or special).
 */
export function resolveConanEpisode(id) {
  const parsed = parseStremioId(id);
  if (!parsed) return null;

  // Only handle Conan series ids (or our bk: prefix)
  if (!isConanSeriesId(parsed.seriesId) && !parsed.seriesId.startsWith('bk:')) {
    // Still try if it's tt0131179 embedded
    if (!/tt0131179/i.test(id)) return null;
  }

  if (parsed.kind === 'special' || parsed.season === 0) {
    return { type: 'special', specialIndex: parsed.episode };
  }

  const { absolute, specialIndex } = toAbsoluteEpisode(
    parsed.season,
    parsed.episode,
    { kind: parsed.kind }
  );

  if (specialIndex != null) return { type: 'special', specialIndex };
  if (absolute == null || absolute < 1) return null;
  return { type: 'episode', absolute };
}

export { loadSeasonMap };
