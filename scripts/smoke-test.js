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
  assert.equal(home.metas?.length, 6, `home metas ${home.metas?.length}`);
  const ids = home.metas.map((m) => m.id);
  assert.deepEqual(
    ids.slice(0, 4),
    ['bk:list:lista-a', 'bk:list:lista-b', 'bk:list:lista-c', 'bk:list:lista-d']
  );
  assert.ok(ids.includes('bk:list:movies-all'));
  assert.ok(ids.includes('bk:ovas'));
  // No character / arc cards
  assert.ok(!ids.some((id) => /hombres-negro|haibara|arco-|shinran|kid$/.test(id)));
  console.log('✓ biblioteca', home.metas.map((m) => m.name).join(' · '));

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
  assert.equal(broad.metas.length, 6, `broad conan ${broad.metas.length}`);
  console.log('✓ search conan', broad.metas.length);

  const poster = home.metas[0]?.poster;
  assert.ok(poster, 'poster url');
  const pr = await fetch(poster);
  assert.ok(pr.status === 200 || pr.status === 302, `poster ${pr.status}`);
  console.log('✓ poster', pr.status);

  const meta = await get('/meta/series/bk:list:lista-b.json');
  assert.ok(meta.meta?.videos?.length > 100);
  const videoIds = meta.meta.videos.map((v) => v.id);
  assert.equal(videoIds.length, new Set(videoIds).size, 'duplicate video ids');
  console.log('✓ lista-b videos', meta.meta.videos.length);

  const stream = await get('/stream/series/tt0131179:18:2.json');
  assert.ok(stream.streams?.length > 0, 'S18E2 streams');
  console.log('✓ stream S18E2', stream.streams.length);

  const movies = await get('/meta/series/bk:list:movies-all.json');
  assert.ok(movies.meta?.videos?.length >= 20);
  console.log('✓ películas', movies.meta.videos.length);

  console.log('[smoke] OK');
}

main().catch((err) => {
  console.error('[smoke] FAIL', err);
  process.exit(1);
});
