import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: () =>
    z.object({
      title: z.string(),
      subtitle: z.string().optional(),
      description: z.string().optional(),
      pubDate: z.union([z.string(), z.coerce.date()]).optional(),
      updatedDate: z.coerce.date().optional(),
      heroImage: z.string().optional(),
      author: z.string().optional(),
      publisher: z.string().optional(),
      editionKey: z.string().optional(),
      language: z.string().optional(),
      editionLanguage: z.string().optional(),
      isbn: z.string().optional(),
      status: z.enum(['Reading', 'Read', 'Plan to Read']).optional(),
    }),
});

export const collections = { blog };