// bot.js — "Text the Crew" recommendation engine.
// Client-side, deterministic, no API keys, no network. Plain ES module.
//
//   reply(message, {places, events, now, copy}) → {text, picks: [ids], followups: [..], intent}
//
// Pipeline: normalise → commands (STOP/START/HELP/HUMAN) → guardrails
// (off-topic) → parse slots (time, category, neighborhood, price, vibe,
// named place) → score every place/event → pick 1–3 diverse winners →
// phrase a short SMS-style reply that always ends with a next prompt.
// Same input + same `now` ⇒ same output (ties break on start time, then id).

import { categoryOf, itemName, timeWindow, nextIn, formatWhen, formatClock, nyParts, dayStart, hasTag, cleanBlurb, fixTitle } from './shared.js';
import { makerAsk, searchMade, spread } from './made.js';

// ------------------------------------------------------------------ copy
export const DEFAULT_COPY = {
  name: 'Crew Bot',
  org: 'the Crew',
  editor: 'a person',
  contact: '',
  help: ({ org, name, contact }) => `${org}: a no-ads local guide. I'm ${name} (a bot). Ask me "tonight", "weekend", "coffee", "free", or any place name. Text HUMAN for a person. Msg & data rates may apply. Reply STOP to cancel.${contact ? ' ' + contact : ''}`,
  stop: ({ org }) => `${org}: You're unsubscribed and won't get any more texts from us. Reply START to rejoin.`,
  start: ({ org }) => `Welcome back to ${org}. Msg & data rates may apply. Reply STOP to cancel, HELP for help.`,
  human: ({ editor, name }) => `Passing you to ${editor}. They usually reply within a day. – ${name}`,
  greeting: ({ name }) => `Hi, I'm ${name} (a bot). Ask me what's on tonight, where to eat, or what to do on a rainy Saturday.`,
  unknown: () => `I don't have a good answer for that one, and I'd rather not guess.`,
  offlane: () => `That's outside my lane: I cover where to go and what to do, not the news.`,
  thanks: () => `Anytime.`,
  nothing: ({ when }) => `I don't have anything listed ${when || 'for that'}, and I'd rather not guess.`,
};

// ------------------------------------------------------------------ lexicon
const CATEGORY_WORDS = {
  eat: ['eat', 'eats', 'food', 'dinner', 'lunch', 'brunch', 'breakfast', 'restaurant', 'restaurants', 'hungry', 'bite', 'meal', 'pizza', 'tacos', 'taco', 'pasta', 'supper', 'dine', 'dining', 'snack'],
  drink: ['drink', 'drinks', 'bar', 'bars', 'beer', 'beers', 'brewery', 'cocktail', 'cocktails', 'wine', 'pint', 'nightcap', 'booze', 'tavern', 'pub'],
  see: ['museum', 'museums', 'art', 'gallery', 'galleries', 'history', 'historic', 'sights', 'sightseeing', 'see', 'tour', 'culture', 'exhibit', 'architecture', 'lighthouse'],
  outdoors: ['outside', 'outdoors', 'outdoor', 'hike', 'hiking', 'walk', 'walking', 'trail', 'trails', 'park', 'parks', 'nature', 'river', 'kayak', 'bike', 'biking', 'swim', 'views', 'sunset'],
  music: ['music', 'live', 'show', 'shows', 'gig', 'gigs', 'concert', 'concerts', 'band', 'bands', 'dj', 'jazz', 'dance', 'dancing', 'karaoke'],
  shop: ['shop', 'shopping', 'vintage', 'market', 'markets', 'records', 'books', 'bookstore', 'gift', 'gifts', 'antiques', 'store', 'stores', 'browse'],
};
const COFFEE = ['coffee', 'espresso', 'latte', 'cafe', 'café', 'cappuccino', 'pastry', 'bakery'];
const NEIGHBORHOODS = [
  { id: 'Uptown/Stockade', words: ['uptown', 'stockade', 'four corners', 'wall st', 'wall street'], label: 'Uptown' },
  { id: 'Midtown', words: ['midtown', 'broadway'], label: 'Midtown' },
  { id: 'Rondout/Waterfront', words: ['rondout', 'waterfront', 'strand', 'downtown', 'the water', 'by the water'], label: 'on the Rondout' },
  { id: 'Port Ewen', words: ['port ewen', 'esopus'], label: 'in Port Ewen' },
  { id: 'Rosendale', words: ['rosendale'], label: 'in Rosendale' },
  { id: 'New Paltz', words: ['new paltz', 'gunks', 'mohonk'], label: 'in New Paltz' },
  { id: 'Saugerties', words: ['saugerties'], label: 'in Saugerties' },
  { id: 'Woodstock', words: ['woodstock', 'bearsville'], label: 'in Woodstock' },
  { id: 'Rhinebeck', words: ['rhinebeck'], label: 'in Rhinebeck' },
];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_ABBR = { sun: 'sunday', mon: 'monday', tue: 'tuesday', tues: 'tuesday', wed: 'wednesday', thu: 'thursday', thur: 'thursday', thurs: 'thursday', fri: 'friday', sat: 'saturday' };
const VIBES = {
  kids: { words: ['kid', 'kids', 'family', 'families', 'children', 'child', 'toddler', 'toddlers', 'baby', 'little ones', 'teens'], tag: /\b(kid|kids|family|families|children|train|trains|trolley|museum|animals|playground|lighthouse|pumpkin|carousel|parade|park|nature)\b/ },
  date: { words: ['date', 'romantic', 'anniversary', 'special', 'fancy', 'dress up', 'dressed up', 'impress'], tag: /\b(wine|cocktail|cocktails|candle|book it|dress-up|dress up|tasting|romantic|french|fireplace|intimate|pasta|natural wine|chef)\b/ },
  indoor: { words: ['rain', 'rainy', 'raining', 'indoor', 'indoors', 'inside', 'cold', 'snow', 'snowy', 'freezing', 'wet'] },
  dog: { words: ['dog', 'dogs', 'pup', 'puppy'], tag: /\b(dog|dogs|dog-friendly|patio|park|trail)\b/ },
  late: { words: ['late', 'late night', 'after midnight', 'night owl'], tag: /\b(late|midnight|dj|dance party|bar)\b/ },
};
const OFFLANE = ['politics', 'political', 'election', 'vote for', 'crime', 'police', 'arrest', 'shooting', 'news', 'mayor', 'council', 'lawsuit', 'trump', 'democrat', 'republican'];
const STOPWORDS = new Set('a an the and or but of to in on at for with near by is are was be it its this that these those what whats where when who how any some something somewhere me my we us our you your i im ive get got go going do does did can could should would want wanna need good best great nice fun cool please thanks thank hey hi hello ok okay up out there here around about like just really very lol tonight today tomorrow weekend this next now place places spot spots things thing stuff ideas idea recommend recommendation recommendations suggest suggestions right anything everything somewhere someplace plans plan options option'.split(' '));

