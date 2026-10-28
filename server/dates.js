/** Dates in the sheet time zone. Inside Trainer Desk a date is always 'yyyy-MM-dd' text. */
import { CONFIG } from './config.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtCache = {};

/** Wall-clock parts of a moment in a time zone. */
export function tzParts(date, tz = CONFIG.TZ) {
  const f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
  }));
  const p = {};
  f.formatToParts(date).forEach(x => { p[x.type] = x.value; });
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 'yyyy-MM-dd' of a moment (default now) in the sheet time zone. */
export function isoDay(date = new Date(), tz = CONFIG.TZ) {
  const p = tzParts(date, tz);
  return p.y + '-' + pad(p.m) + '-' + pad(p.d);
}
export const today = () => isoDay(new Date());

/** 'HH:mm' of a moment in the sheet time zone. */
export function hhmm(date = new Date(), tz = CONFIG.TZ) { const p = tzParts(date, tz); return pad(p.h) + ':' + pad(p.mi); }

/** 'yyMMddHHmmss' (change request IDs). */
export function stamp(date = new Date(), tz = CONFIG.TZ) {
  const p = tzParts(date, tz);
  return pad(p.y % 100) + pad(p.m) + pad(p.d) + pad(p.h) + pad(p.mi) + pad(p.s);
}

export function addDaysIso(iso, n) {
  const p = iso.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

export function dayNumber(iso) {
  const p = iso.split('-');
  return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
}

export function prettyDate(iso) {
  if (!iso) return '';
  const p = String(iso).split('-');
  return (+p[2]) + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0];
}

/**
 * A date as Google Sheets shows it -> 'yyyy-MM-dd' (or '' when it is not a date).
 * Handles 2026-02-04, 4-Feb-2026, 4 Feb 2026, Feb 4, 2026, 2/4/2026 (M/D in en_US, D/M elsewhere), with an optional time.
 * withTime: also returns the time as an ISO-8601 UTC timestamp { iso, at }.
 */
export function parseSheetDate(v, locale = 'en_US', withTime = false) {
  let s = String(v == null ? '' : v).trim().replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+/i, '');
  if (!s || s.length > 30) return withTime ? null : '';
  const T = '(?:[ ,T]+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?(?:\\.\\d+)?\\s*([AaPp][Mm])?)?$';
  const mon = n => MONTHS.findIndex(x => x.toLowerCase() === n.slice(0, 3).toLowerCase()) + 1;
  const yr = y => (y.length === 2 ? 2000 + +y : +y);
  const hr = (h, ap) => { h = +(h || 0); if (ap) { ap = ap.toUpperCase(); if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0; } return h; };
  const ok = (y, mo, d) => mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200;
  let y, mo, d, m, H = 0, Mi = 0, S = 0;
  if ((m = s.match(new RegExp('^(\\d{4})-(\\d{1,2})-(\\d{1,2})' + T))) && ok(+m[1], +m[2], +m[3])) { y = +m[1]; mo = +m[2]; d = +m[3]; H = hr(m[4], m[7]); Mi = +(m[5] || 0); S = +(m[6] || 0); }
  else if ((m = s.match(new RegExp('^(\\d{1,2})[-\\s/.]([A-Za-z]{3,9})[-\\s/.,]+(\\d{2}|\\d{4})' + T))) && mon(m[2]) && ok(yr(m[3]), mon(m[2]), +m[1])) {
    y = yr(m[3]); mo = mon(m[2]); d = +m[1]; H = hr(m[4], m[7]); Mi = +(m[5] || 0); S = +(m[6] || 0);
  } else if ((m = s.match(new RegExp('^([A-Za-z]{3,9})[-\\s.]+(\\d{1,2}),?[-\\s.]+(\\d{4})' + T))) && mon(m[1]) && ok(+m[3], mon(m[1]), +m[2])) {
    y = +m[3]; mo = mon(m[1]); d = +m[2]; H = hr(m[4], m[7]); Mi = +(m[5] || 0); S = +(m[6] || 0);
  } else if ((m = s.match(new RegExp('^(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{2}|\\d{4})' + T)))) {
    let a = +m[1], b = +m[2];
    mo = a; d = b;
    if (!/^en_US/i.test(locale || 'en_US')) { mo = b; d = a; }
    if (mo > 12 && d <= 12) { const x = mo; mo = d; d = x; }
    y = yr(m[3]); H = hr(m[4], m[7]); Mi = +(m[5] || 0); S = +(m[6] || 0);
    if (!ok(y, mo, d)) y = undefined;
  }
  if (y === undefined) return withTime ? null : '';
  const iso = y + '-' + pad(mo) + '-' + pad(d);
  if (!withTime) return iso;
  return { iso, at: zoned(y, mo, d, H, Mi, S).toISOString() };
}

/** The moment of a wall-clock time in the sheet time zone. */
export function zoned(y, m, d, h = 0, mi = 0, s = 0, tz = CONFIG.TZ) {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = tzParts(new Date(t), tz);
    t += guess - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  }
  return new Date(t);
}

/** Any value that may hold a date -> 'yyyy-MM-dd' ('' when blank or unreadable). Same rule as Code.gs toIso_. */
export function toIso(v, locale) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : isoDay(v);
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m && !locale) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
  return locale ? parseSheetDate(s, locale) : '';
}

/** "1:58:46" / "0:00:02" / "75:10:00" -> seconds (0 when blank or unreadable). */
export function durationSeconds(text) {
  const m = String(text == null ? '' : text).trim().match(/^(-?\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+(m[3] || 0)) : 0;
}
