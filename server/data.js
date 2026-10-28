/** Read helpers over the database, returning the shapes the rules work with. */
import * as db from './db.js';
import { CONFIG } from './config.js';
import { resolveSession } from './logic/org.js';
import { departmentsFromRows, latestKc, kcKeys } from './logic/changes.js';
import { parseOjtTargets } from './logic/ojt.js';
import { normId, norm, UserError } from './logic/common.js';
import { isoDay } from './dates.js';

const MASTER_SELECT = `SELECT emp_id empId, trainer, manager, mentor, doj, work_mode mode, name, email, phone, department, sub_team subTeam,
  location, status, lateral, training_start trainingStart, kc_score kcScore, kc_attempt kcAttempt, kc_status kcStatus,
  mock_attempt mockAttempt, mock_status mockStatus, training_end trainingEnd, training_days trainingDays, ojt_start ojtStart,
  ojt_pct ojtPct, ojt_end ojtEnd, attrition_day attritionDay, lwd FROM in_master`;

function loaded() {
  if (!db.get('SELECT 1 FROM sync_status WHERE name = ?', CONFIG.MASTER_SHEET)) {
    throw new UserError('Still loading the sheets, try again in a few seconds.', 503);
  }
}
/*
 * Claimed trainees: Master Dashboard, with blanks filled in from the HR sheet. Trainer Desk only writes Emp ID, Trainer and
 * Training Start Date; the sheet's formulas fill name, DOJ and status. When they do not (a new row the formulas do not
 * reach), a blank DOJ or status would hide the trainee from Attendance and Active NHT Details, so the HR value is used.
 * Claimed in Trainer Desk: in this version (claims) or the previous one (its WhatsApp Log tab, see sync.js).
 */
const fill = (col, alias) => `COALESCE(NULLIF(m.${col}, ''), h.${col}, '') ${alias || col}`;
const CLAIMED_SELECT = `SELECT m.emp_id empId, m.trainer, m.manager, m.mentor, ${fill('doj')},
  COALESCE(NULLIF(m.work_mode, ''), CASE WHEN instr(m.emp_id, 'A') > 0 THEN 'WFH' ELSE 'WFO' END) mode,
  ${fill('name')}, m.email, ${fill('phone')}, m.department, m.sub_team subTeam, ${fill('location')}, ${fill('status')},
  m.lateral, m.training_start trainingStart, m.kc_score kcScore, m.kc_attempt kcAttempt, m.kc_status kcStatus,
  m.mock_attempt mockAttempt, m.mock_status mockStatus, m.training_end trainingEnd, m.training_days trainingDays, m.ojt_start ojtStart,
  m.ojt_pct ojtPct, m.ojt_end ojtEnd, m.attrition_day attritionDay, m.lwd
  FROM in_master m
  LEFT JOIN (SELECT emp_id, name, status, doj, location, phone, MIN(seq) FROM in_hr GROUP BY emp_id) h ON h.emp_id = m.emp_id
  WHERE m.emp_id IN (SELECT emp_id FROM claims UNION SELECT emp_id FROM in_prior_claims)`;

/** Master Dashboard rows of trainees claimed in Trainer Desk (in sheet order), optionally for one trainer. */
export function masterRows(trainer) {
  loaded();
  return trainer ? db.all(CLAIMED_SELECT + ' AND m.trainer = ? ORDER BY COALESCE(m.row_no, 1e9), m.seq', trainer)
    : db.all(CLAIMED_SELECT + ' ORDER BY COALESCE(m.row_no, 1e9), m.seq');
}

/** Every Master Dashboard row, claimed here or not. Only the Performance Dashboards use this. */
export function liveMasterRows() {
  loaded();
  return db.all(MASTER_SELECT + ' ORDER BY COALESCE(row_no, 1e9), seq');
}

export function org() {
  const names = {};
  db.all('SELECT email, name FROM in_names').forEach(r => { names[r.email] = r.name; });
  return { rows: db.all('SELECT trainer, manager, mentor FROM in_org ORDER BY seq'), names };
}

export function session(email) {
  return resolveSession(norm(email), org(), CONFIG.HEAD_EMAILS, CONFIG.ADMIN_EMAILS);
}

/** The trainer's e-mail if this session may open them; otherwise a 403. */
export function assertTrainer(s, email) {
  const target = norm(email);
  if (!s.trainers.some(t => t.email === target)) throw new UserError('You do not have access to this trainer.', 403);
  return target;
}

export function departments() {
  return departmentsFromRows(db.all('SELECT department, sub_team subTeam FROM in_departments ORDER BY seq'));
}

