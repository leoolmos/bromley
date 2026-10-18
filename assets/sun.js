/* Sun simulation for the Leaflet map: a polar sun-path diagram over a focus point, its shadow to real
   scale, daylight tinting of the base map and a year/day timeline with playback.
   Needs window.SunMath (assets/sun-math.js).
   SunPath.create(map, { center, lang }) -> controller { open, close, toggle, play, pause, setMode, setSpeed,
   setDate, setDoy, setTime, setFocus, setLang, destroy, state }; the latest one is also SunPath.instance.
   Times of day are kept as minutes since local midnight (1380 / 1500 of them on the DST change days) and shown
   as Europe/London wall-clock time. */
(() => {
'use strict';

const SM = window.SunMath;
const NS = 'http://www.w3.org/2000/svg', RAD = Math.PI / 180, EARTH = 6378137;
const YEAR_S = 72, SWEEP_S = 1.6, DAY_S = 12;   // playback at 1×: a year, one sunrise→sunset sweep, 24 h
const SPEEDS = [0.5, 1, 2, 4];
const DEFAULT_H = 9;                             // m: a two-storey house
const ARC_N = 48, SEG_N = 24;                    // samples / coloured segments of the day arc
const TH = 8;                                    // half width of the (invisible) range thumbs, px
const SET_EL = SM ? -0.833 + SM.refraction(-0.833) : -0.44;   // apparent elevation at sunrise / sunset
const SPARK_MAX = 1080;                          // day-length chart: 0..18 h
const LEN = 1000;                                // natural length of the scaled shadow / sun-line strips, px
const KEY = 'rp-sun';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pad2 = n => String(n).padStart(2, '0');
const r1 = v => Math.round(v * 10) / 10;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const STR = {
  pt: {
    btn: 'Sol', btn_aria: 'Simulação do sol', region: 'Simulação do sol ao longo do ano',
    play: 'Reproduzir', pause: 'Pausar', modes: 'Modo da animação', year: 'Ano', day: 'Dia',
    year_t: 'Percorre o ano: o sol cruza o céu enquanto as datas avançam', day_t: 'Percorre as 24 horas da data escolhida',
    speed: 'Velocidade', close: 'Fechar a simulação do sol', date: 'Data', time: 'Hora do dia',
    mon: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
    mon_long: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
    date_long: (d, m) => `${d} de ${STR.pt.mon_long[m]}`,
    comp: ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'],
    elev: 'altura', pos_t: 'Altura do sol acima do horizonte e azimute (a partir do norte)',
    rise: 'Nascer do sol', set: 'Pôr do sol', len_t: 'Duração do dia',
    len: (h, m) => `${h}h${pad2(m)}`, len_s: 'de sol',
    shadow_gen: h => `Sombra de um prédio de ${h} m`, shadow_of: (l, h) => `Sombra de ${l} (${h} m)`,
    below: 'sol abaixo do horizonte', horizon: 'sol no horizonte', jun: '21 jun', dec: '21 dez', loc: 'pt-BR',
  },
  en: {
    btn: 'Sun', btn_aria: 'Sun simulation', region: 'Sun simulation through the year',
    play: 'Play', pause: 'Pause', modes: 'Animation mode', year: 'Year', day: 'Day',
    year_t: 'Runs through the year: the sun crosses the sky while the dates advance', day_t: 'Runs through the 24 hours of the chosen date',
    speed: 'Speed', close: 'Close the sun simulation', date: 'Date', time: 'Time of day',
    mon: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    mon_long: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    date_long: (d, m) => `${d} ${STR.en.mon_long[m]}`,
    comp: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
    elev: 'elevation', pos_t: 'Sun elevation above the horizon and azimuth (from north)',
    rise: 'Sunrise', set: 'Sunset', len_t: 'Day length',
    len: (h, m) => `${h}h ${pad2(m)}m`, len_s: 'of daylight',
    shadow_gen: h => `Shadow of a ${h} m building`, shadow_of: (l, h) => `Shadow of ${l} (${h} m)`,
    below: 'sun below the horizon', horizon: 'sun on the horizon', jun: '21 Jun', dec: '21 Dec', loc: 'en-GB',
  },
};

const ICON = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/><path d="M12 2.2v2.3M12 19.5v2.3M2.2 12h2.3M19.5 12h2.3M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M5.1 18.9l1.6-1.6M17.3 6.7l1.6-1.6"/></svg>',
  rise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 18a5 5 0 0 0-10 0M12 2v7M8 6l4-4 4 4M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1"/></svg>',
  set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 18a5 5 0 0 0-10 0M12 9V2M16 5l-4 4-4-4M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1"/></svg>',
  len: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/></svg>',
  shadow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 20.5 21 14v6.5z" fill="currentColor" opacity=".38"/><rect x="4.5" y="7" width="6" height="13.5" rx="1" fill="currentColor"/><path d="M3 20.5h18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  play: '<svg class="i-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a1.1 1.1 0 0 0 1.7.93l10-6.4a1.1 1.1 0 0 0 0-1.86l-10-6.4A1.1 1.1 0 0 0 8 5.6z"/></svg>',
  pause: '<svg class="i-pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4.2" height="14" rx="1.3"/><rect x="13.3" y="5" width="4.2" height="14" rx="1.3"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

/* ---------------- colour ramps (by sun elevation, degrees) ---------------- */
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const ramp = stops => stops.map(([x, c]) => [x, hex(c)]);
function at(stops, x) {
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [x0, a] = stops[i - 1], [x1, b] = stops[i], t = (x - x0) / (x1 - x0);
      return a.map((v, k) => Math.round(v + (b[k] - v) * t));
    }
  }
  return stops[stops.length - 1][1];
}
const ARC = ramp([[0, '#dc2626'], [6, '#f97316'], [18, '#f59e0b'], [40, '#facc15']]);
const CORE = ramp([[-1, '#ef4444'], [3, '#f97316'], [10, '#fbbf24'], [25, '#fde047']]);
const HALO = ramp([[-1, '#f87171'], [4, '#fb923c'], [14, '#fcd34d']]);
const rgb = c => `rgb(${c})`;

let seq = 0;

