import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONAN_IMDB, loadSeasonMap } from './episode-id.js';
import { findEpisode, findSpecial, findMovie } from './index-maps.js';
import { createTtlCache } from './response-cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LISTS_PATH = path.join(__dirname, '..', 'data', 'watch-lists.json');

const metaCache = createTtlCache({ max: 80, name: 'list-meta' });
const META_TTL_MS = 10 * 60 * 1000;

/** @type {Map<number, number> | null} */
let absToSeasonCache = null;

/** Distinct Conan movie / series posters (MAL) — reliable anime covers, not character thumbs. */
export const ART = {
  default: {
    poster: 'https://cdn.myanimelist.net/images/anime/7/73936.jpg',
    background: 'https://cdn.myanimelist.net/images/anime/7/73936l.jpg',
    logo: 'https://cdn.myanimelist.net/images/anime/7/73936t.jpg',
  },
  // Guías A–D → películas icónicas
  'lista-a': {
    poster: 'https://cdn.myanimelist.net/images/anime/7/20981.jpg', // P1 Rascacielos
    background: 'https://cdn.myanimelist.net/images/anime/7/20981l.jpg',
  },
  'lista-b': {
    poster: 'https://cdn.myanimelist.net/images/anime/5/20982.jpg', // P2 14ª víctima
    background: 'https://cdn.myanimelist.net/images/anime/5/20982l.jpg',
  },
  'lista-c': {
    poster: 'https://cdn.myanimelist.net/images/anime/2/20983.jpg', // P3 mago
    background: 'https://cdn.myanimelist.net/images/anime/2/20983l.jpg',
  },
  'lista-d': {
    poster: 'https://cdn.myanimelist.net/images/anime/9/20984.jpg', // P4 ojos
    background: 'https://cdn.myanimelist.net/images/anime/9/20984l.jpg',
  },
  'hombres-negro': {
    poster: 'https://cdn.myanimelist.net/images/anime/13/45587.jpg', // P13 chase
    background: 'https://cdn.myanimelist.net/images/anime/13/45587l.jpg',
  },
  shinran: {
    poster: 'https://cdn.myanimelist.net/images/anime/10/78317.jpg', // P20
    background: 'https://cdn.myanimelist.net/images/anime/10/78317l.jpg',
  },
  conan: {
    poster: 'https://cdn.myanimelist.net/images/anime/7/73936.jpg',
    background: 'https://cdn.myanimelist.net/images/anime/7/73936l.jpg',
  },
  ran: {
    poster: 'https://cdn.myanimelist.net/images/anime/4/75478.jpg', // P18
    background: 'https://cdn.myanimelist.net/images/anime/4/75478l.jpg',
  },
  ninos: {
    poster: 'https://cdn.myanimelist.net/images/anime/11/39717.jpg', // P11
    background: 'https://cdn.myanimelist.net/images/anime/11/39717l.jpg',
  },
  haibara: {
    poster: 'https://cdn.myanimelist.net/images/anime/9/56621.jpg', // P14
    background: 'https://cdn.myanimelist.net/images/anime/9/56621l.jpg',
  },
  kogoro: {
    poster: 'https://cdn.myanimelist.net/images/anime/6/20985.jpg', // P5
    background: 'https://cdn.myanimelist.net/images/anime/6/20985l.jpg',
  },
  'kogoro-eri': {
    poster: 'https://cdn.myanimelist.net/images/anime/8/56619.jpg', // P12
    background: 'https://cdn.myanimelist.net/images/anime/8/56619l.jpg',
  },
  kid: {
    poster: 'https://cdn.myanimelist.net/images/anime/3/20986.jpg', // P3 vibe / Kid
    background: 'https://cdn.myanimelist.net/images/anime/3/20986l.jpg',
  },
  heiji: {
    poster: 'https://cdn.myanimelist.net/images/anime/2/56618.jpg', // P10
    background: 'https://cdn.myanimelist.net/images/anime/2/56618l.jpg',
  },
  sonoko: {
    poster: 'https://cdn.myanimelist.net/images/anime/5/39716.jpg', // P8
    background: 'https://cdn.myanimelist.net/images/anime/5/39716l.jpg',
  },
  fbi: {
    poster: 'https://cdn.myanimelist.net/images/anime/13/45587.jpg',
    background: 'https://cdn.myanimelist.net/images/anime/13/45587l.jpg',
  },
  amuro: {
    poster: 'https://cdn.myanimelist.net/images/anime/10/78317.jpg',
    background: 'https://cdn.myanimelist.net/images/anime/10/78317l.jpg',
  },
  policias: {
    poster: 'https://cdn.myanimelist.net/images/anime/6/39715.jpg', // P7
    background: 'https://cdn.myanimelist.net/images/anime/6/39715l.jpg',
  },
  'matrimonio-kudo': {
    poster: 'https://cdn.myanimelist.net/images/anime/9/75479.jpg', // Episodio ONE vibe
    background: 'https://cdn.myanimelist.net/images/anime/9/75479l.jpg',
  },
  nagano: {
    poster: 'https://cdn.myanimelist.net/images/anime/4/56620.jpg', // P13 alt
    background: 'https://cdn.myanimelist.net/images/anime/4/56620l.jpg',
  },
  'mejores-rellenos': {
    poster: 'https://cdn.myanimelist.net/images/anime/8/20987.jpg', // P6
    background: 'https://cdn.myanimelist.net/images/anime/8/20987l.jpg',
  },
  'mejores-casos': {
    poster: 'https://cdn.myanimelist.net/images/anime/12/39718.jpg', // P9
    background: 'https://cdn.myanimelist.net/images/anime/12/39718l.jpg',
  },
  seasons: {
    poster: 'https://cdn.myanimelist.net/images/anime/7/73936.jpg',
    background: 'https://cdn.myanimelist.net/images/anime/7/73936l.jpg',
  },
};

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
  return 'Lista';
}

