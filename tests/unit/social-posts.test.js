import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { validatePost, buildPostInput, postText } from '../../src/lib/social-posts.js';
import { handleSocialApi, sendDelivery, readLimitedBody, runBufferQueue, runBufferEdits, bufferRequest } from '../../src/lib/social-api.js';
import worker from '../../src/worker.js';
import { runMetaSchedule } from '../../src/lib/social-meta.js';

const origin = 'https://nc-digital.co.uk';
const image = 'a6e7c3ab-8483-4f73-a5e6-2b1862239f21.jpg';
const draft = () => ({ id: crypto.randomUUID(), caption: 'Our latest launch', link: 'https://example.com', images: [image], channelIds: ['fb', 'ig'], mode: 'now', overrides: {} });
function environment(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0004_social_posts.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../migrations/0005_direct_meta_publishing.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../migrations/0012_social_buffer_queue.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../migrations/0013_social_buffer_rate_limit.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../../migrations/0014_social_buffer_edits.sql', import.meta.url), 'utf8'));
  t.after(() => sqlite.close());
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return { args: [], bind(...args) { this.args = args; return this; }, async first() { return statement.get(...this.args) || null; }, async all() { return { results: statement.all(...this.args) }; }, async run() { return { meta: statement.run(...this.args) }; } };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { JOBS_DB: db, BUFFER_API_KEY: 'test-only', BUFFER_ORGANIZATION_ID: 'org', SOCIAL_MEDIA: { async head(key) { return key === image ? { size: 10 } : null; } } };
}
const accounts = [ { id: 'fb', name: 'NC Digital', service: 'facebook' }, { id: 'ig', name: 'ncdigitaluk', service: 'instagram' } ];
function provider(t, onCreate = () => ({ post: { id: crypto.randomUUID(), status: 'scheduled' } })) {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    if (query.includes('channels(input:')) return Response.json({ data: { channels: accounts } });
    if (query.includes('createPost(input:')) { calls++; return Response.json({ data: { createPost: await onCreate(variables.input) } }); }
    return Response.json({ data: { post: { id: 'remote', status: 'sent' } } });
  });
  return () => calls;
}
const request = (path, body, headers = {}) => new Request(`${origin}/admin/social/api/${path}`, {
  method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
});

function queuedProvider(t, { full = false, occupied = full ? 10 : 0, interrupted = false, paused = false, rateLimited = false, rateOnCreate = false, dueAt = new Date(Date.now() + 21600000).toISOString() } = {}) {
  const calls = [];
  calls.reads = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { query, variables } = JSON.parse(options.body);
    if ((rateLimited && query.includes('organizations')) || (rateOnCreate && query.includes('createPost(input:'))) {
      calls.reads++; return new Response('', { status: 429, headers: { 'Retry-After': '34564' } });
    }
    if (query.includes('posts(first:')) {
      calls.reads++;
      return Response.json({ data: { channels: accounts.map(a => ({ ...a, isQueuePaused: paused })), posts: { edges: accounts.flatMap(a => Array.from({ length: occupied }, (_, i) => ({ node: { id: a.id + i, channelId: a.id, dueAt } }))), pageInfo: { hasNextPage: false } } } });
    }
    if (query.includes('organizations')) { calls.reads++; return Response.json({ data: { account: { organizations: [{ id: 'org', limits: { scheduledPosts: 10 } }] } } }); }
    if (query.includes('channels(input:')) return Response.json({ data: { channels: accounts.map(a => ({ ...a, isQueuePaused: paused })) } });
    if (query.includes('createPost(input:')) { calls.push(variables.input); if (interrupted) throw new Error('Disconnected after request'); return Response.json({ data: { createPost: { post: { id: crypto.randomUUID(), status: 'scheduled' } } } }); }
    throw new Error('Unexpected provider query');
  });
  return calls;
}

