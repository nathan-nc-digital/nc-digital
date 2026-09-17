import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleEmd } from '../../src/lib/emd-api.js';
import { baseCandidates,competition,parseFilters,pickCandidates } from '../../src/lib/emd-planner.js';

function db(){const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync('migrations/0007_emd_finder.sql','utf8'));return {sqlite,prepare(sql){const s=sqlite.prepare(sql);return {args:[],bind(...args){this.args=args;return this;},async first(){return s.get(...this.args)||null;},async all(){return {results:s.all(...this.args)};},async run(){return {meta:s.run(...this.args)};}};},async batch(items){sqlite.exec('BEGIN');try{const r=[];for(const item of items)r.push(await item.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};}
const request=(route,body)=>new Request('https://nc-digital.co.uk/admin/emd-finder/api/'+route,{method:body?'POST':'GET',headers:body?{Origin:'https://nc-digital.co.uk','Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
async function call(env,route,body){const response=await handleEmd(request(route,body),env);const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;}
const input={service:'test roofer',town:'merthyr tydfil',jobValue:2500,budget:1};
function mockProvider(calls,{failLinks=false,failRdap=false,delaySerp=null,failMetrics=false}={}){return async(url,options)=>{
  if(String(url).includes('rdap.nominet'))return new Response('',{status:failRdap?503:404});
  const args=JSON.parse(options.body)[0];calls.push({url,args});let result,cost;
  if(url.includes('keyword_overview')){if(failMetrics)throw new Error('connection lost');result={items:args.keywords.map(keyword=>({keyword,keyword_info:{search_volume:100,cpc:4},keyword_properties:{keyword_difficulty:5}}))};cost=.01212;}
  else if(url.includes('serp/')){if(delaySerp)await delaySerp;result={items:Array.from({length:5},(_,i)=>({type:'organic',rank_group:i+1,domain:`business${i}.co.uk`,url:`https://business${i}.co.uk/roofing/`,title:'Local roofer'}))};cost=.002;}
  else {if(failLinks)throw new Error('connection lost');result={items:args.targets.map(target=>({target,referring_domains:3}))};cost=.02436;}
  return Response.json({status_code:20000,cost,tasks:[{status_code:20000,result:[result]}]});
};}
async function finish(env,scan){for(let i=0;scan.status==='running'&&i<40;i++){scan=await call(env,'advance',{id:scan.id});for(const domain of scan.registrationQueue||[]){const response=await fetch('https://rdap.nominet.uk/uk/domain/'+domain);await call(env,'availability',{domain,rdapStatus:[200,404].includes(response.status)?response.status:0});}}assert.equal(scan.status,'complete');return scan;}
test('unknown or partial link evidence never becomes a promising opportunity',()=>{
  assert.equal(competition({}).label,'Unverified');const at=new Date().toISOString();
  const items=Array.from({length:5},()=>({isDirectory:false,referringDomains:null,linksAt:at}));
  assert.equal(competition({serp:{at,items}}).label,'Unverified');
  items.forEach(c=>c.referringDomains=2);assert.equal(competition({serp:{at,items}}).label,'Promising');
  items[0].linksAt='2020-01-01';assert.equal(competition({serp:{at,items}}).label,'Unverified');
});
test('filters reject Google operators and out-of-range budgets; existing cache is retained',()=>{
  assert.throws(()=>parseFilters({service:'site:example.com'}));assert.throws(()=>parseFilters({budget:1.01}));
  assert.equal(baseCandidates.length,3741);assert.ok(pickCandidates(baseCandidates,parseFilters({})).length<=100);
});
test('scan batches links, uses town location, stores evidence and repeat scan costs zero',async t=>{
  const calls=[],storage=db(),env={JOBS_DB:storage,DATAFORSEO_LOGIN:'test',DATAFORSEO_PASSWORD:'test'};t.mock.method(globalThis,'fetch',mockProvider(calls));
  const first=await finish(env,await call(env,'start',input));assert.equal(calls.length,3);assert.ok(first.actual<.05);
  assert.equal(calls[1].args.location_code,1007443);assert.equal(calls[2].args.targets.length,10);
  const data=await call(env,'catalog');const c=data.candidates.find(x=>x.service==='test roofer');assert.equal(c.evidence.label,'Promising');assert.equal(c.available,true);
  const repeated=await finish(env,await call(env,'start',input));assert.equal(repeated.actual,0);assert.equal(calls.length,3);storage.sqlite.close();
});
test('budget prevents bulk dispatch before a charge is incurred',async t=>{
  const calls=[],storage=db(),env={JOBS_DB:storage,DATAFORSEO_LOGIN:'test',DATAFORSEO_PASSWORD:'test'};t.mock.method(globalThis,'fetch',mockProvider(calls));
  const scan=await finish(env,await call(env,'start',{...input,budget:.05}));assert.equal(calls.length,2);assert.ok(scan.committed<=.05);assert.match(scan.warnings.join(' '),/Budget limit/);storage.sqlite.close();
});
test('RDAP failures become unknown and prevent paid competition lookups',async t=>{
  const calls=[],storage=db(),env={JOBS_DB:storage,DATAFORSEO_LOGIN:'test',DATAFORSEO_PASSWORD:'test'};t.mock.method(globalThis,'fetch',mockProvider(calls,{failRdap:true}));
  await finish(env,await call(env,'start',input));assert.equal(calls.length,1);const c=(await call(env,'catalog')).candidates.find(x=>x.service==='test roofer');assert.equal(c.available,null);assert.equal(c.evidence.label,'Unverified');storage.sqlite.close();
});
test('uncertain API outcomes retain their reservation and are not retried on resume',async t=>{
  const calls=[],storage=db(),env={JOBS_DB:storage,DATAFORSEO_LOGIN:'test',DATAFORSEO_PASSWORD:'test'};t.mock.method(globalThis,'fetch',mockProvider(calls,{failLinks:true}));
  const scan=await finish(env,await call(env,'start',input));assert.ok(scan.committed>.1);assert.equal(scan.ledger.find(x=>x.step==='bulk competitor links').status,'uncertain');await call(env,'advance',{id:scan.id});assert.equal(calls.length,3);const c=(await call(env,'catalog')).candidates.find(x=>x.service==='test roofer');assert.equal(c.evidence.label,'Unverified');storage.sqlite.close();
});
test('simultaneous scan starts share one saved scan and cross-origin writes are rejected',async()=>{
  const storage=db(),env={JOBS_DB:storage,DATAFORSEO_LOGIN:'test',DATAFORSEO_PASSWORD:'test'};
  const [a,b]=await Promise.all([handleEmd(request('start',input),env),handleEmd(request('start',input),env)]);assert.deepEqual([a.status,b.status].sort(),[200,409]);
  assert.equal(storage.sqlite.prepare('SELECT COUNT(*) AS n FROM emd_scans').get().n,1);
  const cross=new Request('https://nc-digital.co.uk/admin/emd-finder/api/start',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'});assert.equal((await handleEmd(cross,env)).status,403);storage.sqlite.close();
});
test('watchlist values and notes survive catalog reloads',async()=>{
  const storage=db(),env={JOBS_DB:storage};const domain=baseCandidates[0].domain;
  await call(env,'watch',{domain,status:'watchlist',jobValue:800,commission:15,notes:'Partner agreed in principle.'});
  const c=(await call(env,'catalog')).candidates.find(x=>x.domain===domain);assert.equal(c.jobValue,800);assert.equal(c.commission,15);assert.equal(c.status,'watchlist');assert.match(c.notes,/Partner/);storage.sqlite.close();
});

test('concurrent advance requests cannot duplicate a paid SERP',async t=>{
  let release;const hold=new Promise(r=>release=r),calls=[],storage=db(),env={JOBS_DB:storage,DATAFORSEO_LOGIN:'test',DATAFORSEO_PASSWORD:'test'};
  t.mock.method(globalThis,'fetch',mockProvider(calls,{delaySerp:hold}));let scan=await call(env,'start',input);scan=await call(env,'advance',{id:scan.id});scan=await call(env,'advance',{id:scan.id});for(const domain of scan.registrationQueue||[])await call(env,'availability',{domain,rdapStatus:404});scan=await call(env,'advance',{id:scan.id});
  const first=handleEmd(request('advance',{id:scan.id}),env);while(calls.length<2)await new Promise(r=>setTimeout(r,1));
  const second=await handleEmd(request('advance',{id:scan.id}),env);assert.equal(second.status,409);release();assert.equal((await first).status,200);assert.equal(calls.filter(x=>x.url.includes('serp/')).length,1);storage.sqlite.close();
});

test('an interrupted dispatch resumes from the durable next step without a duplicate charge',async t=>{
  const calls=[],storage=db(),env={JOBS_DB:storage,DATAFORSEO_LOGIN:'test',DATAFORSEO_PASSWORD:'test'};t.mock.method(globalThis,'fetch',mockProvider(calls));
  const scan=await call(env,'start',input);const row=storage.sqlite.prepare('SELECT state FROM emd_scans WHERE id=?').get(scan.id);const state=JSON.parse(row.state);state.phase='availability';
  // Simulate process loss after the transaction committed, before a response was saved.
  storage.sqlite.prepare('UPDATE emd_scans SET state=? WHERE id=?').run(JSON.stringify(state),scan.id);
  storage.sqlite.prepare("INSERT INTO emd_spend(scan_id,step,reserve,status) VALUES (?,'keyword metrics',.05,'uncertain')").run(scan.id);
  const result=await finish(env,scan);assert.equal(calls.length,0);assert.equal(result.committed,.05);assert.equal(result.actual,0);storage.sqlite.close();
});
