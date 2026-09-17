const ADMIN_USER = 'nathan';
const BEN_USER = 'ben';

import { handleSocialApi, serveSocialMedia } from './lib/social-api.js';
import { runMetaSchedule } from './lib/social-meta.js';
import { runBufferQueue } from './lib/social-api.js';
import { handleKeywordResearch } from './lib/keyword-research.js';
import { handleEmd } from './lib/emd-api.js';
import { handleWebsiteAudit } from './lib/website-audit-api.js';
import { handleSeoWins } from './lib/seo-quick-wins-api.js';
import { handleAnalyticsReport } from './lib/analytics-report-api.js';
import { handleCompetitorGaps } from './lib/competitor-gaps-api.js';
import { handleCrmApi, handleEnquiry } from './lib/crm-api.js';
import { runCrmSchedule } from './lib/crm-zoho.js';
import { readJson, sameOrigin, failure } from './lib/crm.js';
import { runWorkspaceSchedule } from './lib/crm-commercial.js';
import {accessEnabled, resolveAccessRole, accessDenied} from './lib/admin-access.js';
import {runCloudBackup} from './lib/crm-cloud-backup.js';

const VALID_STATUSES = ['not_started', 'doing', 'done'];
const VALID_ASSIGNEES = ['nathan', 'ben'];

const SCHEDULED_JOBS = { meta: runMetaSchedule, buffer: runBufferQueue, crm: runCrmSchedule, workspace: runWorkspaceSchedule, backup: runCloudBackup };

// Every job runs to completion regardless of its siblings: a rejected Promise.all would end the
// invocation while a backup or mailbox sync is still mid-flight. Failures are logged by name only.
export async function runScheduledJobs(env, jobs = SCHEDULED_JOBS) {
  const names = Object.keys(jobs);
  const outcomes = await Promise.allSettled(names.map(name => Promise.resolve().then(() => jobs[name](env))));
  outcomes.forEach((outcome, i) => {
    if (outcome.status === 'rejected') console.error(JSON.stringify({ event: 'scheduled_job_failed', job: names[i], error: outcome.reason?.name || 'Error' }));
  });
}

