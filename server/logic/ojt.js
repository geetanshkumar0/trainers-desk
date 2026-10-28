/** OJT: start date from Talktime, targets, achievements, scores and result. */
import { norm, normId } from './common.js';
import { addDaysIso, dayNumber } from '../dates.js';
import { nhtStage } from './batches.js';

/**
 * Trainees who moved from NHT to OJT, with OJT dates and talktime. A trainee moves when OJT Entered and OJT Eligible
 * are both Yes (see nhtStage); stage.movedOn gives the day that happened, used when there is no training end date.
 * talkById: { empId: [{ date, secs }] }. OJT start = first day with talktime above minSecs on or after training end.
 */
export function buildOjtRows(master, talkById, today, minSecs, ojtDays, stage) {
  const out = [], seen = new Set();
  master.forEach(v => {
    const id = v.empId;
    if (!id || seen.has(id)) return;
    if (nhtStage(v, stage) !== 'ojt') return;                     // still in NHT, or training ended without OJT
    const tEnd = v.trainingEnd || (stage && stage.movedOn && stage.movedOn[id]) || '';
    if (!tEnd) return;
    seen.add(id);
    const days = (talkById[id] || []).filter(t => t.date >= tEnd && t.secs > minSecs)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const start = days.length ? days[0].date : '', end = start ? addDaysIso(start, ojtDays - 1) : '';
    const inWin = days.filter(t => t.date <= end), dayKeys = new Set(inWin.map(t => t.date));
    const lwd = v.lwd, left = norm(v.status) !== 'active' && !!lwd;
    const status = left && (!start || lwd < end) ? 'Left' : !start ? 'Waiting for first call' : today > end ? 'OJT completed' : 'In OJT';
    out.push({
      empId: id, name: v.name, trainer: v.trainer, mode: v.mode, email: norm(v.email), dept: v.department, subTeam: v.subTeam,
      doj: v.doj, trainingEnd: tEnd, ojtStart: start, ojtEnd: end, lwd, status,
      ojtDay: start && today >= start ? Math.min(dayNumber(today) - dayNumber(start) + 1, ojtDays) : 0,
      talkDays: dayKeys.size, talkSecs: inWin.reduce((a, t) => a + t.secs, 0),
      lastTalk: days.length ? days[days.length - 1].date : ''
    });
  });
  out.sort((a, b) => (a.trainingEnd < b.trainingEnd ? 1 : a.trainingEnd > b.trainingEnd ? -1 : a.name.localeCompare(b.name)));
  return out;
}

/**
 * Where each team's metrics come from. Keyed 'Department|Team|Metric' exactly as in the OJT Targets sheet.
 *   source: a key of CONFIG.OJT_DUMPS, 'talktime', 'ms2v' or 'manual' (entered in Trainer Desk)
 *   from:   'ojt' counts from OJT Start Date, 'doj' from DOJ; both run to OJT End Date (+ extraDays)
 * Every metric named "Talktime" uses Talktime from DOJ, so it is not listed. A metric missing here shows "No data source yet".
 */
export const OJT_METRIC_SOURCES = {
  'Seller Servicing|Seller Servicing (MS)|Meeting Scheduled': { source: 'sellerMs', from: 'ojt' },
  'Seller Servicing|Seller Servicing (Closure)|Closure': { source: 'sellerClosure', from: 'doj' },
  'Owner Servicing|Owner Servicing (MS)|Meeting Schedules': { source: 'ownerMs', from: 'ojt' },
  'Owner Servicing|Owner Servicing (Closure)|NB Closure': { source: 'ownerClosure', from: 'doj' },
  'PnM Sales|PnM Sales Intra|Closure': { source: 'intracity', from: 'doj' },
  'PnM Sales|PnM Sales Inter|Closure': { source: 'intercity', from: 'ojt' },
  'PMS Sales|PMS Sales|Revenue': { source: 'pmsRevenue', from: 'ojt' },
  'Legal Services|Legal Sales|Revenue': { source: 'legalRevenue', from: 'ojt', extraDays: 15 },
  'Investment Advisory|Investment Advisory|MS2V': { source: 'ms2v', from: 'ojt' },
  // The targets sheet labels CPMS Servicing's talktime row "Ops Rating" (its targets are hours).
  'CPMS Servicing|CPMS Servicing|Ops Rating': { source: 'talktime', from: 'doj', rename: 'Talktime' },
  'Legal Services|Legal Servicing|Ops Rating': { source: 'manual' },
  'CPMS Servicing|CPMS Servicing|PKT Scores': { source: 'manual' },
  'CPMS Servicing|CPMS Servicing - Escalations|PKT Scores': { source: 'manual' }
};

