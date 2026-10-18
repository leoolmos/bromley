// Tests for assets/sun-math.js: optional comparison with scripts/source/sun_reference.json + self-consistency checks.
// Usage: node scripts/test_sun.mjs
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SunMath = createRequire(import.meta.url)(join(here, '../assets/sun-math.js'));
const REF = join(here, 'source/sun_reference.json');
const LAT = 51.3826, LON = 0.0213;

let failed = 0;
const fail = msg => { failed++; console.log('  FAIL ' + msg); };
const pass = msg => console.log('  ok   ' + msg);
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const fmt = (x, n = 4) => x == null ? 'null' : Number.isFinite(x) ? x.toFixed(n) : String(x);
const iso = d => d ? d.toISOString().replace('.000Z', 'Z') : null;

function stats(name, errs, limit, show) {
  if (!errs.length) return console.log(`  --   ${name}: no samples`);
  const max = Math.max(...errs.map(e => e.err)), mean = errs.reduce((s, e) => s + e.err, 0) / errs.length;
  const line = `${name}: n=${errs.length} max=${fmt(max)} mean=${fmt(mean)}` + (limit != null ? ` (limit ${limit})` : ' (info)');
  if (limit == null || max <= limit) return pass(line);
  fail(line);
  errs.filter(e => e.err > limit).sort((a, b) => b.err - a.err).slice(0, 8).forEach(e => console.log('         ' + show(e)));
}

/* ---------------- (a) reference comparison ---------------- */
if (existsSync(REF)) {
  const ref = JSON.parse(readFileSync(REF, 'utf8'));
  const { lat, lon } = ref.location;
  console.log(`Reference: ${REF} (lat ${lat}, lon ${lon})`);

  // NREL SPA (pvlib) applies no refraction once the geometric elevation is below -0.8333° (sun radius + 0.5667°),
  // so its "apparent" value there is geometric: compare our geometric elevation for those samples.
  const SPA_CUTOFF = -0.8333, spa = /pvlib|nrel|spa/i.test(ref.generator || '');
  const bands = { high: { el: [], az: [] }, low: { el: [], az: [] }, below: { el: [], az: [] } };
  let geoCompared = 0;
  for (const p of ref.positions || []) {
    const s = SunMath.position(new Date(p.utc), lat, lon);
    const geo = spa && p.elevation < SPA_CUTOFF, ours = geo ? s.geometricElevation : s.elevation;
    geoCompared += geo;
    const b = p.elevation > 5 ? bands.high : p.elevation > -1 ? bands.low : bands.below;
    b.el.push({ err: Math.abs(ours - p.elevation), p, s, geo });
    b.az.push({ err: angDiff(s.azimuth, p.azimuth), p, s, geo });
  }
  const showPos = e => `${e.p.utc} ref el=${fmt(e.p.elevation)} az=${fmt(e.p.azimuth)} | ours el=${fmt(e.s.elevation)} (geometric ${fmt(e.s.geometricElevation)}${e.geo ? ', compared' : ''}) az=${fmt(e.s.azimuth)}`;
  if (spa) console.log(`  info ${geoCompared} samples below the SPA refraction cutoff (${SPA_CUTOFF}°) compared as geometric elevation`);
  stats('elevation, el > 5°', bands.high.el, 0.05, showPos);
  stats('azimuth,   el > 5°', bands.high.az, 0.05, showPos);
  stats('elevation, -1° < el <= 5°', bands.low.el, 0.3, showPos);
  stats('azimuth,   -1° < el <= 5°', bands.low.az, 0.3, showPos);
  stats('elevation, el <= -1°', bands.below.el, spa ? 0.05 : null, showPos);
  stats('azimuth,   el <= -1°', bands.below.az, 0.05, showPos);

  const ev = { sunrise: [], sunset: [], solar_noon: [] }, nullMismatch = [];
  for (const d of ref.days || []) {
    const [y, m, dd] = d.date.split('-').map(Number);
    const t = SunMath.times(y, m, dd, lat, lon);
    const ours = { sunrise: t.sunrise, sunset: t.sunset, solar_noon: t.solarNoon };
    for (const k of Object.keys(ev)) {
      const r = d[k], o = ours[k];
      if (r == null || o == null) { if ((r == null) !== (o == null)) nullMismatch.push(`${d.date} ${k}: ref ${r} ours ${iso(o)}`); continue; }
      ev[k].push({ err: Math.abs(+o - Date.parse(r)) / 6e4, date: d.date, r, o });
    }
  }
  const showEv = e => `${e.date} ref ${e.r} ours ${iso(e.o)} (${fmt(e.err, 2)} min)`;
  for (const k of Object.keys(ev)) stats(`${k} (min)`, ev[k], 1.0, showEv);
  if (nullMismatch.length) { fail(`null/non-null mismatches: ${nullMismatch.length}`); nullMismatch.slice(0, 8).forEach(s => console.log('         ' + s)); }

  const dstBad = (ref.dst || []).filter(r => SunMath.londonOffsetMin(new Date(r.utc)) !== r.offset_minutes);
  if (dstBad.length) { fail(`DST offsets: ${dstBad.length}/${ref.dst.length} wrong`); dstBad.slice(0, 8).forEach(r => console.log(`         ${r.utc} ref ${r.offset_minutes} ours ${SunMath.londonOffsetMin(new Date(r.utc))}`)); }
  else pass(`DST offsets: ${(ref.dst || []).length} exact`);
} else {
  console.log(`Reference ${REF} not found; skipping comparison.`);
}

