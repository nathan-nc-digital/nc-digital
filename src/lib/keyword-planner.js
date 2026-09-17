export const clean = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export const titleCase = value => value.replace(/\b\p{L}/gu, c => c.toUpperCase());
const unique = values => [...new Set(values.map(clean).filter(Boolean))];
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const profiles = [
  { match: /\b(plumber|plumbers|plumbing)\b/, aliases: ['plumber', 'plumbers', 'plumbing services'], services: ['emergency plumber', 'leak repair', 'blocked drains', 'bathroom installation', 'radiator repair', 'boiler repair', 'boiler servicing', 'commercial plumber'] },
  { match: /\b(electrician|electricians|electrical)\b/, aliases: ['electrician', 'electricians', 'electrical services'], services: ['emergency electrician', 'house rewiring', 'electrical testing', 'consumer unit replacement', 'ev charger installation', 'commercial electrician'] },
  { match: /\b(roofer|roofers|roofing)\b/, aliases: ['roofer', 'roofers', 'roofing services'], services: ['roof repair', 'flat roofing', 'new roof', 'gutter repair', 'emergency roof repair', 'slate roofing'] },
  { match: /\b(builder|builders|building)\b/, aliases: ['builder', 'builders', 'building services'], services: ['house extensions', 'loft conversions', 'garage conversions', 'property renovation', 'commercial builders'] },
  { match: /\b(cleaner|cleaners|cleaning)\b/, aliases: ['cleaner', 'cleaners', 'cleaning services'], services: ['domestic cleaning', 'commercial cleaning', 'end of tenancy cleaning', 'deep cleaning', 'office cleaning'] },
];

export function parseResearchInput(body, locations) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Enter a service and UK town.');
  for (const key of ['query', 'location', 'service', 'services', 'website']) {
    if (body[key] !== undefined && typeof body[key] !== 'string') throw new Error(`Invalid ${key}.`);
  }
  const query = clean(body.query);
  if (query.length < 3 || query.length > 160 || /[<>\x00-\x1f]/.test(query)) throw new Error('Enter a search phrase between 3 and 160 characters.');
  const locationText = clean(body.location);
  let matches = locations.filter(x => locationText
    ? clean(x.name) === locationText || clean(x.name.split(',')[0]) === locationText
    : query.endsWith(` ${clean(x.name.split(',')[0])}`));
  matches.sort((a, b) => b.name.split(',')[0].length - a.name.split(',')[0].length || (a.type === 'City' ? -1 : b.type === 'City' ? 1 : a.code - b.code));
  const location = matches[0];
  if (!location) throw new Error('Choose a UK town in the location field so we can check the right local results.');
  const town = clean(location.name.split(',')[0]);
  const sameName = matches.filter(x => clean(x.name.split(',')[0]) === town);
  if (new Set(sameName.map(x => x.name.split(',').slice(-3).join(','))).size > 1 && !locationText.includes(',')) {
    throw new Error(`There is more than one ${titleCase(town)}. Choose the full location from the suggestions.`);
  }
  const inferred = query.endsWith(` ${town}`) ? query.slice(0, -town.length).trim().replace(/\s+(in|near|around)$/, '') : query;
  const service = clean(body.service || inferred);
  if (!service || service.length > 80 || /[<>\x00-\x1f]/.test(service)) throw new Error('Enter a service, such as plumber.');
  const extra = unique((body.services || '').split(/[,\n]/));
  if (extra.length > 10 || extra.some(x => x.length > 70 || /[<>\x00-\x1f]/.test(x))) throw new Error('Add up to 10 services, each under 70 characters.');
  let website = '';
  if (body.website) {
    try { const u = new URL(body.website.includes('://') ? body.website : `https://${body.website}`); if (!['https:', 'http:'].includes(u.protocol) || !u.hostname.includes('.') || u.username || u.password) throw new Error(); website = u.hostname.replace(/^www\./, '').toLowerCase(); } catch { throw new Error('Enter a valid client website, such as example.co.uk.'); }
  }
  return { query: `${service} ${town}`, service, town, location, extra, website, refresh: body.refresh === true };
}

export function seedKeywords(input) {
  const profile = profiles.find(x => x.match.test(input.service));
  const aliases = unique([input.service, ...(profile?.aliases || [])]);
  // Service ideas are explicitly conditional until confirmed by the client.
  const services = unique([...input.extra, ...(profile?.services || [`${input.service} services`, `commercial ${input.service}`])]);
  const local = unique([...aliases.map(x => `${x} ${input.town}`), ...aliases.map(x => `${x} in ${input.town}`), `local ${input.service} ${input.town}`, ...services.map(x => `${x} ${input.town}`)]);
  const broad = unique([input.service, ...services.slice(0, 10), `${input.service} near me`, `${input.service} cost`]);
  return { local, broad, aliases, services };
}

