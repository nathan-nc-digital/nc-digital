import { auditUrl,auditFetch,parsePage,crawlLinks,robotsPolicy,findingsFor,scoreFor,pageSpeedUrl,pageSpeedSummary } from './website-audit.js';
import { readLimitedBody } from './social-http.js';
import { dataForSeo } from './keyword-research.js';
import { mapKeyword } from './keyword-planner.js';
import { clientView,OFFER_CHOICES } from './audit-report-view.js';
import { CRM_MAILBOX,CRM_FROM_ADDRESS } from './crm.js';
import { reportEmailRequest,queueReportEmail,newShareToken } from './report-email.js';
import { publicSeoReport } from './analytics-report-api.js';
import { zohoConfigured,zohoClient } from './crm-zoho.js';
import { localSearchInput,localKeywordList,rankingQueue,rankingFrom } from './audit-local-search.js';
const now=()=>new Date().toISOString();
const SITE='https://nc-digital.co.uk';
// 18 random bytes as base64url: 24 characters, 144 bits, so links cannot be guessed or enumerated.
const newToken=newShareToken;
// A return visit alerts again only after this gap, so one reading session sends one email.
const ALERT_GAP_MS=12*3600000;
// Scheduled: email Nathan that someone has opened (or come back to) a shared website review or SEO report.
const ALERT_SOURCES=[
  {table:'website_audits',label:'website review',admin:'/admin/website-audit/?report=',name:r=>r.client},
  {table:'analytics_reports',label:'SEO report',admin:'/admin/analytics-reports/?report=',name:r=>{const s=JSON.parse(r.state);return s.client?.name||s.property?.name||'A client';}},
];
export async function runReportAlerts(env){
  const db=env.JOBS_DB;if(!db||env.CRM_ENABLED!=='true'||!zohoConfigured(env))return;
  const due=[];
  for(const source of ALERT_SOURCES){const {results}=await db.prepare(`SELECT * FROM ${source.table} WHERE share_alert_due IS NOT NULL AND share_token IS NOT NULL LIMIT 3`).all();due.push(...results.map(r=>({r,source})));}
  if(!due.length)return;
  const api=await zohoClient(env);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  for(const {r,source} of due.slice(0,3)){
    const claim=await db.prepare(`UPDATE ${source.table} SET share_alert_due=NULL,share_alerted_at=? WHERE id=? AND share_alert_due=?`).bind(now(),r.id,r.share_alert_due).run();
    if(!claim.meta.changes)continue;
    const name=source.name(r),email=(JSON.parse(r.state).emails||[]).at(-1),again=Boolean(r.share_alerted_at);
    const content=`<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1b2430"><p><strong>${esc(name)}</strong> ${again?'has come back to':'has just opened'} their ${source.label}${again?` (${r.share_views} views so far)`:''}.</p><p>Now is a good time to follow up while it is fresh.</p><p><a href="${SITE}${source.admin}${encodeURIComponent(r.id)}">Open the report in your admin</a>${email?` · <a href="${SITE}/admin/crm/?ticket=${encodeURIComponent(email.ticketId)}">Their CRM conversation (${esc(email.name||email.to)})</a>`:''}</p></div>`;
    try{await api('/messages',{fromAddress:CRM_FROM_ADDRESS,toAddress:CRM_MAILBOX,subject:`${name} ${again?'is looking at':'just opened'} their ${source.label}`,content,mailFormat:'html',encoding:'UTF-8'});}
    catch{await db.prepare(`UPDATE ${source.table} SET share_alert_due=COALESCE(share_alert_due,?) WHERE id=?`).bind(now(),r.id).run();}
  }
}
const PUBLIC_HEADERS={'Content-Type':'application/json','Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'};
// Public, unauthenticated: /api/report/<token> returns only the client-safe view of a shared audit.
export async function handlePublicReport(request,env){
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:PUBLIC_HEADERS});
  try{
    if(request.method!=='GET')return reply({error:'Method not allowed.'},405);
    const match=new URL(request.url).pathname.match(/^\/api\/report\/([A-Za-z0-9_-]{24})\/?$/);
    const r=match&&env.JOBS_DB?await env.JOBS_DB.prepare('SELECT * FROM website_audits WHERE share_token=?').bind(match[1]).first():null;
    if(!r){
      // Not a website review: it may be a shared SEO report.
      const seo=match&&env.JOBS_DB?await publicSeoReport(env.JOBS_DB,match[1],new URL(request.url).searchParams.has('preview')):null;
      return seo?reply(seo):reply({error:'This report link is not available. Please contact NC Digital for an up-to-date copy.'},404);
    }
    // Nathan's own previews (?preview=1 from the admin) are not counted and never alert.
    if(!new URL(request.url).searchParams.has('preview')){
      const lastSeen=Date.parse(r.share_last_viewed_at||''),alert=!r.share_views||!(lastSeen>Date.now()-ALERT_GAP_MS);
      await env.JOBS_DB.prepare('UPDATE website_audits SET share_views=share_views+1,share_last_viewed_at=?,share_alert_due=CASE WHEN ? THEN ? ELSE share_alert_due END WHERE id=? AND share_token=?').bind(now(),alert?1:0,now(),r.id,match[1]).run();
    }
    // During an in-place update the client keeps seeing the last completed version.
    return reply(clientView(present(r.previous_state?{...r,state:r.previous_state,status:'complete'}:r)));
  }catch{return reply({error:'This report could not be loaded. Please try again shortly.'},500);}
}
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store, private','X-Robots-Tag':'noindex'}});
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
async function row(db,id){const r=await db.prepare('SELECT * FROM website_audits WHERE id=?').bind(id).first();if(!r)throw fail('Audit not found.',404);return r;}
function present(r){const state=JSON.parse(r.state);const findings=findingsFor(state);return {id:r.id,url:r.url,client:r.client,createdAt:r.created_at,status:r.status,notes:r.notes,summary:r.summary,...state,findings,score:scoreFor(state,findings),share:r.share_token?{token:r.share_token,url:SITE+'/report/'+r.share_token,createdAt:r.share_created_at,views:Number(r.share_views||0),lastViewedAt:r.share_last_viewed_at||null}:null};}
async function lock(db,fn){const owner=crypto.randomUUID();const claim=await db.prepare('UPDATE website_audit_lock SET owner=?,expires_at=? WHERE id=1 AND expires_at<?').bind(owner,new Date(Date.now()+100000).toISOString(),now()).run();if(!claim.meta.changes)throw fail('An audit step is already running. Please wait a moment.',409);try{return await fn();}finally{await db.prepare('UPDATE website_audit_lock SET expires_at=? WHERE id=1 AND owner=?').bind('2000-01-01',owner).run();}}
async function save(db,id,state,status='running'){await db.prepare("UPDATE website_audits SET state=?,status=?,updated_at=?,previous_state=CASE WHEN ?='complete' THEN NULL ELSE previous_state END WHERE id=?").bind(JSON.stringify(state),status,now(),status,id).run();}
// A sitemap counts only when it is real XML: many sites answer every address with an HTML page.
async function isSitemap(url){
  let response=await auditFetch(url,{method:'HEAD'});
  if(response.status===200&&/xml/i.test(response.type))return true;
  if(![200,403,405,501].includes(response.status))return false;
  try{response=await auditFetch(url,{max:3000000});}catch(e){if(e.status===413)return true;throw e;}
  return response.status===200&&/<(?:urlset|sitemapindex)[\s>]/i.test(response.html.slice(0,5000));
}
async function pageSpeed(env,url,strategy){
  if(!env.PAGESPEED_API_KEY)return {error:'PageSpeed Insights API key is not configured (PAGESPEED_API_KEY), so speed was not measured.'};
  const request=async trimmed=>{const response=await fetch(pageSpeedUrl(url,strategy,env.PAGESPEED_API_KEY,{trimmed}),{signal:AbortSignal.timeout(45000)});let body=null;try{body=JSON.parse(new TextDecoder().decode(await readLimitedBody(response,12000000)));}catch{}return {response,body};};
  try{
    let {response,body}=await request(true);
    // Fall back to the full response if Google ever rejects the partial-response field list
    // (it answers a bad field list with a generic 400 "invalid argument").
    if(response.status===400)({response,body}=await request(false));
    if(!response.ok||!body)return {error:`PageSpeed Insights could not test the page (HTTP ${response.status}${body?.error?.message?': '+String(body.error.message).slice(0,200):''}).`};
    return pageSpeedSummary(body);
  }catch(e){return {error:e?.name==='TimeoutError'?'PageSpeed Insights timed out testing the page.':'PageSpeed Insights could not test the page.'};}
}
async function advance(env,id){return lock(env.JOBS_DB,async()=>{
  const db=env.JOBS_DB,r=await row(db,id);if(r.status!=='running')return present(r);const state=JSON.parse(r.state);
  if(state.phase==='robots'){
    try{const response=await auditFetch(new URL('/robots.txt',r.url).href,{max:120000,successBodyOnly:true});state.robotsStatus=response.status;
      if(response.status===200){if(/<html/i.test(response.html))throw new Error('The robots address returned HTML instead of crawl rules.');state.robots=response.html;}else if(![404,410].includes(response.status))throw new Error('Crawl rules could not be confirmed (HTTP '+response.status+').');
      state.phase='pages';
    }catch(e){state.warnings.push('Audit paused without crawling: '+e.message);state.phase='done';}
  }else if(state.phase==='pages'){
    const target=state.queue.shift();
    if(target){
      if(!robotsPolicy(state.robots,new URL(target).pathname)){state.skipped.push({url:target,reason:'Excluded by robots.txt'});}
      else try{
        const p=await auditFetch(target);const record={url:p.url,requestedUrl:target,status:p.status,bytes:p.bytes,responseMs:p.responseMs,redirects:p.redirects,robots:p.robots};
        if(p.status===200&&/text\/html|application\/xhtml\+xml/i.test(p.type)){
          record.parsed=parsePage(p.html,p.url);
          if(state.pages.length===0){state.origin=new URL(p.url).origin;state.finalUrl=p.url;}
          const links=crawlLinks(record.parsed,state.origin);state.discovered=[...new Set([...state.discovered,...links])].slice(0,80);
          for(const link of links)if(!state.pages.some(x=>x.url===link||x.requestedUrl===link)&&link!==p.url&&link!==target&&!state.queue.includes(link))state.queue.push(link);
          state.queue=state.queue.slice(0,60);
        }else record.error=p.status===200?'This address did not return HTML.':'HTTP '+p.status+'; page content was not evaluated.';
        state.pages.push(record);
      }catch(e){state.pages.push({url:target,requestedUrl:target,error:e.message});}
    }
    if(state.pages.length+state.skipped.length>=state.maxPages||!state.queue.length){state.phase='links';state.queue=state.discovered.filter(u=>!state.pages.some(p=>p.url===u||p.requestedUrl===u)&&robotsPolicy(state.robots,new URL(u).pathname)).slice(0,20);}
  }else if(state.phase==='links'){
    const target=state.queue.shift();if(target){
      try{let response=await auditFetch(target,{method:'HEAD'});if([404,410,405,501].includes(response.status))response=await auditFetch(target);state.linkChecks.push({url:target,finalUrl:response.url,status:response.status});}catch(e){state.linkChecks.push({url:target,error:e.message});}
    }if(!state.queue.length)state.phase='https';
  }else if(state.phase==='https'){
    const site=new URL(state.finalUrl||r.url);
    if(site.protocol==='https:'){
      const target='http://'+site.hostname+'/';
      try{let response=await auditFetch(target,{method:'HEAD'});if([405,501].includes(response.status))response=await auditFetch(target);state.httpRedirect={checked:true,url:target,status:response.status,finalUrl:response.url,redirects:response.url.startsWith('https:')};}
      catch(e){state.httpRedirect={checked:false,url:target,error:e.message};}
    }
    const listed=[...(state.robots||'').matchAll(/^\s*sitemap:\s*(\S+)/gim)].map(m=>m[1]).filter(u=>{try{return new URL(u).hostname.replace(/^www\./,'')===site.hostname.replace(/^www\./,'');}catch{return false;}}).slice(0,2);
    state.sitemap={checked:false,found:false,url:null,listedInRobots:listed.length>0,tried:[]};
    state.queue=[...new Set([...listed,site.origin+'/sitemap.xml',site.origin+'/sitemap_index.xml',site.origin+'/wp-sitemap.xml'])].slice(0,4);
    state.phase='sitemap';
  }else if(state.phase==='sitemap'){
    const target=state.queue.shift();
    if(target){state.sitemap.tried.push(target);try{if(await isSitemap(target)){state.sitemap.found=true;state.sitemap.url=target;state.queue=[];}}catch{}}
    if(!state.queue.length){state.sitemap.checked=true;state.phase='speed-mobile';}
  }else if(state.phase==='speed-mobile'||state.phase==='speed-desktop'){
    const strategy=state.phase==='speed-mobile'?'mobile':'desktop';
    state.speed={...(state.speed||{}),[strategy]:await pageSpeed(env,state.finalUrl||r.url,strategy)};
    state.phase=strategy==='mobile'?'speed-desktop':state.local?'keywords':'done';
  }else if(state.phase==='keywords'){
    const local=state.local,list=localKeywordList(local);
    local.keywords=list.map(keyword=>({keyword,volume:null,cpc:null}));
    if(!env.DATAFORSEO_LOGIN||!env.DATAFORSEO_PASSWORD){local.error='DataForSEO is not connected, so local search demand and rankings were not checked.';state.phase='done';}
    else{
      try{const res=await dataForSeo(env,'dataforseo_labs/google/keyword_overview/live',{location_code:2826,language_code:'en',keywords:list,include_serp_info:false},'website-audit');local.cost+=res.cost;const measured=new Map((res.result?.items||[]).map(x=>mapKeyword(x)).map(x=>[x.keyword,x]));local.keywords=list.map(keyword=>({keyword,volume:measured.get(keyword)?.volume??null,cpc:measured.get(keyword)?.cpc??null}));}
      catch(e){local.warning='Search volumes could not be retrieved: '+e.message;}
      local.queue=rankingQueue(local.keywords);state.phase='rankings';
    }
  }else if(state.phase==='rankings'){
    const local=state.local,keyword=local.queue.shift();
    if(keyword){
      try{const res=await dataForSeo(env,'serp/google/organic/live/advanced',{keyword,location_code:local.locationCode,language_code:'en',device:'desktop',os:'windows',depth:30},'website-audit');local.cost+=res.cost;Object.assign(local.keywords.find(k=>k.keyword===keyword),rankingFrom(res.result,state.finalUrl||r.url,r.client));}
      catch(e){
        // Account problems stop every remaining check; anything else (e.g. Google's own error, code
        // 40101) is retried once at the end of the queue, then just that search is marked unchecked.
        const entry=local.keywords.find(k=>k.keyword===keyword);
        if(/credentials were rejected|needs account credit|not connected/.test(e.message)){local.error='Google rankings could not be checked: '+e.message;local.queue=[];}
        else if(!entry.retried){entry.retried=true;local.queue.push(keyword);}
        else{entry.checkError=e.message;local.warning=[local.warning,`“${keyword}” could not be checked: ${e.message}`].filter(Boolean).join(' ');}
      }
    }
    if(!local.queue.length)state.phase='done';
  }
  if(state.phase==='done'&&!state.pages.some(p=>p.parsed))state.warnings.push('No HTML pages were successfully audited. This report cannot assess website quality.');
  await save(db,id,state,state.phase==='done'?'complete':'running');return present(await row(db,id));
});}
export async function handleWebsiteAudit(request,env){try{
  const u=new URL(request.url),route=u.pathname.replace('/admin/website-audit/api/','').replace(/\/$/,'');const db=env.JOBS_DB;
  if(!['GET','POST'].includes(request.method))throw fail('Method not allowed.',405);
  if(request.method==='POST'&&request.headers.get('Origin')!==u.origin)throw fail('Refresh the admin page and try again.',403);
  if(!db)throw fail('Audit storage is not available.',503);
  let body={};if(request.method==='POST'){try{body=JSON.parse(new TextDecoder().decode(await readLimitedBody(request,20000)));if(!body||typeof body!=='object')throw new Error();}catch{throw fail('Invalid request.');}}
  if(route==='history'&&request.method==='GET'){const r=await db.prepare('SELECT id,url,client,created_at,status FROM website_audits ORDER BY created_at DESC LIMIT 50').all();return json({reports:r.results});}
  if(route==='report'&&request.method==='GET')return json(present(await row(db,u.searchParams.get('id'))));
  if(route==='start'&&request.method==='POST')return json(await lock(db,async()=>{
    let target,local;try{target=auditUrl(String(body.url||'').trim());local=localSearchInput(body);}catch(e){throw fail(e.message);}const maxPages=Number(body.maxPages||10);if(![5,10].includes(maxPages))throw fail('Choose five or ten pages.');
    const client=String(body.client||target.hostname).trim().slice(0,120);
    const active=await db.prepare("SELECT * FROM website_audits WHERE status='running' ORDER BY created_at DESC LIMIT 1").first();if(active)return present(active);
    if(!body.refresh){
      // Reuse the newest saved audit with the same size and local search, so reopening never re-buys data.
      const {results:recent}=await db.prepare("SELECT * FROM website_audits WHERE url=? AND status='complete' AND created_at>? ORDER BY created_at DESC LIMIT 20").bind(target.href,new Date(Date.now()-7*86400000).toISOString()).all();
      const cached=recent.find(row=>{const saved=JSON.parse(row.state);return saved.maxPages===maxPages&&saved.pages.some(p=>p.parsed)&&(saved.local?.service||null)===(local?.service||null)&&(saved.local?.locationCode||null)===(local?.locationCode||null);});
      if(cached)return {...present(cached),cached:true};
    }
    const count=await db.prepare('SELECT COUNT(*) AS n FROM website_audits WHERE created_at>?').bind(new Date(Date.now()-3600000).toISOString()).first();if(count.n>=10)throw fail('Ten audits have been started this hour. Open a saved report or try again later.',429);
    const id=crypto.randomUUID(),state={phase:'robots',maxPages,origin:target.origin,finalUrl:null,pages:[],queue:[target.href],discovered:[],linkChecks:[],skipped:[],warnings:[],robots:'',robotsStatus:null,local};
    await db.prepare("INSERT INTO website_audits(id,url,client,created_at,updated_at,status,state) VALUES(?,?,?,?,?,'running',?)").bind(id,target.href,client,now(),now(),JSON.stringify(state)).run();return present(await row(db,id));
  }));
  if(route==='rerun'&&request.method==='POST')return json(await lock(db,async()=>{
    // Re-runs every check into the same report so its client link, notes, offer and email
    // history carry over; the public link shows the previous version until this run completes.
    const r=await row(db,body.id);
    if(r.status==='running')throw fail('This report is already updating.',409);
    if(await db.prepare("SELECT id FROM website_audits WHERE status='running' LIMIT 1").first())throw fail('Another audit is running. Wait for it to finish, then update this report.',409);
    const count=await db.prepare('SELECT COUNT(*) AS n FROM website_audits WHERE created_at>?').bind(new Date(Date.now()-3600000).toISOString()).first();if(count.n>=10)throw fail('Ten audits have been started this hour. Try again later.',429);
    const old=JSON.parse(r.state),target=auditUrl(r.url),l=old.local;
    const local=l?{service:l.service,town:l.town,townLabel:l.townLabel,locationCode:l.locationCode,locationName:l.locationName,keywords:[],queue:[],cost:0,error:null,warning:null}:null;
    const state={phase:'robots',maxPages:old.maxPages||10,origin:target.origin,finalUrl:null,pages:[],queue:[target.href],discovered:[],linkChecks:[],skipped:[],warnings:[],robots:'',robotsStatus:null,local,...(old.offer?{offer:old.offer}:{}),...(old.emails?{emails:old.emails}:{})};
    const previous=r.status==='complete'?r.state:(r.previous_state||null);
    await db.prepare("UPDATE website_audits SET state=?,previous_state=?,status='running',created_at=?,updated_at=? WHERE id=?").bind(JSON.stringify(state),previous,now(),now(),r.id).run();
    return present(await row(db,r.id));
  }));
  if(route==='advance'&&request.method==='POST')return json(await advance(env,body.id));
  if(route==='stop'&&request.method==='POST')return json(await lock(db,async()=>{await row(db,body.id);await db.prepare("UPDATE website_audits SET status='stopped',updated_at=? WHERE id=?").bind(now(),body.id).run();return present(await row(db,body.id));}));
  if(route==='email'&&request.method==='POST'){
    const r=await row(db,body.id),request=await reportEmailRequest(db,env,body);
    if(!request)return json(present(await row(db,r.id)));
    if(!r.share_token)await db.prepare('UPDATE website_audits SET share_token=?,share_created_at=?,share_views=0,share_last_viewed_at=NULL WHERE id=? AND share_token IS NULL').bind(newToken(),now(),r.id).run();
    const shared=await row(db,r.id),url=SITE+'/report/'+shared.share_token,state=JSON.parse(shared.state);
    const sent=await queueReportEmail(db,env,{...request,url,linkLabel:'You can see the full review here:',company:shared.client,service:state.local?.service,source:'website-audit',subject:'Website review: '+shared.client,
      note:`Website review emailed from the audit tool: ${url}`,taskTitle:'Follow up website review: '+(request.name||shared.client),followUpKey:'audit-followup:'+shared.id,
      metadata:{lead_source:'website-audit',lead_temperature:'warm',website_url:shared.url,audit_id:shared.id}});
    const latest=await row(db,r.id),latestState=JSON.parse(latest.state);
    latestState.emails=[...(latestState.emails||[]),sent].slice(-20);
    await db.prepare('UPDATE website_audits SET state=? WHERE id=?').bind(JSON.stringify(latestState),r.id).run();
    return json(present(await row(db,r.id)));
  }
  if(route==='share'&&request.method==='POST'){const r=await row(db,body.id);
    if(body.enable===false)await db.prepare('UPDATE website_audits SET share_token=NULL,share_created_at=NULL,share_views=0,share_last_viewed_at=NULL WHERE id=?').bind(r.id).run();
    else if(!r.share_token)await db.prepare('UPDATE website_audits SET share_token=?,share_created_at=?,share_views=0,share_last_viewed_at=NULL WHERE id=? AND share_token IS NULL').bind(newToken(),now(),r.id).run();
    return json(present(await row(db,r.id)));
  }
  if(route==='notes'&&request.method==='POST'){const existing=await row(db,body.id);const state=JSON.parse(existing.state);if(body.offer!==undefined){if(!OFFER_CHOICES.includes(body.offer))throw fail('Choose what to offer.');state.offer=body.offer;}await db.prepare('UPDATE website_audits SET notes=?,summary=?,client=?,state=?,updated_at=? WHERE id=?').bind(String(body.notes||'').slice(0,6000),String(body.summary||'').slice(0,4000),String(body.client||'Website audit').slice(0,120),JSON.stringify(state),now(),body.id).run();return json({ok:true});}
  throw fail('Not found.',404);
}catch(e){return json({error:e.status?e.message:'The audit could not complete this request. Any saved progress has been kept.'},e.status||500);}}
