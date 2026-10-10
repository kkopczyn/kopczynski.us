// brick.js — /brick/: pick a nominee, then vote with a phone or email (demo).
import { initChrome, save, saveFailed, cleanPhone, cleanEmail, CONSENT_TEXT } from './kc.js';

initChrome();
const $ = (s) => document.querySelector(s);
const pickd = $('#pickd'), go = $('#vote-go'), panel = $('#vote-panel'), form = $('#vote-form'), err = form.querySelector('.err');
let pick = null;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const voted = () => { try { return JSON.parse(localStorage.getItem('kc_vote') || 'null'); } catch { return null; } };

$('#vote').addEventListener('change', (e) => {
  const r = e.target.closest('input[name=nominee]'); if (!r) return;
  pick = { code: r.value, name: r.dataset.name, district: r.dataset.district, pin: r.dataset.pin };
  pickd.textContent = `Your pick: ${pick.code} · ${pick.name}`;
  go.disabled = false; go.textContent = `Vote ${pick.code}`;
});
go.addEventListener('click', () => {
  if (!pick) return;
  $('#vp-name').textContent = pick.name;
  panel.hidden = false; panel.classList.remove('is-done');
  const v = voted();
  if (v && v.day === today()) showDone("You've voted today.", 'Your vote gets counted once a day, and the polls reopen at midnight.');
  panel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  setTimeout(() => form.querySelector('[name=phone]')?.focus({ preventScroll: true }), 350);
});
$('#vote-cancel').addEventListener('click', () => { panel.hidden = true; document.querySelector('.districts input:checked')?.focus(); });

function showDone(h, p) {
  const d = panel.querySelector('.done');
  d.querySelector('h3').textContent = h; d.querySelector('p').textContent = p;
  panel.classList.add('is-done'); d.tabIndex = -1; d.focus({ preventScroll: true });
}
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(form);
  const rp = String(f.get('phone') || '').trim(), re = String(f.get('email') || '').trim();
  const phone = rp ? cleanPhone(rp) : null, email = re ? cleanEmail(re) : null;
  if (rp && !phone) { err.textContent = 'That number needs 10 digits, like 845 555 0123.'; return; }
  if (re && !email) { err.textContent = "That email doesn't look right."; return; }
  if (!phone && !email) { err.textContent = 'Add a mobile number or an email so we can count one vote per person.'; return; }
  const optin = !!f.get('optin'), sms = !!f.get('consent');
  if (optin && phone && !email && !sms) { err.textContent = 'To get the Weekend Five by text, tick the texts box. Or add an email instead.'; return; }
  err.textContent = '';
  const props = { code: pick.code, nominee: pick.name, district: pick.district, pin_id: pick.pin, channel: phone && email ? 'both' : phone ? 'sms' : 'email', round: 'district-heats', demo: true };
  if (phone) props.phone = phone;
  if (email) props.email = email;
  const ok = await save('kc_vote', props);
  if (!ok) { saveFailed(err); return; }
  if (optin) {
    const s = { channel: props.channel, source_page: 'brick', interests: ['brick'], pin_id: pick.pin };
    if (email) s.email = email;
    if (phone && sms) { s.phone = phone; s.consent_text = CONSENT_TEXT; } else if (!email) s.channel = 'sms';
    if (s.email || s.phone) { if (!s.phone) s.channel = 'email'; await save('kc_signup', s); }
  }
  try { localStorage.setItem('kc_vote', JSON.stringify({ day: today(), code: pick.code })); } catch { /* fine */ }
  showDone(`Vote saved for ${pick.name}.`, `This is a preview: votes are counted for real when The Brick launches. Come back tomorrow to vote again.${optin ? " You're on the launch list too." : ''} Share the code: ${pick.code}.`);
});
