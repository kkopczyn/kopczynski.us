// shared.js — time + event helpers used by map.js and bot.js.
// Plain ES module, no dependencies. All wall-clock maths happens in
// America/New_York (configurable via TZ below).
//
// "Wall ms" = Date.UTC(y, m-1, d, h, min) of the *local* New York wall clock.
// Event strings in the data ("2026-10-10T21:00") are NY wall-clock, so
// comparing wall ms to wall ms is DST-safe without a tz library.

export const TZ = 'America/New_York';
const DAY = 86400000;
const DOW = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** NY wall-clock parts for a Date. */
export function nyParts(date = new Date()) {
  const p = {};
  for (const { type, value } of fmt.formatToParts(date)) p[type] = value;
  const y = +p.year, m = +p.month, d = +p.day, h = +p.hour % 24, min = +p.minute;
  const wall = Date.UTC(y, m - 1, d, h, min);
  return { y, m, d, h, min, wall, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

export const dayStart = (wall) => Math.floor(wall / DAY) * DAY;
export const dowOf = (wall) => new Date(dayStart(wall)).getUTCDay();
export const wallToISODate = (wall) => new Date(wall).toISOString().slice(0, 10);

/** Parse "2026-10-10" or "2026-10-10T21:00" into {wall, allDay}. */
export function parseWall(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  return { wall, allDay: !m[4] };
}

// ---------------------------------------------------------------- recurrence
function parseClock(tok, fallbackMeridiem) {
  tok = tok.trim().toLowerCase();
  if (tok === 'noon') return 12 * 60;
  if (tok === 'midnight') return 24 * 60;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(tok);
  if (!m) return null;
  let h = +m[1];
  const mer = m[3] || fallbackMeridiem;
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  return h * 60 + (m[2] ? +m[2] : 0);
}

/** Pull a "6–8pm" / "9am–1pm" / "noon–5pm" range out of free text → minutes. */
export function parseTimeRange(text) {
  if (!text) return null;
  const m = /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon)\s*(?:–|-|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)|noon|midnight)/i.exec(text);
  if (!m) return null;
  const endMer = (/(am|pm)/i.exec(m[2]) || [])[1];
  const start = parseClock(m[1], endMer && endMer.toLowerCase());
  const end = parseClock(m[2]);
  if (start == null || end == null) return null;
  return { start, end: end <= start ? end + 24 * 60 : end };
}

/** Recurrence rule from free text, or null. */
export function parseRecurrence(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  const rule = { days: [], nth: null, dates: [], months: null, time: parseTimeRange(t) };
  // Explicit date lists: "Dec 5, Dec 19, Jan 2"
  const re = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/g;
  let m;
  while ((m = re.exec(t))) rule.dates.push([MONTHS.indexOf(m[1]) + 1, +m[2]]);
  const nth = /\b(first|second|third|fourth|last)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/.exec(t);
  if (nth) rule.nth = { n: ['first', 'second', 'third', 'fourth', 'last'].indexOf(nth[1]) + 1, dow: DOW.indexOf(nth[2]) };
  DOW.forEach((d, i) => { if (new RegExp(`\\b${d}s\\b`).test(t)) rule.days.push(i); });
  if (/\bweekends?\b/.test(t)) rule.days.push(0, 6);
  // Season: "~May–November"
  const season = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(?:–|-|to)\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/.exec(t);
  if (season && !rule.dates.length) rule.months = [MONTHS.indexOf(season[1]) + 1, MONTHS.indexOf(season[2]) + 1];
  // Seasons: "spring–summer", "summer", "fall"
  const SEASONS = { spring: [3, 5], summer: [6, 8], fall: [9, 11], autumn: [9, 11], winter: [12, 2] };
  const ss = t.match(/\b(spring|summer|fall|autumn|winter)\b/g);
  if (!rule.months && ss && !rule.dates.length) rule.months = [SEASONS[ss[0]][0], SEASONS[ss[ss.length - 1]][1]];
  if (!rule.days.length && !rule.nth && rule.dates.length < 2) return null;
  return rule;
}

function inSeason(wall, months) {
  if (!months) return true;
  const mo = new Date(wall).getUTCMonth() + 1;
  const [a, b] = months;
  return a <= b ? mo >= a && mo <= b : mo >= a || mo <= b;
}

function ruleHitsDay(rule, day) {
  const d = new Date(day);
  const dow = d.getUTCDay();
  if (rule.dates.length >= 2) return rule.dates.some(([mo, dd]) => d.getUTCMonth() + 1 === mo && d.getUTCDate() === dd);
  if (rule.nth) {
    if (dow !== rule.nth.dow) return false;
    const n = Math.floor((d.getUTCDate() - 1) / 7) + 1;
    if (rule.nth.n === 5) return d.getUTCDate() + 7 > new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    return n === rule.nth.n;
  }
  return rule.days.includes(dow);
}

