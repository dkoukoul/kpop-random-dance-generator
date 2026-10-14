import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { generateReport, saveReport } from '../src/services/report';
import type { SongSegment } from '../src/types';

const seg = (title: string, artist?: string, startTime = '0:30', endTime = '1:00'): SongSegment => ({
  youtubeUrl: 'https://www.youtube.com/watch?v=x',
  title,
  startTime,
  endTime,
  artist,
});

const bandsOf = async (...segments: SongSegment[]) =>
  (await generateReport(segments)).playlist.map((p) => p.band);

describe('generateReport: band detection', () => {
  test('finds a band from the band list in the video title', async () => {
    expect(await bandsOf(seg("BTS (방탄소년단) 'Dynamite' Official MV"))).toEqual(['BTS']);
  });

  test('prefers the longest matching name (NCT 127 over NCT)', async () => {
    expect(await bandsOf(seg("NCT 127 엔시티 127 'Fact Check' MV"))).toEqual(['NCT 127']);
  });

  test('falls back to the channel name when the title has no band', async () => {
    expect(await bandsOf(seg('Supernova', 'aespa'))).toEqual(['aespa']);
  });

  test('matches whole words only (IVE is not found inside "Alive")', async () => {
    expect(await bandsOf(seg('Alive - Song'))).toEqual(['Alive']);
  });

  test('falls back to "Artist - Title" for bands not in the list', async () => {
    const { playlist } = await generateReport([seg('Some Indie Band - Cool Song (Official Audio) [MV]')]);
    expect(playlist[0]).toMatchObject({ band: 'Some Indie Band', title: 'Cool Song' });
  });

  test('uses "Unknown" when nothing can be detected', async () => {
    const { playlist } = await generateReport([seg('Just a title')]);
    expect(playlist[0]).toMatchObject({ band: 'Unknown', title: 'Just a title' });
  });

  test('strips the band name from "Band - Title"', async () => {
    const { playlist } = await generateReport([seg('NCT 127 - Fact Check')]);
    expect(playlist[0]).toMatchObject({ band: 'NCT 127', title: 'Fact Check' });
  });

  // Today the title keeps quotes and upload labels ("'Dynamite' Official MV").
  test.todo('extracts a clean song title from "BTS \'Dynamite\' Official MV"', () => {});
});

describe('generateReport: playlist and statistics', () => {
  test('numbers songs in order and keeps their cut points', async () => {
    const { playlist } = await generateReport([
      seg('TWICE - FANCY', undefined, '0:45', '1:20'),
      seg('BTS - Dope', undefined, '1:00', '1:30'),
    ]);
    expect(playlist.map((p) => [p.order, p.startTime, p.endTime])).toEqual([
      [1, '0:45', '1:20'],
      [2, '1:00', '1:30'],
    ]);
  });

  test('reports each band as a rounded percentage of the mix', async () => {
    const { statistics } = await generateReport([seg('BTS - Dope'), seg('BTS - Fire'), seg('TWICE - FANCY')]);
    expect(statistics).toEqual({ BTS: '67%', TWICE: '33%' });
  });

  test('lists failed songs only when there are some', async () => {
    expect((await generateReport([seg('BTS - Dope')])).failedSongs).toBeUndefined();
    const failed = [{ title: 'Gone', youtubeUrl: 'https://youtu.be/x', reason: 'Video unavailable' }];
    expect((await generateReport([seg('BTS - Dope')], failed)).failedSongs).toEqual(failed);
  });
});

describe('saveReport', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kpop-report-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('writes the report as JSON named after the job', async () => {
    const report = await generateReport([seg('BTS - Dope')]);
    const path = await saveReport(report, 'job-123', dir);
    expect(path).toBe(join(dir, 'job-123_report.json'));
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(JSON.parse(JSON.stringify(report)));
  });
});
