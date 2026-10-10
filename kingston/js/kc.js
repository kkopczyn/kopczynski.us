// kc.js — shared site behavior: analytics, signup forms, "text me when it's on",
// data loading, event grouping. Plain ES module, no dependencies beyond ./shared.js.
import { timeWindow, nextIn, occurrences, nyParts, formatWhen, formatClock, dayStart, hasTag, fixTitle } from './shared.js';
export { fixTitle };
/** Hand-written lines for the big recurring events (used by the map card, /week/ and Wick). [title regex, line] */
export const EVENT_LINES = [
  ['burning of kingston', "Kingston marks Oct 16, 1777, the day the British burned New York's first capital, with history and reenactments at sites across Uptown."],
  ['farmers market', 'The Saturday ritual on Wall St: growers, bakers and makers.'],
];
export const eventLine = (e) => (EVENT_LINES.find(([rx]) => new RegExp(rx, 'i').test(e.title || e.name || '')) || [])[1] || '';

export const ROOT = document.documentElement.dataset.root || '';
export const PAGE = document.documentElement.dataset.page || 'kingston';
const NOW_OPTS = { send_instantly: true, transport: 'sendBeacon' };

// ------------------------------------------------------------ analytics
function referrer() {
  try { return new URLSearchParams(location.search).get('r') || localStorage.getItem('kk_ref') || ''; } catch { return ''; }
}
export const FALLBACK_EMAIL = 'konrad.kopczynski@gmail.com';
/**
 * Capture something we must not lose (a sign-up, a vote, a reminder). Resolves true
 * only when PostHog has actually loaded and accepted the call; a blocked or missing
 * PostHog (ad blockers, privacy modes) resolves false so the UI can say so.
 */
export async function save(name, props = {}) {
  for (let i = 0; i < 30; i++) {          // give a slow PostHog up to ~3s to finish loading
    const ph = window.posthog;
    if (ph && ph.__loaded && typeof ph.capture === 'function') break;
    if (!ph) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const ph = window.posthog;
  if (!ph || !ph.__loaded || typeof ph.capture !== 'function') return false;
  try {
    const ref = referrer();
    const p = { page_name: 'kingston', source_page: PAGE, ...props };
    if (ref) p.referrer_code = ref;
    window.posthog.capture(name, p, NOW_OPTS);
    return true;
  } catch { return false; }
}
/** The honest failure state: nothing was saved, here's a human to write to. */
export function saveFailed(el) {
  el.innerHTML = `Couldn't save that (an ad blocker may be stopping it). Email <span class="mailto" style="user-select:all">${FALLBACK_EMAIL}</span> and we'll add you by hand.`;
}

/** Capture an event. Looks up window.posthog at call time; never throws, never blocks. */
export function track(name, props = {}) {
  try {
    const ref = referrer();
    const p = { page_name: 'kingston', source_page: PAGE, ...props };
    if (ref) p.referrer_code = ref;
    if (window.posthog && typeof window.posthog.capture === 'function') window.posthog.capture(name, p, NOW_OPTS);
  } catch { /* analytics must never break the page */ }
}

// ------------------------------------------------------------ storage (best effort)
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
export const knownPhone = () => (store.get('kc_sub') || {}).phone || '';

// ------------------------------------------------------------ validation
export function cleanPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.length === 10 && /[2-9]/.test(d[0]) ? d : null;
}
export const prettyPhone = (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
export const cleanEmail = (raw) => { const e = String(raw || '').trim(); return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e.toLowerCase() : null; };

export const CONSENT_TEXT = "Yes, text me Kingston Crew picks and alerts. By checking this box I agree to receive recurring automated marketing texts from Kingston Crew at the number provided. Consent isn't a condition of any purchase. Up to 2 msgs/week. Msg & data rates may apply. Reply STOP to cancel, HELP for help.";
const ALERT_TEXT = (t) => `Get one text the day of ${t}. Msg & data rates may apply. Reply STOP to cancel, HELP for help.`;

// ------------------------------------------------------------ signup forms
/**
 * <form data-signup data-source="home" [data-require="phone"]> with inputs
 * name=email, name=phone, name=consent, name=interest (checkboxes), optional hidden pin_id/product.
 * The container `.signup` gets .is-done and the matching .done block is filled.
 */
export function bindSignups(root = document) {
  for (const form of root.querySelectorAll('form[data-signup]')) {
    if (form.dataset.bound) continue;
    form.dataset.bound = '1';
    form.noValidate = true;
    form.addEventListener('submit', (ev) => { ev.preventDefault(); submitSignup(form); });
  }
}

async function submitSignup(form, extra = {}) {
  const box = form.closest('.signup') || form.parentElement;
  const err = form.querySelector('.err');
  const f = new FormData(form);
  const rawEmail = (f.get('email') || '').trim(), rawPhone = (f.get('phone') || '').trim();
  const email = rawEmail ? cleanEmail(rawEmail) : null;
  const phone = rawPhone ? cleanPhone(rawPhone) : null;
  const say = (m, field) => { if (err) err.textContent = m; if (field) form.querySelector(`[name=${field}]`)?.focus(); };
  if (rawEmail && !email) return say("That email doesn't look right. Check it and try again.", 'email');
  if (rawPhone && !phone) return say('That number needs 10 digits, like 845 555 0123.', 'phone');
  if (form.dataset.require === 'phone' && !phone) return say('Add your mobile number so we can text you first.', 'phone');
  if (!email && !phone) return say('Add an email (or a mobile number) and we\'ll take it from there.', 'email');
  if (phone && !f.get('consent')) return say('To get texts, tick the box above. Or clear the number and we\'ll just email you.', 'consent');
  if (err) err.textContent = '';
  const channel = email && phone ? 'both' : phone ? 'sms' : 'email';
  const interests = f.getAll('interest');
  const prev = store.get('kc_sub') || {};
  const already = (!email || prev.email === email) && (!phone || prev.phone === phone) && (prev.email || prev.phone);
  const props = { channel, source_page: form.dataset.source || PAGE, interests, ...extra };
  if (email) props.email = email;
  if (phone) { props.phone = phone; props.consent_text = CONSENT_TEXT; }
  for (const k of ['pin_id', 'product']) if (f.get(k)) props[k] = f.get(k);
  if (!already) {
    const btn = form.querySelector('button[type=submit]');
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Saving…'; }
    const ok = await save('kc_signup', props);
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; }
    if (!ok) { if (err) saveFailed(err); return null; }
  }
  store.set('kc_sub', { email: email || prev.email || '', phone: phone || prev.phone || '' });
  showDone(box, already ? 'already' : channel);
  return props;
}
export { submitSignup };

