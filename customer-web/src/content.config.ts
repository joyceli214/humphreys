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

const settings = defineCollection({
  loader: glob({
    pattern: '*.json',
    base: './src/content/settings'
  }),
  schema: z.object({
    topBarItems: z.array(
      z.object({
        text: z.string()
      })
    ).default([]),
    menuItems: z.array(
      z.object({
        label: z.string(),
        href: z.string()
      })
    ).default([]),
    headerActions: z.object({
      primary: z.object({
        enabled: z.boolean().default(true),
        label: z.string().default('Get a Quote'),
        href: z.string().default('/contact')
      }),
      secondary: z.object({
        enabled: z.boolean().default(true),
        label: z.string().default('View Inventory'),
        href: z.string().default('/items-for-sale')
      })
    }).default({
      primary: {
        enabled: true,
        label: 'Get a Quote',
        href: '/contact'
      },
      secondary: {
        enabled: true,
        label: 'View Inventory',
        href: '/items-for-sale'
      }
    })
  })
});

export const collections = { pages, settings };
