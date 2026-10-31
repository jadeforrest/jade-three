import type { Release } from '../types/releases';

/**
 * Decides which player a release gets. Kept free of Astro imports so it can be
 * tested directly; src/lib/media.ts feeds it the real files.
 *
 * A release plays locally only when every track has a clip. Anything less
 * (including no media at all) falls back to Spotify, so songs can be converted
 * one at a time. Misnamed or orphaned files fail the build instead, because
 * they would otherwise fall back silently.
 */

export interface MediaFolder<Cover> {
  cover: Cover;
  audio: Map<number, string>;
}

export type MediaIndex<Cover> = Map<string, MediaFolder<Cover>>;

export type PlayerPlan<Cover> =
  | {
      kind: 'local';
      cover: Cover;
      tracks: { trackNumber: number; title: string; src: string }[];
    }
  | {
      kind: 'spotify';
      spotifyId: string;
      type: 'album' | 'track';
      height: number;
    };

const MEDIA_ROOT = '/src/assets/media/';

function parseMediaPath(path: string): { folder: string; file: string } {
  const relative = path.startsWith(MEDIA_ROOT) ? path.slice(MEDIA_ROOT.length) : '';
  const [folder, file, ...rest] = relative.split('/');
  if (!folder || !file || rest.length > 0) {
    throw new Error(`Unexpected media path: ${path}`);
  }
  return { folder, file };
}

/** Clips are named by track number: 01.mp3, 02.mp3, ... */
function parseTrackNumber(path: string, file: string): number {
  const match = /^(\d{2})\.mp3$/.exec(file);
  if (!match || Number(match[1]) === 0) {
    throw new Error(`Media file must be named like 01.mp3: ${path}`);
  }
  return Number(match[1]);
}

export function buildMediaIndex<Cover>(
  audio: Record<string, string>,
  covers: Record<string, Cover>,
  songSlugs: string[],
): MediaIndex<Cover> {
  const coverByFolder = new Map(
    Object.entries(covers).map(([path, cover]) => [parseMediaPath(path).folder, cover]),
  );

  const index: MediaIndex<Cover> = new Map();
  for (const [path, src] of Object.entries(audio)) {
    const { folder, file } = parseMediaPath(path);
    if (!songSlugs.includes(folder)) {
      throw new Error(`Media folder has no song page: ${folder}`);
    }
    const cover = coverByFolder.get(folder);
    if (cover === undefined) {
      throw new Error(`Media folder is missing cover.jpg: ${folder}`);
    }
    const entry = index.get(folder) ?? { cover, audio: new Map<number, string>() };
    entry.audio.set(parseTrackNumber(path, file), src);
    index.set(folder, entry);
  }
  return index;
}

function spotifyPlan<Cover>(release: Release): PlayerPlan<Cover> {
  // Singles embed the track. An album ID in a /embed/track URL renders "Page
  // not found", so a single with no track ID has to use the album embed.
  const trackId = release.type === 'single' ? release.tracks[0]?.spotifyId : null;
  return {
    kind: 'spotify',
    spotifyId: trackId ?? release.spotifyId,
    type: trackId ? 'track' : 'album',
    height: release.type === 'single' ? 152 : 352,
  };
}

/** songSlugs are the song pages belonging to this release. */
export function resolvePlayer<Cover>(
  release: Release,
  songSlugs: string[],
  index: MediaIndex<Cover>,
): PlayerPlan<Cover> {
  const folders = songSlugs.filter((slug) => index.has(slug));
  if (folders.length > 1) {
    throw new Error(`Release "${release.title}" has several media folders: ${folders.join(', ')}`);
  }

  const media = index.get(folders[0]);
  if (!media) return spotifyPlan(release);

  const trackNumbers = new Set(release.tracks.map((track) => track.trackNumber));
  const stray = [...media.audio.keys()].filter((n) => !trackNumbers.has(n));
  if (stray.length > 0) {
    throw new Error(`"${release.title}" has no track number ${stray.join(', ')} (${folders[0]})`);
  }

  if (media.audio.size < trackNumbers.size) return spotifyPlan(release);

  return {
    kind: 'local',
    cover: media.cover,
    tracks: release.tracks.map(({ trackNumber, title }) => ({
      trackNumber,
      title,
      src: media.audio.get(trackNumber) as string,
    })),
  };
}
