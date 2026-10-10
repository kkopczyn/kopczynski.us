// map.js — "A View of the World from Kingston" (after Steinberg, 1976).
// Plain ES module. No framework, no build step, no styling baked in: every
// drawn element gets a `map-*` class; colours/fonts come from CSS variables
// (see map.css for the neutral defaults a brand overrides).
//
// COMPOSITION (the deliberate choice):
//   * The viewer stands at the Rondout waterfront looking roughly north-west
//     up the city. North is "up" inside the city, so the Hudson runs up the
//     RIGHT edge exactly where it really is (east of town).
//   * Foreground (y 330→980 of a 1000×1000 viewBox, ~65%): Kingston on a
//     tilted plane — rows further north are drawn narrower and more
//     compressed (simple perspective), Rondout big at the bottom, Midtown in
//     the middle, Uptown/Stockade upper-left.
//   * Everything that leaves the city frame (in any direction — including
//     SOUTH, behind the viewer) is folded onto a flat horizon band at the top.
//     Depth there is exp-compressed: 7 km and 25 km differ by ~60px.
//   * The horizon is a panorama unrolled CLOCKWISE from SSE (left) through
//     W and N to E (right): Esopus Meadows · New Paltz · Rosendale ·
//     Woodstock · Saugerties · [Hudson] · Rhinebeck. The Hudson bends from
//     the right edge toward the horizon at Saugerties, so Rhinebeck sits
//     beyond the river on the far right — our "New Jersey".
//   * Rivers that run south (behind the viewer) are drawn only inside the
//     city frame and simply leave the bottom of the picture; the Rondout
//     reappears as a squiggle on the horizon at Rosendale.

import { categoryOf, itemName, timeWindow, nextIn, hasTag, CATEGORIES } from './shared.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const DEG = Math.PI / 180;

export const FILTERS = [
  { id: 'all', label: 'Everything' },
  { id: 'tonight', label: 'Tonight' },
  { id: 'weekend', label: 'This weekend' },
  { id: 'eat', label: 'Eat' },
  { id: 'drink', label: 'Drink' },
  { id: 'see', label: 'See' },
  { id: 'outdoors', label: 'Outdoors' },
  { id: 'music', label: 'Music' },
  { id: 'shop', label: 'Shop' },
];

// ------------------------------------------------------------------ projection
export const DEFAULT_PROJECTION = {
  center: [41.927, -73.997],     // between Midtown and Uptown
  width: 1000, height: 1000,
  // city frame (km relative to centre; north/east positive)
  nSouth: -1.5, nNorth: 1.8, eWest: -3.0, eEast: 4.8,
  yFront: 980, yCity: 330,       // city occupies y ∈ [330, 980] ≈ 65%
  x0: 410, kx: 150,              // x = x0 + east_km * kx * perspectiveScale
  persp: 6,                      // km; smaller = stronger perspective
  // horizon
  yHorizon: 128, horizonDepth: 70, horizonFalloff: 5,
  panoramaStart: 135, panoramaSpan: 330, xLeft: 50, xRight: 950,
  blend: 2.2,                    // km over which the city folds into the horizon
};

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function createProjection(opts = {}) {
  const P = { ...DEFAULT_PROJECTION, ...opts };
  const [clat, clng] = P.center;
  const kmLat = 111.2, kmLng = 111.32 * Math.cos(clat * DEG);
  const T = P.nNorth - P.nSouth;
  const t0 = -P.nSouth;                                // centre row
  const gNorm = T / (T + P.persp);

  const local = (lat, lng) => ({ e: (lng - clng) * kmLng, n: (lat - clat) * kmLat });

  function city(e, n) {
    const t = n - P.nSouth;
    const g = (t / (t + P.persp)) / gNorm;
    const s = (P.persp + t0) / Math.max(t + P.persp, 0.5);
    return { x: P.x0 + e * P.kx * s, y: P.yFront - (P.yFront - P.yCity) * g, scale: s };
  }
  function far(e, n) {
    const r = Math.hypot(e, n);
    const bearing = ((Math.atan2(e, n) / DEG) + 360) % 360;
    const beta = (bearing - P.panoramaStart + 360) % 360;
    const x = P.xLeft + Math.min(beta, P.panoramaSpan) / P.panoramaSpan * (P.xRight - P.xLeft);
    const depth = Math.exp(-Math.max(r - 4, 0) / P.horizonFalloff);
    return { x, y: P.yHorizon + P.horizonDepth * depth, scale: 0.25 + 0.35 * depth };
  }
  /** How far (km) a point sits outside the city frame (≤0 = inside). */
  function overflow(e, n) {
    return Math.max(n - P.nNorth, e - P.eEast, P.eWest - e, P.nSouth - n);
  }
  /**
   * project(lat, lng, {mode}) → {x, y, scale, w}
   * mode: 'auto' (default, blends city→horizon), 'city', 'far'.
   * `w` is the horizon weight (0 = city, 1 = horizon).
   */
  function project(lat, lng, { mode = 'auto' } = {}) {
    const { e, n } = local(lat, lng);
    if (mode === 'city') return { ...city(e, n), w: 0 };
    if (mode === 'far') return { ...far(e, n), w: 1 };
    const w = smooth((overflow(e, n) + 0.2) / P.blend);
    if (w === 0) return { ...city(e, n), w };
    if (w === 1) return { ...far(e, n), w };
    // Clamp the city leg at the frame edge so the fold is a smooth bend.
    const a = city(Math.max(P.eWest, Math.min(P.eEast, e)), Math.max(P.nSouth, Math.min(P.nNorth, n)));
    const b = far(e, n);
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, scale: a.scale + (b.scale - a.scale) * w, w };
  }
  return { project, local, overflow, params: P };
}

const defaultProjection = createProjection();
/** Default Kingston projection: project(lat, lng) → {x, y, scale}. */
export const project = (lat, lng, o) => defaultProjection.project(lat, lng, o);

