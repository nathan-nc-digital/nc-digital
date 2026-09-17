import directoryList from '../../scripts/emd-directory-domains.json' with {type:'json'};
export const directoryDomains=[...new Set([...directoryList.filter(d=>d!=='org.uk'),'clutch.co','goodfirms.co','designrush.com','sortlist.com','yelp.co.uk','houzz.com','yell.co.uk','hotfrog.co.uk','brownbook.net','find-open.co.uk','uksmallbusinessdirectory.co.uk','business-directory.org.uk','companycheck.co.uk','bizify.co.uk','getagent.co.uk','zoopla.co.uk','rightmove.co.uk','booking.com','tripadvisor.co.uk','tripadvisor.com','upwork.com','fiverr.com','quora.com'])].sort();
export const normal=s=>String(s??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
export function domain(value){
 const text=String(value||'').trim();if(text.length>1000||/[\s\x00-\x1f]/.test(text))throw Error('Enter a valid business website.');
 let u;try{u=new URL(text.includes('://')?text:'https://'+text);}catch{throw Error('Enter a valid business website.');}
 const host=u.hostname.toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||host.length>253||!host.includes('.')||!host.split('.').every(p=>/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(p))||/^\d+(\.\d+)+$/.test(host)||/\.(localhost|local|internal|test|invalid)$/.test(host))throw Error('Enter a public business domain, without credentials or a custom port.');return host;
}
export const excluded=(host,extra=[])=>[...directoryDomains,...extra].some(d=>host===d||host.endsWith('.'+d));
export const owns=(host,target)=>host===target||host.endsWith('.'+target);
const terms=value=>[...new Set(String(value||'').split(/[,\n]/).map(normal).filter(Boolean))];
export function parseGapInput(body,extra=[]){
 const client=domain(body.client);if(excluded(client,extra))throw Error('Choose the client’s own business website, not a directory or platform.');
 const supplied=Array.isArray(body.competitors)?body.competitors:String(body.competitors||'').split(/[,\n]/);const competitors=[...new Set(supplied.filter(v=>String(v).trim()).map(domain))].sort();
 if(competitors.length<1||competitors.length>3)throw Error('Add one to three direct competitors.');
 for(const d of competitors){if(owns(d,client)||owns(client,d))throw Error('The client and competitor must be different businesses.');if(excluded(d,extra))throw Error(`${d} is excluded as a directory or platform. Choose a direct business competitor.`);}
 if(competitors.some((a,i)=>competitors.some((b,j)=>i!==j&&(owns(a,b)||owns(b,a)))))throw Error('Use separate competing businesses, rather than a domain and its subdomain.');
 const focus=terms(body.focus),brands=terms(body.brands);if(focus.length>5||focus.some(t=>t.length>60||!/^[-\p{L}\p{N} ']+$/u.test(t)))throw Error('Use up to five focus phrases, with letters, numbers, spaces or hyphens.');if(brands.length>15||brands.some(t=>t.length>80))throw Error('Use up to 15 brand terms, each under 80 characters.');
 const limit=Number(body.limit??100),minVolume=Number(body.minVolume??10),maxRank=Number(body.maxRank??20),budget=Number(body.budget??.5);
 if(![50,100,200].includes(limit))throw Error('Choose 50, 100 or 200 rows per lookup.');if(!Number.isInteger(minVolume)||minVolume<0||minVolume>100000)throw Error('Minimum volume must be between 0 and 100,000.');if(![10,20,50,100].includes(maxRank))throw Error('Choose a competitor position limit.');if(!Number.isFinite(budget)||budget<.05||budget>2)throw Error('Choose a spending limit between $0.05 and $2.00 USD.');
 return {client,competitors,focus,brands,limit,minVolume,maxRank,budget:Math.round(budget*100)/100,refresh:body.refresh===true,location:2826,language:'en'};
}
export const RESERVE=.05;
export function gapSteps(input){return input.competitors.flatMap(competitor=>['missing','shared'].map(kind=>({competitor,kind})));}
export function gapRequest(input,step){
 const filters=[['first_domain_serp_element.rank_group','<=',input.maxRank]];
 if(input.minVolume>0)filters.push('and',['keyword_data.keyword_info.search_volume','>=',input.minVolume]);
 if(input.focus.length){const f=[];for(const term of input.focus){if(f.length)f.push('or');f.push(['keyword_data.keyword','like','%'+term+'%']);}filters.push('and',f.length===1?f[0]:f);}
 return {target1:step.competitor,target2:input.client,location_code:2826,language_code:'en',intersections:step.kind==='shared',item_types:['organic'],include_serp_info:false,limit:input.limit,filters,order_by:['keyword_data.keyword_info.search_volume,desc']};
}
export const requestKey=(input,step)=>'gap-v1:'+JSON.stringify(gapRequest(input,step));
const numeric=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
function serp(item,target,extra){if(!item||item.type!=='organic'||!Number.isInteger(item.rank_group)||item.rank_group<1)return null;try{const u=new URL(item.url);const host=domain(item.url);if(!owns(host,target)||excluded(host,extra))return null;return {rank:item.rank_group,url:u.href.slice(0,1500),title:String(item.title||'').slice(0,300)};}catch{return null;}}
export function mapGapResult(input,step,result,extra=[]){
 const items=[];let discarded=0;
 for(const row of result?.items||[]){const data=row.keyword_data||{},keyword=normal(data.keyword),competitor=serp(row.first_domain_serp_element,step.competitor,extra),client=serp(row.second_domain_serp_element,input.client,extra);if(!keyword||keyword.length>300||!competitor||excluded(step.competitor,extra)||(step.kind==='shared'&&!client)){discarded++;continue;}
  items.push({keyword,volume:numeric(data.keyword_info?.search_volume),cpc:numeric(data.keyword_info?.cpc),difficulty:numeric(data.keyword_properties?.keyword_difficulty),intent:data.search_intent_info?.main_intent||null,metricsAt:data.keyword_info?.last_updated_time||null,serpAt:data.serp_info?.last_updated_time||null,competitor,client});
 }
 return {competitor:step.competitor,kind:step.kind,items,total:result?.total_count??null,returned:result?.items_count??result?.items?.length??0,discarded,fetchedAt:new Date().toISOString()};
}
const words=s=>new Set(normal(s).replace(/[^\p{L}\p{N}\s]/gu,' ').split(' ').filter(w=>w.length>2&&!['the','and','for','with','near','best','your','our','www','https','com'].includes(w)));
function relatedPage(keyword,pages){const tokens=words(keyword);let best=null,score=0;for(const p of pages){const pt=words(p.title+' '+new URL(p.url).pathname.replace(/[-/]/g,' ')),common=[...tokens].filter(t=>pt.has(t)).length,value=common/Math.max(1,tokens.size);if(common>=2&&value>=.6&&value>score){best=p;score=value;}}return best;}
export function buildGapReport(input,datasets,warnings=[],extra=[]){
 const accepted=datasets.filter(d=>!excluded(d.competitor,extra)&&!excluded(input.client,extra)).map(d=>({...d,items:(d.items||[]).filter(item=>{try{return !excluded(domain(item.competitor.url),extra);}catch{return false;}})})),groups=new Map(),pageMap=new Map();
 for(const d of accepted)for(const item of d.items||[]){if(excluded(domain(item.competitor.url),extra))continue;if(item.client)pageMap.set(item.client.url,item.client);if(input.brands.some(b=>item.keyword.includes(b)))continue;if(input.focus.length&&!input.focus.some(t=>item.keyword.includes(t)))continue;if(input.minVolume>0&&(item.volume===null||item.volume<input.minVolume))continue;
  let group=groups.get(item.keyword);if(!group){group={keyword:item.keyword,volume:item.volume,cpc:item.cpc,difficulty:item.difficulty,intent:item.intent,metricsAt:item.metricsAt,evidence:[]};groups.set(item.keyword,group);}if(item.metricsAt&&(!group.metricsAt||item.metricsAt>group.metricsAt))Object.assign(group,{volume:item.volume,cpc:item.cpc,difficulty:item.difficulty,intent:item.intent,metricsAt:item.metricsAt});
  if(!group.evidence.some(e=>e.domain===d.competitor&&e.kind===d.kind))group.evidence.push({domain:d.competitor,kind:d.kind,...item.competitor,client:item.client,at:d.fetchedAt});
 }
 const opportunities=[];
 for(const group of groups.values()){
  const observed=group.evidence.filter(e=>e.client).map(e=>e.client).sort((a,b)=>a.rank-b.rank),client=observed[0]||null,best=Math.min(...group.evidence.map(e=>e.rank));
  if(client&&client.rank-best<3)continue;
  const type=client?'improve':'missing',suggested=client||relatedPage(group.keyword,[...pageMap.values()]),informational=group.intent==='informational'||/^(how|what|why|when|can|does)\b/.test(group.keyword)||/\b(guide|tips)\b/.test(group.keyword),action=client?'Improve existing page':suggested?'Review a related page first':informational?'Consider a useful article':'Consider a service page';
  const score=Math.min(100,Math.max(0,Math.round(Math.log10(1+(group.volume||0))*13+new Set(group.evidence.map(e=>e.domain)).size*8+(client?Math.min(20,(client.rank-best)*.8):10)+(['commercial','transactional'].includes(group.intent)?12:0)-(group.difficulty??50)*.12)));
  const tasks=client?['Check that the ranking page matches the query’s service, location and intent.','Compare the competitor pages for useful details, proof and questions your page does not cover.','Improve relevant sections and internal links, then measure the result.']:suggested?['Review this related URL before creating another page; the match is based on words in its title and path.','Decide whether the existing page can satisfy this query without changing its main purpose.','Create a separate page only when the service or search intent is genuinely distinct.']:['Check the website inventory first: an absent ranking does not prove a page is missing.','Confirm the client actually offers this service or can answer the question with useful expertise.','If a new page is justified, build original content around the query and link it from relevant pages.'];
  opportunities.push({...group,type,client,bestCompetitorRank:best,competitorCount:new Set(group.evidence.map(e=>e.domain)).size,suggestedPage:suggested?.url||null,suggestionHeuristic:!client&&!!suggested,action,score,tasks,mixedSnapshots:!!client&&group.evidence.some(e=>!e.client)});
 }
 opportunities.sort((a,b)=>b.score-a.score||(b.volume||0)-(a.volume||0)||a.keyword.localeCompare(b.keyword));const total=opportunities.length;opportunities.splice(300);
 const plans=new Map();for(const o of opportunities){const key=o.suggestedPage||o.evidence.slice().sort((a,b)=>a.rank-b.rank)[0].url+'|'+o.action;let p=plans.get(key);if(!p){p={title:o.keyword,action:o.action,page:o.suggestedPage,keywords:[],score:o.score,tasks:o.tasks};plans.set(key,p);}p.keywords.push(o.keyword);}
 const coverage=accepted.map(d=>({competitor:d.competitor,kind:d.kind,returned:d.returned,total:d.total,discarded:d.discarded,fetchedAt:d.fetchedAt,cached:!!d.cached,error:d.error||null}));
 return {input:{...input,competitors:input.competitors.filter(d=>!excluded(d,extra))},generatedAt:new Date().toISOString(),opportunities,plans:[...plans.values()].slice(0,100),coverage,warnings:[...new Set([...warnings,...(total>300?['Showing the top 300 opportunities and up to 100 page plans.']:[]),...(datasets.length!==accepted.length?['Directory exclusions were applied to this saved report.']:[])])],datasets:accepted};
}
