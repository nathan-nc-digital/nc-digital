import { parse } from 'parse5';
import { readLimitedBody } from './social-http.js';

const clean = x => String(x||'').replace(/\s+/g,' ').trim();
export function auditUrl(input) {
  let url;try{url=new URL(/^https?:\/\//i.test(input)?input:'https://'+input);}catch{throw new Error('Enter a public website address, such as example.co.uk.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||url.hostname.length>253||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)||/\.(localhost|local|internal|test|invalid|example|onion)$/i.test(url.hostname))throw new Error('Use a public domain with no login details or custom port.');
  if(url.search)throw new Error('Use a page address without query parameters.');
  if(url.href.length>1000)throw new Error('The page address is too long to audit.');
  url.hash='';return url;
}
export function publicIp(ip) {
  if(ip.includes(':'))return /^2[0-9a-f]{3}:/i.test(ip)&&!/^2001:(?:0:|db8:|2:|10:|20:)/i.test(ip)&&!/^2002:/i.test(ip);
  const p=ip.split('.').map(Number);if(p.length!==4||p.some(x=>!Number.isInteger(x)||x<0||x>255))return false;
  const [a,b]=p;return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51)||a===203&&b===0);
}
export async function publicHost(hostname,deadline=Date.now()+12000) {
  const ips=[];
  for(const type of ['A','AAAA']){
    if(Date.now()>=deadline)throw new Error('The website lookup timed out.');
    const r=await fetch('https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(hostname)+'&type='+type,{headers:{Accept:'application/dns-json'},signal:AbortSignal.timeout(Math.max(1,Math.min(5000,deadline-Date.now())))});
    if(!r.ok)throw new Error('Public DNS could not be checked.');
    const data=JSON.parse(new TextDecoder().decode(await readLimitedBody(r,65536)));
    if(![0,3].includes(data.Status))throw new Error('Public DNS could not be checked.');
    ips.push(...(data.Answer||[]).filter(x=>[1,28].includes(x.type)).map(x=>x.data));
  }
  if(!ips.length||ips.some(ip=>!publicIp(ip)))throw new Error('This hostname does not resolve exclusively to public addresses.');
}
export async function auditFetch(input, { max=1500000, method='GET', successBodyOnly=false }={}) {
  let url=auditUrl(input);const host=url.hostname.replace(/^www\./,'');const redirects=[],deadline=Date.now()+25000;
  for(let i=0;i<4;i++){
    await publicHost(url.hostname,deadline);
    if(url.hostname.replace(/^www\./,'')!==host)throw new Error('This address redirects to another website. Audit '+url.hostname+' separately.');
    if(Date.now()>=deadline)throw new Error('The website lookup timed out.');
    const started=Date.now();const r=await fetch(url.href,{method,redirect:'manual',headers:{'User-Agent':'NCDigitalAudit/1.0 (+https://nc-digital.co.uk/)','Accept':'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1'},signal:AbortSignal.timeout(Math.max(1,Math.min(12000,deadline-Date.now())))});
    if([301,302,303,307,308].includes(r.status)){const target=r.headers.get('location');await r.body?.cancel();if(!target)throw new Error('A redirect did not include a destination.');redirects.push(url.href);url=auditUrl(new URL(target,url).href);continue;}
    // successBodyOnly: some sites answer a missing file with a large HTML error page; its content is not needed.
    if(successBodyOnly&&r.status!==200)await r.body?.cancel();
    const bytes=method==='HEAD'||(successBodyOnly&&r.status!==200)?new Uint8Array():await readLimitedBody(r,max);return {url:url.href,status:r.status,type:r.headers.get('content-type')||'',robots:(r.headers.get('x-robots-tag')||'').slice(0,1000),html:new TextDecoder().decode(bytes),bytes:bytes.length,responseMs:Date.now()-started,redirects};
  }throw new Error('Too many redirects.');
}
// A UK landline or mobile number written as text (07…, 01…, 02…, 03…, 08…, +44…).
const UK_PHONE=/(?:\+44\s?(?:\(0\)\s?)?|(?<![\d])0)(?:[1237]\d|8[0-9])[\d\s-]{7,11}\d(?![\d])/;
const PLATFORMS=[[/wp-content\/|wp-includes\//i,'WordPress'],[/static\.wixstatic\.com|wix-code|_wixCIDX/i,'Wix'],[/static1\.squarespace\.com|squarespace-cdn\.com/i,'Squarespace'],[/cdn\.shopify\.com|Shopify\.theme/i,'Shopify'],[/data-wf-site=/i,'Webflow'],[/img1\.wsimg\.com/i,'GoDaddy Website Builder'],[/irp\.cdn-website\.com|dudamobile/i,'Duda'],[/\/_next\/static\//,'Next.js'],[/\/_astro\//,'Astro']];
function detectPlatform(html){
  const head=String(html||'').slice(0,500000);
  const generator=head.match(/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']{1,80})["']/i)||head.match(/<meta[^>]+content=["']([^"']{1,80})["'][^>]*name=["']generator["']/i);
  if(generator)return clean(generator[1]);
  return PLATFORMS.find(([re])=>re.test(head))?.[1]||'';
}
function schemaTypes(value,depth=0,out=new Set()){
  if(depth>6||out.size>=20||!value||typeof value!=='object')return [...out];
  if(Array.isArray(value)){for(const v of value.slice(0,50))schemaTypes(v,depth+1,out);return [...out];}
  for(const t of [].concat(value['@type']||[]))if(typeof t==='string'&&t.length<80)out.add(t.replace(/^https?:\/\/schema\.org\//,''));
  for(const v of Object.values(value))if(v&&typeof v==='object')schemaTypes(v,depth+1,out);
  return [...out];
}
export function parsePage(html,url) {
  const document=parse(html),p={url,titles:[],descriptions:[],h1:[],viewport:'',robots:'',canonical:'',lang:'',links:[],images:0,missingAlt:0,forms:0,phone:false,email:false,schema:false,ogTitle:false,ogImage:false,insecureAssets:0,wordCount:0,schemaTypes:[],copyrightYear:null,phoneText:false,platform:detectPlatform(html)};
  let base=url,words='';
  const stack=[{node:document,hidden:false}];let visited=0;
  function text(node){let out='';const nodes=[node];let count=0;while(nodes.length&&count++<10000){const n=nodes.pop();if(n.nodeName==='#text')out+=' '+n.value;else if(!['script','style','template','noscript'].includes(n.tagName))nodes.push(...(n.childNodes||[]).slice().reverse());}return clean(out).slice(0,1000);}
  while(stack.length&&visited++<60000){const {node:n,hidden}=stack.pop();const a=Object.fromEntries((n.attrs||[]).map(x=>[x.name,x.value])),tag=n.tagName;const invisible=hidden||['script','style','template','noscript','head'].includes(tag)||'hidden'in a||a['aria-hidden']==='true';
    if(tag==='base'&&a.href&&a.href.length<1000){try{base=new URL(a.href,url).href;}catch{}}
    if(tag==='title'&&p.titles.length<5)p.titles.push(text(n));if(tag==='h1'&&p.h1.length<10)p.h1.push(text(n));if(tag==='html')p.lang=(a.lang||'').slice(0,50);
    if(tag==='meta'){const name=(a.name||a.property||'').toLowerCase();if(name==='description'&&p.descriptions.length<5)p.descriptions.push(clean(a.content).slice(0,1000));if(name==='viewport')p.viewport=(a.content||'').slice(0,500);if(['robots','googlebot'].includes(name))p.robots=(p.robots+' '+(a.content||'')).slice(0,1000);if(name==='og:title')p.ogTitle=true;if(name==='og:image')p.ogImage=true;}
    if(tag==='link'&&(a.rel||'').toLowerCase().split(/\s+/).includes('canonical'))p.canonical=(a.href||'').slice(0,1000);
    if(tag==='script'&&(a.type||'').toLowerCase()==='application/ld+json'){p.schema=true;if(p.schemaTypes.length<20){try{p.schemaTypes=[...new Set([...p.schemaTypes,...schemaTypes(JSON.parse((n.childNodes||[]).map(c=>c.value||'').join('').slice(0,100000)))])].slice(0,20);}catch{}}}
    if(tag==='img'){p.images++;if(!('alt'in a))p.missingAlt++;}
    if(tag==='form')p.forms++;
    if(tag==='a'&&a.href&&a.href.length<=1000&&p.links.length<100){p.phone ||= /^tel:/i.test(a.href);p.email ||= /^mailto:/i.test(a.href);p.links.push({href:a.href,anchor:text(n).slice(0,120)});}
    if(['img','script','iframe','link','source'].includes(tag)&&/^http:/i.test(a.src||a.href||''))p.insecureAssets++;
    if(n.nodeName==='#text'&&!invisible&&words.length<100000)words+=' '+n.value;
    stack.push(...(n.childNodes||[]).slice().reverse().map(node=>({node,hidden:invisible})));
  }
  const visible=clean(words);p.wordCount=visible.split(' ').filter(Boolean).length;
  p.phoneText=UK_PHONE.test(visible);
  const years=[...visible.matchAll(/(?:©|\(c\)|copyright)[^0-9]{0,40}?((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi)].map(m=>Number(m[2]||m[1]));p.copyrightYear=years.length?Math.max(...years):null;
  p.links=p.links.map(l=>{try{return {anchor:l.anchor,url:new URL(l.href,base).href};}catch{return {anchor:l.anchor,url:''};}}).filter(l=>l.url&&l.url.length<=1000);return p;
}
export function crawlLinks(page,origin) {
  return [...new Set(page.links.map(x=>x.url).filter(href=>{try{const u=auditUrl(href);return u.origin===origin&&!/\.(pdf|png|jpe?g|webp|svg|zip|css|js|xml|mp4|gif|ico)$/i.test(u.pathname)&&!/(^|\/)(admin|wp-admin|wp-login|logout|login|cart|checkout|account|delete)(\/|\.|$)/i.test(u.pathname);}catch{return false;}}).map(x=>{const u=new URL(x);u.hash='';return u.href;}))].sort((a,b)=>Number(/contact|service|about|quote/i.test(b))-Number(/contact|service|about|quote/i.test(a))).slice(0,60);
}
export function robotsPolicy(text,path) {
  const groups=[];let group=null,hasRules=false;
  for(const raw of text.split(/\r?\n/)){const line=raw.split('#')[0].trim(),m=line.match(/^([^:]+):\s*(.*)$/);if(!m)continue;const key=m[1].toLowerCase(),value=m[2].trim();if(key==='user-agent'){if(!group||hasRules){group={agents:[],rules:[]};groups.push(group);hasRules=false;}group.agents.push(value.toLowerCase());}else if(group&&['allow','disallow'].includes(key)){hasRules=true;if(value)group.rules.push({allow:key==='allow',path:value});}}
  const specific=groups.filter(g=>g.agents.some(a=>'ncdigitalaudit'.startsWith(a)&&a!=='*'));const chosen=specific.length?specific:groups.filter(g=>g.agents.includes('*'));
  const matches=chosen.flatMap(g=>g.rules).filter(r=>{const re=r.path.split('*').map(s=>s.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('.*').replace(/\\\$$/,'$');try{return new RegExp('^'+re).test(path);}catch{return path.startsWith(r.path);}}).sort((a,b)=>b.path.length-a.path.length||Number(b.allow)-Number(a.allow));return !matches.length||matches[0].allow;
}
const CATEGORY={'broken-link':'trust',broken:'trust',title:'seo',description:'seo',heading:'seo',viewport:'speed',zoom:'speed',noindex:'seo',alt:'trust',lang:'trust',https:'trust',mixed:'trust',canonical:'seo',duplicate:'seo',contact:'enquiry',social:'enquiry','title-length':'seo','description-length':'seo',thin:'seo',schema:'enquiry','tap-to-call':'enquiry',copyright:'trust',sitemap:'seo','sitemap-robots':'seo','http-redirect':'trust','psi-mobile':'speed','psi-cls':'speed','psi-desktop':'speed','psi-accessibility':'trust','local-rank':'seo','local-rank-more':'seo','map-pack':'enquiry'};
// Shown to Nathan but left out of the client report and score: technical details clients would not recognise.
const INTERNAL=new Set(['lang','sitemap-robots']);
const BUSINESS_SCHEMA=/(Organi[sz]ation|Business|Store|Shop|Contractor|Plumber|Electrician|Roofing|Locksmith|HVAC|Dentist|Attorney|Restaurant|Agency|Clinic|Physician|Salon|Hotel|Corporation|Service|Company)$/i;
const EXEMPT_THIN=/contact|privacy|cookie|terms|thank|login|basket|cart|sitemap|legal|gdpr|policy|accessibility|404/i;
export function findingsFor(state,now=new Date()) {
  const findings=[];const add=(id,priority,title,why,fix,page,evidence,kind='confirmed')=>findings.push({id:id+'-'+findings.length,priority,title,why,fix,page,evidence,kind,internal:kind==='review'||INTERNAL.has(id),category:CATEGORY[id]||null,...(id.startsWith('psi-')?{source:'pagespeed'}:{})});
  const pages=[...new Map(state.pages.filter(p=>p.parsed).map(p=>[p.url,p])).values()],seen=new Set();
  for(const link of state.linkChecks||[])if([404,410].includes(link.status))add('broken-link','high','A link on the website leads to an error page','Visitors following this link reach a dead end.','Fix or remove the broken link.',link.url,'Destination returned HTTP '+link.status+'. Linked from: '+pages.filter(p=>p.parsed.links.some(l=>l.url===link.url)).map(p=>p.url).join(', '));
  for(const p of state.pages){
    if(p.parsed&&seen.has(p.url))continue;
    if(p.parsed)seen.add(p.url);
    if([404,410].includes(p.status))add('broken','high','A page on the website is missing','Visitors following this link reach a dead end.','Restore the page or update the links pointing to it.',p.requestedUrl||p.url,'HTTP '+p.status);
    else if(!p.parsed){add('unchecked','review','Page could not be fully checked','This is a coverage gap, not proof that the website is broken.','Open this page in a browser and investigate the recorded response.',p.requestedUrl||p.url,p.error||'HTTP '+p.status,'review');continue;}
    if(!p.parsed)continue;const d=p.parsed;
    if(!d.titles.some(Boolean))add('title','high','Page has no title for Google to show','The title is the blue link people click on in Google results.','Write a unique title describing the service and relevant location.',p.url,'No non-empty <title> found.');
    if(!d.descriptions.some(Boolean))add('description','medium','Page has no summary for Google to show','This is the short text under the link in Google. Without it, Google picks random text from the page.','Write a short summary of the service and why customers should choose the business.',p.url,'No non-empty meta description found.');
    if(!d.h1.some(Boolean))add('heading','medium','Main page heading was not found','A clear main heading helps visitors understand the page purpose.','Check the rendered page and add a descriptive main heading where needed.',p.url,'No non-empty H1 in the downloaded HTML.','review');
    if(!/width\s*=\s*device-width/i.test(d.viewport))add('viewport','high','Website is not set up properly for phones','Without it, phones show a shrunken desktop page that is hard to read.','Make the website fully mobile-friendly and test it on real phones.',p.url,d.viewport||'No viewport meta tag found.');
    if(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:[,.\s]|$)/i.test(d.viewport))add('zoom','medium','Visitors cannot zoom in on phones','People may need to enlarge text to read it comfortably.','Allow pinch-to-zoom so text can be enlarged.',p.url,d.viewport);
    if(/(?:^|[\s,:])(?:noindex|none)(?:$|[\s,])/i.test(d.robots+' '+p.robots))add('noindex','high','Page asks search engines not to index it','This can be intentional, but it matters if this page should attract search traffic.','Confirm whether exclusion is intended before removing the directive.',p.url,clean(d.robots+' '+p.robots),'review');
    if(d.missingAlt)add('alt','medium','Images have no text descriptions','Google cannot see pictures, and blind visitors’ screen readers have nothing to read out.','Add a short description to each important image.',p.url,`${d.missingAlt} of ${d.images} images have no alt attribute.`);
    if(!d.lang)add('lang','medium','Page language is not declared','Assistive technology uses the declared language to pronounce content.','Set the correct language on the HTML element.',p.url,'No lang attribute on <html>.');
    if(p.url.startsWith('http:'))add('https','high','Page is not secure (no padlock)','Browsers show a “Not secure” warning, which puts visitors off.','Install a security certificate and send every visitor to the secure version.',p.url,p.url);
    if(p.url.startsWith('https:')&&d.insecureAssets)add('mixed','medium','HTML references insecure resources','HTTP resources on an HTTPS page can be upgraded or blocked by browsers.','Replace resource URLs with HTTPS and check the browser console.',p.url,`${d.insecureAssets} HTTP resource references.`,'review');
    if(d.canonical){try{const canonical=new URL(d.canonical,p.url);if(canonical.hostname!==new URL(p.url).hostname)add('canonical','high','Canonical points to a different hostname','This may tell search engines that another website is the preferred version.','Confirm whether the cross-domain canonical is intentional.',p.url,canonical.href,'review');}catch{add('canonical','medium','Canonical address is invalid','Search engines may ignore an invalid canonical.','Use a valid preferred page URL.',p.url,d.canonical);}}
    const title=clean(d.titles[0]),description=clean(d.descriptions[0]);
    if(title.length>65)add('title-length','low','Google cuts off this page’s title','Google usually shows around 50–60 characters, so the end of a long title is often hidden.','Put the service and location first and keep the title to roughly 60 characters.',p.url,`${title.length} characters: ${title}`);
    else if(title&&title.length<20)add('title-length','low','This page’s Google title is too short','A short title misses the chance to name the service and area people search for.','Describe the service and location, for example “Roof Repairs in Cardiff | Business Name”.',p.url,`${title.length} characters: ${title}`);
    if(description.length>165)add('description-length','low','Google cuts off this page’s summary','Google usually shows around 150–160 characters of a description.','Lead with the offer and keep the description to roughly 155 characters.',p.url,`${description.length} characters.`);
    else if(description&&description.length<70)add('description-length','low','This page’s Google summary is too short','A short description gives searchers little reason to choose this result.','Summarise the service, area and a reason to get in touch in 120–155 characters.',p.url,`${description.length} characters: ${description}`);
    if(!EXEMPT_THIN.test(new URL(p.url).pathname)){
      if(d.wordCount<50)add('thin-empty','review','Very little text in the page HTML','The page may build its content with JavaScript, or it may genuinely have almost no written content.','Open the page in a browser; if the content is thin, add useful copy about the service, area and proof of quality.',p.url,`${d.wordCount} words found in the downloaded HTML.`,'review');
      else if(d.wordCount<250)add('thin','medium','Page has very little information on it','Pages with only a few sentences give search engines and visitors little to go on.','Expand the page with details of the service, the areas covered, pricing guidance, FAQs and examples of work.',p.url,`${d.wordCount} words of visible text.`);
    }
  }
  for(const field of ['titles','descriptions']){const groups=new Map();for(const p of pages){const value=clean(p.parsed[field][0]).toLowerCase();if(value){const group=groups.get(value)||[];group.push(p.url);groups.set(value,group);}}for(const [value,urls]of groups)if(urls.length>1)add('duplicate','medium',field==='titles'?'Several pages have the same Google title':'Several pages have the same Google summary','Google struggles to tell the pages apart, so they compete with each other.','Give each page its own title and summary.',urls[0],urls.join('\n')+'\nShared text: '+value);}
  if(pages.length){const homepage=pages[0];if(!pages.some(p=>p.parsed.forms||p.parsed.phone||p.parsed.email||p.parsed.links.some(l=>/contact|quote|book|enquir/i.test(l.anchor+' '+l.url))))add('contact','high','A clear enquiry route was not detected','Potential customers should be able to find a next step quickly.','Review the visible design and add an obvious contact, quote or booking action.',homepage.url,'No phone/email link, form or recognisable enquiry link in checked HTML.','review');
    if(!homepage.parsed.ogTitle||!homepage.parsed.ogImage)add('social','low','Website looks plain when shared on social media','A clear image and title help when somebody shares the website.','Set the title and picture that appear when the website is shared on Facebook, WhatsApp or LinkedIn.',homepage.url,`Open Graph title: ${homepage.parsed.ogTitle?'present':'not found'}; image: ${homepage.parsed.ogImage?'present':'not found'}.`);
  }
  if(pages.length){
    const homepage=pages[0];
    if(!pages.some(p=>p.parsed.schemaTypes?.some(t=>BUSINESS_SCHEMA.test(t))))add('schema','medium','Google is not given the business details directly','Websites can hand Google the business name, address, phone number and opening hours in a format it reads directly, which helps the business show properly in local results.','Add the business details in Google’s preferred format.',homepage.url,pages.some(p=>p.parsed.schemaTypes?.length)?'Schema types found: '+[...new Set(pages.flatMap(p=>p.parsed.schemaTypes||[]))].join(', '):'No JSON-LD structured data found on the pages checked.');
    const phonePage=pages.find(p=>p.parsed.phoneText);
    if(phonePage&&!pages.some(p=>p.parsed.phone))add('tap-to-call','medium','Phone number cannot be tapped to call','On a phone, visitors expect to tap the number to ring the business. Plain text numbers have to be copied or retyped.','Make every phone number tappable, especially in the header and footer.',phonePage.url,'A phone number appears in the page text, but no tel: link was found on the pages checked.');
    const year=Math.max(...pages.map(p=>p.parsed.copyrightYear||0));
    if(year&&year<now.getFullYear()-1)add('copyright','low','Website footer shows an old year',`A copyright year of ${year} can make visitors wonder whether the business is still active.`,'Update the footer year, ideally so it updates automatically.',pages.find(p=>p.parsed.copyrightYear===year).url,`Latest copyright year found: ${year}.`);
  }
  const sm=state.sitemap;
  if(sm?.checked&&!sm.found)add('sitemap','medium','Google is not given a list of the website’s pages','A sitemap helps search engines find and revisit every important page.','Create a sitemap (a list of pages for Google) and submit it through Google Search Console.',state.finalUrl||pages[0]?.url||'','Checked: '+(sm.tried||[]).join(', '));
  else if(sm?.found&&!sm.listedInRobots)add('sitemap-robots','low','Sitemap is not listed in robots.txt','Listing the sitemap in robots.txt helps every search engine find it, not only those it has been submitted to.',`Add “Sitemap: ${sm.url}” to robots.txt${state.robotsStatus===200?'':' (the site does not currently have a robots.txt file)'}.`,sm.url,`Sitemap found at ${sm.url}; not referenced in robots.txt.`);
  const hr=state.httpRedirect;
  if(hr?.checked&&!hr.redirects)add('http-redirect','high','Old website links show a “Not secure” warning','Anyone following an old link, or typing the address without “https”, sees a “Not secure” warning, and Google may see two copies of the website.','Set the website to always send visitors to the secure version.',hr.url,`${hr.url} returned HTTP ${hr.status} without redirecting to HTTPS.`);
  const mobile=state.speed?.mobile,desktop=state.speed?.desktop,url=state.finalUrl||pages[0]?.url||'';
  if(mobile&&typeof mobile.performance==='number'){
    const lcp=mobile.field?.lcp?.p75??mobile.lab?.lcpMs,tips=(mobile.opportunities||[]).map(o=>`• ${o.title}${o.savingsMs>=100?` (about ${seconds(o.savingsMs)} saving)`:''}`).join('\n');
    const evidence=`Google PageSpeed Insights mobile performance: ${mobile.performance}/100.${lcp?` Main content appears after ${seconds(lcp)}${mobile.field?.lcp?' for real visitors':' in a lab test'}.`:''}${tips?'\nBiggest opportunities:\n'+tips:''}`;
    if(mobile.performance<50)add('psi-mobile','high','Website is slow on phones','Most local searches happen on phones. Slow pages lose visitors before they see the offer, and Google takes speed into account when ranking.','Optimise images, remove unnecessary code and review the hosting so pages load quickly.',url,evidence);
    else if(mobile.performance<90)add('psi-mobile','medium','Website could load faster on phones','Faster pages keep more visitors and give a better impression on phones.','Optimise images and trim unnecessary code so pages appear sooner.',url,evidence);
    const cls=mobile.field?.cls?.p75??mobile.lab?.cls;
    if(typeof cls==='number'&&cls>0.1)add('psi-cls',cls>0.25?'high':'medium','Pages jump around while loading','Content that jumps around makes people tap the wrong thing and feels unpolished.','Fix how images and banners load so the page stays still.',url,`Cumulative Layout Shift: ${Math.round(cls*100)/100} (Google recommends 0.1 or less).`);
    if(typeof mobile.accessibility==='number'&&mobile.accessibility<80)add('psi-accessibility','medium','Website is harder to use for people with disabilities','Accessibility issues make the site harder to use for some visitors and can signal wider quality problems.','Improve text contrast, button labels and link wording.',url,`Google Lighthouse accessibility score: ${mobile.accessibility}/100.`);
  }else if(mobile?.error)add('psi-unavailable','review','Speed could not be measured','No speed score is included, so speed has not been assessed.','Run the page through PageSpeed Insights manually before drawing conclusions about speed.',url,mobile.error,'review');
  const local=state.local,checked=(local?.keywords||[]).filter(k=>k.checked);
  if(checked.length){
    const main=checked[0],place=local.townLabel||local.town,demand=typeof main.volume==='number'&&main.volume>0?`About ${main.volume.toLocaleString('en-GB')} searches a month for “${main.keyword}”. `:'';
    const leaders=main.top3.map(t=>`#${t.position} ${t.domain}`).join(', ');
    const where=main.position?`currently #${main.position}${main.url?' ('+main.url+')':''}`:'not in the top 30 results';
    const volumeLine=typeof main.volume==='number'?`\nEstimated searches per month: ${main.volume.toLocaleString('en-GB')}.`:'';
    if(!main.position||main.position>10)add('local-rank','high',`Not on the first page of Google for “${main.keyword}”`,`${demand}People searching this way are looking to hire now, and nearly all of them choose from the first page of results.`,'Create a dedicated page for this service and area, strengthen the Google Business Profile, and build local links and reviews.',url,`Google results for “${main.keyword}” searched from ${place}: this website is ${where}.${leaders?`\nShowing first: ${leaders}.`:''}${volumeLine}`);
    else if(main.position>3)add('local-rank','medium',`Not in the top three for “${main.keyword}”`,`${demand}The top three results receive most of the clicks.`,'Improve the service page content and internal links, and build local authority through reviews and links.',url,`Google results for “${main.keyword}” searched from ${place}: this website is ${where}.${leaders?`\nAhead of it: ${leaders}.`:''}${volumeLine}`);
    if(main.mapPackShown&&!main.inMapPack)add('map-pack','high',`Not shown in the Google Maps results for “${main.keyword}”`,'For local searches Google shows a map with three businesses above the normal results, and those listings receive a large share of calls.','Claim and complete the Google Business Profile: correct categories, services, photos, opening hours and a steady flow of genuine reviews.',url,`Businesses shown in the map results: ${main.mapPack.join(', ')}.`);
    const others=checked.slice(1).filter(k=>!k.position||k.position>10);
    if(others.length)add('local-rank-more','medium','Not on page one for other local searches','Each of these is a different way customers search for the same service in the area.','Cover these services and phrases on relevant pages so the website can appear for each of them.',url,others.map(k=>`“${k.keyword}”${typeof k.volume==='number'?` (${k.volume.toLocaleString('en-GB')}/month)`:''}: ${k.position?'#'+k.position:'not in the top 30'}`).join('\n'));
  }
  if(desktop&&typeof desktop.performance==='number'&&desktop.performance<50)add('psi-desktop','medium','Website is slow on computers','Slow loading on computers affects visitors researching from work or home.','Address the same opportunities as mobile; they usually improve both.',url,`Google PageSpeed Insights desktop performance: ${desktop.performance}/100.`);
  return findings.sort((a,b)=>({high:0,medium:1,low:2,review:3}[a.priority]-{high:0,medium:1,low:2,review:3}[b.priority]));
}
const seconds=ms=>(Math.round(ms/100)/10)+'s';
export const SCORE_CATEGORIES=[{key:'seo',label:'Search visibility'},{key:'speed',label:'Mobile & speed'},{key:'trust',label:'Trust & accessibility'},{key:'enquiry',label:'Enquiries & local'}];
const WEIGHT={high:20,medium:10,low:4};
// Each distinct issue deducts once, with a small extra penalty when it repeats across pages, so one
// template problem on ten pages does not outweigh everything else. Review items are never scored.
export function scoreFor(state,findings) {
  if(!state.pages.some(p=>p.parsed))return null;
  const groups=new Map();
  for(const f of findings){if(f.kind!=='confirmed'||f.internal||!f.category)continue;const k=f.category+'|'+f.title;const g=groups.get(k)||{f,count:0};g.count++;groups.set(k,g);}
  const deduct=(key,filter=()=>true)=>[...groups.values()].filter(g=>g.f.category===key&&filter(g.f)).reduce((sum,g)=>sum+WEIGHT[g.f.priority]*Math.min(1+0.15*(g.count-1),1.6),0);
  const perf=state.speed?.mobile?.performance;
  const categories=SCORE_CATEGORIES.map(c=>{
    if(c.key!=='speed')return {...c,score:Math.round(Math.max(0,100-deduct(c.key))),measured:true};
    if(typeof perf!=='number')return {...c,score:null,measured:false};
    return {...c,score:Math.round(0.7*perf+0.3*Math.max(0,100-deduct('speed',f=>f.source!=='pagespeed'))),measured:true};
  });
  const measured=categories.filter(c=>c.measured),overall=Math.round(measured.reduce((s,c)=>s+c.score,0)/measured.length);
  return {overall,grade:overall>=85?'Strong':overall>=70?'Good foundations':overall>=50?'Needs work':'Needs urgent attention',categories};
}
export function pageSpeedUrl(url,strategy,key,{trimmed=true}={}) {
  const u=new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  u.searchParams.set('url',url);u.searchParams.set('strategy',strategy);
  for(const c of ['performance','accessibility','seo','best-practices'])u.searchParams.append('category',c);
  // Partial response: drops screenshots, timings and translations, roughly halving the payload.
  // Google rejects wildcards and hyphenated names inside audits, so audits are requested whole.
  if(trimmed)u.searchParams.set('fields','lighthouseResult(finalUrl,categories,audits),loadingExperience');
  if(key)u.searchParams.set('key',key);
  return u.href;
}
export function pageSpeedSummary(data) {
  const lh=data?.lighthouseResult;if(!lh)throw new Error('PageSpeed Insights returned no result.');
  const cat=k=>typeof lh.categories?.[k]?.score==='number'?Math.round(lh.categories[k].score*100):null;
  const num=k=>typeof lh.audits?.[k]?.numericValue==='number'?lh.audits[k].numericValue:null;
  const metrics=data.loadingExperience?.metrics||{},field=(k,scale=1)=>typeof metrics[k]?.percentile==='number'?{p75:metrics[k].percentile/scale,category:String(metrics[k].category||'')}:null;
  // Lighthouse 13 reports most improvements as insight audits scored by metricSavings; older
  // versions used details.type 'opportunity'. Both count when the audit is failing.
  const savings=a=>Math.max(a.details?.overallSavingsMs||0,a.metricSavings?.LCP||0,a.metricSavings?.FCP||0);
  const opportunities=Object.values(lh.audits||{}).filter(a=>a&&typeof a.score==='number'&&a.score<0.9&&(a.scoreDisplayMode==='metricSavings'||a.details?.type==='opportunity')).sort((a,b)=>savings(b)-savings(a)||a.score-b.score).slice(0,4).map(a=>({title:clean(String(a.title).replace(/`/g,'')).slice(0,160),savingsMs:Math.round(savings(a))}));
  return {performance:cat('performance'),accessibility:cat('accessibility'),seo:cat('seo'),bestPractices:cat('best-practices'),
    lab:{lcpMs:num('largest-contentful-paint'),cls:num('cumulative-layout-shift'),tbtMs:num('total-blocking-time'),fcpMs:num('first-contentful-paint'),speedIndexMs:num('speed-index')},
    field:{lcp:field('LARGEST_CONTENTFUL_PAINT_MS'),inp:field('INTERACTION_TO_NEXT_PAINT'),cls:field('CUMULATIVE_LAYOUT_SHIFT_SCORE',100),overall:data.loadingExperience?.overall_category||null,originFallback:Boolean(data.loadingExperience?.origin_fallback)},
    opportunities,finalUrl:String(lh.finalUrl||'').slice(0,1000)};
}
