import * as cheerio from 'cheerio';
import { fetchHtml } from './fetch.js';
import { classifyHost, shouldSkipUrl } from './hosts.js';
import { discoverPages } from './pages.js';

/** Anime (3–4 digits) or OVA/Magic File (1–2 digits). Titles may include [Original]. */
const EP_TITLE_RE =
  /^(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?\.\s+(.+?)\s*$/i;
const MOVIE_TITLE_RE = /^pel[ií]cula\s+(\d+)\b(.*)$/i;
const NAMED_SPECIAL_RE =
  /^(OVA\s+Especial\b|Especial\s+(?!gratitud)|Promo\b|Pel[ií]cula\s+Lupin\b|Magic File\b).+/i;
const SKIP_BUTTON =
  /pack completo|use tab|fansubs|agradecimientos/i;
const SKIP_URL_EXTRA = /docs\.google\.com\/spreadsheets|nyaa\.si\/?$/i;

const STREAM_BG = /#ffb703/i;
const DOWNLOAD_BG = /#24e5ff/i;

export function extractButtonRoles(html) {
  const roles = new Map();
  const re = /\.(style-[a-z0-9]+)__root[^{]*\{([^}]*)\}/gi;
  let m;
  while ((m = re.exec(html))) {
    if (STREAM_BG.test(m[2])) roles.set(m[1], 'stream');
    else if (DOWNLOAD_BG.test(m[2])) roles.set(m[1], 'download');
  }
  return roles;
}

function roleFromClass(className, roles) {
  if (!className || !roles?.size) return null;
  const m = String(className).match(/style-[a-z0-9]+/i);
  return m ? roles.get(m[0]) || null : null;
}

/** Strip Wix guard / zero-width chars that break ^episode matching. */
function cleanText(text) {
  return String(text || '')
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(title) {
  return cleanText(title)
    .replace(/\s*\[Original\]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandEpisodeTo(from, rawTo) {
  if (rawTo == null || rawTo === '') return from;
  const raw = String(rawTo);
  if (raw.length < String(from).length) {
    return Number(String(from).slice(0, -raw.length) + raw);
  }
  return Number(raw);
}

/**
 * Parse a BiblioKudo page.
 * Uses full <p> text (joins split <span>s) so titles like "1124." + "Title" match,
 * and still picks up Wix buttons outside paragraphs (old episode pages).
 */
export function parsePage(html, pageMeta = {}) {
  const buttonRoles = extractButtonRoles(html);
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  const items = [];
  let current = null;
  const handledPs = new Set();

  const pushCurrent = () => {
    if (
      current &&
      current.title &&
      !/gratitud|agradecimientos|fansubs/i.test(current.title)
    ) {
      items.push(current);
    }
    current = null;
  };

  const allowShort =
    pageMeta.kind === 'ova' ||
    pageMeta.kind === 'especial' ||
    pageMeta.kind === 'other';

  const startEpisode = (from, to, title) => {
    pushCurrent();
    current = {
      type: pageMeta.kind === 'movie' ? 'movie' : pageMeta.kind || 'anime',
      episodeFrom: from,
      episodeTo: to ?? from,
      title: normalizeTitle(title),
      movieNumber: pageMeta.movieNumber ?? null,
      page: pageMeta.slug || null,
      links: [],
    };
    if (allowShort && pageMeta.kind && pageMeta.kind !== 'anime') {
      current.type = pageMeta.kind === 'other' ? 'especial' : pageMeta.kind;
    }
  };

  const startMovie = (num, title) => {
    pushCurrent();
    current = {
      type: 'movie',
      episodeFrom: null,
      episodeTo: null,
      title: normalizeTitle(title || `Película ${num}`),
      movieNumber: num,
      page: pageMeta.slug || null,
      links: [],
    };
  };

  const addLink = (url, button, role = null) => {
    if (!url || shouldSkipUrl(url) || SKIP_URL_EXTRA.test(url)) return;
    if (!current) {
      if (pageMeta.kind === 'movie' && pageMeta.movieNumber) {
        startMovie(pageMeta.movieNumber, `Película ${pageMeta.movieNumber}`);
      } else {
        return;
      }
    }
    const { label, playable } = classifyHost(url);
    const btn = (button || '').replace(/\s+/g, ' ').trim();
    if (SKIP_BUTTON.test(btn)) return;
    if (current.links.some((l) => l.url === url)) return;
    let inferred = role;
    if (!inferred) {
      if (/streamtape|stapadblock|pluto\.tv|primevideo/i.test(url)) inferred = 'stream';
      else if (/fireload|mediafire|terabox|mega\.nz|nyaa\.si/i.test(url))
        inferred = 'download';
    }
    current.links.push({
      url,
      button: btn || label,
      host: label,
      playable,
      role: inferred,
    });
  };

  /**
   * Find every "NNN. Title" in text (not only at start).
   * Needed when Wix puts the next episode after a <br> inside the same <p>.
   */
  const findEpisodeTitles = (raw) => {
    const text = cleanText(raw);
    if (!text) return [];
    const hits = [];
    const re = /(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?\.\s+/g;
    let m;
    while ((m = re.exec(text))) {
      if (!allowShort && String(m[1]).length < 3) continue;
      if (m.index > 0 && !/\s/.test(text[m.index - 1])) continue;
      hits.push({
        from: Number(m[1]),
        rawTo: m[2],
        index: m.index,
        markerLen: m[0].length,
      });
    }
    const out = [];
    for (let i = 0; i < hits.length; i++) {
      const start = hits[i].index + hits[i].markerLen;
      const end = i + 1 < hits.length ? hits[i + 1].index : text.length;
      let title = text.slice(start, end).trim();
      title = title
        .replace(
          /\s*(Online BK|Enlace APTX|Enlace BeikaStreet|PACK COMPLETO|BK|Pluto\.tv|Prime|WZ|MxS\s*\[R\])\s*$/i,
          ''
        )
        .trim();
      if (title.length < 2) continue;
      out.push({
        from: hits[i].from,
        to: expandEpisodeTo(hits[i].from, hits[i].rawTo),
        title,
      });
    }
    return out;
  };

  const handleText = (raw) => {
    const text = cleanText(raw);
    if (!text) return false;

    const titles = findEpisodeTitles(text);
    if (titles.length) {
      for (const t of titles) startEpisode(t.from, t.to, t.title);
      return true;
    }

    const mv = text.match(MOVIE_TITLE_RE);
    if (mv) {
      startMovie(Number(mv[1]), `Película ${mv[1]}${mv[2] || ''}`);
      return true;
    }
    if (
      (pageMeta.kind === 'especial' || pageMeta.kind === 'ova') &&
      NAMED_SPECIAL_RE.test(text) &&
      text.length < 120
    ) {
      pushCurrent();
      current = {
        type: pageMeta.kind,
        episodeFrom: null,
        episodeTo: null,
        title: normalizeTitle(text),
        movieNumber: null,
        page: pageMeta.slug || null,
        links: [],
      };
      return true;
    }
    return false;
  };

  const collectAnchor = (el) => {
    const href = el.attribs?.href || $(el).attr('href');
    if (!href || !/^https?:/i.test(href)) return;
    const $a = $(el);
    const label =
      $a.find('.wixui-button__label').first().text() || $a.text() || '';
    const role = roleFromClass(el.attribs?.class || $a.attr('class'), buttonRoles);
    addLink(href, label.trim(), role);
  };

  /**
   * Walk a <p> in document order: accumulate text across spans (so "1124."+"Title"
   * joins), flush titles before each link/<br>, assign links to the current episode.
   */
  const walkParagraph = (pNode) => {
    handledPs.add(pNode);
    let pending = '';
    const flush = () => {
      if (!pending) return;
      handleText(pending);
      pending = '';
    };
    const walkP = (node) => {
      if (!node) return;
      if (node.type === 'text') {
        pending += node.data || '';
        return;
      }
      if (node.type !== 'tag') return;
      const name = node.name?.toLowerCase();
      if (name === 'a') {
        flush();
        collectAnchor(node);
        return;
      }
      if (name === 'br') {
        flush();
        return;
      }
      for (const child of node.children || []) walkP(child);
    };
    for (const child of pNode.children || []) walkP(child);
    flush();
  };

  function walk(node) {
    if (!node) return;

    if (node.type === 'tag') {
      const name = node.name?.toLowerCase();

      if (name === 'p') {
        walkParagraph(node);
        return;
      }

      if (name === 'a') {
        let anc = node.parent;
        while (anc) {
          if (handledPs.has(anc)) return;
          anc = anc.parent;
        }
        collectAnchor(node);
        return;
      }

      for (const child of node.children || []) walk(child);
      return;
    }

    if (node.type === 'text') {
      let anc = node.parent;
      while (anc) {
        if (anc.name === 'p' || handledPs.has(anc)) return;
        anc = anc.parent;
      }
      handleText(node.data || '');
    }
  }

  const root = $('body').length ? $('body')[0] : $.root()[0];
  walk(root);
  pushCurrent();

  // Dedicated movie page with only buttons / no title block
  if (pageMeta.kind === 'movie' && pageMeta.movieNumber && items.length === 0) {
    const links = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || !/^https?:/i.test(href) || shouldSkipUrl(href)) return;
      if (SKIP_URL_EXTRA.test(href)) return;
      const label =
        $(el).find('.wixui-button__label').first().text() || $(el).text() || '';
      if (SKIP_BUTTON.test(label)) return;
      const { label: host, playable } = classifyHost(href);
      if (links.some((l) => l.url === href)) return;
      const role = roleFromClass($(el).attr('class'), buttonRoles);
      let inferred = role;
      if (!inferred) {
        if (/streamtape|stapadblock|pluto\.tv|primevideo/i.test(href))
          inferred = 'stream';
        else if (/fireload|mediafire|terabox|mega\.nz/i.test(href))
          inferred = 'download';
      }
      links.push({
        url: href,
        button: label.replace(/\s+/g, ' ').trim() || host,
        host,
        playable,
        role: inferred,
      });
    });
    if (links.length) {
      items.push({
        type: 'movie',
        episodeFrom: null,
        episodeTo: null,
        title: `Película ${pageMeta.movieNumber}`,
        movieNumber: pageMeta.movieNumber,
        page: pageMeta.slug,
        links,
      });
    }
  }

  return items;
}

async function scrapeOne(page) {
  try {
    const html = await fetchHtml(page.url);
    // Soft 404 / empty challenge pages
    if (html.length < 20000 && /Checking Your Request|Page Not Found/i.test(html)) {
      return { page, items: [], error: 'unavailable' };
    }
    const items = parsePage(html, page);
    return { page, items, error: null };
  } catch (err) {
    return { page, items: [], error: String(err.message || err) };
  }
}

export async function scrapeAll({ concurrency = 2, onProgress } = {}) {
  const pages = await discoverPages();
  onProgress?.({ phase: 'discovered', pages: pages.length });

  const results = [];
  for (let i = 0; i < pages.length; i += concurrency) {
    const batch = pages.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(scrapeOne));
    results.push(...batchResults);
    onProgress?.({
      phase: 'scraping',
      done: Math.min(i + concurrency, pages.length),
      total: pages.length,
    });
    await new Promise((r) => setTimeout(r, 500));
  }

  return buildIndex(results);
}

export function buildIndex(results) {
  const episodes = new Map();
  const movies = new Map();
  const specials = [];
  const errors = [];
  const hostCounts = {};
  const pagesScraped = [];

  for (const { page, items, error } of results) {
    pagesScraped.push({
      slug: page.slug,
      kind: page.kind,
      items: items.length,
      error,
    });
    if (error) errors.push({ slug: page.slug, error });

    for (const item of items) {
      for (const link of item.links) {
        hostCounts[link.host] = (hostCounts[link.host] || 0) + 1;
      }

      if (item.type === 'movie' || page.kind === 'movie') {
        const num = item.movieNumber ?? page.movieNumber;
        if (!num) continue;
        const prev = movies.get(num) || {
          movieNumber: num,
          title: item.title,
          links: [],
          page: page.slug,
        };
        // Prefer richer title than "Película N"
        if (item.title && !/^Película\s+\d+$/i.test(item.title)) {
          prev.title = item.title;
        } else if (!prev.title) {
          prev.title = item.title;
        }
        for (const l of item.links) {
          if (!prev.links.some((x) => x.url === l.url)) prev.links.push(l);
        }
        movies.set(num, prev);
        continue;
      }

      if (
        page.kind === 'ova' ||
        page.kind === 'especial' ||
        item.type === 'ova' ||
        item.type === 'especial'
      ) {
        specials.push({
          id: `${page.slug}:${item.episodeFrom ?? item.title}`,
          title: item.title,
          episodeFrom: item.episodeFrom,
          episodeTo: item.episodeTo,
          kind: page.kind,
          page: page.slug,
          links: item.links,
        });
        continue;
      }

      if (page.kind === 'other') {
        specials.push({
          id: `${page.slug}:${item.episodeFrom ?? item.title}`,
          title: `[${page.slug}] ${item.title}`,
          episodeFrom: item.episodeFrom,
          episodeTo: item.episodeTo,
          kind: 'other',
          page: page.slug,
          links: item.links,
        });
        continue;
      }

      if (item.episodeFrom == null) continue;
      const from = item.episodeFrom;
      const to = item.episodeTo ?? from;
      for (let n = from; n <= to; n++) {
        const prev = episodes.get(n) || {
          episode: n,
          title: item.title,
          links: [],
          pages: [],
        };
        if (from === to || !prev.title) prev.title = item.title;
        if (!prev.pages.includes(page.slug)) prev.pages.push(page.slug);
        for (const l of item.links) {
          if (!prev.links.some((x) => x.url === l.url)) prev.links.push(l);
        }
        episodes.set(n, prev);
      }
    }
  }

  // Drop movies with zero links (placeholder pages 25–28 that 404)
  const movieList = [...movies.values()]
    .filter((m) => (m.links || []).length > 0)
    .sort((a, b) => a.movieNumber - b.movieNumber);

  const episodeList = [...episodes.values()].sort((a, b) => a.episode - b.episode);

  const specialList = specials
    .filter((s) => (s.links || []).length > 0)
    .map((s, i) => ({ ...s, specialIndex: i + 1 }));

  const maxEp = episodeList.length ? episodeList[episodeList.length - 1].episode : 0;
  const missing = [];
  for (let i = 1; i <= maxEp; i++) {
    if (!episodes.has(i)) missing.push(i);
  }

  const noLinks = episodeList.filter((e) => !e.links?.length).map((e) => e.episode);

  return {
    scrapedAt: new Date().toISOString(),
    episodes: episodeList,
    movies: movieList,
    specials: specialList,
    stats: {
      episodeCount: episodeList.length,
      movieCount: movieList.length,
      specialCount: specialList.length,
      maxEpisode: maxEp,
      missingEpisodes: missing,
      episodesWithoutLinks: noLinks,
      hostCounts,
      pagesScraped,
      errors,
    },
  };
}

export async function scrapeLive(existingIndex) {
  const pages = (await discoverPages()).filter(
    (p) =>
      /1100-online|dc-1200|^pelicula-\d+$|peliculas/.test(p.slug) ||
      p.kind === 'movie' ||
      p.kind === 'ova' ||
      p.kind === 'especial' ||
      p.kind === 'other'
  );
  const results = [];
  for (const page of pages) {
    results.push(await scrapeOne(page));
    await new Promise((r) => setTimeout(r, 300));
  }
  const live = buildIndex(results);

  const epMap = new Map(existingIndex.episodes.map((e) => [e.episode, e]));
  for (const e of live.episodes) epMap.set(e.episode, e);
  const movieMap = new Map(existingIndex.movies.map((m) => [m.movieNumber, m]));
  for (const m of live.movies) movieMap.set(m.movieNumber, m);

  const specialIds = new Set(existingIndex.specials.map((s) => s.id));
  const specials = [...existingIndex.specials];
  for (const s of live.specials) {
    if (!specialIds.has(s.id)) {
      specialIds.add(s.id);
      specials.push({ ...s, specialIndex: specials.length + 1 });
    } else {
      const idx = specials.findIndex((x) => x.id === s.id);
      if (idx >= 0)
        specials[idx] = { ...s, specialIndex: specials[idx].specialIndex };
    }
  }

  const episodes = [...epMap.values()].sort((a, b) => a.episode - b.episode);
  const movies = [...movieMap.values()]
    .filter((m) => (m.links || []).length > 0)
    .sort((a, b) => a.movieNumber - b.movieNumber);
  const maxEp = episodes.length ? episodes[episodes.length - 1].episode : 0;
  const missing = [];
  for (let i = 1; i <= maxEp; i++) if (!epMap.has(i)) missing.push(i);

  return {
    scrapedAt: new Date().toISOString(),
    episodes,
    movies,
    specials: specials.map((s, i) => ({ ...s, specialIndex: i + 1 })),
    stats: {
      ...existingIndex.stats,
      episodeCount: episodes.length,
      movieCount: movies.length,
      specialCount: specials.length,
      maxEpisode: maxEp,
      missingEpisodes: missing,
      liveRefreshAt: new Date().toISOString(),
    },
  };
}