test('Buffer holding queue requires a future schedule and never sends on enqueue', async t => {
  const env = environment(t); const calls = queuedProvider(t);
  const post = { ...draft(), mode: 'schedule', dueAt: '2099-08-01T12:00:00Z' };
  await handleSocialApi(request('posts', post), env);
  const queued = await handleSocialApi(request(`posts/${post.id}/queue-buffer`, {}), env);
  assert.deepEqual((await queued.json()).post.deliveries.map(d => d.status), ['queued', 'queued']);
  await handleSocialApi(request(`posts/${post.id}/queue-buffer`, {}), env);
  assert.equal(calls.length, 0);
  const immediate = draft(); await handleSocialApi(request('posts', immediate), env);
  assert.equal((await handleSocialApi(request(`posts/${immediate.id}/queue-buffer`, {}), env)).status, 400);
});

test('full Buffer queues wait; free slots preserve exact captions and scheduled times', async t => {
  const env = environment(t); const calls = queuedProvider(t, { full: true });
  const post = { ...draft(), mode: 'schedule', dueAt: '2099-08-01T12:00:00Z' };
  await handleSocialApi(request('posts', post), env); await handleSocialApi(request(`posts/${post.id}/queue-buffer`, {}), env);
  await runBufferQueue(env);
  assert.equal(calls.length, 0);
  const waiting = (await env.JOBS_DB.prepare('SELECT * FROM social_deliveries').all()).results;
  assert.ok(waiting.every(d => d.status === 'queued' && Date.parse(d.next_attempt_at) > Date.now()));
  t.mock.restoreAll(); const accepted = queuedProvider(t);
  await env.JOBS_DB.prepare("UPDATE social_deliveries SET next_attempt_at = '2000-01-01'").run();
  await Promise.all([runBufferQueue(env), runBufferQueue(env)]);
  assert.equal(accepted.length, 2);
  assert.ok(accepted.every(p => p.dueAt === '2099-08-01T12:00:00.000Z' && p.text === postText(post, 'facebook')));
  assert.ok((await env.JOBS_DB.prepare('SELECT * FROM social_deliveries').all()).results.every(d => d.status === 'scheduled' && d.remote_id));
  await runBufferQueue(env); assert.equal(accepted.length, 2);
});

test('cancelled and expired holding posts are never published', async t => {
  const env = environment(t); const calls = queuedProvider(t);
  const post = { ...draft(), mode: 'schedule', dueAt: '2099-08-01T12:00:00Z' };
  await handleSocialApi(request('posts', post), env); await handleSocialApi(request(`posts/${post.id}/queue-buffer`, {}), env);
  await handleSocialApi(request(`posts/${post.id}/cancel-buffer-queue`, {}), env); await runBufferQueue(env);
  assert.equal(calls.length, 0);
  assert.ok((await env.JOBS_DB.prepare('SELECT * FROM social_deliveries').all()).results.every(d => d.status === 'cancelled'));
  const other = { ...post, id: crypto.randomUUID() }; await handleSocialApi(request('posts', other), env); await handleSocialApi(request(`posts/${other.id}/queue-buffer`, {}), env);
  await env.JOBS_DB.prepare("UPDATE social_deliveries SET input = json_set(input, '$.dueAt', '2020-01-01T00:00:00Z') WHERE post_id = ?").bind(other.id).run();
  await runBufferQueue(env); assert.equal(calls.length, 0);
  assert.ok((await env.JOBS_DB.prepare('SELECT * FROM social_deliveries WHERE post_id = ?').bind(other.id).all()).results.every(d => d.status === 'rejected'));
});

test('ambiguous Buffer submission is never automatically retried', async t => {
  const env = environment(t); const calls = queuedProvider(t, { interrupted: true });
  const post = { ...draft(), mode: 'schedule', dueAt: '2099-08-01T12:00:00Z' };
  await handleSocialApi(request('posts', post), env); await handleSocialApi(request(`posts/${post.id}/queue-buffer`, {}), env);
  await runBufferQueue(env); await runBufferQueue(env);
  await handleSocialApi(request(`posts/${post.id}/queue-buffer`, {}), env); await runBufferQueue(env);
  assert.equal(calls.length, 2);
  assert.ok((await env.JOBS_DB.prepare('SELECT * FROM social_deliveries').all()).results.every(d => d.status === 'unknown'));
});