// ------------------------------------------------------------------ decor
// Geography-only decoration for Kingston (no brand styling). Override via opts.decor.
export const KINGSTON_DECOR = {
  zones: { core: ['Uptown/Stockade', 'Midtown', 'Rondout/Waterfront'] },
  zoneLabels: { 'Uptown/Stockade': 'UPTOWN · STOCKADE', Midtown: 'MIDTOWN', 'Rondout/Waterfront': 'RONDOUT' },
  far: [
    { text: 'Albany', lat: 42.65, lng: -73.76 },
    { text: 'Manhattan, allegedly', lat: 40.75, lng: -73.99 },
    { text: 'Catskill Park', lat: 42.10, lng: -74.30 },
    { text: 'The Gunks', lat: 41.74, lng: -74.20, hidden: true },
  ],
  hills: [ // ridge silhouettes on the horizon, by lat/lng extent
    { from: [41.80, -74.30], to: [41.70, -74.10], peak: 22 },   // Shawangunks
    { from: [41.98, -74.40], to: [42.15, -74.05], peak: 52 },   // Catskills
  ],
  roadLabels: ['Broadway'],
  regionLabels: [
    { text: 'the rest of Ulster County', x: 300, y: 300 },
    { text: 'Dutchess', x: 960, y: 300, anchor: 'end' },
  ],
  waterLabels: [
    { text: 'HUDSON RIVER', lat: 41.955, lng: -73.948, rotate: -78 },
    { text: 'Rondout Creek', lat: 41.9135, lng: -74.004, rotate: -14 },
  ],
};

// ------------------------------------------------------------------ helpers
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
const f1 = (v) => Math.round(v * 10) / 10;
const pathFrom = (pts, close) => pts.length ? 'M' + pts.map((p) => `${f1(p.x)},${f1(p.y)}`).join('L') + (close ? 'Z' : '') : '';

