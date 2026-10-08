import http from 'node:http';
import addonSdk from 'stremio-addon-sdk';
import { createAddon, manifest } from './addon.js';
import {
  startBackgroundRefresh,
  ensureIndex,
  getStats,
  getIndexSync,
} from './cache.js';
import { downloadOsSubtitle } from './subtitles/opensubtitles.js';

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

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/' || url.pathname === '/health') {
    const stats = getStats();
    const body = JSON.stringify(
      {
        ok: true,
        name: manifest.name,
        version: manifest.version,
        manifest: '/manifest.json',
        ...stats,
      },
      null,
      2
    );
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
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
  // Warm OpenSubtitles Spanish index in background (first request otherwise ~10s)
  import('./subtitles/opensubtitles.js')
    .then((m) =>
      m.findOpenSubtitlesSpanish({ absolute: 1 }).catch(() => [])
    )
    .then((r) =>
      console.log(`[server] subtitle index warm: ${r?.length ?? 0} for #1`)
    )
    .catch((err) => console.warn('[server] subtitle warm failed:', err.message));
});
