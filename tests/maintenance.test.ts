import { afterEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { maintenance } from '../src/middleware/maintenance';

const app = new Hono();
app.use('/*', maintenance());
app.all('/*', (c) => c.text('real site'));

afterEach(() => {
  delete process.env.MAINTENANCE_MODE;
  delete process.env.MAINTENANCE_BYPASS_KEY;
});

describe('maintenance mode', () => {
  test('off by default', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('real site');
  });

  test('serves the maintenance page with a 503 on every page', async () => {
    process.env.MAINTENANCE_MODE = 'true';
    for (const path of ['/', '/random-dance/bts', '/app/app.js']) {
      const res = await app.request(path);
      expect(res.status).toBe(503);
      expect(res.headers.get('Retry-After')).toBe('3600');
      expect(await res.text()).toContain("We're upgrading the stage");
    }
  });

  test('answers API calls with JSON', async () => {
    process.env.MAINTENANCE_MODE = 'true';
    const res = await app.request('/api/generate', { method: 'POST' });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain('maintenance');
  });

  test('keeps admin, assets, crawler files and running jobs reachable', async () => {
    process.env.MAINTENANCE_MODE = 'true';
    for (const path of ['/admin', '/app/admin.js', '/css/styles.css', '/api/stats', '/robots.txt', '/assets/favicon.png', '/api/status/abc', '/api/download/abc']) {
      expect((await app.request(path)).status).toBe(200);
    }
  });

  test('the preview key lets the owner through and sets a cookie', async () => {
    process.env.MAINTENANCE_MODE = 'true';
    process.env.MAINTENANCE_BYPASS_KEY = 'secret';

    expect((await app.request('/?preview=wrong')).status).toBe(503);

    const res = await app.request('/?preview=secret');
    expect(res.status).toBe(200);
    const cookie = res.headers.get('Set-Cookie')!.split(';')[0]!;

    expect((await app.request('/random-dance/bts', { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await app.request('/', { headers: { Cookie: 'maintenance_bypass=wrong' } })).status).toBe(503);
  });

  test('no bypass when no key is configured', async () => {
    process.env.MAINTENANCE_MODE = 'true';
    expect((await app.request('/?preview=')).status).toBe(503);
    expect((await app.request('/?preview=undefined')).status).toBe(503);
  });
});
