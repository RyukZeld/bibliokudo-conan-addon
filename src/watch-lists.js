import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONAN_IMDB, loadSeasonMap } from './episode-id.js';
import { findEpisode, findSpecial, findMovie } from './index-maps.js';
import { createTtlCache } from './response-cache.js';
import {
  proxiedListArt,
  proxiedSeasonArt,
  proxiedSeriesArt,
} from './art-proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LISTS_PATH = path.join(__dirname, '..', 'data', 'watch-lists.json');

const metaCache = createTtlCache({ max: 80, name: 'list-meta' });
const META_TTL_MS = 10 * 60 * 1000;

/** @type {Map<number, number> | null} */
let absToSeasonCache = null;

/** Extra search keywords so "hdn", "lista b", "kid" find the right card. */
export const SEARCH_ALIASES = {
  'lista-a': ['lista a', 'casi completo', 'completa', 'guia a', 'orden a'],
  'lista-b': ['lista b', 'recomendada', 'guia b', 'equilibrio', 'orden b'],
  'lista-c': ['lista c', 'esencial', 'guia c', 'filtrada', 'corta'],
  'lista-d': ['lista d', 'repaso', 'spoilers', 'esencial puro', 'guia d'],
  'hombres-negro': [
    'hdn',
    'black organization',
    'organizacion',
    'hombres de negro',
    'gin',
    'vermouth',
    'akai',
  ],
  shinran: ['shinichi', 'shin ran', 'romantico', 'pareja'],
  conan: ['protagonista', 'edogawa'],
  ran: ['mouri ran', 'ran mouri'],
  ninos: ['detective boys', 'liga juvenil', 'ayumi', 'genta', 'mitsuhiko'],
  haibara: ['shiho', 'miyano', 'sherry', 'ai haibara'],
  kogoro: ['mouri', 'durmiendo'],
  'kogoro-eri': ['eri', 'kisaki', 'esposa'],
  kid: ['kaito', 'kaito kid', 'phantom thief', 'ladron'],
  heiji: ['hattori', 'kazuha', 'osaka'],
  sonoko: ['suzuki', 'makoto'],
  fbi: ['akai', 'jodie', 'camel', 'james black'],
  amuro: ['furuya', 'bourbon', 'zero', 'tooru'],
  policias: ['megure', 'takagi', 'sato', 'policia'],
  'matrimonio-kudo': ['yusaku', 'yukiko', 'padres', 'kudo'],
  nagano: ['yamato', 'morofushi', 'koumei'],
  'mejores-rellenos': ['filler', 'relleno', 'mejores fillers'],
  'mejores-casos': ['mejores', 'top', 'casos top', 'favoritos'],
  'solo-canon': ['canon', 'sin relleno', 'solo canon', 'manga'],
  'solo-peliculas': ['peliculas guia', 'solo peliculas', 'movies guide'],
  'movies-all': ['todas las peliculas', 'all movies', 'films'],
  'arco-hdn-intro': ['arco hdn', 'intro hdn'],
  'arco-haibara': ['arco haibara', 'sherry'],
  'arco-vs-kid': ['arco kid', 'vs kid'],
  'arco-akira': ['rojo y negro', 'clash of red and black'],
  'arco-bourbon': ['arco bourbon', 'arco amuro'],
  'arco-rum': ['arco rum'],
  'arco-wakasa': ['arco wakasa', 'kuroda'],
};

export function listSearchText(list) {
  const aliases = SEARCH_ALIASES[list.id] || [];
  return normalize(
    [
      list.id,
      list.name,
      list.short,
      list.group,
      list.description,
      ...aliases,
    ].join(' ')
  );
}