/** Default OJT team from Department and Sub-Team. First match wins: [department, sub-team, 'Department|Team']. */
export const OJT_TEAM_RULES = [
  [/^investment advisory$/i, /./, 'Investment Advisory|Investment Advisory'],
  [/./, /^investment advisory$/i, 'Investment Advisory|Investment Advisory'],
  [/^legal sales$/i, /./, 'Legal Services|Legal Sales'],
  [/^legal servicing$/i, /./, 'Legal Services|Legal Servicing'],
  [/^loan sales$/i, /./, 'Loan|Sales'],
  [/^pnm sales$/i, /intra/i, 'PnM Sales|PnM Sales Intra'],
  [/^pnm sales$/i, /inter/i, 'PnM Sales|PnM Sales Inter'],
  [/^pms sales$/i, /./, 'PMS Sales|PMS Sales'],
  [/^cpms tenant search$/i, /./, 'CPMS Servicing|Tenant Search'],
  [/^cpms servicing$/i, /tenant search|cpms-ts/i, 'CPMS Servicing|Tenant Search'],
  [/^cpms servicing$/i, /./, 'CPMS Servicing|CPMS Servicing'],
  [/owner servicing|super servicing/i, /owner.*auto|ss - auto/i, 'Owner Servicing|Owner Servicing (MS)'],
  [/^owner servicing$/i, /./, 'Owner Servicing|Owner Servicing (Closure)'],
  [/^super servicing$/i, /owner/i, 'Owner Servicing|Owner Servicing (Closure)'],
  [/seller servicing|seller prepaid servicing/i, /auto/i, 'Seller Servicing|Seller Servicing (MS)'],
  [/seller servicing|seller prepaid servicing/i, /./, 'Seller Servicing|Seller Servicing (Closure)'],
  [/^buyer acquisition/i, /supply rm/i, 'Seller Servicing|Seller Servicing (Closure)'],
  [/^tenant servicing$/i, /tspp/i, 'Tenant Service|TSPP'],
  [/^tenant servicing$/i, /./, 'Tenant Service|TS/TSRP'],
  [/^buyer acquisition/i, /pre.?sales/i, 'BAPS|BAPS - Pre Sales'],
  [/^plot/i, /./, 'Plot|Sales'],
  [/^seller sales$/i, /prepaid/i, 'Seller Sales|Prepaid'],
  [/^seller sales$/i, /postpaid/i, 'Seller Sales|Postpaid'],
  [/^owner sales$/i, /prepaid/i, 'Owner Sales|Prepaid'],
  [/^owner (sales|postpaid)$/i, /postpaid/i, 'Owner Sales|Postpaid'],
  [/^cpms sales$/i, /./, 'NRI Sales|CPMS Sales'],
  [/^nri sales$/i, /- ?os$/i, 'NRI Sales|Owner/Seller'],
  [/^nri sales$/i, /- ?tb$/i, 'NRI Sales|Tenant/Buyer'],
  [/^commercial sales$/i, /- ?os$/i, 'Commercial Sales|Commercial Sales O/S'],
  [/^commercial sales$/i, /- ?tb$/i, 'Commercial Sales|Commercial Sales T/B'],
  [/^field monetisation$/i, /^owner/i, 'FRM|Owner'],
  [/^field monetisation$/i, /^seller/i, 'FRM|Seller'],
  [/^field monetisation$/i, /^tenant/i, 'FRM|Tenant'],
  [/^outbound$/i, /^misc/i, 'Outbound|MISC South'],
  [/^pnm-?servicing$/i, /inbound/i, 'PnM Servicing|Servicing - Inbound'],
  [/^pnm-?servicing$/i, /ticketing/i, 'PnM Servicing|Servicing - Ticketing'],
  [/^pnm-?servicing$/i, /chat/i, 'PnM Servicing|Servicing - Chat'],
  // Homestore: the sub-team names the activity, e.g. "Homestore AC Chat" -> "Chat".
  [/^homestore - (non )?painting$/i, /chat|customer inbound|partner inbound|partner assignment|schedule|escalation/i, (dept, sub) => {
    const m = sub.match(/chat|customer inbound|partner inbound|partner assignment|schedule|escalation/i)[0].toLowerCase();
    return dept.replace(/^homestore - /i, 'Homestore - ').replace(/non painting/i, 'Non Painting').replace(/- painting/i, '- Painting') + '|' +
      m.replace(/(^| )\w/g, x => x.toUpperCase());
  }]
];