let cached = null;

export function loadWatchLists() {
  if (cached) return cached;
  cached = JSON.parse(fs.readFileSync(LISTS_PATH, 'utf8'));
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
  return { ...ART.default, ...(ART[listId] || {}) };
}

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
  if (item.kind === 'episode') {
    const ep = findEpisode(index, item.episode);
    const season = absToSeason.get(item.episode) || 1;
    return {
      videoId: `${CONAN_IMDB}:1:${item.episode}`,
      title: ep?.title
        ? `${String(item.episode).padStart(3, '0')}. ${ep.title}`
        : `${String(item.episode).padStart(3, '0')}. ${item.title}`,
      season,
      overview: `Cap. ${item.episode} · orden de la lista`,
      kind: 'episode',
      absolute: item.episode,
      hasLinks: Boolean(ep?.links?.length),
    };
  }

  if (item.kind === 'movie') {
    const movie = findMovieInIndex(index, item);
    const num = item.movieNumber;
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
    const sp = spIdx != null ? findSpecial(index, spIdx) : null;
    return {
      videoId: spIdx ? `${CONAN_IMDB}:0:${spIdx}` : `bk:ova:${item.ovaNumber}`,
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
    return {
      videoId: sp
        ? `${CONAN_IMDB}:0:${sp.specialIndex}`
        : `bk:special:${encodeURIComponent(item.title)}`,
      title: sp?.title || item.title,
      season: null,
      overview: 'Especial · orden de la guía',
      kind: 'special',
      specialIndex: sp?.specialIndex,
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

  for (const item of list.items || []) {
    const resolved = resolveListItem(item, index, absToSeason);
    if (!resolved) continue;

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
  const cacheKey = `list:${list.id}:${full ? 'full' : 'card'}:${index.scrapedAt || ''}`;
  const hit = metaCache.get(cacheKey);
  if (hit) return hit;

  const art = artFor(list.id);
  const videos = full ? buildListVideos(list, index) : undefined;
  const eps = (list.items || []).filter((i) => i.kind === 'episode').length;
  const movies = (list.items || []).filter((i) => i.kind === 'movie').length;
  const ovas = (list.items || []).filter((i) => i.kind === 'ova').length;
  const specials = (list.items || []).filter(
    (i) => i.kind === 'special'
  ).length;

  const badge = groupLabel(list.group);
  const displayName =
    list.group === 'guias'
      ? `${list.short} · ${list.name.replace(/^Lista [A-D]\s*[—–-]\s*/i, '')}`
      : `${badge} · ${list.short}`;

  const meta = {
    id: `bk:list:${list.id}`,
    type: 'series',
    name: displayName,
    poster: art.poster,
    background: art.background,
    logo: art.logo || ART.default.logo,
    posterShape: 'poster',
    description: [
      list.description,
      '',
      `${list.itemCount} entradas en orden · ${eps} caps · ${movies} películas · ${ovas} OVAs · ${specials} especiales.`,
      'Añádela a tu biblioteca para seguir el progreso.',
    ].join('\n'),
    releaseInfo: `${list.itemCount} entradas`,
    genres:
      list.group === 'guias'
        ? ['Anime', 'Misterio', 'Guía de visionado']
        : list.group === 'personajes'
          ? ['Anime', 'Misterio', 'Personajes']
          : ['Anime', 'Misterio', 'Selección'],
    runtime: '25 min',
    videos,
  };
  metaCache.set(cacheKey, meta, META_TTL_MS);
  return meta;
}

export function seasonMeta(seasonNumber, index, { full = false } = {}) {
  const cacheKey = `season:${seasonNumber}:${full ? 'full' : 'card'}:${index.scrapedAt || ''}`;
  const hit = metaCache.get(cacheKey);
  if (hit) return hit;

  const absToSeason = buildAbsoluteToSeason();
  const map = loadSeasonMap();
  const start = map.seasonStarts?.[String(seasonNumber)];
  const episodes = (index.episodes || []).filter(
    (e) => absToSeason.get(e.episode) === seasonNumber
  );
  const art = ART.seasons;
  const videos = full
    ? episodes.map((ep, i) => ({
        id: `${CONAN_IMDB}:1:${ep.episode}`,
        title: `${String(ep.episode).padStart(3, '0')}. ${ep.title}`,
        season: seasonNumber,
        episode: i + 1,
        episodeNo: i + 1,
        overview: `Cap. absoluto ${ep.episode} · Temporada ${seasonNumber}`,
      }))
    : undefined;

  const first = episodes[0]?.episode ?? start ?? '?';
  const last = episodes[episodes.length - 1]?.episode ?? '?';

  const meta = {
    id: `bk:season:${seasonNumber}`,
    type: 'series',
    name: `Temporada ${String(seasonNumber).padStart(2, '0')} · Caps ${first}–${last}`,
    poster: art.poster,
    background: art.background,
    logo: ART.default.logo,
    posterShape: 'poster',
    description: `Detective Conan — Temporada ${seasonNumber} (DVD / Case Closed).\nCapítulos absolutos ${first}–${last} · ${episodes.length} episodios.\nAñádela a tu biblioteca para maratonar por temporada.`,
    releaseInfo: `T${seasonNumber} · ${episodes.length} eps`,
    genres: ['Anime', 'Misterio', 'Temporada'],
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
