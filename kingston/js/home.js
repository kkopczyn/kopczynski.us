// home.js — the Map home: live ticker, Steinberg map, pin card, tonight/weekend list.
import { renderMap, KINGSTON_DECOR } from './map.js';
import geo from './kingston-geo.js';
import {
  initChrome, loadData, track, timeAgo, pinAlert, eventsIn, foldOplus, isHappy, isOplus,
  districtClass, districtName, alsoVia, fixTitle, eventLine, timeWindow, nextIn, nyParts, formatWhen, formatClock, dayStart,
} from './kc.js';
import { categoryOf, itemName, hasTag, cleanBlurb } from './shared.js';
import { normaliseMade, mergeMade, madeFamily } from './made.js';

initChrome();
const qs = new URLSearchParams(location.search);
const NOW = qs.get('now') ? new Date(qs.get('now')) : new Date();
const PINS = JSON.parse(document.getElementById('pin-lines')?.textContent || '{}');
const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mq = matchMedia('(max-width: 860px)');
const CAT_LABEL = { eat: 'Eat', drink: 'Drink', see: 'See', outdoors: 'Outdoors', music: 'Music', shop: 'Shop', market: 'Market' };

let data;
try { data = await loadData(); } catch (e) {
  $('#ticker-text').textContent = "One of our event sources isn't answering right now. Places are fine; some events may be missing.";
  data = { places: [], events: [], meta: null };
}
const { events, meta } = data;
// Made in Kingston: merge makers into places (one pin when a maker is already on the map).
let madeRows = [];
try { const r = await fetch('data/made.json', { cache: 'no-cache' }); if (r.ok) madeRows = normaliseMade(await r.json()); } catch { /* layer just stays empty */ }
const { places } = mergeMade(data.places, madeRows);
const byId = new Map([...places, ...events].map((x) => [x.id, x]));
const nowWall = nyParts(NOW).wall;

// ------------------------------------------------------------ freshness + ticker
for (const n of document.querySelectorAll('[data-updated]')) n.textContent = timeAgo(meta?.generated_at, NOW);

const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortClock = (w) => formatClock(w).replace(/:00/, '');
function range(occ) {
  const a = shortClock(occ.start), b = shortClock(occ.end);
  const am = (s) => s.slice(-2);
  return am(a) === am(b) ? `${a.slice(0, -2)}–${b}` : `${a}–${b}`;
}
function dayWord(w) {
  const d = Math.round((dayStart(w) - dayStart(nowWall)) / 86400000);
  return d === 0 ? 'today' : d === 1 ? 'tomorrow' : DOW3[new Date(dayStart(w)).getUTCDay()];
}
function ticker() {
  const items = [];
  const soon = { from: nowWall, to: dayStart(nowWall) + 3 * 86400000 };
  const op = events.filter((e) => isOplus(e) && nextIn(e, soon));
  if (op.length) {
    const last = Math.max(...op.map((e) => Date.parse(e.end || e.start)));
    const endDow = new Date(last).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
    const endsToday = dayStart(nyParts(new Date(last)).wall) === dayStart(nowWall);
    items.push(`<b>O+ Festival</b> is on ${endsToday ? 'until tonight' : `through ${endDow}`}`);
  } else {
    const fest = eventsIn(events.filter((e) => hasTag(e, 'festival') && !isHappy(e)), soon)[0];
    if (fest) items.push(`<b>${esc(fest.e.title)}</b> ${fest.occ.start <= nowWall ? 'is on now' : dayWord(fest.occ.start)}`);
  }
  const n = lists.tonight.rows.length;   // the same city-only list as the Tonight panel
  if (n) items.push(`<b>${n}</b> on tonight in the city`);
  const mk = eventsIn(events.filter((e) => /farmers market/i.test(e.title)), { from: nowWall, to: nowWall + 8 * 86400000 })[0];
  if (mk) items.push(`Farmers Market ${mk.occ.start <= nowWall ? 'on now till ' + shortClock(mk.occ.end) : dayWord(mk.occ.start) + ' ' + range(mk.occ)}`);
  if (items.length < 2) {
    const next = eventsIn(events.filter((e) => !isHappy(e)), { from: nowWall, to: nowWall + 7 * 86400000 }).find((r) => r.occ.start > nowWall);
    if (next) items.push(`Next up: ${esc(next.e.title)} ${dayWord(next.occ.start)}`);
  }
  $('#ticker-text').innerHTML = items.slice(0, 3).join(' · ') || 'Quiet day in Kingston. The map is still full of good places.';
}

