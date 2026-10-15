import { describe, expect, test } from 'bun:test';
import { formatLeft, lights, plainError, readProgress, SECONDS_PER_SONG } from '../../public/app/studio/progress.js';

const status = (states: string[], extra: Record<string, unknown> = {}) => ({
  status: 'processing',
  phase: 'downloading',
  songs: states.map((state) => ({ state })),
  ...extra,
});

describe('generation progress', () => {
  test('counts finished songs and points at the one being made', () => {
    const p = readProgress(status(['done', 'skipped', 'working', 'waiting']));
    expect(p).toMatchObject({ done: 2, total: 4, current: 3, combining: false });
    expect(p.pct).toBe(45);
  });

  test('estimates from the usual pace first, then from the real one', () => {
    const now = 1_000_000;
    const early = readProgress(status(['working', 'waiting', 'waiting'], { startedAt: now - 2000 }), now);
    expect(early.left).toBeCloseTo(3 * SECONDS_PER_SONG + 8);
    // Two songs in 40 s: 20 s each, one to go.
    const later = readProgress(status(['done', 'done', 'working'], { startedAt: now - 40_000 }), now);
    expect(later.left).toBeCloseTo(20 + 8);
  });

  test('joining the songs is the last stretch; complete is 100%', () => {
    expect(readProgress(status(['done', 'done'], { phase: 'combining' }))).toMatchObject({ combining: true, pct: 95 });
    expect(readProgress({ status: 'complete', phase: 'combining', songs: [{ state: 'done' }] }).pct).toBe(100);
  });

  test('says time left in plain words', () => {
    expect(formatLeft(5)).toBe('a few seconds');
    expect(formatLeft(42)).toBe('about 40 s');
    expect(formatLeft(170)).toBe('about 3 min');
  });
});

describe('lights', () => {
  test('one per song, skipped songs count as done', () => {
    expect(lights(['done', 'skipped', 'working', 'waiting'])).toEqual(['done', 'done', 'working', 'waiting']);
  });

  test('a long setlist shares lights so they stay visible', () => {
    const states = Array.from({ length: 100 }, (_, i) => (i < 50 ? 'done' : i === 50 ? 'working' : 'waiting'));
    const out = lights(states, 20);
    expect(out).toHaveLength(20);
    expect(out.slice(0, 10).every((s: string) => s === 'done')).toBe(true);
    expect(out[10]).toBe('working');
    expect(out[19]).toBe('waiting');
  });
});

describe('error messages', () => {
  test.each([
    ['All segments failed to download', 'None of the songs could be downloaded'],
    ['ERROR: unable to download video data: HTTP Error 403: Forbidden', 'YouTube refused'],
    ['The server took too long to answer.', "YouTube didn't answer in time"],
    ['None of the songs has a YouTube video link', 'None of the songs has a YouTube video link'],
    ['weird', 'Something went wrong'],
  ])('%p', (raw, expected) => {
    expect(plainError(raw)).toContain(expected);
  });
});
