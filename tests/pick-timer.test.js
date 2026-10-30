/**
 * Pick Timer inside Trainer Desk: its own admins and roles (separate from Trainer Desk's), a booking through the
 * mounted server, reading the score sheet through Trainer Desk's Google account, and data kept across a restart.
 * The rules themselves are tested in pick-timer/test/core.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const { createPickTimer } = createRequire(import.meta.url)('../pick-timer/server/mount.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-pt-'));
const ADMIN = 'geetansh.kumar@nobroker.in';
const TD_ADMIN = 'gaurav.garg@nobroker.in';          // a Trainer Desk admin: no say in Pick Timer
const TD_TRAINER = 'aditi.rao@nobroker.in';          // a Trainer Desk trainer: no access until added here

// PIA's score sheet as Trainer Desk would read it (see server/scoresheet.js).
const SHEET = { headers: ['Date of KC', 'Emp ID', 'Attempt', 'Obtained Percentage', 'Status'], rows: [] };
let sheetCalls = [], sheetError = null;
async function readSheet(id, tab) { sheetCalls.push([id, tab]); if (sheetError) throw sheetError; return SHEET; }

let pt, server, base;
function start() {
  pt = createPickTimer({ dataDir: dir, demo: false, log: () => {}, readSheet, sheetsAccount: () => 'nbhr@nobroker.in',
    defaultSheet: { sheetId: '1VpY6PK810t2XFpLx1df5-ZUaBXPDlHDhz0ddJpTvAss', tab: 'KC Sheet' } });
  // As Trainer Desk does: it passes only the signed-in e-mail (here a header).
  server = http.createServer((req, res) => {
    pt.handle(req, res, new URL(req.url, 'http://x').pathname.replace(/^\/pick-timer\//, ''), { email: req.headers['x-test-user'] });
  });
  return new Promise(r => server.listen(0, () => { base = 'http://127.0.0.1:' + server.address().port + '/pick-timer/'; r(); }));
}
async function stop() { await new Promise(r => server.close(r)); pt.stop(); pt.close(); }
async function as(email, method, sub, body, headers) {
  const r = await fetch(base + sub, { method, headers: Object.assign({ 'X-Test-User': email, 'Content-Type': 'application/json', 'X-Requested-With': 'kc' }, headers || {}), body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = text; try { data = JSON.parse(text); } catch (e) { /* page or script */ }
  return { status: r.status, data };
}
const op = (email, name, params) => as(email, 'POST', 'api/op', { op: name, params });
// A Monday-to-Saturday date some days ahead, so its slots have not started.
function nextWorkday(days) { const d = new Date(Date.now() + 19800000 + days * 864e5); if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

test.before(start);

test('the page and its files are served under /pick-timer/', async () => {
  const page = await as(ADMIN, 'GET', '');
  assert.equal(page.status, 200);
  assert.match(page.data, /src="core\.js"/);
  assert.match((await as(ADMIN, 'GET', 'apps-script.gs')).data, /SECRET_KEY/);
  assert.equal((await as(ADMIN, 'POST', 'api/op', { op: 'analytics' }, { 'X-Requested-With': '' })).status, 403, 'POST needs the request header');
});

test("Pick Timer's admins and roles are its own: Trainer Desk admins and trainers get nothing automatically", async () => {
  const a = await as(ADMIN, 'GET', 'api/boot');
  assert.equal(a.data.view.me.role, 'admin');
  assert.equal(a.data.view.me.builtin, true, 'built-in admin from pick-timer/server/site-admins.js');
  assert.equal(a.data.view.settings.name, 'Pick Timer');
  for (const email of [TD_ADMIN, TD_TRAINER]) {
    assert.equal((await as(email, 'GET', 'api/boot')).data.noAccess, true, email + ' is not in Pick Timer\'s list');
    assert.equal((await op(email, 'analytics', {})).status, 403);
    assert.equal(pt.hasAccess({ email }), false, 'so no top-bar button');
  }
  // The Pick Timer admin adds them, with whatever role Pick Timer needs.
  assert.equal((await op(ADMIN, 'saveUser', { name: 'Aditi Rao', email: TD_TRAINER, role: 'trainer' })).status, 200);
  assert.equal((await op(ADMIN, 'saveUser', { name: 'Gaurav Garg', email: TD_ADMIN, role: 'pia' })).status, 200);
  assert.equal((await as(TD_TRAINER, 'GET', 'api/boot')).data.view.me.role, 'trainer');
  assert.equal((await as(TD_ADMIN, 'GET', 'api/boot')).data.view.me.role, 'pia', 'a Trainer Desk admin can be just PIA here');
  assert.equal(pt.hasAccess({ email: TD_TRAINER }), true);
  // ...and can take access away again.
  const u = (await as(ADMIN, 'GET', 'api/boot')).data.view.users.find(x => x.email === TD_ADMIN);
  await op(ADMIN, 'saveUser', { id: u.id, name: 'Gaurav Garg', email: TD_ADMIN, role: 'pia', active: false });
  assert.equal((await as(TD_ADMIN, 'GET', 'api/boot')).data.noAccess, true);
});

test('a trainer books a KC, a PIA member added by the admin assigns it', async () => {
  // PIA's KC names are already in the list; adding one again is refused.
  assert.match((await op(ADMIN, 'saveKc', { name: 'legal  services', type: 'Objective' })).data.error, /already exists/);
  const kcId = (await as(ADMIN, 'GET', 'api/boot')).data.view.kcs.find(k => k.name === 'Legal Services').id;
  const kc = { data: { result: { kcId } } };
  const add = await op(ADMIN, 'saveUser', { name: 'Rahul', email: 'rahul.pia@nobroker.in', role: 'pia' });
  assert.equal(add.status, 200);
  const date = nextWorkday(3);
  const book = await op(TD_TRAINER, 'book', { date, hour: 11, mode: 'Online', requestedKcId: kc.data.result.kcId, category: 'New Hire', attempt: 1,
    attendees: [{ empId: 'NBTS50001', name: 'Asha K', email: 'asha.k@nobroker.in' }] });
  assert.equal(book.status, 200, JSON.stringify(book.data));
  assert.equal(book.data.result.status, 'booked');
  const pia = await as('rahul.pia@nobroker.in', 'GET', 'api/boot');
  assert.equal(pia.data.view.me.role, 'pia');
  const assign = await op('rahul.pia@nobroker.in', 'assignKc', { sessionId: book.data.result.sessionId, kcId: kc.data.result.kcId });
  assert.equal(assign.status, 200, JSON.stringify(assign.data));
  assert.equal(assign.data.view.sessions.find(s => s.id === book.data.result.sessionId).status, 'assigned');
  // Booking emails wait in the log until an admin turns email on.
  assert.ok((await as(ADMIN, 'GET', 'api/boot')).data.view.emailLog.some(m => m.to === 'asha.k@nobroker.in'));
});

test('the score sheet (KC Sheet tab) is read through Trainer Desk\'s Google account and matched to the booking', async () => {
  const v = (await as(ADMIN, 'GET', 'api/boot')).data.view;
  assert.deepEqual([v.settings.sheet.sheetId, v.settings.sheet.tab], ['1VpY6PK810t2XFpLx1df5-ZUaBXPDlHDhz0ddJpTvAss', 'KC Sheet'], 'linked out of the box');
  const s = v.sessions[0];
  SHEET.rows = [{ row: 2, cells: [s.date, 'NBTS50001', '1', '82%', 'Pass'] }];
  const test1 = await op(ADMIN, 'testSheet', {});
  assert.equal(test1.status, 200, JSON.stringify(test1.data));
  assert.deepEqual(test1.data.result.missing, []);
  assert.deepEqual(sheetCalls.at(-1), ['1VpY6PK810t2XFpLx1df5-ZUaBXPDlHDhz0ddJpTvAss', 'KC Sheet']);
  const pull = await op('rahul.pia@nobroker.in', 'pullScores', { sessionId: s.id });
  assert.equal(pull.status, 200, JSON.stringify(pull.data));
  assert.deepEqual([pull.data.result.matched, pull.data.result.total], [1, 1]);
  const att = pull.data.view.sessions.find(x => x.id === s.id).attendees[0];
  assert.equal(att.result.pass, true);
  // When the sheet is not shared with Trainer Desk's account, the message says what to do.
  sheetError = Object.assign(new Error('Google API 403: The caller does not have permission'), { status: 403 });
  const bad = await op(ADMIN, 'testSheet', {});
  assert.match(bad.data.error, /Share it \(view access is enough\) with nbhr@nobroker\.in/);
  sheetError = null;
  // A pasted link is accepted.
  const save = await op(ADMIN, 'saveSettings', { section: 'sheet', values: { sheetId: 'https://docs.google.com/spreadsheets/d/1VpY6PK810t2XFpLx1df5-ZUaBXPDlHDhz0ddJpTvAss/edit?gid=765048369', tab: 'KC Sheet' } });
  assert.equal(save.data.view.settings.sheet.sheetId, '1VpY6PK810t2XFpLx1df5-ZUaBXPDlHDhz0ddJpTvAss');
});

test('sign-in settings cannot be changed in Pick Timer (Trainer Desk signs people in)', async () => {
  const r = await op(ADMIN, 'saveSettings', { section: 'sso', values: { enabled: true } });
  assert.equal(r.status, 400);
});

test('everything is kept across a restart, and backed up', async () => {
  await stop();
  await start();
  const v = (await as(ADMIN, 'GET', 'api/boot')).data.view;
  assert.equal(v.sessions.length, 1);
  assert.ok(v.users.some(u => u.name === 'Aditi Rao' && u.role === 'trainer'));
  assert.ok(v.users.some(u => u.email === 'gaurav.garg@nobroker.in' && !u.active), 'kept inactive');
  const file = path.join(dir, 'backups', 'pt.db');
  pt.backup(file);
  assert.ok(fs.statSync(file).size > 0);
});

test.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

test("Trainer Desk's reader turns the score sheet into header + rows, with Date of KC as yyyy-MM-dd", async () => {
  const fake = await import('./fake-google.js');
  const db = await import('../server/db.js');
  const G = await import('../server/google.js');
  const { readScoreSheet } = await import('../server/scoresheet.js');
  db.open(path.join(dir, 'td.db'));
  G.saveSheetsToken('refresh', 'nbhr@nobroker.in', 'google');
  fake.install();
  // A title row above the headers; the date as Sheets stores it (a day number); a blank row.
  fake.addBook('SCORES', { 'KC Sheet': [['KC scores 2026'], ['Date of KC', 'Emp ID', 'Attempt', 'Obtained Percentage', 'Status'],
    [46325, 'NBTS50001', '1', '82%', 'Pass'], [], ['30/10/2026', 'NBTS50002', '2', '60%', 'Fail']] });
  const out = await readScoreSheet('SCORES', 'KC Sheet');
  assert.deepEqual(out.headers, ['Date of KC', 'Emp ID', 'Attempt', 'Obtained Percentage', 'Status']);
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].row, 3);
  assert.equal(out.rows[0].cells[0], '2026-10-30');
  assert.equal(out.rows[1].cells[0], '30/10/2026', 'dates typed as text are left for Pick Timer to read');
  await assert.rejects(readScoreSheet('SCORES', 'Nope'), /400/);
  db.close();
});