// ------------------------------------------------------------ map
const stage = $('#mapstage');
const svg = $('#map');
let map = null, mode = null, selected = null;

function decorFor(P, mobile) {
  const yMid = P.yHorizon + (P.yCity - P.yHorizon) * 0.55;
  const k = mobile ? 1.7 : 1;                          // phone pixels are scarcer: draw the horizon bigger
  const roofs = (lat, lng, n = 3) => Array.from({ length: n }, (_, i) => ({ href: '#s-house', lat, lng, mode: 'far', onHorizon: true, w: 11 * k, h: 10 * k, dx: (i - (n - 1) / 2) * 12 * k }));
  return {
    ...KINGSTON_DECOR,
    far: [
      { text: 'Albany (kept the capital)', lat: 42.65, lng: -73.76 },
      { text: mobile ? 'Manhattan (paved with our bluestone)' : 'Manhattan, paved with our bluestone', lat: 40.75, lng: -73.99 },
      { text: 'the Catskills (say hi to Catskill Crew)', lat: 42.10, lng: -74.30 },
    ],
    farTop: mobile ? 16 : 17,
    hills: [
      { from: [41.80, -74.30], to: [41.70, -74.10], peak: 22 * k },   // Shawangunks
      { from: [41.98, -74.42], to: [42.16, -74.02], peak: 62 * k },   // Catskills
    ],
    regionLabels: [
      { text: 'the rest of Ulster County', x: 30, y: mobile ? P.yCity - 14 : yMid },
      { text: 'Dutchess', x: P.width - 18, y: P.yCity + (mobile ? 120 : 40), anchor: 'end' },
    ],
    waterLabels: [
      mobile ? { text: 'HUDSON', lat: 41.9265, lng: -73.9575, rotate: -80 } : { text: 'HUDSON RIVER', lat: 41.932, lng: -73.952, rotate: -78 },
      { text: 'Rondout Creek', lat: 41.9135, lng: -74.004, rotate: -14 },
    ],
    symbols: [
      { href: '#s-light', lat: 41.9207, lng: -73.9622, w: 26 * (mobile ? 1.3 : 1), h: 35 * (mobile ? 1.3 : 1) },
      { href: '#s-sloop', lat: 41.9475, lng: -73.9515, w: 34 * (mobile ? 1.3 : 1), h: 34 * (mobile ? 1.3 : 1) },
      { href: '#s-church', lat: 41.9345, lng: -74.0205, w: 16, h: 38, dx: -26 },
      { href: '#s-shed', lat: 41.9384, lng: -73.9615, w: 40, h: 22, dx: -30 },
      ...roofs(41.9266, -73.913, 4), ...roofs(42.04, -74.118), ...roofs(42.077, -73.95), ...roofs(41.747, -74.087, 2),
    ],
  };
}

function projFor(w, h) {
  if (!mode || mode === 'desktop') return { width: 1000, height: 1000, yCity: 310 };
  // Phone: a portrait canvas. The city foreground is spread across most of it
  // (weaker perspective, wider scale); the horizon strip stays on top, thin.
  const H = Math.round(1000 * h / w);
  return {
    width: 1000, height: H,
    yHorizon: 235, horizonDepth: 40, yCity: 390, yFront: H - 60,
    x0: 470, kx: 185, persp: 9, xLeft: 90, xRight: 900,   // horizon towns kept clear of the edges and of the zoom buttons
  };
}

