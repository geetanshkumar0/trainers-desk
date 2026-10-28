/**
 * Active NHT Details, change requests and approvals.
 * A trainer's first update of a field and every admin edit apply straight away; changing a value already set
 * through Trainer Desk waits for an admin. Every entry, applied or not, is kept in change_requests.
 */
import * as db from '../db.js';
import * as data from '../data.js';
import * as outbox from '../outbox.js';
import { CONFIG, SERVER } from '../config.js';
import { today, stamp } from '../dates.js';
import { buildTrainerView, buildNhtList } from '../logic/batches.js';
import { checkChange, updatedFields, pendingByTrainee } from '../logic/changes.js';
import { parseOjtRows, scheduleOjtRebuild } from './ojt.js';
import { ojtTeamList } from '../logic/ojt.js';
import { normId, ordinal, attemptNumber, prettyName, UserError } from '../logic/common.js';
import { writeMarks, trackedTrainees } from './attendance.js';
import { planAttendanceSave } from '../logic/attendance.js';

const isOjtField = f => f === 'OJT Team' || f.indexOf('OJT Input: ') === 0;

/** Active NHT Details: trainees under this trainer not yet moved to OJT, with KC, mocks, OJT answers and requests. */
export function getNhtCandidates(user, trainer) {
  const s = data.session(user);
  const target = data.assertTrainer(s, trainer);
  const master = data.masterRows(target), day = today();
  const view = buildTrainerView(master, target, day, CONFIG.BATCH_MERGE_DAYS);
  const batchOf = {};
  view.batches.forEach(b => b.trainees.forEach(p => { batchOf[p.empId] = { name: b.name, key: b.key, start: b.start }; }));
  const list = buildNhtList(master, target, batchOf, data.nhtStage());
  const ids = list.map(c => c.empId);
  const mocks = data.mocks(ids);
  const reqs = data.requests();
  const pending = pendingByTrainee(reqs.filter(q => q.status === 'Pending'));
  const updated = updatedFields(reqs);
  list.forEach(c => {
    c.updated = updated[c.empId] || {};
    const st = data.nhtStatus(c.empId);
    c.ojtEntered = st.entered || ''; c.ojtEligible = st.eligible || '';
    c.kc = data.kcFor(c.empId, c.email);
    c.mocks = mocks[c.empId] || [];
    c.pending = pending[c.empId] || {};
  });
  return { trainer: target, today: day, candidates: list, departments: data.departments(), isAdmin: s.isAdmin };
}

/** Everything checkChange needs for one trainee in training. */
function nhtContext(target, id, batchHasMock) {
  const trainee = buildNhtList(data.masterRows(target), target, {}, data.nhtStage()).find(c => c.empId === id);
  if (!trainee) throw new UserError(id + ' is not in Active NHT Details under this trainer.');
  const st = data.nhtStatus(id);
  trainee.ojtEntered = st.entered || ''; trainee.ojtEligible = st.eligible || '';
  return { departments: data.departments(), today: today(), trainee, mocks: data.mocks([id])[id] || [],
    updated: updatedFields(data.requests('emp_id = ?', id))[id] || {}, kc: data.kcFor(id, trainee.email), batchHasMock: !!batchHasMock };
}

/**
 * One change to one trainee. req: { trainer, empId, field, value }
 *   Department { department, subTeam } · Training Start Date { date } · Mock { date, attempt, status, final }
 *   Mock Edit (same, for a recorded attempt) · OJT Entered / OJT Eligible { answer } · OJT Team { team } · OJT Input: <metric> { achieved }
 */
export function submitChange(user, req, batchHasMock) {
  const s = data.session(user);
  const target = data.assertTrainer(s, req && req.trainer);
  const id = normId(req.empId), field = String(req.field || '');
  if (isOjtField(field)) return submitOjtChange(s, target, id, field, req.value);
  const ctx = nhtContext(target, id, batchHasMock);
  const checked = checkChange(field, req.value, ctx);
  if (checked.error) throw new UserError(checked.error);
  return saveChange(s, target, id, ctx.trainee.name, field, checked);
}

/** OJT team or a hand-entered OJT score for a trainee in this trainer's OJT Performance. */
function submitOjtChange(s, target, id, field, value) {
  const row = parseOjtRows(target, today(), false).rows.find(r => r.empId === id);
  if (!row) throw new UserError(id + ' is not in OJT Performance under this trainer. Refresh OJT data and try again.');
  const targets = data.ojtTargets();
  const picked = data.ojtTeams()[id];                 // a team picked since the last refresh counts straight away
  if (picked && targets[picked]) { row.team = picked; row.teamSet = true; }
  const checked = checkChange(field, value, { today: today(), trainee: row, updated: updatedFields(data.requests('emp_id = ?', id))[id] || {},
    teams: ojtTeamList(targets), manual: data.ojtManual(id) });
  if (checked.error) throw new UserError(checked.error);
  return saveChange(s, target, id, row.name, field, checked);
}