export function mapKeyword(item, origin = 'DataForSEO discovery') {
  const data = item?.keyword_data || item || {};
  const info = data.keyword_info || {};
  return { keyword: clean(data.keyword), volume: number(info.search_volume), cpc: number(info.cpc), adsCompetition: number(info.competition), difficulty: number(data.keyword_properties?.keyword_difficulty),
    intent: data.search_intent_info?.main_intent || null, updatedAt: info.last_updated_time || null,
    monthly: (info.monthly_searches || []).filter(x => Number.isInteger(x.year) && x.month >= 1 && x.month <= 12).map(x => ({ year: x.year, month: x.month, volume: number(x.search_volume) })).sort((a, b) => a.year - b.year || a.month - b.month).slice(-12), origin };
}

export function relevantDiscovery(keyword, input, seeds, locations) {
  const k = clean(keyword);
  if (!k || k.length > 120 || /\b(jobs?|salary|salaries|apprentice|apprenticeship|training|courses?|supplies|wholesale|screwfix|toolstation|games?)\b/.test(k)) return false;
  const roots = unique([input.service, ...seeds.aliases, ...input.extra]);
  if (!roots.some(x => k.includes(x))) return false;
  if (k.includes(input.town)) return true;
  // Restrict discoveries to the entered area; do not turn another town's demand into local evidence.
  return !locations.some(x => { const town = clean(x.name.split(',')[0]); return town.length > 3 && town !== input.town && (k.endsWith(` ${town}`) || k.includes(` ${town} `)); });
}

export function classifyKeyword(row, input, seeds) {
  const k = row.keyword;
  const local = k.includes(input.town);
  const informational = /^(how|what|why|when|can|do|does|is|are)\b/.test(k) || /\b(cost|costs|price|prices|guide)\b/.test(k);
  const intent = row.intent || (informational ? 'informational' : 'commercial');
  const core = k === input.query || seeds.aliases.some(x => k === `${x} ${input.town}` || k === `${x} in ${input.town}`) || k === `local ${input.service} ${input.town}`;
  const categories = [[/emergency|24 hour|24\/7/, 'Emergency service'], [/boiler/, 'Boiler services'], [/bathroom/, 'Bathrooms'], [/drain|blocked/, 'Drainage'], [/leak/, 'Leaks'], [/radiator|heating/, 'Heating'], [/commercial|office/, 'Commercial services'], [/rewir/, 'Rewiring'], [/testing|eicr|inspection/, 'Testing and inspection'], [/charger/, 'EV charging'], [/consumer unit/, 'Consumer units'], [/flat roof/, 'Flat roofing'], [/gutter/, 'Guttering'], [/roof repair/, 'Roof repairs'], [/new roof|slate/, 'Roof installation'], [/extension/, 'Extensions'], [/conversion/, 'Conversions'], [/renovation/, 'Renovations'], [/tenancy/, 'End of tenancy'], [/deep clean/, 'Deep cleaning']];
  const custom = input.extra.find(term => k.includes(term));
  let cluster = core ? 'Main service' : custom ? titleCase(custom) : categories.find(([re]) => re.test(k))?.[1] || 'Main service';
  if (informational) cluster = 'Advice and costs';
  const excluded = /\b(jobs?|salary|apprentice|training|courses?|supplies|wholesale)\b/.test(k);
  const relevance = excluded ? 0 : local ? (core ? 55 : 40) : 10;
  // Missing metrics add no evidence points. They are never converted to zero volume or easy difficulty.
  const demandPoints = row.volume === null ? 0 : Math.min(25, Math.log10(row.volume + 1) * 8);
  const difficultyPoints = row.difficulty === null ? 0 : (100 - row.difficulty) * .15;
  const commercialPoints = ['commercial', 'transactional'].includes(intent) ? 5 : 0;
  const score = Math.round(Math.min(100, relevance + demandPoints + difficultyPoints + commercialPoints));
  return { ...row, local, core, cluster, intent, intentSource: row.intent ? 'DataForSEO' : 'Phrase-based estimate', score,
    priority: excluded ? 'Exclude' : !local ? 'Supporting research' : core ? 'Primary target' : row.volume > 0 ? 'Opportunity' : 'Validate with client',
    reason: excluded ? 'Recruitment or supplier intent does not match a service enquiry.' : core ? 'Direct match for the main service and target town. Group close variants on one page.' : !local ? 'UK-wide topic research; this is not evidence of demand in the client’s town.' : row.volume > 0 ? 'Town-specific phrase with reported search demand. Only target it if the client provides this service.' : 'Relevant local service idea; demand is unreported or zero in this dataset. Confirm the service and test demand.',
  };
}

