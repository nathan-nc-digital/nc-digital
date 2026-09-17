import {crmError,stateGet,stateSet,acquireLock,releaseLock} from './crm.js';
import {londonToday} from './crm-domain.js';

const PAGE_SIZE=30, MAX_CONTENT=8, RUN_BUDGET_MS=150000;
async function discover(db,api,upper,start,helpers) {
  const data=await api('/messages/search?'+new URLSearchParams({searchKey:'subject:NC-',receivedTime:String(upper),start:String(start),limit:String(PAGE_SIZE),includeto:'true'}));
  if(!Array.isArray(data.data)||data.data.length>PAGE_SIZE)throw crmError('Zoho returned an unexpected message list.',502);
  const at=new Date().toISOString();
  for(const message of data.data){
    const reference=helpers.messageTicketReference(message.subject),providerId=String(message.messageId||''),folderId=String(message.folderId||'');
    if(!reference||!/^\d+$/.test(providerId)||!/^\d+$/.test(folderId))continue;
    if(await db.prepare('SELECT id FROM crm_messages WHERE provider_id=?').bind(providerId).first())continue;
    const ticket=await db.prepare('SELECT id,email,status FROM crm_tickets WHERE reference=?').bind(reference).first();
    if(!ticket||ticket.status==='spam'||helpers.senderAddress(message.fromAddress)!==ticket.email)continue;
    const received=Number(message.receivedTime||message.receivedtime||message.sentDateInGMT);
    const receivedAt=Number.isFinite(received)&&received>0&&received<=Date.now()+86400000?new Date(received).toISOString():at;
    await db.prepare(`INSERT INTO crm_sync_items(provider_id,ticket_id,folder_id,sender_email,received_at,has_attachment,next_attempt_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(provider_id) DO UPDATE SET folder_id=excluded.folder_id`)
      .bind(providerId,ticket.id,folderId,ticket.email,receivedAt,['1','true'].includes(String(message.hasAttachment))?1:0,at,at,at).run();
  }
  return data.data.length;
}

async function importItem(db,api,item,helpers) {
  if(await db.prepare('SELECT id FROM crm_messages WHERE provider_id=?').bind(item.provider_id).first()){
    await db.prepare('DELETE FROM crm_sync_items WHERE provider_id=?').bind(item.provider_id).run();return false;
  }
  const ticket=await db.prepare('SELECT * FROM crm_tickets WHERE id=?').bind(item.ticket_id).first();
  if(!ticket||ticket.email!==item.sender_email||ticket.status==='spam')throw crmError('Check the enquiry contact and status before importing this reply.');
  const content=await api(`/folders/${item.folder_id}/messages/${item.provider_id}/content?includeBlockContent=true`);
  if(typeof content.data?.content!=='string')throw crmError('Zoho did not return the message content.',502);
  const fullBody=helpers.mailText(content.data.content),body=helpers.trimQuotedReply(fullBody)||'(This email has no readable text. Open Zoho Mail to view the original.)';
  const suffix=item.has_attachment?'\n\n[This email has attachments. Open the original in Zoho Mail to view them.]':'';
  const at=new Date().toISOString(),messageId=crypto.randomUUID();
  const result=await db.batch([
    db.prepare("INSERT OR IGNORE INTO crm_messages(id,ticket_id,kind,author,body,full_body,source_html,provider_id,created_at,updated_at) VALUES(?,?,'inbound',?,?,?,?,?,?,?)").bind(messageId,ticket.id,ticket.email,body+suffix,fullBody+suffix,content.data.content,item.provider_id,item.received_at,at),
    db.prepare("UPDATE crm_tickets SET status='open',archived_at=NULL,last_inbound_at=MAX(last_inbound_at,?),updated_at=?,version=version+1 WHERE id=? AND EXISTS(SELECT 1 FROM crm_messages WHERE id=?)").bind(item.received_at,at,ticket.id,messageId),
    db.prepare("INSERT OR IGNORE INTO crm_tasks(id,title,ticket_id,account_id,due_date,external_key,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM crm_messages WHERE id=?)").bind('inbound-'+item.provider_id,'Review reply: '+ticket.name,ticket.id,ticket.account_id,londonToday(),'inbound-review:'+item.provider_id,at,at,messageId),
    db.prepare("UPDATE crm_tasks SET status='done',completed_at=?,updated_at=?,version=version+1 WHERE ticket_id=? AND status='open' AND ((external_key LIKE 'reply-followup:%' AND created_at<=?) OR external_key LIKE 'auto-no-reply:%') AND EXISTS(SELECT 1 FROM crm_messages WHERE id=?)").bind(at,at,ticket.id,item.received_at,messageId),
    db.prepare('DELETE FROM crm_sync_items WHERE provider_id=?').bind(item.provider_id),
  ]);
  return Boolean(result[0].meta.changes);
}

