// made.js — "Made in Kingston": normalise made.json and merge makers into places.
// Plain ES module, no DOM. Used by the map home, the /made/ page and the bot.
//
// made.json rows: {id, name, type: food|drink|goods|art|space, subtype, what_they_make,
//   made_where, where_to_buy:[{name, address, lat, lng, kind}], lat, lng, neighborhood,
//   open_to_public, url, instagram, source, verified_2026, blurb}

export const MADE_TYPES = ['food', 'drink', 'goods', 'art', 'space'];
export const MADE_GROUPS = [
  { id: 'fooddrink', label: 'Food & Drink', types: ['food', 'drink'] },
  { id: 'goods', label: 'Goods', types: ['goods'] },
  { id: 'art', label: 'Art', types: ['art'] },
  { id: 'space', label: 'Maker spaces', types: ['space'] },
];
/** Pin family for map styling: food+drink share one, goods, art, murals, spaces. */
export const madeFamily = (t, m) => (m && m.mural ? 'mural' : t === 'food' || t === 'drink' ? 'fooddrink' : MADE_TYPES.includes(t) ? t : 'goods');
export const MARKET_PLACE_ID = 'farmers-market';

/** Accept an array, {makers:[]}, {items:[]}, {made:[]} or any object holding one array. */
export function normaliseMade(json) {
  let rows = Array.isArray(json) ? json : null;
  if (!rows && json && typeof json === 'object') {
    rows = json.makers || json.items || json.made || json.entries || Object.values(json).find(Array.isArray) || [];
  }
  return (rows || [])
    .filter((m) => m && m.id && m.name)
    .map((m) => {
      const geoP = String(m.geo_precision || '');
      const o = String(m.open_to_public ?? '').toLowerCase();
      const row = {
        ...m,
        type: MADE_TYPES.includes(String(m.type).toLowerCase()) ? String(m.type).toLowerCase() : 'goods',
        where_to_buy: Array.isArray(m.where_to_buy) ? m.where_to_buy.filter((w) => w && w.name) : [],
        lat: m.lat == null || m.lat === '' ? null : +m.lat,
        lng: m.lng == null || m.lng === '' ? null : +m.lng,
        open_label: m.open_to_public === true || o === 'yes' || o === 'true' ? 'yes' : m.open_to_public === false || o === 'no' || o === 'false' ? 'no' : o || 'unknown',
        market: /^proxy-market/.test(geoP),           // no public premises: met at the Saturday market
        outside: m.made_in_city === false,             // made just outside the city line
        mural: String(m.subtype || '').toLowerCase() === 'mural',
        approx: /^approx/.test(geoP),
      };
      row.open_to_public = row.open_label === 'yes';
      row.hasCoords = row.lat != null && row.lng != null && !/^none/.test(geoP);
      // The map shows verified makers with real coordinates. Murals are shown with a
      // "walls change" caveat (their verification is a 2024 sighting by nature).
      row.onMap = row.hasCoords && !row.market && !row.outside && (row.verified_2026 !== false || row.mural);
      return row;
    });
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|kingston|ny|llc|inc|co|company)\b/g, ' ').replace(/\s+/g, ' ').trim();
const GENERIC = new Set(['bar', 'and', 'cafe', 'kitchen', 'studio', 'studios', 'gallery', 'shop', 'house', 'brewing', 'brewery', 'ales', 'coffee', 'bakery', 'goods', 'supply', 'company', 'arts', 'art',
  // place words: two different businesses on the Rondout are not the same business
  'rondout', 'hudson', 'broadway', 'uptown', 'midtown', 'stockade', 'wall', 'street', 'catskill', 'catskills', 'ulster', 'river', 'valley', 'esopus', 'wiltwyck']);
