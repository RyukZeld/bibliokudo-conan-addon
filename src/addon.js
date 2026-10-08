import addonSdk from 'stremio-addon-sdk';
import { getIndex, ensureIndex } from './cache.js';
import {
  streamSortKey,
  streamName,
  streamDescription,
  effectiveRole,
} from './hosts.js';
import {
  isStreamtapeUrl,
  resolveStreamtape,
} from './resolvers/streamtape.js';
import {
  resolveConanEpisode,
  CONAN_IMDB,
  isConanSeriesId,
  parseStremioId,
} from './episode-id.js';
import {
  findSpanishSubtitles,
  toStremioSubtitles,
  subtitlesForRequest,
} from './subtitles/index.js';
import {
  allLists,
  getList,
  listMeta,
  seasonMeta,
  listSeasonNumbers,
  findMovieInIndex,
} from './watch-lists.js';

const { addonBuilder } = addonSdk;

const POSTER =
  'https://cdn.myanimelist.net/images/anime/7/73936.jpg';
const BACKGROUND =
  'https://cdn.myanimelist.net/images/anime/7/73936l.jpg';
const LOGO =
  'https://cdn.myanimelist.net/images/anime/7/73936t.jpg';

/** Catalog id (custom). Streams also answer Cinemeta/TMDB ids. */
const SERIES_ID = 'bk:conan';
const MAX_RESOLVE = 3;

export const manifest = {
  id: 'community.bibliokudo.detectiveconan',
  version: '1.4.0',
  name: 'Detective Conan (BiblioKudo ES)',
  description:
    'Detective Conan en ES (BiblioKudo): temporadas, guías de visionado (Listas A–D + personajes), películas/OVAs en orden, streams y subtítulos fan.',
  logo: LOGO,
  background: BACKGROUND,
  resources: [
    {
      name: 'catalog',
      types: ['series', 'movie'],
      idPrefixes: ['bk:'],
    },
    {
      name: 'meta',
      types: ['series', 'movie'],
      idPrefixes: ['tt', 'tmdb:', 'tvdb:', 'bk:', 'kitsu:', 'mal:', 'anilist:'],
    },
    {
      name: 'stream',
      types: ['series', 'movie'],
      idPrefixes: ['tt', 'tmdb:', 'tvdb:', 'bk:', 'kitsu:', 'mal:', 'anilist:'],
    },
    {
      name: 'subtitles',
      types: ['series', 'movie'],
    },
  ],
  types: ['series', 'movie'],
  catalogs: [
    {
      type: 'series',
      id: 'bk-conan-series',
      name: 'Detective Conan (todo)',
      extra: [{ name: 'search', isRequired: false }],
    },
    {
      type: 'series',
      id: 'bk-conan-seasons',
      name: 'Por temporadas',
      extra: [{ name: 'search', isRequired: false }],
    },
    {
      type: 'series',
      id: 'bk-conan-guias',
      name: 'Guías de visionado',
      extra: [{ name: 'search', isRequired: false }],
    },
    {
      type: 'series',
      id: 'bk-conan-personajes',
      name: 'Por personaje',
      extra: [{ name: 'search', isRequired: false }],
    },
    {
      type: 'series',
      id: 'bk-conan-extras',
      name: 'Mejores rellenos / casos',
      extra: [{ name: 'search', isRequired: false }],
    },
    {
      type: 'movie',
      id: 'bk-conan-movies',
      name: 'Películas',
      extra: [{ name: 'search', isRequired: false }],
    },
  ],
  behaviorHints: {
    adultContent: false,
    configurable: false,
  },
};

function filterBySearch(metas, q) {
  if (!q) return metas;
  return metas.filter(
    (m) =>
      (m.name || '').toLowerCase().includes(q) ||
      (m.description || '').toLowerCase().includes(q)
  );
}

function seriesMeta(index, full = false) {
  const videos = [];
  if (full) {
    for (const ep of index.episodes) {
      const num = String(ep.episode).padStart(3, '0');
      // Cinemeta-compatible absolute ids (season 1 = absolute numbering)
      videos.push({
        id: `${CONAN_IMDB}:1:${ep.episode}`,
        title: `${num}. ${ep.title}`,
        season: 1,
        episode: ep.episode,
        episodeNo: ep.episode,
        overview: ep.links?.length
          ? `${ep.links.length} fuentes · BiblioKudo`
          : 'Sin enlaces aún',
      });
    }
    for (const sp of index.specials) {
      videos.push({
        id: `${CONAN_IMDB}:0:${sp.specialIndex}`,
        title: sp.title,
        season: 0,
        episode: sp.specialIndex,
        overview: sp.kind ? `Tipo: ${sp.kind}` : undefined,
      });
    }
  }
  const when = index.scrapedAt
    ? new Date(index.scrapedAt).toISOString().slice(0, 10)
    : '?';
  return {
    // Same IMDb id as Cinemeta so Nuvio/Stremio merge catalogs
    id: CONAN_IMDB,
    imdb_id: CONAN_IMDB,
    type: 'series',
    name: 'Detective Conan',
    poster: POSTER,
    background: BACKGROUND,
    logo: LOGO,
    posterShape: 'poster',
    description: `Detective Conan en español (fansubs vía BiblioKudo).\n${index.stats.episodeCount} episodios · ${index.stats.movieCount} películas · ${index.stats.specialCount} especiales/OVAs.\nActualizado: ${when}`,
    releaseInfo: `1996–${new Date().getFullYear()}`,
    genres: ['Anime', 'Misterio', 'Comedia'],
    runtime: '25 min',
    videos: full ? videos : undefined,
  };
}

