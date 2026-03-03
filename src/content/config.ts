import { defineCollection, z } from 'astro:content';

const songs = defineCollection({
  type: 'content',
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
