import { readLimitedBody } from './social-http.js';

const numericId = value => typeof value === 'string' && /^\d+$/.test(value);
const metaError = message => Object.assign(new Error(message), { rejected: true });

export async function metaRequest(env, resource, params = {}, method = 'GET') {
  if (!env.META_PAGE_ACCESS_TOKEN) throw metaError('Connect the Facebook Page before publishing.');
  const version = env.META_GRAPH_VERSION || 'v26.0';
  if (!/^v\d+\.\d+$/.test(version) || !/^(me|\d+)(\/(photos|feed|media|media_publish))?$/.test(resource)) throw metaError('Invalid Meta account configuration.');
  const url = new URL(`https://graph.facebook.com/${version}/${resource}`);
  const encoded = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)]));
  if (method === 'GET') url.search = encoded.toString();
  const response = await fetch(url, {
    method, headers: { Authorization: `Bearer ${env.META_PAGE_ACCESS_TOKEN}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: method === 'POST' ? encoded : undefined, signal: AbortSignal.timeout(15000),
  });
  const data = JSON.parse(new TextDecoder().decode(await readLimitedBody(response, 1024 * 1024)));
  if (data.error) {
    // Only definite client rejections are safe to retry after a publish call.
    const message = String(data.error.message || 'Meta rejected the request.').replaceAll(env.META_PAGE_ACCESS_TOKEN, '[redacted]').slice(0, 500);
    throw Object.assign(new Error(`Meta: ${message}`), { rejected: response.status < 500 && !data.error.is_transient });
  }
  if (!response.ok) throw new Error(`Meta returned HTTP ${response.status}.`);
  return data;
}

export async function listMetaChannels(env) {
  if (!env.META_PAGE_ACCESS_TOKEN) return [];
  const page = await metaRequest(env, 'me', { fields: 'id,name,instagram_business_account{id,username}' });
  if (!numericId(page.id)) throw metaError('Use the NC Digital Facebook Page access token.');
  if (env.META_PAGE_ID && env.META_PAGE_ID !== page.id) throw metaError('The Meta token belongs to a different Facebook Page.');
  const result = [{ id: `meta:facebook:${page.id}`, name: page.name, service: 'facebook', provider: 'meta', targetId: page.id, pageId: page.id }];
  const instagram = page.instagram_business_account;
  if (numericId(instagram?.id)) result.push({ id: `meta:instagram:${instagram.id}`, name: instagram.username, service: 'instagram', provider: 'meta', targetId: instagram.id, pageId: page.id });
  return result;
}

async function saveState(env, row, state) {
  await env.JOBS_DB.prepare('UPDATE social_deliveries SET provider_state = ? WHERE post_id = ? AND channel_id = ?')
    .bind(JSON.stringify(state), row.post_id, row.channel_id).run();
}
async function setResult(env, row, status, { remoteId = null, error = null, next = null } = {}) {
  await env.JOBS_DB.prepare('UPDATE social_deliveries SET status = ?, remote_id = ?, error = ?, next_attempt_at = ?, updated_at = ? WHERE post_id = ? AND channel_id = ?')
    .bind(status, remoteId, error, next, new Date().toISOString(), row.post_id, row.channel_id).run();
}

export async function sendMetaDelivery(env, row, { scheduled = false } = {}) {
  const input = JSON.parse(row.input);
  const now = new Date().toISOString();
  if (input.dueAt && Date.parse(input.dueAt) > Date.now() && !scheduled) {
    await env.JOBS_DB.prepare("UPDATE social_deliveries SET status = 'scheduled', next_attempt_at = ?, error = NULL, updated_at = ? WHERE post_id = ? AND channel_id = ? AND status IN ('pending', 'rejected')")
      .bind(input.dueAt, now, row.post_id, row.channel_id).run();
    return;
  }
  const allowed = scheduled ? "status IN ('scheduled', 'processing') AND next_attempt_at <= ?" : "status IN ('pending', 'rejected')";
  const args = [now, row.post_id, row.channel_id, ...(scheduled ? [now] : [])];
  const claim = await env.JOBS_DB.prepare(`UPDATE social_deliveries SET status = 'submitting', error = NULL, updated_at = ? WHERE post_id = ? AND channel_id = ? AND ${allowed}`).bind(...args).run();
  if (!claim.meta.changes) return;
  // Read state after claiming: a concurrent request may have completed a stage.
  const current = await env.JOBS_DB.prepare('SELECT provider_state FROM social_deliveries WHERE post_id = ? AND channel_id = ?').bind(row.post_id, row.channel_id).first();
  const state = current?.provider_state ? JSON.parse(current.provider_state) : {};
  let publishing = false;
  try {
    if (!scheduled && input.dueAt && Date.parse(input.dueAt) < Date.now()) throw metaError('The scheduled time has passed. Edit the unaccepted account and choose a new time.');
    const channels = await listMetaChannels(env);
    const channel = channels.find(item => item.id === row.channel_id && item.pageId === input.meta.pageId);
    if (!channel) throw metaError('This account is no longer connected to the configured Facebook Page.');
    if (row.service === 'facebook') {
      state.photos ||= [];
      for (let index = state.photos.length; index < input.assets.length; index++) {
        const photo = await metaRequest(env, `${channel.targetId}/photos`, { url: input.assets[index].image.url, published: false }, 'POST');
        if (!numericId(photo.id)) throw new Error('Meta did not return an uploaded photo ID.');
        state.photos.push(photo.id); await saveState(env, row, state);
      }
      publishing = true;
      const post = await metaRequest(env, `${channel.targetId}/feed`, { message: input.text, ...(state.photos.length ? { attached_media: state.photos.map(id => ({ media_fbid: id })) } : {}) }, 'POST');
      if (typeof post.id !== 'string' || !/^[\d_]+$/.test(post.id)) throw new Error('Meta did not confirm the published post ID.');
      await setResult(env, row, 'sent', { remoteId: post.id });
      return;
    }
    if (row.service !== 'instagram' || !input.assets.length) throw metaError('Instagram needs an image.');
    if (!state.containerId) {
      state.children ||= [];
      if (input.assets.length > 1) {
        for (let index = state.children.length; index < input.assets.length; index++) {
          const child = await metaRequest(env, `${channel.targetId}/media`, { image_url: input.assets[index].image.url, is_carousel_item: true }, 'POST');
          if (!numericId(child.id)) throw new Error('Meta did not return an image container ID.');
          state.children.push(child.id); await saveState(env, row, state);
        }
        for (const child of state.children) {
          const result = await metaRequest(env, child, { fields: 'status_code' });
          if (['ERROR', 'EXPIRED'].includes(result.status_code)) throw metaError('An Instagram image could not be prepared. Edit the unaccepted post to upload it again.');
          if (result.status_code !== 'FINISHED') return await waitForMedia(env, row, state);
        }
      }
      const container = await metaRequest(env, `${channel.targetId}/media`, {
        caption: input.text,
        ...(state.children.length ? { media_type: 'CAROUSEL', children: state.children } : { image_url: input.assets[0].image.url }),
      }, 'POST');
      if (!numericId(container.id)) throw new Error('Meta did not return a post container ID.');
      state.containerId = container.id; state.polls = 0; await saveState(env, row, state);
    }
    const status = await metaRequest(env, state.containerId, { fields: 'status_code' });
    if (status.status_code === 'PUBLISHED') { await setResult(env, row, 'sent'); return; }
    if (['ERROR', 'EXPIRED'].includes(status.status_code)) throw metaError('Instagram could not prepare this post. Edit the unaccepted post to try a new upload.');
    if (status.status_code !== 'FINISHED') return await waitForMedia(env, row, state);
    publishing = true;
    const published = await metaRequest(env, `${channel.targetId}/media_publish`, { creation_id: state.containerId }, 'POST');
    if (!numericId(published.id)) throw new Error('Instagram did not confirm the published post ID.');
    await setResult(env, row, 'sent', { remoteId: published.id });
  } catch (error) {
    const uncertain = publishing && !error.rejected;
    await setResult(env, row, uncertain ? 'unknown' : 'rejected', { error: uncertain
      ? 'Confirmation was interrupted. Check the Facebook or Instagram account before resending.'
      : error.message || 'Could not prepare the Meta post.' });
  }
}

async function waitForMedia(env, row, state) {
  state.polls = (state.polls || 0) + 1;
  if (state.polls > 5) throw metaError('Instagram is still preparing the images. Retry this account in a few minutes.');
  await saveState(env, row, state);
  await setResult(env, row, 'processing', { next: new Date(Date.now() + 60000).toISOString() });
}

export async function refreshMetaDelivery(env, row) {
  const state = row.provider_state ? JSON.parse(row.provider_state) : {};
  if (row.service === 'instagram' && state.containerId && ['unknown', 'submitting'].includes(row.status)) {
    const result = await metaRequest(env, state.containerId, { fields: 'status_code' });
    if (result.status_code === 'PUBLISHED') await setResult(env, row, 'sent', { remoteId: row.remote_id });
  }
}

export async function runMetaSchedule(env) {
  if (!env.JOBS_DB || !env.META_PAGE_ACCESS_TOKEN) return;
  const now = new Date().toISOString();
  const { results } = await env.JOBS_DB.prepare("SELECT * FROM social_deliveries WHERE provider = 'meta' AND status IN ('scheduled', 'processing') AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 2").bind(now).all();
  // Bound requests per invocation for Workers Free, including four-image carousels.
  // Each claim protects against overlapping cron runs; later jobs stay queued.
  for (let offset = 0; offset < results.length; offset += 2) {
    const outcomes = await Promise.allSettled(results.slice(offset, offset + 2).map(row => sendMetaDelivery(env, row, { scheduled: true })));
    if (outcomes.some(result => result.status === 'rejected')) console.error(JSON.stringify({ event: 'meta_schedule_incomplete' }));
  }
}
