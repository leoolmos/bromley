/* Sun position and sun times (NOAA solar calculator / Meeus), plus Europe/London DST helpers.
   UMD: window.SunMath in browsers, module.exports in Node. Angles in degrees, longitude east-positive. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SunMath = factory();
})(typeof self !== 'undefined' ? self : this, () => {
'use strict';

const RAD = Math.PI / 180, DEG = 180 / Math.PI, DAY_MS = 864e5, MIN_MS = 6e4;
const sin = d => Math.sin(d * RAD), cos = d => Math.cos(d * RAD), tan = d => Math.tan(d * RAD);
const mod = (a, n) => ((a % n) + n) % n;
const clamp1 = x => Math.max(-1, Math.min(1, x));

const julianDay = ms => ms / DAY_MS + 2440587.5;

// Declination (deg) and equation of time (min) at Julian day jd (UT used as TT; ΔT is negligible here)
function solar(jd) {
  const T = (jd - 2451545) / 36525;
  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + sin(2 * M) * (0.019993 - 0.000101 * T) + sin(3 * M) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * sin(omega);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * cos(omega);
  const decl = Math.asin(clamp1(sin(eps) * sin(lambda))) * DEG;
  const y = tan(eps / 2) ** 2;
  const eot = 4 * DEG * (y * sin(2 * L0) - 2 * e * sin(M) + 4 * e * y * sin(M) * cos(2 * L0)
    - 0.5 * y * y * sin(4 * L0) - 1.25 * e * e * sin(2 * M));
  return { decl, eot };
}

// NOAA atmospheric refraction correction (deg) for a geometric elevation h (deg)
function refraction(h) {
  if (h > 85) return 0;
  const t = tan(h);
  let arcsec;
  if (h > 5) arcsec = 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5;
  else if (h > -0.575) arcsec = 1735 + h * (-518.2 + h * (103.4 + h * (-12.79 + h * 0.711)));
  else arcsec = -20.774 / t;
  return arcsec / 3600;
}

function position(date, lat, lon) {
  const ms = +date, { decl, eot } = solar(julianDay(ms));
  const utcMin = mod(ms, DAY_MS) / MIN_MS;
  const ha = mod(utcMin + eot + 4 * lon, 1440) / 4 - 180; // hour angle, negative before noon
  const cosZ = clamp1(sin(lat) * sin(decl) + cos(lat) * cos(decl) * cos(ha));
  const geo = 90 - Math.acos(cosZ) * DEG;
  const azimuth = mod(Math.atan2(sin(ha), cos(ha) * sin(lat) - tan(decl) * cos(lat)) * DEG + 180, 360);
  const elevation = geo + refraction(geo);
  return { azimuth, elevation, zenith: 90 - elevation, geometricElevation: geo, declination: decl, eqTime: eot, hourAngle: ha };
}

/* ---------------- sun times ---------------- */

// Minutes from UTC midnight of the date (may be <0 or >1440 far from Greenwich)
function noonMin(base, lon) {
  let t = 720 - 4 * lon;
  for (let i = 0; i < 3; i++) t = 720 - 4 * lon - solar(julianDay(base + t * MIN_MS)).eot;
  return t;
}

// Rising (sign -1) or setting (+1) when the geometric zenith reaches `zen`; null if it never does
function eventMin(base, lat, lon, zen, sign, noon) {
  let t = noon;
  for (let i = 0; i < 4; i++) {
    const { decl, eot } = solar(julianDay(base + t * MIN_MS));
    const c = cos(zen) / (cos(lat) * cos(decl)) - tan(lat) * tan(decl);
    if (c < -1 || c > 1) { if (i === 0) return null; continue; }
    t = 720 - 4 * lon - eot + sign * 4 * Math.acos(c) * DEG;
  }
  const { decl } = solar(julianDay(base + t * MIN_MS));
  const c = cos(zen) / (cos(lat) * cos(decl)) - tan(lat) * tan(decl);
  return c < -1 || c > 1 ? null : t;
}

function times(year, month, day, lat, lon) {
  const base = Date.UTC(year, month - 1, day);
  const at = t => t == null ? null : new Date(base + Math.round(t * MIN_MS));
  const noon = noonMin(base, lon);
  const rise = eventMin(base, lat, lon, 90.833, -1, noon), set = eventMin(base, lat, lon, 90.833, 1, noon);
  let dayLengthMin;
  if (rise != null && set != null) dayLengthMin = set - rise;
  else dayLengthMin = position(new Date(base + noon * MIN_MS), lat, lon).elevation > 0 ? 1440 : 0;
  return {
    sunrise: at(rise), sunset: at(set), solarNoon: at(noon),
    dawn: at(eventMin(base, lat, lon, 96, -1, noon)), dusk: at(eventMin(base, lat, lon, 96, 1, noon)),
    dayLengthMin,
  };
}

/* ---------------- Europe/London ---------------- */

const lastSundayUTC = (year, month /* 1-12 */) => {
  const last = new Date(Date.UTC(year, month, 0));
  return Date.UTC(year, month - 1, last.getUTCDate() - last.getUTCDay(), 1);
};

// BST from 01:00 UTC on the last Sunday of March until 01:00 UTC on the last Sunday of October
function londonOffsetMin(date) {
  const ms = +date, y = new Date(ms).getUTCFullYear();
  return ms >= lastSundayUTC(y, 3) && ms < lastSundayUTC(y, 10) ? 60 : 0;
}

// Wall clock -> instant. Repeated hour (October) resolves to the earlier (BST) instant;
// the skipped hour (March) is read as GMT, i.e. 01:30 -> 02:30 BST.
function londonToDate(year, month, day, minutes) {
  const wall = Date.UTC(year, month - 1, day) + minutes * MIN_MS;
  const bst = wall - 60 * MIN_MS;
  return new Date(londonOffsetMin(bst) === 60 ? bst : wall);
}

function londonParts(date) {
  const offsetMin = londonOffsetMin(date), d = new Date(+date + offsetMin * MIN_MS);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    minutes: mod(+d, DAY_MS) / MIN_MS, offsetMin,
  };
}

/* ---------------- calendar ---------------- */

const daysInYear = year => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
const dayOfYear = (year, month, day) => Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / DAY_MS) + 1;
function fromDayOfYear(year, doy) {
  const d = new Date(Date.UTC(year, 0, doy));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// Length of the shadow cast by a vertical object of heightM; Infinity when the sun is down
const shadowLength = (heightM, elevationDeg) => elevationDeg > 0 ? heightM / tan(elevationDeg) : Infinity;

return { position, times, refraction, londonOffsetMin, londonToDate, londonParts, dayOfYear, fromDayOfYear, daysInYear, shadowLength };
});
