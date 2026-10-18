/* Draggable bottom sheets on phones (≤900px): the sidebar sheet (collapsed / half / expanded) and the
   detail sheet (half / full, drag down to close). Drag from the handle, the header, or the content itself:
   dragging up grows the sheet before the content scrolls; dragging down at the top of the content shrinks it. */
(() => {
'use strict';

const mq = matchMedia('(max-width: 900px)');
const sb = document.getElementById('sidebar'), det = document.getElementById('detail');
if (!sb || !det) return;

// the detail sheet gets a handle like the sidebar's; tapping it toggles half / full
const handle = document.createElement('div');
handle.className = 'grab';
handle.setAttribute('role', 'button');
handle.setAttribute('aria-label', 'Expandir / reduzir');
det.prepend(handle);
handle.addEventListener('click', () => det.classList.toggle('full'));
// a new card always opens at half height
// (only touch the class list when it changes: remove() of an absent class still rewrites the attribute,
// which would re-trigger this observer forever)
new MutationObserver(() => { if (!det.classList.contains('open') && det.classList.contains('full')) det.classList.remove('full'); })
  .observe(det, { attributes: true, attributeFilter: ['class'] });

const SHEETS = [
  { el: sb, scroller: '.tab-body', header: '.grab, .tabs', states: ['collapsed', '', 'expanded'] },
  { el: det, scroller: '.detail-body', header: '.grab, .detail-head', states: ['', 'full'], dismiss: true },
];

// snap heights in px, measured with each state's class so every stylesheet's rules apply
function snaps(s) {
  const el = s.el, cur = s.states.find(c => c && el.classList.contains(c)) || '';
  el.classList.add('dragging');
  const hs = s.states.map(c => {
    s.states.forEach(x => x && el.classList.remove(x));
    if (c) el.classList.add(c);
    return el.offsetHeight;
  });
  s.states.forEach(x => x && el.classList.remove(x));
  if (cur) el.classList.add(cur);
  el.classList.remove('dragging');   // move() puts it back only if this gesture really drags the sheet
  return hs;
}
function settle(s, i) {   // animate from the dragged height to state i
  const el = s.el;
  el.classList.remove('dragging');
  void el.offsetHeight;
  s.states.forEach(c => c && el.classList.remove(c));
  if (s.states[i]) el.classList.add(s.states[i]);
  el.style.height = '';
}

let g = null;   // the gesture in progress
const SKIP = 'input, select, textarea, .lb-stage, .sun-panel';

function start(s, e) {
  if (!mq.matches || e.touches.length !== 1 || e.target.closest(SKIP)) return;
  const t = e.touches[0];
  g = { s, x0: t.clientX, y0: t.clientY, h0: s.el.offsetHeight, mode: null, track: [[t.clientY, e.timeStamp]],
    scroller: e.target.closest(s.scroller), header: !!e.target.closest(s.header) };
}
function move(e) {
  if (!g || e.touches.length !== 1) return;
  const t = e.touches[0], dx = t.clientX - g.x0, dy = t.clientY - g.y0;
  if (!g.mode) {
    if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
    if (Math.abs(dx) > Math.abs(dy)) { g.mode = 'none'; return; }   // horizontal: tables, sliders
    g.hs = snaps(g.s);
    const min = g.hs[0], max = g.hs[g.hs.length - 1];
    const atTop = !g.scroller || g.scroller.scrollTop <= 0;
    if (g.header || (dy < 0 && g.h0 < max - 2) || (dy > 0 && atTop && (g.s.dismiss || g.h0 > min + 2))) {
      g.mode = 'drag';
      g.s.el.classList.add('dragging');
      g.y0 = t.clientY;   // start from here so the sheet does not jump by the slop
    } else g.mode = 'scroll';
  }
  if (g.mode !== 'drag') return;
  e.preventDefault();
  const max = g.hs[g.hs.length - 1], lo = g.s.dismiss ? 0 : g.hs[0] * 0.75;
  let h = g.h0 - (t.clientY - g.y0);
  if (h > max) h = max + (h - max) * 0.25;   // rubber band past the top
  g.s.el.style.height = Math.max(lo, h) + 'px';
  g.track.push([t.clientY, e.timeStamp]);
  if (g.track.length > 6) g.track.shift();
}
function end() {
  if (!g) return;
  const d = g;
  g = null;
  if (d.mode !== 'drag') return;
  const [y1, t1] = d.track[0], [y2, t2] = d.track[d.track.length - 1];
  const v = t2 > t1 ? (y1 - y2) / (t2 - t1) : 0;          // px/ms, positive = upwards
  const h = d.s.el.offsetHeight, aim = h + v * 220;       // a flick carries the sheet on
  if (d.s.dismiss && aim < d.hs[0] * 0.6) {
    settle(d.s, 0);
    document.getElementById('d-close')?.click();
  } else {
    let best = 0;
    d.hs.forEach((x, i) => { if (Math.abs(x - aim) < Math.abs(d.hs[best] - aim)) best = i; });
    settle(d.s, best);
  }
  // the finger lifting after a drag must not count as a tap on whatever is under it
  const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };
  d.s.el.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => d.s.el.removeEventListener('click', swallow, { capture: true }), 350);
}

SHEETS.forEach(s => {
  s.el.addEventListener('touchstart', e => start(s, e), { passive: true });
  s.el.addEventListener('touchmove', move, { passive: false });
  s.el.addEventListener('touchend', end);
  s.el.addEventListener('touchcancel', end);
});
mq.addEventListener('change', () => SHEETS.forEach(s => { s.el.style.height = ''; s.el.classList.remove('dragging'); }));
})();
