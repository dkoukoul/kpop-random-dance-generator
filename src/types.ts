// Types for the K-Pop Random Dance Generator

export interface SongSegment {
  youtubeUrl: string;
  title: string;
  startTime: string; // "MM:SS" or "HH:MM:SS"
  endTime: string;
  artist?: string; // Optional channel/artist name for better band detection
}

export interface GenerateRequest {
  segments: SongSegment[];
  /** Countdown before each song: 3 or 5 seconds (anything else means 5). */
  countdownSeconds?: number;
  /** Fade-out at the end of each song: 1, 2 or 3 seconds (anything else means none). */
  fadeOutSeconds?: number;
}

export interface VideoInfo {
  title: string;
  duration: number; // seconds
  thumbnail: string;
  channel: string;
  url?: string; // search results only
  id?: string; // video info only
  /** YouTube's "Most replayed" curve as 100 values 0..1, or null when YouTube has none. */
  heatmap?: number[] | null;
}

export interface GenerateResult {
  id: string;
  filename: string;
  status: 'processing' | 'complete' | 'error';
  error?: string;
}

export interface FailedSegment {
  title: string;
  youtubeUrl: string;
  reason: string;
  index?: number; // position in the request, from 0
}

export interface ReportItem {
  order: number;
  band: string;
  title: string;
  startTime: string;
  endTime: string;
}

export interface Report {
  playlist: ReportItem[];
}
