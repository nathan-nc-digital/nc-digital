import { crmError, text, key, CRM_MAILBOX } from './crm.js';
import { zohoConfigured } from './crm-zoho.js';
import { id, now, required, choice, integer, dateOnly, londonToday, plusDays, nextRenewal, quoteItems, record, mutation, checkVersion, auditStatement } from './crm-domain.js';

async function rows(db,sql,...args){return (await db.prepare(sql).bind(...args).all()).results;}
const gbp=p=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(p/100);
const NO_REPLY_DAYS=7;
export function quoteBreakdown(items){return Object.fromEntries(['once','monthly','quarterly','annual'].map(f=>[f,items.filter(i=>i.frequency===f).reduce((n,i)=>n+i.total_pence,0)]));}
export function quoteEmail(quote,items,account) {
  const totals=quoteBreakdown(items);
  return [`Hi ${account.name},`,'',`${quote.number} — ${quote.title}`,`Valid until ${quote.expires_on}`,'',...items.map(i=>`${i.description} (${i.quantity} × ${gbp(i.unit_pence)} excl. VAT${i.vat_bps?`, VAT ${i.vat_bps/100}%`:''}): ${gbp(i.total_pence)} ${i.frequency==='once'?'one-off':i.frequency}`),'',...Object.entries(totals).filter(([,n])=>n).map(([f,n])=>`${{once:'One-off total',monthly:'Monthly total',quarterly:'Quarterly total',annual:'Annual total'}[f]}: ${gbp(n)} including applicable VAT`),'',quote.notes,quote.terms?`Terms\n${quote.terms}`:'','Please reply to confirm the quote number and the work you would like to go ahead with.'].filter(v=>v!==undefined).join('\n');
}

