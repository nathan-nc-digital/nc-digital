import { dataForSeo, researchLocations } from './keyword-research.js';
import { readLimitedBody } from './social-http.js';
import { baseCandidates, towns, services, fresh, normal, parseFilters, pickCandidates, scanPreview, qualifies, priority, competition, isDirectory, numberOrNull } from './emd-planner.js';

const now = () => new Date().toISOString();
const json = (body, status=200) => new Response(JSON.stringify(body), { status, headers:{'Content-Type':'application/json','Cache-Control':'no-store, private','X-Robots-Tag':'noindex'} });
const problem = (message,status=400) => Object.assign(new Error(message),{status});
const put = (db,key,value) => db.prepare('INSERT INTO emd_cache (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').bind(key,JSON.stringify(value),now()).run();
async function get(db,key) { const r=await db.prepare('SELECT value FROM emd_cache WHERE key=?').bind(key).first(); return r ? JSON.parse(r.value) : null; }
async function hydrate(env) {
  const [cache,watch] = await Promise.all([env.JOBS_DB.prepare('SELECT key,value FROM emd_cache').all(),env.JOBS_DB.prepare('SELECT * FROM emd_watchlist').all()]);
  const values = new Map(cache.results.map(x=>[x.key,JSON.parse(x.value)]));
  const watches = new Map(watch.results.map(x=>[x.domain,x]));
  const candidates = new Map(baseCandidates.map(x=>[x.domain,{...x}]));
  for (const [key,value] of values) if (key.startsWith('candidate:')) candidates.set(value.domain,{...candidates.get(value.domain),...value});
  return [...candidates.values()].map(x=>{
    const w=watches.get(x.domain), m=values.get('metrics:'+normal(x.service+' '+x.town)), a=values.get('domain:'+x.domain), s=values.get('serp:'+normal(x.service+' '+x.town));
    if (m) Object.assign(x,m);
    if (a) Object.assign(x,a);
    if (s) x.serp={...s,items:s.items.map(c=>{const d=values.get('links:'+c.domain),p=values.get('links:'+c.url);return {...c,referringDomains:d?.count??null,linksAt:d?.at,pageReferringDomains:p?.count??null};})};
    if(w) Object.assign(x,{status:w.status,jobValue:w.job_value??x.jobValue,commission:w.commission,notes:w.notes});
    x.evidence=competition(x); x.score=Math.round(priority(x));
    return x;
  });
}
function localLocation(town) {
  const matches=researchLocations.filter(x=>normal(x.name.split(',')[0])===town);
  return matches.find(x=>/Wales/.test(x.name)) || matches[0];
}
async function saveScan(db,id,state,status='running') { await db.prepare('UPDATE emd_scans SET state=?,status=?,updated_at=? WHERE id=?').bind(JSON.stringify(state),status,now(),id).run(); }
async function scanResult(db,id) {
  const row=await db.prepare('SELECT * FROM emd_scans WHERE id=?').bind(id).first();
  if(!row) throw problem('Scan not found.',404);
  const ledger=await db.prepare('SELECT step,reserve,cost,status FROM emd_spend WHERE scan_id=?').bind(id).all();
  return {id,status:row.status,budget:row.budget,createdAt:row.created_at,...JSON.parse(row.state),actual:ledger.results.reduce((n,x)=>n+(x.cost??0),0),committed:ledger.results.reduce((n,x)=>n+(x.cost??x.reserve),0),ledger:ledger.results};
}
async function withLock(db,fn) {
  const owner=crypto.randomUUID(),time=now();
  const claim=await db.prepare('UPDATE emd_lock SET owner=?,expires_at=? WHERE id=1 AND expires_at<?').bind(owner,new Date(Date.now()+120000).toISOString(),time).run();
  if(!claim.meta.changes) throw problem('Another scan step is running. Please wait a moment.',409);
  try{return await fn();}finally{await db.prepare('UPDATE emd_lock SET expires_at=? WHERE id=1 AND owner=?').bind('2000-01-01',owner).run();}
}
async function paid(env,id,state,step,reserve,endpoint,input) {
  const db=env.JOBS_DB, scan=await scanResult(db,id);
  if(scan.committed+reserve > scan.budget+0.0000001) {state.warnings.push('Budget limit reached. Remaining paid lookups were skipped.');state.phase='done';return null;}
  // A durable reservation precedes dispatch. Unknown outcomes are never retried automatically.
  await db.batch([
    db.prepare("INSERT INTO emd_spend (scan_id,step,reserve,status) VALUES (?,?,?,'uncertain')").bind(id,step,reserve),
    db.prepare('UPDATE emd_scans SET state=?,updated_at=? WHERE id=?').bind(JSON.stringify(state),now(),id),
  ]);
  try {
    const r=await dataForSeo(env,endpoint,input);
    if(!r.costReported||!Number.isFinite(r.cost)||r.cost<0) throw problem('The provider did not return a valid cost.',502);
    await db.prepare("UPDATE emd_spend SET cost=?,status='complete' WHERE scan_id=? AND step=?").bind(r.cost,id,step).run();
    if(r.cost>reserve){state.phase='done';state.warnings.push('Provider cost exceeded the conservative estimate; stopped further spending.');}
    return r.result;
  } catch(error) {state.warnings.push(`${step}: ${error.message} Reserved $${reserve.toFixed(2)} remains counted because the charge could not be confirmed.`);return null;}
}
async function availability(env,domain,rdapStatus) {
  // Nominet requires browser-originated lookups. Only the authenticated admin can
  // submit a result; this is a browser observation, not a registrar purchase guarantee.
  if(![0,200,404].includes(rdapStatus))throw problem('Invalid browser registration result.');
  const result={available:rdapStatus===404?true:rdapStatus===200?false:null,availabilityAt:now(),availabilitySource:'browser-rdap'};
  await put(env.JOBS_DB,'domain:'+domain,result);return result;
}
async function advance(env,id) {
  return withLock(env.JOBS_DB,async()=>{
    const db=env.JOBS_DB,scan=await scanResult(db,id);
    if(scan.status!=='running')return scan;
    const {phase,index,filters,domains,warnings}=scan;
    const state={phase,index,filters,domains,warnings,shortlist:scan.shortlist||[],deep:scan.deep||[]};
    const all=await hydrate(env), map=new Map(all.map(x=>[x.domain,x]));
    const selected=domains.map(d=>map.get(d)).filter(Boolean);
    if(phase==='metrics') {
      state.phase='availability';state.index=0;
      const missing=selected.filter(x=>!fresh(x.metricsAt,90));
      if(missing.length){
        const result=await paid(env,id,state,'keyword metrics',.05,'dataforseo_labs/google/keyword_overview/live',{keywords:missing.map(x=>normal(x.service+' '+x.town)),location_code:2826,language_code:'en',include_serp_info:false});
        const items=new Map((result?.items||[]).map(x=>[normal(x.keyword),x]));
        if(result) for(const c of missing){const item=items.get(normal(c.service+' '+c.town));await put(db,'metrics:'+normal(c.service+' '+c.town),{volume:numberOrNull(item?.keyword_info?.search_volume),cpc:numberOrNull(item?.keyword_info?.cpc),difficulty:numberOrNull(item?.keyword_properties?.keyword_difficulty),metricsAt:now()});}
      }
    } else if(phase==='availability') {
      if(!state.shortlist.length && index===0)state.shortlist=selected.filter(x=>qualifies(x,filters.mode)).sort((a,b)=>priority(b)-priority(a)).slice(0,30).map(x=>x.domain);
      const batch=state.shortlist.slice(index,index+5);
      const registrationQueue=batch.filter(domain=>{const c=map.get(domain);return c?.availabilitySource!=='browser-rdap'||!fresh(c?.availabilityAt,1);});
      if(registrationQueue.length){await saveScan(db,id,state);return {...await scanResult(db,id),registrationQueue};}
      state.index+=batch.length;
      for(const domain of batch)if(map.get(domain)?.available===null)warnings.push(`Registration check unavailable for ${domain}; paid competition checks skipped.`);
      if(state.index>=state.shortlist.length){state.phase='serps';state.index=0;state.shortlist=state.shortlist.filter(d=>{const c=map.get(d);return c;});}
    } else if(phase==='serps') {
      // Current availability gates every paid SERP. Never use an old positive after a failed check.
      state.shortlist=state.shortlist.filter(d=>{const c=map.get(d);return c?.available===true && fresh(c.availabilityAt,1);}).slice(0,20);
      const c=map.get(state.shortlist[index]);state.index++;
      if(c && !fresh(c.serp?.at,30)) {
        const location=localLocation(c.town);
        if(!location)warnings.push(`No precise Google location found for ${c.town}; local search was skipped.`);
        else {
          const result=await paid(env,id,state,'serp '+c.domain,.01,'serp/google/organic/live/advanced',{keyword:normal(c.service+' '+c.town),location_code:location.code,language_code:'en',device:'desktop',os:'windows',depth:10});
          if(result){const items=(result.items||[]).filter(x=>x.type==='organic' && /^https?:\/\//.test(x.url||'')).slice(0,10).map(x=>{const domain=new URL(x.url).hostname.replace(/^www\./,'');return {position:x.rank_group,domain,url:x.url,title:String(x.title||domain).slice(0,250),isDirectory:isDirectory(domain)};});await put(db,'serp:'+normal(c.service+' '+c.town),{items,at:now(),location:location.name,localPack:(result.items||[]).some(x=>x.type==='local_pack')});}
        }
      }
      if(state.index>=state.shortlist.length && state.phase!=='done'){state.phase='links';state.index=0;}
    } else if(phase==='links') {
      state.phase='done';
      const finalists=state.shortlist.map(d=>map.get(d)).filter(c=>c?.serp?.items.length>=5 && fresh(c.serp.at,30)).sort((a,b)=>priority(b)-priority(a)).slice(0,5);
      state.deep=finalists.map(c=>c.domain);
      const targets=[...new Set(finalists.flatMap(c=>c.serp.items.filter(x=>!x.isDirectory).flatMap(x=>[x.domain,x.url])))].slice(0,100);
      const missing=[];for(const target of targets){const cached=await get(db,'links:'+target);if(!fresh(cached?.at,90))missing.push(target);}
      if(missing.length){const result=await paid(env,id,state,'bulk competitor links',.1,'backlinks/bulk_referring_domains/live',{targets:missing});for(const item of result?.items||[]){const count=numberOrNull(item.referring_domains);if(count!==null && missing.includes(item.target))await put(db,'links:'+item.target,{count,at:now()});}}
    }
    await saveScan(db,id,state,state.phase==='done'?'complete':'running');return scanResult(db,id);
  });
}

export async function handleEmd(request,env) {
  try {
    const url=new URL(request.url),route=url.pathname.replace('/admin/emd-finder/api/','').replace(/\/$/,'');
    if(!['GET','POST'].includes(request.method))throw problem('Method not allowed.',405);
    if(request.method==='POST' && request.headers.get('Origin')!==url.origin)throw problem('Refresh this admin page and try again.',403);
    if(!env.JOBS_DB)throw problem('Research storage is not configured.',503);
    let body={};if(request.method==='POST'){try{body=JSON.parse(new TextDecoder().decode(await readLimitedBody(request,12000)));}catch{throw problem('Invalid request.');}}
    if(route==='catalog' && request.method==='GET') {
      const candidates=await hydrate(env);const history=await env.JOBS_DB.prepare('SELECT id,status,created_at FROM emd_scans ORDER BY created_at DESC LIMIT 20').all();
      return json({candidates,towns,services,history:history.results,connected:!!(env.DATAFORSEO_LOGIN&&env.DATAFORSEO_PASSWORD)});
    }
    if(route==='preview' && request.method==='POST'){const filters=parseFilters(body);const candidates=pickCandidates(await hydrate(env),filters);return json({...scanPreview(candidates),filters,domains:candidates.map(x=>x.domain)});}
    if(route==='start' && request.method==='POST')return json(await withLock(env.JOBS_DB,async()=>{
      const filters=parseFilters(body);if(!env.DATAFORSEO_LOGIN||!env.DATAFORSEO_PASSWORD)throw problem('DataForSEO is not connected.',503);
      const existing=await env.JOBS_DB.prepare("SELECT id FROM emd_scans WHERE status='running' ORDER BY created_at DESC LIMIT 1").first();if(existing)return scanResult(env.JOBS_DB,existing.id);
      const hourly=await env.JOBS_DB.prepare('SELECT COUNT(*) AS n FROM emd_scans WHERE created_at>?').bind(new Date(Date.now()-3600000).toISOString()).first();if(hourly.n>=10)throw problem('Hourly limit reached. Browse saved results or try again later.',429);
      const candidates=pickCandidates(await hydrate(env),filters);if(!candidates.length)throw problem('No candidates match. Try a different service, town or discovery mode.');
      for(const c of candidates)if(!baseCandidates.some(x=>x.domain===c.domain)||filters.jobValue!==null)await put(env.JOBS_DB,'candidate:'+c.domain,{service:c.service,town:c.town,domain:c.domain,jobValue:c.jobValue,volume:c.volume??null,difficulty:c.difficulty??null,cpc:c.cpc??null});
      const id=crypto.randomUUID(),state={phase:'metrics',index:0,filters,domains:candidates.map(x=>x.domain),warnings:[],shortlist:[],deep:[]};
      await env.JOBS_DB.prepare("INSERT INTO emd_scans(id,state,status,budget,created_at,updated_at) VALUES (?,?,'running',?,?,?)").bind(id,JSON.stringify(state),filters.budget,now(),now()).run();return scanResult(env.JOBS_DB,id);
    }));
    if(route==='scan' && request.method==='GET')return json(await scanResult(env.JOBS_DB,url.searchParams.get('id')));
    if(route==='advance' && request.method==='POST')return json(await advance(env,body.id));
    if(route==='stop' && request.method==='POST')return json(await withLock(env.JOBS_DB,async()=>{const scan=await scanResult(env.JOBS_DB,body.id);await env.JOBS_DB.prepare("UPDATE emd_scans SET status='stopped',updated_at=? WHERE id=?").bind(now(),scan.id).run();return {ok:true};}));
    if(route==='availability' && request.method==='POST') {
      if(!/^[a-z0-9]{2,63}\.co\.uk$/.test(body.domain||''))throw problem('Invalid .co.uk domain.');
      return json(await availability(env,body.domain,body.rdapStatus));
    }
    if(route==='watch' && request.method==='POST') {
      const statuses=['new','watchlist','dismissed','purchased','partner-found'];
      if(!/^[a-z0-9]{2,63}\.co\.uk$/.test(body.domain||'')||!statuses.includes(body.status))throw problem('Invalid opportunity.');
      const job=Number(body.jobValue),commission=Number(body.commission);
      if(!Number.isFinite(job)||job<0||job>1000000||!Number.isFinite(commission)||commission<0||commission>100)throw problem('Check the job value and commission percentage.');
      await env.JOBS_DB.prepare('INSERT INTO emd_watchlist(domain,status,job_value,commission,notes,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(domain) DO UPDATE SET status=excluded.status,job_value=excluded.job_value,commission=excluded.commission,notes=excluded.notes,updated_at=excluded.updated_at').bind(body.domain,body.status,job,commission,String(body.notes||'').slice(0,2000),now()).run();return json({ok:true});
    }
    throw problem('Not found.',404);
  }catch(error){return json({error:error.status?error.message:'The finder could not complete this request. Your saved data and spending reservations have been kept.'},error.status||500);}
}
