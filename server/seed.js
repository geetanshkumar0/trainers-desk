/**
 * Fills the app tables from grids laid out like the tracker's app tabs (Attendance, Mock Scores, Change Requests, ...).
 * Used only by the local preview (made-up data) and the tests. The live server never imports: Trainer Desk shows
 * only the data worked on in Trainer Desk itself.
 */
import * as db from './db.js';
import { parseSheetDate } from './dates.js';
import { normId, norm, text } from './logic/common.js';

/**
 * grids: { tabName: grid } as read from the tracker (dates as text). Fills the app tables from them.
 * Only runs when every app table is empty, so it can never overwrite data saved in Trainer Desk.
 */
export function importGrids(grids, locale) {
  const d = v => (typeof v === 'string' ? parseSheetDate(v, locale) : '');
  const ts = v => { const x = typeof v === 'string' ? parseSheetDate(v, locale, true) : null; return x ? x.at : ''; };
  const num = v => (typeof v === 'number' && !isNaN(v) ? v : (v === '' || v == null || isNaN(Number(v)) ? null : Number(v)));
  const rows = name => (grids[name] || []).slice(1).filter(r => r && r.length && String(r[0] == null ? '' : r[0]).trim());
  const c = {};
  db.tx(() => {
    c.excluded = db.insertMany('excluded_candidates', dedupe(rows('Excluded Candidates').map(r => ({ emp_id: normId(r[0]), name: text(r[1]), department: text(r[2]), doj: d(r[3]),
      reason: text(r[4]) || 'Not handled by the training team', removed_by: norm(r[5]), removed_on: ts(r[6]) || new Date().toISOString() })), 'emp_id'));

    const att = grids['Attendance'] || [], marks = [];
    if (att.length) {
      const dates = att[0].map((v, i) => (i >= 4 ? d(v) : ''));
      att.slice(1).forEach(r => {
        const id = normId(r[0]);
        if (!id) return;
        for (let k = 4; k < r.length; k++) {
          const code = String(r[k] == null ? '' : r[k]).trim().toUpperCase();
          if (code && dates[k]) marks.push({ emp_id: id, date: dates[k], code, trainer: norm(r[2]), name: text(r[1]), doj: d(r[3]), marked_by: 'imported', marked_on: new Date().toISOString() });
        }
      });
    }
    c.attendance = db.insertMany('attendance', dedupe(marks, 'emp_id', 'date'));
    c.attendanceLog = db.insertMany('attendance_log', rows('Attendance Log').map(r => ({ changed_on: ts(r[0]), changed_by: norm(r[1]), trainer: norm(r[2]), emp_id: normId(r[3]),
      date: d(r[4]), old_code: text(r[5]).toUpperCase(), new_code: text(r[6]).toUpperCase() })));

    const okStatus = new Set(['Pending', 'Approved', 'Rejected', 'Superseded']);
    c.changeRequests = db.insertMany('change_requests', dedupe(rows('Change Requests').map(r => ({ id: text(r[0]), requested_on: ts(r[1]), requested_by: norm(r[2]), trainer: norm(r[3]),
      emp_id: normId(r[4]), name: text(r[5]), field: text(r[6]), old_text: text(r[7]), new_text: text(r[8]), status: okStatus.has(text(r[9])) ? text(r[9]) : 'Rejected',
      reviewed_by: text(r[10]), reviewed_on: ts(r[11]), note: text(r[12]), data: text(r[13]) || '{}' })), 'id'));

    c.mocks = db.insertMany('mock_scores', rows('Mock Scores').map(r => ({ emp_id: normId(r[0]), name: text(r[1]), trainer: norm(r[2]), mock_date: d(r[3]), attempt: text(r[4]),
      score: num(r[5]), status: text(r[6]), final: text(r[7]) === 'Yes' ? 1 : 0, entered_by: norm(r[8]), approved_by: text(r[9]), approved_on: ts(r[10]) })));
    c.nhtStatus = db.insertMany('nht_status', dedupe(rows('NHT Status').map(r => ({ emp_id: normId(r[0]), name: text(r[1]), trainer: norm(r[2]), ojt_entered: text(r[3]),
      ojt_eligible: text(r[4]), updated_by: text(r[5]), updated_on: ts(r[6]) })), 'emp_id'));
    c.ojtTeam = db.insertMany('ojt_team', dedupe(rows('OJT Team').filter(r => text(r[3])).map(r => ({ emp_id: normId(r[0]), name: text(r[1]), trainer: norm(r[2]), team: text(r[3]),
      updated_by: text(r[4]), updated_on: ts(r[5]) })), 'emp_id'));
    c.ojtInputs = db.insertMany('ojt_manual_inputs', dedupe(rows('OJT Manual Inputs').filter(r => text(r[3]) && num(r[4]) !== null).map(r => ({ emp_id: normId(r[0]), metric: text(r[3]),
      name: text(r[1]), trainer: norm(r[2]), achieved: num(r[4]), updated_by: text(r[5]), updated_on: ts(r[6]) })), 'emp_id', 'metric'));
    c.ojtDashboard = db.insertMany('ojt_dashboard', rows('OJT Dashboard').map(r => ({ emp_id: normId(r[0]), name: text(r[1]), trainer: norm(r[2]), work_mode: text(r[3]),
      doj: d(r[4]), training_end: d(r[5]), ojt_start: d(r[6]), ojt_end: d(r[7]), status: text(r[8]), ojt_day: num(r[9]) || 0, talk_days: num(r[10]) || 0,
      talk_hours: num(r[11]) || 0, last_talk: d(r[12]), updated_on: ts(r[13]), team: text(r[14]), team_set: text(r[15]) === 'Yes' ? 1 : 0,
      achievement: num(r[16]), score: num(r[17]), result: text(r[18]), pass_rule: text(r[19]), note: text(r[20]) })));
    c.ojtPerformance = db.insertMany('ojt_performance', rows('OJT Performance').map(r => ({ emp_id: normId(r[0]), name: text(r[1]), trainer: norm(r[2]), team: text(r[3]),
      metric: text(r[4]), type: text(r[5]), weight: num(r[6]), kind: text(r[7]), target: num(r[8]), achieved: num(r[9]), pct: num(r[10]), score: num(r[11]),
      date_from: d(r[12]), date_to: d(r[13]), data: text(r[14]),
      weeks: JSON.stringify([0, 1, 2, 3].map(k => ({ target: num(r[15 + 2 * k]), achieved: num(r[16 + 2 * k]) }))) })));
    c.whatsapp = db.insertMany('whatsapp_log', rows('WhatsApp Log').map(r => ({ sent_on: ts(r[0]), trainer: norm(r[1]), emp_id: normId(r[2]), candidate: text(r[3]),
      candidate_phone: text(r[4]), sent_to: text(r[5]), template: text(r[6]), status: text(r[7]) || 'logged', detail: text(r[8]) })));
  });
  return c;
}

/** Keeps the last row for each key (the sheets could hold repeats; the tables cannot). */
function dedupe(list, ...keys) {
  const m = new Map();
  list.forEach(r => m.set(keys.map(k => r[k]).join('\u0000'), r));
  return [...m.values()];
}

