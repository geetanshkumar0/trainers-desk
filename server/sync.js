/**
 * Copies the input sheets into SQLite (in_* tables).
 *  - Tracker inputs and the OJT targets: every REFRESH_SECONDS.
 *  - Talktime and the OJT dumps (large): only for the OJT refresh.
 * ingestTracker / ingestDumps take plain grids, so the local preview feeds made-up grids through the same code.
 */
import { CONFIG, DEFAULT_DEPARTMENTS } from './config.js';
import * as db from './db.js';
import * as G from './google.js';
import { parseSheetDate, durationSeconds } from './dates.js';
import { norm, normId, text } from './logic/common.js';
import { ojtDumpRows } from './logic/ojt.js';
import { applyMasterOverlay } from './outbox.js';

const log = (...a) => console.log(new Date().toISOString(), '[sync]', ...a);

/** Master Dashboard header -> in_master column. All are required. */
export const MASTER_COLUMNS = {
  'Emp ID': 'emp_id', 'Trainer': 'trainer', 'Manager': 'manager', 'Mentor': 'mentor', 'DOJ': 'doj', 'Work Mode': 'work_mode',
  'Employee Name': 'name', 'Official Email ID': 'email', 'Contact Number': 'phone', 'Department': 'department', 'Sub-Team': 'sub_team',
  'Work Location': 'location', 'Employment Status': 'status', 'Lateral Hire': 'lateral', 'Training Start Date': 'training_start',
  'Final KC Score%': 'kc_score', 'Final KC Clearance / Fail Attempts': 'kc_attempt', 'Final KC Status': 'kc_status',
  'Final Mock Clearance / Fail Attempts': 'mock_attempt', 'Final Mock Status': 'mock_status', 'Final Mock/Training End Date': 'training_end',
  'Total Training Days': 'training_days', 'OJT Start Date': 'ojt_start', 'OJT Achievement %': 'ojt_pct', 'OJT End Date': 'ojt_end',
  'Day of Attrition': 'attrition_day', 'Last Working Date': 'lwd'
};
const DATE_COLS = new Set(['doj', 'training_start', 'training_end', 'ojt_start', 'ojt_end', 'lwd']);
const NUM_COLS = new Set(['kc_score', 'training_days', 'ojt_pct', 'attrition_day']);
const LOWER_COLS = new Set(['trainer', 'manager', 'mentor']);

const num = v => (typeof v === 'number' && !isNaN(v) ? v : null);
const phoneText = v => (typeof v === 'number' ? String(Math.round(v)) : text(v).replace(/\.0$/, ''));

/** Master Dashboard grid -> in_master rows (throws when a column is missing). */
export function masterRowsFromGrid(grid, dateOf) {
  if (!grid.length) throw new Error('Sheet "' + CONFIG.MASTER_SHEET + '" is empty.');
  const head = grid[0].map(h => String(h).trim());
  const idx = {};
  Object.keys(MASTER_COLUMNS).forEach(h => {
    const i = head.indexOf(h);
    if (i < 0) throw new Error('Column "' + h + '" not found in ' + CONFIG.MASTER_SHEET);
    idx[MASTER_COLUMNS[h]] = i;
  });
  const out = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const id = normId(row[idx.emp_id]);
    if (!id) continue;
    const o = { row_no: r + 1 };
    Object.keys(idx).forEach(col => {
      const v = row[idx[col]];
      if (col === 'emp_id') o[col] = id;
      else if (DATE_COLS.has(col)) o[col] = dateOf(v);
      else if (NUM_COLS.has(col)) o[col] = num(v);
      else if (LOWER_COLS.has(col)) o[col] = norm(v);
      else if (col === 'phone') o[col] = phoneText(v);
      else o[col] = text(v);
    });
    out.push(o);
  }
  return out;
}

function setStatus(name, rows, error) {
  db.run('INSERT INTO sync_status (name, rows, loaded_on, error) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET rows = excluded.rows, loaded_on = excluded.loaded_on, error = excluded.error',
    name, rows, new Date().toISOString(), error || '');
}

/**
 * Replaces the tracker inputs. grids: { tabName: 2-D array } (missing optional tabs = undefined).
 * locale: the spreadsheet's locale (how dates like 2/4/2026 are read). since: overlay start (ISO).
 */