function catmullClosed(pts) {
  if (pts.length < 3) return pathFrom(pts, true);
  let d = `M${f1(pts[0].x)},${f1(pts[0].y)}`;
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[(i - 1 + pts.length) % pts.length], p1 = pts[i], p2 = pts[(i + 1) % pts.length], p3 = pts[(i + 2) % pts.length];
    d += `C${f1(p1.x + (p2.x - p0.x) / 6)},${f1(p1.y + (p2.y - p0.y) / 6)} ${f1(p2.x - (p3.x - p1.x) / 6)},${f1(p2.y - (p3.y - p1.y) / 6)} ${f1(p2.x)},${f1(p2.y)}`;
  }
  return d + 'Z';
}
function hull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  for (const p of pts.slice().reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
function blob(points, pad) {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  // Ring of pseudo-points so tiny/collinear groups still make a round blob.
  const ring = [];
  for (const p of points) for (let a = 0; a < 360; a += 45) ring.push({ x: p.x + pad * Math.cos(a * DEG), y: p.y + pad * 0.8 * Math.sin(a * DEG) });
  return { d: catmullClosed(hull(ring)), cx, cy };
}

/** River as a filled ribbon whose width follows the local projection scale. */
function ribbon(proj, coords, widthKm, modes) {
  const centre = coords.map(([la, ln], i) => {
    const mode = modes[i];
    const p = proj.project(la, ln, { mode });
    const q = proj.project(la, ln + 0.3 / (111.32 * Math.cos(la * DEG)), { mode });
    return { ...p, px: Math.max(Math.hypot(q.x - p.x, q.y - p.y) / 0.3, 0) };
  });
  const L = [], R = [];
  centre.forEach((p, i) => {
    const a = centre[Math.max(i - 1, 0)], b = centre[Math.min(i + 1, centre.length - 1)];
    let dx = b.x - a.x, dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const hw = Math.max(widthKm * p.px, 1.6) / 2;
    L.push({ x: p.x - dy * hw, y: p.y + dx * hw }); R.push({ x: p.x + dy * hw, y: p.y - dx * hw });
  });
  return pathFrom(L.concat(R.reverse()), true);
}

/**
 * Split a river polyline into drawable runs. North of the front edge we use the
 * blended projection (so the Hudson bends up to the horizon). South of it —
 * behind the viewer — we keep the plain city plane (the river simply leaves the
 * bottom of the picture) until the water is far enough away to reappear on the
 * horizon. Runs never bridge city ↔ horizon.
 */
function riverRuns(proj, coords) {
  const P = proj.params, runs = []; let cur = null;
  for (const c of coords) {
    const { e, n } = proj.local(c[0], c[1]);
    const r = Math.hypot(e, n);
    let mode;
    if (n >= P.nSouth + 0.2) mode = 'auto';
    else if (r > 9) mode = 'far';
    else if (n >= P.nSouth - 2.5) mode = 'city';
    else { cur = null; continue; }
    const fam = mode === 'far' ? 'far' : 'near';
    if (!cur || cur.fam !== fam) { cur = { fam, mode, coords: [], modes: [] }; runs.push(cur); }
    cur.coords.push(c); cur.modes.push(mode);
  }
  return runs.filter((r) => r.coords.length > 1);
}

// ------------------------------------------------------------------ filtering
function matchFilter(filter, item, kind, now) {
  // Recurring happy-hour listings would bury everything else: only under Drink.
  if (kind === 'event' && hasTag(item, 'happy-hour') && filter !== 'drink' && typeof filter !== 'function') return false;
  if (kind === 'event' && hasTag(item, 'sold-out')) return false;
  if (!filter || filter === 'all') return kind === 'place' || isUpcoming(item, now, 7);
  if (typeof filter === 'function') return filter(item, kind);
  if (filter === 'tonight' || filter === 'weekend') {
    return kind === 'event' && !!nextIn(item, timeWindow(filter, now));
  }
  if (CATEGORIES.includes(filter)) {
    if (kind === 'event') return categoryOf(item) === filter && isUpcoming(item, now);
    return categoryOf(item) === filter;
  }
  return true;
}
function isUpcoming(ev, now, days = 14) {
  const from = timeWindow('now', now).from;
  return !!nextIn(ev, { from, to: from + days * 86400000 });
}

// ------------------------------------------------------------------ renderMap
/**
 * renderMap(svgEl, {places, events, onSelect, filter, geo, decor, now, controls, projection})
 * Returns a controller: {setFilter, zoomBy, reset, focusItem, update, destroy, project}.
 */
export function renderMap(svg, opts = {}) {
  const state = {
    places: opts.places || [], events: opts.events || [], filter: opts.filter || 'all',
    now: opts.now || new Date(), expanded: null, selected: opts.selected || null,
  };
  // Theming knobs (all optional): labelScale multiplies label sizes, pinRadius is
  // the pin radius in screen px, controlsInset moves the zoom buttons (screen px).
  const LS = opts.labelScale || 1;
  const PIN_R = opts.pinRadius || 7;
  const CLF = opts.clusterFactor || 2.85;   // cluster radius, in pin radii
  const INSET = { right: 10, bottom: 10, ...(opts.controlsInset || {}) };
  const proj = opts.projection || createProjection(opts.projectionOptions);
  const P = proj.params;
  const decor = opts.decor || KINGSTON_DECOR;
  const geo = opts.geo || { rivers: [], roads: [] };
  const onSelect = opts.onSelect || (() => {});
  const base = { x: 0, y: 0, w: P.width, h: P.height };
  let vb = { ...base };
  const MAXZ = opts.maxZoom || 8;

  svg.replaceChildren();
  svg.classList.add('kmap');
  svg.setAttribute('viewBox', `0 0 ${P.width} ${P.height}`);
  svg.style.aspectRatio = `${P.width} / ${P.height}`;
  svg.setAttribute('role', 'application');
  svg.setAttribute('aria-roledescription', 'map');
  if (!svg.getAttribute('aria-label')) svg.setAttribute('aria-label', 'Illustrated map of Kingston and, very small, the rest of the world');
  svg.setAttribute('tabindex', '0');

  const defs = el('defs', {}, svg);
  const uid = 'km' + Math.random().toString(36).slice(2, 7);
  const grad = el('linearGradient', { id: `${uid}-far`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0', class: 'map-stop-far' }, grad);
  el('stop', { offset: '1', class: 'map-stop-near' }, grad);
  const blur = el('filter', { id: `${uid}-soft`, x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
  el('feGaussianBlur', { stdDeviation: 6 }, blur);
  const clip = el('clipPath', { id: `${uid}-clip` }, defs);
  el('rect', { x: 0, y: 0, width: P.width, height: P.height }, clip);

  const world = el('g', { class: 'map-world', 'clip-path': `url(#${uid}-clip)` }, svg);
  const L = {};
  for (const name of ['sky', 'land', 'zones', 'roads', 'water', 'labels', 'horizon', 'pins', 'tip']) L[name] = el('g', { class: `map-layer map-layer--${name}` }, world);
  const controlsG = el('g', { class: 'map-controls' }, svg);

  // ---- static base -------------------------------------------------------
  function drawBase() {
    const tsBase = Math.sqrt(base.w / (svg.clientWidth || base.w)) * LS;
    const unitPx = (svg.clientWidth || P.width) / base.w;     // screen px per viewBox unit at the base view
    const pinU = PIN_R / unitPx;                                // pin radius in viewBox units
    const toPlace = [];                                         // labels for the collision pass
    svg.style.setProperty('--map-ts', f1(tsBase * 100) / 100);
    for (const k of ['sky', 'land', 'zones', 'roads', 'water', 'labels', 'horizon']) L[k].replaceChildren();
    el('rect', { class: 'map-sky', x: 0, y: 0, width: P.width, height: P.yHorizon }, L.sky);
    el('rect', { class: 'map-land', x: 0, y: P.yHorizon, width: P.width, height: P.height - P.yHorizon }, L.land);
    el('rect', { class: 'map-land-far', x: 0, y: P.yHorizon, width: P.width, height: P.yCity - P.yHorizon + 40, fill: `url(#${uid}-far)` }, L.land);

    // Hills on the horizon.
    for (const h of decor.hills || []) {
      const a = proj.project(...h.from, { mode: 'far' }), b = proj.project(...h.to, { mode: 'far' });
      const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), steps = 9, pts = [{ x: x1 - 20, y: P.yHorizon }];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, x = x1 + (x2 - x1) * t;
        const bump = Math.sin(t * Math.PI) * h.peak * (0.65 + 0.35 * Math.abs(Math.sin(i * 2.3)));
        pts.push({ x, y: P.yHorizon - bump });
      }
      pts.push({ x: x2 + 20, y: P.yHorizon });
      el('path', { class: 'map-hills', d: pathFrom(pts, true) }, L.sky);
    }
    el('line', { class: 'map-horizon', x1: 0, y1: P.yHorizon, x2: P.width, y2: P.yHorizon }, L.horizon);

    // Neighbourhood zones (core).
    const core = new Set(decor.zones?.core || []);
    const groups = {};
    for (const p of state.places) if (core.has(p.neighborhood)) (groups[p.neighborhood] ||= []).push(proj.project(p.lat, p.lng));
    for (const [name, pts] of Object.entries(groups)) {
      const b = blob(pts, 34);
      const slug = name.toLowerCase().replace(/[^a-z]+/g, '-');
      el('path', { class: `map-zone map-zone--${slug}`, d: b.d, filter: `url(#${uid}-soft)` }, L.zones);
      const near = [...pts].sort((p, q) => Math.hypot(p.x - b.cx, p.y - b.cy) - Math.hypot(q.x - b.cx, q.y - b.cy)).slice(0, Math.ceil(pts.length * 0.7));
      const lx = near.reduce((s, p) => s + p.x, 0) / near.length;
      const halfW = (decor.zoneLabels?.[name] || name).length * 5.6 * tsBase;
      const t = el('text', { class: 'map-zone-label', x: f1(Math.max(halfW + 6, Math.min(P.width - halfW - 6, lx))), y: f1(Math.min(...near.map((p) => p.y)) - 24), 'text-anchor': 'middle' }, L.labels);
      t.textContent = decor.zoneLabels?.[name] || name;
      toPlace.push({ t, step: 9, prio: 0 });
    }

    // Street texture: dense in the city, nothing beyond it (the Steinberg contrast).
    let sd = '';
    for (const st of geo.streets || []) {
      const pts = st.map(([la, ln]) => proj.project(la, ln));
      if (pts.some((p) => p.w > 0.05)) continue;
      sd += pathFrom(pts);
    }
    if (sd) el('path', { class: 'map-street', d: sd }, L.roads);

    // Roads (city only; they fade out at the frame edge).
    const longest = {};
    for (const r of geo.roads || []) {
      const runs = []; let cur = [];
      for (const [la, ln] of r.coords) {
        const p = proj.project(la, ln);
        if (p.w > 0.35) { if (cur.length > 1) runs.push(cur); cur = []; continue; }
        cur.push(p);
      }
      if (cur.length > 1) runs.push(cur);
      for (const run of runs) {
        el('path', { class: `map-road map-road--${r.class || 'minor'}`, d: pathFrom(run) }, L.roads);
        const len = run.reduce((s, p, i) => s + (i ? Math.hypot(p.x - run[i - 1].x, p.y - run[i - 1].y) : 0), 0);
        if (!longest[r.name] || longest[r.name].len < len) longest[r.name] = { run, len };
      }
    }
    for (const name of decor.roadLabels || []) {
      // Label along the longest nearly-straight stretch (avoids broken letters on bends).
      const best = longest[name]; if (!best) continue;
      // ...and, among those, the one with the fewest pins on it.
      const obs = obstacles();
      let seg = null;
      for (let i = 0; i < best.run.length - 1; i++) {
        let j = i + 1;
        const a0 = Math.atan2(best.run[j].y - best.run[i].y, best.run[j].x - best.run[i].x);
        while (j + 1 < best.run.length && Math.abs(Math.atan2(best.run[j + 1].y - best.run[j].y, best.run[j + 1].x - best.run[j].x) - a0) < 0.18) j++;
        const a = best.run[i], b = best.run[j];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 70) continue;
        const hits = obs.filter((o) => segDist(o, a, b) < pinU * 1.6 + 6).length;
        const score = len - hits * 45;
        if (!seg || score > seg.score) seg = { a, b, len, score };
      }
      if (!seg || seg.len < 70) continue;
      let run = [seg.a, seg.b]; if (run[0].x > run[1].x) run = run.reverse();
      const id = `${uid}-road-${name.replace(/\W+/g, '')}`;
      el('path', { id, d: pathFrom(run), fill: 'none', stroke: 'none' }, L.labels);
      const t = el('text', { class: 'map-road-label', dy: -5 }, L.labels);
      const tp = el('textPath', { href: `#${id}`, startOffset: '50%', 'text-anchor': 'middle' }, t);
      tp.textContent = name.toUpperCase();
    }

    // Rivers.
    for (const river of geo.rivers || []) {
      for (const run of riverRuns(proj, river.coords)) {
        if (run.fam === 'far' && river.farRuns === false) continue;
        el('path', { class: `map-water map-water--${river.id}`, d: ribbon(proj, run.coords, river.width_km || 0.1, run.modes) }, L.water);
      }
    }
    for (const w of decor.waterLabels || []) {
      const p = proj.project(w.lat, w.lng);
      const t = el('text', { class: 'map-water-label', x: f1(p.x), y: f1(p.y), 'text-anchor': 'middle', transform: w.rotate ? `rotate(${w.rotate} ${f1(p.x)} ${f1(p.y)})` : null }, L.labels);
      t.textContent = w.text;
      toPlace.push({ t, step: 10, rot: w.rotate || 0, prio: 1, axis: Math.abs(w.rotate || 0) > 45 ? 'y' : 'x' });   // slide along the water, never onto land
    }
    for (const r of decor.regionLabels || []) {
      const t = el('text', { class: 'map-region-label', x: r.x, y: r.y, 'text-anchor': r.anchor || 'start' }, L.labels);
      t.textContent = r.text;
      toPlace.push({ t, step: 10, prio: 2 });
    }
    // Decorative symbols (e.g. <use href="#s-light">): anchored bottom-centre at a
    // lat/lng, or at fixed viewBox x/y. Purely visual: aria-hidden, no pointer events.
    for (const s of decor.symbols || []) {
      const p = s.lat != null ? proj.project(s.lat, s.lng, { mode: s.mode || 'auto' }) : { x: s.x, y: s.y };
      if (s.onHorizon) p.y = P.yHorizon;   // stand it on the horizon line (rooftops, steeples)
      const w = s.w || 24, h = s.h || w;
      el('use', { class: `map-symbol ${s.class || ''}`.trim(), href: s.href, x: f1(p.x - w / 2 + (s.dx || 0)), y: f1(p.y - h + (s.dy || 0)), width: w, height: h, 'aria-hidden': 'true' }, L.labels);
    }

    // Outlying towns: places folded onto the horizon get a horizon label;
    // places still inside the city frame (e.g. just across the creek) get a
    // small in-city label instead.
    const towns = {}, nearTowns = {};
    for (const p of state.places) {
      if (core.has(p.neighborhood) || !p.neighborhood || p.makerOnly) continue;   // maker-only pins never name a town
      const pr = proj.project(p.lat, p.lng);
      ((pr.w > 0.5 ? towns : nearTowns)[p.neighborhood] ||= []).push({ ...pr, label: itemName(p).split(/\s+/).slice(0, 2).join(' ') });
    }
    for (const [name, pts] of Object.entries(nearTowns)) {
      const t = el('text', { class: 'map-town-label map-town-label--near', x: f1(pts.reduce((s, p) => s + p.x, 0) / pts.length), y: f1(Math.max(...pts.map((p) => p.y)) + 24), 'text-anchor': 'middle' }, L.labels);
      t.textContent = name.toUpperCase();
      toPlace.push({ t, step: 8, prio: 3 });
    }
    const tl = Object.entries(towns).map(([name, pts]) => ({ name: nearTowns[name] ? (pts.length === 1 ? pts[0].label : `${name} (further)`) : name, x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: Math.min(...pts.map((p) => p.y)) }))
      .sort((a, b) => a.x - b.x);
    const farLabels = (decor.far || []).filter((f) => !f.hidden).map((f) => ({ name: f.text, ...proj.project(f.lat, f.lng, { mode: 'far' }), far: true }));
    // Horizon towns: two staggered baselines just above the horizon, clear of the
    // pins that sit on it. Far-off jokes: up to three rows at the top of the sky.
    // Widths are measured, not guessed.
    const rowsY = {
      town: [P.yHorizon - pinU - 5 * tsBase, P.yHorizon - pinU - 5 * tsBase - 14 * tsBase],
      far: [0, 1, 2].map((r) => (decor.farTop ?? 18) * tsBase + r * 19 * tsBase),
    };
    const lastRight = { town: rowsY.town.map(() => -Infinity), far: rowsY.far.map(() => -Infinity) };
    const gap = 16 * tsBase;
    for (const t of [...tl, ...farLabels].sort((a, b) => a.x - b.x)) {
      const kind = t.far ? 'far' : 'town';
      const txt = el('text', { class: t.far ? 'map-far-label' : 'map-town-label', x: 0, y: 0, 'text-anchor': 'middle' }, L.horizon);
      txt.textContent = t.far ? t.name : t.name.toUpperCase();
      let width = t.name.length * (t.far ? 7 : 9) * tsBase;
      try { const bb = txt.getBBox(); if (bb.width) width = bb.width; } catch { /* not rendered yet */ }
      const lr = lastRight[kind];
      const clampX = (x) => Math.max(width / 2 + 4, Math.min(P.width - width / 2 - 4, x));
      let cx = clampX(t.x);
      let row = lr.findIndex((r) => cx - width / 2 > r + gap);
      if (row < 0) {   // no free row: nudge right on the row that frees up first
        row = lr.indexOf(Math.min(...lr));
        cx = clampX(Math.max(cx, lr[row] + gap + width / 2));
      }
      lr[row] = cx + width / 2;
      const ly = rowsY[kind][row];
      txt.setAttribute('x', f1(cx)); txt.setAttribute('y', f1(ly));
      if (!t.far) el('line', { class: 'map-town-leader', x1: f1(t.x), y1: f1(ly + 3), x2: f1(t.x), y2: f1(t.y - pinU - 1) }, L.horizon);
    }

    // ---- label collision pass: nudge in-city labels off pins and off each other.
    placeLabels(toPlace, pinU);
  }

  function obstacles() {
    const out = [];
    for (const p of state.places) if (!p.makerOnly) { const q = proj.project(p.lat, p.lng); if (q.w < 0.5) out.push(q); }
    for (const e of state.events) {
      if (e.lat == null || !matchFilter('all', e, 'event', state.now)) continue;
      const q = proj.project(e.lat, e.lng); if (q.w < 0.5) out.push(q);
    }
    return out;
  }
  function segDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  function placeLabels(list, pinU) {
    const obs = obstacles();
    const placed = [];
    const box = (t, rot) => {
      let b; try { b = t.getBBox(); } catch { return null; }
      if (!b || !b.width) return null;
      if (!rot) return { x: b.x, y: b.y, w: b.width, h: b.height };
      const cx = +t.getAttribute('x'), cy = +t.getAttribute('y'), r = rot * DEG;
      const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
        .map(([x, y]) => [cx + (x - cx) * Math.cos(r) - (y - cy) * Math.sin(r), cy + (x - cx) * Math.sin(r) + (y - cy) * Math.cos(r)]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    };
    const ov = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const cost = (b) => {
      let c = 0;
      const m = pinU * 1.7;
      for (const o of obs) if (o.x > b.x - m && o.x < b.x + b.w + m && o.y > b.y - m && o.y < b.y + b.h + m) c += 4;
      for (const q of placed) c += 12 * ov(b, q) / Math.max(1, b.w * b.h);
      if (b.x < 2 || b.x + b.w > P.width - 2) c += 6;
      if (b.y < P.yHorizon + 4 || b.y + b.h > P.height - 2) c += 6;
      return c;
    };
    const move = (t, rot, x, y) => {
      t.setAttribute('x', f1(x)); t.setAttribute('y', f1(y));
      if (rot) t.setAttribute('transform', `rotate(${rot} ${f1(x)} ${f1(y)})`);
    };
    for (const L0 of [...list].sort((a, b) => a.prio - b.prio)) {
      const { t, rot = 0 } = L0;
      const x0 = +t.getAttribute('x'), y0 = +t.getAttribute('y');
      const b0 = box(t, rot); if (!b0) continue;
      const step = Math.max(L0.step, b0.h * 0.6);
      let best = { c: cost(b0), x: x0, y: y0, b: b0 };
      if (best.c > 0) {
        for (const dy of [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6]) for (const dx of [0, -1, 1, -2, 2, -3, 3]) {
          if (!dx && !dy) continue;
          if ((L0.axis === 'y' && dx) || (L0.axis === 'x' && dy)) continue;
          const b = { ...b0, x: b0.x + dx * step * 1.6, y: b0.y + dy * step };
          const c = cost(b) + (Math.abs(dx) * 1.6 + Math.abs(dy)) * 0.18;
          if (c < best.c) best = { c, x: x0 + dx * step * 1.6, y: y0 + dy * step, b };
        }
        move(t, rot, best.x, best.y);
      }
      placed.push(best.b);
    }
  }

  // ---- pins ----------------------------------------------------------------
  function items() {
    const out = [];
    for (const p of state.places) if (matchFilter(state.filter, p, 'place', state.now)) out.push({ item: p, kind: 'place' });
    for (const e of state.events) {
      if (e.lat == null || e.lng == null) continue;
      if (matchFilter(state.filter, e, 'event', state.now)) out.push({ item: e, kind: 'event' });
    }
    for (const o of out) { const p = proj.project(o.item.lat, o.item.lng); o.x = p.x; o.y = p.y; o.w = p.w; }
    return out;
  }
  const pxPerUnit = () => (svg.clientWidth || svg.getBoundingClientRect().width || P.width) / vb.w;

  function cluster(list, radius) {
    const sorted = [...list].sort((a, b) => a.y - b.y || a.x - b.x);
    const clusters = [];
    for (const it of sorted) {
      let best = null, bd = radius;
      for (const c of clusters) { const d = Math.hypot(c.x - it.x, c.y - it.y); if (d < bd) { bd = d; best = c; } }
      if (best) { best.members.push(it); const n = best.members.length; best.x += (it.x - best.x) / n; best.y += (it.y - best.y) / n; }
      else clusters.push({ x: it.x, y: it.y, members: [it] });
    }
    for (const c of clusters) c.key = c.members.map((m) => m.item.id).sort().join('|');
    return clusters;
  }

  function label(it) {
    if (opts.pinLabel) { const l = opts.pinLabel(it.item, it.kind); if (l) return l; }
    const cat = categoryOf(it.item);
    return `${itemName(it.item)} — ${it.kind === 'event' ? 'event' : cat}${it.item.neighborhood ? ', ' + it.item.neighborhood : ''}`;
  }

  function makeButton(parent, cls, ariaLabel, onActivate) {
    const g = el('g', { class: cls, role: 'button', tabindex: '0', 'aria-label': ariaLabel, focusable: 'true' }, parent);
    g.addEventListener('click', (ev) => { if (dragMoved) return; ev.stopPropagation(); onActivate(ev); });
    g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); onActivate(ev); } });
    return g;
  }

  function drawPin(parent, it, x, y, r) {
    const cat = categoryOf(it.item);
    const sel = state.selected === it.item.id;
    // opts.pinStyle(item, kind) → {shape: circle|diamond|square|triangle, cls} lets a page restyle a layer.
    const st = (opts.pinStyle && opts.pinStyle(it.item, it.kind, state.filter)) || {};
    const pulse = st.pulse ? true : false;
    const shape = st.shape || (it.kind === 'event' ? 'diamond' : 'circle');
    const g = makeButton(parent, `map-pin map-pin--${it.kind} map-pin--${cat}${st.cls ? ' ' + st.cls : ''}${sel ? ' is-selected' : ''}`, label(it), () => onSelect(it.item, { kind: it.kind }));
    if (sel) g.setAttribute('aria-current', 'true');
    g.dataset.id = it.item.id;
    if (pulse) el('circle', { class: 'map-pin-pulse', cx: f1(x), cy: f1(y), r: f1(r) }, g);
    if (shape === 'diamond') {
      el('path', { class: 'map-pin-shape', d: `M${f1(x)},${f1(y - r * 1.25)}L${f1(x + r * 1.1)},${f1(y)}L${f1(x)},${f1(y + r * 1.25)}L${f1(x - r * 1.1)},${f1(y)}Z` }, g);
    } else if (shape === 'square') {
      const k = r * 0.9;
      el('rect', { class: 'map-pin-shape', x: f1(x - k), y: f1(y - k), width: f1(2 * k), height: f1(2 * k), rx: f1(r * 0.18) }, g);
    } else if (shape === 'triangle') {
      const k = r * 1.25;
      el('path', { class: 'map-pin-shape', d: `M${f1(x)},${f1(y - k)}L${f1(x + k * 0.95)},${f1(y + k * 0.62)}L${f1(x - k * 0.95)},${f1(y + k * 0.62)}Z` }, g);
    } else {
      el('circle', { class: 'map-pin-shape', cx: f1(x), cy: f1(y), r: f1(r) }, g);
    }
    if (st.glyph) {
      const gt = el('text', { class: 'map-pin-glyph', x: f1(x), y: f1(y + r * 0.05), 'text-anchor': 'middle', 'dominant-baseline': 'central', style: `font-size:${f1(r * (shape === 'triangle' ? 0.95 : 1.15))}px` }, g);
      gt.textContent = st.glyph;
      if (shape === 'triangle') gt.setAttribute('y', f1(y + r * 0.25));
    }
    const t = el('title', {}, g); t.textContent = itemName(it.item);
    g.addEventListener('pointerenter', () => showTip(it, x, y, r));
    g.addEventListener('focus', () => showTip(it, x, y, r));
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('blur', hideTip);
    return g;
  }

  function showTip(it, x, y, r) {
    L.tip.replaceChildren();
    const u = 1 / pxPerUnit();
    const txt = el('text', { class: 'map-tip', x: f1(x), y: f1(y - r - 8 * u), 'text-anchor': 'middle', style: `font-size:${f1(13 * u)}px` }, L.tip);
    txt.textContent = itemName(it.item);
  }
  function hideTip() { L.tip.replaceChildren(); }

  function drawPins() {
    L.pins.replaceChildren(); hideTip();
    const u = 1 / pxPerUnit();                 // viewBox units per screen px
    const r = PIN_R * u;
    const list = items();
    const clusters = cluster(list, PIN_R * CLF * u);
    const order = [...clusters].sort((a, b) => a.y - b.y || a.x - b.x);
    if (state.selected) order.sort((a, b) => (a.members.length === 1 && a.members[0].item.id === state.selected) - (b.members.length === 1 && b.members[0].item.id === state.selected));
    for (const c of order) {
      if (c.members.length === 1) { drawPin(L.pins, c.members[0], c.x, c.y, r); continue; }
      const spread = Math.max(...c.members.map((m) => Math.hypot(m.x - c.x, m.y - c.y)));
      const colocated = spread * pxPerUnit() < 2 || vb.w <= base.w / MAXZ + 1;
      if (state.expanded === c.key) {
        const ring = Math.max(18 * u, (c.members.length * 17 * u) / (2 * Math.PI));
        const g = el('g', { class: 'map-spider' }, L.pins);
        el('circle', { class: 'map-spider-ring', cx: f1(c.x), cy: f1(c.y), r: f1(ring) }, g);
        c.members.forEach((m, i) => {
          const a = -Math.PI / 2 + (i / c.members.length) * 2 * Math.PI;
          const px = c.x + ring * Math.cos(a), py = c.y + ring * Math.sin(a);
          el('line', { class: 'map-spider-leg', x1: f1(c.x), y1: f1(c.y), x2: f1(px), y2: f1(py) }, g);
          drawPin(g, m, px, py, r);
        });
        continue;
      }
      const names = c.members.slice(0, 4).map((m) => itemName(m.item)).join(', ');
      const g = makeButton(L.pins, 'map-cluster', `${c.members.length} places here: ${names}${c.members.length > 4 ? '…' : ''}. Activate to ${colocated ? 'expand' : 'zoom in'}.`, () => {
        if (colocated) { state.expanded = c.key; drawPins(); focusFirstIn(c.key); }
        else zoomAt(c.x, c.y, Math.min(2.5, vb.w / (base.w / MAXZ)));
      });
      const cr = r * (opts.clusterGrowth === false ? 1.15 : 1.1 + Math.min(c.members.length, 12) / 40);   // capped: a big cluster is at most ~1.4 pins wide
      el('circle', { class: 'map-cluster-shape', cx: f1(c.x), cy: f1(c.y), r: f1(cr) }, g);
      const t = el('text', { class: 'map-cluster-count', x: f1(c.x), y: f1(c.y + 0.5 * u), 'text-anchor': 'middle', 'dominant-baseline': 'central', style: `font-size:${f1(Math.min(11, PIN_R * 1.15) * u)}px` }, g);
      t.textContent = c.members.length;
    }
    svg.dispatchEvent(new CustomEvent('kmap:render', { detail: { count: list.length } }));
  }
  function focusFirstIn() { const p = L.pins.querySelector('.map-spider .map-pin'); if (p) p.focus(); }

  // ---- controls (SVG, fixed to the viewport) --------------------------------
  function drawControls() {
    controlsG.replaceChildren();
    if (opts.controls === false) return;
    const u = vb.w / (svg.clientWidth || P.width);
    const s = 38 * u, gap = 6 * u, x = INSET.left != null ? vb.x + INSET.left * u : vb.x + vb.w - s - INSET.right * u;
    let y = INSET.top != null ? vb.y + INSET.top * u : vb.y + vb.h - (s * 3 + gap * 2) - INSET.bottom * u;
    for (const [sym, lab, fn] of [['+', 'Zoom in', () => zoomBy(1.6)], ['−', 'Zoom out', () => zoomBy(1 / 1.6)], ['⟲', 'Reset map', () => reset()]]) {
      const g = makeButton(controlsG, 'map-ctl', lab, fn);
      el('rect', { class: 'map-ctl-bg', x: f1(x), y: f1(y), width: f1(s), height: f1(s), rx: f1(8 * u) }, g);
      const t = el('text', { class: 'map-ctl-sym', x: f1(x + s / 2), y: f1(y + s / 2), 'text-anchor': 'middle', 'dominant-baseline': 'central', style: `font-size:${f1(20 * u)}px` }, g);
      t.textContent = sym;
      y += s + gap;
    }
  }

  // ---- view box --------------------------------------------------------------
  function clampVB(v) {
    const w = Math.max(base.w / MAXZ, Math.min(base.w, v.w)), h = w * base.h / base.w;
    return { w, h, x: Math.max(base.x, Math.min(base.x + base.w - w, v.x)), y: Math.max(base.y, Math.min(base.y + base.h - h, v.y)) };
  }
  let raf = 0;
  function applyVB(redraw = true) {
    svg.setAttribute('viewBox', `${f1(vb.x)} ${f1(vb.y)} ${f1(vb.w)} ${f1(vb.h)}`);
    svg.style.touchAction = vb.w < base.w - 1 ? 'none' : 'pan-y';
    svg.style.setProperty('--map-ts', f1(Math.sqrt(vb.w / (svg.clientWidth || base.w)) * LS * 100) / 100);
    drawControls();
    if (redraw) { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawPins); }
  }
  function zoomAt(cx, cy, factor) {
    const w = vb.w / factor, h = vb.h / factor;
    vb = clampVB({ w, h, x: cx - (cx - vb.x) * (w / vb.w), y: cy - (cy - vb.y) * (h / vb.h) });
    if (vb.w < base.w - 1 === false) state.expanded = null;
    applyVB();
  }
  function zoomBy(f) { zoomAt(vb.x + vb.w / 2, vb.y + vb.h / 2, f); }
  function reset() { vb = { ...base }; state.expanded = null; applyVB(); }

  // ---- pointer pan / pinch -----------------------------------------------------
  const pointers = new Map();
  let dragMoved = false, startDist = 0, startVB = null, startMid = null, downAt = null;
  const toVB = (cx, cy) => { const r = svg.getBoundingClientRect(); return { x: vb.x + (cx - r.left) / r.width * vb.w, y: vb.y + (cy - r.top) / r.height * vb.h }; };
  function onDown(ev) {
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    startVB = { ...vb }; downAt = { x: ev.clientX, y: ev.clientY }; dragMoved = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      startDist = Math.hypot(a.x - b.x, a.y - b.y); startMid = toVB((a.x + b.x) / 2, (a.y + b.y) / 2);
    }
  }
  function onMove(ev) {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const rect = svg.getBoundingClientRect(); const k = vb.w / rect.width;
    if (pointers.size === 1 && startVB) {
      const dx = ev.clientX - downAt.x, dy = ev.clientY - downAt.y;
      if (!dragMoved && Math.hypot(dx, dy) < 6) return;
      if (!dragMoved) { dragMoved = true; try { svg.setPointerCapture(ev.pointerId); } catch { /* noop */ } }
      if (startVB.w >= base.w - 1) return;                 // nothing to pan at full view
      vb = clampVB({ ...startVB, x: startVB.x - dx * k, y: startVB.y - dy * k }); applyVB(false);
    } else if (pointers.size === 2) {
      dragMoved = true;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y); if (!startDist) return;
      const f = d / startDist, w = startVB.w / f, h = startVB.h / f;
      vb = clampVB({ w, h, x: startMid.x - (startMid.x - startVB.x) * (w / startVB.w), y: startMid.y - (startMid.y - startVB.y) * (h / startVB.h) });
      applyVB(false);
    }
  }
  function onUp(ev) {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) startDist = 0;
    if (pointers.size === 0) { if (dragMoved) applyVB(); setTimeout(() => { dragMoved = false; }, 0); }
    else { startVB = { ...vb }; const p = [...pointers.values()][0]; downAt = { x: p.x, y: p.y }; }
  }
  function onWheel(ev) {
    if (!ev.ctrlKey && !ev.metaKey) return;            // leave page scroll alone
    ev.preventDefault();
    const p = toVB(ev.clientX, ev.clientY); zoomAt(p.x, p.y, Math.exp(-ev.deltaY * 0.01));
  }
  function onKey(ev) {
    if (ev.target !== svg) return;
    const step = vb.w * 0.12;
    const m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
    if (m) { ev.preventDefault(); vb = clampVB({ ...vb, x: vb.x + m[0], y: vb.y + m[1] }); applyVB(); }
    else if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); zoomBy(1.6); }
    else if (ev.key === '-') { ev.preventDefault(); zoomBy(1 / 1.6); }
    else if (ev.key === '0') { ev.preventDefault(); reset(); }
    else if (ev.key === 'Escape' && state.expanded) { state.expanded = null; drawPins(); }
  }
  function onBgClick(ev) { if (!dragMoved && state.expanded && !ev.target.closest('.map-pin')) { state.expanded = null; drawPins(); } }
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onUp);
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('keydown', onKey);
  svg.addEventListener('click', onBgClick);
  let lastW = 0;
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
    const w = svg.clientWidth; if (Math.abs(w - lastW) > 30) { lastW = w; drawBase(); } applyVB();
  }) : null;
  ro?.observe(svg);

  drawBase(); applyVB(false); drawPins();
  // Label widths depend on web fonts: lay the base out again once they've loaded.
  let alive = true;
  document.fonts?.ready?.then(() => { if (alive && svg.isConnected) { drawBase(); drawPins(); } });

  return {
    project: proj.project,
    setFilter(f) { state.filter = f; state.expanded = null; drawPins(); },
    getFilter: () => state.filter,
    setSelected(id) { state.selected = id || null; drawPins(); },
    setControlsInset(o) { Object.assign(INSET, o || {}); drawControls(); },
    setNow(d) { state.now = d; drawPins(); },
    update({ places, events } = {}) { if (places) state.places = places; if (events) state.events = events; drawBase(); drawPins(); },
    zoomBy, reset,
    focusItem(id) {
      const it = items().find((o) => o.item.id === id); if (!it) return false;
      vb = clampVB({ w: base.w / 4, h: base.h / 4, x: it.x - base.w / 8, y: it.y - base.h / 8 }); applyVB(false); drawPins();
      const pin = L.pins.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (pin) pin.focus(); else { const c = cluster(items(), PIN_R * CLF / pxPerUnit()).find((c) => c.members.some((m) => m.item.id === id)); if (c) { state.expanded = c.key; drawPins(); L.pins.querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus(); } }
      return true;
    },
    destroy() {
      alive = false;
      ro?.disconnect();
      svg.removeEventListener('pointerdown', onDown); svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp); svg.removeEventListener('pointercancel', onUp);
      svg.removeEventListener('wheel', onWheel); svg.removeEventListener('keydown', onKey); svg.removeEventListener('click', onBgClick);
      svg.replaceChildren();
    },
  };
}

/** Optional helper: HTML filter chips bound to a map controller. */
export function renderFilterChips(container, controller, { filters = FILTERS, onChange } = {}) {
  container.replaceChildren();
  container.setAttribute('role', 'toolbar');
  container.setAttribute('aria-label', 'Filter the map');
  const buttons = filters.map((f) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'map-chip'; b.textContent = f.label; b.dataset.filter = f.id;
    b.setAttribute('aria-pressed', String(controller.getFilter() === f.id));
    b.addEventListener('click', () => {
      const next = controller.getFilter() === f.id && f.id !== 'all' ? 'all' : f.id;
      controller.setFilter(next);
      buttons.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.filter === next)));
      onChange?.(next);
    });
    container.appendChild(b);
    return b;
  });
  return buttons;
}
