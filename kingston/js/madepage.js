// madepage.js — /made/: Made in Kingston, filterable by type and neighborhood.
import { initChrome, loadData, track, districtClass, districtName } from './kc.js';
import { normaliseMade, mergeMade, madeFamily } from './made.js';

initChrome();
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const box = $('#made-list');
const SHAPE = {
  fooddrink: '<circle cx="10" cy="10" r="7" fill="#D9A441" stroke="#22292F" stroke-width="1.4"/>',
  goods: '<rect x="3" y="3" width="14" height="14" rx="2" fill="#56656F" stroke="#22292F" stroke-width="1.4"/>',
  art: '<path d="M10 2.5 L18 16.5 L2 16.5Z" fill="#7A2B18" stroke="#22292F" stroke-width="1.4" stroke-linejoin="round"/>',
  mural: '<path d="M10 2.5 L18 16.5 L2 16.5Z" fill="#F7F2E6" stroke="#7A2B18" stroke-width="2.2" stroke-linejoin="round"/>',
  space: '<circle cx="10" cy="10" r="7" fill="#F7F2E6" stroke="#22292F" stroke-width="3"/>',
  market: '<rect x="3" y="3" width="14" height="14" rx="2" fill="#D9A441" stroke="#22292F" stroke-width="3"/>',
};
const TYPE_LABEL = { food: 'Food', drink: 'Drink', goods: 'Goods', art: 'Art', space: 'Maker space' };
// Groups are exclusive and checked in this order.
const GROUPS = [
  { id: 'outside', label: 'Just outside the line', sub: 'Kingston names, made a few miles out', test: (m) => m.outside },
  { id: 'at-the-market', label: 'At the Saturday market', sub: 'No shopfront: find them at the Kingston Farmers Market', test: (m) => m.market },
  { id: 'fooddrink', label: 'Food & Drink', test: (m) => m.type === 'food' || m.type === 'drink' },
  { id: 'goods', label: 'Goods', test: (m) => m.type === 'goods' },
  { id: 'murals', label: 'Murals', sub: 'Mostly O+ walls. Walls change: last seen on the 2024 O+ map', test: (m) => m.mural },
  { id: 'art', label: 'Art', sub: 'Galleries, studios and the people who fill them', test: (m) => m.type === 'art' },
  { id: 'space', label: 'Maker spaces', test: (m) => m.type === 'space' },
];
const ORDER = ['fooddrink', 'goods', 'art', 'murals', 'space', 'at-the-market', 'outside'];
const HOODS = [['all', 'Everywhere'], ['uptown', 'Uptown'], ['midtown', 'Midtown'], ['rondout', 'Rondout'], ['nearby', 'Nearby']];
const hoodOf = (n) => { const d = districtClass(n); return d ? d.slice(2) : 'nearby'; };

let raw = null, places = [];
try { const r = await fetch('../data/made.json', { cache: 'no-cache' }); if (r.ok) raw = await r.json(); } catch { /* handled below */ }
try { places = (await loadData()).places; } catch { /* pins just won't link */ }
const rows = normaliseMade(raw || []);
const { makers } = mergeMade(places, rows);
if (raw && raw.stub) $('#stubnote').hidden = false;
for (const m of makers) m.group = (GROUPS.find((g) => g.test(m)) || GROUPS[3]).id;

let typeF = 'all', hoodF = 'all';
function chips(el, list, get, set) {
  el.innerHTML = list.map(([id, label]) => `<button type="button" class="chip" data-id="${id}" aria-pressed="${get() === id}">${label}</button>`).join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    set(b.dataset.id); for (const c of el.children) c.setAttribute('aria-pressed', String(c.dataset.id === b.dataset.id));
    render(); track('kc_made_filter', { type: typeF, hood: hoodF });
  });
}
const byId = Object.fromEntries(GROUPS.map((g) => [g.id, g]));
chips($('#typechips'), [['all', 'All makers'], ...ORDER.map((id) => [id, byId[id].label])], () => typeF, (v) => { typeF = v; });
chips($('#hoodchips'), HOODS, () => hoodF, (v) => { hoodF = v; });

