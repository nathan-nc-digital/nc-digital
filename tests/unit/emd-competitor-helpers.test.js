import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDirectoryDomain,
  computeDirectoryRatio,
  computeFloor,
  computeVerdict,
} from '../../scripts/lib/emd-competitor-helpers.mjs';

const DIRECTORY_LIST = ['yell.com', 'trustpilot.com', 'facebook.com'];

describe('isDirectoryDomain', () => {
  test('matches an exact directory domain', () => {
    assert.equal(isDirectoryDomain('yell.com', DIRECTORY_LIST), true);
  });

  test('matches with a www prefix stripped', () => {
    assert.equal(isDirectoryDomain('www.yell.com', DIRECTORY_LIST), true);
  });

  test('matches a subdomain of a directory domain', () => {
    assert.equal(isDirectoryDomain('uk.trustpilot.com', DIRECTORY_LIST), true);
  });

  test('does not match a real business domain', () => {
    assert.equal(isDirectoryDomain('locksmith-newport.co.uk', DIRECTORY_LIST), false);
  });

  test('does not false-positive on a domain that merely contains a directory name as a substring', () => {
    assert.equal(isDirectoryDomain('notyell.com', DIRECTORY_LIST), false);
  });
});

describe('computeDirectoryRatio', () => {
  test('computes the fraction of directory results', () => {
    const competitors = [
      { isDirectory: true }, { isDirectory: true }, { isDirectory: false },
    ];
    assert.equal(computeDirectoryRatio(competitors), 2 / 3);
  });

  test('returns 0 for an empty list', () => {
    assert.equal(computeDirectoryRatio([]), 0);
  });
});

describe('computeFloor', () => {
  test('returns the median referring-domain count among real-business competitors (odd count)', () => {
    const competitors = [
      { isDirectory: false, referringDomains: 80 },
      { isDirectory: false, referringDomains: 42 },
      { isDirectory: false, referringDomains: 10 },
      { isDirectory: true, referringDomains: null },
    ];
    assert.equal(computeFloor(competitors), 42);
  });

  test('averages the two middle values for an even count', () => {
    const competitors = [
      { isDirectory: false, referringDomains: 80 },
      { isDirectory: false, referringDomains: 42 },
    ];
    assert.equal(computeFloor(competitors), 61);
  });

  test('returns null when there are no real-business competitors', () => {
    const competitors = [{ isDirectory: true, referringDomains: null }];
    assert.equal(computeFloor(competitors), null);
  });

  test('ignores real-business competitors with a failed (null) lookup', () => {
    const competitors = [
      { isDirectory: false, referringDomains: null },
      { isDirectory: false, referringDomains: 20 },
    ];
    assert.equal(computeFloor(competitors), 20);
  });

  test('a single weak outlier no longer drags the result down the way a minimum would', () => {
    const competitors = [
      { isDirectory: false, referringDomains: 27 },
      { isDirectory: false, referringDomains: 110 },
      { isDirectory: false, referringDomains: 404 },
      { isDirectory: false, referringDomains: 7 },
      { isDirectory: false, referringDomains: 471 },
    ];
    assert.equal(computeFloor(competitors), 110);
  });

  test('preserves a genuine 0 referring-domains value rather than treating it as missing', () => {
    const competitors = [
      { isDirectory: false, referringDomains: 0 },
      { isDirectory: false, referringDomains: 50 },
    ];
    assert.equal(computeFloor(competitors), 25);
  });
});

describe('computeVerdict', () => {
  test('returns Soft when there is no real-business floor', () => {
    assert.equal(computeVerdict(0.8, null), 'Soft');
  });

  test('returns Defended for a low directory ratio and a high floor', () => {
    assert.equal(computeVerdict(0.3, 42), 'Defended');
  });

  test('returns Soft for a high directory ratio', () => {
    assert.equal(computeVerdict(0.5, 100), 'Soft');
  });

  test('returns Soft for a low floor even with a moderate ratio', () => {
    assert.equal(computeVerdict(0.4, 10), 'Soft');
  });

  test('returns Moderate otherwise', () => {
    assert.equal(computeVerdict(0.4, 20), 'Moderate');
  });

  test('treats floor === 30 as high enough for Defended (boundary)', () => {
    assert.equal(computeVerdict(0.3, 30), 'Defended');
  });

  test('treats floor === 15 as not low enough for Soft (boundary)', () => {
    assert.equal(computeVerdict(0.4, 15), 'Moderate');
  });

  test('a low directory ratio with an insufficient floor is still Moderate, not Defended', () => {
    assert.equal(computeVerdict(0.2, 25), 'Moderate');
  });
});
