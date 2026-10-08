import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONAN_IMDB, loadSeasonMap } from './episode-id.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LISTS_PATH = path.join(__dirname, '..', 'data', 'watch-lists.json');

/** Distinct posters / backgrounds per catalog (MAL / official art). */
export const ART = {
  default: {
    poster: 'https://cdn.myanimelist.net/images/anime/7/73936.jpg',
    background: 'https://cdn.myanimelist.net/images/anime/7/73936l.jpg',
    logo: 'https://cdn.myanimelist.net/images/anime/7/73936t.jpg',
  },
  'lista-a': {
    poster: 'https://cdn.myanimelist.net/images/anime/7/73936.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/7/73936l.jpg',
  },
  'lista-b': {
    poster: 'https://cdn.myanimelist.net/images/anime/2/73806.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/2/73806l.jpg',
  },
  'lista-c': {
    poster: 'https://cdn.myanimelist.net/images/anime/11/73807.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/11/73807l.jpg',
  },
  'lista-d': {
    poster: 'https://cdn.myanimelist.net/images/anime/13/73808.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/13/73808l.jpg',
  },
  'hombres-negro': {
    poster: 'https://cdn.myanimelist.net/images/anime/5/65187.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/5/65187l.jpg',
  },
  shinran: {
    poster: 'https://cdn.myanimelist.net/images/anime/4/19632.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/4/19632l.jpg',
  },
  conan: {
    poster: 'https://cdn.myanimelist.net/images/anime/7/73936.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/7/73936l.jpg',
  },
  ran: {
    poster: 'https://cdn.myanimelist.net/images/anime/9/20471.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/9/20471l.jpg',
  },
  ninos: {
    poster: 'https://cdn.myanimelist.net/images/anime/3/73809.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/3/73809l.jpg',
  },
  haibara: {
    poster: 'https://cdn.myanimelist.net/images/characters/9/32270.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/7/73936l.jpg',
  },
  kogoro: {
    poster: 'https://cdn.myanimelist.net/images/characters/6/32271.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/7/73936l.jpg',
  },
  'kogoro-eri': {
    poster: 'https://cdn.myanimelist.net/images/characters/11/50567.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/7/73936l.jpg',
  },
  kid: {
    poster: 'https://cdn.myanimelist.net/images/anime/9/20471.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/9/20471l.jpg',
  },
  heiji: {
    poster: 'https://cdn.myanimelist.net/images/characters/4/32272.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/7/73936l.jpg',
  },
  sonoko: {
    poster: 'https://cdn.myanimelist.net/images/characters/14/32273.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/7/73936l.jpg',
  },
  fbi: {
    poster: 'https://cdn.myanimelist.net/images/anime/5/65187.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/5/65187l.jpg',
  },
  amuro: {
    poster: 'https://cdn.myanimelist.net/images/characters/6/310307.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/5/65187l.jpg',
  },
  policias: {
    poster: 'https://cdn.myanimelist.net/images/characters/8/32274.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/7/73936l.jpg',
  },
  'matrimonio-kudo': {
    poster: 'https://cdn.myanimelist.net/images/characters/9/50568.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/7/73936l.jpg',
  },
  nagano: {
    poster: 'https://cdn.myanimelist.net/images/anime/5/65187.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/5/65187l.jpg',
  },
  'mejores-rellenos': {
    poster: 'https://cdn.myanimelist.net/images/anime/2/73806.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/2/73806l.jpg',
  },
  'mejores-casos': {
    poster: 'https://cdn.myanimelist.net/images/anime/11/73807.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/11/73807l.jpg',
  },
  seasons: {
    poster: 'https://cdn.myanimelist.net/images/anime/13/73808.jpg',
    background:
      'https://cdn.myanimelist.net/images/anime/13/73808l.jpg',
  },
};

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

/** Build absolute → Wikipedia DVD season using seasonStarts. */
export function buildAbsoluteToSeason() {
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
  // Prefer explicit seMap overrides
  for (const [key, abs] of Object.entries(
    map.seasonEpisodeToAbsolute || {}
  )) {
    const season = Number(String(key).split(':')[0]);
    if (Number.isFinite(season) && Number.isFinite(abs)) {
      absToSeason.set(Number(abs), season);
    }
  }
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
    return (
      (index.movies || []).find(
        (m) => m.movieNumber === item.movieNumber
      ) || null
    );
  }
  return null;
}

/**
 * Resolve a list item to a playable video id + display fields.
 */
export function resolveListItem(item, index, absToSeason) {
  if (item.kind === 'episode') {
    const ep = (index.episodes || []).find(
      (e) => e.episode === item.episode
    );
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
    const sp = (index.specials || []).find(
      (s) => s.specialIndex === spIdx
    );
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
  const art = artFor(list.id);
  const videos = full ? buildListVideos(list, index) : undefined;
  const eps = (list.items || []).filter((i) => i.kind === 'episode').length;
  const movies = (list.items || []).filter((i) => i.kind === 'movie').length;
  const ovas = (list.items || []).filter((i) => i.kind === 'ova').length;
  const specials = (list.items || []).filter(
    (i) => i.kind === 'special'
  ).length;

  return {
    id: `bk:list:${list.id}`,
    type: 'series',
    name: list.name,
    poster: art.poster,
    background: art.background,
    logo: art.logo || ART.default.logo,
    posterShape: 'poster',
    description: `${list.description}\n\n${list.itemCount} entradas · ${eps} caps · ${movies} películas · ${ovas} OVAs · ${specials} especiales.\nOrden fiel a la guía PDF.`,
    releaseInfo: 'Guía de visionado',
    genres: ['Anime', 'Misterio', 'Guía'],
    videos,
  };
}

export function seasonMeta(seasonNumber, index, { full = false } = {}) {
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

  return {
    id: `bk:season:${seasonNumber}`,
    type: 'series',
    name: `Detective Conan — Temporada ${seasonNumber}`,
    poster: art.poster,
    background: art.background,
    logo: ART.default.logo,
    posterShape: 'poster',
    description: `Temporada ${seasonNumber} (numeración DVD / Case Closed).\nCapítulos absolutos ${first}–${last} · ${episodes.length} episodios.`,
    releaseInfo: `T${seasonNumber}`,
    genres: ['Anime', 'Misterio'],
    videos,
  };
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
