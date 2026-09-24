import { SOCIAL_PLATFORMS } from './social-posts.js';

export function showcasePath(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) throw new Error('Invalid showcase link.');
  return `/admin/showcase/${slug}/`;
}

export function validateShowcaseDraft(value, slug) {
  const base = showcasePath(slug);
  if (!value || value.version !== 1 || typeof value.caption !== 'string' || !value.caption.trim() || value.caption.length > 5000) throw new Error('This showcase has no valid caption.');
  const url = new URL(value.link);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('This showcase has an invalid website link.');
  if (!Array.isArray(value.images) || value.images.length !== 4 || value.images.some(path => typeof path !== 'string' || !path.startsWith(base) || !/^[a-z0-9-]+\.png$/.test(path.slice(base.length)))) throw new Error('This showcase must contain four local images.');
  const overrides = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const text = value.overrides?.[platform.service];
    if (typeof text !== 'string' || !text.trim() || text.length > platform.limit) throw new Error(`Check the showcase ${platform.label} caption.`);
    overrides[platform.service] = text;
  }
  return { caption: value.caption, link: url.href, images: value.images, overrides };
}
