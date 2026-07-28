function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function buildDomain(trade, town) {
  return `${slug(town)}${slug(trade)}.co.uk`;
}

export function buildPhrase(trade, town) {
  return `${trade} ${town.replace(/-/g, ' ')}`;
}

export function buildCombos(trades, towns) {
  const combos = [];
  for (const town of towns) {
    for (const trade of trades) {
      combos.push({
        trade,
        town,
        domain: buildDomain(trade, town),
        phrase: buildPhrase(trade, town),
      });
    }
  }
  return combos;
}

export function interpretRdapStatus(status) {
  if (status === 404) return true;
  if (status === 200) return false;
  return null;
}
