/**
 * The tabs Trainer Desk used to write in the tracker (Attendance, Change Requests, Mock Scores, ...).
 *  - importFromSheets(): one time, on the first start, copies what those tabs hold into SQLite.
 *  - mirror: afterwards, keeps a read-only copy of each tab in the tracker (same columns as before) for anyone
 *    reporting from the sheet. Turn it off with SHEET_MIRROR=off. Edits made in those tabs are overwritten.
 */
import * as db from './db.js';
import * as G from './google.js';
import { CONFIG, SERVER } from './config.js';
import { parseSheetDate, tzParts } from './dates.js';
import { normId, norm, text } from './logic/common.js';

const log = (...a) => console.log(new Date().toISOString(), '[mirror]', ...a);
const pad = n => String(n).padStart(2, '0');
/** ISO timestamp -> 'yyyy-MM-dd HH:mm:ss' in the sheet time zone (the sheet reads it as a date-time). */
const when = iso => { if (!iso) return ''; const p = tzParts(new Date(iso)); return p.y + '-' + pad(p.m) + '-' + pad(p.d) + ' ' + pad(p.h) + ':' + pad(p.mi) + ':' + pad(p.s); };
const blank = v => (v === null || v === undefined ? '' : v);

/** Tab name -> () => grid (header first). Column layouts match what Code.gs wrote. */
export const TABS = {
  'Excluded Candidates': () => [['Emp ID', 'Employee Name', 'Department', 'DOJ', 'Reason', 'Removed By', 'Removed On']]
    .concat(db.all('SELECT * FROM excluded_candidates ORDER BY removed_on').map(r => [r.emp_id, r.name, r.department, r.doj, r.reason, r.removed_by, when(r.removed_on)])),
  'Attendance': () => {
    const rows = db.all('SELECT * FROM attendance ORDER BY emp_id, date');
    const dates = [...new Set(rows.map(r => r.date))].sort();
    const col = {}; dates.forEach((d, i) => { col[d] = 4 + i; });
    const people = {}, order = [];
    rows.forEach(r => {
      if (!people[r.emp_id]) { people[r.emp_id] = [r.emp_id, r.name, r.trainer, r.doj].concat(dates.map(() => '')); order.push(r.emp_id); }
      people[r.emp_id][col[r.date]] = r.code;
    });
    return [['Emp ID', 'Employee Name', 'Trainer', 'DOJ'].concat(dates)].concat(order.map(id => people[id]));
  },
  'Attendance Log': () => [['Changed On', 'Changed By', 'Trainer', 'Emp ID', 'Attendance Date', 'Old Mark', 'New Mark']]
    .concat(db.all('SELECT * FROM attendance_log ORDER BY id').map(r => [when(r.changed_on), r.changed_by, r.trainer, r.emp_id, r.date, r.old_code, r.new_code])),
  'Change Requests': () => [['Request ID', 'Requested On', 'Requested By', 'Trainer', 'Emp ID', 'Employee Name', 'Change', 'Old Value', 'New Value',
    'Status', 'Reviewed By', 'Reviewed On', 'Review Note', 'Data']]
    .concat(db.all('SELECT * FROM change_requests ORDER BY seq').map(r => [r.id, when(r.requested_on), r.requested_by, r.trainer, r.emp_id, r.name, r.field,
      r.old_text, r.new_text, r.status, r.reviewed_by, when(r.reviewed_on), r.note, r.data])),
  'Mock Scores': () => [['Emp ID', 'Employee Name', 'Trainer', 'Mock Date', 'Attempt', 'Score %', 'Status', 'Final Attempt', 'Entered By', 'Approved By', 'Approved On']]
    .concat(db.all('SELECT * FROM mock_scores ORDER BY id').map(r => [r.emp_id, r.name, r.trainer, r.mock_date, r.attempt, blank(r.score), r.status,
      r.final ? 'Yes' : 'No', r.entered_by, r.approved_by, when(r.approved_on)])),
  'NHT Status': () => [['Emp ID', 'Employee Name', 'Trainer', 'OJT Entered', 'OJT Eligible', 'Updated By', 'Updated On']]
    .concat(db.all('SELECT * FROM nht_status ORDER BY updated_on').map(r => [r.emp_id, r.name, r.trainer, r.ojt_entered, r.ojt_eligible, r.updated_by, when(r.updated_on)])),
  'OJT Team': () => [['Emp ID', 'Employee Name', 'Trainer', 'OJT Team', 'Updated By', 'Updated On']]
    .concat(db.all('SELECT * FROM ojt_team ORDER BY updated_on').map(r => [r.emp_id, r.name, r.trainer, r.team, r.updated_by, when(r.updated_on)])),
  'OJT Manual Inputs': () => [['Emp ID', 'Employee Name', 'Trainer', 'Metric', 'Achieved', 'Updated By', 'Updated On']]
    .concat(db.all('SELECT * FROM ojt_manual_inputs ORDER BY updated_on').map(r => [r.emp_id, r.name, r.trainer, r.metric, r.achieved, r.updated_by, when(r.updated_on)])),
  'OJT Dashboard': () => [['Emp ID', 'Employee Name', 'Trainer', 'Work Mode', 'DOJ', 'Training End Date', 'OJT Start Date', 'OJT End Date',
    'OJT Status', 'OJT Day', 'Talktime Days', 'Total Talktime (hrs)', 'Last Talktime Date', 'Updated On',
    'OJT Team', 'Team Picked By Trainer', 'Achievement %', 'OJT Score', 'OJT Result', 'Pass Rule', 'Data Note']]
    .concat(db.all('SELECT * FROM ojt_dashboard ORDER BY seq').map(r => [r.emp_id, r.name, r.trainer, r.work_mode, r.doj, r.training_end, r.ojt_start, r.ojt_end,
      r.status, r.ojt_day || '', r.talk_days, r.talk_hours, r.last_talk, when(r.updated_on), r.team, r.team_set ? 'Yes' : '', blank(r.achievement), blank(r.score),
      r.result, r.pass_rule, r.note])),
  'OJT Performance': () => [['Emp ID', 'Employee Name', 'Trainer', 'OJT Team', 'Metric', 'Type', 'Weight', 'Kind', 'Target', 'Achieved', 'Achieved %',
    'Score', 'From', 'To', 'Data', 'W1 Target', 'W1 Achieved', 'W2 Target', 'W2 Achieved', 'W3 Target', 'W3 Achieved', 'W4 Target', 'W4 Achieved']]
    .concat(db.all('SELECT * FROM ojt_performance ORDER BY seq').map(r => {
      const w = JSON.parse(r.weeks || '[]');
      return [r.emp_id, r.name, r.trainer, r.team, r.metric, r.type, blank(r.weight), r.kind, blank(r.target), blank(r.achieved), blank(r.pct), blank(r.score),
        r.date_from, r.date_to, r.data].concat([0, 1, 2, 3].flatMap(k => [blank((w[k] || {}).target), blank((w[k] || {}).achieved)]));
    })),
  'WhatsApp Log': () => [['Sent On', 'Trainer', 'Emp ID', 'Candidate', 'Candidate Phone', 'Sent To', 'Template', 'Status', 'Detail']]
    .concat(db.all('SELECT * FROM whatsapp_log ORDER BY id').map(r => [when(r.sent_on), r.trainer, r.emp_id, r.candidate, r.candidate_phone, r.sent_to, r.template, r.status, r.detail]))
};

