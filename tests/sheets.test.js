/**
 * End-to-end test of everything that talks to Google, against tests/fake-google.js:
 * sync into SQLite, screens showing only trainees claimed in Trainer Desk, Master Dashboard writes through the outbox
 * (including Google being down), the overlay, row-by-row writes to the tracker's app tabs (leaving everyone
 * else's rows alone), and the OJT refresh.
 *   npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as fake from './fake-google.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-test-'));
Object.assign(process.env, { TRACKER_ID: 'TRACKER', DUMPS_ID: 'DUMPS', DATA_DIR: dir, DEMO: '', DESK_EXTRA_ADMINS: 'priya.nair@nobroker.in',
  GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', SHEET_MIRROR: 'on', MIRROR_DELAY_SECONDS: '1' });

const { SERVER, CONFIG } = await import('../server/config.js');
const db = await import('../server/db.js');
const G = await import('../server/google.js');
const sync = await import('../server/sync.js');
const outbox = await import('../server/outbox.js');
const mirror = await import('../server/mirror.js');
const cand = await import('../server/services/candidates.js');
const changes = await import('../server/services/changes.js');
const attendance = await import('../server/services/attendance.js');
const ojt = await import('../server/services/ojt.js');
const perf = await import('../server/services/performance.js');
const { today, addDaysIso } = await import('../server/dates.js');
const { build } = await import('../preview/fake-data.js');

const ADMIN = 'priya.nair@nobroker.in', TR = 'aditi.rao@nobroker.in';
const data = build(today());
fake.install();
const trackerBook = fake.addBook('TRACKER', Object.assign({}, data.tracker, data.appTabs));
fake.tab('TRACKER', 'Master Dashboard').rows = data.tracker['Master Dashboard'].length;   // full grid: the next claim must add rows
const talkGrid = data.talk.ids.map((id, i) => [data.talk.dates[i], '', id, '', '', '', '', data.talk.durations[i]]);
fake.addBook('DUMPS', { 'OJT Targets Across Nobroker': data.targets.values, 'Talktime': talkGrid,
  'Seller Servicing (Closure)': [['x', 'Email', 'Status', 'Date'], ['', 'a@nobroker.in', 'CLOSED_VIA_NOBROKER', today()]] });
db.open(SERVER.dbFile);
G.saveSheetsToken('refresh', 'nbhr@nobroker.in', 'google');
const masterGrid = () => fake.tab('TRACKER', 'Master Dashboard').grid;
const col = name => masterGrid()[0].indexOf(name);

test('sync copies the tracker into SQLite', async () => {
  const res = await sync.syncTracker('test');
  assert.equal(res.master, data.tracker['Master Dashboard'].length - 1);
  assert.equal(db.get('SELECT COUNT(*) n FROM in_org').n, 5);
  assert.ok(db.get('SELECT COUNT(*) n FROM in_kc').n > 10);
  assert.ok(db.get("SELECT COUNT(*) n FROM in_departments").n > 50, 'built-in department list when the tab is missing');
  assert.ok(db.get('SELECT grid FROM in_grids WHERE name = ?', CONFIG.OJT_TARGETS_SHEET));
});

test('nothing from the old tabs is imported: screens start with only Trainer Desk data', () => {
  assert.equal(db.get('SELECT COUNT(*) n FROM attendance').n + db.get('SELECT COUNT(*) n FROM change_requests').n + db.get('SELECT COUNT(*) n FROM mock_scores').n, 0);
  assert.deepEqual(cand.getTrainerBatches(TR, TR).batches, []);
  assert.deepEqual(changes.getNhtCandidates(TR, TR).candidates, []);
  assert.deepEqual(attendance.getAttendance(TR, TR).trainees, []);
  assert.deepEqual(changes.getPendingApprovals(ADMIN).pending, [], 'the 3 pending requests in the live tab are not shown');
  // The Performance Dashboards still use the full live Master Dashboard.
  const head = perf.getPerformanceOld(ADMIN, '').rows.find(r => r.level === 'head');
  assert.ok(head.E > 100, 'live hires counted: ' + head.E);
});

test('a claim is saved locally, then written to Master Dashboard (adding rows)', async () => {
  const pick = cand.getUnclaimedCandidates(TR).filter(c => c.active).slice(0, 2).map(c => c.empId);
  const start = addDaysIso(today(), 3);
  const res = cand.assignCandidates(TR, { ids: pick, trainer: TR, trainingStart: start });
  assert.deepEqual(res.assigned, pick);
  const local = db.all('SELECT * FROM in_master WHERE emp_id IN (?, ?)', ...pick);
  assert.equal(local.length, 2);
  assert.equal(local[0].row_no, null);
  assert.ok(local[0].name, 'name filled from the HR sheet until the sheet formulas run');
  await outbox.kick();
  assert.equal(outbox.status().waiting, 0);
  const g = masterGrid(), rows = g.filter(r => pick.includes(r[col('Emp ID')]));
  assert.equal(rows.length, 2);
  assert.equal(rows[0][col('Trainer')], TR);
  assert.equal(rows[0][col('Training Start Date')], start);
  assert.ok(fake.tab('TRACKER', 'Master Dashboard').rows >= g.length, 'grid was extended');
  // The same people cannot be claimed twice.
  assert.equal(cand.assignCandidates(TR, { ids: pick, trainer: TR }).assigned.length, 0);
  // They show up in Batches, Attendance and Active NHT Details; nobody else does.
  const ids = new Set(pick);
  assert.deepEqual(cand.getTrainerBatches(TR, TR).batches.flatMap(b => b.trainees.map(t => t.empId)).sort(), [...pick].sort());
  assert.ok(changes.getNhtCandidates(TR, TR).candidates.every(c => ids.has(c.empId)) && changes.getNhtCandidates(TR, TR).candidates.length === 2);
  assert.equal(attendance.getAttendance(TR, TR).trainees.length, 2);
  // For the rest of the tests: Aditi's other trainees count as claimed in Trainer Desk earlier.
  db.run("INSERT OR IGNORE INTO claims (emp_id, trainer, claimed_by, claimed_on) SELECT emp_id, trainer, trainer, '2026-10-01' FROM in_master WHERE trainer = ?", TR);
  assert.deepEqual(cand.getTrainerBatches(ADMIN, 'karthik.menon@nobroker.in').batches, [], 'other trainers: still nothing claimed');
});

test('candidates claimed in the previous Trainer Desk (its WhatsApp Log) show up in Attendance and Active NHT Details', async () => {
  const K = 'karthik.menon@nobroker.in';
  const mine = db.all("SELECT emp_id FROM in_master WHERE trainer = ? AND status = 'Active' AND training_end = '' AND lwd = ''", K).map(r => r.emp_id);
  assert.ok(mine.length >= 2);
  const claimed = mine.slice(0, 2);
  // As the previous version wrote it: Sent On | Trainer | Emp ID | Candidate | ... | Status
  fake.addTab('TRACKER', 'WhatsApp Log', [['Sent On', 'Trainer', 'Emp ID', 'Candidate', 'Candidate Phone', 'Sent To', 'Template', 'Status', 'Detail']]
    .concat(claimed.map(id => [today() + ' 09:15:00', K, id, '', '', '', 'nht_trainer_assigned', 'logged', 'WA_MODE=off'])));
  await sync.syncTracker('previous claims');
  const att = attendance.getAttendance(ADMIN, K).trainees.map(t => t.empId).sort();
  const nht = changes.getNhtCandidates(ADMIN, K).candidates.map(c => c.empId).sort();
  assert.deepEqual(att, [...claimed].sort(), 'Attendance shows exactly the previously claimed trainees');
  assert.deepEqual(nht, [...claimed].sort(), 'Active NHT Details too');
  assert.ok(mine.length > 2 && !att.includes(mine[2]), 'trainees never claimed in Trainer Desk stay hidden');
});

test('master writes survive Google being down, and the overlay keeps them visible', async () => {
  const trainee = changes.getNhtCandidates(ADMIN, TR).candidates.find(c => c.department !== 'PIA');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => (/values:batchUpdate/.test(String(url)) ? new Response('{"error":{"message":"backend down"}}', { status: 503 }) : realFetch(url, opts));
  const r = changes.submitChange(ADMIN, { trainer: TR, empId: trainee.empId, field: 'Department', value: { department: 'PIA', subTeam: '' } });
  assert.equal(r.status, 'applied');
  await outbox.kick();
  assert.equal(outbox.status().waiting, 1);
  assert.match(db.get("SELECT last_error FROM outbox WHERE state = 'waiting'").last_error, /backend down/);
  await sync.syncTracker('while down');                        // the sheet still has the old value...
  assert.equal(db.get('SELECT department FROM in_master WHERE emp_id = ?', trainee.empId).department, 'PIA');   // ...but the app shows the new one
  globalThis.fetch = realFetch;
  db.run("UPDATE outbox SET next_try = ''");
  await outbox.kick();
  assert.equal(outbox.status().waiting, 0);
  const row = masterGrid().find(x => x[col('Emp ID')] === trainee.empId);
  assert.equal(row[col('Department')], 'PIA');
  assert.equal(row[col('Sub-Team')], '');
  await sync.syncTracker('after');
  assert.equal(db.get('SELECT department FROM in_master WHERE emp_id = ?', trainee.empId).department, 'PIA');
});

test('unclaimed lists only people who joined after 20 Oct', () => {
  assert.equal(CONFIG.UNCLAIMED_FROM, '2026-10-21');
  const list = cand.getUnclaimedCandidates(ADMIN);
  assert.ok(list.length > 0);
  assert.ok(list.every(c => c.doj && c.doj >= CONFIG.UNCLAIMED_FROM), 'nobody from before the cut-off or without a DOJ');
});

test('Active NHT Details: the department and sub-team come first', () => {
  const c = changes.getNhtCandidates(TR, TR).candidates.find(x => x.kc && !x.mocks.length);
  db.run("UPDATE in_master SET department = '', sub_team = '' WHERE emp_id = ?", c.empId);     // as a fresh claim arrives
  const ts = { field: 'Training Start Date', value: { date: addDaysIso(today(), 1) } };
  assert.throws(() => changes.submitChange(TR, Object.assign({ trainer: TR, empId: c.empId }, ts)), /department and sub-team first/);
  // Department and the rest in one Save: the department goes first, so the rest is allowed.
  const res = changes.submitPageChanges(TR, { trainer: TR, empId: c.empId, changes: [ts, { field: 'Department', value: { department: 'Tenant Servicing', subTeam: 'TSPP' } }] });
  assert.ok(res.results.every(r => r.ok), JSON.stringify(res));
  // A department that has sub-teams needs one.
  const d = changes.getNhtCandidates(TR, TR).candidates.find(x => x.empId !== c.empId && x.kc);
  db.run("UPDATE in_master SET department = 'Tenant Servicing', sub_team = '' WHERE emp_id = ?", d.empId);
  assert.throws(() => changes.submitChange(TR, { trainer: TR, empId: d.empId, field: 'Mock', value: { date: today(), attempt: 1, status: 'Fail' } }), /sub-team first/);
});

test('a final Pass stays in Active NHT Details until OJT Entered and OJT Eligible are Yes, then moves to OJT Performance', async () => {
  mirror.start();
  const c = changes.getNhtCandidates(ADMIN, TR).candidates.find(x => x.kc && !x.mocks.length && x.department && x.subTeam);
  const d = addDaysIso(today(), -1);
  const res = changes.submitPageChanges(TR, { trainer: TR, empId: c.empId, changes: [{ field: 'Mock', value: { date: d, attempt: 1, status: 'Pass' } }] });
  assert.equal(res.results[0].ok, true, JSON.stringify(res));
  await outbox.kick();
  const row = masterGrid().find(x => x[col('Emp ID')] === c.empId);
  assert.deepEqual([row[col('Final Mock Clearance / Fail Attempts')], row[col('Final Mock Status')], row[col('Final Mock/Training End Date')]], ['1st', 'Pass', d]);
  const inNht = () => changes.getNhtCandidates(TR, TR).candidates.some(x => x.empId === c.empId);
  const inOjt = () => ojt.getOjtSummary(TR, TR).rows.some(x => x.empId === c.empId);
  assert.ok(inNht() && !inOjt(), 'waits for the OJT answers');
  changes.submitPageChanges(TR, { trainer: TR, empId: c.empId, changes: [{ field: 'OJT Entered', value: { answer: 'Yes' } }, { field: 'OJT Eligible', value: { answer: 'No' } }] });
  assert.ok(inNht() && !inOjt(), 'Eligible No: still in training');
  const r2 = changes.submitPageChanges(ADMIN, { trainer: TR, empId: c.empId, changes: [{ field: 'OJT Eligible', value: { answer: 'Yes' } }] });
  assert.ok(r2.results[0].ok, JSON.stringify(r2));
  assert.ok(!inNht() && inOjt(), 'moved to OJT Performance');
  // Everything in one Save, as the page sends it: mock Pass + both answers Yes.
  const g = changes.getNhtCandidates(ADMIN, TR).candidates.find(x => x.kc && !x.mocks.length && x.department && x.subTeam);
  const one = changes.submitPageChanges(TR, { trainer: TR, empId: g.empId, changes: [{ field: 'OJT Eligible', value: { answer: 'Yes' } },
    { field: 'OJT Entered', value: { answer: 'Yes' } }, { field: 'Mock', value: { date: d, attempt: 1, status: 'Pass' } }] });
  assert.ok(one.results.every(r => r.ok), JSON.stringify(one));
  assert.ok(!changes.getNhtCandidates(TR, TR).candidates.some(x => x.empId === g.empId) && ojt.getOjtSummary(TR, TR).rows.some(x => x.empId === g.empId));
  // A final Fail ends training without OJT.
  const f = changes.getNhtCandidates(ADMIN, TR).candidates.find(x => x.kc && !x.mocks.length && x.department && x.subTeam);
  changes.submitPageChanges(TR, { trainer: TR, empId: f.empId, changes: [{ field: 'Mock', value: { date: d, attempt: 1, status: 'Fail', final: true } }] });
  assert.ok(!changes.getNhtCandidates(TR, TR).candidates.some(x => x.empId === f.empId));
  // ...and the sheet has the answers within seconds, without anyone pressing anything.
  await new Promise(r => setTimeout(r, 2500));
  const ns = fake.tab('TRACKER', 'NHT Status').grid.find(x => x[0] === c.empId);
  assert.deepEqual([ns[3], ns[4]], ['Yes', 'Yes']);
  assert.ok(fake.tab('TRACKER', 'Mock Scores').grid.some(x => x[0] === f.empId && x[6] === 'Fail'));
  mirror.stop();
});

test('the tracker tabs get Trainer Desk rows added or changed, and nobody else\'s rows are touched', async () => {
  const grid = n => fake.tab('TRACKER', n).grid;
  const snapshot = n => JSON.stringify(grid(n).filter((r, i) => i && !tdIds.has(String(r[0]).toUpperCase())));
  const tdIds = new Set(db.all('SELECT emp_id FROM claims').map(r => r.emp_id));
  const liveMocks = snapshot('Mock Scores'), liveRequests = snapshot('Change Requests');
  // Attendance: everyone else's marks, by person and date.
  const marksBy = () => { const g = grid('Attendance'), out = {}; g.slice(1).forEach(r => { if (!tdIds.has(r[0])) g[0].forEach((d, i) => { if (i >= 4 && r[i]) out[r[0] + '|' + d] = r[i]; }); }); return out; };
  const liveMarks = marksBy();
  assert.ok(Object.keys(liveMarks).length > 100);

  const t = attendance.getAttendance(TR, TR).trainees.find(x => x.doj <= addDaysIso(today(), -20) && x.trackUntil >= today());
  const early = addDaysIso(today(), -20);                       // before every existing date column: a new first column
  attendance.saveAttendance(ADMIN, { trainer: TR, days: [{ date: today(), marks: { [t.empId]: 'WO' } }, { date: early, marks: { [t.empId]: 'P' } }] });
  await mirror.mirrorNow();
  const g = grid('Attendance'), row = g.find(r => r[0] === t.empId);
  assert.equal(row[g[0].indexOf(today())], 'WO');
  assert.equal(row[g[0].indexOf(early)], 'P');
  assert.equal(g[0].indexOf(early), 4, 'new date column placed in date order');
  assert.deepEqual(marksBy(), liveMarks, 'other people\'s marks unchanged and still under the right dates');
  assert.equal(snapshot('Mock Scores'), liveMocks);
  assert.equal(snapshot('Change Requests'), liveRequests);
  assert.ok(grid('Mock Scores').some(r => tdIds.has(r[0])), 'Trainer Desk mocks added');
  assert.ok(fake.tab('TRACKER', 'Attendance Log').grid.length >= 3, 'log tab created and appended');

  // Changing a record changes its row in place; nothing is written twice.
  const before = grid('Attendance').length;
  attendance.saveAttendance(ADMIN, { trainer: TR, days: [{ date: today(), marks: { [t.empId]: 'L' } }] });
  await mirror.mirrorNow();
  assert.equal(grid('Attendance').length, before);
  assert.equal(grid('Attendance').filter(r => r[0] === t.empId).length, 1);
  assert.equal(grid('Attendance').find(r => r[0] === t.empId)[grid('Attendance')[0].indexOf(today())], 'L');
  assert.deepEqual(await mirror.mirrorNow(), [], 'nothing left to write');

  // Removing: only Trainer Desk's own row goes.
  const two = cand.getUnclaimedCandidates(ADMIN).slice(0, 2).map(x => x.empId);
  cand.excludeCandidates(ADMIN, { ids: two, reason: 'test' });
  await mirror.mirrorNow();
  assert.equal(grid('Excluded Candidates').filter(r => two.includes(r[0])).length, 2);
  cand.restoreCandidates(ADMIN, { ids: [two[0]] });
  await mirror.mirrorNow();
  assert.deepEqual(grid('Excluded Candidates').filter(r => two.includes(r[0])).map(r => r[0]), [two[1]]);
  assert.equal(db.get('SELECT COUNT(*) n FROM mirror_dirty').n, 0);
});

test('the OJT refresh reads Talktime and the dumps from Google', async () => {
  const res = await ojt.refreshOjtDashboard(ADMIN);
  assert.ok(res.rows > 20 && res.inOjt > 0, JSON.stringify(res));
  assert.ok(res.missingTabs.includes('Intracity') && !res.missingTabs.includes('Seller Servicing (Closure)'));
  assert.equal(db.get('SELECT COUNT(*) n FROM in_talktime').n, data.talk.ids.length);
  await assert.rejects(ojt.refreshOjtDashboard(TR), /Only admins/);
});

test('trainers cannot open other trainers or approve', () => {
  assert.throws(() => cand.getTrainerBatches(TR, 'karthik.menon@nobroker.in'), /do not have access/);
  assert.throws(() => changes.reviewRequests(TR, { ids: [], decision: 'Approved' }), /Only admins/);
  assert.deepEqual(changes.getPendingApprovals(TR), { pending: [] });
});

test.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); void trackerBook; });
