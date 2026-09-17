import { SOCIAL_PLATFORMS, MEDIA_KEY, MEDIA_PATH, validatePost, buildPostInput } from './social-posts.js';
import { readLimitedBody } from './social-http.js';
import { listMetaChannels, sendMetaDelivery, refreshMetaDelivery } from './social-meta.js';
export { readLimitedBody } from './social-http.js';

const API = 'https://api.buffer.com';
const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', 'Cloudflare-CDN-Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: HEADERS });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export async function bufferRequest(env, query, variables = {}) {
  if (!env.BUFFER_API_KEY) throw fail('Connect Buffer before publishing.', 503);
  const state = env.JOBS_DB && await env.JOBS_DB.prepare('SELECT retry_at FROM social_buffer_api_state WHERE id = 1').first();
  if (Date.parse(state?.retry_at) > Date.now()) throw bufferRateError(state.retry_at);
  const response = await fetch(API, {
    method: 'POST', headers: { Authorization: `Bearer ${env.BUFFER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15000),
  });
  if (response.status === 429) {
    const retry = response.headers.get('retry-after');
    const seconds = retry?.trim() ? Number(retry) : NaN;
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
    const retryTime = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retry);
    const retryAt = new Date(Math.max(Date.now() + 60000, Number.isFinite(retryTime) ? retryTime : reset > Date.now() ? reset : Date.now() + 3600000) + 5000).toISOString();
    if (env.JOBS_DB) await env.JOBS_DB.prepare('UPDATE social_buffer_api_state SET retry_at = MAX(retry_at, ?) WHERE id = 1').bind(retryAt).run();
    throw bufferRateError(retryAt);
  }
  if (!response.ok) throw fail(`Buffer returned HTTP ${response.status}. Check the connection in Buffer.`, 502);
  const data = JSON.parse(new TextDecoder().decode(await readLimitedBody(response, 2 * 1024 * 1024)));
  if (data.errors?.length || !data.data) throw fail('Buffer could not process the request. Check your API access and account connection.', 502);
  return data.data;
}

function bufferRateError(retryAt) {
  return Object.assign(fail(`Buffer's API allowance is temporarily exhausted. Automatic scheduling will retry after ${retryAt}.`, 429), { retryAt });
}

async function listBufferChannels(env) {
  if (!env.BUFFER_API_KEY) return [];
  let organizationId = env.BUFFER_ORGANIZATION_ID;
  if (!organizationId) {
    const data = await bufferRequest(env, 'query { account { organizations { id } } }');
    const organizations = data.account.organizations;
    if (organizations.length !== 1) throw fail('Choose the NC Digital Buffer organization in the server settings.', 503);
    organizationId = organizations[0].id;
  }
  const data = await bufferRequest(env, `query($input: ChannelsInput!) {
    channels(input: $input) { id name displayName service isDisconnected isLocked isQueuePaused }
  }`, { input: { organizationId } });
  return data.channels.filter(channel => SOCIAL_PLATFORMS.some(platform => platform.service === channel.service)).map(channel => ({ ...channel, provider: 'buffer' }));
}

async function discoverChannels(env) {
  const results = await Promise.allSettled([listBufferChannels(env), listMetaChannels(env)]);
  const channels = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const warnings = results.flatMap((result, index) => result.status === 'rejected' ? [`${index ? 'Meta' : 'Buffer'} connection: ${result.reason.message}`] : []);
  return { channels, warnings };
}

export async function listChannels(env) {
  return (await discoverChannels(env)).channels;
}

async function getPost(env, id) {
  const row = await env.JOBS_DB.prepare('SELECT * FROM social_posts WHERE id = ?').bind(id).first();
  if (!row) throw fail('Post not found.', 404);
  const { results } = await env.JOBS_DB.prepare('SELECT channel_id, service, channel_name, provider, status, remote_id, error, updated_at FROM social_deliveries WHERE post_id = ?').bind(id).all();
  return { id: row.id, ...JSON.parse(row.payload), createdAt: row.created_at, deliveries: results };
}

async function createPost(env, body, origin) {
  if (!/^[a-f0-9-]{36}$/.test(body?.id || '')) throw fail('Invalid post ID.');
  const existing = await env.JOBS_DB.prepare('SELECT payload FROM social_posts WHERE id = ?').bind(body.id).first();
  if (existing) return getPost(env, body.id);
  try { validatePost(body); } catch (error) { throw fail(error.message); }
  const channels = await listChannels(env);
  const selected = body.channelIds.map(id => {
    const channel = channels.find(item => item.id === id);
    if (!channel) throw fail('One of the selected accounts is no longer available. Refresh accounts.');
    return channel;
  });
  if (new Set(selected.map(channel => channel.service)).size !== selected.length) throw fail('Choose one account for each platform.');
  for (const key of body.images) {
    if (!env.SOCIAL_MEDIA || !await env.SOCIAL_MEDIA.head(key)) throw fail('An image is missing. Please upload it again.');
  }
  let inputs;
  try { inputs = selected.map(channel => {
    const input = buildPostInput(body, channel, origin);
    if (channel.provider === 'meta') input.meta = { pageId: channel.pageId };
    return input;
  }); } catch (error) { throw fail(error.message); }
  const payload = JSON.stringify({ caption: body.caption, link: body.link || '', images: body.images, overrides: body.overrides || {}, channelIds: body.channelIds, mode: body.mode, dueAt: body.mode === 'schedule' ? body.dueAt : null });
  const now = new Date().toISOString();
  try {
    await env.JOBS_DB.batch([
      env.JOBS_DB.prepare('INSERT INTO social_posts (id, payload, created_at) VALUES (?, ?, ?)').bind(body.id, payload, now),
      ...selected.map((channel, index) => env.JOBS_DB.prepare('INSERT INTO social_deliveries (post_id, channel_id, service, channel_name, input, updated_at, provider) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(body.id, channel.id, channel.service, channel.displayName || channel.name, JSON.stringify(inputs[index]), now, channel.provider)),
    ]);
  } catch (error) {
    // A concurrent retry may already have inserted the same idempotency key.
    if (!await env.JOBS_DB.prepare('SELECT id FROM social_posts WHERE id = ?').bind(body.id).first()) throw error;
  }
  return getPost(env, body.id);
}

export async function sendDelivery(env, row, { fromQueue = false } = {}) {
  if (row.provider === 'meta') return sendMetaDelivery(env, row);
  const input = JSON.parse(row.input);
  if (input.dueAt && Date.parse(input.dueAt) <= Date.now()) {
    await env.JOBS_DB.prepare(`UPDATE social_deliveries SET status = 'rejected', error = ? WHERE post_id = ? AND channel_id = ? AND status IN (${fromQueue ? "'queued'" : "'pending', 'rejected'"})`)
      .bind('The scheduled time has passed. Create a new post with a future time.', row.post_id, row.channel_id).run();
    return;
  }
  const claim = await env.JOBS_DB.prepare(`UPDATE social_deliveries SET status = 'submitting', error = NULL, updated_at = ? WHERE post_id = ? AND channel_id = ? AND status IN (${fromQueue ? "'queued'" : "'pending', 'rejected'"})`)
    .bind(new Date().toISOString(), row.post_id, row.channel_id).run();
  if (!claim.meta.changes) return;
  let remote;
  try {
    const data = await bufferRequest(env, `mutation($input: CreatePostInput!) {
      createPost(input: $input) { ... on PostActionSuccess { post { id status } } ... on MutationError { message } }
    }`, { input });
    remote = data.createPost;
  } catch (error) {
    // A definitive rate rejection did not create a post; it is safe to retry.
    if (error.status === 429 && error.retryAt) {
      await env.JOBS_DB.prepare("UPDATE social_deliveries SET status = ?, next_attempt_at = ?, error = ?, updated_at = ? WHERE post_id = ? AND channel_id = ? AND status = 'submitting'")
        .bind(fromQueue ? 'queued' : 'rejected', error.retryAt, error.message, new Date().toISOString(), row.post_id, row.channel_id).run();
      if (fromQueue) throw error;
      return;
    }
    // A timeout or network error can happen after Buffer accepts the post. Never blindly resend.
    await env.JOBS_DB.prepare("UPDATE social_deliveries SET status = 'unknown', error = ?, updated_at = ? WHERE post_id = ? AND channel_id = ?")
      .bind('Confirmation was interrupted. Check Buffer before creating another post to avoid duplicates.', new Date().toISOString(), row.post_id, row.channel_id).run();
    return;
  }
  const status = remote?.post?.id ? remote.post.status : remote?.message ? 'rejected' : 'unknown';
  await env.JOBS_DB.prepare('UPDATE social_deliveries SET status = ?, remote_id = ?, error = ?, updated_at = ? WHERE post_id = ? AND channel_id = ?')
    .bind(status || 'unknown', remote?.post?.id || null, remote?.message?.slice(0, 1000) || null, new Date().toISOString(), row.post_id, row.channel_id).run();
}

// Keep future posts locally until Buffer has space. Only an explicit queue action
// opts a delivery in; drafts, failed sends and ambiguous confirmations are excluded.
export async function runBufferQueue(env) {
  if (!env.JOBS_DB || !env.BUFFER_API_KEY) return;
  await runBufferEdits(env);
  const db = env.JOBS_DB, now = new Date().toISOString();
  const { results: rows } = await db.prepare("SELECT * FROM social_deliveries WHERE provider = 'buffer' AND status = 'queued' AND next_attempt_at <= ? ORDER BY json_extract(input, '$.dueAt'), post_id, channel_id LIMIT 100").bind(now).all();
  if (!rows.length) return;
  const owner = crypto.randomUUID();
  const lock = await db.prepare('UPDATE social_buffer_queue_lock SET owner = ?, expires_at = ? WHERE id = 1 AND expires_at < ?')
    .bind(owner, new Date(Date.now() + 300000).toISOString(), now).run();
  if (!lock.meta.changes) return;
  let releaseAt = '2000-01-01';
  try {
    const { account } = await bufferRequest(env, 'query { account { organizations { id limits { scheduledPosts } } } }');
    const org = env.BUFFER_ORGANIZATION_ID ? account.organizations.find(org => org.id === env.BUFFER_ORGANIZATION_ID) : account.organizations.length === 1 ? account.organizations[0] : null;
    if (!org || !Number.isInteger(org.limits?.scheduledPosts) || org.limits.scheduledPosts < 1) throw new Error('Queue capacity unavailable');
    // One shared snapshot replaces a separate account/channel/post query per delivery.
    const { channels, posts } = await bufferRequest(env, `query($channels: ChannelsInput!, $posts: PostsInput!) {
      channels(input: $channels) { id isDisconnected isLocked isQueuePaused }
      posts(first: 100, input: $posts) { edges { node { id channelId dueAt } } pageInfo { hasNextPage } }
    }`, { channels: { organizationId: org.id }, posts: { organizationId: org.id, filter: { status: ['scheduled'], channelIds: [...new Set(rows.map(row => row.channel_id))] } } });
    if (!Array.isArray(channels) || !Array.isArray(posts?.edges) || !posts.pageInfo) throw new Error('Queue count unavailable');
    const counts = new Map(), nextSlots = new Map();
    for (const { node } of posts.edges) {
      counts.set(node.channelId, (counts.get(node.channelId) || 0) + 1);
      const due = Date.parse(node.dueAt);
      if (Number.isFinite(due)) nextSlots.set(node.channelId, Math.min(nextSlots.get(node.channelId) ?? Infinity, due));
    }
    let submitted = 0;
    for (const row of rows) {
      const input = JSON.parse(row.input);
      if (!input.dueAt || !Number.isFinite(Date.parse(input.dueAt))) {
        await db.prepare("UPDATE social_deliveries SET status = 'rejected', error = 'Choose a future publishing time.' WHERE post_id = ? AND channel_id = ? AND status = 'queued'").bind(row.post_id, row.channel_id).run();
        continue;
      }
      if (Date.parse(input.dueAt) <= Date.now()) { await sendDelivery(env, row, { fromQueue: true }); continue; }
      const channel = channels.find(channel => channel.id === row.channel_id);
      if (!channel || channel.isDisconnected || channel.isLocked || channel.isQueuePaused) {
        await deferBufferRow(db, row, 'Reconnect or unpause this account in Buffer.'); continue;
      }
      if (posts.pageInfo.hasNextPage || (counts.get(row.channel_id) || 0) >= org.limits.scheduledPosts) {
        const nextSlot = nextSlots.get(row.channel_id);
        const retry = Math.max(Date.now() + 900000, Math.min(nextSlot ? nextSlot + 300000 : Date.now() + 7200000, Date.parse(input.dueAt) - 300000, Date.now() + 86400000));
        await deferBufferRow(db, row, null, new Date(retry).toISOString()); continue;
      }
      if (submitted >= 3) continue;
      await sendDelivery(env, row, { fromQueue: true });
      submitted++;
      // Reserve the slot even if a confirmation is ambiguous; never overfill it.
      counts.set(row.channel_id, (counts.get(row.channel_id) || 0) + 1);
      nextSlots.set(row.channel_id, Math.min(nextSlots.get(row.channel_id) ?? Infinity, Date.parse(input.dueAt)));
    }
  } catch (error) {
    releaseAt = error.retryAt || new Date(Date.now() + 7200000).toISOString();
    if (error.status === 429) {
      await db.prepare("UPDATE social_deliveries SET next_attempt_at = MAX(COALESCE(next_attempt_at, ''), ?), error = ?, updated_at = ? WHERE provider = 'buffer' AND status = 'queued'")
        .bind(releaseAt, error.message, new Date().toISOString()).run();
    } else for (const row of rows) await deferBufferRow(db, row, 'Queue check interrupted. It will retry automatically.', releaseAt);
    console.error(JSON.stringify({ event: 'social_buffer_queue_check_failed' }));
  } finally {
    await db.prepare('UPDATE social_buffer_queue_lock SET expires_at = ? WHERE id = 1 AND owner = ?').bind(releaseAt, owner).run();
  }
}
// Text edits retain the existing Buffer post and schedule. Read before every
// attempt so retries reconcile an accepted edit and never overwrite newer copy.
export async function runBufferEdits(env) {
  if (!env.JOBS_DB || !env.BUFFER_API_KEY) return;
  const db = env.JOBS_DB, now = new Date().toISOString();
  const cooldown = await db.prepare('SELECT retry_at FROM social_buffer_api_state WHERE id = 1').first();
  if (Date.parse(cooldown?.retry_at) > Date.now()) return;
  const { results } = await db.prepare("SELECT e.*, d.input FROM social_buffer_edits e JOIN social_deliveries d ON d.post_id = e.post_id AND d.channel_id = e.channel_id WHERE (e.status = 'pending' OR (e.status = 'applying' AND e.updated_at < ?)) AND e.retry_at <= ? ORDER BY e.due_at, e.post_id, e.channel_id LIMIT 3")
    .bind(new Date(Date.now() - 300000).toISOString(), now).all();
  for (const row of results) {
    const claim = await db.prepare("UPDATE social_buffer_edits SET status = 'applying', updated_at = ? WHERE post_id = ? AND channel_id = ? AND status = ? AND updated_at = ?")
      .bind(now, row.post_id, row.channel_id, row.status, row.updated_at).run();
    if (!claim.meta.changes) continue;
    try {
      if (Date.parse(row.due_at) <= Date.now() + 60000) throw fail('The publishing time has arrived; the existing post was left unchanged.');
      const { post } = await bufferRequest(env, 'query($input: PostInput!) { post(input: $input) { id text status channelId dueAt assets { id } } }', { input: { id: row.remote_id } });
      if (!post || post.id !== row.remote_id || post.channelId !== row.channel_id || post.status !== 'scheduled' || Date.parse(post.dueAt) !== Date.parse(row.due_at) || post.assets?.length) throw fail('The Buffer post or schedule changed. Review this edit in Buffer.');
      if (post.text !== row.replacement_text) {
        if (post.text !== row.expected_text) throw fail('The Buffer caption was edited elsewhere. Review before replacing it.');
        const savedInput = JSON.parse(row.input);
        const input = { id: row.remote_id, text: row.replacement_text };
        if (savedInput.metadata) input.metadata = savedInput.metadata;
        const data = await bufferRequest(env, `mutation($input: EditPostInput!) {
          editPost(input: $input) { ... on PostActionSuccess { post { id text status dueAt } } ... on MutationError { message } }
        }`, { input });
        const updated = data.editPost?.post;
        if (data.editPost?.message) throw fail(data.editPost.message.slice(0, 1000));
        if (!updated || updated.id !== row.remote_id || updated.text !== row.replacement_text || updated.status !== 'scheduled' || Date.parse(updated.dueAt) !== Date.parse(row.due_at)) throw new Error('Edit confirmation interrupted');
      }
      await db.batch([
        db.prepare("UPDATE social_buffer_edits SET status = 'complete', error = NULL, updated_at = ? WHERE post_id = ? AND channel_id = ?").bind(new Date().toISOString(), row.post_id, row.channel_id),
        db.prepare("UPDATE social_deliveries SET error = NULL, updated_at = ? WHERE post_id = ? AND channel_id = ? AND remote_id = ? AND status = 'scheduled'").bind(new Date().toISOString(), row.post_id, row.channel_id, row.remote_id),
      ]);
    } catch (error) {
      const retryAt = error.retryAt || new Date(Date.now() + 7200000).toISOString();
      const message = error.status === 400 ? error.message : 'Caption update is waiting for Buffer confirmation and will retry automatically.';
      await db.batch([
        db.prepare('UPDATE social_buffer_edits SET status = ?, error = ?, retry_at = ?, updated_at = ? WHERE post_id = ? AND channel_id = ?').bind(error.status === 400 ? 'failed' : 'pending', message, retryAt, new Date().toISOString(), row.post_id, row.channel_id),
        db.prepare('UPDATE social_deliveries SET error = ? WHERE post_id = ? AND channel_id = ?').bind(message, row.post_id, row.channel_id),
      ]);
      if (error.status === 429) break;
    }
  }
}
async function deferBufferRow(db, row, error, retryAt = new Date(Date.now() + 7200000).toISOString()) {
  await db.prepare("UPDATE social_deliveries SET next_attempt_at = ?, error = ?, updated_at = ? WHERE post_id = ? AND channel_id = ? AND status = 'queued'")
    .bind(retryAt, error, new Date().toISOString(), row.post_id, row.channel_id).run();
}

export async function serveSocialMedia(request, env) {
  const key = new URL(request.url).pathname.slice(MEDIA_PATH.length);
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
  if (!MEDIA_KEY.test(key) || !env.SOCIAL_MEDIA) return new Response('Not found', { status: 404 });
  const object = request.method === 'HEAD' ? await env.SOCIAL_MEDIA.head(key) : await env.SOCIAL_MEDIA.get(key);
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(request.method === 'HEAD' ? null : object.body, { headers: {
    'Content-Type': 'image/jpeg', 'Content-Length': String(object.size), 'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex',
  } });
}

export async function handleSocialApi(request, env) {
  try {
    const url = new URL(request.url);
    if (!['GET', 'POST'].includes(request.method)) throw fail('Method not allowed.', 405);
    if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) throw fail('Refresh the admin page and try again.', 403);
    const route = url.pathname.replace('/admin/social/api/', '').replace(/\/$/, '');
    if (route === 'status' && request.method === 'GET') {
      let storageReady = false;
      if (env.JOBS_DB) {
        const row = await env.JOBS_DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'social_deliveries'").first();
        storageReady = Boolean(row);
      }
      return json({ connected: Boolean(env.BUFFER_API_KEY || env.META_PAGE_ACCESS_TOKEN), bufferConnected: Boolean(env.BUFFER_API_KEY), metaConnected: Boolean(env.META_PAGE_ACCESS_TOKEN), storageReady, uploadsReady: Boolean(env.SOCIAL_MEDIA) });
    }
    if (!env.JOBS_DB) throw fail('Post storage has not been configured yet.', 503);
    if (route === 'channels' && request.method === 'GET') return json(await discoverChannels(env));
    if (route === 'upload' && request.method === 'POST') {
      if (!env.SOCIAL_MEDIA) throw fail('Image storage has not been connected yet.', 503);
      const bytes = await readLimitedBody(request, 4 * 1024 * 1024);
      if (request.headers.get('content-type') !== 'image/jpeg' || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw fail('Upload a JPEG image.');
      const key = `${crypto.randomUUID()}.jpg`;
      await env.SOCIAL_MEDIA.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
      return json({ key, url: `${MEDIA_PATH}${key}` }, 201);
    }
    if (route === 'posts' && request.method === 'GET') {
      const { results } = await env.JOBS_DB.prepare("SELECT id FROM social_posts ORDER BY COALESCE(json_extract(payload, '$.dueAt'), created_at) DESC, created_at DESC LIMIT 200").all();
      return json({ posts: await Promise.all(results.map(row => getPost(env, row.id))) });
    }
    if (route === 'posts' && request.method === 'POST') {
      let body;
      try { body = JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 50000))); } catch (error) { if (error.status) throw error; throw fail('Invalid post details.'); }
      return json({ post: await createPost(env, body, url.origin) }, 201);
    }
    const match = route.match(/^posts\/([a-f0-9-]{36})\/(send|refresh|cancel-meta|queue-buffer|cancel-buffer-queue)$/);
    if (match && request.method === 'POST') {
      const [, id, action] = match;
      const saved = await getPost(env, id);
      if (action === 'queue-buffer') {
        if (saved.mode !== 'schedule' || !saved.dueAt || Date.parse(saved.dueAt) < Date.now() + 60000) throw fail('Choose a publishing time at least one minute in the future.');
        await env.JOBS_DB.prepare("UPDATE social_deliveries SET status = 'queued', error = NULL, next_attempt_at = ?, updated_at = ? WHERE post_id = ? AND provider = 'buffer' AND status = 'pending' AND remote_id IS NULL")
          .bind(new Date().toISOString(), new Date().toISOString(), id).run();
      } else if (action === 'cancel-buffer-queue') {
        await env.JOBS_DB.prepare("UPDATE social_deliveries SET status = 'cancelled', next_attempt_at = NULL, updated_at = ? WHERE post_id = ? AND provider = 'buffer' AND status = 'queued'")
          .bind(new Date().toISOString(), id).run();
      } else if (action === 'send') {
        const { results } = await env.JOBS_DB.prepare("SELECT * FROM social_deliveries WHERE post_id = ? AND status IN ('pending', 'rejected')").bind(id).all();
        const outcomes = await Promise.allSettled(results.map(row => sendDelivery(env, row)));
        if (outcomes.some(result => result.status === 'rejected')) throw fail('Some confirmations could not be saved. Check the connected accounts before retrying.', 502);
      } else if (action === 'cancel-meta') {
        await env.JOBS_DB.prepare("UPDATE social_deliveries SET status = 'cancelled', next_attempt_at = NULL, updated_at = ? WHERE post_id = ? AND provider = 'meta' AND status IN ('scheduled', 'processing')")
          .bind(new Date().toISOString(), id).run();
      } else {
        const { results } = await env.JOBS_DB.prepare("SELECT * FROM social_deliveries WHERE post_id = ? AND status != 'sent' AND (provider = 'meta' OR remote_id IS NOT NULL)").bind(id).all();
        const outcomes = await Promise.allSettled(results.map(async row => {
          if (row.provider === 'meta') return refreshMetaDelivery(env, row);
          const { post } = await bufferRequest(env, 'query($input: PostInput!) { post(input: $input) { id status } }', { input: { id: row.remote_id } });
          await env.JOBS_DB.prepare('UPDATE social_deliveries SET status = ?, updated_at = ? WHERE post_id = ? AND channel_id = ?')
            .bind(post.status, new Date().toISOString(), id, row.channel_id).run();
        }));
        if (outcomes.some(result => result.status === 'rejected')) throw fail('Could not refresh every status. Existing confirmations have been kept; try again shortly.', 502);
      }
      return json({ post: await getPost(env, id) });
    }
    throw fail('Not found.', 404);
  } catch (error) {
    if (!error.status) console.error(JSON.stringify({ event: 'social_api_error', name: error.name }));
    return json({ error: error.status ? error.message : 'Social publishing is unavailable. Check the storage setup and try again.' }, error.status || 503);
  }
}
