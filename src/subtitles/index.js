import { findOpenSubtitlesSpanish } from './opensubtitles.js';
import { findXcordSpanish } from './xcord.js';
import { getPublicBase } from './public-base.js';
import { resolveSubtitleQuery } from './resolve-query.js';

export { getPublicBase, setPublicBaseFromRequest } from './public-base.js';
export { resolveSubtitleQuery, absoluteFromFilename } from './resolve-query.js';

function proxyUrl(downloadUrl, format, id) {
  const base = getPublicBase();
  const q = new URLSearchParams({
    u: downloadUrl,
    fmt: format || 'srt',
    id: id || 'os',
  });
  return `${base}/subs/proxy.${format || 'srt'}?${q.toString()}`;
}

/**
 * Convert internal subtitle records to Stremio Subtitle Objects.
 * lang=es so Nuvio/Stremio pick them in the Spanish filter for any stream source.
 */
export function toStremioSubtitles(records) {
  return records.map((r) => {
    const url = r.url || proxyUrl(r.downloadUrl, r.format, r.id);
    return {
      id: r.id,
      url,
      lang: r.lang || 'es',
      label: r.label || r.langLabel || 'Español',
    };
  });
}

/**
 * Lookup Spanish fan softsubs for a Conan absolute episode.
 */
export async function findSpanishSubtitles({
  absolute,
  season,
  episode,
  videoHash,
} = {}) {
  if (!absolute && !(season && episode) && !videoHash) return [];

  const [xcord, opensubs] = await Promise.all([
    Promise.resolve(absolute ? findXcordSpanish(absolute) : []),
    findOpenSubtitlesSpanish({
      absolute,
      season,
      episode,
      videoHash,
    }).catch((err) => {
      console.warn('[subs] OpenSubtitles failed:', err.message);
      return [];
    }),
  ]);

  // Prefer fansub packs first, then OpenSubtitles
  const merged = [...xcord, ...opensubs];
  const seen = new Set();
  const deduped = [];
  for (const r of merged) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    // Normalize lang for players
    r.lang = r.lang === 'spa' ? 'es' : r.lang || 'es';
    deduped.push(r);
  }
  return deduped;
}

/**
 * Resolve subtitles for a Stremio/Nuvio request (any stream addon).
 */
export async function subtitlesForRequest(args = {}) {
  const q = resolveSubtitleQuery(args);
  if (!q.isConan && !q.absolute) return [];

  if (!q.absolute && !q.videoHash) return [];

  return findSpanishSubtitles({
    absolute: q.absolute,
    season: q.season,
    episode: q.episode,
    videoHash: q.videoHash,
  });
}

/** @deprecated use subtitlesForRequest */
export async function subtitlesForVideoId(id, extra) {
  return subtitlesForRequest({ id, extra });
}
