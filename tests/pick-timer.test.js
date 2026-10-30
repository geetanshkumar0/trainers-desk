/**
 * Pick Timer inside Trainer Desk: who gets in (Trainer Desk admins, trainers, people added by an admin),
 * a booking through the mounted server, and data kept across a restart.
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
const PEOPLE = {
  [ADMIN]: { name: 'Geetansh Kumar', isAdmin: true, isTrainer: false },
  'aditi.rao@nobroker.in': { name: 'Aditi Rao', isAdmin: false, isTrainer: true },
  'priya.nair@nobroker.in': { name: 'Priya Nair', isAdmin: false, isTrainer: false },     // a manager, not a trainer
  'rahul.pia@nobroker.in': { name: 'Rahul', isAdmin: false, isTrainer: false }
};

let pt, server, base;
function start() {
  pt = createPickTimer({ dataDir: dir, demo: false, admins: [ADMIN], log: () => {} });
  // As Trainer Desk does: the signed-in e-mail (here a header) and what Trainer Desk knows about that person.
  server = http.createServer((req, res) => {
    const email = req.headers['x-test-user'];
    pt.handle(req, res, new URL(req.url, 'http://x').pathname.replace(/^\/pick-timer\//, ''), Object.assign({ email }, PEOPLE[email]));
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

test('Trainer Desk admins are built-in admins; trainers get in as Trainers; others are refused', async () => {
  const a = await as(ADMIN, 'GET', 'api/boot');
  assert.equal(a.data.view.me.role, 'admin');
  assert.equal(a.data.view.me.builtin, true);
  assert.equal(a.data.view.settings.name, 'Pick Timer');
  const t = await as('aditi.rao@nobroker.in', 'GET', 'api/boot');
  assert.equal(t.data.view.me.role, 'trainer');
  assert.equal(t.data.view.me.name, 'Aditi Rao');
  const m = await as('priya.nair@nobroker.in', 'GET', 'api/boot');
  assert.equal(m.data.noAccess, true);
  assert.equal((await op('priya.nair@nobroker.in', 'analytics', {})).status, 403);
  assert.equal(pt.hasAccess(Object.assign({ email: 'priya.nair@nobroker.in' }, PEOPLE['priya.nair@nobroker.in'])), false, 'no top-bar button for her');
  assert.equal(pt.hasAccess(Object.assign({ email: 'aditi.rao@nobroker.in' }, PEOPLE['aditi.rao@nobroker.in'])), true);
});

test('a trainer books a KC, a PIA member added by the admin assigns it', async () => {
  const kc = await op(ADMIN, 'saveKc', { name: 'Legal Services', type: 'Objective' });
  assert.equal(kc.status, 200, JSON.stringify(kc.data));
  const add = await op(ADMIN, 'saveUser', { name: 'Rahul', email: 'rahul.pia@nobroker.in', role: 'pia' });
  assert.equal(add.status, 200);
  const date = nextWorkday(3);
  const book = await op('aditi.rao@nobroker.in', 'book', { date, hour: 11, mode: 'Online', requestedKcId: kc.data.result.kcId, category: 'New Hire', attempt: 1,
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
  const file = path.join(dir, 'backups', 'pt.db');
  pt.backup(file);
  assert.ok(fs.statSync(file).size > 0);
});

test.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });
