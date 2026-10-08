import * as cheerio from 'cheerio';
import { fetchHtml } from './fetch.js';
import { classifyHost, shouldSkipUrl } from './hosts.js';
import { discoverPages } from './pages.js';

/** Anime (3–4 digits) or OVA/Magic File (1–2 digits). */
const EP_TITLE_RE =
  /^(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?\.\s+(.+?)(?:\s*\[Original\])?\s*$/i;
const MOVIE_TITLE_RE = /^pel[ií]cula\s+(\d+)\b(.*)$/i;
/** Named specials without episode numbers (especiales page). */
const NAMED_SPECIAL_RE =
  /^(OVA\s+Especial\b|Especial\s+(?!gratitud)|Promo\b|Pel[ií]cula\s+Lupin\b|Magic File\b).+/i;
const SKIP_BUTTON =
  /pack completo|use tab|fansubs|agradecimientos|enlace beikastreet|online bk/i;
const SKIP_URL_EXTRA = /docs\.google\.com\/spreadsheets|nyaa\.si\/?$/i;

/** BiblioKudo: yellow = streaming, cyan/blue = download. */
const STREAM_BG = /#ffb703/i;
const DOWNLOAD_BG = /#24e5ff/i;

/**
 * Map Wix style-* class → 'stream' | 'download' from CSS background colors.
 */
export function extractButtonRoles(html) {
  const roles = new Map();
  const re =
    /\.(style-[a-z0-9]+)__root[^{]*\{([^}]*)\}/gi;
  let m;
  while ((m = re.exec(html))) {
    const sid = m[1];
    const body = m[2];
    if (STREAM_BG.test(body)) roles.set(sid, 'stream');
    else if (DOWNLOAD_BG.test(body)) roles.set(sid, 'download');
  }
  return roles;
}

function roleFromClass(className, roles) {
  if (!className || !roles?.size) return null;
  const m = String(className).match(/style-[a-z0-9]+/i);
  if (!m) return null;
  return roles.get(m[0]) || null;
}

/**
 * Walk DOM in document order: titles then following external links.
 */
export function parsePage(html, pageMeta = {}) {
  const buttonRoles = extractButtonRoles(html);
  const $ = cheerio.load(html);
  // Remove scripts/styles noise (after we've read button colors)
  $('script, style, noscript').remove();

  const items = [];
  let current = null;

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

  const startEpisode = (from, to, title) => {
    pushCurrent();
    current = {
      type: pageMeta.kind === 'movie' ? 'movie' : pageMeta.kind || 'anime',
      episodeFrom: from,
      episodeTo: to ?? from,
      title: title.trim(),
      movieNumber: pageMeta.movieNumber ?? null,
      page: pageMeta.slug || null,
      links: [],
    };
  };

  const startMovie = (num, title) => {
    pushCurrent();
    current = {
      type: 'movie',
      episodeFrom: null,
      episodeTo: null,
      title: (title || `Película ${num}`).trim(),
      movieNumber: num,
      page: pageMeta.slug || null,
      links: [],
    };
  };

  const addLink = (url, button, role = null) => {
    if (!url || shouldSkipUrl(url) || SKIP_URL_EXTRA.test(url)) return;
    if (!current) {
      // Orphan links on a dedicated movie page
      if (pageMeta.kind === 'movie' && pageMeta.movieNumber) {
        startMovie(pageMeta.movieNumber, `Película ${pageMeta.movieNumber}`);
      } else {
        return;
      }
    }
    const { label, playable } = classifyHost(url);
    const btn = (button || '').replace(/\s+/g, ' ').trim();
    if (/pack completo|use tab|fansubs|agradecimientos/i.test(btn)) return;
    // Dedup by URL
    if (current.links.some((l) => l.url === url)) return;
    // Infer role from host if CSS color missing
    let inferred = role;
    if (!inferred) {
      if (/streamtape|stapadblock|pluto\.tv|primevideo/i.test(url)) inferred = 'stream';
      else if (/fireload|mediafire|terabox|mega\.nz|nyaa\.si/i.test(url)) inferred = 'download';
    }
    current.links.push({
      url,
      button: btn || label,
      host: label,
      playable,
      role: inferred, // 'stream' | 'download' | null
    });
  };

  // Collect all text nodes and anchors with a tree walk on body
  const root = $('body').length ? $('body')[0] : $.root()[0];

  function walk(node) {
    if (!node) return;
    if (node.type === 'text') {
      const text = (node.data || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const ep = text.match(EP_TITLE_RE);
      if (ep) {
        const from = Number(ep[1]);
        // On anime pages ignore 1–2 digit titles (nav noise); on ova/especial allow them
        const allowShort =
          pageMeta.kind === 'ova' ||
          pageMeta.kind === 'especial' ||
          pageMeta.kind === 'other';
        if (String(ep[1]).length < 3 && !allowShort) {
          // fall through — might still be a movie title
        } else {
          let toNum = from;
          if (ep[2]) {
            const raw = ep[2];
            if (raw.length < String(from).length) {
              toNum = Number(String(from).slice(0, -raw.length) + raw);
            } else {
              toNum = Number(raw);
            }
          }
          startEpisode(from, toNum, ep[3]);
          // Mark OVAs/specials by page kind
          if (allowShort && current) {
            current.type = pageMeta.kind === 'other' ? 'especial' : pageMeta.kind;
          }
          return;
        }
      }
      const mv = text.match(MOVIE_TITLE_RE);
      if (mv) {
        startMovie(Number(mv[1]), `Película ${mv[1]}${mv[2] || ''}`);
        return;
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
          title: text,
          movieNumber: null,
          page: pageMeta.slug || null,
          links: [],
        };
      }
      return;
    }

    if (node.type === 'tag') {
      const name = node.name?.toLowerCase();
      if (name === 'a') {
        const href = node.attribs?.href;
        if (href && /^https?:/i.test(href)) {
          const $a = $(node);
          const label =
            $a.find('.wixui-button__label').first().text() ||
            $a.text() ||
            '';
          const role = roleFromClass(node.attribs?.class, buttonRoles);
          addLink(href, label.trim(), role);
        }
      }
      const children = node.children || [];
      for (const child of children) walk(child);
    }
  }

  walk(root);
  pushCurrent();

  // If movie page with movieNumber but no items, keep empty shell for later links-only
  if (pageMeta.kind === 'movie' && pageMeta.movieNumber && items.length === 0) {
    // try collecting all external links as one movie
    const links = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || !/^https?:/i.test(href) || shouldSkipUrl(href)) return;
      const label =
        $(el).find('.wixui-button__label').first().text() || $(el).text() || '';
      if (SKIP_BUTTON.test(label)) return;
      const { label: host, playable } = classifyHost(href);
      if (links.some((l) => l.url === href)) return;
      const role = roleFromClass($(el).attr('class'), buttonRoles);
      let inferred = role;
      if (!inferred) {
        if (/streamtape|stapadblock|pluto\.tv|primevideo/i.test(href)) inferred = 'stream';
        else if (/fireload|mediafire|terabox|mega\.nz/i.test(href)) inferred = 'download';
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
    const items = parsePage(html, page);
    return { page, items, error: null };
  } catch (err) {
    return { page, items: [], error: String(err.message || err) };
  }
}

/**
 * Full scrape of discovered pages. Returns normalized index.
 */
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
    // Be gentle with Wix/Cloudflare
    await new Promise((r) => setTimeout(r, 400));
  }

  return buildIndex(results);
}

