import http from 'node:http';
import addonSdk from 'stremio-addon-sdk';
import { createAddon, manifest } from './addon.js';
import {
  startBackgroundRefresh,
  ensureIndex,
  getStats,
  getIndexSync,
} from './cache.js';

const { getRouter } = addonSdk;
const PORT = Number(process.env.PORT) || 7050;

startBackgroundRefresh();

const addonInterface = createAddon();
const router = getRouter(addonInterface);

const server = http.createServer((req, res) => {
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
  const snap = getIndexSync();
  if (snap) {
    console.log(
      `[server] snapshot ready: ${snap.stats?.episodeCount} eps / ${snap.stats?.movieCount} movies`
    );
  }
  ensureIndex().catch((err) => console.error('[server] warm failed:', err));
});
