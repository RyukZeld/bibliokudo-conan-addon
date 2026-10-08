/**
 * Disk-cached poster proxy so Nuvio/Stremio always hit our host.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch } from 'undici';
import { getPublicBase } from './subtitles/public-base.js';
import { SERIES_ART, MOVIE_ART, listArt, seasonArt } from './art.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'data', 'art-cache');

const KEY_UPSTREAM = new Map();

function register(key, url) {
  if (url) KEY_UPSTREAM.set(key, url);
}

function bootstrapKeys() {
  if (KEY_UPSTREAM.size) return;
  register('series', SERIES_ART.poster);
  register('series-bg', SERIES_ART.background);
  register('logo', SERIES_ART.logo);
  register('ovas', listArt('ovas').poster);
  for (let n = 1; n <= 24; n++) {
    const a = MOVIE_ART[n];
    if (a?.poster) register(`movie-${n}`, a.poster);
  }
  for (const id of [
    'lista-a',
    'lista-b',
    'lista-c',
    'lista-d',
    'hombres-negro',
    'shinran',
    'conan',
    'ran',
    'ninos',
    'haibara',
    'kogoro',
    'kogoro-eri',
    'kid',
    'heiji',
    'sonoko',
    'fbi',
    'amuro',
    'policias',
    'matrimonio-kudo',
    'nagano',
    'mejores-rellenos',
    'mejores-casos',
    'solo-canon',
    'solo-peliculas',
    'movies-all',
  ]) {
    register(`list-${id}`, listArt(id).poster);
  }
  for (let s = 1; s <= 40; s++) {
    register(`season-${s}`, seasonArt(s).poster);
  }
}

export function artProxyUrl(key) {
  bootstrapKeys();
  const base = getPublicBase();
  return `${base}/art/poster/${encodeURIComponent(key)}`;
}

export function proxiedSeriesArt() {
  return {
    poster: artProxyUrl('series'),
    background: artProxyUrl('series-bg'),
    logo: artProxyUrl('logo'),
  };
}

export function proxiedListArt(listId) {
  return {
    poster: artProxyUrl(`list-${listId}`),
    background: artProxyUrl(`list-${listId}`),
    logo: artProxyUrl('logo'),
  };
}

export function proxiedMovieArt(n) {
  return {
    poster: artProxyUrl(`movie-${n}`),
    background: artProxyUrl(`movie-${n}`),
    logo: artProxyUrl('logo'),
  };
}

export function proxiedSeasonArt(n) {
  return {
    poster: artProxyUrl(`season-${n}`),
    background: artProxyUrl(`season-${n}`),
    logo: artProxyUrl('logo'),
  };
}

function cachePath(key) {
  const safe = String(key).replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(CACHE_DIR, `${safe}.bin`);
}

export async function serveArtPoster(key, res) {
  bootstrapKeys();
  const upstream = KEY_UPSTREAM.get(key);
  if (!upstream) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unknown art key' }));
    return;
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = cachePath(key);
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    const type = sniffType(buf) || 'image/jpeg';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=604800',
      'Content-Length': buf.length,
    });
    res.end(buf);
    return;
  }

  try {
    const r = await fetch(upstream, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ConanAddon/1.7)' },
      redirect: 'follow',
    });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(file, buf);
    const type = r.headers.get('content-type') || sniffType(buf) || 'image/jpeg';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=604800',
      'Content-Length': buf.length,
    });
    res.end(buf);
  } catch (err) {
    console.warn('[art]', key, err.message);
    // Redirect client to upstream as last resort
    res.writeHead(302, { Location: upstream, 'Cache-Control': 'no-store' });
    res.end();
  }
}

function sniffType(buf) {
  if (!buf?.length) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp';
  return null;
}

export function artCacheStats() {
  try {
    if (!fs.existsSync(CACHE_DIR)) return { files: 0 };
    return { files: fs.readdirSync(CACHE_DIR).length, dir: CACHE_DIR };
  } catch {
    return { files: 0 };
  }
}
