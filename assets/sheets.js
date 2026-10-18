/* Draggable bottom sheets on phones (≤900px): the sidebar sheet (collapsed / half / expanded) and the
   detail card (half / full, drag down to close). Drag from the handle, the header or the content itself:
   dragging up grows the sheet before the content scrolls; dragging down at the top of the content shrinks it.
   Exposes window.Sheets.detailHalf() for app.js (height of the half-open card). */
(() => {
'use strict';

const mq = matchMedia('(max-width: 900px)');
const sb = document.getElementById('sidebar'), det = document.getElementById('detail');
if (!sb || !det) return;

// Every class write is guarded: add()/remove() of a token that is already there / absent still rewrites the
// attribute, which re-fires the MutationObservers watching these sheets (app.js, sun.js and below).
const has = (el, c) => el.classList.contains(c);
function setState(el, states, cur) {
  states.forEach(x => { if (x && x !== cur && has(el, x)) el.classList.remove(x); });
  if (cur && !has(el, cur)) el.classList.add(cur);
}

const SHEETS = [
  { el: sb, header: '.grab, .tabs', states: ['collapsed', '', 'expanded'] },
  { el: det, header: '.grab, .detail-head', states: ['', 'full'], dismiss: true },
];
const [SB, DET] = SHEETS;
const stateIdx = s => {
  for (let i = s.states.length - 1; i >= 0; i--) if (s.states[i] && has(s.el, s.states[i])) return i;
  return s.states.indexOf('');
};

/* ---------------- handles (real buttons) ---------------- */
const LBL = { pt: ['Expandir ou reduzir o painel', 'Expandir ou reduzir o card'], en: ['Expand or shrink the panel', 'Expand or shrink the card'] };
const sGrab = document.getElementById('grab');
const dGrab = document.createElement('button');
dGrab.type = 'button';
dGrab.className = 'grab';
det.prepend(dGrab);
dGrab.addEventListener('click', () => setState(det, DET.states, has(det, 'full') ? '' : 'full'));
if (sGrab) {
  sGrab.setAttribute('role', 'button');
  sGrab.tabIndex = 0;
  sGrab.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sGrab.click(); } });
}
function labels() {
  const l = (document.documentElement.lang || 'pt').startsWith('en') ? LBL.en : LBL.pt;
  sGrab?.setAttribute('aria-label', l[0]);
  dGrab.setAttribute('aria-label', l[1]);
  sGrab?.setAttribute('aria-expanded', String(has(sb, 'expanded')));
  dGrab.setAttribute('aria-expanded', String(has(det, 'full')));
}
labels();
new MutationObserver(labels).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

/* ---------------- class hygiene ---------------- */
const TEXT = 'input[type=search], input[type=text], input[type=number], input:not([type])';
// a field left focused in a sheet that folds away would keep the phone keyboard up over the card or the map
function blurIn(el) {
  const a = document.activeElement;
  if (mq.matches && a && el.contains(a) && a.matches(TEXT)) a.blur();
}
let g = null;   // the gesture in progress
new MutationObserver(() => {
  if (!has(det, 'open')) {
    if (has(det, 'full')) det.classList.remove('full');   // a new card opens at half height
    blurIn(det);
  } else if (det.style.height && !g) det.style.height = '';   // reopened while the last card slid out
  labels();
}).observe(det, { attributes: true, attributeFilter: ['class'] });
new MutationObserver(() => {
  // app.js folds the sheet for a card with add('collapsed') only; a sheet must never be both
  if (has(sb, 'expanded') && has(sb, 'collapsed')) sb.classList.remove('expanded');
  if (has(sb, 'collapsed')) blurIn(sb);
  labels();
}).observe(sb, { attributes: true, attributeFilter: ['class'] });

/* ---------------- snapping ---------------- */
// heights of every state, measured with that state's classes so all stylesheets apply (the sun module shrinks
// the folded sheet in landscape); called only once a gesture really drags, with transitions already off
function snaps(s) {
  const el = s.el, cur = s.states[stateIdx(s)], inline = el.style.height;
  el.style.height = '';
  const hs = s.states.map(c => { setState(el, s.states, c); return el.offsetHeight; });
  setState(el, s.states, cur);
  el.style.height = inline;
  return hs;
}
function settle(s, i) {   // animate from the dragged height to state i
  const el = s.el;
  el.classList.remove('dragging');
  void el.offsetHeight;
  setState(el, s.states, s.states[i]);
  el.style.height = '';
}

