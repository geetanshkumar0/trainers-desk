/**
 * End-to-end test of everything that talks to Google, against tests/fake-google.js:
 * sync into SQLite, the one-time import of the old tabs, Master Dashboard writes through the outbox
 * (including Google being down), the overlay, the mirror back to the tracker, and the OJT refresh.
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

test('first start imports the old app tabs, once', async () => {
  const counts = await mirror.importFromSheets();
  assert.ok(counts.attendance > 50 && counts.mocks > 10 && counts.changeRequests === 3, JSON.stringify(counts));
  assert.equal(await mirror.importFromSheets(), null);
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

test('people already in OJT before the new rule stay there', () => {
  // Their final mock Pass came before the rule, so they are not pulled back into Active NHT Details.
  const before = db.all("SELECT emp_id FROM mock_scores WHERE final = 1 AND status = 'Pass' AND approved_on < ?", db.getMeta('ojt_answer_rule_since', '')).map(r => r.emp_id);
  assert.ok(before.length > 5);
  const nht = new Set(changes.getNhtCandidates(ADMIN, TR).candidates.map(x => x.empId));
  assert.ok(before.every(id => !nht.has(id)));
});

test('the mirror copies app tabs back, and they read back the same', async () => {
  const t = attendance.getAttendance(TR, TR).trainees.find(x => x.doj <= today() && x.trackUntil >= today());
  attendance.saveAttendance(ADMIN, { trainer: TR, days: [{ date: today(), marks: { [t.empId]: 'WO' } }] });
  const done = await mirror.mirrorNow();
  assert.ok(done.includes('Attendance') && done.includes('Attendance Log'), done.join());
  assert.equal(db.get('SELECT COUNT(*) n FROM mirror_dirty').n, 0);
  const grid = fake.tab('TRACKER', 'Attendance').grid;
  const dcol = grid[0].indexOf(today());
  assert.equal(grid.find(r => r[0] === t.empId)[dcol], 'WO');
  // Written in place: a tab that gets shorter is blanked below, never left with old rows.
  const two = cand.getUnclaimedCandidates(ADMIN).slice(0, 2).map(x => x.empId);
  cand.excludeCandidates(ADMIN, { ids: two, reason: 'test' });
  await mirror.mirrorNow();
  assert.equal(fake.tab('TRACKER', 'Excluded Candidates').grid.filter(r => two.includes(r[0])).length, 2);
  cand.restoreCandidates(ADMIN, { ids: [two[0]] });
  await mirror.mirrorNow();
  const ex = fake.tab('TRACKER', 'Excluded Candidates').grid;
  assert.equal(ex.filter(r => r[0] === two[1]).length, 1);
  assert.equal(ex.filter(r => r[0] === two[0]).length, 0, 'the restored row is gone, not left behind');
  assert.ok(fake.tab('TRACKER', 'Attendance Log'), 'new tab created');
  // Round trip: what the mirror wrote imports into an empty database as the same data.
  const before = { att: db.get('SELECT COUNT(*) n FROM attendance').n, cr: db.get('SELECT COUNT(*) n FROM change_requests').n, mk: db.get('SELECT COUNT(*) n FROM mock_scores').n };
  const grids = {};
  Object.keys(mirror.TABS).forEach(n => { const x = fake.tab('TRACKER', n); if (x) grids[n] = x.grid; });
  db.close();
  db.open(path.join(dir, 'second.db'));
  const counts = mirror.importGrids(grids, 'en_US');
  assert.deepEqual({ att: counts.attendance, cr: counts.changeRequests, mk: counts.mocks }, before);
  db.close();
  db.open(SERVER.dbFile);
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