/** "18:00:00" / "132:00:00" -> hours; anything else -> null. */
function durationHours(text) {
  const m = String(text == null ? '' : text).trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  return m ? (+m[1]) + (+m[2]) / 60 + (+(m[3] || 0)) / 3600 : null;
}

/**
 * OJT Targets sheet -> { 'Department|Team': { key, dept, team, comment, metrics }, _order: [...] }.
 * values / display: the sheet's raw and displayed grids (duration cells are read from the display).
 * Columns: A Department, B Team, E OJT Duration, F Metric, G Metric Type, H Weightage, I Unit, J-M W1-W4, N Overall, O Comment.
 */
export function parseOjtTargets(values, display) {
  const out = {}, order = [];
  const cell = (r, c) => {
    const h = durationHours(display && display[r] ? display[r][c] : '');
    if (h !== null) return { v: h, hours: true };
    const x = (values[r] || [])[c];
    if (typeof x === 'number' && !isNaN(x)) return { v: x, hours: false };
    const n = parseFloat(String(x == null ? '' : x).replace(/[,%₹\s]/g, ''));
    if (!isNaN(n) && /^[\d.,%₹\s]+$/.test(String(x))) return { v: /%/.test(String(x)) ? n / 100 : n, hours: false };
    return null;
  };
  const s = (v, i) => String(v[i] == null ? '' : v[i]).trim();
  let curDept = '', curTeam = '';
  for (let r = 1; r < (values || []).length; r++) {
    const v = values[r] || [];
    const dept = s(v, 0) || curDept, team = s(v, 1) || curTeam, metric = s(v, 5);
    curDept = dept; curTeam = team;
    if (!dept || !team) continue;
    const key = dept + '|' + team;
    if (!out[key]) { out[key] = { key, dept, team, comment: '', metrics: [] }; order.push(key); }
    if (s(v, 14)) out[key].comment = s(v, 14);
    if (!metric) continue;
    const weeks = [9, 10, 11, 12].map(c => cell(r, c));
    const overall = cell(r, 13);
    const hours = (overall && overall.hours) || weeks.some(w => w && w.hours);
    const unit = s(v, 8);
    const kind = hours ? 'hours' : /percent/i.test(unit) || /%|ms2v/i.test(metric) ? 'pct' : /inr/i.test(unit) && !/count/i.test(metric) ? 'inr'
      : /rating|score/i.test(unit + ' ' + metric) ? 'rating' : 'count';
    out[key].metrics.push({ name: metric, type: s(v, 6), weight: Number(v[7]) || 0, unit, kind,
      weeks: weeks.map(w => (w ? w.v : null)), target: overall ? overall.v : null });
  }
  out._order = order;
  return out;
}

/** Targets -> the OJT team choices for the page. */
export function ojtTeamList(targets) {
  return (targets._order || []).map(k => {
    const t = targets[k], totalW = t.metrics.reduce((a, m) => a + m.weight, 0) || 1;
    return { key: k, dept: t.dept, team: t.team, comment: t.comment, metrics: t.metrics.map(m => {
      const map = OJT_METRIC_SOURCES[k + '|' + m.name];
      return { name: (map && map.rename) || m.name, kind: map && map.source === 'talktime' ? 'hours' : m.kind, target: m.target,
        weight: Math.round(m.weight / totalW * 1000) / 1000, manual: !!(map && map.source === 'manual'),
        source: map ? map.source : /^talktime$/i.test(m.name) ? 'talktime' : '' };
    }) };
  });
}