test('a Pick Timer admin can switch role for their own requests; others cannot', async () => {
  const asPia = await as(ADMIN, 'GET', 'api/boot', null, { 'X-KC-Role': 'pia' });
  assert.deepEqual([asPia.data.view.me.role, asPia.data.view.me.realRole], ['pia', 'admin']);
  const refused = await as(ADMIN, 'POST', 'api/op', { op: 'saveSettings', params: { section: 'general', values: {} } }, { 'X-KC-Role': 'trainer' });
  assert.equal(refused.status, 403);
  const pia = await as('rahul.pia@nobroker.in', 'GET', 'api/boot', null, { 'X-KC-Role': 'admin' });
  assert.equal(pia.data.view.me.role, 'pia');
});

test('PIA\'s KC names are in the KC list once, without duplicates', async () => {
  const names = createRequire(import.meta.url)('../pick-timer/server/kc-list.js');
  const v = (await as(ADMIN, 'GET', 'api/boot')).data.view;
  const list = v.kcs.map(k => k.name.toLowerCase());
  for (const n of ['CPMS Sales 1', 'Knowledge Check - Investment Advisory (Buyer servicing)', 'Plot RM Servicing', 'BAPS - Pre-sales KC']) assert.ok(list.includes(n.toLowerCase()), n);
  assert.equal(new Set(list).size, list.length, 'no duplicates');
  assert.equal(names.length, 100);
});

