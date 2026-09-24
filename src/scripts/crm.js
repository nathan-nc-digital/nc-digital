import { londonInput, londonInstant } from '../lib/crm-dates.js';
const $ = id => document.getElementById(id);
const labels = { new: 'New', open: 'In progress', waiting: 'Waiting', closed: 'Closed', spam: 'Spam' };
const state = { page: 0, total: 0, active: null, setup: null, mode: 'outbound', busy: false, drafts: new Map(), draftVersions:new Map(), draftTimers:new Map(), draftWrites:new Map(), listRequest: 0, detailRequest: 0 };
const time = value => new Date(value).toLocaleString('en-GB', { timeZone:'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function node(tag, content, cls) { const el = document.createElement(tag); if (content !== undefined) el.textContent = content; if (cls) el.className = cls; return el; }
function notice(message, error = false) { $('notice').hidden = !message; $('notice').textContent = message; $('notice').className = error ? 'error' : ''; }
async function api(route, body) {
  let response;
  try {response = await fetch('/admin/crm/api/' + route, { method: body ? 'POST' : 'GET', headers: {'X-Requested-With':'XMLHttpRequest',...(body ? { 'Content-Type': 'application/json' } : {})}, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store',signal:AbortSignal.timeout(20000) });}
  catch {throw new Error('Could not reach the CRM. Your text is still here. Retry when the connection is available.');}
  let data;
  try { data = await response.json(); } catch { throw new Error(response.status === 401 ? 'Sign in to the admin again.' : 'The CRM server is unavailable.'); }
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
async function action(fn) {
  if (state.busy) return;
  state.busy = true;
  $('send-message').disabled = true;
  document.querySelectorAll('#reply-body, #ticket-settings input, #ticket-settings select, #ticket-settings button, #convert-job, #archive-ticket').forEach(el => { el.disabled = true; });
  notice('');
  try { await fn(); } catch (error) { notice(error.message, true); }
  finally { state.busy = false; document.querySelectorAll('#reply-body, #ticket-settings input, #ticket-settings select, #ticket-settings button, #convert-job, #archive-ticket').forEach(el => { el.disabled = false; }); updateComposer(); }
}
function draftKey() { return state.active ? `${state.active.id}:${state.mode}` : null; }
function saveDraft() {
  const id = draftKey();
  if (!id) return;
  const old = state.drafts.get(id);
  const body = $('reply-body').value;
  state.drafts.set(id, { body, request_key: old?.body === body ? old.request_key : crypto.randomUUID() });
  queueDraft(id);
}
function draftStatus(value){if($('draft-status'))$('draft-status').textContent=value;}
function queueDraft(id){clearTimeout(state.draftTimers.get(id));draftStatus('Saving draft…');state.draftTimers.set(id,setTimeout(()=>persistDraft(id),650));}
async function hydrateDraft(id){
  if(state.draftVersions.has(id))return;
  try{const saved=await api('workspace/draft?key='+encodeURIComponent(id));state.draftVersions.set(id,saved.version||0);if(saved.body&&!state.drafts.get(id)?.body)state.drafts.set(id,{body:saved.body,request_key:saved.request_key});}
  catch{draftStatus('Draft is only kept in this tab until the connection is restored.');}
}
async function persistDraft(id){
  const previous=state.draftWrites.get(id)||Promise.resolve();
  const promise=previous.catch(()=>{}).then(async()=>{
    await hydrateDraft(id);if(!state.draftVersions.has(id))return;
    const draft=state.drafts.get(id)||{body:'',request_key:crypto.randomUUID()};
    const saved=await api('workspace/draft',{key:id,...draft,version:state.draftVersions.get(id)});state.draftVersions.set(id,saved.version);draftStatus(draft.body?'Draft saved privately.':'');
  }).catch(error=>{draftStatus('Draft not saved: '+error.message);});
  state.draftWrites.set(id,promise);await promise;
}
async function clearDraft(id){clearTimeout(state.draftTimers.get(id));state.drafts.delete(id);await persistDraft(id);}
function saveSettingsDraft(){
  if(!state.active)return;const id=state.active.id+':settings';let previous;try{previous=JSON.parse(state.drafts.get(id)?.body||'null');}catch{}
  const values={version:previous?.version??state.active.version,email:$('edit-email').value,status:$('edit-status').value,assigned_to:$('edit-assignee').value,priority:$('edit-priority').value,lead_source:$('edit-lead-source').value,lead_temperature:$('edit-lead-temperature').value,tags:$('edit-tags').value,followup:$('edit-followup').value};
  state.drafts.set(id,{body:JSON.stringify(values),request_key:crypto.randomUUID()});queueDraft(id);
}
function updateComposer() {
  const note = state.mode === 'note';
  $('reply-mode').classList.toggle('active', !note); $('note-mode').classList.toggle('active', note);
  $('reply-mode').setAttribute('aria-pressed', String(!note)); $('note-mode').setAttribute('aria-pressed', String(note));
  $('send-message').textContent = note ? 'Save private note' : 'Send reply ↗';
  $('composer-recipient').textContent = note ? 'Only visible inside your admin.' : state.active ? `To: ${state.active.email} · From: nathan@nc-digital.co.uk` : '';
  $('composer-hint').textContent = note ? 'This note will never be emailed to the customer.' : !state.active?.email ? 'Add an email address in Customer details to enable replies.' : state.setup?.configured ? 'Queued for sending. Check the message status for confirmation.' : 'Connect Zoho Mail to send replies. You can add private notes now.';
  $('send-message').disabled = state.busy || !state.active || (!note && (!state.setup?.configured || !state.setup?.enabled || state.active.status === 'spam' || !state.active.email || state.active.archived_at));
  $('reply-body').placeholder = note ? 'Add context for your next conversation…' : 'Write a helpful reply…';
}
async function loadSetup() {
  const setup = await api('setup'); state.setup = setup;
  $('connection-dot').classList.toggle('connected', setup.configured && !setup.sync_error);
  $('connection-status').textContent = setup.sync_error ? 'Sync needs attention' : setup.configured ? (setup.last_sync ? `Last synced ${time(setup.last_sync)}` : 'Configured · not yet synced') : 'Zoho connection needed';
  $('sync').disabled = !setup.configured || !setup.database_ready || !setup.enabled;
  $('open-zoho').href = setup.webmail;
  const issues = [];
  if (!setup.database_ready) issues.push('The CRM database migration needs to be applied.');
  if (!setup.enabled) issues.push('CRM form capture is not enabled. Website forms still use the existing delivery route.');
  if (!setup.configured) issues.push(`Zoho is not connected. Server configuration needed: ${setup.missing.join(', ') || 'check region and account ID'}.`);
  if (!setup.notifications_configured) issues.push('Connect Zoho to deliver staff enquiry notifications. Enquiries remain saved in the CRM.');
  if (setup.sync_error) issues.push(setup.sync_error);
  $('setup-panel').hidden = !issues.length;
  $('setup-panel').open = !setup.database_ready;
  const list = node('ul'); issues.forEach(issue => list.append(node('li', issue)));
  $('setup-copy').replaceChildren(list);
  updateComposer();
}
async function loadList() {
  const request = ++state.listRequest;
  const params = new URLSearchParams({ page: String(state.page), status: $('status-filter').value, assigned: $('assignee-filter').value, q: $('search').value, overdue: String($('overdue-filter').checked), archived: String($('archived-filter').checked) });
  const data = await api('list?' + params);
  if (request !== state.listRequest) return;
  state.total = data.total;
  $('list-count').textContent = `${data.total} ${data.total === 1 ? 'enquiry' : 'enquiries'}`;
  for (const status of ['new','open','waiting']) $('count-' + status).textContent = String(data.counts.find(c => c.status === status)?.count || 0);
  $('count-overdue').textContent = String(data.overdue);
  const fragment = document.createDocumentFragment();
  for (const ticket of data.tickets) {
    const button = node('button', undefined, 'ticket-row' + (state.active?.id === ticket.id ? ' active' : ''));
    button.type = 'button'; button.dataset.id = ticket.id;
    button.setAttribute('aria-label', `${ticket.name}: ${ticket.subject}`);
    const top = node('div', undefined, 'row-top'); top.append(node('strong', ticket.name), node('time', time(ticket.updated_at)));
    const bottom = node('div', undefined, 'row-bottom');let metadata={};try{metadata=JSON.parse(ticket.metadata||'{}');}catch{}const source=metadata.lead_source||'manual';bottom.append(node('span', labels[ticket.status], 'badge ' + ticket.status), node('span', `${ticket.priority === 'high' ? 'High priority · ' : ''}${source} · ${ticket.assigned_to}`));
    // Website review emails show whether the prospect has opened their review since it was sent.
    if (ticket.review_audit) bottom.append(node('span', ticket.review_opened_at ? 'Review opened ' + time(ticket.review_opened_at) : 'Review not opened yet', 'review-status ' + (ticket.review_opened_at ? 'opened' : 'unopened')));
    button.append(top, node('p', ticket.subject), bottom);
    button.addEventListener('click', () => { if (!state.busy) { saveDraft(); action(() => openTicket(ticket.id)); } });
    fragment.append(button);
  }
  if (!data.tickets.length) fragment.append(node('p', 'No enquiries match these filters.', 'empty-list'));
  $('ticket-list').replaceChildren(fragment);
  $('page-label').textContent = `Page ${state.page + 1}`;
  $('previous-page').disabled = state.page === 0; $('next-page').disabled = (state.page + 1) * 50 >= data.total;
}
function renderMessage(message) {
  const el = node('article', undefined, `message ${message.kind}`);
  const header = node('div', undefined, 'message-header');
  const types = { inbound: 'Customer', outbound: 'Email reply', note: 'Private note', event: 'Activity', notification: 'Inbox notification', confirmation: 'Auto-confirmation' };
  header.append(node('strong', `${types[message.kind]} · ${message.author}`), node('time', time(message.created_at)));
  el.append(header, node('p', message.kind === 'notification' ? 'Email alert to nathan@nc-digital.co.uk' : message.body, 'message-body'));
  if(message.has_original){const details=node('details',undefined,'original-message');details.append(node('summary','Show full original message'));let loaded=false;details.addEventListener('toggle',async()=>{if(!details.open||loaded)return;try{const original=await api('original?id='+encodeURIComponent(message.id));details.append(node('p',original.body,'message-body'));loaded=true;}catch(error){notice(error.message,true);}});el.append(details);}
  if (['outbound','notification','confirmation'].includes(message.kind)) {
    const delivery = node('div', undefined, `message-delivery ${message.delivery}`);
    delivery.append(node('span', message.delivery === 'sent' ? (message.delivery_confirmed_by ? 'Manually confirmed in Zoho by '+message.delivery_confirmed_by : 'Accepted by email provider') : message.delivery === 'unknown' ? 'Delivery unconfirmed — check Zoho before resending' : message.delivery === 'queued' ? 'Queued — awaiting scheduled delivery' : message.delivery));
    if(message.delivery_confirmed_by)delivery.append(node('span',time(message.delivery_confirmed_at)+' · '+message.delivery_confirmation_note));
    if (message.error) delivery.append(node('span', message.error));
    if (message.delivery === 'failed') {
      const retry = node('button', 'Retry send'); retry.type = 'button';
      retry.addEventListener('click', () => action(async () => { await api('retry', { message_id: message.id }); await openTicket(message.ticket_id); notice('Message queued for another delivery attempt.'); }));
      delivery.append(retry);
    }
    el.append(delivery);
  }
  return el;
}
function renderDetail(data) {
  const ticket = data.ticket;
  state.active = ticket;
  $('ticket-empty').hidden = true; $('ticket-detail').hidden = false; document.querySelector('.inbox').classList.add('detail-open');
  $('ticket-reference').textContent = ticket.reference;
  $('ticket-subject').textContent = ticket.subject;
  $('ticket-from').textContent = `${ticket.name} <${ticket.email}>`;
  $('ticket-status').textContent = labels[ticket.status]; $('ticket-status').className = 'badge ' + ticket.status;
  // Keep the newest customer or CRM message at the top so opening an enquiry
  // immediately shows what needs attention. The full history remains available
  // below it in reverse chronological order.
  $('messages').replaceChildren(...[...data.messages].reverse().map(renderMessage));
  if (data.truncated) $('messages').prepend(node('p', 'Showing the most recent 100 entries. Earlier emails remain in Zoho.', 'small-copy'));
  const details = $('customer-details'); details.replaceChildren();
  for (const [label, value] of [['Name',ticket.name],['Email',ticket.email],['Phone',ticket.phone],['Business',ticket.company],['Service',ticket.service],['Source page',ticket.source_page],['Received',time(ticket.created_at)]]) {
    if (!value) continue;
    const item=node('dd');if(label==='Email'||label==='Phone'||(label==='Source page'&&value.startsWith('/'))){const a=node('a',value);a.href=label==='Email'?'mailto:'+value:label==='Phone'?'tel:'+value.replace(/[^+\d]/g,''):value;item.append(a);}else item.textContent=value;
    details.append(node('dt', label), item);
  }
  let metadata = {}; try { metadata = JSON.parse(ticket.metadata); } catch { /* Ignore malformed optional metadata. */ }
  for (const [label, value] of Object.entries(metadata)) details.append(node('dt', label.replaceAll('_', ' ')), node('dd', String(value)));
  if(ticket.tags)details.append(node('dt','Tags'),node('dd',ticket.tags));
  const sourceValue=metadata.lead_source||'manual';if(sourceValue&&!Array.from($('edit-lead-source').options).some(option=>option.value===sourceValue)){const option=node('option',sourceValue);option.value=sourceValue;$('edit-lead-source').append(option);} $('edit-email').value = ticket.email || ''; $('edit-status').value = ticket.status; $('edit-assignee').value = ticket.assigned_to; $('edit-priority').value = ticket.priority; $('edit-lead-source').value = sourceValue; $('edit-lead-temperature').value = metadata.lead_temperature || 'warm'; $('edit-tags').value = (()=>{try{return JSON.parse(ticket.tags||'[]').join(', ');}catch{return ticket.tags||'';}})();
  $('edit-followup').value = ticket.follow_up_at ? localDateTime(ticket.follow_up_at) : '';
  try{const pending=JSON.parse(state.drafts.get(ticket.id+':settings')?.body||'null');if(pending){$('edit-email').value=(pending.email??ticket.email)||'';$('edit-status').value=pending.status;$('edit-assignee').value=pending.assigned_to;$('edit-priority').value=pending.priority;$('edit-lead-source').value=pending.lead_source||metadata.lead_source||'manual';$('edit-lead-temperature').value=pending.lead_temperature||metadata.lead_temperature||'warm';$('edit-tags').value=pending.tags??$('edit-tags').value;$('edit-followup').value=pending.followup;if(pending.version!==ticket.version)notice('Your settings draft is preserved, but this enquiry changed. Discard the settings draft to reload the latest values.',true);}}catch{}
  $('convert-job').hidden = Boolean(ticket.job_id); $('open-job').hidden = !ticket.job_id;
  $('archive-ticket').textContent = ticket.archived_at ? 'Restore enquiry' : 'Archive enquiry';
  $('archive-ticket').disabled = false;
  $('reply-body').value = state.drafts.get(draftKey())?.body || '';
  document.querySelectorAll('.ticket-row').forEach(row => row.classList.toggle('active', row.dataset.id === ticket.id));
  updateComposer();
  if($('customer-link')){
    $('customer-link').replaceChildren();
    if(ticket.account_id){const a=node('a','Open customer record →');a.href='/admin/crm/?view=accounts&id='+encodeURIComponent(ticket.account_id);$('customer-link').append(a);}
    else {const b=node('button','Link customer / qualify lead');b.type='button';b.onclick=()=>action(async()=>{
      const matches=await api('workspace/duplicates?q='+encodeURIComponent(ticket.email||ticket.company||ticket.name));
      let accountId=null;
      if(matches.items.length){const options=matches.items.map((a,i)=>`${i+1}. ${a.name} (${a.email||a.phone||'no email'})`).join('\n');const chosen=prompt('Choose an existing customer number, or enter NEW to create a separate customer:\n'+options,'1');if(chosen===null)return;if(chosen.trim().toUpperCase()!=='NEW'){const match=matches.items[Number(chosen)-1];if(!match)throw Error('Choose a listed customer number or NEW.');accountId=match.id;}}
      else if(!confirm('Create a prospect/customer record from this enquiry?'))return;
      const result=await api('workspace/link',{ticket_id:ticket.id,version:ticket.version,account_id:accountId});location.assign('/admin/crm/?view=accounts&id='+encodeURIComponent(result.account_id));
    });$('customer-link').append(b);}
  }
  requestAnimationFrame(()=>{$('messages').scrollTop=0;});
}
function localDateTime(value) { return londonInput(value); }
async function openTicket(id) {
  const request = ++state.detailRequest;
  const data = await api('ticket?id=' + encodeURIComponent(id));
  await Promise.all(['outbound','note','settings'].map(mode=>hydrateDraft(id+':'+mode)));
  if (request !== state.detailRequest) return;
  renderDetail(data);
  $('ticket-subject').tabIndex=-1;$('ticket-subject').focus({preventScroll:true});
  const url = new URL(location.href); url.searchParams.set('ticket', id); history.replaceState(null, '', url);
}
async function refresh() {
  saveDraft(); await loadSetup();
  if (!state.setup.database_ready) { $('ticket-list').replaceChildren(node('p', 'Complete database setup to open your inbox.', 'empty-list')); return; }
  await loadList();
  if (state.active) await openTicket(state.active.id);
}
$('filters').addEventListener('submit', event => { event.preventDefault(); state.page = 0; action(loadList); });
for (const id of ['status-filter','assignee-filter','overdue-filter']) $(id).addEventListener('change', () => { state.page = 0; action(loadList); });
$('archived-filter').addEventListener('change', () => { state.page = 0; state.active = null; $('ticket-detail').hidden = true; $('ticket-empty').hidden = false; document.querySelector('.inbox').classList.remove('detail-open'); action(loadList); });
$('search').addEventListener('search', () => { state.page = 0; action(loadList); });
$('previous-page').addEventListener('click', () => { if (state.page && !state.busy) { state.page--; action(loadList); } });
$('next-page').addEventListener('click', () => { if (!state.busy) { state.page++; action(loadList); } });
$('refresh').addEventListener('click', () => action(refresh));
$('sync').addEventListener('click', () => action(async () => { saveDraft(); const result = await api('sync', {}); await refresh(); notice(result.busy ? 'A mailbox sync is already running.' : `Synced ${result.imported} new replies.${result.more ? ' More messages will be checked on the next sync.' : ''}`); }));
$('reply-body').addEventListener('input', saveDraft);
for (const [id, mode] of [['reply-mode','outbound'],['note-mode','note']]) $(id).addEventListener('click', () => { if (state.busy) return; saveDraft(); state.mode = mode; $('reply-body').value = state.drafts.get(draftKey())?.body || ''; updateComposer(); });
$('composer').addEventListener('submit', event => {
  event.preventDefault();
  if (!state.active) return;
  saveDraft();
  const draftId = draftKey(), draft = state.drafts.get(draftId), ticketId = state.active.id, mode = state.mode;
  action(async () => { const data = await api('message', { id: ticketId, body: draft.body, request_key: draft.request_key, kind: mode }); await clearDraft(draftId); renderDetail(data); await loadList(); notice(mode === 'note' ? 'Private note saved.' : 'Reply queued. It will appear as accepted once Zoho confirms sending.'); });
});
$('ticket-settings').addEventListener('submit', event => {
  event.preventDefault(); if (!state.active) return; saveDraft();
  let pending;try{pending=JSON.parse(state.drafts.get(state.active.id+':settings')?.body||'null');}catch{}
  const body = { id: state.active.id, version: pending?.version??state.active.version, email: $('edit-email').value, status: $('edit-status').value, assigned_to: $('edit-assignee').value, priority: $('edit-priority').value, lead_source: $('edit-lead-source').value, lead_temperature: $('edit-lead-temperature').value, tags: $('edit-tags').value, follow_up_at: $('edit-followup').value ? londonInstant($('edit-followup').value) : null };
  action(async () => { const saved=await api('update', body);await clearDraft(body.id+':settings');renderDetail(saved);await loadList();notice('Ticket updated.'); });
});
$('convert-job').addEventListener('click', () => action(async () => { if (!state.active) return; saveDraft(); await api('job', { id: state.active.id }); await openTicket(state.active.id); notice('Job created and linked to this enquiry.'); }));
$('archive-ticket').addEventListener('click', () => action(async () => { if (!state.active) return; const ticket=state.active,restore=Boolean(ticket.archived_at); if (!confirm(`${restore?'Restore':'Archive'} this enquiry? ${restore?'It will return to the active inbox.':'It will leave the active inbox and remain available under Show archived enquiries.'}`)) return; await api('workspace/archive',{entity:'tickets',id:ticket.id,version:ticket.version,restore}); if(restore){await openTicket(ticket.id);await loadList();notice('Enquiry restored.');}else{state.active=null;$('ticket-detail').hidden=true;$('ticket-empty').hidden=false;document.querySelector('.inbox').classList.remove('detail-open');await loadList();notice('Enquiry archived. Use Show archived enquiries to restore it.');} }));
$('back-inbox').addEventListener('click', () => { saveDraft(); document.querySelector('.inbox').classList.remove('detail-open'); $('ticket-detail').hidden = true;document.querySelector('.ticket-row.active')?.focus(); });
$('ticket-settings').addEventListener('change',saveSettingsDraft);
if($('latest-message'))$('latest-message').onclick=()=>{$('messages').scrollTop=0;};
if($('quick-followup')){
  for(const [label,days] of [['Tomorrow',1],['3 days',3],['1 week',7],['1 month',30]]){const b=node('button',label);b.type='button';b.onclick=()=>{const d=new Date(londonInput(Date.now()).slice(0,10)+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);$('edit-followup').value=d.toISOString().slice(0,10)+'T09:00';saveSettingsDraft();};$('quick-followup').append(b);}
  const discard=node('button','Discard settings draft');discard.type='button';discard.onclick=()=>action(async()=>{await clearDraft(state.active.id+':settings');await openTicket(state.active.id);});$('quick-followup').append(discard);
}
addEventListener('beforeunload', event => { if ([...state.drafts.values()].some(d => d.body.trim())) { event.preventDefault(); event.returnValue = ''; } });
action(async () => { await refresh(); const id = new URL(location.href).searchParams.get('ticket'); if (id && state.setup.database_ready) await openTicket(id); });
