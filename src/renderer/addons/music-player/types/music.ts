export interface Track {
  id: string | number;
  title: string;
  artist: string;
  album?: string;
  duration: number; // in seconds
  url: string; // Stream URL or local blob URL
  coverUrl?: string;
  lrc?: string; // Pre-loaded LRC string or fetched dynamically
  isOffline?: boolean;
  downloadProgress?: number; // 0 - 100
  genre?: string;
  releaseDate?: string;
}

export interface LyricLine {
  time: number; // in seconds
  text: string;
  id: number;
}

export interface Playlist {
  id: string | number;
  title: string;
  description?: string;
  coverUrl?: string;
  tracks: Track[];
  curator?: string;
}

export interface Album {
  id: string | number;
  title: string;
  artist: string;
  coverUrl: string;
  releaseYear?: number | string;
  tracks: Track[];
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface SleepTimerState {
  isActive: boolean;
  mode: 'duration' | 'end_of_track' | null;
  durationMinutes: number;
  remainingSeconds: number;
}
