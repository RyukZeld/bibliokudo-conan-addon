/**
 * Fan Spanish softsubs from x-cord/conan-sources (Crunchyroll / Amazon timed).
 * Coverage: episodes 1–123 (España + Latinoamérica).
 * Served via jsDelivr CDN (raw ASS/SRT, no API key).
 */

const JSDELIVR =
  'https://cdn.jsdelivr.net/gh/x-cord/conan-sources@master';

const PACKS = [
  {
    id: 'es-es-cr',
    lang: 'spa',
    label: 'Fansub ES (España · CR)',
    path: 'Spanish (Spain)/Crunchyroll',
    ext: 'ass',
    min: 1,
    max: 123,
  },
  {
    id: 'es-419-cr',
    lang: 'spa',
    label: 'Fansub ES (Latino · CR)',
    path: 'Spanish (Latin America)/Crunchyroll',
    ext: 'ass',
    min: 1,
    max: 123,
  },
  {
    id: 'es-es-amz',
    lang: 'spa',
    label: 'Fansub ES (España · Amazon)',
    path: 'Spanish (Spain)/Amazon',
    ext: 'srt',
    min: 1,
    max: 103,
  },
];

function pad(n) {
  return String(n).padStart(4, '0');
}

function encodePath(p) {
  return p
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/**
 * @returns {Array<{id, source, label, lang, langLabel, fileName, format, url}>}
 */
export function findXcordSpanish(absolute) {
  if (!absolute || absolute < 1) return [];
  const out = [];
  for (const pack of PACKS) {
    if (absolute < pack.min || absolute > pack.max) continue;
    const file = `${pad(absolute)}.${pack.ext}`;
    const url = `${JSDELIVR}/${encodePath(pack.path)}/${file}`;
    out.push({
      id: `xcord:${pack.id}:${absolute}`,
      source: 'x-cord fansub',
      label: pack.label,
      lang: pack.lang,
      langLabel: 'Español',
      fileName: file,
      format: pack.ext,
      url,
    });
  }
  return out;
}
