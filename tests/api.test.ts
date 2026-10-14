import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { rmSync } from 'fs';
import { join } from 'path';
import api from '../src/routes/api';
import { getStats, logGeneration } from '../src/services/analytics';
import { resetFakeYtdlp } from './helpers';

const TEMP_DIR = join(process.cwd(), 'temp');
const createdJobs: string[] = [];

// Generated mixes land in the real temp/ dir; remove this run's files.
afterAll(() => {
  for (const id of createdJobs) {
    rmSync(join(TEMP_DIR, `output_${id}.mp3`), { force: true });
    rmSync(join(TEMP_DIR, `${id}_report.json`), { force: true });
  }
});
beforeEach(resetFakeYtdlp);

const auth = (user: string, pass: string) => ({ Authorization: `Basic ${btoa(`${user}:${pass}`)}` });
const ADMIN = auth('test-admin', 'test-password');

const postJson = (path: string, body: unknown) =>
  api.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const segment = (id: string, title = `BTS - Song ${id}`) => ({
  youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
  title,
  startTime: '0:00',
  endTime: '0:05',
});

async function startJob(segments: object[]): Promise<string> {
  const res = await postJson('/generate', { segments });
  expect(res.status).toBe(200);
  const { jobId } = (await res.json()) as { jobId: string };
  createdJobs.push(jobId);
  return jobId;
}

async function waitForJob(jobId: string): Promise<any> {
  for (let i = 0; i < 300; i++) {
    const job = (await (await api.request(`/status/${jobId}`)).json()) as any;
    if (job.status !== 'processing') return job;
    await Bun.sleep(100);
  }
  throw new Error(`job ${jobId} still processing`);
}

