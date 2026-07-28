import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuthHeader,
  mapKeywordOverviewItem,
  mapSerpItems,
  mapRelatedKeywordItem,
  dedupeRelatedKeywords,
} from '../../scripts/lib/dataforseo-helpers.mjs';

describe('buildAuthHeader', () => {
  test('builds a Basic auth header from login and password', () => {
    const header = buildAuthHeader('user@example.com', 'secret');
    const expected = 'Basic ' + Buffer.from('user@example.com:secret').toString('base64');
    assert.equal(header, expected);
  });
});

describe('mapKeywordOverviewItem', () => {
  test('extracts volume, cpc, competition, and difficulty', () => {
    const item = {
      keyword: 'web design merthyr tydfil',
      keyword_info: { search_volume: 90, cpc: 4.2, competition: 0.31 },
      keyword_properties: { keyword_difficulty: 18 },
    };
    assert.deepEqual(mapKeywordOverviewItem(item), {
      keyword: 'web design merthyr tydfil',
      volume: 90,
      cpc: 4.2,
      competition: 0.31,
      difficulty: 18,
    });
  });

  test('falls back to null when fields are missing', () => {
    const item = { keyword: 'no data keyword' };
    assert.deepEqual(mapKeywordOverviewItem(item), {
      keyword: 'no data keyword',
      volume: null,
      cpc: null,
      competition: null,
      difficulty: null,
    });
  });
});

describe('mapSerpItems', () => {
  test('keeps only organic results, up to the limit, mapped to position/domain/title/url', () => {
    const items = [
      { type: 'organic', rank_group: 1, domain: 'a.com', title: 'A', url: 'https://a.com' },
      { type: 'paid', rank_group: 1, domain: 'ad.com', title: 'Ad', url: 'https://ad.com' },
      { type: 'organic', rank_group: 2, domain: 'b.com', title: 'B', url: 'https://b.com' },
    ];
    assert.deepEqual(mapSerpItems(items, 10), [
      { position: 1, domain: 'a.com', title: 'A', url: 'https://a.com' },
      { position: 2, domain: 'b.com', title: 'B', url: 'https://b.com' },
    ]);
  });

  test('truncates to the given limit', () => {
    const items = [
      { type: 'organic', rank_group: 1, domain: 'a.com', title: 'A', url: 'https://a.com' },
      { type: 'organic', rank_group: 2, domain: 'b.com', title: 'B', url: 'https://b.com' },
    ];
    assert.equal(mapSerpItems(items, 1).length, 1);
  });

  test('handles an empty or missing list', () => {
    assert.deepEqual(mapSerpItems(undefined, 10), []);
    assert.deepEqual(mapSerpItems([], 10), []);
  });
});

describe('mapRelatedKeywordItem', () => {
  test('extracts related keyword data and tags it with the source keyword', () => {
    const item = {
      keyword_data: {
        keyword: 'web designer merthyr',
        keyword_info: { search_volume: 40, cpc: 3.9 },
        keyword_properties: { keyword_difficulty: 22 },
      },
    };
    assert.deepEqual(mapRelatedKeywordItem(item, 'web design merthyr tydfil'), {
      keyword: 'web designer merthyr',
      volume: 40,
      cpc: 3.9,
      difficulty: 22,
      sourceKeyword: 'web design merthyr tydfil',
    });
  });
});

describe('dedupeRelatedKeywords', () => {
  test('keeps the first occurrence of each keyword, case-insensitively', () => {
    const items = [
      { keyword: 'Web Designer Merthyr', volume: 40, cpc: 3.9, difficulty: 22, sourceKeyword: 'seed a' },
      { keyword: 'web designer merthyr', volume: 999, cpc: 999, difficulty: 99, sourceKeyword: 'seed b' },
      { keyword: 'another keyword', volume: 10, cpc: 1, difficulty: 5, sourceKeyword: 'seed a' },
    ];
    const result = dedupeRelatedKeywords(items);
    assert.equal(result.length, 2);
    assert.equal(result[0].sourceKeyword, 'seed a');
    assert.equal(result[1].keyword, 'another keyword');
  });

  test('drops entries with an empty keyword', () => {
    const items = [{ keyword: '  ', volume: null, cpc: null, difficulty: null, sourceKeyword: 'seed a' }];
    assert.deepEqual(dedupeRelatedKeywords(items), []);
  });
});
