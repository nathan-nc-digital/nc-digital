// Client-facing website review: rendering shared by the admin report and the public /report/ page,
// plus clientView(), the only data the public page is ever sent.
export const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const date=x=>new Date(x).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
export function groups(findings){const map=new Map();for(const f of findings){const key=f.title+'|'+f.kind;const group=map.get(key)||{...f,items:[]};group.items.push(f);map.set(key,group);}return [...map.values()];}
export const secs=ms=>ms==null?'—':(Math.round(ms/100)/10)+'s';
const tone=v=>v>=85?'good':v>=70?'ok':v>=50?'warn':'bad';
export const link=u=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`;
const PRIORITY={high:'Urgent',medium:'Important',low:'Worth fixing',review:'Check'};
// Issues tied to the whole website (or to Google) rather than specific pages don't list pages.
const SITE_WIDE=/^(local-|map-pack|psi-|sitemap|http-redirect|schema|copyright|social|tap-to-call|contact)/;
// DataForSEO reports cost-per-click in US dollars; shown to clients as an approximate sterling figure.
const gbp=usd=>'£'+(usd*0.79).toFixed(2);

// ---- Client report: only what a business owner will recognise and care about ----
function scoreHtml(r){const s=r.score;if(!s)return '';const speedMeasured=s.categories.some(c=>c.key==='speed'&&c.measured);
  return `<section class="doc-score"><div class="score-ring ${tone(s.overall)}" style="--score:${Number(s.overall)}"><strong>${Number(s.overall)}</strong><span>out of 100</span></div><div class="score-body"><p class="eyebrow">WEBSITE HEALTH SCORE</p><h3>${esc(s.grade)}</h3><div class="score-bars">${s.categories.filter(c=>c.measured).map(c=>`<div class="score-bar"><span>${esc(c.label)}</span><div class="bar"><i class="${tone(c.score)}" style="width:${Number(c.score)}%"></i></div><b>${Number(c.score)}</b></div>`).join('')}</div><p class="score-note">Based on the issues in this review${speedMeasured?' and Google’s own speed test':''}.</p></div></section>`;}
function localHtml(r){const l=r.local;if(!l)return '';const place=esc(l.townLabel),svc=esc(l.service),name=esc(r.client);
  const checked=l.keywords.filter(k=>k.checked),main=checked[0];if(!main)return '';
  const total=l.keywords.reduce((s,k)=>s+(k.volume||0),0),page1=checked.filter(k=>k.position&&k.position<=10).length,maxCpc=Math.max(0,...l.keywords.map(k=>k.cpc||0));
  const pos=k=>!k.checked?'<span class="pos none">—</span>':k.position?`<b class="pos ${k.position<=3?'good':k.position<=10?'ok':'bad'}">#${k.position}</b>`:'<b class="pos bad">Not in top 30</b>';
  const map=main.mapPackShown?(main.inMapPack?`${name} <strong>is shown</strong> in the Google Maps results.`:`${name} <strong>is not shown</strong> in the Google Maps results.`):'';
  const meaning=page1===0||!main.position||main.position>10
    ?`These are people actively looking for a ${svc} in ${place}. At the moment their enquiries go to the businesses listed above. A dedicated ${svc} page for ${place}, a complete Google Business Profile and a steady build-up of genuine reviews and local links are how ${name} can start competing for these searches.`
    :main.position<=3&&page1===checked.length?`${name} already ranks well for these searches. The opportunity is to cover more related services and protect these positions.`
    :`${name} is visible for some of these searches, but not in the positions that win most clicks. Stronger service pages, more local reviews and better internal linking can move it up.`;
  return `<section class="doc-local"><p class="eyebrow">LOCAL SEARCH</p><h3>${svc[0]?.toUpperCase()+svc.slice(1)} in ${place}: who customers find on Google</h3>
  <div class="local-headline"><p>${total?`Around <strong>${total.toLocaleString('en-GB')}</strong> searches a month for ${svc} services in ${place}.`:`People search Google for ${svc} services in ${place} every month.`}</p><p>${name} appears on the first page of Google for <strong>${page1} of ${checked.length}</strong> searches checked. ${map}</p>${maxCpc?`<p>Businesses advertising on Google pay up to about <strong>${gbp(maxCpc)} per click</strong> for these searches.</p>`:''}</div>
  <div class="doc-table-wrap"><table class="doc-table local-table"><thead><tr><th>What people search</th><th>Searches a month</th><th>Cost per ad click</th><th>Where you appear on Google</th></tr></thead><tbody>${l.keywords.map(k=>`<tr><td>${esc(k.keyword)}</td><td data-label="Searches a month">${typeof k.volume==='number'?k.volume.toLocaleString('en-GB'):'<span class="pos none">Too few to measure</span>'}</td><td data-label="Cost per ad click">${k.cpc?gbp(k.cpc):'—'}</td><td data-label="Where you appear on Google">${pos(k)}</td></tr>`).join('')}</tbody></table></div>
  <div class="local-leaders"><div><h4>Top Google results for “${esc(main.keyword)}”</h4><ol>${main.top3.map(t=>`<li><strong>${esc(t.domain)}</strong><span>${esc(t.title)}</span></li>`).join('')||'<li>No results recorded.</li>'}</ol></div>${main.mapPackShown?`<div><h4>Shown in Google Maps</h4><ol>${(main.mapPackDetails||main.mapPack.map(title=>({title}))).map(b=>`<li><strong>${esc(b.title)}</strong>${typeof b.rating==='number'?`<span class="map-rating">${b.rating.toFixed(1)} ★${typeof b.reviews==='number'?` · ${b.reviews.toLocaleString('en-GB')} Google review${b.reviews===1?'':'s'}`:''}</span>`:''}</li>`).join('')}</ol>${main.inMapPack?'':`<p class="map-missing">${esc(r.client)} is not shown here.</p>`}</div>`:''}</div>
  <p class="local-meaning">${meaning}</p>
  <p class="doc-section-copy">Searches a month are Google’s estimates. Positions come from a Google search made in ${place} on ${date(r.createdAt)} and change over time. Ad costs are approximate.</p></section>`;}