export function planPages(rows, input) {
  const groups = new Map();
  for (const row of rows.filter(x => x.local && x.priority !== 'Exclude')) {
    if (!groups.has(row.cluster)) groups.set(row.cluster, []);
    groups.get(row.cluster).push(row);
  }
  return [...groups].map(([cluster, items]) => {
    items.sort((a, b) => b.score - a.score || (b.volume ?? -1) - (a.volume ?? -1));
    const primary = cluster === 'Main service' ? items.find(x => x.keyword === input.query) || items[0] : items[0];
    const main = cluster === 'Main service';
    const slug = main ? '/' : `/${primary.keyword.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}/`;
    return { cluster, primary: primary.keyword, supporting: items.filter(x => x !== primary).map(x => x.keyword), volume: primary.volume, difficulty: primary.difficulty,
      path: slug, type: main ? 'Homepage / main location page' : cluster === 'Advice and costs' ? 'Guide or FAQ section' : 'Service page — confirm offered',
      title: `${titleCase(primary.keyword)} | [Client name]`, h1: titleCase(primary.keyword),
      sections: main ? [`${titleCase(input.service)} services in ${titleCase(input.town)}`, 'Services actually offered', 'Recent local work and customer reviews', 'Coverage, availability and how to request a quote', 'Customer questions'] : ['Who this service is for', 'What is included and how the work is done', 'Real projects, qualifications and reviews', 'Costs, availability and next steps'],
      evidence: main ? 'Core service relevance; use the metrics as supporting evidence, not a traffic forecast.' : items.some(x => x.volume > 0) ? 'At least one local phrase has reported search volume. Review relevance before creating a page.' : 'No positive volume reported for this cluster. Consider a section on the main service page before a standalone page.',
    };
  }).sort((a, b) => (a.cluster === 'Main service' ? -1 : b.cluster === 'Main service' ? 1 : (b.volume ?? -1) - (a.volume ?? -1)));
}

export function buildReport(input, keywordItems, serp, warnings, cost, calls) {
  const seeds = seedKeywords(input);
  const deduped = new Map();
  for (const row of keywordItems) if (row.keyword) deduped.set(row.keyword, row);
  const rows = [...deduped.values()].map(x => classifyKeyword(x, input, seeds)).sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword));
  const organic = (serp?.items || []).filter(x => x.type === 'organic').slice(0, 10).map(x => ({ position: x.rank_group ?? x.rank_absolute, domain: x.domain || '', title: x.title || '', url: x.url || '', description: x.description || '' }));
  const questions = unique((serp?.items || []).filter(x => x.type === 'people_also_ask').flatMap(x => (x.items || []).map(y => y.title)).filter(Boolean)).slice(0, 12);
  const relatedSearches = unique((serp?.items || []).filter(x => x.type === 'related_searches').flatMap(x => x.items || []).map(x => typeof x === 'string' ? x : x.title).filter(Boolean));
  return { input, fetchedAt: new Date().toISOString(), keywords: rows, pages: planPages(rows, input), organic, questions, relatedSearches,
    serp: { available: Boolean(serp), location: input.location.name, device: 'desktop', checkedAt: serp?.datetime || null, features: unique((serp?.items || []).map(x => x.type)), checkUrl: serp?.check_url || null },
    clientRanking: input.website ? organic.find(x => x.domain.replace(/^www\./, '') === input.website)?.position || null : null,
    warnings, cost: { usd: cost, calls }, metrics: { source: 'DataForSEO Google Labs', location: 'United Kingdom', language: 'English', currency: 'USD' },
    methodology: 'Priority is a planning heuristic, not a ranking prediction: relevance up to 55 points, reported volume up to 25, known difficulty up to 15, commercial intent up to 5. Missing metrics earn no evidence points. Search volumes are UK-wide estimates for each exact phrase; overlapping variants must not be added as unique traffic. Advertising competition is separate from organic keyword difficulty. Page groups are phrase-based suggestions, not a full SERP overlap analysis.' };
}