test('full queues use two shared reads and wait until a scheduled post frees space', async t => {
  const env = environment(t), dueAt = new Date(Date.now() + 21600000).toISOString();
  const calls = queuedProvider(t, { full: true, dueAt });
  for (let i = 0; i < 7; i++) {
    const post = { ...draft(), mode: 'schedule', dueAt: '2099-08-01T12:00:00Z' };
    await handleSocialApi(request('posts', post), env); await handleSocialApi(request(`posts/${post.id}/queue-buffer`, {}), env);
  }
  await runBufferQueue(env);
  assert.equal(calls.reads, 2); assert.equal(calls.length, 0);
  const rows = (await env.JOBS_DB.prepare('SELECT * FROM social_deliveries').all()).results;
  assert.equal(rows.length, 14);
  assert.ok(rows.every(row => Date.parse(row.next_attempt_at) === Date.parse(dueAt) + 300000));
  for (let i = 0; i < 20; i++) await runBufferQueue(env);
  assert.equal(calls.reads, 2);
});

test('a shared snapshot reserves newly used slots and cannot overfill a channel', async t => {
  const env = environment(t), calls = queuedProvider(t, { occupied: 9 });
  for (let i = 0; i < 3; i++) {
    const post = { ...draft(), mode: 'schedule', dueAt: '2099-08-01T12:00:00Z' };
    await handleSocialApi(request('posts', post), env); await handleSocialApi(request(`posts/${post.id}/queue-buffer`, {}), env);
  }
  await runBufferQueue(env);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(input => input.channelId).sort(), ['fb', 'ig']);
  const rows = (await env.JOBS_DB.prepare('SELECT * FROM social_deliveries').all()).results;
  assert.equal(rows.filter(row => row.status === 'queued').length, 4);
});

for (const rateOnCreate of [false, true]) test(`Buffer 429 ${rateOnCreate ? 'during submission' : 'during discovery'} persists cooldown and keeps the queue retryable`, async t => {
  const env = environment(t);
  const calls = queuedProvider(t, { rateLimited: !rateOnCreate, rateOnCreate });
  const post = { ...draft(), mode: 'schedule', dueAt: '2099-08-01T12:00:00Z' };
  await handleSocialApi(request('posts', post), env); await handleSocialApi(request(`posts/${post.id}/queue-buffer`, {}), env);
  await runBufferQueue(env);
  const state = await env.JOBS_DB.prepare('SELECT retry_at FROM social_buffer_api_state WHERE id = 1').first();
  assert.ok(Date.parse(state.retry_at) > Date.now() + 34560000);
  const rows = (await env.JOBS_DB.prepare('SELECT * FROM social_deliveries').all()).results;
  assert.ok(rows.every(row => row.status === 'queued' && row.remote_id === null && row.next_attempt_at === state.retry_at));
  const before = calls.reads;
  // Even a newly due entry or manual discovery cannot bypass the shared cooldown.
  await env.JOBS_DB.prepare("UPDATE social_deliveries SET next_attempt_at = '2000-01-01'").run();
  await runBufferQueue(env);
  await assert.rejects(() => bufferRequest(env, 'query { account { id } }'), error => error.status === 429 && error.retryAt === state.retry_at);
  assert.equal(calls.reads, before); assert.equal(calls.length, 0);
});

