export function buildAuthHeader(login, password) {
  const token = Buffer.from(`${login}:${password}`).toString('base64');
  return `Basic ${token}`;
}

export function mapKeywordOverviewItem(item) {
  const info = item?.keyword_info ?? {};
  const props = item?.keyword_properties ?? {};
  return {
    keyword: item?.keyword ?? '',
    volume: info.search_volume ?? null,
    cpc: info.cpc ?? null,
    competition: info.competition ?? null,
    difficulty: props.keyword_difficulty ?? null,
  };
}

export function mapSerpItems(items, limit = 10) {
  return (items ?? [])
    .filter((item) => item?.type === 'organic')
    .slice(0, limit)
    .map((item) => ({
      position: item.rank_group ?? item.rank_absolute ?? null,
      domain: item.domain ?? '',
      title: item.title ?? '',
      url: item.url ?? '',
    }));
}

export function mapRelatedKeywordItem(item, sourceKeyword) {
  const data = item?.keyword_data ?? {};
  const info = data.keyword_info ?? {};
  const props = data.keyword_properties ?? {};
  return {
    keyword: data.keyword ?? '',
    volume: info.search_volume ?? null,
    cpc: info.cpc ?? null,
    difficulty: props.keyword_difficulty ?? null,
    sourceKeyword,
  };
}

export function dedupeRelatedKeywords(items) {
  const seen = new Map();
  for (const item of items) {
    const key = item.keyword.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.set(key, item);
  }
  return [...seen.values()];
}
