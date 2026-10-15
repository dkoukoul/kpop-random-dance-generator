import { describe, expect, test } from 'bun:test';
import {
  createSetlist,
  findDuplicates,
  generateProblem,
  identifyGroup,
  isPlaylistLink,
  looksLikeLink,
  runtime,
  spreadOutGroups,
  youtubeVideoId,
} from '../../public/app/studio/setlist.js';

const ID = 'gdZLi9oWNZg';
const song = (videoId: string, extra: Record<string, unknown> = {}) => ({
  youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
  videoId,
  title: `Song ${videoId}`,
  group: '',
  start: 50,
  end: 80,
  ...extra,
});

describe('links', () => {
  test('reads the video ID from every YouTube link form', () => {
    for (const link of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}?si=x`,
      `youtube.com/watch?v=${ID}`,
      `https://m.youtube.com/watch?feature=share&v=${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      ID,
    ]) {
      expect(youtubeVideoId(link)).toBe(ID);
    }
    for (const bad of ['bts dynamite', `https://example.com/watch?v=${ID}`, 'https://www.youtube.com/playlist?list=PLx', '', null]) {
      expect(youtubeVideoId(bad as any)).toBeNull();
    }
  });

  test('tells a link from search words', () => {
    expect(looksLikeLink('https://open.spotify.com/track/1')).toBe(true);
    expect(looksLikeLink('youtu.be/abc')).toBe(true);
    expect(looksLikeLink('stray kids maniac')).toBe(false);
    expect(isPlaylistLink('https://www.youtube.com/playlist?list=PL123')).toBe(true);
    expect(isPlaylistLink(`https://www.youtube.com/watch?v=${ID}&list=PL123`)).toBe(false);
  });
});

describe('totals and checks', () => {
  test('runtime adds a 5-second countdown before every song', () => {
    expect(runtime([])).toBe(0);
    expect(runtime([song('a'.repeat(11)), song('b'.repeat(11), { start: 10, end: 15 })])).toBe(35 + 10);
  });

  test('finds extra copies of the same video', () => {
    const songs = [song('aaaaaaaaaaa', { id: '1' }), song('bbbbbbbbbbb', { id: '2' }), song('aaaaaaaaaaa', { id: '3' }), song('aaaaaaaaaaa', { id: '4' })];
    expect(findDuplicates(songs)).toEqual([{ videoId: 'aaaaaaaaaaa', title: 'Song aaaaaaaaaaa', extraIds: ['3', '4'] }]);
    expect(findDuplicates(songs.slice(0, 2))).toEqual([]);
  });

  test('says why Generate is not ready, pointing at the song', () => {
    expect(generateProblem([])).toEqual({ index: -1, message: 'Add at least one song to generate.' });
    expect(generateProblem([song('aaaaaaaaaaa', { id: '1' })])).toBeNull();
    expect(generateProblem([song('aaaaaaaaaaa', { id: '1' }), song('bbbbbbbbbbb', { id: '2', start: 90, end: 80 })])).toEqual({
      index: 1,
      id: '2',
      message: 'Song 02: the end must be after the start.',
    });
    expect(generateProblem([song('aaaaaaaaaaa', { id: '1', loadError: 'gone' })])!.message).toBe(
      "Song 01 can't load. Fix or remove it to generate.",
    );
    expect(generateProblem([song('aaaaaaaaaaa', { id: '1', end: 200, info: { duration: 150 } })])!.message).toBe(
      'Song 01: the end is after the video ends.',
    );
  });
});

describe('groups', () => {
  const bands = ['TWICE', 'IVE', 'BTS', 'Stray Kids'];

  test('finds the group in the title, then the channel', () => {
    expect(identifyGroup('TWICE "FANCY" M/V', 'JYP Entertainment', bands)).toBe('TWICE');
    expect(identifyGroup('Dynamite (Official MV)', 'HYBE LABELS BTS', bands)).toBe('BTS');
    // Whole words only: "LIVE" is not IVE.
    expect(identifyGroup('LIVE performance', '', bands)).toBe('');
    expect(identifyGroup('NewJeans - Super Shy', '', bands)).toBe('NewJeans');
  });

  test('spreads a group out so it never plays twice in a row when it can', () => {
    const songs = ['A', 'A', 'A', 'B', 'B', 'C'].map((g, i) => ({ id: String(i), group: g }));
    const out = spreadOutGroups(songs, (s: any) => s.group);
    for (let i = 1; i < out.length; i++) expect(out[i].group).not.toBe(out[i - 1].group);
    expect(out).toHaveLength(6);
  });
});

describe('the setlist store', () => {
  test('adds, selects the first song, and reports changes', () => {
    const list = createSetlist();
    const changes: string[] = [];
    list.onChange((c: any) => changes.push(c.type));
    const a = list.add(song('aaaaaaaaaaa'));
    const b = list.add(song('bbbbbbbbbbb'));
    expect(list.songs.map((s: any) => s.id)).toEqual([a.id, b.id]);
    expect(list.selectedId).toBe(a.id);
    expect(changes).toEqual(['add', 'add']);
  });

  test('moves within bounds only', () => {
    const list = createSetlist();
    const a = list.add(song('aaaaaaaaaaa'));
    const b = list.add(song('bbbbbbbbbbb'));
    expect(list.move(a.id, -1)).toBe(false);
    expect(list.move(a.id, 1)).toBe(true);
    expect(list.songs.map((s: any) => s.id)).toEqual([b.id, a.id]);
  });

  test('remove + restore puts the song back in its place, and selection moves on', () => {
    const list = createSetlist();
    const a = list.add(song('aaaaaaaaaaa'));
    const b = list.add(song('bbbbbbbbbbb'));
    const c = list.add(song('ccccccccccc'));
    list.select(b.id);
    const undo = list.remove(b.id)!;
    expect(list.selectedId).toBe(c.id);
    expect(list.songs).toHaveLength(2);
    list.restore(undo);
    expect(list.songs.map((s: any) => s.id)).toEqual([a.id, b.id, c.id]);
    // Restoring twice does nothing.
    list.restore(undo);
    expect(list.songs).toHaveLength(3);
  });

  test('removing the last song clears the selection', () => {
    const list = createSetlist();
    const a = list.add(song('aaaaaaaaaaa'));
    list.remove(a.id);
    expect(list.selectedId).toBeNull();
  });

  test('shuffle keeps every song and returns the old order', () => {
    const list = createSetlist();
    for (const v of ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd']) list.add(song(v));
    const before = list.songs;
    let n = 0;
    const previous = list.shuffle(() => '', () => [0.1, 0.9, 0.5][n++ % 3]!);
    expect(previous).toBe(before);
    expect([...list.songs].map((s: any) => s.id).sort()).toEqual(before.map((s: any) => s.id).sort());
  });

  test('update changes one song without touching the others', () => {
    const list = createSetlist();
    const a = list.add(song('aaaaaaaaaaa'));
    const b = list.add(song('bbbbbbbbbbb'));
    const before = list.find(b.id);
    list.update(a.id, { start: 10, cutSource: 'user' });
    expect(list.find(a.id)).toMatchObject({ start: 10, cutSource: 'user', end: 80 });
    expect(list.find(b.id)).toBe(before);
  });
});
