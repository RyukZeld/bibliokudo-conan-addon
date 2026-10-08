#!/usr/bin/env node
import fs from 'node:fs';
import { SNAPSHOT_PATH, loadSnapshot, saveSnapshot } from '../src/cache.js';
import { enrichIndexRoles } from '../src/hosts.js';

const index = loadSnapshot();
if (!index) {
  console.error('No snapshot at', SNAPSHOT_PATH);
  process.exit(1);
}
enrichIndexRoles(index);
// rewrite pretty for git readability of stats only — full file stays compact from cache.save
fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(index));
console.log(
  `Enriched roles → ${index.stats.episodeCount} eps, ${index.stats.specialCount} specials`
);
