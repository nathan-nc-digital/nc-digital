// Static feed of portfolio case studies for the website review page, which shows prospects
// similar work. Built at compile time with optimised thumbnails.
import { getCollection } from 'astro:content';
import { getImage } from 'astro:assets';
import { portfolioFolders } from '../data/portfolio-folders';

const images = import.meta.glob<{ default: ImageMetadata }>('../assets/portfolio/**/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG}', { eager: true });

// Same choice as the portfolio pages: the project's screenshot folder first, then a flat image named after the slug.
function thumb(slug: string) {
  const folder = portfolioFolders[slug];
  const entries = Object.entries(images).filter(([path]) => !path.split('/').pop()!.toLowerCase().startsWith('whatsapp'));
  const inFolder = folder && entries.find(([path]) => path.includes(`/${folder}/`));
  const flat = entries.find(([path]) => path.split('/').slice(-2, -1)[0] === 'portfolio' && path.split('/').pop()!.replace(/\.[^.]+$/, '') === slug);
  return (inFolder || flat)?.[1].default ?? null;
}

export async function GET() {
  const projects = (await getCollection('portfolio')).sort((a, b) => (a.data.order ?? 99) - (b.data.order ?? 99));
  const items = [];
  for (const project of projects) {
    const slug = project.id.replace('/index.mdoc', '');
    const source = thumb(slug);
    const image = source ? await getImage({ src: source, width: 640, format: 'webp', quality: 72 }) : null;
    items.push({ slug, title: project.data.title, industry: project.data.industry ?? [], summary: project.data.summary, image: image?.src ?? null });
  }
  return new Response(JSON.stringify(items), { headers: { 'Content-Type': 'application/json' } });
}
