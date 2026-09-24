import { crmError, crmResponse, failure, readJson, sameOrigin, key, text, stateGet, enquiryHash } from './crm.js';
import { id, now, required, choice, integer, dateOnly, londonToday, plusDays, website, optionalEmail, phone, tags, revenue, ratioRound, record, mutation, checkVersion, auditStatement } from './crm-domain.js';
import { handleCommercial } from './crm-commercial.js';
import {mailboxHealth,retryImport,confirmSent} from './crm-health.js';
import {londonInstant} from './crm-dates.js';
import {runCloudBackup} from './crm-cloud-backup.js';

const TABLES={accounts:'crm_accounts',contacts:'crm_contacts',opportunities:'crm_opportunities',tasks:'crm_tasks',services:'crm_services',quotes:'crm_quotes'};
const VIEW_ENTITIES=['accounts','opportunities','tasks','quotes','services'];
export async function rows(db,sql,...args){return (await db.prepare(sql).bind(...args).all()).results;}

export async function insertRecord(db,table,values,actor,extras=[]) {
  const recordId=key(values.id),at=now(),columns=Object.keys(values);
  const differs=row=>columns.some(c=>!['stage_changed_at','completed_at'].includes(c)&&row[c]!==values[c]);
  const existing=await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(recordId).first();
  if(existing){if(differs(existing))throw crmError('This request was already used. Reload before making another change.',409);return existing;}
  try { await db.batch([
    db.prepare(`INSERT INTO ${table}(${columns.join(',')},created_at,updated_at) VALUES(${columns.map(()=>'?').join(',')},?,?)`).bind(...Object.values(values),at,at),
    db.prepare('INSERT OR IGNORE INTO crm_audit(id,actor,action,entity,entity_id,after_json,created_at) VALUES(?,?,?,?,?,?,?)').bind(`create:${table}:${recordId}`,actor,'created',table,recordId,JSON.stringify(values),at),
    ...extras,
  ]); } catch(error) {const winner=await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(recordId).first();if(!winner)throw error;if(differs(winner))throw crmError('This request was already used for different details.',409);return winner;}
  const saved=await record(db,table,recordId);
  if(differs(saved))throw crmError('This request was already used for different details.',409);
  return saved;
}

async function validateLinks(db,body) {
  const links={};
  for(const [field,table] of [['account_id','crm_accounts'],['contact_id','crm_contacts'],['opportunity_id','crm_opportunities'],['ticket_id','crm_tickets']]) {
    links[field]=body[field]?key(body[field]):null;
    if(links[field])await record(db,table,links[field]);
  }
  if(links.contact_id&&links.account_id){const c=await record(db,'crm_contacts',links.contact_id);if(c.account_id!==links.account_id)throw crmError('Contact belongs to a different customer.');}
  if(links.opportunity_id){const o=await record(db,'crm_opportunities',links.opportunity_id);if(links.account_id&&o.account_id!==links.account_id)throw crmError('Opportunity belongs to a different customer.');links.account_id=o.account_id;}
  if(links.ticket_id&&links.account_id){const t=await record(db,'crm_tickets',links.ticket_id);if(t.account_id&&t.account_id!==links.account_id)throw crmError('Enquiry belongs to a different customer.');}
  return links;
}

async function saveAccount(db,body,actor) {
  const values={name:required(body.name),email:optionalEmail(body.email),phone:phone(body.phone),website:website(body.website),address:text(body.address,1000),notes:text(body.notes,16000),tags:tags(body.tags),lifecycle:choice(body.lifecycle,['prospect','customer','inactive'],'prospect')};
  const existing=body.version!==undefined?await record(db,'crm_accounts',body.id):null;
  if(existing)checkVersion(existing,body);
  if(body.allow_duplicate!==true){
    const duplicate=await db.prepare(`SELECT name,email,phone,website FROM crm_accounts WHERE archived_at IS NULL AND id<>? AND ((?<>'' AND lower(email)=?) OR (?<>'' AND phone=?) OR (?<>'' AND lower(website)=?)) ORDER BY name LIMIT 5`).bind(existing?.id||'',values.email,values.email,values.phone,values.phone,values.website.toLowerCase(),values.website.toLowerCase()).all();
    if(duplicate.results.length){
      const matches=duplicate.results.map(row=>row.name||row.email||row.phone).join(', ');
      throw crmError(`Possible duplicate customer: ${matches}. Confirm that you want to keep separate records.`,409);
    }
  }
  if(existing)return mutation(db,'crm_accounts',existing,values,actor);
  return insertRecord(db,'crm_accounts',{id:key(body.id),...values},actor);
}

