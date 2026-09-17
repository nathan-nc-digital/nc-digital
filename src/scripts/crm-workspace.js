const $ = id => document.getElementById(id);
const names = {today:'Today',accounts:'Customers',contacts:'Contacts',opportunities:'Pipeline',tasks:'Tasks',quotes:'Quotes',services:'Services',health:'Mailbox health',reports:'Reports'};
const singular = {accounts:'customer',contacts:'contact',opportunities:'opportunity',tasks:'task',quotes:'quote',services:'service',enquiries:'lead'};
const state = {options:{accounts:[],stages:[],saved_views:[],saved_views_ready:false},generation:0,controller:null,dialogDirty:false,dialogReturn:null};
const money = value => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format((value||0)/100);
const day = value => value ? new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'}).format(new Date(value.length===10?value+'T12:00:00Z':value)) : 'No date';
function tagList(value){try{const parsed=Array.isArray(value)?value:JSON.parse(value||'[]');return Array.isArray(parsed)?parsed.filter(Boolean):[];}catch{return typeof value==='string'?value.split(',').map(v=>v.trim()).filter(Boolean):[];}}
const tagText=value=>tagList(value).join(', ');
function el(tag,content,cls) { const node=document.createElement(tag); if(cls)node.className=cls; if(content!==undefined&&content!==null)node.textContent=String(content); return node; }
function append(parent,...children) { for(const child of children.flat())if(child)parent.append(child); return parent; }
function button(label,fn,cls='') { const b=el('button',label,cls);b.type='button';b.addEventListener('click',fn);return b; }
function link(label,href) { const a=el('a',label);a.href=href;return a; }
function badge(value,label=value) {return el('span',label,'badge '+value);}
function announce(message,error=false){const n=$('workspace-notice');n.textContent=message;n.hidden=!message;n.className=error?'error':'';}
async function api(route,body,signal) {
  const response=await fetch('/admin/crm/api/workspace/'+route,{method:body?'POST':'GET',headers:{'X-Requested-With':'XMLHttpRequest',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:signal||AbortSignal.timeout(20000)});
  let data;try{data=await response.json();}catch{throw Error(response.status===401?'Sign in again. Your draft has been kept.':'The server did not return a readable response. Please retry.');}
  if(!response.ok)throw Error(data.error||'This change could not be saved.');return data;
}
function params(){return new URL(location.href).searchParams;}
function navigate(values) {const url=new URL(location.href);url.search='';for(const [k,v] of Object.entries(values))if(v!==null&&v!==undefined&&v!=='')url.searchParams.set(k,v);history.pushState(null,'',url);load();}
function pageHeading(title,description,actions=[]) {return append(el('div',null,'page-heading'),append(el('div'),el('p','NC DIGITAL / CLIENT WORKSPACE','eyebrow'),el('h1',title),el('p',description)),append(el('div',null,'actions'),actions));}
function panel(title,items,empty='Nothing needs attention here.',aside) {const p=el('section',null,'panel');append(p,append(el('header',null,'panel-header'),el('h2',title),aside));if(items.length)append(p,items);else append(p,append(el('div',null,'empty'),el('strong',empty)));return p;}
function metric(label,value,description,fn,urgent=false) {const m=fn?button('',fn,'metric'+(urgent?' urgent':'')):el('div',null,'metric');append(m,el('span',label,'metric-label'),el('strong',value),el('small',description));return m;}
function taskRow(task,today) {const row=el('div',null,'work-row');if(task.status==='open')append(row,button('✓',async()=>{try{await api('tasks',{...task,status:'done'});announce('Task completed.');load();}catch(e){announce(e.message,true);}},'complete-button'));
  row.querySelector('button')?.setAttribute('aria-label','Complete '+task.title);
  append(row,append(el('div',null,'row-content'),button(task.title,()=>edit('tasks',task),'text-button'),el('p',task.account_name||task.kind)),badge(task.status==='done'?'done':task.due_date<today?'overdue':task.due_date===today?'today':'open',task.due_date<today&&task.status==='open'?'Overdue · '+day(task.due_date):day(task.due_date)));return row;
}
function recordRow(title,detail,fn,status) {return append(el('div',null,'work-row'),append(el('div',null,'row-content'),button(title,fn,'text-button'),el('p',detail)),status?badge(status):null);}
function inboxLink(ticketId) {return '/admin/crm/inbox/'+(ticketId?'?ticket='+encodeURIComponent(ticketId):'');}
function openRecord(entity,id,relatedId){if(entity==='tickets'||entity==='messages')return location.assign(inboxLink(entity==='messages'?relatedId:id));if((entity==='contacts'||entity==='notes')&&relatedId)return navigate({view:'accounts',id:relatedId});if(entity==='accounts')return navigate({view:'accounts',id});api('record?entity='+entity+'&id='+encodeURIComponent(id)).then(row=>entity==='quotes'?showQuote(row):edit(entity,row)).catch(e=>announce(e.message,true));}
function enquiryContext(ticket) {
  let metadata={};
  try { metadata=JSON.parse(ticket.metadata||'{}'); } catch { /* Ignore malformed optional metadata. */ }
  if (metadata.lead_source === 'website-cost-calculator') {
    return ['Cost calculator', metadata.calculator_build_total].filter(Boolean).join(' · ');
  }
  return [ticket.service || 'Website enquiry', ticket.source_page].filter(Boolean).join(' · ');
}

async function renderToday(signal) {
  const d=await api('today',null,signal),fragment=document.createDocumentFragment();
  const overdue=d.tasks.filter(t=>t.due_date<d.today),todayTasks=d.tasks.filter(t=>t.due_date===d.today),noDate=d.tasks.filter(t=>t.status==='open'&&!t.due_date);
  append(fragment,pageHeading('A clear day ahead.',`${day(d.today)} · Your follow-ups, conversations and commitments.`,[button('Add a task',()=>edit('tasks'),'quiet')]));
  append(fragment,append(el('div',null,'metrics-grid'),metric('Needs attention',overdue.length+todayTasks.length,'Overdue and due today',()=>navigate({view:'tasks',status:'open',due:d.today}),overdue.length>0),metric('Open pipeline',money(d.pipeline.filter(s=>s.outcome==='open').reduce((n,s)=>n+s.value_pence,0)),money(d.weighted_pipeline_pence)+' weighted',()=>navigate({view:'opportunities'})),metric('Monthly recurring',money(d.revenue.mrr_pence),'Active contracts · excluding VAT',()=>navigate({view:'services'})),metric('Annual recurring',money(d.revenue.arr_pence),d.revenue.recurring_customers+' recurring customers',()=>navigate({view:'services'}))));
  const left=el('div',null,'stack'),right=el('div',null,'stack');
  fragment.querySelector('.metrics-grid')?.append(metric('Missing due dates',noDate.length,'Open tasks needing a date',()=>navigate({view:'tasks',status:'open',undated:'true'}),noDate.length>0));
  append(left,panel('Your next actions',[...overdue,...todayTasks].map(t=>taskRow(t,d.today)),'You’re up to date for today.',link('All tasks →','?view=tasks')));
  append(left,panel('Conversations needing a look',d.enquiries.map(t=>recordRow(t.name,t.subject+' · '+enquiryContext(t),()=>location.assign(inboxLink(t.id)),t.status)),'No new or open enquiries.',link('Open inbox →',inboxLink())));
  append(left,panel('Coming up',d.tasks.filter(t=>t.due_date>d.today).slice(0,6).map(t=>taskRow(t,d.today)),'No upcoming tasks.'));
  append(right,panel('Tasks without a due date',noDate.map(t=>recordRow(t.title,t.account_name||'General task',()=>edit('tasks',t),'open')),'Every open task has a due date.',link('Review undated tasks →','?view=tasks&status=open&undated=true')));
  if(d.no_action.length)append(right,panel('Missing a next action',d.no_action.map(o=>recordRow(o.title,o.account_name,()=>edit('opportunities',o),'overdue'))));
  if(d.stale.length)append(right,panel('Stale opportunities',d.stale.map(o=>recordRow(o.title,[o.account_name,'no update since '+day(o.updated_at)].filter(Boolean).join(' · '),()=>edit('opportunities',o),'overdue'))));
  const stageRows=d.pipeline.filter(s=>s.outcome==='open').map(s=>recordRow(s.name,`${s.count} opportunit${s.count===1?'y':'ies'} · ${money(s.value_pence)} · ${s.probability}% likely`,()=>navigate({view:'opportunities',stage_id:s.id})));
  append(right,panel('Pipeline by stage',stageRows,'No open pipeline yet.',el('small',money(d.weighted_pipeline_pence)+' weighted')));
  append(right,panel('Quotes awaiting a decision',d.quotes.map(q=>recordRow(q.number+' · '+q.title,`${q.account_name} · expires ${day(q.expires_on)}`,()=>openRecord('quotes',q.id),q.status)),'No quotes awaiting a decision.'));
  append(right,panel('Renewals in the next 30 days',d.renewals.map(s=>recordRow(s.name,`${s.account_name} · ${day(s.renews_on)}`,()=>edit('services',s))),'No upcoming renewals.'));
  const issues=d.health.filter(h=>['failed','unknown'].includes(h.delivery)),health=el('div',null,'panel-body health'+(issues.length||d.sync_error?' attention':''));
  append(health,el('strong',issues.length||d.sync_error?'Mailbox needs attention':'Mailbox activity'),el('p',d.last_sync?'Last sync '+day(d.last_sync):'No completed sync yet.'),...d.health.map(h=>el('p',`${h.count} ${h.delivery} · oldest ${day(h.oldest)}`)),d.sync_error?el('p',d.sync_error):null,link('Review messages →','?view=health'));
  append(right,append(el('section',null,'panel'),append(el('header',null,'panel-header'),el('h2','Connection & delivery')),health));
  append(fragment,append(el('div',null,'content-grid'),left,right));return fragment;
}

async function renderReports(signal) {
  const p=params(),fromValue=p.get('from')||addDays(state.options.today,-30),toValue=p.get('to')||state.options.today;
  const d=await api('reports?from='+encodeURIComponent(fromValue)+'&to='+encodeURIComponent(toValue),null,signal),fragment=document.createDocumentFragment();
  const rangeForm=el('form',null,'report-range');const from=field(rangeForm,'From','from',d.from,'date',{required:true}),to=field(rangeForm,'To','to',d.to,'date',{required:true});const apply=el('button','Update report','primary');apply.type='submit';append(rangeForm,apply);rangeForm.onsubmit=event=>{event.preventDefault();navigate({view:'reports',from:from.value,to:to.value});};
  append(fragment,pageHeading('Reports','A focused view of lead flow, sales value and recurring commitments.',[rangeForm,button('Last 30 days',()=>navigate({view:'reports',from:addDays(state.options.today,-30),to:state.options.today}),'quiet'),button('This year',()=>navigate({view:'reports',from:state.options.today.slice(0,4)+'-01-01',to:state.options.today}),'quiet')]));
  append(fragment,append(el('div',null,'metrics-grid'),metric('Leads',d.leads.count,'Created in selected period',()=>navigate({view:'today'})),metric('Open pipeline',money(d.opportunities.open_value_pence),'Current one-off value created in period'),metric('Won value',money(d.opportunities.won_value_pence),`${d.opportunities.win_rate}% decided value win rate`),metric('Quotes',d.quotes.count,money(d.quotes.value_pence)+' one-off quoted'),metric('Monthly recurring',money(d.revenue.mrr_pence),'Active contracts · excluding VAT')));
  const table=(headers,rowsData,empty='No data for this period.')=>{if(!rowsData.length)return append(el('div',null,'empty'),el('strong',empty));const t=el('table'),head=el('thead'),body=el('tbody');append(head,append(el('tr'),headers.map(h=>el('th',h))));for(const row of rowsData)append(body,append(el('tr'),row.map(value=>el('td',value))));append(t,head,body);return append(el('div',null,'table-wrap'),t);};
  const leadStatus=d.leads.by_status.map(row=>[row.status,row.count]);
  const leadService=d.leads.by_service.map(row=>[row.label,row.count]);
  const leadSource=d.leads.by_source.map(row=>[row.label,row.count]);
  const oppRows=d.opportunities.by_stage.map(row=>[row.label,row.count,money(row.value_pence),row.outcome]);
  const quoteRows=d.quotes.by_status.map(row=>[row.status,row.count,money(row.value_pence)]);
  const left=el('div',null,'stack'),right=el('div',null,'stack');
  append(left,panel('Lead status',[],null,el('small',d.leads.count+' leads')));left.lastChild.append(table(['Status','Leads'],leadStatus));
  append(left,panel('Lead source',[],null,el('small','Attribution')));left.lastChild.append(table(['Source','Leads'],leadSource));
  append(right,panel('Lead service interest',[],null,el('small','Demand')));right.lastChild.append(table(['Service','Leads'],leadService));
  append(right,panel('Pipeline created',[],null,el('small',money(d.opportunities.won_value_pence)+' won')));right.lastChild.append(table(['Stage','Opportunities','Value','Outcome'],oppRows));
  append(fragment,append(el('div',null,'content-grid'),left,right));
  append(fragment,panel('Quotes and activity',[],null,el('small',d.activities+' logged activities')));fragment.lastChild.append(table(['Quote status','Quotes','Value'],quoteRows));
  append(fragment,el('p',`Reporting period: ${day(d.from)} to ${day(d.to)}. Pipeline and quote totals use one-off GBP values; recurring figures are current contracted services, separate from cash or accounting revenue.`,'form-hint'));
  return fragment;
}

async function renderHealth(signal) {
  const d=await api('health',null,signal),fragment=document.createDocumentFragment(),panels=el('div',null,'stack');
  append(fragment,pageHeading('Mailbox health','Review import problems and messages that need a delivery check.',[button('Refresh',()=>load(),'quiet'),link('Open inbox',inboxLink())]));
  if(!d.ready)append(fragment,el('p','The mailbox reliability upgrade needs to be applied.','error'));
  const stamp=value=>value?new Date(value).toLocaleString('en-GB',{timeZone:'Europe/London'}):'No check recorded';
  append(panels,panel('Connection',[append(el('div',null,'panel-body'),el('p','Last mailbox check: '+stamp(d.last_check)),el('p','Last completed scan: '+stamp(d.last_sync)),el('p','Login: '+(d.auth_mode==='access'?'Managed access':'Password login')),d.logout_path?link('Sign out',d.logout_path):null,d.sync_error?el('p',d.sync_error,'error'):null)]));
  if(d.backup)append(panels,panel('Cloud backups',[append(el('div',null,'panel-body'),el('p',d.backup.configured?'Daily backups are stored privately in Cloudflare R2.':'Cloud backups are not configured.'),el('p','Last successful backup: '+stamp(d.backup.last_success)),d.backup.last_success?link('Download latest backup','/admin/crm/api/workspace/backup'):null,d.backup.configured?button('Back up now',async event=>{event.currentTarget.disabled=true;try{const result=await api('backup-now',{});announce(result.error||'Backup checked. See the latest successful copy below.',Boolean(result.error));await load();}catch(error){announce(error.message,true);event.currentTarget.disabled=false;}},'quiet'):null,d.backup.error?el('p',d.backup.error,'error'):null,d.backup.configured&&(!d.backup.last_success||Date.now()-Date.parse(d.backup.last_success)>36*3600000)?el('p','Backup needs attention: no recent successful copy.','error'):null)]));
  const imports=d.imports.map(item=>{
    const row=append(el('div',null,'work-row'),append(el('div',null,'row-content'),link(item.name+' · '+item.reference,inboxLink(item.ticket_id)),el('p',`${item.status.replaceAll('_',' ')} · ${item.attempts} attempts`),item.last_error?el('p',item.last_error):null,item.status==='retry'?el('small','Next attempt: '+stamp(item.next_attempt_at)):null));
    if(['retry','needs_review'].includes(item.status))append(row,button('Retry import',async event=>{const b=event.currentTarget;b.disabled=true;try{await api('retry-import',{provider_id:item.provider_id});announce('Reply queued for the next mailbox sync.');await load();}catch(e){announce(e.message,true);b.disabled=false;}},'quiet'));return row;
  });
  append(panels,panel('Replies awaiting import',imports,'No replies waiting to be imported.',el('small',d.totals.map(t=>`${t.count} ${t.status.replaceAll('_',' ')}`).join(' · '))));
  const outbox=d.outbox.map(item=>append(el('div',null,'work-row'),append(el('div',null,'row-content'),link(item.name+' · '+item.reference,inboxLink(item.ticket_id)),el('p',`${item.delivery} · ${stamp(item.created_at)}`),item.error?el('p',item.error):null),item.delivery==='unknown'?button('Confirm from Zoho Sent',()=>confirmDelivery(item),'quiet'):badge(item.delivery)));
  append(panels,panel('Messages awaiting confirmation',outbox,'No outstanding delivery issues.'));append(fragment,panels);
  append(fragment,el('p','Showing up to 50 imports and 50 outgoing messages. An unconfirmed send is never resent automatically. Check the exact recipient, message and time in Zoho Sent before confirming.','form-hint'));return fragment;
}
function confirmDelivery(item) {
  const content=showDialog('Confirm a sent message','MAILBOX HEALTH'),form=el('form');
  append(form,el('p','Open this conversation and check the exact message in Zoho Sent. This records your evidence; it does not send an email or prove that the recipient received it.'),link('Open conversation',inboxLink(item.ticket_id)));
  const note=field(form,'Evidence from Zoho Sent','note','','textarea',{required:true,max:2000,hint:'Record the recipient, sent time and enough detail to identify this message.'});note.minLength=12;
  const checked=el('input');checked.type='checkbox';checked.required=true;append(form,append(el('label',null,'form-field'),checked,document.createTextNode('I checked this exact message in Zoho Sent.')));
  const error=el('p',null,'form-error');error.setAttribute('role','alert');const submit=el('button','Record confirmation','primary');submit.type='submit';append(form,error,append(el('div',null,'form-actions'),button('Cancel',()=>closeDialog(),'quiet'),submit));content.append(form);
  form.onsubmit=async event=>{event.preventDefault();if(submit.disabled)return;submit.disabled=true;try{await api('confirm-sent',{id:item.id,updated_at:item.updated_at,confirmed:checked.checked,note:note.value});closeDialog(true);announce('Your delivery confirmation was recorded in the audit trail.');await load();}catch(e){error.textContent=e.message;submit.disabled=false;}};
}

function savedViews(entity){return (state.options.saved_views||[]).filter(view=>view&&view.entity===entity&&typeof view.name==='string'&&typeof view.query==='string');}
async function saveCurrentView(entity,p){const raw=prompt('Name this saved view');if(raw===null)return;const name=raw.trim().slice(0,80);if(!name){announce('Enter a name for the saved view.',true);return;}const query=new URLSearchParams(p);query.delete('view');query.delete('id');query.delete('page');const existing=savedViews(entity).find(view=>view.name.toLowerCase()===name.toLowerCase());try{await api('saved-view',{id:existing?.id,version:existing?.version,entity,name,query:query.toString()});announce(`Saved view “${name}”.`);await load();}catch(error){announce(error.message,true);}}
function applySavedView(entity,value){const view=savedViews(entity).find(item=>item.name===value);if(view)navigate({view:entity,...Object.fromEntries(new URLSearchParams(view.query))});}

function filterBar(entity,data,p) {
  const form=el('form',null,'filter-bar'),search=el('input');search.type='search';search.name='q';search.value=p.get('q')||'';search.placeholder='Search '+names[entity].toLowerCase()+'…';search.setAttribute('aria-label','Search '+names[entity]);
  append(form,search,button('Search',()=>form.requestSubmit(),'quiet'));
  if(['tasks','quotes','services'].includes(entity)){const select=el('select');select.name='status';select.setAttribute('aria-label','Filter by status');const statuses={tasks:['open','done','cancelled'],quotes:['draft','queued','sent','accepted','rejected','expired'],services:['active','paused','cancelled']}[entity];for(const status of ['',...statuses]){const option=el('option',status||'All statuses');option.value=status;select.append(option);}select.value=p.get('status')||'';select.onchange=()=>form.requestSubmit();append(form,select);}
  if(entity==='tasks'){const select=el('select');select.name='kind';select.setAttribute('aria-label','Filter by task type');for(const [value,label] of [['','All task types'],['followup','Follow-ups'],['call','Calls'],['meeting','Meetings'],['onboarding','Onboarding'],['renewal','Renewals'],['task','General tasks']]){const option=el('option',label);option.value=value;select.append(option);}select.value=p.get('kind')||'';select.onchange=()=>form.requestSubmit();append(form,select);}
  if(['opportunities','tasks','quotes','services'].includes(entity)){const select=el('select');select.name='account_id';select.setAttribute('aria-label','Filter by customer');const options=[{id:'',name:'All customers'},...state.options.accounts];for(const account of options){const option=el('option',account.name);option.value=account.id;select.append(option);}select.value=p.get('account_id')||'';select.onchange=()=>form.requestSubmit();append(form,select);}
  if(['accounts','contacts','opportunities'].includes(entity)){const input=el('input');input.type='search';input.name='tag';input.value=p.get('tag')||'';input.placeholder='Tag';input.setAttribute('aria-label','Filter by tag');input.onchange=()=>form.requestSubmit();append(form,input);}
  if(entity==='accounts'){const select=el('select');select.name='lifecycle';select.setAttribute('aria-label','Filter by relationship');for(const [value,label] of [['','All relationships'],['prospect','Prospects'],['customer','Customers'],['inactive','Inactive']]){const option=el('option',label);option.value=value;select.append(option);}select.value=p.get('lifecycle')||'';select.onchange=()=>form.requestSubmit();append(form,select);}
  if(entity==='tasks'){const undated=el('input');undated.type='checkbox';undated.name='undated';undated.checked=p.get('undated')==='true';undated.setAttribute('aria-label','No due date');undated.onchange=()=>form.requestSubmit();append(form,append(el('label'),undated,document.createTextNode('No due date')));const from=el('input');from.type='date';from.name='due_from';from.value=p.get('due_from')||'';from.setAttribute('aria-label','Due from');from.title='Show tasks due on or after this date';from.onchange=()=>form.requestSubmit();append(form,from);const due=el('input');due.type='date';due.name='due';due.value=p.get('due')||'';due.setAttribute('aria-label','Due by');due.title='Show tasks due on or before this date';due.onchange=()=>form.requestSubmit();append(form,due);}
  if(entity==='opportunities'){const select=el('select');select.name='stage_id';select.setAttribute('aria-label','Filter by pipeline stage');const options=[{id:'',name:'All pipeline stages'},...state.options.stages];for(const stage of options){const option=el('option',stage.name);option.value=stage.id;select.append(option);}select.value=p.get('stage_id')||'';select.onchange=()=>form.requestSubmit();append(form,select);for(const [name,label] of [['service','Service'],['source','Lead source']]){const input=el('input');input.type='search';input.name=name;input.value=p.get(name)||'';input.placeholder=label;input.setAttribute('aria-label','Filter by '+label.toLowerCase());input.onchange=()=>form.requestSubmit();append(form,input);}const close=el('input');close.type='date';close.name='close_by';close.value=p.get('close_by')||'';close.title='Show opportunities expected to close by this date';close.setAttribute('aria-label','Close by');close.onchange=()=>form.requestSubmit();append(form,close);const sort=el('select');sort.name='sort';sort.setAttribute('aria-label','Sort opportunities by');for(const [value,label] of [['updated','Latest update'],['value','Highest value'],['close','Expected close']]){const option=el('option',label);option.value=value;sort.append(option);}sort.value=p.get('sort')||'updated';sort.onchange=()=>form.requestSubmit();append(form,sort);}
  const archived=el('input');archived.type='checkbox';archived.name='archived';archived.checked=p.get('archived')==='true';archived.onchange=()=>form.requestSubmit();append(form,append(el('label'),archived,document.createTextNode('Archived')));
  if(p.get('q')||p.get('status')||p.get('kind')||p.get('account_id')||p.get('lifecycle')||p.get('stage_id')||p.get('service')||p.get('source')||p.get('tag')||p.get('close_by')||p.get('undated')||p.get('due_from')||p.get('due')||p.get('sort')||p.get('archived'))append(form,button('Clear filters',()=>navigate({view:entity}),'quiet'));
  if(entity==='opportunities')append(form,button(p.get('layout')==='list'?'Board view':'List view',()=>navigate({...Object.fromEntries(p),view:entity,q:search.value,layout:p.get('layout')==='list'?'board':'list'}),'quiet'));
  if(state.options.saved_views_ready&&entity!=='contacts'){const saved=el('select');saved.setAttribute('aria-label','Saved views');append(saved,el('option','Saved views'));for(const view of savedViews(entity))append(saved,el('option',view.name));saved.onchange=()=>applySavedView(entity,saved.value);append(form,saved,button('Save view',()=>saveCurrentView(entity,p),'quiet'));}
  append(form,el('span',data.total+' records','count'));
  form.onsubmit=event=>{event.preventDefault();const values=Object.fromEntries(new FormData(form));navigate({view:entity,...values,undated:entity==='tasks'&&form.querySelector('[name=undated]')?.checked?'true':'',archived:archived.checked?'true':'',layout:p.get('layout')});};return form;
}
async function renderList(entity,p,signal) {
  const query=new URLSearchParams(p);query.set('entity',entity);
  const d=await api('list?'+query,null,signal),fragment=document.createDocumentFragment();
  const descriptions={contacts:'People, contact details and customer relationships in one place.',accounts:'One relationship, with every conversation and commitment connected.',opportunities:'Know what is moving forward, what it is worth and what happens next.',tasks:'Keep every promise visible. Complete it, or give it a clear next date.',quotes:'Keep proposals, revisions and customer decisions together.',services:'Track active contracts, renewal dates and recurring revenue.'};
  append(fragment,pageHeading(names[entity],descriptions[entity],[entity==='opportunities'?button('Manage stages',manageStages,'quiet'):null,button('Export CSV',()=>exportCsv(entity),'quiet'),button('＋ New '+singular[entity],()=>edit(entity),'primary')]),filterBar(entity,d,p));
  if(entity==='accounts')fragment.querySelector('.page-heading .actions')?.prepend(button('Import CSV',importAccounts,'quiet'));
  if(!d.items.length){append(fragment,panel('',[],'No records in this view.'));return fragment;}
  if(entity==='opportunities'&&p.get('layout')!=='list')append(fragment,board(d.items));else append(fragment,recordTable(entity,d.items));
  append(fragment,append(el('div',null,'pagination'),button('← Previous',()=>navigate({...Object.fromEntries(p),page:d.page-1})),el('span',`Page ${d.page+1} · showing ${d.items.length} of ${d.total}`),button('Next →',()=>navigate({...Object.fromEntries(p),page:d.page+1}))));
  const buttons=fragment.querySelector('.pagination').querySelectorAll('button');buttons[0].disabled=d.page===0;buttons[1].disabled=(d.page+1)*50>=d.total;
  return fragment;
}
function recordTable(entity,items) {
  const labels={contacts:['Contact','Customer','Email / phone','Tags',''],accounts:['Customer / business','Contact','Relationship','Tags','Updated',''],opportunities:['Opportunity','Service','Stage','Tags','One-off value',''],tasks:['Task','Customer','Due','Status',''],quotes:['Quote','Customer','Expires','Status / one-off total',''],services:['Service','Customer','Renewal','Contract price','']};
  const selectable=entity==='tasks',selected=new Map(),table=el('table'),head=el('thead'),body=el('tbody'),toolbar=el('div',null,'bulk-toolbar'),summary=el('span','0 selected');
  const bulkAction=button('Complete selected',async()=>{if(!selected.size||!confirm(`Complete ${selected.size} selected task${selected.size===1?'':'s'}?`))return;bulkAction.disabled=true;try{const count=selected.size;await api('bulk',{entity:'tasks',action:'complete',records:[...selected.values()]});announce(`${count} task${count===1?'':'s'} completed.`);await load();}catch(error){announce(error.message,true);bulkAction.disabled=false;}});
  function updateSelection(){summary.textContent=`${selected.size} selected`;toolbar.hidden=!selected.size;bulkAction.disabled=!selected.size;}
  if(selectable){const all=el('input');all.type='checkbox';all.setAttribute('aria-label','Select all open tasks');all.onchange=()=>{for(const item of items)if(item.status==='open'){if(all.checked)selected.set(item.id,{id:item.id,version:item.version});else selected.delete(item.id);}body.querySelectorAll('input[data-select-task]').forEach(input=>{input.checked=all.checked&&!input.disabled;});updateSelection();};append(toolbar,summary,bulkAction,el('span','Only open tasks can be completed in bulk.','muted'));append(head,append(el('tr'),el('th'),...labels[entity].map(v=>el('th',v))));}else append(head,append(el('tr'),labels[entity].map(v=>el('th',v))));
  for(const item of items){const title=item.name||item.title,first=el('td');append(first,button(entity==='quotes'?item.number+' · '+title:title,()=>entity==='accounts'?navigate({view:'accounts',id:item.id}):entity==='quotes'?showQuote(item):edit(entity,item),'record-link'));if(entity==='opportunities')append(first,el('small',item.source||'No source recorded'));
    const row=el('tr');if(selectable){const check=el('input');check.type='checkbox';check.disabled=item.status!=='open';check.dataset.selectTask='';check.setAttribute('aria-label','Select '+title);check.onchange=()=>{if(check.checked)selected.set(item.id,{id:item.id,version:item.version});else selected.delete(item.id);updateSelection();};append(row,append(el('td'),check));}append(row,first);
    if(entity==='contacts')append(row,el('td',state.options.accounts.find(a=>a.id===item.account_id)?.name||'Independent contact'),append(el('td'),item.email?link(item.email,'mailto:'+item.email):el('span','No email'),el('small',item.phone)),el('td',tagText(item.tags)||'—'));
    if(entity==='accounts')append(row,append(el('td'),item.email?link(item.email,'mailto:'+item.email):el('span','No email'),el('small',item.phone)),append(el('td'),badge(item.lifecycle)),append(el('td'),tagText(item.tags)||'—'),el('td',day(item.updated_at)));
    if(entity==='opportunities')append(row,el('td',item.service||'—'),append(el('td'),badge(item.outcome,item.stage_name)),append(el('td'),tagText(item.tags)||'—'),el('td',money(item.value_pence)));
    if(entity==='tasks')append(row,el('td',item.account_name||'General task'),append(el('td'),badge(item.status==='open'&&item.due_date<state.options.today?'overdue':item.status,day(item.due_date))),el('td',item.status));
    if(entity==='quotes')append(row,el('td',item.account_name||''),el('td',day(item.expires_on)),append(el('td'),badge(item.status),el('small',money(item.total_pence)+' one-off')));
    if(entity==='services')append(row,el('td',item.account_name||''),el('td',day(item.renews_on)),append(el('td'),el('span',money(item.price_pence)+' / '+item.frequency),el('small',item.status+(item.ends_on?' · ends '+day(item.ends_on):''))));
    const actions=el('div',null,'actions');
    if(entity==='tasks'&&item.status==='open')append(actions,button('Complete',async()=>{try{await api('tasks',{...item,status:'done'});announce('Task completed.');load();}catch(e){announce(e.message,true);}}));
    if(entity==='services'&&item.status==='active'&&item.frequency!=='once'&&!item.ends_on)append(actions,button('Renew',async()=>{if(!confirm(`Record ${item.name} as renewed and advance its renewal date?`))return;try{await api('renew',{id:item.id,version:item.version});announce('Renewal recorded.');load();}catch(e){announce(e.message,true);}}));
    append(actions,button(item.archived_at?'Restore':'Archive',()=>archiveRecord(entity,item),'quiet'));
    append(row,append(el('td'),actions));body.append(row);
  }
  append(table,head,body);updateSelection();const wrap=append(el('div',null,'table-wrap'),table);return append(el('div',null,'bulk-section'),selectable?toolbar:null,wrap);
}
function board(items) {
  const b=el('div',null,'board');
  for(const stage of state.options.stages){const deals=items.filter(o=>o.stage_id===stage.id),column=el('section',null,'board-column');append(column,append(el('header'),el('h2',stage.name),el('span',deals.length,'badge')));
    for(const deal of deals){const card=button('',()=>edit('opportunities',deal),'deal-card');card.draggable=true;card.setAttribute('aria-label',deal.title+' · '+stage.name);append(card,el('strong',deal.title),el('p',state.options.accounts.find(a=>a.id===deal.account_id)?.name||''),el('span',money(deal.value_pence),'value'));card.ondragstart=e=>e.dataTransfer.setData('text/plain',deal.id);column.append(card);}
    column.ondragover=e=>{e.preventDefault();column.classList.add('drag-over');};column.ondragleave=()=>column.classList.remove('drag-over');
    column.ondrop=async event=>{event.preventDefault();column.classList.remove('drag-over');const deal=items.find(o=>o.id===event.dataTransfer.getData('text/plain'));if(!deal||deal.stage_id===stage.id)return;
      if(stage.outcome==='lost'||stage.outcome==='future'){edit('opportunities',{...deal,stage_id:stage.id});return;}
      if(stage.outcome==='won'&&!confirm('Mark this opportunity as won and convert its account to a customer?'))return;
      column.setAttribute('aria-busy','true');try{await api('opportunities',{...deal,stage_id:stage.id});announce('Pipeline updated.');await load();}catch(e){announce(e.message,true);edit('opportunities',{...deal,stage_id:stage.id});}finally{column.removeAttribute('aria-busy');}
    };
    append(b,column);
  }return b;
}

function manageStages() {
  const content=showDialog('Manage pipeline stages','PIPELINE SETTINGS'),form=el('form'),intro=el('p','Rename stages, change their order or adjust the probability used for weighted pipeline value. Stage outcomes stay fixed so existing won/lost reporting remains safe.','form-hint'),list=el('div',null,'stage-settings'),error=el('p',null,'form-error');
  error.hidden=true;error.setAttribute('role','alert');
  for(const stage of state.options.stages){
    const row=el('div',null,'stage-setting-row');row.dataset.stageId=stage.id;row.dataset.version=String(stage.version);
    const name=field(row,'Stage name','name',stage.name,'text',{required:true,max:80});
    const position=field(row,'Order','position',stage.position,'number',{required:true,min:1,step:1});
    const probability=field(row,'Probability %','probability',stage.probability,'number',{required:true,min:0,max:100,step:1});
    append(row,append(el('div',null,'stage-outcome'),el('span','Outcome','stage-outcome-label'),badge(stage.outcome),el('small',stage.id)));
    list.append(row);name.addEventListener('input',()=>{state.dialogDirty=true;});position.addEventListener('input',()=>{state.dialogDirty=true;});probability.addEventListener('input',()=>{state.dialogDirty=true;});
  }
  const submit=el('button','Save pipeline stages','primary');submit.type='submit';append(form,intro,list,error,append(el('div',null,'form-actions'),button('Cancel',()=>closeDialog(),'quiet'),submit));content.append(form);
  form.onsubmit=async event=>{event.preventDefault();if(submit.disabled)return;error.hidden=true;submit.disabled=true;
    try{
      for(const row of list.querySelectorAll('.stage-setting-row')){
        const body={id:row.dataset.stageId,version:Number(row.dataset.version),name:row.querySelector('[name=name]').value,position:Number(row.querySelector('[name=position]').value),probability:Number(row.querySelector('[name=probability]').value)};
        const saved=await api('stage',body);row.dataset.version=String(saved.version);
      }
      state.dialogDirty=false;closeDialog(true);announce('Pipeline stages saved.');await load();
    }catch(e){error.textContent=e.message;error.hidden=false;error.focus();submit.disabled=false;}
  };
  requestAnimationFrame(()=>list.querySelector('input')?.focus());
}

function activityTimeline(d) {
  const kinds={inbound:'Customer',outbound:'Email reply',note:'Private note',event:'Activity',notification:'Inbox notification'};
  const entries=[
    ...d.activities.map(n=>({date:n.created_at,title:(n.pinned?'Pinned · ':'')+n.kind,detail:n.body,author:n.author||'Nathan'})),
    ...d.messages.map(m=>({date:m.created_at,title:kinds[m.kind]||m.kind,detail:m.body,author:m.author,fn:()=>location.assign(inboxLink(m.ticket_id))})),
    ...d.audit.map(a=>({date:a.created_at,title:'CRM change',detail:`${a.entity.replace(/^crm_/,'')} · ${a.action}`,author:a.actor}))
  ].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,100);
  return entries.map(item=>{const row=recordRow(item.title,day(item.date)+' · '+(item.author||''),item.fn||(()=>{}));if(!item.fn)row.querySelector('.row-content button').replaceWith(el('strong',item.title));row.querySelector('.row-content').append(el('p',item.detail,'note-body'));return row;});
}
async function renderAccount(accountId,signal) {
  const d=await api('account?id='+encodeURIComponent(accountId),null,signal),a=d.account,fragment=document.createDocumentFragment();
  append(fragment,link('← Customers','?view=accounts'),pageHeading(a.name,'A complete view of your relationship.',[button('Edit details',()=>edit('accounts',a),'quiet'),button('＋ Opportunity',()=>edit('opportunities',{account_id:a.id}),'primary')]));
  append(fragment,append(el('div',null,'metrics-grid'),metric('Relationship',a.lifecycle,a.archived_at?'Archived record':'Customer / business record'),metric('Monthly recurring',money(d.revenue.mrr_pence),'Active services · excluding VAT'),metric('Annual recurring',money(d.revenue.arr_pence),'Normalised recurring contract value'),metric('Open opportunities',d.opportunities.filter(o=>o.outcome==='open').length,d.tasks.filter(t=>t.status==='open').length+' open tasks')));
  const left=el('div',null,'stack'),right=el('div',null,'stack');
  append(left,panel('Next actions',d.tasks.filter(t=>t.status==='open').map(t=>taskRow(t,state.options.today)),'No open tasks.',button('＋ Task',()=>edit('tasks',{account_id:a.id}),'quiet')));
  append(left,panel('Opportunities',d.opportunities.map(o=>recordRow(o.title,`${money(o.value_pence)} · ${o.stage_name}`,()=>edit('opportunities',o),o.outcome)),'No opportunities yet.'));
  append(left,panel('Quotes',d.quotes.map(q=>recordRow(q.number+' · '+q.title,day(q.expires_on),()=>showQuote(q),q.status)),'No quotes yet.',button('＋ Quote',()=>edit('quotes',{account_id:a.id}),'quiet')));
  append(left,panel('Services',d.services.map(s=>recordRow(s.name,`${money(s.price_pence)} / ${s.frequency} · renewal ${day(s.renews_on)}`,()=>edit('services',s),s.status)),'No services yet.',button('＋ Service',()=>edit('services',{account_id:a.id}),'quiet')));
  const details=el('dl',null,'detail-fields');for(const [label,value,href] of [['Email',a.email,a.email?'mailto:'+a.email:null],['Phone',a.phone,a.phone?'tel:'+a.phone:null],['Website',a.website,a.website],['Address',a.address],['Tags',tagText(a.tags)]])if(value)append(details,el('dt',label),append(el('dd'),href?link(value,href):el('span',value)));
  append(right,append(el('section',null,'panel'),append(el('header',null,'panel-header'),el('h2','Contact details')),append(el('div',null,'panel-body'),details,a.notes?el('p',a.notes,'note-body text-small'):null)));
  append(right,panel('People',d.contacts.map(c=>recordRow(c.name,[c.job_title,c.email,c.phone].filter(Boolean).join(' · '),()=>edit('contacts',c))),'No contacts added.',button('＋ Contact',()=>edit('contacts',{account_id:a.id}),'quiet')));
  append(right,panel('Enquiries',d.tickets.map(t=>recordRow(t.reference,t.subject,()=>location.assign(inboxLink(t.id)),t.status)),'No linked enquiries.'));
  append(right,panel('Activity timeline',activityTimeline(d),'No recorded activity.',button('＋ Log activity',()=>activity(a),'quiet')));
  append(fragment,append(el('div',null,'content-grid'),left,right));
  return fragment;
}