const FILTERS = [
  { id: 'all', label: 'Everything' }, { id: 'tonight', label: 'Tonight' }, { id: 'weekend', label: 'This weekend' },
  { id: 'eat', label: 'Eat' }, { id: 'drink', label: 'Drink' }, { id: 'music', label: 'Music' }, { id: 'see', label: 'See' },
  { id: 'outdoors', label: 'Outdoors' }, { id: 'shop', label: 'Shop' }, { id: 'markets', label: 'Markets' },
  { id: 'made', label: 'Made here', cls: 'chip-made' },
];
let filter = 'all';
const DAY = 86400000;
const upcoming = (e, days) => !!nextIn(e, { from: nowWall, to: nowWall + days * DAY });
const okEvent = (e) => !isHappy(e) && !hasTag(e, 'sold-out') && e.lat != null;
// Every layer is a function so maker-only pins stay in the "Made here" layer.
const FILTER_FNS = {
  all: (it, k) => (k === 'place' ? !it.makerOnly : okEvent(it) && upcoming(it, 7)),
  tonight: (it, k) => k === 'event' && okEvent(it) && !!nextIn(it, timeWindow('tonight', NOW)),
  weekend: (it, k) => k === 'event' && okEvent(it) && !!nextIn(it, timeWindow('weekend', NOW)),
  markets: (it, k) => (k === 'place' ? it.category === 'market' : okEvent(it) && /market/i.test(it.title || '') && upcoming(it, 14)),
  made: (it, k) => k === 'place' && (!!it.made || !!it.marketMakers?.length),
};
for (const c of ['eat', 'drink', 'music', 'see', 'outdoors', 'shop']) {
  FILTER_FNS[c] = (it, k) => (k === 'place' ? !it.makerOnly && categoryOf(it) === c : okEvent(it) && categoryOf(it) === c && upcoming(it, 14));
}
const filterValue = (id) => FILTER_FNS[id] || FILTER_FNS.all;
const MADE_SHAPES = { fooddrink: 'circle', goods: 'square', art: 'triangle', mural: 'triangle', space: 'circle', market: 'square' };
const MADE_LABEL = { food: 'Food', drink: 'Drink', goods: 'Goods', art: 'Art', space: 'Maker space', mural: 'Mural' };
const GLYPH = { eat: 'E', drink: 'D', music: '\u266A', see: 'S', outdoors: 'O', shop: '$', market: 'M' };
const tonightWin = timeWindow('tonight', NOW);
const liveNow = (e) => { const o = nextIn(e, { from: nowWall, to: tonightWin.to }); return !!o && (o.start <= nowWall + 3600000 || !!nextIn(e, tonightWin)) && !o.allDay; };
function pinStyle(item, kind) {
  if (filter !== 'made') {
    if (kind === 'event') {
      const live = liveNow(item);
      return { glyph: live ? '\u2605' : (GLYPH[categoryOf(item)] || ''), cls: live ? 'is-live' : '', pulse: live };
    }
    const cat = item.category === 'market' ? 'market' : categoryOf(item);
    const d = districtClass(item.neighborhood);
    return { glyph: GLYPH[cat] || '', cls: cat === 'eat' || cat === 'drink' ? 'pc-food' : d ? 'pc-' + d.slice(2) : 'pc-far' };
  }
  if (!item.made && item.marketMakers?.length) return { shape: 'square', cls: 'pin-made pin-made-market', glyph: 'M' };
  if (!item.made) return null;
  const fam = madeFamily(item.made.type, item.made);
  return { shape: MADE_SHAPES[fam], cls: `pin-made pin-made-${fam}`, glyph: { fooddrink: item.made.type === 'drink' ? 'D' : 'F', goods: 'G', art: 'A', mural: '', space: 'K' }[fam] };
}
function pinLabel(item, kind) {
  if (item.marketMakers?.length && filter === 'made') return `${item.name}: ${item.marketMakers.length} Kingston makers sell here on Saturdays`;
  if (!item.made || (filter !== 'made' && !item.makerOnly)) return null;
  return `${item.name}, made in Kingston: ${MADE_LABEL[item.made.type] || 'maker'}${item.made.subtype ? ', ' + item.made.subtype : ''}${item.neighborhood ? ', ' + item.neighborhood : ''}`;
}

