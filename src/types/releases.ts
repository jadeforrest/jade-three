export interface Track {
  trackNumber: number;
  title: string;
  spotifyId: string;
  spotifyUrl: string;
  appleMusicUrl: string | null;
  amazonMusicUrl: string | null;
  youtubeUrl: string | null;
  durationMs: number;
  durationFormatted: string;
  isExplicit: boolean;
}

export interface Release {
  id: string;
  type: 'album' | 'single';
  title: string;
  releaseDate: string;
  year: number;
  spotifyId: string;
  spotifyUrl: string;
  appleMusicUrl: string | null;
  amazonMusicUrl: string | null;
  youtubePlaylistUrl: string | null;
  youtubeUrl: string | null;
  artworkUrl: string;
  artworkUrlSmall: string;
  totalTracks: number;
  tracks: Track[];
}

export interface ReleasesData {
  lastUpdated: string;
  artistName: string;
  spotifyArtistId: string;
  releases: Release[];
}
