import { describe, expect, test } from 'bun:test';
import { getStats, logGeneration, logVisit } from '../src/services/analytics';
import type { SongSegment } from '../src/types';

// The analytics DB is shared by every test file in the run, so assertions are
// about changes and about this file's own unique URLs, not absolute totals.
const url = (name: string) => `https://www.youtube.com/watch?v=analytics-${name}-${crypto.randomUUID()}`;
const seg = (youtubeUrl: string, startTime = '0:30', endTime = '1:00'): SongSegment => ({
  youtubeUrl,
  title: 'TWICE "FANCY" M/V',
  startTime,
  endTime,
});

describe('analytics', () => {
  test('logVisit counts a visit', async () => {
    const before = getStats().totalVisits;
    await logVisit('test-agent', '127.0.0.1');
    expect(getStats().totalVisits).toBe(before + 1);
  });

  test('logGeneration counts a mix and its songs', async () => {
    const before = getStats().totalGenerations;
    await logGeneration('job-1', [seg(url('a')), seg(url('b'))]);
    expect(getStats().totalGenerations).toBe(before + 1);
  });

  test('top songs count the same video and cut across mixes', async () => {
    const popular = url('popular');
    for (let i = 0; i < 25; i++) await logGeneration(`job-pop-${i}`, [seg(popular)]);

    const top = getStats().topSongs as { youtube_url: string; start_time: string; end_time: string; count: number }[];
    expect(top[0]).toMatchObject({ youtube_url: popular, start_time: '0:30', end_time: '1:00', count: 25 });
  });

  test('top songs list the same video with a different cut separately', async () => {
    const video = url('two-cuts');
    for (let i = 0; i < 30; i++) await logGeneration(`job-cut-a-${i}`, [seg(video, '0:30', '1:00')]);
    for (let i = 0; i < 29; i++) await logGeneration(`job-cut-b-${i}`, [seg(video, '1:10', '1:40')]);

    const top = getStats().topSongs as { youtube_url: string; start_time: string; count: number }[];
    const cuts = top.filter((s) => s.youtube_url === video).map((s) => [s.start_time, s.count]);
    expect(cuts).toEqual([['0:30', 30], ['1:10', 29]]);
  });

  test('top songs are capped at 10', async () => {
    for (let i = 0; i < 12; i++) await logGeneration(`job-many-${i}`, [seg(url(`many-${i}`))]);
    expect(getStats().topSongs.length).toBe(10);
  });
});