export function listMatchesQuery(list, q) {
  if (!q) return true;
  const nq = normalize(q);
  if (!nq) return true;
  const blob = listSearchText(list);
  // Full phrase (e.g. "lista b", "hombres de negro")
  if (blob.includes(nq)) return true;
  // All tokens must hit; short ones (a/b/c/d, kid) need word boundaries
  // so "lista b" does not match every list that merely contains "lista".
  const tokens = nq.split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  return tokens.every((t) => {
    if (t.length <= 2) {
      return new RegExp(`(?:^|\\s)${escapeRegExp(t)}(?:\\s|$)`).test(blob);
    }
    return blob.includes(t);
  });
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function groupLabel(group) {
  if (group === 'guias') return 'Guía';
  if (group === 'personajes') return 'Personaje';
  if (group === 'extras') return 'Selección';
  if (group === 'arcos') return 'Arco';
  return 'Lista';
}

/** Genre chip labels used by the single Biblioteca catalog. */
export const GENRE_GUIAS = 'Guías';
export const GENRE_PERSONAJES = 'Personajes';
export const GENRE_EXTRAS = 'Extras';
export const GENRE_ARCOS = 'Arcos';
export const GENRE_TEMPORADAS = 'Temporadas';
export const GENRE_SERIE = 'Serie';
export const GENRE_ESPECIALES = 'OVAs / Especiales';

/** Slim catalog chips — only guides + movies + specials. */
export const BIBLIOTECA_GENRES = [
  GENRE_GUIAS,
  'Películas',
  GENRE_ESPECIALES,
];

/** The only watch-order lists shown in Biblioteca home. */
export const CORE_GUIDE_IDS = ['lista-a', 'lista-b', 'lista-c', 'lista-d'];

/** Preferred order inside Personajes (rest follow alphabetically by short). */
const PERSONAJE_ORDER = [
  'hombres-negro',
  'shinran',
  'haibara',
  'kid',
  'amuro',
  'heiji',
  'conan',
  'ran',
  'ninos',
  'fbi',
  'kogoro',
  'kogoro-eri',
  'sonoko',
  'policias',
  'matrimonio-kudo',
  'nagano',
];

const GROUP_ORDER = { guias: 0, personajes: 1, extras: 2, arcos: 3 };

/** Episodes tagged as filler via «mejores-rellenos» list. */
let fillerSetCache = null;
export function fillerEpisodeSet() {
  if (fillerSetCache) return fillerSetCache;
  const list = getList('mejores-rellenos');
  fillerSetCache = new Set();
  for (const it of list?.items || []) {
    if (it.kind === 'episode' && it.episode) fillerSetCache.add(it.episode);
  }
  return fillerSetCache;
}

export function listsOrdered() {
  const lists = allLists();
  return lists.sort((a, b) => {
    const ga = GROUP_ORDER[a.group] ?? 9;
    const gb = GROUP_ORDER[b.group] ?? 9;
    if (ga !== gb) return ga - gb;
    if (a.group === 'guias') {
      return String(a.id).localeCompare(String(b.id));
    }
    if (a.group === 'personajes') {
      const ia = PERSONAJE_ORDER.indexOf(a.id);
      const ib = PERSONAJE_ORDER.indexOf(b.id);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    }
    if (a.group === 'extras') {
      const eo = ['mejores-rellenos', 'mejores-casos'];
      return (eo.indexOf(a.id) + 1 || 9) - (eo.indexOf(b.id) + 1 || 9);
    }
    return String(a.short || a.name).localeCompare(String(b.short || b.name));
  });
}

function genreForGroup(group) {
  if (group === 'guias') return GENRE_GUIAS;
  if (group === 'personajes') return GENRE_PERSONAJES;
  if (group === 'extras') return GENRE_EXTRAS;
  if (group === 'arcos') return GENRE_ARCOS;
  return 'Conan';
}

function blurbForList(list) {
  if (list.group === 'guias') {
    const tips = {
      'lista-a': 'Para ver casi todo sin el relleno peor.',
      'lista-b': 'La opción por defecto: la más equilibrada.',
      'lista-c': 'Si quieres la trama principal en menos tiempo.',
      'lista-d': 'Solo repaso / spoilers — no empieces por aquí.',
    };
    return tips[list.id] || 'Orden de visionado de la guía PDF.';
  }
  if (list.group === 'personajes') {
    return 'Arcos y caps focalizados en este personaje, en orden de la guía.';
  }
  if (list.id === 'mejores-rellenos') {
    return 'Fillers que sí merecen la pena, sin el resto.';
  }
  if (list.id === 'mejores-casos') {
    return 'Casos top por mérito propio (canon y relleno).';
  }
  if (list.id === 'solo-canon') {
    return 'Trama principal sin la selección de rellenos.';
  }
  if (list.id === 'solo-peliculas' || list.id === 'movies-all') {
    return 'Maratón de películas en orden.';
  }
  if (list.group === 'arcos') {
    return 'Arco de trama por rangos de capítulos absolutos.';
  }
  return 'Selección curada de la guía de visionado.';
}

let cached = null;
let cachedMtime = 0;

export function loadWatchLists() {
  const st = fs.statSync(LISTS_PATH);
  if (cached && st.mtimeMs === cachedMtime) return cached;
  cached = JSON.parse(fs.readFileSync(LISTS_PATH, 'utf8'));
  cachedMtime = st.mtimeMs;
  return cached;
}

export function getList(listId) {
  return loadWatchLists().lists?.[listId] || null;
}

export function allLists() {
  return Object.values(loadWatchLists().lists || {});
}

/** Build absolute → Wikipedia DVD season using seasonStarts (memoized). */
export function buildAbsoluteToSeason() {
  if (absToSeasonCache) return absToSeasonCache;
  const map = loadSeasonMap();
  const starts = map.seasonStarts || {};
  const entries = Object.entries(starts)
    .map(([s, abs]) => [Number(s), Number(abs)])
    .filter(([s]) => Number.isFinite(s) && s >= 1 && s < 100)
    .sort((a, b) => a[1] - b[1]);

  const absToSeason = new Map();
  for (let i = 0; i < entries.length; i++) {
    const [season, start] = entries[i];
    const end =
      i + 1 < entries.length ? entries[i + 1][1] - 1 : start + 5000;
    for (let abs = start; abs <= end; abs++) {
      absToSeason.set(abs, season);
    }
  }
  for (const [key, abs] of Object.entries(
    map.seasonEpisodeToAbsolute || {}
  )) {
    const season = Number(String(key).split(':')[0]);
    if (Number.isFinite(season) && Number.isFinite(abs)) {
      absToSeason.set(Number(abs), season);
    }
  }
  absToSeasonCache = absToSeason;
  return absToSeason;
}

function artFor(listId) {
  return proxiedListArt(listId);
}

export { proxiedSeriesArt };

/** Official OVAs 1–12 live at specialIndex 54–65 in our scrape. */
export function ovaToSpecialIndex(ovaNumber) {
  if (ovaNumber >= 1 && ovaNumber <= 12) return 53 + ovaNumber;
  return null;
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function findSpecialInIndex(index, title) {
  const needle = normalize(title);
  if (!needle) return null;
  const keys = needle
    .replace(/^especial( de ano nuevo)?\s*/, '')
    .trim();
  let best = null;
  let bestScore = 0;
  for (const sp of index.specials || []) {
    const hay = normalize(sp.title);
    if (!hay) continue;
    let score = 0;
    if (hay === keys || hay === needle) score = 100;
    else if (hay.includes(keys) || keys.includes(hay)) score = 80;
    else {
      const parts = keys.split(' ').filter((w) => w.length > 3);
      const hits = parts.filter((w) => hay.includes(w)).length;
      score = parts.length ? (hits / parts.length) * 60 : 0;
    }
    if (score > bestScore) {
      bestScore = score;
      best = sp;
    }
  }
  return bestScore >= 40 ? best : null;
}

export function findMovieInIndex(index, item) {
  if (item.movieKey === 'lupin') {
    return (
      (index.movies || []).find((m) =>
        /lupin/i.test(m.title || '')
      ) || null
    );
  }
  if (item.movieNumber != null) {
    return findMovie(index, item.movieNumber);
  }
  return null;
}

/**
 * Resolve a list item to a playable video id + display fields.
 */
export function resolveListItem(item, index, absToSeason) {
  const maxEp = index.stats?.maxEpisode || 1500;

  if (item.kind === 'episode') {
    const abs = Number(item.episode);
    if (!Number.isFinite(abs) || abs < 1 || abs > maxEp) return null;
    const ep = findEpisode(index, abs);
    if (!ep) return null;
    const season = absToSeason.get(abs) || 1;
    const tag = fillerEpisodeSet().has(abs) ? 'Relleno' : 'Canon';
    return {
      videoId: `${CONAN_IMDB}:1:${abs}`,
      title: `${String(abs).padStart(3, '0')}. ${ep.title}`,
      season,
      overview: `${tag} · Cap. ${abs} · orden de la lista`,
      kind: 'episode',
      absolute: abs,
      hasLinks: Boolean(ep?.links?.length),
    };
  }

  if (item.kind === 'movie') {
    const movie = findMovieInIndex(index, item);
    const num = item.movieNumber;
    if (!movie && item.movieKey !== 'lupin' && !Number.isFinite(num)) return null;
    return {
      videoId: movie
        ? `bk:movie:${movie.movieNumber}`
        : item.movieKey === 'lupin'
          ? 'bk:movie:lupin'
          : `bk:movie:${num}`,
      title: movie?.title || item.title || `Película ${num}`,
      season: null, // filled by caller from previous episode season
      overview: 'Película · orden de la guía',
      kind: 'movie',
      movieNumber: movie?.movieNumber ?? num,
      hasLinks: Boolean(movie?.links?.length),
    };
  }

  if (item.kind === 'ova') {
    const spIdx = ovaToSpecialIndex(item.ovaNumber);
    if (spIdx == null) return null;
    const sp = findSpecial(index, spIdx);
    return {
      videoId: `${CONAN_IMDB}:0:${spIdx}`,
      title: sp?.title
        ? `OVA ${item.ovaNumber}. ${sp.title}`
        : `OVA ${item.ovaNumber}`,
      season: null,
      overview: 'OVA · orden de la guía',
      kind: 'ova',
      specialIndex: spIdx,
      hasLinks: Boolean(sp?.links?.length),
    };
  }

  if (item.kind === 'special') {
    const sp = findSpecialInIndex(index, item.title);
    if (!sp) return null; // drop PDF prose / unmatched junk
    return {
      videoId: `${CONAN_IMDB}:0:${sp.specialIndex}`,
      title: sp.title,
      season: null,
      overview: 'Especial · orden de la guía',
      kind: 'special',
      specialIndex: sp.specialIndex,
      hasLinks: Boolean(sp?.links?.length),
    };
  }

  return null;
}

/**
 * Build Stremio videos[] for a watch list, split into DVD seasons
 * while keeping list order (movies/OVAs stay in the season block
 * where the guide inserts them).
 */
export function buildListVideos(list, index) {
  const absToSeason = buildAbsoluteToSeason();
  const videos = [];
  let lastSeason = 1;
  const counters = new Map(); // season -> next episode number in that season
  const seenIds = new Set();

  for (const item of list.items || []) {
    const resolved = resolveListItem(item, index, absToSeason);
    if (!resolved?.videoId) continue;
    // Same playable id twice breaks progress UI — skip exact dupes
    if (seenIds.has(resolved.videoId)) continue;
    seenIds.add(resolved.videoId);

    let season = resolved.season;
    if (season == null) season = lastSeason;
    else lastSeason = season;

    const n = (counters.get(season) || 0) + 1;
    counters.set(season, n);

    videos.push({
      id: resolved.videoId,
      title: resolved.title,
      season,
      episode: n,
      episodeNo: n,
      overview: resolved.hasLinks
        ? resolved.overview
        : `${resolved.overview} · sin enlaces BK aún`,
    });
  }
  return videos;
}

export function listMeta(list, index, { full = false } = {}) {
  const cacheKey = `list:v4:${list.id}:${full ? 'full' : 'card'}:${index.scrapedAt || ''}`;
  const hit = metaCache.get(cacheKey);
  if (hit) return hit;

  const art = artFor(list.id);
  const seriesArt = proxiedSeriesArt();
  const videos = full ? buildListVideos(list, index) : undefined;
  const eps = (list.items || []).filter((i) => i.kind === 'episode').length;
  const movies = (list.items || []).filter((i) => i.kind === 'movie').length;
  const ovas = (list.items || []).filter((i) => i.kind === 'ova').length;
  const specials = (list.items || []).filter(
    (i) => i.kind === 'special'
  ).length;

  const badge = groupLabel(list.group);
  const subtitle = list.name.replace(/^Lista [A-D]\s*[—–-]\s*/i, '').trim();
  const guideNames = {
    'lista-a': 'Lista A · Casi completo',
    'lista-b': 'Lista B · Recomendada',
    'lista-c': 'Lista C · Esencial',
    'lista-d': 'Lista D · Repaso / spoilers',
    'movies-all': 'Películas',
    'solo-peliculas': 'Películas (orden guía)',
  };
  const displayName =
    guideNames[list.id] ||
    (list.group === 'guias'
      ? `${list.short} · ${subtitle}`
      : `${badge} · ${list.short}`);

  const genreChip =
    list.id === 'movies-all' || list.id === 'solo-peliculas'
      ? 'Películas'
      : genreForGroup(list.group);
  const recommended = list.id === 'lista-b' ? ' · Recomendada' : '';
  const spoilers = list.id === 'lista-d' ? ' · Spoilers' : '';

  const parts = [
    list.description?.trim() || list.name,
    blurbForList(list),
    '',
    `${list.itemCount} entradas en orden · ${eps} caps · ${movies} películas · ${ovas} OVAs · ${specials} especiales`,
    '',
    'Añádela a tu biblioteca para seguir el progreso.',
  ];

  const meta = {
    id: `bk:list:${list.id}`,
    type: 'series',
    name: displayName,
    poster: art.poster,
    background: art.background,
    logo: art.logo || seriesArt.logo,
    posterShape: 'poster',
    description: parts.filter((p) => p !== undefined).join('\n'),
    releaseInfo: `${badge}${recommended}${spoilers} · ${list.itemCount} entradas`,
    genres: ['Anime', 'Misterio', genreChip],
    runtime: '25 min',
    imdbRating: list.id === 'lista-b' ? '9.0' : list.group === 'guias' ? '8.5' : '8.0',
    videos,
  };
  metaCache.set(cacheKey, meta, META_TTL_MS);
  return meta;
}

export function seasonMeta(seasonNumber, index, { full = false } = {}) {
  const cacheKey = `season:v4:${seasonNumber}:${full ? 'full' : 'card'}:${index.scrapedAt || ''}`;
  const hit = metaCache.get(cacheKey);
  if (hit) return hit;

  const absToSeason = buildAbsoluteToSeason();
  const map = loadSeasonMap();
  const start = map.seasonStarts?.[String(seasonNumber)];
  const episodes = (index.episodes || []).filter(
    (e) => absToSeason.get(e.episode) === seasonNumber
  );
  const art = proxiedSeasonArt(seasonNumber);
  const seriesArt = proxiedSeriesArt();
  const fillers = fillerEpisodeSet();
  const videos = full
    ? episodes.map((ep, i) => ({
        id: `${CONAN_IMDB}:1:${ep.episode}`,
        title: `${String(ep.episode).padStart(3, '0')}. ${ep.title}`,
        season: seasonNumber,
        episode: i + 1,
        episodeNo: i + 1,
        overview: `${fillers.has(ep.episode) ? 'Relleno' : 'Canon'} · Cap. absoluto ${ep.episode} · T${seasonNumber}`,
      }))
    : undefined;

  const first = episodes[0]?.episode ?? start ?? '?';
  const last = episodes[episodes.length - 1]?.episode ?? '?';
  const n = String(seasonNumber).padStart(2, '0');

  const meta = {
    id: `bk:season:${seasonNumber}`,
    type: 'series',
    name: `Temporada ${n} · Caps ${first}–${last}`,
    poster: art.poster,
    background: art.background,
    logo: seriesArt.logo,
    posterShape: 'poster',
    description: [
      `Detective Conan — Temporada ${seasonNumber} (DVD / Case Closed).`,
      `Capítulos absolutos ${first}–${last} · ${episodes.length} episodios.`,
      '',
      'Numeración de temporada al estilo Case Closed; los streams usan el número absoluto de BiblioKudo.',
      'Añádela a tu biblioteca para maratonar por temporada.',
    ].join('\n'),
    releaseInfo: `Temporada · ${episodes.length} eps`,
    genres: ['Anime', 'Misterio', GENRE_TEMPORADAS],
    runtime: '25 min',
    videos,
  };
  metaCache.set(cacheKey, meta, META_TTL_MS);
  return meta;
}

export function listSeasonNumbers(index) {
  const absToSeason = buildAbsoluteToSeason();
  const set = new Set();
  for (const ep of index.episodes || []) {
    const s = absToSeason.get(ep.episode);
    if (s) set.add(s);
  }
  return [...set].sort((a, b) => a - b);
}
