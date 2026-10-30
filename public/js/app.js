/* Trainer Desk page (plain JavaScript, no framework). Data comes from the REST API through js/api.js. */
(function () {
  'use strict';
  var root = document.getElementById('app');
  var PAGE = 100;            // unclaimed candidates shown per step
  var MAX_ASSIGN = 200;      // keep in step with CONFIG.MAX_ASSIGN in Code.gs
  var NO_DEPT = '(none)';    // department filter value for people with no department
  // Tabs in display order. ready:false shows a placeholder until that tab is built.
  // Home-screen cards in display order. ready:false opens a placeholder until that section is built.
  var TABS = [
    { id: 'approvals',  label: 'Approvals',                   ready: true,  adminOnly: true,
      blurb: 'Changes trainers have sent for approval: departments, training start dates and mock results.' },
    { id: 'unclaimed',  label: 'Unclaimed Candidates',        ready: true,  month: true,
      blurb: 'New joiners in the HR sheets who are not mapped to a trainer yet. Select and assign them to yourself.' },
    { id: 'attendance', label: 'Attendance Tracker',          ready: true,
      blurb: 'Mark daily attendance for everyone in training, from their DOJ onwards.' },
    { id: 'nht',        label: 'Active NHT Details',          ready: true,
      blurb: 'Everyone you claimed who is still in training. Open a trainee: set their department and sub-team first, then the rest.' },
    { id: 'ojt',        label: 'OJT Performance',             ready: true,
      blurb: 'Trainees marked OJT Entered and OJT Eligible: OJT start from their first call in Talktime, 30-day OJT window and talktime so far.' },
    { id: 'perfNew',    label: 'Performance Dashboard (New)', ready: true,
      blurb: 'The New Cal view: attrition by 15, 30 and 45 days completed, NHP from OJT results and NHT graduation, by month.' },
    { id: 'perfOld',    label: 'Performance Dashboard (Old)', ready: true,
      blurb: 'Your monthly scorecard on the T&D Performance Tracker rules: KC, mock, OJT, attrition and BQ, final score and incentive.' },
    { id: 'batches',    label: 'Batch Wise Summary',          ready: true,  month: true,
      blurb: 'Every batch you trained, with mock, OJT and 45-day attrition figures and the trainee list.' }
  ];
  var ICONS = {
    approvals:  '<path d="M9 12l2 2 4-4"/><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"/>',
    unclaimed:  '<path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M19 8v6M16 11h6"/>',
    attendance: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="m8.5 15 2.5 2.5 4.5-4.5"/>',
    nht:        '<path d="M2 9l10-5 10 5-10 5-10-5Z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>',
    ojt:        '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    perfNew:    '<path d="M3 17l5-5 4 4 8-8"/><path d="M15 8h5v5"/>',
    perfOld:    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    batches:    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'
  };
  function icon(id) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[id] || '') + '</svg>'; }
  function tabById(id) { return TABS.filter(function (t) { return t.id === id; })[0] || null; }

  var state = {
    screen: 'signin',        // signin | app
    session: null,           // from getSession()
    trainer: '',             // trainer currently open
    view: null,              // from getTrainerBatches()
    tab: 'batches',          // batches | unclaimed
    month: '',               // 'yyyy-MM' on DOJ, '' = all months
    filter: 'All',
    openKey: '',
    unclaimed: null,         // from getUnclaimedCandidates()
    picked: {},              // empId -> true
    query: '',
    show: 'active',          // unclaimed list: active | all | removed (admins only)
    dept: '',                // unclaimed list department filter, '' = all
    reason: '',              // admin: reason typed for removal
    shown: PAGE,
    trainingStart: '',
    notice: null,            // { tone, text, items }
    att: null,               // from getAttendance()
    attDate: '',             // day being marked
    attScope: 'current',     // current | all
    attPending: {},          // date -> { empId: code or '' } not yet saved
    attView: 'day',          // day | register
    attMonth: '',            // register month 'yyyy-MM'
    attEdit: null,           // register cell being edited { id, date }
    nht: null,               // from getNhtCandidates()
    nhtOpen: '',             // Emp ID shown in the detail dialog
    nhtDept: '', nhtSub: '', // dropdown values in the dialog
    nhtQuery: '',
    nhtOnlyMissing: false,   // show only trainees without a department
    nhtMsg: {},              // per-section message in the dialog: field -> { tone, text }
    nhtTs: '', nhtTsEdit: false,                  // training start date being edited
    nhtMock: null,           // mock form { date, attempt, score, status, final }
    nhtMockEdit: null,       // recorded attempt being corrected { attempt, date, score, status, final }
    nhtOjt: {},              // OJT Yes/No answers being chosen: field -> 'Yes' | 'No'
    approvals: null,         // admins: from getPendingApprovals()
    perf: {},                // Performance Dashboard (Old): month -> view from getPerformanceOld()
    perfMonth: null,         // 'yyyy-MM', '' = all months; null until first opened
    perfN: {}, perfNMonth: null, perfNOpen: '',   // Performance Dashboard (New), same idea
    ojtView: null,           // from getOjtSummary()
    ojtFilter: 'In OJT',
    ojtOpen: '',             // Emp ID whose OJT details are open
    ojtTeamPick: {},         // empId -> team key being chosen
    ojtTeamEdit: '',
    ojtShowAll: {},          // 'filter|team' -> true once "Show more" is pressed         // Emp ID whose OJT team picker is open
    ojtInput: {},            // 'empId|metric' -> value being typed
    ojtMsg: {},              // empId -> { tone, text } after a save
    apprPicked: {},          // request id -> true
    apprNote: '',
    busy: false,
    error: ''
  };

  /* ---------- data access: the REST API (js/api.js) ---------- */
  var call = window.deskApi.call;

  /* ---------- helpers ---------- */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function day(iso) {
    if (!iso) return '–';
    var p = iso.split('-');
    return (+p[2]) + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0];
  }
  function monthName(ym) { var p = ym.split('-'); return MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function inMonth(doj) { return !state.month || String(doj || '').slice(0, 7) === state.month; }
  function pct(n, d) { return d ? Math.round(100 * n / d) + '%' : '–'; }
  function sum(list, k) { return list.reduce(function (a, b) { return a + b[k]; }, 0); }
  function plural(n, one, many) { return n.toLocaleString('en-IN') + ' ' + (n === 1 ? one : many); }
  function stageClass(s) { return s === 'In training' ? 'training' : s === 'In OJT' ? 'ojt' : s === 'OJT pending' ? 'pending' : 'done'; }
  var ALL = 'all';            // the trainer picker's first option: every trainer this person can open
  function trainerName(email) {
    if (email === ALL) return 'All trainers';
    var t = (state.session.trainers || []).filter(function (x) { return x.email === email; })[0];
    return t ? t.name : email;
  }
  /** In the All trainers view, the trainer a row belongs to (shown next to the Emp ID). */
  function byTrainer(x) { return state.trainer === ALL && x && x.trainer ? ' · ' + esc(trainerName(x.trainer)) : ''; }

  /** Batch figures for a set of trainees. Same counting rules as the T&D Performance Tracker. */
  function figures(b, trainees) {
    var joined = function (p) { return p.attritionDay !== 0; };
    var count = function (f) { return trainees.filter(f).length; };
    var subs = {};
    trainees.forEach(function (p) { var k = p.subTeam || p.dept || 'Unassigned'; subs[k] = (subs[k] || 0) + 1; });
    return {
      key: b.key, number: b.number, name: b.name, start: b.start, trainingEnd: b.trainingEnd,
      ojtStart: b.ojtStart, ojtEnd: b.ojtEnd, stage: b.stage, trainees: trainees, full: b.trainees.length,
      size: trainees.length,
      wfo: count(function (p) { return p.mode === 'WFO'; }),
      wfh: count(function (p) { return p.mode === 'WFH'; }),
      active: count(function (p) { return p.active; }),
      joiners: count(joined),
      mockAttempted: count(function (p) { return joined(p) && (p.mockStatus === 'Pass' || p.mockStatus === 'Fail'); }),
      mockFirstPass: count(function (p) { return joined(p) && p.mockStatus === 'Pass' && p.mockAttempt === '1st'; }),
      ojtDone: count(function (p) { return joined(p) && p.ojtPct !== null; }),
      ojtCleared: count(function (p) { return joined(p) && p.ojtPct !== null && p.ojtPct >= 0.7; }),
      exits45: count(function (p) { return p.attritionDay !== null && p.attritionDay >= 1 && p.attritionDay <= 45; }),
      subTeams: Object.keys(subs).map(function (k) { return { name: k, count: subs[k] }; })
        .sort(function (x, y) { return y.count - x.count || x.name.localeCompare(y.name); })
    };
  }
  /** Batches after the DOJ month filter; batches with nobody in that month drop out. */
  function visibleBatches() {
    return state.view.batches.map(function (b) {
      return figures(b, b.trainees.filter(function (p) { return inMonth(p.doj); }));
    }).filter(function (b) { return b.size > 0; });
  }
  function monthOptions() {
    var set = {};
    if (state.view) state.view.batches.forEach(function (b) { b.trainees.forEach(function (p) { if (p.doj) set[p.doj.slice(0, 7)] = 1; }); });
    if (state.unclaimed) state.unclaimed.forEach(function (c) { if (c.doj) set[c.doj.slice(0, 7)] = 1; });
    if (state.month) set[state.month] = 1;
    return Object.keys(set).sort().reverse();
  }
  /** Unclaimed people in the month filter. Removed ones only when asked for (admins). */
  function unclaimedInMonth(removed) {
    return (state.unclaimed || []).filter(function (c) { return inMonth(c.doj) && (!!c.excluded === !!removed); });
  }
  function unclaimedPool() {
    var removedView = state.show === 'removed';
    return unclaimedInMonth(removedView).filter(function (c) { return removedView || state.show === 'all' || c.active; });
  }
  function unclaimedMatches() {
    var q = state.query.trim().toLowerCase();
    return unclaimedPool().filter(function (c) {
      if (state.dept && (c.department || NO_DEPT) !== state.dept) return false;
      return !q || c.name.toLowerCase().indexOf(q) >= 0 || c.empId.toLowerCase().indexOf(q) >= 0 || c.location.toLowerCase().indexOf(q) >= 0 ||
        (c.department || '').toLowerCase().indexOf(q) >= 0;
    });
  }
  function pickedIds() { return Object.keys(state.picked); }

  /* ---------- sign-in screen ---------- */
  function renderSignin() {
    var s = state.session, body = '';
    if (state.error) body += '<div class="notice crit">' + esc(state.error) + '</div>';

    if (s && s.email) {
      body += '<div class="account"><span class="label">Google account</span><br>' + esc(s.email) + '</div>';
    }

    if (s && s.role === 'none') {
      body += '<div class="notice crit">' +
        (s.email ? esc(s.email) + ' is not on the trainer list. Ask your manager to add you to the Scoring_Master sheet.'
                 : 'Your Google account could not be read. Open this link while signed in to your nobroker.in account.') +
        '</div>';
    }

    var canEnter = !s || s.role !== 'none';
    var switchLink = window.deskApi.preview ? '' : '<a href="auth/logout">Use a different Google account</a>';

    root.innerHTML =
      '<main class="signin"><div class="signin-card">' +
        '<div class="wordmark"><i></i>Trainer Desk</div>' +
        '<div><h1>Your batches, from day one to OJT</h1>' +
        '<p>Sign in with your nobroker.in Google account to open your batches.</p></div>' +
        body +
        '<div class="signin-actions">' +
          (canEnter ? '<button class="btn btn-primary" id="enter"' + (state.busy ? ' disabled' : '') + '>' +
            (state.busy ? 'Signing in…' : 'Continue with Google') + '</button>' : '') +
          switchLink +
        '</div>' +
      '</div></main>';

    var btn = document.getElementById('enter');
    if (btn) btn.onclick = enter;
  }

  function enter() {
    state.busy = true; state.error = ''; renderSignin();
    call('getSession').then(function (s) {
      state.session = s; state.busy = false;
      if (!s || s.role === 'none') { renderSignin(); return; }
      state.screen = 'app'; state.tab = 'home'; state.month = ''; state.notice = null;
      var own = s.trainers.filter(function (t) { return t.email === s.email; })[0];
      openTrainer(s.trainers.length > 1 ? ALL : (own || s.trainers[0] || {}).email || '');
      loadUnclaimed();
      if (s.isAdmin) loadApprovals();
    }).catch(fail);
  }
  function fail(e) {
    state.busy = false;
    state.error = (e && e.message) ? e.message : 'Something went wrong. Reload and try again.';
    if (state.screen === 'signin') renderSignin(); else renderApp();
  }

  /* ---------- loading ---------- */
  function openTrainer(email, keepOpen) {
    state.trainer = email; state.view = null; state.error = '';
    if (!state.att || state.att.trainer !== email) { state.att = null; state.attPending = {}; }
    if (state.nht && state.nht.trainer !== email) { state.nht = null; state.nhtOpen = ''; }
    if (state.ojtView && state.ojtView.trainer !== email) state.ojtView = null;
    if (!keepOpen) { state.filter = 'All'; state.openKey = ''; }
    renderApp();
    if (!email) return;
    call('getTrainerBatches', email).then(function (v) {
      if (state.trainer !== email) return;
      state.view = v;
      renderApp();
    }).catch(fail);
  }
  /** quiet: refresh in the background (new joiners from the HR sheets) without clearing the list first. */
  function loadUnclaimed(quiet) {
    var before = quiet && state.unclaimed ? state.unclaimed.map(function (c) { return c.empId + (c.excluded ? '-' : ''); }).join() : null;
    if (!quiet) state.unclaimed = null;
    call('getUnclaimedCandidates').then(function (list) {
      list = list || [];
      if (quiet && before === list.map(function (c) { return c.empId + (c.excluded ? '-' : ''); }).join()) return;   // nothing new
      if (quiet && (state.busy || /^(INPUT|SELECT|TEXTAREA)$/.test((document.activeElement || {}).tagName || ''))) return;   // try again next minute
      state.unclaimed = list;
      var still = {};
      state.unclaimed.forEach(function (c) { if (state.picked[c.empId]) still[c.empId] = true; });
      state.picked = still;
      if (state.screen === 'app') renderApp();
    }).catch(fail);
  }

  /** Whom Assign gives candidates to: the trainer open at the top, or (All trainers) the one picked in the bar. */
  function assignTarget() {
    if (state.trainer !== ALL) return state.trainer;
    if (state.assignTo === undefined) state.assignTo = state.session.trainers.some(function (t) { return t.email === state.session.email; }) ? state.session.email : '';
    return state.assignTo;
  }
  function assign() {
    var ids = pickedIds();
    var trainer = assignTarget();
    if (!ids.length || state.busy || !trainer) return;
    state.busy = true; state.notice = null; renderApp();
    call('assignCandidates', { ids: ids, trainer: trainer, trainingStart: state.trainingStart }).then(function (res) {
      state.busy = false; state.picked = {};
      var who = trainer === state.session.email ? 'you' : trainerName(trainer);
      var done = res.assigned.length, skipped = res.skipped || [];
      state.notice = {
        tone: skipped.length ? 'warn' : 'good',
        text: (done ? plural(done, 'candidate', 'candidates') + ' assigned to ' + who + '. They are now in the Attendance Tracker.' : 'Nobody was assigned.') +
              (skipped.length ? ' ' + plural(skipped.length, 'candidate was', 'candidates were') + ' skipped:' : ''),
        items: skipped.map(function (x) { return x.empId + ' – ' + x.reason; })
      };
      state.unclaimed = (state.unclaimed || []).filter(function (c) { return res.assigned.indexOf(c.empId) < 0; });
      renderApp();
      state.att = null;                // attendance roster reloads with the new trainees
      state.nht = null;                // so does the NHT list
      openTrainer(state.trainer, true); // pull the new rows into the batch view
      if (skipped.length) loadUnclaimed();
    }).catch(fail);
  }

  function exclude() {
    var ids = pickedIds();
    if (!ids.length || state.busy) return;
    state.busy = true; state.notice = null; renderApp();
    call('excludeCandidates', { ids: ids, reason: state.reason }).then(function (res) {
      state.busy = false; state.picked = {};
      var on = {}; res.removed.forEach(function (id) { on[id] = true; });
      (state.unclaimed || []).forEach(function (c) {
        if (on[c.empId]) c.excluded = { reason: res.reason, by: state.session.email, on: state.view && state.view.today || '' };
      });
      var skipped = res.skipped || [];
      state.notice = {
        tone: skipped.length ? 'warn' : 'good',
        text: (res.removed.length ? plural(res.removed.length, 'candidate', 'candidates') + ' removed from the list. Find them under Removed to restore.' : 'Nobody was removed.') +
              (skipped.length ? ' ' + plural(skipped.length, 'candidate was', 'candidates were') + ' skipped:' : ''),
        items: skipped.map(function (x) { return x.empId + ' – ' + x.reason; })
      };
      renderApp();
    }).catch(fail);
  }
  function restore() {
    var ids = pickedIds();
    if (!ids.length || state.busy) return;
    state.busy = true; state.notice = null; renderApp();
    call('restoreCandidates', { ids: ids }).then(function (res) {
      state.busy = false; state.picked = {};
      (state.unclaimed || []).forEach(function (c) { if (res.restored.indexOf(c.empId) >= 0) c.excluded = null; });
      state.notice = { tone: 'good', text: plural(res.restored.length, 'candidate', 'candidates') + ' back on the unclaimed list.', items: [] };
      renderApp();
    }).catch(fail);
  }

  /* ---------- app ---------- */
  function renderApp() {
    var s = state.session, v = state.view;
    var picker = s.trainers.length > 1
      ? '<label class="who"><span class="label">Trainer</span><select id="trainer-pick">' +
          '<option value="' + ALL + '"' + (state.trainer === ALL ? ' selected' : '') + '>All trainers</option>' + s.trainers.map(function (t) {
          return '<option value="' + esc(t.email) + '"' + (t.email === state.trainer ? ' selected' : '') + '>' + esc(t.name) + '</option>';
        }).join('') + '</select></label>'
      : '';

    var html =
      (window.deskApi.preview ? '<div class="preview-flag">Local preview with made-up data. Saves stay on this computer.</div>' : '') +
      '<header class="topbar"><div class="topbar-in">' +
        '<button class="wordmark home-link" data-tab="home" aria-label="Trainer Desk home"><i></i>Trainer Desk</button>' + picker +
        '<div class="who"><b>' + esc(s.name) + '</b><span class="chip">' + esc(s.roleLabel) + '</span>' + (s.isAdmin && s.role !== 'admin' ? '<span class="chip">Admin</span>' : '') + '</div>' +
        (s.pickTimer ? '<a class="btn pick-btn" href="pick-timer/" title="KC slot booking and close-out"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>Pick Timer</a>' : '') +
        (s.isAdmin ? '<button class="btn appr-btn" data-tab="approvals">Approvals<span class="count' + (state.approvals && state.approvals.length ? ' hot' : '') + '">' + (state.approvals ? state.approvals.length : '…') + '</span></button>' : '') +
        '<button class="btn" id="signout">Sign out</button>' +
      '</div></header><div class="page">';

    var mine = state.trainer === s.email;
    var monthSel = '<div class="field"><label class="label" for="month">Month of joining</label><select id="month">' +
      '<option value="">All months</option>' + monthOptions().map(function (m) {
        return '<option value="' + m + '"' + (m === state.month ? ' selected' : '') + '>' + monthName(m) + '</option>';
      }).join('') + '</select></div>';
    var tab = tabById(state.tab), who = mine ? s.name : trainerName(state.trainer);
    if (!tab) {
      html += homePage(who, mine);
    } else {
      var title = tab.id === 'batches'
        ? '<div class="label">' + (mine ? 'My batches' : state.trainer === ALL ? 'All trainers\' batches' : 'Batches of ' + esc(who)) + '</div><h1>Batch Wise Summary</h1>'
        : tab.id === 'unclaimed'
        ? '<div class="label">Not mapped to any trainer yet</div><h1>Unclaimed Candidates</h1>'
        : tab.id === 'approvals'
        ? '<div class="label">Admin</div><h1>Approvals</h1>'
        : tab.id === 'perfNew'
        ? '<div class="label">New Cal rules</div><h1>Performance Dashboard (New)</h1>'
        : tab.id === 'perfOld'
        ? '<div class="label">T&amp;D Performance Tracker rules</div><h1>Performance Dashboard (Old)</h1>'
        : '<div class="label">' + esc(who) + '</div><h1>' + esc(tab.label) + '</h1>';
      html += '<nav class="crumbs" aria-label="Breadcrumb"><button class="back" data-tab="home">← Home</button><span class="dim">/</span><span>' + esc(tab.label) + '</span></nav>' +
        '<div class="page-head"><div>' + title + '</div>' + (tab.month ? '<div class="tools">' + monthSel + '</div>' : '') + '</div>';
    }

    if (state.error) html += '<div class="notice crit">' + esc(state.error) + '</div>';
    if (state.notice) {
      html += '<div class="notice ' + state.notice.tone + '">' + esc(state.notice.text) +
        (state.notice.items.length ? '<ul>' + state.notice.items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
    }

    html += (!tab ? '' : tab.id === 'batches' ? batchesPage(v) : tab.id === 'unclaimed' ? unclaimedPage() : tab.id === 'attendance' ? attendancePage() : tab.id === 'nht' ? nhtPage() : tab.id === 'approvals' ? approvalsPage() : tab.id === 'perfOld' ? perfOldPage() : tab.id === 'perfNew' ? perfNewPage() : tab.id === 'ojt' ? ojtPage() : comingSoon(tab)) + '</div>' + (tab && tab.id === 'nht' ? nhtDialog() : '');
    root.innerHTML = html;
    wire();
  }

  /* ---------- page: batches ---------- */
  function batchesPage(v) {
    if (!v) return '<div class="loading">Loading batches…</div>';
    var all = visibleBatches(), numbered = v.batches.filter(function (b) { return b.number > 0; });
    var scope = state.month ? 'Joined in ' + monthName(state.month) : (numbered.length ? 'Batch 1 started ' + day(numbered[0].start) : '');

    var html = '<div class="sub dim">' + esc(scope) + (scope ? ' · ' : '') + 'Batches are numbered by training start date</div>' +
      '<section class="summary" aria-label="Totals">' +
      tile(all.filter(function (b) { return b.number > 0; }).length, 'Batches') +
      tile(sum(all, 'size'), 'Trainees') +
      tile(sum(all, 'active'), 'Active today') +
      tile(pct(sum(all, 'mockFirstPass'), sum(all, 'mockAttempted')), 'Mock cleared first attempt') +
      tile(pct(sum(all, 'ojtCleared'), sum(all, 'ojtDone')), 'OJT at 70% or above') +
      tile(pct(sum(all, 'exits45'), sum(all, 'joiners')), 'Left within 45 days') +
      '</section>';

    if (!all.length) {
      return html + '<div class="empty">' + (state.month ? 'Nobody under this trainer joined in ' + esc(monthName(state.month)) + '.' : 'No batches yet. Open Unclaimed Candidates from the home screen to assign the first trainees.') + '</div>';
    }

    var stages = ['All', 'In training', 'OJT pending', 'In OJT', 'Completed'];
    var shown = all.filter(function (b) { return state.filter === 'All' || b.stage === state.filter; }).slice().reverse();
    var open = all.filter(function (b) { return b.key === state.openKey; })[0] ||
               all.filter(function (b) { return b.number > 0; }).slice(-1)[0] || all[0];
    state.openKey = open.key;

    html += '<div class="work"><section class="register" aria-label="Batches">' +
      '<div class="filters">' + stages.map(function (st) {
        var n = st === 'All' ? all.length : all.filter(function (b) { return b.stage === st; }).length;
        return '<button class="filter" data-filter="' + st + '" aria-pressed="' + (state.filter === st) + '">' + st + '<span class="num">' + n + '</span></button>';
      }).join('') + '</div>' +
      '<div class="batch-list">' + (shown.length ? shown.map(batchRow).join('') : '<div class="empty">No batches at this stage.</div>') + '</div>' +
      '</section>' +
      '<section class="detail" id="detail" aria-live="polite">' + batchDetail(open) + '</section></div>';
    return html;
  }

  function tile(v, n) { return '<div><span class="v">' + esc(v) + '</span><span class="n">' + esc(n) + '</span></div>'; }

  function batchRow(b) {
    var teams = b.subTeams.map(function (t) { return t.name; }).join(', ');
    return '<button class="batch" data-key="' + esc(b.key) + '" aria-current="' + (b.key === state.openKey) + '">' +
      '<span class="t">' + esc(b.name) + '</span>' +
      '<span><span class="pill ' + stageClass(b.stage) + '">' + esc(b.stage) + '</span></span>' +
      '<span class="d">' + (b.start ? 'Started ' + esc(day(b.start)) : 'Training start date missing') + '</span>' +
      '<span class="c num">' + b.active + '/' + b.size + ' active</span>' +
      '<span class="s">' + esc(teams) + '</span>' +
      '</button>';
  }

  function meter(label, n, d, tone) {
    var w = d ? Math.min(100, Math.round(100 * n / d)) : 0;
    return '<div class="meter"><span class="label">' + esc(label) + '</span>' +
      '<div class="row"><span class="big">' + pct(n, d) + '</span><span class="frac num">' + n + ' of ' + d + '</span></div>' +
      '<div class="track"><i class="' + (tone || '') + '" style="width:' + w + '%"></i></div></div>';
  }

  function batchDetail(b) {
    var rows = b.trainees.map(function (p) {
      var mock = p.mockStatus
        ? '<span class="pill ' + (p.mockStatus === 'Pass' ? 'good' : 'crit') + '">' + esc(p.mockStatus) + '</span>' + (p.mockAttempt ? ' <span class="dim">' + esc(p.mockAttempt) + '</span>' : '')
        : '<span class="dim">–</span>';
      var kc = p.kcStatus
        ? '<span class="pill ' + (p.kcStatus === 'Pass' ? 'good' : 'crit') + '">' + esc(p.kcStatus) + '</span>' + (p.kcScore !== null ? ' <span class="dim num">' + Math.round(p.kcScore) + '%</span>' : '')
        : '<span class="dim">–</span>';
      var ojt = p.ojtPct !== null
        ? '<span class="pill ' + (p.ojtPct >= 0.7 ? 'good' : 'warn') + ' num">' + Math.round(p.ojtPct * 100) + '%</span>'
        : (p.ojtStart ? '<span class="dim">In progress</span>' : '<span class="dim">–</span>');
      var status = p.active
        ? '<span class="pill good">Active</span>'
        : '<span class="pill crit">Left</span>' + (p.attritionDay !== null ? ' <span class="dim num">day ' + p.attritionDay + '</span>' : '');
      return '<tr><td><div class="nm">' + esc(p.name) + (p.lateral ? ' <span class="chip">Lateral</span>' : '') + '</div><div class="id">' + esc(p.empId) + byTrainer(p) + '</div></td>' +
        '<td class="num">' + esc(day(p.doj)) + '</td>' +
        '<td>' + esc(p.subTeam || p.dept || '–') + '</td>' +
        '<td>' + esc(p.mode) + '</td>' +
        '<td>' + kc + '</td>' +
        '<td>' + mock + '</td>' +
        '<td class="r num">' + (p.trainingDays !== null ? p.trainingDays : '–') + '</td>' +
        '<td>' + ojt + '</td>' +
        '<td>' + status + '</td></tr>';
    }).join('');

    var partial = b.size < b.full ? ' · showing ' + b.size + ' of ' + b.full + ' who joined in ' + monthName(state.month) : '';
    return '<div class="detail-head"><h2>' + esc(b.name) + '</h2><span class="pill ' + stageClass(b.stage) + '">' + esc(b.stage) + '</span>' +
        '<span class="dim num">' + plural(b.size, 'trainee', 'trainees') + ' · ' + b.wfo + ' WFO · ' + b.wfh + ' WFH' + esc(partial) + '</span></div>' +
      '<div class="timeline">' +
        '<div><span class="label">Training started</span><span class="v">' + esc(day(b.start)) + '</span></div>' +
        '<div><span class="label">Training ended</span><span class="v">' + esc(day(b.trainingEnd)) + '</span></div>' +
        '<div><span class="label">OJT started</span><span class="v">' + esc(day(b.ojtStart)) + '</span></div>' +
        '<div><span class="label">OJT ends</span><span class="v">' + esc(day(b.ojtEnd)) + '</span></div>' +
      '</div>' +
      '<div class="meters">' +
        meter('Still active', b.active, b.size) +
        meter('Mock cleared first attempt', b.mockFirstPass, b.mockAttempted) +
        meter('OJT at 70% or above', b.ojtCleared, b.ojtDone) +
        meter('Left within 45 days', b.exits45, b.joiners, 'crit') +
      '</div>' +
      '<div class="teams">' + b.subTeams.map(function (t) { return '<span class="team">' + esc(t.name) + '<span class="num">' + t.count + '</span></span>'; }).join('') + '</div>' +
      '<div class="table-wrap"><table><thead><tr><th>Trainee</th><th>DOJ</th><th>Sub-team</th><th>Mode</th><th>KC</th><th>Mock</th><th class="r">Training days</th><th>OJT</th><th>Status</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  /* ---------- home ---------- */
  function homePage(who, mine) {
    var v = state.view, batches = v ? v.batches.filter(function (b) { return b.number > 0; }) : null;
    var active = v ? v.batches.reduce(function (a, b) { return a + b.trainees.filter(function (p) { return p.active; }).length; }, 0) : 0;
    var stat = {
      perfOld: perfHomeStat(),
      ojt: state.ojtView ? plural(state.ojtView.rows.filter(function (r) { return r.status === 'In OJT'; }).length, 'trainee', 'trainees') + ' in OJT · ' + state.ojtView.rows.filter(function (r) { return r.status === 'Waiting for first call'; }).length + ' waiting for a first call' : 'Open to see who is in OJT',
      perfNew: perfNHomeStat(),
      approvals: state.approvals ? (state.approvals.length ? plural(state.approvals.length, 'change', 'changes') + ' waiting for you' : 'Nothing waiting') : 'Loading…',
      attendance: state.att ? attHomeStat() : 'Open to mark today\'s attendance',
      nht: state.nht ? plural(state.nht.candidates.length, 'trainee', 'trainees') + ' in training · ' + state.nht.candidates.filter(function (c) { return !c.department; }).length + ' without a department' : 'Open to see who is in training',
      batches: batches ? plural(batches.length, 'batch', 'batches') + ' · ' + plural(active, 'active trainee', 'active trainees') : 'Loading…',
      unclaimed: state.unclaimed ? plural(state.unclaimed.filter(function (c) { return c.active && !c.excluded; }).length, 'active candidate', 'active candidates') + ' waiting' : 'Loading…'
    };
    var first = (who || '').split(' ')[0];
    var all = state.trainer === ALL;
    return '<div class="home-head"><div class="label">' + (mine ? 'Trainer Desk' : 'Viewing as ' + esc((state.session.roleLabel || 'manager').toLowerCase())) + '</div>' +
      '<h1>' + (mine ? 'Welcome, ' + esc(first) : all ? 'All trainers' : esc(who)) + '</h1>' +
      '<p class="dim">' + (all ? 'Everything below covers all ' + state.session.trainers.length + ' trainers you can see. Pick a trainer at the top to see just theirs.' : 'Pick what you want to work on.') + '</p></div>' +
      (state.error ? '' : '') +
      '<div class="cards">' + TABS.filter(function (t) { return !t.adminOnly || state.session.isAdmin; }).map(function (t) {
        return '<button class="card' + (t.ready ? '' : ' later') + '" data-tab="' + t.id + '">' +
          '<span class="card-top"><span class="card-icon">' + icon(t.id) + '</span>' +
          (t.ready ? '' : '<span class="pill done">Coming soon</span>') + '</span>' +
          '<span class="card-title">' + esc(t.label) + '</span>' +
          '<span class="card-blurb">' + esc(t.ready ? t.blurb : 'This section is being built.') + '</span>' +
          (t.ready ? '<span class="card-stat num">' + esc(stat[t.id] || '') + '</span>' : '') +
          '<span class="card-go" aria-hidden="true">Open →</span>' +
        '</button>';
      }).join('') + '</div>';
  }

  /* ---------- page: attendance tracker ---------- */
  var CODE_LABEL = { P: 'Present', L: 'Leave', WO: 'Weekoff', NCNS: 'NCNS', LWD: 'LWD' };
  var CODE_SHORT = { P: 'P', L: 'L', WO: 'W', NCNS: 'N', LWD: 'X' };
  var STRIP_DAYS = 14;
  function ordinal(n) { n = Number(n); var t = n % 100, u = n % 10; return n + (t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'); }
  function attemptNumber(v) { var m = String(v == null ? '' : v).match(/\d+/); return m ? Number(m[0]) : 0; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function addDays(iso, n) {
    var p = iso.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }
  function weekday(iso) { var p = iso.split('-'); return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay()]; }
  function daysBetween(a, b) {
    var pa = a.split('-'), pb = b.split('-');
    return Math.round((Date.UTC(+pb[0], +pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], +pa[1] - 1, +pa[2])) / 86400000);
  }
  /** Saved mark with any unsaved change on top. */
  function attCode(id, date) {
    var p = state.attPending[date];
    if (p && has(p, id)) return p[id];
    var m = state.att.marks[id];
    return (m && m[date]) || '';
  }
  /** Earliest date marked LWD (saved or unsaved). */
  function lwdOf(t) {
    var best = '', dates = Object.keys(state.att.marks[t.empId] || {}).concat(Object.keys(state.attPending));
    dates.forEach(function (d) { if (attCode(t.empId, d) === 'LWD' && (!best || d < best)) best = d; });
    return best;
  }
  /** Last date attendance can be marked: today, OJT end, HR last working date or a marked LWD, whichever is first. */
  function lastDay(t) {
    var end = state.att.today;
    if (t.trackUntil && t.trackUntil < end) end = t.trackUntil;
    if (t.lastWorkingDate && t.lastWorkingDate < end) end = t.lastWorkingDate;
    var l = lwdOf(t); if (l && l < end) end = l;
    return end;
  }
  function canMark(t, d) { return !!t.doj && d >= t.doj && d <= lastDay(t); }
  function whyNot(t, d) {
    if (!t.doj) return 'DOJ missing';
    if (d < t.doj) return 'Joins ' + day(t.doj);
    var l = lwdOf(t);
    if (l && d > l) return 'Left ' + day(l);
    if (t.lastWorkingDate && d > t.lastWorkingDate) return 'Left ' + day(t.lastWorkingDate) + ' (HR)';
    if (t.trackUntil && d > t.trackUntil) return 'OJT ended ' + day(t.trackUntil);
    return '';
  }
  function isCurrent(t) {
    var today = state.att.today, l = lwdOf(t);
    return !!t.doj && t.doj <= today && (!t.trackUntil || today <= t.trackUntil) &&
      !(t.lastWorkingDate && t.lastWorkingDate < today) && !(l && l < today);
  }
  function attRoster() { return state.att.trainees.filter(function (t) { return state.attScope === 'all' || isCurrent(t); }); }
  /** Unmarked days from DOJ up to yesterday (or the last markable day, if earlier). */
  function gaps(t) {
    var end = lastDay(t), y = addDays(state.att.today, -1), out = [];
    if (end > y) end = y;
    if (!t.doj || end < t.doj) return out;
    for (var d = t.doj; d <= end; d = addDays(d, 1)) { if (!attCode(t.empId, d)) out.push(d); }
    return out;
  }
  function pendingCount() {
    return Object.keys(state.attPending).reduce(function (a, d) { return a + Object.keys(state.attPending[d]).length; }, 0);
  }
  function setMark(id, date, code) {
    var saved = ((state.att.marks[id] || {})[date]) || '';
    var p = state.attPending[date] = state.attPending[date] || {};
    if (code === saved) delete p[id]; else p[id] = code;
    if (!Object.keys(p).length) delete state.attPending[date];
  }
  function attHomeStat() {
    var cur = state.att.trainees.filter(isCurrent);
    var open = cur.filter(function (t) { return canMark(t, state.att.today) && !attCode(t.empId, state.att.today); }).length;
    return plural(cur.length, 'trainee', 'trainees') + ' tracked · ' + open + ' unmarked today';
  }

  function loadAttendance() {
    var t = state.trainer;
    call('getAttendance', t).then(function (a) {
      if (state.trainer !== t) return;
      state.att = a;
      if (!state.attDate || state.attDate > a.today) state.attDate = a.today;
      renderApp();
    }).catch(fail);
  }

  function saveAtt() {
    var days = Object.keys(state.attPending).sort().map(function (d) { return { date: d, marks: state.attPending[d] }; });
    if (!days.length || state.busy) return;
    state.busy = true; state.notice = null; renderApp();
    call('saveAttendance', { trainer: state.trainer, days: days }).then(function (res) {
      state.busy = false;
      var bad = {}, pend = res.pending || [];
      (res.skipped || []).forEach(function (x) { bad[x.empId + '|' + x.date] = true; });
      pend.forEach(function (x) { bad[x.empId + '|' + x.date] = true; });     // changes to saved marks wait for an admin
      days.forEach(function (d) {
        Object.keys(d.marks).forEach(function (id) {
          if (bad[id + '|' + d.date]) return;
          var m = state.att.marks[id] = state.att.marks[id] || {};
          if (d.marks[id]) m[d.date] = d.marks[id]; else delete m[d.date];
        });
      });
      state.attPending = {};
      var skipped = res.skipped || [];
      var who = function (id) { var t = state.att.trainees.filter(function (x) { return x.empId === id; })[0]; return t ? t.name : id; };
      state.notice = {
        tone: skipped.length ? 'warn' : 'good',
        text: (res.saved ? 'Saved ' + plural(res.saved, 'mark', 'marks') + '.' : '') +
          (pend.length ? ' ' + plural(pend.length, 'change to a saved mark was', 'changes to saved marks were') + ' sent to the admin for approval.' : '') +
          (skipped.length ? ' ' + plural(skipped.length, 'mark was', 'marks were') + ' not saved:' : ''),
        items: pend.map(function (x) { return who(x.empId) + ' on ' + day(x.date) + ' → ' + (CODE_LABEL[x.code] || 'cleared') + ' (awaiting approval)'; })
          .concat(skipped.map(function (x) { return x.empId + ' on ' + day(x.date) + ' – ' + x.reason; }))
      };
      renderApp();
    }).catch(fail);
  }

  function attendancePage() {
    if (!state.att || state.att.trainer !== state.trainer) {
      if (!state.attLoading || state.attLoading !== state.trainer) { state.attLoading = state.trainer; loadAttendance(); }
      return '<div class="loading">Loading attendance…</div>';
    }
    state.attLoading = '';
    var a = state.att, date = state.attDate || a.today, roster = attRoster();
    var current = a.trainees.filter(isCurrent).length;
    var minDate = a.trainees.reduce(function (m, t) { return t.doj && (!m || t.doj < m) ? t.doj : m; }, '') || a.today;

    // Counts for the selected day, among people who can be marked that day.
    var markable = roster.filter(function (t) { return canMark(t, date); });
    var counts = { P: 0, L: 0, WO: 0, NCNS: 0, LWD: 0 }, unmarked = 0;
    markable.forEach(function (t) { var c = attCode(t.empId, date); if (c) counts[c] = (counts[c] || 0) + 1; else unmarked++; });

    var html = '<div class="sub dim">Attendance is tracked from each trainee\'s DOJ to their OJT End Date' +
      (a.ojtSheetFound ? ' (from the OJT dashboard).' : '. OJT dates come from Master Dashboard until an admin runs the first OJT refresh.') +
      ' Where no OJT End Date is filled yet, tracking runs ' + a.fallbackDays + ' days from DOJ.</div>';

    var reg = state.attView === 'register';
    html += '<div class="filters view-switch" role="group" aria-label="View">' +
      '<button class="filter" data-att-view="day" aria-pressed="' + !reg + '">Daily marking</button>' +
      '<button class="filter" data-att-view="register" aria-pressed="' + reg + '">Monthly register (edit past days)</button></div>';
    if (reg) return html + registerPage(roster, minDate);

    html += '<div class="att-bar">' +
      '<div class="att-date"><button class="btn" id="att-prev" aria-label="Previous day"' + (date <= minDate ? ' disabled' : '') + '>‹</button>' +
        '<label class="field"><span class="label">Attendance for</span>' +
        '<input type="date" id="att-date" value="' + date + '" min="' + minDate + '" max="' + a.today + '"></label>' +
        '<button class="btn" id="att-next" aria-label="Next day"' + (date >= a.today ? ' disabled' : '') + '>›</button>' +
        (date !== a.today ? '<button class="link-btn" id="att-today">Today</button>' : '') +
      '</div>' +
      '<div class="filters">' +
        '<button class="filter" data-att-scope="current" aria-pressed="' + (state.attScope === 'current') + '">In training or OJT<span class="num">' + current + '</span></button>' +
        '<button class="filter" data-att-scope="all" aria-pressed="' + (state.attScope === 'all') + '">All my trainees<span class="num">' + a.trainees.length + '</span></button>' +
      '</div></div>';

    html += '<section class="summary att-summary" aria-label="' + esc(day(date)) + '">' +
      tile(weekday(date) + ' ' + day(date), 'Day being marked') +
      ['P', 'L', 'WO', 'NCNS', 'LWD'].map(function (c) { return '<div><span class="v st-text-' + c + '">' + counts[c] + '</span><span class="n">' + CODE_LABEL[c] + '</span></div>'; }).join('') +
      tile(unmarked, 'Not marked yet') + '</section>';

    var pend = pendingCount();
    if (pend || unmarked) {
      html += '<div class="assign-bar att-save" role="region" aria-label="Save attendance">' +
        '<span class="grow">' + (pend ? '<b>' + pend + '</b> unsaved ' + (pend === 1 ? 'mark' : 'marks') : 'Nothing to save yet') + '</span>' +
        (unmarked ? '<button class="btn" id="att-all-present">Mark the ' + unmarked + ' unmarked as Present</button>' : '') +
        (pend ? '<button class="btn btn-accent" id="att-save"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Saving…' : 'Save attendance') + '</button>' +
                '<button class="link" id="att-discard">Discard</button>' : '') +
        '</div>';
    }

    if (!roster.length) {
      return html + '<div class="empty">' + (state.attScope === 'current'
        ? 'Nobody is in training or OJT right now. Claim candidates from Unclaimed Candidates and they will appear here.'
        : 'No trainees are mapped to this trainer yet.') + '</div>';
    }

    // Strip: the 14 days ending on the selected day.
    var stripDays = [];
    for (var i = STRIP_DAYS - 1; i >= 0; i--) stripDays.push(addDays(date, -i));

    var groups = {}, order = [];
    roster.forEach(function (t) {
      if (!groups[t.batchKey]) { groups[t.batchKey] = []; order.push(t.batchKey); }
      groups[t.batchKey].push(t);
    });
    order.sort(function (x, y) { return (groups[y][0].batchStart || '') < (groups[x][0].batchStart || '') ? -1 : 1; });

    html += '<div class="legend">' + ['P', 'L', 'WO', 'NCNS', 'LWD'].map(function (c) {
        return '<span><i class="cell st-' + c + '">' + CODE_SHORT[c] + '</i>' + CODE_LABEL[c] + '</span>';
      }).join('') + '<span><i class="cell gap"></i>Not marked</span><span class="dim">Click a day in the strip to mark it.</span></div>';

    html += '<div class="table-wrap"><table class="att"><thead><tr><th>Trainee</th><th>DOJ · OJT end</th><th>' + esc(day(date)) + '</th><th>Last ' + STRIP_DAYS + ' days</th><th>Unmarked</th></tr></thead><tbody>';
    order.forEach(function (k) {
      var list = groups[k].slice().sort(function (x, y) { return x.name.localeCompare(y.name); }), b = list[0];
      html += '<tr class="grp"><td colspan="5">' + esc(b.batch) + (b.batchStart ? ' <span class="dim">· started ' + esc(day(b.batchStart)) + '</span>' : '') +
        ' <span class="dim">· ' + plural(list.length, 'trainee', 'trainees') + '</span></td></tr>';
      list.forEach(function (t) {
        var code = attCode(t.empId, date), ok = canMark(t, date), dirty = state.attPending[date] && has(state.attPending[date], t.empId);
        var seg = ok
          ? '<div class="seg" role="group" aria-label="Attendance for ' + esc(t.name) + '">' + ['P', 'L', 'WO', 'NCNS', 'LWD'].map(function (c) {
              return '<button class="st-' + c + '" data-mark="' + esc(t.empId) + '|' + c + '" aria-pressed="' + (code === c) + '">' + CODE_LABEL[c] + '</button>';
            }).join('') + '</div>' + (dirty ? '<span class="unsaved">Unsaved</span>' : '')
          : '<span class="dim">' + esc(whyNot(t, date)) + '</span>';
        var strip = stripDays.map(function (d) {
          var c = attCode(t.empId, d), on = canMark(t, d), cls = !on ? 'off' : c ? 'st-' + c : (d < a.today ? 'gap' : 'todo');
          var tip = weekday(d) + ' ' + day(d) + (on ? ': ' + (c ? CODE_LABEL[c] : 'not marked') : '');
          return on ? '<button class="cell ' + cls + (d === date ? ' sel' : '') + '" data-att-date="' + d + '" title="' + esc(tip) + '" aria-label="' + esc(tip) + '">' + (c ? CODE_SHORT[c] : '') + '</button>'
                    : '<i class="cell off" title="' + esc(tip) + '"></i>';
        }).join('');
        var g = gaps(t), dayN = t.doj && t.doj <= date ? daysBetween(t.doj, date) + 1 : 0;
        html += '<tr><td><div class="nm">' + esc(t.name) + '</div><div class="id">' + esc(t.empId) + ' · ' + esc(t.subTeam || '–') + byTrainer(t) + '</div></td>' +
          '<td class="num"><div>' + esc(day(t.doj)) + (dayN ? ' <span class="dim">· day ' + dayN + '</span>' : '') + '</div>' +
            '<div class="id">' + (t.trackEstimated ? 'OJT end not set' : 'OJT ends ' + esc(day(t.trackUntil))) + '</div></td>' +
          '<td>' + seg + '</td>' +
          '<td><div class="strip">' + strip + '</div></td>' +
          '<td>' + (g.length ? '<button class="pill crit" data-att-date="' + g[0] + '" title="Go to the first unmarked day">' + g.length + (g.length === 1 ? ' day' : ' days') + '</button>' : '<span class="pill good">Up to date</span>') + '</td></tr>';
      });
    });
    html += '</tbody></table></div>';
    return html;
  }

  /** Month grid: one row per trainee, one column per day. Any markable past day can be changed. */
  function registerPage(roster, minDate) {
    var a = state.att, month = state.attMonth || (state.attDate || a.today).slice(0, 7);
    var minMonth = minDate.slice(0, 7), maxMonth = a.today.slice(0, 7);
    if (month < minMonth) month = minMonth;
    if (month > maxMonth) month = maxMonth;
    state.attMonth = month;
    var first = month + '-01', days = [];
    for (var d = first; d.slice(0, 7) === month && d <= a.today; d = addDays(d, 1)) days.push(d);
    // people who can be marked on at least one day of this month
    var rows = roster.filter(function (t) { return days.some(function (x) { return canMark(t, x); }); });

    var pend = pendingCount();
    var html = '<div class="att-bar"><div class="att-date">' +
      '<button class="btn" id="reg-prev" aria-label="Previous month"' + (month <= minMonth ? ' disabled' : '') + '>‹</button>' +
      '<span class="month-name">' + esc(monthName(month)) + '</span>' +
      '<button class="btn" id="reg-next" aria-label="Next month"' + (month >= maxMonth ? ' disabled' : '') + '>›</button></div>' +
      '<div class="filters">' +
        '<button class="filter" data-att-scope="current" aria-pressed="' + (state.attScope === 'current') + '">In training or OJT</button>' +
        '<button class="filter" data-att-scope="all" aria-pressed="' + (state.attScope === 'all') + '">All my trainees</button>' +
      '</div></div>';
    html += '<p class="dim reg-help">Click any day to set the mark. Everything is saved together when you press Save, and every change is logged.' +
      (state.session && state.session.isAdmin ? '' : ' Changing a mark that is already saved is sent to the admin for approval.') + '</p>';
    if (pend) {
      html += '<div class="assign-bar att-save" role="region" aria-label="Save attendance"><span class="grow"><b>' + pend + '</b> unsaved ' + (pend === 1 ? 'change' : 'changes') + '</span>' +
        '<button class="btn btn-accent" id="att-save"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Saving…' : 'Save attendance') + '</button>' +
        '<button class="link" id="att-discard">Discard</button></div>';
    }
    if (!rows.length) return html + '<div class="empty">Nobody in this view could be marked in ' + esc(monthName(month)) + '.</div>';

    html += '<div class="legend">' + ['P', 'L', 'WO', 'NCNS', 'LWD'].map(function (c) {
        return '<span><i class="cell st-' + c + '">' + CODE_SHORT[c] + '</i>' + CODE_LABEL[c] + '</span>';
      }).join('') + '<span><i class="cell gap"></i>Not marked</span><span><i class="cell st-P dirty">P</i>Unsaved change</span></div>';

    html += '<div class="table-wrap reg-wrap" id="reg-wrap"><table class="reg"><thead><tr><th class="who-col">Trainee</th>' +
      days.map(function (x) { return '<th class="dcol' + (weekday(x) === 'Sun' ? ' sun' : '') + '"><span>' + (+x.slice(8)) + '</span><span class="wd">' + weekday(x).charAt(0) + '</span></th>'; }).join('') +
      '<th class="r">Unmarked</th></tr></thead><tbody>';
    var batchSeen = {};
    rows.slice().sort(function (x, y) { return (y.batchStart || '').localeCompare(x.batchStart || '') || x.name.localeCompare(y.name); }).forEach(function (t) {
      if (!batchSeen[t.batchKey]) {
        batchSeen[t.batchKey] = true;
        html += '<tr class="grp"><td class="who-col">' + esc(t.batch) + '</td><td colspan="' + (days.length + 1) + '"></td></tr>';
      }
      var missing = 0;
      html += '<tr><td class="who-col"><div class="nm">' + esc(t.name) + '</div><div class="id">' + esc(t.empId) + byTrainer(t) + '</div></td>' +
        days.map(function (x) {
          if (!canMark(t, x)) return '<td class="dcol"><i class="cell off" title="' + esc(whyNot(t, x)) + '"></i></td>';
          var c = attCode(t.empId, x), dirty = state.attPending[x] && has(state.attPending[x], t.empId);
          if (!c && x < a.today) missing++;
          var open = state.attEdit && state.attEdit.id === t.empId && state.attEdit.date === x;
          var tip = t.name + ', ' + weekday(x) + ' ' + day(x) + ': ' + (c ? CODE_LABEL[c] : 'not marked');
          return '<td class="dcol"><button class="cell ' + (c ? 'st-' + c : (x < a.today ? 'gap' : 'todo')) + (dirty ? ' dirty' : '') + (open ? ' sel' : '') +
            '" data-reg="' + esc(t.empId) + '|' + x + '" title="' + esc(tip) + '" aria-label="' + esc(tip) + '">' + (c ? CODE_SHORT[c] : '') + '</button></td>';
        }).join('') +
        '<td class="r">' + (missing ? '<span class="pill crit">' + missing + '</span>' : '<span class="pill good">0</span>') + '</td></tr>';
    });
    html += '</tbody></table></div>';

    if (state.attEdit) {
      var e = state.attEdit, who = a.trainees.filter(function (t) { return t.empId === e.id; })[0], cur = attCode(e.id, e.date);
      html += '<div class="pop" id="att-pop" role="dialog" aria-label="Set attendance"><div class="pop-head"><b>' + esc(who ? who.name : e.id) + '</b><span class="dim">' + esc(weekday(e.date) + ' ' + day(e.date)) + '</span></div>' +
        '<div class="pop-opts">' + ['P', 'L', 'WO', 'NCNS', 'LWD'].map(function (c) {
          return '<button class="st-' + c + '" data-pop="' + c + '" aria-pressed="' + (cur === c) + '">' + CODE_LABEL[c] + '</button>';
        }).join('') + '<button data-pop="" class="pop-clear"' + (cur ? '' : ' disabled') + '>Clear</button></div></div>';
    }
    return html;
  }

  /* ---------- page: NHT performance ---------- */
  function loadNht() {
    var t = state.trainer;
    call('getNhtCandidates', t).then(function (r) {
      if (state.trainer !== t) return;
      state.nht = r; renderApp();
    }).catch(fail);
  }
  function deptRow(d) { return (state.nht.departments || []).filter(function (x) { return x[0] === d; })[0]; }
  function nhtMatches() {
    var q = state.nhtQuery.trim().toLowerCase();
    return state.nht.candidates.filter(function (c) {
      if (state.nhtOnlyMissing && c.department) return false;
      return !q || (c.name + ' ' + c.empId + ' ' + c.department + ' ' + c.subTeam).toLowerCase().indexOf(q) >= 0;
    });
  }

  function kcText(k) {
    if (!k) return '';
    return (k.score !== null && k.score !== undefined && k.score !== '' ? Math.round(k.score * 10) / 10 + '%' : '–') + (k.attempt ? ' · ' + k.attempt : '');
  }
  function lastMock(c) { return (c.mocks || []).slice(-1)[0] || null; }
  function pendingChip(c) { var n = Object.keys(c.pending || {}).length; return n ? '<span class="pill pending">' + n + ' awaiting approval</span>' : ''; }

  function nhtPage() {
    if (!state.nht || state.nht.trainer !== state.trainer) {
      if (state.nhtLoading !== state.trainer) { state.nhtLoading = state.trainer; loadNht(); }
      return '<div class="loading">Loading trainees in training…</div>';
    }
    state.nhtLoading = '';
    var all = state.nht.candidates, list = nhtMatches(), missing = all.filter(function (c) { return !c.department; }).length;
    var html = '<div class="sub dim">Everyone you claimed who is still in training. Open a card and set the department and sub-team first; then the training start date, mocks and OJT open. ' +
      'When OJT Entered and OJT Eligible are both Yes, the trainee moves to OJT Performance.' +
      (state.nht.isAdmin ? '' : ' Your first update of a department or training start date saves straight away; changing it again goes to an admin for approval.') + '</div>' +
      '<div class="unclaimed-bar"><input class="search" id="nht-search" type="search" placeholder="Search by name, Emp ID or department" value="' + esc(state.nhtQuery) + '" aria-label="Search trainees">' +
      '<div class="filters"><button class="filter" data-nht-missing="0" aria-pressed="' + !state.nhtOnlyMissing + '">All<span class="num">' + all.length + '</span></button>' +
      '<button class="filter" data-nht-missing="1" aria-pressed="' + state.nhtOnlyMissing + '">Department not set<span class="num">' + missing + '</span></button></div></div>';
    if (!all.length) return html + '<div class="empty">Nobody is in training right now. Candidates you claim appear here until they move to OJT.</div>';
    if (!list.length) return html + '<div class="empty">No trainees match.</div>';

    var groups = {}, order = [];
    list.forEach(function (c) { var k = c.batchKey || 'none'; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(c); });
    order.sort(function (x, y) { return (groups[y][0].batchStart || '') < (groups[x][0].batchStart || '') ? -1 : 1; });
    order.forEach(function (k) {
      var g = groups[k], b = g[0];
      html += '<section class="nht-group"><h2 class="grp-title">' + esc(b.batch || 'No batch yet') +
        (b.batchStart ? ' <span class="dim">· started ' + esc(day(b.batchStart)) + '</span>' : '') + ' <span class="dim">· ' + plural(g.length, 'trainee', 'trainees') + '</span></h2>' +
        '<div class="nht-cards">' + g.map(function (c) {
          var dayN = c.doj && c.doj <= state.nht.today ? daysBetween(c.doj, state.nht.today) + 1 : 0, m = lastMock(c);
          return '<button class="nht-card" data-nht="' + esc(c.empId) + '">' +
            '<span class="nht-top"><span class="nm">' + esc(c.name) + '</span><span class="chip">' + esc(c.mode || '–') + '</span></span>' +
            '<span class="id">' + esc(c.empId) + ' · DOJ ' + esc(day(c.doj)) + (dayN ? ' · day ' + dayN : '') + byTrainer(c) + '</span>' +
            (c.department
              ? '<span class="nht-dept"><b>' + esc(c.department) + '</b>' + (c.subTeam ? ' · ' + esc(c.subTeam) : '') + '</span>'
              : '<span class="pill warn">Department not set</span>') +
            '<span class="nht-facts">' +
              '<span><i>Start</i>' + esc(c.trainingStart ? day(c.trainingStart).replace(/ \d{4}$/, '') : '–') + '</span>' +
              '<span><i>KC</i>' + esc(c.kc ? kcText(c.kc) : '–') + '</span>' +
              '<span><i>Mock</i>' + esc(m ? m.attempt + ' · ' + m.status : '–') + '</span>' +
            '</span>' + (!c.kc ? '<span class="pill done">Waiting for KC</span>' : '') + (c.ojtEntered || c.ojtEligible ? '<span class="nht-ojt">OJT entered: <b>' + esc(c.ojtEntered || '–') + '</b> · Eligible: <b>' + esc(c.ojtEligible || '–') + '</b></span>' : '') + pendingChip(c) +
          '</button>';
        }).join('') + '</div></section>';
    });
    return html;
  }

  function nhtSection(title, field, body, c, extra) {
    var fields = [field].concat(extra || []);
    var chips = fields.map(function (f) {
      var p = c.pending && c.pending[f];
      return p ? '<span class="pill pending" title="Sent ' + esc(day(String(p.on).slice(0, 10))) + '">Awaiting approval: ' + esc(p.newText) + '</span>' : '';
    }).join('');
    var msgs = fields.map(function (f) { var m = state.nhtMsg[f]; return m ? '<div class="notice ' + m.tone + '">' + esc(m.text) + '</div>' : ''; }).join('');
    return '<section class="dsec"><div class="dsec-head"><h3>' + esc(title) + '</h3>' + (chips ? '<span class="chips">' + chips + '</span>' : '') + '</div>' + body + msgs + '</section>';
  }

  function lockedSection(title) {
    return '<section class="dsec locked"><div class="dsec-head"><h3>' + esc(title) + '</h3><span class="pill done">Locked</span></div>' +
      '<p class="dim small">Opens once this trainee has a KC result in the KC Sheet.</p></section>';
  }

  /** Everything changed in the open trainee dialog, as it will be sent by the single Save. */
  function nhtStaged(c) {
    var out = [], admin = state.nht.isAdmin, done = c.updated || {};
    var row = deptRow(state.nhtDept);
    if (state.nhtDept && row && (state.nhtDept !== c.department || state.nhtSub !== c.subTeam) && (!row[1].length || state.nhtSub)) {
      out.push({ field: 'Department', value: { department: state.nhtDept, subTeam: state.nhtSub }, label: 'Department: ' + state.nhtDept + (state.nhtSub ? ' / ' + state.nhtSub : '') });
    }
    if (!state.nhtDept || !row || (row[1].length && !state.nhtSub)) return out.map(function (x) { x.approval = !admin && !!done[x.field]; return x; });
    if (state.nhtTs && state.nhtTs !== c.trainingStart) out.push({ field: 'Training Start Date', value: { date: state.nhtTs }, label: 'Training start: ' + day(state.nhtTs) });
    var f = state.nhtMock || {};
    if (c.kc && f.status && f.date) {
      out.push({ field: 'Mock', value: { date: f.date, attempt: Number(f.attempt), score: '', status: f.status, final: f.status === 'Pass' || !!f.final },
        label: 'Mock: ' + ordinal(f.attempt) + ' attempt · ' + f.status + ' · ' + day(f.date) + (f.status === 'Pass' || f.final ? ' (final)' : '') });
    }
    var e = state.nhtMockEdit;
    if (e) {
      var orig = (c.mocks || []).filter(function (m) { return attemptNumber(m.attempt) === e.attempt; }).slice(-1)[0];
      if (!orig || orig.date !== e.date || orig.status !== e.status || !!orig.final !== !!e.final) {
        out.push({ field: 'Mock Edit', value: { attempt: e.attempt, date: e.date, score: '', status: e.status, final: !!e.final }, label: 'Change ' + ordinal(e.attempt) + ' attempt → ' + e.status + ' · ' + day(e.date) });
      }
    }
    ['OJT Entered', 'OJT Eligible'].forEach(function (fld) {
      var saved = fld === 'OJT Entered' ? c.ojtEntered : c.ojtEligible, pick = state.nhtOjt[fld];
      if (pick && pick !== saved) out.push({ field: fld, value: { answer: pick }, label: fld + ': ' + pick });
    });
    out.forEach(function (x) { x.approval = !admin && (x.field === 'Mock Edit' || (x.field !== 'Mock' && !!done[x.field])); });
    return out;
  }

  function nhtDialog() {
    if (!state.nhtOpen || !state.nht) return '';
    var c = state.nht.candidates.filter(function (x) { return x.empId === state.nhtOpen; })[0];
    if (!c) return '';
    var admin = state.nht.isAdmin;
    var done = c.updated || {};
    var needsOk = function (f) { return !admin && done[f]; };
    var depts = state.nht.departments || [], row = deptRow(state.nhtDept);
    var inList = deptRow(c.department) && (!deptRow(c.department)[1].length ? !c.subTeam : deptRow(c.department)[1].indexOf(c.subTeam) >= 0);
    var subOpts = !state.nhtDept ? '<option value="">Pick a department first</option>'
      : !row[1].length ? '<option value="">No sub-team</option>'
      : '<option value="">Select sub-team</option>' + row[1].map(function (x) { return '<option' + (x === state.nhtSub ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('');
    var field = function (k, v, cls) { return '<div><dt>' + k + '</dt><dd class="' + (cls || '') + '">' + esc(v || '–') + '</dd></div>'; };
    var approvalNote = function (f) { return needsOk(f) ? '<p class="dim small">You have set this once; a change goes to the admin for approval.</p>' : ''; };

    var deptBody = (c.department && !inList ? '<p class="dim small">Currently ' + esc(c.department) + (c.subTeam ? ' / ' + esc(c.subTeam) : '') + ', which is not in the Department List.</p>' : '') +
      '<div class="dept-row"><label class="field"><span class="label">Department</span><select id="nht-dept"><option value="">Select department</option>' +
        depts.map(function (d) { return '<option' + (d[0] === state.nhtDept ? ' selected' : '') + '>' + esc(d[0]) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span class="label">Sub-Team</span><select id="nht-sub"' + (state.nhtDept && row[1].length ? '' : ' disabled') + '>' + subOpts + '</select></label></div>' +
      approvalNote('Department');

    var tsBody = '<div class="inline-form"><label class="field"><span class="label">Training start date</span><input type="date" id="nht-ts" value="' + esc(state.nhtTs) + '"></label>' +
      (c.trainingStart ? '<span class="dim small">Saved: ' + esc(weekday(c.trainingStart) + ' ' + day(c.trainingStart)) + '</span>' : '<span class="dim small">Not set yet</span>') + '</div>' +
      approvalNote('Training Start Date');

    var deptReady = !!state.nhtDept && !!row && (!row[1].length || !!state.nhtSub);
    var deptFirst = function (title) {
      return '<section class="dsec locked"><div class="dsec-head"><h3>' + esc(title) + '</h3><span class="pill done">Locked</span></div>' +
        '<p class="dim small">Pick the department and sub-team first.</p></section>';
    };
    var k = c.kc;
    var kcBody = k
      ? '<dl class="facts compact">' + field('Score', k.score !== null && k.score !== '' ? Math.round(k.score * 10) / 10 + '%' : '–', 'num') + field('Attempt', k.attempt) +
        '<div><dt>Status</dt><dd>' + (k.status ? '<span class="pill ' + (/^pass/i.test(k.status) ? 'good' : 'crit') + '">' + esc(k.status) + '</span>' : '–') + '</dd></div>' +
        field('Date of KC', day(k.date), 'num') + '</dl>'
      : '<p class="dim small">No KC entry for ' + esc(c.empId) + ' in the KC Sheet yet. Mock and OJT open once it is there.</p>';

    var mocks = c.mocks || [], f = state.nhtMock || {};
    var hist = mocks.length
      ? '<table class="mini"><thead><tr><th>Attempt</th><th>Date</th><th>Status</th><th></th></tr></thead><tbody>' + mocks.map(function (m) {
          var n = attemptNumber(m.attempt), e = state.nhtMockEdit;
          if (e && e.attempt === n) {
            return '<tr class="edit-row"><td>' + esc(m.attempt) + '</td>' +
              '<td><input type="date" id="me-date" value="' + esc(e.date) + '" max="' + state.nht.today + '" aria-label="Mock date"></td>' +
              '<td><div class="seg" role="group" aria-label="Status"><button class="st-P" data-me-status="Pass" aria-pressed="' + (e.status === 'Pass') + '">Pass</button>' +
                '<button class="st-LWD" data-me-status="Fail" aria-pressed="' + (e.status === 'Fail') + '">Fail</button></div>' +
                (e.status === 'Fail' ? '<label class="check-line"><input type="checkbox" id="me-final"' + (e.final ? ' checked' : '') + '> Final attempt</label>' : '') + '</td>' +
              '<td class="row-acts"><button class="link-btn" id="me-cancel">Cancel</button></td></tr>';
          }
          return '<tr><td>' + esc(m.attempt) + (m.final ? ' <span class="dim">(final)</span>' : '') + '</td><td class="num">' + esc(day(m.date)) + '</td>' +
            '<td><span class="pill ' + (m.status === 'Pass' ? 'good' : 'crit') + '">' + esc(m.status) + '</span></td>' +
            '<td class="r">' + (m.final ? '' : '<button class="btn btn-sm" data-me-edit="' + n + '">Edit</button>') + '</td></tr>';
        }).join('') + '</tbody></table>' + (state.nhtMockEdit && !admin ? '<p class="dim small">Changing a recorded attempt goes to the admin for approval.</p>' : '')
      : '<p class="dim small">No mock recorded yet.</p>';
    var mockBody = hist +
      '<div class="mock-form">' +
        '<label class="field"><span class="label">Mock date</span><input type="date" id="mk-date" value="' + esc(f.date || '') + '" max="' + state.nht.today + '"></label>' +
        '<label class="field"><span class="label">Attempt</span><select id="mk-att">' + [1, 2, 3, 4, 5, 6].map(function (n) {
          return '<option value="' + n + '"' + (Number(f.attempt) === n ? ' selected' : '') + '>' + ordinal(n) + '</option>'; }).join('') + '</select></label>' +
        '<div class="field"><span class="label">Status</span><div class="seg" role="group" aria-label="Mock status">' +
          '<button class="st-P" data-mk-status="Pass" aria-pressed="' + (f.status === 'Pass') + '">Pass</button>' +
          '<button class="st-LWD" data-mk-status="Fail" aria-pressed="' + (f.status === 'Fail') + '">Fail</button></div></div>' +
        (f.status ? '<button class="link-btn" id="mk-clear">Clear</button>' : '') +
      '</div>' +
      (f.status === 'Fail' ? '<label class="check-line"><input type="checkbox" id="mk-final"' + (f.final ? ' checked' : '') + '> Final attempt, no retake (this ends training)</label>'
        : f.status === 'Pass' ? '<p class="dim small">A pass is the final mock: once saved, it fills Master Dashboard. The trainee stays here until OJT Entered and OJT Eligible are both Yes.</p>' : '');

    var ojtOpen = !!k && (mocks.length > 0 || !!f.status);
    var ojtBody = '<p class="dim small">When both are Yes, the trainee moves to OJT Performance.</p>' + ['OJT Entered', 'OJT Eligible'].map(function (fld) {
      var saved = fld === 'OJT Entered' ? c.ojtEntered : c.ojtEligible, pick = state.nhtOjt[fld] || saved || '';
      return '<div class="yn-row"><span class="yn-label">' + esc(fld) + '</span>' +
        '<div class="seg" role="group" aria-label="' + esc(fld) + '">' + ['Yes', 'No'].map(function (a) {
          return '<button class="' + (a === 'Yes' ? 'st-P' : 'st-LWD') + '" data-yn="' + esc(fld) + '|' + a + '" aria-pressed="' + (pick === a) + '">' + a + '</button>';
        }).join('') + '</div>' +
        (saved ? '<span class="dim small">Saved: ' + esc(saved) + (needsOk(fld) ? ' · a change needs approval' : '') + '</span>' : '<span class="dim small">Not answered yet</span>') + '</div>';
    }).join('');

    var staged = nhtStaged(c), sm = state.nhtMsg._save;
    var nApproval = staged.filter(function (x) { return x.approval; }).length;
    var footer = '<div class="nht-savebar' + (staged.length ? ' has' : '') + '">' +
      (staged.length
        ? '<div class="grow"><b>' + plural(staged.length, 'change', 'changes') + ' ready</b>' +
            '<ul class="staged">' + staged.map(function (x) { return '<li>' + esc(x.label) + (x.approval ? ' <span class="pill pending">needs approval</span>' : '') + '</li>'; }).join('') + '</ul></div>' +
          '<button class="link-btn" id="nht-discard"' + (state.busy ? ' disabled' : '') + '>Discard</button>' +
          '<button class="btn btn-accent" id="nht-save"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Saving…' : nApproval === staged.length ? 'Send for approval' : nApproval ? 'Save & send for approval' : 'Save changes') + '</button>'
        : '<div class="grow dim small">Make your changes above, then save them all at once here.</div>') +
      '</div>' + (sm ? '<div class="notice ' + sm.tone + '">' + esc(sm.text) + '</div>' : '');

    return '<div class="modal-back" id="nht-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="nht-title">' +
      '<div class="modal-head"><div><div class="label">' + esc(c.batch || 'In training') + '</div><h2 id="nht-title">' + esc(c.name) + '</h2></div>' +
      '<button class="btn btn-sm" id="nht-close" aria-label="Close">Close</button></div>' +
      '<dl class="facts">' + field('DOJ', day(c.doj), 'num') + field('Work Mode', c.mode) + field('Emp ID', c.empId, 'num') +
        field('Employee Name', c.name) + field('Official Email ID', c.email, 'wrap') + field('Contact Number', c.phone, 'num') + '</dl>' +
      nhtSection('Department', 'Department', deptBody, c) +
      (deptReady ? nhtSection('Training start date', 'Training Start Date', tsBody, c) : deptFirst('Training start date')) +
      '<section class="dsec"><div class="dsec-head"><h3>KC</h3><span class="dim small">Latest entry in the KC Sheet</span></div>' + kcBody + '</section>' +
      (!deptReady ? deptFirst('Mock') : k ? nhtSection('Mock', 'Mock', mockBody, c, ['Mock Edit']) : lockedSection('Mock')) +
      (!deptReady ? deptFirst('OJT') : ojtOpen ? nhtSection('OJT', 'OJT Entered', ojtBody, c, ['OJT Eligible'])
        : '<section class="dsec locked"><div class="dsec-head"><h3>OJT</h3><span class="pill done">Locked</span></div><p class="dim small">' +
          (k ? 'Opens once a mock is recorded, or filled in above.' : 'Opens once this trainee has a KC result and a mock.') + '</p></section>') +
      footer +
      '</div></div>';
  }

  function openNht(id) {
    var c = state.nht.candidates.filter(function (x) { return x.empId === id; })[0];
    var row = c && deptRow(c.department);
    var ok = row && (!row[1].length ? !c.subTeam : row[1].indexOf(c.subTeam) >= 0);
    var next = (c.mocks || []).reduce(function (m, x) { return Math.max(m, attemptNumber(x.attempt)); }, 0) + 1;
    state.nhtOpen = id; state.nhtMsg = {};
    state.nhtDept = ok ? c.department : ''; state.nhtSub = ok ? c.subTeam : '';
    state.nhtTs = c.trainingStart || ''; state.nhtTsEdit = false; state.nhtMockEdit = null; state.nhtOjt = {};
    state.nhtMock = { date: state.nht.today, attempt: Math.min(next, 6), score: '', status: '', final: false };
    renderApp();
    var first = document.getElementById('nht-close'); if (first) first.focus();
  }
  function closeNht() {
    var c = state.nht && state.nht.candidates.filter(function (x) { return x.empId === state.nhtOpen; })[0];
    if (c && nhtStaged(c).length && !window.confirm('You have changes that are not saved. Close without saving?')) return;
    var id = state.nhtOpen; state.nhtOpen = ''; state.nhtMsg = {};
    keepScroll(renderApp);
    var card = root.querySelector('[data-nht="' + id + '"]'); if (card) card.focus({ preventScroll: true });
  }
  function modalScroll(fn) {
    var m = root.querySelector('.modal-back'), y = m ? m.scrollTop : 0;
    keepScroll(fn);
    var m2 = root.querySelector('.modal-back'); if (m2) m2.scrollTop = y;
  }

  /** The single Save of the trainee dialog: sends every staged change in one request. */
  function saveNht() {
    var id = state.nhtOpen, c = state.nht.candidates.filter(function (x) { return x.empId === id; })[0];
    if (!c || state.busy) return;
    var staged = nhtStaged(c);
    if (!staged.length) return;
    state.busy = true; state.nhtMsg = {}; modalScroll(renderApp);
    call('submitPageChanges', { trainer: state.trainer, empId: id, changes: staged.map(function (x) { return { field: x.field, value: x.value }; }) }).then(function (res) {
      state.busy = false;
      var left = null, okN = 0, pendN = 0, bad = 0;
      (res.results || []).forEach(function (r) {
        var st = staged.filter(function (x) { return x.field === r.field; })[0], value = st ? st.value : {};
        if (!r.ok) { bad++; state.nhtMsg[r.field] = { tone: 'crit', text: r.error || 'Not saved.' }; return; }
        if (r.status === 'pending') {
          pendN++;
          (c.pending = c.pending || {})[r.field] = { newText: r.newText, on: state.nht.today };
          state.nhtMsg[r.field] = { tone: 'good', text: 'Sent to the admin for approval. It takes effect once approved.' };
        } else {
          okN++;
          if (r.field === 'Department') { c.department = value.department; c.subTeam = value.subTeam; }
          if (r.field === 'Training Start Date') c.trainingStart = value.date;
          if (r.field === 'OJT Entered') c.ojtEntered = value.answer;
          if (r.field === 'OJT Eligible') c.ojtEligible = value.answer;
          if (r.field === 'Mock Edit') {
            (c.mocks || []).forEach(function (m) { if (attemptNumber(m.attempt) === value.attempt) { m.date = value.date; m.status = value.status; m.final = value.status === 'Pass' || value.final; } });
            if (value.status === 'Fail' && value.final) left = value;
          }
          if (r.field === 'Mock') {
            (c.mocks = c.mocks || []).push({ date: value.date, attempt: ordinal(value.attempt), score: '', status: value.status, final: value.final });
            if (value.status === 'Fail' && value.final) left = value;          // a final Fail ends training
          }
          (c.updated = c.updated || {})[r.field] = true;
        }
        if (r.field === 'Mock Edit') state.nhtMockEdit = null;
        if (r.field.indexOf('OJT') === 0) delete state.nhtOjt[r.field];
        if (r.field === 'Mock') {
          var next = (c.mocks || []).reduce(function (m, x) { return Math.max(m, attemptNumber(x.attempt)); }, 0) + 1;
          state.nhtMock = { date: state.nht.today, attempt: Math.min(next, 6), score: '', status: '', final: false };
        }
      });
      if (state.session.isAdmin) loadApprovals();
      var toOjt = c.ojtEntered === 'Yes' && c.ojtEligible === 'Yes';
      if ((left || toOjt) && !bad) {
        state.nht.candidates = state.nht.candidates.filter(function (x) { return x !== c; });
        state.notice = { tone: 'good', items: [], text: toOjt
          ? c.name + ' is marked OJT Entered and OJT Eligible, and has moved to OJT Performance.'
          : c.name + ' finished training (' + left.status + ' on the ' + ordinal(left.attempt) + ' attempt) and has left this list.' };
        if (toOjt) state.ojtView = null;                     // OJT Performance reloads with them in it
        state.nhtOpen = ''; keepScroll(renderApp); return;
      }
      state.nhtMsg._save = { tone: bad ? 'warn' : 'good', text: [okN ? okN + ' saved' : '', pendN ? pendN + ' sent for approval' : '', bad ? bad + ' not saved (see the messages above)' : ''].filter(String).join(' · ') + '.' };
      modalScroll(renderApp);
    }).catch(function (e) {
      state.busy = false; state.nhtMsg._save = { tone: 'crit', text: (e && e.message) || 'Could not save. Try again.' }; modalScroll(renderApp);
    });
  }

  /* ---------- page: performance dashboard (old) ---------- */
  function perfDefaultMonth(v) {
    var t = (v && v.today) || (state.view && state.view.today) || new Date().toISOString().slice(0, 10);
    var prev = addDays(t.slice(0, 7) + '-01', -1).slice(0, 7);          // last complete month
    return prev;
  }
  function loadPerf(month) {
    call('getPerformanceOld', month).then(function (v) {
      state.perf[month] = v;
      if (state.screen === 'app') keepScroll(renderApp);
    }).catch(fail);
  }
  function perfHomeStat() {
    var v = state.perfMonth !== null && state.perf[state.perfMonth];
    if (!v) return 'Open to see your scorecard';
    var me = v.rows.filter(function (o) { return o.email === state.trainer; })[0] || v.rows[0];
    return me ? (typeof me.L === 'number' ? 'Final score ' + me.L.toFixed(2) + ' / 5' : me.L) + ' · ' + (state.perfMonth ? monthName(state.perfMonth) : 'all months') : '';
  }
  function pctTxt(v) { return v === '' || v === undefined ? '–' : (Math.round(v * 1000) / 10) + '%'; }
  function pips(score) {
    if (score === '' || score === undefined) return '<span class="dim small">Not scored</span>';
    var h = '<span class="pips" role="img" aria-label="Score ' + score + ' of 5">';
    for (var i = 1; i <= 5; i++) h += '<i class="' + (i <= score ? 'on' : '') + '"></i>';
    return h + '</span><b class="num pip-n">' + score + '/5</b>';
  }
  var PERF_PARTS = [
    { key: 'ojt',  label: 'OJT pass (70% or above)', v: 'H', s: 'BC', n: 'V', d: 'U', unit: 'cleared OJT' },
    { key: 'wfh',  label: 'WFH attrition within 45 days', v: 'J', s: 'BB', n: 'AJ', d: 'O', unit: 'WFH joiners left', lower: true },
    { key: 'bq',   label: 'BQ projects with 20%+ improvement', v: 'K', s: 'BF', n: 'AM', d: 'AL', unit: 'required projects done' },
    { key: 'wfo',  label: 'WFO attrition within 45 days', v: 'I', s: 'BA', n: 'AI', d: 'N', unit: 'WFO joiners left', lower: true },
    { key: 'kc',   label: 'KC cleared first attempt', v: 'F', s: 'BD', n: 'Q', d: 'P', unit: 'attempted cleared on the 1st' },
    { key: 'mock', label: 'Mock cleared first attempt', v: 'G', s: 'BE', n: 'S', d: 'R', unit: 'attempted cleared on the 1st' }
  ];
  function scorecard(o) {
    var final = typeof o.L === 'number' ? o.L.toFixed(2) : o.L, w = o.weights || {};
    var lvl = { head: 'Head (all trainers)', manager: 'Manager', mentor: 'Mentor', trainer: 'Trainer' }[o.level];
    var html = '<section class="sc-head">' +
      '<div><div class="label">' + esc(lvl) + '</div><h2>' + esc(o.name) + '</h2>' +
        '<div class="dim small">' + plural(o.E, 'joiner', 'joiners') + ' (' + o.N + ' WFO · ' + o.O + ' WFH) · ' + (state.perfMonth ? 'joined in ' + esc(monthName(state.perfMonth)) : 'all months') + '</div></div>' +
      '<div class="sc-big"><span class="label">Final score</span><span class="sc-num num">' + esc(final) + (typeof o.L === 'number' ? '<small> / 5</small>' : '') + '</span></div>' +
      (o.level === 'trainer' ? '<div class="sc-big"><span class="label">Incentive achievement</span><span class="sc-num num' + (typeof o.M === 'number' && o.M >= 1 ? ' good-ink' : '') + '">' + (typeof o.M === 'number' ? Math.round(o.M * 1000) / 10 + '%' : '–') + '</span></div>' : '') +
      '</section>';
    html += '<div class="parts">' + PERF_PARTS.map(function (p) {
      var val = o[p.v], sc = o[p.s], wt = w[p.key];
      return '<div class="part"><span class="label">' + esc(p.label) + '</span>' +
        '<div class="part-row"><span class="part-v num">' + pctTxt(val) + '</span><span class="dim small num">' + o[p.n] + ' of ' + o[p.d] + '</span></div>' +
        '<div class="part-row">' + pips(sc) + '<span class="dim small">' + (wt ? 'weight ' + (Math.round(wt * 10) / 10) + '%' : 'not counted') + '</span></div>' +
        (p.lower ? '<span class="dim tiny">Lower is better</span>' : '') + '</div>';
    }).join('') + '</div>';
    var row = function (label, t, wfo, wfh, base) {
      var pc = function (n, d) { return d ? ' <span class="dim">(' + Math.round(n / d * 1000) / 10 + '%)</span>' : ''; };
      return '<tr><td>' + label + '</td><td class="r num">' + t + pc(t, base[0]) + '</td><td class="r num">' + wfo + pc(wfo, base[1]) + '</td><td class="r num">' + wfh + pc(wfh, base[2]) + '</td></tr>';
    };
    var b = [o.E, o.N, o.O];
    html += '<div class="detail-grid">' +
      '<div class="table-wrap"><table class="mini"><caption>Attrition (counted from DOJ)</caption><thead><tr><th></th><th class="r">Total</th><th class="r">WFO</th><th class="r">WFH</th></tr></thead><tbody>' +
        row('Within 7 days', o.Y, o.Z, o.AA, b) + row('Within 15 days', o.AB, o.AC, o.AD, b) + row('Within 30 days', o.AE, o.AF, o.AG, b) +
        row('Within 45 days', o.AH, o.AI, o.AJ, b) + '<tr><td>Day 16 to 45</td><td class="r num">' + o.AK + (o.E ? ' <span class="dim">(' + pctTxt(o.AZ) + ')</span>' : '') + '</td><td></td><td></td></tr>' +
      '</tbody></table></div>' +
      '<div class="table-wrap"><table class="mini"><caption>Training and OJT</caption><tbody>' +
        '<tr><td>KC attempted</td><td class="r num">' + o.P + '</td></tr>' +
        '<tr><td>KC cleared overall</td><td class="r num">' + o.KCPASS + ' <span class="dim">(' + pctTxt(o.P ? o.KCPASS / o.P : '') + ')</span></td></tr>' +
        '<tr><td>KC cleared 1st attempt</td><td class="r num">' + o.Q + ' <span class="dim">(' + pctTxt(o.F) + ')</span></td></tr>' +
        '<tr><td>Mock attempted</td><td class="r num">' + o.R + '</td></tr>' +
        '<tr><td>Mock cleared overall</td><td class="r num">' + o.T + ' <span class="dim">(' + pctTxt(o.R ? o.T / o.R : '') + ')</span></td></tr>' +
        '<tr><td>Mock cleared 1st attempt</td><td class="r num">' + o.S + ' <span class="dim">(' + pctTxt(o.G) + ')</span></td></tr>' +
        '<tr><td>OJT completed</td><td class="r num">' + o.U + '</td></tr>' +
        '<tr><td>OJT 70% or above</td><td class="r num">' + o.V + ' <span class="dim">(' + pctTxt(o.H) + ')</span></td></tr>' +
        '<tr><td>OJT 80% or above</td><td class="r num">' + o.W + ' <span class="dim">(' + pctTxt(o.AN) + ')</span></td></tr>' +
        '<tr><td>OJT 90% or above</td><td class="r num">' + o.X + ' <span class="dim">(' + pctTxt(o.AO) + ')</span></td></tr>' +
        '<tr><td>BQ projects required</td><td class="r num">' + o.AL + '</td></tr>' +
        '<tr><td>BQ projects done (20%+ improvement)</td><td class="r num">' + o.AM + ' <span class="dim">(' + pctTxt(o.K) + ')</span></td></tr>' +
      '</tbody></table></div></div>';
    return html;
  }
  function perfOldPage() {
    if (state.perfMonth === null) state.perfMonth = perfDefaultMonth(null);
    var m = state.perfMonth, v = state.perf[m];
    var months = (v && v.months) || Object.keys(state.perf).reduce(function (a, k) { return (state.perf[k].months || a); }, []);
    if (months.indexOf(m) < 0 && m) months = months.concat([m]).sort();
    var html = '<div class="att-bar"><label class="field"><span class="label">Month of joining</span><select id="perf-month">' +
      '<option value=""' + (m === '' ? ' selected' : '') + '>All months</option>' +
      months.map(function (x) { return '<option value="' + x + '"' + (x === m ? ' selected' : '') + '>' + monthName(x) + '</option>'; }).join('') +
      '</select></label><span class="dim small">Same rules as the T&amp;D Performance Tracker sheet: hires counted by DOJ month, laterals and same-day exits left out.</span></div>';
    if (!v) {
      if (state.perfLoading !== m) { state.perfLoading = m; loadPerf(m); }
      return html + '<div class="loading">Working out scores…</div>';
    }
    state.perfLoading = null;
    var rows = v.rows;
    if (!rows.length) return html + '<div class="empty">No scorecard to show.</div>';
    // Default: the viewer's own head / manager / mentor row, else the trainer picked in the header.
    var open = rows.filter(function (o) { return o.level !== 'trainer' && o.email === state.session.email; })[0] ||
               rows.filter(function (o) { return o.level === 'trainer' && o.email === state.trainer; })[0] || rows[0];
    if (state.perfOpen) open = rows.filter(function (o) { return o.level + '|' + o.email === state.perfOpen; })[0] || open;
    html += scorecard(open);

    if (rows.length > 1) {
      var order = { head: 0, manager: 1, mentor: 2, trainer: 3 };
      var list = rows.slice().sort(function (a, b) {
        return order[a.level] - order[b.level] || (typeof b.L === 'number' ? b.L : -1) - (typeof a.L === 'number' ? a.L : -1) || a.name.localeCompare(b.name);
      });
      html += '<h2 class="grp-title team-title">Team · ' + (m ? esc(monthName(m)) : 'all months') + '</h2>' +
        '<div class="table-wrap"><table class="team"><thead><tr><th>Name</th><th class="r">Joiners</th><th class="r">KC 1st</th><th class="r">Mock 1st</th><th class="r">OJT 70%+</th>' +
        '<th class="r">WFO left ≤45d</th><th class="r">WFH left ≤45d</th><th class="r">BQ done</th><th class="r">Final</th><th class="r">Incentive</th></tr></thead><tbody>' +
        list.map(function (o) {
          var key = o.level + '|' + o.email, on = o === open;
          return '<tr class="pick' + (on ? ' on' : '') + '" data-perf="' + esc(key) + '"><td><div class="nm">' + esc(o.name) + '</div><div class="id">' + esc({ head: 'Head', manager: 'Manager', mentor: 'Mentor', trainer: 'Trainer' }[o.level]) + '</div></td>' +
            '<td class="r num">' + o.E + '</td><td class="r num">' + pctTxt(o.F) + '</td><td class="r num">' + pctTxt(o.G) + '</td><td class="r num">' + pctTxt(o.H) + '</td>' +
            '<td class="r num">' + pctTxt(o.I) + '</td><td class="r num">' + pctTxt(o.J) + '</td><td class="r num">' + pctTxt(o.K) + '</td>' +
            '<td class="r num"><b>' + (typeof o.L === 'number' ? o.L.toFixed(2) : '<span class="dim">' + esc(o.L) + '</span>') + '</b></td>' +
            '<td class="r num">' + (typeof o.M === 'number' ? Math.round(o.M * 1000) / 10 + '%' : '–') + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="dim small">Click a row to open that scorecard.</p>';
    }
    html += '<details class="how"><summary>How the score is worked out</summary>' +
      '<p>Each part is scored 0 to 5, then weighted: OJT 45%, WFH attrition 20%, BQ projects 15%, WFO attrition 10%, KC 5%, mock 5%. ' +
      'If there were no WFO joiners, WFH attrition takes 30% (and the other way round). Weights of parts with nothing to score are shared equally among the rest. ' +
      'No WFO or WFH joiners and no BQ target gives "Not Eligible". Incentive achievement is the final score × 25% (a 4 is 100%).</p>' +
      '<p>Attrition and OJT bands get stricter as the group gets bigger (more than 20, 10 to 20, under 10). KC and mock: under 65% scores 0, 65% 1, 70% 2, 75% 3, 85% to 90% 4, above 90% 5.</p></details>';
    return html;
  }

  /* ---------- page: OJT summary ---------- */
  var OJT_PAGE = 20;            // rows shown per team before "Show more"
  var OJT_STATES = ['In OJT', 'OJT completed', 'Waiting for first call', 'Left'];
  var OJT_STATE_LABEL = { 'In OJT': 'In OJT', 'OJT completed': 'Completed', 'Waiting for first call': 'Waiting for first call', 'Left': 'Left during OJT', 'No team': 'Needs a team' };
  function teamLabel(key) { var p = String(key || '').split('|'); return p[1] ? p[1] : ''; }
  function teamDept(key) { return String(key || '').split('|')[0]; }
  function fmtKind(kind, v) {
    if (v === null || v === undefined || v === '') return '–';
    if (kind === 'hours') return (Math.round(v * 10) / 10).toLocaleString('en-IN') + ' h';
    if (kind === 'inr') return '₹' + Math.round(v).toLocaleString('en-IN');
    if (kind === 'pct') return (Math.round(v * 1000) / 10) + '%';
    if (kind === 'rating') return String(Math.round(v * 10) / 10);
    return Math.round(v * 10) / 10 === Math.round(v) ? Math.round(v).toLocaleString('en-IN') : String(Math.round(v * 10) / 10);
  }
  /** "1 Oct" (or "1 Oct 2025" when not this year) */
  function shortDay(iso, today) {
    if (!iso) return '–';
    var p = iso.split('-');
    return (+p[2]) + ' ' + MONTHS[+p[1] - 1] + (today && p[0] !== today.slice(0, 4) ? ' ' + p[0] : '');
  }
  function tone(p) { return p === null || p === undefined ? '' : p >= 0.7 ? 'good' : p >= 0.5 ? 'warn' : 'crit'; }
  /** A bar with the percentage beside it. neutral: no traffic-light colour (OJT still running). */
  function achBar(p, neutral) {
    if (p === null || p === undefined) return '<span class="dim">–</span>';
    return '<div class="ach"><div class="track"><i class="' + (neutral ? '' : tone(p)) + '" style="width:' + Math.min(100, Math.round(p * 100)) + '%"></i></div>' +
      '<span class="tnum">' + Math.round(p * 100) + '%</span></div>';
  }
  function resultPill(r) {
    if (!r.result) return '<span class="dim">–</span>';
    var cls = r.result === 'Pass' ? 'good' : r.result === 'Fail' ? 'crit' : r.result === 'In OJT' ? 'ojt' : r.result === 'OJT attrition' ? 'done' : 'pending';
    return '<span class="pill ' + cls + '">' + esc(r.result) + '</span>';
  }
  var OJT_DATA_NOTE = {
    partial: 'The dump covers only part of the OJT window',
    nodump: 'Not in the dumps for this OJT window',
    nosource: 'No data source yet',
    manual: 'Not entered yet',
    notstarted: 'OJT not started',
    pending: 'Shows after the next OJT refresh'
  };

  function ojtPage() {
    var v = state.ojtView;
    if (!v || v.trainer !== state.trainer) {
      if (state.ojtLoading !== state.trainer) {
        state.ojtLoading = state.trainer;
        var t = state.trainer;
        call('getOjtSummary', t).then(function (r) { if (state.trainer === t) { state.ojtView = r; state.ojtLoading = ''; renderApp(); } }).catch(fail);
      }
      return '<div class="loading">Loading OJT…</div>';
    }
    var html = '<div class="ojt-top"><p class="dim">Everyone marked OJT Entered and OJT Eligible in Active NHT Details, with their 30-day OJT against their team\'s targets.</p>' +
      '<div class="ojt-refresh"><span class="dim small">' + (v.updatedOn ? 'Updated ' + esc(day(String(v.updatedOn).slice(0, 10))) : '') + '</span>' +
      (v.isAdmin ? '<button class="btn btn-sm" id="ojt-refresh"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Refreshing…' : 'Refresh now') + '</button>' : '') + '</div></div>';
    if (!v.sheetFound) return html + '<div class="empty">OJT data has not been built yet. ' + (v.isAdmin ? 'Press "Refresh now" to build it.' : 'Ask an admin to refresh OJT data.') + '</div>';

    var rows = v.rows, count = function (st) { return rows.filter(function (r) { return r.status === st; }).length; };
    var judged = rows.filter(function (r) { return r.result === 'Pass' || r.result === 'Fail'; });
    var passed = judged.filter(function (r) { return r.result === 'Pass'; }).length;
    var ach = rows.filter(function (r) { return r.status === 'OJT completed' && r.achievement !== null; })
      .map(function (r) { return r.achievement; }).sort(function (a, b) { return a - b; });
    var mid = ach.length ? (ach.length % 2 ? ach[(ach.length - 1) / 2] : (ach[ach.length / 2 - 1] + ach[ach.length / 2]) / 2) : null;
    var noTeam = rows.filter(function (r) { return r.status !== 'Left' && !r.team; });
    html += '<section class="summary ojt-tiles" aria-label="OJT totals">' +
      tile(count('In OJT'), 'In OJT now') +
      tile(count('OJT completed'), 'Completed OJT') +
      tile(judged.length ? Math.round(passed / judged.length * 100) + '%' : '–', 'Pass rate · ' + passed + ' of ' + judged.length) +
      tile(mid === null ? '–' : Math.round(mid * 100) + '%', 'Median achievement') +
      '</section>';

    var states = OJT_STATES.concat(noTeam.length ? ['No team'] : []);
    if (state.ojtFilter === 'No team' && !noTeam.length) state.ojtFilter = 'In OJT';
    html += '<div class="filters">' + states.map(function (st) {
      var n = st === 'No team' ? noTeam.length : count(st);
      return '<button class="filter' + (st === 'No team' ? ' warn' : '') + '" data-ojt-filter="' + esc(st) + '" aria-pressed="' + (state.ojtFilter === st) + '">' +
        esc(OJT_STATE_LABEL[st]) + '<span class="num">' + n + '</span></button>';
    }).join('') + '</div>';

    var f = state.ojtFilter;
    var list = f === 'No team' ? noTeam : rows.filter(function (r) { return r.status === f; });
    if (!list.length) return html + '<div class="empty">Nobody here right now.</div>';
    var sorter = f === 'In OJT' ? function (a, b) { return b.ojtDay - a.ojtDay || a.name.localeCompare(b.name); }
      : f === 'OJT completed' || f === 'Left' ? function (a, b) { return a.ojtEnd < b.ojtEnd ? 1 : a.ojtEnd > b.ojtEnd ? -1 : a.name.localeCompare(b.name); }
      : function (a, b) { return a.name.localeCompare(b.name); };

    // Columns per view: [header, cell(r), class]
    var T = v.today;
    var COLS = {
      'In OJT': [
        ['OJT dates', function (r) { return shortDay(r.ojtStart, T) + ' – ' + shortDay(r.ojtEnd, T); }, 'opt'],
        ['Progress', function (r) { return '<div class="ach"><div class="track"><i style="width:' + Math.min(100, Math.round(r.ojtDay / 30 * 100)) + '%"></i></div><span class="tnum">Day ' + r.ojtDay + '</span></div>'; }],
        ['Achievement so far', function (r) { return achBar(r.achievement, true); }]
      ],
      'OJT completed': [
        ['OJT ended', function (r) { return shortDay(r.ojtEnd, T); }, 'opt'],
        ['Achievement', function (r) { return achBar(r.achievement, true); }],
        ['Score', function (r) { return r.score === null ? '<span class="dim">–</span>' : r.score.toFixed(1); }, 'r opt'],
        ['Result', function (r) { return resultPill(r); }]
      ],
      'Waiting for first call': [
        ['Training ended', function (r) { return shortDay(r.trainingEnd, T); }],
        ['Waiting', function (r) { return Math.max(0, daysBetween(r.trainingEnd, T)) + ' days'; }, 'r'],
        ['Last call', function (r) { return r.lastTalk ? shortDay(r.lastTalk, T) : '<span class="dim">None yet</span>'; }, 'opt']
      ],
      'Left': [
        ['OJT dates', function (r) { return r.ojtStart ? shortDay(r.ojtStart, T) + ' – ' + shortDay(r.ojtEnd, T) : '<span class="dim">Not started</span>'; }],
        ['Talktime', function (r) { return r.talkHours.toFixed(1) + ' h'; }, 'r'],
        ['Last call', function (r) { return r.lastTalk ? shortDay(r.lastTalk, T) : '–'; }, 'opt']
      ]
    };
    var cols = f === 'No team' ? [['Status', function (r) { return esc(OJT_STATE_LABEL[r.status] || r.status); }], ['Training ended', function (r) { return shortDay(r.trainingEnd, T); }]] : COLS[f];
    var span = cols.length + 2;

    // Group by OJT team
    var groups = {}, order = [];
    list.forEach(function (r) { var k = r.team || ''; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(r); });
    order.sort(function (a, b) { return !a ? 1 : !b ? -1 : groups[b].length - groups[a].length || a.localeCompare(b); });

    html += '<div class="table-wrap"><table class="ojt2"><thead><tr><th>Trainee</th>' +
      cols.map(function (c) { return '<th' + (c[2] ? ' class="' + c[2] + '"' : '') + '>' + c[0] + '</th>'; }).join('') + '<th class="chev-col"><span class="sr">Details</span></th></tr></thead>';
    order.forEach(function (k) {
      var g = groups[k].sort(sorter);
      var gj = g.filter(function (r) { return r.result === 'Pass' || r.result === 'Fail'; }), gp = gj.filter(function (r) { return r.result === 'Pass'; }).length;
      html += '<tbody><tr class="grp"><th colspan="' + span + '" scope="colgroup"><span class="grp-name">' + esc(k ? teamLabel(k) : 'No OJT team') + '</span>' +
        (k && teamDept(k) !== teamLabel(k) && teamLabel(k).indexOf(teamDept(k)) !== 0 ? '<span class="dim"> · ' + esc(teamDept(k)) + '</span>' : '') +
        '<span class="grp-n">' + plural(g.length, 'trainee', 'trainees') + (f === 'OJT completed' && gj.length ? ' · ' + gp + ' of ' + gj.length + ' passed' : '') + '</span></th></tr>';
      var limit = state.ojtShowAll[f + '|' + k] ? g.length : OJT_PAGE;
      g.forEach(function (r, i) {
        if (i >= limit && state.ojtOpen !== r.empId) return;
        var open = state.ojtOpen === r.empId;
        var pend = r.pending && Object.keys(r.pending).length;
        html += '<tr class="ojt-row' + (open ? ' open' : '') + '" data-ojt-open="' + esc(r.empId) + '" tabindex="0" aria-expanded="' + open + '">' +
          '<td><span class="nm">' + esc(r.name) + '</span>' + (pend ? ' <span class="dot" title="Waiting for approval"></span>' : '') +
          '<span class="id">' + esc(r.empId) + byTrainer(r) + '</span></td>' +
          cols.map(function (c) { return '<td class="' + (c[2] || '') + '">' + c[1](r) + '</td>'; }).join('') +
          '<td class="r chev-col"><span class="chev" aria-hidden="true">' + (open ? '▴' : '▾') + '</span></td></tr>';
        if (open) html += '<tr class="ojt-detail-row"><td colspan="' + span + '">' + ojtDetail(r, v) + '</td></tr>';
      });
      if (g.length > limit) html += '<tr class="more-row"><td colspan="' + span + '"><button class="link-btn" data-ojt-more="' + esc(f + '|' + k) + '">Show ' + (g.length - limit) + ' more</button></td></tr>';
      html += '</tbody>';
    });
    html += '</table></div>';
    html += '<details class="how ojt-how"><summary>How OJT is measured</summary>' +
      '<p>OJT starts on the first day in the Talktime sheet with more than 2 seconds of talktime, on or after the day training ended, and runs 30 days.</p>' +
      '<p>Each trainee is measured on their OJT team\'s metrics from the OJT Targets sheet. Talktime counts from DOJ; the other figures come from the sales and servicing dumps. ' +
      'Each metric scores 0 to 5 (under 50% of target is 0, 50% 1, 60% 2, 65% 3, 70–75% 4, above 75% 5), then the scores are weighted into the OJT score.</p>' +
      '<p>Achievement is the weighted percentage of target; talktime counts up to 100%. The pass rule depends on the team and is shown on each trainee.</p></details>';
    return html;
  }

  /** The panel under a trainee: result, one card per metric (with weeks), and the OJT team. */
  function ojtDetail(r, v) {
    var T = v.today, teams = v.teams || [], team = teams.filter(function (t) { return t.key === r.team; })[0];
    var msg = state.ojtMsg[r.empId], pend = r.pending || {};
    var html = '<div class="ojt-detail">';
    if (msg) html += '<div class="notice ' + msg.tone + '">' + esc(msg.text) + '</div>';

    // Headline (hidden when the team changed since the last refresh: those figures belong to the old team)
    var stale = team && r.metrics.length && r.metrics.map(function (m) { return m.name; }).join('|') !== team.metrics.map(function (m) { return m.name; }).join('|');
    if (stale) r = Object.assign({}, r, { result: '', achievement: null, score: null, passRule: '' });
    html += '<div class="od-head">' +
      '<div class="od-stat"><span class="label">Result</span>' + resultPill(r) + '</div>' +
      '<div class="od-stat"><span class="label">Achievement</span><b class="tnum">' + (r.achievement === null ? '–' : Math.round(r.achievement * 100) + '%') + '</b></div>' +
      '<div class="od-stat"><span class="label">OJT score</span><b class="tnum">' + (r.score === null ? '–' : r.score.toFixed(2)) + '<small> / 5</small></b></div>' +
      '<div class="od-meta dim small">' + (r.ojtStart ? 'OJT ' + esc(shortDay(r.ojtStart, T)) + ' – ' + esc(shortDay(r.ojtEnd, T)) : 'OJT not started') +
        (r.passRule ? '<br>Pass rule: ' + esc(r.passRule) : '') + '</div></div>';

    // Metric cards
    if (team && team.metrics.length) {
      var same = r.metrics.length && r.metrics.map(function (m) { return m.name; }).join('|') === team.metrics.map(function (m) { return m.name; }).join('|');
      var metrics = same ? r.metrics : team.metrics.map(function (m) {
        return { name: m.name, kind: m.kind, weight: m.weight, target: m.target, achieved: null, pct: null, score: null, data: r.ojtStart ? 'pending' : 'notstarted', weeks: [] };
      });
      html += '<div class="mcards">' + metrics.map(function (m) {
        var def = team.metrics.filter(function (x) { return x.name === m.name; })[0] || {};
        var weeks = (m.weeks || []).filter(function (w) { return w.target !== null || w.achieved !== null; }).length ? m.weeks : [];
        var h = '<div class="mcard"><div class="mc-top"><span class="mc-name">' + esc(m.name) + '</span><span class="dim small">' + Math.round((m.weight || 0) * 100) + '% weight</span></div>' +
          '<div class="mc-val"><b class="tnum">' + fmtKind(m.kind, m.achieved) + '</b><span class="dim"> of ' + fmtKind(m.kind, m.target) + '</span>' +
          (m.score !== null && m.score !== undefined ? '<span class="mc-score">' + m.score + '/5</span>' : '') + '</div>' +
          achBar(m.pct, r.status === 'In OJT');
        if (m.data && m.data !== 'ok') h += '<div class="mc-note">' + esc(OJT_DATA_NOTE[m.data] || m.data) + '</div>';
        if (weeks.length) {
          h += '<div class="mc-weeks">' + weeks.map(function (w, k) {
            var hit = w.achieved !== null && w.target ? w.achieved >= w.target : null;
            return '<div' + (hit ? ' class="hit"' : '') + '><span class="label">W' + (k + 1) + '</span><span class="tnum">' + (w.achieved === null ? '–' : fmtKind(m.kind, w.achieved)) + '</span>' +
              (w.target !== null ? '<span class="dim tnum">of ' + fmtKind(m.kind, w.target) + '</span>' : '<span class="dim">&nbsp;</span>') + '</div>';
          }).join('') + '</div>';
        }
        if (def.manual && r.ojtStart) {
          var key = r.empId + '|' + m.name, fld = 'OJT Input: ' + m.name, cur = (r.manual || {})[m.name];
          var val = state.ojtInput[key] !== undefined ? state.ojtInput[key] : (cur === undefined ? '' : cur);
          h += '<div class="mc-input"><input type="number" min="0" step="0.1" inputmode="decimal" aria-label="' + esc(m.name) + '" placeholder="Enter ' + esc(m.name) + '" data-ojt-input="' + esc(key) + '" value="' + esc(val) + '">' +
            '<button class="btn btn-sm" data-ojt-input-save="' + esc(key) + '"' + (state.busy ? ' disabled' : '') + '>' + (cur === undefined ? 'Save' : 'Update') + '</button></div>' +
            (pend[fld] ? '<div class="mc-note">Waiting for approval: ' + esc(pend[fld].newText) + '</div>' : '');
        }
        return h + '</div>';
      }).join('') + '</div>';
      if (!same && r.metrics.length) html += '<div class="dim small">The team changed after the last refresh; figures show from the next OJT refresh.</div>';
    } else if (team) {
      html += '<div class="dim small">The targets sheet has no metrics for ' + esc(team.team) + ' yet.' + (team.comment ? ' ' + esc(team.comment) : '') + '</div>';
    }

    // Team (collapsed unless editing or missing)
    var editing = state.ojtTeamEdit === r.empId || !r.team;
    html += '<div class="od-team"><span class="dim small">OJT team: <b>' + esc(r.team ? teamLabel(r.team) : 'not set') + '</b>' +
      (r.team ? (r.teamSet ? ' (picked by trainer)' : ' (from department)') : '') + '</span>' +
      (editing ? '' : '<button class="link-btn" data-ojt-team-edit="' + esc(r.empId) + '">Change</button>') + '</div>';
    if (pend['OJT Team']) html += '<div class="mc-note">Waiting for approval: ' + esc(pend['OJT Team'].newText) + '</div>';
    if (editing) {
      var pick = state.ojtTeamPick[r.empId] !== undefined ? state.ojtTeamPick[r.empId] : r.team;
      var depts = {}, opts = '<option value="">Select OJT team</option>';
      teams.forEach(function (t) { if (t.metrics.length) (depts[t.dept] = depts[t.dept] || []).push(t); });
      Object.keys(depts).forEach(function (d) {
        opts += '<optgroup label="' + esc(d) + '">' + depts[d].map(function (t) {
          return '<option value="' + esc(t.key) + '"' + (t.key === pick ? ' selected' : '') + '>' + esc(t.team) + '</option>';
        }).join('') + '</optgroup>';
      });
      html += '<div class="od-team-edit"><select aria-label="OJT team" data-ojt-team="' + esc(r.empId) + '">' + opts + '</select>' +
        '<button class="btn btn-sm btn-primary" data-ojt-team-save="' + esc(r.empId) + '"' + (!pick || pick === r.team || state.busy ? ' disabled' : '') + '>Save</button>' +
        (r.team ? '<button class="link-btn" data-ojt-team-cancel="' + esc(r.empId) + '">Cancel</button>' : '') + '</div>' +
        '<div class="dim small">' + (r.updated && r.updated['OJT Team'] && !v.isAdmin ? 'Changing the team again needs admin approval.' : 'The first change saves straight away; later changes need admin approval.') + '</div>';
    }
    return html + '</div>';
  }

  /* ---------- page: performance dashboard (new) ---------- */
  function perfNHomeStat() {
    var v = state.perfNMonth !== null && state.perfN[state.perfNMonth];
    if (!v) return 'Open to see attrition, NHP and graduation';
    var me = v.rows.filter(function (o) { return o.email === state.trainer; })[0] || v.rows[0];
    return me ? 'NHT graduation ' + pctTxt(me.gradpT) + ' · NHP ' + pctTxt(me.nhp70T) + ' · ' + (state.perfNMonth ? monthName(state.perfNMonth) : 'all months') : '';
  }
  function ncTile(label, pv, n, d, sub, lower) {
    return '<div class="part"><span class="label">' + esc(label) + '</span>' +
      '<div class="part-row"><span class="part-v num">' + pctTxt(pv) + '</span><span class="dim small num">' + n + ' of ' + d + '</span></div>' +
      '<div class="part-row"><span class="dim small">' + sub + '</span></div>' + (lower ? '<span class="dim tiny">Lower is better</span>' : '') + '</div>';
  }
  function ncCard(o, win) {
    var lvl = { head: 'Head (all trainers)', manager: 'Manager', trainer: 'Trainer' }[o.level];
    var mix = function (a, b) { return 'WFO ' + pctTxt(a) + ' · WFH ' + pctTxt(b); };
    var html = '<section class="sc-head"><div><div class="label">' + esc(lvl) + '</div><h2>' + esc(o.name) + '</h2>' +
      '<div class="dim small">Window ' + esc(day(win.from)) + ' to ' + esc(day(win.to)) + (win.toOjt !== win.to ? ' (OJT and NHT up to ' + esc(day(win.toOjt)) + ')' : '') + '</div></div>' +
      '<div class="sc-big"><span class="label">NHT graduation</span><span class="sc-num num">' + pctTxt(o.gradpT) + '</span></div>' +
      '<div class="sc-big"><span class="label">NHP (70%)</span><span class="sc-num num">' + pctTxt(o.nhp70T) + '</span></div></section>';
    html += '<div class="parts">' +
      ncTile('NHT graduation', o.gradpT, o.gradT, o.joinT, mix(o.gradpO, o.gradpH)) +
      ncTile('NHP: OJT cleared at 70%', o.nhp70T, o.clr70T, o.ojtT, mix(o.nhp70O, o.nhp70H)) +
      ncTile('NHP: OJT cleared at 80%', o.nhp80T, o.clr80T, o.ojtT, mix(o.nhp80O, o.nhp80H)) +
      ncTile('Left within 15 days', o.exitp15T, o.exit15T, o.comp15T, mix(o.exitp15O, o.exitp15H), true) +
      ncTile('Left within 30 days', o.exitp30T, o.exit30T, o.comp30T, mix(o.exitp30O, o.exitp30H), true) +
      ncTile('Left within 45 days', o.exitp45T, o.exit45T, o.comp45T, mix(o.exitp45O, o.exitp45H), true) +
      '</div>';
    var cell = function (n, d) { return n + (d ? ' <span class="dim">(' + pctTxt(n / d) + ')</span>' : ''); };
    var attr = function (n) {
      return '<tr><td>Completed ' + n + ' days</td><td class="r num">' + o['comp' + n + 'T'] + '</td><td class="r num">' + o['comp' + n + 'O'] + '</td><td class="r num">' + o['comp' + n + 'H'] + '</td></tr>' +
        '<tr><td>Left within ' + n + ' days</td><td class="r num">' + cell(o['exit' + n + 'T'], o['comp' + n + 'T']) + '</td><td class="r num">' + cell(o['exit' + n + 'O'], o['comp' + n + 'O']) + '</td><td class="r num">' + cell(o['exit' + n + 'H'], o['comp' + n + 'H']) + '</td></tr>';
    };
    var trio = function (label, k, base) {
      return '<tr><td>' + label + '</td>' + ['T', 'O', 'H'].map(function (m) { return '<td class="r num">' + (base ? cell(o[k + m], o[base + m]) : o[k + m]) + '</td>'; }).join('') + '</tr>';
    };
    var head = '<thead><tr><th></th><th class="r">Total</th><th class="r">WFO</th><th class="r">WFH</th></tr></thead>';
    html += '<div class="detail-grid">' +
      '<div class="table-wrap"><table class="mini"><caption>Attrition by days completed</caption>' + head + '<tbody>' + attr(15) + attr(30) + attr(45) + '</tbody></table></div>' +
      '<div class="table-wrap"><table class="mini"><caption>OJT (OJT ended in the window)</caption>' + head + '<tbody>' +
        trio('OJT completed', 'ojt') + trio('Cleared at 70%', 'clr70', 'ojt') + trio('Cleared at 80%', 'clr80', 'ojt') + trio('Cleared at 90%', 'clr90', 'ojt') + '</tbody></table>' +
      '<table class="mini"><caption>NHT (training ended in the window)</caption>' + head + '<tbody>' +
        trio('Training ended', 'join') + trio('Graduated (mock passed)', 'grad', 'join') + '</tbody></table></div>' +
      '</div>';
    return html;
  }
  function perfNewPage() {
    if (state.perfNMonth === null) state.perfNMonth = perfDefaultMonth(null);
    var m = state.perfNMonth, v = state.perfN[m];
    var months = (v && v.months) || Object.keys(state.perfN).reduce(function (a, k) { return state.perfN[k].months || a; }, []);
    if (months.indexOf(m) < 0 && m) months = months.concat([m]).sort();
    var html = '<div class="att-bar"><label class="field"><span class="label">Month</span><select id="perfn-month">' +
      '<option value=""' + (m === '' ? ' selected' : '') + '>Since 1 Feb (to date)</option>' +
      months.map(function (x) { return '<option value="' + x + '"' + (x === m ? ' selected' : '') + '>' + monthName(x) + '</option>'; }).join('') +
      '</select></label><span class="dim small">Same rules as the New Cal sheet. Every figure looks at people who reached that stage in the month, not at people who joined in it.</span></div>';
    if (!v) {
      if (state.perfNLoading !== m) { state.perfNLoading = m; call('getPerformanceNew', m).then(function (r) { state.perfN[m] = r; if (state.screen === 'app') keepScroll(renderApp); }).catch(fail); }
      return html + '<div class="loading">Working out figures…</div>';
    }
    state.perfNLoading = null;
    var rows = v.rows;
    if (!rows.length) return html + '<div class="empty">Nothing to show.</div>';
    var open = rows.filter(function (o) { return o.level !== 'trainer' && o.email === state.session.email; })[0] ||
               rows.filter(function (o) { return o.level === 'trainer' && o.email === state.trainer; })[0] || rows[0];
    if (state.perfNOpen) open = rows.filter(function (o) { return o.level + '|' + o.email === state.perfNOpen; })[0] || open;
    html += ncCard(open, v.window);
    if (rows.length > 1) {
      var order = { head: 0, manager: 1, trainer: 2 };
      var list = rows.slice().sort(function (a, b) { return order[a.level] - order[b.level] || a.name.localeCompare(b.name); });
      html += '<h2 class="grp-title team-title">Team · ' + (m ? esc(monthName(m)) : 'since 1 Feb') + '</h2>' +
        '<div class="table-wrap"><table class="team"><thead><tr><th>Name</th><th class="r">Training ended</th><th class="r">NHT graduation</th><th class="r">OJT completed</th>' +
        '<th class="r">NHP 70%</th><th class="r">Left ≤15d</th><th class="r">Left ≤30d</th><th class="r">Left ≤45d</th></tr></thead><tbody>' +
        list.map(function (o) {
          var key = o.level + '|' + o.email;
          return '<tr class="pick' + (o === open ? ' on' : '') + '" data-perfn="' + esc(key) + '"><td><div class="nm">' + esc(o.name) + '</div><div class="id">' + esc({ head: 'Head', manager: 'Manager', trainer: 'Trainer' }[o.level]) + '</div></td>' +
            '<td class="r num">' + o.joinT + '</td><td class="r num">' + pctTxt(o.gradpT) + '</td><td class="r num">' + o.ojtT + '</td><td class="r num">' + pctTxt(o.nhp70T) + '</td>' +
            '<td class="r num">' + pctTxt(o.exitp15T) + '</td><td class="r num">' + pctTxt(o.exitp30T) + '</td><td class="r num">' + pctTxt(o.exitp45T) + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="dim small">Click a row to open it.</p>';
    }
    html += '<details class="how"><summary>How these figures are worked out</summary>' +
      '<p><b>Attrition:</b> for N = 15, 30 and 45, the group is everyone who completed N days during the month (DOJ between the 1st minus N−1 days and the month end minus N−1 days). "Left" is the part of that group whose Day of Attrition is N or less.</p>' +
      '<p><b>NHP:</b> of everyone whose OJT End Date falls in the month, the share whose OJT achievement is at least 70% (or 80%, 90%).</p>' +
      '<p><b>NHT graduation:</b> of everyone whose training (final mock) ended in the month, the share whose final mock status is Pass.</p>' +
      '<p>Unlike the old tracker, laterals and same-day exits are included. The head row adds up all trainers.</p></details>';
    return html;
  }

  /* ---------- page: approvals (admins) ---------- */
  function loadApprovals() {
    call('getPendingApprovals').then(function (r) { state.approvals = r.pending || []; if (state.screen === 'app') keepScroll(renderApp); }).catch(fail);
  }
  function review(ids, decision) {
    if (!ids.length || state.busy) return;
    state.busy = true; state.notice = null; renderApp();
    call('reviewRequests', { ids: ids, decision: decision, note: state.apprNote }).then(function (res) {
      state.busy = false; state.apprPicked = {}; state.apprNote = '';
      state.notice = {
        tone: res.failed.length ? 'warn' : 'good',
        text: plural(res.done.length, 'change', 'changes') + ' ' + decision.toLowerCase() + '.' + (res.failed.length ? ' ' + plural(res.failed.length, 'change', 'changes') + ' could not be ' + decision.toLowerCase() + ':' : ''),
        items: res.failed.map(function (x) { return x.id + ' – ' + x.reason; })
      };
      state.nht = null;                 // master data changed
      loadApprovals();
    }).catch(fail);
  }
  function approvalsPage() {
    if (!state.approvals) return '<div class="loading">Loading approvals…</div>';
    var list = state.approvals.slice().sort(function (a, b) { return String(b.on).localeCompare(String(a.on)); });
    var picked = Object.keys(state.apprPicked).filter(function (id) { return list.some(function (q) { return q.id === id; }); });
    var html = '<div class="sub dim">When a trainer changes a department or training start date they already updated once, or corrects a recorded mock, it waits here for you. Their first update of each field does not need approval. Approving writes the change into Master Dashboard; every decision is kept in the change history.</div>';
    if (!list.length) return html + '<div class="empty">Nothing is waiting for approval.</div>';
    if (picked.length) {
      html += '<div class="assign-bar" role="region" aria-label="Review selected changes"><span class="grow"><b>' + picked.length + '</b> selected</span>' +
        '<label for="appr-note">Note (optional)<input type="text" id="appr-note" class="reason" value="' + esc(state.apprNote) + '"></label>' +
        '<button class="btn btn-accent" id="appr-yes"' + (state.busy ? ' disabled' : '') + '>Approve</button>' +
        '<button class="btn btn-danger" id="appr-no"' + (state.busy ? ' disabled' : '') + '>Reject</button>' +
        '<button class="link" id="appr-clear">Clear</button></div>';
    }
    var allOn = list.every(function (q) { return state.apprPicked[q.id]; });
    html += '<div class="table-wrap"><table><thead><tr><th class="check"><input type="checkbox" id="appr-all" aria-label="Select all"' + (allOn ? ' checked' : '') + '></th>' +
      '<th>Sent</th><th>Trainee</th><th>Change</th><th>From</th><th>To</th><th>Sent by</th><th></th></tr></thead><tbody>' +
      list.map(function (q) {
        var on = !!state.apprPicked[q.id];
        return '<tr class="pick' + (on ? ' on' : '') + '" data-appr="' + esc(q.id) + '"><td class="check"><input type="checkbox" tabindex="-1" aria-label="Select"' + (on ? ' checked' : '') + '></td>' +
          '<td class="num">' + esc(day(String(q.on).slice(0, 10))) + '</td>' +
          '<td><div class="nm">' + esc(q.name) + '</div><div class="id">' + esc(q.empId) + ' · ' + esc(q.trainerName || q.trainer) + '</div></td>' +
          '<td>' + esc(q.field) + '</td><td class="dim">' + esc(q.oldText || 'not set') + '</td><td><b>' + esc(q.newText) + '</b></td>' +
          '<td>' + esc(q.byName || q.by) + '</td>' +
          '<td class="row-acts"><button class="btn btn-sm" data-appr-one="' + esc(q.id) + '|Approved">Approve</button><button class="btn btn-sm" data-appr-one="' + esc(q.id) + '|Rejected">Reject</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    return html;
  }

  /* ---------- sections not built yet ---------- */
  function comingSoon(tab) {
    return '<section class="soon"><span class="pill done">In progress</span>' +
      '<h2>' + esc(tab.label) + ' is being built</h2>' +
      '<p>This section will open here once it is ready. Batch Wise Summary and Unclaimed Candidates already work.</p>' +
      '<div class="soon-actions"><button class="btn" data-tab="home">Back to home</button></div></section>';
  }

  /* ---------- page: unclaimed candidates ---------- */
  function unclaimedPage() {
    if (!state.unclaimed) return '<div class="loading">Loading unclaimed candidates…</div>';
    var admin = state.session.isAdmin, removedView = state.show === 'removed';
    var inMonthList = unclaimedInMonth(false), removedList = admin ? unclaimedInMonth(true) : [];
    var list = unclaimedMatches(), rows = list.slice(0, state.shown);
    var assignTo = assignTarget();
    var picked = pickedIds(), target = assignTo === state.session.email ? 'me' : trainerName(assignTo);
    var allOn = rows.length > 0 && rows.every(function (c) { return state.picked[c.empId]; });
    var allMatching = list.length > 0 && list.every(function (c) { return state.picked[c.empId]; });

    // Department choices with counts, from whatever the status chips currently show.
    var deptCount = {};
    unclaimedPool().forEach(function (c) { var d = c.department || NO_DEPT; deptCount[d] = (deptCount[d] || 0) + 1; });
    var depts = Object.keys(deptCount).sort(function (a, b) { return deptCount[b] - deptCount[a] || a.localeCompare(b); });
    if (state.dept && !deptCount[state.dept]) depts.unshift(state.dept), deptCount[state.dept] = 0;

    var chip = function (key, label, n) {
      return '<button class="filter" data-show="' + key + '" aria-pressed="' + (state.show === key) + '">' + label + '<span class="num">' + n.toLocaleString('en-IN') + '</span></button>';
    };
    var html = '<section class="unclaimed">' +
      '<div class="sub dim">' + (removedView
        ? 'Removed by an admin because they are not in a team the training team handles. Trainers do not see these.'
        : 'People in HR_WFO and HR_WFH who joined' + (state.session.unclaimedFrom ? ' on or after ' + day(state.session.unclaimedFrom) : '') + ' and whose Emp ID is not in Master Dashboard. New joiners appear within a minute of being added to the HR sheets.') +
        (state.month ? ' · joined in ' + esc(monthName(state.month)) : '') + '</div>' +
      '<div class="unclaimed-bar">' +
        '<input class="search" id="search" type="search" placeholder="Search by name, Emp ID, department or location" value="' + esc(state.query) + '" aria-label="Search candidates">' +
        '<select id="dept" aria-label="Department"><option value="">All departments</option>' + depts.map(function (d) {
          return '<option value="' + esc(d) + '"' + (d === state.dept ? ' selected' : '') + '>' + esc(d === NO_DEPT ? 'No department' : d) + ' (' + deptCount[d] + ')</option>';
        }).join('') + '</select>' +
        '<div class="filters">' +
          chip('active', 'Active', inMonthList.filter(function (c) { return c.active; }).length) +
          chip('all', 'All', inMonthList.length) +
          (admin ? chip('removed', 'Removed', removedList.length) : '') +
        '</div>' +
      '</div>';

    if (picked.length) {
      var selectMore = allOn && !allMatching
        ? '<button class="link" id="pick-matching">Select all ' + list.length.toLocaleString('en-IN') + ' matching</button>' : '';
      html += '<div class="assign-bar" role="region" aria-label="Act on selected candidates">' +
        '<span class="grow"><b>' + picked.length.toLocaleString('en-IN') + '</b> selected ' + selectMore + '</span>';
      if (removedView) {
        html += '<button class="btn btn-accent" id="restore"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Restoring…' : 'Restore to list') + '</button>';
      } else {
        html += '<label for="training-start">Training start date (optional)<input type="date" id="training-start" value="' + esc(state.trainingStart) + '"></label>' +
          (picked.length > MAX_ASSIGN
            ? '<span class="bar-note">Assign up to ' + MAX_ASSIGN + ' at a time</span>'
            : (state.trainer === ALL
                ? '<label for="assign-to">Assign to<select id="assign-to"><option value="">Pick a trainer</option>' + state.session.trainers.map(function (t) {
                    return '<option value="' + esc(t.email) + '"' + (t.email === assignTo ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select></label>'
                : '') +
              '<button class="btn btn-accent" id="assign"' + (state.busy || !assignTo ? ' disabled' : '') + '>' + (state.busy ? 'Working…' : assignTo ? 'Assign to ' + esc(target) : 'Assign') + '</button>');
        if (admin) {
          html += '<span class="bar-split" aria-hidden="true"></span>' +
            '<label for="reason">Reason<input type="text" id="reason" class="reason" placeholder="Not handled by the training team" value="' + esc(state.reason) + '"></label>' +
            '<button class="btn btn-danger" id="exclude"' + (state.busy ? ' disabled' : '') + '>Remove from list</button>';
        }
      }
      html += '<button class="link" id="clear-picks">Clear</button></div>';
    }

    if (!list.length) {
      var none = removedView ? 'Nobody has been removed' + (state.month ? ' from ' + esc(monthName(state.month)) + ' joiners' : '') + '.'
        : (unclaimedPool().length ? 'No candidates match this search.' : 'Everyone' + (state.month ? ' who joined in ' + esc(monthName(state.month)) : '') + ' is already mapped to a trainer.');
      return html + '<div class="empty">' + none + '</div></section>';
    }

    html += '<div class="table-wrap"><table><thead><tr>' +
      '<th class="check"><input type="checkbox" id="pick-all" aria-label="Select all candidates shown"' + (allOn ? ' checked' : '') + '></th>' +
      '<th>Candidate</th><th>Department</th><th>DOJ</th><th>Mode</th><th>Location</th><th>' + (removedView ? 'Removed' : 'Source') + '</th><th>Status</th></tr></thead><tbody>' +
      rows.map(function (c) {
        var on = !!state.picked[c.empId];
        return '<tr class="pick' + (on ? ' on' : '') + '" data-pick="' + esc(c.empId) + '">' +
          '<td class="check"><input type="checkbox" tabindex="-1" aria-label="Select ' + esc(c.name) + '"' + (on ? ' checked' : '') + '></td>' +
          '<td><div class="nm">' + esc(c.name) + (c.removedBefore ? ' <span class="pill warn">Previously removed</span>' : '') + '</div><div class="id">' + esc(c.empId) + '</div></td>' +
          '<td>' + esc(c.department || '–') + '</td>' +
          '<td class="num">' + esc(day(c.doj)) + '</td>' +
          '<td>' + esc(c.mode) + '</td>' +
          '<td>' + esc(c.location || '–') + '</td>' +
          (removedView && c.excluded
            ? '<td><div>' + esc(c.excluded.reason) + '</div><div class="id">' + esc((c.excluded.by || '').split('@')[0]) + (c.excluded.on ? ' · ' + esc(day(c.excluded.on)) : '') + '</div></td>'
            : '<td>' + esc(c.source || '–') + '</td>') +
          '<td>' + (c.active ? '<span class="pill good">Active</span>' : '<span class="pill crit">Left</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="more"><span>Showing ' + rows.length.toLocaleString('en-IN') + ' of ' + list.length.toLocaleString('en-IN') + '</span>' +
      (rows.length < list.length ? '<button class="btn" id="show-more">Show ' + Math.min(PAGE, list.length - rows.length) + ' more</button>' : '') + '</div></section>';
    return html;
  }

  /* ---------- events ---------- */
  /** Re-render without losing the page or register scroll position. */
  function keepScroll(fn) {
    var w = document.getElementById('reg-wrap'), x = w ? w.scrollLeft : 0, y = window.scrollY;
    fn();
    var w2 = document.getElementById('reg-wrap'); if (w2) w2.scrollLeft = x;
    window.scrollTo(0, y);
  }
  /** Puts the register's mark picker next to the cell being edited. */
  function placePopover() {
    var pop = document.getElementById('att-pop');
    if (!pop || !state.attEdit) return;
    var cell = root.querySelector('[data-reg="' + state.attEdit.id + '|' + state.attEdit.date + '"]');
    if (!cell) { state.attEdit = null; pop.remove(); return; }
    var r = cell.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    var top = r.bottom + 6 + h > window.innerHeight ? r.top - h - 6 : r.bottom + 6;
    pop.style.left = left + 'px'; pop.style.top = Math.max(8, top) + 'px';
    var first = pop.querySelector('[aria-pressed="true"]') || pop.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }
  document.addEventListener('click', function (ev) {
    if (state.attEdit && !ev.target.closest('#att-pop') && !ev.target.closest('[data-reg]')) { state.attEdit = null; keepScroll(renderApp); }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && state.nhtOpen) { closeNht(); return; }
    if (ev.key === 'Escape' && state.attEdit) { var c = state.attEdit; state.attEdit = null; keepScroll(renderApp);
      var b = root.querySelector('[data-reg="' + c.id + '|' + c.date + '"]'); if (b) b.focus(); }
  });
  window.addEventListener('scroll', function () { if (state.attEdit) placePopover(); }, { passive: true });
  window.addEventListener('resize', function () { if (state.attEdit) placePopover(); });

  function on(id, ev, fn) { var el = document.getElementById(id); if (el) el[ev] = fn; }
  function each(sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); }

  function wire() {
    on('signout', 'onclick', function () {
      state.screen = 'signin'; state.view = null; state.unclaimed = null; state.picked = {}; state.error = ''; state.notice = null;
      state.att = null; state.attPending = {}; state.attDate = ''; state.nht = null; state.nhtOpen = ''; state.approvals = null; state.apprPicked = {}; state.perf = {}; state.perfMonth = null; state.perfOpen = ''; state.perfN = {}; state.perfNMonth = null; state.perfNOpen = ''; state.ojtView = null;
      window.location.href = 'auth/logout';     // server build: clear the sign-in cookie, then sign in again
    });
    on('trainer-pick', 'onchange', function () { state.notice = null; state.perfOpen = 'trainer|' + this.value; state.perfNOpen = 'trainer|' + this.value; openTrainer(this.value); });
    on('month', 'onchange', function () { state.month = this.value; state.shown = PAGE; state.openKey = ''; renderApp(); });
    each('[data-tab]', function (el) {
      el.onclick = function () {
        var id = el.getAttribute('data-tab');
        if (id === state.tab) return;
        state.tab = id; state.shown = PAGE; state.notice = null; state.picked = {};
        if (id === 'unclaimed' || id === 'home') loadUnclaimed(true);       // pick up new joiners
        renderApp(); window.scrollTo(0, 0);
      };
    });

    each('[data-filter]', function (el) {
      el.onclick = function () { state.filter = el.getAttribute('data-filter'); renderApp(); };
    });
    each('[data-key]', function (el) {
      el.onclick = function () {
        state.openKey = el.getAttribute('data-key');
        var list = root.querySelector('.batch-list'), y = list ? list.scrollTop : 0;
        renderApp();
        var again = root.querySelector('.batch-list'); if (again) again.scrollTop = y;
        if (window.matchMedia('(max-width: 860px)').matches) {
          var d = document.getElementById('detail'); if (d) d.scrollIntoView({ block: 'start' });
        }
      };
    });

    on('search', 'oninput', function () {
      state.query = this.value; state.shown = PAGE;
      var at = this.selectionStart;
      renderApp();
      var again = document.getElementById('search');
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (e) {} }
    });
    each('[data-show]', function (el) {
      el.onclick = function () {
        var to = el.getAttribute('data-show');
        if (to !== state.show) { state.show = to; state.shown = PAGE; state.picked = {}; state.dept = ''; renderApp(); }
      };
    });
    each('[data-pick]', function (el) {
      el.onclick = function () {
        var id = el.getAttribute('data-pick');
        if (state.picked[id]) delete state.picked[id]; else state.picked[id] = true;
        renderApp();
      };
    });
    on('pick-all', 'onchange', function () {
      var rows = unclaimedMatches().slice(0, state.shown), checked = this.checked;
      rows.forEach(function (c) { if (checked) state.picked[c.empId] = true; else delete state.picked[c.empId]; });
      renderApp();
    });
    on('show-more', 'onclick', function () { state.shown += PAGE; renderApp(); });
    on('training-start', 'onchange', function () { state.trainingStart = this.value; });
    on('clear-picks', 'onclick', function () { state.picked = {}; renderApp(); });
    on('assign', 'onclick', assign);
    on('assign-to', 'onchange', function () { state.assignTo = this.value; renderApp(); });
    // attendance
    var goDate = function (d) { if (d) { state.attDate = d; renderApp(); } };
    on('att-date', 'onchange', function () { goDate(this.value); });
    on('att-prev', 'onclick', function () { goDate(addDays(state.attDate, -1)); });
    on('att-next', 'onclick', function () { goDate(addDays(state.attDate, 1)); });
    on('att-today', 'onclick', function () { goDate(state.att.today); });
    each('[data-att-date]', function (el) { el.onclick = function () { goDate(el.getAttribute('data-att-date')); }; });
    each('[data-att-scope]', function (el) { el.onclick = function () { state.attScope = el.getAttribute('data-att-scope'); renderApp(); }; });
    each('[data-mark]', function (el) {
      el.onclick = function () {
        var p = el.getAttribute('data-mark').split('|'), id = p[0], code = p[1];
        setMark(id, state.attDate, attCode(id, state.attDate) === code ? '' : code);
        var y = window.scrollY; renderApp(); window.scrollTo(0, y);
      };
    });
    on('att-all-present', 'onclick', function () {
      attRoster().forEach(function (t) { if (canMark(t, state.attDate) && !attCode(t.empId, state.attDate)) setMark(t.empId, state.attDate, 'P'); });
      var y = window.scrollY; renderApp(); window.scrollTo(0, y);
    });
    on('att-save', 'onclick', saveAtt);
    // NHT performance
    each('[data-nht]', function (el) { el.onclick = function () { openNht(el.getAttribute('data-nht')); }; });
    each('[data-nht-missing]', function (el) { el.onclick = function () { state.nhtOnlyMissing = el.getAttribute('data-nht-missing') === '1'; renderApp(); }; });
    on('nht-search', 'oninput', function () {
      state.nhtQuery = this.value; var at = this.selectionStart; renderApp();
      var again = document.getElementById('nht-search'); if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (e) {} }
    });
    on('nht-dept', 'onchange', function () { state.nhtDept = this.value; state.nhtSub = ''; modalScroll(renderApp); var s2 = document.getElementById('nht-sub'); if (s2 && !s2.disabled) s2.focus(); });
    on('nht-sub', 'onchange', function () { state.nhtSub = this.value; modalScroll(renderApp); });
    on('nht-close', 'onclick', closeNht);
    on('nht-ts-edit', 'onclick', function () { state.nhtTsEdit = true; modalScroll(renderApp); var d = document.getElementById('nht-ts'); if (d) d.focus(); });
    on('nht-ts-cancel', 'onclick', function () { state.nhtTsEdit = false; modalScroll(renderApp); });
    on('nht-ts', 'onchange', function () { state.nhtTs = this.value; modalScroll(renderApp); });
    on('mk-date', 'onchange', function () { state.nhtMock.date = this.value; modalScroll(renderApp); });
    on('mk-att', 'onchange', function () { state.nhtMock.attempt = Number(this.value); modalScroll(renderApp); });
    on('mk-score', 'oninput', function () { state.nhtMock.score = this.value; });
    on('mk-final', 'onchange', function () { state.nhtMock.final = this.checked; modalScroll(renderApp); });
    each('[data-mk-status]', function (el) { el.onclick = function () { state.nhtMock.status = el.getAttribute('data-mk-status'); if (state.nhtMock.status === 'Pass') state.nhtMock.final = false; modalScroll(renderApp); }; });
    each('[data-me-edit]', function (el) {
      el.onclick = function () {
        var n = Number(el.getAttribute('data-me-edit')), c = state.nht.candidates.filter(function (x) { return x.empId === state.nhtOpen; })[0];
        var m = (c.mocks || []).filter(function (x) { return attemptNumber(x.attempt) === n; }).slice(-1)[0];
        state.nhtMockEdit = { attempt: n, date: m.date, score: m.score, status: m.status, final: !!m.final };
        modalScroll(renderApp); var d = document.getElementById('me-score'); if (d) d.focus();
      };
    });
    each('[data-yn]', function (el) { el.onclick = function () { var p = el.getAttribute('data-yn').split('|'); state.nhtOjt[p[0]] = p[1]; modalScroll(renderApp); }; });
    on('me-cancel', 'onclick', function () { state.nhtMockEdit = null; modalScroll(renderApp); });
    on('me-date', 'onchange', function () { state.nhtMockEdit.date = this.value; modalScroll(renderApp); });
    on('me-score', 'oninput', function () { state.nhtMockEdit.score = this.value; });
    on('me-final', 'onchange', function () { state.nhtMockEdit.final = this.checked; modalScroll(renderApp); });
    each('[data-me-status]', function (el) { el.onclick = function () { state.nhtMockEdit.status = el.getAttribute('data-me-status'); if (state.nhtMockEdit.status === 'Pass') state.nhtMockEdit.final = false; modalScroll(renderApp); }; });
    on('nht-save', 'onclick', saveNht);
    on('nht-discard', 'onclick', function () { openNht(state.nhtOpen); });
    on('mk-clear', 'onclick', function () { state.nhtMock.status = ''; state.nhtMock.final = false; modalScroll(renderApp); });
    // OJT summary
    each('[data-ojt-filter]', function (el) { el.onclick = function () { state.ojtFilter = el.getAttribute('data-ojt-filter'); renderApp(); }; });
    on('ojt-refresh', 'onclick', function () {
      state.busy = true; renderApp();
      call('refreshOjtDashboard').then(function (r) {
        state.busy = false; state.ojtView = null; state.att = null;
        var miss = r.missingTabs && r.missingTabs.length;
        state.notice = { tone: miss ? 'warn' : 'good', text: 'OJT data refreshed: ' + r.inOjt + ' in OJT, ' + r.waiting + ' waiting for a first call (' + r.rows + ' trainees in all).' +
          (miss ? ' These tabs were not found in the dumps spreadsheet, so their achievements are blank:' : ''), items: miss ? r.missingTabs : [] };
        renderApp();
      }).catch(fail);
    });
    each('[data-ojt-open]', function (el) {
      var toggle = function () { var id = el.getAttribute('data-ojt-open'); state.ojtOpen = state.ojtOpen === id ? '' : id; renderApp(); };
      el.onclick = toggle;
      el.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
    });
    each('[data-ojt-more]', function (el) { el.onclick = function () { state.ojtShowAll[el.getAttribute('data-ojt-more')] = true; renderApp(); }; });
    each('[data-ojt-team-edit]', function (el) { el.onclick = function (e) { e.stopPropagation(); state.ojtTeamEdit = el.getAttribute('data-ojt-team-edit'); renderApp(); }; });
    each('[data-ojt-team-cancel]', function (el) { el.onclick = function () { var id = el.getAttribute('data-ojt-team-cancel'); state.ojtTeamEdit = ''; delete state.ojtTeamPick[id]; renderApp(); }; });
    each('[data-ojt-team]', function (el) { el.onchange = function () { state.ojtTeamPick[el.getAttribute('data-ojt-team')] = el.value; renderApp(); }; });
    each('[data-ojt-input]', function (el) { el.oninput = function () { state.ojtInput[el.getAttribute('data-ojt-input')] = el.value; }; });
    var ojtRow = function (id) { return ((state.ojtView && state.ojtView.rows) || []).filter(function (x) { return x.empId === id; })[0]; };
    var ojtSave = function (id, field, value, after) {
      state.busy = true; delete state.ojtMsg[id]; renderApp();
      call('submitChange', { trainer: state.trainer, empId: id, field: field, value: value }).then(function (res) {
        state.busy = false;
        if (field === 'OJT Team') state.ojtTeamEdit = '';
        var r = ojtRow(id);
        if (r) {
          r.pending = r.pending || {}; r.updated = r.updated || {};
          if (res.status === 'applied') { after(r); r.updated[field] = true; delete r.pending[field]; }
          else r.pending[field] = { newText: res.newText };
        }
        state.ojtMsg[id] = res.status === 'applied'
          ? { tone: 'good', text: 'Saved. Achievements update at the next OJT refresh.' }
          : { tone: 'info', text: 'Sent to an admin for approval: ' + field.replace(/^OJT Input: /, '') + ' → ' + res.newText + '.' };
        renderApp();
      }).catch(function (e) { state.busy = false; state.ojtMsg[id] = { tone: 'crit', text: e.message || String(e) }; renderApp(); });
    };
    each('[data-ojt-team-save]', function (el) {
      el.onclick = function () {
        var id = el.getAttribute('data-ojt-team-save'), team = state.ojtTeamPick[id];
        ojtSave(id, 'OJT Team', { team: team }, function (r) { r.team = team; r.teamSet = true; delete state.ojtTeamPick[id]; state.ojtTeamEdit = ''; });
      };
    });
    each('[data-ojt-input-save]', function (el) {
      el.onclick = function () {
        var key = el.getAttribute('data-ojt-input-save'), id = key.split('|')[0], metric = key.slice(id.length + 1);
        var r0 = ojtRow(id), val = state.ojtInput[key] !== undefined ? state.ojtInput[key] : ((r0 && r0.manual || {})[metric]);
        ojtSave(id, 'OJT Input: ' + metric, { achieved: val === '' || val === undefined ? '' : Number(val) }, function (r) {
          r.manual = r.manual || {}; r.manual[metric] = Number(val); delete state.ojtInput[key];
        });
      };
    });
    // performance (new)
    on('perfn-month', 'onchange', function () { state.perfNMonth = this.value; renderApp(); });
    each('[data-perfn]', function (el) {
      el.onclick = function () { state.perfNOpen = el.getAttribute('data-perfn'); renderApp(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    });
    // performance (old)
    on('perf-month', 'onchange', function () { state.perfMonth = this.value; renderApp(); });
    each('[data-perf]', function (el) {
      el.onclick = function () { state.perfOpen = el.getAttribute('data-perf'); renderApp(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    });
    // approvals
    each('[data-appr]', function (el) {
      el.onclick = function (ev) {
        if (ev.target.closest('[data-appr-one]')) return;
        var id = el.getAttribute('data-appr');
        if (state.apprPicked[id]) delete state.apprPicked[id]; else state.apprPicked[id] = true;
        keepScroll(renderApp);
      };
    });
    each('[data-appr-one]', function (el) { el.onclick = function () { var p = el.getAttribute('data-appr-one').split('|'); review([p[0]], p[1]); }; });
    on('appr-all', 'onchange', function () { var on2 = this.checked; state.apprPicked = {}; if (on2) state.approvals.forEach(function (q) { state.apprPicked[q.id] = true; }); keepScroll(renderApp); });
    on('appr-note', 'oninput', function () { state.apprNote = this.value; });
    on('appr-yes', 'onclick', function () { review(Object.keys(state.apprPicked), 'Approved'); });
    on('appr-no', 'onclick', function () { review(Object.keys(state.apprPicked), 'Rejected'); });
    on('appr-clear', 'onclick', function () { state.apprPicked = {}; keepScroll(renderApp); });
    on('nht-back', 'onclick', function (ev) { if (ev.target === this) closeNht(); });
    each('[data-att-view]', function (el) {
      el.onclick = function () { state.attView = el.getAttribute('data-att-view'); state.attEdit = null; renderApp(); };
    });
    var goMonth = function (n) {
      var f = state.attMonth + '-01', t = n < 0 ? addDays(f, -1) : addDays(f, 32);
      state.attMonth = t.slice(0, 7); state.attEdit = null; renderApp();
    };
    on('reg-prev', 'onclick', function () { goMonth(-1); });
    on('reg-next', 'onclick', function () { goMonth(1); });
    each('[data-reg]', function (el) {
      el.onclick = function (ev) {
        ev.stopPropagation();
        var p = el.getAttribute('data-reg').split('|');
        var same = state.attEdit && state.attEdit.id === p[0] && state.attEdit.date === p[1];
        state.attEdit = same ? null : { id: p[0], date: p[1] };
        keepScroll(renderApp);
      };
    });
    each('[data-pop]', function (el) {
      el.onclick = function (ev) {
        ev.stopPropagation();
        setMark(state.attEdit.id, state.attEdit.date, el.getAttribute('data-pop'));
        state.attEdit = null;
        keepScroll(renderApp);
      };
    });
    on('reg-wrap', 'onscroll', placePopover);
    placePopover();
    on('att-discard', 'onclick', function () { state.attPending = {}; renderApp(); });
    on('exclude', 'onclick', exclude);
    on('restore', 'onclick', restore);
    on('reason', 'oninput', function () { state.reason = this.value; });
    on('dept', 'onchange', function () { state.dept = this.value; state.shown = PAGE; renderApp(); });
    on('pick-matching', 'onclick', function () { unclaimedMatches().forEach(function (c) { state.picked[c.empId] = true; }); renderApp(); });
  }

  // New joiners reach the HR sheets all day; the server re-reads them every minute, so the open list does too.
  setInterval(function () {
    if (state.screen === 'app' && (state.tab === 'unclaimed' || state.tab === 'home') && !document.hidden) loadUnclaimed(true);
  }, 60000);

  /* ---------- start ---------- */
  // The server has already signed the person in: go straight in; the card only stays for someone with no access.
  state.busy = true; renderSignin();
  call('getSession').then(function (s) {
    state.session = s;
    if (s && s.role !== 'none') enter(); else { state.busy = false; renderSignin(); }
  }).catch(fail);
})();
