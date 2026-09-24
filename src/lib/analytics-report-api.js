import {readLimitedBody} from './social-http.js';
import {googleToken as gscToken} from './seo-quick-wins-api.js';
import {parseReportInput,reportPeriods,gaSets,gaRequest,parseGa,buildAnalyticsReport} from './analytics-report.js';
import {researchLocations,dataForSeo} from './keyword-research.js';
import {rankingFrom} from './audit-local-search.js';
import {reportEmailRequest,queueReportEmail,newShareToken} from './report-email.js';
import {seoClientView} from './seo-report-view.js';
const SITE='https://nc-digital.co.uk';
const RANK_CHUNK=5,PARALLEL_STAGES=4,MAX_KEYWORDS=15;
const now=()=>new Date().toISOString();
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const json=(d,status=200)=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store, private','X-Robots-Tag':'noindex'}});
const decode=async(r,max=1500000)=>JSON.parse(new TextDecoder().decode(await readLimitedBody(r,max)));
export async function analyticsToken(env){
 let c;try{c=JSON.parse(env.GOOGLE_ANALYTICS_CONFIG||'');}catch{throw fail('Read-only Google Analytics access has not been connected yet.',503);}
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.client_id,client_secret:c.client_secret,refresh_token:c.refresh_token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)}),d=await decode(r,50000);
 if(!r.ok||!d.access_token)throw fail('Google Analytics needs a fresh sign-in. Saved reports remain available.',401);return d.access_token;
}
async function google(token,url,body){
 const r=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)}),d=await decode(r);
 if(!r.ok){const disabled=d.error?.details?.find(x=>x.reason==='SERVICE_DISABLED');if(disabled){const service=disabled.metadata?.service==='analyticsdata.googleapis.com'?'Analytics Data':disabled.metadata?.service==='analyticsadmin.googleapis.com'?'Analytics Admin':'Google';throw fail(`Enable the ${service} API in the Google Cloud project used by this connection, then retry.`,503);}throw fail(r.status===403?'Google denied access. Check the selected property and the connected account’s read-only permission.':r.status===429?'Google’s reporting quota is busy. Resume this saved report later.':r.status===400?'Google rejected a report request. The saved step can be retried after checking its dimensions and metrics.':'Google could not return this report step. Resume to retry.',r.status===403?403:r.status===429?429:502);}
 return d;
}
export async function analyticsProperties(token){
 const properties=[],seen=new Set();let pageToken='';
 for(let i=0;i<20;i++){
  const d=await google(token,'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200'+(pageToken?'&pageToken='+encodeURIComponent(pageToken):''));
  for(const a of d.accountSummaries||[])for(const p of a.propertySummaries||[])if(/^properties\/\d+$/.test(p.property)&&!seen.has(p.property)){seen.add(p.property);properties.push({property:p.property,name:p.displayName,account:a.displayName});}
  pageToken=d.nextPageToken||'';if(!pageToken)return properties;
 }
 throw fail('Too many account pages were returned. Narrow the connected Google account access.',503);
}
async function searchProperties(env){const token=await gscToken(env),d=await google(token,'https://www.googleapis.com/webmasters/v3/sites');return (d.siteEntry||[]).filter(s=>s.permissionLevel!=='siteUnverifiedUser').map(s=>s.siteUrl);}
const gscKinds=['gscCurrentTotals','gscPreviousTotals','gscCurrentPages','gscPreviousPages','gscCurrentQueries','gscPreviousQueries','gscCurrentTrend','gscPreviousTrend'];
// ---- Saved SEO clients: property pairing, name variations, enquiry events and ranking searches.
const list=(v,max,len)=>[...new Set((Array.isArray(v)?v:String(v||'').split(/[\n,]/)).map(x=>String(x).trim().toLowerCase()).filter(Boolean))].map(x=>x.slice(0,len)).slice(0,max);
function findTown(name){
 const q=String(name||'').trim().toLowerCase();if(!q)return null;
 const matches=researchLocations.filter(l=>l.name.toLowerCase()===q||l.name.split(',')[0].toLowerCase()===q);
 if(!matches.length)throw fail('Choose the town from the suggestions.');
 const towns=new Set(matches.map(l=>l.name.split(',').slice(1).join(',')));if(towns.size>1&&!q.includes(','))throw fail('There is more than one '+name+'. Choose the full location from the suggestions.');
 const l=matches.find(x=>x.type==='City')||matches[0];return {code:l.code,name:l.name};
}
const clientView=c=>c&&({id:c.id,name:c.name,property:c.property,site:c.site,country:c.country,brandTerms:JSON.parse(c.brand_terms),enquiryEvents:JSON.parse(c.enquiry_events),keywords:JSON.parse(c.keywords),locationCode:c.location_code,locationName:c.location_name,contactName:c.contact_name,contactEmail:c.contact_email});
async function saveClient(db,body){
 const name=String(body.name||'').trim().slice(0,120);if(!name)throw fail('Enter the client’s business name.');
 let input;try{input=parseReportInput({property:body.property,site:body.site,country:body.country});}catch(e){throw fail(e.message);}
 const keywords=list(body.keywords,MAX_KEYWORDS,120),town=body.town?findTown(body.town):null;
 if(keywords.length&&!town)throw fail('Choose the town to check rankings in.');
 const email=String(body.contactEmail||'').trim().toLowerCase().slice(0,254);if(email&&!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email))throw fail('Enter a valid contact email or leave it blank.');
 const id=body.id&&/^[0-9a-f-]{36}$/.test(body.id)?body.id:crypto.randomUUID(),at=now();
 await db.prepare(`INSERT INTO seo_clients(id,name,property,site,country,brand_terms,enquiry_events,keywords,location_code,location_name,contact_name,contact_email,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name,property=excluded.property,site=excluded.site,country=excluded.country,brand_terms=excluded.brand_terms,enquiry_events=excluded.enquiry_events,keywords=excluded.keywords,location_code=excluded.location_code,location_name=excluded.location_name,contact_name=excluded.contact_name,contact_email=excluded.contact_email,updated_at=excluded.updated_at`)
  .bind(id,name,input.property,input.site,input.country,JSON.stringify(list(body.brandTerms,10,80)),JSON.stringify(list(body.enquiryEvents,20,80)),JSON.stringify(keywords),town?.code??null,town?.name??null,String(body.contactName||'').trim().slice(0,120),email,at,at).run();
 return clientView(await db.prepare('SELECT * FROM seo_clients WHERE id=?').bind(id).first());
}
async function get(db,id){const r=await db.prepare('SELECT * FROM analytics_reports WHERE id=?').bind(id).first();if(!r)throw fail('Report not found.',404);return r;}
async function savedWork(db,id){const row=await db.prepare("SELECT data FROM analytics_report_data WHERE report_id=? AND kind='work'").bind(id).first();return row?JSON.parse(row.data).text:'';}
async function savedForms(db,id){const row=await db.prepare("SELECT data FROM analytics_report_data WHERE report_id=? AND kind='enquiries'").bind(id).first();return row?JSON.parse(row.data):null;}
const view=r=>({id:r.id,title:r.title,status:r.status,createdAt:r.created_at,notes:r.notes,clientId:r.client_id||null,...JSON.parse(r.state),report:r.report?JSON.parse(r.report):null,share:r.share_token?{token:r.share_token,url:SITE+'/report/'+r.share_token,createdAt:r.share_created_at,views:Number(r.share_views||0),lastViewedAt:r.share_last_viewed_at||null}:null});
async function lock(db,fn){const owner=crypto.randomUUID(),claim=await db.prepare('UPDATE analytics_report_lock SET owner=?,expires_at=? WHERE id=1 AND expires_at<?').bind(owner,new Date(Date.now()+120000).toISOString(),now()).run();if(!claim.meta.changes)throw fail('Another report step is running. Please wait a moment.',409);try{return await fn();}finally{await db.prepare('UPDATE analytics_report_lock SET expires_at=? WHERE id=1 AND owner=?').bind('2000-01-01',owner).run();}}
async function fetchStage(env,state,kind){
 if(kind.startsWith('gsc')){
  const range=kind.includes('Previous')?state.periods.previous:state.periods.current,dimensions=kind.endsWith('Totals')?[]:kind.endsWith('Pages')?['page']:kind.endsWith('Queries')?['query']:['date'];
  try{const token=await gscToken(env),d=await google(token,'https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(state.input.site)+'/searchAnalytics/query',{...range,dimensions,type:'web',dataState:'final',rowLimit:kind.endsWith('Trend')?200:100,...(state.input.country==='gbr'?{dimensionFilterGroups:[{filters:[{dimension:'country',operator:'equals',expression:'gbr'}]}]}:{})});const data={rows:(d.rows||[]).map(x=>({keys:(x.keys||[]).map(k=>String(k).slice(0,500)),clicks:x.clicks,impressions:x.impressions,ctr:x.ctr,position:x.position}))};if(data.rows.length===100&&!kind.endsWith('Trend'))state.warnings.push(`${kind}: top 100 rows returned. Lower-traffic rows may be absent.`);return data;}
  catch(e){if([401,403,503].includes(e.status))return {rows:[],error:e.message};throw e;}
 }
 if(kind.startsWith('rankings:')){
  // Google positions for the client's chosen searches, checked from their town.
  const c=state.client,chunk=c.keywords.slice(Number(kind.split(':')[1])*RANK_CHUNK,(Number(kind.split(':')[1])+1)*RANK_CHUNK);
  const siteUrl='https://'+String(state.input.site||'').replace(/^sc-domain:|^https?:\/\//,'').replace(/\/.*$/,'')+'/';
  const rows=await Promise.all(chunk.map(async keyword=>{
   try{const r=await dataForSeo(env,'serp/google/organic/live/advanced',{keyword,location_code:c.locationCode,language_code:'en',device:'desktop',os:'windows',depth:50},'seo-report');state.rankingCost=(state.rankingCost||0)+r.cost;const x=rankingFrom(r.result,siteUrl,c.name);return {keyword,position:x.position,url:x.url,inMapPack:x.inMapPack,mapPackShown:x.mapPackShown};}
   catch(e){return {keyword,position:null,error:e.message};}
  }));
  return {rows};
 }
 const token=await analyticsToken(env);return parseGa(await google(token,'https://analyticsdata.googleapis.com/v1beta/'+state.input.property+':runReport',gaRequest(state,kind)));
}
async function advance(env,id){return lock(env.JOBS_DB,async()=>{
 const db=env.JOBS_DB,r=await get(db,id);if(r.status!=='running')return view(r);const state=JSON.parse(r.state);
 if(state.stage<state.stages.length){
  // Google steps run several at a time; each ranking step (five live searches) runs on its own.
  const next=state.stages.slice(state.stage),first=next[0];
  const batch=first.startsWith('rankings:')?[first]:next.slice(0,PARALLEL_STAGES).filter((k,i)=>!k.startsWith('rankings:')&&(i===0||!next.slice(0,i).some(x=>x.startsWith('rankings:'))));
  const results=await Promise.all(batch.map(kind=>fetchStage(env,state,kind)));
  state.stage+=batch.length;
  await db.batch([...batch.map((kind,i)=>db.prepare('INSERT INTO analytics_report_data(report_id,kind,data) VALUES(?,?,?) ON CONFLICT(report_id,kind) DO UPDATE SET data=excluded.data').bind(id,kind,JSON.stringify(results[i]))),db.prepare('UPDATE analytics_reports SET state=?,updated_at=? WHERE id=?').bind(JSON.stringify(state),now(),id)]);
  return view(await get(db,id));
 }
 const chunks=await db.prepare('SELECT kind,data FROM analytics_report_data WHERE report_id=?').bind(id).all(),all=Object.fromEntries(chunks.results.map(r=>[r.kind,JSON.parse(r.data)]));
 const data=Object.fromEntries(Object.entries(all).filter(([k])=>!k.startsWith('rankings:')&&k!=='enquiries'&&k!=='work'));
 const report=buildAnalyticsReport(state,data);
 if(state.client){
  report.client={id:state.client.id,name:state.client.name,brandTerms:state.client.brandTerms,enquiryEvents:state.client.enquiryEvents,locationName:state.client.locationName};
  const current=Object.entries(all).filter(([k])=>k.startsWith('rankings:')).sort().flatMap(([,v])=>v.rows||[]);
  if(current.length){
   // Compare with the client's previous report that checked rankings.
   const prior=await db.prepare("SELECT report FROM analytics_reports WHERE client_id=? AND id<>? AND status='complete' AND report IS NOT NULL ORDER BY created_at DESC LIMIT 5").bind(state.client.id,id).all();
   const before=prior.results.map(x=>JSON.parse(x.report)).find(x=>x.rankings?.current?.length);
   report.rankings={current,previous:before?Object.fromEntries(before.rankings.current.map(x=>[x.keyword,x.position])):null,previousDate:before?.rankings?.checkedAt||null,checkedAt:now(),locationName:state.client.locationName};
  }
 }
 await db.prepare("UPDATE analytics_reports SET status='complete',report=?,updated_at=? WHERE id=?").bind(JSON.stringify(report),now(),id).run();return view(await get(db,id));
});}
// Public, unauthenticated: the client-safe view of a shared SEO report (called from /api/report/<token>).
export async function publicSeoReport(db,token,preview){
 const r=await db.prepare('SELECT * FROM analytics_reports WHERE share_token=?').bind(token).first();if(!r||r.status!=='complete')return null;
 if(!preview){const last=Date.parse(r.share_last_viewed_at||''),alert=!r.share_views||!(last>Date.now()-12*3600000);await db.prepare('UPDATE analytics_reports SET share_views=share_views+1,share_last_viewed_at=?,share_alert_due=CASE WHEN ? THEN ? ELSE share_alert_due END WHERE id=? AND share_token=?').bind(now(),alert?1:0,now(),r.id,token).run();}
 return seoClientView({...view(r),forms:await savedForms(db,r.id),work:await savedWork(db,r.id)});
}
export async function handleAnalyticsReport(request,env){try{
 const u=new URL(request.url),route=u.pathname.replace('/admin/analytics-reports/api/','').replace(/\/$/,'');if(!['GET','POST'].includes(request.method))throw fail('Method not allowed.',405);if(request.method==='POST'&&request.headers.get('Origin')!==u.origin)throw fail('Refresh the admin page before trying again.',403);
 const db=env.JOBS_DB;if(!db)throw fail('Report storage is unavailable.',503);let body={};if(request.method==='POST'){try{body=await decode(request,15000);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{throw fail('Invalid request.');}}
 if(route==='connection'&&request.method==='GET'){
  const [ga,gsc]=await Promise.allSettled([(async()=>analyticsProperties(await analyticsToken(env)))(),searchProperties(env)]);
  return json({connected:ga.status==='fulfilled',properties:ga.status==='fulfilled'?ga.value:[],message:ga.status==='rejected'?(ga.reason.status?ga.reason.message:'Google Analytics could not be reached. Refresh the connection to retry.'):'',sites:gsc.status==='fulfilled'?gsc.value:[],searchMessage:gsc.status==='rejected'?'Search Console is unavailable. You can still create an Analytics-only report.':''});
 }
 if(route==='history'&&request.method==='GET'){const r=await db.prepare('SELECT id,title,created_at,status FROM analytics_reports ORDER BY created_at DESC LIMIT 50').all();return json({reports:r.results});}
 if(route==='report'&&request.method==='GET'){const r=await get(db,u.searchParams.get('id'));return json({...view(r),forms:await savedForms(db,r.id),work:await savedWork(db,r.id)});}
 if(route==='work'&&request.method==='POST'){const r=await get(db,body.id);if(r.status!=='complete')throw fail('Complete the report before listing the work done.');const text=String(body.work||'').slice(0,8000);if(text.trim())await db.prepare("INSERT OR REPLACE INTO analytics_report_data(report_id,kind,data) VALUES(?,'work',?)").bind(r.id,JSON.stringify({text})).run();else await db.prepare("DELETE FROM analytics_report_data WHERE report_id=? AND kind='work'").bind(r.id).run();return json({ok:true,work:text});}
 if(route==='enquiries'&&request.method==='POST'){
  // Website form enquiries imported from the client's WordPress site. Only counts are stored.
  const r=await get(db,body.id);if(r.status!=='complete')throw fail('Complete the report before adding enquiries.');
  if(body.current===null||body.current===undefined){await db.prepare("DELETE FROM analytics_report_data WHERE report_id=? AND kind='enquiries'").bind(r.id).run();return json({ok:true});}
  const count=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);if(!Number.isInteger(n)||n<0||n>1000000)throw fail('Enquiry counts must be whole numbers.');return n;};
  const forms={current:count(body.current),previous:count(body.previous),file:String(body.file||'').slice(0,200),column:String(body.column||'').slice(0,120),savedAt:now()};
  await db.prepare("INSERT OR REPLACE INTO analytics_report_data(report_id,kind,data) VALUES(?,'enquiries',?)").bind(r.id,JSON.stringify(forms)).run();return json({ok:true,forms});
 }
 if(route==='clients'&&request.method==='GET'){const r=await db.prepare('SELECT * FROM seo_clients ORDER BY name').all();return json({clients:r.results.map(clientView)});}
 if(route==='client'&&request.method==='POST')return json({client:await saveClient(db,body)});
 if(route==='client-delete'&&request.method==='POST'){await db.prepare('DELETE FROM seo_clients WHERE id=?').bind(String(body.id||'')).run();return json({ok:true});}
 if(route==='share'&&request.method==='POST'){const r=await get(db,body.id);if(r.status!=='complete')throw fail('Complete the report before sharing it.');
  if(body.enable===false)await db.prepare('UPDATE analytics_reports SET share_token=NULL,share_created_at=NULL,share_views=0,share_last_viewed_at=NULL WHERE id=?').bind(r.id).run();
  else if(!r.share_token)await db.prepare('UPDATE analytics_reports SET share_token=?,share_created_at=?,share_views=0,share_last_viewed_at=NULL WHERE id=? AND share_token IS NULL').bind(newShareToken(),now(),r.id).run();
  return json(view(await get(db,r.id)));}
 if(route==='email'&&request.method==='POST'){const r=await get(db,body.id);if(r.status!=='complete')throw fail('Complete the report before emailing it.');
  const request=await reportEmailRequest(db,env,body);if(!request)return json(view(await get(db,r.id)));
  if(!r.share_token)await db.prepare('UPDATE analytics_reports SET share_token=?,share_created_at=?,share_views=0,share_last_viewed_at=NULL WHERE id=? AND share_token IS NULL').bind(newShareToken(),now(),r.id).run();
  const shared=await get(db,r.id),state=JSON.parse(shared.state),name=state.property?.name||'your business',url=SITE+'/report/'+shared.share_token;
  const sent=await queueReportEmail(db,env,{...request,url,linkLabel:'You can see the full report here:',company:state.client?.name||name,service:'SEO',source:'seo-report',subject:'SEO report: '+(state.client?.name||name),
   note:`SEO report emailed from the reporting tool: ${url}`,taskTitle:'Follow up SEO report: '+(state.client?.name||name),followUpKey:'seo-report-followup:'+shared.id,metadata:{lead_source:'seo-report',lead_temperature:'warm',report_id:shared.id}});
  state.emails=[...(state.emails||[]),sent].slice(-20);await db.prepare('UPDATE analytics_reports SET state=? WHERE id=?').bind(JSON.stringify(state),r.id).run();return json(view(await get(db,r.id)));}
 if(route==='start'&&request.method==='POST')return json(await lock(db,async()=>{
  let client=null;if(body.clientId){client=clientView(await db.prepare('SELECT * FROM seo_clients WHERE id=?').bind(String(body.clientId)).first());if(!client)throw fail('Saved client not found.',404);}
  let input;try{input=parseReportInput(client?{...body,property:client.property,site:client.site,country:client.country}:body);}catch(e){throw fail(e.message);}
  const active=await db.prepare("SELECT * FROM analytics_reports WHERE status='running' ORDER BY created_at DESC LIMIT 1").first();if(active)return {...view(active),resumed:true};
  const token=await analyticsToken(env),p=await google(token,'https://analyticsadmin.googleapis.com/v1beta/'+input.property);if(p.deleteTime||p.expireTime)throw fail('Choose an active Analytics property.');
  const property={id:input.property,name:p.displayName,timeZone:p.timeZone,currency:p.currencyCode};let periods;try{periods=reportPeriods(input,property.timeZone);}catch(e){throw fail(e.message);}
  const fingerprint=JSON.stringify({property:input.property,site:input.site,country:input.country,periods,client:client?{id:client.id,keywords:client.keywords,brand:client.brandTerms,events:client.enquiryEvents}:null});
  const cached=await db.prepare("SELECT * FROM analytics_reports WHERE fingerprint=? AND status='complete' AND created_at>? ORDER BY created_at DESC LIMIT 1").bind(fingerprint,new Date(Date.now()-86400000).toISOString()).first();if(cached&&!body.refresh)return {...view(cached),cached:true};
  if(input.site&&!(await searchProperties(env)).includes(input.site))throw fail('The selected Search Console property is not accessible to this connection.',403);
  const recent=await db.prepare('SELECT COUNT(*) AS n FROM analytics_reports WHERE created_at>?').bind(new Date(Date.now()-3600000).toISOString()).first();if(recent.n>=10)throw fail('Ten reports were started this hour. Open saved research or try again later.',429);
  const warnings=[];if(Date.parse(periods.current.endDate)>Date.now()-3*86400000)warnings.push('The report includes recent dates. Google can still process and revise the latest data.');
  if(input.site&&Date.parse(periods.previous.startDate)<Date.now()-480*86400000)warnings.push('The comparison extends beyond roughly 16 months of Search Console history. Older search data may be incomplete.');
  const ranks=client&&client.keywords.length&&client.locationCode&&input.site&&env.DATAFORSEO_LOGIN&&env.DATAFORSEO_PASSWORD?Array.from({length:Math.ceil(client.keywords.length/RANK_CHUNK)},(_,i)=>'rankings:'+i):[];
  if(client&&client.keywords.length&&!ranks.length)warnings.push('Rankings were not checked: the client needs a town, a Search Console property and a DataForSEO connection.');
  const id=crypto.randomUUID(),state={input,property,periods,stage:0,stages:[...Object.keys(gaSets),...(input.site?gscKinds:[]),...ranks],warnings,client:client&&{id:client.id,name:client.name,brandTerms:client.brandTerms,enquiryEvents:client.enquiryEvents,keywords:client.keywords,locationCode:client.locationCode,locationName:client.locationName,contactName:client.contactName,contactEmail:client.contactEmail}},title=`${client?.name||property.name} · ${periods.current.startDate} to ${periods.current.endDate}`;
  await db.prepare("INSERT INTO analytics_reports(id,fingerprint,property,title,created_at,updated_at,status,state,client_id) VALUES(?,?,?,?,?,?,'running',?,?)").bind(id,fingerprint,input.property,title,now(),now(),JSON.stringify(state),client?.id||null).run();return view(await get(db,id));
 }));
 if(route==='advance'&&request.method==='POST')return json(await advance(env,body.id));
 if(route==='stop'&&request.method==='POST')return json(await lock(db,async()=>{const r=await get(db,body.id);if(r.status==='running')await db.prepare("UPDATE analytics_reports SET status='stopped',updated_at=? WHERE id=?").bind(now(),body.id).run();return view(await get(db,body.id));}));
 if(route==='notes'&&request.method==='POST'){const r=await get(db,body.id);if(r.status!=='complete')throw fail('Complete the report before adding client notes.');await db.prepare('UPDATE analytics_reports SET notes=?,updated_at=? WHERE id=?').bind(String(body.notes||'').slice(0,6000),now(),body.id).run();return json({ok:true});}
 throw fail('Not found.',404);
}catch(e){return json({error:e.status?e.message:'This report step could not complete. Saved progress is available to resume.'},e.status||500);}}
