import {test,expect} from '@playwright/test';
import {londonToday} from '../src/lib/crm-domain.js';

test('cloud backup controls create a copy and expose its private download',async({page})=>{
  let completed=false;
  await page.route('**/api/workspace/health',route=>route.fulfill({json:{ready:true,imports:[],totals:[],outbox:[],backup:{configured:true,last_success:completed?'2026-09-17T09:00:00Z':null,error:null}}}));
  await page.route('**/api/workspace/backup-now',async route=>{expect(route.request().method()).toBe('POST');completed=true;await route.fulfill({json:{configured:true,last_success:'2026-09-17T09:00:00Z',error:null}});});
  await page.setViewportSize({width:390,height:900});await page.goto('/admin/crm/?view=health');
  await expect(page.getByText('Backup needs attention: no recent successful copy.')).toBeVisible();
  await page.getByRole('button',{name:'Back up now',exact:true}).click();
  await expect(page.getByRole('link',{name:'Download latest backup',exact:true})).toHaveAttribute('href','/admin/crm/api/workspace/backup');
  await expect(page.getByText('Backup needs attention: no recent successful copy.')).not.toBeVisible();
  expect(completed).toBeTruthy();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:'output/crm-build/cloud-backup-mobile.png',fullPage:true});
});

test('customer and contact tags survive editing and filter the list',async({page})=>{
  await page.goto('/admin/crm/?view=accounts');await page.getByRole('button',{name:'New customer',exact:false}).click();
  await page.getByLabel('Business or customer name').fill('Tagged browser customer');await page.getByLabel('Tags',{exact:true}).fill('Hosting, Referral');await page.getByRole('button',{name:'Create customer',exact:true}).click();await expect(page.locator('#editor')).not.toBeVisible();
  await page.getByLabel('Filter by tag',{exact:true}).fill('hosting');await page.getByLabel('Filter by tag',{exact:true}).press('Tab');await expect(page.locator('tbody')).toContainText('Tagged browser customer');
  await page.goto('/admin/crm/?view=contacts');await page.getByRole('button',{name:'New contact',exact:false}).click();await page.getByLabel('Contact name',{exact:true}).fill('Tagged browser contact');await page.getByLabel('Email',{exact:true}).fill('tagged-browser@example.com');await page.getByLabel('Tags',{exact:true}).fill('Decision maker');await page.getByRole('button',{name:'Create contact',exact:true}).click();await expect(page.locator('#editor')).not.toBeVisible();
  await page.getByLabel('Filter by tag',{exact:true}).fill('decision maker');await page.getByLabel('Filter by tag',{exact:true}).press('Tab');await expect(page.locator('tbody')).toContainText('Tagged browser contact');await page.getByRole('button',{name:'Tagged browser contact',exact:true}).click();await expect(page.getByLabel('Tags',{exact:true})).toHaveValue('Decision maker');
});