/** Writes one tab: creates it if needed, clears it, writes the grid in chunks. */
async function writeTab(meta, name, grid) {
  const id = CONFIG.TRACKER_ID;
  if (!meta.sheets.some(s => s.properties.title === name)) {
    await G.sheetsBatchUpdate(id, [{ addSheet: { properties: { title: name, gridProperties: { frozenRowCount: 1, rowCount: Math.max(grid.length + 50, 100), columnCount: Math.max(grid[0].length, 26) } } } }]);
  } else {
    const p = meta.sheets.find(s => s.properties.title === name).properties, need = [];
    if (p.gridProperties.rowCount < grid.length) need.push({ appendDimension: { sheetId: p.sheetId, dimension: 'ROWS', length: grid.length - p.gridProperties.rowCount + 50 } });
    if (p.gridProperties.columnCount < grid[0].length) need.push({ appendDimension: { sheetId: p.sheetId, dimension: 'COLUMNS', length: grid[0].length - p.gridProperties.columnCount } });
    if (need.length) await G.sheetsBatchUpdate(id, need);
    await G.sheetsClear(id, [G.quoteTab(name)]);
  }
  for (let i = 0; i < grid.length; i += 5000) {
    await G.sheetsWrite(id, [{ range: G.quoteTab(name) + '!A' + (i + 1), values: grid.slice(i, i + 5000).map(r => r.map(v => (v === null || v === undefined ? '' : v))) }]);
  }
}