async function saveQuote(db,body,actor) {
  const account=await record(db,'crm_accounts',body.account_id);
  if(body.opportunity_id){const o=await record(db,'crm_opportunities',body.opportunity_id);if(o.account_id!==account.id)throw crmError('Opportunity belongs to a different customer.');}
  if(body.ticket_id){const t=await record(db,'crm_tickets',body.ticket_id);if(t.account_id!==account.id)throw crmError('Link the enquiry to this customer before preparing its quote.');}
  const items=quoteItems(body.items),total=integer(quoteBreakdown(items).once),quoteId=key(body.id),at=now();
  const old=body.version!==undefined?await record(db,'crm_quotes',quoteId):null;
  if(old){checkVersion(old,body);if(old.status!=='draft')throw crmError('Issued quotes are immutable. Duplicate this quote for a new proposal.',409);}
  const revision=old?old.revision+1:1;
  const values={account_id:account.id,opportunity_id:body.opportunity_id?key(body.opportunity_id):null,ticket_id:body.ticket_id?key(body.ticket_id):null,title:required(body.title,240,'Quote title'),expires_on:dateOnly(body.expires_on),terms:text(body.terms,8000),notes:text(body.notes,4000),total_pence:total,revision};
  if(values.expires_on<londonToday())throw crmError('Choose a quote expiry date today or later.');
  const number=old?.number||'Q-'+quoteId.replace(/-/g,'').slice(0,10).toUpperCase();
  const snapshot=JSON.stringify({id:quoteId,number,...values,customer:{name:account.name,email:account.email,address:account.address},items});
  const itemStatements=guard=>items.map((item,index)=>db.prepare(`INSERT INTO crm_quote_items(id,quote_id,position,description,quantity,unit_pence,vat_bps,frequency,net_pence,tax_pence,total_pence) SELECT ?,?,?,?,?,?,?,?,?,?,? ${guard?'WHERE EXISTS(SELECT 1 FROM crm_audit WHERE id=?)':''}`).bind(`${quoteId}-${revision}-${index}`,quoteId,index,item.description,item.quantity,item.unit_pence,item.vat_bps,item.frequency,item.net_pence,item.tax_pence,item.total_pence,...(guard?[guard]:[])));
  const revisionStatement=guard=>db.prepare(`INSERT INTO crm_quote_revisions(id,quote_id,revision,snapshot,created_at,author) SELECT ?,?,?,?,?,? ${guard?'WHERE EXISTS(SELECT 1 FROM crm_audit WHERE id=?)':''}`).bind(id(),quoteId,revision,snapshot,at,actor,...(guard?[guard]:[]));
  if(old) {
    const extra=[auditId=>db.prepare('DELETE FROM crm_quote_items WHERE quote_id=? AND EXISTS(SELECT 1 FROM crm_audit WHERE id=?)').bind(quoteId,auditId),...items.map((_,index)=>auditId=>itemStatements(auditId)[index]),auditId=>revisionStatement(auditId)];
    return mutation(db,'crm_quotes',old,values,actor,'revised draft',extra);
  }
  const existing=await db.prepare('SELECT * FROM crm_quotes WHERE id=?').bind(quoteId).first();
  if(existing){const prior=await db.prepare('SELECT snapshot FROM crm_quote_revisions WHERE quote_id=? AND revision=1').bind(quoteId).first();if(prior?.snapshot!==snapshot)throw crmError('Request already used for another quote.',409);return existing;}
  await db.batch([db.prepare('INSERT INTO crm_quotes(id,number,account_id,opportunity_id,ticket_id,title,expires_on,terms,notes,total_pence,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(quoteId,number,values.account_id,values.opportunity_id,values.ticket_id,values.title,values.expires_on,values.terms,values.notes,total,at,at),...itemStatements(null),revisionStatement(null),auditStatement(db,actor,'created','crm_quotes',quoteId,null,values,at)]);
  return record(db,'crm_quotes',quoteId);
}

async function quoteAction(db,env,body,actor) {
  const quote=await record(db,'crm_quotes',body.id);checkVersion(quote,body);
  const action=choice(body.action,['send','sent_external','accept','reject','expire']);
  const at=now(),today=londonToday(),note=text(body.note,2000);
  const account=await record(db,'crm_accounts',quote.account_id);
  const extras=[];
  let values;
  if(['send','sent_external'].includes(action)){
    if(quote.status!=='draft')throw crmError('Only a draft can be issued. Check its delivery status before retrying.',409);
    if(quote.expires_on<today)throw crmError('Extend the quote expiry before issuing it.');
    if(action==='send'){
      if(!zohoConfigured(env)||env.CRM_ENABLED!=='true')throw crmError('Connect Zoho before sending a quote.',503);
      if(!quote.ticket_id)throw crmError('Link a customer enquiry to send through the CRM, or record an external send.');
      const ticket=await record(db,'crm_tickets',quote.ticket_id);
      if(ticket.account_id!==quote.account_id||ticket.status==='spam'||!ticket.email||ticket.email===CRM_MAILBOX)throw crmError('Check this quote’s linked enquiry and recipient before sending.');
      const items=await rows(db,'SELECT * FROM crm_quote_items WHERE quote_id=? ORDER BY position',quote.id),content=quoteEmail(quote,items,account);
      if(content.length>16000)throw crmError('This quote is too long for an email. Print it to PDF and record the external send.');
      const messageId='quote-'+quote.id+'-'+quote.revision;
      extras.push(auditId=>db.prepare("INSERT INTO crm_messages(id,ticket_id,kind,author,body,delivery,request_key,quote_id,quote_revision,created_at,updated_at) SELECT ?,?,'outbound',?,?,'queued',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM crm_audit WHERE id=?)").bind(messageId,ticket.id,actor,content,messageId,quote.id,quote.revision,at,at,auditId));
      values={status:'queued'};
    }else{
      if(!body.confirmed||!note)throw crmError('Confirm the external send and record where it was sent.');
      values={status:'sent',sent_at:at,acceptance_note:note};
    }
    extras.push(auditId=>db.prepare("INSERT OR IGNORE INTO crm_tasks(id,title,account_id,opportunity_id,ticket_id,due_date,external_key,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM crm_audit WHERE id=?)").bind('followup-'+quote.id,'Follow up quote '+quote.number,quote.account_id,quote.opportunity_id,quote.ticket_id,plusDays(today,5),'quote-followup:'+quote.id,at,at,auditId));
  }else if(action==='accept'){
    if(quote.status!=='sent'||quote.expires_on<today)throw crmError('Only an issued, unexpired quote can be accepted. Prepare a new quote if it expired.',409);
    if(!body.confirmed||!note)throw crmError('Record how the customer accepted this exact quote revision.');
    if(quote.opportunity_id){const opportunity=await record(db,'crm_opportunities',quote.opportunity_id);const stage=await db.prepare('SELECT outcome FROM crm_stages WHERE id=?').bind(opportunity.stage_id).first();if(stage?.outcome==='lost')throw crmError('Reopen the lost opportunity before recording acceptance.',409);}
    values={status:'accepted',accepted_at:at,acceptance_note:note};
    extras.push(auditId=>db.prepare("UPDATE crm_accounts SET lifecycle='customer',version=version+1,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM crm_audit WHERE id=?)").bind(at,quote.account_id,auditId));
    if(quote.opportunity_id){extras.push(auditId=>db.prepare("UPDATE crm_opportunities SET stage_id='won',won_at=?,lost_at=NULL,outcome_reason='',stage_changed_at=?,version=version+1,updated_at=? WHERE id=? AND archived_at IS NULL AND EXISTS(SELECT 1 FROM crm_audit WHERE id=?)").bind(at,at,at,quote.opportunity_id,auditId));extras.push(auditId=>db.prepare("UPDATE crm_tasks SET status='cancelled',version=version+1,updated_at=? WHERE opportunity_id=? AND kind='followup' AND status='open' AND EXISTS(SELECT 1 FROM crm_audit WHERE id=?)").bind(at,quote.opportunity_id,auditId));}
    extras.push(auditId=>db.prepare("INSERT OR IGNORE INTO crm_tasks(id,title,account_id,opportunity_id,ticket_id,kind,due_date,external_key,created_at,updated_at) SELECT ?,?,?,?,?,'onboarding',?,?,?,? WHERE EXISTS(SELECT 1 FROM crm_audit WHERE id=?)").bind('onboard-'+quote.id,'Start agreed work: '+quote.title,quote.account_id,quote.opportunity_id,quote.ticket_id,today,'quote-onboard:'+quote.id,at,at,auditId));
  }else{
    if(!['draft','sent'].includes(quote.status))throw crmError('This quote cannot be changed to that outcome.',409);
    if(action==='reject'&&!note)throw crmError('Record why this quote was declined.');
    if(action==='expire'&&quote.expires_on>=today)throw crmError('This quote has not expired.');
    values={status:action==='reject'?'rejected':'expired',acceptance_note:note};
  }
  if(['accept','reject','expire'].includes(action))extras.push(auditId=>db.prepare("UPDATE crm_tasks SET status='cancelled',version=version+1,updated_at=? WHERE external_key=? AND status='open' AND EXISTS(SELECT 1 FROM crm_audit WHERE id=?)").bind(at,'quote-followup:'+quote.id,auditId));
  return mutation(db,'crm_quotes',quote,values,actor,'quote '+action,extras);
}

async function saveService(db,body,actor) {
  const account=await record(db,'crm_accounts',body.account_id),serviceId=key(body.id),at=now();
  const old=body.version!==undefined?await record(db,'crm_services',serviceId):null;if(old)checkVersion(old,body);
  const frequency=choice(body.frequency,['monthly','quarterly','annual','once']);
  const starts=dateOnly(body.starts_on),renews=dateOnly(body.renews_on,frequency==='once'),ends=dateOnly(body.ends_on,true);
  if(renews&&renews<starts)throw crmError('Renewal must not precede the service start.');
  if(ends&&ends<starts)throw crmError('Cancellation must not precede the service start.');
  const status=choice(body.status,['active','paused','cancelled'],'active'),reason=text(body.cancellation_reason,1000);
  if((status==='cancelled'||ends)&&!reason)throw crmError('Record a cancellation reason.');
  const quoteId=body.quote_id?key(body.quote_id):null;
  if(quoteId){const q=await record(db,'crm_quotes',quoteId);if(q.account_id!==account.id||q.status!=='accepted')throw crmError('Choose an accepted quote for this customer.');}
  const values={account_id:account.id,quote_id:quoteId,name:required(body.name,240,'Service name'),category:text(body.category,160),price_pence:integer(body.price_pence),frequency,starts_on:starts,renews_on:renews,ends_on:status==='cancelled'?(ends||londonToday()):ends,status,cancellation_reason:reason,notes:text(body.notes,8000)};
  if(old){const cancelTask=auditId=>db.prepare("UPDATE crm_tasks SET status='cancelled',version=version+1,updated_at=? WHERE service_id=? AND status='open' AND (due_date IS NOT ? OR ?<>'active' OR (? IS NOT NULL AND ?<=?)) AND EXISTS(SELECT 1 FROM crm_audit WHERE id=?)").bind(at,old.id,renews,status,values.ends_on,values.ends_on,renews,auditId);return mutation(db,'crm_services',old,values,actor,'service updated',[cancelTask]);}
  const existing=await db.prepare('SELECT * FROM crm_services WHERE id=?').bind(serviceId).first();if(existing){if(Object.keys(values).some(k=>existing[k]!==values[k]))throw crmError('This request already created a different service.',409);return existing;}
  await db.batch([db.prepare('INSERT INTO crm_services(id,account_id,quote_id,name,category,price_pence,frequency,starts_on,renews_on,ends_on,status,cancellation_reason,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(serviceId,...Object.values(values),at,at),auditStatement(db,actor,'created','crm_services',serviceId,null,values,at)]);
  return record(db,'crm_services',serviceId);
}

export async function handleCommercial(route,db,env,body,actor) {
  if(route==='quotes')return saveQuote(db,body,actor);
  if(route==='quote-action')return quoteAction(db,env,body,actor);
  if(route==='services')return saveService(db,body,actor);
  if(route==='renew') {
    const service=await record(db,'crm_services',body.id);checkVersion(service,body);
    if(service.frequency==='once'||service.status!=='active'||service.ends_on)throw crmError('Only an active, continuing recurring service can be renewed.');
    const renewal=nextRenewal(service.renews_on,service.frequency),at=now();
    return mutation(db,'crm_services',service,{renews_on:renewal},actor,'renewed',[auditId=>db.prepare("UPDATE crm_tasks SET status='done',completed_at=?,updated_at=?,version=version+1 WHERE service_id=? AND due_date=? AND status='open' AND EXISTS(SELECT 1 FROM crm_audit WHERE id=?)").bind(at,at,service.id,service.renews_on,auditId)]);
  }
  throw crmError('Not found.',404);
}

export async function runWorkspaceSchedule(env) {
  const db=env.JOBS_DB;if(!db||env.CRM_ENABLED!=='true')return;
  if((await db.prepare("SELECT value FROM crm_state WHERE key='workspace_schema'").first())?.value!=='1')return;
  const today=londonToday(),at=now();
  // Stable external keys make repeated scheduled invocations harmless.
  const statements=[
    db.prepare("INSERT OR IGNORE INTO crm_tasks(id,title,account_id,service_id,kind,due_date,external_key,created_at,updated_at) SELECT 'renewal-'||id||'-'||renews_on,'Renew '||name,account_id,id,'renewal',renews_on,'renewal:'||id||':'||renews_on,?,? FROM crm_services WHERE archived_at IS NULL AND status='active' AND renews_on<=? AND (ends_on IS NULL OR ends_on>renews_on)").bind(at,at,plusDays(today,30)),
    db.prepare("UPDATE crm_tasks SET status='cancelled',updated_at=?,version=version+1 WHERE status='open' AND service_id IN (SELECT id FROM crm_services WHERE status<>'active' OR archived_at IS NOT NULL OR ends_on<=?)").bind(at,today),
  ];
  const candidates=await rows(db,`SELECT t.id,t.name,t.account_id,
      MAX(CASE WHEN m.kind='inbound' THEN m.created_at END) AS last_inbound,
      MAX(CASE WHEN m.kind='outbound' AND m.delivery='sent' THEN m.created_at END) AS last_outbound
    FROM crm_tickets t
    LEFT JOIN crm_messages m ON m.ticket_id=t.id
    WHERE t.archived_at IS NULL AND t.status NOT IN ('closed','spam')
      AND NOT EXISTS (SELECT 1 FROM crm_tasks pending WHERE pending.ticket_id=t.id AND pending.archived_at IS NULL AND pending.status='open' AND pending.kind='followup')
    GROUP BY t.id
    HAVING (last_outbound IS NOT NULL OR last_inbound IS NOT NULL)
       AND (last_inbound IS NULL OR last_outbound IS NULL OR last_inbound<=last_outbound)
    ORDER BY COALESCE(last_outbound,last_inbound),t.id LIMIT 100`);
  for(const ticket of candidates){
    const baseline=ticket.last_outbound||ticket.last_inbound;
    const due=plusDays(londonToday(new Date(baseline)),NO_REPLY_DAYS);
    if(due>today)continue;
    const taskId=`auto-no-reply-${ticket.id}-${due}`,externalKey=`auto-no-reply:${ticket.id}:${due}`;
    const after={id:taskId,title:`No reply after ${NO_REPLY_DAYS} days: ${ticket.name}`,description:'No inbound reply received after the last enquiry or sent reply. Review and follow up.',account_id:ticket.account_id||null,ticket_id:ticket.id,kind:'followup',due_date:due,external_key:externalKey};
    statements.push(db.prepare("INSERT OR IGNORE INTO crm_tasks(id,title,description,account_id,ticket_id,kind,due_date,external_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(taskId,after.title,after.description,after.account_id,ticket.id,'followup',due,externalKey,at,at));
    statements.push(db.prepare("INSERT OR IGNORE INTO crm_audit(id,actor,action,entity,entity_id,after_json,created_at) VALUES(?,?,?,?,?,?,?)").bind(`audit-${taskId}`,'system','created','crm_tasks',taskId,JSON.stringify(after),at));
  }
  await db.batch(statements);
}
