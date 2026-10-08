/**
 * Runtime synthetic watch lists: solo-canon, solo-películas, arcos.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getList, loadWatchLists } from './watch-lists.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCS_PATH = path.join(__dirname, '..', 'data', 'arcs.json');

let arcsCache = null;

export function loadArcs() {
  if (arcsCache) return arcsCache;
  arcsCache = JSON.parse(fs.readFileSync(ARCS_PATH, 'utf8'));
  return arcsCache;
}

function fillerEpisodeSet() {
  const rellenos = getList('mejores-rellenos');
  const set = new Set();
  for (const it of rellenos?.items || []) {
    if (it.kind === 'episode' && it.episode) set.add(it.episode);
  }
  return set;
}

/** Essential guide minus known filler selection → “solo canon”. */
export function buildSoloCanonList() {
  const base = getList('lista-c') || getList('lista-d');
  const fillers = fillerEpisodeSet();
  const items = (base?.items || []).filter((it) => {
    if (it.kind === 'episode') return !fillers.has(it.episode);
    return true; // keep movies/ovas from esencial
  });
  return {
    id: 'solo-canon',
    name: 'Solo canon',
    short: 'Canon',
    group: 'extras',
    description:
      'Lista C filtrada: quita los caps marcados como mejores rellenos. Ideal para trama principal.',
    itemCount: items.length,
    items,
    synthetic: true,
  };
}

/** Movies in Lista B guide order (recommended watch order). */
export function buildSoloPeliculasList() {
  const base = getList('lista-b') || getList('lista-a');
  const items = (base?.items || []).filter((it) => it.kind === 'movie');
  return {
    id: 'solo-peliculas',
    name: 'Solo películas (orden guía)',
    short: 'Películas guía',
    group: 'extras',
    description:
      'Todas las películas en el orden en que aparecen en la Lista B (recomendada).',
    itemCount: items.length,
    items,
    synthetic: true,
  };
}

/** All BK movies as a flat playlist (numeric order). */
export function buildMoviesAllList(index) {
  const items = (index.movies || [])
    .slice()
    .sort((a, b) => (a.movieNumber || 0) - (b.movieNumber || 0))
    .map((m) => ({
      kind: 'movie',
      movieNumber: m.movieNumber,
      title: m.title,
    }));
  return {
    id: 'movies-all',
    name: 'Todas las películas',
    short: 'Películas',
    group: 'extras',
    description: `Las ${items.length} películas de BiblioKudo en orden numérico.`,
    itemCount: items.length,
    items,
    synthetic: true,
  };
}

export function buildArcLists(index) {
  const max = index.stats?.maxEpisode || 1203;
  const byEp = new Map((index.episodes || []).map((e) => [e.episode, e]));
  return (loadArcs().arcs || []).map((arc) => {
    const items = [];
    const to = Math.min(arc.to, max);
    for (let ep = arc.from; ep <= to; ep++) {
      if (!byEp.has(ep)) continue;
      items.push({
        kind: 'episode',
        episode: ep,
        title: byEp.get(ep).title,
      });
    }
    return {
      id: arc.id,
      name: arc.name,
      short: arc.short,
      group: 'arcos',
      description: `${arc.description}\nCaps absolutos ${arc.from}–${to}.`,
      itemCount: items.length,
      items,
      synthetic: true,
    };
  });
}

/** Merge PDF lists + synthetics for catalog/search. */
export function allListsIncludingSynthetic(index) {
  const pdf = Object.values(loadWatchLists().lists || {});
  const extra = [
    buildSoloCanonList(),
    buildSoloPeliculasList(),
    buildMoviesAllList(index),
    ...buildArcLists(index),
  ];
  return [...pdf, ...extra];
}

export function getSyntheticList(id, index) {
  if (id === 'solo-canon') return buildSoloCanonList();
  if (id === 'solo-peliculas') return buildSoloPeliculasList();
  if (id === 'movies-all') return buildMoviesAllList(index);
  return buildArcLists(index).find((l) => l.id === id) || null;
}