function create(map, opts = {}) {
  if (!SM) throw new Error('SunPath: SunMath is not loaded');
  if (!window.ResizeObserver || !window.MutationObserver) throw new Error('SunPath: ResizeObserver is not supported');
  const uid = 'sunp' + (++seq);
  const mq = matchMedia('(max-width: 900px)');
  const mapEl = map.getContainer();
  const home = L.latLng(opts.center || map.getCenter());
  let lang = opts.lang === 'en' ? 'en' : 'pt';
  const T = () => STR[lang];

  const st = {
    open: false, playing: false, mode: 'year',
    speed: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.5 : 1,
    year: 0, doy: 1, min: 720, doyF: 1, sweep: 0,
    touched: false,   // the date/time was chosen by the user: keep it between opens
  };
  const defFocus = () => ({ lat: home.lat, lon: home.lng, heightM: DEFAULT_H, widthM: 7, label: null });
  let F = defFocus();

  /* ---------------- sun data (cached per day of the current year) ---------------- */
  let days = new Map(), spark = null;
  function day(doy) {
    let d = days.get(doy);
    if (d) return d;
    const { year, month, day: dd } = SM.fromDayOfYear(st.year, doy);
    const t0 = +SM.londonToDate(year, month, dd, 0), span = Math.round((SM.londonToDate(year, month, dd, 1440) - t0) / 6e4);
    const el = x => x ? (x - t0) / 6e4 : null;   // instant -> minutes since local midnight
    const tm = SM.times(year, month, dd, F.lat, F.lon);
    d = { doy, year, month, day: dd, t0, span, rise: el(tm.sunrise), set: el(tm.sunset), dawn: el(tm.dawn), dusk: el(tm.dusk),
      noon: el(tm.solarNoon), len: tm.dayLengthMin, arc: null, bg: null };
    days.set(doy, d);
    return d;
  }
  const instant = (d, min) => new Date(d.t0 + min * 6e4);
  const wallOf = (d, min) => SM.londonParts(instant(d, min)).minutes;
  const fromWall = (d, w) => clamp((SM.londonToDate(d.year, d.month, d.day, w) - d.t0) / 6e4, 0, d.span - 0.01);
  function arcOf(d) {   // [azimuth, elevation>=0] from sunrise to sunset
    if (d.arc) return d.arc;
    const a = d.rise ?? 0, b = d.set ?? d.span;
    d.arc = [];
    if (d.rise == null && d.len === 0) return d.arc;
    for (let i = 0; i <= ARC_N; i++) {
      const p = SM.position(instant(d, a + (b - a) * i / ARC_N), F.lat, F.lon);
      d.arc.push([p.azimuth, Math.max(0, p.elevation)]);
    }
    return d.arc;
  }
  function sample() {
    const d = day(st.doy), date = instant(d, st.min), p = SM.position(date, F.lat, F.lon), w = SM.londonParts(date);
    const shadowM = p.elevation > 0 ? SM.shadowLength(F.heightM, p.elevation) : null;
    return { d, date, az: p.azimuth, el: p.elevation, wall: w.minutes, tz: w.offsetMin ? 'BST' : 'GMT', shadowM };
  }
  function setYear(y) {
    if (y === st.year) return;
    st.year = y; days = new Map(); spark = null;
  }

  /* ---------------- panes ---------------- */
  const pane = (name, z, cls) => {
    const p = map.createPane(name);
    p.style.zIndex = z; p.style.pointerEvents = 'none';
    p.classList.add('sunp-pane', cls, 'sunp-off');
    return p;
  };
  const dimPane = pane(uid + 'Dim', 390, 'sunp-dimpane');    // between the drawings (250) and the vector overlay (400)
  const pathPane = pane(uid + 'Path', 450, 'sunp-pathpane');
  const sunPane = pane(uid + 'Sun', 655, 'sunp-pathpane');     // the disc and the shadow label, above permanent map labels (650)
  // composited layers: per frame only their opacity / rotation change, so the full-viewport tint never repaints
  const dimEl = L.DomUtil.create('div', 'sunp-dim', dimPane);
  const dimDark = L.DomUtil.create('i', 'sunp-dark', dimEl), dimGlow = L.DomUtil.create('i', 'sunp-glow', dimEl);

  const sv = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    parent && parent.appendChild(e);
    return e;
  };
  // what moves every frame (shadow, sun, sun line) is composited HTML moved by transforms; the SVG between
  // them (dial, solstice and day arcs) only changes with the date or the view
  const H = cls => L.DomUtil.create('div', 'sunp-hel ' + cls, pathPane);
  const shEl = H('sunp-sh');
  const svg = sv('svg', { class: 'sunp-svg', 'aria-hidden': 'true' }, pathPane);
  sv('defs', {}, svg).innerHTML =
    `<radialGradient id="${uid}-plate"><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".16"/></radialGradient>`;
  const plate = sv('circle', { class: 'sunp-plate', fill: `url(#${uid}-plate)` }, svg);
  const gDial = sv('g', { class: 'sunp-dial' }, svg);
  const alts = [0, 1].map(() => sv('circle', { class: 'sunp-alt' }, gDial));   // 30° and 60° rings
  const ringHalo = sv('circle', { class: 'sunp-ring-h' }, gDial);
  const ring = sv('circle', { class: 'sunp-ring' }, gDial);
  const ticks = sv('path', { class: 'sunp-ticks' }, gDial);
  const altLbl = ['30°', '60°'].map(s => { const e = sv('text', { class: 'sunp-altlbl' }, gDial); e.textContent = s; return e; });
  const card = [0, 1, 2, 3].map(i => sv('text', { class: 'sunp-card' + (i ? '' : ' n') }, gDial));
  const gRef = sv('g', { class: 'sunp-ref' }, svg);
  const sol = ['jun', 'dec'].map(k => ({ k, path: sv('path', { class: 'sunp-sol ' + k }, gRef), text: sv('text', { class: 'sunp-sollbl ' + k }, gRef) }));
  const gRays = sv('g', { class: 'sunp-rays' }, svg);
  const rays = ['rise', 'set'].map(k => ({ line: sv('line', { class: k }, gRays), dot: sv('circle', { class: k, r: 3.6 }, gRays) }));
  const arcHalo = sv('path', { class: 'sunp-arc-h' }, svg);
  const gArc = sv('g', { class: 'sunp-arc' }, svg);
  const segs = Array.from({ length: SEG_N }, () => sv('path', {}, gArc));
  const focusDot = sv('circle', { class: 'sunp-focus', r: 4 }, svg);
  const shTip = H('sunp-shtip'), lineEl = H('sunp-line');
  const shLbl = L.DomUtil.create('div', 'sunp-hel sunp-shlbl', sunPane);   // above the map's permanent labels, like the disc
  const sunEl = L.DomUtil.create('div', 'sunp-hel sunp-sun', sunPane);
  sunEl.appendChild(document.createElement('i'));

  // attribute / text writes only when the value changed
  const A = (e, k, v) => { const c = '_s_' + k; if (e[c] !== v) { e[c] = v; e.setAttribute(k, v); } };
  const X = (e, v) => { if (e._t !== v) { e._t = v; e.textContent = v; } };
  const show = (e, on) => { if (e._v !== on) { e._v = on; e.style.display = on ? '' : 'none'; } };
  const vis = (e, on) => { if (e._v !== on) { e._v = on; e.style.visibility = on ? '' : 'hidden'; } };
  const T2 = (e, v) => { if (e._tr !== v) { e._tr = v; e.style.transform = v; } };

  /* ---------------- toggle control (top right, under the Map/Satellite switch) ---------------- */
  const Ctl = L.Control.extend({
    onAdd() {
      const el = L.DomUtil.create('div', 'map-ctl sun-ctl');
      el.innerHTML = `<button type="button" class="sun-toggle" aria-pressed="false">${ICON.sun}<span></span></button>`;
      L.DomEvent.disableClickPropagation(el);
      el.firstChild.addEventListener('click', () => toggle());
      return el;
    },
  });
  const ctl = new Ctl({ position: 'topright' }).addTo(map);
  const tgl = ctl.getContainer().firstChild;

  /* ---------------- timeline panel (its own bottom-centre control corner) ---------------- */
  const corner = L.DomUtil.create('div', 'leaflet-bottom sun-corner', mapEl.querySelector('.leaflet-control-container') || mapEl);
  const panel = L.DomUtil.create('div', 'sun-panel', corner);
  panel.setAttribute('role', 'region');
  panel.innerHTML = `
    <div class="sun-top">
      <button type="button" class="sun-play" aria-pressed="false">${ICON.play}${ICON.pause}</button>
      <div class="sun-when"><span class="sun-date"></span><span class="sun-time"></span><span class="sun-tz"></span></div>
      <div class="sun-facts">
        <span class="sun-tz sun-tz2"></span>
        <span class="sun-f sun-pos">${ICON.sun}<b class="sun-el"></b><span class="sun-el-l"></span><span class="sun-sep">·</span><b class="sun-az"></b></span>
        <span class="sun-f sun-rise-f">${ICON.rise}<b class="sun-rise"></b></span>
        <span class="sun-f sun-set-f">${ICON.set}<b class="sun-set"></b></span>
        <span class="sun-f sun-len-f">${ICON.len}<b class="sun-len"></b><span class="sun-len-s"></span></span>
      </div>
      <div class="sun-f sun-sh">${ICON.shadow}<span class="sun-sh-l"></span><b class="sun-sh-v"></b><span class="sun-sh-n"></span></div>
      <div class="sun-ctls">
        <div class="seg sun-modes" role="group"><button type="button" data-mode="year"></button><button type="button" data-mode="day"></button></div>
        <div class="seg sun-speeds" role="group">${SPEEDS.map(s => `<button type="button" data-speed="${s}">${s}×</button>`).join('')}</div>
        <button type="button" class="sun-cycle"></button>
        <button type="button" class="icon-btn sun-close">${ICON.close}</button>
      </div>
    </div>
    <div class="sun-tracks">
      <div class="sun-trk sun-yr-trk">
        <svg class="sun-spark" viewBox="0 0 364 100" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="${uid}-sp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f59e0b" stop-opacity=".5"/><stop offset="1" stop-color="#f59e0b" stop-opacity=".06"/></linearGradient></defs>
          <g class="sun-sp-grid"></g><line class="sun-sp-half" x1="0" x2="364" y1="33.3" y2="33.3"/>
          <path class="sun-sp-area" fill="url(#${uid}-sp)"/><path class="sun-sp-line"/>
        </svg>
        <div class="sun-mark sun-ymark"><i class="sun-dot"></i><i class="sun-knob"></i></div>
        <input type="range" class="sun-range sun-yr" min="1" max="365" step="1">
        <div class="sun-axis sun-months"></div>
      </div>
      <div class="sun-trk sun-day-trk">
        <div class="sun-band"></div>
        <div class="sun-mark sun-dmark"><i class="sun-knob"></i></div>
        <input type="range" class="sun-range sun-dr" min="0" max="1439" step="1">
        <div class="sun-axis sun-hours">${[0, 6, 12, 18, 24].map(h => `<span>${h}h</span>`).join('')}</div>
      </div>
    </div>`;
  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);
  const q = s => panel.querySelector(s);
  const ui = {
    play: q('.sun-play'), date: q('.sun-date'), time: q('.sun-time'), tz: q('.sun-tz'), tz2: q('.sun-tz2'),
    pos: q('.sun-pos'), el: q('.sun-el'), elL: q('.sun-el-l'), az: q('.sun-az'),
    riseF: q('.sun-rise-f'), rise: q('.sun-rise'), setF: q('.sun-set-f'), set: q('.sun-set'), lenF: q('.sun-len-f'), len: q('.sun-len'), lenS: q('.sun-len-s'),
    shL: q('.sun-sh-l'), shV: q('.sun-sh-v'), shN: q('.sun-sh-n'),
    modeG: q('.sun-modes'), modes: [...panel.querySelectorAll('[data-mode]')],
    speedG: q('.sun-speeds'), speeds: [...panel.querySelectorAll('[data-speed]')], cycle: q('.sun-cycle'), close: q('.sun-close'),
    yrTrk: q('.sun-yr-trk'), yr: q('.sun-yr'), ymark: q('.sun-ymark'), ydot: q('.sun-ymark .sun-dot'), months: q('.sun-months'),
    spGrid: q('.sun-sp-grid'), spArea: q('.sun-sp-area'), spLine: q('.sun-sp-line'), spark: q('.sun-spark'),
    dayTrk: q('.sun-day-trk'), dr: q('.sun-dr'), dmark: q('.sun-dmark'), band: q('.sun-band'), hours: [...q('.sun-hours').children],
  };
  const box = { yw: 0, sh: 34, dw: 0 };   // cached track sizes (ResizeObserver), so frames never read layout

  function buildSpark() {
    const N = SM.daysInYear(st.year), sx = 364 / (N - 1);
    let d = '';
    for (let i = 1; i <= N; i++) d += `L${r1((i - 1) * sx)} ${r1(100 - Math.min(day(i).len, SPARK_MAX) / SPARK_MAX * 100)}`;
    ui.spArea.setAttribute('d', `M0 100${d}L364 100Z`);
    ui.spLine.setAttribute('d', 'M' + d.slice(1));
    ui.yr.max = N;
    let g = '';
    for (let m = 2; m <= 12; m++) { const x = r1((SM.dayOfYear(st.year, m, 1) - 1.5) * sx); g += `<line x1="${x}" x2="${x}" y1="0" y2="100"/>`; }
    ui.spGrid.innerHTML = g;
    spark = { N, months: Array.from({ length: 12 }, (_, m) => {
      const a = SM.dayOfYear(st.year, m + 1, 1), b = m === 11 ? N + 1 : SM.dayOfYear(st.year, m + 2, 1);
      return ((a + b - 1) / 2 - 1) / (N - 1);
    }) };
    renderMonths();
  }
  function renderMonths() {
    if (!spark) return;
    const t = T();
    ui.months.innerHTML = t.mon.map((s, i) => `<button type="button" data-m="${i}" aria-label="${t.date_long(1, i)}" style="left:calc(${TH}px + (100% - ${2 * TH}px) * ${spark.months[i].toFixed(4)})">${s}</button>`).join('');
    ui.monthEls = [...ui.months.children]; ui.curMonth = -1;
  }

  /* ---------------- formatting ---------------- */
  const hhmm = m => { const v = Math.floor(m + 1e-6); return `${pad2(Math.floor(v / 60) % 24)}:${pad2(v % 60)}`; };
  const clock = m => hhmm(Math.min(1439, Math.round(m)));   // the clock and the event times round alike
  const num = (v, dg) => v.toLocaleString(T().loc, { maximumFractionDigits: dg, minimumFractionDigits: dg });
  const deg = v => { const f = Math.abs(v) < 0.95 ? 1 : 0, r = Math.abs(v).toFixed(f); return `${v < 0 && +r ? '−' : ''}${num(+r, f)}°`; };   // −0,4° next to "below the horizon"
  const spd = v => num(v, v % 1 ? 1 : 0) + '×';
  const metres = m => m == null ? '—' : m < 10 ? `${num(m, 1)} m` : m < 1000 ? `${Math.round(m)} m` : m < 10000 ? `${num(m / 1000, 1)} km` : '> 10 km';
  const hm = m => { const t = Math.round(m); return [Math.floor(t / 60), t % 60]; };

  /* ---------------- geometry ---------------- */
  // the dial fits the map area left free by the panel and the detail drawer (see lift)
  let Rc = 0;
  const calcR = () => {
    const s = map.getSize(), f = freeRect();
    return Math.round(clamp(Math.min(0.32 * Math.min(s.x, s.y), 0.5 * Math.min(f.r - f.l, f.b - f.t) - 22), 64, 260));
  };
  const radius = () => Rc || calcR();
  // unrounded layer point (latLngToLayerPoint rounds to whole pixels: short shadows would lose their direction)
  const lp = ll => map.project(ll, map.getZoom())._subtract(map.getPixelOrigin());
  const P = (C, R, az, el) => { const r = R * (90 - el) / 90; return [C.x + r * Math.sin(az * RAD), C.y - r * Math.cos(az * RAD)]; };
  function pathOf(pts, C, R, a = 0, b = pts.length - 1) {
    let s = '';
    for (let i = a; i <= b; i++) { const [x, y] = P(C, R, pts[i][0], pts[i][1]); s += (i === a ? 'M' : 'L') + r1(x) + ' ' + r1(y); }
    return s;
  }
  const offset = (lat, lon, m, brg) => [lat + m * Math.cos(brg * RAD) / EARTH / RAD, lon + m * Math.sin(brg * RAD) / (EARTH * Math.cos(lat * RAD)) / RAD];

  // svg + dim layer follow the viewport; svg content is drawn in layer coordinates so panning needs no redraw
  let svgAt = null;
  function layout() {
    const s = map.getSize(), p = map.containerPointToLayerPoint([0, 0]);
    const px = Math.round(s.x / 2), py = Math.round(s.y / 2), x = Math.round(p.x) - px, y = Math.round(p.y) - py;
    L.DomUtil.setPosition(svg, L.point(x, y));
    svg.setAttribute('width', s.x + 2 * px); svg.setAttribute('height', s.y + 2 * py);
    svg.setAttribute('viewBox', `${x} ${y} ${s.x + 2 * px} ${s.y + 2 * py}`);
    svgAt = { p, px, py };
    placeDim();
  }
  function placeDim() {
    const s = map.getSize(), k = s.x + 'x' + s.y;
    L.DomUtil.setPosition(dimEl, map.containerPointToLayerPoint([0, 0]));
    if (dimEl._k === k) return;
    dimEl._k = k;
    const D = Math.ceil(Math.hypot(s.x, s.y));   // the glow square covers the viewport at any rotation
    Object.assign(dimEl.style, { width: s.x + 'px', height: s.y + 'px' });
    Object.assign(dimGlow.style, { width: D + 'px', height: D + 'px', left: (s.x - D) / 2 + 'px', top: (s.y - D) / 2 + 'px' });
  }

  let geoKey = '', arcKey = '', sunKey = '';
  function drawDial(C, R) {
    for (const c of [plate, ringHalo, ring]) { A(c, 'cx', C.x); A(c, 'cy', C.y); A(c, 'r', R); }
    A(plate, 'r', R + 1);
    alts.forEach((c, i) => { A(c, 'cx', C.x); A(c, 'cy', C.y); A(c, 'r', R * (2 - i) / 3); });
    let d = '';
    for (let a = 0; a < 360; a += 10) {
      const len = a % 90 === 0 ? 11 : a % 30 === 0 ? 7 : 3.5, s = Math.sin(a * RAD), c = -Math.cos(a * RAD);
      d += `M${r1(C.x + s * R)} ${r1(C.y + c * R)}L${r1(C.x + s * (R - len))} ${r1(C.y + c * (R - len))}`;
    }
    A(ticks, 'd', d);
    card.forEach((t, i) => { const [x, y] = P(C, R, i * 90, -13 * 90 / R); A(t, 'x', r1(x)); A(t, 'y', r1(y)); });
    altLbl.forEach((t, i) => { A(t, 'x', C.x + 4); A(t, 'y', r1(C.y - R * (2 - i) / 3 - 3)); });
    sol.forEach(o => {
      const d = day(SM.dayOfYear(st.year, o.k === 'jun' ? 6 : 12, 21)), pts = arcOf(d);
      A(o.path, 'd', pathOf(pts, C, R));
      const end = pts[pts.length - 1], [x, y] = P(C, R, end[0], -10 * 90 / R);
      A(o.text, 'x', r1(x)); A(o.text, 'y', r1(y));
    });
    A(focusDot, 'cx', C.x); A(focusDot, 'cy', C.y);
  }
  function drawArc(d, C, R) {
    const pts = arcOf(d), ok = pts.length > 1;
    show(arcHalo, ok); show(gArc, ok); show(gRays, ok && d.rise != null);
    if (!ok) return;
    A(arcHalo, 'd', pathOf(pts, C, R));
    const k = ARC_N / SEG_N;
    segs.forEach((s, i) => { A(s, 'd', pathOf(pts, C, R, i * k, (i + 1) * k)); A(s, 'stroke', rgb(at(ARC, pts[i * k + k / 2][1]))); });
    [pts[0], pts[pts.length - 1]].forEach((p, i) => {
      const [x, y] = P(C, R, p[0], 0), o = rays[i];
      A(o.line, 'x1', C.x); A(o.line, 'y1', C.y); A(o.line, 'x2', r1(x)); A(o.line, 'y2', r1(y));
      A(o.dot, 'cx', r1(x)); A(o.dot, 'cy', r1(y));
    });
  }
  // a strip of natural length LEN, from (x, y) at angle ang (deg), scaled to len px
  const strip = (x, y, ang, len) => `translate(${r1(x)}px,${r1(y)}px) rotate(${ang.toFixed(2)}deg) scaleX(${(len / LEN).toFixed(4)}) translateY(-50%)`;
  function drawSun(C, R, s) {
    const up = s.el > -0.9;   // standard sunrise/sunset: the disc is on the horizon
    const r = up ? R * (90 - Math.max(0, s.el)) / 90 : R + 8 + Math.min(18, -s.el) * 1.2;
    const sx = Math.sin(s.az * RAD), sy = -Math.cos(s.az * RAD), x = C.x + r * sx, y = C.y + r * sy;
    T2(sunEl, `translate(${r1(x)}px,${r1(y)}px)`);
    if (sunEl._up !== up) { sunEl._up = up; sunEl.classList.toggle('ghost', !up); }
    vis(lineEl, s.el > 0);
    if (s.el > 0) T2(lineEl, strip(C.x, C.y, Math.atan2(sy, sx) / RAD, r));
    const k = Math.round(clamp(s.el, -2, 30) * 2);   // colour shifts towards red near the horizon
    if (k !== sunKey) {
      sunKey = k;
      sunEl.style.setProperty('--c', rgb(at(CORE, s.el)));
      sunEl.style.setProperty('--e', rgb(at(CORE, s.el - 8)));
      sunEl.style.setProperty('--h', String(at(HALO, s.el)));
    }
  }
  function drawShadow(C, R, s, tick) {
    const on = s.el > 0 && isFinite(s.shadowM);
    vis(shEl, on);
    if (!on) { vis(shTip, false); vis(shLbl, false); altLbl.forEach(t => vis(t, true)); return; }
    const [la, lo] = offset(F.lat, F.lon, s.shadowM, (s.az + 180) % 360);
    const p = lp([la, lo]), dx = p.x - C.x, dy = p.y - C.y, full = Math.hypot(dx, dy) || 1e-6;
    const ux = dx / full, uy = dy / full, cap = 4 * R, len = Math.min(full, cap), capped = full > cap;
    const tx = C.x + ux * len, ty = C.y + uy * len, w = clamp(F.widthM * full / s.shadowM, 4, 46);
    const ang = Math.atan2(uy, ux) / RAD, wr = Math.round(w);
    if (shEl._w !== wr) { shEl._w = wr; shEl.style.height = wr + 'px'; }
    T2(shEl, strip(C.x, C.y, ang, len));
    vis(shTip, capped);
    if (capped) {   // drawn length capped at 4R: an arrowhead says it goes on
      const hw = Math.round(Math.max(7, w / 2 + 4));
      if (shTip._h !== hw) { shTip._h = hw; shTip.style.height = 2 * hw + 'px'; }
      T2(shTip, `translate(${r1(tx + ux * 3)}px,${r1(ty + uy * 3)}px) rotate(${ang.toFixed(2)}deg) translateY(-50%)`);
    }
    // the length is always labelled: at low zoom a noon shadow is only a few pixels long
    vis(shLbl, true);
    if (tick) X(shLbl, (capped ? '› ' : '') + metres(s.shadowM));
    const g = (capped ? 14 : 6 + w * 0.15) + Math.abs(ux) * 20 + Math.abs(uy) * 8;   // beyond the tip, whatever the direction
    const lx = tx + ux * g, ly = ty + uy * g, hw = (shLbl._t || '').length * 3.4 + 4;
    T2(shLbl, `translate(${r1(lx)}px,${r1(ly)}px) translate(-50%,-50%)`);
    altLbl.forEach((t, i) => {   // the 30° / 60° ring labels give way to it
      const y = C.y - R * (2 - i) / 3 - 3;
      vis(t, !(Math.abs(ly - y) < 13 && lx + hw > C.x + 2 && lx - hw < C.x + 30));
    });
  }
  // tint of the base map: golden near the horizon, blue dusk, night
  function drawDim(s) {
    const e = s.el, warm = e >= 8 ? 0 : e >= 0 ? 1 - e / 8 : clamp(1 + e / 6, 0, 1);
    const dark = e >= 0 ? 0 : clamp(-e / 12, 0, 1), ds = dark * dark * (3 - 2 * dark);   // smoothstep 0 → −12°
    const g = (warm * (1 - ds)).toFixed(3), a = (0.5 * ds).toFixed(3), rot = Math.round(s.az);
    if (dimGlow._o !== g) { dimGlow._o = g; dimGlow.style.opacity = g; }
    if (+g > 0 && dimGlow._r !== rot) { dimGlow._r = rot; dimGlow.style.transform = `rotate(${rot}deg)`; }
    if (dimDark._o !== a) { dimDark._o = a; dimDark.style.opacity = a; }
    const c = Math.round(ds * 10);   // blue dusk -> night, in a few steps (a colour change repaints)
    if (dimDark._c !== c) {
      dimDark._c = c;
      const t = c / 10;
      dimDark.style.backgroundColor = `rgb(${Math.round(40 - 32 * t)},${Math.round(52 - 37 * t)},${Math.round(112 - 77 * t)})`;
    }
  }

  function bandBg(d) {
    if (d.bg) return d.bg;
    if (d.rise == null || d.set == null) return (d.bg = d.len >= 1440 ? 'var(--sunp-day)' : 'var(--sunp-night)');
    const p = m => (clamp(m, 0, d.span) / d.span * 100).toFixed(2) + '%';
    const dawn = d.dawn ?? d.rise - 45, dusk = d.dusk ?? d.set + 45;
    return (d.bg = `linear-gradient(90deg, var(--sunp-night) ${p(dawn)}, var(--sunp-twi) ${p((dawn + d.rise) / 2)}, var(--sunp-gold) ${p(d.rise)},` +
      ` var(--sunp-day) ${p(d.rise + 60)}, var(--sunp-noon) ${p(d.noon)}, var(--sunp-day) ${p(d.set - 60)}, var(--sunp-gold) ${p(d.set)},` +
      ` var(--sunp-twi) ${p((d.set + dusk) / 2)}, var(--sunp-night) ${p(dusk)})`);
  }

  // hour labels at wall-clock hours: on the 23 h / 25 h days the ones after 01:00 shift
  function placeHours(d) {
    if (ui.hoursFor === d.span) return;   // both changes happen at 01:00 UTC, so the day length says it all
    ui.hoursFor = d.span;
    [0, 6, 12, 18, 24].forEach((h, i) => {
      const e = h === 24 ? d.span : (SM.londonToDate(d.year, d.month, d.day, h * 60) - d.t0) / 6e4;
      ui.hours[i].style.left = `calc(${TH}px + (100% - ${2 * TH}px) * ${(e / d.span).toFixed(4)})`;
    });
  }

  let cur = null, bandFor = null, textAt = 0;
  function updatePanel(s, tick) {
    const t = T(), d = s.d, last = d.span - 1;
    if (bandFor !== d) { bandFor = d; ui.band.style.background = bandBg(d); placeHours(d); if (+ui.dr.max !== last) ui.dr.max = last; }
    if (tick) {   // the inputs are invisible (the marks below draw them); their values matter for keyboard and AT
      updateText(s, t, d);
      const tv = Math.min(last, Math.floor(st.min));
      if (+ui.yr.value !== st.doy) ui.yr.value = st.doy;
      if (+ui.dr.value !== tv) ui.dr.value = tv;
    }
    const N = spark ? spark.N : 365, yf = st.playing && st.mode === 'year' ? clamp(st.doyF, 1, N) : st.doy;
    T2(ui.ymark, `translateX(${r1(TH + (yf - 1) / (N - 1) * (box.yw - 2 * TH))}px)`);
    T2(ui.ydot, `translateY(${r1(box.sh * (1 - Math.min(d.len, SPARK_MAX) / SPARK_MAX))}px)`);
    T2(ui.dmark, `translateX(${r1(TH + Math.min(st.min, last) / last * (box.dw - 2 * TH))}px)`);
  }
  const evt = (d, k) => d[k + 'S'] ??= d[k] == null ? '—' : clock(wallOf(d, d[k]));
  function updateText(s, t, d) {
    X(ui.date, `${d.day} ${t.mon[d.month - 1]}`);
    X(ui.time, clock(s.wall)); X(ui.tz, s.tz); X(ui.tz2, s.tz);
    X(ui.el, deg(s.el)); X(ui.az, `${Math.round(s.az) % 360}° ${t.comp[Math.round(s.az / 45) % 8]}`);
    X(ui.rise, evt(d, 'rise')); X(ui.set, evt(d, 'set'));
    X(ui.len, t.len(...hm(d.len)));
    const h = Math.round(F.heightM);
    X(ui.shL, (F.label ? t.shadow_of(F.label, h) : t.shadow_gen(h)) + ':');
    X(ui.shV, metres(s.shadowM)); X(ui.shN, s.shadowM != null ? '' : s.el > SET_EL ? t.horizon : t.below);
    A(ui.yr, 'aria-valuetext', t.date_long(d.day, d.month - 1));
    A(ui.dr, 'aria-valuetext', `${clock(s.wall)} ${s.tz}`);
    if (ui.monthEls && ui.curMonth !== d.month - 1) {
      ui.monthEls[ui.curMonth]?.classList.remove('on');
      ui.curMonth = d.month - 1; ui.monthEls[ui.curMonth].classList.add('on');
    }
  }

  function render() {
    if (!st.open) return;
    const s = cur = sample(), C = lp([F.lat, F.lon]), R = radius();
    const gk = `${r1(C.x)},${r1(C.y)},${R}`;
    if (gk !== geoKey) { geoKey = gk; arcKey = ''; drawDial(C, R); }
    const ak = gk + '|' + st.doy;
    if (ak !== arcKey) { arcKey = ak; drawArc(s.d, C, R); }
    const now = performance.now(), tick = !st.playing || now - textAt > 66;   // text at ~15 Hz while playing: it costs a layout
    if (tick) textAt = now;
    drawShadow(C, R, s, tick);
    drawSun(C, R, s);
    drawDim(s);
    updatePanel(s, tick);
  }

  /* ---------------- playback ---------------- */
  let raf = 0, lastT = 0;
  function frame(now) {
    raf = 0;
    if (!st.open || !st.playing) return;
    const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
    lastT = now;
    const done = step(dt);
    render();
    if (done) pause();
    else raf = requestAnimationFrame(frame);
  }
  function step(dt) {
    if (st.mode === 'day') {
      st.min = (st.min + dt * st.speed * 1440 / DAY_S) % day(st.doy).span;
      return false;
    }
    const N = SM.daysInYear(st.year);
    st.doyF = Math.min(N + 0.9999, st.doyF + dt * st.speed * N / YEAR_S);
    st.doy = Math.min(N, Math.floor(st.doyF));
    st.sweep += dt * st.speed / SWEEP_S;
    let done = false;
    if (st.sweep >= 1) {
      if (st.doy >= N) { st.sweep = 1; done = true; } else st.sweep %= 1;   // night skipped: sunset -> next sunrise
    }
    const d = day(st.doy);
    if (d.rise != null && d.set != null) st.min = d.rise + st.sweep * (d.set - d.rise);
    return done;
  }
  function syncYearClock() {   // resume the year sweep from the current date/time
    const d = day(st.doy), N = SM.daysInYear(st.year);
    st.doyF = st.doy;
    st.sweep = d.rise != null && d.set != null ? (st.min - d.rise) / (d.set - d.rise) : 0;
    if (st.sweep >= 1 && st.doy < N) { st.doy++; st.doyF = st.doy; st.sweep = 0; }
    st.sweep = clamp(st.sweep, 0, 1);
  }
  function play() {
    if (!st.open) open();
    if (st.playing) return;
    st.touched = true;
    if (st.mode === 'year') {   // from the start again only once the last sunset of the year has played
      const N = SM.daysInYear(st.year), dN = day(N);
      if (st.doy >= N && (dN.set == null || st.min >= dN.set - 0.5)) { st.doy = 1; st.doyF = 1; st.sweep = 0; } else syncYearClock();
    }
    st.playing = true; lastT = 0;
    syncButtons();
    raf = raf || requestAnimationFrame(frame);
    if (foldSheet()) settleSoon(true);   // phone: the animation wants the map, not the sheet
  }
  function pause(redraw = true) {
    st.playing = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    syncButtons();
    if (redraw) render();
  }
  function setMode(m) {
    if (m !== 'year' && m !== 'day') return;
    st.mode = m;
    if (st.playing && m === 'year') syncYearClock();
    syncButtons(); render();
  }
  function setSpeed(v) {
    if (!SPEEDS.includes(+v)) return;
    st.speed = +v;
    syncButtons();
  }
  function setDoy(doy) {
    if (!Number.isFinite(+doy)) return;
    pause(false); st.touched = true;
    const w = wallOf(day(st.doy), st.min);   // same wall-clock time on the new date
    st.doy = clamp(Math.round(doy), 1, SM.daysInYear(st.year)); st.doyF = st.doy;
    st.min = fromWall(day(st.doy), w);
    render();
  }
  const setDate = (month, dd) => setDoy(SM.dayOfYear(st.year, month, dd));
  // 'HH:MM' is a wall-clock time; a number is minutes since local midnight (the time slider)
  function setTime(v) {
    const d = day(st.doy);
    let m = +v;
    if (typeof v === 'string') { const [h, mi] = v.split(':').map(Number); m = Number.isFinite(h) ? fromWall(d, h * 60 + (+mi || 0)) : NaN; }
    if (!Number.isFinite(m)) return;
    pause(false); st.touched = true;
    st.min = clamp(m, 0, d.span - 0.01);
    render();
  }
  function now() {
    const t = Date.now(), p = SM.londonParts(new Date(t));
    setYear(p.year);
    st.doy = SM.dayOfYear(p.year, p.month, p.day); st.doyF = st.doy; st.min = (t - day(st.doy).t0) / 6e4;
  }

  function syncButtons() {
    const t = T();
    A(ui.play, 'aria-pressed', String(st.playing)); A(ui.play, 'aria-label', st.playing ? t.pause : t.play);
    A(ui.play, 'title', st.playing ? t.pause : t.play);
    ui.modes.forEach(b => { const on = b.dataset.mode === st.mode; b.classList.toggle('active', on); A(b, 'aria-pressed', String(on)); });
    ui.speeds.forEach(b => { const on = +b.dataset.speed === st.speed; b.classList.toggle('active', on); A(b, 'aria-pressed', String(on)); });
    X(ui.cycle, spd(st.speed));
    A(ui.cycle, 'aria-label', `${t.speed}: ${spd(st.speed)}`);
    A(tgl, 'aria-pressed', String(st.open));
    panel.classList.toggle('playing', st.playing);
    panel.dataset.mode = st.mode;
  }
  function applyLang() {
    const t = T();
    X(tgl.lastChild, t.btn); A(tgl, 'aria-label', t.btn_aria); A(tgl, 'title', t.btn_aria);
    A(panel, 'aria-label', t.region);
    A(ui.modeG, 'aria-label', t.modes); A(ui.speedG, 'aria-label', t.speed);
    ui.speeds.forEach(b => X(b, spd(+b.dataset.speed)));
    ui.modes.forEach(b => { X(b, t[b.dataset.mode]); A(b, 'title', t[b.dataset.mode + '_t']); });
    A(ui.close, 'aria-label', t.close); A(ui.close, 'title', t.close);
    A(ui.yr, 'aria-label', t.date); A(ui.dr, 'aria-label', t.time);
    A(ui.pos, 'title', t.pos_t); X(ui.elL, t.elev);
    A(ui.riseF, 'title', t.rise); A(ui.setF, 'title', t.set); A(ui.lenF, 'title', t.len_t); X(ui.lenS, t.len_s);
    ['N', 2, 4, 6].forEach((k, i) => X(card[i], typeof k === 'number' ? t.comp[k] : k));
    sol.forEach(o => X(o.text, t[o.k]));
    renderMonths();
    syncButtons();
  }

  /* ---------------- layout around the app (controls, detail drawer, mobile sheet) ---------------- */
  const detEl = document.getElementById('detail'), sbEl = document.getElementById('sidebar');
  const detOpen = () => !!detEl && detEl.classList.contains('open');
  let sheetAt = -1e9;   // last change of the phone's bottom sheet, whose height animates for .2s
  // map area (container px) the dial may use: above the panel (right of it in side mode), clear of the drawer
  function freeRect() {
    const s = map.getSize();
    let l = 6, t = 6, r = s.x - 6, b = s.y - 6;
    if (detOpen() && !mq.matches) r = Math.min(r, detEl.offsetLeft - mapEl.offsetLeft - 10);
    if (st.open && panel.offsetParent) {
      if (corner.classList.contains('side')) { l = corner.offsetLeft + panel.offsetLeft + panel.offsetWidth + 10; b = Math.min(b, corner.offsetTop + corner.offsetHeight - 6); }
      else b = Math.min(b, corner.offsetTop + panel.offsetTop - 10);
    }
    return { l, t, r, b };
  }

  let liftRaf = 0;
  function lift() {
    liftRaf = 0;
    const attr = mapEl.querySelector('.leaflet-control-attribution'), ah = attr ? attr.offsetHeight : 0;
    mapEl.style.setProperty('--sunp-attr', ah + 'px');
    const W = mapEl.clientWidth, det = detOpen() && !mq.matches;
    if (!st.open) { document.body.classList.remove('sun-below'); corner.classList.remove('side'); panel.classList.remove('mini'); }
    else if (performance.now() - sheetAt > 240) {   // not while the sheet is still moving
      // drawer open with little room beside it: the panel spans the map and the drawer stops above it
      const below = det && W - detEl.offsetWidth - 24 < 380;
      const cw = det && !below ? W - detEl.offsetWidth - 24 : W, cb = corner.offsetTop + corner.offsetHeight;
      // short map: the panel goes to the side when the map is wide (dial beside it), else it drops the facts and chart
      const side = !below && cb < 480 && cw >= 640, mini = side ? cb < 300 : cb < 480;
      document.body.classList.toggle('sun-below', below); corner.classList.toggle('side', side); panel.classList.toggle('mini', mini);
    }
    document.body.style.setProperty('--sunp-ph', panel.offsetHeight + ah + 8 + 'px');
    box.yw = ui.yrTrk.clientWidth; box.dw = ui.dayTrk.clientWidth; box.sh = ui.spark.clientHeight || box.sh;
    const scale = mapEl.querySelector('.leaflet-control-scale'), zoom = mapEl.querySelector('.leaflet-control-zoom');
    const pl = corner.offsetLeft + panel.offsetLeft, pr = W - pl - panel.offsetWidth;
    const top = panel.offsetHeight + ah + 8 + 8;
    const ll = st.open && scale && scale.offsetWidth && pl < scale.offsetWidth + 22;
    const lr = st.open && zoom && zoom.offsetWidth && pr < zoom.offsetWidth + 22;
    mapEl.classList.toggle('sunp-lift-l', !!ll); mapEl.classList.toggle('sunp-lift-r', !!lr);
    mapEl.style.setProperty('--sunp-lift-l', top + 'px'); mapEl.style.setProperty('--sunp-lift-r', (top - ah) + 'px');
    Rc = calcR();
    if (!st.open) return;
    // nobody sees the animation behind the expanded sheet or the phone's detail sheet
    if (st.playing && (!panel.offsetParent || (mq.matches && detOpen()))) pause(false);
    render();
  }
  const queueLift = () => { liftRaf = liftRaf || requestAnimationFrame(lift); };
  const ro = new ResizeObserver(queueLift);
  [corner, panel, ui.yrTrk, ui.dayTrk, mapEl].forEach(e => ro.observe(e));
  const attrEl = mapEl.querySelector('.leaflet-control-attribution');
  attrEl && ro.observe(attrEl);

  // pan so that the whole dial is in the free area
  function ensureVisible() {
    if (!st.open) return;
    const f = freeRect(), need = radius() + 22, C = map.latLngToContainerPoint([F.lat, F.lon]);
    const fit = (c, lo, hi) => hi - lo >= 2 * need ? (c - need < lo ? c - need - lo : c + need > hi ? c + need - hi : 0) : c - (lo + hi) / 2;
    const dx = Math.round(fit(C.x, f.l, f.r)), dy = Math.round(fit(C.y, f.t, f.b));
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) map.panBy([dx, dy], { duration: 0.5 });
  }
  let moving = false, pendingEnsure = false, ensureTimer = 0;
  // once the sheet / drawer / panel have settled: final layout, then the dial into view
  function settle() {
    if (liftRaf) { cancelAnimationFrame(liftRaf); liftRaf = 0; }
    lift();
    if (moving) pendingEnsure = true; else ensureVisible();
  }
  const settleSoon = (sheet, ms = 260) => { if (sheet) sheetAt = performance.now(); clearTimeout(ensureTimer); ensureTimer = setTimeout(settle, ms); };
  function foldSheet() {   // phone: collapse the bottom sheet to give the map room
    if (!mq.matches || !sbEl || sbEl.classList.contains('collapsed')) return false;
    sbEl.classList.remove('expanded'); sbEl.classList.add('collapsed');
    return true;
  }

  /* ---------------- open / close ---------------- */
  function open() {
    if (st.open) return;
    st.open = true;
    if (!st.touched) now();
    if (!spark) buildSpark();
    st.playing = false;
    geoKey = arcKey = ''; bandFor = null; sunKey = '';
    [dimPane, pathPane, sunPane].forEach(p => p.classList.remove('sunp-off'));
    panel.classList.add('open'); document.body.classList.add('sun-on');
    syncButtons(); store.set(KEY, '1');
    foldSheet();
    settleSoon(mq.matches, mq.matches ? 260 : 40);   // on a phone the sheet moves (folded, or shorter while the sun is on)
    layout(); lift();
  }
  function close() {
    if (!st.open) return;
    pause(false);
    st.open = false;
    [dimPane, pathPane, sunPane].forEach(p => p.classList.add('sunp-off'));
    panel.classList.remove('open'); document.body.classList.remove('sun-on', 'sun-below');
    syncButtons(); store.set(KEY, '0');
    clearTimeout(ensureTimer);
    queueLift();
  }
  const toggle = () => (st.open ? close() : open());

  function setFocus(fx) {
    let nf;
    if (fx && isFinite(fx.lat) && isFinite(fx.lon)) {
      nf = { lat: +fx.lat, lon: +fx.lon, heightM: +fx.heightM || DEFAULT_H, widthM: +fx.widthM || (+fx.heightM > 10 ? 16 : 7), label: fx.label || null };
    } else {
      // selection cleared: back to the default point when it is in view, else stay put as an unnamed building
      const p = map.latLngToContainerPoint(home), f = freeRect();
      if (st.open && !(p.x >= f.l && p.x <= f.r && p.y >= f.t && p.y <= f.b)) { if (!F.label) return; nf = { ...F, label: null }; }
      else nf = defFocus();
      if (nf.lat === F.lat && nf.lon === F.lon && nf.label === F.label && nf.heightM === F.heightM) return;
    }
    if (Math.abs(nf.lat - F.lat) > 0.01 || Math.abs(nf.lon - F.lon) > 0.01) { days = new Map(); bandFor = null; }
    F = nf; geoKey = '';
    if (!st.open) return;
    render();
    if (fx) { if (moving) pendingEnsure = true; else requestAnimationFrame(ensureVisible); }
  }
  function setLang(l) {
    lang = l === 'en' ? 'en' : 'pt';
    applyLang(); render();
  }

  /* ---------------- events ---------------- */
  ui.play.addEventListener('click', () => (st.playing ? pause() : play()));
  ui.modes.forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  ui.speeds.forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
  ui.cycle.addEventListener('click', () => setSpeed(SPEEDS[(SPEEDS.indexOf(st.speed) + 1) % SPEEDS.length]));
  ui.close.addEventListener('click', () => { close(); tgl.focus(); });
  ui.yr.addEventListener('input', () => setDoy(+ui.yr.value));
  // a month name jumps to its 1st; in year mode at sunrise, ready to play from there
  ui.months.addEventListener('click', e => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    setDoy(SM.dayOfYear(st.year, +b.dataset.m + 1, 1));
    const d = day(st.doy);
    if (st.mode === 'year' && d.rise != null) { st.min = d.rise; render(); }
  });
  ui.dr.addEventListener('input', () => setTime(+ui.dr.value));
  // Space plays / pauses, except on the panel's other buttons, which it presses as usual
  const spaceIsOurs = e => e.key === ' ' && !e.altKey && !e.ctrlKey && !e.metaKey && !(e.target.closest('button') && e.target !== ui.play);
  panel.addEventListener('keydown', e => {
    if (spaceIsOurs(e)) { e.preventDefault(); if (!e.repeat) st.playing ? pause() : play(); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); tgl.focus(); }
  });
  panel.addEventListener('keyup', e => { if (spaceIsOurs(e)) e.preventDefault(); });   // no extra click on the play button

  const ev = {
    move() { if (st.open) { placeDim(); const p = map.containerPointToLayerPoint([0, 0]); if (!svgAt || Math.abs(p.x - svgAt.p.x) > svgAt.px / 2 || Math.abs(p.y - svgAt.p.y) > svgAt.py / 2) layout(); } },
    zoom() { if (st.open) { layout(); render(); } },
    viewreset() { if (st.open) { layout(); render(); } },
    resize() { if (st.open) { layout(); render(); settleSoon(false); } queueLift(); },   // e.g. into the phone layout: dial back in view
    zoomanim() { pathPane.classList.add('sunp-zooming'); sunPane.classList.add('sunp-zooming'); },
    zoomend() { pathPane.classList.remove('sunp-zooming'); sunPane.classList.remove('sunp-zooming'); if (st.open) { layout(); render(); } },
    movestart() { moving = true; },
    moveend() {
      moving = false;
      if (st.open) layout();
      if (pendingEnsure) { pendingEnsure = false; ensureVisible(); }
    },
  };
  map.on(ev);
  // the drawer and the phone's sheet change the free map area
  const mo = new MutationObserver(recs => {
    const sheet = recs.some(r => r.target === sbEl);
    queueLift();
    if (st.open && (!sheet || mq.matches)) settleSoon(sheet);
  });
  detEl && mo.observe(detEl, { attributes: true, attributeFilter: ['class'] });
  sbEl && mo.observe(sbEl, { attributes: true, attributeFilter: ['class'] });

  const api = {
    open, close, toggle, play, pause: () => pause(), setMode, setSpeed, setDate, setDoy, setTime, setFocus, setLang,
    destroy() {
      close();
      cancelAnimationFrame(liftRaf); liftRaf = 0; clearTimeout(ensureTimer);
      map.off(ev); ro.disconnect(); mo.disconnect();
      ctl.remove(); [corner, dimPane, pathPane, sunPane].forEach(e => L.DomUtil.remove(e));
      ['Dim', 'Path', 'Sun'].forEach(n => { delete map._panes[uid + n]; if (map._paneRenderers) delete map._paneRenderers[uid + n]; });
      mapEl.classList.remove('sunp-lift-l', 'sunp-lift-r');
      ['--sunp-attr', '--sunp-lift-l', '--sunp-lift-r'].forEach(k => mapEl.style.removeProperty(k));
      document.body.style.removeProperty('--sunp-ph');
      if (SunPath.instance === api) SunPath.instance = null;
      if (window.__sun === api) delete window.__sun;
    },
    get state() {
      const s = cur && st.open ? cur : sample(), d = s.d;
      return {
        open: st.open, playing: st.playing, mode: st.mode, speed: st.speed,
        year: st.year, doy: st.doy, month: d.month, day: d.day, minutes: +st.min.toFixed(2), dayMinutes: d.span,
        wallMinutes: +s.wall.toFixed(2), time: clock(s.wall), tz: s.tz,
        iso: s.date.toISOString(), elevation: +s.el.toFixed(3), azimuth: +s.az.toFixed(3),
        shadowM: s.shadowM == null ? null : +s.shadowM.toFixed(2), sunrise: d.rise == null ? null : evt(d, 'rise'),
        sunset: d.set == null ? null : evt(d, 'set'), dayLengthMin: Math.round(d.len), radius: radius(),
        focus: { ...F }, lang,
        layout: { mini: panel.classList.contains('mini'), side: corner.classList.contains('side'), below: document.body.classList.contains('sun-below') },
      };
    },
  };

  now();
  applyLang();
  SunPath.instance = api;
  if (/[?&]debug\b/.test(location.search)) window.__sun = api;   // console handle
  if (store.get(KEY, '0') === '1') open();
  return api;
}

const SunPath = window.SunPath = { create, instance: null };
})();
