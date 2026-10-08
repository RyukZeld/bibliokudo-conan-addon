/** Host detection and streamability for BiblioKudo links. */

const HOST_LABELS = [
  { test: /streamtape\.com|stapadblockuser\.info/i, label: 'Streamtape', playable: true },
  { test: /fireload\.com/i, label: 'Fireload', playable: false },
  { test: /terabox\.(app|com)/i, label: 'Terabox', playable: false },
  { test: /mediafire\.com/i, label: 'Mediafire', playable: false },
  { test: /drive\.google\.com|docs\.google\.com/i, label: 'Drive', playable: false },
  { test: /pluto\.tv/i, label: 'Pluto.tv', playable: false },
  { test: /primevideo\.com/i, label: 'Prime', playable: false },
  { test: /apotoxinfansub/i, label: 'APTX', playable: false },
  { test: /beikastreet|beika.?street/i, label: 'BeikaStreet', playable: false },
  { test: /maxisubs|maxidcsubs/i, label: 'MaxiSubs', playable: false },
];

const SKIP_HOSTS = [
  /wix\.com/i,
  /wixsite\.com/i,
  /wixstatic\.com/i,
  /parastorage\.com/i,
  /sentry/i,
  /google-analytics/i,
  /fonts\.googleapis/i,
  /localhost/i,
];

export function shouldSkipUrl(url) {
  try {
    const u = new URL(url);
    return SKIP_HOSTS.some((re) => re.test(u.hostname) || re.test(url));
  } catch {
    return true;
  }
}

export function classifyHost(url) {
  for (const h of HOST_LABELS) {
    if (h.test.test(url)) {
      return { label: h.label, playable: h.playable };
    }
  }
  let hostname = 'link';
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    /* ignore */
  }
  return { label: hostname, playable: false };
}

/** Resolve stream/download role from CSS tag or host fallback. */
export function effectiveRole(link) {
  if (link.role === 'stream' || link.role === 'download') return link.role;
  if (/streamtape|stapadblock|pluto\.tv|primevideo/i.test(link.url || '')) return 'stream';
  if (/fireload|mediafire|terabox|mega\.nz|nyaa\.si/i.test(link.url || '')) return 'download';
  return null;
}

/**
 * Prefer yellow (streaming) BK buttons over blue (download).
 * Then playable hosts (Streamtape), then the rest.
 */
export function streamSortKey(link) {
  const role = effectiveRole(link);
  const roleScore = role === 'stream' ? 0 : role === 'download' ? 2 : 1;
  const playable = link.playable ? 0 : 1;
  const hostPrefer = /streamtape|stapadblock/i.test(link.url)
    ? 0
    : /pluto|primevideo/i.test(link.url)
      ? 1
      : /fireload|mediafire|drive\.google|terabox/i.test(link.url)
        ? 3
        : 2;
  return roleScore * 100 + playable * 10 + hostPrefer;
}

export function streamName(link) {
  const parts = [];
  let btn = link.button || '';
  const role = effectiveRole(link);
  if (/^bk$/i.test(btn.trim())) {
    if (role === 'stream') btn = 'BK streaming';
    else if (role === 'download') btn = 'BK descarga';
  }
  if (btn) parts.push(btn);
  if (link.host && link.host !== btn && !btn.includes(link.host)) {
    parts.push(link.host);
  }
  return parts.join(' · ') || link.host || 'Ver';
}

export function streamDescription(link) {
  const bits = [];
  const role = effectiveRole(link);
  if (role === 'stream') bits.push('Streaming (botón amarillo)');
  if (role === 'download') bits.push('Descarga (botón azul)');
  if (/mxs|maxi/i.test(link.button || '') || /maxi/i.test(link.host || '')) {
    bits.push('Contraseña: maxisubs');
  }
  if (!link.playable && role !== 'stream') bits.push('Se abre en el navegador');
  return bits.join(' · ') || undefined;
}

/** Attach inferred roles to every link in an index (for old snapshots). */
export function enrichIndexRoles(index) {
  if (!index) return index;
  const enrich = (links) => {
    for (const l of links || []) {
      if (!l.role) l.role = effectiveRole(l);
    }
  };
  for (const e of index.episodes || []) enrich(e.links);
  for (const m of index.movies || []) enrich(m.links);
  for (const s of index.specials || []) enrich(s.links);
  return index;
}