/* ---------------- (b) self-consistency ---------------- */
console.log('Self-checks');

// DST transitions (2026: 29 Mar, 25 Oct; 2028: 26 Mar, 29 Oct)
{
  const cases = [
    ['2026-03-29T00:59:59Z', 0], ['2026-03-29T01:00:00Z', 60], ['2026-10-25T00:59:59Z', 60], ['2026-10-25T01:00:00Z', 0],
    ['2028-03-26T00:59:59Z', 0], ['2028-03-26T01:00:00Z', 60], ['2028-10-29T00:59:59Z', 60], ['2028-10-29T01:00:00Z', 0],
    ['2026-01-15T12:00:00Z', 0], ['2026-07-15T12:00:00Z', 60], ['2026-12-31T23:59:59Z', 0],
  ];
  const bad = cases.filter(([u, o]) => SunMath.londonOffsetMin(new Date(u)) !== o);
  bad.length ? fail(`DST transition instants: ${bad.map(b => b[0]).join(', ')}`) : pass(`DST transition instants (${cases.length})`);
}

// Wall clock -> instant -> wall clock, every 5 min of every day of 2026 and 2028
for (const year of [2026, 2028]) {
  let n = 0, gap = 0; const bad = [];
  const n0 = SunMath.daysInYear(year);
  for (let doy = 1; doy <= n0; doy++) {
    const { month, day } = SunMath.fromDayOfYear(year, doy);
    for (let min = 0; min < 1440; min += 5) {
      const d = SunMath.londonToDate(year, month, day, min), p = SunMath.londonParts(d);
      const same = p.year === year && p.month === month && p.day === day && Math.abs(p.minutes - min) < 1e-9;
      n++;
      if (same) continue;
      // skipped hour in March reads as GMT: 01:xx -> 02:xx BST
      if (month === 3 && p.day === day && min >= 60 && min < 120 && Math.abs(p.minutes - (min + 60)) < 1e-9 && p.offsetMin === 60) { gap++; continue; }
      bad.push(`${year}-${month}-${day} ${min} -> ${JSON.stringify(p)}`);
    }
  }
  bad.length ? (fail(`wall->instant->wall ${year}: ${bad.length} bad`), bad.slice(0, 5).forEach(s => console.log('         ' + s)))
    : pass(`wall->instant->wall ${year}: ${n} samples (${gap} in the skipped March hour)`);
}

// Instant -> wall clock -> instant, every 5 min through 2026 incl. both transition days
{
  let n = 0, rep = 0; const bad = [];
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 5 * 6e4) {
    const p = SunMath.londonParts(new Date(t)), back = +SunMath.londonToDate(p.year, p.month, p.day, p.minutes);
    n++;
    if (back === t) continue;
    // second pass of the repeated October hour (GMT) resolves to its first (BST) occurrence
    if (p.offsetMin === 0 && p.month === 10 && back === t - 36e5 && p.minutes >= 60 && p.minutes < 120) { rep++; continue; }
    bad.push(`${new Date(t).toISOString()} -> ${JSON.stringify(p)} -> ${new Date(back).toISOString()}`);
  }
  bad.length ? (fail(`instant->wall->instant: ${bad.length} bad`), bad.slice(0, 5).forEach(s => console.log('         ' + s)))
    : pass(`instant->wall->instant 2026: ${n} samples (${rep} in the repeated October hour)`);
}

// Explicit transition-day spot checks
{
  const chk = [
    [SunMath.londonToDate(2026, 3, 29, 0 * 60 + 30), '2026-03-29T00:30:00Z'],
    [SunMath.londonToDate(2026, 3, 29, 3 * 60), '2026-03-29T02:00:00Z'],
    [SunMath.londonToDate(2026, 10, 25, 1 * 60 + 30), '2026-10-25T00:30:00Z'],
    [SunMath.londonToDate(2026, 10, 25, 3 * 60), '2026-10-25T03:00:00Z'],
    [SunMath.londonToDate(2026, 7, 1, 12 * 60), '2026-07-01T11:00:00Z'],
  ].filter(([d, e]) => d.toISOString() !== new Date(e).toISOString());
  chk.length ? fail('transition-day spot checks: ' + chk.map(([d, e]) => `${d.toISOString()} != ${e}`).join('; ')) : pass('transition-day spot checks (5)');
}

