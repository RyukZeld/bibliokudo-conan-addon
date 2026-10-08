/**
 * O(1) lookup helpers over the scraped index.
 * Attached lazily onto the index object as non-enumerable props.
 */

const MARK = Symbol.for('bk.indexMaps');

export function ensureIndexMaps(index) {
  if (!index) return null;
  if (index[MARK]) return index[MARK];

  const episodesByNum = new Map();
  for (const ep of index.episodes || []) {
    episodesByNum.set(ep.episode, ep);
  }
  const specialsByIdx = new Map();
  for (const sp of index.specials || []) {
    specialsByIdx.set(sp.specialIndex, sp);
  }
  const moviesByNum = new Map();
  for (const m of index.movies || []) {
    moviesByNum.set(m.movieNumber, m);
  }

  const maps = {
    episode: (n) => episodesByNum.get(Number(n)),
    special: (n) => specialsByIdx.get(Number(n)),
    movie: (n) => moviesByNum.get(Number(n)),
    episodesByNum,
    specialsByIdx,
    moviesByNum,
  };

  Object.defineProperty(index, MARK, {
    value: maps,
    enumerable: false,
    configurable: true,
  });
  return maps;
}

export function findEpisode(index, absolute) {
  return ensureIndexMaps(index)?.episode(absolute) || null;
}

export function findSpecial(index, specialIndex) {
  return ensureIndexMaps(index)?.special(specialIndex) || null;
}

export function findMovie(index, movieNumber) {
  return ensureIndexMaps(index)?.movie(movieNumber) || null;
}
