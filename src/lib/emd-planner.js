import catalog from '../data/emd-catalog.json' with { type: 'json' };
import directories from '../../scripts/emd-directory-domains.json' with { type: 'json' };

export const DAY = 86400000;
export const fresh = (at, days, now = Date.now()) => Boolean(at) && Date.parse(at) > now - days * DAY;
export const normal = x => String(x || '').toLowerCase().trim().replace(/\s+/g, ' ');
export const domainFor = (service, town) => `${normal(town + service).replace(/[^a-z0-9]/g, '')}.co.uk`;
export const baseCandidates = catalog.rows.map(([service, town, domain, available, volume, cpc, difficulty, jobValue, oldMedian, oldDirectories]) => ({ service, town, domain, volume, cpc, difficulty, jobValue, available, metricsAt: catalog.metricsAt, availabilityAt: catalog.metricsAt, history: { median: oldMedian, directories: oldDirectories, at: catalog.historyAt }, status: 'new', commission: 10 }));
export const towns = [...new Set(baseCandidates.map(x => x.town))].sort();
export const services = [...new Set(baseCandidates.map(x => x.service))].sort();
export const isDirectory = domain => directories.some(d => domain === d || domain.endsWith('.' + d));
export const numberOrNull = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null;
export function parseFilters(body = {}) {
  const mode = ['balanced', 'value', 'explore'].includes(body.mode) ? body.mode : 'balanced';
  const service = normal(body.service), town = normal(body.town);
  if ([service, town].some(x => x.length > 70 || (x && !/^[a-z0-9][a-z0-9 '&-]*$/.test(x)))) throw new Error('Use a service and town name without search operators or symbols.');
  if (service && town && domainFor(service,town).split('.')[0].length > 63) throw new Error('This service and town would make a domain longer than 63 characters. Use a shorter service name.');
  const budget = Number(body.budget ?? 1);
  if (!Number.isFinite(budget) || budget < 0.05 || budget > 1) throw new Error('Set a scan budget between $0.05 and $1.00.');
  const jobValue = body.jobValue === '' || body.jobValue == null ? null : Number(body.jobValue);
  if (jobValue !== null && (!Number.isFinite(jobValue) || jobValue < 0 || jobValue > 1000000)) throw new Error('Enter a job value between £0 and £1,000,000.');
  return { mode, service, town, budget, jobValue };
}
export function qualifies(x, mode) {
  if (mode === 'explore') return x.volume === null;
  return x.volume !== null && x.volume >= (mode === 'value' ? 20 : 50) && x.jobValue >= (mode === 'value' ? 1500 : 500);
}
export function competition(x, now = Date.now()) {
  const serp = x.serp;
  if (!serp || !fresh(serp.at, 30, now) || serp.items.length < 5) return { label: 'Unverified', median: null, reason: 'Needs a current local Google snapshot and link evidence.' };
  const business = serp.items.filter(c => !c.isDirectory);
  const measured = business.filter(c => fresh(c.linksAt, 90, now) && c.referringDomains !== null && c.referringDomains !== undefined);
  if (business.length < 2 || measured.length < business.length) return { label: 'Unverified', median: null, reason: `${serp.items.filter(c => c.isDirectory).length}/${serp.items.length} directory results; competitor link checks incomplete.` };
  const sorted = measured.map(c => c.referringDomains).sort((a,b) => a-b);
  const mid = Math.floor(sorted.length/2), median = sorted.length % 2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
  const label = median < 15 ? 'Promising' : median >= 30 ? 'Defended' : 'Moderate';
  return { label, median, reason: `Median ${median} referring domains across ${measured.length} businesses. ${serp.items.filter(c=>c.isDirectory).length} directories in ${serp.items.length} organic results. ${serp.localPack ? 'A map pack competes for clicks.' : ''}` };
}
export function priority(x) {
  const evidence = competition(x);
  return Math.log10(1 + (x.volume || 0)) * 20 + Math.log10(1 + (x.jobValue || 0)) * 8 + (evidence.label === 'Promising' ? 25 : evidence.label === 'Defended' ? -25 : 0) - (x.difficulty ?? 35) * .3;
}
export function pickCandidates(all, f) {
  let list = all.filter(x => (!f.service || x.service.includes(f.service)) && (!f.town || x.town === f.town) && !['dismissed','purchased','partner-found'].includes(x.status));
  if (f.service && f.town && !list.some(x => x.service === f.service && x.town === f.town)) list.push({ service:f.service, town:f.town, domain:domainFor(f.service,f.town), jobValue:f.jobValue ?? 0, volume:null, difficulty:null, cpc:null, available:null, status:'new', commission:10 });
  if (f.jobValue !== null) list = list.map(x => ({ ...x, jobValue:f.jobValue }));
  return list.filter(x => qualifies(x, f.mode) || x.volume === null || !fresh(x.metricsAt,90)).filter(x => !(x.available === false && fresh(x.availabilityAt,1))).sort((a,b)=>priority(b)-priority(a)).slice(0,100);
}
export function scanPreview(candidates) {
  const missing = candidates.filter(x=>!fresh(x.metricsAt,90));
  return { candidates:candidates.length, metricLookups:missing.length, maxDomains:30, maxSerps:20, deepChecks:5, estimate: Number(((missing.length ? .012 + missing.length*.00012 : 0) + .04 + .028).toFixed(5)), reservedMaximum: .05 + .2 + .1 };
}
