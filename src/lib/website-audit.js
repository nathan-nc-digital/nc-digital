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
export async function auditFetch(input, { max=1500000, method='GET' }={}) {
  let url=auditUrl(input);const host=url.hostname.replace(/^www\./,'');const redirects=[],deadline=Date.now()+25000;
  for(let i=0;i<4;i++){
    await publicHost(url.hostname,deadline);
    if(url.hostname.replace(/^www\./,'')!==host)throw new Error('This address redirects to another website. Audit '+url.hostname+' separately.');
    if(Date.now()>=deadline)throw new Error('The website lookup timed out.');
    const started=Date.now();const r=await fetch(url.href,{method,redirect:'manual',headers:{'User-Agent':'NCDigitalAudit/1.0 (+https://nc-digital.co.uk/)','Accept':'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1'},signal:AbortSignal.timeout(Math.max(1,Math.min(12000,deadline-Date.now())))});
    if([301,302,303,307,308].includes(r.status)){const target=r.headers.get('location');await r.body?.cancel();if(!target)throw new Error('A redirect did not include a destination.');redirects.push(url.href);url=auditUrl(new URL(target,url).href);continue;}
    const bytes=method==='HEAD'?new Uint8Array():await readLimitedBody(r,max);return {url:url.href,status:r.status,type:r.headers.get('content-type')||'',robots:(r.headers.get('x-robots-tag')||'').slice(0,1000),html:new TextDecoder().decode(bytes),bytes:bytes.length,responseMs:Date.now()-started,redirects};
  }throw new Error('Too many redirects.');
}
export function parsePage(html,url) {
  const document=parse(html),p={url,titles:[],descriptions:[],h1:[],viewport:'',robots:'',canonical:'',lang:'',links:[],images:0,missingAlt:0,forms:0,phone:false,email:false,schema:false,ogTitle:false,ogImage:false,insecureAssets:0,wordCount:0};
  let base=url,words='';
  const stack=[{node:document,hidden:false}];let visited=0;
  function text(node){let out='';const nodes=[node];let count=0;while(nodes.length&&count++<10000){const n=nodes.pop();if(n.nodeName==='#text')out+=' '+n.value;else if(!['script','style','template','noscript'].includes(n.tagName))nodes.push(...(n.childNodes||[]).slice().reverse());}return clean(out).slice(0,1000);}
  while(stack.length&&visited++<60000){const {node:n,hidden}=stack.pop();const a=Object.fromEntries((n.attrs||[]).map(x=>[x.name,x.value])),tag=n.tagName;const invisible=hidden||['script','style','template','noscript','head'].includes(tag)||'hidden'in a||a['aria-hidden']==='true';
    if(tag==='base'&&a.href&&a.href.length<1000){try{base=new URL(a.href,url).href;}catch{}}
    if(tag==='title'&&p.titles.length<5)p.titles.push(text(n));if(tag==='h1'&&p.h1.length<10)p.h1.push(text(n));if(tag==='html')p.lang=(a.lang||'').slice(0,50);
    if(tag==='meta'){const name=(a.name||a.property||'').toLowerCase();if(name==='description'&&p.descriptions.length<5)p.descriptions.push(clean(a.content).slice(0,1000));if(name==='viewport')p.viewport=(a.content||'').slice(0,500);if(['robots','googlebot'].includes(name))p.robots=(p.robots+' '+(a.content||'')).slice(0,1000);if(name==='og:title')p.ogTitle=true;if(name==='og:image')p.ogImage=true;}
    if(tag==='link'&&(a.rel||'').toLowerCase().split(/\s+/).includes('canonical'))p.canonical=(a.href||'').slice(0,1000);
    if(tag==='script'&&(a.type||'').toLowerCase()==='application/ld+json')p.schema=true;
    if(tag==='img'){p.images++;if(!('alt'in a))p.missingAlt++;}
    if(tag==='form')p.forms++;
    if(tag==='a'&&a.href&&a.href.length<=1000&&p.links.length<100){p.phone ||= /^tel:/i.test(a.href);p.email ||= /^mailto:/i.test(a.href);p.links.push({href:a.href,anchor:text(n).slice(0,120)});}
    if(['img','script','iframe','link','source'].includes(tag)&&/^http:/i.test(a.src||a.href||''))p.insecureAssets++;
    if(n.nodeName==='#text'&&!invisible&&words.length<100000)words+=' '+n.value;
    stack.push(...(n.childNodes||[]).slice().reverse().map(node=>({node,hidden:invisible})));
  }
  p.wordCount=clean(words).split(' ').filter(Boolean).length;
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
export function findingsFor(state) {
  const findings=[];const add=(id,priority,title,why,fix,page,evidence,kind='confirmed')=>findings.push({id:id+'-'+findings.length,priority,title,why,fix,page,evidence,kind});
  const pages=[...new Map(state.pages.filter(p=>p.parsed).map(p=>[p.url,p])).values()],seen=new Set();
  for(const link of state.linkChecks||[])if([404,410].includes(link.status))add('broken-link','high','An internal link leads to a missing page','Visitors following this link reach a dead end.','Update the source link or restore the destination.',link.url,'Destination returned HTTP '+link.status+'. Linked from: '+pages.filter(p=>p.parsed.links.some(l=>l.url===link.url)).map(p=>p.url).join(', '));
  for(const p of state.pages){
    if(p.parsed&&seen.has(p.url))continue;
    if(p.parsed)seen.add(p.url);
    if([404,410].includes(p.status))add('broken','high','A linked page is missing','Visitors following this link reach a dead end.','Restore the page or update the links pointing to it.',p.requestedUrl||p.url,'HTTP '+p.status);
    else if(!p.parsed){add('unchecked','review','Page could not be fully checked','This is a coverage gap, not proof that the website is broken.','Open this page in a browser and investigate the recorded response.',p.requestedUrl||p.url,p.error||'HTTP '+p.status,'review');continue;}
    if(!p.parsed)continue;const d=p.parsed;
    if(!d.titles.some(Boolean))add('title','high','Page title is missing','A descriptive title helps visitors and search engines understand the page.','Write a unique title describing the service and relevant location.',p.url,'No non-empty <title> found.');
    if(!d.descriptions.some(Boolean))add('description','medium','Search description is missing','A useful description can explain the offer when search engines choose to display it.','Add a relevant summary and reason to choose the business.',p.url,'No non-empty meta description found.');
    if(!d.h1.some(Boolean))add('heading','medium','Main page heading was not found','A clear main heading helps visitors understand the page purpose.','Check the rendered page and add a descriptive main heading where needed.',p.url,'No non-empty H1 in the downloaded HTML.','review');
    if(!/width\s*=\s*device-width/i.test(d.viewport))add('viewport','high','Mobile viewport needs attention','The viewport setting affects how a page scales on phones.','Check the mobile layout and configure a device-width viewport.',p.url,d.viewport||'No viewport meta tag found.');
    if(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:[,.\s]|$)/i.test(d.viewport))add('zoom','medium','Page may restrict mobile zoom','People may need to enlarge text to read it comfortably.','Remove restrictive viewport zoom settings and test pinch-to-zoom.',p.url,d.viewport);
    if(/(?:^|[\s,:])(?:noindex|none)(?:$|[\s,])/i.test(d.robots+' '+p.robots))add('noindex','high','Page asks search engines not to index it','This can be intentional, but it matters if this page should attract search traffic.','Confirm whether exclusion is intended before removing the directive.',p.url,clean(d.robots+' '+p.robots),'review');
    if(d.missingAlt)add('alt','medium','Images are missing alt attributes','Meaningful images need a text alternative; decorative images should have an empty alt attribute.','Review each image and add appropriate alternative text.',p.url,`${d.missingAlt} of ${d.images} images have no alt attribute.`);
    if(!d.lang)add('lang','medium','Page language is not declared','Assistive technology uses the declared language to pronounce content.','Set the correct language on the HTML element.',p.url,'No lang attribute on <html>.');
    if(p.url.startsWith('http:'))add('https','high','Page was served without HTTPS','An unencrypted page does not protect data in transit.','Enable HTTPS and redirect HTTP requests securely.',p.url,p.url);
    if(p.url.startsWith('https:')&&d.insecureAssets)add('mixed','medium','HTML references insecure resources','HTTP resources on an HTTPS page can be upgraded or blocked by browsers.','Replace resource URLs with HTTPS and check the browser console.',p.url,`${d.insecureAssets} HTTP resource references.`,'review');
    if(d.canonical){try{const canonical=new URL(d.canonical,p.url);if(canonical.hostname!==new URL(p.url).hostname)add('canonical','high','Canonical points to a different hostname','This may tell search engines that another website is the preferred version.','Confirm whether the cross-domain canonical is intentional.',p.url,canonical.href,'review');}catch{add('canonical','medium','Canonical address is invalid','Search engines may ignore an invalid canonical.','Use a valid preferred page URL.',p.url,d.canonical);}}
  }
  for(const field of ['titles','descriptions']){const groups=new Map();for(const p of pages){const value=clean(p.parsed[field][0]).toLowerCase();if(value){const group=groups.get(value)||[];group.push(p.url);groups.set(value,group);}}for(const [value,urls]of groups)if(urls.length>1)add('duplicate','medium',field==='titles'?'Several pages share a title':'Several pages share a search description','Unique descriptions help distinguish the purpose of each page.','Write page-specific copy after confirming these are distinct pages.',urls[0],urls.join('\n')+'\nShared text: '+value);}
  if(pages.length){const homepage=pages[0];if(!pages.some(p=>p.parsed.forms||p.parsed.phone||p.parsed.email||p.parsed.links.some(l=>/contact|quote|book|enquir/i.test(l.anchor+' '+l.url))))add('contact','high','A clear enquiry route was not detected','Potential customers should be able to find a next step quickly.','Review the visible design and add an obvious contact, quote or booking action.',homepage.url,'No phone/email link, form or recognisable enquiry link in checked HTML.','review');
    if(!homepage.parsed.ogTitle||!homepage.parsed.ogImage)add('social','low','Social sharing preview can be improved','A clear image and title help when somebody shares the website.','Add and test Open Graph title and image metadata.',homepage.url,`Open Graph title: ${homepage.parsed.ogTitle?'present':'not found'}; image: ${homepage.parsed.ogImage?'present':'not found'}.`);
  }
  return findings.sort((a,b)=>({high:0,medium:1,low:2,review:3}[a.priority]-{high:0,medium:1,low:2,review:3}[b.priority]));
}
