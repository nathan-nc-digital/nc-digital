import { auditUrl,auditFetch,parsePage,crawlLinks,robotsPolicy,findingsFor } from './website-audit.js';
import { readLimitedBody } from './social-http.js';
const now=()=>new Date().toISOString();
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store, private','X-Robots-Tag':'noindex'}});
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
async function row(db,id){const r=await db.prepare('SELECT * FROM website_audits WHERE id=?').bind(id).first();if(!r)throw fail('Audit not found.',404);return r;}
function present(r){const state=JSON.parse(r.state);return {id:r.id,url:r.url,client:r.client,createdAt:r.created_at,status:r.status,notes:r.notes,summary:r.summary,...state,findings:findingsFor(state)};}
async function lock(db,fn){const owner=crypto.randomUUID();const claim=await db.prepare('UPDATE website_audit_lock SET owner=?,expires_at=? WHERE id=1 AND expires_at<?').bind(owner,new Date(Date.now()+100000).toISOString(),now()).run();if(!claim.meta.changes)throw fail('An audit step is already running. Please wait a moment.',409);try{return await fn();}finally{await db.prepare('UPDATE website_audit_lock SET expires_at=? WHERE id=1 AND owner=?').bind('2000-01-01',owner).run();}}
async function save(db,id,state,status='running'){await db.prepare('UPDATE website_audits SET state=?,status=?,updated_at=? WHERE id=?').bind(JSON.stringify(state),status,now(),id).run();}
async function advance(env,id){return lock(env.JOBS_DB,async()=>{
  const db=env.JOBS_DB,r=await row(db,id);if(r.status!=='running')return present(r);const state=JSON.parse(r.state);
  if(state.phase==='robots'){
    try{const response=await auditFetch(new URL('/robots.txt',r.url).href,{max:120000});state.robotsStatus=response.status;
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
    }if(!state.queue.length)state.phase='done';
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
    let target;try{target=auditUrl(String(body.url||'').trim());}catch(e){throw fail(e.message);}const maxPages=Number(body.maxPages||10);if(![5,10].includes(maxPages))throw fail('Choose five or ten pages.');
    const client=String(body.client||target.hostname).trim().slice(0,120);
    const active=await db.prepare("SELECT * FROM website_audits WHERE status='running' ORDER BY created_at DESC LIMIT 1").first();if(active)return present(active);
    if(!body.refresh){const cached=await db.prepare("SELECT * FROM website_audits WHERE url=? AND status='complete' AND created_at>? ORDER BY created_at DESC LIMIT 1").bind(target.href,new Date(Date.now()-7*86400000).toISOString()).first();if(cached&&JSON.parse(cached.state).maxPages===maxPages&&JSON.parse(cached.state).pages.some(p=>p.parsed))return {...present(cached),cached:true};}
    const count=await db.prepare('SELECT COUNT(*) AS n FROM website_audits WHERE created_at>?').bind(new Date(Date.now()-3600000).toISOString()).first();if(count.n>=10)throw fail('Ten audits have been started this hour. Open a saved report or try again later.',429);
    const id=crypto.randomUUID(),state={phase:'robots',maxPages,origin:target.origin,finalUrl:null,pages:[],queue:[target.href],discovered:[],linkChecks:[],skipped:[],warnings:[],robots:'',robotsStatus:null};
    await db.prepare("INSERT INTO website_audits(id,url,client,created_at,updated_at,status,state) VALUES(?,?,?,?,?,'running',?)").bind(id,target.href,client,now(),now(),JSON.stringify(state)).run();return present(await row(db,id));
  }));
  if(route==='advance'&&request.method==='POST')return json(await advance(env,body.id));
  if(route==='stop'&&request.method==='POST')return json(await lock(db,async()=>{await row(db,body.id);await db.prepare("UPDATE website_audits SET status='stopped',updated_at=? WHERE id=?").bind(now(),body.id).run();return present(await row(db,body.id));}));
  if(route==='notes'&&request.method==='POST'){await row(db,body.id);await db.prepare('UPDATE website_audits SET notes=?,summary=?,client=?,updated_at=? WHERE id=?').bind(String(body.notes||'').slice(0,6000),String(body.summary||'').slice(0,4000),String(body.client||'Website audit').slice(0,120),now(),body.id).run();return json({ok:true});}
  throw fail('Not found.',404);
}catch(e){return json({error:e.status?e.message:'The audit could not complete this request. Any saved progress has been kept.'},e.status||500);}}