const dir = (w) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(w.address || `${w.lat},${w.lng}`)}`;
const ig = (h) => `https://instagram.com/${String(h).replace(/^@|.*instagram\.com\//, '').replace(/\/$/, '')}`;
const OPEN = { yes: 'Open to visitors.', no: 'Not open to the public.', 'by appointment': 'Visits by appointment.' };
function card(m) {
  const fam = m.market ? 'market' : madeFamily(m.type, m);
  const buy = (m.where_to_buy || []).filter((w) => w.kind !== 'online' || w.url);
  const checking = m.verified_2026 === false;
  const onMap = m.pin_id && (m.onMap || m.market);
  const note = m.mural ? `Painted ${m.year || '—'} · walls change: last seen on the 2024 O+ map.` : (OPEN[m.open_label] || '');
  return `<article class="mcard${checking ? ' unverified' : ''}" id="${esc(m.id)}">
    <div class="k"><svg class="mshape" viewBox="0 0 20 20" aria-hidden="true">${SHAPE[fam]}</svg>${m.mural ? 'Mural' : esc(TYPE_LABEL[m.type] || m.type)}${m.subtype && !m.mural ? ' · ' + esc(m.subtype) : ''}${m.neighborhood && districtClass(m.neighborhood) ? `<span class="dist ${districtClass(m.neighborhood)}">${esc(districtName(m.neighborhood))}</span>` : ''}${checking ? '<span class="checking">listing being checked</span>' : ''}</div>
    <h3>${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.name)}</a>` : esc(m.name)}</h3>
    ${m.blurb ? `<p>${esc(m.blurb)}</p>` : ''}
    ${m.what_they_make && !m.mural ? `<p><b>What they make:</b> ${esc(m.what_they_make)}</p>` : m.mural && m.what_they_make ? `<p class="muted">${esc(m.what_they_make)}</p>` : ''}
    ${m.made_where && !m.mural ? `<p class="muted">Made: ${esc(m.made_where)}</p>` : ''}
    ${buy.length && !m.mural ? `<p><b>Where to buy:</b></p><ul class="buy">${buy.slice(0, 6).map((w) => `<li>${w.url ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.name)}</a>` : w.address || w.lat != null ? `<a href="${dir(w)}" target="_blank" rel="noopener">${esc(w.name)}</a>` : esc(w.name)}${w.kind ? ` <span class="muted">· ${esc(String(w.kind).replace('_', ' '))}</span>` : ''}</li>`).join('')}</ul>` : ''}
    ${note ? `<p class="fine">${note}${m.approx ? ' Approximate pin.' : ''}</p>` : ''}
    <div class="links">${onMap ? `<a href="../?pin=${encodeURIComponent(m.pin_id)}&amp;layer=made">${m.market ? 'The market on the map →' : 'On the map →'}</a>` : ''}${m.instagram ? `<a href="${esc(ig(m.instagram))}" target="_blank" rel="noopener">Instagram</a>` : ''}${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">Website</a>` : ''}</div>
  </article>`;
}
function render() {
  if (!rows.length) { box.innerHTML = '<p class="listempty" style="padding:30px 0">The maker list is still being compiled. Know someone who makes things in Kingston? Tell us.</p>'; return; }
  let html = '', n = 0;
  for (const id of ORDER) {
    const g = byId[id];
    if (typeF !== 'all' && typeF !== id) continue;
    const list = makers.filter((m) => m.group === id && (hoodF === 'all' || hoodOf(m.neighborhood) === hoodF))
      .sort((a, b) => (b.verified_2026 !== false) - (a.verified_2026 !== false) || a.name.localeCompare(b.name));
    if (!list.length) continue;
    n += list.length;
    html += `<section class="made-sec" id="${id}" aria-labelledby="ms-${id}"><h2 id="ms-${id}">${g.label} <small>${list.length}</small></h2>${g.sub ? `<p class="muted" style="margin:4px 0 0">${g.sub}</p>` : ''}<div class="made-grid">${list.map(card).join('')}</div></section>`;
  }
  box.innerHTML = html || '<p class="listempty" style="padding:30px 0">Nothing fits both of those. Try another neighborhood.</p>';
}
render();
if (location.hash) requestAnimationFrame(() => document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView());