function metres(a, b) {
  if (a.lat == null || b.lat == null) return Infinity;
  const k = 111320, dy = (a.lat - b.lat) * k, dx = (a.lng - b.lng) * k * Math.cos(a.lat * Math.PI / 180);
  return Math.hypot(dx, dy);
}
/** Is maker `m` the same business as place `p`? */
export function sameBusiness(m, p) {
  if (m.place_id && m.place_id === p.id) return true;
  if (m.id && m.id === p.id) return true;
  const a = norm(m.name), b = norm(p.name);
  if (!a || !b) return false;
  const d = metres(m, p);
  if (a === b) return d < 1500 || d === Infinity;
  const ta = a.split(' ').filter((w) => w.length > 2 && !GENERIC.has(w));
  const tb = new Set(b.split(' ').filter((w) => w.length > 2 && !GENERIC.has(w)));
  const shared = ta.filter((w) => tb.has(w));
  if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 5 && d < 600) return true;
  return shared.length >= 1 && d < 250 && shared.join('').length >= 4;
}

/**
 * Merge makers into places. Returns {places, makers}:
 *  - places: the input places, where a matching one gains `made` (the maker row), plus
 *    one place-like item per unmatched maker (`makerOnly: true`, id `made-<id>`).
 *  - makers: every maker row, each with `pin_id` pointing at its map item.
 */
export function mergeMade(places, madeRows) {
  const out = places.map((p) => ({ ...p }));
  const makers = [];
  const market = out.find((p) => p.id === MARKET_PLACE_ID);
  for (const m of madeRows) {
    if (m.market) {
      // No public premises: list them inside the market's pin card instead of 13 stacked pins.
      if (market && m.verified_2026 !== false) (market.marketMakers ||= []).push(m);
      makers.push({ ...m, pin_id: market ? market.id : null });
      continue;
    }
    const hit = out.find((p) => !p.makerOnly && sameBusiness(m, p));
    if (hit) {
      if (m.onMap !== false) hit.made = m;
      makers.push({ ...m, pin_id: hit.id, place: hit.id });
      continue;
    }
    if (m.onMap === false || m.lat == null || m.lng == null) { makers.push({ ...m, pin_id: null }); continue; }
    const item = {
      id: `made-${m.id}`, name: m.name, category: 'made', makerOnly: true, made: m,
      lat: m.lat, lng: m.lng, neighborhood: m.neighborhood || '', ring: 'core',
      blurb: m.blurb || m.what_they_make || '', url: m.url || null,
      address: m.address || (m.where_to_buy[0] && m.where_to_buy[0].name === m.name ? m.where_to_buy[0].address : ''),
    };
    out.push(item);
    makers.push({ ...m, pin_id: item.id });
  }
  return { places: out, makers };
}

// ------------------------------------------------------------------ search (bot)
const SYN = {
  beer: ['beer', 'beers', 'brew', 'brewery', 'brewing', 'ale', 'ales', 'ipa', 'stout', 'lager', 'pils', 'taproom'],
  cider: ['cider', 'cidery'],
  spirits: ['spirits', 'distillery', 'whiskey', 'whisky', 'gin', 'vodka', 'rye', 'bourbon', 'liquor'],
  wine: ['wine', 'winery', 'vineyard'],
  coffee: ['coffee', 'roaster', 'roasters', 'roastery', 'espresso', 'beans'],
  bread: ['bread', 'bakery', 'bakeries', 'sourdough', 'pastry', 'pastries', 'baked'],
  chocolate: ['chocolate', 'candy', 'confection', 'sweets'],
  ceramics: ['ceramics', 'ceramic', 'pottery', 'potter', 'stoneware', 'clay', 'porcelain', 'mugs', 'mug', 'bowls'],
  textiles: ['textiles', 'textile', 'clothing', 'apparel', 'sewing', 'weaving', 'knit', 'denim', 'fabric'],
  wood: ['wood', 'woodwork', 'woodworking', 'furniture', 'carpentry'],
  jewelry: ['jewelry', 'jewellery', 'rings', 'silver'],
  candles: ['candles', 'candle', 'soap', 'soaps', 'apothecary', 'skincare'],
  print: ['print', 'prints', 'printmaking', 'letterpress', 'screenprint', 'risograph', 'zines', 'posters'],
  art: ['art', 'artist', 'artists', 'gallery', 'galleries', 'studio', 'studios', 'mural', 'murals', 'painting', 'paintings', 'sculpture'],
  glass: ['glass', 'glassblowing'],
  food: ['food', 'cheese', 'honey', 'hot sauce', 'pickles', 'jam', 'maple', 'pasta', 'tortillas'],
};
const LOOKUP = new Map();
for (const [k, list] of Object.entries(SYN)) for (const w of list) LOOKUP.set(w, k);