function movieMeta(m) {
  return {
    id: `bk:movie:${m.movieNumber}`,
    type: 'movie',
    name: m.title || `Película ${m.movieNumber}`,
    poster: POSTER,
    background: BACKGROUND,
    posterShape: 'poster',
    description: `Detective Conan — Película ${m.movieNumber} (ES, BiblioKudo)${
      m.links?.length ? `\n${m.links.length} fuentes` : ''
    }`,
  };
}

async function linksToStreams(links, { subtitles } = {}) {
  const sorted = [...(links || [])].sort(
    (a, b) => streamSortKey(a) - streamSortKey(b)
  );
  // Dedupe by host+role keeping first (best) of each host for streaming
  const seenHosts = new Set();
  const deduped = [];
  for (const link of sorted) {
    const role = effectiveRole(link);
    // Allow up to 2 streamtape mirrors, 1 of everything else per role
    const stCount = deduped.filter(
      (l) => isStreamtapeUrl(l.url) && effectiveRole(l) === 'stream'
    ).length;
    if (isStreamtapeUrl(link.url) && role === 'stream') {
      if (stCount >= 2) continue;
    } else if (seenHosts.has(`${role}:${link.host}`)) {
      continue;
    } else {
      seenHosts.add(`${role}:${link.host}`);
    }
    deduped.push(link);
  }

  const streams = [];
  let resolved = 0;
  const subTracks =
    subtitles && subtitles.length ? toStremioSubtitles(subtitles) : undefined;

  for (const link of deduped) {
    const name = streamName(link);
    const description = streamDescription(link);
    const wantResolve =
      (link.playable || effectiveRole(link) === 'stream') &&
      isStreamtapeUrl(link.url) &&
      resolved < MAX_RESOLVE;

    if (wantResolve) {
      resolved += 1;
      try {
        const media = await resolveStreamtape(link.url);
        if (media) {
          streams.push({
            name: `${name} ▶`,
            title: name,
            description,
            url: media,
            subtitles: subTracks,
            behaviorHints: {
              notWebReady: true,
              bingeGroup: 'bk-streamtape',
              proxyHeaders: {
                request: {
                  Referer: 'https://streamtape.com/',
                  'User-Agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
              },
            },
          });
          continue;
        }
      } catch (err) {
        console.warn('[stream] streamtape resolve failed:', err.message);
      }
    }

    streams.push({
      name: `${name} ↗`,
      title: name,
      description: description || 'Abrir en navegador',
      externalUrl: link.url,
      subtitles: subTracks,
    });
  }
  return streams;
}

async function subsForResolved(resolved, id) {
  if (!resolved || resolved.type !== 'episode') return [];
  const parsed = parseStremioId(id);
  try {
    return await findSpanishSubtitles({
      absolute: resolved.absolute,
      season: parsed?.season,
      episode: parsed?.episode,
    });
  } catch (err) {
    console.warn('[subs] lookup failed:', err.message);
    return [];
  }
}

export function createAddon() {
  const builder = new addonBuilder(manifest);

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    await ensureIndex();
    const index = await getIndex();
    const q = (extra?.search || '').toLowerCase().trim();

    if (type === 'series' && id === 'bk-conan-series') {
      const meta = seriesMeta(index, false);
      return { metas: filterBySearch([meta], q) };
    }

    if (type === 'series' && id === 'bk-conan-seasons') {
      const metas = listSeasonNumbers(index).map((n) =>
        seasonMeta(n, index, { full: false })
      );
      return { metas: filterBySearch(metas, q) };
    }

    if (type === 'series' && id === 'bk-conan-guias') {
      const metas = allLists()
        .filter((l) => l.group === 'guias')
        .map((l) => listMeta(l, index, { full: false }));
      return { metas: filterBySearch(metas, q) };
    }

    if (type === 'series' && id === 'bk-conan-personajes') {
      const metas = allLists()
        .filter((l) => l.group === 'personajes')
        .map((l) => listMeta(l, index, { full: false }));
      return { metas: filterBySearch(metas, q) };
    }

    if (type === 'series' && id === 'bk-conan-extras') {
      const metas = allLists()
        .filter((l) => l.group === 'extras')
        .map((l) => listMeta(l, index, { full: false }));
      return { metas: filterBySearch(metas, q) };
    }

    if (type === 'movie' && id === 'bk-conan-movies') {
      let movies = index.movies;
      if (q) {
        movies = movies.filter(
          (m) =>
            (m.title || '').toLowerCase().includes(q) ||
            String(m.movieNumber).includes(q)
        );
      }
      return { metas: movies.map(movieMeta) };
    }

    return { metas: [] };
  });

  builder.defineMetaHandler(async ({ type, id }) => {
    await ensureIndex();
    const index = await getIndex();

    if (type === 'series' && id.startsWith('bk:list:')) {
      const listId = id.slice('bk:list:'.length);
      const list = getList(listId);
      if (!list) return { meta: null };
      return { meta: listMeta(list, index, { full: true }) };
    }

    if (type === 'series' && id.startsWith('bk:season:')) {
      const n = Number(id.split(':')[2]);
      if (!Number.isFinite(n)) return { meta: null };
      return { meta: seasonMeta(n, index, { full: true }) };
    }

    if (
      type === 'series' &&
      (id === SERIES_ID ||
        id === 'bk:conan' ||
        id === CONAN_IMDB ||
        isConanSeriesId(id))
    ) {
      return { meta: seriesMeta(index, true) };
    }

    if (type === 'movie' && id.startsWith('bk:movie:')) {
      const key = id.slice('bk:movie:'.length);
      if (key === 'lupin') {
        const m = findMovieInIndex(index, { movieKey: 'lupin' });
        if (!m) return { meta: null };
        return { meta: movieMeta(m) };
      }
      const num = Number(key);
      const m = index.movies.find((x) => x.movieNumber === num);
      if (!m) return { meta: null };
      return { meta: movieMeta(m) };
    }

    return { meta: null };
  });

  builder.defineStreamHandler(async ({ type, id }) => {
    await ensureIndex();
    const index = await getIndex();

    if (type === 'series') {
      const resolved = resolveConanEpisode(id);
      if (resolved) {
        if (resolved.type === 'special') {
          const sp = index.specials.find(
            (s) => s.specialIndex === resolved.specialIndex
          );
          if (!sp) return { streams: [] };
          return { streams: await linksToStreams(sp.links) };
        }
        const ep = index.episodes.find((e) => e.episode === resolved.absolute);
        if (!ep) {
          console.warn(
            `[stream] no episode ${resolved.absolute} for id=${id}`
          );
          return { streams: [] };
        }
        const subs = await subsForResolved(resolved, id);
        console.log(
          `[stream] ${id} → abs #${resolved.absolute} (${ep.title}) subs=${subs.length}`
        );
        const streams = await linksToStreams(ep.links, { subtitles: subs });
        // BiblioKudo encodes Spanish hardsubs; softsubs cover JP audio / early eps
        if (!subs.length) {
          for (const s of streams) {
            const extra = 'Vídeo ES (hardsub BK). Softsubs fan no disponibles para este cap.';
            s.description = s.description ? `${s.description}\n${extra}` : extra;
          }
        }
        return { streams };
      }

      // Legacy bk:conan:N / bk:conan:s0:N if resolver missed
      const parsed = parseStremioId(id);
      if (parsed?.seriesId === 'bk:conan') {
        if (parsed.season === 0) {
          const sp = index.specials.find((s) => s.specialIndex === parsed.episode);
          if (!sp) return { streams: [] };
          return { streams: await linksToStreams(sp.links) };
        }
        const ep = index.episodes.find((e) => e.episode === parsed.episode);
        if (!ep) return { streams: [] };
        const subs = await findSpanishSubtitles({
          absolute: parsed.episode,
          season: 1,
          episode: parsed.episode,
        }).catch(() => []);
        return { streams: await linksToStreams(ep.links, { subtitles: subs }) };
      }
    }

    if (type === 'movie' && id.startsWith('bk:movie:')) {
      const key = id.slice('bk:movie:'.length);
      const m =
        key === 'lupin'
          ? findMovieInIndex(index, { movieKey: 'lupin' })
          : index.movies.find((x) => x.movieNumber === Number(key));
      if (!m) return { streams: [] };
      return { streams: await linksToStreams(m.links) };
    }

    return { streams: [] };
  });

  builder.defineSubtitlesHandler(async (args) => {
    const { type, id, extra } = args || {};
    if (type && type !== 'series' && type !== 'movie') {
      return { subtitles: [] };
    }
    try {
      // Works for BiblioKudo streams and third-party addons (Torrentio, …)
      const records = await subtitlesForRequest({ id, extra });
      const subtitles = toStremioSubtitles(records);
      console.log(
        `[subs] id=${id} file=${extra?.filename || '-'} → ${subtitles.length} ES`
      );
      return { subtitles, cacheMaxAge: 3600 };
    } catch (err) {
      console.warn('[subs] handler error:', err.message);
      return { subtitles: [] };
    }
  });

  return builder.getInterface();
}
