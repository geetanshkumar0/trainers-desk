/**
 * Batches, NHT list and attendance roster from Master Dashboard rows.
 * A master row: { empId, trainer, doj, mode, name, email, phone, department, subTeam, location, status, lateral,
 *   trainingStart, kcScore, kcAttempt, kcStatus, mockAttempt, mockStatus, trainingEnd, trainingDays,
 *   ojtStart, ojtPct, ojtEnd, attritionDay, lwd, manager, mentor }
 */
import { norm } from './common.js';
import { addDaysIso, dayNumber } from '../dates.js';

/** All batches for one trainer, numbered from the trainer's first one. */
export function buildTrainerView(master, trainerEmail, today, mergeDays) {
  const people = [];
  master.forEach(row => {
    if (!row.empId || row.trainer !== trainerEmail) return;
    people.push({
      empId: row.empId, name: row.name, mode: row.mode, dept: row.department, subTeam: row.subTeam, location: row.location,
      active: norm(row.status) === 'active', lateral: norm(row.lateral) === 'yes',
      doj: row.doj, trainingStart: row.trainingStart, trainingEnd: row.trainingEnd, trainingDays: row.trainingDays,
      kcScore: row.kcScore, kcAttempt: row.kcAttempt, kcStatus: row.kcStatus,
      mockAttempt: row.mockAttempt, mockStatus: row.mockStatus,
      ojtStart: row.ojtStart, ojtPct: row.ojtPct, ojtEnd: row.ojtEnd,
      attritionDay: row.attritionDay, lastWorkingDate: row.lwd,
      batchDate: row.trainingStart || row.doj
    });
  });

  // Group into batches by training start date (DOJ when the start date is missing).
  const dated = people.filter(p => p.batchDate)
    .sort((a, b) => (a.batchDate < b.batchDate ? -1 : a.batchDate > b.batchDate ? 1 : a.name.localeCompare(b.name)));
  const groups = [];
  let cur = null;
  dated.forEach(p => {
    if (!cur || dayNumber(p.batchDate) - dayNumber(cur.start) > (mergeDays || 0)) { cur = { start: p.batchDate, trainees: [] }; groups.push(cur); }
    cur.trainees.push(p);
  });
  const batches = groups.map((g, i) => summariseBatch(g, i + 1, today));
  const undated = people.filter(p => !p.batchDate);
  if (undated.length) {
    const u = summariseBatch({ start: '', trainees: undated }, 0, today);
    u.name = 'No start date';
    batches.push(u);
  }
  return { trainer: trainerEmail, today, batches };
}

function summariseBatch(g, number, today) {
  const t = g.trainees;
  const maxOf = k => t.reduce((m, p) => (p[k] > m ? p[k] : m), '');
  const minOf = k => t.reduce((m, p) => (p[k] && (!m || p[k] < m) ? p[k] : m), '');
  const count = f => t.filter(f).length;
  const subs = {};
  t.forEach(p => { const k = p.subTeam || p.dept || 'Unassigned'; subs[k] = (subs[k] || 0) + 1; });
  const subTeams = Object.keys(subs).map(k => ({ name: k, count: subs[k] })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const trainingEnd = maxOf('trainingEnd'), ojtEnd = maxOf('ojtEnd');
  const stage = !g.start ? 'Not started'
    : (!trainingEnd || trainingEnd >= today) ? 'In training'
    : (ojtEnd && ojtEnd >= today) ? 'In OJT'
    : (!ojtEnd && dayNumber(today) - dayNumber(trainingEnd) <= 45) ? 'OJT pending'   // training over, no OJT dates yet
    : 'Completed';

  // Same counting rules as the T&D Performance Tracker.
  const joined = p => p.attritionDay !== 0;                   // same-day exits are not joiners
  const judged = p => p.mockStatus === 'Pass' || p.mockStatus === 'Fail';
  return {
    key: g.start || 'none', number, name: 'Batch ' + number, start: g.start,
    trainingEnd, ojtStart: minOf('ojtStart'), ojtEnd, stage, size: t.length,
    wfo: count(p => p.mode === 'WFO'), wfh: count(p => p.mode === 'WFH'), active: count(p => p.active),
    joiners: count(joined),
    mockAttempted: count(p => joined(p) && judged(p)),
    mockPassed: count(p => joined(p) && p.mockStatus === 'Pass'),
    mockFirstPass: count(p => joined(p) && p.mockStatus === 'Pass' && p.mockAttempt === '1st'),
    ojtDone: count(p => joined(p) && p.ojtPct !== null),
    ojtCleared: count(p => joined(p) && p.ojtPct !== null && p.ojtPct >= 0.7),
    exits45: count(p => p.attritionDay !== null && p.attritionDay >= 1 && p.attritionDay <= 45),
    subTeams, trainees: t
  };
}

/** Flat trainee list for the attendance page, each tagged with its batch. */
export function rosterFromView(view) {
  const out = [];
  view.batches.forEach(b => b.trainees.forEach(p => out.push({
    empId: p.empId, name: p.name, mode: p.mode, subTeam: p.subTeam || p.dept, doj: p.doj,
    trainingEnd: p.trainingEnd, ojtStart: p.ojtStart, ojtEnd: p.ojtEnd, lastWorkingDate: p.lastWorkingDate, active: p.active,
    batch: b.name, batchKey: b.key, batchStart: b.start
  })));
  return out;
}

/**
 * Sets each trainee's OJT dates and the last day attendance is tracked (trackUntil).
 * OJT dates: the OJT dashboard row if there is one, else Master Dashboard. An OJT end before DOJ is ignored.
 * trackUntil: OJT end date, or DOJ + fallbackDays - 1 while the OJT end date is not known.
 */
export function applyTracking(trainees, ojtMap, fallbackDays) {
  trainees.forEach(t => {
    const o = ojtMap && ojtMap[t.empId];
    if (o) { t.ojtStart = o.start || ''; t.ojtEnd = o.end || ''; t.ojtSource = 'OJT Dashboard'; }
    else t.ojtSource = t.ojtEnd ? 'Master Dashboard' : '';
    if (t.ojtEnd && t.doj && t.ojtEnd < t.doj) { t.ojtEnd = ''; t.ojtSource = ''; }
    t.trackUntil = t.ojtEnd || (t.doj ? addDaysIso(t.doj, fallbackDays - 1) : '');
    t.trackEstimated = !t.ojtEnd;
  });
  return trainees;
}

/** Trainees still in training for one trainer: active, no last working date, no final mock / training end date. Newest DOJ first. */
export function buildNhtList(master, trainerEmail, batchOf) {
  const out = [];
  master.forEach(row => {
    if (!row.empId || row.trainer !== trainerEmail) return;
    if (norm(row.status) !== 'active' || row.lwd || row.trainingEnd) return;
    const b = (batchOf && batchOf[row.empId]) || {};
    out.push({
      empId: row.empId, name: row.name, doj: row.doj, mode: row.mode, email: row.email, phone: row.phone,
      department: row.department, subTeam: row.subTeam, trainingStart: row.trainingStart,
      batch: b.name || '', batchKey: b.key || '', batchStart: b.start || ''
    });
  });
  out.sort((a, b) => (a.doj < b.doj ? 1 : a.doj > b.doj ? -1 : a.name.localeCompare(b.name)));
  return out;
}
