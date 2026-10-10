// week.js — /week/: everything on in the next 7 days, filterable by day and category.
import { initChrome, loadData, timeAgo, pinAlert, isHappy, isOplus, foldOplus, nyParts, dayStart, formatClock, track, alsoVia, fixTitle, eventLine } from './kc.js';
import { occurrences, hasTag, cleanBlurb, parseWall } from './shared.js';

initChrome();
const qs = new URLSearchParams(location.search);
const NOW = qs.get('now') ? new Date(qs.get('now')) : new Date();
const DAY = 86400000;
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CATS = [['all', 'Everything'], ['music', 'Music'], ['nightlife', 'Nightlife'], ['food', 'Food'], ['art', 'Art'], ['market', 'Markets'], ['family', 'Family'], ['outdoors', 'Outdoors'], ['community', 'Community']];
const CAT_LABEL = Object.fromEntries(CATS);

const box = $('#days');
let data;
try { data = await loadData(); } catch { box.innerHTML = '<p class="listempty">One of our event sources isn\'t answering right now. Try again in a few minutes.</p>'; throw new Error('data'); }
for (const n of document.querySelectorAll('[data-updated]')) n.textContent = timeAgo(data.meta?.generated_at, NOW);

const nowWall = nyParts(NOW).wall;
const today = dayStart(nowWall);
const days = Array.from({ length: 7 }, (_, i) => today + i * DAY);
const dayName = (d, i) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(d).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }));
const dateStr = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// Bucket every event into days; happy hours, O+ and long runs get their own homes.
let nearby = false;   // the City of Kingston by default; "+ nearby towns" adds the rest
const isCore = (e) => !e.ring || e.ring === 'core';
let perDay, happy, oplus, ongoing, nearbyCount = 0;
function bucket() {
perDay = days.map(() => []);
happy = new Map();
oplus = [];
ongoing = new Map();
nearbyCount = 0;
const seenRun = new Map();   // title|venue → first card, for things that repeat on several days
for (const e of data.events) {
  if (hasTag(e, 'sold-out')) continue;
  if (!isCore(e)) { if (occurrences(e, nowWall, today + 7 * DAY).length && !isHappy(e)) nearbyCount++; if (!nearby) continue; }
  const occs = occurrences(e, nowWall, today + 7 * DAY);
  if (!occs.length) continue;
  if (isHappy(e)) {
    if (occs.every((o) => o.allDay)) continue;              // no time listed: not useful
    const k = e.venue || e.title;                           // one row per venue
    const h = happy.get(k) || { e, days: new Set(), occ: occs.find((o) => !o.allDay) };
    occs.forEach((o) => h.days.add(new Date(dayStart(o.start)).getUTCDay()));
    happy.set(k, h); continue;
  }
  if (isOplus(e)) { oplus.push({ e, occ: occs[0] }); continue; }
  const s = Date.parse(e.start), en = Date.parse(e.end);
  const startedBefore = (parseWall(e.start)?.wall ?? Infinity) < today;
  if (startedBefore && (hasTag(e, 'ongoing') || occs[0].run || (en && en - s > 2 * DAY))) { ongoing.set(e.id, { e, occ: occs[0] }); continue; }
  // A multi-day event that starts this week (e.g. the Burning of Kingston): a card on each of its days.
  if (occs.length === 1 && occs[0].allDay && occs[0].end - occs[0].start > DAY) {
    const o = occs[0];
    const i0 = Math.max(0, Math.floor((dayStart(o.start) - today) / DAY)), i1 = Math.min(6, Math.floor((dayStart(o.end) - today) / DAY));
    for (let i = i0; i <= i1; i++) perDay[i].push({ e, occ: { ...o, start: Math.max(o.start, today + i * DAY) }, span: [Math.floor((dayStart(o.start) - today) / DAY), Math.floor((dayStart(o.end) - today) / DAY)] });
    continue;
  }
  const live = occs.filter((o) => o.end > nowWall);
  if (!live.length) continue;
  // Several days in the week (a daily run, or the same title+venue listed per day): one card.
  const key = `${fixTitle(e.title).toLowerCase()}|${(e.venue || '').toLowerCase()}`;
  const dayIdx = [...new Set(live.map((o) => Math.floor((dayStart(o.start) - today) / DAY)))].filter((i) => i >= 0 && i < 7);
  if (!dayIdx.length) continue;
  const prev = seenRun.get(key);
  if (prev) { prev.lastDay = Math.max(prev.lastDay, ...dayIdx); continue; }
  const row = { e, occ: live[0], firstDay: dayIdx[0], lastDay: dayIdx.at(-1) };
  seenRun.set(key, row);
  perDay[dayIdx[0]].push(row);
}
}
bucket();
perDay.forEach((l) => l.sort((a, b) => (a.occ.allDay - b.occ.allDay) || a.occ.start - b.occ.start || a.e.title.localeCompare(b.e.title)));
const op = foldOplus(oplus.map((r) => ({ ...r, occ: { ...r.occ } })));
const feature = op.find((r) => r.e.festival) || null;

