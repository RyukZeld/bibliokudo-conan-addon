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
  getList,
  listMeta,
  seasonMeta,
  listSeasonNumbers,
  findMovieInIndex,
  listMatchesQuery,
  listsOrdered,
  BIBLIOTECA_GENRES,
  GENRE_GUIAS,
  GENRE_PERSONAJES,
  GENRE_EXTRAS,
  GENRE_TEMPORADAS,
  GENRE_SERIE,
  GENRE_ESPECIALES,
} from './watch-lists.js';
import { findEpisode, findSpecial, findMovie } from './index-maps.js';
import { createTtlCache } from './response-cache.js';
import { SERIES_ART, movieArt, listArt } from './art.js';

const { addonBuilder } = addonSdk;

const streamCache = createTtlCache({ max: 300, name: 'streams' });
const STREAM_TTL_MS = 5 * 60 * 1000;

const POSTER = SERIES_ART.poster;
const BACKGROUND = SERIES_ART.background;
const LOGO = SERIES_ART.logo;

/** Catalog id (custom). Streams also answer Cinemeta/TMDB ids. */
const SERIES_ID = 'bk:conan';
const MAX_RESOLVE = 3;

export const manifest = {
  id: 'community.bibliokudo.detectiveconan',
  version: '1.6.2',
  name: 'Detective Conan (BiblioKudo ES)',
  description:
    'Biblioteca Conan: serie, Listas A–D, personajes, extras, OVAs y temporadas. Filtra por género. Streams BiblioKudo + softsubs ES.',
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
      extra: [
        {
          name: 'genre',
          isRequired: false,
          options: [...BIBLIOTECA_GENRES],
        },
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false },
      ],
    },
    {
      type: 'movie',
      id: 'bk-conan-movies',
      name: 'Películas Conan',
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
  let lists = listsOrdered();
  if (group) lists = lists.filter((l) => l.group === group);
  if (ids) {
    const set = new Set(ids);
    lists = lists.filter((l) => set.has(l.id));
    lists.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  }
  if (q) lists = lists.filter((l) => listMatchesQuery(l, q));
  return lists.map((l) => listMeta(l, index, { full: false }));
}

function normalizeGenre(g) {
  const n = normalizeQ(g);
  if (!n || n === 'todas' || n === 'todo' || n === 'all') return '';
  if (/guia/.test(n)) return GENRE_GUIAS;
  if (/personaje/.test(n)) return GENRE_PERSONAJES;
  if (/ova|especial/.test(n)) return GENRE_ESPECIALES;
  if (/extra|relleno|caso/.test(n)) return GENRE_EXTRAS;
  if (/temp/.test(n)) return GENRE_TEMPORADAS;
  if (/serie/.test(n)) return GENRE_SERIE;
  // Exact chip match
  const hit = BIBLIOTECA_GENRES.find((x) => normalizeQ(x) === n);
  return hit || '';
}

/** Nuvio/Search often queries with just "conan" — show the full board, not 3 hits. */
function isBroadConanQuery(q) {
  const nq = normalizeQ(q);
  if (!nq) return true;
  return /^(conan|detective|detective conan|meitantei|meitantei conan|case closed|biblioteca|biblioteca conan|serie|serie completa)$/.test(
    nq
  );
}

/**
 * Home board: Serie + todas las listas (+ OVAs).
 * Temporadas solo con el chip «Temporadas» (así no tapan las listas).
 */
function buildBiblioteca(index, { genre, q, skip = 0 } = {}) {
  // Broad queries ("conan") must return the full library — Nuvio Search uses this path.
  if (q && !isBroadConanQuery(q)) return searchBiblioteca(index, q);

  const g = normalizeGenre(genre);
  const out = [];

  const wantSerie = !g || g === GENRE_SERIE;
  const wantGuias = !g || g === GENRE_GUIAS;
  const wantPers = !g || g === GENRE_PERSONAJES;
  const wantExtras = !g || g === GENRE_EXTRAS;
  const wantEspeciales = !g || g === GENRE_ESPECIALES;
  // Seasons ONLY when explicitly filtered — keeps lists visible on home
  const wantSeasons = g === GENRE_TEMPORADAS;

  if (wantSerie) out.push(seriesMeta(index, false));
  if (wantGuias) out.push(...listsAsMetas(index, { group: 'guias' }));
  if (wantPers) out.push(...listsAsMetas(index, { group: 'personajes' }));
  if (wantExtras) out.push(...listsAsMetas(index, { group: 'extras' }));
  if (wantEspeciales) out.push(ovasEspecialesMeta(index, false));
  if (wantSeasons) {
    for (const n of listSeasonNumbers(index)) {
      out.push(seasonMeta(n, index, { full: false }));
    }
  }

  if (skip > 0) return out.slice(skip);
  return out;
}

