/** OJT Performance and the OJT refresh (admins, every morning, and after a trainee moves to OJT). */
import * as db from '../db.js';
import * as data from '../data.js';
import { CONFIG, SERVER } from '../config.js';
import { today, isoDay, hhmm } from '../dates.js';
import { buildOjtRows, buildOjtPerformance, indexOjtSource, ojtTeamList } from '../logic/ojt.js';
import { updatedFields, pendingByTrainee } from '../logic/changes.js';
import { UserError } from '../logic/common.js';
import { syncDumps, syncTracker } from '../sync.js';

const log = (...a) => console.log(new Date().toISOString(), '[ojt]', ...a);

/** OJT dashboard rows for one trainer (or a list of trainers). */
export function parseOjtRows(trainer, day, isAdmin) {
  const any = db.get('SELECT updated_on FROM ojt_dashboard ORDER BY seq LIMIT 1');
  const want = new Set([].concat(trainer));
  const rows = db.all('SELECT * FROM ojt_dashboard ORDER BY seq').filter(v => want.has(v.trainer)).map(v => ({
    empId: v.emp_id, name: v.name, trainer: v.trainer, mode: v.work_mode, doj: v.doj, trainingEnd: v.training_end, ojtStart: v.ojt_start, ojtEnd: v.ojt_end,
    status: v.status, ojtDay: v.ojt_day, talkDays: v.talk_days, talkHours: v.talk_hours, lastTalk: v.last_talk,
    team: v.team, teamSet: !!v.team_set, achievement: v.achievement, score: v.score, result: v.result, passRule: v.pass_rule, note: v.note
  }));
  return { trainer: Array.isArray(trainer) ? data.ALL : trainer, today: day, updatedOn: any ? any.updated_on : '', sheetFound: !!any, isAdmin: !!isAdmin, rows };
}

export function getOjtSummary(user, trainer) {
  const s = data.session(user);
  const sc = data.scope(s, trainer), target = sc.key === data.ALL ? sc.list : sc.key;
  if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = null; buildOjtDashboard(); }   // someone just moved to OJT
  const view = parseOjtRows(target, today(), s.isAdmin);
  const ids = view.rows.map(r => r.empId);
  const metrics = {};
  data.inList('SELECT * FROM ojt_performance WHERE emp_id IN', ids, 'ORDER BY seq').forEach(v => {
    (metrics[v.emp_id] = metrics[v.emp_id] || []).push({ name: v.metric, type: v.type, weight: v.weight, kind: v.kind, target: v.target,
      achieved: v.achieved, pct: v.pct, score: v.score, from: v.date_from, to: v.date_to, data: v.data, weeks: JSON.parse(v.weeks || '[]') });
  });
  const reqs = data.requests();
  const pending = pendingByTrainee(reqs.filter(q => q.status === 'Pending'));
  const updated = updatedFields(reqs);
  const manual = data.ojtManual();
  view.rows.forEach(r => {
    r.metrics = metrics[r.empId] || [];
    r.pending = pending[r.empId] || {};
    r.updated = updated[r.empId] || {};
    r.manual = manual[r.empId] || {};
  });
  view.teams = ojtTeamList(data.ojtTargets());
  return view;
}

