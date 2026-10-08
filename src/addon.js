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
  GENRE_ARCOS,
  GENRE_TEMPORADAS,
  GENRE_SERIE,
  GENRE_ESPECIALES,
  proxiedSeriesArt,
} from './watch-lists.js';
import {
  allListsIncludingSynthetic,
  getSyntheticList,
} from './synthetic-lists.js';
import { findEpisode, findSpecial, findMovie } from './index-maps.js';
import { createTtlCache } from './response-cache.js';
import { proxiedMovieArt, proxiedListArt, artProxyUrl } from './art-proxy.js';
import {
  isFembedUrl,
  resolveFembed,
} from './resolvers/fembed.js';
import { loadConfig, configFromExtra } from './config.js';

const { addonBuilder } = addonSdk;

const streamCache = createTtlCache({ max: 300, name: 'streams' });
const STREAM_TTL_MS = 5 * 60 * 1000;

function brandArt() {
  return proxiedSeriesArt();
}

/** Catalog id (custom). Streams also answer Cinemeta/TMDB ids. */
const SERIES_ID = 'bk:conan';
const MAX_RESOLVE = 3;

export const manifest = {
  id: 'community.bibliokudo.detectiveconan',
  version: '1.7.0',
  name: 'Detective Conan (BiblioKudo ES)',
  description:
    'Biblioteca Conan: serie, Listas A–D, personajes, extras, OVAs y temporadas. Filtra por género. Streams BiblioKudo + softsubs ES.',
  logo: artProxyUrl('logo'),
  background: artProxyUrl('series-bg'),
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
    configurable: true,
    configurationRequired: false,
  },
  config: [
    {
      key: 'defaultGuide',
      type: 'select',
      default: 'lista-b',
      title: 'Guía destacada',
      options: ['lista-b', 'lista-c', 'lista-a', 'lista-d'],
    },
    {
      key: 'hideSeasons',
      type: 'checkbox',
      default: 'checked',
      title: 'Ocultar temporadas en el home (usar filtro)',
    },
    {
      key: 'preferSoftsubs',
      type: 'checkbox',
      default: 'checked',
      title: 'Priorizar streams con softsubs ES',
    },
  ],
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
  let lists = allListsIncludingSynthetic(index);
  const orderedIds = listsOrdered().map((l) => l.id);
  const groupRank = (g) =>
    ({ guias: 0, personajes: 1, extras: 2, arcos: 3 }[g] ?? 9);
  lists.sort((a, b) => {
    const gr = groupRank(a.group) - groupRank(b.group);
    if (gr) return gr;
    const ia = orderedIds.indexOf(a.id);
    const ib = orderedIds.indexOf(b.id);
    if (ia !== -1 || ib !== -1) {
      return (ia === -1 ? 900 : ia) - (ib === -1 ? 900 : ib);
    }
    return String(a.short || a.id).localeCompare(String(b.short || b.id));
  });
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
  if (/arco/.test(n)) return GENRE_ARCOS;
  if (/extra|relleno|caso|canon|pelicula/.test(n)) return GENRE_EXTRAS;
  if (/temp/.test(n)) return GENRE_TEMPORADAS;
  if (/serie/.test(n)) return GENRE_SERIE;
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
 * Home board: Destacados → Serie + listas (+ OVAs/arcos).
 * Temporadas solo con el chip «Temporadas» (así no tapan las listas).
 */
