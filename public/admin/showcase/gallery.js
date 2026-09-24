const names = ['desktop', 'laptop', 'mobile', 'responsive'];
let labels = ['Desktop showcase', 'Laptop scene', 'Mobile close-up', 'Desktop + mobile'];
const slug = document.body.dataset.showcase || 'priva-cy';
let brandedView = true;
const platforms = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X', googlebusiness: 'Google Business Profile' };
let manifest;
function showImages(branded) {
  brandedView = branded;
  document.querySelectorAll('[data-version]').forEach(button => button.setAttribute('aria-pressed', String((button.dataset.version === 'branded') === branded)));
  document.getElementById('version-description').textContent = branded ? 'NC Digital branded images for social media.' : 'Clean originals for your portfolio.';
  document.getElementById('download-set').href = branded ? `${slug}-social-branded.zip` : `${slug}-mockups.zip`;
  document.getElementById('download-set').textContent = branded ? 'Download branded set (ZIP)' : 'Download portfolio set (ZIP)';
  document.getElementById('gallery').replaceChildren(...names.map((name, i) => {
    const file = `${name}${branded ? '-branded' : ''}.png`;
    const article = document.createElement('article');
    const open = document.createElement('a'); open.href = file; open.target = '_blank'; open.rel = 'noopener';
    const img = document.createElement('img'); img.src = file; img.alt = `${labels[i]}${branded ? ' with NC Digital logo' : ', unbranded'}`; img.width = 1122; img.height = 1402;
    open.append(img);
    const row = document.createElement('div'); row.className = 'card-footer';
    const title = document.createElement('h2'); title.textContent = labels[i];
    const save = document.createElement('a'); save.href = file; save.download = `${slug}-${file}`; save.textContent = 'Save PNG ↓';
    row.append(title, save); article.append(open, row); return article;
  }));
}
function showCaption() {
  const service = document.getElementById('platform').value;
  const text = manifest.overrides[service];
  document.getElementById('caption-preview').value = service === 'googlebusiness' ? text : `${text}\n\n${manifest.link}`;
  document.getElementById('caption-note').textContent = service === 'googlebusiness' ? `Learn more button: ${manifest.link}` : service === 'instagram' ? 'Website URLs appear as plain text on Instagram. You can edit the caption in Social Posts.' : 'You can edit this caption in Social Posts before publishing.';
}
document.querySelectorAll('[data-version]').forEach(button => button.addEventListener('click', () => showImages(button.dataset.version === 'branded')));
document.getElementById('platform').addEventListener('change', showCaption);
document.getElementById('copy-caption').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(document.getElementById('caption-preview').value); document.getElementById('copy-status').textContent = 'Caption copied.'; }
  catch { document.getElementById('caption-preview').select(); document.getElementById('copy-status').textContent = 'Select and copy the caption above.'; }
});
showImages(true);
fetch('social-draft.json').then(response => { if (!response.ok) throw Error('Captions unavailable'); return response.json(); }).then(data => {
  manifest = data;
  if (Array.isArray(data.galleryLabels) && data.galleryLabels.length === 4 && data.galleryLabels.every(label => typeof label === 'string')) { labels = data.galleryLabels; showImages(brandedView); }
  for (const [value, label] of Object.entries(platforms)) { const option = new Option(label, value); document.getElementById('platform').add(option); }
  showCaption(); document.getElementById('caption-controls').disabled = false;
}).catch(() => { document.getElementById('caption-note').textContent = 'Could not load captions. Refresh to try again.'; });
