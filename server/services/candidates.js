/** Session, batches and unclaimed candidates. */
import * as db from '../db.js';
import * as data from '../data.js';
import * as outbox from '../outbox.js';
import { CONFIG } from '../config.js';
import { today, isoDay } from '../dates.js';
import { buildScopedView } from '../logic/batches.js';
import { buildUnclaimed, planAssignment } from '../logic/candidates.js';
import { cleanIds, isIso, norm, UserError } from '../logic/common.js';

export function getSession(user) {
  return Object.assign(data.session(user), { unclaimedFrom: CONFIG.UNCLAIMED_FROM });
}

/** All batches for one trainer. */
export function getTrainerBatches(user, trainer) {
  const s = data.session(user);
  const sc = data.scope(s, trainer);
  const view = buildScopedView(data.masterRows(sc.list), sc.key === data.ALL ? sc.list : sc.key, today(), CONFIG.BATCH_MERGE_DAYS, data.nameOf);
  view.trainer = sc.key;
  return view;
}

function mappedIds() {
  const set = new Set(db.all('SELECT emp_id FROM in_master').map(r => r.emp_id));
  db.all('SELECT emp_id FROM in_also_mapped').forEach(r => set.add(r.emp_id));
  return set;
}
function excludedMap() {
  const out = {};
  db.all('SELECT emp_id, reason, removed_by, removed_on FROM excluded_candidates').forEach(r => {
    out[r.emp_id] = { reason: r.reason, by: r.removed_by, on: isoDay(new Date(r.removed_on)) };
  });
  return out;
}
const hrRows = () => db.all('SELECT emp_id empId, name, status, doj, location, source, department FROM in_hr ORDER BY seq');

/** Everyone in the HR sheets whose Emp ID is not yet in Master Dashboard. */
export function getUnclaimedCandidates(user) {
  const s = data.session(user);
  if (s.role === 'none') throw new UserError('You do not have access.', 403);
  data.liveMasterRows();                         // throws while the sheets are still loading
  const removed = new Set(db.all('SELECT emp_id FROM in_removed').map(r => r.emp_id));
  return buildUnclaimed(hrRows(), mappedIds(), removed, excludedMap(), s.isAdmin, CONFIG.UNCLAIMED_FROM);
}

/**
 * Adds the chosen candidates to Master Dashboard under one trainer.
 * req: { ids, trainer, trainingStart: 'yyyy-MM-dd' or '' }. Only Emp ID, Trainer and Training Start Date are written;
 * the sheet's formulas fill in the rest. Runs in one transaction, so two trainers cannot claim the same person.
 */
export function assignCandidates(user, req) {
  const s = data.session(user);
  const trainer = norm(req && req.trainer);
  if (!s.trainers.some(t => t.email === trainer)) throw new UserError('You cannot assign candidates to this trainer.', 403);
  const ids = cleanIds(req.ids);
  if (!ids.length) throw new UserError('Select at least one candidate.');
  if (ids.length > CONFIG.MAX_ASSIGN) throw new UserError('Assign at most ' + CONFIG.MAX_ASSIGN + ' candidates at a time.');
  const startIso = String(req.trainingStart || '').trim();
  if (startIso && !isIso(startIso)) throw new UserError('Training start date is not a valid date.');
  data.liveMasterRows();
  return db.tx(() => {
    const inHr = new Set();
    hrRows().forEach(r => { if (!(CONFIG.UNCLAIMED_FROM && (!r.doj || r.doj < CONFIG.UNCLAIMED_FROM))) inHr.add(r.empId); });
    const plan = planAssignment(ids, mappedIds(), inHr, excludedMap());
    outbox.masterAppend(plan.assign.map(empId => ({ empId, trainer, trainingStart: startIso })));
    const now = new Date().toISOString();
    plan.assign.forEach(empId => db.run('INSERT INTO claims (emp_id, trainer, claimed_by, claimed_on, training_start) VALUES (?, ?, ?, ?, ?) ON CONFLICT(emp_id) DO NOTHING',
      empId, trainer, s.email, now, startIso));
    return { trainer, assigned: plan.assign, skipped: plan.skipped };
  });
}

/** Admins: takes candidates off the unclaimed list (the HR sheets are not touched). req: { ids, reason } */
export function excludeCandidates(user, req) {
  const s = data.session(user);
  if (!s.isAdmin) throw new UserError('Only admins can remove candidates from the list.', 403);
  const ids = cleanIds(req && req.ids);
  if (!ids.length) throw new UserError('Select at least one candidate.');
  if (ids.length > CONFIG.MAX_EXCLUDE) throw new UserError('Remove at most ' + CONFIG.MAX_EXCLUDE + ' candidates at a time.');
  const reason = String(req.reason || '').trim() || 'Not handled by the training team';
  return db.tx(() => {
    const excluded = excludedMap(), mapped = mappedIds(), hr = {};
    hrRows().forEach(r => { if (!hr[r.empId]) hr[r.empId] = r; });
    const removed = [], skipped = [], now = new Date().toISOString();
    ids.forEach(id => {
      if (excluded[id]) skipped.push({ empId: id, reason: 'Already removed' });
      else if (mapped.has(id)) skipped.push({ empId: id, reason: 'Already mapped to a trainer' });
      else if (!hr[id]) skipped.push({ empId: id, reason: 'Not found in the HR sheets' });
      else {
        removed.push(id);
        db.run('INSERT INTO excluded_candidates (emp_id, name, department, doj, reason, removed_by, removed_on) VALUES (?, ?, ?, ?, ?, ?, ?)',
          id, hr[id].name, hr[id].department, hr[id].doj, reason, s.email, now);
      }
    });
    if (removed.length) db.markDirty('Excluded Candidates');
    return { removed, skipped, reason };
  });
}

/** Admins: puts removed candidates back on the unclaimed list. req: { ids } */
export function restoreCandidates(user, req) {
  const s = data.session(user);
  if (!s.isAdmin) throw new UserError('Only admins can restore candidates.', 403);
  const ids = cleanIds(req && req.ids);
  if (!ids.length) throw new UserError('Select at least one candidate.');
  return db.tx(() => {
    const restored = data.inList('SELECT emp_id FROM excluded_candidates WHERE emp_id IN', ids).map(r => r.emp_id);
    restored.forEach(id => db.run('DELETE FROM excluded_candidates WHERE emp_id = ?', id));
    if (restored.length) db.markDirty('Excluded Candidates');
    return { restored };
  });
}