/** Does the message ask about local makers / products? */
export function makerAsk(text) {
  const t = ` ${String(text || '').toLowerCase()} `;
  if (/\bmade (in kingston|here|locally|in town|local)\b|\blocal(ly)?[- ]made\b|\bmade in\b.*\bkingston\b|\bmakers?\b|\bproducers?\b|\bartisans?\b|\bbrewed (here|in kingston|locally)\b/.test(t)) return true;
  if (/\b(local|kingston)\s+(\w+\s+)?(beer|beers|brew|brewery|breweries|cider|spirits|gin|whiskey|coffee|roaster|roasters|bread|bakery|ceramics|pottery|art|artists?|goods|gifts?|honey|chocolate|candles?|soap|prints?|jewelry|makers?)\b/.test(t)) return true;
  if (/\bwhere (can i|could i|to|do i|should i) (buy|get|find|pick up)\b/.test(t) && productWords(t).length) return true;
  if (/\blocal(ly)?\b/.test(t) && productWords(t).length) return true;
  return false;
}
export function productWords(text) {
  const t = String(text || '').toLowerCase().replace(/[^a-z ]+/g, ' ');
  const out = new Set();
  for (const w of t.split(/\s+/)) if (LOOKUP.has(w)) out.add(LOOKUP.get(w));
  if (/hot sauce/.test(t)) out.add('food');
  return [...out];
}
const rowText = (m) => `${m.name} ${m.type} ${m.subtype || ''} ${m.what_they_make || ''} ${m.blurb || ''}`.toLowerCase();

/** Rank makers for a message. Returns [{m, s}] best first (may be empty). */
export function searchMade(made, text) {
  const want = productWords(text);
  const t = String(text || '').toLowerCase();
  const hood = /\buptown|stockade\b/.test(t) ? 'uptown' : /\bmidtown\b/.test(t) ? 'midtown' : /\brondout|waterfront\b/.test(t) ? 'rondout' : null;
  const scored = [];
  for (const m of made) {
    const rt = rowText(m);
    let s = 0;
    for (const k of want) {
      if (SYN[k].some((w) => new RegExp(`\\b${w}`).test(rt))) s += 5;
      if (k === 'art' && m.type === 'art') s += 3;
      if (k === 'food' && m.type === 'food') s += 2;
    }
    if (want.length && !s) continue;
    if (hood) { if (String(m.neighborhood || '').toLowerCase().includes(hood)) s += 2; else s -= 1; }
    if (m.verified_2026) s += 0.5;
    if (m.open_to_public) s += 0.3;
    if (m.where_to_buy.length) s += 0.3;
    scored.push({ m, s });
  }
  scored.sort((a, b) => b.s - a.s || String(a.m.id).localeCompare(String(b.m.id)));
  return { want, ranked: scored };
}

/** One of each family for "what's made in Kingston". */
export function spread(ranked, n = 4) {
  const out = [], seen = new Set();
  for (const r of ranked) { const f = madeFamily(r.m.type); if (!seen.has(f) && f !== 'space') { seen.add(f); out.push(r); } if (out.length >= n) break; }
  for (const r of ranked) { if (out.length >= Math.min(3, n)) break; if (!out.includes(r)) out.push(r); }
  return out;
}