test('reports apply an inclusive date range and remain usable on mobile',async({page})=>{
  await page.setViewportSize({width:390,height:900});await page.goto('/admin/crm/?view=reports');await expect(page.getByRole('heading',{name:'Reports',exact:true})).toBeVisible();
  await page.getByLabel('From',{exact:true}).fill('2026-09-01');await page.getByLabel('To',{exact:true}).fill('2026-09-30');await page.getByRole('button',{name:'Update report',exact:true}).click();await expect(page).toHaveURL(/from=2026-09-01&to=2026-09-30/);await expect(page.getByRole('heading',{name:'Lead source',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:'output/crm-build/reports-mobile.png',fullPage:true});
});
test('daily workspace and all primary views render at desktop, tablet and mobile sizes',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  for(const width of [1440,1024,390,320]){
    await page.setViewportSize({width,height:950});await page.goto('/admin/crm/');await expect(page.getByRole('heading',{name:'A clear day ahead.'})).toBeVisible();
    await expect(page.getByRole('heading',{name:'Your next actions'})).toBeVisible();
    await expect(page.getByRole('heading',{name:'Pipeline by stage'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await page.screenshot({path:`output/crm-build/today-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  for(const [view,title] of [['opportunities','Pipeline'],['accounts','Customers'],['tasks','Tasks'],['quotes','Quotes'],['services','Services'],['health','Mailbox health'],['contacts','Contacts'],['reports','Reports']]){
    await page.goto('/admin/crm/?view='+view);await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  }
  expect(errors).toEqual([]);
});
test('pipeline stage links expose sorting and clear their active filter',async({page})=>{
  await page.goto('/admin/crm/');await page.getByRole('button',{name:'Qualified',exact:true}).click();await expect(page).toHaveURL(/view=opportunities&stage_id=qualified/);await expect(page.getByLabel('Filter by pipeline stage')).toHaveValue('qualified');await expect(page.getByLabel('Filter by customer')).toBeVisible();await expect(page.getByLabel('Filter by service')).toBeVisible();await expect(page.getByLabel('Filter by lead source')).toBeVisible();await expect(page.getByLabel('Close by')).toBeVisible();await expect(page.getByLabel('Sort opportunities by')).toHaveValue('updated');await page.getByLabel('Sort opportunities by').selectOption('value');await expect(page).toHaveURL(/sort=value/);await expect(page.getByLabel('Sort opportunities by')).toHaveValue('value');await page.getByLabel('Filter by service').fill('SEO');await page.getByRole('button',{name:'Search',exact:true}).click();await expect(page).toHaveURL(/view=opportunities&stage_id=qualified&service=SEO/);await page.getByLabel('Close by').fill('2026-12-31');await expect(page).toHaveURL(/close_by=2026-12-31/);await page.getByLabel('Filter by customer').selectOption({label:'Oak & Co. Builders'});await expect(page).toHaveURL(/account_id=/);await expect(page.getByRole('button',{name:'Clear filters',exact:true})).toBeVisible();await page.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(page).toHaveURL(/view=opportunities$/);await expect(page.getByLabel('Filter by pipeline stage')).toHaveValue('');
});
test('pipeline stages can be adjusted from the workspace settings',async({page})=>{
  await page.goto('/admin/crm/?view=opportunities');await page.getByRole('button',{name:'Manage stages',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Manage pipeline stages'}),row=dialog.locator('.stage-setting-row').first(),name=row.getByLabel('Stage name'),probability=row.getByLabel('Probability %');
  await expect(dialog).toBeVisible();const originalName=await name.inputValue(),originalProbability=await probability.inputValue();
  await probability.fill('11');await dialog.getByRole('button',{name:'Save pipeline stages',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'Manage stages',exact:true}).click();const reopened=page.getByRole('dialog',{name:'Manage pipeline stages'}).locator('.stage-setting-row').first();await expect(reopened.getByLabel('Probability %')).toHaveValue('11');
  await reopened.getByLabel('Stage name').fill(originalName);await reopened.getByLabel('Probability %').fill(originalProbability);await page.getByRole('dialog',{name:'Manage pipeline stages'}).getByRole('button',{name:'Save pipeline stages',exact:true}).click();await expect(page.getByRole('dialog',{name:'Manage pipeline stages'})).not.toBeVisible();
});
test('customer list exposes and clears the relationship filter',async({page})=>{
  await page.goto('/admin/crm/?view=accounts');await expect(page.getByLabel('Filter by relationship')).toBeVisible();await page.getByLabel('Filter by relationship').selectOption('customer');await expect(page).toHaveURL(/view=accounts&lifecycle=customer/);await expect(page.getByRole('button',{name:'Clear filters',exact:true})).toBeVisible();await page.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(page).toHaveURL(/view=accounts$/);await expect(page.getByLabel('Filter by relationship')).toHaveValue('');
});
test('customer CSV import previews duplicates and invalid rows before saving',async({page})=>{
  await page.goto('/admin/crm/?view=accounts');await page.getByRole('button',{name:'Import CSV',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Import customers'});await dialog.getByLabel('Customer CSV file').setInputFiles({name:'customers.csv',mimeType:'text/csv',buffer:Buffer.from('Name,Email,Phone,Website,Notes\nCSV import test,csv-import@example.com,07700900998,https://csv-import.example,"Needs a quote, soon"\nBroken row,not-an-email,,,\nExisting row,contact0@example.com,,,')});await dialog.getByRole('button',{name:'Review rows',exact:true}).click();await expect(dialog).toContainText('1 ready');await expect(dialog).toContainText('1 duplicate');await expect(dialog).toContainText('1 invalid');page.once('dialog',dialog=>dialog.accept());await dialog.getByRole('button',{name:'Import ready rows',exact:true}).click();
  await expect(dialog).not.toBeVisible();await expect(page.getByRole('button',{name:'CSV import test',exact:true})).toBeVisible();
});
test('today attention opens tasks with visible due-date and type filters',async({page})=>{
  const today=londonToday();await page.goto('/admin/crm/');await expect(page.getByRole('button',{name:/Missing due dates/})).toBeVisible();await page.getByRole('button',{name:/Needs attention/}).click();await expect(page).toHaveURL(new RegExp('view=tasks&status=open&due='+today));await expect(page.getByLabel('Filter by task type')).toBeVisible();await page.getByLabel('Filter by task type').selectOption('followup');await expect(page).toHaveURL(/kind=followup/);await expect(page.getByLabel('No due date')).toBeVisible();await expect(page.getByLabel('No due date')).not.toBeChecked();await expect(page.getByLabel('Due from')).toHaveValue('');await expect(page.getByLabel('Due by')).toHaveValue(today);await page.getByLabel('Due from').fill(today);await expect(page).toHaveURL(new RegExp('due_from='+today));await expect(page.getByRole('button',{name:'Clear filters',exact:true})).toBeVisible();await page.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(page).toHaveURL(/view=tasks$/);
});
test('filtered lists persist as saved views through a reload',async({page})=>{
  await page.goto('/admin/crm/?view=tasks&status=open&kind=followup');page.once('dialog',dialog=>dialog.accept('Open follow-ups'));await page.getByRole('button',{name:'Save view',exact:true}).click();await expect(page.getByLabel('Saved views')).toContainText('Open follow-ups');await page.reload();await expect(page.getByLabel('Saved views')).toContainText('Open follow-ups');await page.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(page).toHaveURL(/view=tasks$/);await page.getByLabel('Saved views').selectOption({label:'Open follow-ups'});await expect(page).toHaveURL(/view=tasks&status=open&kind=followup/);
});
test('open tasks can be completed in one audited bulk action',async({page})=>{
  await page.goto('/admin/crm/?view=tasks');await page.getByRole('button',{name:/New task/}).click();const dialog=page.getByRole('dialog',{name:'New task'});await dialog.getByLabel('What needs doing?').fill('Bulk completion test task');await dialog.getByRole('button',{name:'Create task',exact:true}).click();await expect(page.locator('#editor')).not.toBeVisible();await expect(page.getByRole('button',{name:'Bulk completion test task',exact:true})).toBeVisible();await page.getByLabel('Select Bulk completion test task').check();await expect(page.getByRole('button',{name:'Complete selected',exact:true})).toBeEnabled();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Complete selected',exact:true}).click();await expect(page.getByText(/task completed\./)).toBeVisible();
});
test('task editor can intentionally leave a task without a due date',async({page})=>{
  await page.goto('/admin/crm/?view=tasks');await page.getByRole('button',{name:/New task/}).click();const dialog=page.getByRole('dialog',{name:'New task'});await dialog.getByLabel('What needs doing?').fill('Unscheduled planning task');await dialog.getByLabel('No due date').check();await expect(dialog.getByLabel('Due date · Europe/London')).toHaveValue('');await dialog.getByRole('button',{name:'Create task',exact:true}).click();await expect(page).toHaveURL(/view=tasks$/);await page.goto('/admin/crm/');await expect(page.getByRole('button',{name:'Unscheduled planning task',exact:true})).toBeVisible();
});

test('mailbox recovery requires explicit confirmation and stays usable on mobile',async({page})=>{
  let confirmed=false,posted:any=null;
  await page.route('**/api/workspace/health',route=>route.fulfill({json:{ready:true,imports:[{provider_id:'100',ticket_id:'synthetic-ticket',name:'Customer',reference:'NC-0123456789ABCDEF',status:'needs_review',attempts:5,last_error:'Check the reply in Zoho.'}],totals:[{status:'needs_review',count:1}],outbox:confirmed?[]:[{id:'synthetic-message',ticket_id:'synthetic-ticket',name:'Customer',reference:'NC-0123456789ABCDEF',delivery:'unknown',created_at:'2026-09-15T10:00:00Z',updated_at:'2026-09-15T10:00:00Z'}],auth_mode:'access',logout_path:'/cdn-cgi/access/logout'}}));
  await page.route('**/api/workspace/confirm-sent',route=>{posted=route.request().postDataJSON();confirmed=true;return route.fulfill({json:{confirmed:true}});});
  await page.setViewportSize({width:390,height:844});await page.goto('/admin/crm/?view=health');
  await expect(page.getByRole('heading',{name:'Mailbox health',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Sign out',exact:true})).toHaveAttribute('href','/cdn-cgi/access/logout');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.getByRole('button',{name:'Confirm from Zoho Sent'}).click();await page.getByLabel('Evidence from Zoho Sent').fill('Checked exact recipient and the 10:00 reply in Zoho.');
  await page.getByRole('button',{name:'Record confirmation',exact:true}).click();expect(posted).toBeNull();
  await page.getByRole('checkbox',{name:'I checked this exact message in Zoho Sent.'}).check();await page.getByRole('button',{name:'Record confirmation',exact:true}).click();
  await expect(page.locator('#editor')).not.toBeVisible();expect(posted.confirmed).toBeTruthy();expect(posted.updated_at).toBe('2026-09-15T10:00:00Z');
  await page.screenshot({path:'output/crm-build/mailbox-health-mobile.png',fullPage:true});
});
test('global search finds contacts and enquiries and opens their related records',async({page})=>{
  await page.goto('/admin/crm/');
  const search=page.getByLabel('Search customers, contacts, enquiries, messages, notes, opportunities, tasks and quotes');
  await search.fill('Alex Morgan');await search.press('Enter');
  await expect(page.getByRole('heading',{name:'Search results',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Alex Morgan',exact:true})).toBeVisible();
  await expect(page.getByText(/contacts · contact0@example.com/)).toBeVisible();
  await page.getByRole('button',{name:'Alex Morgan',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Oak & Co. Builders',exact:true})).toBeVisible();
  await page.goto('/admin/crm/');
  await search.fill('Development');await search.press('Enter');
  await expect(page.getByRole('button',{name:'Booking website',exact:true})).toBeVisible();
  await page.goto('/admin/crm/');
  await search.fill('Jordan Price');await search.press('Enter');
  await expect(page.locator('#editor').getByRole('button',{name:'Jordan Price',exact:true})).toBeVisible();
  await page.locator('#editor').getByRole('button',{name:'Jordan Price',exact:true}).click();
  await expect(page).toHaveURL(/\/admin\/crm\/inbox\/\?ticket=/);
});
test('customer to opportunity, quote acceptance and recurring service works through the real local API',async({page})=>{
  const suffix=Date.now();const customer='Workflow Customer '+suffix;
  await page.goto('/admin/crm/');await page.getByRole('button',{name:'Add new'}).click();await page.getByRole('button',{name:'New customer',exact:false}).click();
  await page.getByLabel('Business or customer name').fill(customer);await page.getByLabel('Email',{exact:true}).fill('workflow@example.com');await page.getByRole('button',{name:'Create customer',exact:true}).click();await expect(page.locator('#editor')).not.toBeVisible();
  await page.goto('/admin/crm/?view=accounts');await page.getByRole('button',{name:customer,exact:true}).click();await expect(page.getByRole('heading',{name:customer,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'＋ Opportunity',exact:true}).click();await page.getByLabel('Opportunity title').fill('Website project '+suffix);await page.getByLabel('Estimated one-off value').fill('1500.00');await page.getByLabel('Next action',{exact:false}).first().fill('Discovery call');await page.getByLabel('Next action date').fill('2026-10-01');await page.getByRole('button',{name:'Create opportunity',exact:true}).click();await expect(page.locator('#editor')).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Website project '+suffix,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'＋ Quote',exact:true}).click();await page.getByLabel('Quote title').fill('Website proposal '+suffix);await page.getByLabel('Unit price £ excl. VAT').fill('1500.00');await page.getByLabel('Opportunity',{exact:true}).selectOption({label:'Website project '+suffix});await page.getByRole('button',{name:'Create quote',exact:true}).click();await expect(page.locator('#editor')).not.toBeVisible();
  await page.getByRole('button',{name:new RegExp('Website proposal '+suffix)}).click();await expect(page.locator('.quote-preview')).toContainText('£1,500.00');
  page.on('dialog',async dialog=>{if(dialog.type()==='prompt')await dialog.accept('Confirmed by customer email for this revision.');else await dialog.accept();});
  await page.getByRole('button',{name:'Record external send',exact:true}).click();await expect(page.getByRole('button',{name:'Record acceptance',exact:true})).toBeVisible();await page.getByRole('button',{name:'Record acceptance',exact:true}).click();await expect(page.locator('.quote-preview')).toContainText('Acceptance recorded');
  await page.getByRole('button',{name:'Add agreed service',exact:true}).click();await page.getByLabel('Service name').fill('Maintenance '+suffix);await page.getByLabel('Contract price £ excl. VAT').fill('100.00');await page.getByRole('button',{name:'Create service',exact:true}).click();await expect(page.locator('#editor')).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Maintenance '+suffix,exact:true})).toBeVisible();await expect(page.locator('.metrics-grid')).toContainText('£100.00');
  await expect(page.getByRole('heading',{name:'Activity timeline',exact:true})).toBeVisible();await expect(page.locator('.panel').filter({has:page.getByRole('heading',{name:'Activity timeline',exact:true})})).toContainText('CRM change');
  await page.screenshot({path:'output/crm-build/customer-workflow.png',fullPage:true});
});
test('manual phone-only leads reach the inbox, can add an email and appear as a task',async({page})=>{
  await page.goto('/admin/crm/');await page.getByRole('button',{name:'Add new'}).click();await page.getByRole('button',{name:'New lead',exact:false}).click();await page.getByLabel('Contact name',{exact:true}).fill('Phone Enquiry');await page.getByLabel('Phone',{exact:true}).fill('07700900123');await page.getByLabel('Enquiry / requirements').fill('Please call about a website.');await page.getByRole('button',{name:'Create lead',exact:true}).click();await expect(page).toHaveURL(/inbox\/\?ticket=/);await expect(page.locator('#ticket-subject')).toHaveText('New manual enquiry');await expect(page.locator('#send-message')).toBeDisabled();await expect(page.locator('#composer-hint')).toContainText('Add an email address');await expect(page.locator('#customer-details a[href^="tel:"]')).toBeVisible();await page.getByLabel('Email for replies').fill('phone@example.com');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByLabel('Email for replies')).toHaveValue('phone@example.com');await expect(page.locator('#composer-hint')).toContainText('Connect Zoho Mail');
});
test('enquiries can be archived and restored from the inbox',async({page})=>{
  await page.goto('/admin/crm/inbox/');await page.locator('.ticket-row').filter({hasText:'Jordan Price'}).click();await expect(page.getByRole('button',{name:'Archive enquiry',exact:true})).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Archive enquiry',exact:true}).click();await expect(page.locator('#ticket-detail')).toBeHidden();await expect(page.locator('.ticket-row').filter({hasText:'Jordan Price'})).toHaveCount(0);
  await page.getByLabel('Show archived enquiries').check();await page.locator('.ticket-row').filter({hasText:'Jordan Price'}).click();await expect(page.getByRole('button',{name:'Restore enquiry',exact:true})).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Restore enquiry',exact:true}).click();await expect(page.getByRole('button',{name:'Archive enquiry',exact:true})).toBeVisible();await expect(page.locator('#messages')).toContainText('new website');
});
test('inbox drafts survive reload and original ticket links still open',async({page})=>{
  await page.goto('/admin/crm/inbox/');await page.locator('.ticket-row').filter({hasText:'Jordan Price'}).click();await page.getByRole('button',{name:'Private note',exact:true}).click();await page.locator('#reply-body').fill('Persistent private draft');await expect(page.locator('#draft-status')).toHaveText('Draft saved privately.');page.on('dialog',d=>d.accept());await page.reload();await page.getByRole('button',{name:'Private note',exact:true}).click();await expect(page.locator('#reply-body')).toHaveValue('Persistent private draft');await page.getByRole('button',{name:'Save private note',exact:true}).click();await expect(page.locator('#reply-body')).toHaveValue('');
});

test('new customer form keeps a private draft after a full page reload',async({page})=>{
  await page.goto('/admin/crm/?view=accounts');await page.getByRole('button',{name:'New customer',exact:false}).click();await page.getByLabel('Business or customer name').fill('Draft customer');await page.getByLabel('Important account notes').fill('Requirements discussed but not ready to save.');
  await expect(page.locator('#editor-content')).toContainText('Draft saved privately.');page.on('dialog',d=>d.accept());await page.reload();await page.getByRole('button',{name:'New customer',exact:false}).click();
  await expect(page.getByLabel('Business or customer name')).toHaveValue('Draft customer');await expect(page.getByLabel('Important account notes')).toHaveValue('Requirements discussed but not ready to save.');await page.getByRole('button',{name:'Discard saved draft',exact:true}).click();await expect(page.getByLabel('Business or customer name')).toHaveValue('');
});
test('new customer form warns before saving a matching account identifier',async({page})=>{
  await page.goto('/admin/crm/?view=accounts');await page.getByRole('button',{name:'New customer',exact:false}).click();await page.getByLabel('Business or customer name').fill('Separate shared-email record');await page.getByLabel('Email',{exact:true}).fill('contact0@example.com');
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('Possible duplicate customer');await dialog.accept();});
  await page.getByRole('button',{name:'Create customer',exact:true}).click();await expect(page.locator('#editor')).not.toBeVisible();
});
