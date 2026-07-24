const ADMIN_USER = 'nathan';
const ADMIN_PASS = 'NC-Digital2026';
const BEN_USER = 'ben';
const BEN_PASS = 'B1E2N3!';

const VALID_STATUSES = ['not_started', 'doing', 'done'];
const VALID_ASSIGNEES = ['nathan', 'ben'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.protocol !== 'https:' || url.hostname === 'www.nc-digital.co.uk') {
      url.protocol = 'https:';
      url.hostname = 'nc-digital.co.uk';
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname.startsWith('/admin/jobs/api/')) {
      const role = resolveRole(url.pathname, request.headers.get('Authorization'));
      if (!role) return unauthorizedResponse();
      return handleJobsApi(request, env, role, url.pathname);
    }

    if (url.pathname.startsWith('/admin')) {
      const role = resolveRole(url.pathname, request.headers.get('Authorization'));
      if (!role) return unauthorizedResponse();
      // Bypass cache for admin pages so auth always runs
      const res = await env.ASSETS.fetch(request);
      return new Response(res.body, {
        status: res.status,
        headers: {
          ...Object.fromEntries(res.headers),
          'Cache-Control': 'no-store, no-cache, private',
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

export function resolveRole(pathname, authHeader) {
  const creds = decodeBasicAuth(authHeader);
  if (!creds) return null;
  if (creds.user === ADMIN_USER && creds.pass === ADMIN_PASS) return 'nathan';
  if (creds.user === BEN_USER && creds.pass === BEN_PASS && (pathname === '/admin/jobs' || pathname.startsWith('/admin/jobs/'))) return 'ben';
  return null;
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, private' },
  });
}

export async function listJobs(env, role) {
  const stmt = role === 'ben'
    ? env.JOBS_DB.prepare('SELECT * FROM jobs WHERE assigned_to = ? ORDER BY created_at').bind('ben')
    : env.JOBS_DB.prepare('SELECT * FROM jobs ORDER BY created_at');
  const { results } = await stmt.all();
  return results;
}

export async function createJob(env, role, body) {
  if (role !== 'nathan') return { error: 'Forbidden', status: 403 };
  const { client_name, notes, eta, assigned_to } = body;
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
  return jsonResponse({ error: 'Not found' }, 404);
}
