// Location pages marked `noindex: true` (out-of-area towns) are hidden from Google, so links to them
// pass no value. Automatic link lists skip them; the pages still work if someone lands on one.
import { getCollection } from 'astro:content';

let hidden: Promise<Set<string>> | null = null;

export function hiddenPaths(): Promise<Set<string>> {
  hidden ??= getCollection('locations').then(
    (locations) => new Set(locations.filter((l) => l.data.noindex).map((l) => `/${l.id.replace('/index.mdoc', '')}/`)),
  );
  return hidden;
}

export function withoutHidden<T extends { href: string }>(links: T[] | undefined, paths: Set<string>): T[] {
  return (links ?? []).filter((l) => !paths.has(l.href));
}
