import { documentHtml } from '../lib/audit-report-view.js';
import { seoReportHtml } from '../lib/seo-report-view.js';

const $ = id => document.getElementById(id);
const token = location.pathname.split('/').filter(Boolean)[1] || '';
const form = $('quote-form');
let review = null;

$('print').addEventListener('click', () => window.print());

// What the enquiry asks for follows the offer made in the review.
function offerDetails(data) {
  if (data.type === 'seo') return { service: 'SEO report question', ask: 'to talk through my SEO report' };
  const type = data.offerView?.type;
  if (type === 'seo') return { service: 'Local SEO & Google ranking', ask: 'a free quote for local SEO to improve where we appear on Google' };
  if (type === 'website') return { service: 'Multi-page WordPress website', ask: 'a free quote for a new multi-page WordPress website' };
  return { service: 'Website review follow-up', ask: 'a free quote to fix the issues in the review' };
}

function prefill(data) {
  const { ask } = offerDetails(data);
  const area = data.local ? ` We would like to get more customers searching for a ${data.local.service} in ${data.local.townLabel}.` : '';
  form.elements.company.value = data.client || '';
  form.elements.message.value = data.type === 'seo' ? `Hi Nathan, I have read our SEO report and I would like ${ask}.` : `Hi Nathan, I have read the website review for ${data.client} and I would like ${ask}.${area}`;
  // Every "Get a free quote" link in the review scrolls to this form instead of leaving the page.
  for (const a of $('report').querySelectorAll('a[href$="/contact"]')) a.setAttribute('href', '#get-in-touch');
}

function showError(message) {
  $('quote-error').textContent = message;
  $('quote-error').hidden = false;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  $('quote-error').hidden = true;
  const fields = form.elements;
  if (!fields.name.value.trim()) { fields.name.focus(); return showError('Please add your name.'); }
  if (!fields.email.value.trim() || !fields.email.checkValidity()) { fields.email.focus(); return showError('Please add a valid email address so Nathan can reply.'); }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const label = button.innerHTML;
  button.textContent = 'Sending…';
  try {
    const { service } = offerDetails(review || {});
    const payload = {
      name: fields.name.value, email: fields.email.value, phone: fields.phone.value, company: fields.company.value,
      message: fields.message.value, botcheck: fields.botcheck.value,
      subject: review?.type === 'seo' ? `SEO report question: ${fields.company.value || 'client'}` : `Website review enquiry: ${review?.client || fields.company.value || 'NC Digital'}`, service,
      from_page: location.pathname, website_url: review?.finalUrl || review?.url || '',
      lead_source: 'Website review link', lead_temperature: 'hot',
      submission_key: form.dataset.key || (form.dataset.key = crypto.randomUUID()),
    };
    const response = await fetch('/api/enquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    let result = {};
    try { result = await response.json(); } catch {}
    if (!response.ok || !result.success) throw new Error(result.error || 'Your message could not be sent. Please try again, or email info@nc-digital.co.uk.');
    form.hidden = true;
    $('quote-success').hidden = false;
    $('quote-success').focus();
  } catch (error) {
    showError(error.message);
    button.disabled = false;
    button.innerHTML = label;
  }
});

(async () => {
  try {
    if (!/^[A-Za-z0-9_-]{24}$/.test(token)) throw new Error('This report link is not complete. Please check the link you were sent.');
    const preview = new URLSearchParams(location.search).has('preview') ? '?preview=1' : '';
    const portfolio = fetch('/portfolio-index.json').then(r => (r.ok ? r.json() : [])).catch(() => []);
    const response = await fetch('/api/report/' + token + preview, { cache: 'no-store' });
    let data;
    try { data = await response.json(); } catch { throw new Error('This report could not be loaded. Please try again shortly.'); }
    if (!response.ok) throw new Error(data.error || 'This report could not be loaded.');
    review = data;
    if (data.type === 'seo') {
      // An existing client's SEO report: same page, report-specific wording for the contact section.
      data.client = data.report.property.name;
      document.title = `${data.client} SEO report | NC Digital`;
      $('report').innerHTML = seoReportHtml({ report: data.report, notes: data.notes }, { forms: data.forms });
      $('cta-eyebrow').textContent = 'Get in touch';
      $('cta-title').textContent = 'Questions about your report?';
      $('cta-copy').textContent = 'Add your details and this goes straight to Nathan. We will talk you through the results and what comes next.';
      $('cta-quote').hidden = true;
    } else {
      document.title = `${data.client} website review | NC Digital`;
      $('report').innerHTML = documentHtml(data, { portfolio: await portfolio });
    }
    prefill(data);
    $('status').hidden = true;
    $('cta').hidden = false;
    $('print').hidden = false;
    if (location.hash === '#get-in-touch') $('get-in-touch').scrollIntoView();
  } catch (error) {
    $('status').textContent = error.message;
    $('status').classList.add('error');
  }
})();