async function importAccounts(db,body,actor) {
  const mode=choice(body.mode,['preview','commit'],'preview');
  if(!Array.isArray(body.rows)||!body.rows.length||body.rows.length>200)throw crmError('Upload between 1 and 200 customer rows at a time.');
  if(mode==='commit'&&body.confirm!==true)throw crmError('Confirm the reviewed customer rows before importing.');
  const seen={email:new Set(),phone:new Set(),website:new Set()},prepared=[];
  for(let index=0;index<body.rows.length;index++){
    const row=body.rows[index]||{};let values,issue='',duplicate='';
    try{
      values={name:required(row.name,160,'Business/customer name'),email:optionalEmail(row.email),phone:phone(row.phone),website:website(row.website),address:text(row.address,1000),notes:text(row.notes,16000),tags:tags(row.tags),lifecycle:choice(row.lifecycle,['prospect','customer','inactive'],'prospect')};
      const duplicateRow=await db.prepare(`SELECT name,email,phone,website FROM crm_accounts WHERE archived_at IS NULL AND ((?<>'' AND lower(email)=?) OR (?<>'' AND phone=?) OR (?<>'' AND lower(website)=?)) ORDER BY name LIMIT 1`).bind(values.email,values.email,values.phone,values.phone,values.website.toLowerCase(),values.website.toLowerCase()).first();
      const inFile=(values.email&&seen.email.has(values.email))||(values.phone&&seen.phone.has(values.phone))||(values.website&&seen.website.has(values.website.toLowerCase()));
      if(duplicateRow||inFile){duplicate=duplicateRow?.name||'Another row in this file';}
      else {if(values.email)seen.email.add(values.email);if(values.phone)seen.phone.add(values.phone);if(values.website)seen.website.add(values.website.toLowerCase());}
    }catch(error){issue=error.publicMessage||'This row could not be validated.';}
    prepared.push({row:index+2,status:issue?'invalid':duplicate?'duplicate':'ready',name:values?.name||String(row.name||'').slice(0,160),email:values?.email||'',phone:values?.phone||'',website:values?.website||'',lifecycle:values?.lifecycle||'prospect',issue,duplicate,values});
  }
  if(mode==='preview')return {mode,rows:prepared.map(({values,...row})=>row),ready:prepared.filter(row=>row.status==='ready').length,duplicates:prepared.filter(row=>row.status==='duplicate').length,invalid:prepared.filter(row=>row.status==='invalid').length};
  const requestKey=key(body.request_key),at=now(),statements=[],committed=[];
  for(const row of prepared.filter(item=>item.status==='ready')){
    const accountId='import-'+requestKey+'-'+row.row;
    const existing=await db.prepare('SELECT id FROM crm_accounts WHERE id=?').bind(accountId).first();if(existing)continue;
    const v=row.values;statements.push(db.prepare('INSERT INTO crm_accounts(id,name,email,phone,website,address,tags,lifecycle,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(accountId,v.name,v.email,v.phone,v.website,v.address,v.tags,v.lifecycle,v.notes,at,at));statements.push(db.prepare('INSERT INTO crm_audit(id,actor,action,entity,entity_id,after_json,created_at) VALUES(?,?,?,?,?,?,?)').bind('import-audit-'+accountId,actor,'created','crm_accounts',accountId,JSON.stringify(v),at));committed.push(accountId);
  }
  if(statements.length)await db.batch(statements);
  return {mode,imported:committed.length,skipped:prepared.length-committed.length,rows:prepared.map(({values,...row})=>row)};
}
async function saveContact(db,body,actor) {
  const links=await validateLinks(db,body);
  const values={account_id:links.account_id,name:required(body.name),email:optionalEmail(body.email),phone:phone(body.phone),job_title:text(body.job_title,160),notes:text(body.notes,16000),tags:tags(body.tags)};
  if(!values.email&&!values.phone)throw crmError('Add an email address or phone number.');
  const existing=body.version!==undefined?await record(db,'crm_contacts',body.id):null;
  if(existing)checkVersion(existing,body);
  if(body.allow_duplicate!==true&&links.account_id){
    const duplicate=await db.prepare(`SELECT name,email,phone FROM crm_contacts WHERE archived_at IS NULL AND account_id=? AND id<>? AND ((?<>'' AND lower(email)=?) OR (?<>'' AND phone=?)) ORDER BY name LIMIT 5`).bind(links.account_id,existing?.id||'',values.email,values.email,values.phone,values.phone).all();
    if(duplicate.results.length){
      const matches=duplicate.results.map(row=>row.name||row.email||row.phone).join(', ');
      throw crmError(`Possible duplicate contact in this customer: ${matches}. Confirm that you want to keep separate records.`,409);
    }
  }
  if(existing)return mutation(db,'crm_contacts',existing,values,actor);
  return insertRecord(db,'crm_contacts',{id:key(body.id),...values},actor);
}
async function saveTask(db,body,actor) {
  const links=await validateLinks(db,body);
  const status=choice(body.status,['open','done','cancelled'],'open');
  const values={title:required(body.title,240,'Task'),description:text(body.description,8000),account_id:links.account_id,opportunity_id:links.opportunity_id,ticket_id:links.ticket_id,
    owner:'nathan',kind:choice(body.kind,['followup','call','meeting','onboarding','renewal','task'],'followup'),priority:choice(body.priority,['low','normal','high'],'normal'),due_date:dateOnly(body.due_date,true),status,completed_at:status==='done'?now():null};
  if(body.version!==undefined){const old=await record(db,'crm_tasks',body.id);checkVersion(old,body);if(status===old.status)values.completed_at=old.completed_at;return mutation(db,'crm_tasks',old,values,actor,status==='done'?'completed':'updated');}
  return insertRecord(db,'crm_tasks',{id:key(body.id),...values},actor);
}
async function saveOpportunity(db,body,actor) {
  const links=await validateLinks(db,body);if(!links.account_id)throw crmError('Choose a customer or business.');
  const stage=await db.prepare('SELECT * FROM crm_stages WHERE id=? AND archived_at IS NULL').bind(text(body.stage_id,80)||'new').first();if(!stage)throw crmError('Choose an available stage.');
  const reason=text(body.outcome_reason,1000);
  if(stage.outcome==='lost'&&!reason)throw crmError('Record why this opportunity was lost.');
  const taskTitle=text(body.next_action,240),taskDue=body.next_date?dateOnly(body.next_date):null;
  const previous=body.version!==undefined?await record(db,'crm_opportunities',body.id):null;
  if(previous)checkVersion(previous,body);
  const openTask=previous?await db.prepare("SELECT id FROM crm_tasks WHERE opportunity_id=? AND status='open' AND archived_at IS NULL").bind(previous.id).first():null;
  if(['open','future'].includes(stage.outcome)&&!openTask&&(!taskTitle||!taskDue))throw crmError('Add a next action and date so this opportunity is not forgotten.');
  const at=now(),values={account_id:links.account_id,contact_id:links.contact_id,ticket_id:links.ticket_id,title:required(body.title,240,'Opportunity title'),service:text(body.service,180),source:text(body.source,180),tags:tags(body.tags),stage_id:stage.id,owner:'nathan',value_pence:integer(body.value_pence??0),expected_close:dateOnly(body.expected_close,true),outcome_reason:reason,notes:text(body.notes,16000),stage_changed_at:previous?.stage_id===stage.id?previous.stage_changed_at:at,won_at:stage.outcome==='won'?(previous?.won_at||at):null,lost_at:stage.outcome==='lost'?(previous?.lost_at||at):null};
  const opportunityId=key(body.id),taskId='next-'+opportunityId+'-'+(previous?.version||0);
  const taskInsert=guard=>db.prepare(`INSERT OR IGNORE INTO crm_tasks(id,title,account_id,opportunity_id,ticket_id,due_date,external_key,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,? ${guard?'WHERE EXISTS(SELECT 1 FROM crm_audit WHERE id=?)':''}`).bind(taskId,taskTitle,links.account_id,opportunityId,links.ticket_id,taskDue,taskId,at,at,...(guard?[guard]:[]));
  let saved;
  if(previous){const extras=[];
    if(taskTitle&&taskDue)extras.push(auditId=>taskInsert(auditId));
    if(stage.outcome==='won')extras.push(auditId=>db.prepare("UPDATE crm_accounts SET lifecycle='customer',version=version+1,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM crm_audit WHERE id=?)").bind(at,links.account_id,auditId));
    if(['won','lost'].includes(stage.outcome))extras.push(auditId=>db.prepare("UPDATE crm_tasks SET status='cancelled',version=version+1,updated_at=? WHERE opportunity_id=? AND status='open' AND kind='followup' AND EXISTS(SELECT 1 FROM crm_audit WHERE id=?)").bind(at,opportunityId,auditId));
    saved=await mutation(db,'crm_opportunities',previous,values,actor,previous.stage_id!==stage.id?'stage changed':'updated',extras);
  }else{
    if(stage.outcome!=='open')throw crmError('Create the opportunity in an open stage first.');
    saved=await insertRecord(db,'crm_opportunities',{id:opportunityId,...values},actor,[taskInsert(null)]);
  }
  return saved;
}

async function saveStage(db,body,actor) {
  const stageId=text(body.id,80);
  if(!stageId)throw crmError('Choose a pipeline stage.');
  const stage=await db.prepare('SELECT * FROM crm_stages WHERE id=? AND archived_at IS NULL').bind(stageId).first();
  if(!stage)throw crmError('Pipeline stage not found.',404);
  checkVersion(stage,body);
  const name=required(body.name,80,'Stage name'),position=integer(body.position,1,10000),probability=integer(body.probability,0,100);
  const duplicate=await db.prepare('SELECT id FROM crm_stages WHERE archived_at IS NULL AND id<>? AND lower(name)=lower(?)').bind(stage.id,name).first();
  if(duplicate)throw crmError('Each pipeline stage needs a unique name.');
  const values={name,position,probability};
  if(stage.name===name&&stage.position===position&&stage.probability===probability)return stage;
  const at=now(),auditId=id(),after={...stage,...values,version:stage.version+1};
  const result=await db.batch([
    db.prepare('INSERT INTO crm_audit(id,actor,action,entity,entity_id,before_json,after_json,created_at) SELECT ?,?,?,?,?,?,?,? FROM crm_stages WHERE id=? AND version=?').bind(auditId,actor,'updated','crm_stages',stage.id,JSON.stringify(stage),JSON.stringify(after),at,stage.id,stage.version),
    db.prepare('UPDATE crm_stages SET name=?,position=?,probability=?,version=version+1 WHERE id=? AND version=?').bind(name,position,probability,stage.id,stage.version),
  ]);
  if(!result[1].meta.changes)throw crmError('This stage changed in another tab. Reload the pipeline before saving.',409);
  return (await db.prepare('SELECT * FROM crm_stages WHERE id=?').bind(stage.id).first());
}

function savedViewQuery(entity,value) {
  const allowed={
    accounts:['q','lifecycle','tag','archived'],
    opportunities:['q','account_id','stage_id','service','source','tag','close_by','sort','layout','archived'],
    tasks:['q','status','kind','account_id','undated','due_from','due','archived'],
    quotes:['q','status','account_id','archived'],
    services:['q','status','account_id','archived'],
  }[entity];
  const query=text(value,1600),params=new URLSearchParams(query);
  for(const [name,part] of params){
    if(!allowed.includes(name)||part.length>300)throw crmError('Saved view contains an unsupported filter.');
  }
  return params.toString();
}

async function saveView(db,body,actor) {
  if(await stateGet(db,'saved_views_schema')!=='1')throw crmError('Saved views need the database upgrade before they can be saved.',503);
  const entity=choice(body.entity,VIEW_ENTITIES),name=required(body.name,80,'Saved view name'),query=savedViewQuery(entity,body.query);
  const viewId=body.id?text(body.id,80):id(),existing=body.id?await record(db,'crm_saved_views',viewId,true):null;
  if(existing){if(existing.owner!==actor)throw crmError('Saved view not found.',404);checkVersion(existing,body);}
  const duplicate=await db.prepare('SELECT id FROM crm_saved_views WHERE owner=? AND entity=? AND archived_at IS NULL AND lower(name)=lower(?) AND id<>?').bind(actor,entity,name,viewId).first();
  if(duplicate)throw crmError('A saved view with this name already exists for this list.',409);
  const values={owner:actor,entity,name,query,archived_at:null};
  if(existing)return mutation(db,'crm_saved_views',existing,values,actor,'saved view updated');
  return insertRecord(db,'crm_saved_views',{id:viewId,...values},actor);
}

async function accountDetail(db,accountId) {
  const account=await record(db,'crm_accounts',accountId,true);
  const [contacts,opportunities,tasks,services,quotes,activities,tickets]=await Promise.all([
    rows(db,'SELECT * FROM crm_contacts WHERE account_id=? AND archived_at IS NULL ORDER BY name LIMIT 200',account.id),
    rows(db,'SELECT o.*,s.name AS stage_name,s.outcome FROM crm_opportunities o JOIN crm_stages s ON s.id=o.stage_id WHERE account_id=? AND o.archived_at IS NULL ORDER BY o.updated_at DESC LIMIT 100',account.id),
    rows(db,'SELECT * FROM crm_tasks WHERE account_id=? AND archived_at IS NULL ORDER BY status,due_date LIMIT 100',account.id),
    rows(db,'SELECT * FROM crm_services WHERE account_id=? AND archived_at IS NULL ORDER BY status,renews_on LIMIT 100',account.id),
    rows(db,'SELECT * FROM crm_quotes WHERE account_id=? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 100',account.id),
    rows(db,'SELECT * FROM crm_activities WHERE account_id=? ORDER BY pinned DESC,created_at DESC LIMIT 100',account.id),
    rows(db,'SELECT id,reference,subject,status,email,updated_at,job_id FROM crm_tickets WHERE account_id=? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 100',account.id),
  ]);
  const messages=await rows(db,"SELECT m.id,m.ticket_id,m.kind,m.author,m.body,m.delivery,m.created_at FROM crm_messages m JOIN crm_tickets t ON t.id=m.ticket_id WHERE t.account_id=? AND m.kind IN ('inbound','outbound','note','confirmation') ORDER BY m.created_at DESC LIMIT 100",account.id);
  // Keep each related-record lookup as a separate IN subquery. D1's SQLite
  // runtime has a lower compound-SELECT limit than local SQLite, so a UNION
  // chain here can make an otherwise valid account detail request fail.
  const audit=await rows(db,`SELECT id,actor,action,entity,entity_id,before_json,after_json,created_at FROM crm_audit WHERE entity_id=?
    OR entity_id IN (SELECT id FROM crm_contacts WHERE account_id=?)
    OR entity_id IN (SELECT id FROM crm_opportunities WHERE account_id=?)
    OR entity_id IN (SELECT id FROM crm_tasks WHERE account_id=?)
    OR entity_id IN (SELECT id FROM crm_services WHERE account_id=?)
    OR entity_id IN (SELECT id FROM crm_quotes WHERE account_id=?)
    OR entity_id IN (SELECT id FROM crm_tickets WHERE account_id=?)
    OR entity_id IN (SELECT m.id FROM crm_messages m JOIN crm_tickets t ON t.id=m.ticket_id WHERE t.account_id=?)
    ORDER BY created_at DESC LIMIT 100`,account.id,account.id,account.id,account.id,account.id,account.id,account.id,account.id);
  return {account,contacts,opportunities,tasks,services,quotes,activities,tickets,messages,audit,revenue:revenue(services)};
}

async function listRecords(db,type,url) {
  const table=TABLES[type];if(!table)throw crmError('Unknown list.',404);
  const page=Math.min(10000,Math.max(0,Math.floor(Number(url.searchParams.get('page'))||0)));
  const q=text(url.searchParams.get('q'),120),archived=url.searchParams.get('archived')==='true';
  const where=[`r.archived_at IS ${archived?'NOT ':''}NULL`],args=[];
  if(q){const fields={accounts:['name','email','phone','website','tags'],contacts:['name','email','phone','tags'],opportunities:['title','service','source','tags'],tasks:['title','description'],services:['name','category'],quotes:['title','number']}[type];where.push('('+fields.map(f=>`r.${f} LIKE ? ESCAPE '\\'`).join(' OR ')+')');args.push(...fields.map(()=>'%'+q.replace(/[\%_]/g,'\\$&')+'%'));}
  for(const f of ['account_id','status','stage_id']){const value=url.searchParams.get(f);if(value&&((f==='account_id'&&type!=='accounts')||(f==='status'&&['tasks','quotes','services'].includes(type))||(f==='stage_id'&&type==='opportunities'))){where.push(`r.${f}=?`);args.push(value);}}
  if(type==='tasks'){const kind=url.searchParams.get('kind');if(['followup','call','meeting','onboarding','renewal','task'].includes(kind)){where.push('r.kind=?');args.push(kind);}}
  if(type==='accounts'){const lifecycle=url.searchParams.get('lifecycle');if(['prospect','customer','inactive'].includes(lifecycle)){where.push('r.lifecycle=?');args.push(lifecycle);}}
  if(['accounts','contacts','opportunities'].includes(type)){const tag=text(url.searchParams.get('tag'),40);if(tag){where.push("lower(r.tags) LIKE ? ESCAPE '\\'");args.push('%"'+tag.toLowerCase().replace(/[\\%_]/g,'\\$&')+'"%');}}
  if(type==='opportunities')for(const f of ['service','source']){const value=text(url.searchParams.get(f),180);if(value){where.push(`r.${f} LIKE ? ESCAPE '\\'`);args.push('%'+value.replace(/[\\%_]/g,'\\$&')+'%');}}
  if(type==='opportunities'&&url.searchParams.get('close_by')){where.push('r.expected_close IS NOT NULL AND r.expected_close<=?');args.push(dateOnly(url.searchParams.get('close_by')));}
  if(type==='tasks'&&url.searchParams.get('undated')==='true')where.push('r.due_date IS NULL');
  if(type==='tasks'&&url.searchParams.get('due_from')){where.push('r.due_date>=?');args.push(dateOnly(url.searchParams.get('due_from')));}
  if(type==='tasks'&&url.searchParams.get('due')){where.push('r.due_date<=?');args.push(dateOnly(url.searchParams.get('due')));}
  const join=type==='opportunities'?' LEFT JOIN crm_stages s ON s.id=r.stage_id':'';
  const projection=type==='opportunities'?',s.name AS stage_name,s.probability,s.outcome':type!=='accounts'&&type!=='contacts'?',a.name AS account_name':'';
  const accountJoin=type!=='accounts'&&type!=='contacts'?' LEFT JOIN crm_accounts a ON a.id=r.account_id':'';
  let order=type==='tasks'?'r.status,r.due_date,r.id':type==='accounts'?'r.name COLLATE NOCASE,r.id':'r.updated_at DESC,r.id DESC';
  if(type==='opportunities'){const sort=url.searchParams.get('sort');if(sort==='value')order='r.value_pence DESC,r.updated_at DESC,r.id DESC';else if(sort==='close')order='CASE WHEN r.expected_close IS NULL THEN 1 ELSE 0 END,r.expected_close ASC,r.updated_at DESC,r.id DESC';}
  const [items,total]=await Promise.all([rows(db,`SELECT r.*${projection} FROM ${table} r${join}${accountJoin} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 50 OFFSET ?`,...args,page*50),db.prepare(`SELECT COUNT(*) AS count FROM ${table} r WHERE ${where.join(' AND ')}`).bind(...args).first()]);
  return {items,total:total.count,page};
}

async function reportsView(db,url) {
  const today=londonToday(),from=dateOnly(url.searchParams.get('from')||plusDays(today,-30)),to=dateOnly(url.searchParams.get('to')||today);
  if(from>to)throw crmError('The report start date must be on or before the end date.');
  const start=londonInstant(from+'T00:00'),end=londonInstant(plusDays(to,1)+'T00:00');
  const [leads,leadByStatus,leadByService,leadSources,opportunities,opportunityByStage,quotes,quoteByStatus,activities,services]=await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM crm_tickets WHERE archived_at IS NULL AND status<>'spam' AND created_at>=? AND created_at<?").bind(start,end).first(),
    rows(db,"SELECT status,COUNT(*) AS count FROM crm_tickets WHERE archived_at IS NULL AND status<>'spam' AND created_at>=? AND created_at<? GROUP BY status ORDER BY count DESC",start,end),
    rows(db,"SELECT COALESCE(NULLIF(service,''),'Unspecified') AS label,COUNT(*) AS count FROM crm_tickets WHERE archived_at IS NULL AND status<>'spam' AND created_at>=? AND created_at<? GROUP BY label ORDER BY count DESC LIMIT 20",start,end),
    rows(db,"SELECT source_page,metadata FROM crm_tickets WHERE archived_at IS NULL AND status<>'spam' AND created_at>=? AND created_at<?",start,end),
    db.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(CASE WHEN s.outcome='open' THEN o.value_pence ELSE 0 END),0) AS open_value_pence,COALESCE(SUM(CASE WHEN s.outcome='won' THEN o.value_pence ELSE 0 END),0) AS won_value_pence,COALESCE(SUM(CASE WHEN s.outcome='lost' THEN o.value_pence ELSE 0 END),0) AS lost_value_pence FROM crm_opportunities o JOIN crm_stages s ON s.id=o.stage_id WHERE o.archived_at IS NULL AND o.created_at>=? AND o.created_at<?").bind(start,end).first(),
    rows(db,"SELECT s.name AS label,s.outcome,COUNT(o.id) AS count,COALESCE(SUM(o.value_pence),0) AS value_pence FROM crm_stages s LEFT JOIN crm_opportunities o ON o.stage_id=s.id AND o.archived_at IS NULL AND o.created_at>=? AND o.created_at<? WHERE s.archived_at IS NULL GROUP BY s.id ORDER BY s.position",start,end),
    db.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(total_pence),0) AS value_pence FROM crm_quotes WHERE archived_at IS NULL AND created_at>=? AND created_at<?").bind(start,end).first(),
    rows(db,"SELECT status,COUNT(*) AS count,COALESCE(SUM(total_pence),0) AS value_pence FROM crm_quotes WHERE archived_at IS NULL AND created_at>=? AND created_at<? GROUP BY status ORDER BY count DESC",start,end),
    db.prepare('SELECT COUNT(*) AS count FROM crm_activities WHERE created_at>=? AND created_at<?').bind(start,end).first(),
    rows(db,'SELECT account_id,price_pence,frequency,starts_on,ends_on,status,archived_at FROM crm_services WHERE archived_at IS NULL'),
  ]);
  const sourceCounts=new Map();
  for(const lead of leadSources){let metadata={};try{metadata=JSON.parse(lead.metadata||'{}');}catch{}const label=metadata.lead_source||lead.source_page||'Other';sourceCounts.set(label,(sourceCounts.get(label)||0)+1);}
  const bySource=[...sourceCounts].map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label)).slice(0,20);
  const won=Number(opportunities.won_value_pence||0),lost=Number(opportunities.lost_value_pence||0),decidedCount=Number((leadByStatus.find(row=>row.status==='closed')||{}).count||0);
  return {from,to,leads:{count:Number(leads.count||0),by_status:leadByStatus,by_service:leadByService,by_source:bySource},opportunities:{count:Number(opportunities.count||0),open_value_pence:Number(opportunities.open_value_pence||0),won_value_pence:won,lost_value_pence:lost,by_stage:opportunityByStage,win_rate:won+lost?Math.round(won/(won+lost)*100):0},quotes:{count:Number(quotes.count||0),value_pence:Number(quotes.value_pence||0),by_status:quoteByStatus},activities:Number(activities.count||0),revenue:revenue(services,today),decided_leads:decidedCount};
}

