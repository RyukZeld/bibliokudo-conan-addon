import {
  resolveConanEpisode,
  parseStremioId,
  toAbsoluteEpisode,
  isConanSeriesId,
  CONAN_IMDB,
} from '../episode-id.js';

/**
 * Detect OpenSubtitles-style file hash (16 hex chars).
 */
export function isVideoHashId(id) {
  return typeof id === 'string' && /^[a-f0-9]{16}$/i.test(id.trim());
}

/**
 * Pull absolute Conan episode from torrent / release filenames used by other addons.
 */
export function absoluteFromFilename(filename) {
  if (!filename || typeof filename !== 'string') return null;
  const name = filename.replace(/\\/g, '/').split('/').pop() || filename;

  // Must look like Conan / Case Closed (avoid false positives on random files)
  const isConan = /conan|case[.\s_-]*closed|meitantei/i.test(name);
  if (!isConan) {
    // Still allow tight patterns like DC_-_525 or DetectiveConan-0525
    if (!/\bDC\b|DetectiveConan/i.test(name)) return null;
  }

  // S18E2 / 18x02 / Season 18 Episode 2
  let m = name.match(
    /(?:S|Season[.\s_-]*)(\d{1,2})[.\s_-]*(?:E|x|Episode[.\s_-]*)(\d{1,3})\b/i
  );
  if (m) {
    const season = Number(m[1]);
    const episode = Number(m[2]);
    const { absolute } = toAbsoluteEpisode(season, episode);
    if (absolute) return absolute;
  }

  // Detective Conan - 525 / [APTX] DC_-_525 / DetectiveConan-0525
  m = name.match(
    /(?:Detective[.\s_-]*Conan|Meitantei[.\s_-]*Conan|Case[.\s_-]*Closed|DetectiveConan|\bDC\b)[^\d]{0,20}0*(\d{1,4})\b/i
  );
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 1500) return n;
  }

  // Trailing - 525 before resolution tags
  m = name.match(/[.\s_-]0*(\d{3,4})[.\s_-]+(?:\d{3,4}p|x264|x265|HEVC|WEB|BD|DVD|AAC|FLAC)/i);
  if (m && isConan) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 1500) return n;
  }

  return null;
}

/**
 * Normalize Stremio/Nuvio subtitle request args into a Conan episode query.
 * Works for BiblioKudo streams AND third-party addons (Torrentio, etc.).
 *
 * Clients may send:
 *  - id = tt0131179:18:2
 *  - id = videoHash, extra.videoId / filename
 *  - filename only (from torrent)
 */
export function resolveSubtitleQuery({ id, extra } = {}) {
  const ex = extra || {};
  const filename =
    ex.filename || ex.videoName || ex.videoFilename || ex.name || '';
  const videoHash = ex.videoHash || (isVideoHashId(id) ? id : null);

  const candidates = [
    id,
    ex.videoId,
    ex.videoID,
    ex.metaId,
    ex.from,
  ].filter(Boolean);

  let absolute = null;
  let season = null;
  let episode = null;
  let matchedId = null;

  for (const cand of candidates) {
    if (isVideoHashId(cand)) continue;
    const resolved = resolveConanEpisode(String(cand));
    if (resolved?.type === 'episode' && resolved.absolute) {
      absolute = resolved.absolute;
      matchedId = String(cand);
      const parsed = parseStremioId(String(cand));
      season = parsed?.season ?? null;
      episode = parsed?.episode ?? null;
      break;
    }
    // Series-level id alone is not enough
    if (isConanSeriesId(cand) || String(cand).includes(CONAN_IMDB)) {
      matchedId = String(cand);
    }
  }

  if (!absolute) {
    const fromFile = absoluteFromFilename(filename);
    if (fromFile) {
      absolute = fromFile;
      season = 1;
      episode = fromFile;
    }
  }

  // Filename may also carry S/E even when id already resolved — keep S/E from id
  if (absolute && (season == null || episode == null)) {
    season = 1;
    episode = absolute;
  }

  return {
    absolute,
    season,
    episode,
    filename,
    videoHash,
    matchedId,
    isConan: Boolean(absolute || matchedId || absoluteFromFilename(filename)),
  };
}