test('the KC list is added only once, and the test booking removal matches only that booking', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-once-'));
  const { Store } = createRequire(import.meta.url)('../pick-timer/server/store.js');
  const mk = () => createPickTimer({ dataDir: d, demo: false, log: () => {} });
  let pt = mk(); let S = pt.state();
  assert.equal(S.kcs.length, 100);
  // An admin turns one KC off and deletes another; Abhijeet has the test booking and a real one.
  S.kcs.pop(); S.kcs[0].active = false;
  const ab = { id: 'uab', name: 'Abhijeet Patel', email: 'abhijeet.patel@nobroker.in', role: 'trainer', active: true };
  S.users.push(ab);
  const sess = (id, hour, emp) => { S.sessions.push({ id, date: '2026-10-30', hour, mode: 'Online', trainerId: 'uab', status: 'assigned', attempt: 1 }); S.attendees.push({ id: 'a' + id, sessionId: id, empId: emp, name: 'x', email: 'x@nobroker.in' }); };
  sess('test', 13, 'NBTS41735'); sess('real', 14, 'NBTS41735');
  S.settings.removalsDone = [];
  pt.close();
  const st = new Store(d, 'pick-timer.db'); st.load(); st.save(S); st.close();
  pt = mk(); S = pt.state();
  assert.equal(S.kcs.length, 99, 'a deleted KC is not added back');
  assert.equal(S.kcs[0].active, false);
  assert.deepEqual(S.sessions.map(s => s.id), ['real']);
  assert.deepEqual(S.attendees.map(a => a.sessionId), ['real']);
  pt.close(); fs.rmSync(d, { recursive: true, force: true });
});
