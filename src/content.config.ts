import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const songs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/songs' }),
  schema: z.object({
    releaseId: z.string(),
    title: z.string(),
    type: z.enum(['single', 'ep', 'album']),
    trackNumber: z.number().nullable().optional(),
    releaseDate: z.string(),
    genres: z.array(z.string()).optional().default([]),
    themes: z.array(z.string()).optional().default([]),
    mood: z.array(z.string()).optional().default([]),
    bpm: z.number().nullable().optional(),
    key: z.string().optional().default(''),
  }),
});

export const collections = { songs };