function build() {
  const m = mq.matches ? 'mobile' : 'desktop';
  if (map && m === mode) return;
  mode = m;
  map?.destroy();
  let w = stage.clientWidth, h;
  if (mode === 'mobile') {
    h = Math.round(Math.min(Math.max(innerHeight * 0.72, 460), 820, innerHeight - 64 - 16));
    stage.style.setProperty('--map-h', h + 'px');
    stage.style.setProperty('--hz', Math.round(235 * w / 1000) + 'px');
  }
  const P = projFor(w, h);
  map = renderMap(svg, {
    places, events, geo, now: NOW, filter: filterValue(filter), selected,
    projectionOptions: P, decor: decorFor({ yHorizon: 128, yCity: 330, height: 1000, ...P }, mode === 'mobile'),
    pinRadius: mode === 'mobile' ? 10.5 : 8.5, labelScale: mode === 'mobile' ? 1.3 : 1.05, clusterFactor: mode === 'mobile' ? 1.3 : 2.1,
    controlsInset: mode === 'mobile' ? { left: 10, bottom: 76 + 12 + 44 + 10 } : { right: 12, bottom: 12 },   // phone: bottom-left, above the List button, where the creek is and pins are few
    onSelect: (item, { kind }) => select(item, kind, 'map'), pinStyle, pinLabel,
  });
  window.__map = map;
}

// chips
const chipBox = $('#chips');
chipBox.innerHTML = FILTERS.map((f) => `<button type="button" class="chip ${f.cls || ''}" data-f="${f.id}" aria-pressed="${f.id === filter}">${f.label}</button>`).join('');
chipBox.addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  setFilter(filter === b.dataset.f && b.dataset.f !== 'all' ? 'all' : b.dataset.f);
});
function setFilter(id) {
  filter = id;
  for (const c of chipBox.children) c.setAttribute('aria-pressed', String(c.dataset.f === id));
  map.setFilter(filterValue(id));
  const lg = $('#legend'), lb = $('#legend-base');
  if (lg) lg.hidden = id !== 'made';
  if (lb) lb.hidden = id === 'made';
  track('kc_map_filter', { filter: id });
}
$('#live').addEventListener('click', () => {
  setFilter('tonight'); showTab('tonight');
  stage.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
});

// ------------------------------------------------------------ pin card
const card = $('#pincard');
const side = $('#side');
function setSheet(state) {
  side.dataset.state = state;
  $('#sheet-hint').textContent = state === 'open' ? 'Hide ↓' : state === 'card' ? 'List ↑' : 'Show list ↑';
  $('.sheet-handle').setAttribute('aria-expanded', String(state !== 'peek'));
}
$('.sheet-handle').addEventListener('click', () => setSheet(side.dataset.state === 'open' ? 'peek' : 'open'));

