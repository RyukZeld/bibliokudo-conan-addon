#!/usr/bin/env node
/**
 * Clean PDF-parsed watch-lists.json:
 * - drop prose "specials"
 * - fix absurd episode numbers via title match / digit heuristics
 * - map remaster Sonata → 1000/1001
 * - strip glued prose from titles
 * - drop unresolvable junk
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIndex } from '../src/cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LISTS_PATH = path.join(__dirname, '..', 'data', 'watch-lists.json');

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isProseJunk(title) {
  const t = String(title || '');
  const n = normalize(t);
  if (!t || t.length < 8) return true;
  if (/^(especial,?|especial o)\b/.test(n)) return true;
  if (/aqui puede|comparte algunos|mas alla de ser|muchos capitulos de detective/.test(n))
    return true;
  if (/ver el principio|pasado este punto|desde la segunda mitad/.test(n) && !/\b\d{2,4}\b/.test(t))
    return false; // keep episode, strip later
  return false;
}

function stripGluedProse(title) {
  let t = String(title || '');
  t = t.replace(/\s*Muchos capítulos de Detective Conan.*$/i, '');
  t = t.replace(/\s*\[Ver el principio[^\]]*\]/gi, '');
  t = t.replace(/\s*\[Pasado este punto[^\]]*\]/gi, '');
  t = t.replace(/\s*\[Desde la segunda mitad[^\]]*\]/gi, '');
  // "745: 854-Recuerdos..." → keep first title chunk
  t = t.replace(/\s+\d{3,4}:\s*\d{3,4}-.*$/u, '');
  return t.trim();
}

function buildTitleIndex(episodes) {
  const map = new Map();
  for (const ep of episodes) {
    const n = normalize(ep.title);
    if (!n) continue;
    if (!map.has(n)) map.set(n, ep.episode);
    // also key without parte markers
    const short = n
      .replace(/\b(parte|part|i|ii|iii|iv|caso|sospecha|resolucion)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (short.length > 20 && !map.has(short)) map.set(short, ep.episode);
  }
  return map;
}

function scoreTitle(a, b) {
  const aa = normalize(a).split(' ').filter((w) => w.length > 3);
  const bb = new Set(normalize(b).split(' ').filter((w) => w.length > 3));
  if (!aa.length) return 0;
  let hits = 0;
  for (const w of aa) if (bb.has(w)) hits++;
  return hits / aa.length;
}

function findByTitle(episodes, title) {
  const needle = normalize(title);
  if (!needle || needle.length < 10) return null;
  let best = null;
  let bestScore = 0;
  for (const ep of episodes) {
    const hay = normalize(ep.title);
    if (!hay) continue;
    let score = 0;
    if (hay === needle) score = 1;
    else if (hay.includes(needle) || needle.includes(hay)) score = 0.85;
    else score = scoreTitle(title, ep.title);
    if (score > bestScore) {
      bestScore = score;
      best = ep.episode;
    }
  }
  return bestScore >= 0.55 ? best : null;
}

function fixEpisodeNumber(item, episodes, maxEp) {
  let title = stripGluedProse(item.title);
  let ep = item.episode;

  // Remaster Sonata → 1000/1001
  if (/remaster/i.test(title) && /sonata|luz de luna|moonlight|gekko|gekkou/i.test(title)) {
    const part2 = /\b(ii|2|parte\s*2|后)\b/i.test(title) || /\)\s*$/.test(title) && /II/i.test(title);
    // 000 / (I) → 1000, 001 / (II) → 1001
    if (/\b000\b|\(I\)|parte\s*1/i.test(title) && !/\(II\)|parte\s*2/i.test(title)) {
      return { episode: 1000, title: 'Sonata a la Luz de la Luna (Parte 1) [remaster]' };
    }
    if (/\b001\b|\(II\)|parte\s*2/i.test(title)) {
      return { episode: 1001, title: 'Sonata a la Luz de la Luna (Parte 2) [remaster]' };
    }
    return {
      episode: part2 ? 1001 : 1000,
      title: part2
        ? 'Sonata a la Luz de la Luna (Parte 2) [remaster]'
        : 'Sonata a la Luz de la Luna (Parte 1) [remaster]',
    };
  }

  if (Number.isFinite(ep) && ep >= 1 && ep <= maxEp) {
    return { episode: ep, title };
  }

  // Heuristic: 2279 → 279, 2910 → 910 (concatenated digits from PDF)
  if (Number.isFinite(ep) && ep > maxEp) {
    const s = String(ep);
    const candidates = [];
    if (s.length >= 3) candidates.push(Number(s.slice(-3)));
    if (s.length >= 4) candidates.push(Number(s.slice(-4)));
    if (s.length >= 3) candidates.push(Number(s.slice(0, 3)));
    const byTitle = findByTitle(episodes, title);
    if (byTitle) return { episode: byTitle, title };
    for (const c of candidates) {
      if (c >= 1 && c <= maxEp) {
        const epObj = episodes.find((e) => e.episode === c);
        if (epObj && scoreTitle(title, epObj.title) >= 0.4) {
          return { episode: c, title };
        }
      }
    }
    for (const c of candidates) {
      if (c >= 1 && c <= maxEp) return { episode: c, title };
    }
  }

  const byTitle = findByTitle(episodes, title);
  if (byTitle) return { episode: byTitle, title };

  return null;
}

function sanitizeList(list, episodes, maxEp) {
  const out = [];
  const seen = new Set();
  let dropped = 0;
  let fixed = 0;

  for (const raw of list.items || []) {
    const item = { ...raw };
    if (item.title) item.title = stripGluedProse(item.title);

    if (item.kind === 'special') {
      if (isProseJunk(item.title)) {
        dropped++;
        continue;
      }
      // keep titled specials; resolver may still fail softly
      const key = `special:${normalize(item.title)}`;
      if (seen.has(key)) {
        dropped++;
        continue;
      }
      seen.add(key);
      out.push(item);
      continue;
    }

    if (item.kind === 'episode') {
      if (isProseJunk(item.title) && !Number.isFinite(item.episode)) {
        dropped++;
        continue;
      }
      const fixedEp = fixEpisodeNumber(item, episodes, maxEp);
      if (!fixedEp) {
        dropped++;
        continue;
      }
      if (fixedEp.episode !== item.episode || fixedEp.title !== item.title) fixed++;
      item.episode = fixedEp.episode;
      item.title = fixedEp.title;
      const key = `ep:${item.episode}`;
      // allow remaster + original both if different numbers; skip exact dup
      if (seen.has(key)) {
        dropped++;
        continue;
      }
      seen.add(key);
      out.push(item);
      continue;
    }

    if (item.kind === 'movie') {
      const key = `movie:${item.movieNumber || item.movieKey || item.title}`;
      if (seen.has(key)) {
        dropped++;
        continue;
      }
      seen.add(key);
      out.push(item);
      continue;
    }

    if (item.kind === 'ova') {
      const key = `ova:${item.ovaNumber}`;
      if (seen.has(key)) {
        dropped++;
        continue;
      }
      seen.add(key);
      out.push(item);
      continue;
    }

    dropped++;
  }

  return {
    ...list,
    items: out,
    itemCount: out.length,
    _sanitize: { dropped, fixed, before: (list.items || []).length },
  };
}

const index = await getIndex();
const maxEp = index.stats?.maxEpisode || 1203;
const episodes = index.episodes || [];
const data = JSON.parse(fs.readFileSync(LISTS_PATH, 'utf8'));

let totalDropped = 0;
let totalFixed = 0;
for (const [id, list] of Object.entries(data.lists || {})) {
  const cleaned = sanitizeList(list, episodes, maxEp);
  totalDropped += cleaned._sanitize.dropped;
  totalFixed += cleaned._sanitize.fixed;
  console.log(
    `${id}: ${cleaned._sanitize.before} → ${cleaned.itemCount} (fixed ${cleaned._sanitize.fixed}, dropped ${cleaned._sanitize.dropped})`
  );
  delete cleaned._sanitize;
  data.lists[id] = cleaned;
}

data.sanitizedAt = new Date().toISOString();
fs.writeFileSync(LISTS_PATH, JSON.stringify(data));
console.log(`\nDone. fixed≈${totalFixed} dropped≈${totalDropped} → ${LISTS_PATH}`);
