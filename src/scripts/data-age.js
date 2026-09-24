// "How old is this data?" labels for admin pages. The age is worked out in the browser, so a page
// built weeks ago still shows the true age today. Elements with data-age-at are filled in on load.
const DAY = 86400000;

export function ageLabel(at, { staleDays = 7, oldDays = 30, now = Date.now() } = {}) {
  const time = Date.parse(at);
  if (!at || Number.isNaN(time)) return null;
  const days = Math.max(0, Math.floor((now - time) / DAY)), hours = Math.floor((now - time) / 3600000);
  const when = new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const ago = days === 0 ? (hours < 1 ? 'just now' : hours === 1 ? '1 hour ago' : `${hours} hours ago`) : days === 1 ? 'yesterday' : `${days} days ago`;
  return { days, text: `${when} · ${ago}`, tone: days >= oldDays ? 'old' : days >= staleDays ? 'stale' : 'fresh' };
}

export function fillAgeLabels(root = document) {
  for (const el of root.querySelectorAll('[data-age-at]')) {
    const label = ageLabel(el.dataset.ageAt, { staleDays: Number(el.dataset.staleDays) || 7, oldDays: Number(el.dataset.oldDays) || 30 });
    const text = el.querySelector('[data-age-text]') || el;
    if (!label) { text.textContent = 'Data date unknown'; el.dataset.tone = 'old'; continue; }
    text.textContent = label.text;
    el.dataset.tone = label.tone;
  }
}
