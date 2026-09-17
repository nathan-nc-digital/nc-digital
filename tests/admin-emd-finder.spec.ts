import { test,expect } from '@playwright/test';
const candidate={service:'roofer',town:'merthyr tydfil',domain:'merthyrtydfilroofer.co.uk',volume:260,cpc:4.3,difficulty:5,jobValue:2500,commission:10,status:'new',metricsAt:'2026-07-30',availabilityAt:'2026-07-30',available:true,score:80,evidence:{label:'Unverified',reason:'Needs current evidence.'}};
async function setup(page){let c={...candidate},scan=null,paid=0;await page.route('**/admin/emd-finder/api/**',async route=>{const path=new URL(route.request().url()).pathname.split('/').at(-1),body=route.request().postDataJSON();let result;
  if(path==='catalog')result={candidates:[c],towns:['merthyr tydfil'],services:['roofer'],history:[],connected:true};
  else if(path==='preview')result={candidates:1,metricLookups:0,estimate:.068,filters:{...body,budget:1}};
  else if(path==='watch'){c={...c,...body};result={ok:true};}
  else if(path==='availability')result={available:true,availabilityAt:new Date().toISOString()};
  else if(path==='start'){paid++;result=scan={id:'abc',status:'running',phase:'metrics',actual:0,committed:0,budget:1,domains:[c.domain],shortlist:[],warnings:[],ledger:[]};}
  else if(path==='advance')result={...scan,status:'complete',phase:'done',actual:.026,committed:.026};
  else result={};await route.fulfill({json:result});});return()=>paid;}
test('free browsing, dated availability and saved commission assumptions',async({page})=>{const paid=await setup(page);await page.goto('/admin/emd-finder/');await expect(page.getByRole('heading',{name:'Shortlist before you spend.'})).toBeVisible();await expect(page.locator('#rows')).toContainText('Needs recheck');expect(paid()).toBe(0);await page.getByRole('button',{name:'Inspect ↗'}).click();await page.locator('#edit-job').fill('3000');await page.locator('#edit-commission').fill('15');await expect(page.locator('#scenario')).toContainText('£900 gross commission');await page.locator('#edit-status').selectOption('watchlist');await page.getByRole('button',{name:'Save opportunity'}).click();await expect(page.locator('#saved-note')).toContainText('Saved');await page.getByRole('button',{name:'Close details'}).click();await page.locator('#view').selectOption('watchlist');await expect(page.locator('#rows')).toContainText('£3,000');expect(paid()).toBe(0);});
test('scan shows its actual spending and completes',async({page})=>{const paid=await setup(page);await page.goto('/admin/emd-finder/');await page.getByRole('button',{name:'Find opportunities ↗'}).click();await expect(page.locator('#phase')).toHaveText('Scan complete');await expect(page.locator('#spend')).toContainText('$0.02600');expect(paid()).toBe(1);});
test('mobile layout fits without page overflow',async({page})=>{await setup(page);await page.setViewportSize({width:390,height:844});await page.goto('/admin/emd-finder/');await expect(page.locator('#rows')).toContainText('merthyrtydfilroofer.co.uk');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'.tmp/emd-mobile.png',fullPage:true});});

test('registration lookup runs from the browser and persists only its result',async({page})=>{
  await setup(page);let called=false;
  await page.route('https://rdap.nominet.uk/uk/domain/**',async route=>{called=true;await route.fulfill({status:404,headers:{'Access-Control-Allow-Origin':'*'},json:{errorCode:404,title:'Domain not found'}});});
  await page.goto('/admin/emd-finder/');await page.getByRole('button',{name:'Inspect ↗'}).click();
  const saved=page.waitForRequest(r=>r.url().endsWith('/api/availability'));
  await page.getByRole('button',{name:'Recheck availability · free'}).click();
  expect((await saved).postDataJSON()).toEqual({domain:candidate.domain,rdapStatus:404});
  await expect(page.locator('#domain-status')).toHaveText('Appears unregistered');expect(called).toBe(true);
});