for (const scenario of ['success', 'interrupted', 'changed', 'expired', 'cooldown']) test(`deferred Buffer caption edit: ${scenario}`, async t => {
  const env = environment(t); provider(t);
  const post = { ...draft(), channelIds: ['fb'], images: [], mode: 'schedule', dueAt: '2099-08-01T12:00:00Z' };
  await handleSocialApi(request('posts', post), env); await handleSocialApi(request(`posts/${post.id}/send`, {}), env);
  const row = await env.JOBS_DB.prepare('SELECT * FROM social_deliveries').first();
  const original = JSON.parse(row.input), replacement = 'SEO for roofers: verified website figures.';
  await env.JOBS_DB.prepare("INSERT INTO social_buffer_edits (post_id,channel_id,remote_id,expected_text,replacement_text,due_at,retry_at,updated_at) VALUES (?,?,?,?,?,?,'2000-01-01','2000-01-01')")
    .bind(post.id, row.channel_id, row.remote_id, original.text, replacement, scenario === 'expired' ? '2020-01-01' : original.dueAt).run();
  if (scenario === 'cooldown') await env.JOBS_DB.prepare("UPDATE social_buffer_api_state SET retry_at = '2099-01-01'").run();
  t.mock.restoreAll(); let reads = 0, edits = 0, remoteText = scenario === 'changed' ? 'A newer caption from the user' : original.text;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const {query,variables} = JSON.parse(options.body);
    const remote = () => ({id:row.remote_id,channelId:row.channel_id,text:remoteText,status:'scheduled',dueAt:original.dueAt,assets:[]});
    if (query.includes('editPost(')) {
      edits++; assert.deepEqual(variables.input,{id:row.remote_id,text:replacement}); remoteText = replacement;
      if (scenario === 'interrupted') throw new Error('Connection lost after accepted edit');
      return Response.json({data:{editPost:{post:remote()}}});
    }
    reads++; return Response.json({data:{post:remote()}});
  });
  await Promise.all([runBufferEdits(env),runBufferEdits(env)]);
  if (scenario === 'interrupted') {
    await env.JOBS_DB.prepare("UPDATE social_buffer_edits SET retry_at = '2000-01-01'").run();
    await runBufferEdits(env);
  }
  const result = await env.JOBS_DB.prepare('SELECT * FROM social_buffer_edits').first();
  assert.equal(result.status, ['success','interrupted'].includes(scenario) ? 'complete' : scenario === 'cooldown' ? 'pending' : 'failed');
  assert.equal(edits, ['success','interrupted'].includes(scenario) ? 1 : 0);
  if (['expired','cooldown'].includes(scenario)) assert.equal(reads,0);
  const delivery = await env.JOBS_DB.prepare('SELECT * FROM social_deliveries').first();
  assert.equal(delivery.remote_id,row.remote_id); assert.equal(delivery.status,'scheduled');
});

