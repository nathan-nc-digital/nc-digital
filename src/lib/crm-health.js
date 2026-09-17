import {crmError,stateGet,key,text} from './crm.js';
import {accessEnabled} from './admin-access.js';

export async function mailboxHealth(db,env) {
  const ready=await stateGet(db,'reliability_schema')==='1';
  const imports=ready?(await db.prepare("SELECT i.provider_id,i.ticket_id,i.status,i.attempts,i.next_attempt_at,i.last_error,t.name,t.reference FROM crm_sync_items i JOIN crm_tickets t ON t.id=i.ticket_id ORDER BY CASE i.status WHEN 'needs_review' THEN 0 ELSE 1 END,i.received_at DESC LIMIT 50").all()).results:[];
  const totals=ready?(await db.prepare('SELECT status,COUNT(*) AS count FROM crm_sync_items GROUP BY status').all()).results:[];
  const outbox=(await db.prepare("SELECT m.id,m.ticket_id,m.delivery,m.error,m.updated_at,m.created_at,t.name,t.reference FROM crm_messages m JOIN crm_tickets t ON t.id=m.ticket_id WHERE m.delivery IN ('failed','unknown','sending','queued') ORDER BY CASE m.delivery WHEN 'unknown' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,m.created_at LIMIT 50").all()).results;
  const backup={configured:Boolean(env.CRM_BACKUPS),last_success:await stateGet(db,'backup_last_success'),error:await stateGet(db,'backup_error')};
  return {ready,imports,totals,outbox,backup,last_sync:await stateGet(db,'last_sync'),last_check:await stateGet(db,'last_sync_check'),last_send_check:await stateGet(db,'last_send_check'),sync_error:await stateGet(db,'sync_error'),auth_mode:accessEnabled(env)?'access':'basic',logout_path:accessEnabled(env)?'/cdn-cgi/access/logout':null};
}
export async function retryImport(db,body,actor) {
  const providerId=String(body.provider_id||'');if(!/^\d+$/.test(providerId))throw crmError('Choose a valid reply.');
  const at=new Date().toISOString(),auditId=crypto.randomUUID();
  const results=await db.batch([
    db.prepare("INSERT INTO crm_audit(id,actor,action,entity,entity_id,created_at) SELECT ?,?,'retry import','crm_tickets',ticket_id,? FROM crm_sync_items WHERE provider_id=? AND status IN ('retry','needs_review')").bind(auditId,actor,at,providerId),
    db.prepare("UPDATE crm_sync_items SET status='pending',attempts=0,next_attempt_at=?,last_error=NULL,updated_at=? WHERE provider_id=? AND EXISTS(SELECT 1 FROM crm_audit WHERE id=?)").bind(at,at,providerId,auditId),
  ]);
  if(!results[1].meta.changes)throw crmError('This reply is already queued or imported. Refresh mailbox health.',409);
  return {queued:true};
}
export async function confirmSent(db,body,actor) {
  const note=text(body.note,2000);if(body.confirmed!==true||note.length<12)throw crmError('Check the exact message in Zoho Sent, then record the evidence for this confirmation.');
  const message=await db.prepare('SELECT * FROM crm_messages WHERE id=?').bind(key(body.id)).first();
  if(!message||message.delivery!=='unknown'||message.updated_at!==body.updated_at)throw crmError('Only an unchanged unconfirmed send can be confirmed. Refresh mailbox health.',409);
  const at=new Date().toISOString(),auditId=crypto.randomUUID();
  const result=await db.batch([
    db.prepare("INSERT INTO crm_audit(id,actor,action,entity,entity_id,before_json,after_json,created_at) SELECT ?,?,'manually confirmed sent','crm_messages',id,?,?,? FROM crm_messages WHERE id=? AND delivery='unknown' AND updated_at=?")
      .bind(auditId,actor,JSON.stringify({delivery:'unknown'}),JSON.stringify({delivery:'sent',note}),at,message.id,body.updated_at),
    db.prepare("UPDATE crm_messages SET delivery='sent',delivery_confirmed_by=?,delivery_confirmation_note=?,delivery_confirmed_at=?,error=NULL,updated_at=? WHERE id=? AND delivery='unknown' AND updated_at=? AND EXISTS(SELECT 1 FROM crm_audit WHERE id=?)")
      .bind(actor,note,at,at,message.id,body.updated_at,auditId),
    db.prepare("UPDATE crm_quotes SET status='sent',sent_at=?,updated_at=?,version=version+1 WHERE id=? AND revision=? AND status='queued' AND EXISTS(SELECT 1 FROM crm_audit WHERE id=?)")
      .bind(at,at,message.quote_id,message.quote_revision,auditId),
    db.prepare("UPDATE crm_tickets SET status=CASE WHEN ?='outbound' AND status IN ('new','open','waiting') AND last_inbound_at<=? THEN 'waiting' ELSE status END,version=version+1,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM crm_audit WHERE id=?)")
      .bind(message.kind,message.created_at,at,message.ticket_id,auditId),
  ]);
  if(!result[1].meta.changes)throw crmError('The message changed. Refresh mailbox health.',409);
  return {confirmed:true};
}
