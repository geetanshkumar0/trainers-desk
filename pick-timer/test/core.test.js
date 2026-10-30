'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/core.js');

/* A fixed clock: Friday 30 Oct 2026, 09:00 IST, so every slot today is still ahead. */
const NOW = Date.parse('2026-10-30T09:00:00+05:30');
function world() {
  let n = 0; const sheet = {headers:[], rows:[]};
  const env = {now:() => NOW, uid:p => p + (++n), fetchSheet:async () => sheet, sendTestEmail:async () => {}};
  const S = C.newState();
  const U = (id, role) => (S.users.push({id, name:id, email:`${id}@nobroker.in`, role, active:true}), id);
  U('admin', 'admin'); U('t1', 'trainer'); U('t2', 'trainer'); U('pia', 'pia');
  S.kcs.push({id:'k1', name:'Legal Services', type:'Objective', active:true}, {id:'k2', name:'Home Loans', type:'Objective', active:true});
  S.settings.piaEmail = 'pia.team@nobroker.in';
  const run = (me, op, p) => C.run(S, env, me, op, p);
  return {S, env, run, sheet};
}
const people = (n, start = 1) => Array.from({length:n}, (_, i) => ({empId:`NB${start + i}`, name:`Person ${start + i}`, email:`p${start + i}@nobroker.in`}));
const booking = (extra = {}) => ({date:'2026-10-31', hour:11, mode:'Online', requestedKcId:'k1', category:'New Hire', attempt:1, attendees:people(3), ...extra});
const rejects = (p, re) => assert.rejects(p, e => (re.test(e.message) ? true : assert.fail(`"${e.message}" does not match ${re}`)));

test('8 Online and 8 Offline seats per slot, counted separately', async () => {
  const {run} = world();
  await run('t1', 'book', booking({attendees:people(8)}));
  await rejects(run('t2', 'book', booking({attendees:people(1, 50)})), /Online seats in this slot are full/);
  await run('t2', 'book', booking({mode:'Offline', attendees:people(8, 50)}));
  await rejects(run('t1', 'book', booking({hour:12, attendees:people(9, 80)})), /at most 8/);
});
test('a partly full slot says how many seats are left', async () => {
  const {run} = world();
  await run('t1', 'book', booking({attendees:people(6)}));
  await rejects(run('t2', 'book', booking({attendees:people(3, 20)})), /Only 2 Online seats left/);
});
test('Sundays, past slots, odd hours and closed slots are refused', async () => {
  const {run} = world();
  await rejects(run('t1', 'book', booking({date:'2026-11-01'})), /Sundays are closed/);
  await rejects(run('t1', 'book', booking({date:'2026-10-29'})), /already started/);
  await rejects(run('t1', 'book', booking({hour:17})), /between 10 AM and 5 PM/);
  await run('admin', 'setSlotRule', {date:'2026-10-31', hour:11, closed:true, note:'Audit'});
  await rejects(run('t1', 'book', booking()), /closed \(Audit\)/);
  await run('admin', 'setSlotRule', {date:'2026-11-02', hour:null, closed:true, note:'Holiday'});
  await rejects(run('t1', 'book', booking({date:'2026-11-02', hour:15})), /closed \(Holiday\)/);
});
test('booking emails each attendee, the trainer and the PIA team', async () => {
  const {S, run} = world();
  await run('t1', 'book', booking());
  const to = S.emailLog.map(m => m.to).sort();
  assert.deepEqual(to, ['p1@nobroker.in', 'p2@nobroker.in', 'p3@nobroker.in', 'pia.team@nobroker.in', 't1@nobroker.in']);
  assert.ok(S.emailLog.every(m => m.status === 'queued' && /KC scheduled/.test(m.subject)));
});
test('the same Emp ID cannot be booked twice for the same KC while open', async () => {
  const {run} = world();
  await run('t1', 'book', booking());
  await rejects(run('t2', 'book', booking({hour:14, attendees:people(1, 2)})), /NB2 is already booked for Legal Services/);
  await run('t2', 'book', booking({hour:14, requestedKcId:'k2', attendees:people(1, 2)})); // another KC is fine
});
test('attempt 3 waits for the administrator and holds no seats until approved', async () => {
  const {S, run} = world();
  const {sessionId, status} = await run('t1', 'book', booking({attempt:3, attendees:people(2)}));
  assert.equal(status, 'pending');
  assert.equal(C.slotInfo(S, '2026-10-31', 11).used.Online, 0);
  assert.ok(S.emailLog.some(m => m.to === 'admin@nobroker.in' && /needs approval/.test(m.subject)));
  await rejects(run('t1', 'decideApproval', {approvalId:S.approvals[0].id, approve:true}), /Only the administrator/);
  await run('t2', 'book', booking({attendees:people(7, 30)}));
  await rejects(run('admin', 'decideApproval', {approvalId:S.approvals[0].id, approve:true}), /Only 1 Online seat left/);
  await run('admin', 'decideApproval', {approvalId:S.approvals[0].id, approve:true, hour:12});
  const s = S.sessions.find(x => x.id === sessionId);
  assert.equal(s.status, 'booked'); assert.equal(s.hour, 12);
});
test('admin can pre-book for a trainer, including attempt 3 without approval', async () => {
  const {S, run} = world();
  const r = await run('admin', 'book', booking({trainerId:'t2', attempt:3}));
  assert.equal(r.status, 'booked'); assert.equal(S.sessions[0].trainerId, 't2');
});
test('trainers change only their own bookings, and only until PIA assigns', async () => {
  const {S, run} = world();
  const {sessionId} = await run('t1', 'book', booking());
  await rejects(run('t2', 'cancelBooking', {sessionId}), /your own bookings/);
  await run('t1', 'updateBooking', {...booking({hour:13, attendees:people(4)}), sessionId});
  assert.equal(S.attendees.filter(a => a.sessionId === sessionId).length, 4);
  await rejects(run('t1', 'assignKc', {sessionId, kcId:'k2'}), /Only the PIA team/);
  await run('pia', 'assignKc', {sessionId, kcId:'k2'});
  const s = S.sessions[0];
  assert.equal(s.assignedKcId, 'k2'); assert.equal(s.invigilatorId, 'pia'); assert.equal(s.status, 'assigned');
  await rejects(run('t1', 'cancelBooking', {sessionId}), /already assigned/);
});
test('cancelling frees the seats', async () => {
  const {S, run} = world();
  const {sessionId} = await run('t1', 'book', booking({attendees:people(8)}));
  await run('t1', 'cancelBooking', {sessionId, reason:'Batch moved'});
  assert.equal(C.slotInfo(S, '2026-10-31', 11).used.Online, 0);
  assert.ok(S.emailLog.some(m => /KC cancelled/.test(m.subject) && /Batch moved/.test(m.text)));
});

