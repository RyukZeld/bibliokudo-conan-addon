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
  listMatchesQuery,
} from './watch-lists.js';
import { findEpisode, findSpecial, findMovie } from './index-maps.js';
import { createTtlCache } from './response-cache.js';

const { addonBuilder } = addonSdk;

const streamCache = createTtlCache({ max: 300, name: 'streams' });
const STREAM_TTL_MS = 5 * 60 * 1000;

/** Order in Biblioteca / Discover home. */
const BIBLIOTECA_LIST_IDS = [
  'lista-a',
  'lista-b',
  'lista-c',
  'lista-d',
  'hombres-negro',
  'shinran',
  'haibara',
  'kid',
  'amuro',
  'heiji',
  'mejores-rellenos',
  'mejores-casos',
];

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
  version: '1.5.1',
  name: 'Detective Conan (BiblioKudo ES)',
  description:
    'Biblioteca Conan ES: Listas A–D, personajes, temporadas y películas en orden. Streams BiblioKudo + softsubs ES. Busca «Lista B», «Haibara», «Kid»…',
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
      id: 'bk-conan-biblioteca',
      name: 'Biblioteca Conan',
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
      id: 'bk-conan-seasons',
      name: 'Por temporadas',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false },
      ],
    },
    {
      type: 'series',
      id: 'bk-conan-extras',
      name: 'Mejores rellenos / casos',
      extra: [{ name: 'search', isRequired: false }],
    },
    {
      type: 'series',
      id: 'bk-conan-series',
      name: 'Serie completa',
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

function normalizeQ(q) {
  return String(q || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function metaMatchesSearch(meta, q) {
  if (!q) return true;
  const nq = normalizeQ(q);
  const blob = normalizeQ(
    `${meta.name || ''} ${meta.description || ''} ${meta.releaseInfo || ''} ${(meta.genres || []).join(' ')}`
  );
  if (blob.includes(nq)) return true;
  const tokens = nq.split(/\s+/).filter(Boolean);
  return tokens.every((t) => {
    if (t.length <= 2) {
      return new RegExp(`(?:^|\\s)${escapeRegExp(t)}(?:\\s|$)`).test(blob);
    }
    return blob.includes(t);
  });
}

function filterBySearch(metas, q) {
  if (!q) return metas;
  return metas.filter((m) => metaMatchesSearch(m, q));
}

function listsAsMetas(index, { group, ids, q } = {}) {
  let lists = allLists();
  if (group) lists = lists.filter((l) => l.group === group);
  if (ids) {
    const set = new Set(ids);
    lists = lists.filter((l) => set.has(l.id));
    lists.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  }
  if (q) lists = lists.filter((l) => listMatchesQuery(l, q));
  return lists.map((l) => listMeta(l, index, { full: false }));
}

/** Full Search: serie + todas las listas + temporadas relevantes. */
function searchBiblioteca(index, q) {
  const nq = normalizeQ(q);
  const out = [];
  const seen = new Set();
  const push = (meta) => {
    if (!meta?.id || seen.has(meta.id)) return;
    seen.add(meta.id);
    out.push(meta);
  };

  const main = seriesMeta(index, false);
  // Only surface the full series for broad queries — not every "lista X" hit.
  if (
    !q ||
    metaMatchesSearch(main, q) ||
    /^(conan|detective|meitantei|case closed|biblioteca|serie completa|serie)$/.test(nq) ||
    /^(conan|detective conan|meitantei conan|case closed)\b/.test(nq)
  ) {
    push(main);
  }

  const listHits = listsAsMetas(index, { q: q || undefined });
  // Prefer exact / short-name hits first (Lista B before Lista A when query is "lista b")
  listHits.sort((a, b) => {
    const an = normalizeQ(a.name);
    const bn = normalizeQ(b.name);
    const aExact = an.includes(nq) ? 0 : 1;
    const bExact = bn.includes(nq) ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return 0;
  });
  for (const meta of listHits) push(meta);

  if (!q) return out;

  const seasonHit = nq.match(/(?:temp(?:orada)?|t|season)\s*0*(\d{1,2})\b/);
  if (seasonHit) {
    push(seasonMeta(Number(seasonHit[1]), index, { full: false }));
  } else if (/temporada|season/.test(nq)) {
    for (const n of listSeasonNumbers(index).slice(0, 10)) {
      push(seasonMeta(n, index, { full: false }));
    }
  } else {
    const epNum = nq.match(/\b(\d{1,4})\b/);
    if (epNum) {
      const abs = Number(epNum[1]);
      if (abs >= 1 && abs <= 1500) {
        for (const n of listSeasonNumbers(index)) {
          const sm = seasonMeta(n, index, { full: false });
          if ((sm.description || '').includes(`${abs}`)) {
            push(sm);
            break;
          }
        }
      }
    }
  }

  return out;
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
    description: `Serie completa en español (BiblioKudo).\n${index.stats.episodeCount} episodios · ${index.stats.movieCount} películas · ${index.stats.specialCount} especiales/OVAs.\nActualizado: ${when}\n\nListas A–D y arcos por personaje viven en el catálogo Biblioteca Conan.`,
    releaseInfo: `1996–${new Date().getFullYear()} · Completa`,
    genres: ['Anime', 'Misterio', 'Comedia'],
    runtime: '25 min',
    videos: full ? videos : undefined,
  };
}

function movieMeta(m) {
  const n = m.movieNumber;
  return {
    id: `bk:movie:${n}`,
    type: 'movie',
    name: m.title || `Película ${n}`,
    poster: POSTER,
    background: BACKGROUND,
    logo: LOGO,
    posterShape: 'poster',
    description: `Película ${n} de Detective Conan en español (BiblioKudo).${
      m.links?.length ? `\n${m.links.length} fuentes disponibles.` : ''
    }`,
    releaseInfo: `Película ${n}`,
    genres: ['Anime', 'Misterio', 'Película'],
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
    const q = (extra?.search || '').trim();

    // Home board + global Search entry point
    if (type === 'series' && id === 'bk-conan-biblioteca') {
      if (q) {
        return { metas: searchBiblioteca(index, q), cacheMaxAge: 600 };
      }
      const featured = [
        seriesMeta(index, false),
        ...listsAsMetas(index, { ids: BIBLIOTECA_LIST_IDS }),
      ];
      return { metas: featured, cacheMaxAge: 1800 };
    }

    if (type === 'series' && id === 'bk-conan-series') {
      if (q) {
        // Also surface lists when searching from this board
        return { metas: searchBiblioteca(index, q), cacheMaxAge: 600 };
      }
      return {
        metas: [seriesMeta(index, false)],
        cacheMaxAge: 3600,
      };
    }

    if (type === 'series' && id === 'bk-conan-seasons') {
      let metas = listSeasonNumbers(index).map((n) =>
        seasonMeta(n, index, { full: false })
      );
      if (q) {
        metas = [
          ...listsAsMetas(index, { q }),
          ...metas.filter((m) => metaMatchesSearch(m, q)),
        ];
      }
      const skip = Math.max(0, Number(extra?.skip) || 0);
      if (skip) metas = metas.slice(skip);
      return { metas, cacheMaxAge: 3600 };
    }

    if (type === 'series' && id === 'bk-conan-guias') {
      const metas = listsAsMetas(index, { group: 'guias', q: q || undefined });
      return { metas, cacheMaxAge: 3600 };
    }

    if (type === 'series' && id === 'bk-conan-personajes') {
      const metas = listsAsMetas(index, {
        group: 'personajes',
        q: q || undefined,
      });
      return { metas, cacheMaxAge: 3600 };
    }

    if (type === 'series' && id === 'bk-conan-extras') {
      const metas = listsAsMetas(index, { group: 'extras', q: q || undefined });
      return { metas, cacheMaxAge: 3600 };
    }

    if (type === 'movie' && id === 'bk-conan-movies') {
      let movies = index.movies;
      if (q) {
        const nq = normalizeQ(q);
        movies = movies.filter(
          (m) =>
            normalizeQ(m.title || '').includes(nq) ||
            String(m.movieNumber).includes(nq)
        );
      }
      return { metas: movies.map(movieMeta), cacheMaxAge: 3600 };
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
      return {
        meta: listMeta(list, index, { full: true }),
        cacheMaxAge: 1800,
      };
    }

    if (type === 'series' && id.startsWith('bk:season:')) {
      const n = Number(id.split(':')[2]);
      if (!Number.isFinite(n)) return { meta: null };
      return {
        meta: seasonMeta(n, index, { full: true }),
        cacheMaxAge: 1800,
      };
    }

    if (
      type === 'series' &&
      (id === SERIES_ID ||
        id === 'bk:conan' ||
        id === CONAN_IMDB ||
        isConanSeriesId(id))
    ) {
      return { meta: seriesMeta(index, true), cacheMaxAge: 1800 };
    }

    if (type === 'movie' && id.startsWith('bk:movie:')) {
      const key = id.slice('bk:movie:'.length);
      if (key === 'lupin') {
        const m = findMovieInIndex(index, { movieKey: 'lupin' });
        if (!m) return { meta: null };
        return { meta: movieMeta(m), cacheMaxAge: 1800 };
      }
      const m = findMovie(index, Number(key));
      if (!m) return { meta: null };
      return { meta: movieMeta(m), cacheMaxAge: 1800 };
    }

    return { meta: null };
  });

  builder.defineStreamHandler(async ({ type, id }) => {
    const cached = streamCache.get(`${type}:${id}`);
    if (cached) return cached;

    await ensureIndex();
    const index = await getIndex();

    const pack = async (streams) => {
      const body = { streams, cacheMaxAge: 300 };
      streamCache.set(`${type}:${id}`, body, STREAM_TTL_MS);
      return body;
    };

    if (type === 'series') {
      const resolved = resolveConanEpisode(id);
      if (resolved) {
        if (resolved.type === 'special') {
          const sp = findSpecial(index, resolved.specialIndex);
          if (!sp) return pack([]);
          return pack(await linksToStreams(sp.links));
        }
        const ep = findEpisode(index, resolved.absolute);
        if (!ep) {
          console.warn(
            `[stream] no episode ${resolved.absolute} for id=${id}`
          );
          return pack([]);
        }
        const subs = await subsForResolved(resolved, id);
        console.log(
          `[stream] ${id} → abs #${resolved.absolute} (${ep.title}) subs=${subs.length}`
        );
        const streams = await linksToStreams(ep.links, { subtitles: subs });
        if (!subs.length) {
          for (const s of streams) {
            const extra =
              'Vídeo ES (hardsub BK). Softsubs fan no disponibles para este cap.';
            s.description = s.description
              ? `${s.description}\n${extra}`
              : extra;
          }
        }
        return pack(streams);
      }

      const parsed = parseStremioId(id);
      if (parsed?.seriesId === 'bk:conan') {
        if (parsed.season === 0) {
          const sp = findSpecial(index, parsed.episode);
          if (!sp) return pack([]);
          return pack(await linksToStreams(sp.links));
        }
        const ep = findEpisode(index, parsed.episode);
        if (!ep) return pack([]);
        const subs = await findSpanishSubtitles({
          absolute: parsed.episode,
          season: 1,
          episode: parsed.episode,
        }).catch(() => []);
        return pack(await linksToStreams(ep.links, { subtitles: subs }));
      }
    }

    if (type === 'movie' && id.startsWith('bk:movie:')) {
      const key = id.slice('bk:movie:'.length);
      const m =
        key === 'lupin'
          ? findMovieInIndex(index, { movieKey: 'lupin' })
          : findMovie(index, Number(key));
      if (!m) return pack([]);
      return pack(await linksToStreams(m.links));
    }

    return pack([]);
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