/** Records a checked change: applied now (admins, or the trainer's first entry) or left pending for an admin. */
export function saveChange(s, target, id, name, field, checked) {
  return db.tx(() => {
    const now = new Date().toISOString();
    const q = { id: 'CR-' + stamp() + '-' + Math.floor(Math.random() * 900 + 100), on: now, by: s.email, trainer: target, empId: id, name, field,
      oldText: checked.oldText || '', newText: checked.newText || '', value: checked.value };
    // A newer request for the same trainee and change replaces any that is still pending.
    db.run("UPDATE change_requests SET status = 'Superseded', reviewed_by = ?, reviewed_on = ?, note = 'Replaced by a newer request' WHERE emp_id = ? AND field = ? AND status = 'Pending'",
      s.email, now, id, field);
    const insert = (status, reviewer, reviewedOn, note) => db.run(
      `INSERT INTO change_requests (id, requested_on, requested_by, trainer, emp_id, name, field, old_text, new_text, status, reviewed_by, reviewed_on, note, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      q.id, q.on, q.by, q.trainer, q.empId, q.name, q.field, q.oldText, q.newText, status, reviewer, reviewedOn, note, JSON.stringify(q.value));
    db.markDirty('Change Requests');
    if (s.isAdmin || checked.first) {
      applyChange(q, s.email);
      insert('Approved', s.isAdmin ? s.email : 'No approval needed', now, s.isAdmin ? 'Made by an admin' : 'First entry');
      return { status: 'applied', field, newText: q.newText };
    }
    insert('Pending', '', '', '');
    notifyAdmins(q, s);
    return { status: 'pending', field, newText: q.newText, requestId: q.id };
  });
}

/** Writes an approved change where it belongs. Runs inside the caller's transaction. */
export function applyChange(q, approver) {
  const v = q.value, now = new Date().toISOString();
  const finalMock = () => outbox.masterSet(q.empId, q.trainer, {
    'Final Mock Clearance / Fail Attempts': ordinal(v.attempt), 'Final Mock Status': v.status, 'Final Mock/Training End Date': v.date
  });
  if (q.field === 'Department') outbox.masterSet(q.empId, q.trainer, { 'Department': v.department, 'Sub-Team': v.subTeam });
  else if (q.field === 'Training Start Date') outbox.masterSet(q.empId, q.trainer, { 'Training Start Date': v.date });
  else if (q.field === 'Mock') {
    db.run(`INSERT INTO mock_scores (emp_id, name, trainer, mock_date, attempt, score, status, final, entered_by, approved_by, approved_on)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      q.empId, q.name, q.trainer, v.date, ordinal(v.attempt), v.score === '' || v.score == null ? null : Number(v.score), v.status, v.final ? 1 : 0, q.by, approver, now);
    db.markDirty('Mock Scores');
    if (v.final) finalMock();        // a final Fail ends training; a final Pass waits for the OJT answers
  } else if (q.field === 'Mock Edit') {
    const hit = db.all('SELECT id, attempt FROM mock_scores WHERE emp_id = ? ORDER BY id DESC', q.empId).find(r => attemptNumber(r.attempt) === Number(v.attempt));
    if (!hit) throw new UserError(ordinal(v.attempt) + ' attempt for ' + q.empId + ' is no longer recorded.');
    db.run('UPDATE mock_scores SET mock_date = ?, score = ?, status = ?, final = ?, approved_by = ?, approved_on = ? WHERE id = ?',
      v.date, v.score === '' || v.score == null ? null : Number(v.score), v.status, v.final ? 1 : 0, approver, now, hit.id);
    db.markDirty('Mock Scores');
    if (v.final) finalMock();
  } else if (q.field === 'OJT Entered' || q.field === 'OJT Eligible') {
    const col = q.field === 'OJT Entered' ? 'ojt_entered' : 'ojt_eligible';
    db.run(`INSERT INTO nht_status (emp_id, name, trainer, ${col}, updated_by, updated_on) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(emp_id) DO UPDATE SET ${col} = excluded.${col}, updated_by = excluded.updated_by, updated_on = excluded.updated_on`,
      q.empId, q.name, q.trainer, v.answer, approver, now);
    db.markDirty('NHT Status');
    scheduleOjtRebuild();            // both answers Yes moves the trainee to OJT Performance
  } else if (q.field === 'OJT Team') {
    db.run(`INSERT INTO ojt_team (emp_id, name, trainer, team, updated_by, updated_on) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(emp_id) DO UPDATE SET name = excluded.name, trainer = excluded.trainer, team = excluded.team, updated_by = excluded.updated_by, updated_on = excluded.updated_on`,
      q.empId, q.name, q.trainer, v.team, approver, now);
    db.markDirty('OJT Team');
  } else if (q.field.indexOf('OJT Input: ') === 0) {
    db.run(`INSERT INTO ojt_manual_inputs (emp_id, metric, name, trainer, achieved, updated_by, updated_on) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(emp_id, metric) DO UPDATE SET name = excluded.name, trainer = excluded.trainer, achieved = excluded.achieved, updated_by = excluded.updated_by, updated_on = excluded.updated_on`,
      q.empId, v.metric, q.name, q.trainer, v.achieved, approver, now);
    db.markDirty('OJT Manual Inputs');
  } else if (q.field.indexOf('Attendance ') === 0) {
    // A change to a saved attendance mark, approved: same checks as a direct save.
    const byId = {};
    trackedTrainees(q.trainer).forEach(t => { byId[t.empId] = t; });
    const m = {}; m[q.empId] = v.code;
    const plan = planAttendanceSave([{ date: v.date, marks: m }], byId, today(), CONFIG.ATTENDANCE_CODES);
    if (plan.skipped.length) throw new UserError(plan.skipped[0].reason);
    writeMarks(approver, q.trainer, plan.ok, byId);
  } else {
    throw new UserError('Unknown change type ' + q.field);
  }
}

function notifyAdmins(q, s) {
  if (!CONFIG.EMAIL_ADMINS_ON_REQUEST) return;
  const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  outbox.queueMail(CONFIG.ADMIN_EMAILS.join(','), 'Trainer Desk: approval needed for ' + q.name + ' (' + q.field + ')',
    '<p><b>' + esc(s.name) + '</b> asked to change <b>' + esc(q.field) + '</b> for <b>' + esc(q.name) + '</b> (' + esc(q.empId) + ').</p>' +
    '<p>From: ' + esc(q.oldText || 'not set') + '<br>To: ' + esc(q.newText) + '</p>' +
    '<p><a href="' + SERVER.origin + SERVER.base + '/">Open Trainer Desk</a> and go to Approvals to approve or reject it.</p>');
}

/**
 * One Save for everything changed on a trainee in Active NHT Details. req: { trainer, empId, changes: [{ field, value }] }
 * The mock is checked first. The department saves first (everything else needs it) and the OJT answers last,
 * because both answers Yes moves the trainee to OJT Performance.
 */
export function submitPageChanges(user, req) {
  const order = ['Department', 'Training Start Date', 'Mock Edit', 'Mock', 'OJT Entered', 'OJT Eligible'];
  const changes = ((req && req.changes) || []).slice().sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
  if (!changes.length) throw new UserError('Nothing to save.');
  const mock = changes.find(c => c.field === 'Mock');
  if (mock) {
    const s = data.session(user);
    const target = data.assertTrainer(s, req.trainer);
    let err = '';
    try { err = checkChange('Mock', mock.value, nhtContext(target, normId(req.empId), false)).error || ''; } catch (e) { err = e.message; }
    if (err) return { results: [{ field: 'Mock', ok: false, error: err }].concat(changes.filter(c => c !== mock).map(c => ({ field: c.field, ok: false, error: 'Not saved: fix the mock first.' }))) };
  }
  const results = changes.map(c => {
    try {
      const r = submitChange(user, { trainer: req.trainer, empId: req.empId, field: c.field, value: c.value }, !!mock);
      return { field: c.field, ok: true, status: r.status, newText: r.newText, requestId: r.requestId || '' };
    } catch (e) {
      return { field: c.field, ok: false, error: e.message };
    }
  });
  return { results };
}

/** Admins: every change still waiting for approval. */
export function getPendingApprovals(user) {
  const s = data.session(user);
  if (!s.isAdmin) return { pending: [] };
  const org = data.org();
  return { pending: data.requests("status = 'Pending'").map(q => {
    q.trainerName = org.names[q.trainer] || prettyName(q.trainer);
    q.byName = org.names[q.by] || prettyName(q.by);
    delete q.value;
    return q;
  }) };
}

/** Admins: approve or reject requests. req: { ids, decision: 'Approved' | 'Rejected', note } */
export function reviewRequests(user, req) {
  const s = data.session(user);
  if (!s.isAdmin) throw new UserError('Only admins can approve changes.', 403);
  const decision = req && req.decision === 'Rejected' ? 'Rejected' : 'Approved';
  const want = new Set((req.ids || []).map(String));
  const note = String(req.note || '').trim();
  const done = [], failed = [];
  data.requests().filter(q => want.has(q.id)).forEach(q => {
    if (q.status !== 'Pending') { failed.push({ id: q.id, reason: 'Already ' + q.status.toLowerCase() }); return; }
    try {
      db.tx(() => {
        if (decision === 'Approved') applyChange(q, s.email);
        db.run('UPDATE change_requests SET status = ?, reviewed_by = ?, reviewed_on = ?, note = ? WHERE id = ?', decision, s.email, new Date().toISOString(), note, q.id);
        db.markDirty('Change Requests');
      });
      done.push(q.id);
    } catch (e) {
      failed.push({ id: q.id, reason: e.message });
    }
  });
  return { decision, done, failed };
}
