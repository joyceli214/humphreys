import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const pages = defineCollection({
  loader: glob({
    pattern: '*.mdoc',
    base: './src/content/pages'
  }),
  schema: z.object({
    slug: z.string(),
    title: z.string(),
    description: z.string().optional(),
    heading: z.string().optional()
  })
});

export const collections = { pages };
