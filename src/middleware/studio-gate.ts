import { posix } from 'node:path';
import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { BYPASS_COOKIE } from './maintenance';

/**
 * The new mix builder (public/studio.html and its files) is being built in
 * public/, which is live as soon as a file is saved. Until it's ready it is
 * served only to the owner, who has the maintenance bypass cookie (open
 * /studio.html?preview=<MAINTENANCE_BYPASS_KEY> once; this works whether
 * or not maintenance mode is on), or to everyone when STUDIO_PUBLIC=true.
 * Anyone else gets a 404, except the page itself, which sends them to the
 * classic page (so a group page's "Open in generator" never dead-ends).
 */
export function isStudioPath(path: string): boolean {
  return path === '/studio.html' || path.startsWith('/app/studio/') || path === '/css/studio.css';
}

export function studioGate(): MiddlewareHandler {
  return async (c, next) => {
    // serveStatic collapses "//" and "/./", so check the path the way it will
    // be read from disk: "//studio.html" is still the studio page.
    const path = posix.normalize(c.req.path);
    if (!isStudioPath(path)) return next();
    if (process.env.STUDIO_PUBLIC === 'true') return next();
    const key = process.env.MAINTENANCE_BYPASS_KEY;
    if (key && getCookie(c, BYPASS_COOKIE) === key) return next();
    if (key && c.req.query('preview') === key) {
      // Same cookie as maintenance mode's bypass, so one link unlocks both.
      setCookie(c, BYPASS_COOKIE, key, { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 60 * 60 * 24 * 30 });
      return next();
    }
    c.header('Cache-Control', 'no-store');
    if (path === '/studio.html') return c.redirect('/', 302);
    return c.text('404 Not Found', 404);
  };
}
