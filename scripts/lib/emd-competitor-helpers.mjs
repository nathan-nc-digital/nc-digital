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
  return Math.min(...realBusiness.map((c) => c.referringDomains));
}

export function computeVerdict(directoryRatio, floor) {
  if (floor === null) return 'Soft';
  if (directoryRatio <= 0.3 && floor >= 30) return 'Defended';
  if (directoryRatio >= 0.5 || floor < 15) return 'Soft';
  return 'Moderate';
}