function speedHtml(r){const m=r.speed?.mobile,d=r.speed?.desktop;if(typeof m?.performance!=='number')return '';
  const tile=(label,v)=>`<div class="doc-stat speed ${typeof v==='number'?(v>=90?'good':v>=50?'ok':'bad'):''}"><strong>${typeof v==='number'?v:'—'}<small>/100</small></strong><span>${label}</span></div>`;
  const lcp=m.field?.lcp?.p75??m.lab?.lcpMs;
  return `<h3>How fast the website loads</h3><div class="doc-stats speed-stats">${tile('Speed on phones',m.performance)}${typeof d?.performance==='number'?tile('Speed on computers',d.performance):''}</div>
  ${lcp?`<p class="doc-section-copy">On a phone, the main content takes about <strong>${secs(lcp)}</strong> to appear. Google recommends <strong>2.5 seconds or less</strong>.</p>`:''}<p class="doc-section-copy">Scores come from Google’s own speed test. 90 or above is good; below 50 is poor.</p>`;}
// ---- What NC Digital can offer: a new WordPress build for sites on other platforms, local SEO for
// sites already on WordPress. Nathan can override the automatic choice per report. ----
const PLATFORM_NAMES=[[/wordpress/i,'WordPress'],[/wix/i,'Wix'],[/squarespace/i,'Squarespace'],[/shopify/i,'Shopify'],[/godaddy/i,'GoDaddy'],[/webflow/i,'Webflow'],[/duda/i,'Duda'],[/weebly/i,'Weebly'],[/jimdo/i,'Jimdo']];
export const OFFER_CHOICES=['auto','website','seo','none'];
export function offerFor(r){
  if(r.offerView!==undefined)return r.offerView;
  const raw=(r.pages||[]).find(p=>p.parsed?.platform)?.parsed.platform||'';
  const platform=PLATFORM_NAMES.find(([re])=>re.test(raw))?.[1]||null;
  const choice=OFFER_CHOICES.includes(r.offer)?r.offer:'auto';
  if(choice==='none')return null;
  return {type:choice==='auto'?(platform==='WordPress'?'seo':'website'):choice,platform};
}
// ---- Case studies that look like the prospect's business: same trade first, then same industry ----
const TRADES=/plumb|roof|electric|build|carpent|joiner|plaster|heating|gas|boiler|paint|decorat|landscap|garden|fenc|driveway|pav|kitchen|bathroom|window|glaz|door|floor|tile|til(er|ing)|locksmith|scaffold|groundwork|brick|cladding|insulat|solar|damp|clean|removal|skip|mechanic|garage|handyman|trade/i;
// Industries a prospect's service belongs to, matched against the portfolio's industry tags.
const INDUSTRIES=[['trades',TRADES],['property',/propert|estate agent|letting|develop/i],['events',/event|venue|wedding|festival|party/i],['energy',/solar|energy|renewable|ev charg|heat pump/i],['ecommerce',/shop|store|ecommerce|retail|boutique/i]];
// Only genuinely similar work is shown: the same trade first, then the same industry. No match, no section.
export function similarWork(portfolio,r){
  if(!portfolio?.length)return [];
  const service=String(r.local?.service||'').toLowerCase(),stem=service.split(/\s+/).find(w=>w.length>3)?.replace(/(ers|er|ians|ian|ing|s)$/,'')||'';
  const industries=INDUSTRIES.filter(([,re])=>re.test(service)).map(([tag])=>tag);
  // Same trade outranks a specific industry, which outranks the general trades tag.
  const score=p=>(stem&&(p.slug.includes(stem)||p.title.toLowerCase().includes(stem))?4:0)+(p.industry.some(tag=>tag!=='trades'&&industries.includes(tag))?2:0)+(p.industry.includes('trades')&&industries.includes('trades')?1:0);
  return portfolio.map((p,i)=>({p,i,s:score(p)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s||a.i-b.i).slice(0,3).map(x=>x.p);
}
// With no similar case studies, point to the whole portfolio instead of showing unrelated work.
function workHtml(r,portfolio){const work=similarWork(portfolio,r);if(!work.length)return '<p class="offer-portfolio"><a href="https://nc-digital.co.uk/portfolio/" target="_blank" rel="noopener">See the websites we have built for other local businesses →</a></p>';
  return `<div class="offer-work"><h4>Similar work we have done</h4><div class="work-grid">${work.map(p=>`<a class="work-card" href="https://nc-digital.co.uk/portfolio/${esc(p.slug)}/" target="_blank" rel="noopener">${p.image?`<img src="${esc(/^\//.test(p.image)?'https://nc-digital.co.uk'+p.image:p.image)}" alt="${esc(p.title)} website" loading="lazy" width="640" height="400"/>`:''}<strong>${esc(p.title)}</strong></a>`).join('')}</div></div>`;}
function offerHtml(r,portfolio){const offer=offerFor(r);if(!offer)return '';
  const name=esc(r.client),l=r.local,main=l?.keywords?.find(k=>k.checked),svc=l?esc(l.service):'',place=l?esc(l.townLabel):'';
  const notRanking=main&&(!main.position||main.position>10),mapsMissing=main?.mapPackShown&&!main.inMapPack;
  const phone=r.speed?.mobile?.performance,visible=(r.findings||[]).filter(f=>!f.internal),urgent=visible.filter(f=>f.priority==='high').length;
  const pages=r.pagesChecked??new Set((r.pages||[]).filter(p=>p.parsed).map(p=>p.url)).size;
  const volume=main&&typeof main.volume==='number'&&main.volume>0?` (about ${main.volume.toLocaleString('en-GB')} searches a month)`:'';
  const points=[];
  if(offer.type==='website'){
    points.push(l?`A multi-page website with a dedicated page for each service and for ${place} and the other areas you cover. These pages are what Google ranks${notRanking?', and right now the website is not on the first page':''}.`:'A multi-page website with a dedicated page for each service and each area you cover. These pages are what Google ranks.');
    if(pages&&pages<=3)points.push(`The current website has only ${pages} page${pages===1?'':'s'}, which gives Google very little to rank. Each new page is another chance to appear in search results.`);
    if(typeof phone==='number'&&phone<90)points.push(`Built to load quickly on phones (the current website scores ${phone}/100).`);
    if(visible.length)points.push(`Every issue in this review fixed as part of the build${urgent?`, including the ${urgent} urgent one${urgent===1?'':'s'}`:''}.`);
    points.push('A mobile-friendly design tailored to your business, with a clear contact form and tap-to-call phone number.','Full WordPress setup with a premium plugin package worth £300 included. You own the website and can update it yourself.','You work directly with Nathan from the first conversation to launch.');
    return `<section class="doc-offer" id="offer"><p class="eyebrow">WHAT WE CAN OFFER</p><h3>A multi-page WordPress website, built to win customers on Google</h3>
    <p class="offer-lead">${offer.platform?`${name}’s website is currently built with ${esc(offer.platform)}. `:''}We would rebuild it as a multi-page website on WordPress, the platform behind over 40% of the world’s websites. Giving every service and area its own page is the most reliable way to build up Google rankings over time, and WordPress gives you full control and room to keep adding pages as the business grows.</p>
    <ul class="offer-points">${points.map(p=>`<li>${p}</li>`).join('')}</ul>${workHtml(r,portfolio)}
    <div class="offer-price"><div><strong>Multi-page WordPress website</strong><span>Quoted to your needs, with a page for every service and area you cover.</span></div><div class="offer-links"><a class="offer-btn" href="https://nc-digital.co.uk/contact">Get a free quote →</a><a href="https://nc-digital.co.uk/services/web-design/">About our web design</a></div></div>
    <p class="offer-about">NC Digital was founded in 2025 by Nathan Constance, a professional web developer since 2015 who built his first website in 2008. Based in Merthyr Tydfil, working with businesses across South Wales.</p></section>`;
  }
  if(main)points.push(`Target “${esc(main.keyword)}”${volume} and the other local searches in this review, so ${name} appears when people in ${place} are looking for a ${svc}.`);
  points.push(mapsMissing?'Set up and optimise your Google Business Profile to get you into the Google Maps results.':'Optimise your Google Business Profile so you stand out in Google Maps.');
  points.push(l?`Create and improve service and area pages on your existing WordPress website, such as ${svc} in ${place}.`:'Create and improve service and area pages on your existing WordPress website.');
  if(visible.length)points.push(`Fix the issues in this review${typeof phone==='number'&&phone<90?`, including speed on phones (currently ${phone}/100)`:''}.`);
  points.push('Build local citations and links, and send you a monthly report showing where you rank.');
  return `<section class="doc-offer" id="offer"><p class="eyebrow">WHAT WE CAN OFFER</p><h3>Local SEO to get ${name} onto the first page of Google</h3>
  <p class="offer-lead">Your website is built on WordPress, so there is no need to start again. We would work with your existing website to improve where you appear on Google, and keep improving it month by month.</p>
  <ul class="offer-points">${points.map(p=>`<li>${p}</li>`).join('')}</ul>
  <div class="offer-price"><div><strong>Local SEO &amp; Google ranking</strong><span>A plan built around your area and the searches that bring in work. We recommend a minimum of 3 months, as SEO takes time to show in Google’s results.</span></div><div class="offer-links"><a class="offer-btn" href="https://nc-digital.co.uk/contact">Get a free SEO quote →</a><a href="https://nc-digital.co.uk/services/local-seo-google-ranking/">About our local SEO service</a></div></div>
  <p class="offer-about">NC Digital was founded in 2025 by Nathan Constance, a professional web developer since 2015 who built his first website in 2008. Based in Merthyr Tydfil, working with businesses across South Wales.</p></section>`;
}
export function documentHtml(r,{portfolio=[]}={}){const scanned={length:r.pagesChecked??new Set(r.pages.filter(p=>p.parsed).map(p=>p.url)).size},all=groups(r.findings.filter(f=>!f.internal));
  const host=new URL(r.finalUrl||r.url).hostname.replace(/^www\./,'');
  const summary=r.summary||`We checked ${scanned.length} page${scanned.length===1?'':'s'} of ${host}${r.local?.keywords?.some(k=>k.checked)?` and how the business appears when people in ${r.local.townLabel} search Google for a ${r.local.service}`:''}. Below is what is holding the website back, most important first, and what we would do about it.`;
  const pages=g=>{if(SITE_WIDE.test(g.id))return '';const urls=[...new Set(g.items.map(f=>f.page).filter(Boolean))];return urls.length?`<p class="found-on">Pages affected: ${urls.slice(0,4).map(u=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u.replace(/^https?:\/\/(www\.)?/,''))}</a>`).join(', ')}${urls.length>4?` and ${urls.length-4} more`:''}</p>`:'';};
  return `<article class="document"><div class="doc-top"><div class="doc-brand">NC <span>Digital</span></div><small>WEBSITE REVIEW<br/>Prepared ${date(r.createdAt)}</small></div><p class="eyebrow">PREPARED FOR ${esc(r.client).toUpperCase()}</p><h2>Website review</h2><p class="doc-meta">${link(r.finalUrl||r.url)}</p><p class="doc-intro">${esc(summary)}</p>${offerFor(r)?'<a class="offer-jump" href="#offer"><span>What we can offer to help improve your business online</span><b aria-hidden="true">↓</b></a>':''}${scoreHtml(r)}${localHtml(r)}${speedHtml(r)}
  ${r.status!=='complete'?'<p class="doc-warning">Some checks were not finished, so this review may not show everything.</p>':''}
  <h3>What we recommend</h3>
  ${all.length?all.map(g=>`<section class="finding"><span class="badge ${g.priority}">${PRIORITY[g.priority].toUpperCase()}</span><h4>${esc(g.title)}</h4><p>${esc(g.why)}</p><p><strong>What we would do:</strong> ${esc(g.fix)}</p>${pages(g)}</section>`).join(''):`<p class="doc-section-copy">${scanned.length?'No problems were found in the areas we checked.':'The website could not be checked. Please get in touch and we will look at it directly.'}</p>`}
  ${offerHtml(r,portfolio)}
  ${r.notes?`<h3>Next steps</h3><div class="doc-notes">${esc(r.notes)}</div>`:''}
  <h3>About this review</h3><div class="doc-limits"><ul><li>Checked on ${date(r.createdAt)}. Websites and Google results change over time.</li><li>We looked at up to ${r.maxPages} pages of the website${typeof r.speed?.mobile?.performance==='number'?' and ran Google’s speed test on the homepage':''}. A full review may find more.</li></ul></div><footer class="doc-footer"><span>NC Digital · Website design & marketing</span><a href="https://nc-digital.co.uk">nc-digital.co.uk</a></footer></article>`;
}


// Everything the public link may show, copied field by field so internal findings, evidence,
// errors, spend and crawl detail can never reach a client even if the stored report grows.
export function clientView(r){const l=r.local,m=r.speed?.mobile;
  return {client:r.client,createdAt:r.createdAt,url:r.url,finalUrl:r.finalUrl,status:r.status,summary:r.summary,notes:r.notes,maxPages:r.maxPages,
    pagesChecked:new Set((r.pages||[]).filter(p=>p.parsed).map(p=>p.url)).size,score:r.score||null,
    local:l?{service:l.service,townLabel:l.townLabel,keywords:(l.keywords||[]).map(k=>({keyword:k.keyword,volume:k.volume??null,cpc:k.cpc??null,checked:Boolean(k.checked),position:k.position??null,mapPackShown:Boolean(k.mapPackShown),inMapPack:Boolean(k.inMapPack),mapPack:k.mapPack||[],mapPackDetails:(k.mapPackDetails||[]).map(b=>({title:b.title,rating:b.rating??null,reviews:b.reviews??null})),top3:(k.top3||[]).map(t=>({position:t.position,domain:t.domain,title:t.title}))}))}:null,
    speed:typeof m?.performance==='number'?{mobile:{performance:m.performance,field:{lcp:m.field?.lcp?{p75:m.field.lcp.p75}:null},lab:{lcpMs:m.lab?.lcpMs??null}},desktop:{performance:r.speed?.desktop?.performance??null}}:null,
    offerView:offerFor(r),
    findings:(r.findings||[]).filter(f=>!f.internal).map(f=>({id:f.id,title:f.title,why:f.why,fix:f.fix,page:f.page,priority:f.priority,kind:f.kind}))};
}

// ---- The email that goes out with the report link. Plain text: the CRM adds the greeting-free
// "Kind regards, Nathan" sign-off and signature, so the copy must not include its own. ----
export function reviewEmailCopy(r,name,url){
  const first=String(name||'').trim().split(/\s+/)[0]||'',host=(()=>{try{return new URL(r.finalUrl||r.url).hostname.replace(/^www\./,'');}catch{return r.client;}})();
  const l=r.local,checked=(l?.keywords||[]).filter(k=>k.checked),main=checked[0];
  const lines=[`Hi${first?' '+first:''},`,''];
  lines.push(`I’ve put together a free review of ${host} and how ${r.client} shows up on Google${l?` when people in ${l.townLabel} search for a ${l.service}`:''}.`,'');
  if(main){
    const total=(l.keywords||[]).reduce((s,k)=>s+(k.volume||0),0),page1=checked.filter(k=>k.position&&k.position<=10).length,maps=main.mapPackShown&&!main.inMapPack;
    const demand=total?`Around ${total.toLocaleString('en-GB')} people a month search for a ${l.service} in ${l.townLabel}, but`:'People search for a '+l.service+' in '+l.townLabel+' every month, but';
    const standing=page1===0?`at the moment ${r.client} is not on the first page of Google for any of the ${checked.length} searches I checked`:`at the moment ${r.client} is on the first page of Google for only ${page1} of the ${checked.length} searches I checked`;
    lines.push(`${demand} ${standing}${maps?', and is not shown in the Google Maps results':''}.`,'');
  }else{
    const count=(r.findings||[]).filter(f=>!f.internal).length,urgent=(r.findings||[]).filter(f=>!f.internal&&f.priority==='high').length;
    if(count)lines.push(`It found ${count} thing${count===1?'':'s'} holding the website back${urgent?`, including ${urgent} I would treat as urgent`:''}.`,'');
  }
  lines.push('You can see the full review here:',url,'','It also covers what I would recommend to fix it. I am happy to talk it through with no obligation, just reply to this email.');
  return lines.join('\n');
}
