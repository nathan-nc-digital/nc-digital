// Shared by the composer and Worker. Provider validation remains authoritative.
export const SOCIAL_PLATFORMS = [
  { service: 'facebook', label: 'Facebook', limit: 5000 },
  { service: 'linkedin', label: 'LinkedIn', limit: 3000 },
  { service: 'instagram', label: 'Instagram', limit: 2200 },
  { service: 'twitter', label: 'X', limit: 280 },
  { service: 'googlebusiness', label: 'Google Business Profile', limit: 1500 },
];
export const MEDIA_PATH = '/social-media/';
export const MEDIA_KEY = /^[a-f0-9-]{36}\.jpg$/;

export function postText(post, service) {
  const caption = (post.overrides?.[service] || post.caption || '').trim();
  // GBP has a dedicated link button. Instagram retains the supplied URL as text.
  return service === 'googlebusiness' || !post.link ? caption : `${caption}\n\n${post.link}`;
}

export function validatePost(post, now = Date.now()) {
  if (!post || typeof post !== 'object') throw new Error('Enter your post details.');
  if (typeof post.caption !== 'string' || !post.caption.trim() || post.caption.length > 5000) throw new Error('Enter a caption of up to 5,000 characters.');
  if (post.link && (typeof post.link !== 'string' || post.link.length > 2048)) throw new Error('Enter a valid website link.');
  if (post.link) {
    let url;
    try { url = new URL(post.link); } catch { throw new Error('Enter a full website link starting with https://.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter a public http or https website link.');
  }
  if (!Array.isArray(post.images) || post.images.length > 4 || post.images.some(key => typeof key !== 'string' || !MEDIA_KEY.test(key))) throw new Error('Choose up to four uploaded images.');
  if (!Array.isArray(post.channelIds) || !post.channelIds.length || post.channelIds.length > 5 || new Set(post.channelIds).size !== post.channelIds.length || post.channelIds.some(id => typeof id !== 'string' || id.length > 100)) throw new Error('Choose between one and five connected accounts.');
  if (!['now', 'schedule'].includes(post.mode)) throw new Error('Choose publish now or schedule.');
  if (post.mode === 'schedule' && (!Number.isFinite(Date.parse(post.dueAt)) || Date.parse(post.dueAt) < now + 60000)) throw new Error('Choose a publishing time at least one minute in the future.');
  if (post.overrides && (typeof post.overrides !== 'object' || Array.isArray(post.overrides))) throw new Error('Invalid platform captions.');
  for (const platform of SOCIAL_PLATFORMS) {
    const value = post.overrides?.[platform.service];
    if (value !== undefined && (typeof value !== 'string' || value.length > 5000)) throw new Error(`Check the ${platform.label} caption.`);
  }
  return post;
}

export function buildPostInput(post, channel, origin) {
  const platform = SOCIAL_PLATFORMS.find(item => item.service === channel.service);
  if (!platform) throw new Error('Unsupported social account.');
  if (channel.isDisconnected || channel.isLocked || channel.isQueuePaused) throw new Error(`${platform.label}: reconnect or unpause this account in Buffer first.`);
  const text = postText(post, channel.service);
  // X weights links, emoji and some scripts differently; Buffer performs its exact validation.
  if (channel.service !== 'twitter' && [...text].length > platform.limit) throw new Error(`${platform.label}: shorten the caption to ${platform.limit} characters.`);
  if (channel.service === 'instagram' && !post.images.length) throw new Error('Instagram needs at least one image.');
  const images = channel.service === 'googlebusiness' ? post.images.slice(0, 1) : post.images;
  const input = {
    channelId: channel.id, text, assets: images.map(key => ({ image: { url: `${origin}${MEDIA_PATH}${key}` } })),
    schedulingType: 'automatic', mode: post.mode === 'schedule' ? 'customScheduled' : 'shareNow',
    needsApproval: false, saveToDraft: false,
  };
  if (post.mode === 'schedule') input.dueAt = new Date(post.dueAt).toISOString();
  if (channel.service === 'instagram') input.metadata = { instagram: { type: 'post', shouldShareToFeed: true } };
  if (channel.service === 'googlebusiness') input.metadata = { google: {
    type: 'whats_new', detailsWhatsNew: post.link ? { button: 'learn_more', link: post.link } : { button: 'none' },
  } };
  return input;
}
