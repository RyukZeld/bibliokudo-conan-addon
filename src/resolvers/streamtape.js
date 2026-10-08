import { fetch } from 'undici';
import { UA } from '../fetch.js';

/** Short TTL cache so repeated Stremio probes don't hammer Streamtape. */
const cache = new Map(); // url -> { media, expires }
const CACHE_TTL_MS = 15 * 60 * 1000;
const NEG_TTL_MS = 2 * 60 * 1000;

export function isStreamtapeUrl(url) {
  return /streamtape\.com|stapadblockuser\.info/i.test(url);
}

export function toEmbedUrl(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/([ev])\/([^/?#]+)/i);
    if (m) {
      const host = /stapadblockuser/i.test(u.hostname)
        ? 'streamtape.com'
        : u.hostname;
      return `https://${host}/e/${m[2]}`;
    }
  } catch {
    /* ignore */
  }
  return url;
}

function extractGetVideo(html) {
  const concatRe =
    /['"](\/\/[^'"]*get_video\?[^'"]+)['"]\s*\+\s*\(['"]([^'"]+)['"]\)\.substring\((\d+)\)/gi;
  let m;
  while ((m = concatRe.exec(html))) {
    const path = m[1] + m[2].substring(Number(m[3]));
    return path.startsWith('//') ? `https:${path}` : path;
  }

  const direct = html.match(/(\/\/[^"'<\s]*get_video\?[^"'<\s]+)/i);
  if (direct) {
    const path = direct[1];
    return path.startsWith('//')
      ? `https:${path}`
      : `https://streamtape.com${path.startsWith('/') ? '' : '/'}${path}`;
  }

  for (const id of ['botlink', 'norobotlink']) {
    const re = new RegExp(
      `id=["']${id}["'][^>]*>[\\s\\S]*?href=["']([^"']+)["']`,
      'i'
    );
    const hit = html.match(re);
    if (hit) {
      let href = hit[1];
      if (href.startsWith('//')) href = `https:${href}`;
      if (href.includes('get_video')) return href;
    }
  }

  const loose = html.match(/get_video\?[^"'<\s]+/i);
  if (loose) {
    let path = loose[0];
    if (path.startsWith('get_video')) path = `//streamtape.com/${path}`;
    if (path.startsWith('//')) return `https:${path}`;
    if (path.startsWith('/')) return `https://streamtape.com${path}`;
    return path;
  }
  return null;
}

export async function resolveStreamtape(pageUrl, { timeoutMs = 15000 } = {}) {
  const embed = toEmbedUrl(pageUrl);
  const cached = cache.get(embed);
  if (cached && cached.expires > Date.now()) return cached.media;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(embed, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,*/*',
        Referer: 'https://streamtape.com/',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      cache.set(embed, { media: null, expires: Date.now() + NEG_TTL_MS });
      return null;
    }
    const html = await res.text();
    let media = extractGetVideo(html);
    if (!media) {
      cache.set(embed, { media: null, expires: Date.now() + NEG_TTL_MS });
      return null;
    }
    if (!/[?&]stream=1\b/.test(media)) {
      media += (media.includes('?') ? '&' : '?') + 'stream=1';
    }
    cache.set(embed, { media, expires: Date.now() + CACHE_TTL_MS });
    return media;
  } catch {
    cache.set(embed, { media: null, expires: Date.now() + NEG_TTL_MS });
    return null;
  } finally {
    clearTimeout(t);
  }
}
