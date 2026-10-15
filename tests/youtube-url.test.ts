import { describe, expect, test } from 'bun:test';
import { toYoutubeWatchUrl, youtubeVideoId } from '../src/services/youtube-url';

const ID = 'gdZLi9oWNZg';
const WATCH = `https://www.youtube.com/watch?v=${ID}`;

describe('toYoutubeWatchUrl', () => {
  test.each([
    WATCH,
    `http://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}&t=42s`,
    `https://music.youtube.com/watch?v=${ID}&list=RDAMVM`,
    `https://www.youtube.com/watch?feature=share&v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc&t=30`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}?start=10`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `  ${WATCH}  `,
    `youtube.com/watch?v=${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `youtu.be/${ID}`,
    ID,
  ])('accepts %p', (input) => {
    expect(toYoutubeWatchUrl(input)).toBe(WATCH);
  });

  test.each([
    null,
    undefined,
    '',
    'not a url',
    'http://localhost:3020/',
    `http://127.0.0.1:3000/?v=${ID}`,
    `https://example.com/watch?v=${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `https://evil.example/youtu.be/${ID}`,
    `https://user:pass@www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com:8443/watch?v=${ID}`,
    `ftp://www.youtube.com/watch?v=${ID}`,
    `file:///etc/passwd`,
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=waytoolongvideoid',
    'https://www.youtube.com/playlist?list=PL1234567890',
    'https://www.youtube.com/@channel',
    '--update-to=nightly',
    'Lemonade',
    'https://open.spotify.com/track/abc',
    `localhost:3020/watch?v=${ID}`,
    123,
    {},
  ])('rejects %p', (input) => {
    expect(toYoutubeWatchUrl(input)).toBeNull();
    expect(youtubeVideoId(input)).toBeNull();
  });

  // Separate: test.each would spread an array into the callback's arguments.
  test('rejects an array', () => {
    expect(toYoutubeWatchUrl([WATCH])).toBeNull();
  });
});