describe('mix generation flow', () => {
  test('generates a downloadable MP3 and report', async () => {
    const jobId = await startJob([segment('ok-one', 'TWICE - FANCY')]);

    const job = await waitForJob(jobId);
    expect(job).toMatchObject({ status: 'complete' });
    expect(job.failedSegments).toBeUndefined();

    const mp3 = await api.request(`/download/${jobId}`);
    expect(mp3.status).toBe(200);
    expect(mp3.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(mp3.headers.get('Content-Disposition')).toContain(`random-dance-${jobId.slice(0, 8)}.mp3`);
    const bytes = new Uint8Array(await mp3.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(10_000);
    // MP3 files start with an ID3 tag or an MPEG frame sync.
    expect(bytes[0] === 0x49 || bytes[0] === 0xff).toBe(true);

    const report = (await (await api.request(`/download-report/${jobId}`)).json()) as any;
    expect(report.playlist).toEqual([{ order: 1, band: 'TWICE', title: 'FANCY', startTime: '0:00', endTime: '0:05' }]);
  }, 30_000);

  test('skips a song that fails and still builds the rest', async () => {
    const jobId = await startJob([segment('ok-two'), segment('unavailable-video', 'TWICE - Gone')]);

    const job = await waitForJob(jobId);
    expect(job.status).toBe('complete');
    // Only the ERROR line is shown to the user, not yt-dlp's warning noise.
    expect(job.failedSegments).toEqual([
      {
        title: 'TWICE - Gone',
        youtubeUrl: 'https://www.youtube.com/watch?v=unavailable-video',
        reason: '[youtube] https://www.youtube.com/watch?v=unavailable-video: Video unavailable. This video has been removed by the uploader',
      },
    ]);

    const report = (await (await api.request(`/download-report/${jobId}`)).json()) as any;
    expect(report.playlist).toHaveLength(1);
    expect(report.failedSongs).toHaveLength(1);
  }, 30_000);

  test('reports an error when every song fails', async () => {
    const jobId = await startJob([segment('unavailable-all')]);
    expect(await waitForJob(jobId)).toEqual({ status: 'error', error: 'All segments failed to download' });
    expect((await api.request(`/download/${jobId}`)).status).toBe(404);
  }, 30_000);

  test('logs the mix for analytics', async () => {
    const before = getStats().totalGenerations;
    const jobId = await startJob([segment('ok-logged')]);
    await waitForJob(jobId);
    expect(getStats().totalGenerations).toBe(before + 1);
  }, 30_000);

  test('a download is not offered while the mix is still being made', async () => {
    const jobId = await startJob([segment('ok-pending')]);
    expect((await api.request(`/download/${jobId}`)).status).toBe(404);
    expect((await api.request(`/download-report/${jobId}`)).status).toBe(404);
    await waitForJob(jobId);
  }, 30_000);
});

describe('POST /generate validation', () => {
  test.each([
    ['no segments', {}],
    ['an empty list', { segments: [] }],
    ['segments that are not a list', { segments: 'abc' }],
  ])('rejects %s', async (_, body) => {
    expect((await postJson('/generate', body)).status).toBe(400);
  });

  test('rejects a body that is not JSON', async () => {
    expect((await postJson('/generate', 'not json')).status).toBe(400);
  });
});

describe('job lookups', () => {
  test.each(['/status/nope', '/download/nope', '/download-report/nope'])('%s is 404 for an unknown job', async (path) => {
    expect((await api.request(path)).status).toBe(404);
  });
});

describe('admin endpoints', () => {
  test.each([
    ['GET', '/stats'],
    ['GET', '/ytdlp-status'],
    ['POST', '/ytdlp-update'],
  ])('%s %s needs the admin password', async (method, path) => {
    expect((await api.request(path, { method })).status).toBe(401);
    expect((await api.request(path, { method, headers: auth('test-admin', 'wrong') })).status).toBe(401);
  });

  test('GET /stats returns totals and top songs', async () => {
    const res = await api.request('/stats', { headers: ADMIN });
    expect(res.status).toBe(200);
    const stats = (await res.json()) as any;
    expect(typeof stats.totalVisits).toBe('number');
    expect(typeof stats.totalGenerations).toBe('number');
    expect(Array.isArray(stats.topSongs)).toBe(true);
  });

  test('GET /ytdlp-status reports the version', async () => {
    const res = await api.request('/ytdlp-status', { headers: ADMIN });
    expect(Object.keys((await res.json()) as object).sort()).toEqual(['lastUpdateCheck', 'lastUpdateError', 'version']);
  });
});

describe('public endpoints', () => {
  test('POST /visit counts a visit', async () => {
    const before = getStats().totalVisits;
    expect((await api.request('/visit', { method: 'POST' })).status).toBe(200);
    expect(getStats().totalVisits).toBe(before + 1);
  });

  test('GET /top-songs returns a list', async () => {
    expect(Array.isArray(await (await api.request('/top-songs')).json())).toBe(true);
  });

  test('GET /bands returns the band list', async () => {
    const res = await api.request('/bands');
    expect(res.status).toBe(200);
    expect((await res.text()).split('\n')).toContain('BTS');
  });

  test('GET /youtube/info needs a url', async () => {
    expect((await api.request('/youtube/info')).status).toBe(400);
  });

  test('GET /youtube/search needs a query', async () => {
    expect((await api.request('/youtube/search')).status).toBe(400);
  });
});

describe('GET /popular-cut', () => {
  // Runs before any other popular-cut request, so the cached index is built
  // after these generations are logged.
  test('returns the most common cut once 3 mixes used it', async () => {
    const cut = { youtubeUrl: 'https://www.youtube.com/watch?v=popCut00001', title: 'IVE - Love Dive', startTime: '0:41', endTime: '1:12' };
    for (let i = 0; i < 3; i++) await logGeneration(`pop-${i}`, [cut]);

    const res = await api.request(`/popular-cut?url=${encodeURIComponent('https://youtu.be/popCut00001?si=x')}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cut: { startTime: '0:41', endTime: '1:12', uses: 3 } });
  });

  test('returns null for a video nobody cut', async () => {
    const res = await api.request(`/popular-cut?url=${encodeURIComponent('https://www.youtube.com/watch?v=noData00001')}`);
    expect(await res.json()).toEqual({ cut: null });
  });

  test('needs a url', async () => {
    expect((await api.request('/popular-cut')).status).toBe(400);
  });
});

describe('POST /contact', () => {
  const realFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.CONTACT_TO_EMAIL = 'owner@example.com';
    fetchMock = mock(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.CONTACT_TO_EMAIL;
  });

  const valid = { email: 'fan@example.com', message: 'Love the site!' };

  test('sends the message through Resend with the sender as reply-to', async () => {
    const res = await postJson('/contact', valid);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({ to: ['owner@example.com'], reply_to: 'fan@example.com' });
    expect(sent.text).toContain('Love the site!');
  });

  test('pretends to succeed for bots that fill the honeypot, without sending', async () => {
    const res = await postJson('/contact', { ...valid, website: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    ['a missing email', { message: 'hi' }],
    ['an invalid email', { email: 'not-an-email', message: 'hi' }],
    ['a missing message', { email: 'fan@example.com' }],
    ['a blank message', { email: 'fan@example.com', message: '   ' }],
    ['a message over 5000 characters', { email: 'fan@example.com', message: 'x'.repeat(5001) }],
    ['a body that is not JSON', 'not json'],
  ])('rejects %s', async (_, body) => {
    expect((await postJson('/contact', body)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('accepts a message of exactly 5000 characters', async () => {
    expect((await postJson('/contact', { ...valid, message: 'x'.repeat(5000) })).status).toBe(200);
  });

  test('returns 500 when the contact form is not configured', async () => {
    delete process.env.RESEND_API_KEY;
    expect((await postJson('/contact', valid)).status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns 502 when Resend rejects the message', async () => {
    fetchMock.mockImplementation(async () => new Response('bad', { status: 422 }));
    expect((await postJson('/contact', valid)).status).toBe(502);
  });

  test('returns 500 when Resend cannot be reached', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('network down');
    });
    expect((await postJson('/contact', valid)).status).toBe(500);
  });
});
