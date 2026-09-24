import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseEntryDate, findDateColumn, countEnquiries } from '../../src/lib/enquiry-import.js';

const periods = { current: { startDate: '2026-08-01', endDate: '2026-08-31' }, previous: { startDate: '2026-07-01', endDate: '2026-07-31' } };

test('CSV parsing handles quotes, commas and line breaks inside messages, BOMs and other separators', () => {
  const rows = parseCsv('﻿Name,Message,Date\r\n"Smith, J","Hi,\nI need a quote ""asap""",2026-08-02\r\n\r\nJones,Hello,2026-08-03\n');
  assert.deepEqual(rows, [['Name', 'Message', 'Date'], ['Smith, J', 'Hi,\nI need a quote "asap"', '2026-08-02'], ['Jones', 'Hello', '2026-08-03']]);
  assert.deepEqual(parseCsv('Name;Date\nA;01/08/2026'), [['Name', 'Date'], ['A', '01/08/2026']]);
  assert.deepEqual(parseCsv('Name\tDate\nA\t2026-08-01'), [['Name', 'Date'], ['A', '2026-08-01']]);
});

test('dates in the formats WordPress form plugins export are read correctly, UK style', () => {
  assert.equal(parseEntryDate('2026-08-12 14:33:00'), '2026-08-12');
  assert.equal(parseEntryDate('12/08/2026 14:33'), '2026-08-12', 'day first');
  assert.equal(parseEntryDate('03-08-26'), '2026-08-03');
  assert.equal(parseEntryDate('August 12, 2026 2:33 pm'), '2026-08-12');
  assert.equal(parseEntryDate('12th August 2026'), '2026-08-12');
  assert.equal(parseEntryDate('Wednesday, 12 Aug 2026'), '2026-08-12');
  assert.equal(parseEntryDate('31/02/2026'), null);
  assert.equal(parseEntryDate('hello'), null);
  assert.equal(parseEntryDate(''), null);
});

test('the submission date column is found even when other columns contain dates', () => {
  const rows = parseCsv('Name,Preferred date,Email,Date Created\nA,2027-01-01,a@x.com,2026-08-02\nB,2027-02-01,b@x.com,2026-07-20');
  assert.equal(findDateColumn(rows).name, 'Date Created');
  assert.equal(findDateColumn(parseCsv('Name,Email\nA,a@x.com')), null);
});

test('enquiries are counted in the report period and the previous period only', () => {
  const csv = 'Entry ID,Name,Email,Message,Submitted\n' + [
    '1,A,a@x.com,Hi,2026-08-01 09:00', '2,B,b@x.com,Hi,31/08/2026', '3,C,c@x.com,"Quote, please",2026-08-15',
    '4,D,d@x.com,Hi,2026-07-10', '5,E,e@x.com,Hi,2026-06-30', '6,F,f@x.com,Hi,2026-09-01', '7,G,g@x.com,Hi,not a date',
  ].join('\n');
  assert.deepEqual(countEnquiries(csv, periods), { current: 3, previous: 1, entries: 7, unreadable: 1, column: 'Submitted' });
  assert.throws(() => countEnquiries('Name\n', periods), /no entries/);
  assert.throws(() => countEnquiries('Name,Email\nA,a@x.com', periods), /No date column/);
});
