const DAY=86400000;
const iso=d=>new Date(d).toISOString().slice(0,10);
const stamp=s=>Date.parse(s+'T12:00:00Z');
export function reportPeriods(input,timeZone,now=new Date()) {
 const today=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 let start,end,priorStart,priorEnd;
 if(input.period==='custom'){
  start=input.startDate;end=input.endDate;
  if(![start,end].every(s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(stamp(s))&&iso(stamp(s))===s))throw new Error('Choose valid start and end dates.');
  const days=(stamp(end)-stamp(start))/DAY+1;
  if(days<1||days>184)throw new Error('Choose a custom range of 1–184 days.');
  if(end>=today)throw new Error('The report must end before today in the Analytics property’s time zone.');
  priorEnd=iso(stamp(start)-DAY);priorStart=iso(stamp(start)-days*DAY);
 }else{
  const months=Number(input.period||1);if(![1,3,6].includes(months))throw new Error('Choose 1, 3 or 6 months, or a custom range.');
  const [y,m]=today.split('-').map(Number);const boundary=Date.UTC(y,m-1,1,12);
  start=iso(Date.UTC(y,m-1-months,1,12));end=iso(boundary-DAY);
  priorStart=iso(Date.UTC(y,m-1-months*2,1,12));priorEnd=iso(stamp(start)-DAY);
 }
 return {current:{startDate:start,endDate:end},previous:{startDate:priorStart,endDate:priorEnd},currentDays:(stamp(end)-stamp(start))/DAY+1,previousDays:(stamp(priorEnd)-stamp(priorStart))/DAY+1,timeZone};
}
export function parseReportInput(body){
 const property=String(body.property||'');if(!/^properties\/\d{1,20}$/.test(property))throw new Error('Choose a GA4 property.');
 const site=String(body.site||'');if(site.length>500||(site&&!/^sc-domain:[a-z0-9.-]+$/i.test(site)&&!/^https?:\/\/[^\s]+\/$/.test(site)))throw new Error('Choose a Search Console property or Analytics only.');
 return {property,site,period:String(body.period||'1'),startDate:body.startDate,endDate:body.endDate,country:body.country==='gbr'?'gbr':'all'};
}
export const overviewMetrics=['activeUsers','newUsers','sessions','engagedSessions','engagementRate','screenPageViews','keyEvents','sessionKeyEventRate','userEngagementDuration'];
const sessionMetrics=['sessions','engagementRate','keyEvents','sessionKeyEventRate'];
export const gaSets={overview:{metrics:overviewMetrics},organic:{metrics:overviewMetrics,organic:true},channels:{dimensions:['sessionDefaultChannelGroup'],metrics:sessionMetrics},sources:{dimensions:['sessionSourceMedium'],metrics:sessionMetrics},landing:{dimensions:['landingPage'],metrics:sessionMetrics},devices:{dimensions:['deviceCategory'],metrics:sessionMetrics},countries:{dimensions:['country'],metrics:sessionMetrics},events:{dimensions:['eventName'],metrics:['eventCount','keyEvents']},trend:{dimensions:['date'],metrics:['sessions','keyEvents']}};
export function gaRequest(state,kind){
 const spec=gaSets[kind],filters=[{filter:{fieldName:'platform',stringFilter:{matchType:'EXACT',value:'web'}}}];
 if(state.input.country==='gbr')filters.push({filter:{fieldName:'countryId',stringFilter:{matchType:'EXACT',value:'GB'}}});
 if(spec.organic)filters.push({filter:{fieldName:'sessionDefaultChannelGroup',stringFilter:{matchType:'EXACT',value:'Organic Search'}}});
 return {dateRanges:[{...state.periods.current,name:'current'},{...state.periods.previous,name:'previous'}],dimensions:(spec.dimensions||[]).map(name=>({name})),metrics:spec.metrics.map(name=>({name})),dimensionFilter:{andGroup:{expressions:filters}},limit:kind==='trend'?'400':'200',keepEmptyRows:false,returnPropertyQuota:true,orderBys:kind==='trend'?[{dimension:{dimensionName:'date'}}]:[{metric:{metricName:spec.metrics.includes('sessions')?'sessions':spec.metrics[0]},desc:true}]};
}
export function parseGa(data){
 const restricted=new Set((data.metadata?.schemaRestrictionResponse?.activeMetricRestrictions||[]).map(r=>r.metricName));
 const rows=(data.rows||[]).map(r=>{const dimensions=Object.fromEntries((data.dimensionHeaders||[]).map((h,i)=>[h.name,String(r.dimensionValues?.[i]?.value??'').slice(0,500)]));const metrics=Object.fromEntries((data.metricHeaders||[]).map((h,i)=>{const v=r.metricValues?.[i]?.value;return [h.name,restricted.has(h.name)||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v)];}));return {dimensions,metrics};});
 return {rows,rowCount:data.rowCount??rows.length,metadata:data.metadata||{}};
}
const metricRow=(d,period)=>d?.rows.find(r=>r.dimensions.dateRange===period)?.metrics||null;
export function comparison(a,b,type='number'){
 if(a==null||b==null||!Number.isFinite(a)||!Number.isFinite(b))return {text:'No comparable data',direction:'unknown',delta:null};
 const delta=a-b,direction=delta===0?'flat':(type==='position'?delta<0:delta>0)?'up':'down';
 if(type==='rate')return {text:`${delta>=0?'+':''}${(delta*100).toFixed(1)} percentage points`,direction,delta};
 if(type==='position')return {text:delta===0?'Unchanged':`${Math.abs(delta).toFixed(1)} positions ${delta<0?'better':'worse'}`,direction,delta};
 if(b===0)return {text:a===0?'No change':'No percentage baseline (previously 0)',direction,delta};
 return {text:`${delta>=0?'+':''}${(delta/b*100).toFixed(1)}%`,direction,delta};
}
export const metricDefinitions=[
 ['sessions','Website sessions','number','ga','Visits recorded by GA4. Consent choices and tracking changes can affect the count.'],
 ['activeUsers','Active users','number','ga','Distinct active users in this period; this is not a sum of daily user counts.'],
 ['newUsers','New users','number','ga','Users triggering their first visit. Returning devices and consent can affect identification.'],
 ['screenPageViews','Page views','number','ga','Page views recorded on the web, including repeat views.'],
 ['engagementRate','Engagement rate','rate','ga','Share of sessions GA4 classifies as engaged. Compare alongside traffic sources and key events.'],
 ['engagementSeconds','Engagement per active user','seconds','ga','Recorded engagement time divided by active users. This measures active engagement, not time between page loads.'],
 ['keyEvents','Key events','number','ga','Occurrences of events marked as important in GA4. These may include purchases, forms or other actions; they are not verified leads.'],
 ['sessionKeyEventRate','Session key event rate','rate','ga','Share of sessions with any key event. Repeated events in one session do not increase this rate in the same way as the event count.'],
 ['sessions','Organic search sessions','number','organic','Visits attributed to Organic Search across search engines. This will differ from Google Search Console clicks.'],
 ['keyEvents','Organic search key events','number','organic','Key events attributed to organic search sessions. Check which events represent meaningful enquiries.'],
 ['clicks','Google search clicks','number','gsc','Clicks from Google Web Search. This measures search traffic before GA4 tracking and consent apply.'],
 ['impressions','Google search impressions','number','gsc','Appearances in Google results. More impressions can reflect wider visibility or changes in search demand.'],
 ['ctr','Google search CTR','rate','gsc','Clicks divided by impressions. Search features, query mix and position can change the rate.'],
 ['position','Google average position','position','gsc','Average position across impressions. A lower number is better; changing query mix can move this average.'],
];
const withEngagement=m=>m?{...m,engagementSeconds:m.activeUsers>0&&m.userEngagementDuration!=null?m.userEngagementDuration/m.activeUsers:null}:null;
function gscTotal(rows){if(!rows?.length)return null;const r=rows[0];return {...r,position:r.impressions>0?r.position:null};}
export function buildAnalyticsReport(state,data){
 const ga={current:withEngagement(metricRow(data.overview,'current')),previous:withEngagement(metricRow(data.overview,'previous'))},organic={current:withEngagement(metricRow(data.organic,'current')),previous:withEngagement(metricRow(data.organic,'previous'))},gsc={current:gscTotal(data.gscCurrentTotals?.rows),previous:gscTotal(data.gscPreviousTotals?.rows)};
 const cards=metricDefinitions.filter(d=>d[3]!=='gsc'||state.input.site).map(([key,label,type,source,explanation])=>{const values={ga,organic,gsc}[source],current=values.current?.[key]??null,previous=values.previous?.[key]??null,change=comparison(current,previous,type);let insight;
  if(change.direction==='unknown')insight='One or both periods have no comparable returned value. Check data availability before interpreting a change.';
  else if(change.delta===0)insight='The recorded figure is unchanged between these periods.';
  else if(previous===0&&type==='number')insight='Activity was recorded after a zero baseline. A percentage growth figure would be misleading.';
  else if(key==='position')insight=`Average position is ${change.direction==='up'?'better':'worse'}. Review individual queries before attributing this to ranking changes.`;
  else if(type==='rate')insight=`The rate ${change.direction==='up'?'increased':'decreased'}. Review the traffic and query mix to understand why.`;
  else insight=`The recorded total ${change.direction==='up'?'increased':'decreased'}. This comparison describes the result; it does not establish its cause.`;
  if(source==='ga'&&key==='keyEvents'&&current===0)insight='No key events were recorded. Check that enquiry actions are configured and firing before judging lead performance.';
  if(source==='gsc'&&key==='ctr'&&gsc.current&&gsc.previous&&gsc.current.impressions>gsc.previous.impressions&&gsc.current.ctr<gsc.previous.ctr)insight='Impressions increased but clicks did not keep pace, so CTR fell. Review which new queries and pages gained visibility, and their search snippets.';
  if(source==='gsc'&&key==='clicks'&&gsc.current&&gsc.previous&&gsc.current.clicks<gsc.previous.clicks&&gsc.current.impressions<gsc.previous.impressions)insight='Both search clicks and impressions fell. Check the query and page tables to separate reduced visibility from lower search demand.';
  if(source==='ga'&&key==='sessions'&&ga.current&&ga.previous&&ga.current.sessions>ga.previous.sessions&&ga.current.engagementRate<ga.previous.engagementRate)insight='Visits increased while engagement rate fell. Review which channels and landing pages brought the additional traffic before treating all of the growth as better-quality visits.';
  if(source==='organic'&&key==='keyEvents'&&organic.current&&organic.previous&&organic.current.sessions>organic.previous.sessions&&organic.current.keyEvents<=organic.previous.keyEvents)insight='Organic visits increased, but recorded key events did not. Review organic landing pages and enquiry tracking to understand whether the extra traffic is useful.';
  const daily=type==='number'&&['sessions','clicks','impressions','screenPageViews','keyEvents'].includes(key)&&current!=null&&previous!=null?{current:current/state.periods.currentDays,previous:previous/state.periods.previousDays}:null;
  if(daily&&state.periods.currentDays!==state.periods.previousDays)insight+=` The periods contain ${state.periods.currentDays} and ${state.periods.previousDays} days; compare the daily averages as well.`;
  return {key,label,type,source,current,previous,change,explanation,insight,daily};
 });
 const warnings=[...state.warnings];
 for(const [kind,d]of Object.entries(data)){if(d.error){warnings.push(`${kind}: ${d.error}`);continue;}const meta=d.metadata||{};if(meta.subjectToThresholding)warnings.push(`${kind}: Google applied privacy thresholding; some data may be withheld.`);if(meta.dataLossFromOtherRow)warnings.push(`${kind}: some dimension values are grouped into “(other)”.`);if(meta.samplingMetadatas?.length)warnings.push(`${kind}: Google returned sampled data.`);if(meta.emptyReason)warnings.push(`${kind}: ${meta.emptyReason}`);if(meta.schemaRestrictionResponse?.activeMetricRestrictions?.length)warnings.push(`${kind}: restricted metrics are shown as unavailable.`);if(d.rowCount>d.rows?.length)warnings.push(`${kind}: showing ${d.rows.length} of ${d.rowCount} rows, ranked by the requested metric. Missing rows are not assumed to be zero.`);}
 if(!ga.current)warnings.push('No current GA4 totals were returned. Check the selected property, dates, country and web tracking.');
 if(!ga.previous)warnings.push('No previous GA4 totals were returned. A full period comparison is unavailable.');
 if(state.input.site&&(!gsc.current||!gsc.previous))warnings.push('Search Console has no comparable totals for one or both periods. Check available history; older data may be outside Google’s retention window.');
 return {input:state.input,property:state.property,periods:state.periods,generatedAt:new Date().toISOString(),cards,data,warnings:[...new Set(warnings)]};
}
