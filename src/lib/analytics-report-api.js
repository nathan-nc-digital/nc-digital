import {readLimitedBody} from './social-http.js';
import {googleToken as gscToken} from './seo-quick-wins-api.js';
import {parseReportInput,reportPeriods,gaSets,gaRequest,parseGa,buildAnalyticsReport} from './analytics-report.js';
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
async function get(db,id){const r=await db.prepare('SELECT * FROM analytics_reports WHERE id=?').bind(id).first();if(!r)throw fail('Report not found.',404);return r;}
const view=r=>({id:r.id,title:r.title,status:r.status,createdAt:r.created_at,notes:r.notes,...JSON.parse(r.state),report:r.report?JSON.parse(r.report):null});
async function lock(db,fn){const owner=crypto.randomUUID(),claim=await db.prepare('UPDATE analytics_report_lock SET owner=?,expires_at=? WHERE id=1 AND expires_at<?').bind(owner,new Date(Date.now()+120000).toISOString(),now()).run();if(!claim.meta.changes)throw fail('Another report step is running. Please wait a moment.',409);try{return await fn();}finally{await db.prepare('UPDATE analytics_report_lock SET expires_at=? WHERE id=1 AND owner=?').bind('2000-01-01',owner).run();}}
async function advance(env,id){return lock(env.JOBS_DB,async()=>{
 const db=env.JOBS_DB,r=await get(db,id);if(r.status!=='running')return view(r);const state=JSON.parse(r.state),kind=state.stages[state.stage];
 if(kind){let data;
  if(kind.startsWith('gsc')){
   const range=kind.includes('Previous')?state.periods.previous:state.periods.current,dimensions=kind.endsWith('Totals')?[]:kind.endsWith('Pages')?['page']:kind.endsWith('Queries')?['query']:['date'];
   try{const token=await gscToken(env),d=await google(token,'https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(state.input.site)+'/searchAnalytics/query',{...range,dimensions,type:'web',dataState:'final',rowLimit:kind.endsWith('Trend')?200:100,...(state.input.country==='gbr'?{dimensionFilterGroups:[{filters:[{dimension:'country',operator:'equals',expression:'gbr'}]}]}:{})});data={rows:(d.rows||[]).map(x=>({keys:(x.keys||[]).map(k=>String(k).slice(0,500)),clicks:x.clicks,impressions:x.impressions,ctr:x.ctr,position:x.position}))};if(data.rows.length===100&&!kind.endsWith('Trend'))state.warnings.push(`${kind}: top 100 rows returned. Lower-traffic rows may be absent.`);}
   catch(e){if([401,403,503].includes(e.status))data={rows:[],error:e.message};else throw e;}
  }else{const token=await analyticsToken(env);data=parseGa(await google(token,'https://analyticsdata.googleapis.com/v1beta/'+state.input.property+':runReport',gaRequest(state,kind)));}
  state.stage++;
  await db.batch([db.prepare('INSERT INTO analytics_report_data(report_id,kind,data) VALUES(?,?,?) ON CONFLICT(report_id,kind) DO UPDATE SET data=excluded.data').bind(id,kind,JSON.stringify(data)),db.prepare('UPDATE analytics_reports SET state=?,updated_at=? WHERE id=?').bind(JSON.stringify(state),now(),id)]);
  return view(await get(db,id));
 }
 const chunks=await db.prepare('SELECT kind,data FROM analytics_report_data WHERE report_id=?').bind(id).all(),data=Object.fromEntries(chunks.results.map(r=>[r.kind,JSON.parse(r.data)]));
 const report=buildAnalyticsReport(state,data);await db.prepare("UPDATE analytics_reports SET status='complete',report=?,updated_at=? WHERE id=?").bind(JSON.stringify(report),now(),id).run();return view(await get(db,id));
});}
export async function handleAnalyticsReport(request,env){try{
 const u=new URL(request.url),route=u.pathname.replace('/admin/analytics-reports/api/','').replace(/\/$/,'');if(!['GET','POST'].includes(request.method))throw fail('Method not allowed.',405);if(request.method==='POST'&&request.headers.get('Origin')!==u.origin)throw fail('Refresh the admin page before trying again.',403);
 const db=env.JOBS_DB;if(!db)throw fail('Report storage is unavailable.',503);let body={};if(request.method==='POST'){try{body=await decode(request,15000);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{throw fail('Invalid request.');}}
 if(route==='connection'&&request.method==='GET'){
  const [ga,gsc]=await Promise.allSettled([(async()=>analyticsProperties(await analyticsToken(env)))(),searchProperties(env)]);
  return json({connected:ga.status==='fulfilled',properties:ga.status==='fulfilled'?ga.value:[],message:ga.status==='rejected'?(ga.reason.status?ga.reason.message:'Google Analytics could not be reached. Refresh the connection to retry.'):'',sites:gsc.status==='fulfilled'?gsc.value:[],searchMessage:gsc.status==='rejected'?'Search Console is unavailable. You can still create an Analytics-only report.':''});
 }
 if(route==='history'&&request.method==='GET'){const r=await db.prepare('SELECT id,title,created_at,status FROM analytics_reports ORDER BY created_at DESC LIMIT 50').all();return json({reports:r.results});}
 if(route==='report'&&request.method==='GET')return json(view(await get(db,u.searchParams.get('id'))));
 if(route==='start'&&request.method==='POST')return json(await lock(db,async()=>{
  let input;try{input=parseReportInput(body);}catch(e){throw fail(e.message);}
  const active=await db.prepare("SELECT * FROM analytics_reports WHERE status='running' ORDER BY created_at DESC LIMIT 1").first();if(active)return {...view(active),resumed:true};
  const token=await analyticsToken(env),p=await google(token,'https://analyticsadmin.googleapis.com/v1beta/'+input.property);if(p.deleteTime||p.expireTime)throw fail('Choose an active Analytics property.');
  const property={id:input.property,name:p.displayName,timeZone:p.timeZone,currency:p.currencyCode};let periods;try{periods=reportPeriods(input,property.timeZone);}catch(e){throw fail(e.message);}
  const fingerprint=JSON.stringify({property:input.property,site:input.site,country:input.country,periods});
  const cached=await db.prepare("SELECT * FROM analytics_reports WHERE fingerprint=? AND status='complete' AND created_at>? ORDER BY created_at DESC LIMIT 1").bind(fingerprint,new Date(Date.now()-86400000).toISOString()).first();if(cached&&!body.refresh)return {...view(cached),cached:true};
  if(input.site&&!(await searchProperties(env)).includes(input.site))throw fail('The selected Search Console property is not accessible to this connection.',403);
  const recent=await db.prepare('SELECT COUNT(*) AS n FROM analytics_reports WHERE created_at>?').bind(new Date(Date.now()-3600000).toISOString()).first();if(recent.n>=10)throw fail('Ten reports were started this hour. Open saved research or try again later.',429);
  const warnings=[];if(Date.parse(periods.current.endDate)>Date.now()-3*86400000)warnings.push('The report includes recent dates. Google can still process and revise the latest data.');
  if(input.site&&Date.parse(periods.previous.startDate)<Date.now()-480*86400000)warnings.push('The comparison extends beyond roughly 16 months of Search Console history. Older search data may be incomplete.');
  const id=crypto.randomUUID(),state={input,property,periods,stage:0,stages:[...Object.keys(gaSets),...(input.site?gscKinds:[])],warnings},title=`${property.name} · ${periods.current.startDate} to ${periods.current.endDate}`;
  await db.prepare("INSERT INTO analytics_reports(id,fingerprint,property,title,created_at,updated_at,status,state) VALUES(?,?,?,?,?,?,'running',?)").bind(id,fingerprint,input.property,title,now(),now(),JSON.stringify(state)).run();return view(await get(db,id));
 }));
 if(route==='advance'&&request.method==='POST')return json(await advance(env,body.id));
 if(route==='stop'&&request.method==='POST')return json(await lock(db,async()=>{const r=await get(db,body.id);if(r.status==='running')await db.prepare("UPDATE analytics_reports SET status='stopped',updated_at=? WHERE id=?").bind(now(),body.id).run();return view(await get(db,body.id));}));
 if(route==='notes'&&request.method==='POST'){const r=await get(db,body.id);if(r.status!=='complete')throw fail('Complete the report before adding client notes.');await db.prepare('UPDATE analytics_reports SET notes=?,updated_at=? WHERE id=?').bind(String(body.notes||'').slice(0,6000),now(),body.id).run();return json({ok:true});}
 throw fail('Not found.',404);
}catch(e){return json({error:e.status?e.message:'This report step could not complete. Saved progress is available to resume.'},e.status||500);}}