/**
 * Occurrences of an event that overlap [from, to) (wall ms).
 * Returns [{start, end, allDay}] — empty if the event has no usable timing.
 */
export function occurrences(ev, from, to) {
  const s = parseWall(ev.start), e = parseWall(ev.end);
  if (ev.all_day === true) { if (s) s.allDay = true; if (e) e.allDay = true; }
  const rule = parseRecurrence(ev.recurrence);
  const out = [];
  const span = s && e ? e.wall - s.wall : 0;
  if (rule && (!s || span > 7 * DAY)) {
    const lo = Math.max(from, s ? dayStart(s.wall) : -Infinity);
    const hi = Math.min(to, e ? dayStart(e.wall) + DAY : Infinity);
    for (let day = dayStart(lo); day < hi; day += DAY) {
      if (!ruleHitsDay(rule, day) || !inSeason(day, rule.months)) continue;
      const st = rule.time ? day + rule.time.start * 60000 : day;
      const en = rule.time ? day + rule.time.end * 60000 : day + DAY - 60000;
      if (en > from && st < to) out.push({ start: st, end: en, allDay: !rule.time });
    }
    return out;
  }
  if (!s) return out;
  // Timed runs spanning several days ("11am–6pm, runs through Oct 31") →
  // one occurrence per day at the same clock times.
  if (e && !s.allDay && !e.allDay && e.wall - s.wall > DAY + 3600000) {
    const st = s.wall - dayStart(s.wall), en0 = e.wall - dayStart(e.wall);
    const en = en0 > st ? en0 : en0 + DAY;
    for (let day = Math.max(dayStart(s.wall), dayStart(from) - DAY); day <= dayStart(e.wall) && day < to; day += DAY) {
      const a = day + st, b = day + en;
      if (b > from && a < to && a >= s.wall && a < e.wall) out.push({ start: a, end: b, allDay: false, run: true });
    }
    return out;
  }
  let end;
  if (e) end = e.allDay ? dayStart(e.wall) + DAY - 60000 : e.wall;
  else end = s.allDay ? s.wall + DAY - 60000 : s.wall + 2 * 3600000;
  if (end <= s.wall) end = s.wall + 2 * 3600000; // "18:30–18:30" style feed rows
  if (end > from && s.wall < to) out.push({ start: s.wall, end, allDay: s.allDay });
  return out;
}

// ---------------------------------------------------------------- windows
/** Named time windows relative to `now` (a Date). Returns {from, to, label}. */
export function timeWindow(name, now = new Date()) {
  const p = nyParts(now);
  const today = dayStart(p.wall);
  const H = 3600000;
  switch (name) {
    case 'now': return { from: p.wall, to: p.wall + 2 * H, label: 'right now' };
    case 'today': return { from: p.wall, to: today + DAY + 2 * H, label: 'today' };
    case 'tonight': return { from: Math.max(p.wall, today + 17 * H), to: today + DAY + 3 * H, label: 'tonight' };
    case 'tomorrow': return { from: today + DAY, to: today + 2 * DAY + 2 * H, label: 'tomorrow' };
    case 'weekend': {
      // Fri 5pm → Sun midnight. If we're already in it, start now.
      const dow = p.dow;
      const toFri = dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow;
      const fri = today + toFri * DAY + 17 * H;
      const sunEnd = today + (toFri + 3) * DAY;
      return { from: Math.max(p.wall, fri), to: sunEnd, label: 'this weekend' };
    }
    case 'week': return { from: p.wall, to: today + 7 * DAY, label: 'this week' };
    default: {
      const i = DOW.indexOf(name);
      if (i >= 0) {
        const delta = (i - p.dow + 7) % 7;
        const from = delta === 0 ? p.wall : today + delta * DAY;
        return { from, to: today + (delta + 1) * DAY + 2 * H, label: delta === 0 ? 'today' : DOW[i][0].toUpperCase() + DOW[i].slice(1) };
      }
      return null;
    }
  }
}

/** Next occurrence of an event inside a window (or null). */
export function nextIn(ev, win) {
  if (!win) return null;
  // Windows run a few hours past midnight for late shows; an all-day event
  // that only starts in that tail belongs to the next day, not this one.
  const occ = occurrences(ev, win.from, win.to).filter((o) => !(o.allDay && o.start >= win.to - 4 * 3600000));
  return occ.length ? occ[0] : null;
}

