import type { SongSegment, Report, ReportItem, FailedSegment } from "../types";
import { join } from "path";

// Cache for band list
let bandListCache: string[] | null = null;

/**
 * Load band list from assets file
 */
async function loadBandList(): Promise<string[]> {
  if (bandListCache) {
    return bandListCache;
  }
  
  try {
    const filePath = join(process.cwd(), "assets", "band-list.txt");
    const file = Bun.file(filePath);
    const text = await file.text();
    bandListCache = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return bandListCache;
  } catch (error) {
    console.error("Failed to load band list:", error);
    return [];
  }
}

/**
 * Check if text contains a band name using word boundaries
 */
function checkMatch(text: string, band: string): boolean {
  if (!text || !band) return false;
  
  // Escape special regex characters
  const escapedBand = band.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  
  // Create regex with word boundaries (allows special K-Pop characters)
  const regex = new RegExp(
    `(^|[^a-zA-Z0-9])${escapedBand}([^a-zA-Z0-9]|$)`,
    "i"
  );
  
  return regex.test(text);
}

/**
 * Identify band from title by checking against band list
 */
async function identifyBandFromList(title: string, channel: string): Promise<string | null> {
  const bandList = await loadBandList();
  
  if (bandList.length === 0) {
    return null;
  }
  
  // Sort by length descending to match more specific names first
  const sortedBands = [...bandList].sort((a, b) => b.length - a.length);
  
  // Try matching against title first
  for (const band of sortedBands) {
    if (checkMatch(title, band)) {
      console.log(`Matched band: ${band}`);
      return band;
    }
  }
  
  // Try matching against channel if title doesn't match
  for (const band of sortedBands) {
    if (checkMatch(channel, band)) {
      console.log(`Matched band: ${band}`);
      return band;
    }
  }
  
  return null;
}

/**
 * Parses "Artist - Title" string.
 * Strategies:
 * 1. Check against band-list.txt for accurate matching
 * 2. Split by " - "
 * 3. Split by "-"
 * 4. If no split, Artist = "Unknown", Title = full string
 */
async function parseTitle(videoTitle: string, videoChannel?: string): Promise<{ band: string; title: string }> {
  // First, try to identify band from the band list
  const identifiedBand = await identifyBandFromList(videoTitle, videoChannel || "");
  
  if (identifiedBand) {
    // Remove band name from title to get clean song title
    let cleanTitle = videoTitle;
    
    // Try to remove the band name and common separators
    const separators = [" - ", " : ", "-"];
    for (const sep of separators) {
      const pattern = new RegExp(`^((${identifiedBand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})${sep}|${sep}${identifiedBand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*`, "i");
      cleanTitle = cleanTitle.replace(pattern, "");
    }
    
    // If still contains the band name, try to remove it with word boundaries
    if (cleanTitle === videoTitle) {
      const boundaryPattern = new RegExp(`(^|[^a-zA-Z0-9])${identifiedBand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-zA-Z0-9]|$)`, "gi");
      cleanTitle = cleanTitle.replace(boundaryPattern, "").replace(/^[\s\-:]+|[\s\-:]+$/g, "");
    }
    
    // Remove common garbage like [MV], (Official Audio), etc.
    cleanTitle = cleanTitle.replace(/\[.*?\]|\(.*?\)/g, "").trim();
    
    return { band: identifiedBand, title: cleanTitle || videoTitle.trim() };
  }
  
  // Fallback to traditional parsing if band list matching fails
  const separators = [" - ", " : ", "-"];
  
  for (const sep of separators) {
    if (videoTitle.includes(sep)) {
      const parts = videoTitle.split(sep);
      if (parts.length >= 2) {
        // Assume first part is Artist, second is Title (and potential extra info)
        const band = parts[0]!.trim();
        // Join the rest back in case title had the separator too
        const title = parts.slice(1).join(sep).trim();
        // Remove common garbage like [MV], (Official Audio), etc.
        const cleanTitle = title.replace(/\[.*?\]|\(.*?\)/g, "").trim();
        return { band, title: cleanTitle || title };
      }
    }
  }
  
  return { band: "Unknown", title: videoTitle.trim() };
}

export async function generateReport(segments: SongSegment[]): Promise<Report> {
  const playlist: ReportItem[] = [];

  for (const segment of segments) {
    const { band, title } = await parseTitle(segment.title, segment.artist);
    
    playlist.push({
      order: playlist.length + 1,
      band,
      title,
      startTime: segment.startTime,
      endTime: segment.endTime
    });
  }

  return { playlist };
}

/** Seconds to "mm:ss" or "h:mm:ss" for the setlist. */
function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

/**
 * When each song starts in the MP3. The mix is countdown, song, countdown,
 * song..., so song i starts after i+1 countdowns and the songs before it.
 * Uses the real file lengths, which can differ from the cut by a fraction of
 * a second per song. Joining the files also loses ~30 ms per file to MP3
 * padding, so when the finished mix's length is known the times are scaled
 * to it; otherwise the last songs of a long mix would drift seconds late.
 */
export function songStartTimes(countdownSeconds: number, songSeconds: number[], mixSeconds?: number): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const length of songSeconds) {
    t += countdownSeconds;
    starts.push(t);
    t += length;
  }
  if (mixSeconds && mixSeconds > 0 && t > 0) {
    const k = mixSeconds / t;
    return starts.map((s) => s * k);
  }
  return starts;
}

/**
 * A plain-text setlist: when each song starts in the MP3, then what was
 * skipped. The time lines also work as YouTube chapters.
 */
export function buildSetlist(
  playlist: ReportItem[],
  startsAt: number[],
  totalSeconds: number,
  failed: FailedSegment[] = [],
  countdownSeconds = 5,
  fadeOutSeconds = 0,
): string {
  const lines = [
    `K-Pop random dance mix: ${playlist.length} song${playlist.length === 1 ? '' : 's'}, ${clock(totalSeconds)}`,
    `A ${countdownSeconds}-second countdown plays before every song.`,
  ];
  if (fadeOutSeconds > 0) lines.push(`Each song fades out over its last ${fadeOutSeconds} second${fadeOutSeconds === 1 ? '' : 's'}.`);
  lines.push('');
  const width = String(playlist.length).length < 2 ? 2 : String(playlist.length).length;
  playlist.forEach((item, i) => {
    const name = item.band && item.band !== 'Unknown' ? `${item.band} - ${item.title}` : item.title;
    lines.push(`${clock(startsAt[i] ?? 0)}  ${String(i + 1).padStart(width, '0')}  ${name} (${item.startTime}-${item.endTime})`);
  });
  if (failed.length > 0) {
    lines.push('', `Skipped (${failed.length}):`);
    for (const f of failed) lines.push(`- ${f.title}: ${f.reason}`);
  }
  lines.push('', 'Made with https://kpopgenerator.cloud', '');
  return lines.join('\n');
}
