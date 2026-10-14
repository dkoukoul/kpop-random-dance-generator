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
    });
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