/** One dump tab's grid (header row first) -> rows { date, email, value, lead }. Rows without a date or failing the status filter are skipped. */
export function ojtDumpRows(values, spec, dateOf) {
  const out = [], c = n => (n ? n - 1 : -1);
  const cd = c(spec.date), ce = c(spec.email), cv = c(spec.value), cl = c(spec.lead), cs = c(spec.status);
  const want = spec.statusIs ? String(spec.statusIs).trim().toUpperCase() : '';
  for (let r = 1; r < (values || []).length; r++) {
    const v = values[r] || [], d = dateOf(v[cd]);
    if (!d) continue;
    if (want && String(v[cs] == null ? '' : v[cs]).trim().toUpperCase() !== want) continue;
    let val = null;
    if (cv >= 0) { val = typeof v[cv] === 'number' ? v[cv] : parseFloat(String(v[cv] == null ? '' : v[cv]).replace(/[,₹\s]/g, '')); if (isNaN(val)) val = 0; }
    out.push({ date: d, email: ce >= 0 ? norm(v[ce]) : '', value: val, lead: cl >= 0 ? String(v[cl] == null ? '' : v[cl]).trim() : '' });
  }
  return out;
}

/** The targets team a trainee belongs to by default ('' when none fits). */
export function defaultOjtTeam(dept, sub, targets) {
  dept = String(dept || '').trim(); sub = String(sub || '').trim();
  for (const rule of OJT_TEAM_RULES) {
    if (!rule[0].test(dept) || !rule[1].test(sub || '-')) continue;
    const key = typeof rule[2] === 'function' ? rule[2](dept, sub) : rule[2];
    if (targets[key]) return key;
  }
  // Otherwise: the same department and team name in the targets sheet, or a department with a single team.
  const keys = (targets._order || []).filter(k => targets[k].dept.toLowerCase() === dept.toLowerCase());
  const exact = keys.filter(k => targets[k].team.toLowerCase() === sub.toLowerCase());
  if (exact.length) return exact[0];
  return keys.length === 1 ? keys[0] : '';
}

/** Dump rows -> { byEmail, from, to, n, leads }. */
export function indexOjtSource(rows) {
  const out = { byEmail: {}, from: '', to: '', n: 0, leads: {} };
  (rows || []).forEach(r => {
    if (!r.date) return;
    if (!out.from || r.date < out.from) out.from = r.date;
    if (!out.to || r.date > out.to) out.to = r.date;
    out.n++;
    if (r.lead) out.leads[r.lead] = true;
    if (r.email) (out.byEmail[r.email] = out.byEmail[r.email] || []).push(r);
  });
  return out;
}

/** 0-5 score from an achievement fraction (same bands as the OJT dashboards). */
export function ojtBandScore(p) { return p < 0.5 ? 0 : p < 0.6 ? 1 : p < 0.65 ? 2 : p < 0.7 ? 3 : p <= 0.75 ? 4 : 5; }

/**
 * Targets, achievements, scores and result for each trainee in OJT.
 * rows: buildOjtRows(); targets: parseOjtTargets(); sources: { key: indexOjtSource() }; talkById: { empId: [{ date, secs }] };
 * teamSet: { empId: 'Department|Team' } picked by trainers; manual: { empId: { metric: value } }; rules: CONFIG.OJT_PASS_RULES.
 */
