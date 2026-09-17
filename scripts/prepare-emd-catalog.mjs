import fs from 'node:fs';
const original = JSON.parse(fs.readFileSync('scripts/emd-finder-cache.json', 'utf8'));
const checks = JSON.parse(fs.readFileSync('scripts/emd-competitor-check-cache.json', 'utf8'));
const history = new Map(checks.checks.map(x => [`${x.trade}|${x.town}`, x]));
const catalog = { metricsAt: original.fetchedAt, historyAt: checks.fetchedAt, rows: original.combos.map(x => {
  const c = history.get(`${x.trade}|${x.town}`);
  return [x.trade, x.town.replaceAll('-', ' '), x.domain, x.available, x.volume, x.cpc, x.difficulty, x.avgJobCost, c?.floor ?? null, c?.directoryRatio ?? null];
}) };
fs.writeFileSync('src/data/emd-catalog.json', JSON.stringify(catalog));
console.log(`Preserved ${catalog.rows.length} existing opportunities with original dates.`);
