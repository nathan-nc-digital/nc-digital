const ADMIN_USER = 'nathan';
const ADMIN_PASS = 'NC-Digital2026';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.protocol !== 'https:' || url.hostname === 'www.nc-digital.co.uk') {
      url.protocol = 'https:';
      url.hostname = 'nc-digital.co.uk';
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname.startsWith('/admin')) {
      const auth = request.headers.get('Authorization');
      if (!checkAuth(auth)) {
        return new Response('Unauthorised', {
          status: 401,
          headers: {
            'WWW-Authenticate': 'Basic realm="NC Digital Admin", charset="UTF-8"',
            'Cache-Control': 'no-store, no-cache, private',
          },
        });
      }
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

function checkAuth(header) {
  if (!header?.startsWith('Basic ')) return false;
  try {
    const decoded = atob(header.slice(6));
    const colon = decoded.indexOf(':');
    return decoded.slice(0, colon) === ADMIN_USER && decoded.slice(colon + 1) === ADMIN_PASS;
  } catch {
    return false;
  }
}