// ------------------------------------------------------------------ text utils
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[’']/g, '').replace(/[^a-z0-9&$ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const has = (text, phrase) => new RegExp(`(^| )${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(text);
const hasAny = (text, list) => list.some((w) => has(text, norm(w)));
const firstSentence = (s, max = 90) => {
  if (!s) return '';
  let t = String(s).split(/(?<=[.!?])\s/)[0].replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max).replace(/[\s,;:—–-]+\S*$/, '') + '…';
  return t;
};
const itemText = (it) => norm(`${itemName(it)} ${it.venue || ''} ${it.blurb || ''} ${it.category || ''} ${it.recurrence || ''}`);

// ------------------------------------------------------------------ parse
export function parse(message) {
  const raw = String(message || '');
  const t = norm(raw.replace(/\bwhat'?s\b/gi, 'whats'));
  const words = t.split(' ').filter(Boolean);
  const slots = { raw, text: t, words, categories: [], coffee: false, neighborhood: null, time: null, free: false, cheap: false, vibes: [], eventy: false };

  if (!t) { slots.command = 'empty'; return slots; }
  const solo = words.length <= 2 ? t : '';
  if (/^(stop|stopall|stop all|unsubscribe|cancel|end|quit|optout|opt out)$/.test(solo)) slots.command = 'stop';
  else if (/^(start|unstop|subscribe|y|yes|resume)$/.test(solo)) slots.command = 'start';
  else if (/^(help|info|menu|commands|\?)$/.test(solo) || /^help\b/.test(t)) slots.command = 'help';
  else if (/^(human|agent|person|real person|operator)$/.test(solo) || has(t, 'talk to a human') || has(t, 'talk to a person')) slots.command = 'human';
  else if (/^(hi|hello|hey|yo|hiya|howdy|good morning|good evening|sup)( there| wick| bot)?$/.test(t)) slots.command = 'greeting';
  else if (/^(thanks|thank you|thx|ty|cheers|great thanks|awesome thanks|perfect|cool thanks)$/.test(t)) slots.command = 'thanks';
  if (slots.command) return slots;

  if (hasAny(t, OFFLANE)) slots.offlane = true;

  // time
  if (hasAny(t, ['right now', 'now', 'open now', 'at the moment', 'currently'])) slots.time = 'now';
  if (hasAny(t, ['tonight', 'this evening', 'tonite', 'late tonight'])) slots.time = 'tonight';
  else if (hasAny(t, ['today', 'this afternoon', 'this morning'])) slots.time = 'today';
  else if (hasAny(t, ['tomorrow', 'tmrw', 'tmr', 'tomorrow night'])) slots.time = 'tomorrow';
  else if (hasAny(t, ['this weekend', 'weekend', 'the weekend', 'sat and sun'])) slots.time = 'weekend';
  else if (hasAny(t, ['this week', 'next few days', 'week'])) slots.time = 'week';
  for (const w of words) {
    const d = DAYS.includes(w) ? w : DAYS.includes(w.replace(/s$/, '')) ? w.replace(/s$/, '') : DAY_ABBR[w];
    if (d) { slots.time = d; break; }
  }
  if (/\b(whats on|what s on|whats happening|happening|going on|events?|anything on|whats up)\b/.test(t)) slots.eventy = true;

  // category / coffee
  for (const [cat, list] of Object.entries(CATEGORY_WORDS)) if (hasAny(t, list)) slots.categories.push(cat);
  if (hasAny(t, COFFEE)) { slots.coffee = true; slots.categories = slots.categories.filter((c) => c !== 'drink'); }
  if (slots.categories.includes('music')) slots.eventy = true;
  if (has(t, 'live music')) slots.categories = slots.categories.filter((c) => c === 'music').concat(slots.categories.includes('music') ? [] : ['music']);

  // neighborhood
  for (const n of NEIGHBORHOODS) if (hasAny(t, n.words)) { slots.neighborhood = n; break; }
  if (slots.neighborhood?.id === 'Midtown' && has(t, 'broadway') && slots.categories.includes('music') === false && /\b(show|musical)\b/.test(t)) slots.neighborhood = null;

  // price / vibes
  if (hasAny(t, ['free', 'no cost', 'for free', 'zero dollars'])) slots.free = true;
  if (hasAny(t, ['cheap', 'budget', 'inexpensive', 'affordable', 'broke', 'cheap eats'])) slots.cheap = true;
  for (const [v, def] of Object.entries(VIBES)) if (hasAny(t, def.words)) slots.vibes.push(v);
  if (slots.vibes.includes('date') && !slots.categories.length) slots.categories.push('eat', 'drink');
  if (hasAny(t, ['adult', 'adults', 'grown up', 'grownups', '21+', 'no kids'])) slots.adult = true;
  // Leftover content words become keywords ("halloween", "pumpkins", "oysters").
  const known = new Set([...Object.values(CATEGORY_WORDS).flat(), ...COFFEE, ...Object.values(VIBES).flatMap((v) => v.words), ...NEIGHBORHOODS.flatMap((n) => n.words), ...DAYS, ...Object.keys(DAY_ABBR),
    'free', 'cheap', 'adult', 'adults', 'plans', 'plan', 'friendly', 'weekend', 'tonight', 'today', 'tomorrow', 'kingston', 'whats', 'happening', 'going', 'events', 'event', 'worth', 'open', 'late', 'night', 'day', 'days', 'time', 'with', 'from', 'have', 'there', 'their', 'over', 'into', 'than', 'then', 'will']);
  slots.keywords = words.filter((w) => w.length > 3 && !STOPWORDS.has(w) && !known.has(w) && !known.has(w.replace(/s$/, '')));
  return slots;
}

// ------------------------------------------------------------------ scoring
function tags(it, cat) {
  const t = itemText(it);
  return {
    coffee: /\b(coffee|espresso|cafe|roaster|roasters|bakery|pastry|pastries|latte)\b/.test(t),
    free: /^free$/i.test(String(it.price || '').trim()) || hasTag(it, 'free') || /\bfree\b/.test(t) || (cat === 'outdoors' && !it.start && !/\b(ticket|tickets|admission|\$)/.test(t)),
    cheap: /\b(cheap|casual|diner|taco|tacos|pizza|slice|counter|bodega|no-frills|deli)\b/.test(t),
    indoor: cat !== 'outdoors' && cat !== 'market' && !/\b(outdoor|outdoors|trail|hike|park|lot|parade|walk|spit|preserve|meadows|festival|oktoberfest|fair|market|cruise|train|foliage|beer garden|reenact\w*)\b/.test(t),
    kids: hasTag(it, 'kids') || hasTag(it, 'family') || String(it.category).toLowerCase() === 'family' || VIBES.kids.tag.test(t),
    date: VIBES.date.tag.test(t),
    dog: VIBES.dog.tag.test(t),
    late: VIBES.late.tag.test(t),
  };
}

/** Find a place/event the user named directly ("is top taste worth it"). */
function namedItem(slots, items) {
  const t = slots.text;
  let best = null;
  for (const { item } of items) {
    const name = norm(itemName(item)).replace(/^the /, '');
    const core = name.split(' (')[0];
    const toks = core.split(' ').filter((w) => w.length > 2 && !STOPWORDS.has(w) && !['kingston', 'restaurant', 'bar', 'house', 'park', 'street', 'cafe', 'live', 'night', 'music', 'market', 'museum', 'trail', 'theatre', 'theater', 'festival', 'tour', 'hudson', 'river'].includes(w));
    let score = 0;
    if (core.length > 3 && has(t, core)) score = 10 + core.length;
    else {
      const hit = toks.filter((w) => has(t, w));
      if (hit.length >= 2 || (hit.length === 1 && toks.length <= 2 && hit[0].length >= 5)) score = hit.length * 3 + hit.join('').length / 10;
    }
    if (score && (!best || score > best.score)) best = { item, score };
  }
  return best && best.score >= 3 ? best.item : null;
}

function candidates(places, events, win, nowWall, days = 21) {
  const out = [];
  for (const p of places) out.push({ item: p, kind: 'place', cat: categoryOf(p) });
  const horizon = { from: nowWall, to: dayStart(nowWall) + days * 86400000 };
  for (const e of events) {
    if (e.lat == null && e.lng == null && !e.venue) continue;
    const occ = nextIn(e, win || horizon);
    if (!occ) continue;
    out.push({ item: e, kind: 'event', cat: categoryOf(e), occ });
  }
  return out;
}

function score(c, slots, win) {
  const tg = tags(c.item, c.cat);
  let s = c.kind === 'event' ? 1.5 : 1;
  const why = [];
  if (hasTag(c.item, 'sold-out')) s -= 10;
  if (hasTag(c.item, 'happy-hour') && !/\b(happy hour|deal|deals|cheap)\b/.test(slots.text)) s -= 3;
  if (c.occ?.run) s -= 1;   // month-long runs are background, not news
  const wantCats = slots.categories;
  if (slots.coffee) { if (tg.coffee) { s += 7; why.push('coffee'); } else s -= 4; }
  if (wantCats.length) {
    if (wantCats.includes(c.cat)) { s += 4; why.push(c.cat); }
    else if (c.kind === 'place') s -= 3;
    else s -= 1.5;
  }
  if (slots.neighborhood) {
    if (c.item.neighborhood === slots.neighborhood.id) { s += 3.5; why.push('area'); }
    else if (c.kind === 'event' && slots.neighborhood.id === 'Uptown/Stockade' && /uptown|wall st|stockade/.test(itemText(c.item))) s += 3;
    else s -= 3;
  }
  if (win) {
    if (c.kind === 'event') {
      const fits = !wantCats.length || wantCats.includes(c.cat);
      s += fits ? 5 : 1; why.push('time');
      if (c.occ.allDay && (slots.time === 'tonight' || slots.time === 'now')) s -= 2;   // all-day fairs rarely run late
    }
    else if (slots.eventy && !wantCats.length) s -= 1;
  } else if (slots.eventy) {
    if (c.kind === 'event') s += 3; else s -= 1;
  }
  if (slots.free) { if (tg.free) { s += 3.5; why.push('free'); } else s -= 2; }
  if (slots.cheap && tg.cheap) { s += 2; why.push('cheap'); }
  for (const v of slots.vibes) {
    if (v === 'indoor') { if (tg.indoor) { s += 2; why.push('indoor'); } else s -= 8; if (c.item.ring && c.item.ring !== 'core') s -= 2; }
    else if (tg[v]) { s += 3; why.push(v); }
    else if (v === 'kids' && c.kind === 'event' && /\b(21\+|burlesque|bitch|adult|bar)\b/.test(itemText(c.item))) s -= 6;
  }
  // free-text overlap with the item's own words (cap 3)
  const t = itemText(c.item);
  let overlap = 0;
  for (const w of slots.words) if (w.length > 3 && !STOPWORDS.has(w) && has(t, w)) overlap++;
  s += Math.min(overlap, 3) * 0.75;
  // outlying towns only when asked
  if (!slots.neighborhood && c.item.ring && c.item.ring !== 'core') s -= c.kind === 'event' ? 4 : 1.5;   // city first: out-of-town events only when asked
  // soonest events first; with no time asked, far-off events fade
  const kwHits = slots.keywords.filter((w) => has(t, w)).length;
  if (c.occ) s -= Math.max(0, (c.occ.start - (win ? win.from : slots.nowWall)) / 86400000) * (win || kwHits ? 0.05 : 0.2);
  // keyword-led asks ("halloween", "pumpkins") lean on the overlap
  if (slots.keywords.length) {
    s += kwHits * 3;
    if (!kwHits && !wantCats.length && !slots.vibes.length) s -= 2;
  }
  if (slots.adult && /(kids|family|families|children|toddler)/.test(t)) s -= 6;
  // a sit-down meal is not a bakery, a coffee bar or a donut counter
  if (/\b(dinner|supper|lunch|date)\b/.test(slots.text) && c.kind === 'place' && /\b(bakery|bakeshop|bread|donuts?|pastr\w*|egg sandwich\w*|espresso|roaster|bagels?|deli|general store)\b/.test(t)) s -= 8;
  return { s, why };
}

const titleKey = (it) => norm(itemName(it)).replace(/\b(\d+(st|nd|rd|th)?|annual|the|a|of|at|in|and|20\d\d|live|presents?)\b/g, ' ').split(/[:(\-]/)[0].replace(/\s+/g, ' ').trim();

function pickTop(scored, n = 3) {
  scored.sort((a, b) => b.s - a.s || (a.occ?.start ?? Infinity) - (b.occ?.start ?? Infinity) || String(a.item.id).localeCompare(String(b.item.id)));
  const picks = [], seenVenue = new Set();
  for (const c of scored) {
    if (picks.length >= n) break;
    const venue = `${(+c.item.lat).toFixed(3)},${(+c.item.lng).toFixed(3)}:${c.kind}`;
    if (seenVenue.has(venue) && picks.length) continue;
    const key = titleKey(c.item);
    if (key && picks.some((p) => { const k = titleKey(p.item); return k && (k.includes(key) || key.includes(k)); })) continue;
    if (picks.length && c.s < picks[0].s - 4.5) break;
    seenVenue.add(venue); picks.push(c);
  }
  return picks;
}

// ------------------------------------------------------------------ phrasing
const TITLE = { eat: 'Food', drink: 'Drinks', see: 'Worth a look', outdoors: 'Outside', music: 'Music', shop: 'Shopping' };
function where(it) {
  if (it.venue && !/citywide/i.test(it.venue)) return it.venue.split(/[,(]/)[0].trim();
  return it.neighborhood ? it.neighborhood.replace('/Stockade', '').replace('/Waterfront', '') : '';
}
function line(c, nowWall) {
  const name = c.kind === 'event' ? fixTitle(itemName(c.item)) : itemName(c.item);
  if (c.kind === 'event') {
    const when = formatWhen(c.occ, nowWall);
    const w = where(c.item);
    return `${name} (${[when, w && !name.includes(w) ? w : ''].filter(Boolean).join(', ')})`;
  }
  const blurb = firstSentence(c.item.blurb, 80);
  const nb = c.item.neighborhood ? c.item.neighborhood.split('/')[0] : '';
  return `${name}${nb && !name.includes(nb) ? ` (${nb})` : ''}${blurb ? `: ${blurb}` : ''}`;
}

function heading(slots, win) {
  const bits = [];
  if (slots.coffee) bits.push('Coffee');
  else if (slots.vibes.includes('date')) bits.push('Date night');
  else if (slots.vibes.includes('kids')) bits.push('With kids');
  else if (slots.vibes.includes('indoor')) bits.push('Staying dry');
  else if (slots.free) bits.push('Free');
  else if (slots.categories.length === 1) bits.push(TITLE[slots.categories[0]]);
  else if (slots.keywords?.length) bits.push(slots.keywords[0][0].toUpperCase() + slots.keywords[0].slice(1));
  if (slots.neighborhood) bits.push(slots.neighborhood.label);
  if (win) bits.push(win.label);
  if (!bits.length) return 'A few picks';
  const h = bits.join(' ');
  return h[0].toUpperCase() + h.slice(1);
}

function followupsFor(slots, picks) {
  const f = [];
  const cats = new Set(picks.map((p) => p.cat));
  if (slots.time === 'tonight') f.push("What's on tomorrow?"); else if (!slots.time) f.push("What's on tonight?");
  if (!cats.has('eat') && !slots.coffee) f.push('Somewhere to eat nearby?');
  else if (!cats.has('drink')) f.push('A drink after?');
  if (slots.time !== 'weekend') f.push('Something free this weekend');
  if (!slots.vibes.includes('indoor')) f.push('Rainy day ideas');
  if (!slots.neighborhood) f.push('Best coffee Uptown');
  return [...new Set(f)].slice(0, 3);
}

// ------------------------------------------------------------------ reply
export function reply(message, { places = [], events = [], made = [], now = new Date(), copy = {} } = {}) {
  const C = { ...DEFAULT_COPY, ...copy };
  const ctx = { name: C.name, org: C.org, editor: C.editor, contact: C.contact };
  const say = (k, extra) => (typeof C[k] === 'function' ? C[k]({ ...ctx, ...extra }) : C[k]);
  const slots = parse(message);
  slots.nowWall = nyParts(now).wall;
  const base = ['What\'s on tonight?', 'Rainy day ideas', 'Best coffee Uptown'];
  const nowWall = nyParts(now).wall;

  switch (slots.command) {
    case 'stop': return { text: say('stop'), picks: [], followups: ['START'], intent: 'stop' };
    case 'start': return { text: say('start') + ` Try "what's on tonight?"`, picks: [], followups: base, intent: 'start' };
    case 'help': return { text: say('help'), picks: [], followups: base, intent: 'help' };
    case 'human': return { text: say('human'), picks: [], followups: ["Meanwhile: what's on tonight?"], intent: 'human' };
    case 'greeting': return { text: `${say('greeting')} Try: "what's on tonight?"`, picks: [], followups: base, intent: 'greeting' };
    case 'thanks': return { text: `${say('thanks')} Text me whenever. Want ideas for the weekend?`, picks: [], followups: ['Something free this weekend', 'Date night', 'Live music Friday'], intent: 'thanks' };
    case 'empty': return { text: `Say the word. Try "what's on tonight?" or "best coffee Uptown".`, picks: [], followups: base, intent: 'empty' };
    default: break;
  }
  if (slots.offlane && !slots.categories.length && !slots.time) {
    return { text: `${say('offlane')} Want something to do tonight instead?`, picks: [], followups: ["What's on tonight?", 'Something free this weekend'], intent: 'offlane' };
  }

  // "What's made in Kingston?" / "local beer" / "where can I buy local ceramics" → made.json.
  // ---- asks we can't answer from data: say so, then offer what we do know.
  const t0 = slots.text;
  // "is X open?" / "X hours"
  if (/\b(is|are)\b.*\bopen\b|\bopening hours\b|\bwhat time does\b|\bhours\b/.test(t0)) {
    const named = namedItem(slots, places.map((p) => ({ item: p })));
    if (named) {
      const site = named.url ? ` Their site: ${named.url}` : '';
      return { text: `I don't track opening hours yet, so I won't guess about ${itemName(named)}.${site || ' Call ahead before you go.'} Want something nearby instead?`, picks: [named.id], followups: [`Food near ${itemName(named)}`, "What's on tonight?"], intent: 'hours' };
    }
  }
  // happy hour → the happy-hour listings, not festivals
  if (/\bhappy hours?\b/.test(t0)) {
    const win = slots.time && slots.time !== 'now' ? timeWindow(slots.time, now) : { from: nowWall, to: dayStart(nowWall) + 86400000, label: slots.time === 'now' ? 'right now' : 'today' };
    const seen = new Set(), hh = [];
    for (const e of events) {
      if (!hasTag(e, 'happy-hour')) continue;
      const occ = nextIn(e, win); if (!occ || occ.allDay) continue;
      const v = e.venue || e.title; if (seen.has(v)) continue;
      seen.add(v); hh.push({ e, occ });
    }
    hh.sort((a, b) => a.occ.start - b.occ.start);
    const label = win.label || 'today';
    if (!hh.length) return { text: `No happy hours listed ${label === 'today' ? 'for the rest of today' : label}. Want a bar instead?`, picks: [], followups: ['A good bar Uptown', "What's on tonight?"], intent: 'happy-hour' };
    const lines = hh.slice(0, 3).map(({ e, occ }) => `${(e.venue || e.title).split(/[,(]/)[0].trim()} (${occ.start <= nowWall && occ.end > nowWall ? 'on now till ' + formatClock(occ.end) : formatWhen(occ, nowWall)})`);
    return { text: `Happy hours ${label}: ${lines.length === 1 ? lines[0] : '\n' + lines.map((l, i) => `${i + 1}) ${l}`).join('\n')}${lines.length > 1 ? '\n' : ' '}Prices and times are from the venues' own listings, so check before you go.`, picks: hh.slice(0, 3).map((x) => x.e.id), followups: ['Food nearby?', "What's on tonight?"], intent: 'happy-hour' };
  }
  // a specific dish: only places that actually serve it, or an honest "I don't know"
  const DISH = { pizza: /\b(pizza|pizzas|pies|neapolitan|slice|slices)\b/, brunch: /\b(brunch|breakfast|eggs|pancakes?|diner)\b/, tacos: /\b(tacos?|taqueria|tortillas?)\b/,
    ramen: /\b(ramen|noodles?)\b/, sushi: /\b(sushi|omakase)\b/, burger: /\b(burgers?)\b/, bagel: /\b(bagels?)\b/, donuts: /\b(donuts?|doughnuts?)\b/ };
  const dish = Object.keys(DISH).find((k) => DISH[k].test(t0) || (k === 'burger' && /\bburger/.test(t0)));
  if (dish && !slots.time) {
    const hits = places.filter((p) => DISH[dish].test(itemText(p)) && (slots.neighborhood ? p.neighborhood === slots.neighborhood.id : p.ring === 'core' || !p.ring))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, 3);
    if (!hits.length) return { text: `I don't have a ${dish} pick I'd stand behind yet, and I'd rather not guess. Reply HUMAN and Konrad will ask around.`, picks: [], followups: ['Somewhere to eat Uptown', "What's on tonight?"], intent: 'dish' };
    const lines = hits.map((p) => line({ item: p, kind: 'place' }, nowWall));
    return { text: `${dish[0].toUpperCase() + dish.slice(1)}: ${lines.length === 1 ? lines[0] : '\n' + lines.map((l, i) => `${i + 1}) ${l}`).join('\n')}${lines.length > 1 ? '\n' : ' '}Want a drink after?`, picks: hits.map((p) => p.id), followups: ['A drink after?', "What's on tonight?"], intent: 'dish' };
  }
  // dietary asks: we only know what blurbs say
  if (/\b(vegan|vegetarian|veggie|plant based|gluten free|gluten|celiac|halal|kosher|dairy free|nut free)\b/.test(t0)) {
    const veg = /\b(vegan|vegetarian|veggie|plant based)\b/.test(t0);
    const hits = veg ? places.filter((p) => /\b(vegan|vegetarian|veg-forward|veggie|plant-based)\b/i.test(`${p.name} ${p.blurb || ''}`)).slice(0, 3) : [];
    const what = (/\b(gluten free|gluten|celiac)\b/.exec(t0) || /\b(halal|kosher|dairy free|nut free)\b/.exec(t0) || ['vegan'])[0];
    let text = `I don't have reliable ${what === 'celiac' ? 'gluten-free' : what} info yet, so I won't promise anything: check the menu or ask the kitchen.`;
    if (hits.length) text += ` On our list, ${hits.map((p) => itemName(p)).join(' and ')} ${hits.length > 1 ? 'are' : 'is'} known for veg-forward cooking.`;
    text += ' Or reply HUMAN and Konrad will ask around.';
    return { text, picks: hits.map((p) => p.id), followups: ['Somewhere to eat Uptown', "What's on tonight?"], intent: 'diet' };
  }
  // dog-friendly: no data, so no guesses
  if (slots.vibes.includes('dog') || /\bdog friendly\b/.test(t0)) {
    return { text: "I don't know which places are dog-friendly, and I'd rather not guess. Call ahead and ask, or reply HUMAN and Konrad will find out.", picks: [], followups: ['A walk by the river', "What's on tonight?"], intent: 'dog' };
  }
  // late-night food: we don't track kitchen hours
  if (slots.vibes.includes('late') && (slots.categories.includes('eat') || /\b(food|eat|eats|kitchen|hungry|bite|snack)\b/.test(t0))) {
    const tw = timeWindow('tonight', now);
    const late = candidates([], events, tw, nowWall).filter((c) => !hasTag(c.item, 'happy-hour') && (!c.item.ring || c.item.ring === 'core') && new Date(c.occ.start).getUTCHours() >= 21).slice(0, 2);
    let text = "I don't track kitchen hours yet, so I won't promise late food: call ahead.";
    if (late.length) text += ` Late shows tonight, if that helps: ${late.map((c) => `${itemName(c.item)} (${formatWhen(c.occ, nowWall)})`).join('; ')}.`;
    text += ' Or reply HUMAN.';
    return { text, picks: late.map((c) => c.item.id), followups: ["What's on tonight?", 'A drink after?'], intent: 'late-food' };
  }

  // Wick only recommends what's checked: skip makers whose listing is still being verified.
  const madeOk = made.filter((m) => m.verified_2026 !== false);
  if (madeOk.length && makerAsk(slots.raw)) {
    const { want, ranked } = searchMade(madeOk, slots.raw);
    const top = want.length ? ranked.slice(0, 3) : spread(ranked, 3);
    if (!top.length) {
      return { text: `I don't know a Kingston maker for that yet, and I'd rather not guess. Reply HUMAN and ${C.editor} can look into it.`, picks: [], followups: ["What's made in Kingston?", 'Local beer'], intent: 'made-none' };
    }
    const lineFor = ({ m }) => {
      const buy = m.where_to_buy.map((w) => w.name).filter((n) => n && n !== m.name).slice(0, 2);
      const what = firstSentence(m.what_they_make || m.blurb, 90);
      let l = `${m.name}${m.subtype ? ` (${m.subtype})` : ''}${what ? `: ${what.replace(/[\s,;:–—-]+$/, '').replace(/([^.!?…])$/, '$1.')}` : ''}`;
      if (m.market) l += ' Find them at the Kingston Farmers Market (Sat).';
      else if (buy.length) l += ` Buy it at ${buy.join(' or ')}.`;
      else if (m.where_to_buy.length || m.open_to_public) l += ' Buy it at the source.';
      return l;
    };
    const lines = top.map(lineFor);
    const head = want.length ? `Made in Kingston` : `A few things made in Kingston`;
    const text = `${head}: ${lines.length === 1 ? lines[0] : '\n' + lines.map((l, i) => `${i + 1}) ${l}`).join('\n')}${lines.length > 1 ? '\n' : ' '}The full list is on our Made in Kingston page. Want one near you?`;
    return { text, picks: top.map(({ m }) => m.pin_id || m.id), followups: ['Local beer', 'Where can I buy local ceramics?', "What's on tonight?"], intent: 'made', made: top.map(({ m }) => m.id) };
  }

  const win = slots.time ? timeWindow(slots.time, now) : null;
  const pool = candidates(places, events, win, nowWall, slots.keywords?.length ? 75 : 21);

  // Direct "tell me about X".
  const named = namedItem(slots, pool.length ? pool : places.map((p) => ({ item: p })));
  if (named && !slots.time && !slots.categories.length) {
    const c = pool.find((x) => x.item.id === named.id) || { item: named, kind: named.start ? 'event' : 'place', cat: categoryOf(named) };
    const nb = named.neighborhood ? ` (${named.neighborhood})` : '';
    const isEv = !!(named.start || named.recurrence);
    const curated = isEv && (C.eventLines || []).find(([rx]) => new RegExp(rx, 'i').test(named.title || named.name));
    let nbClean = isEv ? cleanBlurb(named.blurb) : named.blurb;
    if (isEv && c.occ && c.occ.start > nowWall) nbClean = nbClean.replace(/\bRuns through [^.]*\.\s*/i, '');   // not started yet
    const desc = curated ? curated[1] : firstSentence(nbClean, 160) || (named.venue ? `at ${named.venue}.` : 'on our map.');
    let text = `${isEv ? fixTitle(itemName(named)) : itemName(named)}${nb}: ${desc}`;
    if (c.kind === 'event' && c.occ) text += ` ${c.occ.start > nowWall ? 'When' : 'Next'}: ${formatWhen(c.occ, nowWall)}.`;
    if (c.kind === 'place') {
      const ev = pool.filter((x) => x.kind === 'event' && !hasTag(x.item, 'happy-hour') && Math.abs(x.item.lat - named.lat) < 0.0006 && Math.abs(x.item.lng - named.lng) < 0.0006)
        .sort((a, b) => a.occ.start - b.occ.start)[0];
      if (ev) text += ` Coming up there: ${itemName(ev.item)}, ${formatWhen(ev.occ, nowWall)}.`;
    }
    text += ' Want something nearby?';
    return { text, picks: [named.id], followups: [`Food near ${itemName(named)}`, "What's on tonight?"], intent: 'lookup' };
  }

  const kwHit = slots.keywords?.length && [...places, ...events].some((it) => slots.keywords.some((w) => has(itemText(it), w)));
  const understood = kwHit || slots.categories.length || slots.coffee || slots.time || slots.neighborhood || slots.free || slots.cheap || slots.vibes.length || slots.eventy;
  if (!understood) {
    return { text: `${say('unknown')} Try "what's on tonight?", "date night" or "best coffee Uptown". Or reply HUMAN.`, picks: [], followups: base, intent: 'unknown' };
  }

  // A time window with no event-y or category ask means "what's on".
  if (win && !slots.categories.length && !slots.coffee && !slots.vibes.length) slots.eventy = true;
  let pool2 = pool;
  if (win && (slots.eventy || slots.categories.includes('music')) && !slots.vibes.includes('date')) {
    let evs = pool.filter((c) => c.kind === 'event');
    const coreEvs = evs.filter((c) => !c.item.ring || c.item.ring === 'core');
    if (!slots.neighborhood && coreEvs.length >= 2) evs = coreEvs;   // the city first
    if (evs.length) pool2 = evs;
  }
  const scored = pool2.map((c) => ({ ...c, ...score(c, slots, win) }));
  const picks = pickTop(scored).filter((c) => c.s > 1.5);
  if (!picks.length) {
    const when = win ? win.label : '';
    return { text: `${say('nothing', { when })} Want me to look at ${slots.time === 'weekend' ? 'next week' : 'this weekend'} instead? Or reply HUMAN.`, picks: [], followups: ['Something free this weekend', "What's on tonight?"], intent: 'nothing' };
  }

  const head = heading(slots, win);
  const lines = picks.map((c) => line(c, nowWall));
  let text = `${head}: ${lines.length === 1 ? lines[0] : '\n' + lines.map((l, i) => `${i + 1}) ${l}`).join('\n')}`;
  const notes = [];
  if (slots.vibes.includes('indoor') && picks.some((p) => p.cat === 'outdoors')) notes.push('check the weather first');
  if (slots.free && picks.some((p) => !tags(p.item, p.cat).free)) notes.push('double-check prices on the listing');
  if (slots.time === 'now' && picks.some((p) => p.kind === 'place')) notes.push("I don't track opening hours, so call ahead");
  if (notes.length) text += ` (${notes.join('; ')}.)`;
  const followups = followupsFor(slots, picks);
  const closer = {
    "What's on tomorrow?": 'Want tomorrow too?', "What's on tonight?": "Want what's on tonight?",
    'Somewhere to eat nearby?': 'Want food nearby?', 'A drink after?': 'Want a drink after?',
    'Something free this weekend': 'Want something free this weekend?', 'Rainy day ideas': 'Want rainy-day ideas?',
    'Best coffee Uptown': 'Want coffee Uptown?',
  }[followups[0]] || `Try "${followups[0]}".`;
  text += `${lines.length > 1 ? '\n' : ' '}${closer}`;
  return { text, picks: picks.map((c) => c.item.id), followups, intent: 'recommend', slots: { time: slots.time, categories: slots.categories, neighborhood: slots.neighborhood?.id || null, vibes: slots.vibes, free: slots.free, coffee: slots.coffee } };
}
