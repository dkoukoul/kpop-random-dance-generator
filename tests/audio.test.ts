import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { cleanupTempFiles, concatenateWithCountdown, fadeOutEnd } from '../src/services/audio';
import { audioDuration } from './helpers';

// Uses the real ffmpeg on this machine; the countdown clip doubles as a "song".
const COUNTDOWN = join(import.meta.dir, '..', 'assets', 'countdown.mp3');
const dir = mkdtempSync(join(tmpdir(), 'kpop-audio-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('concatenateWithCountdown', () => {
  test('rejects an empty mix', async () => {
    await expect(concatenateWithCountdown([], COUNTDOWN, join(dir, 'empty.mp3'))).rejects.toThrow('No segments provided');
  });

  test('puts a countdown before every song and leaves only the MP3 behind', async () => {
    const countdown = await audioDuration(COUNTDOWN);
    const out = join(dir, 'mix.mp3');

    await concatenateWithCountdown([COUNTDOWN, COUNTDOWN], COUNTDOWN, out);

    // countdown + song + countdown + song, each song here being one countdown clip long
    expect(await audioDuration(out)).toBeCloseTo(countdown * 4, 0);
    expect(readdirSync(dir).filter((f) => f.startsWith('mix'))).toEqual(['mix.mp3']);
  }, 30_000);

  // Today ffmpeg's concat demuxer logs the missing file but exits 0, so the mix
  // is silently built without that song.
  test.todo('fails clearly when a segment file is missing', () => {});
});

/** Mean volume in dB of `seconds` of audio starting at `from`. */
async function meanVolume(path: string, from: number, seconds: number): Promise<number> {
  const proc = Bun.spawn(['ffmpeg', '-ss', String(from), '-t', String(seconds), '-i', path, '-af', 'volumedetect', '-f', 'null', '-'], {
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return Number(stderr.match(/mean_volume: (-?[\d.]+|-inf) dB/)?.[1] ?? -Infinity);
}

/** A steady tone, so any drop in volume is the fade. */
async function tone(path: string, seconds: number): Promise<void> {
  const proc = Bun.spawn(['ffmpeg', '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-ac', '2', '-c:a', 'libmp3lame', '-q:a', '2', path], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  expect(await proc.exited).toBe(0);
}

describe('fadeOutEnd', () => {
  test('fades the last seconds out and keeps the length', async () => {
    const song = join(dir, 'fade.mp3');
    await tone(song, 6);
    const full = await meanVolume(song, 0, 1);

    await fadeOutEnd(song, 2);

    expect(await audioDuration(song)).toBeCloseTo(6, 0);
    expect(await meanVolume(song, 0, 1)).toBeCloseTo(full, 0); // untouched before the fade
    expect(await meanVolume(song, 5.5, 0.4)).toBeLessThan(full - 15); // nearly silent at the end
    expect(readdirSync(dir).filter((f) => f.startsWith('fade'))).toEqual(['fade.mp3']);
  }, 30_000);

  test('never fades more than half of a short cut', async () => {
    const song = join(dir, 'short.mp3');
    await tone(song, 2);
    const full = await meanVolume(song, 0, 0.5);

    await fadeOutEnd(song, 3);

    expect(await meanVolume(song, 0, 0.5)).toBeCloseTo(full, 0);
  }, 30_000);
});

describe('cleanupTempFiles', () => {
  test('deletes the files and ignores ones that are already gone', async () => {
    const a = join(dir, 'a.mp3');
    writeFileSync(a, 'x');
    await cleanupTempFiles([a, join(dir, 'never-existed.mp3')]);
    expect(existsSync(a)).toBe(false);
  });
});