let dayF = 'all', catF = 'all';
function chips(el, list, get, set) {
  el.innerHTML = list.map(([id, label]) => `<button type="button" class="chip" data-id="${id}" aria-pressed="${get() === id}">${label}</button>`).join('');
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('.chip'); if (!b) return;
    set(b.dataset.id);
    for (const c of el.children) c.setAttribute('aria-pressed', String(c.dataset.id === b.dataset.id));
    render(); track('kc_week_filter', { day: dayF, category: catF });
  });
}
chips($('#daychips'), [['all', 'All week'], ...days.map((d, i) => [String(i), i < 2 ? dayName(d, i) : `${dayName(d, i).slice(0, 3)} ${new Date(d).getUTCDate()}`])], () => dayF, (v) => { dayF = v; });
chips($('#catchips'), CATS, () => catF, (v) => { catF = v; });

const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const clock = (o, r) => {
  const t = o.allDay ? 'All day' : o.start <= nowWall && o.end > nowWall ? `On now · till ${formatClock(o.end)}` : formatClock(o.start);
  if (r && r.lastDay != null && r.lastDay > r.firstDay) return `${t} · daily through ${DN[new Date(days[r.lastDay]).getUTCDay()]}`;
  if (r && r.span) return `All day · ${DN[new Date(today + r.span[0] * DAY).getUTCDay()]}–${DN[new Date(today + r.span[1] * DAY).getUTCDay()]}`;
  return t;
};
const credit = (e) => {
  const c = esc(e.credit || (e.source_name ? 'via ' + e.source_name : ''));
  const av = alsoVia(e); const via = av.length ? `, also via ${esc(av.join(', '))}` : '';
  return e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${c}</a>${via}` : c + via;
};
function card(r, { feature: feat = false } = {}) {
  const e = r.e;
  const art = document.createElement('article');
  art.className = 'ecard' + (feat ? ' feature' : '');
  const when = feat ? `On now · through ${new Date(e.lastDay).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' })}` : clock(r.occ, r);
  let blurb = feat ? e.blurb : eventLine(e) || cleanBlurb(e.blurb);
  if (!feat && r.occ.start > nowWall) blurb = blurb.replace(/\bRuns through [^.]*\.\s*/i, '');
  const parts = feat ? `<ul>${r.parts.slice(0, 8).map((p) => `<li>${esc(fixTitle(p.title))}${p.venue ? ` · ${esc(p.venue)}` : ''}</li>`).join('')}</ul>` : '';
  art.innerHTML = `
    <div class="top"><span class="when">${esc(when)}</span><span class="cat">${feat ? 'Festival' : esc(CAT_LABEL[e.category] || e.category || '')}</span></div>
    <h3>${e.url && !feat ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(fixTitle(e.title))}</a>` : esc(fixTitle(e.title))}</h3>
    ${e.venue && e.venue !== e.title ? `<div class="venue">${esc(e.venue)}${hasTag(e, 'approx-location') ? ' <span class="approx">Approximate pin</span>' : ''}</div>` : ''}
    ${blurb ? `<p class="blurb">${esc(blurb)}</p>` : ''}${parts}
    <div class="foot-row"><span class="credit">${credit(e)}</span>${e.lat != null && !feat ? `<a class="credit" href="../?pin=${encodeURIComponent(e.id)}">On the map →</a>` : ''}</div>`;
  art.append(pinAlert(feat ? { ...e, start: new Date(r.occ.start).toISOString().slice(0, 16), end: new Date(e.lastDay).toISOString(), all_day: true } : e, { source: 'week', now: NOW, compact: true }));
  return art;
}

function render() {
  box.replaceChildren();
  const catOk = (e) => catF === 'all' || e.category === catF;
  let shown = 0;
  if (feature && (catF === 'all' || ['music', 'art', 'community'].includes(catF)) && (dayF === 'all' || ['0', '1'].includes(dayF))) {
    const g = document.createElement('div'); g.className = 'ecards'; g.append(card(feature, { feature: true })); box.append(g); shown++;
  }
  if (catF === 'all' || catF === 'food' || catF === 'nightlife') {
    const hh = [...happy.values()].filter((h) => dayF === 'all' || h.days.has(new Date(days[+dayF]).getUTCDay()));
    if (hh.length) {
      const d = document.createElement('details'); d.className = 'hh'; d.id = 'happy-hours';
      d.innerHTML = `<summary>Happy hours this week (${hh.length} ${hh.length === 1 ? 'bar' : 'bars'})</summary><ul>${hh.sort((a, b) => (a.e.venue || '').localeCompare(b.e.venue || '')).map((h) => {
        const ds = [...h.days].sort().map((x) => DN[x]).join(', ');
        const t = ` · ${formatClock(h.occ.start)}–${formatClock(h.occ.end)}`;
        const cr = h.e.credit ? (h.e.url ? `<a href="${esc(h.e.url)}" target="_blank" rel="noopener">${esc(h.e.credit)}</a>` : esc(h.e.credit)) : '';
        return `<li>${esc(h.e.venue || h.e.title)}<span>${esc(ds)}${t}${cr ? ' · ' + cr : ''}</span></li>`;
      }).join('')}</ul>`;
      const g = document.createElement('div'); g.className = 'ecards'; g.style.marginTop = '14px'; g.append(d); box.append(g);
      if (location.hash === '#happy-hours') d.open = true;
    }
  }
  days.forEach((d, i) => {
    if (dayF !== 'all' && +dayF !== i) return;
    const rows = perDay[i].filter((r) => catOk(r.e));
    if (!rows.length) return;
    const sec = document.createElement('section'); sec.className = 'day';
    sec.innerHTML = `<h2>${dayName(d, i)} <small>${dateStr(d)} · ${rows.length} listed</small></h2>`;
    const g = document.createElement('div'); g.className = 'ecards';
    rows.forEach((r) => g.append(card(r)));
    sec.append(g); box.append(sec); shown += rows.length;
  });
  const og = [...ongoing.values()].filter((r) => catOk(r.e));
  if (og.length) {
    const sec = document.createElement('section'); sec.className = 'day';
    sec.innerHTML = `<h2>Running all week <small>exhibitions, cruises and runs · ${og.length}</small></h2>`;
    const g = document.createElement('div'); g.className = 'ecards';
    og.forEach((r) => g.append(card({ ...r, occ: { ...r.occ, allDay: true } })));
    sec.append(g); box.append(sec); shown += og.length;
  }
  if (!shown) box.innerHTML = '<p class="listempty" style="padding:30px 0">Nothing fits all of that. Drop a chip or two and try again.</p>';
  if (nearbyCount) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost nearby-toggle'; b.setAttribute('aria-pressed', String(nearby));
    b.textContent = nearby ? '− Show the City of Kingston only' : `+ Nearby towns (${nearbyCount} more listings)`;
    b.onclick = () => { nearby = !nearby; bucket(); render(); track('kc_week_nearby', { on: nearby }); };
    box.append(b);
  }
}
render();
if (location.hash === '#happy-hours') document.getElementById('happy-hours')?.scrollIntoView();