function showDialog(title,eyebrow='WORKSPACE') {if(!$('editor').open)state.dialogReturn=document.activeElement;state.dialogDirty=false;$('editor-title').textContent=title;$('editor-eyebrow').textContent=eyebrow;$('editor-content').replaceChildren();if(!$('editor').open)$('editor').showModal();return $('editor-content');}
function closeDialog(force=false) {if(!force&&state.dialogDirty&&!confirm('Close this form? A saved draft remains available when you reopen it.'))return;$('editor').close();state.dialogDirty=false;(state.dialogReturn?.isConnected?state.dialogReturn:$('main-content')).focus({preventScroll:true});}
function field(form,label,name,value='',type='text',options={}) {
  const wrap=el('label',label,'form-field'+(options.full?' full-width':''));let input;
  if(type==='select'){input=el('select');for(const option of options.options||[]){const o=el('option',option.label??option.name??option);o.value=option.value??option.id??option;input.append(o);}}
  else if(type==='textarea')input=el('textarea');else{input=el('input');input.type=type;}
  input.name=name;input.setAttribute('aria-label',label);input.value=value??'';if(options.required)input.required=true;if(options.max)input.maxLength=options.max;if(options.min!==undefined)input.min=options.min;if(options.step)input.step=options.step;
  append(wrap,input,options.hint?el('small',options.hint):null);form.append(wrap);return input;
}
function accountField(grid,value,required=true) {return field(grid,'Customer / business','account_id',value,'select',{required,options:[{value:'',label:required?'Choose a customer…':'General / no customer'},...state.options.accounts.map(a=>({value:a.id,label:a.name}))]});}
function relatedFields(grid,data,entity) {
  const account=grid.querySelector('[name=account_id]');if(!account)return;
  const definitions=entity==='opportunities'?[['Contact','contact_id','contacts','name'],['Enquiry','ticket_id','tickets','subject']]:entity==='quotes'?[['Opportunity','opportunity_id','opportunities','title'],['Enquiry for sending','ticket_id','tickets','subject']]:entity==='tasks'?[['Opportunity','opportunity_id','opportunities','title'],['Enquiry','ticket_id','tickets','subject']]:[];
  for(const [label,name,list,title] of definitions){const input=field(grid,label,name,data[name]||'','select',{options:[]});const populate=()=>{input.replaceChildren();const empty=el('option','None');empty.value='';input.append(empty);for(const row of state.options[list]||[])if(row.account_id===account.value||(name==='ticket_id'&&!row.account_id&&!account.value)){const o=el('option',row[title]);o.value=row.id;input.append(o);}input.value=data[name]||'';};populate();account.addEventListener('change',()=>{data[name]=null;populate();});}
}
function quickDates(input) {const actions=el('div',null,'quick-options');for(const [label,days] of [['Today',0],['Tomorrow',1],['3 days',3],['1 week',7],['2 weeks',14],['1 month',30],['3 months',90]])append(actions,button(label,()=>{const d=new Date(state.options.today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);input.value=d.toISOString().slice(0,10);input.dispatchEvent(new Event('input',{bubbles:true}));}));input.parentElement.append(actions);}
function amountValue(p){return ((p||0)/100).toFixed(2);}
function readPence(v){if(!/^\d{1,8}(\.\d{1,2})?$/.test(v.trim()))throw Error('Enter an amount with at most two decimal places.');const [whole,fraction='']=v.split('.');return Number(whole)*100+Number(fraction.padEnd(2,'0'));}
function quoteLine(container,item={}) {
  const row=el('div',null,'quote-line');
  const description=field(row,'Description','description',item.description||'','text',{required:true,max:500});description.parentElement.classList.add('description');
  field(row,'Quantity','quantity',item.quantity||1,'number',{required:true,min:1,step:'1'});
  field(row,'Unit price £ excl. VAT','unit',amountValue(item.unit_pence),'text',{required:true});
  field(row,'VAT %','vat',String((item.vat_bps||0)/100),'number',{min:0,step:'0.01'});
  field(row,'Frequency','frequency',item.frequency||'once','select',{options:[{value:'once',label:'One-off'},'monthly','quarterly','annual']});
  append(row,button('×',()=>{const form=row.closest('form');row.remove();state.dialogDirty=true;form?.dispatchEvent(new Event('input'));}));row.querySelector('button').setAttribute('aria-label','Remove quote item');container.append(row);
}
async function edit(entity,seed={}) {
  let data={...seed};if(entity==='quotes'&&seed.id&&!seed.items)data=await api('record?entity=quotes&id='+seed.id);
  const draftKey='form:'+entity+':'+(seed.id||'new:'+(seed.account_id||'general'));
  let draftVersion=0,restored=null,draftAvailable=true;
  try{const saved=await api('draft?key='+encodeURIComponent(draftKey));draftVersion=saved.version;if(saved.body){restored=JSON.parse(saved.body);data=restored.seed;}}catch{draftAvailable=false;}
  const content=showDialog((data.version?'Edit ':'New ')+singular[entity],names[entity]||'CUSTOMER DETAILS');
  if(['opportunities','quotes','services','contacts'].includes(entity)&&!state.options.accounts.length){append(content,el('p','Add a customer or business first. You can keep them as a prospect until work is won.','form-hint'),button('Add customer',()=>edit('accounts'),'primary'));return;}
  const form=el('form'),error=el('div',null,'form-error');error.hidden=true;error.setAttribute('role','alert');error.tabIndex=-1;
  const grid=el('div',null,'form-grid'),recordId=restored?.recordId||data.id||crypto.randomUUID();let lines;
  const draftNote=el('p',restored?'Your saved draft has been restored.':draftAvailable?'Drafts are saved privately as you type.':'Draft storage is unavailable. Keep this tab open until you save.','form-hint');draftNote.setAttribute('role','status');content.append(draftNote);
  if(entity==='accounts'){
    field(grid,'Business or customer name','name',data.name,'text',{required:true,max:160,full:true});field(grid,'Email','email',data.email,'email');field(grid,'Phone','phone',data.phone,'tel');field(grid,'Website','website',data.website,'url');field(grid,'Relationship','lifecycle',data.lifecycle||'prospect','select',{options:['prospect','customer','inactive']});field(grid,'Tags','tags',tagText(data.tags),'text',{hint:'Separate tags with commas, for example: Hosting, WordPress, High value.'});field(grid,'Address','address',data.address,'textarea',{full:true,max:1000});field(grid,'Important account notes','notes',data.notes,'textarea',{full:true,max:16000});
  }else if(entity==='contacts'){
    accountField(grid,data.account_id,false);field(grid,'Contact name','name',data.name,'text',{required:true,max:160});field(grid,'Email','email',data.email,'email');field(grid,'Phone','phone',data.phone,'tel');field(grid,'Job title','job_title',data.job_title);field(grid,'Tags','tags',tagText(data.tags),'text',{hint:'Separate tags with commas.'});field(grid,'Notes','notes',data.notes,'textarea',{full:true,max:16000});
  }else if(entity==='opportunities'){
    accountField(grid,data.account_id);field(grid,'Opportunity title','title',data.title,'text',{required:true,max:240});field(grid,'Service of interest','service',data.service);field(grid,'Lead source','source',data.source);field(grid,'Tags','tags',tagText(data.tags),'text',{hint:'Separate tags with commas.'});field(grid,'Stage','stage_id',data.stage_id||'new','select',{options:state.options.stages});field(grid,'Estimated one-off value £','value',amountValue(data.value_pence),'text',{required:true});field(grid,'Expected close date','expected_close',data.expected_close,'date');field(grid,'Outcome / lost reason','outcome_reason',data.outcome_reason);field(grid,'Next action','next_action','','text',{hint:'Required if there is no open task.'});quickDates(field(grid,'Next action date','next_date','','date'));field(grid,'Requirements and notes','notes',data.notes,'textarea',{full:true,max:16000});
    append(content,el('p','Keep communication status in the inbox. This stage describes the sale. Winning creates a customer; a lost opportunity needs a reason.','form-hint'));
  }else if(entity==='tasks'){
    field(grid,'What needs doing?','title',data.title,'text',{required:true,max:240,full:true});accountField(grid,data.account_id,false);field(grid,'Type','kind',data.kind||'followup','select',{options:['followup','call','meeting','onboarding','renewal','task']});const hasDue=data.due_date!==undefined&&data.due_date!==null&&data.due_date!=='';const due=field(grid,'Due date · Europe/London','due_date',hasDue?data.due_date:state.options.today,'date',{full:true});quickDates(due);const noDue=el('input');noDue.type='checkbox';noDue.name='no_due_date';noDue.checked=data.due_date!==undefined&&!hasDue;noDue.setAttribute('aria-label','No due date');const noDueLabel=el('label','No due date','form-field');noDueLabel.append(noDue);append(grid,noDueLabel);if(noDue.checked)due.value='';noDue.onchange=()=>{if(noDue.checked){due.value='';}else{due.value=state.options.today;}due.dispatchEvent(new Event('input',{bubbles:true}));};field(grid,'Priority','priority',data.priority||'normal','select',{options:['low','normal','high']});field(grid,'Status','status',data.status||'open','select',{options:['open','done','cancelled']});field(grid,'Details','description',data.description,'textarea',{full:true,max:8000});
  }else if(entity==='quotes'){
    accountField(grid,data.account_id);field(grid,'Quote title','title',data.title,'text',{required:true,max:240});quickDates(field(grid,'Valid until','expires_on',data.expires_on||addDays(state.options.today,30),'date',{required:true,full:true}));
    lines=el('div',null,'full-width');append(lines,el('h3','Line items'));for(const item of restored?Array.from({length:restored.fields.filter(([name])=>name==='description').length},()=>({})):data.items||[{description:'Website design',unit_pence:0,quantity:1}])quoteLine(lines,item);append(grid,lines,button('＋ Add item',()=>{quoteLine(lines);form.dispatchEvent(new Event('input'));},'quiet'));
    field(grid,'Proposal notes','notes',data.notes,'textarea',{full:true,max:4000});field(grid,'Terms','terms',data.terms,'textarea',{full:true,max:8000,hint:'Record the actual scope, payment terms and conditions agreed for this quote.'});
  }else if(entity==='services'){
    accountField(grid,data.account_id);field(grid,'Service name','name',data.name,'text',{required:true,max:240});field(grid,'Category','category',data.category);field(grid,'Contract price £ excl. VAT','price',amountValue(data.price_pence),'text',{required:true});field(grid,'Billing frequency','frequency',data.frequency||'monthly','select',{options:['monthly','quarterly','annual','once']});field(grid,'Status','status',data.status||'active','select',{options:['active','paused','cancelled']});field(grid,'Starts on','starts_on',data.starts_on||state.options.today,'date',{required:true});field(grid,'Renews on','renews_on',data.renews_on||addDays(state.options.today,30),'date');field(grid,'Ends on / cancellation effective date','ends_on',data.ends_on,'date');field(grid,'Cancellation reason','cancellation_reason',data.cancellation_reason);field(grid,'Service notes','notes',data.notes,'textarea',{full:true,max:8000});
    append(content,el('p','This records the customer’s contract. It does not charge them or change their hosting. Future cancellations stop revenue from their effective date.','form-hint'));
  }else if(entity==='enquiries'){
    field(grid,'Contact name','name','','text',{required:true,max:120});field(grid,'Business','company','');field(grid,'Email','email','','email');field(grid,'Phone','phone','','tel');field(grid,'Service','service','');field(grid,'Lead source','lead_source','manual','select',{options:[{value:'manual',label:'Other / manual'},{value:'phone',label:'Phone'},{value:'whatsapp',label:'WhatsApp'},{value:'referral',label:'Referral'},{value:'website',label:'Website'},{value:'website-cost-calculator',label:'Cost calculator'}]});field(grid,'Lead temperature','lead_temperature','warm','select',{options:['cold','warm','hot']});field(grid,'Subject','subject','New manual enquiry','text',{required:true});quickDates(field(grid,'First follow-up','due_date',state.options.today,'date',{required:true,full:true}));field(grid,'Enquiry / requirements','message','','textarea',{required:true,full:true,max:16000});
  }
  relatedFields(grid,data,entity);
  const submit=el('button',data.version?'Save changes':'Create '+singular[entity],'primary');submit.type='submit';
  append(form,error,grid,append(el('div',null,'form-actions'),button('Cancel',()=>closeDialog(),'quiet'),submit));content.append(form);
  if(restored){const fields=new Map();for(const [name,value] of restored.fields){if(!fields.has(name))fields.set(name,[]);fields.get(name).push(value);}const account=form.querySelector('[name=account_id]');if(account&&fields.has('account_id')){account.value=fields.get('account_id')[0];account.dispatchEvent(new Event('change'));}for(const input of form.querySelectorAll('input,textarea,select')){const values=fields.get(input.name);if(values?.length)input.value=values.shift();}}
  let draftTimer,writes=Promise.resolve(),disposed=false;
  const writeDraft=body=>{clearTimeout(draftTimer);writes=writes.catch(()=>{}).then(async()=>{if(!draftAvailable)return;const saved=await api('draft',{key:draftKey,body,request_key:recordId,version:draftVersion});draftVersion=saved.version;draftNote.textContent=body?'Draft saved privately.':'';}).catch(e=>{draftNote.textContent='Draft not saved: '+e.message;});return writes;};
  form.addEventListener('input',()=>{if(disposed)return;state.dialogDirty=true;clearTimeout(draftTimer);draftNote.textContent='Saving draft…';const snapshot=JSON.stringify({seed:data,recordId,fields:[...new FormData(form)]});draftTimer=setTimeout(()=>writeDraft(snapshot),650);});
  if(restored)content.append(button('Discard saved draft',async()=>{disposed=true;await writeDraft('');state.dialogDirty=false;closeDialog(true);edit(entity,seed);},'quiet'));
  let duplicateConfirmed=false;
  form.onsubmit=async event=>{
    event.preventDefault();if(submit.disabled)return;error.hidden=true;submit.disabled=true;
    try{
      const body={...data,...Object.fromEntries(new FormData(form)),id:recordId};
      if(entity==='tasks'){if(body.no_due_date)body.due_date='';delete body.no_due_date;}
      if(entity==='opportunities'){body.value_pence=readPence(body.value);delete body.value;}
      if(entity==='services'){body.price_pence=readPence(body.price);delete body.price;if(body.frequency==='once')body.renews_on=null;}
      if(entity==='quotes')body.items=[...lines.querySelectorAll('.quote-line')].map(row=>({description:row.querySelector('[name=description]').value,quantity:Number(row.querySelector('[name=quantity]').value),unit_pence:readPence(row.querySelector('[name=unit]').value),vat_bps:readPence(row.querySelector('[name=vat]').value||'0'),frequency:row.querySelector('[name=frequency]').value}));
      let saved;
      try{saved=await api(entity,body);}catch(e){
        if(['accounts','contacts'].includes(entity)&&!duplicateConfirmed&&e.message.startsWith('Possible duplicate')){
          if(!confirm(e.message+'\n\nCreate a separate customer record anyway?'))throw e;
          duplicateConfirmed=true;saved=await api(entity,{...body,allow_duplicate:true});
        }else throw e;
      }
      disposed=true;await writeDraft('');closeDialog(true);announce(singular[entity][0].toUpperCase()+singular[entity].slice(1)+' saved.');
      // A new manual lead has a clear destination. Redirect immediately instead
      // of waiting for the Today view to reload, which can race a slow API call.
      if(entity==='enquiries'){location.assign(inboxLink(saved.id));return;}
      await load();
    }catch(e){error.textContent=e.message;error.hidden=false;error.focus();}finally{submit.disabled=false;}
  };
  requestAnimationFrame(()=>form.querySelector('input,select,textarea')?.focus());
}
function addDays(value,n){const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}

