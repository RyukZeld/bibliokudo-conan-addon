import { findOpenSubtitlesSpanish } from './opensubtitles.js';
import { findXcordSpanish } from './xcord.js';
import { parseStremioId } from '../episode-id.js';

/**
 * Public base URL for proxied subtitle downloads (OpenSubtitles gz → utf8).
 * Set PUBLIC_URL when using Cloudflare tunnel / Render.
 */
export function publicBase() {
  return (
    process.env.PUBLIC_URL ||
    process.env.ADDON_URL ||
    `http://127.0.0.1:${process.env.PORT || 7050}`
  ).replace(/\/$/, '');
}

function proxyUrl(downloadUrl, format, id) {
  const base = publicBase();
  const q = new URLSearchParams({
    u: downloadUrl,
    fmt: format || 'srt',
    id: id || 'os',
  });
  return `${base}/subs/proxy.${format || 'srt'}?${q.toString()}`;
}

/**
 * Convert internal subtitle records to Stremio Subtitle Objects.
 * https://stremio.github.io/stremio-addon-sdk/api/responses/subtitles.html
 */
export function toStremioSubtitles(records) {
  return records.map((r) => {
    const url = r.url || proxyUrl(r.downloadUrl, r.format, r.id);
    return {
      id: r.id,
      url,
      lang: r.lang || 'spa',
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
} = {}) {
  if (!absolute && !(season && episode)) return [];

  const [xcord, opensubs] = await Promise.all([
    Promise.resolve(findXcordSpanish(absolute)),
    findOpenSubtitlesSpanish({ absolute, season, episode }).catch((err) => {
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
    deduped.push(r);
  }
  return deduped;
}

/**
 * Resolve subtitles for a Stremio video id (series episode).
 */
export async function subtitlesForVideoId(id) {
  const parsed = parseStremioId(id);
  // Lazy import to avoid circular deps at module load
  const { resolveConanEpisode } = await import('../episode-id.js');
  const resolved = resolveConanEpisode(id);
  if (!resolved || resolved.type !== 'episode') return [];

  return findSpanishSubtitles({
    absolute: resolved.absolute,
    season: parsed?.season,
    episode: parsed?.episode,
  });
}
