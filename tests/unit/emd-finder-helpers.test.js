import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDomain,
  buildPhrase,
  buildCombos,
  interpretRdapStatus,
} from '../../scripts/lib/emd-finder-helpers.mjs';

describe('buildDomain', () => {
  test('strips hyphens from the town and joins with the trade', () => {
    assert.equal(buildDomain('plumber', 'merthyr-tydfil'), 'merthyrtydfilplumber.co.uk');
  });

  test('strips spaces from multi-word trades', () => {
    assert.equal(buildDomain('carpet cleaner', 'port-talbot'), 'porttalbotcarpetcleaner.co.uk');
  });

  test('lowercases everything', () => {
    assert.equal(buildDomain('Plumber', 'Merthyr-Tydfil'), 'merthyrtydfilplumber.co.uk');
  });
});

describe('buildPhrase', () => {
  test('joins trade and town with town hyphens turned to spaces', () => {
    assert.equal(buildPhrase('plumber', 'merthyr-tydfil'), 'plumber merthyr tydfil');
  });

  test('leaves multi-word trades as-is', () => {
    assert.equal(buildPhrase('carpet cleaner', 'port-talbot'), 'carpet cleaner port talbot');
  });
});

describe('buildCombos', () => {
  test('builds one combo per trade/town pair with domain and phrase', () => {
    const combos = buildCombos(['plumber', 'roofer'], ['cardiff', 'newport']);
    assert.equal(combos.length, 4);
    assert.deepEqual(combos[0], {
      trade: 'plumber',
      town: 'cardiff',
      domain: 'cardiffplumber.co.uk',
      phrase: 'plumber cardiff',
    });
  });

  test('returns an empty array for empty inputs', () => {
    assert.deepEqual(buildCombos([], []), []);
    assert.deepEqual(buildCombos(['plumber'], []), []);
  });
});

describe('interpretRdapStatus', () => {
  test('404 means the domain is available', () => {
    assert.equal(interpretRdapStatus(404), true);
  });

  test('200 means the domain is registered/taken', () => {
    assert.equal(interpretRdapStatus(200), false);
  });

  test('any other status is unknown', () => {
    assert.equal(interpretRdapStatus(500), null);
    assert.equal(interpretRdapStatus(403), null);
    assert.equal(interpretRdapStatus(429), null);
  });
});