export function ingestTracker(grids, locale, since) {
  const dateOf = v => (typeof v === 'string' ? parseSheetDate(v, locale) : '');
  const need = name => { if (!grids[name]) throw new Error('Sheet "' + name + '" not found in the tracker.'); return grids[name]; };
  const master = masterRowsFromGrid(need(CONFIG.MASTER_SHEET), dateOf);

  const hr = [];
  CONFIG.HR_SHEETS.forEach(name => {
    const g = need(name);
    const head = (g[0] || []).map(h => String(h).toLowerCase());
    const cPhone = head.findIndex(h => /contact|mobile|phone/.test(h));
    for (let r = 1; r < g.length; r++) {
      const v = g[r] || [], id = normId(v[0]);
      if (!id) continue;
      hr.push({ sheet: name, emp_id: id, name: text(v[1]), status: text(v[2]), doj: dateOf(v[3]), location: text(v[6]), source: text(v[8]),
        department: text(v[9]), phone: cPhone >= 0 ? phoneText(v[cPhone]) : '' });
    }
  });

  const also = new Set();
  CONFIG.ALSO_MAPPED_SHEETS.forEach(n => (grids[n] || []).forEach((r, i) => { const id = normId((r || [])[2]); if (i && id) also.add(id); }));
  const removed = new Set();
  (grids[CONFIG.REMOVED_SHEET] || []).forEach(r => [(r || [])[2], (r || [])[3]].forEach(v => { const id = normId(v); if (/^NBT[A-Z]*\d+$/.test(id)) removed.add(id); }));

  const org = [];
  need(CONFIG.SCORING_SHEET).forEach(r => { const t = norm((r || [])[12]); if (t.indexOf('@') > 0) org.push({ trainer: t, manager: norm(r[13]), mentor: norm(r[14]) }); });
  const names = {};
  (grids[CONFIG.TRACKER_SHEET] || []).forEach(r => { const e = norm((r || [])[2]); if (e.indexOf('@') > 0 && r[1]) names[e] = String(r[1]).trim(); });

  const kc = [];
  (grids[CONFIG.KC_SHEET] || []).forEach((row, i) => {
    if (!i || !row) return;
    const raw = String(row[1] == null ? '' : row[1]).trim();
    const key = raw.indexOf('@') > 0 ? raw.toLowerCase() : normId(raw);
    if (!key) return;
    let score = row[3];
    if (typeof score === 'string') { const n = parseFloat(score); score = isNaN(n) ? null : n; }
    if (typeof score !== 'number') score = null;
    else if (score <= 1 && score > 0) score = Math.round(score * 10000) / 100;      // stored as a fraction
    kc.push({ key, date: dateOf(row[0]), attempt: text(row[2]), score, status: text(row[4]) });
  });

  // Intervention Required: header = months from column B; first row per trainer counts (columns B..M).
  const ir = grids[CONFIG.IR_SHEET] || [];
  const months = ir.length ? ir[0].map((v, i) => (i ? dateOf(v).slice(0, 7) : '')) : [];
  const bqMonths = months.slice(1).filter(String);
  const required = {}, seenTrainer = new Set();
  for (let r = 1; r < ir.length; r++) {
    const t = norm((ir[r] || [])[0]);
    if (!t || seenTrainer.has(t)) continue;
    seenTrainer.add(t);
    for (let c = 1; c < Math.min(ir[r].length, 13); c++) {
      if (typeof ir[r][c] !== 'number') continue;
      const k = t + '\u0000' + months[c];
      required[k] = (required[k] || 0) + ir[r][c];
    }
  }
  const done = [];
  (grids[CONFIG.TIE_SHEET] || []).forEach((r, i) => {
    if (i < 2 || !r) return;                                   // two header rows
    const d = dateOf(r[0]);
    if (d) done.push({ date: d, trainer: norm(r[2]), effectiveness: num(r[18]) });
  });

  const depts = [];
  const dl = grids[CONFIG.DEPARTMENT_SHEET];
  if (dl && dl.length > 1) dl.slice(1).forEach(r => { if (text((r || [])[0])) depts.push({ department: text(r[0]), sub_team: text(r[1]) }); });
  else DEFAULT_DEPARTMENTS.forEach(([d, subs]) => { if (!subs.length) depts.push({ department: d, sub_team: '' }); subs.forEach(s => depts.push({ department: d, sub_team: s })); });

  const templates = {};
  (grids[CONFIG.TEMPLATE_SHEET] || []).forEach((r, i) => {
    const e = norm((r || [])[0]);
    if (i && e) templates[e] = { email: e, name: text(r[1]), phone: String(r[2] == null ? '' : r[2]).replace(/\.0$/, '').trim(), template: text(r[3]) };
  });

  db.tx(() => {
    db.exec('DELETE FROM in_master; DELETE FROM in_hr; DELETE FROM in_also_mapped; DELETE FROM in_removed; DELETE FROM in_org; DELETE FROM in_names; ' +
      'DELETE FROM in_kc; DELETE FROM in_bq_months; DELETE FROM in_bq_required; DELETE FROM in_bq_done; DELETE FROM in_departments; DELETE FROM in_trainer_templates;');
    db.insertMany('in_master', master);
    db.insertMany('in_hr', hr);
    db.insertMany('in_also_mapped', [...also].map(emp_id => ({ emp_id })));
    db.insertMany('in_removed', [...removed].map(emp_id => ({ emp_id })));
    db.insertMany('in_org', org);
    db.insertMany('in_names', Object.keys(names).map(email => ({ email, name: names[email] })));
    db.insertMany('in_kc', kc);
    db.insertMany('in_bq_months', bqMonths.map(month => ({ month })));
    db.insertMany('in_bq_required', Object.keys(required).map(k => { const [trainer, month] = k.split('\u0000'); return { trainer, month, n: required[k] }; }));
    db.insertMany('in_bq_done', done);
    db.insertMany('in_departments', depts);
    db.insertMany('in_trainer_templates', Object.values(templates));
    // Master Dashboard writes not yet in the sheet (or sent while this copy was being read) stay visible.
    applyMasterOverlay(since);
    setStatus('tracker', master.length + hr.length + org.length + kc.length);
    setStatus(CONFIG.MASTER_SHEET, master.length);
    setStatus('HR sheets', hr.length);
    setStatus(CONFIG.DEPARTMENT_SHEET, depts.length, dl && dl.length > 1 ? '' : 'Tab not found: using the built-in list');
  });
  return { master: master.length, hr: hr.length };
}