/* ---------------- gesture ---------------- */
const SKIP = 'input[type=range], .lb-stage, .sun-panel';
const WIN = { capture: true, passive: false };
const FLICK = 0.2;   // px/ms: released faster than this, the sheet goes on in the direction of the motion

function start(s, e) {
  if (g) {
    if (g.mode === 'drag' && e.touches.length > 1) return;   // a second finger never takes over a drag
    abort();
  }
  if (!mq.matches || e.touches.length !== 1 || e.target.closest(SKIP)) return;
  if (s.dismiss && !has(s.el, 'open')) return;   // a card sliding out is left to finish
  const t = e.touches[0];
  g = { s, id: t.identifier, x0: t.clientX, y0: t.clientY, start: [t.clientY, e.timeStamp], mode: null, track: [],
    idx: stateIdx(s), node: e.target, header: !!e.target.closest(s.header) };
  // touch events keep going to the touched node; once a re-render detaches it they no longer reach the sheet
  // or the window, so the node itself is listened to as well
  g.node.addEventListener('touchmove', onNode, WIN);
  g.node.addEventListener('touchend', onNode, WIN);
  g.node.addEventListener('touchcancel', onNode, WIN);
  window.addEventListener('touchend', end, WIN);
  window.addEventListener('touchcancel', end, WIN);
}
function onNode(e) {
  if (e.type !== 'touchmove') end(e);
  else if (!e.currentTarget.isConnected) move(e);   // still attached: move() runs from the sheet
}
function unlisten(d) {
  d.node.removeEventListener('touchmove', onNode, WIN);
  d.node.removeEventListener('touchend', onNode, WIN);
  d.node.removeEventListener('touchcancel', onNode, WIN);
  window.removeEventListener('touchend', end, WIN);
  window.removeEventListener('touchcancel', end, WIN);
}
function abort() {
  if (!g) return;
  const d = g;
  g = null;
  unlisten(d);
  if (d.mode === 'drag') settle(d.s, stateIdx(d.s));
}
function engage(t, e) {
  const el = g.s.el;
  g.h0 = el.offsetHeight;   // where it is now, even mid-animation: freeze it there instead of jumping
  el.classList.add('dragging');
  el.style.height = g.h0 + 'px';
  g.hs = snaps(g.s);
  g.mode = 'drag';
  g.y0 += Math.sign(t.clientY - g.y0) * 7;   // follow the finger from the start, minus the 7px slop
  g.track = [g.start];   // move() adds this move; the speed then counts from the touch down
}
function move(e) {
  if (!g) return;
  if (!mq.matches) return abort();
  if (g.mode === 'drag' && e.cancelable) e.preventDefault();
  const t = [...e.touches].find(x => x.identifier === g.id);
  if (!t || g.mode === 'none' || g.mode === 'scroll') return;
  if (!g.mode) {
    if (e.touches.length > 1) { g.mode = 'none'; return; }
    const dx = t.clientX - g.x0, dy = t.clientY - g.y0;
    if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
    if (!e.cancelable) { g.mode = 'none'; return; }
    // at the top only if no scroller under the finger (the suggestion list, a table, the tab) is scrolled
    let atTop = true, side = false;
    for (let n = g.node; n && n !== g.s.el; n = n.parentElement) {
      if (n.scrollTop > 0) atTop = false;
      if (n.scrollWidth > n.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(n).overflowX)) side = true;
    }
    const last = g.s.states.length - 1;
    const sheet = g.header || (dy < 0 && g.idx < last) || (dy > 0 && atTop && (g.s.dismiss || g.idx > 0));
    if (Math.abs(dx) > Math.abs(dy)) {
      // sideways first: a table that pans sideways, or content the sheet could not move for, gets the touch;
      // otherwise keep it (an unclaimed move lets the browser take the rest of the touch) and wait for the
      // vertical part of the swipe: a thumb often starts at 45° or more
      if (side || !sheet) { g.mode = 'none'; return; }
      e.preventDefault();
      return;
    }
    if (sheet) {
      engage(t, e);
      e.preventDefault();
    } else { g.mode = 'scroll'; return; }
  }
  const max = g.hs[g.hs.length - 1], lo = g.s.dismiss ? 0 : g.hs[0] * 0.75;
  let h = g.h0 - (t.clientY - g.y0);
  if (h > max) h = Math.min(max + 8, max + (h - max) * 0.25);   // a little rubber band, never over the top bar
  g.s.el.style.height = Math.max(lo, h) + 'px';
  g.track.push([t.clientY, e.timeStamp]);
  if (g.track.length > 10) g.track.shift();
}
function end(e) {
  if (!g) return;
  if (e.changedTouches && ![...e.changedTouches].some(x => x.identifier === g.id)) return;   // another finger lifted
  const d = g;
  g = null;
  unlisten(d);
  if (d.mode !== 'drag') return;
  if (e.type === 'touchend' && e.cancelable) e.preventDefault();   // the finger lifting is not a tap
  // speed from the last 100ms only, and none at all if the finger rested before lifting
  const now = e.timeStamp, last = d.track[d.track.length - 1];
  let recent = d.track.filter(([, ts]) => now - ts <= 100);
  if (recent.length < 2) recent = d.track.slice(-2);   // sparse events (a slow device): the last two moves
  const v = e.type === 'touchend' && now - last[1] < 80 && recent.length > 1
    ? (recent[0][0] - last[0]) / Math.max(1, last[1] - recent[0][1]) : 0;   // px/ms, positive = upwards
  // released moving: the next state in the direction of the motion, never back against it; released still:
  // the nearest state. Below its half height the card closes if let go under 60% of it, or if the flick would
  // carry it there (-1 = closed)
  const hs = d.hs, h = d.s.el.offsetHeight, closes = y => d.s.dismiss && y < hs[0] * 0.6;
  let to = 0;
  if (v > FLICK) {
    to = hs.findIndex(x => x > h + 2);
    if (to < 0) to = hs.length - 1;
  } else if (v < -FLICK) {
    to = -1;
    hs.forEach((x, i) => { if (x < h - 2) to = i; });
    if (to < 0 && !closes(h + v * 220)) to = 0;
  } else {
    hs.forEach((x, i) => { if (Math.abs(x - h) < Math.abs(hs[to] - h)) to = i; });
    if (closes(h)) to = -1;
  }
  if (to < 0) dismiss(d.s.el);
  else settle(d.s, to);
}
// the card slides out at the height the finger left it; its CSS height comes back once it is off-screen
function dismiss(el) {
  el.classList.remove('dragging');
  document.getElementById('d-close')?.click();
  setTimeout(() => {
    if (g?.s.el === el || has(el, 'open') || !el.style.height) return;   // a new gesture or card owns it
    el.classList.add('dragging');
    el.style.height = '';
    void el.offsetHeight;
    el.classList.remove('dragging');
  }, 300);
}
// touchmove is registered for good and non-passive, so the browser waits for it from the first move of a
// touch (a listener added during touchstart can be too late for that: the first moves come uncancelable)
SHEETS.forEach(s => {
  s.el.addEventListener('touchstart', e => start(s, e), { passive: true });
  s.el.addEventListener('touchmove', move, { passive: false });
});
// a second finger landing on the map while a sheet is dragged must not pinch-zoom it (Leaflet counts every touch)
window.addEventListener('touchstart', e => {
  if (g && g.mode === 'drag' && !g.s.el.contains(e.target)) e.stopPropagation();
}, { capture: true, passive: true });
mq.addEventListener('change', () => { abort(); SHEETS.forEach(s => { s.el.style.height = ''; s.el.classList.remove('dragging'); }); });

/* ---------------- phone conveniences ---------------- */
// typing: give the field room above the on-screen keyboard (search suggestions open below the box)
[SB, DET].forEach(s => s.el.addEventListener('focusin', e => {
  if (mq.matches && e.target.matches(TEXT)) setState(s.el, s.states, s.states[s.states.length - 1]);
}));
// 'see same housetype' switches the list in the sidebar, which the card covers on a phone
det.addEventListener('click', e => {
  if (!mq.matches || !e.target.closest('[data-same]')) return;
  setTimeout(() => { document.getElementById('d-close')?.click(); setState(sb, SB.states, 'expanded'); }, 0);
});

window.Sheets = {
  // height of the half-open card from its CSS fraction of the layout (never a mid-animation reading)
  detailHalf() {
    const f = parseFloat(getComputedStyle(det).getPropertyValue('--half')) || 0.56;
    return Math.round((det.parentElement?.clientHeight || innerHeight) * f);
  },
};
})();