export function buildOjtPerformance(rows, targets, sources, talkById, teamSet, manual, today, rules) {
  const sum = (list, from, to, f) => list.reduce((a, x) => (x.date >= from && x.date <= to ? a + f(x) : a), 0);
  return rows.map(r => {
    const setKey = (teamSet || {})[r.empId] || '';
    const key = setKey && targets[setKey] ? setKey : defaultOjtTeam(r.dept, r.subTeam, targets);
    const out = { empId: r.empId, team: key, teamSet: !!(setKey && targets[setKey]), metrics: [], achievement: null, score: null, result: '', note: '' };
    const t = targets[key];
    if (!t) { out.result = 'No OJT team'; out.note = 'Pick an OJT team'; return out; }
    if (!t.metrics.length) { out.result = 'No targets'; out.note = t.comment || 'The targets sheet has no metrics for this team'; return out; }
    const started = !!r.ojtStart, end = r.ojtEnd;
    const totalW = t.metrics.reduce((a, m) => a + m.weight, 0) || 1;
    const missing = [], partial = [];
    t.metrics.forEach(m => {
      const map = OJT_METRIC_SOURCES[key + '|' + m.name] || (/^talktime$/i.test(m.name) ? { source: 'talktime', from: 'doj' } : null);
      const mo = { name: (map && map.rename) || m.name, type: m.type, kind: map && map.source === 'talktime' ? 'hours' : m.kind, unit: m.unit,
        weight: m.weight / totalW, target: m.target, weekTargets: m.weeks, achieved: null, pct: null, score: null,
        source: map ? map.source : '', from: '', to: '', data: 'ok', weeks: [] };
      out.metrics.push(mo);
      if (!map) { mo.data = 'nosource'; missing.push(mo.name); return; }
      if (!started) { mo.data = 'notstarted'; return; }
      const winFrom = map.from === 'doj' && r.doj ? r.doj : r.ojtStart;
      const winTo = addDaysIso(end, map.extraDays || 0);
      mo.from = winFrom; mo.to = winTo;
      const weekWin = [0, 1, 2, 3].map(k => ({ from: k === 0 ? winFrom : addDaysIso(r.ojtStart, 7 * k), to: k === 3 ? winTo : addDaysIso(r.ojtStart, 7 * k + 6) }));
      let measure;
      if (map.source === 'manual') {
        const mv = ((manual || {})[r.empId] || {})[mo.name];
        if (mv === undefined || mv === null || mv === '') { mo.data = 'manual'; if (today > end) missing.push(mo.name); return; }
        mo.achieved = Number(mv);
      } else if (map.source === 'talktime') {
        const tl = talkById[r.empId] || [];
        measure = (from, to) => sum(tl, from, to, x => x.secs) / 3600;
      } else if (map.source === 'ms2v') {
        const ms = sources.buyerMs, pv = sources.buyerPv;
        if (!ms || !pv) { mo.data = 'nodump'; missing.push(mo.name); return; }
        const leads = (ms.byEmail[r.email] || []).filter(x => x.lead && x.lead !== 'undefined');
        measure = (from, to) => {
          const inWin = leads.filter(x => x.date >= from && x.date <= to);
          return inWin.length ? inWin.filter(x => pv.leads[x.lead]).length / inWin.length : 0;
        };
        mo.coverFrom = ms.from; mo.coverTo = ms.to;
      } else {
        const src = sources[map.source];
        if (!src || !src.n) { mo.data = 'nodump'; missing.push(mo.name); return; }
        const list = src.byEmail[r.email] || [];
        measure = (from, to) => sum(list, from, to, x => (typeof x.value === 'number' ? x.value : 1));
        mo.coverFrom = src.from; mo.coverTo = src.to;
      }
      if (measure) {
        if (mo.coverFrom && mo.coverFrom > winTo) { mo.data = 'nodump'; missing.push(mo.name); return; }
        const upTo = winTo < today ? winTo : today;
        if (mo.coverFrom && (mo.coverFrom > winFrom || mo.coverTo < upTo)) { mo.data = 'partial'; partial.push(mo.name); }
        mo.achieved = measure(winFrom, winTo);
        mo.weeks = weekWin.map((w, k) => ({ from: w.from, to: w.to, target: m.weeks[k], achieved: w.from > today ? null : measure(w.from, w.to) }));
      }
      if (mo.target) { mo.pct = mo.achieved / mo.target; mo.score = ojtBandScore(mo.pct); }
    });
    if (r.status === 'Left') { out.result = 'OJT attrition'; return out; }
    if (!started) { out.result = ''; return out; }
    const scored = out.metrics.filter(m => m.score !== null);
    if (scored.length === out.metrics.length) {
      out.score = Math.round(scored.reduce((a, m) => a + m.weight * m.score, 0) * 100) / 100;
      // Input metrics (talktime and the like) count up to 100%; output metrics count in full.
      out.achievement = scored.reduce((a, m) => a + m.weight * (/input/i.test(m.type) || m.kind === 'hours' ? Math.min(m.pct, 1) : m.pct), 0);
    }
    if (today <= end) out.result = 'In OJT';
    else if (out.score === null) out.result = 'Awaiting data';
    else {
      const rule = (rules || {})[t.dept] || (rules || {})['*'] || { achievement: 0.7 };
      out.passRule = rule.score != null ? 'OJT score ' + rule.score + ' or more' : 'Achievement ' + Math.round(rule.achievement * 100) + '% or more';
      out.result = (rule.score != null ? out.score >= rule.score : out.achievement >= rule.achievement) ? 'Pass' : 'Fail';
    }
    const notes = [];
    if (missing.length) notes.push('No data: ' + missing.join(', '));
    if (partial.length) notes.push('Dump only covers part of the window: ' + partial.join(', '));
    out.note = notes.join('. ');
    return out;
  });
}

export { normId };
