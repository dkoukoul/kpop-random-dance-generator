import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { rmSync } from 'fs';
import { join } from 'path';
import api, { countdownChoice, pruneJobs } from '../src/routes/api';
import { getStats, logGeneration } from '../src/services/analytics';
import { audioDuration, resetFakeYtdlp, ytdlpCalls } from './helpers';

const TEMP_DIR = join(process.cwd(), 'temp');
const createdJobs: string[] = [];

// Generated mixes land in the real temp/ dir; remove this run's files.
afterAll(() => {
  for (const id of createdJobs) {
    rmSync(join(TEMP_DIR, `output_${id}.mp3`), { force: true });
    rmSync(join(TEMP_DIR, `${id}_setlist.txt`), { force: true });
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

// Video IDs are always 11 characters; the server rejects anything else.
const videoId = (name: string) => name.padEnd(11, '0').slice(0, 11);
const segment = (id: string, title = `BTS - Song ${id}`) => ({
  youtubeUrl: `https://www.youtube.com/watch?v=${videoId(id)}`,
  title,
  startTime: '0:00',
  endTime: '0:05',
});

async function startJob(segments: object[], extra: object = {}): Promise<string> {
  const res = await postJson('/generate', { segments, ...extra });
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
  test('generates a downloadable MP3 and setlist', async () => {
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

    const setlist = await (await api.request(`/download-setlist/${jobId}`)).text();
    expect(setlist).toContain('TWICE');
    expect(setlist).toContain('FANCY');
  }, 30_000);

  test('skips a song that fails and still builds the rest', async () => {
    const jobId = await startJob([segment('ok-two'), segment('unavailable-video', 'TWICE - Gone')]);

    const job = await waitForJob(jobId);
    expect(job.status).toBe('complete');
    // Only the ERROR line is shown to the user, not yt-dlp's warning noise.
    expect(job.failedSegments).toEqual([
      {
        title: 'TWICE - Gone',
        youtubeUrl: 'https://www.youtube.com/watch?v=unavailable',
        reason: '[youtube] https://www.youtube.com/watch?v=unavailable: Video unavailable. This video has been removed by the uploader',
        index: 1,
      },
    ]);

    const setlist = await (await api.request(`/download-setlist/${jobId}`)).text();
    expect(setlist).toContain('TWICE');
    expect(setlist).toContain('Gone');
  }, 30_000);

  test('reports an error when every song fails', async () => {
    const jobId = await startJob([segment('unavailable-all')]);
    expect(await waitForJob(jobId)).toMatchObject({
      status: 'error',
      error: 'All segments failed to download',
      songs: [{ state: 'skipped' }],
    });
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
    expect((await api.request(`/download-setlist/${jobId}`)).status).toBe(404);
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

  test.each([
    'http://localhost:3020/admin',
    'https://example.com/watch?v=abcdefghijk',
    'file:///etc/passwd',
    '',
    123,
  ])('rejects a mix with no YouTube video link: %p', async (youtubeUrl) => {
    const res = await postJson('/generate', { segments: [{ ...segment('x'), youtubeUrl }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'None of the songs has a YouTube video link' });
    expect(ytdlpCalls()).toEqual([]);
  });

  test('skips a song that is not a YouTube video and still builds the rest', async () => {
    const jobId = await startJob([segment('ok-good'), { ...segment('x', 'TWICE - Typo'), youtubeUrl: 'http://localhost:3020/' }]);
    const job = await waitForJob(jobId);
    expect(job.status).toBe('complete');
    expect(job.failedSegments).toEqual([
      { title: 'TWICE - Typo', youtubeUrl: 'http://localhost:3020/', reason: 'Not a YouTube video link', index: 1 },
    ]);
    expect(ytdlpCalls().join('\n')).not.toContain('localhost');
  }, 30_000);

  test('sends yt-dlp a clean watch URL', async () => {
    const jobId = await startJob([{ ...segment('x'), youtubeUrl: 'https://youtu.be/okClean0001?si=abc&t=30' }]);
    await waitForJob(jobId);
    expect(ytdlpCalls().join('\n')).toContain('-- https://www.youtube.com/watch?v=okClean0001');
  }, 30_000);
});

describe('job lookups', () => {
  test.each(['/status/nope', '/download/nope', '/download-setlist/nope'])('%s is 404 for an unknown job', async (path) => {
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
    expect(Object.keys((await res.json()) as object).sort()).toEqual(['activeJobs', 'lastUpdateCheck', 'lastUpdateError', 'version']);
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

  test('GET /youtube/info only looks up YouTube videos', async () => {
    const res = await api.request(`/youtube/info?url=${encodeURIComponent('http://localhost:3020/')}`);
    expect(res.status).toBe(400);
    expect(ytdlpCalls()).toEqual([]);
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

describe('per-song progress', () => {
  async function waitFor(jobId: string, check: (job: any) => boolean): Promise<any> {
    for (let i = 0; i < 300; i++) {
      const job = (await (await api.request(`/status/${jobId}`)).json()) as any;
      if (check(job)) return job;
      await Bun.sleep(20);
    }
    throw new Error('condition never met');
  }

  test('reports each song as it goes, and skips before the mix is done', async () => {
    const jobId = await startJob([segment('unavailable'), segment('ok-progress')]);
    // The second song waits 1.5 s before downloading, so this is mid-run.
    const mid = await waitFor(jobId, (j) => j.songs[0].state === 'skipped');
    expect(mid.status).toBe('processing');
    expect(mid.phase).toBe('downloading');
    expect(typeof mid.startedAt).toBe('number');
    expect(mid.songs[1].state).toBe('working');
    expect(mid.failedSegments).toHaveLength(1);
    expect(mid.failedSegments[0].index).toBe(0);

    const done = await waitForJob(jobId);
    expect(done.status).toBe('complete');
    expect(done.phase).toBe('combining');
    expect(done.songs.map((s: any) => s.state)).toEqual(['skipped', 'done']);
    expect(done.songs[0].reason).toContain('Video unavailable');
    expect(done.progress).toBeUndefined();
  }, 30_000);
});

describe('setlist download', () => {
  test('lists when each song starts in the MP3', async () => {
    const jobId = await startJob([segment('ok-set-a', 'TWICE - FANCY'), segment('ok-set-b', 'IVE - I AM')]);
    expect((await waitForJob(jobId)).status).toBe('complete');

    const res = await api.request(`/download-setlist/${jobId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    expect(res.headers.get('Content-Disposition')).toContain(`random-dance-setlist-${jobId.slice(0, 8)}.txt`);
    const text = await res.text();
    expect(text).toContain('2 songs');
    expect(text).toMatch(/^00:05  01  TWICE - FANCY \(0:00-0:05\)$/m);
    // countdown + song 1 + countdown, from the real file lengths.
    const second = text.match(/^(\d\d):(\d\d)  02  IVE - I AM/m);
    expect(second).not.toBeNull();
    const startsAt = Number(second![1]) * 60 + Number(second![2]);
    const mp3 = join(TEMP_DIR, `output_${jobId}.mp3`);
    const total = await audioDuration(mp3);
    const last = total - 5; // the last song is 0:00-0:05
    expect(Math.abs(startsAt - last)).toBeLessThanOrEqual(1);
  }, 30_000);

  test('uses the 3-second countdown when the host picks it', async () => {
    const jobId = await startJob([segment('ok-short-a', 'TWICE - FANCY'), segment('ok-short-b', 'IVE - I AM')], { countdownSeconds: 3 });
    expect((await waitForJob(jobId)).status).toBe('complete');

    const text = await (await api.request(`/download-setlist/${jobId}`)).text();
    expect(text).toContain('A 3-second countdown plays before every song.');
    expect(text).toMatch(/^00:03  01  TWICE - FANCY/m);
    // 3 s + 5 s song + 3 s + 5 s song
    expect(await audioDuration(join(TEMP_DIR, `output_${jobId}.mp3`))).toBeCloseTo(16, 0);
  }, 30_000);

  test('only 3 picks the short countdown; anything else is 5', () => {
    expect(countdownChoice(3)).toBe(3);
    for (const v of [5, undefined, null, '3', 4, 0, 10]) expect(countdownChoice(v)).toBe(5);
  });

  test('is 404 for an unknown job', async () => {
    expect((await api.request('/download-setlist/nope')).status).toBe(404);
  });
});

describe('expired mixes', () => {
  test('a mix whose file was cleaned up answers 410', async () => {
    const jobId = await startJob([segment('ok-expired')]);
    await waitForJob(jobId);
    rmSync(join(TEMP_DIR, `output_${jobId}.mp3`));
    rmSync(join(TEMP_DIR, `${jobId}_setlist.txt`));
    const res = await api.request(`/download/${jobId}`);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'This mix has expired. Generate it again.' });
    expect((await api.request(`/download-setlist/${jobId}`)).status).toBe(410);
  }, 30_000);

  test('a job stuck for 6 hours is forgotten', async () => {
    const jobId = await startJob([segment('ok-stuck')]);
    pruneJobs(Date.now() + 7 * 60 * 60 * 1000);
    expect((await api.request(`/status/${jobId}`)).status).toBe(404);
    // Let it finish so its files are cleaned up with the rest.
    await Bun.sleep(1500);
  }, 30_000);

  test('jobs older than a day are forgotten', async () => {
    const jobId = await startJob([segment('ok-pruned')]);
    await waitForJob(jobId);
    pruneJobs(Date.now() + 25 * 60 * 60 * 1000);
    expect((await api.request(`/status/${jobId}`)).status).toBe(404);
  }, 30_000);
});

describe('search limit', () => {
  test('asks yt-dlp for 20 results', async () => {
    const res = await api.request(`/youtube/search?q=${encodeURIComponent(`limit test ${Date.now()}`)}`);
    expect(res.status).toBe(200);
    expect(ytdlpCalls()[0]).toStartWith('ytsearch20:limit test');
  });
});
