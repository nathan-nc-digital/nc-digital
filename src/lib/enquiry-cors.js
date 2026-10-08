import { crmError } from './crm.js';

// Partner sites allowed to post to the public enquiry endpoints. Admin/CRM routes stay same-origin only.
export const ENQUIRY_ORIGINS = new Set(['https://plumberwebsitedesign.co.uk', 'https://www.plumberwebsitedesign.co.uk']);

export function enquiryOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin && origin === new URL(request.url).origin) return { origin, external: false };
  if (origin && ENQUIRY_ORIGINS.has(origin)) return { origin, external: true };
  throw crmError('Refresh the page and try again.', 403);
}

function corsHeaders(origin) {
  return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
}

export function withCors(response, origin) {
  if (!origin || !ENQUIRY_ORIGINS.has(origin)) return response;
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v);
  return res;
}

export function preflight(request) {
  const origin = request.headers.get('Origin');
  if (!origin || !ENQUIRY_ORIGINS.has(origin)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
