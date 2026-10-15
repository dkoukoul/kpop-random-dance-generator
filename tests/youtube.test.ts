import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  downloadSegment,
  formatSecondsToTime,
  getVideoInfo,
  isClientBlockedError,
  isTransientYoutubeError,
  parseTimeToSeconds,
  resampleHeatmap,
  searchVideos,
} from '../src/services/youtube';
import { audioDuration, fakeYtdlpOutput, resetFakeYtdlp, ytdlpCalls } from './helpers';

const outDir = mkdtempSync(join(tmpdir(), 'kpop-yt-'));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));
beforeEach(resetFakeYtdlp);

describe('parseTimeToSeconds', () => {
  test('parses M:SS, MM:SS and H:MM:SS', () => {
    expect(parseTimeToSeconds('0:00')).toBe(0);
    expect(parseTimeToSeconds('1:23')).toBe(83);
    expect(parseTimeToSeconds('12:05')).toBe(725);
    expect(parseTimeToSeconds('1:02:03')).toBe(3723);
  });

  test('parses plain seconds, which the frontend accepts', () => {
    expect(parseTimeToSeconds('90')).toBe(90);
    expect(parseTimeToSeconds('0')).toBe(0);
  });

  test('returns 0 for garbage instead of NaN', () => {
    expect(parseTimeToSeconds('abc')).toBe(0);
    expect(parseTimeToSeconds('1:2:3:4')).toBe(0);
  });
});

describe('formatSecondsToTime', () => {
  test('formats under and over an hour', () => {
    expect(formatSecondsToTime(0)).toBe('0:00');
    expect(formatSecondsToTime(83)).toBe('1:23');
    expect(formatSecondsToTime(3723)).toBe('1:02:03');
  });

  test('drops fractional seconds', () => {
    expect(formatSecondsToTime(83.9)).toBe('1:23');
  });

  test('round-trips with parseTimeToSeconds', () => {
    for (const s of [0, 5, 59, 60, 599, 3599, 3600, 7322]) {
      expect(parseTimeToSeconds(formatSecondsToTime(s))).toBe(s);
    }
  });
});

describe('YouTube error classification', () => {
  // These decide whether a failed download is retried, moved to another
  // player client, or given up on. Getting them wrong either wastes minutes
  // per song or drops songs that would have downloaded.
  test.each([
    'ERROR: [youtube] abc: Sign in to confirm you’re not a bot',
    'ERROR: [youtube] abc: Sign in to confirm youre not a bot',
    'Your IP is rate-limited by YouTube',
    'This content isn’t available, try again later',
    'HTTP Error 429: Too Many Requests',
    'HTTP Error 503: Service Unavailable',
    'yt-dlp download timed out after 240s',
  ])('transient: %s', (msg) => {
    expect(isTransientYoutubeError(msg)).toBe(true);
  });

  test.each([
    'ERROR: unable to download video data: HTTP Error 403: Forbidden',
    'ERROR: ffmpeg exited with code 8',
    'ERROR: [youtube] abc: Requested format is not available',
    'Only images are available for download',
    'The page needs to be reloaded',
    'WARNING: [youtube] abc: PO Token is required',
    'Some formats are missing: SABR streaming',
  ])('client blocked: %s', (msg) => {
    expect(isClientBlockedError(msg)).toBe(true);
  });

  test.each([
    'ERROR: [youtube] abc: Video unavailable',
    'ERROR: [youtube] abc: Private video',
    'ERROR: [youtube] abc: This video is not available in your country',
  ])('permanent (neither): %s', (msg) => {
    expect(isTransientYoutubeError(msg)).toBe(false);
    expect(isClientBlockedError(msg)).toBe(false);
  });
});

