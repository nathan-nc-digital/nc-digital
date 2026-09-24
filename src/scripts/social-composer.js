import { SOCIAL_PLATFORMS, postText, validatePost, MEDIA_KEY } from '../lib/social-posts.js';
import { showcasePath, validateShowcaseDraft } from '../lib/showcase-draft.js';

const $ = id => document.getElementById(id);
const KEY = 'nc-social-draft-v1';
const empty = () => ({ id: crypto.randomUUID(), caption: '', link: '', images: [], overrides: {}, channelIds: [], mode: 'now', dueAt: '' });
let draft = empty();
try {
  const saved = JSON.parse(localStorage.getItem(KEY));
  if (saved && typeof saved.caption === 'string') draft = { ...draft, ...saved, images: (saved.images || []).filter(key => MEDIA_KEY.test(key)) };
} catch { /* Browser storage may be unavailable. */ }
let channels = [], ready = false, busy = false, uploadsReady = false;
let submissionStarted = Boolean(draft.submitted);

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function notify(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
async function api(path, body) {
  const response = await fetch(`/admin/social/api/${path}`, {
    method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Could not load social publishing. Refresh the page and sign in again.'), { status: response.status });
  return data;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(draft)); $('draft-status').textContent = 'Draft saved on this browser'; }
  catch { $('draft-status').textContent = 'Browser draft storage is unavailable'; }
}
function collect() {
  draft.caption = $('caption').value; draft.link = $('link').value.trim();
  draft.mode = document.querySelector('input[name=timing]:checked').value;
  const date = new Date($('due-at').value);
  draft.dueAt = Number.isFinite(date.getTime()) ? date.toISOString() : '';
  if (submissionStarted) { draft.id = crypto.randomUUID(); draft.submitted = false; submissionStarted = false; }
  save();
}
function setBusy(value) {
  busy = value; $('compose-fields').disabled = value || submissionStarted;
  $('publish').disabled = value || !ready || !draft.channelIds.length;
  $('new-draft').disabled = value; $('images').disabled = value || !uploadsReady;
  document.querySelectorAll('#previews textarea, #image-list button').forEach(el => { el.disabled = value || submissionStarted; });
}
function hydrate() {
  $('caption').value = draft.caption; $('link').value = draft.link;
  document.querySelector(`input[name=timing][value=${draft.mode === 'schedule' ? 'schedule' : 'now'}]`).checked = true;
  if (draft.dueAt && Number.isFinite(Date.parse(draft.dueAt))) {
    const date = new Date(draft.dueAt);
    $('due-at').value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  } else $('due-at').value = '';
  $('schedule-field').hidden = draft.mode !== 'schedule';
  $('publish').textContent = draft.mode === 'schedule' ? 'Schedule selected accounts' : 'Publish to selected accounts';
  $('timezone').textContent = `Times use your browser’s timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;
  renderImages(); renderPreviews();
}
function renderImages() {
  $('image-list').replaceChildren(...draft.images.map((key, index) => {
    const item = node('div', undefined, 'image-item');
    const image = node('img'); image.src = `/social-media/${key}`; image.alt = `Launch image ${index + 1}`;
    const remove = node('button', `Remove ${index + 1}`); remove.type = 'button'; remove.disabled = busy;
    remove.onclick = () => { draft.images.splice(index, 1); collect(); renderImages(); renderPreviews(); };
    item.append(image, remove); return item;
  }));
}
function renderChannels() {
  const previous = new Set(draft.channelIds);
  $('channels').replaceChildren(...SOCIAL_PLATFORMS.map(platform => {
    const accounts = channels.filter(channel => channel.service === platform.service);
    const card = node('div', undefined, 'channel');
    const check = node('input'); check.type = 'checkbox'; check.setAttribute('aria-label', `Publish to ${platform.label}`);
    const detail = node('div'); detail.append(node('strong', platform.label));
    const select = node('select'); select.setAttribute('aria-label', `${platform.label} account`);
    for (const account of accounts) {
      const option = node('option', `${account.displayName || account.name} · ${account.provider === 'meta' ? 'Meta' : 'Buffer'}${account.isDisconnected ? ' · Reconnect needed' : account.isLocked ? ' · Locked' : account.isQueuePaused ? ' · Paused' : ''}`);
      option.value = account.id; option.disabled = account.isDisconnected || account.isLocked || account.isQueuePaused; select.append(option);
    }
    const selected = accounts.find(account => previous.has(account.id)) || accounts.find(account => !account.isDisconnected && !account.isLocked && !account.isQueuePaused);
    if (selected) select.value = selected.id;
    check.disabled = !selected || selected.isDisconnected || selected.isLocked || selected.isQueuePaused;
    check.checked = !check.disabled && previous.has(select.value);
    if (accounts.length) detail.append(select); else detail.append(node('small', ['facebook', 'instagram'].includes(platform.service) ? 'Connect your Facebook Page and linked Instagram account through Meta' : 'Connect this account in Buffer'));
    const update = () => {
      const account = accounts.find(item => item.id === select.value);
      check.disabled = !account || account.isDisconnected || account.isLocked || account.isQueuePaused;
      if (check.disabled) check.checked = false;
      draft.channelIds = draft.channelIds.filter(id => !accounts.some(item => item.id === id));
      if (check.checked) draft.channelIds.push(select.value);
      collect(); renderPreviews(); setBusy(busy);
    };
    check.onchange = update; select.onchange = update;
    card.append(check, detail); return card;
  }));
  draft.channelIds = draft.channelIds.filter(id => channels.some(channel => channel.id === id && !channel.isDisconnected && !channel.isLocked && !channel.isQueuePaused));
  save(); setBusy(busy); renderPreviews();
}
function renderPreviews() {
  const selected = channels.filter(channel => draft.channelIds.includes(channel.id));
  const platforms = selected.length ? SOCIAL_PLATFORMS.filter(platform => selected.some(channel => channel.service === platform.service)) : SOCIAL_PLATFORMS;
  $('previews').replaceChildren(...platforms.map(platform => {
    const card = node('article', undefined, 'preview');
    const head = node('div', undefined, 'preview-head');
    head.append(node('span', platform.service === 'googlebusiness' ? 'G' : platform.service === 'twitter' ? 'X' : platform.label.slice(0, 2), 'platform-icon'), node('strong', platform.label));
    const content = node('div', postText(draft, platform.service) || 'Your caption will appear here.', 'preview-text');
    const count = node('p', undefined, 'hint');
    const updateCount = () => {
      const length = [...postText(draft, platform.service)].length;
      count.textContent = platform.service === 'twitter' ? `${length} characters · X checks weighted length, including links and emoji, when submitted.` : `${length} / ${platform.limit} characters`;
      count.classList.toggle('warning', length > platform.limit);
    };
    updateCount(); card.append(head, content);
    const images = node('div', undefined, 'preview-images');
    for (const key of platform.service === 'googlebusiness' ? draft.images.slice(0, 1) : draft.images) {
      const image = node('img'); image.src = `/social-media/${key}`; image.alt = 'Post image preview'; images.append(image);
    }
    card.append(images);
    if (platform.service === 'googlebusiness' && draft.link) {
      const cta = node('a', 'Learn more ↗', 'button secondary'); cta.href = /^https?:\/\//i.test(draft.link) ? draft.link : '#'; cta.target = '_blank'; cta.rel = 'noopener noreferrer'; card.append(cta);
    }
    if (platform.service === 'instagram') card.append(node('p', 'Caption URLs are plain text. Use your profile link for a clickable destination.', 'hint'));
    const details = node('details'); details.append(node('summary', 'Adjust caption for this platform'));
    const label = node('label', `${platform.label} caption`, 'field');
    const textarea = node('textarea'); textarea.rows = 3; textarea.maxLength = 5000; textarea.placeholder = 'Leave blank to use the main caption'; textarea.value = draft.overrides[platform.service] || ''; textarea.disabled = busy;
    textarea.oninput = () => { draft.overrides[platform.service] = textarea.value; collect(); content.textContent = postText(draft, platform.service); updateCount(); };
    label.append(textarea); details.append(label); card.append(details, count); return card;
  }));
}
async function normalizeImage(file, preserveAspect = false) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('Choose JPG, PNG or WebP images under 20 MB each.');
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas'); canvas.width = 1200;
  canvas.height = preserveAspect ? Math.round(1200 * bitmap.height / bitmap.width) : 1200;
  const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
  const width = bitmap.width * scale, height = bitmap.height * scale;
  context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height); bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not prepare this image.')), 'image/jpeg', .92));
}
$('images').addEventListener('change', async event => {
  const files = [...event.target.files];
  if (files.length + draft.images.length > 4) { notify('Choose up to four images in total.', true); event.target.value = ''; return; }
  setBusy(true);
  try {
    for (const file of files) {
      notify(`Preparing ${file.name}…`);
      const blob = await normalizeImage(file);
      const response = await fetch('/admin/social/api/upload', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Image upload failed.');
      draft.images.push(data.key); collect(); renderImages(); renderPreviews();
    }
    notify('Images uploaded. Review your previews before publishing.');
  } catch (error) { notify(error.message, true); }
  finally { event.target.value = ''; setBusy(false); }
});
$('composer').addEventListener('input', event => {
  if (event.target.id === 'images' || event.target.closest('#channels')) return;
  collect(); $('schedule-field').hidden = draft.mode !== 'schedule';
  $('publish').textContent = draft.mode === 'schedule' ? 'Schedule selected accounts' : 'Publish to selected accounts'; renderPreviews();
});
$('new-draft').onclick = () => {
  if ((draft.caption || draft.images.length) && !confirm('Clear this draft and start a new post? Your publishing history will be kept.')) return;
  draft = empty(); submissionStarted = false; save(); hydrate(); renderChannels(); notify('New draft ready.');
};
const statusLabels = { pending: 'Ready to send', submitting: 'Awaiting confirmation', unknown: 'Check account', rejected: 'Not accepted', scheduled: 'Scheduled', processing: 'Preparing images', cancelled: 'Cancelled', sending: 'Publishing', sent: 'Published', error: 'Publishing failed', draft: 'Draft in Buffer', needs_approval: 'Approval required' };
async function loadHistory() {
  statusLabels.queued = 'Queued in NC Digital';
  const { posts } = await api('posts');
  $('history').replaceChildren(...(posts.length ? posts.map(post => {
    const item = node('article', undefined, 'history-item');
    const excerpt = post.caption.length > 220 ? `${post.caption.slice(0, 220).trimEnd()}…` : post.caption;
    item.append(node('p', new Date(post.createdAt).toLocaleString('en-GB'), 'muted'), node('h3', excerpt));
    if (post.dueAt) item.append(node('p', `Scheduled for ${new Date(post.dueAt).toLocaleString('en-GB')}`, 'muted'));
    const deliveries = node('div', undefined, 'deliveries');
    for (const delivery of post.deliveries) {
      const row = node('div', undefined, 'delivery');
      row.append(node('span', `${SOCIAL_PLATFORMS.find(platform => platform.service === delivery.service)?.label || delivery.service} · ${delivery.channel_name}`), node('span', statusLabels[delivery.status] || delivery.status, `badge ${delivery.status}`));
      if (delivery.status === 'queued') row.append(node('small', 'Queued in NC Digital. It will move to Buffer automatically when a slot is available.'));
      if (delivery.error) row.append(node('small', delivery.error));
      if (['unknown', 'submitting'].includes(delivery.status)) row.append(node('small', `Check ${delivery.provider === 'meta' ? 'Meta Business Suite' : 'Buffer'} before resending. This may already have been accepted.`));
      if (delivery.status === 'error') row.append(node('small', 'Open Buffer to see the platform’s error and retry the existing post.'));
      const platformLabel = SOCIAL_PLATFORMS.find(platform => platform.service === delivery.service)?.label || delivery.service;
      const caption = node('details', undefined, 'history-caption');
      caption.append(node('summary', `View full ${platformLabel} caption`), node('p', postText(post, delivery.service), 'preview-text'));
      if (delivery.service === 'googlebusiness' && /^https?:\/\//i.test(post.link || '')) {
        const link = node('a', `Learn more: ${post.link}`, 'history-caption-link');
        link.href = post.link; link.target = '_blank'; link.rel = 'noopener noreferrer'; caption.append(link);
      }
      row.append(caption);
      deliveries.append(row);
    }
    item.append(deliveries);
    const actions = node('div', undefined, 'history-actions');
    const action = (text, route) => {
      const button = node('button', text, 'button secondary'); button.type = 'button';
      button.onclick = async () => {
        button.disabled = true;
        try { await api(`posts/${post.id}/${route}`, {}); await loadHistory(); notify('Publishing results updated.'); }
        catch (error) { notify(error.message, true); button.disabled = false; }
      }; actions.append(button);
    };
    if (post.deliveries.some(delivery => (delivery.remote_id || delivery.provider === 'meta') && !['sent', 'cancelled'].includes(delivery.status))) action('Check publishing status', 'refresh');
    if (post.deliveries.some(delivery => delivery.provider === 'meta' && ['scheduled', 'processing'].includes(delivery.status))) action('Cancel queued Facebook / Instagram', 'cancel-meta');
    if (post.deliveries.some(delivery => delivery.provider === 'buffer' && delivery.status === 'queued')) action('Cancel posts waiting for Buffer', 'cancel-buffer-queue');
    if (post.dueAt && Date.parse(post.dueAt) > Date.now() + 60000 && post.deliveries.some(delivery => delivery.provider === 'buffer' && delivery.status === 'pending')) action('Queue for automatic Buffer scheduling', 'queue-buffer');
    if (post.deliveries.some(delivery => ['pending', 'rejected'].includes(delivery.status)) && (!post.dueAt || Date.parse(post.dueAt) > Date.now() + 60000)) action('Send unaccepted accounts', 'send');
    if (post.deliveries.some(delivery => ['pending', 'rejected'].includes(delivery.status))) {
      const edit = node('button', 'Edit unaccepted accounts', 'button secondary'); edit.type = 'button';
      edit.onclick = () => {
        if (busy) return;
        if ((draft.caption || draft.images.length) && !confirm('Replace your current draft with the unaccepted versions of this post?')) return;
        draft = { ...empty(), caption: post.caption, link: post.link, images: [...post.images], overrides: { ...post.overrides }, channelIds: post.deliveries.filter(delivery => ['pending', 'rejected'].includes(delivery.status)).map(delivery => delivery.channel_id) };
        submissionStarted = false; save(); hydrate(); renderChannels(); $('caption').focus();
        notify('Only unaccepted accounts have been selected. Edit the caption or schedule, then publish.');
      };
      actions.append(edit);
    }
    for (const provider of new Set(post.deliveries.map(delivery => delivery.provider || 'buffer'))) {
      const manage = node('a', provider === 'meta' ? 'Open Meta Business Suite ↗' : 'Open Buffer ↗', 'button secondary');
      manage.href = provider === 'meta' ? 'https://business.facebook.com/' : 'https://publish.buffer.com/'; manage.target = '_blank'; manage.rel = 'noopener noreferrer'; actions.append(manage);
    }
    item.append(actions); return item;
  }) : [node('p', 'No posts yet. Your first launch starts above.', 'muted')]));
}
$('refresh').onclick = async () => { try { await loadHistory(); } catch (error) { notify(error.message, true); } };
$('composer').onsubmit = async event => {
  event.preventDefault(); if (busy || !ready) return;
  try { validatePost(draft); } catch (error) { notify(error.message, true); return; }
  setBusy(true); submissionStarted = true; draft.submitted = true; save();
  try {
    notify('Saving your post and sending it to your selected accounts…');
    const { post } = await api('posts', draft);
    const result = await api(`posts/${post.id}/send`, {});
    const failures = result.post.deliveries.filter(delivery => ['rejected', 'unknown', 'submitting', 'error'].includes(delivery.status));
    notify(failures.length ? 'Some accounts need attention. See the results below before retrying.' : 'Your post has been submitted. See each account’s publishing status below.', Boolean(failures.length));
    draft = empty(); submissionStarted = false; save(); hydrate(); renderChannels(); await loadHistory();
  } catch (error) {
    if (error.status === 400) { submissionStarted = false; draft.submitted = false; save(); }
    else { try { await loadHistory(); } catch { /* Keep the draft and idempotency key. */ } }
    notify(`${error.message} Review history before retrying. Use New draft to create a separate post.`, true);
  }
  finally { setBusy(false); }
};
const showcaseSlug = new URLSearchParams(location.search).get('showcase');
const showcaseUploads = new Map();
async function importShowcase() {
  if (!showcaseSlug || busy) return;
  if (!uploadsReady) { notify('Image storage is unavailable. Your current draft is unchanged. Refresh to retry the showcase import.', true); return; }
  if ((draft.caption || draft.images.length || draft.link) && !confirm('Replace your current draft with the showcase captions and four branded images? Nothing will be published.')) return;
  setBusy(true);
  $('showcase-import').disabled = true;
  try {
    const base = showcasePath(showcaseSlug);
    const response = await fetch(`${base}social-draft.json`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Could not load the showcase. Your current draft is unchanged.');
    const incoming = validateShowcaseDraft(await response.json(), showcaseSlug);
    const keys = [];
    for (const [index, path] of incoming.images.entries()) {
      notify(`Preparing showcase image ${index + 1} of ${incoming.images.length}…`);
      let key = showcaseUploads.get(path);
      if (!key) {
        const imageResponse = await fetch(path, { signal: AbortSignal.timeout(30000) });
        if (!imageResponse.ok) throw new Error('A showcase image could not be loaded.');
        const blob = await normalizeImage(await imageResponse.blob(), true);
        const upload = await fetch('/admin/social/api/upload', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob, signal: AbortSignal.timeout(60000) });
        const data = await upload.json();
        if (!upload.ok || !MEDIA_KEY.test(data.key)) throw new Error(data.error || 'A showcase image could not be uploaded.');
        key = data.key; showcaseUploads.set(path, key);
      }
      keys.push(key);
    }
    draft = { ...empty(), caption: incoming.caption, link: incoming.link, overrides: incoming.overrides, images: keys };
    submissionStarted = false; save(); hydrate(); renderChannels();
    const url = new URL(location.href); url.searchParams.delete('showcase'); history.replaceState(null, '', url);
    $('showcase-import-panel').hidden = true;
    notify('Showcase imported: four branded images and captions for all five platforms. Choose your accounts, review the previews, then publish or schedule.');
  } catch (error) {
    notify(`${error.message} Your current draft is unchanged. Use Load showcase draft to retry.`, true);
  } finally { setBusy(false); $('showcase-import').disabled = false; }
}
$('showcase-import').onclick = () => void importShowcase();
$('showcase-import-panel').hidden = !showcaseSlug;
hydrate();
async function init() {
  try {
    const status = await api('status'); uploadsReady = status.uploadsReady;
    ready = status.connected && status.storageReady && uploadsReady;
    let warnings = [];
    if (status.connected) { const data = await api('channels'); channels = data.channels; warnings = data.warnings || []; }
    renderChannels(); if (status.storageReady) await loadHistory();
    notify(warnings.length ? warnings.join(' ') : ready && channels.length ? 'Connected. Choose the accounts you want to publish to.' : 'Setup needed: connect X, LinkedIn and Google Business Profile in Buffer, then Facebook and Instagram through Meta. You can prepare your caption here in the meantime.', Boolean(warnings.length));
  } catch (error) { ready = false; notify(error.message, true); renderChannels(); }
  setBusy(false);
  if (showcaseSlug && uploadsReady) await importShowcase();
}
void init();
