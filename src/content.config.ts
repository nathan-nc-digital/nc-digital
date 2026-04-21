import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const services = defineCollection({
  loader: glob({ pattern: '**/index.mdoc', base: './src/content/services' }),
  schema: z.object({
    title: z.string(),
    headline: z.string(),
    description: z.string(),
    features: z.array(z.string()),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
  }),
});

const portfolio = defineCollection({
  loader: glob({ pattern: '**/index.mdoc', base: './src/content/portfolio' }),
  schema: z.object({
    title: z.string(),
    client: z.string(),
    services: z.array(z.string()),
    summary: z.string(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: '**/index.mdoc', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    pubDate: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
  }),
});

const locations = defineCollection({
  loader: glob({ pattern: '**/index.mdoc', base: './src/content/locations' }),
  schema: z.object({
    title: z.string(),
    town: z.string(),
    county: z.string().optional(),
    serviceType: z.enum(['web-design', 'seo', 'both']),
    headline: z.string(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
  }),
});

export const collections = { services, portfolio, blog, locations };