async function todayView(db) {
  const today=londonToday(),soon=plusDays(today,30),staleBefore=plusDays(today,-14)+'T00:00:00.000Z';
  const [tasks,enquiries,noAction,stale,renewals,quotes,services,pipeline,health]=await Promise.all([
    rows(db,"SELECT t.*,a.name AS account_name FROM crm_tasks t LEFT JOIN crm_accounts a ON a.id=t.account_id WHERE t.status='open' AND t.archived_at IS NULL ORDER BY t.due_date,t.id LIMIT 100"),
    rows(db,"SELECT id,name,email,subject,status,service,source_page,metadata,updated_at FROM crm_tickets WHERE archived_at IS NULL AND status IN ('new','open') ORDER BY last_inbound_at DESC LIMIT 30"),
    rows(db,"SELECT o.*,a.name AS account_name FROM crm_opportunities o JOIN crm_accounts a ON a.id=o.account_id JOIN crm_stages s ON s.id=o.stage_id WHERE o.archived_at IS NULL AND s.outcome IN ('open','future') AND o.updated_at>=? AND NOT EXISTS(SELECT 1 FROM crm_tasks t WHERE t.opportunity_id=o.id AND t.status='open' AND t.archived_at IS NULL) ORDER BY o.updated_at LIMIT 30",staleBefore),
    rows(db,"SELECT o.*,a.name AS account_name,s.name AS stage_name FROM crm_opportunities o JOIN crm_accounts a ON a.id=o.account_id JOIN crm_stages s ON s.id=o.stage_id WHERE o.archived_at IS NULL AND s.outcome IN ('open','future') AND o.updated_at<? AND NOT EXISTS(SELECT 1 FROM crm_tasks t WHERE t.opportunity_id=o.id AND t.status='open' AND t.archived_at IS NULL) ORDER BY o.updated_at LIMIT 30",staleBefore),
    rows(db,"SELECT s.*,a.name AS account_name FROM crm_services s JOIN crm_accounts a ON a.id=s.account_id WHERE s.archived_at IS NULL AND s.status='active' AND s.renews_on<=? AND (s.ends_on IS NULL OR s.ends_on>s.renews_on) ORDER BY s.renews_on LIMIT 30",soon),
    rows(db,"SELECT q.*,a.name AS account_name FROM crm_quotes q JOIN crm_accounts a ON a.id=q.account_id WHERE q.archived_at IS NULL AND q.status IN ('queued','sent') ORDER BY q.expires_on LIMIT 30"),
    rows(db,"SELECT account_id,price_pence,frequency,starts_on,ends_on,status,archived_at FROM crm_services WHERE archived_at IS NULL"),
    rows(db,"SELECT s.id,s.name,s.position,s.outcome,s.probability,COUNT(o.id) AS count,COALESCE(SUM(o.value_pence),0) AS value_pence FROM crm_stages s LEFT JOIN crm_opportunities o ON o.stage_id=s.id AND o.archived_at IS NULL WHERE s.archived_at IS NULL GROUP BY s.id ORDER BY s.position"),
    rows(db,"SELECT delivery,COUNT(*) AS count,MIN(created_at) AS oldest FROM crm_messages WHERE kind IN ('outbound','notification','confirmation') AND delivery IN ('queued','sending','failed','unknown') GROUP BY delivery"),
  ]);
  const weightedPipelinePence=pipeline.filter(stage=>stage.outcome==='open').reduce((sum,stage)=>sum+ratioRound(Number(stage.value_pence||0),Number(stage.probability||0),100),0);
  return {today,tasks,enquiries,no_action:noAction,stale,renewals,quotes,revenue:revenue(services,today),pipeline,weighted_pipeline_pence:weightedPipelinePence,health,last_sync:await stateGet(db,'last_sync'),sync_error:await stateGet(db,'sync_error'),last_send_check:await stateGet(db,'last_send_check')};
}

