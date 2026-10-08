import * as cheerio from 'cheerio';
import { fetchHtml } from './fetch.js';

const BASE = 'https://bibliokudo.wixsite.com/bibliokudo';

/** Known slug patterns when menu discovery fails. */
const FALLBACK_SLUGS = [
  'dc-001-050',
  'dc-051-099',
  '100-199-online',
  'dc-200',
  'dc-300',
  'dc-400',
  'dc-500',
  'dc-600',
  '700-799-online',
  '800-899-online',
  '900-999-online',
  '1000-online',
  '1100-online',
  'dc-1200',
  'peliculas',
  'ova',
  'especiales',
  'magic-files',
  'historias-cortas',
  'magic-kaito',
  'anime-zeros-tea-time',
  'el-culpable',
];

/**
 * Classify a page slug into content kind.
 * @returns {'anime'|'movie'|'ova'|'especial'|'other'|null}
 */
export function classifySlug(slug) {
  const s = slug.toLowerCase();
  if (s === 'peliculas' || /^pelicula-\d+$/.test(s) || s === 'pel') return 'movie';
  if (s === 'ova' || s.startsWith('ova')) return 'ova';
  if (s === 'especiales' || s === 'magic-files' || s === 'historias-cortas') return 'especial';
  if (
    /^dc-\d/.test(s) ||
    /^\d{3,4}-\d{3,4}/.test(s) ||
    /^\d{3,4}-online$/.test(s) ||
    /^\d{3,4}-dd$/.test(s) ||
    s === 'dc-1200'
  ) {
    // Prefer online over DD when both exist; caller filters
    if (/-dd$/.test(s)) return null; // skip download-only pages
    return 'anime';
  }
  if (s === 'magic-kaito' || s === 'anime-zeros-tea-time' || s === 'el-culpable') return 'other';
  // manga, videojuegos, musica, live-actions, dorama, comerciales — skip
  if (
    /manga|videojuego|musica|live-action|dorama|comercial|culpable-manga|wild-police/.test(s)
  ) {
    return null;
  }
  return null;
}

export function isLiveSlug(slug) {
  return /1100-online|dc-1200|peliculas|^pelicula-\d+$/.test(slug);
}

/**
 * Discover content pages from the site menu (+ movie detail pages).
 * Falls back to a hardcoded slug list if the home page is rate-limited.
 */
export async function discoverPages() {
  const found = new Map();

  try {
    const html = await fetchHtml(BASE);
    const $ = cheerio.load(html);
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const m = href.match(/bibliokudo\.wixsite\.com\/bibliokudo\/([a-zA-Z0-9_%-]+)/);
      if (!m) return;
      const slug = decodeURIComponent(m[1]);
      if (slug.startsWith('_')) return;
      const kind = classifySlug(slug);
      if (!kind) return;
      found.set(slug, { slug, kind, url: `${BASE}/${slug}` });
    });
  } catch (err) {
    console.warn('[pages] home discovery failed, using fallbacks:', err.message);
  }

  // Ensure fallbacks
  for (const slug of FALLBACK_SLUGS) {
    const kind = classifySlug(slug);
    if (!kind) continue;
    if (!found.has(slug)) {
      found.set(slug, { slug, kind, url: `${BASE}/${slug}` });
    }
  }

  // Expand peliculas hub into individual movie pages
  const moviePages = [];
  const movieNums = new Set();
  try {
    const pelHtml = await fetchHtml(`${BASE}/peliculas`);
    const $p = cheerio.load(pelHtml);
    $p('a[href]').each((_, el) => {
      const href = $p(el).attr('href') || '';
      const m = href.match(/\/pelicula-(\d+)/i);
      if (!m) return;
      movieNums.add(Number(m[1]));
    });
  } catch (err) {
    console.warn('[pages] peliculas hub failed:', err.message);
  }
  // Always include 1..28 (covers known films); extend if hub found higher
  const maxMovie = Math.max(28, ...movieNums, 0);
  for (let i = 1; i <= maxMovie; i++) {
    moviePages.push({
      slug: `pelicula-${i}`,
      kind: 'movie',
      url: `${BASE}/pelicula-${i}`,
      movieNumber: i,
    });
  }

  const pages = [...found.values()].filter((p) => p.slug !== 'peliculas');
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  for (const mp of moviePages) bySlug.set(mp.slug, mp);

  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug, 'en'));
}

export { BASE };