/** A trainee's latest KC entry: by Emp ID, else by official e-mail. */
export function kcFor(empId, email) {
  for (const key of kcKeys(empId, email)) {
    const rows = db.all('SELECT date, attempt, score, status FROM in_kc WHERE key = ? ORDER BY seq', key);
    if (rows.length) return latestKc(rows);
  }
  return null;
}

/** Mock attempts by Emp ID, oldest attempt first. ids: array, or null for everyone. */
export function mocks(ids) {
  const rows = ids ? inList('SELECT * FROM mock_scores WHERE emp_id IN', ids, 'ORDER BY id') : db.all('SELECT * FROM mock_scores ORDER BY id');
  const out = {};
  rows.forEach(r => (out[r.emp_id] = out[r.emp_id] || []).push({
    date: r.mock_date, attempt: r.attempt, score: r.score === null ? '' : r.score, status: r.status, final: !!r.final, by: r.entered_by
  }));
  const n = a => Number((String(a).match(/\d+/) || [0])[0]);
  Object.keys(out).forEach(k => out[k].sort((a, b) => n(a.attempt) - n(b.attempt)));
  return out;
}

export function nhtStatus(empId) {
  const r = db.get('SELECT ojt_entered, ojt_eligible FROM nht_status WHERE emp_id = ?', empId);
  return r ? { entered: r.ojt_entered, eligible: r.ojt_eligible } : {};
}

const reqShape = r => ({
  id: r.id, on: r.requested_on, by: r.requested_by, trainer: r.trainer, empId: r.emp_id, name: r.name, field: r.field,
  oldText: r.old_text, newText: r.new_text, status: r.status, reviewedBy: r.reviewed_by, note: r.note, value: JSON.parse(r.data || '{}')
});
/** Change requests, oldest first. where: optional SQL condition. */
export function requests(where, ...params) {
  return db.all('SELECT * FROM change_requests' + (where ? ' WHERE ' + where : '') + ' ORDER BY seq', ...params).map(reqShape);
}

/** What decides whether a trainee is in Active NHT Details or OJT Performance (see logic/batches.js nhtStage). */
export function nhtStage() {
  const status = {}, finalMock = {}, movedOn = {};
  db.all('SELECT emp_id, ojt_entered, ojt_eligible, updated_on FROM nht_status').forEach(r => {
    status[r.emp_id] = { entered: r.ojt_entered, eligible: r.ojt_eligible };
    if (r.ojt_entered === 'Yes' && r.ojt_eligible === 'Yes' && r.updated_on) movedOn[r.emp_id] = isoDay(new Date(r.updated_on));
  });
  db.all('SELECT emp_id, status, mock_date FROM mock_scores WHERE final = 1 ORDER BY id')
    .forEach(r => { finalMock[r.emp_id] = { status: r.status, date: r.mock_date }; });
  return { status, finalMock, movedOn };
}

/** Emp ID -> { start, end } from the OJT dashboard, or null when it has never been built. */
export function ojtDates() {
  const rows = db.all('SELECT emp_id, ojt_start, ojt_end FROM ojt_dashboard ORDER BY seq');
  if (!rows.length) return null;
  const out = {};
  rows.forEach(r => { out[r.emp_id] = { start: r.ojt_start, end: r.ojt_end }; });
  return out;
}

export function ojtTargets() {
  const g = db.get('SELECT grid, display FROM in_grids WHERE name = ?', CONFIG.OJT_TARGETS_SHEET);
  return g ? parseOjtTargets(JSON.parse(g.grid), JSON.parse(g.display || '[]')) : { _order: [] };
}

export function ojtTeams() {
  const out = {};
  db.all('SELECT emp_id, team FROM ojt_team').forEach(r => { if (r.team) out[r.emp_id] = r.team; });
  return out;
}

export function ojtManual(empId) {
  const out = {};
  (empId ? db.all('SELECT * FROM ojt_manual_inputs WHERE emp_id = ?', empId) : db.all('SELECT * FROM ojt_manual_inputs'))
    .forEach(r => { (out[r.emp_id] = out[r.emp_id] || {})[r.metric] = r.achieved; });
  return empId ? out[empId] || {} : out;
}

/** Runs "<sql> (?, ?, ...) <tail>" in chunks (SQLite limits the number of parameters). */
export function inList(sql, ids, tail) {
  const out = [];
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    out.push(...db.all(sql + ' (' + part.map(() => '?').join(',') + ') ' + (tail || ''), ...part));
  }
  return out;
}

export { normId };