/** OJT targets grid (values + displayed text). */
export function ingestTargets(values, display) {
  db.tx(() => {
    db.run('INSERT INTO in_grids (name, grid, display) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET grid = excluded.grid, display = excluded.display',
      CONFIG.OJT_TARGETS_SHEET, JSON.stringify(values || []), JSON.stringify(display || []));
    setStatus(CONFIG.OJT_TARGETS_SHEET, (values || []).length, values ? '' : 'Tab not found');
  });
}

/**
 * Talktime and the dump tabs. talk: { dates: [..], ids: [..], durations: [display text] } (column A, C, H; no header).
 * dumps: { key: grid } for each CONFIG.OJT_DUMPS key found. Returns the tab names that were missing.
 */
export function ingestDumps(talk, dumps, locale) {
  const dateOf = v => (typeof v === 'string' ? parseSheetDate(v, locale) : '');
  const talkRows = [];
  if (talk) {
    for (let i = 0; i < talk.ids.length; i++) {
      const d = dateOf(talk.dates[i]), id = normId(talk.ids[i]);
      if (d && id) talkRows.push({ emp_id: id, date: d, secs: durationSeconds(talk.durations[i]) });
    }
  }
  const missing = talk ? [] : [CONFIG.TALKTIME_SHEET];
  const dumpRows = [];
  Object.keys(CONFIG.OJT_DUMPS).forEach(k => {
    if (!dumps[k]) { missing.push(CONFIG.OJT_DUMPS[k].sheet); return; }
    ojtDumpRows(dumps[k], CONFIG.OJT_DUMPS[k], dateOf).forEach(r => dumpRows.push({ source: k, date: r.date, email: r.email, value: r.value, lead: r.lead }));
  });
  db.tx(() => {
    if (talk) { db.exec('DELETE FROM in_talktime'); db.insertMany('in_talktime', talkRows); setStatus(CONFIG.TALKTIME_SHEET, talkRows.length); }
    const present = Object.keys(dumps);
    present.forEach(k => db.run('DELETE FROM in_dump_rows WHERE source = ?', k));
    db.insertMany('in_dump_rows', dumpRows);
    present.forEach(k => setStatus(CONFIG.OJT_DUMPS[k].sheet, dumpRows.filter(r => r.source === k).length));
    missing.forEach(n => setStatus(n, 0, 'Tab not found'));
  });
  return { talktime: talkRows.length, dumpRows: dumpRows.length, missing };
}

/* ------------------------------------------------------------------ */
/* Reading from Google                                                 */
/* ------------------------------------------------------------------ */

const state = { running: null, lastOk: null, lastError: '', lastMs: 0, timer: null };
export const syncState = state;

const TRACKER_RANGES = () => {
  const r = {};
  r[CONFIG.MASTER_SHEET] = ''; CONFIG.HR_SHEETS.forEach(n => { r[n] = ''; });
  CONFIG.ALSO_MAPPED_SHEETS.forEach(n => { r[n] = 'A:C'; });
  r[CONFIG.REMOVED_SHEET] = 'A:D'; r[CONFIG.SCORING_SHEET] = 'A:O'; r[CONFIG.TRACKER_SHEET] = 'A:D'; r[CONFIG.KC_SHEET] = 'A:E';
  r[CONFIG.IR_SHEET] = 'A:M'; r[CONFIG.TIE_SHEET] = 'A:S'; r[CONFIG.DEPARTMENT_SHEET] = 'A:B'; r[CONFIG.TEMPLATE_SHEET] = 'A:D';
  return r;
};