async function showQuote(seed) {
  const q=await api('record?entity=quotes&id='+seed.id),account=q.snapshot?.customer||state.options.accounts.find(a=>a.id===q.account_id),content=showDialog(q.number,'QUOTE · REVISION '+q.revision),preview=el('article',null,'quote-preview');
  append(preview,el('div','NC Digital','quote-brand'),el('h2',q.title),el('p',account?.name||'Customer'),el('p',`${q.number} · Revision ${q.revision} · Valid until ${day(q.expires_on)}`,'muted'),badge(q.status));
  const table=el('table');append(table,append(el('thead'),append(el('tr'),['Description','Qty','Unit excl. VAT','VAT','Total'].map(h=>el('th',h)))));const tbody=el('tbody');for(const i of q.items)append(tbody,append(el('tr'),el('td',i.description+' · '+i.frequency),el('td',i.quantity),el('td',money(i.unit_pence)),el('td',i.vat_bps/100+'%'),el('td',money(i.total_pence))));table.append(tbody);preview.append(table);
  const totals=el('div',null,'quote-totals');for(const frequency of ['once','monthly','quarterly','annual']){const total=q.items.filter(i=>i.frequency===frequency).reduce((n,i)=>n+i.total_pence,0);if(total)append(totals,append(el('p'),el('span',frequency==='once'?'One-off total':frequency+' total'),el('strong',money(total))));}append(preview,totals,el('p','Totals include applicable VAT. Recurring charges are separate from one-off work.','muted'));if(q.notes)append(preview,el('h3','Proposal'),el('p',q.notes));if(q.terms)append(preview,el('h3','Terms'),el('p',q.terms));if(q.accepted_at)append(preview,el('h3','Acceptance recorded'),el('p',`${day(q.accepted_at)} · ${q.acceptance_note}`));
  const actions=el('div',null,'form-actions quote-actions');append(actions,button('Print / Save PDF',()=>window.print(),'quiet'));
  if(q.status==='draft')append(actions,button('Edit draft',()=>edit('quotes',q),'quiet'),button('Send via CRM',()=>quoteAction(q,'send'),'primary'),button('Record external send',()=>quoteAction(q,'sent_external'),'quiet'));
  if(q.status==='sent')append(actions,button('Record acceptance',()=>quoteAction(q,'accept'),'primary'),button('Record rejection',()=>quoteAction(q,'reject'),'quiet'));
  if(['accepted','rejected','expired','sent'].includes(q.status))append(actions,button('Duplicate as new draft',()=>{const copy={...q};delete copy.id;delete copy.version;delete copy.number;copy.expires_on=addDays(state.options.today,30);edit('quotes',copy);},'quiet'));
  if(q.status==='accepted')append(actions,button('Add agreed service',()=>edit('services',{account_id:q.account_id,quote_id:q.id}),'quiet'));
  append(content,preview,actions);
}
async function quoteAction(q,action) {
  let note='';if(action!=='send'){note=prompt({sent_external:'Where and when was this quote sent?',accept:'How did the customer accept this exact quote revision?',reject:'Why was the quote declined?'}[action]);if(!note?.trim())return;}
  if(!confirm(action==='send'?`Queue ${q.number} for the customer in its linked enquiry?`:`Record this ${action==='accept'?'acceptance':action==='reject'?'rejection':'send'} for ${q.number}, revision ${q.revision}?`))return;
  try{await api('quote-action',{id:q.id,version:q.version,action,confirmed:true,note});announce(action==='send'?'Quote queued. Check the inbox for provider acceptance.':'Quote outcome recorded.');await load();await showQuote(q);}catch(e){announce(e.message,true);const n=el('p',e.message,'form-error');n.setAttribute('role','alert');$('editor-content').prepend(n);}
}
function activity(account) {
  const content=showDialog('Log activity','CUSTOMER · '+account.name),form=el('form'),grid=el('div',null,'form-grid');field(grid,'Type','kind','note','select',{options:['note','call','meeting']});field(grid,'Pin to customer overview','pinned','0','select',{options:[{value:'0',label:'No'},{value:'1',label:'Yes'}]});field(grid,'Notes','body','','textarea',{full:true,required:true,max:16000});const save=el('button','Save activity','primary');save.type='submit';append(form,grid,append(el('div',null,'form-actions'),save));content.append(form);
  form.oninput=()=>{state.dialogDirty=true;};const activityId=crypto.randomUUID();form.onsubmit=async event=>{event.preventDefault();if(save.disabled)return;save.disabled=true;try{const body=Object.fromEntries(new FormData(form));body.pinned=body.pinned==='1';await api('activity',{...body,id:activityId,account_id:account.id});closeDialog(true);announce('Activity saved.');load();}catch(e){form.prepend(el('p',e.message,'form-error'));}finally{save.disabled=false;}};
}
async function archiveRecord(entity,item) {
  const restore=Boolean(item.archived_at);if(!confirm(`${restore?'Restore':'Archive'} ${item.name||item.title||'this record'}? ${restore?'It will return to active lists.':'It will leave active lists and can be restored from Archived.'}`))return;
  try{await api('archive',{entity,id:item.id,version:item.version,restore});announce(restore?'Record restored.':'Record archived. Use the Archived filter to restore it.');load();}catch(e){announce(e.message,true);}
}
async function exportCsv(entity) {
  if(!confirm('Export '+names[entity].toLowerCase()+'? The downloaded file contains customer information.'))return;
  try{const items=[];let after=null;do{const data=await api('export',{entity,after});items.push(...data.items);after=data.next;}while(after);if(!items.length){announce('No records to export.');return;}
    const columns=Object.keys(items[0]),csvValue=value=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};const csv=[columns.map(csvValue).join(','),...items.map(row=>columns.map(c=>csvValue(row[c])).join(','))].join('\r\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),a=link('',url);a.download=`nc-digital-${entity}-${state.options.today}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);announce(items.length+' records exported.');
  }catch(e){announce(e.message,true);}
}
function parseAccountCsv(source) {
  if(typeof source!=='string'||source.length>1000000)throw Error('CSV files must be smaller than 1 MB.');
  const rows=[],current=[];let value='',quoted=false;
  for(let i=0;i<source.length;i++){const char=source[i];if(quoted){if(char==='"'&&source[i+1]==='"'){value+='"';i++;}else if(char==='"')quoted=false;else value+=char;continue;}if(char==='"'&&value===''){quoted=true;continue;}if(char===','){current.push(value.trim());value='';continue;}if(char==='\n'||char==='\r'){if(char==='\r'&&source[i+1]==='\n')i++;current.push(value.trim());value='';if(current.some(cell=>cell))rows.push(current.splice(0));continue;}value+=char;}
  if(quoted)throw Error('The CSV has an unfinished quoted value.');current.push(value.trim());if(current.some(cell=>cell))rows.push(current);if(rows.length<2)throw Error('Add a header row and at least one customer row.');if(rows.length>201)throw Error('Import no more than 200 customer rows at a time.');
  const aliases={name:'name',business:'name',company:'name','business/customer':'name','customer':'name',email:'email','emailaddress':'email',phone:'phone','telephone':'phone',mobile:'phone',website:'website',url:'website',address:'address',lifecycle:'lifecycle',relationship:'lifecycle',tags:'tags',tag:'tags',notes:'notes'};
  const headers=rows.shift().map(header=>aliases[header.toLowerCase().replace(/[^a-z0-9/]/g,'')]);if(!headers.includes('name'))throw Error('The CSV needs a Name, Business or Company column.');
  return rows.map(cells=>{const row={};headers.forEach((header,index)=>{if(header&&!row[header])row[header]=cells[index]||'';});return row;});
}
async function importAccounts() {
  const content=showDialog('Import customers','CUSTOMERS / CSV IMPORT'),form=el('form'),intro=el('p','Upload a CSV with a name or business column. Email, phone and website duplicates are shown before anything is saved.','form-hint'),fileLabel=el('label','Customer CSV file','form-field'),file=el('input');file.type='file';file.accept='.csv,text/csv';file.required=true;file.setAttribute('aria-label','Customer CSV file');fileLabel.append(file);const status=el('p','Choose a CSV to review.','form-hint'),results=el('div',null,'import-results'),error=el('p',null,'form-error');error.hidden=true;error.setAttribute('role','alert');const review=el('button','Review rows','quiet');review.type='button';const submit=el('button','Import ready rows','primary');submit.type='submit';submit.disabled=true;append(form,intro,fileLabel,status,results,append(el('div',null,'form-actions'),button('Cancel',()=>closeDialog(),'quiet'),review,submit));content.append(form);
  let rows=null,preview=null;
  function renderPreview(){results.replaceChildren();if(!preview)return;status.textContent=`${preview.ready} ready · ${preview.duplicates} duplicate${preview.duplicates===1?'':'s'} · ${preview.invalid} invalid`;const table=el('table'),head=el('thead'),body=el('tbody');append(head,append(el('tr'),el('th','Row'),el('th','Name'),el('th','Email'),el('th','Status'),el('th','Details')));for(const item of preview.rows){const detail=item.issue||item.duplicate||'',statusCell=append(el('td'),badge(item.status));append(body,append(el('tr'),el('td',item.row),el('td',item.name||'—'),el('td',item.email||'—'),statusCell,el('td',detail)));}append(table,head,body);results.append(append(el('div',null,'table-wrap'),table));submit.disabled=preview.ready<1;}
  file.onchange=()=>{rows=null;preview=null;submit.disabled=true;status.textContent='Ready to review.';results.replaceChildren();error.hidden=true;};review.onclick=async()=>{error.hidden=true;review.disabled=true;try{if(!file.files?.[0])throw Error('Choose a CSV file first.');rows=parseAccountCsv(await file.files[0].text());preview=await api('import-accounts',{mode:'preview',rows});renderPreview();}catch(e){error.textContent=e.message;error.hidden=false;}finally{review.disabled=false;}};
  form.onsubmit=async event=>{event.preventDefault();if(submit.disabled||!preview?.ready)return;if(!confirm(`Import ${preview.ready} ready customer${preview.ready===1?'':'s'}? Duplicate and invalid rows will be skipped.`))return;submit.disabled=true;try{const result=await api('import-accounts',{mode:'commit',confirm:true,request_key:crypto.randomUUID(),rows});state.dialogDirty=false;closeDialog(true);announce(`${result.imported} customer${result.imported===1?'':'s'} imported. ${result.skipped} row${result.skipped===1?'':'s'} skipped.`);await load();}catch(e){error.textContent=e.message;error.hidden=false;submit.disabled=false;}};
  file.focus();
}
function quickAdd() {const content=showDialog('What would you like to add?','QUICK ADD'),menu=el('div',null,'add-menu');for(const [entity,description] of [['contacts','A person and their customer relationship'],['enquiries','A phone, referral or offline enquiry'],['accounts','A prospect or existing client'],['opportunities','A potential piece of work'],['tasks','A clear action and due date'],['quotes','A proposal for a customer'],['services','Hosting, maintenance or ongoing work']]){const b=button('',()=>edit(entity));append(b,el('strong','New '+singular[entity]),el('small',description));menu.append(b);}content.append(menu);}
async function search(event) {event?.preventDefault();const q=$('global-search').value.trim();if(q.length<2)return;try{const data=await api('search?q='+encodeURIComponent(q)),content=showDialog('Search results','WORKSPACE SEARCH');if(!data.items.length)content.append(el('p','No matching records.','empty'));for(const item of data.items)content.append(recordRow(item.title,`${item.entity} · ${item.detail||''}`,()=>{closeDialog(true);openRecord(item.entity,item.id,item.related_id);}));}catch(e){announce(e.message,true);}}
async function load() {
  const generation=++state.generation;state.controller?.abort();const controller=new AbortController();state.controller=controller;
  const p=params(),view=names[p.get('view')]?p.get('view'):'today';document.title=names[view]+' | NC Digital CRM';document.querySelectorAll('[data-view]').forEach(a=>{a.classList.toggle('active',a.dataset.view===view);if(a.dataset.view===view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  $('main-content').setAttribute('aria-busy','true');
  try{state.options=await api('options',null,controller.signal);const content=view==='today'?await renderToday(controller.signal):view==='health'?await renderHealth(controller.signal):view==='reports'?await renderReports(controller.signal):view==='accounts'&&p.get('id')?await renderAccount(p.get('id'),controller.signal):await renderList(view,p,controller.signal);if(generation!==state.generation)return;$('main-content').replaceChildren(content);}
  catch(e){if(e.name==='AbortError')return;$('main-content').replaceChildren(pageHeading('The workspace needs attention.',e.message),link('Open the enquiry inbox →',inboxLink()));announce(e.message,true);}
  finally{if(generation===state.generation)$('main-content').removeAttribute('aria-busy');}
}
$('quick-add').onclick=quickAdd;$('close-editor').onclick=()=>closeDialog();$('editor').addEventListener('cancel',event=>{event.preventDefault();closeDialog();});$('refresh-workspace').onclick=()=>load();$('global-search-form').onsubmit=search;
document.addEventListener('click',event=>{const a=event.target.closest('a');if(!a||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;const url=new URL(a.href);if(url.origin===location.origin&&url.pathname===location.pathname&&url.searchParams.has('view')){event.preventDefault();navigate(Object.fromEntries(url.searchParams));}});
addEventListener('popstate',load);addEventListener('beforeunload',event=>{if(state.dialogDirty){event.preventDefault();event.returnValue='';}});
addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();$('global-search').focus();}});
if(params().get('ticket'))location.replace(inboxLink(params().get('ticket')));else load();