function marketBlock(list) {
  return `<div class="madebox"><p class="label">Made here, find them at the Kingston Farmers Market (Sat)</p>
    <ul class="buy">${list.map((m) => `<li><a href="made/#${encodeURIComponent(m.id)}">${esc(m.name)}</a> <span class="muted">· ${esc(m.subtype || MADE_LABEL[m.type] || '')}</span></li>`).join('')}</ul>
    <p class="fine">No shopfront of their own: the market is where you meet them. <a href="made/#at-the-market">All market makers →</a></p></div>`;
}
function madeBlock(m) {
  const buy = (m.where_to_buy || []).filter((w) => w.kind !== 'online' || w.url);
  return `<div class="madebox">
    <p class="label">${m.mural ? 'Mural' : 'Made in Kingston'} · ${esc(MADE_LABEL[m.type] || m.type)}${m.subtype ? ' · ' + esc(m.subtype) : ''}${m.verified_2026 === false ? ' <span class="checking">listing being checked</span>' : ''}</p>
    ${m.what_they_make ? `<p><b>What they make:</b> ${esc(m.what_they_make)}</p>` : ''}
    ${m.made_where ? `<p><b>Made:</b> ${esc(m.made_where)}</p>` : ''}
    ${buy.length ? `<p><b>Where to buy:</b></p><ul class="buy">${buy.slice(0, 5).map((w) => `<li>${w.url ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.name)}</a>` : w.lat != null ? `<a href="${directions(w)}" target="_blank" rel="noopener">${esc(w.name)}</a>` : esc(w.name)}${w.kind ? ` <span class="muted">· ${esc(w.kind.replace('_', ' '))}</span>` : ''}</li>`).join('')}</ul>` : ''}
    <p class="fine">${m.mural ? `Painted ${m.year || ''} · walls change: last seen on the 2024 O+ map.` : m.open_label === 'yes' ? 'Open to visitors.' : m.open_label === 'by appointment' ? 'Visits by appointment.' : 'Not open to the public; buy from the places above.'}${m.approx ? ' Approximate pin.' : ''}${m.instagram ? ` <a href="https://instagram.com/${esc(String(m.instagram).replace(/^@|.*instagram\.com\//, '').replace(/\/$/, ''))}" target="_blank" rel="noopener">Instagram</a>` : ''}</p>
  </div>`;
}
function directions(it) {
  const q = it.address || `${it.lat},${it.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
function select(item, kind, from) {
  selected = item.id;
  map.setSelected(item.id);
  const isEvent = kind === 'event';
  const cat = isEvent ? (item.category || categoryOf(item)) : item.category;
  const nb = item.neighborhood;
  const mk = item.made;
  const line = PINS[item.id] || (mk ? mk.blurb || mk.what_they_make : '') || (isEvent ? eventLine(item) || cleanBlurb(item.blurb) : item.blurb) || '';
  const occ = isEvent ? (item.festival ? null : nextIn(item, { from: nowWall - 3 * 3600000, to: nowWall + 60 * 86400000 })) : null;
  const credit = isEvent
    ? `Listing ${item.url ? `<a href="${esc(item.url)}" rel="noopener" target="_blank">${esc(item.credit || 'via ' + item.source_name)}</a>` : esc(item.credit || '')}${alsoVia(item).length ? `, also via ${esc(alsoVia(item).join(', '))}` : ''}`
    : `${item.source_name ? `First spotted via ${esc(item.source_name)}` : 'Researched for Kingston'}${mk && mk.source && !/^stub/.test(mk.source) ? ` · maker info via ${esc(String(mk.source).replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}` : ''}`;
  card.innerHTML = `${from === 'featured' ? '<p class="kicker" style="margin:0 0 8px">On right now</p>' : ''}
    <div class="meta"><span>${isEvent ? 'Event' : item.makerOnly ? 'Made in Kingston' : esc(CAT_LABEL[cat] || cat)}</span>${mk && !item.makerOnly ? '<span class="madetag">Made here</span>' : ''}${nb ? `<span class="dist ${districtClass(nb)}">${esc(districtName(nb))}</span>` : ''}${hasTag(item, 'approx-location') || item.geo_precision === 'approx' ? '<span class="approx">Approximate pin</span>' : ''}</div>
    <h2 tabindex="-1">${esc(fixTitle(itemName(item)))}</h2>
    ${isEvent && occ ? `<div class="when">${esc(formatWhen(occ, nowWall))}${item.venue ? ' · ' + esc(item.venue) : ''}</div>` : ''}
    ${item.festival ? `<div class="when">${esc(item.whenText)}</div>` : ''}
    ${line ? `<p class="line">${esc(line)}</p>` : ''}
    ${item.parts ? `<ul class="addr">${item.parts.filter((p) => !/^(\d+\w*\s+annual\s+)?O\+ Festival/i.test(p.title)).slice(0, 6).map((p) => `<li>${esc(fixTitle(p.title))}${p.venue ? ` <span class="muted">· ${esc(p.venue)}</span>` : ''}</li>`).join('')}</ul>` : ''}
    ${item.address && !item.festival ? `<p class="addr">${esc(item.address.replace(/, Kingston, NY \d{5}$/, ', Kingston'))}</p>` : ''}
    ${mk ? madeBlock(mk) : ''}${item.marketMakers?.length ? marketBlock(item.marketMakers) : ''}
    <div class="alert-slot"></div>
    <div class="acts">
      ${(item.url || mk?.url) && !isEvent ? `<a class="btn btn-ghost btn-sm" href="${esc(item.url || mk.url)}" target="_blank" rel="noopener">Website</a>` : ''}
      ${item.lat != null && !item.festival ? `<a class="btn btn-ghost btn-sm" href="${directions(item)}" target="_blank" rel="noopener">Directions</a>` : ''}
      <button type="button" class="btn btn-ghost btn-sm" data-share>Share</button>
    </div>
    <p class="credit" style="margin-top:12px">${credit}</p>`;
  if (isEvent) card.querySelector('.alert-slot').append(pinAlert(item, { source: 'home', now: NOW }));
  card.querySelector('[data-share]').onclick = async () => {
    const url = location.origin + location.pathname + '?pin=' + encodeURIComponent(item.id);
    try { if (navigator.share) await navigator.share({ title: itemName(item), text: line, url }); else { await navigator.clipboard.writeText(url); card.querySelector('[data-share]').textContent = 'Link copied'; } } catch { /* user canceled */ }
    track('kc_share', { pin_id: item.id });
  };
  if (from === 'featured') return;
  if (mq.matches) { setSheet('card'); side.scrollTop = 0; }
  if (from !== 'map') card.querySelector('h2').focus({ preventScroll: true });
  track('kc_pin_open', { pin_id: item.id, kind, from });
}

// ------------------------------------------------------------ tonight / weekend list
let tab = 'tonight';
const lists = {};
let nearby = false;   // lists default to the City of Kingston; "+ nearby towns" adds the rest
const isCore = (e) => !e.ring || e.ring === 'core';
function rowsFor(name) {
  const win = timeWindow(name, NOW);
  const all = eventsIn(events.filter((e) => nearby || isCore(e)), win);
  const hh = all.filter((r) => isHappy(r.e));
  const rows = foldOplus(all.filter((r) => !isHappy(r.e)));
  return { rows, hh: hh.length };
}
function whenShort(occ, name) {
  if (occ.start <= nowWall && occ.end > nowWall) return 'On now';
  const day = dayWord(occ.start);
  const t = occ.allDay ? 'all day' : shortClock(occ.start);
  return name === 'tonight' ? t : `${day[0].toUpperCase() + day.slice(1)} ${t}`;
}
function renderList() {
  const { rows, hh } = lists[tab];
  const ul = $('#evlist');
  if (!rows.length) {
    ul.innerHTML = `<li class="listempty">${tab === 'tonight' ? 'Quiet night in Kingston, or at least on our list. Look at the weekend, or browse the map for places that are always good.' : 'Nothing listed for the weekend yet. Check back Thursday.'}</li>`;
  } else {
    ul.innerHTML = rows.slice(0, 40).map((r, i) => {
      const e = r.e;
      const sub = e.festival ? `Citywide, ${e.parts.length} listings · ${e.credit}` : [e.venue, e.credit].filter(Boolean).join(' · ');
      return `<li><button type="button" class="ev" data-i="${i}"><span class="w">${esc(whenShort(r.occ, tab))}</span><span><span class="t">${esc(fixTitle(e.title))}</span><span class="v">${esc(sub)}</span></span></button></li>`;
    }).join('');
  }
  const extra = rowsForNearby(tab);
  $('#hh-note').innerHTML = (hh ? `<a class="more" href="week/#happy-hours">Happy hours ${tab === 'tonight' ? 'tonight' : 'this weekend'} →</a>` : '')
    + (extra ? `<button type="button" class="linkbtn more" id="nearby-toggle" aria-pressed="${nearby}">${nearby ? '− City of Kingston only' : `+ nearby towns (${extra})`}</button>` : '');
  $('#nearby-toggle')?.addEventListener('click', () => { nearby = !nearby; lists.tonight = rowsFor('tonight'); lists.weekend = rowsFor('weekend'); updateTabs(); renderList(); });
  const total = rows.length;
  $('#sheet-title').textContent = `${tab === 'tonight' ? 'Tonight' : 'This weekend'} · ${total}`;
}
function showTab(name) {
  tab = name;
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === name));
  renderList();
}
function rowsForNearby(name) {
  if (nearby) return 1;
  const win = timeWindow(name, NOW);
  return eventsIn(events.filter((e) => !isCore(e) && !isHappy(e)), win).length;
}
function updateTabs() {
  $('#tab-tonight').textContent = `Tonight (${lists.tonight.rows.length})`;
  $('#tab-weekend').textContent = `This weekend (${lists.weekend.rows.length})`;
}
lists.tonight = rowsFor('tonight');
lists.weekend = rowsFor('weekend');
updateTabs();
ticker();
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => showTab(t.dataset.tab));
$('#evlist').addEventListener('click', (e) => {
  const b = e.target.closest('.ev'); if (!b) return;
  const r = lists[tab].rows[+b.dataset.i];
  const item = itemForRow(r);
  if (item.festival) {
    const anchor = r.parts.find((p) => p.lat != null) || item.parts.find((p) => p.lat != null);
    if (anchor) map.focusItem(anchor.id);
  } else if (item.lat != null) {
    if (filter !== 'all' && filter !== tab) setFilter(tab);
    map.focusItem(item.id);
  }
  select(item, 'event', 'list');
});
function itemForRow(r) {
  if (!r.e.festival) return r.e;
  const last = new Date(r.e.lastDay).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
  return { ...r.e, whenText: `On now through ${last}`, neighborhood: 'Uptown/Stockade' };
}
showTab('tonight');

build();
mq.addEventListener('change', build);
const pin = qs.get('pin');
if (qs.get('layer') && FILTER_FNS[qs.get('layer')]) setFilter(qs.get('layer'));
if (pin && byId.has(pin)) {
  const it = byId.get(pin);
  if (it.makerOnly && filter !== 'made') setFilter('made');
  if (!map.focusItem(pin) && filter !== 'all') { setFilter('all'); map.focusItem(pin); }
  select(it, places.includes(it) ? 'place' : 'event', 'link');
}
setSheet(side.dataset.state || 'peek');
// Desktop: open on what's on right now instead of an empty prompt.
if (!pin && !mq.matches) {
  const fr = lists.tonight.rows.find((r) => r.e.festival) || lists.tonight.rows[0] || lists.weekend.rows[0];
  if (fr) select(itemForRow(fr), 'event', 'featured');
  else if (byId.has('four-corners')) select(byId.get('four-corners'), 'place', 'featured');
}
// Phone: a List toggle on the map itself.
const lt = $('#list-toggle');
if (lt) lt.addEventListener('click', () => { setSheet(side.dataset.state === 'open' ? 'peek' : 'open'); lt.setAttribute('aria-expanded', String(side.dataset.state === 'open')); });