function showDone(box, kind) {
  const done = box.querySelector('.done');
  if (!done) return;
  const lines = {
    email: ["You're on the launch list.", "We'll write when the Weekend Five starts."],
    sms: ['Saved.', "The text line opens after carrier registration; we'll text you once to confirm then."],
    both: ["You're on the launch list.", "We'll write when the Weekend Five starts. The text line opens after carrier registration; we'll text you once to confirm then."],
    already: ["You're already on the launch list.", "We'll write when the Weekend Five starts."],
  }[kind];
  done.querySelector('h3').textContent = lines[0];
  done.querySelector('p').textContent = lines[1];
  box.classList.add('is-done');
  done.setAttribute('tabindex', '-1');
  done.focus({ preventScroll: true });
}

// ------------------------------------------------------------ "Text me when it's on"
export function eventDayLabel(ev, now = new Date()) {
  const occ = nextOcc(ev, now);
  if (!occ) return null;
  const nw = nyParts(now).wall;
  const days = Math.round((dayStart(occ.start) - dayStart(nw)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return new Date(occ.start).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export function nextOcc(ev, now = new Date()) {
  const w = nyParts(now).wall;
  const o = occurrences(ev, w, w + 60 * 86400000);
  return o.find((x) => x.end > w) || null;
}

export function pinAlert(ev, { source = PAGE, now = new Date(), compact = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'alert';
  const title = ev.title || ev.name;
  const day = eventDayLabel(ev, now);
  const render = (state) => {
    wrap.replaceChildren();
    if (!day) {
      const b = document.createElement('button'); b.className = 'btn btn-sm'; b.disabled = true; b.textContent = "This one's over"; wrap.append(b); return;
    }
    const occNow = nextOcc(ev, now);
    if (occNow && occNow.start <= nyParts(now).wall) { wrap.hidden = true; return; }   // already on: nothing to remind
    if (state === 'done') {
      const d = document.createElement('div'); d.className = 'alert-done'; d.setAttribute('role', 'status');
      d.textContent = '✓ Saved';
      const p = document.createElement('p');
      p.append(`Reminders start when the text line launches (after carrier registration). If it's live by ${day}, you'll get one text the morning of ${title}. `);
      const u = document.createElement('button'); u.className = 'linkbtn'; u.type = 'button'; u.textContent = 'Undo';
      u.onclick = () => { track('kc_pin_alert', { action: 'undo', pin_id: ev.id, event_title: title, source_page: source }); render('idle'); };
      p.append(u); wrap.append(d, p); return;
    }
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = compact ? 'btn btn-ghost btn-sm' : 'btn btn-brick btn-sm'; btn.textContent = 'Remind me';
    const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = 'One text on the day, once the text line launches.';
    wrap.append(btn); if (!compact) wrap.append(sub); else btn.title = 'One text on the day, once the text line launches.';
    btn.onclick = () => {
      const phone = knownPhone();
      if (phone) return confirm(phone);
      const form = document.createElement('form'); form.className = 'alert-form'; form.noValidate = true;
      const id = 'al-' + Math.random().toString(36).slice(2, 7);
      form.innerHTML = `<label class="sr" for="${id}">Your mobile</label><input id="${id}" type="tel" name="phone" inputmode="tel" autocomplete="tel" placeholder="Your mobile"><button class="btn btn-sm" type="submit">Remind me</button><p class="fine"></p><p class="fine err" role="alert"></p>`;
      form.querySelector('.fine').textContent = ALERT_TEXT(title);
      form.onsubmit = (e) => {
        e.preventDefault();
        const p = cleanPhone(form.phone.value);
        if (!p) { form.querySelector('.err').textContent = 'That number needs 10 digits, like 845 555 0123.'; form.phone.focus(); return; }
        confirm(p);
      };
      btn.replaceWith(form); sub.remove(); form.phone.focus();
    };
  };
  const confirm = async (phone) => {
    const occ = nextOcc(ev, now);
    const ok = await save('kc_pin_alert', { action: 'set', phone, pin_id: ev.id, event_title: title, event_start: ev.start || null, event_day: day, venue: ev.venue || null, consent_text: ALERT_TEXT(title), source_page: source, occurrence: occ ? new Date(occ.start).toISOString().slice(0, 16) : null });
    if (!ok) { wrap.replaceChildren(); const p = document.createElement('p'); p.className = 'fine err'; saveFailed(p); wrap.append(p); return; }
    const prev = store.get('kc_sub') || {}; store.set('kc_sub', { ...prev, phone: prev.phone || phone });
    render('done');
  };
  render('idle');
  return wrap;
}

// ------------------------------------------------------------ data
export async function loadData() {
  const get = async (n) => { const r = await fetch(`${ROOT}data/${n}.json`, { cache: 'no-cache' }); if (!r.ok) throw new Error(n); return r.json(); };
  const [p, e, m] = await Promise.all([get('places'), get('events'), get('meta').catch(() => null)]);
  return { places: (p.places || []).filter((x) => x.valid !== false && x.status !== 'closed'), events: e.events || [], meta: m };
}
export function timeAgo(iso, now = new Date()) {
  if (!iso) return '';
  const min = Math.max(0, Math.round((now - new Date(iso)) / 60000));
  if (min < 2) return 'Updated just now';
  if (min < 60) return `Updated ${min} min ago`;
  const h = Math.round(min / 60);
  if (h <= 6) return `Updated ${h} hr ago`;
  return `Last updated ${new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' })}. Some listings may have changed, so check with the venue.`;
}

// ------------------------------------------------------------ events
export const alsoVia = (e) => (e.also_via || []).map((v) => (typeof v === 'string' ? v : v.source_name)).filter(Boolean);
export const isHappy = (e) => hasTag(e, 'happy-hour');
export const isOplus = (e) => /(^|\W)O\+/.test(e.title || '');
export const districtClass = (n) => /uptown/i.test(n || '') ? 'd-uptown' : /midtown/i.test(n || '') ? 'd-midtown' : /rondout/i.test(n || '') ? 'd-rondout' : '';
export const districtName = (n) => (n || '').replace('Uptown/Stockade', 'Uptown · Stockade').replace('Rondout/Waterfront', 'Rondout · Waterfront');

/** Events with an occurrence inside `win`, sorted by that occurrence. */
export function eventsIn(events, win) {
  const out = [];
  for (const e of events) {
    if (hasTag(e, 'sold-out')) continue;
    const occ = nextIn(e, win);
    if (occ) out.push({ e, occ });
  }
  return out.sort((a, b) => a.occ.start - b.occ.start || (a.e.title > b.e.title ? 1 : -1));
}

/** Fold every O+ Festival listing into one synthetic card. */
export function foldOplus(rows) {
  const o = rows.filter((r) => isOplus(r.e));
  if (o.length < 2) return rows;
  const rest = rows.filter((r) => !isOplus(r.e));
  const credits = [...new Set(o.map((r) => r.e.source_name).filter(Boolean))];
  const parts = o.map((r) => r.e).filter((ev) => !/^(\d+\w*\s+annual\s+)?O\+ Festival( 2026)?(:\s*MO\+NUMENTS)?$/i.test(ev.title.trim()));
  const start = Math.min(...o.map((r) => r.occ.start));
  const end = Math.max(...o.map((r) => r.occ.end));
  const ends = o.map((r) => Date.parse(r.e.end || r.e.start)).filter(Boolean);
  const anchor = o.find((r) => /MO\+NUMENTS|annual/i.test(r.e.title)) || o[0];
  const merged = {
    e: { ...anchor.e, id: 'oplus', title: 'O+ Festival 2026', venue: 'Citywide: Assembly, Keegan Ales, Old Dutch Church and more', blurb: 'Kingston\'s art, music and wellness weekend: bands, murals and free health care for artists. One wristband, a dozen rooms.', credit: `via ${credits.join(', ')}`, festival: true, parts: o.map((r) => r.e), lastDay: Math.max(...ends) },
    occ: { start, end, allDay: false },
    parts,
  };
  return [merged, ...rest].sort((a, b) => a.occ.start - b.occ.start);
}

export { timeWindow, nextIn, nyParts, formatWhen, formatClock, dayStart };

// ------------------------------------------------------------ chrome
export function initChrome() {
  const more = document.querySelector('.tabbar details');
  if (more) {
    document.addEventListener('click', (e) => { if (more.open && !more.contains(e.target)) more.open = false; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && more.open) { more.open = false; more.querySelector('summary').focus(); } });
  }
  bindSignups();
  for (const a of document.querySelectorAll('[data-track]')) a.addEventListener('click', () => track('kc_click', { target: a.dataset.track }));
}