test('GBP uses one image, caption and a separate learn-more destination', () => {
  const post = { ...draft(), images: [image, image], overrides: { googlebusiness: 'Visit the new site' } };
  const result = buildPostInput(post, { id: 'gbp', service: 'googlebusiness' }, origin);
  assert.equal(result.assets.length, 1); assert.equal(result.text, 'Visit the new site');
  assert.deepEqual(result.metadata.google.detailsWhatsNew, { button: 'learn_more', link: post.link });
});
test('Instagram requires an image and declares required feed metadata', () => {
  const account = { id: 'ig', service: 'instagram' };
  assert.throws(() => buildPostInput({ ...draft(), images: [] }, account, origin), /image/);
  assert.equal(buildPostInput(draft(), account, origin).metadata.instagram.shouldShareToFeed, true);
});
test('platform override preserves the destination URL and original caption', () => {
  const post = { ...draft(), overrides: { twitter: 'A shorter launch' } };
  assert.equal(postText(post, 'twitter'), 'A shorter launch\n\nhttps://example.com');
  assert.equal(postText(post, 'linkedin'), 'Our latest launch\n\nhttps://example.com');
});
test('invalid links, image paths, duplicate accounts and stale schedules are rejected', () => {
  for (const change of [{ link: 'javascript:alert(1)' }, { images: ['../../secret'] }, { channelIds: ['fb', 'fb'] }, { mode: 'schedule', dueAt: '2020-01-01' }, { overrides: { twitter: [] } }]) assert.throws(() => validatePost({ ...draft(), ...change }));
});
test('scheduled posts have exact UTC due time and disconnected accounts are rejected', () => {
  const post = { ...draft(), mode: 'schedule', dueAt: '2099-08-01T12:00:00+01:00' };
  validatePost(post);
  const input = buildPostInput(post, accounts[0], origin);
  assert.equal(input.dueAt, '2099-08-01T11:00:00.000Z'); assert.equal(input.mode, 'customScheduled');
  assert.throws(() => buildPostInput(post, { ...accounts[0], isDisconnected: true }, origin), /reconnect/);
});
test('cross-origin publishing is rejected before any database or provider call', async () => {
  const response = await handleSocialApi(request('posts', draft(), { Origin: 'https://untrusted.example' }), {});
  assert.equal(response.status, 403);
});
test('unauthenticated social API calls are blocked by the Worker', async () => {
  const response = await worker.fetch(new Request(`${origin}/admin/social/api/status`), {});
  assert.equal(response.status, 401); assert.match(response.headers.get('cache-control'), /no-store/);
});
test('streamed upload size limit works without a Content-Length header', async () => {
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8)); controller.close(); } }));
  await assert.rejects(() => readLimitedBody(response, 4), /too large/);
});
test('new submissions persist atomically but do not publish until send', async t => {
  const env = environment(t); const calls = provider(t); const post = draft();
  const result = await handleSocialApi(request('posts', post), env);
  assert.equal(result.status, 201); assert.equal(calls(), 0);
  assert.equal((await result.json()).post.deliveries.length, 2);
  const repeat = await handleSocialApi(request('posts', post), env);
  assert.equal((await repeat.json()).post.id, post.id);
  assert.equal((await env.JOBS_DB.prepare('SELECT * FROM social_posts').all()).results.length, 1);
});
test('unknown channels and missing uploads cannot be submitted', async t => {
  const env = environment(t); provider(t);
  for (const change of [{ channelIds: ['not-mine'] }, { images: ['b6e7c3ab-8483-4f73-a5e6-2b1862239f21.jpg'] }]) {
    const response = await handleSocialApi(request('posts', { ...draft(), ...change }), env);
    assert.equal(response.status, 400);
  }
  assert.equal((await env.JOBS_DB.prepare('SELECT * FROM social_posts').all()).results.length, 0);
});
test('parallel sends claim each account once and never label scheduled as published', async t => {
  const env = environment(t); const calls = provider(t); const post = draft();
  await handleSocialApi(request('posts', post), env);
  const responses = await Promise.all([handleSocialApi(request(`posts/${post.id}/send`, {}), env), handleSocialApi(request(`posts/${post.id}/send`, {}), env)]);
  assert.equal(calls(), 2);
  assert.deepEqual((await responses[0].json()).post.deliveries.map(row => row.status), ['scheduled', 'scheduled']);
  await handleSocialApi(request(`posts/${post.id}/send`, {}), env); assert.equal(calls(), 2);
});
test('a partial rejection retries only the unaccepted account', async t => {
  const env = environment(t); let reject = true;
  const calls = provider(t, input => input.channelId === 'ig' && reject ? { message: 'Reconnect Instagram' } : { post: { id: input.channelId, status: 'sent' } });
  const post = draft(); await handleSocialApi(request('posts', post), env);
  await handleSocialApi(request(`posts/${post.id}/send`, {}), env);
  reject = false; await handleSocialApi(request(`posts/${post.id}/send`, {}), env);
  assert.equal(calls(), 3);
  const rows = (await env.JOBS_DB.prepare('SELECT * FROM social_deliveries').all()).results;
  assert.ok(rows.every(row => row.status === 'sent'));
});
test('interrupted provider confirmation becomes unknown and cannot be blindly retried', async t => {
  const env = environment(t); const calls = provider(t, () => { throw new Error('transport lost'); });
  const post = draft(); await handleSocialApi(request('posts', post), env);
  await handleSocialApi(request(`posts/${post.id}/send`, {}), env);
  await handleSocialApi(request(`posts/${post.id}/send`, {}), env);
  assert.equal(calls(), 2);
  assert.ok((await env.JOBS_DB.prepare('SELECT * FROM social_deliveries').all()).results.every(row => row.status === 'unknown'));
});
test('expired scheduled destinations are rejected without calling Buffer', async t => {
  const env = environment(t); const calls = provider(t); const post = draft();
  await handleSocialApi(request('posts', post), env);
  const row = await env.JOBS_DB.prepare('SELECT * FROM social_deliveries LIMIT 1').first();
  row.input = JSON.stringify({ ...JSON.parse(row.input), dueAt: '2020-01-01T00:00:00Z' });
  await sendDelivery(env, row); assert.equal(calls(), 0);
  assert.equal((await env.JOBS_DB.prepare('SELECT status FROM social_deliveries WHERE channel_id = ?').bind(row.channel_id).first()).status, 'rejected');
});
test('refresh confirms remote publication without creating another post', async t => {
  const env = environment(t); const calls = provider(t); const post = draft();
  await handleSocialApi(request('posts', post), env); await handleSocialApi(request(`posts/${post.id}/send`, {}), env);
  const response = await handleSocialApi(request(`posts/${post.id}/refresh`, {}), env);
  assert.ok((await response.json()).post.deliveries.every(row => row.status === 'sent')); assert.equal(calls(), 2);
});

