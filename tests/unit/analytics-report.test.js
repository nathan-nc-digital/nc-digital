import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {reportPeriods,parseReportInput,gaRequest,parseGa,comparison,buildAnalyticsReport} from '../../src/lib/analytics-report.js';
import {handleAnalyticsReport} from '../../src/lib/analytics-report-api.js';
const property='properties/123',site='sc-domain:example.co.uk',clock=new Date('2026-09-09T12:00:00Z');
test('one and six completed calendar months compare against preceding calendar months',()=>{
 const one=reportPeriods({period:'1'},'Europe/London',clock);assert.deepEqual(one.current,{startDate:'2026-08-01',endDate:'2026-08-31'});assert.deepEqual(one.previous,{startDate:'2026-07-01',endDate:'2026-07-31'});
 const six=reportPeriods({period:'6'},'Europe/London',clock);assert.deepEqual(six.current,{startDate:'2026-03-01',endDate:'2026-08-31'});assert.deepEqual(six.previous,{startDate:'2025-09-01',endDate:'2026-02-28'});assert.equal(six.currentDays,184);assert.equal(six.previousDays,181);
 const leap=reportPeriods({period:'1'},'Europe/London',new Date('2024-03-01T12:00Z'));assert.equal(leap.current.endDate,'2024-02-29');assert.equal(leap.currentDays,29);
});
test('property time zone determines completed months and custom periods stay equal and non-overlapping',()=>{
 const p=reportPeriods({period:'1'},'America/Los_Angeles',new Date('2026-09-01T01:00Z'));assert.equal(p.current.endDate,'2026-07-31');
 const custom=reportPeriods({period:'custom',startDate:'2026-07-15',endDate:'2026-08-14'},'Europe/London',clock);assert.equal(custom.currentDays,31);assert.equal(custom.previousDays,31);assert.equal(custom.previous.endDate,'2026-07-14');
 for(const range of [{startDate:'2026-02-30',endDate:'2026-03-10'},{startDate:'2025-01-01',endDate:'2026-08-01'},{startDate:'2026-09-01',endDate:'2026-09-09'},{startDate:'2026-08-10',endDate:'2026-08-01'}])assert.throws(()=>reportPeriods({period:'custom',...range},'Europe/London',clock));
 assert.throws(()=>parseReportInput({property:'../../other'}));
});
test('GA requests use named date ranges, web traffic and matching country/organic filters',()=>{
 const state={input:{country:'gbr'},periods:reportPeriods({period:'6'},'Europe/London',clock)},q=gaRequest(state,'organic');assert.deepEqual(q.dateRanges.map(r=>r.name),['current','previous']);assert.equal(q.metrics.length,9);assert.ok(q.dimensionFilter.andGroup.expressions.some(f=>f.filter.stringFilter.value==='GB'));assert.ok(q.dimensionFilter.andGroup.expressions.some(f=>f.filter.stringFilter.value==='Organic Search'));assert.ok(q.dimensionFilter.andGroup.expressions.some(f=>f.filter.stringFilter.value==='web'));assert.equal(gaRequest(state,'landing').dimensions[0].name,'landingPage');
});
test('GA parsing uses headers and preserves missing and restricted values',()=>{
 const d=parseGa({dimensionHeaders:[{name:'dateRange'},{name:'landingPage'}],metricHeaders:[{name:'sessions'},{name:'keyEvents'}],rows:[{dimensionValues:[{value:'previous'},{value:'/contact/'}],metricValues:[{value:'0'},{value:'bad'}]}],metadata:{schemaRestrictionResponse:{activeMetricRestrictions:[{metricName:'sessions'}]}}});assert.equal(d.rows[0].dimensions.dateRange,'previous');assert.equal(d.rows[0].metrics.sessions,null);assert.equal(d.rows[0].metrics.keyEvents,null);
});
test('rates use percentage points, lower positions improve, and zero/missing baselines stay explicit',()=>{
 assert.equal(comparison(.6,.5,'rate').text,'+10.0 percentage points');assert.equal(comparison(8,10,'position').direction,'up');assert.equal(comparison(null,5).direction,'unknown');assert.match(comparison(10,0).text,/No percentage baseline/);assert.equal(comparison(0,0).text,'No change');
});
test('report insights use independent totals, daily averages, and disclose thresholding and truncated lists',()=>{
 const state={input:{property,site},property:{id:property,name:'Client'},periods:reportPeriods({period:'6'},'Europe/London',clock),warnings:[]};const totals={rows:[{dimensions:{dateRange:'current'},metrics:{sessions:100,activeUsers:40,userEngagementDuration:1200,keyEvents:0}},{dimensions:{dateRange:'previous'},metrics:{sessions:90,activeUsers:30,keyEvents:5}}],rowCount:2,metadata:{subjectToThresholding:true}};
 const r=buildAnalyticsReport(state,{overview:totals,landing:{rows:[],rowCount:500},gscCurrentTotals:{rows:[{clicks:20,impressions:200,ctr:.1,position:5}]}});assert.equal(r.cards.find(c=>c.key==='engagementSeconds').current,30);assert.equal(r.cards.find(c=>c.key==='sessions').current,100);assert.equal(r.cards.find(c=>c.key==='sessions').daily.current,100/184);assert.match(r.cards.find(c=>c.key==='keyEvents').insight,/No key events/);assert.equal(r.cards.find(c=>c.key==='clicks').previous,null);assert.ok(r.warnings.some(w=>w.includes('thresholding')));assert.ok(r.warnings.some(w=>w.includes('500')));
});
function database(t){const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync('migrations/0010_analytics_reports.sql','utf8'));sqlite.exec(fs.readFileSync('migrations/0025_seo_clients.sql','utf8'));t.after(()=>sqlite.close());return {sqlite,prepare(sql){const s=sqlite.prepare(sql);return {args:[],bind(...args){this.args=args;return this;},async first(){return s.get(...this.args)||null;},async all(){return {results:s.all(...this.args)};},async run(){return {meta:s.run(...this.args)};}};},async batch(items){sqlite.exec('BEGIN');try{const results=[];for(const s of items)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};}
const request=(route,body)=>new Request('https://nc-digital.co.uk/admin/analytics-reports/api/'+route,{method:body?'POST':'GET',headers:{Origin:'https://nc-digital.co.uk','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
async function api(env,route,body){const r=await handleAnalyticsReport(request(route,body),env),d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;}
function provider(t,{disabled=false,transient=false}={}){const calls=[];let failed=false;t.mock.method(globalThis,'fetch',async(url,opts)=>{
 calls.push(url);if(url.includes('oauth2'))return Response.json({access_token:'private-token'});assert.equal(opts.headers.Authorization,'Bearer private-token');
 if(disabled&&url.includes('analyticsadmin'))return Response.json({error:{details:[{reason:'SERVICE_DISABLED',metadata:{service:'analyticsadmin.googleapis.com'}}]}},{status:403});
 if(url.includes('accountSummaries'))return Response.json({accountSummaries:[{displayName:'Agency',propertySummaries:[{property,displayName:'Client'}]}]});
 if(url.includes('analyticsadmin'))return url.endsWith(property)?Response.json({name:property,displayName:'Client',timeZone:'Europe/London'}):Response.json({error:{}},{status:403});
 if(url.endsWith('/sites'))return Response.json({siteEntry:[{siteUrl:site,permissionLevel:'siteOwner'}]});
 const q=JSON.parse(opts.body);
 if(url.includes('webmasters'))return Response.json({rows:[{keys:q.dimensions.length?[q.dimensions[0]==='date'?'2026-08-01':'example']:[],clicks:10,impressions:100,ctr:.1,position:5}]});
 if(transient&&!failed){failed=true;return Response.json({error:{}},{status:429});}
 return Response.json({dimensionHeaders:[...q.dimensions,{name:'dateRange'}],metricHeaders:q.metrics,rows:['current','previous'].map(period=>({dimensionValues:[...q.dimensions.map(d=>({value:d.name==='date'?'20260801':'Organic Search'})),{value:period}],metricValues:q.metrics.map(m=>({value:m.name.includes('Rate')?'0.5':'100'}))})),rowCount:2});
 });return calls;}
test('combined six-month report persists every step, caches expensive calls and saves client notes',async t=>{
 const env={JOBS_DB:database(t),GOOGLE_ANALYTICS_CONFIG:'{}',GOOGLE_GSC_CONFIG:'{}'},calls=provider(t);let r=await api(env,'start',{property,site,period:'6'});assert.equal(r.stages.length,17);for(let i=0;r.status==='running'&&i<20;i++)r=await api(env,'advance',{id:r.id});assert.equal(r.status,'complete');assert.equal(r.report.cards.length,14);const before=calls.filter(u=>u.includes(':runReport')||u.includes('searchAnalytics/query')).length;const cached=await api(env,'start',{property,site,period:'6'});assert.equal(cached.id,r.id);assert.equal(cached.cached,true);assert.equal(calls.filter(u=>u.includes(':runReport')||u.includes('searchAnalytics/query')).length,before);await api(env,'notes',{id:r.id,notes:'Updated service pages.'});assert.equal((await api(env,'report?id='+r.id)).notes,'Updated service pages.');assert.ok(!JSON.stringify(r).includes('private-token'));
});
test('quota failures keep progress unchanged and can be resumed without duplicating chunks',async t=>{
 const env={JOBS_DB:database(t),GOOGLE_ANALYTICS_CONFIG:'{}'};provider(t,{transient:true});let r=await api(env,'start',{property});const failed=await handleAnalyticsReport(request('advance',{id:r.id}),env);assert.equal(failed.status,429);assert.equal((await api(env,'report?id='+r.id)).stage,0);r=await api(env,'advance',{id:r.id});assert.equal(r.stage,4,'four Google steps run together');assert.equal(env.JOBS_DB.sqlite.prepare('SELECT COUNT(*) AS n FROM analytics_report_data').get().n,4,'one saved result per step, no duplicates');
});
test('disabled APIs are actionable, saved history works, and origin/property checks reject requests',async t=>{
 const env={JOBS_DB:database(t),GOOGLE_ANALYTICS_CONFIG:'{}',GOOGLE_GSC_CONFIG:'{}'};provider(t,{disabled:true});const c=await api(env,'connection');assert.equal(c.connected,false);assert.match(c.message,/Enable the Analytics Admin API/);assert.deepEqual((await api(env,'history')).reports,[]);assert.equal((await handleAnalyticsReport(new Request('https://nc-digital.co.uk/admin/analytics-reports/api/start',{method:'POST',headers:{Origin:'https://other.co.uk'},body:'{}'}),env)).status,403);
});
test('concurrent starts serialize; stopping preserves completed reports',async t=>{
 const env={JOBS_DB:database(t),GOOGLE_ANALYTICS_CONFIG:'{}'};provider(t);const responses=await Promise.all([handleAnalyticsReport(request('start',{property}),env),handleAnalyticsReport(request('start',{property}),env)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);const r=await responses.find(r=>r.status===200).json();await api(env,'stop',{id:r.id});assert.equal((await api(env,'report?id='+r.id)).status,'stopped');assert.equal((await handleAnalyticsReport(request('start',{property:'properties/999'}),env)).status,403);
});
test('website form enquiry counts are saved with a report, returned with it, validated and clearable',async t=>{
 const env={JOBS_DB:database(t),GOOGLE_ANALYTICS_CONFIG:'{}',GOOGLE_GSC_CONFIG:'{}'};provider(t);let r=await api(env,'start',{property,site,period:'1'});for(let i=0;r.status==='running'&&i<20;i++)r=await api(env,'advance',{id:r.id});
 assert.equal((await api(env,'report?id='+r.id)).forms,null);
 await api(env,'enquiries',{id:r.id,current:6,previous:2,file:'wpforms-entries.csv',column:'Date Created'});
 const saved=await api(env,'report?id='+r.id);assert.deepEqual({current:saved.forms.current,previous:saved.forms.previous,file:saved.forms.file,column:saved.forms.column},{current:6,previous:2,file:'wpforms-entries.csv',column:'Date Created'});
 for(const bad of [{current:-1},{current:1.5},{current:'x'},{current:2000000}])assert.equal((await handleAnalyticsReport(request('enquiries',{id:r.id,...bad}),env)).status,400,JSON.stringify(bad));
 await api(env,'enquiries',{id:r.id,current:null});assert.equal((await api(env,'report?id='+r.id)).forms,null,'cleared');
});
