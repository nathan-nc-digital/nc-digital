import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const services = defineCollection({
  loader: glob({ pattern: '**/index.mdoc', base: './src/content/services/' }),
  schema: z.object({
    title: z.string(),
    headline: z.string(),
    description: z.string(),
    features: z.array(z.string()),
    relatedServices: z.array(z.object({ label: z.string(), href: z.string() })).optional(),
    locationLinks: z.array(z.object({ label: z.string(), href: z.string() })).optional(),
    locationSectionTitle: z.string().optional(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
  }),
});

const portfolio = defineCollection({
  loader: glob({ pattern: '**/index.mdoc', base: './src/content/portfolio/' }),
  schema: z.object({
    title: z.string(),
    client: z.string(),
    services: z.array(z.string()),
    industry: z.array(z.string()).optional(),
    order: z.number().optional(),
    summary: z.string(),
    imageAlt: z.string().optional(), // descriptive alt for the project's lead image (used on the homepage grid)
    siteUrl: z.string().optional(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: '**/index.mdoc', base: './src/content/blog/' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    pubDate: z.string().optional(),
    description: z.string().optional(),
    heroImage: image().optional(),
    heroImageAlt: z.string().optional(),
    category: z.string().optional(),
    location: z.array(z.string()).optional(),
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
    serviceType: z.enum(['web-design', 'seo', 'both', 'logo-design', 'ecommerce']),
    headline: z.string(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    locationLinks: z.array(z.object({ label: z.string(), href: z.string() })).optional(),
    locationSectionTitle: z.string().optional(),
    services: z.array(z.object({ name: z.string(), description: z.string(), href: z.string() })).optional(),
    noindex: z.boolean().optional(),
  }),
});

export const collections = { services, portfolio, blog, locations };
