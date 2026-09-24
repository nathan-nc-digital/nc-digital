import {test,expect} from '@playwright/test';
import {buildGscReport,gscDates,compareSnapshots} from '../src/lib/gsc-insights.js';

const site='sc-domain:nc-digital.co.uk';
const row=(key,clicks,impressions,position)=>({keys:key==null?[]:[key].flat(),clicks,impressions,ctr:impressions?clicks/impressions:0,position});
const report=buildGscReport(site,gscDates(new Date()),{totals:[row(null,120,6000,14.2)],prevTotals:[row(null,80,4000,18)],allQueries:[row('web design merthyr',3,400,6.5)],recent:[row('web design merthyr',2,50,5)],prior:[row('web design merthyr',1,40,9)],topQueries:[row('nc digital',40,90,1.2)],topPages:[row('https://nc-digital.co.uk/web-design/',30,900,4)],queryPages:[row(['web design merthyr','https://nc-digital.co.uk/web-design-merthyr/'],3,400,6.5)]});
const sites={sites:[{site,permission:'siteOwner'},{site:'sc-domain:ir-energy.co.uk',permission:'siteFullUser'}],defaultSite:site};

test('Search Console insights load live, auto-refresh old data and switch property',async({page})=>{
  const refreshed=[];let saved={...report,generatedAt:new Date(Date.now()-3*86400000).toISOString()};
  await page.route('**/admin/gsc/api/**',async route=>{const u=new URL(route.request().url()),kind=u.pathname.split('/').at(-1);
    if(kind==='sites')return route.fulfill({json:sites});
    if(kind==='report')return route.fulfill({json:{report:u.searchParams.get('site')===site?saved:null}});
    if(kind==='refresh'){const body=route.request().postDataJSON();refreshed.push(body.site);saved={...report,generatedAt:new Date().toISOString()};return route.fulfill({json:{report:saved}});}});
  await page.goto('/admin/gsc/');
  await expect(page.locator('#out')).toContainText('Priority Actions');
  await expect.poll(()=>refreshed.length).toBe(1);
  await expect(page.locator('#age')).toContainText('just now');
  await expect(page.locator('#out')).toContainText('web design merthyr');
  await expect(page.locator('#out')).toContainText('/web-design-merthyr/');
  await expect(page.locator('#out')).toContainText('Prior: 80 · 50.0%');
  await page.locator('#issue').selectOption('low-ctr');
  await expect(page.locator('#insights tbody tr').first()).toBeHidden();
  await page.getByRole('button',{name:'Reset filters'}).click();
  await expect(page.locator('#insights tbody tr').first()).toBeVisible();
  await page.locator('#site').selectOption('sc-domain:ir-energy.co.uk');
  await expect.poll(()=>refreshed.at(-1)).toBe('sc-domain:ir-energy.co.uk');
  await expect(page).toHaveURL(/site=sc-domain%3Air-energy\.co\.uk/);
});