function buildBiblioteca(index, { genre, q, skip = 0, config } = {}) {
  if (q && !isBroadConanQuery(q)) return searchBiblioteca(index, q);

  const cfg = config || loadConfig();
  const g = normalizeGenre(genre);
  const out = [];
  const seen = new Set();
  const push = (m) => {
    if (!m?.id || seen.has(m.id)) return;
    seen.add(m.id);
    out.push(m);
  };

  const wantSerie = !g || g === GENRE_SERIE;
  const wantGuias = !g || g === GENRE_GUIAS;
  const wantPers = !g || g === GENRE_PERSONAJES;
  const wantExtras = !g || g === GENRE_EXTRAS;
  const wantArcos = !g || g === GENRE_ARCOS;
  const wantEspeciales = !g || g === GENRE_ESPECIALES;
  const wantSeasons = g === GENRE_TEMPORADAS;

  // Featured row (only on full home, not filtered genres)
  if (!g) {
    const guideId = cfg.defaultGuide || 'lista-b';
    const featuredIds = [guideId, 'hombres-negro', 'kid', 'solo-canon', 'movies-all'];
    for (const fid of featuredIds) {
      const hit = listsAsMetas(index, { ids: [fid] })[0];
      if (hit) {
        hit.releaseInfo = `Destacado · ${hit.releaseInfo || ''}`.trim();
        push(hit);
      }
    }
    push(ovasEspecialesMeta(index, false));
  }

  if (wantSerie) push(seriesMeta(index, false));
  if (wantGuias) for (const m of listsAsMetas(index, { group: 'guias' })) push(m);
  if (wantPers) for (const m of listsAsMetas(index, { group: 'personajes' })) push(m);
  if (wantExtras) for (const m of listsAsMetas(index, { group: 'extras' })) push(m);
  if (wantArcos) for (const m of listsAsMetas(index, { group: 'arcos' })) push(m);
  if (wantEspeciales) push(ovasEspecialesMeta(index, false));
  if (wantSeasons && !cfg.hideSeasons) {
    for (const n of listSeasonNumbers(index)) push(seasonMeta(n, index, { full: false }));
  } else if (wantSeasons) {
    for (const n of listSeasonNumbers(index)) push(seasonMeta(n, index, { full: false }));
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

const SERIES_TRAILER = 'https://www.youtube.com/watch?v=ED8XaUxPf6U';
const MOVIE_TRAILERS = {
  1: 'https://www.youtube.com/watch?v=ED8XaUxPf6U',
  20: 'https://www.youtube.com/watch?v=7YCqL8qF9kE',
};

function ovasEspecialesMeta(index, full = false) {
  const specials = index.specials || [];
  const art = proxiedListArt('ovas');
  const brand = brandArt();
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
    logo: brand.logo,
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
  const brand = brandArt();
  const videos = [];
  if (full) {
    for (const ep of index.episodes) {
      const num = String(ep.episode).padStart(3, '0');
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
    id: CONAN_IMDB,
    imdb_id: CONAN_IMDB,
    type: 'series',
    name: 'Detective Conan · Serie completa',
    poster: brand.poster,
    background: brand.background,
    logo: brand.logo,
    posterShape: 'poster',
    description: [
      'Toda la serie Detective Conan en español (BiblioKudo).',
      `${index.stats.episodeCount} episodios · ${index.stats.movieCount} películas · ${index.stats.specialCount} especiales/OVAs.`,
      `Actualizado: ${when}`,
      '',
      'Para ver filtrado: usa el filtro de género (Guías, Personajes, Arcos, Extras…).',
    ].join('\n'),
    releaseInfo: `Serie · ${index.stats.episodeCount} eps`,
    genres: ['Anime', 'Misterio', GENRE_SERIE],
    runtime: '25 min',
    imdbRating: '8.6',
    trailer: SERIES_TRAILER,
    videos: full ? videos : undefined,
  };
}

function movieMeta(m) {
  const n = m.movieNumber;
  const art = proxiedMovieArt(n);
  const brand = brandArt();
  return {
    id: `bk:movie:${n}`,
    type: 'movie',
    name: m.title || `Película ${n}`,
    poster: art.poster,
    background: art.background,
    logo: brand.logo,
    posterShape: 'poster',
    description: `Película ${n} de Detective Conan en español (BiblioKudo).${
      m.links?.length ? `\n${m.links.length} fuentes disponibles.` : ''
    }`,
    releaseInfo: `Película ${n}`,
    genres: ['Anime', 'Misterio', 'Película'],
    trailer: MOVIE_TRAILERS[n] || SERIES_TRAILER,
  };
}

function softsubNote(hasSubs) {
  return hasSubs
    ? 'Softsubs ES disponibles (fansub / OpenSubtitles)'
    : 'Solo hardsub BK (sin softsub fan para este cap)';
}

async function linksToStreams(links, { subtitles, preferSoftsubs = true } = {}) {
  const sorted = [...(links || [])].sort(
    (a, b) => streamSortKey(a) - streamSortKey(b)
  );
  const seenHosts = new Set();
  const deduped = [];
  for (const link of sorted) {
    const role = effectiveRole(link);
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
  const hasSubs = Boolean(subtitles?.length);
  const subTracks = hasSubs ? toStremioSubtitles(subtitles) : undefined;

  for (const link of deduped) {
    const name = streamName(link);
    let description = [streamDescription(link), softsubNote(hasSubs)]
      .filter(Boolean)
      .join('\n');

    const canResolveSt =
      (link.playable || effectiveRole(link) === 'stream') &&
      isStreamtapeUrl(link.url) &&
      resolved < MAX_RESOLVE;
    const canResolveFe =
      isFembedUrl(link.url) && resolved < MAX_RESOLVE;

    if (canResolveSt) {
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
            _hasSoftsubs: hasSubs,
            _playable: true,
          });
          continue;
        }
      } catch (err) {
        console.warn('[stream] streamtape resolve failed:', err.message);
      }
    }

    if (canResolveFe) {
      resolved += 1;
      try {
        const media = await resolveFembed(link.url);
        if (media) {
          streams.push({
            name: `${name} ▶`,
            title: name,
            description,
            url: media,
            subtitles: subTracks,
            behaviorHints: {
              notWebReady: true,
              bingeGroup: 'bk-fembed',
            },
            _hasSoftsubs: hasSubs,
            _playable: true,
          });
          continue;
        }
      } catch (err) {
        console.warn('[stream] fembed resolve failed:', err.message);
      }
    }

    streams.push({
      name: `${name} ↗`,
      title: name,
      description: description || 'Abrir en navegador',
      externalUrl: link.url,
      subtitles: subTracks,
      _hasSoftsubs: hasSubs,
      _playable: false,
    });
  }

  if (preferSoftsubs && hasSubs) {
    streams.sort((a, b) => {
      const ap = a._playable ? 0 : 1;
      const bp = b._playable ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return 0;
    });
  }

  for (const s of streams) {
    delete s._hasSoftsubs;
    delete s._playable;
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
    const config = configFromExtra(extra);

    // Single home board (+ Search). Genre chip = Guías / Personajes / …
    if (type === 'series' && id === 'bk-conan-biblioteca') {
      const skip = Math.max(0, Number(extra?.skip) || 0);
      const metas = buildBiblioteca(index, {
        genre: extra?.genre,
        q,
        skip,
        config,
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
      const list = getList(listId) || getSyntheticList(listId, index);
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

  builder.defineStreamHandler(async ({ type, id, extra }) => {
    const cached = streamCache.get(`${type}:${id}`);
    if (cached) return cached;

    await ensureIndex();
    const index = await getIndex();
    const config = configFromExtra(extra);

    const pack = async (streams) => {
      const body = { streams, cacheMaxAge: 300 };
      streamCache.set(`${type}:${id}`, body, STREAM_TTL_MS);
      return body;
    };

    const streamOpts = (subs) => ({
      subtitles: subs,
      preferSoftsubs: config.preferSoftsubs,
    });

    // Movies embedded in watch-lists are requested as series videos with bk:movie ids
    if (id.startsWith('bk:movie:')) {
      const key = id.slice('bk:movie:'.length);
      const m =
        key === 'lupin'
          ? findMovieInIndex(index, { movieKey: 'lupin' })
          : findMovie(index, Number(key));
      if (!m) return pack([]);
      return pack(await linksToStreams(m.links, streamOpts([])));
    }

    if (type === 'series' || type === 'movie') {
      const resolved = resolveConanEpisode(id);
      if (resolved) {
        if (resolved.type === 'special') {
          const sp = findSpecial(index, resolved.specialIndex);
          if (!sp) return pack([]);
          return pack(await linksToStreams(sp.links, streamOpts([])));
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
        return pack(await linksToStreams(ep.links, streamOpts(subs)));
      }

      const parsed = parseStremioId(id);
      if (parsed?.seriesId === 'bk:conan') {
        if (parsed.season === 0) {
          const sp = findSpecial(index, parsed.episode);
          if (!sp) return pack([]);
          return pack(await linksToStreams(sp.links, streamOpts([])));
        }
        const ep = findEpisode(index, parsed.episode);
        if (!ep) return pack([]);
        const subs = await findSpanishSubtitles({
          absolute: parsed.episode,
          season: 1,
          episode: parsed.episode,
        }).catch(() => []);
        return pack(await linksToStreams(ep.links, streamOpts(subs)));
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