export function buildIndex(results) {
  const episodes = new Map(); // key: absolute episode number
  const movies = new Map();
  const specials = []; // OVAs / especiales (season 0)
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
        prev.title = item.title || prev.title;
        for (const l of item.links) {
          if (!prev.links.some((x) => x.url === l.url)) prev.links.push(l);
        }
        movies.set(num, prev);
        continue;
      }

      if (page.kind === 'ova' || page.kind === 'especial' || item.type === 'ova' || item.type === 'especial') {
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

      // anime episodes
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
        // Prefer title that mentions this specific number if shared
        if (from === to || !prev.title) prev.title = item.title;
        if (!prev.pages.includes(page.slug)) prev.pages.push(page.slug);
        for (const l of item.links) {
          if (!prev.links.some((x) => x.url === l.url)) prev.links.push(l);
        }
        episodes.set(n, prev);
      }
    }
  }

  const episodeList = [...episodes.values()].sort((a, b) => a.episode - b.episode);
  const movieList = [...movies.values()].sort((a, b) => a.movieNumber - b.movieNumber);

  // Assign specials season-0 episode numbers 1..N (skip empty)
  const specialList = specials
    .filter((s) => (s.links || []).length > 0)
    .map((s, i) => ({
      ...s,
      specialIndex: i + 1,
    }));

  const maxEp = episodeList.length ? episodeList[episodeList.length - 1].episode : 0;
  const missing = [];
  for (let i = 1; i <= maxEp; i++) {
    if (!episodes.has(i)) missing.push(i);
  }

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
      hostCounts,
      pagesScraped,
      errors,
    },
  };
}

/**
 * Rescrape only live pages and merge into existing index.
 */
export async function scrapeLive(existingIndex) {
  const pages = (await discoverPages()).filter(
    (p) =>
      /1100-online|dc-1200|^pelicula-\d+$|peliculas/.test(p.slug) ||
      p.kind === 'movie'
  );
  const results = [];
  for (const page of pages) {
    results.push(await scrapeOne(page));
  }
  const live = buildIndex(results);

  // Merge: take live episodes/movies over existing when present
  const epMap = new Map(existingIndex.episodes.map((e) => [e.episode, e]));
  for (const e of live.episodes) epMap.set(e.episode, e);
  const movieMap = new Map(existingIndex.movies.map((m) => [m.movieNumber, m]));
  for (const m of live.movies) movieMap.set(m.movieNumber, m);

  // Specials: keep existing, append new ids
  const specialIds = new Set(existingIndex.specials.map((s) => s.id));
  const specials = [...existingIndex.specials];
  for (const s of live.specials) {
    if (!specialIds.has(s.id)) {
      specialIds.add(s.id);
      specials.push({ ...s, specialIndex: specials.length + 1 });
    } else {
      const idx = specials.findIndex((x) => x.id === s.id);
      if (idx >= 0) specials[idx] = { ...s, specialIndex: specials[idx].specialIndex };
    }
  }

  const episodes = [...epMap.values()].sort((a, b) => a.episode - b.episode);
  const movies = [...movieMap.values()].sort((a, b) => a.movieNumber - b.movieNumber);
  const maxEp = episodes.length ? episodes[episodes.length - 1].episode : 0;
  const missing = [];
  for (let i = 1; i <= maxEp; i++) if (!epMap.has(i)) missing.push(i);

  return {
    scrapedAt: new Date().toISOString(),
    episodes,
    movies,
    specials,
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