/** Narrow Search: specific list / character / season hits. */
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
  if (metaMatchesSearch(main, q)) {
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

  const ovas = ovasEspecialesMeta(index, false);
  if (
    !q ||
    metaMatchesSearch(ovas, q) ||
    /ova|especial|magic file|magicfiles/.test(nq)
  ) {
    push(ovas);
  }

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

function ovasEspecialesMeta(index, full = false) {
  const specials = index.specials || [];
  const art = listArt('ovas');
  const videos = full
    ? specials.map((sp, i) => ({
        id: `${CONAN_IMDB}:0:${sp.specialIndex}`,
        title: sp.title || `Especial ${sp.specialIndex}`,
        season: 1,
        episode: i + 1,
        episodeNo: i + 1,
        overview: sp.kind
          ? `${sp.kind} · BiblioKudo`
          : 'OVA / especial · BiblioKudo',
      }))
    : undefined;
  return {
    id: 'bk:ovas',
    type: 'series',
    name: 'OVAs y especiales',
    poster: art.poster,
    background: art.background,
    logo: LOGO,
    posterShape: 'poster',
    description: [
      'OVAs, Magic Files, episodios especiales y extras de BiblioKudo.',
      `${specials.length} títulos disponibles.`,
      '',
      'También aparecen intercalados en las Listas A–D cuando la guía los incluye.',
    ].join('\n'),
    releaseInfo: `OVAs · ${specials.length} títulos`,
    genres: ['Anime', 'Misterio', GENRE_ESPECIALES],
    runtime: '25–90 min',
    videos,
  };
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
    name: 'Detective Conan · Serie completa',
    poster: POSTER,
    background: BACKGROUND,
    logo: LOGO,
    posterShape: 'poster',
    description: [
      'Toda la serie Detective Conan en español (BiblioKudo).',
      `${index.stats.episodeCount} episodios · ${index.stats.movieCount} películas · ${index.stats.specialCount} especiales/OVAs.`,
      `Actualizado: ${when}`,
      '',
      'Para ver filtrado: elige Guías (A–D), Personajes o Extras en el filtro de género de esta misma Biblioteca.',
    ].join('\n'),
    releaseInfo: `Serie · ${index.stats.episodeCount} eps`,
    genres: ['Anime', 'Misterio', GENRE_SERIE],
    runtime: '25 min',
    videos: full ? videos : undefined,
  };
}

function movieMeta(m) {
  const n = m.movieNumber;
  const art = movieArt(n);
  return {
    id: `bk:movie:${n}`,
    type: 'movie',
    name: m.title || `Película ${n}`,
    poster: art.poster,
    background: art.background,
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

    // Single home board (+ Search). Genre chip = Guías / Personajes / …
    if (type === 'series' && id === 'bk-conan-biblioteca') {
      const skip = Math.max(0, Number(extra?.skip) || 0);
      const metas = buildBiblioteca(index, {
        genre: extra?.genre,
        q,
        skip,
      });
      return { metas, cacheMaxAge: q ? 600 : 1800 };
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

    if (type === 'series' && id === 'bk:ovas') {
      return {
        meta: ovasEspecialesMeta(index, true),
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

    // Movies embedded in watch-lists are requested as series videos with bk:movie ids
    if (id.startsWith('bk:movie:')) {
      const key = id.slice('bk:movie:'.length);
      const m =
        key === 'lupin'
          ? findMovieInIndex(index, { movieKey: 'lupin' })
          : findMovie(index, Number(key));
      if (!m) return pack([]);
      return pack(await linksToStreams(m.links));
    }

    if (type === 'series' || type === 'movie') {
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
