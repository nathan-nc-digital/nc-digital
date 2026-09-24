// Counts website form enquiries from a WordPress form-plugin export (WPForms, Gravity Forms,
// Contact Form 7/Flamingo, Fluent Forms, Ninja Forms…) by date. Runs in the browser: only the
// counts leave the page, never names, emails or messages.

// RFC 4180-style CSV: quoted fields, doubled quotes, newlines inside quotes; comma, semicolon or tab.
export function parseCsv(text) {
  const source = String(text || '').replace(/^﻿/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  const delimiter = [',', ';', '\t'].map(d => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v.trim() !== '')) rows.push(row);
  return rows;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = n => String(n).padStart(2, '0');
const valid = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };

// Returns YYYY-MM-DD. Numeric dates are read UK-style (day first) unless the year leads.
export function parseEntryDate(value) {
  const v = String(value || '').trim();
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) { const [y, mo, d] = [+m[1], +m[2], +m[3]]; return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null; }
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) { let [d, mo, y] = [+m[1], +m[2], +m[3]]; if (y < 100) y += 2000; return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null; }
  m = v.match(/^(?:[a-z]+,?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,})\.?,?\s+(\d{4})/i) || null;
  if (m) { const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; return mo && valid(+m[3], mo, +m[1]) ? `${m[3]}-${pad(mo)}-${pad(+m[1])}` : null; }
  m = v.match(/^(?:[a-z]+,?\s+)?([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (m) { const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; return mo && valid(+m[3], mo, +m[2]) ? `${m[3]}-${pad(mo)}-${pad(+m[2])}` : null; }
  return null;
}

// The date column: a header that names a date, preferring submission/creation dates, confirmed by values.
export function findDateColumn(rows) {
  const [header = [], ...body] = rows, sample = body.slice(0, 50);
  const parses = i => sample.filter(r => parseEntryDate(r[i])).length;
  const scored = header.map((h, i) => {
    const name = String(h).toLowerCase();
    const named = /submi|created|entry date|date created|received|^date$|date|time/.test(name) ? (/submi|created|received|entry/.test(name) ? 3 : 2) : 0;
    const ratio = sample.length ? parses(i) / sample.length : 0;
    return { i, name: String(h).trim(), score: ratio >= 0.8 ? named + ratio : 0 };
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

export function countEnquiries(text, periods) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('The file has no entries. Export the form entries as a CSV file and try again.');
  const column = findDateColumn(rows);
  if (!column) throw new Error('No date column was found. Make sure the export includes the date each entry was submitted.');
  const inRange = (d, p) => d >= p.startDate && d <= p.endDate;
  let current = 0, previous = 0, unreadable = 0;
  for (const row of rows.slice(1)) {
    const d = parseEntryDate(row[column.i]);
    if (!d) { unreadable++; continue; }
    if (inRange(d, periods.current)) current++;
    else if (inRange(d, periods.previous)) previous++;
  }
  return { current, previous, entries: rows.length - 1, unreadable, column: column.name };
}
