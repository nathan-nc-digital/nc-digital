// Local search demand and Google rankings for a website audit: how many people search for the
// client's service in their town, and where (if anywhere) the client appears for those searches.
import { parseResearchInput, seedKeywords } from './keyword-planner.js';
import { researchLocations } from './keyword-research.js';

// Every local search in the list is checked (about half a penny each), so the report has no gaps.
export const MAX_RANKING_CHECKS = 8;

// Returns null when no local search was requested; throws a user-facing message when half-filled.
export function localSearchInput(body) {
  const service = String(body?.service || '').trim(), town = String(body?.town || '').trim();
  if (!service && !town) return null;
  if (!service) throw new Error('Enter the main service to check local rankings, or clear the town.');
  if (!town) throw new Error('Choose the town to check local rankings in.');
  const input = parseResearchInput({ query: service, service, location: town }, researchLocations);
  return { service: input.service, town: input.town, townLabel: input.location.name.split(',')[0], locationCode: input.location.code, locationName: input.location.name, keywords: [], queue: [], cost: 0, error: null, warning: null };
}

// The main "service town" search first, then the planner's other local variations.
export function localKeywordList(local) {
  const seeds = seedKeywords({ service: local.service, town: local.town, extra: [] });
  return [...new Set([`${local.service} ${local.town}`, ...seeds.local])].slice(0, 8);
}

// The main search first, then the rest by demand; searches without volume data still get checked.
export function rankingQueue(keywords) {
  const [first, ...rest] = keywords;
  const byDemand = [...rest].sort((a, b) => (b.volume || 0) - (a.volume || 0));
  return [first, ...byDemand].slice(0, MAX_RANKING_CHECKS).map(k => k.keyword);
}

const host = value => {
  try { return new URL(String(value).includes('://') ? value : 'https://' + value).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
};
const words = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function rankingFrom(result, siteUrl, client) {
  const domain = host(siteUrl), items = result?.items || [];
  const sameSite = x => { const h = host(x.domain || x.url || ''); return Boolean(h) && (h === domain || h.endsWith('.' + domain)); };
  const organic = items.filter(x => x.type === 'organic');
  const mine = organic.find(sameSite);
  const pack = items.filter(x => x.type === 'local_pack' || x.type === 'map').flatMap(x => Array.isArray(x.items) ? x.items : [x]).filter(x => x?.title).slice(0, 3);
  // Map listings often have no website, so a listing also counts when it carries the business name.
  const name = words(client), named = x => name.length >= 4 && name !== words(domain) && words(x.title).includes(name);
  return {
    checked: true,
    position: mine ? Number(mine.rank_group ?? mine.rank_absolute) || null : null,
    url: mine?.url ? String(mine.url).slice(0, 1000) : null,
    mapPackShown: pack.length > 0,
    inMapPack: pack.some(x => sameSite(x) || named(x)),
    mapPack: pack.map(x => String(x.title).slice(0, 120)),
    mapPackDetails: pack.map(x => ({ title: String(x.title).slice(0, 120), rating: typeof x.rating?.value === 'number' ? x.rating.value : null, reviews: Number.isInteger(x.rating?.votes_count) ? x.rating.votes_count : null })),
    top3: organic.filter(x => x !== mine).slice(0, 3).map(x => ({ position: Number(x.rank_group) || null, domain: host(x.domain || x.url || ''), title: String(x.title || '').slice(0, 140) })),
  };
}