let busy = false;
/** Copies every changed tab back to the tracker. */
export async function mirrorNow() {
  // Never before the old tabs have been read in: the copy would replace them.
  if (busy || SERVER.demo || !SERVER.mirror || !G.sheetsConnected() || !db.getMeta('imported_from_sheets', null)) return [];
  busy = true;
  try {
    const dirty = db.all('SELECT tab, since FROM mirror_dirty');
    if (!dirty.length) return [];
    const meta = await G.sheetsMeta(CONFIG.TRACKER_ID);
    const done = [];
    for (const d of dirty) {
      if (!TABS[d.tab]) { db.run('DELETE FROM mirror_dirty WHERE tab = ?', d.tab); continue; }
      const startedAt = new Date().toISOString();
      try {
        await writeTab(meta, d.tab, TABS[d.tab]());
        // Changes made while this tab was being written keep it dirty for the next round.
        db.run('DELETE FROM mirror_dirty WHERE tab = ? AND since = ?', d.tab, d.since);
        db.run('UPDATE mirror_dirty SET since = ? WHERE tab = ? AND since < ?', startedAt, d.tab, startedAt);
        done.push(d.tab);
      } catch (e) {
        log(d.tab, 'not copied:', e.message);
      }
    }
    if (done.length) log('copied to the tracker:', done.join(', '));
    return done;
  } finally {
    busy = false;
  }
}

let timer = null;
export function start() { timer = setInterval(() => mirrorNow().catch(e => log(e.message)), SERVER.mirrorSeconds * 1000); }
export function stop() { clearInterval(timer); }

/* ------------------------------------------------------------------ */
/* First start: bring the existing tabs into SQLite                     */
/* ------------------------------------------------------------------ */

const APP_TABLES = ['excluded_candidates', 'attendance', 'attendance_log', 'change_requests', 'mock_scores', 'nht_status', 'ojt_team',
  'ojt_manual_inputs', 'ojt_dashboard', 'ojt_performance', 'whatsapp_log'];

export function appDataEmpty() { return APP_TABLES.every(t => !db.get('SELECT 1 FROM ' + t + ' LIMIT 1')); }

/**
 * grids: { tabName: grid } as read from the tracker (dates as text). Fills the app tables from them.
 * Only runs when every app table is empty, so it can never overwrite data saved in Trainer Desk.
 */
