/** Attendance rules. */
import { normId, isIso } from './common.js';

export const CODE_LABEL = { P: 'Present', L: 'Leave', WO: 'Weekoff', NCNS: 'NCNS', LWD: 'LWD' };
export const codeLabel = c => (c ? CODE_LABEL[c] || c : 'Not marked');

/**
 * Checks requested marks. days: [{ date, marks: { empId: code or '' } }]; byId: trainees by Emp ID (with doj, trackUntil).
 * Returns { ok: [{ empId, date, code }], skipped: [{ empId, date, reason }] }.
 */
export function planAttendanceSave(days, byId, today, codes) {
  const ok = [], skipped = [], seen = new Set();
  (days || []).forEach(d => {
    const date = String((d && d.date) || '');
    Object.keys((d && d.marks) || {}).forEach(raw => {
      const id = normId(raw), code = String(d.marks[raw] == null ? '' : d.marks[raw]).trim().toUpperCase();
      const t = byId[id];
      if (!isIso(date)) skipped.push({ empId: id, date, reason: 'Not a valid date' });
      else if (date > today) skipped.push({ empId: id, date, reason: 'Date is in the future' });
      else if (!t) skipped.push({ empId: id, date, reason: 'Not one of this trainer\'s trainees' });
      else if (t.doj && date < t.doj) skipped.push({ empId: id, date, reason: 'Before their DOJ' });
      else if (t.trackUntil && date > t.trackUntil) skipped.push({ empId: id, date, reason: 'After their OJT end date' });
      else if (code && !codes.includes(code)) skipped.push({ empId: id, date, reason: 'Unknown attendance option' });
      else if (!seen.has(id + date)) { seen.add(id + date); ok.push({ empId: id, date, code }); }
    });
  });
  return { ok, skipped };
}