// ---------------------------------------------------------------- categories
export const CATEGORIES = ['eat', 'drink', 'see', 'outdoors', 'music', 'shop'];

/** Normalise a place category; events get one inferred from their text. */
// Map feed categories (cleaned events use food/art/community/family/nightlife/market)
// onto the six filter categories.
const CATEGORY_ALIASES = {
  food: 'eat', restaurant: 'eat', art: 'see', arts: 'see', community: 'see', family: 'see', history: 'see', film: 'see',
  nightlife: 'drink', bar: 'drink', market: 'shop', shopping: 'shop', outdoor: 'outdoors', nature: 'outdoors', concert: 'music',
};
const tagList = (it) => (Array.isArray(it.tags) ? it.tags.map((t) => String(t).toLowerCase()) : []);
export const hasTag = (it, tag) => tagList(it).includes(tag);

export function categoryOf(item) {
  if (hasTag(item, 'happy-hour')) return 'drink';
  if (item.category) {
    const c = String(item.category).toLowerCase();
    return CATEGORIES.includes(c) ? c : CATEGORY_ALIASES[c] || 'see';
  }
  const t = `${item.name || item.title || ''} ${item.venue || ''} ${item.blurb || ''}`.toLowerCase();
  if (/\b(market|craft|makers|marketplace|vintage|flea)\b/.test(t)) return 'shop';
  if (/\b(train|trolley|cruise|ride|hike|trail|walk|park)\b/.test(t) && !/\b(live music|concert)\b/.test(t)) return 'outdoors';
  if (/\b(live|music|concert|band|dj|honky|tonk|swing|two-step|tour|jazz|trio|sing|turntables|pansori|festival|w\/|album)\b/.test(t)) return 'music';
  if (/\b(trivia|beer|brew|oktoberfest|cocktail|wine|bar)\b/.test(t)) return 'drink';
  if (/\b(dinner|food|brunch|taco|pizza|feast|tasting)\b/.test(t)) return 'eat';
  return 'see';
}

export const itemName = (it) => it.name || it.title || it.id;

export function formatClock(wall) {
  const d = new Date(wall);
  let h = d.getUTCHours(); const m = d.getUTCMinutes();
  const mer = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')}${mer}` : `${h}${mer}`;
}

export function formatWhen(occ, nowWall) {
  const days = Math.round((dayStart(occ.start) - dayStart(nowWall)) / DAY);
  const dayLabel = days <= 0 ? 'today' : days === 1 ? 'tomorrow'
    : days < 7 ? DOW[dowOf(occ.start)][0].toUpperCase() + DOW[dowOf(occ.start)].slice(1)
      : new Date(occ.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (occ.allDay) {
    const multi = occ.end - occ.start > DAY;
    const endDay = DOW[dowOf(occ.end)][0].toUpperCase() + DOW[dowOf(occ.end)].slice(1);
    if (occ.start <= nowWall) return multi ? `on now, through ${endDay}` : 'today';
    return multi ? `${dayLabel} through ${endDay}` : dayLabel;
  }
  if (occ.start <= nowWall && occ.end > nowWall) return `on now till ${formatClock(occ.end)}`;
  return `${dayLabel} ${formatClock(occ.start)}`;
}

/**
 * Our pipeline writes blurbs as "<Type> at <Venue> (<Area>). <facts>". The first
 * sentence only restates the card, so drop it and keep the facts ("Free.",
 * "Tickets $19–$25.", "Runs through Oct 31."). Returns '' when nothing is left.
 */
export function cleanBlurb(b) {
  const s = String(b || '').trim();
  const m = /^[A-Z][A-Za-z &/-]{1,30} (?:at|in) .*?\.(?=\s|$)/.exec(s);
  if (!m) return s;
  // "(Uptown/Stockade)." ends the generated sentence; make sure we didn't stop inside "St." etc.
  let cut = m[0].length;
  const paren = s.indexOf(').');
  if (paren >= 0 && paren + 2 > cut && paren < 160) cut = paren + 2;
  return s.slice(cut).trim();
}

// ---------------------------------------------------------------- titles
const TYPOS = [[/\bCatheral\b/g, 'Cathedral']];
const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
/** Feed titles: fix known typos and drop trailing dates ("… Exhibitions October 3rd") that go stale. */
export function fixTitle(t) {
  let s = String(t || '');
  for (const [rx, to] of TYPOS) s = s.replace(rx, to);
  s = s.replace(new RegExp(`[\\s,:–—-]+(?:on\\s+)?${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*20\\d\\d)?\\s*$`, 'i'), '');
  return s.trim();
}
