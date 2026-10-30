/* Pick Timer inside Trainer Desk: browser app (plain JavaScript, no framework). Sign-in is Trainer Desk's. */
(function () {
  'use strict';
  const C = window.Core, h = C.esc;
  const $app = document.getElementById('app');

  /* ---------- talking to the server (or to the in-browser preview) ---------- */
  const API = window.PREVIEW_API || {
    async req(method, url, body) {
      const r = await fetch(url, {method, credentials:'same-origin', headers:{'Content-Type':'application/json', 'X-Requested-With':'kc', 'X-KC-Role':viewAs()}, body:body ? JSON.stringify(body) : undefined});
      let data = {}; try { data = await r.json(); } catch (e) { /* empty */ }
      if (!r.ok) { const err = new Error(data.error || `Request failed (${r.status}).`); err.status = r.status; throw err; }
      return data;
    },
    // Paths are relative to /pick-timer/. Signing in and out is Trainer Desk's.
    boot() { return this.req('GET', 'api/boot'); },
    op(op, params) { return this.req('POST', 'api/op', {op, params}); },
    logout() { location.href = '../auth/logout'; return new Promise(() => {}); },
    async appsScript() { const r = await fetch('apps-script.gs'); return r.ok ? r.text() : ''; },
  };

  // An administrator can switch to the PIA or trainer role (for this browser tab only).
  function viewAs() { try { return sessionStorage.getItem('kc-role') || ''; } catch (e) { return ''; } }
  function setViewAs(role) { try { if (role && role !== 'admin') sessionStorage.setItem('kc-role', role); else sessionStorage.removeItem('kc-role'); } catch (e) { /* tab-only setting */ } }
  window.KCRole = viewAs;

  let V = null, B = null;            // view from the server; sign-in info when signed out
  const ui = {analytics:null, aFilters:null, book:null, marks:{}, slotEdit:null, sessFilter:{status:'open', q:'', mode:''}, appsScript:null, signin:{}, busy:false};

  /* ---------- helpers ---------- */
  const user = id => V.users.find(u => u.id === id);
  const uname = id => user(id)?.name || '—';
  const kc = id => V.kcs.find(k => k.id === id);
  const kname = id => kc(id)?.name || '—';
  const isAdmin = () => V.me.role === 'admin', isPia = () => V.me.role === 'pia' || V.me.role === 'admin', isTrainer = () => V.me.role === 'trainer';
  const ROLE = {trainer:'Trainer', pia:'PIA', admin:'Admin'};
  const STATUS = {pending:'Awaiting approval', booked:'Booked', assigned:'KC assigned', submitted:'Submitted', cancelled:'Cancelled', rejected:'Rejected'};
  const badge = s => `<span class="b ${s}">${STATUS[s] || h(s)}</span>`;
  const modeB = m => `<span class="b ${m.toLowerCase()}">${h(m)}</span>`;
  const when = ms => { if (!ms) return '—'; const d = new Date(ms + 19800000); return `${d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const shortDate = d => { const x = C.dateLabel(d).split(' '); return `${x[0]} ${x[1]} ${x[2]}`; };
  const opt = (v, label, sel) => `<option value="${h(v)}"${String(sel) === String(v) ? ' selected' : ''}>${h(label)}</option>`;
  const mondayOf = d => C.addDays(d, -((C.weekday(d) + 6) % 7));
  const session = id => V.sessions.find(s => s.id === id);

  function toast(msg, bad) {
    document.querySelector('.toast')?.remove();
    const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), bad ? 7000 : 3500);
  }
  async function op(name, params, okMsg) {
    if (ui.busy) return null; ui.busy = true;
    try { const r = await API.op(name, params); V = r.view; render(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r.result) : okMsg); return r.result; }
    catch (e) { if (e.status === 401) { location.href = '../auth/login?next=' + encodeURIComponent(location.pathname); return null; } toast(e.message, true); return null; }
    finally { ui.busy = false; }
  }

  /* ---------- routing ---------- */
  function route() {
    const [path, qs] = (location.hash.slice(1) || '').split('?');
    return {parts:path.split('/').filter(Boolean), q:Object.fromEntries(new URLSearchParams(qs || ''))};
  }
  const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };
  window.addEventListener('hashchange', () => { closeModal(); render(); window.scrollTo(0, 0); });

  function navItems() {
    const pend = V.approvals.filter(a => a.status === 'pending').length;
    if (isTrainer()) return [['book', 'Book a KC'], ['sessions', 'My bookings'], ['calendar', 'Calendar'], ['analytics', 'Analytics']];
    const items = [['calendar', 'Calendar'], ['sessions', 'Sessions'], ['analytics', 'Analytics']];
    if (isAdmin()) items.splice(2, 0, ['book', 'Pre-book'], ['approvals', 'Approvals', pend], ['slots', 'Slots']), items.push(['admin', 'Site administration']);
    return items;
  }
  function layout(body) {
    const cur = route().parts[0] || '';
    return `<header class="top"><a class="back-td" href="../" title="Back to Trainer Desk">← Trainer Desk</a><a class="brand" href="#/"><span class="logo">${clockIcon()}</span>${h(V.settings.name)}</a>
<nav class="nav">${navItems().map(([k, l, n]) => `<a href="#/${k}" class="${cur === k || (cur === 'session' && k === 'sessions') ? 'on' : ''}">${h(l)}${n ? `<span class="count">${n}</span>` : ''}</a>`).join('')}</nav>
<div class="who"><span>${h(V.me.name)}</span>${V.me.realRole === 'admin' ? `<label class="role-switch" title="Switch role to use Pick Timer as a PIA or a trainer would"><span class="sr">Role</span><select data-role-switch>${C.ROLES.slice().reverse().map(r => opt(r, ROLE[r], V.me.role)).join('')}</select></label>` : `<span class="role">${ROLE[V.me.role]}</span>`}<button class="btn sm ghost" data-act="logout">Sign out</button></div></header><main>${body}</main>`;
  }
  const clockIcon = () => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>`;

  function render() {
    if (!V) { $app.innerHTML = signInPage(); return; }
    const r = route(), p = r.parts[0] || (isTrainer() ? 'book' : 'calendar');
    const views = {book:viewBook, sessions:viewSessions, session:viewSession, calendar:viewCalendar, analytics:viewAnalytics, approvals:viewApprovals, slots:viewSlots, admin:viewAdmin};
    const fn = views[p] && (p !== 'approvals' && p !== 'slots' && p !== 'admin' || isAdmin()) && (p !== 'book' || isTrainer() || isAdmin()) ? views[p] : viewCalendar;
    let body; try { body = fn(r); } catch (e) { console.error(e); body = `<div class="note bad">Something went wrong showing this page: ${h(e.message)}</div>`; }
    const acting = V.me.realRole === 'admin' && V.me.role !== 'admin'
      ? `<div class="acting">You are using Pick Timer as ${V.me.role === 'pia' ? 'a PIA' : 'a trainer'}. Anything you do here is real. <button class="btn sm" data-role-back>Back to Admin</button></div>` : '';
    $app.innerHTML = (window.PREVIEW_API ? window.PREVIEW_API.banner(V) : '') + layout(acting + body);
    if (p === 'analytics' && !ui.analytics) loadAnalytics();
    if (p === 'admin' && r.parts[1] === 'sheet' && ui.appsScript == null) API.appsScript().then(t => { ui.appsScript = t || ''; render(); });
  }

  /* ---------- no access ---------- */
  // Trainer Desk has already signed the person in; this only shows when their account is not allowed in Pick Timer.
  function signInPage() {
    const banner = window.PREVIEW_API ? window.PREVIEW_API.banner(null) : '';
    return `${banner}<div class="signin"><div class="card"><div class="brand"><span class="logo">${clockIcon()}</span>${h(B?.site || 'Pick Timer')}</div>
<p class="muted">Knowledge Check scheduling for trainers and the PIA team.</p>
${B?.error ? `<div class="note bad">${h(B.error)}</div>` : `<div class="note">${h(B?.email || 'Your account')} does not have access to Pick Timer yet. Pick Timer has its own users and roles: ask a Pick Timer administrator to add you under Site administration › Users.</div>`}
<div class="row" style="margin-top:14px"><a class="btn primary" href="../">Back to Trainer Desk</a><a class="btn ghost" href="../auth/logout">Use a different Google account</a></div></div></div>`;
  }

  /* ---------- booking (trainer, and admin pre-booking) ---------- */
  function freshBook(fromSession) {
    if (fromSession) return {editId:fromSession.id, date:fromSession.date, hour:fromSession.hour, mode:fromSession.mode, trainerId:fromSession.trainerId, requestedKcId:fromSession.requestedKcId,
      category:fromSession.category, attempt:fromSession.attempt, note:fromSession.note || '', attendees:fromSession.attendees.map(a => ({empId:a.empId, name:a.name, email:a.email})), status:fromSession.status};
    return {date:null, hour:null, mode:null, trainerId:'', requestedKcId:'', category:'New Hire', attempt:1, note:'', attendees:[{empId:'', name:'', email:''}]};
  }
  function viewBook(r) {
    if (r.q.edit && (!ui.book || ui.book.editId !== r.q.edit)) { const s = session(r.q.edit); if (s) ui.book = freshBook(s); }
    if (!r.q.edit && (!ui.book || ui.book.editId)) ui.book = freshBook();
    const b = ui.book, editing = !!b.editId;
    const days = [...new Set(V.slots.map(s => s.date))].slice(0, 18);
    if (!b.date) b.date = days.find(d => V.slots.some(s => s.date === d && !s.closed && C.slotStart(d, s.hour) > Date.now())) || days[0];
    const mineSeats = s => editing && b.status !== 'pending' && (() => { const me = session(b.editId); return me && me.date === s.date && me.hour === s.hour ? {[me.mode]:me.attendees.length} : {}; })() || {};
    const pending = Number(b.attempt) === 3 && !isAdmin();
    const slotRows = C.HOURS.map(hr => {
      const s = V.slots.find(x => x.date === b.date && x.hour === hr);
      const started = C.slotStart(b.date, hr) <= Date.now();
      return `<div class="lab">${C.slotLabel(hr)}</div>` + C.MODES.map(m => {
        if (!s) return `<button class="seat" disabled><span class="m">${m}</span><span class="l">Not open yet</span></button>`;
        const own = mineSeats(s)[m] || 0, left = s.cap[m] - s.used[m] + own, n = b.attendees.filter(a => a.empId || a.name || a.email).length || 1;
        const dis = s.closed || started || (!pending && left < n);
        const why = s.closed ? s.reason : started ? 'Started' : left <= 0 ? 'Full' : `${left} of ${s.cap[m]} left`;
        return `<button class="seat ${m}${b.hour === hr && b.mode === m ? ' on' : ''}" data-act="pickSeat" data-hour="${hr}" data-mode="${m}" ${dis ? 'disabled' : ''}><span><span class="m">${m}</span><div class="meter"><i style="width:${Math.min(100, (s.used[m] - own) / (s.cap[m] || 1) * 100)}%"></i></div></span><span class="l">${h(why)}</span></button>`;
      }).join('');
    }).join('');
    const trainers = V.users.filter(u => u.active && (u.role === 'trainer' || u.role === 'admin'));
    return `<div class="head"><div><h1>${editing ? 'Change booking' : isAdmin() ? 'Pre-book a slot' : 'Book a KC'}</h1><p class="muted">Slots run Monday to Saturday, 10 AM to 5 PM IST. Each slot has ${C.DEFAULT_CAP} Online and ${C.DEFAULT_CAP} Offline seats.</p></div>
${editing ? `<a class="btn" href="#/session/${b.editId}">Back to booking</a>` : ''}</div>
<div class="card"><h2>1. Choose a date and slot</h2><div class="days">${days.map(d => { const open = V.slots.some(s => s.date === d && !s.closed && C.slotStart(d, s.hour) > Date.now()); const x = C.dateLabel(d).split(' ');
  return `<button class="day${b.date === d ? ' on' : ''}" data-act="pickDay" data-date="${d}" ${open ? '' : 'disabled'}><span>${x[0]}</span><b>${x[1]}</b><span>${x[2]}</span></button>`; }).join('')}</div>
<div class="slots" style="margin-top:14px"><div></div><div class="muted small"><b>Online</b></div><div class="muted small"><b>Offline</b></div>${slotRows}</div></div>
<form class="card" data-form="book"><h2>2. Booking details</h2>
${b.hour != null ? `<div class="note info"><b>${h(C.dateLabel(b.date))}</b>, ${C.slotLabel(b.hour)} IST · ${h(b.mode)}</div>` : `<div class="note">Pick a slot above.</div>`}
<div class="form cols">${isAdmin() && !editing ? `<label class="f">Trainer<select data-draft="trainerId" required><option value="">Choose…</option>${trainers.map(u => opt(u.id, u.name + (u.role === 'admin' ? ' (Admin)' : ''), b.trainerId)).join('')}</select></label>` : ''}
<label class="f">KC requested<select data-draft="requestedKcId" required><option value="">Choose…</option>${V.kcs.filter(k => k.active !== false).map(k => opt(k.id, `${k.name} (${k.type})`, b.requestedKcId)).join('')}</select></label>
<label class="f">Category<select data-draft="category">${C.CATEGORIES.map(c => opt(c, c, b.category)).join('')}</select></label>
<label class="f">Attempt<select data-draft="attempt" data-rerender="1" ${editing ? 'disabled' : ''}>${[1, 2, 3].map(n => opt(n, `Attempt ${n}`, b.attempt)).join('')}</select></label></div>
${pending ? `<div class="note warn" style="margin-top:12px">Attempt 3 needs the administrator's approval. Your request will hold no seats until it is approved.</div>` : ''}
<h3 style="margin-top:18px">Attendees <span class="muted small">(${b.attendees.length} of ${C.DEFAULT_CAP})</span></h3>
<div class="scroll"><table class="t"><thead><tr><th>#</th><th>Emp ID</th><th>Name</th><th>Email ID</th><th></th></tr></thead><tbody>
${b.attendees.map((a, i) => `<tr><td class="muted">${i + 1}</td><td><input data-att="${i}" data-k="empId" value="${h(a.empId)}" placeholder="NB12345"></td><td><input data-att="${i}" data-k="name" value="${h(a.name)}"></td>
<td><input type="email" data-att="${i}" data-k="email" value="${h(a.email)}" placeholder="name@nobroker.in"></td><td><button type="button" class="btn sm ghost danger" data-act="rmAtt" data-i="${i}" ${b.attendees.length < 2 ? 'disabled' : ''}>Remove</button></td></tr>`).join('')}
</tbody></table></div>
<div class="row" style="margin-top:10px"><button type="button" class="btn sm" data-act="addAtt" ${b.attendees.length >= C.DEFAULT_CAP ? 'disabled' : ''}>+ Add attendee</button><button type="button" class="btn sm" data-act="pasteAtt">Paste from a sheet</button></div>
<label class="f" style="margin-top:14px">Note for PIA (optional)<textarea data-draft="note" rows="2">${h(b.note)}</textarea></label>
<div class="row" style="margin-top:16px"><button class="btn primary" ${b.hour == null ? 'disabled' : ''}>${editing ? 'Save changes' : pending ? 'Send for approval' : 'Book slot'}</button>${editing ? '' : `<button type="button" class="btn ghost" data-act="resetBook">Clear</button>`}</div></form>`;
  }

  /* ---------- calendar ---------- */
  function slotView(date, hour) {
    if (isAdmin()) { const atts = V.sessions.flatMap(s => s.attendees.map(a => ({...a, sessionId:s.id}))); return C.slotInfo({slotRules:V.slotRules, sessions:V.sessions, attendees:atts}, date, hour); }
    return V.slots.find(s => s.date === date && s.hour === hour);
  }
  function viewCalendar(r) {
    const wk = mondayOf(r.q.week || V.today), days = [0, 1, 2, 3, 4, 5].map(i => C.addDays(wk, i));
    const cells = [`<div class="ch"></div>`, ...days.map(d => `<div class="ch${d === V.today ? ' today' : ''}">${shortDate(d)}</div>`)];
    for (const hr of C.HOURS) {
      cells.push(`<div class="hr">${C.hourLabel(hr)}</div>`);
      for (const d of days) {
        const info = slotView(d, hr), past = C.slotStart(d, hr) + 3600e3 < Date.now();
        const list = V.sessions.filter(s => s.date === d && s.hour === hr && (s.status !== 'cancelled' || ui.showCancelled));
        const seats = info && !info.closed && !past ? `<div class="seats">${C.MODES.map(m => { const left = info.cap[m] - info.used[m]; return `<span class="${left <= 0 ? 'full' : m === 'Online' ? 'on' : 'off'}" title="${m} seats left">${m === 'Online' ? 'On' : 'Off'} ${left}/${info.cap[m]}</span>`; }).join('')}</div>` : '';
        cells.push(`<div class="${info?.closed ? 'closed' : past ? 'past' : ''}">${info?.closed ? `<div class="muted small">${h(info.reason)}</div>` : seats}
${list.map(s => `<a class="chip ${s.mode} st-${s.status}" href="#/session/${s.id}" title="${h(STATUS[s.status])}"><b>${h(kname(s.assignedKcId || s.requestedKcId))}</b><br>${s.attendees.length} · ${h(uname(s.trainerId).split(' ')[0])}${s.attempt > 1 ? ` · A${s.attempt}` : ''}</a>`).join('')}</div>`);
      }
    }
    return `<div class="head"><div><h1>Calendar</h1><p class="muted">Week of ${h(C.dateLabel(wk))}. ${isTrainer() ? 'Your bookings, with seats left in each slot.' : 'All bookings. Blue is Online, amber is Offline; ✓ means submitted.'}</p></div>
<div class="row"><label class="check small"><input type="checkbox" data-act="toggleCancelled" ${ui.showCancelled ? 'checked' : ''}> Show cancelled</label>
<a class="btn" href="#/calendar?week=${C.addDays(wk, -7)}">‹ Previous</a><a class="btn" href="#/calendar">This week</a><a class="btn" href="#/calendar?week=${C.addDays(wk, 7)}">Next ›</a></div></div>
<div class="scroll"><div class="cal">${cells.join('')}</div></div>`;
  }

  /* ---------- sessions list ---------- */
  function viewSessions() {
    const f = ui.sessFilter, q = f.q.trim().toLowerCase();
    const groups = {open:['pending', 'booked', 'assigned'], toclose:['assigned'], toassign:['booked'], submitted:['submitted'], all:null};
    const list = V.sessions.filter(s => (!groups[f.status] || groups[f.status].includes(s.status)) && (!f.mode || s.mode === f.mode)
      && (!q || [kname(s.requestedKcId), kname(s.assignedKcId), uname(s.trainerId), ...s.attendees.flatMap(a => [a.empId, a.name])].some(x => String(x).toLowerCase().includes(q))))
      .sort((a, b) => f.status === 'submitted' || f.status === 'all' ? (b.date + b.hour).localeCompare(a.date + a.hour) : (a.date + String(a.hour).padStart(2, '0')).localeCompare(b.date + String(b.hour).padStart(2, '0')));
    const tabs = isTrainer() ? [['open', 'Upcoming and open'], ['submitted', 'Submitted'], ['all', 'All']] : [['open', 'Open'], ['toassign', 'To assign'], ['toclose', 'To close out'], ['submitted', 'Submitted'], ['all', 'All']];
    return `<div class="head"><div><h1>${isTrainer() ? 'My bookings' : 'Sessions'}</h1><p class="muted">${list.length} session${list.length === 1 ? '' : 's'} shown.</p></div>${isTrainer() ? '<a class="btn primary" href="#/book">Book a KC</a>' : ''}</div>
<div class="row" style="margin-bottom:12px"><div class="seg">${tabs.map(([k, l]) => `<button data-act="sessTab" data-k="${k}" class="${f.status === k ? 'on' : ''}">${l}</button>`).join('')}</div>
<select data-act="sessMode"><option value="">All modes</option>${C.MODES.map(m => opt(m, m, f.mode)).join('')}</select>
<input type="search" data-act="sessQ" placeholder="Search KC, trainer, Emp ID or name" value="${h(f.q)}" style="min-width:260px"></div>
<div class="card flush scroll"><table class="t"><thead><tr><th>Date</th><th>Slot</th><th>Mode</th><th>KC</th>${isTrainer() ? '' : '<th>Trainer</th>'}<th class="num">Attendees</th><th>Attempt</th><th>Status</th></tr></thead><tbody>
${list.map(s => `<tr class="click" data-act="openSession" data-id="${s.id}"><td class="nowrap">${h(shortDate(s.date))}</td><td class="nowrap">${C.slotLabel(s.hour)}</td><td>${modeB(s.mode)}</td>
<td>${h(kname(s.assignedKcId || s.requestedKcId))}${s.assignedKcId && s.assignedKcId !== s.requestedKcId ? `<div class="muted small">requested ${h(kname(s.requestedKcId))}</div>` : ''}</td>${isTrainer() ? '' : `<td>${h(uname(s.trainerId))}</td>`}
<td class="num">${s.attendees.length}</td><td>${s.attempt} · ${h(s.category)}</td><td>${badge(s.status)}</td></tr>`).join('') || `<tr><td colspan="8" class="muted" style="padding:24px;text-align:center">No sessions here.</td></tr>`}
</tbody></table></div>`;
  }

  /* ---------- one session ---------- */
  function viewSession(r) {
    const s = session(r.parts[1]); if (!s) return `<div class="note bad">This session was not found, or you can't see it.</div>`;
    const canEdit = (isAdmin() || (isTrainer() && s.trainerId === V.me.id)) && ['pending', 'booked'].includes(s.status);
    const ap = V.approvals.filter(a => a.sessionId === s.id).slice(-1)[0];
    const facts = [['Date', C.dateLabel(s.date)], ['Slot', C.slotLabel(s.hour) + ' IST'], ['Mode', s.mode], ['Trainer', uname(s.trainerId)], ['Category', s.category], ['Attempt', s.attempt],
      ['KC requested', kname(s.requestedKcId)], ['KC assigned', s.assignedKcId ? kname(s.assignedKcId) : '—'], ['KC type', s.assignedKcId ? kc(s.assignedKcId)?.type : '—'], ['Invigilator', s.invigilatorId ? uname(s.invigilatorId) : '—'],
      ['Booked by', `${uname(s.createdBy)}, ${when(s.createdAt)}`], ...(s.submittedAt ? [['Submitted', `${uname(s.submittedBy)}, ${when(s.submittedAt)}`]] : [])];
    let action = '';
    if (s.status === 'pending') action = `<div class="note warn">Waiting for the administrator to approve this attempt-3 booking. It holds no seats yet.${isAdmin() ? ` <a href="#/approvals">Go to Approvals</a>` : ''}</div>`;
    if (s.status === 'rejected') action = `<div class="note bad">The administrator rejected this attempt-3 booking${ap?.note ? `: ${h(ap.note)}` : '.'}</div>`;
    if (s.status === 'cancelled') action = `<div class="note">This booking was cancelled${s.cancelledBy ? ` by ${h(uname(s.cancelledBy))}, ${when(s.cancelledAt)}` : ''}.</div>`;
    if (isPia() && ['booked', 'assigned'].includes(s.status)) action += `<div class="card"><h2>${s.status === 'booked' ? 'Assign the KC' : 'Assigned KC'}</h2>
<p class="muted small">Pick the correct KC (remap it if the trainer's request is wrong). You will be recorded as the invigilator. Run the KC in Google Forms as usual.</p>
<form class="row" data-form="assign" data-id="${s.id}"><select name="kcId" style="min-width:280px">${V.kcs.filter(k => k.active !== false || k.id === s.assignedKcId).map(k => opt(k.id, `${k.name} (${k.type})`, s.assignedKcId || s.requestedKcId)).join('')}</select>
<button class="btn primary">${s.status === 'booked' ? 'Assign KC' : 'Change KC'}</button></form></div>`;
    const closing = isPia() && s.status === 'assigned';
    const showScores = ['assigned', 'submitted'].includes(s.status);
    const marks = ui.marks[s.id] || (ui.marks[s.id] = Object.fromEntries(s.attendees.map(a => [a.id, {completion:a.completion, reason:a.reason || '', reasonNote:a.reasonNote || ''}])));
    const rows = s.attendees.map(a => {
      const m = marks[a.id] || {}, res = a.result;
      const comp = closing ? `<select data-mark="${a.id}" data-k="completion"><option value="">Choose…</option>${opt('completed', 'KC completed', m.completion)}${opt('not_completed', 'KC not completed', m.completion)}</select>
${m.completion === 'not_completed' ? `<div class="row" style="margin-top:6px;flex-wrap:nowrap"><select data-mark="${a.id}" data-k="reason"><option value="">Reason…</option>${C.REASONS.map(x => opt(x, x, m.reason)).join('')}</select>${m.reason === 'Other' ? `<input data-mark="${a.id}" data-k="reasonNote" value="${h(m.reasonNote)}" placeholder="Describe">` : ''}</div>` : ''}`
        : a.completion === 'completed' ? '<span class="b good">Completed</span>' : a.completion === 'not_completed' ? `<span class="b bad">Not completed</span> <span class="muted small">${h(a.reason)}${a.reasonNote ? ': ' + h(a.reasonNote) : ''}</span>` : '<span class="muted">—</span>';
      const sc = !showScores ? '' : res ? `<td class="num">${res.obtained}%</td><td><span class="b ${res.pass ? 'pass' : 'fail'}">${res.pass ? 'Pass' : 'Fail'}</span>${res.kcMismatch ? `<div class="small" style="color:var(--warn)">Sheet KC: ${h(res.kcName)}</div>` : ''}${res.dateDiffers ? `<div class="small" style="color:var(--warn)">Sheet row ${res.row} has Date of KC ${h(shortDate(res.date))}</div>` : ''}</td>`
        : `<td colspan="2" class="muted small">${(closing ? m.completion : a.completion) === 'completed' ? `<span style="color:var(--warn)">No row with this Emp ID for attempt ${s.attempt} in the score sheet yet</span>` : ''}</td>`;
      return `<tr><td class="mono">${h(a.empId)}</td><td>${h(a.name)}</td><td class="small">${h(a.email)}</td>${showScores ? `<td style="min-width:200px">${comp}</td>${sc}` : ''}</tr>`;
    }).join('');
    const counts = s.attendees.reduce((c, a) => { const m = closing ? marks[a.id] : a; if (m?.completion === 'completed') c.done++; else if (m?.completion === 'not_completed') c.not++; if (a.result) c.scored++; return c; }, {done:0, not:0, scored:0});
    return `<div class="head"><div><a class="small" href="#/sessions">‹ ${isTrainer() ? 'My bookings' : 'Sessions'}</a><h1>${h(kname(s.assignedKcId || s.requestedKcId))}</h1>
<div class="row">${modeB(s.mode)} ${badge(s.status)} <span class="muted">${h(C.dateLabel(s.date))}, ${C.slotLabel(s.hour)}</span></div></div>
<div class="row">${canEdit ? `<a class="btn" href="#/book?edit=${s.id}">Change</a><button class="btn danger" data-act="cancelBooking" data-id="${s.id}">Cancel booking</button>` : ''}
${isAdmin() && s.status === 'submitted' ? `<button class="btn" data-act="reopen" data-id="${s.id}">Reopen</button>` : ''}</div></div>
${action}
<div class="card"><div class="facts">${facts.map(([k, v]) => `<div><b>${k}</b>${h(v)}</div>`).join('')}</div>${s.note ? `<p class="small" style="margin:12px 0 0"><b>Note:</b> ${h(s.note)}</p>` : ''}</div>
<div class="card flush"><div style="padding:16px 18px 6px" class="row"><h2 style="margin:0;flex:1">Attendees (${s.attendees.length})</h2>
${showScores ? `<span class="muted small">${counts.done} completed · ${counts.not} not completed · ${counts.scored} scores found${V.settings.lastSync ? ` · sheet last read ${when(V.settings.lastSync)}` : ''}</span>` : ''}</div>
${closing ? `<p class="muted small" style="padding:0 18px">Mark each attendee, then pull their scores from the PIA score sheet. Submitting locks the session; anyone not completed needs a new booking.</p>` : ''}
<div class="scroll"><table class="t"><thead><tr><th>Emp ID</th><th>Name</th><th>Email ID</th>${showScores ? '<th>KC completed?</th><th class="num">Obtained</th><th>Status</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>
${closing ? `<div class="row" style="padding:14px 18px;border-top:1px solid var(--line-2)"><button class="btn" data-act="saveMarks" data-id="${s.id}">Save marks</button><button class="btn" data-act="pull" data-id="${s.id}">Pull scores from sheet</button>
<span style="flex:1"></span><button class="btn primary" data-act="submitSession" data-id="${s.id}">Submit session</button></div>` : ''}</div>`;
  }

  /* ---------- approvals (admin) ---------- */
  function viewApprovals() {
    const pend = V.approvals.filter(a => a.status === 'pending'), done = V.approvals.filter(a => a.status !== 'pending').sort((a, b) => b.decidedAt - a.decidedAt).slice(0, 30);
    const card = a => { const s = session(a.sessionId); if (!s) return ''; const info = slotView(s.date, s.hour); const left = info ? info.cap[s.mode] - info.used[s.mode] : 0;
      return `<div class="card"><div class="row" style="justify-content:space-between"><div><h2 style="margin:0">${h(kname(s.requestedKcId))} · attempt 3</h2>
<div class="muted">${h(uname(s.trainerId))} asked ${when(a.at)} for ${h(C.dateLabel(s.date))}, ${C.slotLabel(s.hour)} · ${modeB(s.mode)}</div></div><a href="#/session/${s.id}">Open</a></div>
<table class="t" style="margin:10px 0"><thead><tr><th>Emp ID</th><th>Name</th><th>Email ID</th></tr></thead><tbody>${s.attendees.map(x => `<tr><td class="mono">${h(x.empId)}</td><td>${h(x.name)}</td><td class="small">${h(x.email)}</td></tr>`).join('')}</tbody></table>
<div class="note ${left >= s.attendees.length ? 'good' : 'warn'}">${left >= s.attendees.length ? `${left} ${s.mode} seats are free in this slot.` : `Only ${Math.max(0, left)} ${s.mode} seats are free in this slot. Move it to another slot to approve.`}</div>
<form class="row" data-form="decide" data-id="${a.id}"><label class="f">Date<select name="date">${[...new Set(V.slots.map(x => x.date))].map(d => opt(d, shortDate(d), s.date)).join('')}</select></label>
<label class="f">Slot<select name="hour">${C.HOURS.map(x => opt(x, C.slotLabel(x), s.hour)).join('')}</select></label><label class="f">Mode<select name="mode">${C.MODES.map(m => opt(m, m, s.mode)).join('')}</select></label>
<label class="f" style="flex:1">Note to trainer (optional)<input name="note"></label><button class="btn primary" name="approve" value="1">Approve</button><button class="btn danger" name="approve" value="0">Reject</button></form></div>`; };
    return `<div class="head"><div><h1>Approvals</h1><p class="muted">Attempt-3 bookings wait here. Approving books the seats and emails everyone.</p></div></div>
${pend.map(card).join('') || '<div class="note">Nothing is waiting for approval.</div>'}
${done.length ? `<h2 style="margin-top:24px">Decided</h2><div class="card flush scroll"><table class="t"><thead><tr><th>Decided</th><th>Trainer</th><th>KC</th><th>Slot</th><th>Decision</th><th>Note</th></tr></thead><tbody>
${done.map(a => { const s = session(a.sessionId); return `<tr><td>${when(a.decidedAt)}</td><td>${h(uname(a.requestedBy))}</td><td>${s ? h(kname(s.requestedKcId)) : '—'}</td><td>${s ? h(shortDate(s.date)) + ', ' + C.hourLabel(s.hour) : ''}</td><td><span class="b ${a.status === 'approved' ? 'good' : 'bad'}">${h(a.status)}</span></td><td class="small">${h(a.note)}</td></tr>`; }).join('')}</tbody></table></div>` : ''}`;
  }

  /* ---------- slots (admin) ---------- */
  function viewSlots(r) {
    const wk = mondayOf(r.q.week || V.today), days = [0, 1, 2, 3, 4, 5].map(i => C.addDays(wk, i));
    const ed = ui.slotEdit;
    const cells = [`<div class="ch"></div>`, ...days.map(d => { const dr = V.slotRules.find(x => x.date === d && x.hour == null);
      return `<div class="ch${d === V.today ? ' today' : ''}">${shortDate(d)}<br><button class="btn sm ${dr?.closed ? '' : 'ghost'}" data-act="toggleDay" data-date="${d}" style="margin-top:4px">${dr?.closed ? 'Reopen day' : 'Close day'}</button></div>`; })];
    for (const hr of C.HOURS) {
      cells.push(`<div class="hr">${C.hourLabel(hr)}</div>`);
      for (const d of days) {
        const info = slotView(d, hr), rule = V.slotRules.find(x => x.date === d && x.hour === hr);
        cells.push(`<div class="${info.closed ? 'closed' : ''}" data-act="editSlot" data-date="${d}" data-hour="${hr}" style="cursor:pointer;${ed && ed.date === d && ed.hour === hr ? 'outline:2px solid var(--brand);outline-offset:-2px' : ''}">
${info.closed ? `<div class="small"><b>Closed</b><br><span class="muted">${h(info.reason)}</span></div>` : `<div class="small">${C.MODES.map(m => `<div><span class="b ${m.toLowerCase()}">${m}</span> ${info.used[m]}/${info.cap[m]}</div>`).join('')}</div>`}
${rule && !info.closed && (rule.capOnline != null || rule.capOffline != null) ? '<div class="muted small">custom capacity</div>' : ''}</div>`);
      }
    }
    let panel = '';
    if (ed) { const info = slotView(ed.date, ed.hour), rule = V.slotRules.find(x => x.date === ed.date && x.hour === ed.hour);
      panel = `<form class="card" data-form="slotRule" data-date="${ed.date}" data-hour="${ed.hour}"><h2>${h(C.dateLabel(ed.date))}, ${C.slotLabel(ed.hour)}</h2>
<div class="form cols"><label class="f">Online seats<input type="number" min="0" max="50" name="capOnline" value="${rule?.capOnline ?? C.DEFAULT_CAP}"><span class="muted small">${info.used.Online} booked</span></label>
<label class="f">Offline seats<input type="number" min="0" max="50" name="capOffline" value="${rule?.capOffline ?? C.DEFAULT_CAP}"><span class="muted small">${info.used.Offline} booked</span></label>
<label class="f">Reason if closed<input name="note" value="${h(rule?.note || '')}" placeholder="e.g. Training audit"></label></div>
<label class="check" style="margin-top:12px"><input type="checkbox" name="closed" ${rule?.closed ? 'checked' : ''}> Close this slot</label>
<div class="row" style="margin-top:14px"><button class="btn primary">Save slot</button><button type="button" class="btn ghost" data-act="closeSlotEdit">Close</button><a class="btn" href="#/book">Pre-book this week</a></div></form>`; }
    return `<div class="head"><div><h1>Slots</h1><p class="muted">Click a slot to change its seats or close it. Closing doesn't cancel existing bookings. Sundays are always closed.</p></div>
<div class="row"><a class="btn" href="#/slots?week=${C.addDays(wk, -7)}">‹ Previous</a><a class="btn" href="#/slots">This week</a><a class="btn" href="#/slots?week=${C.addDays(wk, 7)}">Next ›</a></div></div>
${panel}<div class="scroll"><div class="cal">${cells.join('')}</div></div>`;
  }

  /* ---------- analytics ---------- */
  function defaultFilters() { return {from:C.addDays(V.today, -6), to:V.today, mode:'', kcType:'', category:'', trainerId:'', invigilatorId:'', kcId:'', attempt:''}; }
  async function loadAnalytics() {
    ui.aFilters = ui.aFilters || defaultFilters();
    const f = ui.aFilters;
    try { const r = await API.op('analytics', {from:f.from, to:f.to, filters:f}); ui.analytics = r.result; ui.analyticsErr = ''; }
    catch (e) { ui.analytics = {error:e.message}; }
    if (route().parts[0] === 'analytics') render();
  }
  function viewAnalytics() {
    const f = ui.aFilters || (ui.aFilters = defaultFilters()), a = ui.analytics;
    const sel = (k, label, opts) => `<label class="f">${label}<select data-af="${k}"><option value="">All</option>${opts.map(([v, l]) => opt(v, l, f[k])).join('')}</select></label>`;
    const filters = `<div class="card"><div class="row" style="margin-bottom:12px"><div class="seg">${[['today', 'Today'], ['yesterday', 'Yesterday'], ['7', 'Last 7 days'], ['month', 'This month']].map(([k, l]) => `<button data-act="aRange" data-k="${k}">${l}</button>`).join('')}</div></div>
<div class="form cols"><label class="f">From<input type="date" data-af="from" value="${f.from}"></label><label class="f">To<input type="date" data-af="to" value="${f.to}"></label>
${sel('mode', 'Mode', C.MODES.map(m => [m, m]))}${sel('kcType', 'KC type', C.KC_TYPES.map(m => [m, m]))}${sel('category', 'Category', C.CATEGORIES.map(m => [m, m]))}
${isTrainer() ? '' : sel('trainerId', 'Trainer', V.users.filter(u => u.role === 'trainer').map(u => [u.id, u.name]))}${isTrainer() ? '' : sel('invigilatorId', 'Invigilator', V.users.filter(u => u.role !== 'trainer').map(u => [u.id, u.name]))}
${sel('kcId', 'KC', V.kcs.map(k => [k.id, k.name]))}${sel('attempt', 'Attempt', [[1, '1'], [2, '2'], [3, '3']])}</div></div>`;
    if (!a) return `<div class="head"><div><h1>Analytics</h1></div></div>${filters}<div class="muted">Loading…</div>`;
    if (a.error) return `<div class="head"><div><h1>Analytics</h1></div></div>${filters}<div class="note bad">${h(a.error)}</div>`;
    const t = a.totals, range = a.from === a.to ? C.dateLabel(a.from) : `${shortDate(a.from)} to ${shortDate(a.to)}`;
    const tile = (n, k, cls = '') => `<div class="tile ${cls}"><div class="n">${n}</div><div class="k">${k}</div></div>`;
    const bar = x => x.pass + x.fail ? `<div class="bar" title="${x.pass} pass, ${x.fail} fail"><i class="p" style="width:${x.pass / (x.pass + x.fail) * 100}%"></i><i class="f" style="width:${x.fail / (x.pass + x.fail) * 100}%"></i></div>` : '<span class="muted small">—</span>';
    return `<div class="head"><div><h1>Analytics</h1><p class="muted">${h(range)}${isTrainer() ? ' · your bookings only' : ''}. Pass and Fail count only submitted sessions.</p></div>
<div class="row"><button class="btn" data-act="csv" data-k="kcs">Download KC-wise CSV</button><button class="btn" data-act="csv" data-k="detail">Download attendee CSV</button></div></div>
${filters}
<div class="tiles">${tile(t.assigned, 'KCs assigned', 'accent')}${tile(t.attendees, 'Attendees')}${tile(t.completed, 'KC completed')}${tile(t.notCompleted, 'Not completed')}${tile(t.pass, 'Pass', 'good')}${tile(t.fail, 'Fail', 'bad')}${tile(t.passRate == null ? '—' : t.passRate + '%', 'Pass rate')}${t.pending ? tile(t.pending, 'Awaiting close-out') : ''}</div>
<div><div class="card flush"><h2 style="padding:16px 18px 4px">Day by day</h2><div class="scroll"><table class="t"><thead><tr><th>Date</th><th class="num">KCs assigned</th><th class="num">Attendees</th><th class="num">Completed</th><th class="num">Not completed</th><th class="num">Pass</th><th class="num">Fail</th></tr></thead><tbody>
${a.days.map(d => `<tr><td class="nowrap">${h(shortDate(d.date))}</td><td class="num">${d.assigned}</td><td class="num">${d.attendees}</td><td class="num">${d.completed}</td><td class="num">${d.notCompleted}</td><td class="num">${d.pass}</td><td class="num">${d.fail}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No KCs in this range.</td></tr>'}</tbody></table></div></div>
<div class="card flush"><h2 style="padding:16px 18px 4px">KC-wise results</h2><div class="scroll"><table class="t"><thead><tr><th>KC</th><th class="num">Attendees</th><th class="num">Pass</th><th class="num">Fail</th><th class="num">Pass rate</th><th></th></tr></thead><tbody>
${a.kcs.map(k => `<tr><td>${h(k.kc)}<div class="muted small">${h(k.type)} · ${k.sessions} session${k.sessions === 1 ? '' : 's'}</div></td><td class="num">${k.attendees}</td><td class="num">${k.pass}</td><td class="num">${k.fail}</td><td class="num">${k.passRate == null ? '—' : k.passRate + '%'}</td><td>${bar(k)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No KCs in this range.</td></tr>'}</tbody></table></div></div></div>
<details class="card"><summary>Attendee results (${a.detail.length})</summary><div class="scroll" style="margin-top:12px"><table class="t"><thead><tr><th>Date</th><th>KC</th><th>Mode</th><th>Emp ID</th><th>Name</th><th>Trainer</th><th>Status</th><th class="num">Obtained</th><th>Result</th></tr></thead><tbody>
${a.detail.slice(0, 500).map(d => `<tr><td class="nowrap">${h(shortDate(d.date))}</td><td>${h(d.kc)}</td><td>${modeB(d.mode)}</td><td class="mono">${h(d.empId)}</td><td>${h(d.name)}</td><td>${h(d.trainer)}</td><td class="small">${h(d.status)}</td><td class="num">${d.obtained === '' ? '' : d.obtained + '%'}</td><td>${d.result ? `<span class="b ${d.result === 'Pass' ? 'pass' : 'fail'}">${d.result}</span>` : ''}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  function downloadCsv(kind) {
    const a = ui.analytics; if (!a || a.error) return;
    const cols = kind === 'kcs' ? [['kc', 'KC'], ['type', 'KC Type'], ['sessions', 'Sessions'], ['attendees', 'Attendees'], ['completed', 'Completed'], ['notCompleted', 'Not completed'], ['pass', 'Pass'], ['fail', 'Fail'], ['passRate', 'Pass rate %']]
      : [['date', 'Date of KC'], ['slot', 'Slot'], ['mode', 'Mode of KC'], ['kc', 'KC Name'], ['kcType', 'KC Type'], ['category', 'Category'], ['attempt', 'Attempt'], ['trainer', "Trainer's Name"], ['invigilator', 'Invigilator'], ['empId', 'Emp ID'], ['name', 'Name'], ['email', 'Email ID'], ['status', 'KC completed?'], ['obtained', 'Obtained Percentage'], ['result', 'Status']];
    const rows = kind === 'kcs' ? a.kcs : a.detail;
    const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
    const csv = [cols.map(c => c[1]).join(','), ...rows.map(r => cols.map(c => cell(r[c[0]])).join(','))].join('\r\n');
    const name = `${kind === 'kcs' ? 'kc-wise-results' : 'kc-attendee-results'}-${a.from}${a.to !== a.from ? '-to-' + a.to : ''}.csv`;
    if (window.PREVIEW_API) return window.PREVIEW_API.download(name, csv);
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(['﻿' + csv], {type:'text/csv'})); link.download = name; document.body.appendChild(link); link.click(); link.remove();
  }

  /* ---------- site administration (admin) ---------- */
  function viewAdmin(r) {
    const tab = r.parts[1] || 'users';
    const tabs = [['users', 'Users'], ['kcs', 'KC list'], ['email', 'Email'], ['sheet', 'Score sheet'], ['general', 'General'], ['emaillog', 'Email log'], ['synclog', 'Sync log']];
    const body = {users:adminUsers, kcs:adminKcs, email:adminEmail, sheet:adminSheet, general:adminGeneral, emaillog:adminEmailLog, synclog:adminSyncLog}[tab] || adminUsers;
    return `<div class="head"><div><h1>Site administration</h1></div></div><div class="tabs">${tabs.map(([k, l]) => `<a href="#/admin/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>${body(r)}`;
  }
  function adminUsers(r) {
    const editing = r.q.edit ? V.users.find(u => u.id === r.q.edit) : null;
    const list = [...V.users].sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
    return `<div class="grid2" style="grid-template-columns:2fr 1fr"><div class="card flush scroll"><table class="t"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign-in</th><th></th></tr></thead><tbody>
${list.map(u => `<tr${u.active ? '' : ' style="opacity:.55"'}><td>${h(u.name)}${u.builtin ? ' <span class="b">built-in</span>' : ''}${u.active ? '' : ' <span class="b">inactive</span>'}</td><td class="small">${h(u.email)}</td><td>${ROLE[u.role]}</td><td class="small">${when(u.lastLogin)}</td><td class="right"><a href="#/admin/users?edit=${u.id}">Edit</a></td></tr>`).join('')}</tbody></table></div>
<form class="card" data-form="saveUser" data-id="${editing ? editing.id : ''}"><h2>${editing ? 'Edit user' : 'Add a user'}</h2><div class="form">
<label class="f">Name<input name="name" value="${h(editing?.name || '')}" required></label><label class="f">Email<input type="email" name="email" value="${h(editing?.email || '')}" ${editing?.builtin ? 'readonly' : ''} required></label>
<label class="f">Role<select name="role" ${editing?.builtin ? 'disabled' : ''}>${C.ROLES.map(x => opt(x, ROLE[x], editing?.role || 'trainer')).join('')}</select></label>
${editing && !editing.builtin ? `<label class="check"><input type="checkbox" name="active" ${editing.active ? 'checked' : ''}> Active (can sign in)</label>` : ''}
<p class="muted small">People open Pick Timer from Trainer Desk with their nobroker.in Google account. Only the people listed here can get in, with the role given here; Pick Timer's admins and roles are separate from Trainer Desk's.</p>
<div class="row"><button class="btn primary">${editing ? 'Save' : 'Add user'}</button>${editing ? '<a class="btn ghost" href="#/admin/users">Cancel</a>' : ''}</div></div></form></div>`;
  }
  function adminKcs(r) {
    const editing = r.q.edit ? kc(r.q.edit) : null;
    return `<div class="grid2" style="grid-template-columns:2fr 1fr"><div class="card flush scroll"><table class="t"><thead><tr><th>KC name</th><th>Type</th><th>Status</th><th></th></tr></thead><tbody>
${V.kcs.map(k => `<tr${k.active !== false ? '' : ' style="opacity:.55"'}><td>${h(k.name)}</td><td>${h(k.type)}</td><td>${k.active !== false ? 'Active' : 'Hidden'}</td><td class="right"><a href="#/admin/kcs?edit=${k.id}">Edit</a></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No KCs yet.</td></tr>'}</tbody></table></div>
<form class="card" data-form="saveKc" data-id="${editing ? editing.id : ''}"><h2>${editing ? 'Edit KC' : 'Add a KC'}</h2><div class="form">
<label class="f">KC name<input name="name" value="${h(editing?.name || '')}" required></label>
<label class="f">KC type<select name="type">${C.KC_TYPES.map(x => opt(x, x, editing?.type || 'Objective')).join('')}</select></label>
${editing ? `<label class="check"><input type="checkbox" name="active" ${editing.active !== false ? 'checked' : ''}> Active (shown when booking)</label>` : ''}
<div class="row"><button class="btn primary">${editing ? 'Save' : 'Add KC'}</button>${editing ? '<a class="btn ghost" href="#/admin/kcs">Cancel</a>' : ''}</div></div></form></div>`;
  }
  function adminEmail() {
    const s = V.settings.smtp;
    return `<form class="card" data-form="settings" data-section="smtp"><h2>Email (SMTP)</h2>
<p class="muted">Same as NB Academy. Until email is turned on, emails are kept in the Email log and not sent; turning it on sends those from the last 3 days.</p>
<div class="form cols"><label class="f">Mail server<input name="host" value="${h(s.host)}" placeholder="smtp.gmail.com"></label><label class="f">Port<input type="number" name="port" value="${h(s.port)}"></label>
<label class="f">Username<input name="user" value="${h(s.user)}" autocomplete="off"></label><label class="f">Password or app password<input type="password" name="pass" placeholder="${s.hasPass ? 'Saved (leave blank to keep)' : ''}" autocomplete="off"></label>
<label class="f">From address<input name="from" value="${h(s.from)}" placeholder="KC Pick Timer &lt;pia.kc@nobroker.in&gt;"></label></div>
<div class="row" style="margin-top:12px"><label class="check"><input type="checkbox" name="secure" ${s.secure ? 'checked' : ''}> Use TLS from the start (port 465)</label><label class="check"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> Turn on email</label></div>
<p class="muted small" style="margin-top:10px">Google Workspace: smtp.gmail.com, port 587, an app password (spaces are fine). Microsoft 365: smtp.office365.com, port 587.</p>
<div class="row" style="margin-top:12px"><button class="btn primary">Save</button><input type="email" name="testTo" placeholder="Send a test to…" value="${h(V.me.email)}" style="min-width:240px"><button type="button" class="btn" data-act="testEmail">Save and send a test email</button></div></form>`;
  }
  function adminGeneral() {
    const s = V.settings;
    return `<form class="card" data-form="settings" data-section="general"><h2>General</h2><div class="form cols">
<label class="f">Site name<input name="name" value="${h(s.name)}" required></label>
<label class="f">PIA team email<input type="email" name="piaEmail" value="${h(s.piaEmail)}" placeholder="pia.team@nobroker.in"><span class="muted small">Gets a copy of every booking, change and cancellation.</span></label></div>
<div class="row" style="margin-top:14px"><button class="btn primary">Save</button></div></form>`;
  }
  function adminSheet() {
    const s = V.settings.sheet, last = V.syncLog[0];
    return `<form class="card" data-form="settings" data-section="sheet"><h2>Score sheet</h2>
<p class="muted">Pick Timer reads PIA's score sheet through the Google account Trainer Desk uses for its sheets. It never writes to the sheet. It reads when PIA clicks <b>Pull scores</b> and every 15 minutes.</p>
<div class="form cols"><label class="f">Score sheet link<input name="sheetId" value="${h(s.sheetId ? 'https://docs.google.com/spreadsheets/d/' + s.sheetId + '/edit' : '')}" placeholder="https://docs.google.com/spreadsheets/d/…/edit"></label>
<label class="f">Tab name<input name="tab" value="${h(s.tab || '')}" placeholder="KC Sheet"></label></div>
<p class="muted small" style="margin-top:6px">The sheet must be shared (view access is enough) with Trainer Desk's Google account. If it cannot be, use an Apps Script link instead (below).</p>
<details style="margin-top:10px" ${s.url && !s.sheetId ? 'open' : ''}><summary class="small">Use an Apps Script link instead</summary>
<div class="form cols" style="margin-top:10px"><label class="f">Apps Script web app URL<input name="url" value="${h(s.url)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
<label class="f">Secret key<input name="key" placeholder="${s.hasKey ? 'Saved (leave blank to keep)' : ''}" autocomplete="off"></label></div>
<p class="muted small">Leave the score sheet link empty to use this. Steps: open the score sheet, Extensions › Apps Script, paste the script below, put a key (<button type="button" class="btn sm" data-act="genKey">Generate a key</button>) into SECRET_KEY and into the box above, Deploy › Web app (Execute as: Me, Who has access: Anyone), paste the /exec URL above.</p>
${ui.appsScript == null ? '<p class="muted">Loading the script…</p>' : `<pre class="code">${h(ui.appsScript)}</pre><button type="button" class="btn sm" data-act="copyScript">Copy script</button>`}</details>
<div class="row" style="margin-top:12px"><button class="btn primary">Save</button><button type="button" class="btn" data-act="testSheet">Test connection</button><button type="button" class="btn" data-act="syncNow">Sync now</button></div>
${ui.sheetTest ? `<div class="note ${ui.sheetTest.missing?.length ? 'warn' : 'good'}" style="margin-top:12px">${ui.sheetTest.error ? h(ui.sheetTest.error) : `Connected to "${h(ui.sheetTest.sheet)}": ${ui.sheetTest.rows} rows. ${ui.sheetTest.missing.length ? `Missing columns: <b>${h(ui.sheetTest.missing.join(', '))}</b>.` : 'All required columns found.'}<br><span class="small">Headers: ${h(ui.sheetTest.headers.join(' · '))}</span>`}</div>` : ''}
${last ? `<p class="small muted" style="margin-top:12px">Last read ${when(last.at)}: ${last.error ? `<span style="color:var(--bad)">${h(last.error)}</span>` : `${last.rows} rows, ${last.added} new, ${last.updated} updated, ${last.skipped.length} skipped.`} <a href="#/admin/synclog">Sync log</a></p>` : ''}
<p class="muted small" style="margin-top:12px">Required columns: ${h(['Date of KC', 'Emp ID', 'Attempt', 'Obtained Percentage', 'Status'].join(', '))}. Status must say Pass or Fail. Columns are found by their header names, so order does not matter, but do not rename them. Scores are matched to attendees by Emp ID and Attempt (a row for another attempt is never used); if there are several, the nearest Date of KC is used.</p></form>`;
  }
  function adminEmailLog() {
    return `<div class="card flush scroll"><table class="t"><thead><tr><th>Time</th><th>To</th><th>Subject</th><th>Status</th></tr></thead><tbody>
${V.emailLog.map(m => `<tr class="click" data-act="showMail" data-id="${m.id}"><td class="nowrap small">${when(m.at)}</td><td class="small">${h(m.to)}</td><td>${h(m.subject)}</td><td><span class="b ${m.status === 'sent' ? 'good' : m.status === 'failed' || m.status === 'not sent' ? 'bad' : 'pending'}">${h(m.status)}</span>${m.error ? `<div class="small" style="color:var(--bad)">${h(m.error)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No emails yet.</td></tr>'}</tbody></table></div>
${V.settings.smtp.enabled ? '' : '<p class="muted small">Email is off, so these are kept here and not sent. Turn it on under Email.</p>'}`;
  }
  function adminSyncLog() {
    return `<div class="card flush scroll"><table class="t"><thead><tr><th>Time</th><th>By</th><th class="num">Rows</th><th class="num">New</th><th class="num">Updated</th><th class="num">Removed</th><th>Skipped / error</th></tr></thead><tbody>
${V.syncLog.map(l => `<tr><td class="nowrap small">${when(l.at)}</td><td class="small">${l.by ? h(uname(l.by)) : 'Automatic'}</td><td class="num">${l.rows}</td><td class="num">${l.added}</td><td class="num">${l.updated}</td><td class="num">${l.removed}</td>
<td class="small">${l.error ? `<span style="color:var(--bad)">${h(l.error)}</span>` : l.skipped.length ? `<details><summary>${l.skipped.length} skipped</summary>${l.skipped.map(x => `Row ${x.row}${x.empId ? ` (${h(x.empId)})` : ''}: ${h(x.reason)}`).join('<br>')}</details>` : '<span class="muted">None</span>'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">The sheet has not been read yet.</td></tr>'}</tbody></table></div>`;
  }

  /* ---------- modal ---------- */
  function openModal(html) { closeModal(); const d = document.createElement('div'); d.className = 'modal-bg'; d.innerHTML = `<div class="modal">${html}</div>`; document.body.appendChild(d); d.querySelector('input,textarea,select')?.focus(); }
  function closeModal() { document.querySelector('.modal-bg')?.remove(); }

  /* ---------- actions ---------- */
  const formData = form => { const o = {}; for (const el of form.elements) if (el.name) o[el.name] = el.type === 'checkbox' ? el.checked : el.value; return o; };
  const ACT = {
    logout() { API.logout(); },
    pickDay(el) { ui.book.date = el.dataset.date; ui.book.hour = null; ui.book.mode = null; render(); },
    pickSeat(el) { ui.book.hour = Number(el.dataset.hour); ui.book.mode = el.dataset.mode; render(); },
    addAtt() { ui.book.attendees.push({empId:'', name:'', email:''}); render(); },
    rmAtt(el) { ui.book.attendees.splice(Number(el.dataset.i), 1); render(); },
    resetBook() { ui.book = freshBook(); render(); },
    pasteAtt() { openModal(`<h2>Paste attendees</h2><p class="muted small">Copy the rows from your sheet (Emp ID, Name, Email ID, in that order) and paste them here. Up to ${C.DEFAULT_CAP} rows.</p>
<form data-form="paste"><textarea name="text" rows="8" style="width:100%" placeholder="NB41210&#9;Aditi Rao&#9;aditi.rao@nobroker.in"></textarea><div class="row" style="margin-top:12px"><button class="btn primary">Add these</button><button type="button" class="btn ghost" data-act="closeModal">Cancel</button></div></form>`); },
    closeModal,
    openSession(el) { go('#/session/' + el.dataset.id); },
    sessTab(el) { ui.sessFilter.status = el.dataset.k; render(); },
    toggleCancelled(el) { ui.showCancelled = el.checked; render(); },
    cancelBooking(el) { openModal(`<h2>Cancel this booking?</h2><p class="muted">The seats are freed and the attendees, the trainer and the PIA team are emailed.</p>
<form data-form="cancel" data-id="${el.dataset.id}"><label class="f">Reason (optional)<input name="reason"></label><div class="row" style="margin-top:14px"><button class="btn primary">Cancel booking</button><button type="button" class="btn ghost" data-act="closeModal">Keep it</button></div></form>`); },
    async saveMarks(el) { await op('markAttendees', {sessionId:el.dataset.id, marks:marksList(el.dataset.id)}, 'Marks saved.'); },
    async pull(el) {
      const id = el.dataset.id; el.disabled = true; el.textContent = 'Reading the sheet…';
      if (await op('markAttendees', {sessionId:id, marks:marksList(id)}) === null) return;
      await op('pullScores', {sessionId:id}, r => `Sheet read: ${r.log.rows} rows. Scores found for ${r.matched} of ${r.total} attendees.`);
    },
    async submitSession(el) {
      const id = el.dataset.id;
      if (await op('markAttendees', {sessionId:id, marks:marksList(id)}) === null) return;
      if (await op('submitSession', {sessionId:id}, 'Session submitted.')) delete ui.marks[id];
    },
    async reopen(el) { delete ui.marks[el.dataset.id]; await op('reopenSession', {sessionId:el.dataset.id}, 'Session reopened.'); },
    async toggleDay(el) { const d = el.dataset.date, dr = V.slotRules.find(x => x.date === d && x.hour == null); await op('setSlotRule', {date:d, hour:null, closed:!dr?.closed, note:dr?.closed ? '' : 'Closed'}, dr?.closed ? 'Day reopened.' : 'Day closed.'); },
    editSlot(el) { ui.slotEdit = {date:el.dataset.date, hour:Number(el.dataset.hour)}; render(); },
    closeSlotEdit() { ui.slotEdit = null; render(); },
    aRange(el) { const t = V.today, f = ui.aFilters; const k = el.dataset.k;
      if (k === 'today') Object.assign(f, {from:t, to:t}); if (k === 'yesterday') { const y = C.addDays(t, -1); Object.assign(f, {from:y, to:y}); }
      if (k === '7') Object.assign(f, {from:C.addDays(t, -6), to:t}); if (k === 'month') Object.assign(f, {from:t.slice(0, 8) + '01', to:t});
      ui.analytics = null; render(); },
    csv(el) { downloadCsv(el.dataset.k); },
    genKey() { const a = new Uint8Array(24); crypto.getRandomValues(a); const k = Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); const inp = document.querySelector('[data-form=settings] [name=key]'); inp.value = k; inp.type = 'text'; inp.select(); toast('Key generated. Paste it into the script as SECRET_KEY, then click Save.'); },
    async testSheet() { const f = document.querySelector('[data-form=settings]'); if (await op('saveSettings', {section:'sheet', values:formData(f)}) === null) return;
      try { const r = await API.op('testSheet', {}); V = r.view; ui.sheetTest = r.result; } catch (e) { ui.sheetTest = {error:e.message}; } render(); },
    async syncNow() { await op('pullScores', {}, r => `Sheet read: ${r.log.rows} rows, ${r.log.added} new, ${r.log.updated} updated, ${r.log.skipped.length} skipped.`); },
    async testEmail() { const f = document.querySelector('[data-form=settings]'); const v = formData(f);
      if (await op('saveSettings', {section:'smtp', values:v}) === null) return;
      await op('testEmail', {to:v.testTo}, r => `Test email sent to ${r.to}.`); },
    copyScript() { navigator.clipboard?.writeText(ui.appsScript).then(() => toast('Script copied.'), () => toast('Select the script and copy it.', true)); },
    showMail(el) { const m = V.emailLog.find(x => x.id === el.dataset.id); if (m) openModal(`<h2>${h(m.subject)}</h2><p class="muted small">To ${h(m.to)} · ${when(m.at)}</p><pre class="code" style="white-space:pre-wrap;background:#f6f7f9;color:var(--ink)">${h(m.text)}</pre><button class="btn" data-act="closeModal">Close</button>`); },
  };
  function marksList(id) { return Object.entries(ui.marks[id] || {}).map(([attendeeId, m]) => ({attendeeId, completion:m.completion || null, reason:m.reason, reasonNote:m.reasonNote})); }

  const FORM = {
    async book() {
      const b = ui.book; if (b.hour == null) return toast('Pick a slot first.', true);
      const params = {date:b.date, hour:b.hour, mode:b.mode, requestedKcId:b.requestedKcId, category:b.category, attempt:Number(b.attempt), note:b.note, trainerId:b.trainerId || undefined,
        attendees:b.attendees.filter(a => a.empId || a.name || a.email)};
      if (b.editId) { const r = await op('updateBooking', {...params, sessionId:b.editId}, 'Booking updated. Everyone has been emailed.'); if (r) { ui.book = null; go('#/session/' + r.sessionId); } return; }
      const r = await op('book', params, x => x.status === 'pending' ? 'Sent to the administrator for approval.' : 'Slot booked. Attendees, you and the PIA team have been emailed.');
      if (r) { ui.book = null; go('#/session/' + r.sessionId); }
    },
    paste(f, d) {
      const rows = d.text.split(/\r?\n/).map(l => l.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(x => x.trim().replace(/^"|"$/g, ''))).filter(r => r.some(Boolean))
        .filter(r => !/emp\s*id/i.test(r[0] || '')).map(r => ({empId:r[0] || '', name:r[1] || '', email:r[2] || ''}));
      if (!rows.length) return toast('Nothing to add.', true);
      const kept = ui.book.attendees.filter(a => a.empId || a.name || a.email);
      ui.book.attendees = [...kept, ...rows].slice(0, C.DEFAULT_CAP);
      if (kept.length + rows.length > C.DEFAULT_CAP) toast(`Only ${C.DEFAULT_CAP} attendees fit in one booking; the rest were left out.`, true);
      closeModal(); render();
    },
    async cancel(f, d) { closeModal(); await op('cancelBooking', {sessionId:f.dataset.id, reason:d.reason}, 'Booking cancelled. Everyone has been emailed.'); },
    async assign(f, d) { await op('assignKc', {sessionId:f.dataset.id, kcId:d.kcId}, 'KC assigned. You are recorded as the invigilator.'); },
    async decide(f, d, submitter) { await op('decideApproval', {approvalId:f.dataset.id, approve:submitter?.value === '1', date:d.date, hour:Number(d.hour), mode:d.mode, note:d.note}, submitter?.value === '1' ? 'Approved and booked.' : 'Request rejected.'); },
    async slotRule(f, d) { if (await op('setSlotRule', {date:f.dataset.date, hour:Number(f.dataset.hour), closed:d.closed, note:d.note, capOnline:d.capOnline, capOffline:d.capOffline}, 'Slot saved.') !== null) { ui.slotEdit = null; render(); } },
    async saveUser(f, d) { const r = await op('saveUser', {id:f.dataset.id || undefined, name:d.name, email:d.email, role:d.role || 'admin', active:d.active === undefined ? true : d.active}, f.dataset.id ? 'User saved.' : 'User added.'); if (r) go('#/admin/users'); },
    async saveKc(f, d) { const r = await op('saveKc', {id:f.dataset.id || undefined, name:d.name, type:d.type, active:d.active === undefined ? true : d.active}, f.dataset.id ? 'KC saved.' : 'KC added.'); if (r) go('#/admin/kcs'); },
    async settings(f, d) { await op('saveSettings', {section:f.dataset.section, values:d}, 'Settings saved.'); },
  };

  $app.parentElement.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    if (!ACT[el.dataset.act]) return; e.preventDefault(); ACT[el.dataset.act](el, e);
  });
  $app.parentElement.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.act === 'toggleCancelled') return ACT.toggleCancelled(el);
    if (el.dataset.act === 'sessMode') { ui.sessFilter.mode = el.value; return render(); }
    if (el.dataset.af) { ui.aFilters[el.dataset.af] = el.value; ui.analytics = null; return render(); }
    if (el.dataset.mark) { const m = ui.marks[route().parts[1]][el.dataset.mark]; m[el.dataset.k] = el.value; if (el.dataset.k === 'completion' && el.value !== 'not_completed') { m.reason = ''; m.reasonNote = ''; } if (el.tagName === 'SELECT') render(); return; }
    if (el.dataset.draft) { ui.book[el.dataset.draft] = el.value; if (el.dataset.rerender) render(); }
  });
  $app.parentElement.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.att != null) ui.book.attendees[Number(el.dataset.att)][el.dataset.k] = el.value;
    else if (el.dataset.draft && el.tagName !== 'SELECT') ui.book[el.dataset.draft] = el.value;
    else if (el.dataset.mark && el.tagName === 'INPUT') ui.marks[route().parts[1]][el.dataset.mark][el.dataset.k] = el.value;
    else if (el.dataset.act === 'sessQ') { ui.sessFilter.q = el.value; const pos = el.selectionStart; render(); const n = document.querySelector('[data-act=sessQ]'); n.focus(); n.setSelectionRange(pos, pos); }
  });
  $app.parentElement.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault();
    FORM[f.dataset.form]?.(f, formData(f), e.submitter);
  });

  /* ---------- start ---------- */
  async function boot() {
    try { const r = await API.boot(); if (r.view) { V = r.view; B = null; } else { V = null; B = r; } }
    catch (e) { if (e.status === 401) { location.href = '../auth/login?next=' + encodeURIComponent(location.pathname); return; } V = null; B = {site:'Pick Timer', error:'Could not reach the server. ' + e.message}; }
    render();
  }
  function switchRole(role) { setViewAs(role); ui.analytics = null; ui.marks = {}; ui.book = null; if (location.hash) location.hash = ''; boot(); }
  document.addEventListener('change', e => { if (e.target.matches('[data-role-switch]')) switchRole(e.target.value); });
  document.addEventListener('click', e => { if (e.target.closest('[data-role-back]')) switchRole('admin'); });
  window.KCApp = {boot, render, get view() { return V; }};
  boot();
})();