/** Rebuilds ojt_dashboard and ojt_performance from Master Dashboard, Talktime, the dumps and trainers' inputs. */
export function buildOjtDashboard(missingTabs) {
  const day = today();
  const talkById = {};
  db.all('SELECT emp_id, date, secs FROM in_talktime').forEach(t => { (talkById[t.emp_id] = talkById[t.emp_id] || []).push({ date: t.date, secs: t.secs }); });
  const rows = buildOjtRows(data.masterRows(''), talkById, day, CONFIG.TALKTIME_MIN_SECONDS, CONFIG.OJT_DAYS, data.nhtStage());
  const sources = {};
  const bySource = {};
  db.all('SELECT source, date, email, value, lead FROM in_dump_rows').forEach(r => { (bySource[r.source] = bySource[r.source] || []).push(r); });
  Object.keys(CONFIG.OJT_DUMPS).forEach(k => { if (bySource[k] || db.get('SELECT 1 FROM sync_status WHERE name = ? AND error = \'\'', CONFIG.OJT_DUMPS[k].sheet)) sources[k] = indexOjtSource(bySource[k] || []); });
  const perf = buildOjtPerformance(rows, data.ojtTargets(), sources, talkById, data.ojtTeams(), data.ojtManual(), day, CONFIG.OJT_PASS_RULES);
  const now = new Date().toISOString();
  db.tx(() => {
    db.exec('DELETE FROM ojt_dashboard; DELETE FROM ojt_performance;');
    db.insertMany('ojt_dashboard', rows.map((r, i) => {
      const p = perf[i];
      return { emp_id: r.empId, name: r.name, trainer: r.trainer, work_mode: r.mode, doj: r.doj, training_end: r.trainingEnd, ojt_start: r.ojtStart,
        ojt_end: r.ojtEnd, status: r.status, ojt_day: r.ojtDay || 0, talk_days: r.talkDays, talk_hours: Math.round(r.talkSecs / 36) / 100,
        last_talk: r.lastTalk, updated_on: now, team: p.team, team_set: p.teamSet ? 1 : 0, achievement: p.achievement, score: p.score,
        result: p.result, pass_rule: p.passRule || '', note: p.note };
    }));
    const metricRows = [];
    perf.forEach((p, i) => p.metrics.forEach(m => metricRows.push({
      emp_id: rows[i].empId, name: rows[i].name, trainer: rows[i].trainer, team: p.team, metric: m.name, type: m.type, weight: m.weight, kind: m.kind,
      target: m.target, achieved: m.achieved, pct: m.pct, score: m.score, date_from: m.from, date_to: m.to, data: m.data,
      weeks: JSON.stringify([0, 1, 2, 3].map(k => ({ target: m.weekTargets[k] == null ? null : m.weekTargets[k], achieved: (m.weeks[k] || {}).achieved == null ? null : m.weeks[k].achieved })))
    })));
    db.insertMany('ojt_performance', metricRows);
    db.markDirty('OJT Dashboard', 'OJT Performance');
  });
  const count = st => rows.filter(r => r.status === st).length;
  return { rows: rows.length, inOjt: count('In OJT'), waiting: count('Waiting for first call'), updatedOn: isoDay() + ' ' + hhmm(), missingTabs: missingTabs || [] };
}

let rebuildTimer = null;
/** Rebuilds the OJT list shortly after a trainee's OJT answers change (from the data already in the database). */
export function scheduleOjtRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    try { if (db.isOpen()) buildOjtDashboard(); } catch (e) { log('rebuild after OJT answers failed:', e.message); }
  }, 300);
}

let running = null;
/** Reads Talktime and the dumps fresh, then rebuilds. One at a time. */
export async function refreshOjtDashboard(user) {
  if (user !== null) {
    const s = data.session(user);
    if (!s.isAdmin) throw new UserError('Only admins can refresh OJT data.', 403);
  }
  if (running) return running;
  running = (async () => {
    try {
      let missing = [];
      if (!SERVER.demo) {
        await syncTracker('ojt refresh');
        missing = (await syncDumps()).missing;
      }
      const res = buildOjtDashboard(missing);
      log('refreshed:', res.rows, 'rows,', res.inOjt, 'in OJT');
      db.setMeta('ojt_refreshed', new Date().toISOString());
      return res;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Runs the refresh every morning at CONFIG.OJT_REFRESH_HOUR (sheet time zone), once a day. */
export function startDaily() {
  const tick = () => {
    const now = new Date(), day = isoDay(now), hour = +hhmm(now).slice(0, 2);
    if (hour === CONFIG.OJT_REFRESH_HOUR && db.getMeta('ojt_daily', '') !== day) {
      db.setMeta('ojt_daily', day);
      refreshOjtDashboard(null).catch(e => log('morning refresh failed:', e.message));
    }
  };
  return setInterval(tick, 60000);
}