function metaProvider(t, options = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const resource = new URL(url).pathname.replace(/^\/v\d+\.\d+\//, '');
    const params = init.method === 'POST' ? Object.fromEntries(init.body) : {};
    calls.push({ resource, method: init.method, params });
    if (resource === 'me') return Response.json({ id: '123', name: 'NC Digital', instagram_business_account: { id: '456', username: 'ncdigital' } });
    if (resource === '123/photos') { assert.equal(params.published, 'false'); return Response.json({ id: '789' }); }
    if (resource === '123/feed') {
      if (options.failPublish) throw new Error('Connection interrupted');
      return Response.json({ id: '123_999' });
    }
    if (resource === '456/media') return Response.json({ id: String(1000 + calls.length) });
    if (resource === '456/media_publish') return Response.json({ id: '2000' });
    if (/^\d+$/.test(resource)) return Response.json({ status_code: options.processing ? 'IN_PROGRESS' : 'FINISHED' });
    throw new Error(`Unexpected request ${resource}`);
  });
  return calls;
}
function metaEnvironment(t) {
  const env = environment(t); delete env.BUFFER_API_KEY; env.META_PAGE_ACCESS_TOKEN = 'test-meta-token'; return env;
}
const metaDraft = () => ({ ...draft(), channelIds: ['meta:facebook:123', 'meta:instagram:456'] });

test('direct Meta publishes Facebook and Instagram once without a Buffer connection', async t => {
  const env = metaEnvironment(t), calls = metaProvider(t), post = metaDraft();
  assert.equal((await handleSocialApi(request('posts', post), env)).status, 201);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  const responses = await Promise.all([handleSocialApi(request(`posts/${post.id}/send`, {}), env), handleSocialApi(request(`posts/${post.id}/send`, {}), env)]);
  assert.equal(calls.filter(call => ['123/feed', '456/media_publish'].includes(call.resource)).length, 2);
  const history = await handleSocialApi(request('posts'), env);
  assert.ok((await history.json()).posts[0].deliveries.every(row => row.status === 'sent' && row.provider === 'meta'));
  assert.ok(responses.every(response => response.ok));
  const facebook = calls.find(call => call.resource === '123/feed');
  assert.match(facebook.params.message, /https:\/\/example.com/);
  assert.deepEqual(JSON.parse(facebook.params.attached_media), [{ media_fbid: '789' }]);
});

