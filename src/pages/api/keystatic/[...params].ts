import type { APIContext } from 'astro';

export const prerender = import.meta.env.PROD ? true : false;

export function getStaticPaths() {
  return [];
}

export async function ALL(context: APIContext) {
  if (import.meta.env.PROD) {
    return new Response('Not found', { status: 404 });
  }
  const { makeHandler } = await import('@keystatic/astro/api');
  const keystatic = (await import('../../../../keystatic.config')).default;
  return makeHandler({ config: keystatic })(context);
}
