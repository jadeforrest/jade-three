import type { ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';
import { getCollection } from 'astro:content';
import type { Release } from '../types/releases';
import { buildMediaIndex, resolvePlayer } from './resolve-media';

// Vite gives these hashed URLs, so a replaced clip or cover gets a new address
// and /_astro/* can be cached forever.
const audioFiles = import.meta.glob<string>('/src/assets/media/*/*.mp3', {
  query: '?url',
  import: 'default',
  eager: true,
});
const coverFiles = import.meta.glob<ImageMetadata>('/src/assets/media/*/cover.jpg', {
  import: 'default',
  eager: true,
});

const songs = await getCollection('songs');
const mediaIndex = buildMediaIndex(audioFiles, coverFiles, songs.map((song) => song.id));

export function getReleasePlayer(release: Release) {
  const songSlugs = songs
    .filter((song) => song.data.releaseId === release.id)
    .map((song) => song.id);
  return resolvePlayer(release, songSlugs, mediaIndex);
}

export async function getCoverUrl(cover: ImageMetadata, width: number): Promise<string> {
  const image = await getImage({ src: cover, width, height: width, format: 'webp' });
  return image.src;
}