test('Meta schedules stay idle until submitted and due; overlapping cron runs publish once', async t => {
  const env = metaEnvironment(t), calls = metaProvider(t), post = { ...metaDraft(), mode: 'schedule', dueAt: '2099-08-01T12:00:00Z' };
  await handleSocialApi(request('posts', post), env);
  await runMetaSchedule(env); assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  await handleSocialApi(request(`posts/${post.id}/send`, {}), env);
  await runMetaSchedule(env); assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  await env.JOBS_DB.prepare("UPDATE social_deliveries SET next_attempt_at = '2020-01-01T00:00:00.000Z'").run();
  await Promise.all([runMetaSchedule(env), runMetaSchedule(env)]);
  assert.equal(calls.filter(call => ['123/feed', '456/media_publish'].includes(call.resource)).length, 2);
});

test('Instagram image processing resumes on the next cron without recreating containers', async t => {
  const env = metaEnvironment(t), options = { processing: true }, calls = metaProvider(t, options);
  const post = { ...metaDraft(), channelIds: ['meta:instagram:456'], images: [image, image] };
  await handleSocialApi(request('posts', post), env);
  const response = await handleSocialApi(request(`posts/${post.id}/send`, {}), env);
  assert.equal((await response.json()).post.deliveries[0].status, 'processing');
  assert.equal(calls.filter(call => call.resource === '456/media').length, 2);
  options.processing = false;
  await env.JOBS_DB.prepare("UPDATE social_deliveries SET next_attempt_at = '2020-01-01T00:00:00.000Z'").run();
  await runMetaSchedule(env);
  assert.equal(calls.filter(call => call.resource === '456/media').length, 3);
  const carousel = calls.filter(call => call.resource === '456/media').at(-1);
  assert.equal(carousel.params.media_type, 'CAROUSEL'); assert.equal(JSON.parse(carousel.params.children).length, 2);
  assert.equal(calls.filter(call => call.resource === '456/media_publish').length, 1);
});

test('uncertain Facebook publication cannot be retried automatically', async t => {
  const env = metaEnvironment(t), calls = metaProvider(t, { failPublish: true }), post = { ...metaDraft(), channelIds: ['meta:facebook:123'] };
  await handleSocialApi(request('posts', post), env);
  const response = await handleSocialApi(request(`posts/${post.id}/send`, {}), env);
  assert.equal((await response.json()).post.deliveries[0].status, 'unknown');
  await handleSocialApi(request(`posts/${post.id}/send`, {}), env); await runMetaSchedule(env);
  assert.equal(calls.filter(call => call.resource === '123/feed').length, 1);
});

test('cancelled Meta schedules never publish', async t => {
  const env = metaEnvironment(t), calls = metaProvider(t), post = { ...metaDraft(), mode: 'schedule', dueAt: '2099-08-01T12:00:00Z' };
  await handleSocialApi(request('posts', post), env); await handleSocialApi(request(`posts/${post.id}/send`, {}), env);
  const response = await handleSocialApi(request(`posts/${post.id}/cancel-meta`, {}), env);
  assert.ok((await response.json()).post.deliveries.every(row => row.status === 'cancelled'));
  await env.JOBS_DB.prepare("UPDATE social_deliveries SET next_attempt_at = '2020-01-01T00:00:00.000Z'").run();
  await runMetaSchedule(env); await handleSocialApi(request(`posts/${post.id}/send`, {}), env);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
});

test('a failed Buffer connection still allows discovering and publishing through Meta', async t => {
  const env = metaEnvironment(t); env.BUFFER_API_KEY = 'broken'; metaProvider(t);
  const response = await handleSocialApi(request('channels'), env);
  const result = await response.json(); assert.equal(result.channels.length, 2); assert.equal(result.warnings.length, 1);
  const post = metaDraft(); assert.equal((await handleSocialApi(request('posts', post), env)).status, 201);
});