const HEAD = ['Month', 'Invigilator', 'Mode of KC', 'KC Type', "Trainer's Name", 'Category', 'Emp ID', 'Email ID', 'Name', 'Team', 'Sub Team/KC Name', 'Date of KC', 'Attempt', 'Score', 'Obtained Percentage', 'Passing percentage'];
const row = (empId, date, attempt, obtained, passing = '80%', kc = 'Home Loans') => ['Oct-26', 'pia', 'Online', 'Objective', 't1', 'New Hire', empId, '', '', kc, kc, date, attempt, '18', obtained, passing];

test('the score sheet is read by header names, in any column order', async () => {
  const {S, env} = world();
  const order = [...HEAD].reverse();
  const r = row('NB1', '31/10/2026', '1', '85%');
  const log = C.applySheet(S, env, null, {headers:order, rows:[[...r].reverse()]});
  assert.equal(log.added, 1);
  assert.deepEqual({emp:S.results[0].empId, date:S.results[0].date, ob:S.results[0].obtained, pass:S.results[0].pass}, {emp:'NB1', date:'2026-10-31', ob:85, pass:true});
});
test('a renamed required header stops the sync and names the column', () => {
  const {S, env} = world();
  assert.throws(() => C.applySheet(S, env, null, {headers:HEAD.map(x => x === 'Date of KC' ? 'When' : x === 'Obtained Percentage' ? 'Marks' : x), rows:[]}), /Missing columns in the score sheet: Date of KC, Obtained Percentage/);
  assert.match(S.syncLog[0].error, /Missing columns/);
});
test('dates, percentages and attempts in the usual sheet formats', () => {
  for (const [v, want] of [['2026-10-31', '2026-10-31'], ['31/10/2026', '2026-10-31'], ['31-10-2026', '2026-10-31'], ['31-Oct-2026', '2026-10-31'], ['31 October 2026', '2026-10-31'], ['Oct 31, 2026', '2026-10-31'], ['31/13/2026', null], ['soon', null]])
    assert.equal(C.parseSheetDate(v), want, v);
  for (const [v, want] of [['85%', 85], ['85.5 %', 85.5], ['0.85', 85], ['85', 85], ['1', 1], ['', null]]) assert.equal(C.parsePercent(v), want, v);
});
test('sheet sync updates in place, removes deleted rows and lists skipped rows', () => {
  const {S, env} = world();
  C.applySheet(S, env, null, {headers:HEAD, rows:[row('NB1', '2026-10-31', '1', '70%'), row('NB2', '2026-10-31', '1', '90%')]});
  const id = S.results.find(r => r.empId === 'NB1').id;
  const log = C.applySheet(S, env, null, {headers:HEAD, rows:[row('NB1', '2026-10-31', 'Attempt 1', '82%'), row('', '2026-10-31', '1', '90%'), row('NB3', 'tomorrow', '1', '90%'), {row:9, cells:row('NB4', '2026-10-31', '1', '')}]});
  assert.equal(log.updated, 1); assert.equal(log.removed, 1);
  assert.deepEqual(log.skipped.map(x => x.reason), ['No Emp ID', 'Date of KC "tomorrow" is not a date', 'No Obtained Percentage']);
  assert.equal(log.skipped[2].row, 9);
  const r = S.results.find(x => x.empId === 'NB1'); assert.equal(r.id, id); assert.equal(r.obtained, 82); assert.equal(r.pass, true);
});
test('close-out: every attendee marked, scores found for the completed ones, then submit', async () => {
  const {S, run, sheet} = world();
  const {sessionId} = await run('t1', 'book', booking({attendees:people(3)}));
  await run('pia', 'assignKc', {sessionId, kcId:'k2'});
  const [a, b, c] = S.attendees;
  await rejects(run('pia', 'submitSession', {sessionId}), /Mark every attendee first/);
  await rejects(run('pia', 'markAttendees', {sessionId, marks:[{attendeeId:c.id, completion:'not_completed'}]}), /Choose a reason/);
  await run('pia', 'markAttendees', {sessionId, marks:[{attendeeId:a.id, completion:'completed'}, {attendeeId:b.id, completion:'completed'}, {attendeeId:c.id, completion:'not_completed', reason:'Absent'}]});
  Object.assign(sheet, {headers:HEAD, rows:[row('NB1', '31-Oct-2026', '1', '85%'), row('nb2 ', '2026-10-31', '1', '60%', '80%', 'Legal Services')]});
  const r = await run('pia', 'pullScores', {sessionId});
  assert.equal(r.matched, 2);
  const v = C.view(S, 'pia', NOW).sessions[0];
  assert.equal(v.attendees[1].result.kcMismatch, true, 'sheet KC differs from the assigned KC');
  await run('pia', 'submitSession', {sessionId});
  assert.equal(S.sessions[0].status, 'submitted');
  await rejects(run('pia', 'markAttendees', {sessionId, marks:[]}), /already been submitted/);
  const an = await run('pia', 'analytics', {from:'2026-10-31', to:'2026-10-31'});
  assert.deepEqual({...an.totals, passRate:undefined}, {assigned:1, attendees:3, completed:2, notCompleted:1, pending:0, pass:1, fail:1, passRate:undefined});
  assert.equal(an.kcs[0].kc, 'Home Loans');
});
test('submit is refused while a completed attendee has no score in the sheet', async () => {
  const {S, run} = world();
  const {sessionId} = await run('t1', 'book', booking({attendees:people(1)}));
  await run('pia', 'assignKc', {sessionId, kcId:'k1'});
  await run('pia', 'markAttendees', {sessionId, marks:[{attendeeId:S.attendees[0].id, completion:'completed'}]});
  await rejects(run('pia', 'submitSession', {sessionId}), /No score in the sheet yet for: Person 1 \(NB1\)/);
});
test('slot capacity cannot drop below seats already booked', async () => {
  const {run} = world();
  await run('t1', 'book', booking({attendees:people(5)}));
  await rejects(run('admin', 'setSlotRule', {date:'2026-10-31', hour:11, capOnline:4}), /5 Online seats are already booked/);
  await run('admin', 'setSlotRule', {date:'2026-10-31', hour:11, capOnline:10});
  await run('t2', 'book', booking({attendees:people(5, 40)}));
});
test('what each role can see', async () => {
  const {S, run} = world();
  await run('t1', 'book', booking()); await run('t2', 'book', booking({hour:12, attendees:people(2, 10)}));
  S.settings.smtp.pass = 'app-pass'; S.settings.sso.clientSecret = 'sso-secret'; S.settings.sheet.key = 'k3y';
  assert.equal(C.view(S, 't1', NOW).sessions.length, 1);
  assert.equal(C.view(S, 'pia', NOW).sessions.length, 2);
  const admin = JSON.stringify(C.view(S, 'admin', NOW));
  for (const secret of ['app-pass', 'sso-secret', 'k3y']) assert.ok(!admin.includes(secret), secret);
  assert.equal(C.view(S, 't1', NOW).settings.smtp, undefined);
  assert.equal(C.view(S, 't1', NOW).users[0].email, undefined);
});
test('the built-in administrator cannot be demoted or deactivated', async () => {
  const {S, run} = world();
  S.users[0].builtin = true;
  await rejects(run('admin', 'saveUser', {id:'admin', name:'x', email:'admin@nobroker.in', role:'pia'}), /built-in administrator/);
  await run('admin', 'saveUser', {name:'New PIA', email:'New.Pia@NoBroker.in', role:'pia'});
  assert.ok(S.users.some(u => u.email === 'new.pia@nobroker.in' && u.role === 'pia'));
  await rejects(run('admin', 'saveUser', {name:'Dup', email:'new.pia@nobroker.in', role:'trainer'}), /already has this email/);
});
test('demo data and demo sheet line up', async () => {
  const {S, env} = world();
  C.seedDemo(S, env, 'geetansh.kumar@nobroker.in');
  const log = C.applySheet(S, env, null, C.demoSheet(S, NOW));
  assert.equal(log.skipped.length, 0); assert.ok(log.added > 20);
  const an = C.ops.analytics(S, env, S.users.find(u => u.role === 'admin'), {from:'2026-10-01', to:'2026-10-30'});
  assert.equal(an.totals.completed, an.totals.pass + an.totals.fail);
});
