// shop.js — /shop/: every "Join the drop list" button feeds the one signup form.
import { initChrome, track } from './kc.js';

initChrome();
const form = document.querySelector('#drop-list form');
const product = form?.querySelector('[name=product]');
let note = null;
for (const b of document.querySelectorAll('[data-product]')) {
  b.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (!form) return;
    product.value = b.dataset.product;
    const drops = form.querySelector('input[name=interest][value=drops]');
    if (drops) drops.checked = true;
    if (!note) { note = document.createElement('p'); note.className = 'fine'; note.setAttribute('aria-live', 'polite'); form.prepend(note); }
    note.textContent = `You're joining the drop list for: ${b.dataset.name}. We'll send the private link before anyone else.`;
    track('kc_drop_interest', { product: b.dataset.product });
    document.getElementById('drop-list').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    setTimeout(() => form.querySelector('[name=email]')?.focus({ preventScroll: true }), 350);
  });
}
