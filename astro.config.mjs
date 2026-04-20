// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import markdoc from '@astrojs/markdoc';
import sitemap from '@astrojs/sitemap';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';
import keystatic from '@keystatic/astro';

export default defineConfig({
  site: 'https://nc-digital.co.uk',
  output: 'static',
  adapter: cloudflare(),
  integrations: [
    react(),
    markdoc(),
    sitemap(),
    tailwind({ applyBaseStyles: false }),
    ...(process.env.NODE_ENV !== 'production' ? [keystatic()] : []),
  ],
  image: {
    service: { entrypoint: 'astro/assets/services/sharp' },
  },
});
