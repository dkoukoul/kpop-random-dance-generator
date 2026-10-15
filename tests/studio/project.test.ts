import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  fromDraft,
  fromPendingMix,
  fromProjectFile,
  projectFileName,
  signature,
  songFromSaved,
  toDraft,
  toProjectFile,
} from '../../public/app/studio/project.js';

const ID = 'gdZLi9oWNZg';

// A file saved by the classic page (its exportProject writes state.songs as is).
const classicFile = {
  version: '1.0',
  timestamp: '2026-10-01T10:00:00.000Z',
  songs: [
    {
      youtubeUrl: `https://www.youtube.com/watch?v=${ID}`,
      title: "BTS 'Dynamite' Official MV",
      startTime: '0:52',
      endTime: '1:22',
      isExpanded: true,
      cutSource: 'user',
      info: { title: "BTS 'Dynamite' Official MV", thumbnail: 't.jpg', channel: 'HYBE LABELS', duration: 223 },
    },
    { youtubeUrl: 'https://youtu.be/kOHB85vDuow?si=x', title: 'TWICE FANCY', startTime: '0:50', endTime: '1:24', info: null },
    { youtubeUrl: '', title: 'empty card', startTime: '0:00', endTime: '0:30' },
  ],
};

describe('project files', () => {
  test('opens a file saved by the classic page', () => {
    const { songs, skipped } = fromProjectFile(JSON.stringify(classicFile));
    expect(skipped).toBe(1);
    expect(songs).toHaveLength(2);
    expect(songs[0]).toMatchObject({ videoId: ID, start: 52, end: 82, cutSource: 'user', info: { duration: 223 } });
    // Cuts from a file are the user's: never replaced by a popular cut.
    expect(songs[1]).toMatchObject({ youtubeUrl: 'https://www.youtube.com/watch?v=kOHB85vDuow', cutSource: 'import', info: null });
  });

  test('round-trips through a saved file', () => {
    const { songs } = fromProjectFile(JSON.stringify(classicFile));
    const file = toProjectFile(songs, new Date('2026-10-15T12:00:00Z'));
    expect(file.version).toBe('1.0');
    expect(file.shuffleEnabled).toBe(false);
    expect(file.songs[0]).toMatchObject({ youtubeUrl: `https://www.youtube.com/watch?v=${ID}`, startTime: '0:52', endTime: '1:22' });
    const again = fromProjectFile(JSON.stringify(file)).songs;
    expect(signature(again)).toBe(signature(songs));
  });

  test('keeps the popular cut so "Back to popular cut" survives a save', () => {
    const song = songFromSaved({ youtubeUrl: ID, startTime: '1:00', endTime: '1:30', cutSource: 'user', popularCut: { startTime: '0:41', endTime: '1:12', uses: 7 } }, 'import')!;
    expect(song.popularCut).toEqual({ start: 41, end: 72, uses: 7 });
    const back = fromProjectFile(JSON.stringify(toProjectFile([{ ...song, id: 'x' }]))).songs[0];
    expect(back!.popularCut).toEqual({ start: 41, end: 72, uses: 7 });
  });

  test.each(['not json', '{}', '{"songs": "x"}', '{"songs": [{"youtubeUrl": "https://example.com"}]}'])(
    'refuses a file that is not a mix: %p',
    (text) => {
      expect(() => fromProjectFile(text)).toThrow();
    },
  );

  test('names the file by date', () => {
    expect(projectFileName(new Date(2026, 9, 5))).toBe('kpop-dance-mix-2026-10-05.json');
  });
});

describe('draft', () => {
  test('reads a draft saved by the classic page, including its popular-cut note', () => {
    const draft = {
      version: 1,
      savedAt: 1,
      songs: [{ youtubeUrl: `https://www.youtube.com/watch?v=${ID}`, title: 'Dynamite', startTime: '0:52', endTime: '1:22', cutSource: 'popular', popularUses: 12, info: null }],
    };
    expect(fromDraft(JSON.stringify(draft))![0]).toMatchObject({ cutSource: 'popular', popularCut: { start: 52, end: 82, uses: 12 } });
  });

  test('a draft Studio writes is one the classic page can read', () => {
    const songs = fromDraft(JSON.stringify(toDraft([{ ...songFromSaved({ youtubeUrl: ID, title: 'x', startTime: '0:10', endTime: '0:40' }, 'draft')!, id: 'a' }])))!;
    const saved = toDraft(songs.map((s, i) => ({ ...s, id: String(i) })));
    expect(saved.version).toBe(1);
    expect(saved.songs[0]).toMatchObject({ youtubeUrl: `https://www.youtube.com/watch?v=${ID}`, startTime: '0:10', endTime: '0:40' });
  });

  test.each([null, '', 'garbage', '{"songs": []}', '{"version": 1}'])('no usable draft: %p', (raw) => {
    expect(fromDraft(raw as any)).toBeNull();
  });
});

describe('ready-made mixes', () => {
  test('opens a real group-page mix in the page order, with its cuts', () => {
    const html = readFileSync(join(import.meta.dir, '..', '..', 'public', 'random-dance', 'twice.html'), 'utf-8');
    const raw = html.match(/<script type="application\/json" id="data-[^"]+">(.*?)<\/script>/s)![1]!;
    const payload = JSON.parse(raw);
    const mix = fromPendingMix(raw)!;
    expect(mix.name).toBe(payload.name);
    expect(mix.songs.map((s: any) => s.youtubeUrl)).toEqual(payload.songs.map((s: any) => s.youtubeUrl));
    expect(mix.songs.every((s: any) => s.cutSource === 'mix')).toBe(true);
    expect(mix.songs[0]!.start).toBe(66);
  });

  test.each([null, '', '{', '{"songs": []}'])('nothing to open: %p', (raw) => {
    expect(fromPendingMix(raw as any)).toBeNull();
  });
});
