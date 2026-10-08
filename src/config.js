/**
 * Stremio/Nuvio addon configuration (from manifest URL query / extras).
 */
const DEFAULTS = {
  defaultGuide: 'lista-b',
  hideSeasons: true,
  preferSoftsubs: true,
};

export function loadConfig(raw = {}) {
  const cfg = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return cfg;

  if (raw.defaultGuide) cfg.defaultGuide = String(raw.defaultGuide);
  // Stremio sends checkbox as "checked" / empty / true / false
  if (raw.hideSeasons != null) {
    cfg.hideSeasons = isChecked(raw.hideSeasons);
  }
  if (raw.preferSoftsubs != null) {
    cfg.preferSoftsubs = isChecked(raw.preferSoftsubs);
  }
  return cfg;
}

function isChecked(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const s = String(v).toLowerCase();
  if (s === '' || s === '0' || s === 'false' || s === 'unchecked') return false;
  return true;
}

/** Merge config from catalog/stream extra + process env defaults. */
export function configFromExtra(extra = {}) {
  return loadConfig({
    defaultGuide: extra.defaultGuide || process.env.BK_DEFAULT_GUIDE,
    hideSeasons:
      extra.hideSeasons != null
        ? extra.hideSeasons
        : process.env.BK_HIDE_SEASONS,
    preferSoftsubs:
      extra.preferSoftsubs != null
        ? extra.preferSoftsubs
        : process.env.BK_PREFER_SOFTSUBS,
  });
}