export function importGrids(grids, locale) {
  if (!appDataEmpty()) throw new Error('Trainer Desk already has its own data; the old tabs were not imported again.');
  const d = v => (typeof v === 'string' ? parseSheetDate(v, locale) : '');
  const ts = v => { const x = typeof v === 'string' ? parseSheetDate(v, locale, true) : null; return x ? x.at : ''; };
  const num = v => (typeof v === 'number' && !isNaN(v) ? v : (v === '' || v == null || isNaN(Number(v)) ? null : Number(v)));
  const rows = name => (grids[name] || []).slice(1).filter(r => r && r.length && String(r[0] == null ? '' : r[0]).trim());
  const c = {};
  db.tx(() => {
    c.excluded = db.insertMany('excluded_candidates', dedupe(rows('Excluded Candidates').map(r => ({ emp_id: normId(r[0]), name: text(r[1]), department: text(r[2]), doj: d(r[3]),
      reason: text(r[4]) || 'Not handled by the training team', removed_by: norm(r[5]), removed_on: ts(r[6]) || new Date().toISOString() })), 'emp_id'));

    const att = grids['Attendance'] || [], marks = [];
    if (att.length) {
      const dates = att[0].map((v, i) => (i >= 4 ? d(v) : ''));
      att.slice(1).forEach(r => {
        const id = normId(r[0]);
        if (!id) return;
        for (let k = 4; k < r.length; k++) {
          const code = String(r[k] == null ? '' : r[k]).trim().toUpperCase();
          if (code && dates[k]) marks.push({ emp_id: id, date: dates[k], code, trainer: norm(r[2]), name: text(r[1]), doj: d(r[3]), marked_by: 'imported', marked_on: new Date().toISOString() });
        }
      });
    }
    c.attendance = db.insertMany('attendance', dedupe(marks, 'emp_id', 'date'));
    c.attendanceLog = db.insertMany('attendance_log', rows('Attendance Log').map(r => ({ changed_on: ts(r[0]), changed_by: norm(r[1]), trainer: norm(r[2]), emp_id: normId(r[3]),
      date: d(r[4]), old_code: text(r[5]).toUpperCase(), new_code: text(r[6]).toUpperCase() })));

    const okStatus = new Set(['Pending', 'Approved', 'Rejected', 'Superseded']);
    c.changeRequests = db.insertMany('change_requests', dedupe(rows('Change Requests').map(r => ({ id: text(r[0]), requested_on: ts(r[1]), requested_by: norm(r[2]), trainer: norm(r[3]),
      emp_id: normId(r[4]), name: text(r[5]), field: text(r[6]), old_text: text(r[7]), new_text: text(r[8]), status: okStatus.has(text(r[9])) ? text(r[9]) : 'Rejected',
      reviewed_by: text(r[10]), reviewed_on: ts(r[11]), note: text(r[12]), data: text(r[13]) || '{}' })), 'id'));

    c.mocks = db.insertMany('mock_scores', rows('Mock Scores').map(r => ({ emp_id: normId(r[0]), name: text(r[1]), trainer: norm(r[2]), mock_date: d(r[3]), attempt: text(r[4]),
      score: num(r[5]), status: text(r[6]), final: text(r[7]) === 'Yes' ? 1 : 0, entered_by: norm(r[8]), approved_by: text(r[9]), approved_on: ts(r[10]) })));
    c.nhtStatus = db.insertMany('nht_status', dedupe(rows('NHT Status').map(r => ({ emp_id: normId(r[0]), name: text(r[1]), trainer: norm(r[2]), ojt_entered: text(r[3]),
      ojt_eligible: text(r[4]), updated_by: text(r[5]), updated_on: ts(r[6]) })), 'emp_id'));
    c.ojtTeam = db.insertMany('ojt_team', dedupe(rows('OJT Team').filter(r => text(r[3])).map(r => ({ emp_id: normId(r[0]), name: text(r[1]), trainer: norm(r[2]), team: text(r[3]),
      updated_by: text(r[4]), updated_on: ts(r[5]) })), 'emp_id'));
    c.ojtInputs = db.insertMany('ojt_manual_inputs', dedupe(rows('OJT Manual Inputs').filter(r => text(r[3]) && num(r[4]) !== null).map(r => ({ emp_id: normId(r[0]), metric: text(r[3]),
      name: text(r[1]), trainer: norm(r[2]), achieved: num(r[4]), updated_by: text(r[5]), updated_on: ts(r[6]) })), 'emp_id', 'metric'));
    c.ojtDashboard = db.insertMany('ojt_dashboard', rows('OJT Dashboard').map(r => ({ emp_id: normId(r[0]), name: text(r[1]), trainer: norm(r[2]), work_mode: text(r[3]),
      doj: d(r[4]), training_end: d(r[5]), ojt_start: d(r[6]), ojt_end: d(r[7]), status: text(r[8]), ojt_day: num(r[9]) || 0, talk_days: num(r[10]) || 0,
      talk_hours: num(r[11]) || 0, last_talk: d(r[12]), updated_on: ts(r[13]), team: text(r[14]), team_set: text(r[15]) === 'Yes' ? 1 : 0,
      achievement: num(r[16]), score: num(r[17]), result: text(r[18]), pass_rule: text(r[19]), note: text(r[20]) })));
    c.ojtPerformance = db.insertMany('ojt_performance', rows('OJT Performance').map(r => ({ emp_id: normId(r[0]), name: text(r[1]), trainer: norm(r[2]), team: text(r[3]),
      metric: text(r[4]), type: text(r[5]), weight: num(r[6]), kind: text(r[7]), target: num(r[8]), achieved: num(r[9]), pct: num(r[10]), score: num(r[11]),
      date_from: d(r[12]), date_to: d(r[13]), data: text(r[14]),
      weeks: JSON.stringify([0, 1, 2, 3].map(k => ({ target: num(r[15 + 2 * k]), achieved: num(r[16 + 2 * k]) }))) })));
    c.whatsapp = db.insertMany('whatsapp_log', rows('WhatsApp Log').map(r => ({ sent_on: ts(r[0]), trainer: norm(r[1]), emp_id: normId(r[2]), candidate: text(r[3]),
      candidate_phone: text(r[4]), sent_to: text(r[5]), template: text(r[6]), status: text(r[7]) || 'logged', detail: text(r[8]) })));
    db.setMeta('imported_from_sheets', { on: new Date().toISOString(), counts: c });
  });
  return c;
}

/** Keeps the last row for each key (the sheets could hold repeats; the tables cannot). */
function dedupe(list, ...keys) {
  const m = new Map();
  list.forEach(r => m.set(keys.map(k => r[k]).join('\u0000'), r));
  return [...m.values()];
}

/** Reads the old tabs from the tracker and imports them (first start only). */
export async function importFromSheets() {
  if (db.getMeta('imported_from_sheets', null)) return null;
  if (!appDataEmpty()) { db.setMeta('imported_from_sheets', { on: new Date().toISOString(), skipped: 'Trainer Desk already had its own data' }); return null; }
  const meta = await G.sheetsMeta(CONFIG.TRACKER_ID);
  const have = new Set(meta.sheets.map(s => s.properties.title));
  const names = Object.keys(TABS).filter(n => have.has(n));
  const values = await G.sheetsValues(CONFIG.TRACKER_ID, names);
  const grids = {};
  names.forEach((n, i) => { grids[n] = values[i]; });
  const counts = importGrids(grids, meta.properties.locale || 'en_US');
  log('imported the existing tabs:', JSON.stringify(counts));
  return counts;
}
