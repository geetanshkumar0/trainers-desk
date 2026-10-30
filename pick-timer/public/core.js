/*
 * KC Pick Timer: shared business rules.
 * The same file runs on the server (Node.js) and in the browser-only preview, so every rule
 * (slots, seats, approvals, close-out, score matching, analytics) is enforced in one place.
 * State is a plain object; the server persists it to SQLite after each operation.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HOURS = [10, 11, 12, 13, 14, 15, 16];          // slot start hours, IST
  const DEFAULT_CAP = 8;                               // seats per mode per slot
  const MODES = ['Online', 'Offline'];
  const CATEGORIES = ['New Hire', 'Lateral'];
  const KC_TYPES = ['Objective', 'Subjective'];
  const ROLES = ['trainer', 'pia', 'admin'];
  const REASONS = ['Absent', 'Technical issue', 'Other'];
  const SEATED = ['booked', 'assigned', 'submitted'];  // statuses that hold seats
  const OPEN = ['pending', 'booked', 'assigned'];      // statuses that block a duplicate booking
  const IST = 19800000;                                // +05:30 in ms
  const DAY = 864e5;

  class OpError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
  const need = (c, msg, status = 400) => { if (!c) throw new OpError(msg, status); };

  /* ---------- dates and slots (all wall-clock IST) ---------- */
  const pad = n => String(n).padStart(2, '0');
  const istDate = ms => new Date(ms + IST).toISOString().slice(0, 10);
  const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
  const weekday = date => new Date(date + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
  const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d)) && !isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
  const slotStart = (date, hour) => Date.parse(`${date}T${pad(hour)}:00:00+05:30`);
  const hourLabel = h => (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
  const slotLabel = h => `${hourLabel(h)} – ${hourLabel(h + 1)}`;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dateLabel = d => `${DOW[weekday(d)]} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

  /* ---------- small helpers ---------- */
  const norm = s => String(s == null ? '' : s).trim().toLowerCase();
  const emailOk = s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim());
  const byId = (list, id) => list.find(x => x.id === id);
  const str = (v, label, max = 200, required = true) => {
    const s = String(v == null ? '' : v).trim();
    need(!required || s, `${label} is required.`); need(s.length <= max, `${label} is too long (max ${max} characters).`);
    return s;
  };

  function newState() {
    return {users:[], kcs:[], slotRules:[], sessions:[], attendees:[], approvals:[], results:[], syncLog:[], emailLog:[],
      settings:{id:'site', name:'KC Pick Timer', siteUrl:'', piaEmail:'',
        smtp:{enabled:false, host:'', port:587, secure:false, user:'', pass:'', from:''},
        sso:{enabled:false, issuer:'https://accounts.google.com', clientId:'', clientSecret:'', label:'Sign in with Google'},
        sheet:{sheetId:'', tab:'', url:'', key:''}, lastSync:null}};
  }

  /* ---------- people ---------- */
  const userName = (S, id) => byId(S.users, id)?.name || 'Former user';
  const isAdmin = u => u?.role === 'admin';
  const isPia = u => u?.role === 'pia' || u?.role === 'admin';
  const kcName = (S, id) => byId(S.kcs, id)?.name || '';

  /* ---------- seats ---------- */
  function slotInfo(S, date, hour) {
    const dayRule = S.slotRules.find(r => r.date === date && r.hour == null);
    const rule = S.slotRules.find(r => r.date === date && r.hour === hour);
    const sunday = weekday(date) === 0;
    const closed = sunday || !!dayRule?.closed || !!rule?.closed;
    const cap = {Online:rule?.capOnline ?? DEFAULT_CAP, Offline:rule?.capOffline ?? DEFAULT_CAP};
    const used = {Online:0, Offline:0};
    for (const s of S.sessions) if (s.date === date && s.hour === hour && SEATED.includes(s.status)) used[s.mode] += S.attendees.filter(a => a.sessionId === s.id).length;
    return {date, hour, closed, reason:sunday ? 'Sunday' : dayRule?.closed ? (dayRule.note || 'Closed') : rule?.closed ? (rule.note || 'Closed') : '', cap, used};
  }
  function availability(S, from, days) {
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(from, i); if (weekday(d) === 0) continue;
      for (const h of HOURS) out.push(slotInfo(S, d, h));
    }
    return out;
  }

  /* ---------- email (queued; the server delivers, the preview only logs) ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  function queueMail(S, env, to, subject, lines, table) {
    to = String(to || '').trim(); if (!emailOk(to)) return;
    const text = lines.join('\n') + (table ? '\n\n' + table.map(r => r.join('  |  ')).join('\n') : '') + `\n\n— ${S.settings.name}`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #eee;border-radius:8px;overflow:hidden">
<div style="background:#FB3753;color:#fff;padding:16px 20px;font-size:18px;font-weight:bold">${esc(subject)}</div>
<div style="padding:16px 20px;color:#222;font-size:14px;line-height:1.5">${lines.map(l => `<p style="margin:0 0 8px">${esc(l)}</p>`).join('')}
${table ? `<table style="border-collapse:collapse;width:100%;font-size:13px;margin-top:8px">${table.map((r, i) => `<tr>${r.map(c => `<${i ? 'td' : 'th'} style="border:1px solid #ddd;padding:6px;text-align:left${i ? '' : ';background:#f6f6f6'}">${esc(c)}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</table>` : ''}</div>
<div style="padding:10px 20px;background:#fafafa;color:#888;font-size:12px">${esc(S.settings.name)}</div></div>`;
    S.emailLog.push({id:env.uid('m'), to, subject, text, html, status:'queued', at:env.now(), error:''});
    if (S.emailLog.length > 3000) S.emailLog.splice(0, S.emailLog.length - 3000);
  }
  function sessionLines(S, s) {
    return [`KC: ${kcName(S, s.assignedKcId || s.requestedKcId)}`, `Date: ${dateLabel(s.date)}`, `Time: ${slotLabel(s.hour)} IST`, `Mode: ${s.mode}`, `Attempt: ${s.attempt} · ${s.category}`, `Trainer: ${userName(S, s.trainerId)}`];
  }
  function mailSession(S, env, s, kind, extra) {
    const atts = S.attendees.filter(a => a.sessionId === s.id);
    const title = {booked:'KC scheduled', changed:'KC schedule changed', cancelled:'KC cancelled'}[kind];
    const subject = `${title}: ${kcName(S, s.requestedKcId)} · ${dateLabel(s.date)}, ${hourLabel(s.hour)}`;
    for (const a of atts) queueMail(S, env, a.email, subject, [`Hi ${a.name},`, kind === 'cancelled' ? 'Your Knowledge Check below has been cancelled.' : kind === 'changed' ? 'The details of your Knowledge Check have changed. The latest schedule is:' : 'Your Knowledge Check has been scheduled:', ...sessionLines(S, s), ...(extra ? [extra] : [])]);
    const table = [['Emp ID', 'Name', 'Email'], ...atts.map(a => [a.empId, a.name, a.email])];
    const tr = byId(S.users, s.trainerId);
    const body = [`${title} for ${atts.length} attendee${atts.length === 1 ? '' : 's'}.`, ...sessionLines(S, s), ...(extra ? [extra] : [])];
    if (tr) queueMail(S, env, tr.email, subject, body, table);
    if (S.settings.piaEmail) queueMail(S, env, S.settings.piaEmail, subject, body, table);
  }

  /* ---------- booking ---------- */
  function cleanAttendees(list) {
    need(Array.isArray(list) && list.length, 'Add at least one attendee.');
    need(list.length <= DEFAULT_CAP, `A booking can have at most ${DEFAULT_CAP} attendees.`);
    const seen = new Set();
    return list.map((a, i) => {
      const n = i + 1;
      const empId = str(a.empId, `Emp ID (row ${n})`, 40), name = str(a.name, `Name (row ${n})`, 120), email = str(a.email, `Email (row ${n})`, 200);
      need(emailOk(email), `Email in row ${n} is not a valid address.`);
      need(!seen.has(norm(empId)), `Emp ID ${empId} is listed twice.`); seen.add(norm(empId));
      return {empId, name, email};
    });
  }
  function checkSlot(S, env, date, hour, mode, seats, excludeId, isAdminUser) {
    need(validDate(date), 'Choose a valid date.');
    need(HOURS.includes(hour), 'Choose a slot between 10 AM and 5 PM.');
    need(MODES.includes(mode), 'Choose Online or Offline.');
    need(weekday(date) !== 0, 'Sundays are closed.');
    need(slotStart(date, hour) > env.now(), 'That slot has already started. Choose a later slot.');
    const info = slotInfo(S, date, hour);
    need(!info.closed, `That slot is closed (${info.reason}).`);
    if (seats != null) {
      let used = info.used[mode];
      if (excludeId) { const ex = byId(S.sessions, excludeId); if (ex && SEATED.includes(ex.status) && ex.date === date && ex.hour === hour && ex.mode === mode) used -= S.attendees.filter(a => a.sessionId === ex.id).length; }
      const left = info.cap[mode] - used;
      need(seats <= left, left <= 0 ? `${mode} seats in this slot are full.` : `Only ${left} ${mode} seat${left === 1 ? '' : 's'} left in this slot.`, 409);
    }
  }
  function checkDuplicates(S, attendees, kcId, excludeId) {
    for (const a of attendees) {
      const clash = S.attendees.find(x => norm(x.empId) === norm(a.empId) && x.sessionId !== excludeId && (() => { const s = byId(S.sessions, x.sessionId); return s && OPEN.includes(s.status) && (s.requestedKcId === kcId || s.assignedKcId === kcId); })());
      if (clash) { const s = byId(S.sessions, clash.sessionId); throw new OpError(`Emp ID ${a.empId} is already booked for ${kcName(S, kcId)} on ${dateLabel(s.date)}, ${hourLabel(s.hour)}.`, 409); }
    }
  }
  function readBooking(S, p) {
    const kc = byId(S.kcs, p.requestedKcId); need(kc && kc.active !== false, 'Choose the KC.');
    need(CATEGORIES.includes(p.category), 'Choose the category (New Hire or Lateral).');
    return {date:String(p.date || ''), hour:Number(p.hour), mode:p.mode, requestedKcId:kc.id, category:p.category, attendees:cleanAttendees(p.attendees)};
  }

  const ops = {};

  ops.book = (S, env, me, p) => {
    need(me.role === 'trainer' || isAdmin(me), 'Only trainers and the administrator can book slots.', 403);
    let trainerId = me.id;
    if (isAdmin(me) && p.trainerId) { const t = byId(S.users, p.trainerId); need(t && t.active !== false && (t.role === 'trainer' || t.role === 'admin'), 'Choose the trainer.'); trainerId = t.id; }
    const b = readBooking(S, p);
    const attempt = Number(p.attempt); need([1, 2, 3].includes(attempt), 'Choose attempt 1, 2 or 3.');
    const needsApproval = attempt === 3 && !isAdmin(me);
    checkSlot(S, env, b.date, b.hour, b.mode, needsApproval ? null : b.attendees.length, null, isAdmin(me));
    checkDuplicates(S, b.attendees, b.requestedKcId, null);
    const s = {id:env.uid('s'), date:b.date, hour:b.hour, mode:b.mode, trainerId, category:b.category, attempt, requestedKcId:b.requestedKcId, assignedKcId:null, invigilatorId:null,
      status:needsApproval ? 'pending' : 'booked', createdBy:me.id, createdAt:env.now(), assignedAt:null, submittedAt:null, submittedBy:null, note:String(p.note || '').slice(0, 500)};
    S.sessions.push(s);
    for (const a of b.attendees) S.attendees.push({id:env.uid('a'), sessionId:s.id, ...a, completion:null, reason:'', reasonNote:''});
    if (needsApproval) {
      const ap = {id:env.uid('ap'), sessionId:s.id, requestedBy:me.id, status:'pending', at:env.now(), decidedBy:null, decidedAt:null, note:''};
      S.approvals.push(ap);
      for (const u of S.users.filter(x => isAdmin(x) && x.active !== false)) queueMail(S, env, u.email, `Attempt-3 booking needs approval: ${kcName(S, s.requestedKcId)}`,
        [`${userName(S, me.id)} asked to book attempt 3 for ${b.attendees.length} attendee(s).`, ...sessionLines(S, s), 'Approve or reject it under Approvals.'], [['Emp ID', 'Name', 'Email'], ...b.attendees.map(a => [a.empId, a.name, a.email])]);
    } else mailSession(S, env, s, 'booked');
    return {sessionId:s.id, status:s.status};
  };

  function ownedEditable(S, me, sessionId) {
    const s = byId(S.sessions, sessionId); need(s, 'Booking not found.', 404);
    need(isAdmin(me) || (me.role === 'trainer' && s.trainerId === me.id), 'You can only change your own bookings.', 403);
    need(['pending', 'booked'].includes(s.status), 'This booking can no longer be changed because PIA has already assigned the KC.', 409);
    return s;
  }
  ops.updateBooking = (S, env, me, p) => {
    const s = ownedEditable(S, me, p.sessionId);
    const b = readBooking(S, p);
    checkSlot(S, env, b.date, b.hour, b.mode, s.status === 'pending' ? null : b.attendees.length, s.id, isAdmin(me));
    checkDuplicates(S, b.attendees, b.requestedKcId, s.id);
    Object.assign(s, {date:b.date, hour:b.hour, mode:b.mode, requestedKcId:b.requestedKcId, category:b.category, note:String(p.note ?? s.note).slice(0, 500)});
    const old = S.attendees.filter(a => a.sessionId === s.id);
    S.attendees = S.attendees.filter(a => a.sessionId !== s.id);
    for (const a of b.attendees) { const was = old.find(o => norm(o.empId) === norm(a.empId)); S.attendees.push({id:was?.id || env.uid('a'), sessionId:s.id, ...a, completion:null, reason:'', reasonNote:''}); }
    if (s.status === 'booked') mailSession(S, env, s, 'changed');
    return {sessionId:s.id};
  };
  ops.cancelBooking = (S, env, me, p) => {
    const s = ownedEditable(S, me, p.sessionId);
    const was = s.status; s.status = 'cancelled'; s.cancelledAt = env.now(); s.cancelledBy = me.id;
    for (const ap of S.approvals) if (ap.sessionId === s.id && ap.status === 'pending') Object.assign(ap, {status:'withdrawn', decidedAt:env.now(), decidedBy:me.id});
    if (was === 'booked') mailSession(S, env, s, 'cancelled', p.reason ? `Reason: ${String(p.reason).slice(0, 300)}` : '');
    return {};
  };

  ops.decideApproval = (S, env, me, p) => {
    need(isAdmin(me), 'Only the administrator can approve attempt-3 bookings.', 403);
    const ap = byId(S.approvals, p.approvalId); need(ap && ap.status === 'pending', 'This request has already been decided.', 409);
    const s = byId(S.sessions, ap.sessionId); need(s && s.status === 'pending', 'Booking not found.', 404);
    const note = String(p.note || '').slice(0, 300);
    if (p.approve) {
      const date = p.date || s.date, hour = p.hour != null ? Number(p.hour) : s.hour, mode = p.mode || s.mode;
      checkSlot(S, env, date, hour, mode, S.attendees.filter(a => a.sessionId === s.id).length, null, true);
      Object.assign(s, {date, hour, mode, status:'booked'});
      Object.assign(ap, {status:'approved', decidedBy:me.id, decidedAt:env.now(), note});
      const tr = byId(S.users, s.trainerId);
      if (tr) queueMail(S, env, tr.email, `Attempt-3 booking approved: ${kcName(S, s.requestedKcId)}`, ['Your attempt-3 booking was approved.', ...sessionLines(S, s), ...(note ? [`Note: ${note}`] : [])]);
      mailSession(S, env, s, 'booked');
    } else {
      s.status = 'rejected';
      Object.assign(ap, {status:'rejected', decidedBy:me.id, decidedAt:env.now(), note});
      const tr = byId(S.users, s.trainerId);
      if (tr) queueMail(S, env, tr.email, `Attempt-3 booking rejected: ${kcName(S, s.requestedKcId)}`, ['Your attempt-3 booking was not approved.', ...sessionLines(S, s), ...(note ? [`Reason: ${note}`] : [])]);
    }
    return {};
  };

  /* ---------- PIA: assign and close out ---------- */
  function piaSession(S, me, id, statuses) {
    need(isPia(me), 'Only the PIA team can do this.', 403);
    const s = byId(S.sessions, id); need(s, 'Session not found.', 404);
    need(statuses.includes(s.status), {booked:'Assign the KC first.', submitted:'This session has already been submitted.', cancelled:'This booking was cancelled.', pending:'This booking is waiting for approval.', rejected:'This booking was rejected.'}[s.status] || 'This session cannot be changed now.', 409);
    return s;
  }
  ops.assignKc = (S, env, me, p) => {
    const s = piaSession(S, me, p.sessionId, ['booked', 'assigned']);
    const kc = byId(S.kcs, p.kcId); need(kc && kc.active !== false, 'Choose the KC to assign.');
    Object.assign(s, {assignedKcId:kc.id, invigilatorId:me.id, status:'assigned', assignedAt:env.now()});
    return {};
  };
  ops.markAttendees = (S, env, me, p) => {
    const s = piaSession(S, me, p.sessionId, ['assigned']);
    for (const m of p.marks || []) {
      const a = S.attendees.find(x => x.id === m.attendeeId && x.sessionId === s.id); need(a, 'Attendee not found.', 404);
      need([null, 'completed', 'not_completed'].includes(m.completion ?? null), 'Choose Completed or Not completed.');
      a.completion = m.completion ?? null;
      if (a.completion === 'not_completed') {
        need(REASONS.includes(m.reason), `Choose a reason for ${a.name}.`);
        a.reason = m.reason; a.reasonNote = String(m.reasonNote || '').slice(0, 200);
        need(a.reason !== 'Other' || a.reasonNote.trim(), `Describe the reason for ${a.name}.`);
      } else { a.reason = ''; a.reasonNote = ''; }
    }
    return {};
  };
  ops.submitSession = (S, env, me, p) => {
    const s = piaSession(S, me, p.sessionId, ['assigned']);
    const atts = S.attendees.filter(a => a.sessionId === s.id);
    const unmarked = atts.filter(a => !a.completion);
    need(!unmarked.length, `Mark every attendee first: ${unmarked.map(a => a.name).join(', ')}.`);
    const missing = atts.filter(a => a.completion === 'completed' && !resultFor(S, s, a));
    need(!missing.length, `No row with their Emp ID and this attempt in the score sheet yet for: ${missing.map(a => `${a.name} (${a.empId})`).join(', ')}. Add them to the sheet, then pull scores again.`);
    Object.assign(s, {status:'submitted', submittedAt:env.now(), submittedBy:me.id});
    return {};
  };
  ops.reopenSession = (S, env, me, p) => {
    need(isAdmin(me), 'Only the administrator can reopen a submitted session.', 403);
    const s = byId(S.sessions, p.sessionId); need(s && s.status === 'submitted', 'Only submitted sessions can be reopened.', 409);
    Object.assign(s, {status:'assigned', submittedAt:null, submittedBy:null});
    return {};
  };

  /* ---------- score sheet ---------- */
  const H = s => norm(s).replace(/[^a-z0-9]/g, '');
  // PIA's KC Sheet has five columns: Date of KC, Emp ID, Attempt, Obtained Percentage, Status (Pass or Fail).
  // The others are read when a sheet has them, but are not needed.
  const SHEET_COLS = {date:'Date of KC', empId:'Emp ID', attempt:'Attempt', obtained:'Obtained Percentage', status:'Status',
    name:'Name', email:'Email ID', kcName:'Sub Team/KC Name', score:'Score', passing:'Passing percentage'};
  const REQUIRED = ['date', 'empId', 'attempt', 'obtained', 'status'];
  const ALIASES = {kcName:['subteamkcname', 'subteam', 'kcname'], obtained:['obtainedpercentage', 'obtained', 'obtainedpercent'], passing:['passingpercentage', 'passing', 'passingpercent', 'passpercentage'], empId:['empid', 'employeeid'], email:['emailid', 'email'], date:['dateofkc', 'kcdate'], status:['status', 'result', 'kcstatus']};
  function parseStatus(v) {
    const s = H(v);
    if (/^(pass|passed|cleared|clear|qualified)$/.test(s)) return true;
    if (/^(fail|failed|notcleared|notqualified)$/.test(s)) return false;
    return null;
  }
  function parseSheetDate(v) {
    const s = String(v || '').trim(); if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return mk(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); if (m) return mk(+m[3], +m[2], +m[1]); // day first (India)
    m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{4})$/); if (m) return mk(+m[3], mon(m[2]), +m[1]);
    m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/); if (m) return mk(+m[3], mon(m[1]), +m[2]);
    return null;
    function mon(x) { const i = MONTHS.findIndex(n => n.toLowerCase() === x.slice(0, 3).toLowerCase()); return i + 1; }
    function mk(y, mo, d) { if (!mo || mo > 12 || !d || d > 31) return null; const out = `${y}-${pad(mo)}-${pad(d)}`; return validDate(out) ? out : null; }
  }
  function parsePercent(v) {
    const s = String(v == null ? '' : v).trim().replace(/,/g, ''); if (!s) return null;
    const n = parseFloat(s.replace('%', '')); if (!isFinite(n)) return null;
    return s.includes('%') ? n : (n > 0 && n <= 1 && /\./.test(s) ? n * 100 : n);
  }
  function parseAttempt(v) { const m = String(v || '').match(/\d+/); return m ? Number(m[0]) : null; }
  const round = n => Math.round(n * 100) / 100;

  /* rows: [{row, cells:[...]}] or plain arrays; headers: [...] */
  function applySheet(S, env, me, data) {
    const headers = (data.headers || []).map(String);
    const idx = {};
    headers.forEach((h, i) => { const k = H(h); for (const [key, label] of Object.entries(SHEET_COLS)) if (idx[key] == null && (H(label) === k || (ALIASES[key] || []).includes(k))) idx[key] = i; });
    const missing = REQUIRED.filter(k => idx[k] == null).map(k => SHEET_COLS[k]);
    const log = {id:env.uid('sy'), at:env.now(), by:me ? me.id : null, rows:0, added:0, updated:0, removed:0, unchanged:0, skipped:[], error:''};
    if (missing.length) { log.error = `Missing column${missing.length > 1 ? 's' : ''} in the score sheet: ${missing.join(', ')}. Check the header names have not been renamed.`; pushLog(S, log); throw new OpError(log.error, 422); }
    const fresh = new Map();
    (data.rows || []).forEach((r, i) => {
      const cells = Array.isArray(r) ? r : r.cells, rowNo = Array.isArray(r) ? i + 2 : r.row;
      const get = k => idx[k] == null ? '' : String(cells[idx[k]] == null ? '' : cells[idx[k]]).trim();
      if (!cells.some(c => String(c == null ? '' : c).trim())) return;
      log.rows++;
      const skip = reason => log.skipped.push({row:rowNo, reason, empId:get('empId'), name:get('name')});
      const empId = get('empId'); if (!empId) return skip('No Emp ID');
      const date = parseSheetDate(get('date')); if (!date) return skip(`Date of KC "${get('date')}" is not a date`);
      const attempt = parseAttempt(get('attempt')); if (!attempt) return skip('No attempt number');
      const obtained = parsePercent(get('obtained')); if (obtained == null) return skip('No Obtained Percentage');
      const pass = parseStatus(get('status')); if (pass == null) return skip(get('status') ? `Status "${get('status')}" is not Pass or Fail` : 'No Status');
      const passing = parsePercent(get('passing')), kc = get('kcName');
      const key = `${norm(empId)}|${date}|${attempt}`;
      if (fresh.has(key)) log.skipped.push({row:fresh.get(key).row, reason:`Replaced by row ${rowNo} (same Emp ID, Date of KC and attempt)`, empId, name:get('name')});
      fresh.set(key, {key, row:rowNo, empId, name:get('name'), email:get('email'), kcName:kc, date, attempt, score:get('score'), obtained:round(obtained), passing:passing == null ? '' : round(passing), pass});
    });
    const old = new Map(S.results.map(r => [r.key, r]));
    const next = [];
    for (const [key, r] of fresh) {
      const o = old.get(key);
      if (!o) { log.added++; next.push({id:env.uid('r'), ...r, pulledAt:env.now()}); continue; }
      const changed = ['date', 'score', 'obtained', 'passing', 'pass', 'name', 'email', 'kcName', 'empId'].some(f => o[f] !== r[f]);
      if (changed) log.updated++; else log.unchanged++;
      next.push({...o, ...r, id:o.id, pulledAt:changed ? env.now() : o.pulledAt});
    }
    log.removed = [...old.keys()].filter(k => !fresh.has(k)).length;
    S.results = next;
    S.settings.lastSync = env.now();
    pushLog(S, log);
    return log;
  }
  function pushLog(S, log) { S.syncLog.push(log); if (S.syncLog.length > 300) S.syncLog.splice(0, S.syncLog.length - 300); }

  /* A score belongs to an attendee by Emp ID, for the same attempt as the booking (an older attempt's row is never
     used). Among those rows, the one dated closest to the KC is used (on or after the KC date first); the sheet's
     date is shown when it differs from the booking. */
  const empKey = v => norm(v).replace(/\s+/g, '');
  function resultFor(S, s, a) {
    const mine = S.results.filter(r => empKey(r.empId) === empKey(a.empId));
    const pool = mine.filter(r => r.attempt === s.attempt);   // a row for another attempt is never used
    if (!pool.length) return null;
    const gap = r => { const d = (Date.parse(r.date) - Date.parse(s.date)) / DAY; return d >= 0 ? d : 1000 - d; };
    const r = pool.slice().sort((x, y) => gap(x) - gap(y) || y.row - x.row)[0];
    const want = norm(kcName(S, s.assignedKcId || s.requestedKcId));
    return {...r, dateDiffers:r.date !== s.date, kcMismatch:!!r.kcName && norm(r.kcName) !== want};
  }

  ops.pullScores = async (S, env, me, p) => {
    need(isPia(me), 'Only the PIA team can pull scores.', 403);
    const s = p.sessionId ? byId(S.sessions, p.sessionId) : null;
    if (p.sessionId) need(s && ['assigned', 'submitted'].includes(s.status), 'Assign the KC before pulling scores.', 409);
    const data = await env.fetchSheet(S.settings.sheet);
    const log = applySheet(S, env, me, data);
    if (!s) return {log};
    const atts = S.attendees.filter(a => a.sessionId === s.id);
    return {log, matched:atts.filter(a => resultFor(S, s, a)).length, total:atts.length};
  };
  ops.testSheet = async (S, env, me) => {
    need(isAdmin(me), 'Only the administrator can do this.', 403);
    need(S.settings.sheet.sheetId || S.settings.sheet.url, 'Enter the score sheet link first.');
    const data = await env.fetchSheet(S.settings.sheet);
    const found = (data.headers || []).map(String);
    const missing = REQUIRED.filter(k => !found.some(h => H(h) === H(SHEET_COLS[k]) || (ALIASES[k] || []).includes(H(h)))).map(k => SHEET_COLS[k]);
    return {sheet:data.sheet || '', headers:found, rows:(data.rows || []).length, missing};
  };

  /* ---------- administrator ---------- */
  ops.setSlotRule = (S, env, me, p) => {
    need(isAdmin(me), 'Only the administrator can change slots.', 403);
    need(validDate(p.date), 'Choose a valid date.');
    const hour = p.hour == null || p.hour === '' ? null : Number(p.hour);
    need(hour == null || HOURS.includes(hour), 'Choose a valid slot.');
    let r = S.slotRules.find(x => x.date === p.date && x.hour === hour);
    if (!r) { r = {id:env.uid('sr'), date:p.date, hour}; S.slotRules.push(r); }
    r.closed = !!p.closed; r.note = String(p.note || '').slice(0, 100);
    if (hour != null) {
      const info = slotInfo(S, p.date, hour);
      for (const m of MODES) {
        const key = m === 'Online' ? 'capOnline' : 'capOffline';
        if (p[key] == null || p[key] === '') { delete r[key]; continue; }
        const c = Number(p[key]); need(Number.isInteger(c) && c >= 0 && c <= 50, `${m} capacity must be a whole number from 0 to 50.`);
        need(c >= info.used[m], `${info.used[m]} ${m} seats are already booked in this slot, so capacity can't go below ${info.used[m]}.`, 409);
        r[key] = c === DEFAULT_CAP ? undefined : c; if (r[key] === undefined) delete r[key];
      }
    }
    if (!r.closed && r.capOnline == null && r.capOffline == null) S.slotRules = S.slotRules.filter(x => x !== r);
    return {};
  };
  ops.saveUser = (S, env, me, p) => {
    need(isAdmin(me), 'Only the administrator can manage users.', 403);
    const email = str(p.email, 'Email', 200).toLowerCase(); need(emailOk(email), 'Enter a valid email address.');
    const name = str(p.name, 'Name', 120);
    need(ROLES.includes(p.role), 'Choose a role.');
    need(!S.users.some(u => u.email === email && u.id !== p.id), 'Another user already has this email.', 409);
    let u = p.id ? byId(S.users, p.id) : null;
    if (p.id) need(u, 'User not found.', 404);
    if (u?.builtin) { need(p.role === 'admin' && p.active !== false && email === u.email, 'This is the built-in administrator set in server/site-admins.js; its email, role and access cannot be changed here.', 400); u.name = name; return {userId:u.id}; }
    if (!u) { u = {id:env.uid('u'), createdAt:env.now()}; S.users.push(u); }
    Object.assign(u, {name, email, role:p.role, active:p.active !== false});
    return {userId:u.id};
  };
  ops.saveKc = (S, env, me, p) => {
    need(isAdmin(me), 'Only the administrator can manage the KC list.', 403);
    const name = str(p.name, 'KC name', 150); need(KC_TYPES.includes(p.type), 'Choose Objective or Subjective.');
    const same = x => norm(x).replace(/\s+/g, ' ');
    need(!S.kcs.some(k => same(k.name) === same(name) && k.id !== p.id), 'A KC with this name already exists.', 409);
    let k = p.id ? byId(S.kcs, p.id) : null; if (p.id) need(k, 'KC not found.', 404);
    if (!k) { k = {id:env.uid('k')}; S.kcs.push(k); }
    Object.assign(k, {name, type:p.type, active:p.active !== false});
    return {kcId:k.id};
  };
  ops.saveSettings = (S, env, me, p) => {
    need(isAdmin(me), 'Only the administrator can change settings.', 403);
    const st = S.settings, v = p.values || {};
    if (p.section === 'general') {
      st.name = str(v.name, 'Site name', 80); st.siteUrl = String(v.siteUrl || '').trim().replace(/\/+$/, '');
      need(!st.siteUrl || /^https?:\/\//.test(st.siteUrl), 'The site address must start with https://');
      st.piaEmail = String(v.piaEmail || '').trim(); need(!st.piaEmail || emailOk(st.piaEmail), 'Enter a valid PIA team email address.');
    } else if (p.section === 'smtp') {
      const port = Number(v.port || 587); need(Number.isInteger(port) && port > 0 && port < 65536, 'Enter a valid port.');
      if (v.enabled) { need(String(v.host || '').trim(), 'Enter the mail server.'); need(emailOk(String(v.from || '').replace(/^.*</, '').replace(/>.*$/, '')), 'Enter the From address.'); }
      Object.assign(st.smtp, {enabled:!!v.enabled, host:String(v.host || '').trim(), port, secure:!!v.secure, user:String(v.user || '').trim(), from:String(v.from || '').trim()});
      if (v.pass) st.smtp.pass = String(v.pass).replace(/\s+/g, ''); // Google app passwords are shown with spaces
      if (v.clearPass) st.smtp.pass = '';
    } else if (p.section === 'sso') {
      if (v.enabled) { need(/^https:\/\//.test(String(v.issuer || '')), 'The issuer URL must start with https://'); need(String(v.clientId || '').trim(), 'Enter the client ID.'); need(v.clientSecret || st.sso.clientSecret, 'Enter the client secret.'); }
      Object.assign(st.sso, {enabled:!!v.enabled, issuer:String(v.issuer || '').trim().replace(/\/+$/, ''), clientId:String(v.clientId || '').trim(), label:String(v.label || 'Sign in with Google').trim().slice(0, 60)});
      if (v.clientSecret) st.sso.clientSecret = String(v.clientSecret).trim();
    } else if (p.section === 'sheet') {
      // A Google Sheet read through Trainer Desk's Google account (sheet link or ID + tab), or an Apps Script web app.
      const link = String(v.sheetId || '').trim(), m = link.match(/\/d\/([a-zA-Z0-9_-]{20,})/), sid = m ? m[1] : link;
      need(!sid || /^[a-zA-Z0-9_-]{20,}$/.test(sid), 'Paste the score sheet link (it contains /d/…/edit) or its ID.');
      st.sheet.sheetId = sid; st.sheet.tab = String(v.tab || '').trim().slice(0, 100);
      need(!sid || st.sheet.tab, 'Enter the tab name, for example KC Sheet.');
      const url = String(v.url || '').trim(); need(!url || /^https:\/\/script\.google(usercontent)?\.com\//.test(url), 'Paste the Apps Script web app URL (it starts with https://script.google.com/).');
      st.sheet.url = url; if (v.key) st.sheet.key = String(v.key).trim();
      need(!url || st.sheet.key, 'Enter the secret key that is in the Apps Script.');
    } else throw new OpError('Unknown settings section.');
    return {};
  };
  ops.testEmail = async (S, env, me, p) => {
    need(isAdmin(me), 'Only the administrator can do this.', 403);
    const to = String(p.to || me.email).trim(); need(emailOk(to), 'Enter an address to send the test to.');
    need(S.settings.smtp.host, 'Enter the mail server first.');
    await env.sendTestEmail(S.settings.smtp, to);
    return {to};
  };

  /* ---------- analytics ---------- */
  ops.analytics = (S, env, me, p) => {
    const today = istDate(env.now());
    const from = validDate(p.from) ? p.from : today, to = validDate(p.to) ? p.to : from;
    need(from <= to, 'The start date must be on or before the end date.');
    const f = p.filters || {};
    const trainerId = me.role === 'trainer' ? me.id : f.trainerId;
    const sessions = S.sessions.filter(s => ['assigned', 'submitted'].includes(s.status) && s.date >= from && s.date <= to
      && (!trainerId || s.trainerId === trainerId) && (!f.mode || s.mode === f.mode) && (!f.category || s.category === f.category)
      && (!f.invigilatorId || s.invigilatorId === f.invigilatorId) && (!f.kcId || s.assignedKcId === f.kcId) && (!f.attempt || s.attempt === Number(f.attempt))
      && (!f.kcType || byId(S.kcs, s.assignedKcId)?.type === f.kcType));
    const blank = () => ({assigned:0, attendees:0, completed:0, notCompleted:0, pending:0, pass:0, fail:0});
    const totals = blank(), days = new Map(), kcs = new Map(), detail = [];
    for (const s of sessions) {
      const d = days.get(s.date) || {date:s.date, ...blank()}; days.set(s.date, d);
      const k = kcs.get(s.assignedKcId) || {kcId:s.assignedKcId, kc:kcName(S, s.assignedKcId), type:byId(S.kcs, s.assignedKcId)?.type || '', sessions:0, ...blank()}; kcs.set(s.assignedKcId, k);
      for (const x of [totals, d]) x.assigned++; k.sessions++;
      for (const a of S.attendees.filter(x => x.sessionId === s.id)) {
        for (const x of [totals, d, k]) x.attendees++;
        const r = s.status === 'submitted' && a.completion === 'completed' ? resultFor(S, s, a) : null;
        if (s.status !== 'submitted') for (const x of [totals, d, k]) x.pending++;
        else if (a.completion === 'completed') { for (const x of [totals, d, k]) x.completed++; if (r) for (const x of [totals, d, k]) x[r.pass ? 'pass' : 'fail']++; }
        else for (const x of [totals, d, k]) x.notCompleted++;
        detail.push({date:s.date, slot:slotLabel(s.hour), mode:s.mode, kc:kcName(S, s.assignedKcId), kcType:byId(S.kcs, s.assignedKcId)?.type || '', category:s.category, attempt:s.attempt,
          trainer:userName(S, s.trainerId), invigilator:userName(S, s.invigilatorId), empId:a.empId, name:a.name, email:a.email,
          status:s.status !== 'submitted' ? 'Not submitted yet' : a.completion === 'completed' ? 'Completed' : `Not completed (${a.reason})`,
          score:r ? r.score : '', obtained:r ? r.obtained : '', passing:r ? r.passing : '', result:r ? (r.pass ? 'Pass' : 'Fail') : ''});
      }
    }
    const rate = x => x.pass + x.fail ? Math.round(x.pass / (x.pass + x.fail) * 1000) / 10 : null;
    return {from, to, totals:{...totals, passRate:rate(totals)}, days:[...days.values()].sort((a, b) => a.date < b.date ? -1 : 1),
      kcs:[...kcs.values()].map(k => ({...k, passRate:rate(k)})).sort((a, b) => b.attendees - a.attendees), detail:detail.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0)};
  };

  /* ---------- running an operation ---------- */
  /* An administrator can switch to another role to use Pick Timer as a PIA or a trainer would. Only the
     administrator's own role changes, for their own requests; everyone else's access is untouched. */
  function actingAs(S, meId, asRole) {
    const me = byId(S.users, meId); if (!me) return null;
    return me.role === 'admin' && ROLES.includes(asRole) && asRole !== 'admin' ? {...me, role:asRole, realRole:'admin'} : me;
  }
  async function run(S, env, meId, name, params, asRole) {
    const me = actingAs(S, meId, asRole); need(me && me.active !== false, 'Please sign in again.', 401);
    need(Object.prototype.hasOwnProperty.call(ops, name), 'Unknown action.', 404);
    return await ops[name](S, env, me, params || {});
  }

  /* ---------- what each person may see ---------- */
  function view(S, meId, now, asRole) {
    const me = actingAs(S, meId, asRole); if (!me) return null;
    const today = istDate(now), since = addDays(today, -60);
    const mine = s => me.role !== 'trainer' || s.trainerId === me.id;
    const sessions = S.sessions.filter(s => mine(s) && (s.date >= since || OPEN.includes(s.status))).map(s => ({...s,
      attendees:S.attendees.filter(a => a.sessionId === s.id).map(a => { const r = ['assigned', 'submitted'].includes(s.status) ? resultFor(S, s, a) : null; return {...a, result:r ? {score:r.score, obtained:r.obtained, passing:r.passing, pass:r.pass, kcName:r.kcName, kcMismatch:r.kcMismatch, date:r.date, attempt:r.attempt, dateDiffers:r.dateDiffers, row:r.row} : null}; })}));
    const admin = isAdmin(me);
    const st = S.settings;
    return {
      me:{id:me.id, name:me.name, email:me.email, role:me.role, realRole:me.realRole || me.role, builtin:!!me.builtin, mustChangePassword:!!me.mustChangePassword},
      now, today,
      consts:{HOURS, MODES, CATEGORIES, KC_TYPES, REASONS, ROLES, DEFAULT_CAP, SHEET_COLS},
      users:S.users.map(u => ({id:u.id, name:u.name, role:u.role, active:u.active !== false, ...(admin ? {email:u.email, builtin:!!u.builtin, lastLogin:u.lastLogin || null} : {})})),
      kcs:S.kcs,
      sessions,
      approvals:S.approvals.filter(a => admin || byId(S.sessions, a.sessionId)?.trainerId === me.id),
      slots:availability(S, today, 28),
      slotRules:admin ? S.slotRules : [],
      settings:admin ? {name:st.name, siteUrl:st.siteUrl, piaEmail:st.piaEmail, lastSync:st.lastSync,
        smtp:{...st.smtp, pass:'', hasPass:!!st.smtp.pass}, sso:{...st.sso, clientSecret:'', hasSecret:!!st.sso.clientSecret}, sheet:{sheetId:st.sheet.sheetId || '', tab:st.sheet.tab || '', url:st.sheet.url, hasKey:!!st.sheet.key}}
        : {name:st.name, lastSync:isPia(me) ? st.lastSync : null},
      emailLog:admin ? S.emailLog.slice(-200).reverse().map(m => ({id:m.id, to:m.to, subject:m.subject, status:m.status, at:m.at, error:m.error, text:m.text})) : [],
      syncLog:isPia(me) ? S.syncLog.slice(-40).reverse() : [],
    };
  }

  /* ---------- demo data (preview and `--demo` only) ---------- */
  function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function seedDemo(S, env, adminEmail) {
    const now = env.now(), today = istDate(now);
    const U = (name, email, role) => { const u = {id:env.uid('u'), name, email, role, active:true, createdAt:now}; S.users.push(u); return u; };
    if (!S.users.some(u => u.email === adminEmail)) U('Geetansh Kumar', adminEmail, 'admin').builtin = true;
    const tr = [U('Priya Sharma', 'priya.sharma@nobroker.in', 'trainer'), U('Arjun Mehta', 'arjun.mehta@nobroker.in', 'trainer'), U('Sneha Iyer', 'sneha.iyer@nobroker.in', 'trainer')];
    const pia = [U('Rahul Verma', 'rahul.verma@nobroker.in', 'pia'), U('Kavya Nair', 'kavya.nair@nobroker.in', 'pia')];
    const K = (name, type) => { const k = {id:env.uid('k'), name, type, active:true}; S.kcs.push(k); return k; };
    const kcs = [K('Legal Services', 'Objective'), K('Home Loans', 'Objective'), K('Rental Agreement', 'Objective'), K('Packers and Movers', 'Objective'), K('Customer Handling Role Play', 'Subjective')];
    S.settings.piaEmail = 'pia.team@nobroker.in';
    const first = ['Aditi', 'Rohan', 'Meera', 'Vikram', 'Ananya', 'Karthik', 'Pooja', 'Siddharth', 'Neha', 'Amit', 'Divya', 'Manish', 'Ishita', 'Nikhil', 'Shreya', 'Varun', 'Tanvi', 'Harsh', 'Ritika', 'Gaurav', 'Swati', 'Deepak', 'Nisha', 'Akash'];
    const last = ['Rao', 'Gupta', 'Singh', 'Reddy', 'Joshi', 'Patel', 'Das', 'Menon', 'Kulkarni', 'Bose', 'Pillai', 'Shetty'];
    let emp = 41200;
    const people = n => Array.from({length:n}, () => { emp += 7; const f = first[hash('f' + emp) % first.length], l = last[hash('l' + emp) % last.length]; return {empId:'NB' + emp, name:`${f} ${l}`, email:`${f}.${l}${emp % 100}@nobroker.in`.toLowerCase()}; });
    const mk = (date, hour, mode, t, kc, cat, attempt, n, status, invig) => {
      const s = {id:env.uid('s'), date, hour, mode, trainerId:t.id, category:cat, attempt, requestedKcId:kc.id, assignedKcId:status === 'booked' || status === 'pending' ? null : kc.id,
        invigilatorId:invig ? invig.id : null, status, createdBy:t.id, createdAt:now - 5 * DAY, assignedAt:invig ? now - DAY : null, submittedAt:status === 'submitted' ? now - 3600e3 : null, submittedBy:status === 'submitted' ? invig.id : null, note:''};
      S.sessions.push(s);
      for (const a of people(n)) S.attendees.push({id:env.uid('a'), sessionId:s.id, ...a, completion:null, reason:'', reasonNote:''});
      return s;
    };
    // past 8 working days: assigned and submitted, with close-out marks
    let d = today, made = 0;
    while (made < 8) {
      d = addDays(d, -1); if (weekday(d) === 0) continue; made++;
      [[10, 'Online'], [12, 'Offline'], [15, 'Online']].forEach(([h, mode], j) => {
        if ((hash(d + h) % 5) === 0) return;
        const kc = kcs[hash(d + 'kc' + h) % kcs.length], t = tr[hash(d + 't' + h) % tr.length], inv = pia[hash(d + 'p' + h) % pia.length];
        const s = mk(d, h, mode, t, kc, hash(d + 'c' + h) % 4 ? 'New Hire' : 'Lateral', hash(d + 'at' + h) % 6 ? 1 : 2, 4 + hash(d + 'n' + h) % 5, 'submitted', inv);
        for (const a of S.attendees.filter(x => x.sessionId === s.id)) {
          if (hash(a.empId + 'abs') % 11 === 0) Object.assign(a, {completion:'not_completed', reason:hash(a.empId) % 2 ? 'Absent' : 'Technical issue'}); else a.completion = 'completed';
        }
      });
    }
    // today: one assigned (ready to close out), one booked (ready to assign)
    let td = today; if (weekday(td) === 0) td = addDays(td, -1);
    mk(td, 10, 'Offline', tr[0], kcs[0], 'New Hire', 1, 6, 'assigned', pia[0]);
    mk(td, 11, 'Online', tr[1], kcs[1], 'Lateral', 1, 5, 'booked', null);
    // upcoming bookings
    let nd = today, n = 0;
    while (n < 4) { nd = addDays(nd, 1); if (weekday(nd) === 0) continue; n++;
      mk(nd, 10 + (n * 2) % 7, n % 2 ? 'Online' : 'Offline', tr[n % 3], kcs[n % kcs.length], 'New Hire', 1, 3 + n, 'booked', null); }
    // an attempt-3 request waiting for approval
    let ad = addDays(today, 2); if (weekday(ad) === 0) ad = addDays(ad, 1);
    const ps = mk(ad, 14, 'Online', tr[2], kcs[2], 'New Hire', 3, 2, 'pending', null);
    S.approvals.push({id:env.uid('ap'), sessionId:ps.id, requestedBy:tr[2].id, status:'pending', at:now - 3600e3, decidedBy:null, decidedAt:null, note:''});
    S.demo = true;
  }
  /* A stand-in for PIA's Google Sheet, built from the demo sessions (preview and --demo only). */
  function demoSheet(S, now) {
    const headers = ['Date of KC', 'Emp ID', 'Attempt', 'Obtained Percentage', 'Status'], rows = [];
    const today = istDate(now);
    for (const s of S.sessions) {
      if (!['assigned', 'submitted'].includes(s.status) || s.date > today) continue;
      const passing = s.attempt === 1 ? 75 : 70;
      for (const a of S.attendees.filter(x => x.sessionId === s.id)) {
        if (a.completion === 'not_completed') continue;
        const obtained = 60 + hash(a.empId + s.date) % 41;
        rows.push({row:rows.length + 2, cells:[`${Number(s.date.slice(8))}-${MONTHS[Number(s.date.slice(5, 7)) - 1]}-${s.date.slice(0, 4)}`, a.empId, String(s.attempt), `${obtained}%`, obtained >= passing ? 'Pass' : 'Fail']});
      }
    }
    return {ok:true, sheet:'KC Scores (demo)', headers, rows};
  }

  return {HOURS, MODES, CATEGORIES, KC_TYPES, ROLES, REASONS, DEFAULT_CAP, SHEET_COLS, OpError,
    newState, run, ops, view, slotInfo, availability, applySheet, resultFor, parseSheetDate, parsePercent, parseStatus,
    istDate, addDays, weekday, slotStart, hourLabel, slotLabel, dateLabel, seedDemo, demoSheet, esc};
});