describe('downloadSegment', () => {
  test('downloads on the first try with the default player client', async () => {
    const out = join(outDir, 'ok.mp3');
    await downloadSegment('https://www.youtube.com/watch?v=ok', '0:00', '0:05', out);
    expect(existsSync(out)).toBe(true);
    const calls = ytdlpCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('--download-sections *0:00-0:05');
    expect(calls[0]).not.toContain('player_client');
  });

  test('passes the URL after `--` so it can never be read as a yt-dlp option', async () => {
    const out = join(outDir, 'dash.mp3');
    await downloadSegment('--update-to=evil/repo', '0:00', '0:05', out);
    expect(ytdlpCalls()[0]).toEndWith(' -- --update-to=evil/repo');
  });

  test('trims the cue-point excess so the segment has the requested length', async () => {
    // The fake returns a ~5s file for a 3s request, like yt-dlp starting at an earlier cue point.
    const out = join(outDir, 'trim.mp3');
    await downloadSegment('https://www.youtube.com/watch?v=ok', '1:00', '1:03', out);
    expect(await audioDuration(out)).toBeCloseTo(3, 0);
  });

  test('trims segments given in plain seconds too', async () => {
    const out = join(outDir, 'trim-seconds.mp3');
    await downloadSegment('https://www.youtube.com/watch?v=ok', '60', '63', out);
    expect(await audioDuration(out)).toBeCloseTo(3, 0);
  });

  test('gives up at once on a video that is genuinely unavailable', async () => {
    const out = join(outDir, 'gone.mp3');
    await expect(
      downloadSegment('https://www.youtube.com/watch?v=unavailable', '0:00', '0:05', out),
    ).rejects.toThrow(/Video unavailable/);
    expect(ytdlpCalls()).toHaveLength(1);
  });

  test('falls back through the player clients when YouTube returns 403', async () => {
    const out = join(outDir, 'mweb.mp3');
    await downloadSegment('https://www.youtube.com/watch?v=needs-mweb', '0:00', '0:05', out);
    expect(existsSync(out)).toBe(true);
    const clients = ytdlpCalls().map((c) => c.match(/player_client=(\S+)/)?.[1] ?? 'default');
    expect(clients).toEqual(['default', 'web_embedded', 'tv_embedded', 'mweb']);
  });

  test('throws the 403 once every player client has been tried', async () => {
    const out = join(outDir, 'blocked.mp3');
    await expect(
      downloadSegment('https://www.youtube.com/watch?v=blocked', '0:00', '0:05', out),
    ).rejects.toThrow(/403/);
    expect(ytdlpCalls()).toHaveLength(4);
  });
});

describe('searchVideos', () => {
  const line = (o: object) => JSON.stringify(o);

  test('maps yt-dlp JSON lines to results, filling in missing fields', async () => {
    fakeYtdlpOutput(
      [
        line({ title: 'TWICE "FANCY" M/V', duration: 214, thumbnail: 'https://i.ytimg.com/a.jpg', channel: 'JYP', webpage_url: 'https://www.youtube.com/watch?v=aaa' }),
        line({ duration: 0, thumbnails: [{ url: 'small.jpg' }, { url: 'big.jpg' }], uploader: 'Someone', id: 'bbb' }),
        'not json at all',
      ].join('\n'),
    );
    const results = (await searchVideos(`fancy ${Date.now()}`)) as any[];
    expect(results).toEqual([
      { title: 'TWICE "FANCY" M/V', duration: 214, thumbnail: 'https://i.ytimg.com/a.jpg', channel: 'JYP', url: 'https://www.youtube.com/watch?v=aaa' },
      { title: 'Unknown Title', duration: 0, thumbnail: 'big.jpg', channel: 'Someone', url: 'https://www.youtube.com/watch?v=bbb' },
    ]);
  });

  test('serves a repeated search from the cache without calling yt-dlp', async () => {
    const query = `cached ${Date.now()}`;
    fakeYtdlpOutput(line({ title: 'Song', id: 'ccc' }));
    const first = await searchVideos(query);
    expect(ytdlpCalls()).toHaveLength(1);
    const second = await searchVideos(query);
    expect(second).toEqual(first);
    expect(ytdlpCalls()).toHaveLength(1);
  });

  test('returns an empty list when nothing is found', async () => {
    fakeYtdlpOutput('');
    expect(await searchVideos(`nothing ${Date.now()}`)).toEqual([]);
  });

  test('throws when yt-dlp fails with no output', async () => {
    fakeYtdlpOutput('', { stderr: 'ERROR: network down', exitCode: 1 });
    await expect(searchVideos(`broken ${Date.now()}`)).rejects.toThrow(/network down/);
  });
});

