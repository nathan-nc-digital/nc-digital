import { crmError, text, email, key } from './crm.js';

export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function required(value, max=160, label='Name') {
  const result=text(value,max); if(!result) throw crmError(`${label} is required.`); return result;
}
export function choice(value, options, fallback) {
  const result=value ?? fallback; if(!options.includes(result)) throw crmError('Choose a valid option.'); return result;
}
export function integer(value,min=0,max=1000000000) {
  if(!Number.isSafeInteger(value)||value<min||value>max) throw crmError(`Enter a whole number between ${min} and ${max}.`); return value;
}
export function dateOnly(value, optional=false) {
  if(!value&&optional)return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw crmError('Choose a valid date.');
  const d=new Date(value+'T12:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value||value<'2000-01-01'||value>'2100-12-31')throw crmError('Choose a date between 2000 and 2100.');
  return value;
}
export function londonToday(at=new Date()) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);
  const part=type=>parts.find(p=>p.type===type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function plusDays(value,days) {const d=new Date(dateOnly(value)+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function nextRenewal(value,frequency) {
  const months={monthly:1,quarterly:3,annual:12}[frequency]; if(!months)return null;
  const d=new Date(dateOnly(value)+'T12:00:00Z'),day=d.getUTCDate(); d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);
  const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10);
}
export function website(value) {
  const v=text(value,500); if(!v)return '';
  let u;try{u=new URL(v);}catch{throw crmError('Website must be a full https:// or http:// address.');}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw crmError('Enter a public website address without login details.');return u.href;
}
export function optionalEmail(value){return value?email(value):'';}
export function phone(value){return text(value,60).replace(/[\s().-]/g,'');}
export function tags(value) {
  if(value===undefined||value===null)return '[]';
  let values=value;
  if (typeof value === 'string') {
    const raw=value.trim();
    if (!raw) return '[]';
    try { values=JSON.parse(raw); } catch { values=raw.split(','); }
  }
  if (!Array.isArray(values)) throw crmError('Tags must be a comma-separated list.');
  const clean=[];const seen=new Set();
  for(const item of values){
    const tag=text(item,40).replace(/\s+/g,' ');
    if(!tag)continue;
    const key=tag.toLocaleLowerCase('en-GB');
    if(seen.has(key))continue;
    seen.add(key);clean.push(tag);
    if(clean.length>20)throw crmError('Use no more than 20 tags per record.');
  }
  return JSON.stringify(clean);
}
export function pence(value) {
  if(typeof value!=='string'||!/^\d{1,8}(\.\d{1,2})?$/.test(value.trim()))throw crmError('Enter a GBP amount with at most two decimal places.');
  const [whole,fraction='']=value.trim().split('.');return integer(Number(whole)*100+Number(fraction.padEnd(2,'0')));
}
export function ratioRound(amount,numerator,denominator) {
  return Number((BigInt(amount)*BigInt(numerator)+BigInt(denominator)/2n)/BigInt(denominator));
}
export function quoteItems(values) {
  if(!Array.isArray(values)||!values.length||values.length>40)throw crmError('Add between 1 and 40 quote items.');
  return values.map((item,position)=>{
    const unit_pence=integer(item.unit_pence),quantity=integer(item.quantity,1,10000),vat_bps=integer(item.vat_bps??0,0,10000);
    const net_pence=integer(unit_pence*quantity,0,1000000000),tax_pence=ratioRound(net_pence,vat_bps,10000);
    return {description:required(item.description,500,'Item description'),position,unit_pence,quantity,vat_bps,net_pence,tax_pence,total_pence:integer(net_pence+tax_pence),frequency:choice(item.frequency,['once','monthly','quarterly','annual'],'once')};
  });
}
export function revenue(services,today=londonToday()) {
  // Aggregate in twelfths of a penny before a single display rounding.
  let twelfths=0n;const accounts=new Set();
  for(const s of services){if(s.archived_at||s.status!=='active'||s.starts_on>today||(s.ends_on&&s.ends_on<=today)||s.frequency==='once')continue;
    twelfths+=BigInt(s.price_pence)*BigInt({monthly:12,quarterly:4,annual:1}[s.frequency]);accounts.add(s.account_id);}
  return {mrr_pence:Number((twelfths+6n)/12n),arr_pence:Number(twelfths),recurring_customers:accounts.size};
}
export function auditStatement(db,actor,action,entity,entityId,before,after,at=now()) {
  return db.prepare('INSERT INTO crm_audit(id,actor,action,entity,entity_id,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id(),actor,action,entity,entityId,before?JSON.stringify(before):null,after?JSON.stringify(after):null,at);
}
export async function record(db,table,recordId,allowArchived=false) {
  const row=await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(key(recordId)).first();
  if(!row||(!allowArchived&&row.archived_at))throw crmError('Record not found or archived.',404);return row;
}
export function checkVersion(row,body){if(row.version!==body.version)throw crmError('This record changed. Your draft is safe; reload the record before saving.',409);}
export async function mutation(db,table,row,values,actor,action='updated',extra=[]) {
  const at=now(),fields=Object.keys(values);
  // Audit insertion and dependent changes are conditional on the winning version.
  const auditId=id();
  const result=await db.batch([
    db.prepare(`INSERT INTO crm_audit(id,actor,action,entity,entity_id,before_json,after_json,created_at) SELECT ?,?,?,?,?,?,?,? FROM ${table} WHERE id=? AND version=?`).bind(auditId,actor,action,table,row.id,JSON.stringify(row),JSON.stringify({...row,...values,version:row.version+1}),at,row.id,row.version),
    db.prepare(`UPDATE ${table} SET ${fields.map(f=>`${f}=?`).join(',')},version=version+1,updated_at=? WHERE id=? AND version=?`).bind(...Object.values(values),at,row.id,row.version),
    ...extra.map(sql=>sql(auditId)),
  ]);
  if(!result[1].meta.changes)throw crmError('This record changed. Reload it before saving.',409);
  return record(db,table,row.id,true);
}