export default {
  async scheduled(controller, env) {
    await runScheduledJobs(env);
  },
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.protocol !== 'https:' || url.hostname === 'www.nc-digital.co.uk') {
      url.protocol = 'https:';
      url.hostname = 'nc-digital.co.uk';
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname.startsWith('/social-media/')) return serveSocialMedia(request, env);

    if (url.pathname === '/api/enquiries' || url.pathname === '/api/enquiries/config') return handleEnquiry(request, env);

    // Once Access is enabled, a Basic password can never bypass it, including on workers.dev.
    let managedRole=null;
    const managedPath=env.ADMIN_AUTH_SCOPE==='crm'?(url.pathname==='/admin/crm'||url.pathname.startsWith('/admin/crm/')):url.pathname.startsWith('/admin');
    if(managedPath&&env.ADMIN_AUTH_MODE&&env.ADMIN_AUTH_MODE!=='basic'){
      if(!accessEnabled(env))return accessDenied(true);
      try{managedRole=await resolveAccessRole(request,env);}catch{return accessDenied(true);}
      if(!managedRole)return accessDenied();
    }
    const requestRole=()=>managedRole?Promise.resolve(managedRole):resolveRole(url.pathname,request.headers.get('Authorization'),env);

    if (url.pathname.startsWith('/admin/crm/api/')) {
      const role = await requestRole();
      if (role !== 'nathan') return unauthorizedResponse();
      return handleCrmApi(request, env, role);
    }

    if (url.pathname.startsWith('/admin/keyword-research/api/')) {
      const role = await requestRole();
      if (role !== 'nathan') return unauthorizedResponse();
      return handleKeywordResearch(request, env);
    }

    if (url.pathname.startsWith('/admin/competitor-gaps/api/')) {
      const role = await requestRole();
      if (role !== 'nathan') return unauthorizedResponse();
      return handleCompetitorGaps(request, env);
    }

    if (url.pathname.startsWith('/admin/analytics-reports/api/')) {
      const role = await requestRole();
      if (role !== 'nathan') return unauthorizedResponse();
      return handleAnalyticsReport(request, env);
    }

    if (url.pathname.startsWith('/admin/seo-quick-wins/api/')) {
      const role = await requestRole();
      if (role !== 'nathan') return unauthorizedResponse();
      return handleSeoWins(request, env);
    }

    if (url.pathname.startsWith('/admin/website-audit/api/')) {
      const role = await requestRole();
      if (role !== 'nathan') return unauthorizedResponse();
      return handleWebsiteAudit(request, env);
    }

    if (url.pathname.startsWith('/admin/emd-finder/api/')) {
      const role = await requestRole();
      if (role !== 'nathan') return unauthorizedResponse();
      return handleEmd(request, env);
    }

    if (url.pathname.startsWith('/admin/social/api/')) {
      const role = await requestRole();
      if (role !== 'nathan') return unauthorizedResponse();
      return handleSocialApi(request, env);
    }

    if (url.pathname.startsWith('/admin/jobs/api/')) {
      const role = await requestRole();
      if (!role) return unauthorizedResponse();
      return handleJobsApi(request, env, role, url.pathname);
    }

    if (url.pathname.startsWith('/admin')) {
      const role = await requestRole();
      if (!role) return unauthorizedResponse();
      // Bypass cache for admin pages so auth always runs.
      // Cloudflare-CDN-Cache-Control controls the *edge* cache specifically and
      // overrides any zone-level default caching — plain Cache-Control alone
      // was observed being ignored by the edge (CF-Cache-Status: HIT) even
      // though it's respected by browsers.
      const res = await env.ASSETS.fetch(request, { cf: { cacheTtl: 0, cacheEverything: false } });
      return new Response(res.body, {
        status: res.status,
        headers: {
          ...Object.fromEntries(res.headers),
          'Cache-Control': 'no-store, no-cache, private',
          'Cloudflare-CDN-Cache-Control': 'no-store',
          ...(url.pathname==='/admin/crm'||url.pathname.startsWith('/admin/crm/')?{
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
            'X-Frame-Options':'DENY',
            'Referrer-Policy':'same-origin',
            'X-Content-Type-Options':'nosniff',
          }:{}),
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};

function unauthorizedResponse() {
  return new Response('Unauthorised', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="NC Digital Admin", charset="UTF-8"',
      'Cache-Control': 'no-store, no-cache, private',
      'Cloudflare-CDN-Cache-Control': 'no-store',
    },
  });
}

export function decodeBasicAuth(header) {
  if (!header?.startsWith('Basic ')) return null;
  try {
    const decoded = atob(header.slice(6));
    const colon = decoded.indexOf(':');
    if (colon === -1) return null;
    return { user: decoded.slice(0, colon), pass: decoded.slice(colon + 1) };
  } catch {
    return null;
  }
}

async function passwordMatches(provided, expected) {
  if (typeof expected !== 'string' || !expected || !provided || provided.length > 1024) return false;
  // HMAC verification performs the secret comparison inside Web Crypto.
  const encoder = new TextEncoder();
  const compareKey = await crypto.subtle.importKey('raw', encoder.encode('nc-digital-admin-password-comparison'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign('HMAC', compareKey, encoder.encode(expected));
  return crypto.subtle.verify('HMAC', compareKey, signature, encoder.encode(provided));
}

export async function resolveRole(pathname, authHeader, env = {}) {
  const creds = decodeBasicAuth(authHeader);
  if (!creds) return null;
  if (creds.user === ADMIN_USER && await passwordMatches(creds.pass, env.ADMIN_PASSWORD)) return 'nathan';
  if (creds.user === BEN_USER && (pathname === '/admin/jobs' || pathname.startsWith('/admin/jobs/')) && await passwordMatches(creds.pass, env.BEN_PASSWORD)) return 'ben';
  return null;
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, private',
      'Cloudflare-CDN-Cache-Control': 'no-store',
    },
  });
}

export async function listJobs(env, role) {
  const stmt = role === 'ben'
    ? env.JOBS_DB.prepare('SELECT * FROM jobs WHERE assigned_to = ? ORDER BY created_at').bind('ben')
    : env.JOBS_DB.prepare('SELECT * FROM jobs ORDER BY created_at');
  const { results } = await stmt.all();
  if (!results.length) return results;

  const ids = results.map(j => j.id);
  const placeholders = ids.map(() => '?').join(',');
  const { results: notes } = await env.JOBS_DB
    .prepare(`SELECT * FROM job_notes WHERE job_id IN (${placeholders}) ORDER BY created_at`)
    .bind(...ids)
    .all();

  const notesByJob = new Map();
  for (const note of notes) {
    if (!notesByJob.has(note.job_id)) notesByJob.set(note.job_id, []);
    notesByJob.get(note.job_id).push(note);
  }
  return results.map(job => ({ ...job, notes_log: notesByJob.get(job.id) || [] }));
}

export async function addJobNote(env, role, body) {
  const { job_id, text } = body;
  if (!job_id || !text) return { error: 'job_id and text are required', status: 400 };

  const job = await env.JOBS_DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(job_id).first();
  if (!job) return { error: 'Not found', status: 404 };
  if (role === 'ben' && job.assigned_to !== 'ben') return { error: 'Forbidden', status: 403 };

  const now = new Date().toISOString();
  await env.JOBS_DB.prepare(
    'INSERT INTO job_notes (job_id, author, text, created_at) VALUES (?, ?, ?, ?)'
  ).bind(job_id, role, text, now).run();
  return { status: 201 };
}

