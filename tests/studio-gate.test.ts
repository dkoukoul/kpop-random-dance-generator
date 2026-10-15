import { afterEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { isStudioPath, studioGate } from '../src/middleware/studio-gate';

const app = new Hono();
app.use('/*', studioGate());
app.all('/*', (c) => c.text('served'));

afterEach(() => {
  delete process.env.STUDIO_PUBLIC;
  delete process.env.MAINTENANCE_BYPASS_KEY;
});

const STUDIO = ['/studio.html', '/app/studio/main.js', '/css/studio.css'];

describe('studio gate', () => {
  test('knows which files belong to the new page', () => {
    for (const path of STUDIO) expect(isStudioPath(path)).toBe(true);
    for (const path of ['/', '/index.html', '/app/app.js', '/css/styles.css', '/studio', '/app/studio']) {
      expect(isStudioPath(path)).toBe(false);
    }
  });

  test('hides the new page from everyone by default', async () => {
    process.env.MAINTENANCE_BYPASS_KEY = 'secret';
    for (const path of ['/app/studio/main.js', '/css/studio.css', '/app//studio/main.js', '/css//studio.css', '/app/./studio/ui.js']) {
      const res = await app.request(path);
      expect(res.status).toBe(404);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  test('sends a locked visit to the page itself to the classic page', async () => {
    process.env.MAINTENANCE_BYPASS_KEY = 'secret';
    for (const path of ['/studio.html', '//studio.html']) {
      const res = await app.request(path);
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/');
    }
  });

  test('never touches the rest of the site', async () => {
    for (const path of ['/', '/app/app.js', '/random-dance/bts']) {
      expect(await (await app.request(path)).text()).toBe('served');
    }
  });

  test('serves it with the bypass cookie', async () => {
    process.env.MAINTENANCE_BYPASS_KEY = 'secret';
    const res = await app.request('/app/studio/main.js', { headers: { Cookie: 'maintenance_bypass=secret' } });
    expect(await res.text()).toBe('served');
    const wrong = await app.request('/app/studio/main.js', { headers: { Cookie: 'maintenance_bypass=nope' } });
    expect(wrong.status).toBe(404);
  });

  test('?preview=<key> unlocks it and sets the cookie', async () => {
    process.env.MAINTENANCE_BYPASS_KEY = 'secret';
    const res = await app.request('/studio.html?preview=secret');
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('maintenance_bypass=secret');
    expect((await app.request('/studio.html?preview=wrong')).status).toBe(302);
  });

  test('without a bypass key nobody gets in, not even with an empty cookie', async () => {
    const res = await app.request('/css/studio.css?preview=', { headers: { Cookie: 'maintenance_bypass=' } });
    expect(res.status).toBe(404);
  });

  test('STUDIO_PUBLIC=true opens it to everyone', async () => {
    process.env.STUDIO_PUBLIC = 'true';
    for (const path of STUDIO) expect((await app.request(path)).status).toBe(200);
  });
});
