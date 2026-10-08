#!/usr/bin/env node
/**
 * Re-scrape specific ranges/movies that gaps or rate-limits left incomplete,
 * then merge into data/index.json without wiping good data.
 */
import { fetchHtml } from '../src/fetch.js';
import { parsePage, buildIndex } from '../src/scraper.js';
import { loadSnapshot, saveSnapshot } from '../src/cache.js';
import { enrichIndexRoles } from '../src/hosts.js';
import { BASE } from '../src/pages.js';

const TARGETS = [
  { slug: '100-199-online', kind: 'anime' },
  { slug: 'dc-001-050', kind: 'anime' },
  { slug: 'dc-051-099', kind: 'anime' },
  { slug: '1000-online', kind: 'anime' },
  { slug: '1100-online', kind: 'anime' },
  { slug: 'dc-1200', kind: 'anime' },
  { slug: 'ova', kind: 'ova' },
  { slug: 'especiales', kind: 'especial' },
  { slug: 'magic-files', kind: 'especial' },
  { slug: 'historias-cortas', kind: 'especial' },
  { slug: 'magic-kaito', kind: 'other' },
  { slug: 'anime-zeros-tea-time', kind: 'other' },
  { slug: 'el-culpable', kind: 'other' },
  ...Array.from({ length: 24 }, (_, i) => ({
    slug: `pelicula-${i + 1}`,
    kind: 'movie',
    movieNumber: i + 1,
  })),
];

const index = enrichIndexRoles(loadSnapshot());
if (!index) {
  console.error('No snapshot');
  process.exit(1);
}

const results = [];
for (const page of TARGETS) {
  const url = `${BASE}/${page.slug}`;
  process.stdout.write(`→ ${page.slug} … `);
  try {
    const html = await fetchHtml(url);
    const items = parsePage(html, page);
    console.log(`${items.length} items`);
    results.push({ page: { ...page, url }, items, error: null });
  } catch (err) {
    console.log(`FAIL ${err.message}`);
    results.push({ page: { ...page, url }, items: [], error: String(err.message || err) });
  }
  await new Promise((r) => setTimeout(r, 800));
}

const live = buildIndex(results);

// Merge episodes
const epMap = new Map(index.episodes.map((e) => [e.episode, e]));
for (const e of live.episodes) {
  const prev = epMap.get(e.episode);
  if (!prev || (e.links?.length || 0) >= (prev.links?.length || 0)) {
    epMap.set(e.episode, e);
  } else {
    // keep prev links, maybe update title
    prev.title = e.title || prev.title;
  }
}

// Merge movies
const movieMap = new Map(index.movies.map((m) => [m.movieNumber, m]));
for (const m of live.movies) {
  const prev = movieMap.get(m.movieNumber);
  if (!prev || (m.links?.length || 0) >= (prev.links?.length || 0)) {
    movieMap.set(m.movieNumber, m);
  }
}

// Merge specials by id
const specialMap = new Map(index.specials.map((s) => [s.id, s]));
for (const s of live.specials) specialMap.set(s.id, s);

const episodes = [...epMap.values()].sort((a, b) => a.episode - b.episode);
const movies = [...movieMap.values()]
  .filter((m) => (m.links || []).length > 0)
  .sort((a, b) => a.movieNumber - b.movieNumber);
const specials = [...specialMap.values()]
  .filter((s) => (s.links || []).length > 0)
  .map((s, i) => ({ ...s, specialIndex: i + 1 }));

const maxEp = episodes.at(-1)?.episode || 0;
const missing = [];
for (let i = 1; i <= maxEp; i++) if (!epMap.has(i)) missing.push(i);
const noLinks = episodes.filter((e) => !e.links?.length).map((e) => e.episode);

const out = {
  scrapedAt: new Date().toISOString(),
  episodes,
  movies,
  specials,
  stats: {
    episodeCount: episodes.length,
    movieCount: movies.length,
    specialCount: specials.length,
    maxEpisode: maxEp,
    missingEpisodes: missing,
    episodesWithoutLinks: noLinks,
    hostCounts: live.stats.hostCounts,
    pagesScraped: live.stats.pagesScraped,
    errors: live.stats.errors,
    repairedAt: new Date().toISOString(),
  },
};

saveSnapshot(enrichIndexRoles(out));

console.log('\n=== Repair summary ===');
console.log(`Episodes: ${out.stats.episodeCount} (max ${out.stats.maxEpisode})`);
console.log(`Movies:   ${out.stats.movieCount}`);
console.log(`Specials: ${out.stats.specialCount}`);
console.log(`Missing:  ${missing.length} → ${missing.join(', ') || 'none'}`);
console.log(`No links: ${noLinks.length} → ${noLinks.slice(0, 20).join(', ') || 'none'}`);
