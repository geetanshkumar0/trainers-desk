/**
 * Performance Dashboards.
 *  Old: the T&D Performance Tracker's scorecard (columns E..BF of that sheet).
 *  New: the New Cal sheet (attrition by days completed, NHP, NHT graduation).
 */
import { norm, prettyName } from './common.js';
import { addDaysIso } from '../dates.js';

/** Master rows -> the fields the tracker's COUNTIFS use (lower case, as COUNTIFS ignores case). */
export function tdPrepare(master) {
  const low = v => String(v == null ? '' : v).toLowerCase();
  return master.filter(r => r.empId).map(r => ({
    doj: r.doj, mode: low(r.mode), trainer: low(r.trainer).trim(), manager: low(r.manager).trim(), mentor: low(r.mentor).trim(),
    lateral: low(r.lateral) === 'yes', kcAtt: low(r.kcAttempt), kcStatus: low(r.kcStatus), mockAtt: low(r.mockAttempt), mockStatus: low(r.mockStatus),
    ojt: typeof r.ojtPct === 'number' ? r.ojtPct : null, y: typeof r.attritionDay === 'number' ? r.attritionDay : null,
    tEnd: r.trainingEnd, ojtEnd: r.ojtEnd
  }));
}

/** Raw counts for one person, as the tracker's columns E and N-AK count them. key: trainer | manager | mentor. */
export function tdCounts(rows, key, email, month) {
  email = norm(email);
  const base = rows.filter(r => r[key] === email && !r.lateral && r.doj && (!month || r.doj.slice(0, 7) === month));
  const j = base.filter(r => r.y !== 0);                    // "Day of Attrition <> 0": same-day exits are not joiners
  const n = (list, f) => list.filter(f).length;
  const wfo = r => r.mode === 'wfo', wfh = r => r.mode === 'wfh';
  const att = (lo, hi, m) => n(base, r => r.y !== null && r.y >= lo && r.y <= hi && (!m || m(r)));
  return {
    E: j.length, N: n(j, wfo), O: n(j, wfh),
    P: n(j, r => r.kcStatus === 'pass' || r.kcStatus === 'fail'),
    Q: n(j, r => r.kcStatus === 'pass' && r.kcAtt === '1st'),
    KCPASS: n(j, r => r.kcStatus === 'pass'),
    R: n(j, r => r.mockStatus === 'pass' || r.mockStatus === 'fail'),
    S: n(j, r => r.mockStatus === 'pass' && r.mockAtt === '1st'),
    T: n(j, r => r.mockStatus === 'pass'),
    U: n(j, r => r.ojt !== null && r.ojt >= 0),
    V: n(j, r => r.ojt !== null && r.ojt >= 0.7),
    W: n(j, r => r.ojt !== null && r.ojt >= 0.8),
    X: n(j, r => r.ojt !== null && r.ojt >= 0.9),
    Y: att(1, 7), Z: att(1, 7, wfo), AA: att(1, 7, wfh),
    AB: att(1, 15), AC: att(1, 15, wfo), AD: att(1, 15, wfh),
    AE: att(1, 30), AF: att(1, 30, wfo), AG: att(1, 30, wfh),
    AH: att(1, 45), AI: att(1, 45, wfo), AJ: att(1, 45, wfh),
    AK: att(16, 45)
  };
}

/** BQ required for a trainer and month ('' = every month added up). bq: { required: { trainer: { month: n } } } */
export function tdBqRequired(bq, trainer, month) {
  const m = bq.required[norm(trainer)];
  if (!m) return 0;
  return Object.keys(m).reduce((a, k) => (!month || k === month ? a + m[k] : a), 0);
}

/** BQ done: interventions by this trainer in the month with Effectiveness of 20% or more. */
export function tdBqDone(bq, trainer, month) {
  const t = norm(trainer);
  return bq.done.filter(r => r.trainer === t && (!month || r.date.slice(0, 7) === month) && typeof r.effectiveness === 'number' && r.effectiveness >= 0.2).length;
}

export function tdSum(list) {
  const out = {};
  list.forEach(c => Object.keys(c).forEach(k => { out[k] = (out[k] || 0) + c[k]; }));
  return out;
}