// Day of year round trips
for (const year of [2026, 2028]) {
  const n = SunMath.daysInYear(year); let bad = 0;
  for (let doy = 1; doy <= n; doy++) {
    const { year: y, month, day } = SunMath.fromDayOfYear(year, doy);
    if (y !== year || SunMath.dayOfYear(y, month, day) !== doy) bad++;
  }
  const last = SunMath.fromDayOfYear(year, n);
  const ok = !bad && n === (year === 2028 ? 366 : 365) && last.month === 12 && last.day === 31
    && SunMath.dayOfYear(year, 3, 1) === (year === 2028 ? 61 : 60);
  ok ? pass(`dayOfYear/fromDayOfYear ${year} (${n} days)`) : fail(`dayOfYear/fromDayOfYear ${year}: ${bad} bad`);
}

// Noon elevation / azimuth at the site
for (const [m, d, exp] of [[6, 21, 62.0], [12, 21, 15.2]]) {
  const t = SunMath.times(2026, m, d, LAT, LON), s = SunMath.position(t.solarNoon, LAT, LON);
  const line = `2026-${m}-${d} noon ${iso(t.solarNoon)}: elevation ${fmt(s.elevation, 3)} (expect ${exp}±0.3), azimuth ${fmt(s.azimuth, 3)} (expect 180±0.5)`;
  Math.abs(s.elevation - exp) <= 0.3 && angDiff(s.azimuth, 180) <= 0.5 ? pass(line) : fail(line);
}
{
  let worst = 0;
  for (let doy = 1; doy <= 365; doy++) {
    const { month, day } = SunMath.fromDayOfYear(2026, doy);
    worst = Math.max(worst, angDiff(SunMath.position(SunMath.times(2026, month, day, LAT, LON).solarNoon, LAT, LON).azimuth, 180));
  }
  worst <= 0.5 ? pass(`azimuth at solar noon, every day of 2026: max |az-180| = ${fmt(worst, 4)}`) : fail(`azimuth at solar noon: max dev ${fmt(worst)}`);
}

// Sunrise/sunset consistency: apparent elevation ≈ -0.833 + refraction(-0.833) at the event, same London date, ordering
{
  const target = -0.833 + SunMath.refraction(-0.833);
  let worstEl = 0, bad = [];
  for (let doy = 1; doy <= 365; doy++) {
    const { month, day } = SunMath.fromDayOfYear(2026, doy), t = SunMath.times(2026, month, day, LAT, LON);
    for (const k of ['sunrise', 'sunset']) worstEl = Math.max(worstEl, Math.abs(SunMath.position(t[k], LAT, LON).elevation - target));
    const order = t.dawn < t.sunrise && t.sunrise < t.solarNoon && t.solarNoon < t.sunset && t.sunset < t.dusk;
    const sameDay = ['dawn', 'sunrise', 'solarNoon', 'sunset', 'dusk'].every(k => { const p = SunMath.londonParts(t[k]); return p.month === month && p.day === day; });
    const len = Math.abs(t.dayLengthMin - (t.sunset - t.sunrise) / 6e4) < 0.02;
    if (!order || !sameDay || !len) bad.push(`2026-${month}-${day}`);
  }
  worstEl < 0.02 && !bad.length ? pass(`sunrise/sunset 2026: elevation at event within ${fmt(worstEl)}° of ${fmt(target, 3)}, order/date/dayLength ok`)
    : fail(`sunrise/sunset 2026: worst elevation dev ${fmt(worstEl)}, bad days ${bad.slice(0, 5).join(', ')}`);
  const j = SunMath.times(2026, 6, 21, LAT, LON), w = SunMath.times(2026, 12, 21, LAT, LON);
  console.log(`  info 21 Jun: rise ${iso(j.sunrise)} set ${iso(j.sunset)} len ${fmt(j.dayLengthMin / 60, 2)} h | 21 Dec: rise ${iso(w.sunrise)} set ${iso(w.sunset)} len ${fmt(w.dayLengthMin / 60, 2)} h`);
}

// Polar day / night return nulls
{
  const sum = SunMath.times(2026, 6, 21, 78.2, 15.6), win = SunMath.times(2026, 12, 21, 78.2, 15.6);
  const ok = sum.sunrise === null && sum.sunset === null && sum.dayLengthMin === 1440 && win.sunrise === null && win.dawn === null && win.dayLengthMin === 0 && sum.solarNoon instanceof Date;
  ok ? pass('polar day/night (Svalbard) -> nulls, dayLength 1440 / 0') : fail(`polar: ${JSON.stringify({ sum, win })}`);
}

// Shadow length
{
  const ok = Math.abs(SunMath.shadowLength(10, 45) - 10) < 1e-9 && Math.abs(SunMath.shadowLength(10, 15.2) - 10 / Math.tan(15.2 * Math.PI / 180)) < 1e-9
    && SunMath.shadowLength(10, 0) === Infinity && SunMath.shadowLength(10, -3) === Infinity;
  ok ? pass('shadowLength') : fail('shadowLength');
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
