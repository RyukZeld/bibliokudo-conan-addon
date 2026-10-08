import { fetch } from 'undici';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchHtml(url, { timeoutMs = 45000, retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
      });
      const text = await res.text();
      // Cloudflare challenge / rate limit
      if (
        res.status === 429 ||
        res.status === 503 ||
        /Checking Your Request|cf-mitigated|just a moment/i.test(text)
      ) {
        throw new Error(`HTTP ${res.status} (rate-limited) for ${url}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return text;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const wait = 1500 * (attempt + 1) + Math.floor(Math.random() * 500);
        await sleep(wait);
      }
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

export { UA };
