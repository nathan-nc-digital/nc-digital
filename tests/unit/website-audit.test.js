import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { auditUrl,publicIp,auditFetch,parsePage,crawlLinks,robotsPolicy,findingsFor } from '../../src/lib/website-audit.js';
import { handleWebsiteAudit } from '../../src/lib/website-audit-api.js';
const origin='https://nc-digital.co.uk';
function db(t){const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync('migrations/0008_website_audits.sql','utf8'));t.after(()=>sqlite.close());return {sqlite,prepare(sql){const s=sqlite.prepare(sql);return {args:[],bind(...args){this.args=args;return this;},async first(){return s.get(...this.args)||null;},async all(){return {results:s.all(...this.args)};},async run(){return {meta:s.run(...this.args)};}};}};}
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
  const pages=[{url:'https://example.co.uk/',status:200,parsed:parsePage('<html><body><div id="app"></div></body></html>','https://example.co.uk/')},{url:'https://example.co.uk/blocked',status:403,error:'Blocked'},{url:'https://example.co.uk/missing',status:404}];const f=findingsFor({pages,linkChecks:[]});assert.equal(f.filter(x=>x.title==='A linked page is missing').length,1);assert.ok(f.some(x=>x.title==='Page could not be fully checked'&&x.kind==='review'));assert.ok(f.some(x=>x.title==='Main page heading was not found'&&x.kind==='review'));
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
  });let r=await api(env,'start',{url:'https://example.com/',client:'Test roofer',maxPages:5});for(let i=0;r.status==='running'&&i<40;i++)r=await api(env,'advance',{id:r.id});assert.equal(r.status,'complete');assert.ok(r.pages.length<=5);assert.ok(r.linkChecks.length<=20);assert.ok(!calls.some(x=>x.endsWith('/private')));assert.ok(r.findings.some(x=>/missing page|page is missing/.test(x.title)));
  const before=calls.length;const cached=await api(env,'start',{url:'https://example.com/',maxPages:5});assert.equal(cached.cached,true);assert.equal(calls.length,before);await api(env,'notes',{id:r.id,client:'Client revised',summary:'A focused review.',notes:'Fix the service pages first.'});assert.equal((await api(env,'report?id='+r.id)).notes,'Fix the service pages first.');
});
test('simultaneous starts are serialized and cross-origin mutations rejected',async t=>{
  const env={JOBS_DB:db(t)},input={url:'https://example.com/'};const [a,b]=await Promise.all([handleWebsiteAudit(request('start',input),env),handleWebsiteAudit(request('start',input),env)]);assert.deepEqual([a.status,b.status].sort(),[200,409]);
  const bad=new Request(origin+'/admin/website-audit/api/start',{method:'POST',headers:{Origin:'https://other.com'},body:JSON.stringify(input)});assert.equal((await handleWebsiteAudit(bad,env)).status,403);
});
