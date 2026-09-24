import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { relatedPosts, slugOf } from '../../src/lib/related-posts.js';

const post = (slug, title, category, pubDate = '2026-01-01') => ({ id: `${slug}/index.mdoc`, data: { title, category, pubDate } });
const all = [
  post('seo-for-roofers', 'SEO for Roofers', 'seo', '2026-04-29'),
  post('seo-for-builders', 'SEO for Builders', 'seo', '2026-03-01'),
  post('seo-for-plumbers', 'SEO for Plumbers', 'seo', '2026-03-02'),
  post('roofing-website-tips', 'Website Tips for Roofing Companies', 'web-design', '2025-01-01'),
  post('newest-seo-post', 'Why SEO Takes Time', 'seo', '2026-09-20'),
  post('newest-web-post', 'Our Latest News', 'web-design', '2026-09-21'),
  post('web-design-for-salons', 'Web Design for Salons', 'web-design', '2026-07-22'),
  post('web-design-for-fitness-businesses', 'Web Design for Fitness Businesses', 'web-design', '2026-05-03'),
  post('draft', 'SEO for Roofers draft', 'seo', null),
];

test('related posts are chosen by topic, not by which posts are newest', () => {
  const picks = relatedPosts(all[0], all).map(slugOf);
  assert.equal(picks.length, 4);
  assert.ok(picks.includes('seo-for-builders') && picks.includes('seo-for-plumbers'), 'same series first');
  assert.ok(picks.includes('roofing-website-tips'), 'shared topic word counts across categories');
  assert.ok(!picks.includes('draft'), 'undated drafts are never linked');
  assert.ok(!picks.includes('seo-for-roofers'), 'never links to itself');
  assert.deepEqual(relatedPosts(all[6], all, 1).map(slugOf), ['web-design-for-fitness-businesses'], 'industry series link to each other');
});

test('on the real blog, every post gets related links and none hoards them', () => {
  const posts = fs.readdirSync('src/content/blog').map(d => {
    const text = fs.readFileSync(`src/content/blog/${d}/index.mdoc`, 'utf8');
    const field = k => (text.match(new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, 'm')) || [])[1];
    return { id: `${d}/index.mdoc`, data: { title: field('title'), category: field('category'), pubDate: field('pubDate') } };
  });
  const inbound = new Map(posts.map(p => [p.id, 0]));
  for (const p of posts) {
    const picks = relatedPosts(p, posts);
    assert.equal(new Set(picks.map(r => r.id)).size, picks.length, 'no duplicates');
    for (const r of picks) inbound.set(r.id, inbound.get(r.id) + 1);
  }
  const counts = [...inbound.values()];
  assert.equal(counts.filter(n => n === 0).length, 0, 'no post is left without a related link');
  assert.ok(Math.max(...counts) <= 12, 'no post is linked from everywhere');
});
