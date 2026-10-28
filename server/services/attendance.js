/**
 * Attendance Tracker. A trainer's first mark for a day saves straight away; changing a mark that is already
 * saved becomes a change request ("Attendance yyyy-MM-dd") for an admin. Admins save directly.
 */
import * as db from '../db.js';
import * as data from '../data.js';
import { CONFIG } from '../config.js';
import { today, prettyDate } from '../dates.js';
import { buildScopedView, rosterFromView, applyTracking } from '../logic/batches.js';
import { planAttendanceSave, codeLabel } from '../logic/attendance.js';
import { normId } from '../logic/common.js';
import { saveChange } from './changes.js';

/** The trainees of one trainer (or a list of trainers) with OJT dates and the last day attendance is tracked. */
export function trackedTrainees(target) {
  const view = buildScopedView(data.masterRows(target), target, today(), CONFIG.BATCH_MERGE_DAYS, data.nameOf);
  return applyTracking(rosterFromView(view), data.ojtDates(), CONFIG.ATTENDANCE_FALLBACK_DAYS);
}

/** { empId: { date: code } } for these Emp IDs (null = everyone). */
function marksFor(ids) {
  const rows = ids ? data.inList('SELECT emp_id, date, code FROM attendance WHERE emp_id IN', ids) : db.all('SELECT emp_id, date, code FROM attendance');
  const out = {};
  rows.forEach(r => { (out[r.emp_id] = out[r.emp_id] || {})[r.date] = r.code; });
  return out;
}

/** The open trainer's trainees and every mark already saved for them. */
export function getAttendance(user, trainer) {
  const s = data.session(user);
  const sc = data.scope(s, trainer);
  const trainees = trackedTrainees(sc.key === data.ALL ? sc.list : sc.key);
  return {
    trainer: sc.key, today: today(), codes: CONFIG.ATTENDANCE_CODES, trainees,
    ojtSheetFound: !!data.ojtDates(), fallbackDays: CONFIG.ATTENDANCE_FALLBACK_DAYS,
    marks: marksFor(trainees.map(t => t.empId))
  };
}

/** Writes checked marks ('' clears one) and logs what changed. Runs in the caller's transaction (or its own). */
export function writeMarks(by, target, ok, byId) {
  return db.tx(() => {
    const now = new Date().toISOString();
    let changed = 0;
    ok.forEach(e => {
      const cur = db.get('SELECT code FROM attendance WHERE emp_id = ? AND date = ?', e.empId, e.date);
      const old = cur ? cur.code : '';
      if (old === e.code) return;
      const t = byId[e.empId] || {};
      if (e.code) {
        db.run(`INSERT INTO attendance (emp_id, date, code, trainer, name, doj, marked_by, marked_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(emp_id, date) DO UPDATE SET code = excluded.code, trainer = excluded.trainer, marked_by = excluded.marked_by, marked_on = excluded.marked_on`,
          e.empId, e.date, e.code, t.trainer || target, t.name || '', t.doj || '', by, now);
      } else {
        db.run('DELETE FROM attendance WHERE emp_id = ? AND date = ?', e.empId, e.date);
      }
      db.run('INSERT INTO attendance_log (changed_on, changed_by, trainer, emp_id, date, old_code, new_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
        now, by, t.trainer || target, e.empId, e.date, old, e.code);
      changed++;
    });
    if (changed) db.markDirty('Attendance', 'Attendance Log');
    return { saved: ok.length, changed };
  });
}

/**
 * Saves marks. req: { trainer, days: [{ date, marks: { empId: code or '' } }] }
 * Marks before DOJ, after the tracking window, in the future or for someone not under this trainer are skipped.
 */
export function saveAttendance(user, req) {
  const s = data.session(user);
  const sc = data.scope(s, req && req.trainer), target = sc.key;      // 'all': each mark goes to its trainee's trainer
  const day = today(), byId = {};
  trackedTrainees(sc.key === data.ALL ? sc.list : sc.key).forEach(t => { byId[t.empId] = t; });
  const days = req.days || [];

  if (s.isAdmin) {
    const plan = planAttendanceSave(days, byId, day, CONFIG.ATTENDANCE_CODES);
    if (!plan.ok.length) return { saved: 0, skipped: plan.skipped, pending: [] };
    const r = writeMarks(s.email, target, plan.ok, byId);
    return { saved: r.saved, changed: r.changed, skipped: plan.skipped, pending: [] };
  }

  // Trainers: marks on empty days save now; changes to saved marks go for approval.
  const ids = [];
  days.forEach(d => Object.keys((d && d.marks) || {}).forEach(raw => ids.push(normId(raw))));
  const saved = marksFor([...new Set(ids)]);
  const direct = [], changes = [];
  days.forEach(d => {
    const keep = {};
    Object.keys((d && d.marks) || {}).forEach(raw => {
      const id = normId(raw), code = String(d.marks[raw] == null ? '' : d.marks[raw]).trim().toUpperCase();
      const old = (saved[id] || {})[d.date] || '';
      if (old && old !== code) changes.push({ date: d.date, marks: { [id]: code } });
      else keep[raw] = d.marks[raw];
    });
    if (Object.keys(keep).length) direct.push({ date: d.date, marks: keep });
  });
  const plan = planAttendanceSave(direct, byId, day, CONFIG.ATTENDANCE_CODES);
  const res = plan.ok.length ? writeMarks(s.email, target, plan.ok, byId) : { saved: 0, changed: 0 };
  res.skipped = plan.skipped;
  res.pending = [];
  if (!changes.length) return res;

  // Same checks as a direct save (date, trainee, range, code) before anything is sent for approval.
  const cplan = planAttendanceSave(changes, byId, day, CONFIG.ATTENDANCE_CODES);
  res.skipped = res.skipped.concat(cplan.skipped);
  cplan.ok.forEach(e => {
    const old = (saved[e.empId] || {})[e.date] || '';
    const checked = { first: false, value: { date: e.date, code: e.code }, oldText: codeLabel(old) + ' on ' + prettyDate(e.date), newText: codeLabel(e.code) + ' on ' + prettyDate(e.date) };
    const r = saveChange(s, (byId[e.empId] || {}).trainer || target, e.empId, (byId[e.empId] || {}).name || e.empId, 'Attendance ' + e.date, checked);
    res.pending.push({ empId: e.empId, date: e.date, code: e.code, requestId: r.requestId || '' });
  });
  return res;
}