async function archive(db,body,actor) {
  const table=TABLES[body.entity]||(body.entity==='tickets'?'crm_tickets':null);if(!table)throw crmError('This record cannot be archived.');
  const row=await record(db,table,body.id,true);checkVersion(row,body);
  if(typeof body.restore!=='boolean')throw crmError('Choose archive or restore.');
  if(!body.restore&&body.entity==='accounts'){
    const live=await db.prepare("SELECT (SELECT COUNT(*) FROM crm_opportunities o JOIN crm_stages s ON s.id=o.stage_id WHERE o.account_id=? AND o.archived_at IS NULL AND s.outcome IN ('open','future'))+(SELECT COUNT(*) FROM crm_services WHERE account_id=? AND archived_at IS NULL AND status IN ('active','paused'))+(SELECT COUNT(*) FROM crm_tasks WHERE account_id=? AND archived_at IS NULL AND status='open') AS count").bind(row.id,row.id,row.id).first();
    if(live.count)throw crmError('Resolve open opportunities, tasks and services before archiving this customer.',409);
  }
  if(!body.restore&&body.entity==='services'&&row.status!=='cancelled')throw crmError('Cancel this service before archiving it.',409);
  if(!body.restore&&body.entity==='quotes'&&['queued','sent','accepted'].includes(row.status))throw crmError('Keep issued quotes with the customer history.',409);
  if(body.restore&&row.account_id)await record(db,'crm_accounts',row.account_id);
  const extra=[];
  if(body.entity==='tickets'&&!body.restore)extra.push(auditId=>db.prepare("UPDATE crm_messages SET delivery='cancelled',updated_at=? WHERE ticket_id=? AND delivery IN ('queued','failed') AND EXISTS(SELECT 1 FROM crm_audit WHERE id=?)").bind(now(),row.id,auditId));
  return mutation(db,table,row,{archived_at:body.restore?null:now()},actor,body.restore?'restored':'archived',extra);
}

