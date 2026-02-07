// Types for the K-Pop Random Dance Generator

export interface SongSegment {
  youtubeUrl: string;
  title: string;
  startTime: string; // "MM:SS" or "HH:MM:SS"
  endTime: string;
}

export interface GenerateRequest {
  segments: SongSegment[];
}

export interface VideoInfo {
  title: string;
  duration: number; // seconds
  thumbnail: string;
  channel: string;
}

export interface GenerateResult {
  id: string;
  filename: string;
  status: 'processing' | 'complete' | 'error';
  error?: string;
}

export interface ReportItem {
  order: number;
  band: string;
  title: string;
  startTime: string;
  endTime: string;
}

export interface ReportStats {
  [band: string]: string; // "XX%"
}

export interface Report {
  playlist: ReportItem[];
  statistics: ReportStats;
}