/** Ratios, 0-5 scores, final score and incentive from counts (+ AL required, AM done). Mirrors columns F-M, AN-BF. */
export function tdFinish(c, isTrainer) {
  const o = Object.assign({}, c);
  const ratio = (num, den) => (den ? num / den : '');
  o.F = ratio(c.Q, c.P); o.G = ratio(c.S, c.R); o.H = ratio(c.V, c.U);
  o.I = ratio(c.AI, c.N); o.J = ratio(c.AJ, c.O); o.K = ratio(c.AM, c.AL);
  const z = (num, den) => (den ? num / den : 0);           // IFERROR(x, 0) columns
  o.AN = z(c.W, c.U); o.AO = z(c.X, c.U);
  o.AP = z(c.Y, c.E); o.AQ = z(c.Z, c.N); o.AR = z(c.AA, c.O);
  o.AS = z(c.AB, c.E); o.AT = z(c.AC, c.N); o.AU = z(c.AD, c.O);
  o.AV = z(c.AE, c.E); o.AW = z(c.AF, c.N); o.AX = z(c.AG, c.O);
  o.AY = z(c.AH, c.E); o.AZ = z(c.AK, c.E);
  const down = (v, cuts) => { for (let i = 0; i < 4; i++) { if (v > cuts[i]) return i; } return v >= cuts[4] ? 4 : 5; };
  const up = (v, cuts) => { for (let i = 0; i < 4; i++) { if (v < cuts[i]) return i; } return v <= cuts[4] ? 4 : 5; };
  const tier = (count, big, mid, small) => (count > 20 ? big : count >= 10 ? mid : small);
  o.BA = c.N ? down(o.I, tier(c.N, [.40, .35, .30, .25, .20], [.35, .30, .25, .20, .15], [.30, .25, .20, .15, .10])) : '';
  o.BB = c.O ? down(o.J, tier(c.O, [.45, .40, .35, .30, .25], [.40, .35, .30, .25, .20], [.35, .30, .25, .20, .15])) : '';
  o.BC = c.U ? up(o.H, tier(c.U, [.50, .60, .65, .70, .75], [.55, .65, .70, .75, .80], [.60, .70, .75, .80, .85])) : '';
  o.BD = c.P ? up(o.F, [.65, .70, .75, .85, .90]) : '';
  o.BE = c.R ? up(o.G, [.65, .70, .75, .85, .90]) : '';
  o.BF = c.AL && o.K !== '' ? (o.K < .25 ? 0 : o.K < .5 ? 1 : o.K < .75 ? 2 : o.K < 1 ? 3 : o.K === 1 ? 4 : 5) : '';
  o.L = tdFinalScore(o.BA, o.BB, o.BC, o.BD, o.BE, o.BF);
  o.M = isTrainer && typeof o.L === 'number' ? o.L * 0.25 : '';
  return o;
}

/** Column L: weighted final score. Weights OJT 45, WFH 20, BQ 15, WFO 10, KC 5, Mock 5; missing ones shared out. */
export function tdFinalScore(wfo, wfh, ojt, kc, mock, bq) {
  const has = v => v !== '';
  if (!has(wfo) && !has(wfh) && !has(bq)) return 'Not Eligible';
  if (!has(wfo) && !has(wfh)) return bq;
  const w = { wfo: 10, wfh: 20, ojt: 45, kc: 5, mock: 5, bq: 15 };
  if (!has(wfo) && has(wfh)) { w.wfo = 0; w.wfh = 30; }
  if (!has(wfh) && has(wfo)) { w.wfh = 0; w.wfo = 30; }
  const s = { wfo, wfh, ojt, kc, mock, bq };
  const missing = (has(ojt) ? 0 : 45) + (has(kc) ? 0 : 5) + (has(mock) ? 0 : 5) + (has(bq) ? 0 : 15);
  const present = Object.keys(s).filter(k => has(s[k]));
  const extra = present.length ? missing / present.length : 0;
  const total = present.reduce((a, k) => a + s[k] * (w[k] + extra), 0);
  return Math.round(total + 1e-9) / 100;
}

