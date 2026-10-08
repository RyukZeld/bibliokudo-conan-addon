#!/usr/bin/env node
/** Integrity checks for data/watch-lists.json */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIndex } from '../src/cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LISTS = path.join(__dirname, '..', 'data', 'watch-lists.json');

const data = JSON.parse(fs.readFileSync(LISTS, 'utf8'));
const index = await getIndex();
const max = index.stats?.maxEpisode || 1203;
let errors = 0;

for (const [id, list] of Object.entries(data.lists || {})) {
  for (const it of list.items || []) {
    if (it.kind === 'episode') {
      if (!Number.isFinite(it.episode) || it.episode < 1 || it.episode > max) {
        console.error(id, 'bad episode', it);
        errors++;
      }
      if (
        typeof it.title === 'string' &&
        /aqui puede|comparte algunos|muchos capitulos de detective/i.test(
          it.title
        )
      ) {
        console.error(id, 'prose junk', it.title.slice(0, 60));
        errors++;
      }
    }
  }
  if (list.itemCount !== (list.items || []).length) {
    console.error(id, 'itemCount mismatch', list.itemCount, list.items.length);
    errors++;
  }
}

if (errors) {
  console.error(`[integrity] ${errors} errors`);
  process.exit(1);
}
console.log('[integrity] OK', Object.keys(data.lists).length, 'lists');
