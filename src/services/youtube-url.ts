/**
 * Server-side check for the URLs we hand to yt-dlp.
 *
 * yt-dlp's generic extractor will fetch any http(s) URL, including addresses
 * on this server (other sites run on localhost here). So a request may only
 * name a YouTube video: we pull out the video ID and rebuild a clean watch URL
 * from it, and anything else is rejected.
 */

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const VIDEO_ID = /^[\w-]{11}$/;

/** The 11-character video ID of a YouTube video URL (or a bare ID); null otherwise. */
export function youtubeVideoId(input: unknown): string | null {
  // Request bodies are untrusted JSON, so this may not even be a string.
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (VIDEO_ID.test(value)) return value;

  // People paste "youtube.com/watch?v=…" without the scheme.
  const withScheme = /^((www|m|music)\.)?(youtube\.com|youtu\.be)\//i.test(value) ? `https://${value}` : value;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;

  const host = url.hostname.toLowerCase();
  let id: string | null | undefined;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else {
      const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/);
      id = m?.[1];
    }
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** A clean `https://www.youtube.com/watch?v=<id>` for a YouTube video URL; null otherwise. */
export function toYoutubeWatchUrl(input: unknown): string | null {
  const id = youtubeVideoId(input);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}