async function bulkCompleteTasks(db,body,actor) {
  if(body.entity!=='tasks'||body.action!=='complete')throw crmError('That bulk action is not available for this list.');
  if(!Array.isArray(body.records)||body.records.length<1||body.records.length>50)throw crmError('Choose between 1 and 50 tasks.');
  const records=[],seen=new Set();
  for(const input of body.records){
    if(!input||typeof input!=='object')throw crmError('Each selected task needs its current version.');
    const taskId=key(input.id);if(seen.has(taskId))throw crmError('A task was selected more than once.');seen.add(taskId);
    const task=await record(db,'crm_tasks',taskId);checkVersion(task,input);if(task.status!=='open')throw crmError('Only open tasks can be completed in bulk.',409);records.push(task);
  }
  const at=now(),statements=[];
  for(const task of records){
    const auditId=id(),after={...task,status:'done',completed_at:at,version:task.version+1,updated_at:at};
    statements.push(db.prepare('INSERT INTO crm_audit(id,actor,action,entity,entity_id,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(auditId,actor,'completed','crm_tasks',task.id,JSON.stringify(task),JSON.stringify(after),at));
    statements.push(db.prepare("UPDATE crm_tasks SET status='done',completed_at=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status='open'").bind(at,at,task.id,task.version));
  }
  const result=await db.batch(statements);for(let index=1;index<result.length;index+=2)if(!result[index].meta.changes)throw crmError('A task changed in another tab. Reload the list before completing it.',409);
  return {updated:records.length};
}

async function linkTicket(db,body,actor) {
  const ticket=await record(db,'crm_tickets',body.ticket_id);checkVersion(ticket,body);
  if(ticket.account_id)throw crmError('This enquiry is already linked to a customer.',409);
  let accountId=body.account_id?key(body.account_id):'account-'+ticket.id;
  if(body.account_id)await record(db,'crm_accounts',accountId);
  const at=now(),contactId='contact-'+ticket.id,auditId=id();
  const statements=[db.prepare('INSERT INTO crm_audit(id,actor,action,entity,entity_id,created_at) SELECT ?,?,?,?,?,? FROM crm_tickets WHERE id=? AND version=?').bind(auditId,actor,'linked customer','crm_tickets',ticket.id,at,ticket.id,ticket.version)];
  if(!body.account_id)statements.push(db.prepare("INSERT OR IGNORE INTO crm_accounts(id,name,email,phone,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM crm_audit WHERE id=?)").bind(accountId,ticket.company||ticket.name,ticket.email,phone(ticket.phone),at,at,auditId));
  statements.push(db.prepare('INSERT OR IGNORE INTO crm_contacts(id,account_id,name,email,phone,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM crm_audit WHERE id=?)').bind(contactId,accountId,ticket.name,ticket.email,phone(ticket.phone),at,at,auditId));
  statements.push(db.prepare('UPDATE crm_tickets SET account_id=?,contact_id=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(accountId,contactId,at,ticket.id,ticket.version));
  const ticketUpdateIndex=statements.length-1;
  statements.push(db.prepare('UPDATE crm_tasks SET account_id=?,version=version+1,updated_at=? WHERE ticket_id=? AND account_id IS NULL AND EXISTS(SELECT 1 FROM crm_audit WHERE id=?)').bind(accountId,at,ticket.id,auditId));
  const result=await db.batch(statements);if(!result[ticketUpdateIndex].meta.changes)throw crmError('Enquiry changed. Reload before linking.',409);
  return {account_id:accountId,contact_id:contactId};
}

export async function handleWorkspace(request,env,actor) {
  try {
    if(actor!=='nathan')throw crmError('CRM access is restricted to Nathan.',403);
    const db=env.JOBS_DB,url=new URL(request.url),route=url.pathname.split('/workspace/')[1]?.replace(/\/$/,'');
    if(!db||await stateGet(db,'workspace_schema')!=='1')throw crmError('The CRM workspace needs its database upgrade before it can open. The existing inbox is still available.',503);
    if(request.method==='GET') {
      if(route==='backup'){
        const backupKey=await stateGet(db,'backup_last_key');
        if(!env.CRM_BACKUPS||!/^daily\/\d{4}-\d{2}-\d{2}\.json\.gz$/.test(backupKey))throw crmError('No cloud backup is available yet.',404);
        const object=await env.CRM_BACKUPS.get(backupKey);if(!object)throw crmError('The backup could not be found.',404);
        return new Response(object.body,{headers:{'Content-Type':'application/gzip','Content-Disposition':'attachment; filename="nc-digital-'+backupKey.slice(6)+'"','Cache-Control':'no-store, private','Cloudflare-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
      }
      if(route==='health')return crmResponse(await mailboxHealth(db,env));
      if(route==='today')return crmResponse(await todayView(db));
      if(route==='reports')return crmResponse(await reportsView(db,url));
      if(route==='options'){const savedViewsReady=(await stateGet(db,'saved_views_schema'))==='1';return crmResponse({accounts:await rows(db,'SELECT id,name,email FROM crm_accounts WHERE archived_at IS NULL ORDER BY name LIMIT 500'),stages:await rows(db,'SELECT * FROM crm_stages WHERE archived_at IS NULL ORDER BY position'),opportunities:await rows(db,'SELECT id,account_id,title FROM crm_opportunities WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT 500'),tickets:await rows(db,"SELECT id,account_id,subject,reference FROM crm_tickets WHERE archived_at IS NULL AND status<>'spam' ORDER BY updated_at DESC LIMIT 500"),contacts:await rows(db,'SELECT id,account_id,name FROM crm_contacts WHERE archived_at IS NULL ORDER BY name LIMIT 500'),saved_views_ready:savedViewsReady,saved_views:savedViewsReady?await rows(db,'SELECT id,entity,name,query,version,updated_at FROM crm_saved_views WHERE owner=? AND archived_at IS NULL ORDER BY entity,name COLLATE NOCASE',actor):[],today:londonToday()});}
      if(route==='list')return crmResponse(await listRecords(db,url.searchParams.get('entity'),url));
      if(route==='account')return crmResponse(await accountDetail(db,key(url.searchParams.get('id'))));
      if(route==='record'){const entity=url.searchParams.get('entity');if(!TABLES[entity])throw crmError('Unknown record.',404);const row=await record(db,TABLES[entity],url.searchParams.get('id'),true);if(entity==='quotes'){row.items=await rows(db,'SELECT * FROM crm_quote_items WHERE quote_id=? ORDER BY position',row.id);const revision=await db.prepare('SELECT snapshot FROM crm_quote_revisions WHERE quote_id=? AND revision=?').bind(row.id,row.revision).first();row.snapshot=revision?JSON.parse(revision.snapshot):null;}return crmResponse(row);}
      if(route==='duplicates'){const q=text(url.searchParams.get('q'),254);if(q.length<3)return crmResponse({items:[]});return crmResponse({items:await rows(db,"SELECT id,name,email,phone,website FROM crm_accounts WHERE archived_at IS NULL AND (email=? OR phone=? OR name LIKE ?) LIMIT 20",q.toLowerCase(),phone(q),'%'+q+'%')});}
      if(route==='draft'){const draft=await db.prepare('SELECT * FROM crm_drafts WHERE owner=? AND draft_key=?').bind(actor,text(url.searchParams.get('key'),160)).first();return crmResponse(draft||{body:'',version:0});}
      if(route==='audit'){const auditEntityId=text(url.searchParams.get('id'),80);if(!auditEntityId)throw crmError('Choose a record to inspect.');return crmResponse({items:await rows(db,'SELECT * FROM crm_audit WHERE entity_id=? ORDER BY created_at DESC LIMIT 100',auditEntityId)});}
      if(route==='search'){
        const q=text(url.searchParams.get('q'),120);if(q.length<2)return crmResponse({items:[]});const query='%'+q.replace(/[\%_]/g,'\\$&')+'%';
        const items=await rows(db,"SELECT id,'accounts' AS entity,name AS title,COALESCE(NULLIF(email,''),NULLIF(phone,''),NULLIF(website,''),'') AS detail,NULL AS related_id FROM crm_accounts WHERE archived_at IS NULL AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR website LIKE ? ESCAPE '\\') UNION ALL SELECT id,'contacts',name,COALESCE(NULLIF(email,''),NULLIF(phone,''),job_title,''),account_id FROM crm_contacts WHERE archived_at IS NULL AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR job_title LIKE ? ESCAPE '\\') UNION ALL SELECT id,'tickets',COALESCE(NULLIF(name,''),NULLIF(email,''),'Enquiry'),subject,id FROM crm_tickets WHERE archived_at IS NULL AND status<>'spam' AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\' OR subject LIKE ? ESCAPE '\\' OR service LIKE ? ESCAPE '\\' OR source_page LIKE ? ESCAPE '\\' OR metadata LIKE ? ESCAPE '\\') UNION ALL SELECT m.id,'messages',t.subject,substr(replace(replace(m.body,char(13),' '),char(10),' '),1,240),t.id FROM crm_messages m JOIN crm_tickets t ON t.id=m.ticket_id WHERE t.archived_at IS NULL AND t.status<>'spam' AND m.kind IN ('inbound','outbound','note','notification') AND (m.body LIKE ? ESCAPE '\\' OR m.author LIKE ? ESCAPE '\\') UNION ALL SELECT a.id,'notes',ac.name,substr(replace(replace(a.body,char(13),' '),char(10),' '),1,240),ac.id FROM crm_activities a JOIN crm_accounts ac ON ac.id=a.account_id WHERE ac.archived_at IS NULL AND (a.body LIKE ? ESCAPE '\\' OR a.author LIKE ? ESCAPE '\\') UNION ALL SELECT id,'opportunities',title,COALESCE(NULLIF(service,''),NULLIF(source,''),''),NULL FROM crm_opportunities WHERE archived_at IS NULL AND (title LIKE ? ESCAPE '\\' OR service LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\') UNION ALL SELECT id,'tasks',title,due_date,NULL FROM crm_tasks WHERE archived_at IS NULL AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') UNION ALL SELECT id,'quotes',number,title,NULL FROM crm_quotes WHERE archived_at IS NULL AND (number LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\') LIMIT 50",...Array(27).fill(query));return crmResponse({items});
      }
    }
    if(request.method!=='POST')throw crmError('Not found.',404);
    sameOrigin(request);const body=await readJson(request,80000);
    let result;
    if(route==='retry-import')result=await retryImport(db,body,actor);
    else if(route==='confirm-sent')result=await confirmSent(db,body,actor);
    else if(route==='accounts')result=await saveAccount(db,body,actor);
    else if(route==='import-accounts')result=await importAccounts(db,body,actor);
    else if(route==='enquiries'){
      const name=required(body.name,120),mail=optionalEmail(body.email),tel=phone(body.phone),company=text(body.company,160),ticketId=key(body.id),at=now();
      if(!mail&&!tel)throw crmError('Add an email address or phone number.');
      const subject=required(body.subject,180,'Subject').replace(/[\r\n]/g,' '),message=required(body.message,16000,'Enquiry'),due=dateOnly(body.due_date),service=text(body.service,180),lead_source=text(body.lead_source,80,'manual'),lead_temperature=choice(body.lead_temperature,['cold','warm','hot'],'warm');
      const submissionHash=await enquiryHash({name,email:mail,phone:tel,company,subject,message,due,service,lead_source,lead_temperature});
      const existing=await db.prepare('SELECT * FROM crm_tickets WHERE id=?').bind(ticketId).first();
      if(existing){if(existing.submission_hash!==submissionHash)throw crmError('Request already used for another enquiry.',409);result=existing;}
      else {await db.batch([
        db.prepare("INSERT INTO crm_tickets(id,reference,submission_key,name,email,phone,company,subject,service,source_page,metadata,created_at,updated_at,last_inbound_at,submission_hash) VALUES(?,?,?,?,?,?,?,?,?,'manual',?,?,?,?,?)").bind(ticketId,'NC-'+ticketId.replace(/-/g,'').slice(0,16).toUpperCase(),ticketId,name,mail,tel,company,subject,service,JSON.stringify({lead_source,lead_temperature}),at,at,at,submissionHash),
        db.prepare("INSERT INTO crm_messages(id,ticket_id,kind,author,body,created_at,updated_at) VALUES(?,?,'inbound',?,?,?,?)").bind(id(),ticketId,mail||name,message,at,at),
        db.prepare("INSERT INTO crm_tasks(id,title,ticket_id,due_date,external_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind('followup-'+ticketId,'Follow up: '+name,ticketId,due,'ticket-followup:'+ticketId,at,at),
        auditStatement(db,actor,'manual lead created','crm_tickets',ticketId,null,{name,email:mail,phone:tel},at),
      ]);result=await record(db,'crm_tickets',ticketId);}
    }
    else if(route==='backup-now'){if(!env.CRM_BACKUPS)throw crmError('Cloud backups are not configured.',503);await runCloudBackup(env,{force:true});result=(await mailboxHealth(db,env)).backup;}
    else if(route==='contacts')result=await saveContact(db,body,actor);
    else if(route==='tasks')result=await saveTask(db,body,actor);
    else if(route==='opportunities')result=await saveOpportunity(db,body,actor);
    else if(route==='stage')result=await saveStage(db,body,actor);
    else if(route==='saved-view')result=await saveView(db,body,actor);
    else if(route==='bulk')result=await bulkCompleteTasks(db,body,actor);
    else if(route==='archive')result=await archive(db,body,actor);
    else if(route==='link')result=await linkTicket(db,body,actor);
    else if(route==='activity'){
      const account=await record(db,'crm_accounts',body.account_id),activityId=key(body.id);
      const values={kind:choice(body.kind,['note','call','meeting'],'note'),body:required(body.body,16000,'Note'),pinned:body.pinned?1:0};
      await db.batch([db.prepare('INSERT OR IGNORE INTO crm_activities(id,account_id,kind,body,author,pinned,created_at) VALUES(?,?,?,?,?,?,?)').bind(activityId,account.id,values.kind,values.body,actor,values.pinned,now()),db.prepare('INSERT OR IGNORE INTO crm_audit(id,actor,action,entity,entity_id,created_at) VALUES(?,?,?,?,?,?)').bind('activity:'+activityId,actor,'added '+values.kind,'crm_accounts',account.id,now())]);result={id:activityId};
    }else if(route==='draft'){
      const draftKey=required(body.key,160,'Draft key'),content=text(body.body,draftKey.startsWith('form:')?64000:16000),version=integer(body.version??0),at=now();
      const r=await db.prepare('INSERT INTO crm_drafts(owner,draft_key,body,request_key,version,updated_at) SELECT ?,?,?,?,1,? WHERE ?=0 ON CONFLICT(owner,draft_key) DO UPDATE SET body=excluded.body,request_key=excluded.request_key,version=crm_drafts.version+1,updated_at=excluded.updated_at WHERE crm_drafts.version=?').bind(actor,draftKey,content,key(body.request_key),at,version,version).run();
      // Existing drafts must update separately when the insert SELECT does not run.
      const update=version?await db.prepare('UPDATE crm_drafts SET body=?,request_key=?,version=version+1,updated_at=? WHERE owner=? AND draft_key=? AND version=?').bind(content,key(body.request_key),at,actor,draftKey,version).run():r;
      if(!update.meta.changes)throw crmError('This draft changed in another tab. Copy your text before reloading.',409);result={version:version+1};
    }else if(route==='export'){
      const entity=body.entity,table=TABLES[entity];if(!table)throw crmError('Choose a record type.');
      const last=body.after?key(body.after):'',items=await rows(db,`SELECT * FROM ${table} WHERE id>? ORDER BY id LIMIT 500`,last);
      await auditStatement(db,actor,'exported',table,last||'all',null,{count:items.length}).run();result={items,next:items.length===500?items.at(-1).id:null};
    }else result=await handleCommercial(route,db,env,body,actor);
    return crmResponse(result,200);
  }catch(error){return failure(error);}
}
