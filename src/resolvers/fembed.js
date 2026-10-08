/**
 * Resolve fembed / steagencr / similar embed players to a direct media URL when possible.
 */
import { fetch } from 'undici';
import { UA } from '../fetch.js';

const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

export function isFembedUrl(url) {
  return /fembed\.com|femax\d+\.com|fcdn\.stream|embedsito\.com|vanfem\.com|feurl\.com|suzihaza\.com|animekaizoku|mrdhan/i.test(
    url || ''
  );
}

function extractId(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/(?:v|f|e)\/([^/?#]+)/i);
    return m?.[1] || null;
  } catch {
    return null;
  }
}

export async function resolveFembed(pageUrl, { timeoutMs = 12000 } = {}) {
  const id = extractId(pageUrl);
  if (!id) return null;
  const cached = cache.get(id);
  if (cached && cached.expires > Date.now()) return cached.media;

  const apiHosts = [
    'https://www.fembed.com/api/source/',
    'https://layarkacaxxi.icu/api/source/',
    'https://vanfem.com/api/source/',
  ];

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    for (const base of apiHosts) {
      try {
        const res = await fetch(base + id, {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'User-Agent': UA,
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: pageUrl,
          },
          body: '',
        });
        if (!res.ok) continue;
        const data = await res.json().catch(() => null);
        const files = data?.data || data?.files || [];
        if (!Array.isArray(files) || !files.length) continue;
        // Prefer highest label
        const sorted = [...files].sort((a, b) => {
          const qa = parseInt(String(a.label || a.file || '').replace(/\D/g, ''), 10) || 0;
          const qb = parseInt(String(b.label || b.file || '').replace(/\D/g, ''), 10) || 0;
          return qb - qa;
        });
        const media = sorted[0]?.file || sorted[0]?.url;
        if (media) {
          cache.set(id, { media, expires: Date.now() + CACHE_TTL_MS });
          return media;
        }
      } catch {
        /* try next host */
      }
    }
  } finally {
    clearTimeout(t);
  }
  cache.set(id, { media: null, expires: Date.now() + 60_000 });
  return null;
}