/** Effective weights after the tracker's redistribution, or null when not eligible. */
export function tdWeights(o) {
  const has = v => v !== '';
  const s = { wfo: o.BA, wfh: o.BB, ojt: o.BC, kc: o.BD, mock: o.BE, bq: o.BF };
  if (!has(s.wfo) && !has(s.wfh)) return null;
  const w = { wfo: 10, wfh: 20, ojt: 45, kc: 5, mock: 5, bq: 15 };
  if (!has(s.wfo)) { w.wfo = 0; w.wfh = 30; }
  if (!has(s.wfh)) { w.wfh = 0; w.wfo = 30; }
  const missing = (has(s.ojt) ? 0 : 45) + (has(s.kc) ? 0 : 5) + (has(s.mock) ? 0 : 5) + (has(s.bq) ? 0 : 15);
  const present = Object.keys(s).filter(k => has(s[k]));
  const out = {};
  Object.keys(s).forEach(k => { out[k] = has(s[k]) ? w[k] + missing / present.length : 0; });
  return out;
}

/**
 * Old dashboard rows for one viewer. Trainers see themselves; managers and mentors also see their own roll-up;
 * the head and admins see every manager, mentor and the head row (all trainers added up).
 */
export function tdBuildView(rows, bq, org, session, month, heads) {
  const nameOf = e => org.names[e] || prettyName(e);
  const cache = {}, leaders = {};
  // A manager's, mentor's or the head's Intervention Required row is a roll-up of their trainers.
  org.rows.forEach(r => { if (r.manager) leaders[r.manager] = true; if (r.mentor) leaders[r.mentor] = true; });
  (heads || []).forEach(h => { leaders[norm(h)] = true; });
  const trainerCounts = e => {
    if (cache[e]) return cache[e];
    const k = tdCounts(rows, 'trainer', e, month);
    k.AL = leaders[e] ? 0 : tdBqRequired(bq, e, month);
    k.AM = tdBqDone(bq, e, month);
    return (cache[e] = k);
  };
  const allTrainers = [], seen = new Set();
  org.rows.forEach(r => { if (!seen.has(r.trainer)) { seen.add(r.trainer); allTrainers.push(r.trainer); } });
  const group = (key, email) => {
    const k = tdCounts(rows, key, email, month);
    k.AL = 0; k.AM = 0;
    org.rows.filter(r => r[key] === email).forEach(r => { const t = trainerCounts(r.trainer); k.AL += t.AL; k.AM += t.AM; });
    return k;
  };
  const out = [];
  const push = (level, email, counts, isTrainer, extra) => {
    const o = tdFinish(counts, isTrainer);
    o.level = level; o.email = email; o.name = nameOf(email); o.weights = tdWeights(o);
    Object.assign(o, extra || {});
    out.push(o);
  };
  const wide = session.role === 'head' || session.role === 'admin' || session.isAdmin;
  if (wide) push('head', norm(heads[0] || ''), tdSum(allTrainers.map(trainerCounts)), false, { trainerCount: allTrainers.length });
  const uniq = key => { const s2 = new Set(), l = []; org.rows.forEach(r => { if (r[key] && !s2.has(r[key])) { s2.add(r[key]); l.push(r[key]); } }); return l; };
  const lead = key => uniq(key).forEach(m => {
    if (!wide && m !== session.email) return;
    const g = group(key, m);
    if (!g.E && !g.AL && !g.AM && m !== session.email) return;   // nobody under them in this period
    push(key, m, g, false);
  });
  lead('manager'); lead('mentor');
  session.trainers.forEach(t => {
    // Managers / mentors also listed as trainers, with no trainees of their own, only show their roll-up row.
    if (leaders[t.email] && t.email !== session.email && !trainerCounts(t.email).E && !trainerCounts(t.email).AM) return;
    const r = org.rows.find(x => x.trainer === t.email) || {};
    push('trainer', t.email, trainerCounts(t.email), true, { manager: r.manager || '', mentor: r.mentor || '' });
  });
  return { month, rows: out };
}

/* ---------------- New Cal ---------------- */

/** month 'yyyy-MM': that month. '': 1 Feb this year to the end of this month (OJT and NHT up to today). */
export function ncWindow(month, today) {
  const eom = ym => { const p = ym.split('-'); return ym + '-' + String(new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate()).padStart(2, '0'); };
  if (month) return { from: month + '-01', to: eom(month), toOjt: eom(month) };
  return { from: today.slice(0, 4) + '-02-01', to: eom(today.slice(0, 7)), toOjt: today };
}

