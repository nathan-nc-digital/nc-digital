const DAY=86400000;
const date=d=>new Date(d).toISOString().slice(0,10);
export function periods(days=28,now=new Date()){
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const end=Date.parse(today+'T12:00:00Z')-3*DAY,start=end-(days-1)*DAY;
  return {current:{startDate:date(start),endDate:date(end)},previous:{startDate:date(start-days*DAY),endDate:date(start-DAY)},days};
}
export function parseWinInput(body){
  const site=String(body.site||'');if(site.length>500||!( /^sc-domain:[a-z0-9.-]+$/i.test(site)||/^https?:\/\/[^\s]+\/$/.test(site)))throw new Error('Choose a Search Console property.');
  const days=Number(body.days||28);if(![28,56,84].includes(days))throw new Error('Choose 28, 56 or 84 days.');
  const country=body.country==='all'?'all':'gbr',device=['all','MOBILE','DESKTOP','TABLET'].includes(body.device)?body.device:'all';
  const minImpressions=Number(body.minImpressions??50);if(!Number.isInteger(minImpressions)||minImpressions<10||minImpressions>100000)throw new Error('Minimum impressions must be between 10 and 100,000.');
  const ctr=Number(body.ctr??2);if(!Number.isFinite(ctr)||ctr<.1||ctr>20)throw new Error('Set a CTR threshold between 0.1% and 20%.');
  const brands=String(body.brands||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean).slice(0,10).map(x=>x.slice(0,80));
  return {site,days,country,device,minImpressions,ctr,brands};
}
export function metrics(row){if(!row)return null;const {clicks,impressions,position}=row;if(!Number.isFinite(clicks)||!Number.isFinite(impressions)||clicks<0||impressions<0)return null;return {clicks,impressions,ctr:impressions?clicks/impressions:0,position:impressions>0&&Number.isFinite(position)&&position>=1?position:null};}
export const change=(current,previous)=>current===null||previous===null?null:previous===0?null:(current-previous)/previous*100;
const safePage=x=>{try{const u=new URL(x);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
export const steps={
  'striking-distance':['Confirm the page matches the service, location and intent of this query.','Improve relevant sections with useful details and genuine project examples.','Add descriptive internal links from related pages; avoid creating a duplicate page for a close variant.'],
  'low-ctr':['Review the current search results for this query, including maps, ads and other features.','Check whether the title and description explain the offer accurately and give a clear reason to click.','Compare mobile and desktop performance before changing the snippet; a low CTR alone does not prove the copy is weak.'],
  'declining-page':['Check the page is accessible and indexable, and review recent website changes.','Check which queries lost clicks and whether demand or seasonality changed.','Compare the content and search intent with current competitors before editing.'],
  'lost-position':['Confirm the change in Search Console across devices and countries.','Check recent page changes, indexing, internal links and the current search results.','Improve the page only after identifying a likely cause; average position varies with query mix.'],
};
export function buildWins(input,range,data,warnings=[]){
  const currentPages=new Map((data.currentPages||[]).filter(x=>safePage(x.keys?.[0])).map(x=>[x.keys[0],metrics(x)]));
  const previousPages=new Map((data.previousPages||[]).filter(x=>safePage(x.keys?.[0])).map(x=>[x.keys[0],metrics(x)]));
  const previousPairs=new Map((data.previousPairs||[]).map(x=>[JSON.stringify(x.keys),metrics(x)]));
  const opportunities=[],seen=new Set();
  const add=(type,page,query,current,previous,reason)=>{const key=JSON.stringify([type,page,query]);if(seen.has(key))return;seen.add(key);const score=Math.min(100,Math.round(Math.log10(1+current.impressions)*13+(type==='declining-page'?25:type==='lost-position'?20:15)+(current.position!==null&&current.position<=12?10:0)));opportunities.push({type,page,query,current,previous,reason,score,confidence:current.impressions>=200?'More evidence':'Limited sample',actions:steps[type]});};
  for(const row of data.currentPairs||[]){const [query,page]=row.keys||[];if(!query||!safePage(page)||input.brands.some(b=>query.toLowerCase().includes(b)))continue;const m=metrics(row),p=previousPairs.get(JSON.stringify(row.keys))||null;if(!m||m.impressions<input.minImpressions||m.position===null)continue;
    if(m.position>=5&&m.position<=20)add('striking-distance',page,query,m,p,`${m.impressions} impressions with an average position of ${m.position.toFixed(1)}. This is within the selected 5–20 opportunity range.`);
    if(m.position<=10&&m.impressions>=Math.max(100,input.minImpressions)&&m.ctr<input.ctr/100)add('low-ctr',page,query,m,p,`${(m.ctr*100).toFixed(1)}% CTR from ${m.impressions} impressions, below your ${input.ctr}% screening threshold, with average position ${m.position.toFixed(1)}.`);
    if(p&&p.impressions>=input.minImpressions&&p.position!==null&&m.position-p.position>=2&&m.clicks<p.clicks)add('lost-position',page,query,m,p,`Average position moved from ${p.position.toFixed(1)} to ${m.position.toFixed(1)}, while clicks fell from ${p.clicks} to ${m.clicks}.`);
  }
  for(const [page,current]of currentPages){const previous=previousPages.get(page);if(!current||!previous||previous.clicks<10||Math.max(current.impressions,previous.impressions)<input.minImpressions)continue;const delta=change(current.clicks,previous.clicks);if(delta<=-20&&previous.clicks-current.clicks>=5)add('declining-page',page,'',current,previous,`Page clicks fell ${Math.abs(delta).toFixed(0)}% (${previous.clicks} → ${current.clicks}) between equal periods. Check demand and seasonality before attributing this to SEO changes.`);}
  opportunities.sort((a,b)=>b.score-a.score||b.current.impressions-a.current.impressions||a.page.localeCompare(b.page));
  const totalOpportunities=opportunities.length;
  opportunities.splice(300);
  const groups=new Map();for(const item of opportunities){let group=groups.get(item.page);if(!group){group={page:item.page,score:item.score,current:currentPages.get(item.page)||null,previous:previousPages.get(item.page)||null,types:[],queries:[],opportunities:[]};groups.set(item.page,group);}if(!group.types.includes(item.type))group.types.push(item.type);if(item.query&&!group.queries.includes(item.query))group.queries.push(item.query);group.opportunities.push(item);}
  const missingCurrent=[...previousPages].filter(([page,m])=>m?.clicks>=10&&!currentPages.has(page)).map(([page,previous])=>({page,previous,reason:'This page was not returned for the current period. Missing rows are not treated as zero traffic; check the page directly in Search Console.'}));
  return {input,periods:range,generatedAt:new Date().toISOString(),overview:{current:metrics(data.currentTotals?.[0]),previous:metrics(data.previousTotals?.[0])},trend:(data.trend||[]).map(r=>({date:r.keys?.[0],...metrics(r)})),opportunities,pages:[...groups.values()].slice(0,100).map(p=>({...p,queries:p.queries.slice(0,15),opportunities:p.opportunities.slice(0,30).map(o=>opportunities.indexOf(o))})),missingCurrent:missingCurrent.slice(0,50),coverage:{currentPairs:data.currentPairs?.length||0,previousPairs:data.previousPairs?.length||0,currentPages:currentPages.size,previousPages:previousPages.size},warnings:[...warnings,...(totalOpportunities>300?['The display is limited to the top 300 opportunities and 100 page plans.']:[])]};
}