describe('getVideoInfo', () => {
  test('maps the yt-dlp JSON to video info', async () => {
    fakeYtdlpOutput(JSON.stringify({ title: 'Dynamite', duration: 199, thumbnail: 't.jpg', uploader: 'HYBE LABELS' }));
    expect(await getVideoInfo('https://www.youtube.com/watch?v=xyz')).toEqual({
      title: 'Dynamite',
      duration: 199,
      thumbnail: 't.jpg',
      channel: 'HYBE LABELS',
      heatmap: null,
    });
  });

  test('includes the video ID and the "Most replayed" curve', async () => {
    const heatmap = [
      { start_time: 0, end_time: 50, value: 1 },
      { start_time: 50, end_time: 100, value: 0.25 },
    ];
    fakeYtdlpOutput(JSON.stringify({ id: 'heatMap0001', title: 'x', duration: 100, heatmap }));
    const info = await getVideoInfo('https://www.youtube.com/watch?v=heatMap0001');
    expect(info.id).toBe('heatMap0001');
    expect(info.heatmap).toHaveLength(100);
    expect(info.heatmap!.slice(48, 52)).toEqual([1, 1, 0.25, 0.25]);
  });

  test('serves a video it looked up before from the cache', async () => {
    fakeYtdlpOutput(JSON.stringify({ id: 'cachedInfo1', title: 'Cached', duration: 60 }));
    const url = 'https://www.youtube.com/watch?v=cachedInfo1';
    const first = await getVideoInfo(url);
    const second = await getVideoInfo(url);
    expect(second).toEqual(first);
    expect(ytdlpCalls()).toHaveLength(1);
  });

  test('does not cache a lookup without a length', async () => {
    const url = 'https://www.youtube.com/watch?v=noLength001';
    fakeYtdlpOutput(JSON.stringify({ id: 'noLength001', title: 'Half', duration: 0 }));
    await getVideoInfo(url);
    await getVideoInfo(url);
    expect(ytdlpCalls()).toHaveLength(2);
  });

  test('does not cache a failed lookup', async () => {
    const url = 'https://www.youtube.com/watch?v=failedInfo1';
    fakeYtdlpOutput('', { stderr: 'ERROR: Video unavailable', exitCode: 1 });
    await expect(getVideoInfo(url)).rejects.toThrow();
    resetFakeYtdlp();
    fakeYtdlpOutput(JSON.stringify({ id: 'failedInfo1', title: 'Back', duration: 60 }));
    expect((await getVideoInfo(url)).title).toBe('Back');
  });

  test('passes the URL after `--` so it can never be read as a yt-dlp option', async () => {
    fakeYtdlpOutput(JSON.stringify({ title: 'x' }));
    await getVideoInfo('--exec=touch /tmp/pwned');
    expect(ytdlpCalls()[0]).toEndWith(' -- --exec=touch /tmp/pwned');
  });

  test('throws with the yt-dlp error when it fails', async () => {
    fakeYtdlpOutput('', { stderr: 'ERROR: Video unavailable', exitCode: 1 });
    await expect(getVideoInfo('https://www.youtube.com/watch?v=gone')).rejects.toThrow(/Video unavailable/);
  });

  test('throws on output that is not JSON', async () => {
    fakeYtdlpOutput('<html>oops</html>');
    await expect(getVideoInfo('https://www.youtube.com/watch?v=x')).rejects.toThrow(/Invalid JSON/);
  });
});

describe('resampleHeatmap', () => {
  test('is null when YouTube has no replay data', () => {
    expect(resampleHeatmap(undefined, 200)).toBeNull();
    expect(resampleHeatmap(null, 200)).toBeNull();
    expect(resampleHeatmap([], 200)).toBeNull();
    expect(resampleHeatmap([{ start_time: 0, end_time: 10, value: 1 }], 0)).toBeNull();
    expect(resampleHeatmap([{ nonsense: true }], 200)).toBeNull();
  });

  test('gives evenly spaced values, clamped to 0..1 and rounded', () => {
    const raw = [
      { start_time: 0, end_time: 2, value: 0.123456 },
      { start_time: 2, end_time: 4, value: 1.7 },
    ];
    expect(resampleHeatmap(raw, 4, 4)).toEqual([0.12, 0.12, 1, 1]);
  });

  test('uses the nearest end when marks do not cover the whole video', () => {
    const raw = [{ start_time: 1, end_time: 2, value: 0.5 }];
    expect(resampleHeatmap(raw, 4, 4)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
});
