import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { auditUrl,publicIp,auditFetch,parsePage,crawlLinks,robotsPolicy,findingsFor,pageSpeedSummary,scoreFor } from '../../src/lib/website-audit.js';
import { handleWebsiteAudit,handlePublicReport } from '../../src/lib/website-audit-api.js';
import { rankingFrom,localSearchInput,localKeywordList } from '../../src/lib/audit-local-search.js';
import { auditProgress } from '../../src/lib/audit-progress.js';
import { offerFor,clientView,documentHtml } from '../../src/lib/audit-report-view.js';
const origin='https://nc-digital.co.uk';
function db(t){const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync('migrations/0008_website_audits.sql','utf8'));sqlite.exec(fs.readFileSync('migrations/0022_website_audit_share.sql','utf8'));sqlite.exec(fs.readFileSync('migrations/0023_website_audit_open_alerts.sql','utf8'));sqlite.exec(fs.readFileSync('migrations/0024_website_audit_rerun.sql','utf8'));sqlite.exec(fs.readFileSync('migrations/0010_analytics_reports.sql','utf8'));sqlite.exec(fs.readFileSync('migrations/0025_seo_clients.sql','utf8'));t.after(()=>sqlite.close());return {sqlite,prepare(sql){const s=sqlite.prepare(sql);return {args:[],bind(...args){this.args=args;return this;},async first(){return s.get(...this.args)||null;},async all(){return {results:s.all(...this.args)};},async run(){return {meta:s.run(...this.args)};}};}};}
const request=(route,body)=>new Request(origin+'/admin/website-audit/api/'+route,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
async function api(env,route,body){const r=await handleWebsiteAudit(request(route,body),env);const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;}
const good='<html lang="en"><head><title>Roof repairs in Cardiff</title><meta name="description" content="Local roofing team"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Roof repairs</h1><a href="tel:0123456">Call</a><img src="roof.jpg" alt="Roof repair"><img src="decoration.jpg" alt=""></body></html>';
test('HTML parser handles entities, comments, script strings and decorative alt correctly',()=>{
  const p=parsePage(good+'<!-- <img src="fake"> --><script>"<h1>fake</h1>"</script>','https://example.co.uk/');assert.equal(p.images,2);assert.equal(p.missingAlt,0);assert.equal(p.h1.length,1);assert.equal(p.phone,true);
  const second=parsePage('<title>A &amp; B</title><h1>Our <em>work</em></h1><img src="x"><a href="/contact">Get a quote</a>','https://example.co.uk/');assert.equal(second.titles[0],'A & B');assert.equal(second.h1[0],'Our work');assert.equal(second.missingAlt,1);assert.equal(second.links[0].url,'https://example.co.uk/contact');
});
test('URL and address validation reject private, encoded and credentialed targets',()=>{
  for(const x of ['http://127.0.0.1','http://2130706433','http://[::1]','http://local.test','https://user:pass@example.com','https://example.com:8443','https://example.com/?token=secret'])assert.throws(()=>auditUrl(x));
  for(const x of ['127.0.0.1','10.0.0.1','100.64.0.1','192.168.0.1','169.254.169.254','172.16.0.1','::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(publicIp(x),false,x);
  assert.equal(publicIp('8.8.8.8'),true);assert.equal(publicIp('2606:4700:4700::1111'),true);
});
test('crawler stays on site and excludes query actions, assets and login areas',()=>{
  const page=parsePage('<a href="/contact#form">Contact</a><a href="https://other.co.uk/">Other</a><a href="/logout">Out</a><a href="/delete/7">Delete</a><a href="/?action=delete">Action</a><a href="/file.pdf">PDF</a>','https://example.co.uk/');assert.deepEqual(crawlLinks(page,'https://example.co.uk'),['https://example.co.uk/contact']);
});
test('robots exclusions support groups, longest match and allow precedence',()=>{
  const rules='User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*.pdf$';assert.equal(robotsPolicy(rules,'/private/a'),false);assert.equal(robotsPolicy(rules,'/private/public/a'),true);assert.equal(robotsPolicy(rules,'/a.pdf'),false);assert.equal(robotsPolicy(rules,'/a.pdf/extra'),true);
  assert.equal(robotsPolicy('User-agent: OtherBot\nDisallow: /\nUser-agent: *\nAllow: /','/'),true);
});
test('missing, blocked and script-rendered pages do not become false passes or broken links',()=>{
  const pages=[{url:'https://example.co.uk/',status:200,parsed:parsePage('<html><body><div id="app"></div></body></html>','https://example.co.uk/')},{url:'https://example.co.uk/blocked',status:403,error:'Blocked'},{url:'https://example.co.uk/missing',status:404}];const f=findingsFor({pages,linkChecks:[]});assert.equal(f.filter(x=>x.title==='A page on the website is missing').length,1);assert.ok(f.some(x=>x.title==='Page could not be fully checked'&&x.kind==='review'));assert.ok(f.some(x=>x.title==='Main page heading was not found'&&x.kind==='review'));
});
test('safe fetch checks DNS on redirect and never sends incoming credentials',async t=>{
  const targets=[];t.mock.method(globalThis,'fetch',async(url,options)=>{targets.push(String(url));if(String(url).includes('dns-query')){const host=new URL(url).searchParams.get('name');return Response.json({Status:0,Answer:new URL(url).searchParams.get('type')==='A'?[{type:1,data:host==='private.example.com'?'127.0.0.1':'8.8.8.8'}]:[]});}assert.equal(options.headers.Authorization,undefined);return new Response(null,{status:302,headers:{Location:'https://private.example.com/'}});});await assert.rejects(()=>auditFetch('https://example.com/'),/public/);assert.ok(!targets.includes('https://private.example.com/'));
});
test('audits persist, enforce page bounds, skip exclusions and reuse saved results',async t=>{
  const env={JOBS_DB:db(t)},calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{url=String(url);if(url.includes('dns-query'))return Response.json({Status:0,Answer:new URL(url).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});calls.push(url);const path=new URL(url).pathname;
    if(path==='/robots.txt')return new Response('User-agent: *\nDisallow: /private',{headers:{'Content-Type':'text/plain'}});
    if(path==='/missing')return new Response('Gone',{status:404,headers:{'Content-Type':'text/html'}});
    const links=Array.from({length:35},(_,i)=>`<a href="/page-${i}">Page</a>`).join('');return new Response(good+'<a href="/private">Private</a><a href="/missing">Missing</a>'+links,{headers:{'Content-Type':'text/html'}});
  });let r=await api(env,'start',{url:'https://example.com/',client:'Test roofer',maxPages:5});for(let i=0;r.status==='running'&&i<40;i++)r=await api(env,'advance',{id:r.id});assert.equal(r.status,'complete');assert.ok(r.pages.length<=5);assert.ok(r.linkChecks.length<=20);assert.ok(!calls.some(x=>x.endsWith('/private')));assert.ok(r.findings.some(x=>/error page|website is missing/.test(x.title)));
  const before=calls.length;const cached=await api(env,'start',{url:'https://example.com/',maxPages:5});assert.equal(cached.cached,true);assert.equal(calls.length,before);await api(env,'notes',{id:r.id,client:'Client revised',summary:'A focused review.',notes:'Fix the service pages first.'});assert.equal((await api(env,'report?id='+r.id)).notes,'Fix the service pages first.');
});
test('simultaneous starts are serialized and cross-origin mutations rejected',async t=>{
  const env={JOBS_DB:db(t)},input={url:'https://example.com/'};const [a,b]=await Promise.all([handleWebsiteAudit(request('start',input),env),handleWebsiteAudit(request('start',input),env)]);assert.deepEqual([a.status,b.status].sort(),[200,409]);
  const bad=new Request(origin+'/admin/website-audit/api/start',{method:'POST',headers:{Origin:'https://other.com'},body:JSON.stringify(input)});assert.equal((await handleWebsiteAudit(bad,env)).status,403);
});

const psi=(performance,extra={})=>({lighthouseResult:{finalUrl:'https://example.co.uk/',categories:{performance:{score:performance/100},accessibility:{score:0.72},seo:{score:0.9},'best-practices':{score:0.8}},audits:{'largest-contentful-paint':{numericValue:6200},'cumulative-layout-shift':{numericValue:0.31},'total-blocking-time':{numericValue:900},'first-contentful-paint':{numericValue:2100},'speed-index':{numericValue:5000},'render-blocking-resources':{title:'Eliminate render-blocking resources',score:0.2,details:{type:'opportunity',overallSavingsMs:1800}},'uses-webp-images':{title:'Serve images in next-gen formats',score:0.4,details:{type:'opportunity',overallSavingsMs:2600}},'cache-insight':{title:'Use efficient cache lifetimes',score:0.5,scoreDisplayMode:'metricSavings',metricSavings:{LCP:0,FCP:0},details:{type:'table'}},'lcp-breakdown-insight':{title:'LCP breakdown',score:0,scoreDisplayMode:'numeric',details:{type:'list'}},'passing':{title:'Minify CSS',score:1,scoreDisplayMode:'metricSavings',metricSavings:{LCP:0}}}},loadingExperience:{overall_category:'SLOW',metrics:{LARGEST_CONTENTFUL_PAINT_MS:{percentile:4800,category:'SLOW'},CUMULATIVE_LAYOUT_SHIFT_SCORE:{percentile:12,category:'AVERAGE'}}},...extra});
test('parser records business schema, copyright year, untappable phone numbers and platform',()=>{
  const html='<html lang="en"><head><meta name="generator" content="WordPress 6.4.2"><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":["Roofing","LocalBusiness"]}]}</script><script type="application/ld+json">not json</script></head><body><p>Call us on 029 2000 1234</p><footer>&copy; 2019 - 2021 Example Roofing</footer></body></html>';
  const p=parsePage(html,'https://example.co.uk/');assert.deepEqual(p.schemaTypes.sort(),['LocalBusiness','Roofing','WebSite']);assert.equal(p.copyrightYear,2021);assert.equal(p.phoneText,true);assert.equal(p.phone,false);assert.equal(p.platform,'WordPress 6.4.2');
  assert.equal(parsePage('<link href="https://static1.squarespace.com/x.css"><p>No year here, ref 12345</p>','https://example.co.uk/').platform,'Squarespace');
  const plain=parsePage('<p>Order 20240101 shipped</p>','https://example.co.uk/');assert.equal(plain.phoneText,false);assert.equal(plain.copyrightYear,null);assert.equal(plain.platform,'');
});
test('PageSpeed summary keeps scores, vitals and the biggest opportunities only',()=>{
  const s=pageSpeedSummary(psi(38));assert.equal(s.performance,38);assert.equal(s.accessibility,72);assert.equal(s.lab.lcpMs,6200);assert.equal(s.field.lcp.p75,4800);assert.equal(s.field.cls.p75,0.12);
  assert.deepEqual(s.opportunities.map(o=>o.title),['Serve images in next-gen formats','Eliminate render-blocking resources','Use efficient cache lifetimes'],'failing opportunity and Lighthouse 13 insight audits, biggest saving first; informative and passing audits excluded');
  assert.throws(()=>pageSpeedSummary({error:{message:'x'}}));
});
test('new local-business checks, speed findings and category scores',()=>{
  const home=parsePage('<html lang="en"><head><title>Home</title><meta name="description" content="x"><meta name="viewport" content="width=device-width"></head><body><h1>Hi</h1><p>Call 07700 900123</p><footer>© 2020</footer></body></html>','https://example.co.uk/');
  const contact=parsePage('<html lang="en"><head><title>Contact us today</title><meta name="viewport" content="width=device-width"></head><body><h1>Contact</h1><form></form></body></html>','https://example.co.uk/contact');
  const state={pages:[{url:'https://example.co.uk/',status:200,parsed:home},{url:'https://example.co.uk/contact',status:200,parsed:contact}],linkChecks:[],sitemap:{checked:true,found:false,listedInRobots:false,tried:['https://example.co.uk/sitemap.xml']},httpRedirect:{checked:true,redirects:false,status:200,url:'http://example.co.uk/'},speed:{mobile:pageSpeedSummary(psi(38)),desktop:pageSpeedSummary(psi(81))}};
  const f=findingsFor(state,new Date('2026-09-23'));const titles=f.map(x=>x.title);
  for(const t of ['Google is not given a list of the website’s pages','Old website links show a “Not secure” warning','Website footer shows an old year','Phone number cannot be tapped to call','Google is not given the business details directly','Website is slow on phones','Pages jump around while loading','This page’s Google title is too short','This page’s Google summary is too short'])assert.ok(titles.includes(t),t);
  assert.ok(f.some(x=>x.title==='Very little text in the page HTML'&&x.kind==='review'),'near-empty pages are a review item, not a confirmed thin-content issue');
  assert.ok(!f.some(x=>x.page==='https://example.co.uk/contact'&&/text/.test(x.title)),'contact pages are exempt from thin content');
  assert.ok(f.filter(x=>x.kind==='confirmed').every(x=>['seo','speed','trust','enquiry'].includes(x.category)));
  const score=scoreFor(state,f);assert.equal(score.categories.length,4);assert.ok(score.overall>=0&&score.overall<=100);assert.ok(score.categories.find(c=>c.key==='speed').score<60);assert.equal(score.categories.find(c=>c.key==='speed').measured,true);assert.ok(score.grade);
  const clean={pages:[{url:'https://example.co.uk/',status:200,parsed:parsePage(good,'https://example.co.uk/')}],linkChecks:[]};const cleanScore=scoreFor(clean,findingsFor(clean,new Date('2026-09-23')));
  assert.equal(cleanScore.categories.find(c=>c.key==='speed').measured,false,'speed is not scored without PageSpeed data');assert.ok(cleanScore.overall>score.overall);
  assert.equal(scoreFor({pages:[{url:'x',status:403}],linkChecks:[]},[]),null);
  assert.ok(!findingsFor({...state,pages:[{...state.pages[0],parsed:{...home,copyrightYear:2025}}]},new Date('2026-09-23')).some(x=>x.title==='Website footer shows an old year'),'last year is not flagged');
});
test('audit runs sitemap, https and PageSpeed steps and reports missing key without failing',async t=>{
  const run=async(env,handler)=>{t.mock.method(globalThis,'fetch',handler);let r=await api(env,'start',{url:'https://example.com/',maxPages:5,refresh:true});for(let i=0;r.status==='running'&&i<60;i++)r=await api(env,'advance',{id:r.id});return r;};
  const psiCalls=[];
  const site=async(url)=>{url=String(url);if(url.includes('dns-query'))return Response.json({Status:0,Answer:new URL(url).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});
    if(url.startsWith('https://www.googleapis.com/pagespeedonline/')){psiCalls.push(new URL(url));return Response.json(psi(new URL(url).searchParams.get('strategy')==='mobile'?42:88));}
    const u=new URL(url);if(u.protocol==='http:')return new Response('',{status:301,headers:{Location:'https://example.com/'}});
    if(u.pathname==='/robots.txt')return new Response('User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap_index.xml',{headers:{'Content-Type':'text/plain'}});
    if(u.pathname==='/sitemap_index.xml')return new Response('<?xml version="1.0"?><sitemapindex></sitemapindex>',{headers:{'Content-Type':'application/xml'}});
    return new Response(good,{headers:{'Content-Type':'text/html'}});};
  const r=await run({JOBS_DB:db(t),PAGESPEED_API_KEY:'test-key'},site);
  assert.equal(r.status,'complete');assert.equal(r.sitemap.found,true);assert.equal(r.sitemap.url,'https://example.com/sitemap_index.xml');assert.equal(r.httpRedirect.redirects,true);
  assert.equal(r.speed.mobile.performance,42);assert.equal(r.speed.desktop.performance,88);assert.equal(psiCalls.length,2);assert.equal(psiCalls[0].searchParams.get('key'),'test-key');assert.equal(psiCalls[0].searchParams.get('url'),'https://example.com/');
  assert.ok(r.score&&r.score.categories.find(c=>c.key==='speed').measured);assert.ok(r.findings.some(f=>f.title==='Website is slow on phones'||f.title==='Website could load faster on phones'));
  t.mock.restoreAll();psiCalls.length=0;
  const noKey=await run({JOBS_DB:db(t)},site);assert.equal(noKey.status,'complete');assert.equal(psiCalls.length,0);assert.match(noKey.speed.mobile.error,/not configured/);assert.equal(noKey.score.categories.find(c=>c.key==='speed').measured,false);
});

const serpResult=(extra=[])=>({items:[{type:'local_pack',title:'Top Roofing Cardiff',domain:'toproofing.co.uk'},{type:'local_pack',title:'Bay Roofers',domain:'bayroofers.co.uk'},{type:'organic',rank_group:1,domain:'www.checkatrade.com',title:'Roofers in Cardiff',url:'https://www.checkatrade.com/x'},{type:'organic',rank_group:2,domain:'toproofing.co.uk',title:'Top Roofing',url:'https://toproofing.co.uk/'},{type:'organic',rank_group:3,domain:'rival.co.uk',title:'Rival',url:'https://rival.co.uk/'},...extra]});
test('local rankings find the client domain, map pack presence and who ranks first',()=>{
  const miss=rankingFrom(serpResult(),'https://www.example.co.uk/','Example Roofing');
  assert.equal(miss.position,null);assert.equal(miss.mapPackShown,true);assert.equal(miss.inMapPack,false);assert.deepEqual(miss.mapPack,['Top Roofing Cardiff','Bay Roofers']);assert.deepEqual(miss.top3.map(x=>x.domain),['checkatrade.com','toproofing.co.uk','rival.co.uk']);
  const hit=rankingFrom(serpResult([{type:'organic',rank_group:14,domain:'example.co.uk',title:'Us',url:'https://example.co.uk/roofing'},{type:'local_pack',title:'Example Roofing Ltd',domain:''}]),'https://example.co.uk/','Example Roofing');
  assert.equal(hit.position,14);assert.equal(hit.url,'https://example.co.uk/roofing');assert.equal(hit.inMapPack,true,'map listing matched by business name');
  assert.equal(localSearchInput({}),null);assert.throws(()=>localSearchInput({service:'roofer'}),/town/);
  const input=localSearchInput({service:'Roofer',town:'Cardiff,Wales,United Kingdom'});assert.equal(input.service,'roofer');assert.equal(input.townLabel,'Cardiff');assert.ok(input.locationCode>0);
  const list=localKeywordList(input);assert.equal(list[0],'roofer cardiff');assert.ok(list.length>=3&&list.length<=8);
});
test('not ranking locally becomes a clear, evidenced sales finding',()=>{
  const home=parsePage(good,'https://example.co.uk/');
  const local={service:'roofer',town:'cardiff',townLabel:'Cardiff',keywords:[{keyword:'roofer cardiff',volume:880,cpc:4.1,...rankingFrom(serpResult(),'https://example.co.uk/','Example')},{keyword:'roofers in cardiff',volume:320,cpc:3,...rankingFrom(serpResult(),'https://example.co.uk/','Example')},{keyword:'roof repairs cardiff',volume:260,cpc:null}]};
  const state={finalUrl:'https://example.co.uk/',pages:[{url:'https://example.co.uk/',status:200,parsed:home}],linkChecks:[],local};
  const f=findingsFor(state);const rank=f.find(x=>x.title==='Not on the first page of Google for “roofer cardiff”');
  assert.ok(rank);assert.equal(rank.priority,'high');assert.equal(rank.category,'seo');assert.match(rank.evidence,/880/);assert.match(rank.evidence,/checkatrade\.com/);
  assert.ok(f.some(x=>x.title==='Not shown in the Google Maps results for “roofer cardiff”'&&x.category==='enquiry'));
  assert.ok(f.some(x=>x.title==='Not on page one for other local searches'&&/roofers in cardiff/.test(x.evidence)));
  const ranking={...local,keywords:[{...local.keywords[0],position:2,inMapPack:true}]};assert.ok(!findingsFor({...state,local:ranking}).some(x=>/Google Maps|first page/.test(x.title)),'no sales finding when the business already ranks');
  const withoutLocal=scoreFor({...state,local:undefined},findingsFor({...state,local:undefined}));assert.ok(scoreFor(state,f).overall<withoutLocal.overall,'poor local visibility lowers the score');
});
test('audit with a service and town checks demand and rankings, records spend and keeps cache separate',async t=>{
  const env={JOBS_DB:db(t),DATAFORSEO_LOGIN:'login',DATAFORSEO_PASSWORD:'secret'},dfs=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{url=String(url);if(url.includes('dns-query'))return Response.json({Status:0,Answer:new URL(url).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});
    if(url.startsWith('https://api.dataforseo.com/')){const body=JSON.parse(options.body)[0];dfs.push({url,body});
      const result=url.includes('keyword_overview')?{items:body.keywords.map((k,i)=>({keyword:k,keyword_info:{search_volume:[880,320,260,90,0,0,0,0][i]??0,cpc:4.1}}))}:serpResult();
      return Response.json({status_code:20000,cost:0.01,tasks:[{status_code:20000,cost:0.01,result:[result]}]});}
    if(new URL(url).pathname==='/robots.txt')return new Response('Not found',{status:404});
    return new Response(good,{headers:{'Content-Type':'text/html'}});});
  let r=await api(env,'start',{url:'https://example.com/',client:'Example Roofing',maxPages:5,service:'roofer',town:'Cardiff,Wales,United Kingdom'});for(let i=0;r.status==='running'&&i<80;i++)r=await api(env,'advance',{id:r.id});
  assert.equal(r.status,"complete");assert.equal(r.local.townLabel,'Cardiff');assert.equal(r.local.keywords[0].keyword,'roofer cardiff');assert.equal(r.local.keywords[0].volume,880);assert.equal(r.local.keywords[0].checked,true);assert.equal(r.local.keywords[0].position,null);
  const serps=dfs.filter(x=>x.url.includes('/serp/'));assert.equal(serps.length,r.local.keywords.length,'every local search is checked, including those without volume data');assert.ok(r.local.keywords.every(k=>k.checked));assert.equal(serps[0].body.location_code,r.local.locationCode);assert.equal(serps[0].body.depth,30);
  assert.equal(dfs.filter(x=>x.url.includes('keyword_overview')).length,1);assert.equal(dfs.filter(x=>x.url.includes('keyword_overview'))[0].body.location_code,2826);
  assert.ok(Math.abs(r.local.cost-0.01*dfs.length)<1e-9);assert.ok(r.findings.some(x=>/first page of Google/.test(x.title)));
  const before=dfs.length;const plain=await api(env,'start',{url:'https://example.com/',maxPages:5});for(let i=0;plain.status==='running'&&i<80;i++)Object.assign(plain,await api(env,'advance',{id:plain.id}));assert.notEqual(plain.id,r.id,'an audit without local search is not served the local-search cache');
  const again=await api(env,'start',{url:'https://example.com/',maxPages:5,service:'roofer',town:'Cardiff,Wales,United Kingdom'});assert.equal(again.cached,true);assert.equal(again.id,r.id);
  assert.equal((await handleWebsiteAudit(request('start',{url:'https://example.com/',service:'roofer'}),env)).status,400);
});
test('a Google error on one search is retried once and never stops the other ranking checks',async t=>{
  const env={JOBS_DB:db(t),DATAFORSEO_LOGIN:'login',DATAFORSEO_PASSWORD:'secret'},attempts=new Map();
  t.mock.method(globalThis,'fetch',async(url,options)=>{url=String(url);if(url.includes('dns-query'))return Response.json({Status:0,Answer:new URL(url).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});
    if(url.startsWith('https://api.dataforseo.com/')){const body=JSON.parse(options.body)[0];
      if(url.includes('keyword_overview'))return Response.json({status_code:20000,cost:0.01,tasks:[{status_code:20000,result:[{items:[]}]}]});
      const n=(attempts.get(body.keyword)||0)+1;attempts.set(body.keyword,n);
      const failing=(body.keyword==='roofers cardiff'&&n===1)||body.keyword==='roofers in cardiff';
      return Response.json(failing?{status_code:20000,cost:0,tasks:[{status_code:40101,result:null}]}:{status_code:20000,cost:0.01,tasks:[{status_code:20000,result:[serpResult()]}]});}
    if(new URL(url).pathname==='/robots.txt')return new Response('Not found',{status:404});
    return new Response(good,{headers:{'Content-Type':'text/html'}});});
  let r=await api(env,'start',{url:'https://example.com/',maxPages:5,service:'roofer',town:'Cardiff,Wales,United Kingdom'});for(let i=0;r.status==='running'&&i<80;i++)r=await api(env,'advance',{id:r.id});
  assert.equal(r.status,'complete');assert.equal(r.local.error,null);
  assert.equal(r.local.keywords.find(k=>k.keyword==='roofers cardiff').checked,true,'transient failure succeeds on retry');
  const stuck=r.local.keywords.find(k=>k.keyword==='roofers in cardiff');assert.equal(stuck.checked,undefined);assert.match(stuck.checkError,/40101/);assert.equal(attempts.get('roofers in cardiff'),2);
  assert.equal(r.local.keywords.filter(k=>k.checked).length,r.local.keywords.length-1,'every other search is still checked');
});
test('client links show only the client report, count views and can be turned off',async t=>{
  const env={JOBS_DB:db(t)};
  t.mock.method(globalThis,'fetch',async url=>{url=String(url);if(url.includes('dns-query'))return Response.json({Status:0,Answer:new URL(url).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});if(new URL(url).pathname==='/robots.txt')return new Response('',{status:404});return new Response('<html><head><title>Hi</title></head><body><img src="a.jpg"></body></html>',{headers:{'Content-Type':'text/html'}});});
  let r=await api(env,'start',{url:'https://example.com/',client:'Example Roofing',maxPages:5});for(let i=0;r.status==='running'&&i<40;i++)r=await api(env,'advance',{id:r.id});
  assert.ok(r.findings.some(f=>f.internal),'fixture has an internal finding');
  const pub=path=>handlePublicReport(new Request(origin+path),env);
  const shared=await api(env,'share',{id:r.id,enable:true});assert.match(shared.share.token,/^[A-Za-z0-9_-]{24}$/);assert.equal(shared.share.url,origin+'/report/'+shared.share.token);
  assert.equal((await api(env,'share',{id:r.id,enable:true})).share.token,shared.share.token,'creating again keeps the same link');
  const res=await pub('/api/report/'+shared.share.token);assert.equal(res.status,200);assert.match(res.headers.get('X-Robots-Tag'),/noindex/);assert.equal(res.headers.get('Referrer-Policy'),'no-referrer');assert.match(res.headers.get('Cache-Control'),/no-store/);
  const body=await res.json(),text=JSON.stringify(body);
  assert.equal(body.client,'Example Roofing');assert.ok(body.findings.length>0);assert.ok(body.findings.every(f=>!('evidence' in f)&&!('internal' in f)));
  for(const secret of ['warnings','pages','linkChecks','skipped','discovered','robots','cost','evidence','share_views','id'])assert.ok(!(secret in body),secret);assert.ok(!text.includes('evidence'));
  assert.ok(!body.findings.some(f=>/language/i.test(f.title)),'internal findings never reach the client');
  await pub('/api/report/'+shared.share.token);const after=await api(env,'report?id='+r.id);assert.equal(after.share.views,2);assert.ok(after.share.lastViewedAt);
  assert.equal((await pub('/api/report/not-a-real-token-000000000')).status,404);assert.equal((await pub('/api/report/../../x')).status,404);
  assert.equal((await api(env,'share',{id:r.id,enable:false})).share,null);assert.equal((await pub('/api/report/'+shared.share.token)).status,404,'a turned-off link stops working');
  const fresh=await api(env,'share',{id:r.id,enable:true});assert.notEqual(fresh.share.token,shared.share.token,'a new link is issued after turning it off');
});
test('the offer is SEO for WordPress sites and a new WordPress website otherwise, with a manual override',()=>{
  const report=(platform,extra={})=>({client:'Dowlais Heating',createdAt:'2026-09-23T10:00:00Z',url:'https://d.co.uk/',finalUrl:'https://d.co.uk/',status:'complete',summary:'',notes:'',maxPages:10,
    pages:[{url:'https://d.co.uk/',status:200,parsed:{platform}}],findings:[{id:'tap-to-call-1',title:'Phone number cannot be tapped to call',why:'x',fix:'y',page:'https://d.co.uk/',priority:'medium',kind:'confirmed'}],
    speed:{mobile:{performance:71,lab:{lcpMs:4800},field:{}},desktop:{performance:76}},
    local:{service:'plumber',townLabel:'Merthyr Tydfil',keywords:[{keyword:'plumber merthyr tydfil',volume:260,checked:true,position:null,mapPackShown:true,inMapPack:false,mapPack:['A'],top3:[]}]},...extra});
  assert.deepEqual(offerFor(report('Wix.com Website Builder')),{type:'website',platform:'Wix'});
  assert.deepEqual(offerFor(report('WordPress 6.4.2')),{type:'seo',platform:'WordPress'});
  assert.deepEqual(offerFor(report('')),{type:'website',platform:null},'an unknown platform is offered a WordPress build');
  assert.equal(offerFor(report('Wix.com Website Builder',{offer:'seo'})).type,'seo');assert.equal(offerFor(report('WordPress',{offer:'none'})),null);
  const wix=documentHtml(report('Wix.com Website Builder'));
  assert.match(wix,/href="#offer"/);assert.match(wix,/id="offer"/);assert.match(wix,/A multi-page WordPress website/);assert.match(wix,/currently built with Wix/);assert.doesNotMatch(wix,/£199|one-page/,'always recommends a multi-page site');assert.match(wix,/dedicated page for each service and for Merthyr Tydfil/);assert.match(wix,/scores 71\/100/);assert.match(wix,/1 page\b/);
  const wp=documentHtml(report('WordPress 6.4.2'));assert.match(wp,/Local SEO to get Dowlais Heating onto the first page of Google/);assert.match(wp,/about 260 searches a month/);assert.match(wp,/Google Maps results/);assert.doesNotMatch(wp,/Multi-page WordPress website/);
  const none=documentHtml(report('WordPress',{offer:'none'}));assert.doesNotMatch(none,/id="offer"|href="#offer"/);
  const view=clientView(report('Wix.com Website Builder'));assert.deepEqual(view.offerView,{type:'website',platform:'Wix'});assert.ok(!('pages' in view));assert.match(documentHtml(view),/currently built with Wix/,'the public view renders the same offer');
});
test('the chosen offer is saved with the report notes and invalid choices are refused',async t=>{
  const env={JOBS_DB:db(t)};
  t.mock.method(globalThis,'fetch',async url=>{url=String(url);if(url.includes('dns-query'))return Response.json({Status:0,Answer:new URL(url).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});if(new URL(url).pathname==='/robots.txt')return new Response('',{status:404});return new Response(good,{headers:{'Content-Type':'text/html'}});});
  let r=await api(env,'start',{url:'https://example.com/',maxPages:5});for(let i=0;r.status==='running'&&i<40;i++)r=await api(env,'advance',{id:r.id});
  await api(env,'notes',{id:r.id,client:'Example',summary:'',notes:'',offer:'seo'});assert.equal((await api(env,'report?id='+r.id)).offer,'seo');
  assert.equal((await handleWebsiteAudit(request('notes',{id:r.id,client:'Example',offer:'free-lunch'}),env)).status,400);
});


test('updating a report re-runs it in place: same link, notes and history, previous version shown until done',async t=>{
  const env={JOBS_DB:db(t),DATAFORSEO_LOGIN:'login',DATAFORSEO_PASSWORD:'secret'};let title='Old title',rank=null;
  t.mock.method(globalThis,'fetch',async(url,options)=>{url=String(url);if(url.includes('dns-query'))return Response.json({Status:0,Answer:new URL(url).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});
    if(url.startsWith('https://api.dataforseo.com/')){const body=JSON.parse(options.body)[0];const result=url.includes('keyword_overview')?{items:body.keywords.map(k=>({keyword:k,keyword_info:{search_volume:100,cpc:2}}))}:{items:rank?[{type:'organic',rank_group:rank,domain:'example.com',url:'https://example.com/'}]:[]};return Response.json({status_code:20000,cost:0.01,tasks:[{status_code:20000,result:[result]}]});}
    if(new URL(url).pathname==='/robots.txt')return new Response('',{status:404});
    return new Response(`<html lang="en"><head><title>${title}</title><meta name="viewport" content="width=device-width"></head><body><h1>Hi</h1></body></html>`,{headers:{'Content-Type':'text/html'}});});
  const finish=async r=>{for(let i=0;r.status==='running'&&i<80;i++)r=await api(env,'advance',{id:r.id});return r;};
  let r=await finish(await api(env,'start',{url:'https://example.com/',client:'Example Roofing',maxPages:5,service:'roofer',town:'Cardiff,Wales,United Kingdom'}));
  await api(env,'notes',{id:r.id,client:'Example Roofing',summary:'',notes:'Start with service pages.',offer:'seo'});
  const token=(await api(env,'share',{id:r.id,enable:true})).share.token;
  env.JOBS_DB.sqlite.prepare("UPDATE website_audits SET share_views=3,state=json_set(state,'$.emails',json('[{\"to\":\"a@b.co.uk\",\"reference\":\"NC-1\"}]')) WHERE id=?").run(r.id);
  const pub=async()=>(await handlePublicReport(new Request(origin+'/api/report/'+token+'?preview=1'),env)).json();
  assert.equal((await pub()).local.keywords[0].position,null);
  title='New title';rank=4;
  let u=await api(env,'rerun',{id:r.id});
  assert.equal(u.id,r.id);assert.equal(u.status,'running');assert.equal(u.share.token,token,'the client link does not change');assert.equal(u.pages.length,0);
  const during=await pub();assert.equal(during.status,'complete','the client keeps seeing the last finished version');assert.equal(during.local.keywords[0].position,null);
  assert.equal((await handleWebsiteAudit(request('rerun',{id:r.id}),env)).status,409,'cannot start a second update while one runs');
  u=await finish(u);
  assert.equal(u.status,'complete');assert.equal(u.notes,'Start with service pages.');assert.equal(u.offer,'seo');assert.equal(u.emails.length,1);assert.equal(u.share.views,3);assert.equal(u.local.townLabel,'Cardiff');
  assert.equal(u.pages[0].parsed.titles[0],'New title');
  const after=await pub();assert.equal(after.local.keywords[0].position,4,'the same link now shows the new data');
  assert.equal(env.JOBS_DB.sqlite.prepare('SELECT previous_state FROM website_audits WHERE id=?').get(r.id).previous_state,null);
});
test('audit progress only moves forward and reaches 100% when complete',async t=>{
  const env={JOBS_DB:db(t),DATAFORSEO_LOGIN:'login',DATAFORSEO_PASSWORD:'secret',PAGESPEED_API_KEY:'key'};
  t.mock.method(globalThis,'fetch',async(url,options)=>{url=String(url);if(url.includes('dns-query'))return Response.json({Status:0,Answer:new URL(url).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});
    if(url.startsWith('https://www.googleapis.com/'))return Response.json({lighthouseResult:{categories:{performance:{score:0.6}},audits:{}}});
    if(url.startsWith('https://api.dataforseo.com/')){const body=JSON.parse(options.body)[0];return Response.json({status_code:20000,cost:0.01,tasks:[{status_code:20000,result:[url.includes('keyword_overview')?{items:body.keywords.map(k=>({keyword:k,keyword_info:{search_volume:50}}))}:{items:[]}]}]});}
    if(new URL(url).pathname==='/robots.txt')return new Response('',{status:404});
    const links=Array.from({length:6},(_,i)=>`<a href="/p${i}">P</a>`).join('');return new Response(good+links,{headers:{'Content-Type':'text/html'}});});
  let r=await api(env,'start',{url:'https://example.com/',maxPages:5,service:'roofer',town:'Cardiff,Wales,United Kingdom'});const seen=[auditProgress(r)];
  for(let i=0;r.status==='running'&&i<80;i++){r=await api(env,'advance',{id:r.id});seen.push(auditProgress(r));}
  assert.equal(r.status,'complete');assert.ok(seen[0]<=5,'starts near zero: '+seen[0]);assert.equal(seen.at(-1),100);
  for(let i=1;i<seen.length;i++)assert.ok(seen[i]>=seen[i-1],`went backwards at step ${i}: ${seen.join(',')}`);
  assert.ok(seen.slice(0,-1).every(p=>p<100),'never shows 100% before the audit has finished');
  assert.ok(new Set(seen).size>=seen.length*0.6,'moves on almost every step: '+seen.join(','));
});
test('a missing robots.txt with a large "not found" page does not stop the audit',async t=>{
  const env={JOBS_DB:db(t)},big='<html><body>'+'x'.repeat(200000)+'</body></html>';
  t.mock.method(globalThis,'fetch',async url=>{url=String(url);if(url.includes('dns-query'))return Response.json({Status:0,Answer:new URL(url).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});
    if(new URL(url).pathname==='/robots.txt')return new Response(big,{status:404,headers:{'Content-Type':'text/html'}});
    return new Response(good,{headers:{'Content-Type':'text/html'}});});
  let r=await api(env,'start',{url:'https://example.com/',maxPages:5});for(let i=0;r.status==='running'&&i<40;i++)r=await api(env,'advance',{id:r.id});
  assert.equal(r.status,'complete');assert.equal(r.robotsStatus,404);assert.ok(r.pages.some(p=>p.parsed),'pages were checked');
  assert.ok(!r.warnings.some(w=>/paused without crawling/.test(w)),r.warnings.join(' | '));
});