export async function deleteJobNote(env, role, body) {
  const { id } = body;
  if (!id) return { error: 'id is required', status: 400 };

  const note = await env.JOBS_DB.prepare('SELECT * FROM job_notes WHERE id = ?').bind(id).first();
  if (!note) return { error: 'Not found', status: 404 };

  const job = await env.JOBS_DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(note.job_id).first();
  if (role === 'ben' && job?.assigned_to !== 'ben') return { error: 'Forbidden', status: 403 };

  await env.JOBS_DB.prepare('DELETE FROM job_notes WHERE id = ?').bind(id).run();
  return { status: 200 };
}

export async function createJob(env, role, body) {
  if (role !== 'nathan' && role !== 'ben') return { error: 'Forbidden', status: 403 };
  const { client_name, notes, eta } = body;
  const assigned_to = role === 'ben' ? 'ben' : body.assigned_to;
  if (!client_name || !assigned_to) return { error: 'client_name and assigned_to are required', status: 400 };
  if (!VALID_ASSIGNEES.includes(assigned_to)) return { error: 'Invalid assigned_to', status: 400 };
  const now = new Date().toISOString();
  await env.JOBS_DB.prepare(
    'INSERT INTO jobs (client_name, notes, status, eta, assigned_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(client_name, notes ?? null, 'not_started', eta ?? null, assigned_to, now, now).run();
  return { status: 201 };
}

export async function updateJob(env, role, body) {
  const { id, status, eta, client_name, notes, assigned_to } = body;
  if (!id) return { error: 'id is required', status: 400 };
  if (status !== undefined && !VALID_STATUSES.includes(status)) return { error: 'Invalid status', status: 400 };
  if (assigned_to !== undefined && !VALID_ASSIGNEES.includes(assigned_to)) return { error: 'Invalid assigned_to', status: 400 };

  const job = await env.JOBS_DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first();
  if (!job) return { error: 'Not found', status: 404 };

  if (role === 'ben') {
    if (job.assigned_to !== 'ben') return { error: 'Forbidden', status: 403 };
    if (client_name !== undefined || notes !== undefined || assigned_to !== undefined) {
      return { error: 'Forbidden', status: 403 };
    }
  }

  const now = new Date().toISOString();
  const next = {
    client_name: 'client_name' in body ? client_name : job.client_name,
    notes: 'notes' in body ? notes : job.notes,
    status: 'status' in body ? status : job.status,
    eta: 'eta' in body ? eta : job.eta,
    assigned_to: 'assigned_to' in body ? assigned_to : job.assigned_to,
  };
  await env.JOBS_DB.prepare(
    'UPDATE jobs SET client_name=?, notes=?, status=?, eta=?, assigned_to=?, updated_at=? WHERE id=?'
  ).bind(next.client_name, next.notes, next.status, next.eta, next.assigned_to, now, id).run();
  return { status: 200 };
}

export async function deleteJob(env, role, body) {
  if (role !== 'nathan') return { error: 'Forbidden', status: 403 };
  if (!body.id) return { error: 'id is required', status: 400 };
  await env.JOBS_DB.prepare('DELETE FROM jobs WHERE id = ?').bind(body.id).run();
  return { status: 200 };
}

async function handleJobsApi(request, env, role, pathname) {
  if (request.method === 'POST') {
    try { sameOrigin(request); await readJson(request.clone()); } catch(error) { return failure(error); }
  }
  if (pathname === '/admin/jobs/api/whoami') {
    return jsonResponse({ role }, 200);
  }
  if (pathname === '/admin/jobs/api/list' && request.method === 'GET') {
    const jobs = await listJobs(env, role);
    return jsonResponse({ jobs }, 200);
  }
  if (pathname === '/admin/jobs/api/create' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const result = await createJob(env, role, body);
    return jsonResponse(result.error ? { error: result.error } : { ok: true }, result.status);
  }
  if (pathname === '/admin/jobs/api/update' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const result = await updateJob(env, role, body);
    return jsonResponse(result.error ? { error: result.error } : { ok: true }, result.status);
  }
  if (pathname === '/admin/jobs/api/delete' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const result = await deleteJob(env, role, body);
    return jsonResponse(result.error ? { error: result.error } : { ok: true }, result.status);
  }
  if (pathname === '/admin/jobs/api/notes/add' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const result = await addJobNote(env, role, body);
    return jsonResponse(result.error ? { error: result.error } : { ok: true }, result.status);
  }
  if (pathname === '/admin/jobs/api/notes/delete' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const result = await deleteJobNote(env, role, body);
    return jsonResponse(result.error ? { error: result.error } : { ok: true }, result.status);
  }
  return jsonResponse({ error: 'Not found' }, 404);
}
