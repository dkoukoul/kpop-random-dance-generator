import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { cleanupTempFiles, concatenateWithCountdown } from '../src/services/audio';
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

describe('cleanupTempFiles', () => {
  test('deletes the files and ignores ones that are already gone', async () => {
    const a = join(dir, 'a.mp3');
    writeFileSync(a, 'x');
    await cleanupTempFiles([a, join(dir, 'never-existed.mp3')]);
    expect(existsSync(a)).toBe(false);
  });
});
