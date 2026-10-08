#!/usr/bin/env node
/**
 * Smoke tests against a running addon (default http://127.0.0.1:7050).
 */
import assert from 'node:assert/strict';

const BASE = (process.env.SMOKE_URL || 'http://127.0.0.1:7050').replace(
  /\/$/,
  ''
);

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  assert.equal(res.status, 200, `${path} → ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) return res.json();
  return res;
}

async function main() {
  console.log('[smoke] base', BASE);
  const manifest = await get('/manifest.json');
  assert.ok(manifest.id);
  assert.ok(manifest.catalogs?.length >= 1);
  console.log('✓ manifest', manifest.version);

  const health = await get('/health');
  assert.equal(health.ok, true);
  assert.ok(health.snapshot?.episodeCount > 1000);
  console.log('✓ health eps', health.snapshot.episodeCount);

  const home = await get('/catalog/series/bk-conan-biblioteca.json');
  assert.ok(home.metas?.length >= 22, `home metas ${home.metas?.length}`);
  const listCards = home.metas.filter((m) => m.id?.startsWith('bk:list:'));
  assert.ok(listCards.length >= 20, `list cards ${listCards.length}`);
  console.log('✓ biblioteca', home.metas.length, 'metas');

  const search = await get(
    '/catalog/series/bk-conan-biblioteca.json?search=lista%20b'
  );
  assert.ok(
    search.metas.some((m) => m.id === 'bk:list:lista-b'),
    'lista b search'
  );
  console.log('✓ search lista b');

  const broad = await get(
    '/catalog/series/bk-conan-biblioteca.json?search=conan'
  );
  assert.ok(broad.metas.length >= 20, `broad conan ${broad.metas.length}`);
  console.log('✓ search conan', broad.metas.length);

  const poster = home.metas[0]?.poster;
  assert.ok(poster, 'poster url');
  const pr = await fetch(poster);
  assert.ok(pr.status === 200 || pr.status === 302, `poster ${pr.status}`);
  console.log('✓ poster', pr.status);

  const meta = await get('/meta/series/bk:list:lista-b.json');
  assert.ok(meta.meta?.videos?.length > 100);
  const ids = meta.meta.videos.map((v) => v.id);
  assert.equal(ids.length, new Set(ids).size, 'duplicate video ids');
  console.log('✓ lista-b videos', meta.meta.videos.length);

  const stream = await get('/stream/series/tt0131179:18:2.json');
  assert.ok(stream.streams?.length > 0, 'S18E2 streams');
  console.log('✓ stream S18E2', stream.streams.length);

  // integrity: synthetic lists
  const canon = await get('/meta/series/bk:list:solo-canon.json');
  assert.ok(canon.meta?.videos?.length > 50);
  console.log('✓ solo-canon', canon.meta.videos.length);

  console.log('[smoke] OK');
}

main().catch((err) => {
  console.error('[smoke] FAIL', err);
  process.exit(1);
});
