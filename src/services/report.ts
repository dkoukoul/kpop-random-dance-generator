import type { SongSegment, Report, ReportItem, ReportStats } from "../types";
import { join } from "path";

/**
 * Parses "Artist - Title" string.
 * Strategies:
 * 1. Split by " - "
 * 2. Split by "-"
 * 3. If no split, Artist = "Unknown", Title = full string
 */
function parseTitle(videoTitle: string): { band: string; title: string } {
  // Common separators
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

export function generateReport(segments: SongSegment[]): Report {
  const playlist: ReportItem[] = [];
  const bandCounts: Record<string, number> = {};
  
  segments.forEach((segment, index) => {
    const { band, title } = parseTitle(segment.title);
    
    playlist.push({
      order: index + 1,
      band,
      title,
      startTime: segment.startTime,
      endTime: segment.endTime
    });
    
    // Stats
    bandCounts[band] = (bandCounts[band] || 0) + 1;
  });
  
  // Calculate percentages
  const total = segments.length;
  const statistics: ReportStats = {};
  
  Object.entries(bandCounts).forEach(([band, count]) => {
    const percentage = Math.round((count / total) * 100);
    statistics[band] = `${percentage}%`;
  });
  
  return { playlist, statistics };
}

export async function saveReport(report: Report, jobId: string, tempDir: string): Promise<string> {
  const filePath = join(tempDir, `${jobId}_report.json`);
  await Bun.write(filePath, JSON.stringify(report, null, 2));
  return filePath;
}
