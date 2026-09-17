export function isDirectoryDomain(domain, directoryList) {
  const normalized = String(domain || '').toLowerCase().replace(/^www\./, '');
  return directoryList.some((entry) => {
    const d = entry.toLowerCase();
    return normalized === d || normalized.endsWith(`.${d}`);
  });
}

export function computeDirectoryRatio(competitors) {
  if (competitors.length === 0) return 0;
  const directoryCount = competitors.filter((c) => c.isDirectory).length;
  return directoryCount / competitors.length;
}

export function computeFloor(competitors) {
  const realBusiness = competitors.filter((c) => !c.isDirectory && c.referringDomains !== null);
  if (realBusiness.length === 0) return null;
  const sorted = realBusiness.map((c) => c.referringDomains).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function computeVerdict(directoryRatio, floor) {
  if (floor === null) return 'Unverified';
  if (directoryRatio <= 0.3 && floor >= 30) return 'Defended';
  if (directoryRatio >= 0.5 || floor < 15) return 'Soft';
  return 'Moderate';
}

export function isEmdLikeDomain(domain, trade, town) {
  const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedDomain = normalize(domain);
  const tradeSlug = normalize(trade);
  const townSlug = normalize(town);
  if (!tradeSlug || !townSlug) return false;
  return normalizedDomain.includes(tradeSlug) && normalizedDomain.includes(townSlug);
}