/** Reads the tracker inputs (and the OJT targets) from Google into SQLite. One run at a time. */
export function syncTracker(reason) {
  if (state.running) return state.running;
  state.running = (async () => {
    const since = new Date().toISOString(), t0 = Date.now();
    try {
      const meta = await G.sheetsMeta(CONFIG.TRACKER_ID);
      const locale = meta.properties.locale || 'en_US';
      const tabs = new Set(meta.sheets.map(s => s.properties.title));
      const want = TRACKER_RANGES();
      const names = Object.keys(want).filter(n => tabs.has(n));
      const values = await G.sheetsValues(CONFIG.TRACKER_ID, names.map(n => G.quoteTab(n) + (want[n] ? '!' + want[n] : '')));
      const grids = {};
      names.forEach((n, i) => { grids[n] = values[i]; });
      const res = ingestTracker(grids, locale, since);
      if (CONFIG.DUMPS_ID) {
        const dm = await G.sheetsMeta(CONFIG.DUMPS_ID);
        if (dm.sheets.some(s => s.properties.title === CONFIG.OJT_TARGETS_SHEET)) {
          const [v] = await G.sheetsValues(CONFIG.DUMPS_ID, [CONFIG.OJT_TARGETS_SHEET]);
          const [d] = await G.sheetsValues(CONFIG.DUMPS_ID, [CONFIG.OJT_TARGETS_SHEET], 'FORMATTED_VALUE');
          ingestTargets(v, d);
        } else ingestTargets(null, null);
      }
      state.lastOk = new Date(); state.lastError = ''; state.lastMs = Date.now() - t0;
      db.setMeta('locale', locale);
      if (reason !== 'timer') log('tracker loaded (' + reason + '):', res.master, 'master rows,', res.hr, 'HR rows,', state.lastMs + 'ms');
      return res;
    } catch (e) {
      state.lastError = e.message;
      log('tracker sync (' + reason + ') failed:', e.message);
      throw e;
    } finally {
      state.running = null;
    }
  })();
  return state.running;
}

/** Talktime (~335k rows) and the dump tabs, for the OJT refresh. */
export async function syncDumps() {
  if (!CONFIG.DUMPS_ID) return { missing: [] };
  const meta = await G.sheetsMeta(CONFIG.DUMPS_ID);
  const locale = meta.properties.locale || 'en_US';
  const tabs = new Set(meta.sheets.map(s => s.properties.title));
  let talk = null;
  if (tabs.has(CONFIG.TALKTIME_SHEET)) {
    const C = CONFIG.TALKTIME_COLS, col = n => String.fromCharCode(64 + n), t = G.quoteTab(CONFIG.TALKTIME_SHEET);
    const [dates, ids] = await G.sheetsValues(CONFIG.DUMPS_ID, [t + '!' + col(C.date) + ':' + col(C.date), t + '!' + col(C.id) + ':' + col(C.id)]);
    const [durs] = await G.sheetsValues(CONFIG.DUMPS_ID, [t + '!' + col(C.talk) + ':' + col(C.talk)], 'FORMATTED_VALUE');
    const n = Math.max(dates.length, ids.length);
    talk = { dates: [], ids: [], durations: [] };
    for (let i = 0; i < n; i++) { talk.dates.push((dates[i] || [])[0]); talk.ids.push((ids[i] || [])[0]); talk.durations.push((durs[i] || [])[0]); }
  }
  const keys = Object.keys(CONFIG.OJT_DUMPS).filter(k => tabs.has(CONFIG.OJT_DUMPS[k].sheet));
  const values = await G.sheetsValues(CONFIG.DUMPS_ID, keys.map(k => CONFIG.OJT_DUMPS[k].sheet));
  const dumps = {};
  keys.forEach((k, i) => { dumps[k] = values[i]; });
  return ingestDumps(talk, dumps, locale);
}

/** Starts the timer: tracker inputs every refreshSeconds. */
export function start(seconds) {
  const loop = async () => {
    try { await syncTracker('timer'); } catch (e) { /* logged */ }
    state.timer = setTimeout(loop, seconds * 1000);
  };
  return syncTracker('start').catch(() => null).finally(() => { state.timer = setTimeout(loop, seconds * 1000); });
}
export function stop() { clearTimeout(state.timer); }
