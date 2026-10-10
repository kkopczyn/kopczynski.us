// wick.js — /wick/: the Text Wick demo (bot.js in an SMS thread).
import { reply } from './bot.js';
import { initChrome, loadData, track, EVENT_LINES } from './kc.js';
import { normaliseMade, mergeMade } from './made.js';

initChrome();
const qs = new URLSearchParams(location.search);
const now = () => (qs.get('now') ? new Date(qs.get('now')) : new Date());
const COPY = {
  name: 'Wick', org: 'Kingston Crew', editor: 'Konrad', eventLines: EVENT_LINES,
  help: () => 'Kingston Crew: a no-ads guide to Kingston, NY. I\'m Wick, a bot. Ask me "tonight," "weekend," "coffee," "free," or any place name. Text HUMAN for a person. Up to 2 msgs/week. Msg & data rates may apply. Reply STOP to cancel.',
  stop: () => "Kingston Crew: You're unsubscribed and won't get any more texts from us. Reply START to rejoin. Thanks for being part of the Crew.",
  start: () => 'Welcome back to Kingston Crew. Up to 2 msgs/week. Msg & data rates may apply. Reply STOP to cancel, HELP for help.',
  human: () => 'Passing you to Konrad, a real person. He usually replies within a day. – Wick (bot)',
  greeting: () => "Hi, I'm Wick, the Kingston Crew bot. Ask me what's on tonight, where to eat, or what to do with a rainy Saturday.",
  offlane: () => "That's outside my lane. Kingston Crew covers where to go and what to do, not the news. Hudson Valley One and the Daily Freeman cover that.",
};

const thread = document.getElementById('thread');
const sugg = document.getElementById('suggest');
const input = document.getElementById('msg');
let data = { places: [], events: [] }, made = [];
try {
  data = await loadData();
  try { const r = await fetch('../data/made.json'); if (r.ok) { const m = mergeMade(data.places, normaliseMade(await r.json())); data.places = m.places; made = m.makers; } } catch { /* optional */ }
} catch { /* the bot still answers commands */ }
const byId = new Map([...data.places, ...data.events, ...made].map((x) => [x.id, x]));

const add = (cls, text) => { const d = document.createElement('div'); d.className = `msg ${cls}`; d.textContent = text; thread.append(d); thread.scrollTop = thread.scrollHeight; return d; };
const stamp = (text) => { const s = document.createElement('div'); s.className = 'stamp'; s.textContent = text; thread.append(s); };
function setSugg(list) {
  sugg.replaceChildren(...list.map((t) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = t; b.onclick = () => send(t); return b; }));
}
function showPicks(ids) {
  const wrap = document.createElement('div'); wrap.className = 'picks';
  for (const id of ids) {
    const it = byId.get(id); if (!it) continue;
    const a = document.createElement('a'); a.className = 'pick';
    a.href = it.lat != null || it.pin_id ? `../?pin=${encodeURIComponent(it.pin_id || id)}` : `../made/#${encodeURIComponent(id)}`;
    a.textContent = (it.name || it.title) + ' ';
    const s = document.createElement('span'); s.textContent = (it.neighborhood || it.venue || '').replace('/Stockade', '').replace('/Waterfront', '') + ' · on the map →'; a.append(s);
    wrap.append(a);
  }
  if (wrap.children.length) { thread.append(wrap); thread.scrollTop = thread.scrollHeight; }
}
function send(text) {
  text = String(text).trim(); if (!text) return;
  add('out', text);
  const typing = document.createElement('div'); typing.className = 'typing'; typing.textContent = 'Wick is typing…'; thread.append(typing);
  const r = reply(text, { places: data.places, events: data.events, made, now: now(), copy: COPY });
  track('kc_wick_message', { intent: r.intent, picks: r.picks.length });
  setTimeout(() => {
    typing.remove(); add('in', r.text); showPicks(r.picks); setSugg(r.followups);
    if (r.intent === 'human') stamp('Demo: nothing is sent. On the real line, this reaches Konrad.');
    if (r.intent === 'stop') stamp('Demo: no number is subscribed yet.');
  }, qs.has('instant') ? 0 : 450);
}
stamp(now().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ' · Kingston');
add('in', "Hi, I'm Wick, the Kingston Crew bot. Ask me what's on tonight, where to eat, or what to do with a rainy Saturday. I only suggest places on our map and events from credited listings. Text HUMAN to reach Konrad, HELP for help, STOP to unsubscribe. – Wick (bot)");
setSugg(["What's on tonight?", 'Rainy Saturday ideas', 'Best coffee Uptown', 'Kid-friendly this weekend', 'Something free', "What's made in Kingston?"]);
document.getElementById('compose').addEventListener('submit', (e) => { e.preventDefault(); send(input.value); input.value = ''; });
const script = (qs.get('script') || '').split('|').filter(Boolean);
if (script.length) script.forEach(send);
else { stamp('Example'); const r = reply("What's on tonight?", { places: data.places, events: data.events, made, now: now(), copy: COPY }); add('out', "What's on tonight?"); add('in', r.text); showPicks(r.picks); setSugg(r.followups.concat(["What's made in Kingston?"])); }