export async function syncMailbox(env,createApi,helpers) {
  const db=env.JOBS_DB,owner=await acquireLock(db,'sync_lock');
  if(!owner)return {busy:true};
  const started=Date.now();let imported=0,failed=0,discoveryError=null,more=false;
  try{
    const api=await createApi(env);
    const upper=Number(await stateGet(db,'sync_upper','0'))||Date.now();
    const start=Math.max(1,Number(await stateGet(db,'sync_start','1'))||1);
    await stateSet(db,'sync_upper',upper);
    try{
      // Always discover the newest page first, even while older pages are being scanned.
      if(start>1)await discover(db,api,Date.now(),1,helpers);
      const count=await discover(db,api,upper,start,helpers);
      more=count===PAGE_SIZE;
      await db.batch([
        db.prepare("INSERT INTO crm_state(key,value) VALUES('sync_start',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(more?start+count:1)),
        db.prepare("INSERT INTO crm_state(key,value) VALUES('sync_upper',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(more?upper:0)),
      ]);
      if(!more)await stateSet(db,'last_sync',new Date().toISOString());
    }catch(error){discoveryError=error;}
    const {results:items}=await db.prepare("SELECT * FROM crm_sync_items WHERE status IN ('pending','retry') AND next_attempt_at<=? ORDER BY received_at DESC,provider_id LIMIT ?").bind(new Date().toISOString(),MAX_CONTENT).all();
    for(const item of items){
      if(Date.now()-started>RUN_BUDGET_MS)break;
      if(await stateGet(db,'sync_lock')!==owner)throw crmError('Mailbox sync ownership changed. The next scheduled run will continue.',409);
      try{if(await importItem(db,api,item,helpers))imported++;}
      catch(error){
        failed++;const attempts=item.attempts+1,at=new Date().toISOString();
        await db.prepare('UPDATE crm_sync_items SET status=?,attempts=?,next_attempt_at=?,last_error=?,updated_at=? WHERE provider_id=?')
          .bind(attempts>=5?'needs_review':'retry',attempts,new Date(Date.now()+Math.min(3600000,60000*2**Math.min(attempts,6))).toISOString(),error.publicMessage||'This reply could not be imported. Check the original in Zoho.',at,item.provider_id).run();
      }
    }
    const pending=await db.prepare('SELECT COUNT(*) AS count FROM crm_sync_items').first();
    await stateSet(db,'sync_error',discoveryError?.publicMessage||(discoveryError?'Mailbox discovery failed. Saved imports will continue to retry.':pending.count?`${pending.count} replies are still waiting to import. Review mailbox health.`:''));
    await stateSet(db,'last_sync_check',new Date().toISOString());
    if(discoveryError)throw discoveryError;
    return {imported,failed,pending:pending.count,more:more||pending.count>0};
  }catch(error){await stateSet(db,'sync_error',error.publicMessage||'Mailbox sync failed. Try again.');throw error;}
  finally{await releaseLock(db,'sync_lock',owner);}
}
