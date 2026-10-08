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

const { addonBuilder } = addonSdk;

// Stable CDN-ish poster (avoid fragile wiki hotlink breakage when possible)
const POSTER =
  'https://cdn.myanimelist.net/images/anime/7/73936.jpg';
const BACKGROUND =
  'https://cdn.myanimelist.net/images/anime/7/73936l.jpg';
const LOGO =
  'https://cdn.myanimelist.net/images/anime/7/73936t.jpg';

const SERIES_ID = 'bk:conan';
/** Max Streamtape URLs to resolve per request (rest stay as external). */
const MAX_RESOLVE = 3;

export const manifest = {
  id: 'community.bibliokudo.detectiveconan',
  version: '1.1.0',
  name: 'Detective Conan (BiblioKudo ES)',
  description:
    'Episodios, películas, OVAs y especiales de Detective Conan en español desde BiblioKudo (fansubs). Prioriza botones amarillos de streaming. Se actualiza sola.',
  logo: LOGO,
  background: BACKGROUND,
  resources: ['catalog', 'meta', 'stream'],
  types: ['series', 'movie'],
  catalogs: [
    {
      type: 'series',
      id: 'bk-conan-series',
      name: 'Detective Conan (ES)',
      extra: [{ name: 'search', isRequired: false }],
    },
    {
      type: 'movie',
      id: 'bk-conan-movies',
      name: 'Detective Conan Películas',
      extra: [{ name: 'search', isRequired: false }],
    },
  ],
  idPrefixes: ['bk:'],
  behaviorHints: {
    adultContent: false,
    configurable: false,
  },
};

function seriesMeta(index, full = false) {
  const videos = [];
  if (full) {
    for (const ep of index.episodes) {
      const num = String(ep.episode).padStart(3, '0');
      videos.push({
        id: `${SERIES_ID}:${ep.episode}`,
        title: `${num}. ${ep.title}`,
        season: 1,
        episode: ep.episode,
        overview: ep.links?.length
          ? `${ep.links.length} fuentes · BiblioKudo`
          : 'Sin enlaces aún',
      });
    }
    for (const sp of index.specials) {
      videos.push({
        id: `${SERIES_ID}:s0:${sp.specialIndex}`,
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
    id: SERIES_ID,
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

async function linksToStreams(links) {
  const sorted = [...(links || [])].sort(
    (a, b) => streamSortKey(a) - streamSortKey(b)
  );
  // Dedupe by host+role keeping first (best) of each host for streaming
  const seenHosts = new Set();
  const deduped = [];
  for (const link of sorted) {
    const role = effectiveRole(link);
    const key = `${role}:${link.host}:${isStreamtapeUrl(link.url) ? 'st' : 'x'}`;
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
    });
  }
  return streams;
}

export function createAddon() {
  const builder = new addonBuilder(manifest);

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    await ensureIndex();
    const index = await getIndex();
    const q = (extra?.search || '').toLowerCase().trim();

    if (type === 'series' && id === 'bk-conan-series') {
      const meta = seriesMeta(index, false);
      if (
        q &&
        !meta.name.toLowerCase().includes(q) &&
        !'detective conan'.includes(q) &&
        !q.includes('conan')
      ) {
        return { metas: [] };
      }
      return { metas: [meta] };
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

    if (type === 'series' && (id === SERIES_ID || id === 'bk:conan')) {
      return { meta: seriesMeta(index, true) };
    }

    if (type === 'movie' && id.startsWith('bk:movie:')) {
      const num = Number(id.split(':')[2]);
      const m = index.movies.find((x) => x.movieNumber === num);
      if (!m) return { meta: null };
      return { meta: movieMeta(m) };
    }

    return { meta: null };
  });

  builder.defineStreamHandler(async ({ type, id }) => {
    await ensureIndex();
    const index = await getIndex();

    if (type === 'series' && id.startsWith(`${SERIES_ID}:`)) {
      const rest = id.slice(SERIES_ID.length + 1);
      if (rest.startsWith('s0:')) {
        const n = Number(rest.slice(3));
        const sp = index.specials.find((s) => s.specialIndex === n);
        if (!sp) return { streams: [] };
        return { streams: await linksToStreams(sp.links) };
      }
      const epNum = Number(rest);
      const ep = index.episodes.find((e) => e.episode === epNum);
      if (!ep) return { streams: [] };
      return { streams: await linksToStreams(ep.links) };
    }

    if (type === 'movie' && id.startsWith('bk:movie:')) {
      const num = Number(id.split(':')[2]);
      const m = index.movies.find((x) => x.movieNumber === num);
      if (!m) return { streams: [] };
      return { streams: await linksToStreams(m.links) };
    }

    return { streams: [] };
  });

  return builder.getInterface();
}
