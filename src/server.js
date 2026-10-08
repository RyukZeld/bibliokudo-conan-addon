import http from 'node:http';
import addonSdk from 'stremio-addon-sdk';
import { createAddon, manifest } from './addon.js';
import {
  startBackgroundRefresh,
  ensureIndex,
  getStats,
  getIndexSync,
} from './cache.js';
import {
  downloadOsSubtitle,
  warmSpanishIndex,
} from './subtitles/opensubtitles.js';
import { setPublicBaseFromRequest } from './subtitles/public-base.js';
import { loadWatchLists } from './watch-lists.js';

const { getRouter } = addonSdk;
const PORT = Number(process.env.PORT) || 7050;

startBackgroundRefresh();

const addonInterface = createAddon();
const router = getRouter(addonInterface);

const server = http.createServer(async (req, res) => {
  // CORS for Stremio / Nuvio / browsers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // Stremio SDK expects extras in the PATH:
  //   /catalog|meta|stream|subtitles/.../<id>/<qs>.json
  // Nuvio/browsers often send ?search= — rewrite to path extras.
  const mRes = url.pathname.match(
    /^(\/(?:catalog|subtitles|stream|meta)\/[^/]+\/[^/]+)\.json$/i
  );
  if (mRes && url.search && url.search.length > 1) {
    const rewritten = `${mRes[1]}/${url.searchParams.toString()}.json`;
    req.url = rewritten;
    url = new URL(rewritten, `http://${req.headers.host || 'localhost'}`);
  }

  // So proxied OS subtitle URLs use the same host the client hit (tunnel / LAN)
  if (
    url.pathname.startsWith('/subtitles/') ||
    url.pathname.startsWith('/stream/') ||
    url.pathname.startsWith('/subs/')
  ) {
    setPublicBaseFromRequest(req, url);
  }

  if (url.pathname === '/' || url.pathname === '/health') {
    const stats = getStats();
    let listCount = 0;
    try {
      listCount = Object.keys(loadWatchLists().lists || {}).length;
    } catch {
      /* ignore */
    }
    const body = JSON.stringify(
      {
        ok: true,
        name: manifest.name,
        version: manifest.version,
        manifest: '/manifest.json',
        catalogs: (manifest.catalogs || []).map((c) => c.id),
        watchLists: listCount,
        ...stats,
      },
      null,
      2
    );
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  // Proxy OpenSubtitles (gz) → UTF-8 .srt/.ass for Stremio/Nuvio players
  if (
    url.pathname === '/subs/proxy.srt' ||
    url.pathname === '/subs/proxy.ass' ||
    url.pathname === '/subs/proxy.ssa'
  ) {
    const src = url.searchParams.get('u');
    if (!src || !/^https:\/\/([a-z0-9.-]*\.)?opensubtitles\.org\//i.test(src)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid subtitle url' }));
      return;
    }
    try {
      const text = await downloadOsSubtitle(src);
      const ext = url.pathname.split('.').pop() || 'srt';
      const type =
        ext === 'ass' || ext === 'ssa'
          ? 'text/x-ssa; charset=utf-8'
          : 'application/x-subrip; charset=utf-8';
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=86400',
        'Content-Disposition': `inline; filename="conan.${ext}"`,
      });
      res.end(text);
    } catch (err) {
      console.warn('[subs/proxy]', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'subtitle download failed' }));
    }
    return;
  }

  // Express-style router from SDK
  router(req, res, () => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] ${manifest.name} v${manifest.version} on :${PORT}`);
  console.log(`[server] manifest → http://127.0.0.1:${PORT}/manifest.json`);
  console.log(`[server] health   → http://127.0.0.1:${PORT}/health`);
  if (process.env.PUBLIC_URL) {
    console.log(`[server] PUBLIC_URL → ${process.env.PUBLIC_URL}`);
  }
  const snap = getIndexSync();
  if (snap) {
    console.log(
      `[server] snapshot ready: ${snap.stats?.episodeCount} eps / ${snap.stats?.movieCount} movies`
    );
  }
  ensureIndex().catch((err) => console.error('[server] warm failed:', err));
  // Single-flight warm of OpenSubtitles Spanish index (disk cache if present)
  warmSpanishIndex().then((byAbs) => {
    console.log(
      `[server] subtitle index warm: ${byAbs?.size ?? 0} absolute eps`
    );
  });
  try {
    const n = Object.keys(loadWatchLists().lists || {}).length;
    console.log(`[server] watch lists loaded: ${n}`);
  } catch (err) {
    console.warn('[server] watch lists:', err.message);
  }
});
