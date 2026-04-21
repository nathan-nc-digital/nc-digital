#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const XML_FILE = join(__dirname, 'wordpress-export.xml');
const OUTPUT_DIR = join(ROOT, 'src/content/blog');

if (!existsSync(XML_FILE)) {
  console.error(`\nError: ${XML_FILE} not found.`);
  console.error('Export your WordPress posts and save the .xml file as scripts/wordpress-export.xml\n');
  process.exit(1);
}

const xml = readFileSync(XML_FILE, 'utf-8');
const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);

console.log(`Found ${items.length} items in WordPress export\n`);

let created = 0;

for (const item of items) {
  const status = item.match(/<wp:status><!\[CDATA\[(.*?)\]\]><\/wp:status>/)?.[1]
    ?? item.match(/<wp:status>(.*?)<\/wp:status>/)?.[1];
  if (status !== 'publish') continue;

  const postType = item.match(/<wp:post_type><!\[CDATA\[(.*?)\]\]><\/wp:post_type>/)?.[1]
    ?? item.match(/<wp:post_type>(.*?)<\/wp:post_type>/)?.[1];
  if (postType !== 'post') continue;

  const title = (item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1]
    ?? item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').trim();
  if (!title) continue;

  const wpSlug = (item.match(/<wp:post_name><!\[CDATA\[(.*?)\]\]><\/wp:post_name>/)?.[1]
    ?? item.match(/<wp:post_name>(.*?)<\/wp:post_name>/)?.[1] ?? '').trim();

  const slug = wpSlug || title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug) continue;

  const rawDate = item.match(/<wp:post_date><!\[CDATA\[(.*?)\]\]><\/wp:post_date>/)?.[1]
    ?? item.match(/<wp:post_date>(.*?)<\/wp:post_date>/)?.[1] ?? '';
  const pubDate = rawDate ? rawDate.split(' ')[0] : '';

  const excerpt = (item.match(/<excerpt:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/excerpt:encoded>/)?.[1]
    ?? '').trim().replace(/<[^>]+>/g, '').substring(0, 300);

  const rawContent = item.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/)?.[1] ?? '';
  const content = htmlToMarkdown(rawContent);

  const cats = [...item.matchAll(/<category domain="category"[^>]*><!\[CDATA\[(.*?)\]\]><\/category>/g)]
    .map(m => m[1].toLowerCase());

  let category = 'web-design';
  if (cats.some(c => c.includes('seo'))) category = 'seo';
  else if (cats.some(c => c.includes('business'))) category = 'business';
  else if (cats.some(c => c.includes('news'))) category = 'news';

  const frontmatter = [
    `title: ${JSON.stringify(title)}`,
    pubDate ? `pubDate: "${pubDate}"` : null,
    excerpt ? `description: ${JSON.stringify(excerpt)}` : null,
    `category: ${category}`,
    `metaTitle: ${JSON.stringify(title + ' | NC Digital')}`,
    excerpt ? `metaDescription: ${JSON.stringify(excerpt.substring(0, 160))}` : null,
  ].filter(Boolean).join('\n');

  const mdoc = `---\n${frontmatter}\n---\n\n${content}\n`;

  const dir = join(OUTPUT_DIR, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.mdoc'), mdoc, 'utf-8');

  console.log(`✓ ${slug}`);
  created++;
}

console.log(`\nDone! Created ${created} posts.\n`);
console.log(`Posts are in src/content/blog/ — review before going live.\n`);

function htmlToMarkdown(html) {
  if (!html) return '';
  return html
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n')
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) =>
      inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n').trim() + '\n\n'
    )
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
      let i = 1;
      return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, () => `${i++}. $1\n`).trim() + '\n\n';
    })
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
