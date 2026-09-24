// @ts-check

import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import markdoc from '@astrojs/markdoc';
import sitemap from '@astrojs/sitemap';
import tailwind from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import keystatic from '@keystatic/astro';

import sentry from '@sentry/astro';

// Out-of-area location pages (North/Mid/West Wales) — set to noindex 2026-07-27
// since NC Digital's real service area is Merthyr Tydfil/South Wales. Kept off the
// sitemap here to match the noindex meta tag set in BaseHead via loc.data.noindex.
const outOfAreaTowns = [
  'aberystwyth', 'bangor', 'buckley', 'builth-wells', 'caernarfon', 'cardigan',
  'colwyn-bay', 'conwy', 'denbigh', 'dolgellau', 'fishguard', 'flint',
  'haverfordwest', 'hay-on-wye', 'holyhead', 'holywell', 'llandrindod-wells',
  'llandudno', 'machynlleth', 'mid-wales', 'milford-haven', 'mold', 'newtown',
  'north-wales', 'pembroke', 'pembroke-dock', 'porthmadog', 'prestatyn',
  'pwllheli', 'rhyl', 'ruthin', 'tenby', 'welshpool', 'wrexham',
];
const outOfAreaVerticals = [
  'seo', 'web-design', 'ecommerce-web-design', 'logo-design',
  'managed-starter-websites', 'website-maintenance',
];
const outOfAreaSlugs = new Set(
  outOfAreaTowns.flatMap((town) => outOfAreaVerticals.map((v) => `/${v}-${town}/`))
);

export default defineConfig({
  site: 'https://nc-digital.co.uk',
  output: 'static',
  // Preserve spaces between inline elements when upgrading to Astro 7.
  compressHTML: true,
  vite: { css: { postcss: { plugins: [tailwind(), autoprefixer()] } } },
  build: {
    inlineStylesheets: 'always',
  },
  integrations: [
    react(),
    markdoc(),
    sitemap({
      filter: (page) => {
        if (page.includes('/admin/') || page.includes('/report/')) return false;
        // Deliberately noindex (form confirmation), so it must not be listed either.
        if (page.endsWith('/thank-you/')) return false;
        const path = new URL(page).pathname;
        return !outOfAreaSlugs.has(path);
      },
    }),
    ...(process.env.NODE_ENV !== 'production' ? [keystatic()] : []),
    ...(process.env.CRM_LOCAL_BUILD === '1' ? [] : [sentry({
      project: 'nc-digital',
      org: 'nc-digital-42',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      enabled: {
        client: true,
        server: false,
      },
    })]),
  ],
  image: {
    service: { entrypoint: 'astro/assets/services/sharp' },
  },
});
