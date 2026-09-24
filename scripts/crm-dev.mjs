// Isolated localhost preview: synthetic data only, no production credentials or mail transport.
import { createServer } from 'node:http';
import { readFileSync,existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { handleCrmApi,handleEnquiry } from '../src/lib/crm-api.js';
import { handleWorkspace } from '../src/lib/crm-workspace.js';
import { londonToday,plusDays } from '../src/lib/crm-domain.js';
const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
for(const name of ['0001_create_jobs_table.sql','0002_create_job_notes_table.sql','0003_add_completed_at.sql','0015_crm.sql','0016_crm_workspace.sql','0017_crm_reliability.sql','0018_crm_undated_tasks.sql','0019_crm_saved_views.sql','0020_crm_tags.sql','0021_crm_confirmation_kind.sql'])sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
const db={prepare(sql){const s=sqlite.prepare(sql);return {args:[],bind(...args){this.args=args;return this;},async first(){return s.get(...this.args)||null;},async all(){return {results:s.all(...this.args)};},async run(){const r=s.run(...this.args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
const env={JOBS_DB:db,CRM_ENABLED:'true'},origin='https://nc-digital.co.uk',root=path.resolve('dist');
const request=(route,body)=>new Request(origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
async function create(route,body){const response=await handleWorkspace(request('/admin/crm/api/workspace/'+route,body),env,'nathan');const data=await response.json();if(!response.ok)throw Error(data.error);return data;}
if(!process.argv.includes('--empty')){
  const today=londonToday();
  for(const [i,name] of ['Oak & Co. Builders','Coastal Studio','Swift Motor Services'].entries()){
    const account=await create('accounts',{id:crypto.randomUUID(),name,email:`contact${i}@example.com`,phone:'07700900123',website:'https://example.com',lifecycle:i===1?'customer':'prospect',allow_duplicate:true});
    await create('contacts',{id:crypto.randomUUID(),account_id:account.id,name:['Alex Morgan','Sam Evans','Jamie Taylor'][i],email:`contact${i}@example.com`,job_title:'Owner'});
    await create('opportunities',{id:crypto.randomUUID(),account_id:account.id,title:['Website redesign','SEO & content plan','Booking website'][i],service:['Web design','SEO','Development'][i],source:['Website','Returning customer','Referral'][i],stage_id:['quoted','qualified','new'][i],value_pence:[149900,90000,249900][i],next_action:['Follow up the proposal','Discuss SEO priorities','Arrange discovery call'][i],next_date:plusDays(today,i-1)});
    if(i===1)await create('services',{id:crypto.randomUUID(),account_id:account.id,name:'Hosting & maintenance',category:'Maintenance',price_pence:12500,frequency:'monthly',starts_on:'2026-01-01',renews_on:plusDays(today,12),status:'active'});
  }
  await handleEnquiry(request('/api/enquiries',{name:'Jordan Price',email:'jordan@example.com',company:'Example Landscaping',subject:'A website for our landscaping business',message:'Hi Nathan, we’re looking for a new website to show our recent projects. Could you let me know the next steps?',service:'Web design',from_page:'/contact/',submission_key:crypto.randomUUID()}),env);
}
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/admin/crm/api/')||url.pathname.startsWith('/api/enquiries')){
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>100000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
      const request=new Request(origin+url.pathname+url.search,{method:req.method,headers:{'Content-Type':'application/json',Origin:origin},...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
      const result=url.pathname.startsWith('/api/enquiries')?await handleEnquiry(request,env):await handleCrmApi(request,env,'nathan');res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
    }
    let requested=decodeURIComponent(url.pathname);if(requested.endsWith('/'))requested+='index.html';let file=path.resolve(root,'.'+requested);
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    if(!existsSync(file)&&!path.extname(file))file=path.join(file,'index.html');
    if(!existsSync(file)){res.writeHead(404);res.end('Not found.');return;}
    const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
    const payload=readFileSync(file);res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});res.end(payload);
  }catch(error){if(!res.headersSent)res.writeHead(500,{'Content-Type':'text/plain'});if(!res.writableEnded)res.end('Local preview request failed.');console.error(error.name+': '+error.message);}
});
const port=Number(process.env.CRM_PREVIEW_PORT||4350);server.listen(port,'127.0.0.1',()=>console.log(`Isolated CRM preview: http://127.0.0.1:${port}/admin/crm/ — synthetic records, email disabled`));
process.on('SIGINT',()=>server.close(()=>{sqlite.close();process.exit(0);}));
