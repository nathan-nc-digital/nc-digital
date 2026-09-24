// "Related posts" for a blog post, chosen by topic rather than date. Words shared between two posts'
// slugs and titles are weighted by how rare they are across the blog (so "seo" + "roofers" matters
// more than "website"), with a small bonus for the same category. Picking by topic spreads internal
// links across the whole blog instead of every post linking to the same few newest posts.

const STOP = new Set('a an and are as at be by can do does for from get how i in is it its my of on or our the their this to vs what when where which who why will with you your yours need needs guide 2024 2025 2026 uk nc digital'.split(' '));

// Rough stemming so roofer/roofers/roofing, shop/shops and business/businesses match.
const stem = (w) => (w.length > 4 ? w.replace(/(ies)$/, 'y').replace(/(ings|ing|ers|er|es|s)$/, '') : w);

// Stable pseudo-random order for equally good matches, different for every post, so leftover
// slots are shared across the blog rather than always going to the newest posts.
function shuffleKey(a, b) {
  let h = 2166136261;
  for (const c of a + '|' + b) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export const slugOf = (post) => post.id.replace('/index.mdoc', '');

function words(post) {
  const text = `${slugOf(post).replace(/-/g, ' ')} ${post.data.title || ''}`.toLowerCase();
  return new Set(text.split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w)).map(stem));
}

// Every post's candidates, best match first.
function rankAll(all) {
  const bags = new Map(all.map(p => [p.id, words(p)]));
  const df = new Map();
  for (const bag of bags.values()) for (const w of bag) df.set(w, (df.get(w) || 0) + 1);
  const idf = (w) => Math.log(all.length / (df.get(w) || 1));
  const ranked = new Map();
  for (const post of all) {
    const mine = bags.get(post.id);
    const scored = all.filter(p => p.id !== post.id && p.data.pubDate).map(p => {
      let score = 0;
      for (const w of bags.get(p.id)) if (mine.has(w)) score += idf(w);
      if (p.data.category === post.data.category) score += 1;
      return { p, score, key: shuffleKey(post.id, p.id) };
    });
    scored.sort((a, b) => b.score - a.score || a.key - b.key);
    ranked.set(post.id, scored.map(s => s.p));
  }
  return ranked;
}

// All but the last slot are the closest matches. The last slot goes to the best of the next few
// matches that has the fewest links so far, so no post is left without any.
function pickAll(all, count) {
  const ranked = rankAll(all), picks = new Map(), inbound = new Map(all.map(p => [p.id, 0]));
  for (const post of all) {
    const top = ranked.get(post.id).slice(0, count - 1);
    picks.set(post.id, top);
    for (const p of top) inbound.set(p.id, inbound.get(p.id) + 1);
  }
  const order = [...all].sort((a, b) => shuffleKey('order', a.id) - shuffleKey('order', b.id));
  for (const post of order) {
    const chosen = picks.get(post.id), pool = ranked.get(post.id).slice(count - 1, count + 14).filter(p => !chosen.includes(p));
    const pick = pool.reduce((best, p) => (!best || inbound.get(p.id) < inbound.get(best.id) ? p : best), null);
    if (pick) { chosen.push(pick); inbound.set(pick.id, inbound.get(pick.id) + 1); }
  }
  return picks;
}

const cache = new WeakMap();
export function relatedPosts(post, all, count = 4) {
  let byCount = cache.get(all);
  if (!byCount) cache.set(all, (byCount = new Map()));
  if (!byCount.has(count)) byCount.set(count, pickAll(all, count));
  return byCount.get(count).get(post.id) || [];
}
