import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';

const PAGE_PATH = './public/maintenance.html';
export const BYPASS_COOKIE = 'maintenance_bypass';

// Still reachable during maintenance: the admin page with its script, styles
// and API, and files that crawlers and site verification expect.
const OPEN_PATHS = new Set([
  '/admin',
  '/app/admin.js',
  '/css/admin.css',
  '/api/stats',
  '/api/ytdlp-status',
  '/api/ytdlp-update',
  '/robots.txt',
  '/favicon.ico',
  '/BingSiteAuth.xml',
  '/f748f8158a874f20aaabddd755c915dd.txt',
]);

// Images the page uses (favicon, og-image), and mixes that started before
// maintenance was switched on, which can still finish and be downloaded.
const OPEN_PREFIXES = ['/assets/', '/api/status/', '/api/download/', '/api/download-setlist/'];

/**
 * When MAINTENANCE_MODE=true, answer every other request with the maintenance
 * page and a 503. A 503 with Retry-After (rather than a redirect) tells search
 * engines the outage is temporary, so the site keeps its rankings.
 *
 * Visiting any URL with ?preview=<MAINTENANCE_BYPASS_KEY> sets a cookie that
 * lets the owner use the real site while everyone else sees the page.
 */
export function maintenance(): MiddlewareHandler {
  return async (c, next) => {
    if (process.env.MAINTENANCE_MODE !== 'true') return next();

    const path = c.req.path;
    if (OPEN_PATHS.has(path) || OPEN_PREFIXES.some((p) => path.startsWith(p))) return next();

    const key = process.env.MAINTENANCE_BYPASS_KEY;
    if (key) {
      if (c.req.query('preview') === key) {
        setCookie(c, BYPASS_COOKIE, key, { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 60 * 60 * 24 * 30 });
        return next();
      }
      if (getCookie(c, BYPASS_COOKIE) === key) return next();
    }

    c.header('Retry-After', '3600');
    c.header('Cache-Control', 'no-store');
    if (path.startsWith('/api/')) {
      return c.json({ error: 'The site is down for maintenance. Please try again later.' }, 503);
    }
    return c.html(await Bun.file(PAGE_PATH).text(), 503);
  };
}
