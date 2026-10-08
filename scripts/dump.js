#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeAll } from '../src/scraper.js';
import { saveSnapshot, SNAPSHOT_PATH } from '../src/cache.js';

const write = process.argv.includes('--write');

const index = await scrapeAll({
  concurrency: 3,
  onProgress: (p) => {
    if (p.phase === 'discovered') console.log(`Discovered ${p.pages} pages`);
    if (p.phase === 'scraping') process.stdout.write(`\rScraped ${p.done}/${p.total}`);
  },
});
console.log('\n');

const { stats } = index;
console.log('=== BiblioKudo scrape summary ===');
console.log(`Scraped at: ${index.scrapedAt}`);
console.log(`Episodes:   ${stats.episodeCount} (max ${stats.maxEpisode})`);
console.log(`Movies:     ${stats.movieCount}`);
console.log(`Specials:   ${stats.specialCount}`);
console.log(`Missing:    ${stats.missingEpisodes.length} → ${stats.missingEpisodes.slice(0, 40).join(', ')}${stats.missingEpisodes.length > 40 ? '…' : ''}`);
console.log('\nHosts:');
for (const [h, n] of Object.entries(stats.hostCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${h}: ${n}`);
}
console.log('\nPages:');
for (const p of stats.pagesScraped) {
  const err = p.error ? ` ERROR: ${p.error}` : '';
  console.log(`  [${p.kind}] ${p.slug}: ${p.items} items${err}`);
}

if (stats.errors?.length) {
  console.log('\nErrors:');
  for (const e of stats.errors) console.log(`  ${e.slug}: ${e.error}`);
}

// Sample
console.log('\nSample episodes:');
for (const ep of index.episodes.slice(0, 3)) {
  console.log(`  #${ep.episode} ${ep.title} (${ep.links.length} links)`);
}
if (index.movies[0]) {
  console.log(`\nSample movie: ${index.movies[0].title} (${index.movies[0].links.length} links)`);
}

if (write) {
  saveSnapshot(index);
  console.log(`\nWrote snapshot → ${SNAPSHOT_PATH}`);
} else {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(__dirname, '..', 'data', 'dump-preview.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // Write a lighter preview
  const preview = {
    scrapedAt: index.scrapedAt,
    stats,
    firstEpisodes: index.episodes.slice(0, 5),
    movies: index.movies.slice(0, 3),
    specials: index.specials.slice(0, 5),
  };
  fs.writeFileSync(out, JSON.stringify(preview, null, 2));
  console.log(`\nPreview → ${out}`);
  console.log('Run with --write to save full data/index.json snapshot');
}
