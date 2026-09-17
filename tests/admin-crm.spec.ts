import { test, expect } from '@playwright/test';
const ticketId = 'a0f3d1cc-0195-4d9d-9a58-39a54e768502';
const at = '2026-09-14T09:35:00.000Z';
async function fixture(page, connected = true) {
  const ticket = { id: ticketId, reference: 'NC-A12B34C56D78E90F', name: 'Jamie Taylor', email: 'jamie@example.com', phone: '07700 900123', company: 'Example Building Co.', subject: 'A new website for my building business', service: 'Web design', source_page: '/contact/', status: 'new', priority: 'normal', assigned_to: 'nathan', follow_up_at: null, job_id: null, version: 1, created_at: at, updated_at: at, metadata: '{"utm_source":"facebook"}' };
  const messages = [{ id: crypto.randomUUID(), ticket_id: ticketId, kind: 'inbound', author: ticket.email, body: 'Hi Nathan, I’m looking for a website to showcase our building projects. Could we have a chat about what’s possible?\n\nThanks, Jamie', delivery: 'received', created_at: at, updated_at: at }];
  let failNext = false;const drafts=new Map();
  await page.route('**/admin/crm/api/**', async route => {
    const url = new URL(route.request().url()); const path = url.pathname.split('/').pop(); const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
    let data;
    if(path==='draft'){const key=body.key||url.searchParams.get('key');if(route.request().method()==='POST'){const version=(drafts.get(key)?.version||0)+1;drafts.set(key,{...body,version});data={version};}else data=drafts.get(key)||{body:'',version:0};}
    else if (path === 'setup') data = { enabled: true, database_ready: true, configured: connected, notifications_configured: true, mailbox: 'nathan@nc-digital.co.uk', missing: connected ? [] : ['ZOHO_CLIENT_ID'], webmail: 'https://mail.zoho.eu', last_sync: at, sync_error: '' };
    else if (path === 'list') data = { tickets: !url.searchParams.get('q') || ticket.subject.includes(url.searchParams.get('q')) ? [ticket] : [], total: 1, counts: [{status:ticket.status,count:1}], overdue:0, page:0 };
    else if (path === 'ticket') data = { ticket, messages };
    else if (path === 'message') {
      if (failNext) { failNext=false; return route.fulfill({ status:503, json:{error:'Zoho connection needs attention.'} }); }
      messages.push({id:crypto.randomUUID(),ticket_id:ticketId,kind:body.kind,author:'nathan',body:body.body,delivery:body.kind==='outbound'?'queued':'received',created_at:at,updated_at:at}); ticket.version++;
      if(body.kind==='outbound')ticket.status='waiting';data={ticket,messages};
    } else if(path==='update') { Object.assign(ticket,body);ticket.version++;data={ticket,messages}; }
    else if(path==='job'){ticket.job_id=25;data={job_id:25};}
    else if(path==='sync')data={imported:0};
    else data={ok:true};
    await route.fulfill({json:data});
  });
  return { fail:()=>{failNext=true;},ticket,messages };
}
test('CRM conversations, notes, replies, metadata, jobs and draft preservation',async({page})=>{
  const f=await fixture(page);await page.setViewportSize({width:1500,height:1000});await page.goto('/admin/crm/inbox/');
  await page.getByRole('button',{name:'Jamie Taylor: A new website for my building business'}).click();
  await expect(page.locator('#ticket-subject')).toHaveText(f.ticket.subject);
  await expect(page.locator('#customer-details')).toContainText('facebook');
  await page.getByRole('button',{name:'Private note',exact:true}).click();await page.locator('#reply-body').fill('Call Jamie tomorrow. Budget discussed privately.');
  await page.getByRole('button',{name:'Save private note'}).click();await expect(page.locator('.message.note')).toContainText('Budget discussed privately.');
  await page.getByRole('button',{name:'Email reply',exact:true}).click();await page.locator('#reply-body').fill('Hi Jamie, happy to help. Are you free for a call tomorrow?');
  f.fail();await page.getByRole('button',{name:'Send reply'}).click();await expect(page.locator('#notice')).toContainText('needs attention');await expect(page.locator('#reply-body')).toHaveValue(/Hi Jamie/);
  await page.getByRole('button',{name:'Send reply'}).click();await expect(page.locator('.message.outbound')).toContainText('Queued');await expect(page.locator('#reply-body')).toHaveValue('');
  await page.locator('#edit-priority').selectOption('high');await page.locator('#edit-status').selectOption('open');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.locator('#ticket-status')).toHaveText('In progress');
  await page.locator('#reply-body').fill('An unsent draft');await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.locator('#reply-body')).toHaveValue('An unsent draft');
  await page.getByRole('button',{name:'Create a linked job'}).click();await expect(page.locator('#open-job')).toBeVisible();
  await page.locator('#reply-body').fill('');
  await page.screenshot({path:'output/crm/desktop.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('mobile inbox opens conversation, returns to list and keeps private text safe',async({page})=>{
  const f=await fixture(page);f.messages[0].body='<img src=x onerror="alert(1)"> This is literal customer text.';f.messages.push({id:crypto.randomUUID(),ticket_id:ticketId,kind:'inbound',author:'jamie@example.com',body:'Latest customer update',delivery:'received',created_at:'2026-09-14T10:35:00.000Z',updated_at:'2026-09-14T10:35:00.000Z'});
  await page.setViewportSize({width:390,height:844});await page.goto('/admin/crm/inbox/');
  await page.getByRole('button',{name:'Jamie Taylor: A new website for my building business'}).click();
  await expect(page.locator('.ticket-list-panel')).toBeHidden();await expect(page.locator('.message-body').first()).toContainText('Latest customer update');await expect(page.locator('.message-body').last()).toContainText('<img');expect(await page.locator('.messages img').count()).toBe(0);
  await page.getByRole('button',{name:'Private note',exact:true}).click();await page.locator('#reply-body').fill('Unsent mobile note');
  await page.getByRole('button',{name:'← Inbox',exact:true}).click();await expect(page.locator('.ticket-list-panel')).toBeVisible();
  await page.getByRole('button',{name:'Jamie Taylor: A new website for my building business'}).click();await expect(page.locator('#reply-body')).toHaveValue('Unsent mobile note');
  await page.screenshot({path:'output/crm/mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.locator('#reply-body').fill('');
});
test('disconnected Zoho disables email sending while private notes remain available',async({page})=>{
  await fixture(page,false);await page.goto('/admin/crm/inbox/');await page.getByRole('button',{name:'Jamie Taylor: A new website for my building business'}).click();
  await expect(page.getByRole('button',{name:'Send reply'})).toBeDisabled();await page.getByRole('button',{name:'Private note',exact:true}).click();await expect(page.getByRole('button',{name:'Save private note'})).toBeEnabled();
  await expect(page.locator('#connection-status')).toHaveText('Zoho connection needed');
});
test('contact form uses CRM capture when enabled and existing route when disabled',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  let capture;
  await page.route('**/api/enquiries/config',route=>route.fulfill({json:{enabled:true}}));
  await page.route('**/api/enquiries',route=>{capture=route.request().postDataJSON();return route.fulfill({status:201,json:{success:true}});});
  await page.goto('/contact/');await page.locator('#contact-form-name').fill('Demo Customer');await page.locator('#contact-form-email').fill('demo@example.com');await page.locator('#contact-form-message').fill('Please build my website');
  await page.getByRole('button',{name:'Send message',exact:false}).click();await expect(page).toHaveURL(/thank-you/);expect(capture.name).toBe('Demo Customer');expect(capture.from_page).toBe('/contact/');expect(capture.access_key).toBeUndefined();expect(capture.submission_key).toBeTruthy();
  let fallback=false;
  await page.route('**/api/enquiries/config',route=>route.fulfill({json:{enabled:false}}));await page.route('https://api.web3forms.com/submit',route=>{fallback=true;return route.fulfill({json:{success:true}});});
  await page.goto('/contact/');await page.locator('#contact-form-name').fill('Demo Customer');await page.locator('#contact-form-email').fill('demo@example.com');await page.locator('#contact-form-message').fill('Fallback check');await page.getByRole('button',{name:'Send message',exact:false}).click();await expect(page).toHaveURL(/thank-you/);expect(fallback).toBeTruthy();
});
test('website cost calculator sends quote details and structured metadata to the CRM', async ({page}) => {
  test.setTimeout(60000);
  await page.emulateMedia({reducedMotion:'reduce'});
  let capture:any;
  await page.route('**/api/enquiries/config', route => route.fulfill({json:{enabled:true}}));
  await page.route('**/api/enquiries', route => { capture = route.request().postDataJSON(); return route.fulfill({status:201,json:{success:true}}); });
  await page.goto('/website-cost-calculator/');
  await page.getByText('5–10 pages — from £699').click();
  await page.getByText('No thanks — save £100').click();
  await page.getByText('Online shop (+£500)').click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByText('Annual hosting & domain — £250/year').click();
  await page.getByLabel('Name').fill('Calculator Customer');
  await page.getByLabel('Email').fill('calculator@example.com');
  await page.getByRole('button',{name:'Send me this quote',exact:true}).click();
  await expect(page).toHaveURL(/thank-you/);
  expect(capture.name).toBe('Calculator Customer');
  expect(capture.service).toBe('Website cost calculator');
  expect(capture.from_page).toBe('/website-cost-calculator/');
  expect(capture.lead_source).toBe('website-cost-calculator');
  expect(capture.website_type).toBe('Website build — 5–10 pages');
  expect(capture.calculator_build_total).toBe('£1099 inc. VAT');
  expect(capture.calculator_hosting).toBe('Annual hosting & domain — £250/year inc. VAT');
  expect(capture.calculator_breakdown).toContain('5–10 pages (no custom homepage): £599');
  expect(capture.calculator_breakdown).toContain('Online shop: £500');
  expect(capture.message).toContain('Website build total: £1099 inc. VAT');
  expect(capture.submission_key).toBeTruthy();
  expect(capture.access_key).toBeUndefined();
});
