/** Request-scoped public origin for subtitle proxy URLs. */
let runtimeBase = null;

export function setPublicBaseFromRequest(req, url) {
  const xfProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim();
  const xfHost = String(req.headers['x-forwarded-host'] || '')
    .split(',')[0]
    .trim();
  const host = xfHost || req.headers.host;
  if (!host) return;

  // Prefer https when behind Cloudflare tunnel
  let proto = xfProto || (url.protocol === 'https:' ? 'https' : null);
  if (!proto) {
    proto = /trycloudflare\.com|onrender\.com|fly\.dev/i.test(host)
      ? 'https'
      : 'http';
  }
  runtimeBase = `${proto}://${host}`.replace(/\/$/, '');
}

export function getPublicBase() {
  if (runtimeBase) return runtimeBase;
  return (
    process.env.PUBLIC_URL ||
    process.env.ADDON_URL ||
    `http://127.0.0.1:${process.env.PORT || 7050}`
  ).replace(/\/$/, '');
}
