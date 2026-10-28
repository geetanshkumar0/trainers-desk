/* Trainer Desk: talks to the server's REST API. deskApi.call(name, arg) returns a Promise of the result. */
(function () {
  'use strict';
  var enc = encodeURIComponent;
  var t = function (arg) { return 'api/trainers/' + enc(arg && arg.trainer !== undefined ? arg.trainer : arg); };
  var month = function (m) { return m ? '?month=' + enc(m) : ''; };

  // name -> [method, path(arg), body(arg)]
  var ROUTES = {
    getSession:             ['GET',  function () { return 'api/session'; }],
    getTrainerBatches:      ['GET',  function (a) { return t(a) + '/batches'; }],
    getAttendance:          ['GET',  function (a) { return t(a) + '/attendance'; }],
    saveAttendance:         ['POST', function (a) { return t(a) + '/attendance'; }, function (a) { return { days: a.days }; }],
    getNhtCandidates:       ['GET',  function (a) { return t(a) + '/nht'; }],
    submitPageChanges:      ['POST', function (a) { return t(a) + '/nht/' + enc(a.empId); }, function (a) { return { changes: a.changes }; }],
    submitChange:           ['POST', function (a) { return t(a) + '/changes'; }, function (a) { return { empId: a.empId, field: a.field, value: a.value }; }],
    getOjtSummary:          ['GET',  function (a) { return t(a) + '/ojt'; }],
    refreshOjtDashboard:    ['POST', function () { return 'api/ojt/refresh'; }, function () { return {}; }],
    getUnclaimedCandidates: ['GET',  function () { return 'api/candidates'; }],
    assignCandidates:       ['POST', function () { return 'api/candidates/assign'; }],
    excludeCandidates:      ['POST', function () { return 'api/candidates/exclude'; }],
    restoreCandidates:      ['POST', function () { return 'api/candidates/restore'; }],
    getPendingApprovals:    ['GET',  function () { return 'api/approvals'; }],
    reviewRequests:         ['POST', function () { return 'api/approvals/review'; }],
    getPerformanceOld:      ['GET',  function (m) { return 'api/performance/old' + month(m); }],
    getPerformanceNew:      ['GET',  function (m) { return 'api/performance/new' + month(m); }]
  };

  function call(name, arg) {
    var r = ROUTES[name];
    if (!r) return Promise.reject(new Error('Unknown action ' + name));
    var opts = { method: r[0], credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (r[0] === 'POST') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(r[2] ? r[2](arg) : (arg || {}));
    }
    return fetch(r[1](arg), opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (res.ok) return j;
        if (j && j.login) { location.href = 'auth/login'; return new Promise(function () {}); }
        throw new Error((j && j.error) || 'Request failed (' + res.status + ')');
      });
    }, function () { throw new Error('Could not reach Trainer Desk. Check your connection and try again.'); });
  }

  window.deskApi = { call: call, preview: document.documentElement.hasAttribute('data-preview') };
})();