test('Indexing runs step by step, explains problems and filters stuck pages; mobile fits',async({page})=>{
  const old=new Date(Date.now()-20*86400000).toISOString(),fresh=new Date().toISOString();
  const pages=[{url:'https://nc-digital.co.uk/',status:'pending',firstSeen:old},{url:'https://nc-digital.co.uk/blog/stuck/',status:'pending',firstSeen:old},{url:'https://nc-digital.co.uk/blog/new/',status:'pending',firstSeen:fresh}];
  let remaining=0,steps=0;
  const state=()=>({site,pages,lastChecked:steps?fresh:null,run:{mode:'problems',startedAt:fresh,finishedAt:remaining?null:fresh,remaining,running:remaining>0}});
  await page.route('**/admin/gsc/api/sites**',route=>route.fulfill({json:sites}));
  await page.route('**/admin/indexing/api/**',async route=>{const kind=new URL(route.request().url()).pathname.split('/').at(-1);
    if(kind==='status')return route.fulfill({json:{site,pages:[],lastChecked:null,run:null}});
    if(kind==='start'){remaining=3;return route.fulfill({json:state()});}
    if(kind==='step'){steps++;const p=pages[3-remaining];Object.assign(p,p.url.endsWith('/')&&p.url.split('/').length===4?{status:'indexed',coverageState:'Submitted and indexed'}:{status:'not-indexed',coverageState:p.url.includes('stuck')?'Crawled - currently not indexed':'Discovered - currently not indexed'},{inspectedAt:fresh,lastCrawlTime:fresh,googleCanonical:p.url});remaining--;return route.fulfill({json:state()});}});
  await page.goto('/admin/indexing/');
  await expect(page.locator('#empty')).toBeVisible();
  await page.getByRole('button',{name:'Check new & problem pages'}).click();
  await expect.poll(()=>steps).toBe(3);
  await expect(page.locator('#notice')).toHaveText('Check complete.');
  await expect(page.locator('#stats')).toContainText('Not indexed after 7+ days1');
  await expect(page.locator('#rows')).toContainText('chose not to index');
  await expect(page.locator('#rows')).toContainText('In sitemap for 20 days');
  await page.locator('#status').selectOption('stuck');
  await expect(page.locator('#rows tr:visible')).toHaveCount(1);
  await expect(page.locator('#rows tr:visible')).toContainText('/blog/stuck/');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('dashboard shows what needs attention and saves the DataForSEO budget; mobile fits',async({page})=>{
  const budgets=[];
  const spend={month:3.21,budget:20,since:'2026-09-01',level:'ok',byTool:[{tool:'website-audit',label:'Website audits',lookups:12,cost:2.5},{tool:'seo-report',label:'SEO report rankings',lookups:40,cost:0.71}],balance:41.5,balanceCheckedAt:new Date().toISOString()};
  await page.route('**/admin/dashboard/api/**',async route=>{const kind=new URL(route.request().url()).pathname.split('/').at(-1);
    if(kind==='budget'){budgets.push(route.request().postDataJSON().budget);return route.fulfill({json:{...spend,budget:3,level:'over'}});}
    return route.fulfill({json:{generatedAt:new Date().toISOString(),enquiries:{newCount:2,recent:[{id:'t1',name:'Sam Jones',company:'Jones Plumbing',subject:'New website',status:'new',createdAt:new Date().toISOString()}]},tasks:[{id:'k',title:'Call Sam back',dueDate:'2026-01-01',ticketId:'t1'}],
      shares:{opened:[{id:'a2',name:'M&T Heating',kind:'audit',views:3,viewedAt:new Date().toISOString()}],unopened:[{id:'r1',name:'IR Energy SEO',kind:'seo',sharedAt:new Date().toISOString()}]},
      seoClients:[{id:'c1',name:'IR Energy',lastReport:null,due:true}],indexing:{site,total:120,indexed:117,notIndexed:3,pending:0,stuck:1,stuckPages:[{url:'https://nc-digital.co.uk/blog/stuck/',coverageState:'Crawled - currently not indexed',firstSeen:'2026-09-01'}],lastChecked:new Date().toISOString()},
      search:{generatedAt:new Date().toISOString(),current:{clicks:120,impressions:6000,position:14.2},previous:{clicks:80,impressions:4000,position:18},gained:4,lost:2},spend}});});
  await page.goto('/admin/');
  await expect(page.locator('#cards')).toContainText('New enquiries2');
  await expect(page.locator('#cards')).toContainText('$3.21');
  await expect(page.locator('#enquiries')).toContainText('Sam Jones');
  await expect(page.locator('#tasks')).toContainText('Call Sam back');
  await expect(page.locator('#shares')).toContainText('M&T Heating');
  await expect(page.locator('#shares')).toContainText('IR Energy SEO');
  await expect(page.locator('#clients')).toContainText('Due this month');
  await expect(page.locator('#search')).toContainText('+50%');
  await expect(page.locator('#indexing')).toContainText('/blog/stuck/');
  await expect(page.locator('#spend')).toContainText('Website audits');
  await expect(page.locator('#spend')).toContainText('$41.50');
  await page.locator('#budget').fill('3');
  await page.getByRole('button',{name:'Save'}).click();
  await expect(page.locator('#spend')).toContainText('Over budget');
  expect(budgets).toEqual([3]);
  await expect(page.locator('.admin-nav-brand')).toHaveAttribute('href','/admin/');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'.tmp/dashboard-mobile.png',fullPage:true});
  await page.setViewportSize({width:1400,height:1000});
  await page.screenshot({path:'.tmp/dashboard-desktop.png',fullPage:true});
});

test('DataForSEO tools show the monthly spend bar and snapshot pages show their age',async({page})=>{
  await page.route('**/admin/dashboard/api/spend',route=>route.fulfill({json:{month:18,budget:20,level:'near',balance:12,byTool:[]}}));
  await page.goto('/admin/keyword-research/');
  await expect(page.locator('[data-dfs-spend]')).toContainText('Nearly at budget: DataForSEO this month $18.00 of $20.00 budget · $12.00 left on the account');
  await page.goto('/admin/keywords/');
  await expect(page.locator('.data-age')).toContainText('days ago');
  await expect(page.locator('.data-age')).toHaveAttribute('data-tone','old');
});

test('GSC Insights shows what improved and declined since the last refresh; mobile fits',async({page})=>{
  const before={...report,generatedAt:'2026-09-20T09:00:00Z',overview:{...report.overview,current:{clicks:30,impressions:5000,ctr:.006,position:15}},queries:[['web design merthyr',1,200,9.4],['seo cardiff',1,80,6],['old search',0,40,30]],pages:[['https://nc-digital.co.uk/',20,500,5],['https://nc-digital.co.uk/gone/',2,50,20]]};
  const now={...report,generatedAt:new Date().toISOString(),queries:[['web design merthyr',3,400,6.5],['seo cardiff',0,90,11.5],['new search',1,30,8]],pages:[['https://nc-digital.co.uk/',28,600,4]]};
  now.sinceLast=compareSnapshots(now,before);
  await page.route('**/admin/gsc/api/**',async route=>{const kind=new URL(route.request().url()).pathname.split('/').at(-1);return route.fulfill({json:kind==='sites'?sites:{report:now}});});
  await page.goto('/admin/gsc/');
  const since=page.locator('#since');
  await expect(since).toContainText('Compared with the refresh on 20 Sept 2026');
  await expect(since).toContainText('30 → 120');
  await expect(since).toContainText('+90');
  await expect(since.locator('.since-col.good')).toContainText('web design merthyr');
  await expect(since.locator('.since-col.good')).toContainText('9.4 → 6.5');
  await expect(since.locator('.since-col.good')).toContainText('new search');
  await expect(since.locator('.since-col.good')).toContainText('+8 clicks');
  await expect(since.locator('.since-col.bad')).toContainText('seo cardiff');
  await expect(since.locator('.since-col.bad')).toContainText('old search');
  await expect(since.locator('.since-col.bad')).toContainText('/gone/');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await since.screenshot({path:'.tmp/gsc-since-mobile.png'});
  await page.setViewportSize({width:1400,height:1000});
  await since.screenshot({path:'.tmp/gsc-since-desktop.png'});
});