/**
 * New Cal counts for one person. key trainer | manager.
 * Completed N days: DOJ between (from - (N-1)) and (to - (N-1)); exited: of those, Day of Attrition <= N.
 * OJT: OJT End Date in the window; NHT: Final Mock / Training End Date in the window. Laterals and same-day exits count.
 */
export function ncCounts(rows, key, email, win) {
  email = norm(email);
  const mine = rows.filter(r => r[key] === email);
  const o = {}, modes = { T: null, O: 'wfo', H: 'wfh' };
  const inMode = (r, m) => !modes[m] || r.mode === modes[m];
  [45, 15, 30].forEach(n => {
    const lo = addDaysIso(win.from, -(n - 1)), hi = addDaysIso(win.to, -(n - 1));
    Object.keys(modes).forEach(m => {
      const cohort = mine.filter(r => r.doj && r.doj >= lo && r.doj <= hi && inMode(r, m));
      o['comp' + n + m] = cohort.length;
      o['exit' + n + m] = cohort.filter(r => r.y !== null && r.y <= n).length;
    });
  });
  Object.keys(modes).forEach(m => {
    const ojt = mine.filter(r => r.ojtEnd && r.ojtEnd >= win.from && r.ojtEnd <= win.toOjt && inMode(r, m));
    o['ojt' + m] = ojt.length;
    [70, 80, 90].forEach(c => { o['clr' + c + m] = ojt.filter(r => r.ojt !== null && r.ojt >= c / 100).length; });
    const nht = mine.filter(r => r.tEnd && r.tEnd >= win.from && r.tEnd <= win.toOjt && inMode(r, m));
    o['join' + m] = nht.length;
    o['grad' + m] = nht.filter(r => r.mockStatus === 'pass').length;
  });
  return o;
}

export function ncFinish(c) {
  const o = Object.assign({}, c);
  const r = (a, b) => (b ? a / b : '');
  ['T', 'O', 'H'].forEach(m => {
    [45, 15, 30].forEach(n => { o['exitp' + n + m] = r(c['exit' + n + m], c['comp' + n + m]); });
    [70, 80, 90].forEach(x => { o['nhp' + x + m] = r(c['clr' + x + m], c['ojt' + m]); });
    o['gradp' + m] = r(c['grad' + m], c['join' + m]);
  });
  return o;
}

/** New Cal rows for one viewer: head (all trainers added up), managers and trainers, like the sheet. */
export function ncBuildView(rows, org, session, month, heads, today) {
  const win = ncWindow(month, today);
  const nameOf = e => org.names[e] || prettyName(e);
  const trainers = [], seen = new Set(), leaders = {};
  org.rows.forEach(r => {
    if (!seen.has(r.trainer)) { seen.add(r.trainer); trainers.push(r.trainer); }
    if (r.manager) leaders[r.manager] = true;
    if (r.mentor) leaders[r.mentor] = true;
  });
  const cache = {};
  const tc = e => cache[e] || (cache[e] = ncCounts(rows, 'trainer', e, win));
  const out = [];
  const push = (level, email, counts) => { const o = ncFinish(counts); o.level = level; o.email = email; o.name = nameOf(email); out.push(o); };
  const wide = session.role === 'head' || session.role === 'admin' || session.isAdmin;
  if (wide) push('head', norm(heads[0] || ''), tdSum(trainers.map(tc)));
  const mgrs = [], ms = new Set();
  org.rows.forEach(r => { if (r.manager && !ms.has(r.manager)) { ms.add(r.manager); mgrs.push(r.manager); } });
  mgrs.forEach(m => {
    if (!wide && m !== session.email) return;
    const c = ncCounts(rows, 'manager', m, win);
    if (!c.comp45T && !c.ojtT && !c.joinT && m !== session.email) return;
    push('manager', m, c);
  });
  session.trainers.forEach(t => {
    const c = tc(t.email);
    if (leaders[t.email] && t.email !== session.email && !c.comp45T && !c.ojtT && !c.joinT) return;
    push('trainer', t.email, c);
  });
  return { month, window: win, rows: out };
}
