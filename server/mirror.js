/**
 * Writes Trainer Desk's records into the tracker's app tabs (Attendance, Change Requests, Mock Scores, NHT Status, ...),
 * a few seconds after each save, in the same columns as before.
 *
 * Only Trainer Desk's own rows are touched: each record is added as a new row or changed in place, and a record that
 * no longer exists (a restored candidate, say) has its row removed. Every other row in those tabs stays exactly as it
 * is. mirror_rows remembers which rows Trainer Desk wrote, so nothing is written twice. Turn it off with SHEET_MIRROR=off.
 */
import * as db from './db.js';
import * as G from './google.js';
import { CONFIG, SERVER } from './config.js';
import { parseSheetDate, tzParts } from './dates.js';

const log = (...a) => console.log(new Date().toISOString(), '[mirror]', ...a);
const pad = n => String(n).padStart(2, '0');
/** ISO timestamp -> 'yyyy-MM-dd HH:mm:ss' in the sheet time zone (the sheet reads it as a date-time). */
const when = iso => { if (!iso) return ''; const p = tzParts(new Date(iso)); return p.y + '-' + pad(p.m) + '-' + pad(p.d) + ' ' + pad(p.h) + ':' + pad(p.mi) + ':' + pad(p.s); };
const blank = v => (v === null || v === undefined ? '' : v);
const K = v => String(v == null ? '' : v).trim().toUpperCase();

/**
 * Each tab: its header, which columns identify a row (keyCols), and Trainer Desk's rows as [values].
 * appendOnly tabs (logs) only ever get new rows at the bottom.
 */
export const TABS = {
  'Excluded Candidates': { header: ['Emp ID', 'Employee Name', 'Department', 'DOJ', 'Reason', 'Removed By', 'Removed On'], keyCols: [0],
    rows: () => db.all('SELECT * FROM excluded_candidates ORDER BY removed_on').map(r => [r.emp_id, r.name, r.department, r.doj, r.reason, r.removed_by, when(r.removed_on)]) },
  'Attendance Log': { header: ['Changed On', 'Changed By', 'Trainer', 'Emp ID', 'Attendance Date', 'Old Mark', 'New Mark'], appendOnly: true,
    rows: () => db.all('SELECT * FROM attendance_log ORDER BY id').map(r => ({ key: 'log#' + r.id, values: [when(r.changed_on), r.changed_by, r.trainer, r.emp_id, r.date, r.old_code, r.new_code] })) },
  'Change Requests': { header: ['Request ID', 'Requested On', 'Requested By', 'Trainer', 'Emp ID', 'Employee Name', 'Change', 'Old Value', 'New Value',
    'Status', 'Reviewed By', 'Reviewed On', 'Review Note', 'Data'], keyCols: [0],
    rows: () => db.all('SELECT * FROM change_requests ORDER BY seq').map(r => [r.id, when(r.requested_on), r.requested_by, r.trainer, r.emp_id, r.name, r.field,
      r.old_text, r.new_text, r.status, r.reviewed_by, when(r.reviewed_on), r.note, r.data]) },
  'Mock Scores': { header: ['Emp ID', 'Employee Name', 'Trainer', 'Mock Date', 'Attempt', 'Score %', 'Status', 'Final Attempt', 'Entered By', 'Approved By', 'Approved On'], keyCols: [0, 4],
    rows: () => db.all('SELECT * FROM mock_scores ORDER BY id').map(r => [r.emp_id, r.name, r.trainer, r.mock_date, r.attempt, blank(r.score), r.status,
      r.final ? 'Yes' : 'No', r.entered_by, r.approved_by, when(r.approved_on)]) },
  'NHT Status': { header: ['Emp ID', 'Employee Name', 'Trainer', 'OJT Entered', 'OJT Eligible', 'Updated By', 'Updated On'], keyCols: [0],
    rows: () => db.all('SELECT * FROM nht_status ORDER BY updated_on').map(r => [r.emp_id, r.name, r.trainer, r.ojt_entered, r.ojt_eligible, r.updated_by, when(r.updated_on)]) },
  'OJT Team': { header: ['Emp ID', 'Employee Name', 'Trainer', 'OJT Team', 'Updated By', 'Updated On'], keyCols: [0],
    rows: () => db.all('SELECT * FROM ojt_team ORDER BY updated_on').map(r => [r.emp_id, r.name, r.trainer, r.team, r.updated_by, when(r.updated_on)]) },
  'OJT Manual Inputs': { header: ['Emp ID', 'Employee Name', 'Trainer', 'Metric', 'Achieved', 'Updated By', 'Updated On'], keyCols: [0, 3],
    rows: () => db.all('SELECT * FROM ojt_manual_inputs ORDER BY updated_on').map(r => [r.emp_id, r.name, r.trainer, r.metric, r.achieved, r.updated_by, when(r.updated_on)]) },
  // Rebuilt by every OJT refresh; the Updated On column is left out of the comparison so an unchanged trainee is not rewritten.
  'OJT Dashboard': { header: ['Emp ID', 'Employee Name', 'Trainer', 'Work Mode', 'DOJ', 'Training End Date', 'OJT Start Date', 'OJT End Date',
    'OJT Status', 'OJT Day', 'Talktime Days', 'Total Talktime (hrs)', 'Last Talktime Date', 'Updated On',
    'OJT Team', 'Team Picked By Trainer', 'Achievement %', 'OJT Score', 'OJT Result', 'Pass Rule', 'Data Note'], keyCols: [0], ignoreCols: [13],
    rows: () => db.all('SELECT * FROM ojt_dashboard ORDER BY seq').map(r => [r.emp_id, r.name, r.trainer, r.work_mode, r.doj, r.training_end, r.ojt_start, r.ojt_end,
      r.status, r.ojt_day || '', r.talk_days, r.talk_hours, r.last_talk, when(r.updated_on), r.team, r.team_set ? 'Yes' : '', blank(r.achievement), blank(r.score),
      r.result, r.pass_rule, r.note]) },
  'OJT Performance': { header: ['Emp ID', 'Employee Name', 'Trainer', 'OJT Team', 'Metric', 'Type', 'Weight', 'Kind', 'Target', 'Achieved', 'Achieved %',
    'Score', 'From', 'To', 'Data', 'W1 Target', 'W1 Achieved', 'W2 Target', 'W2 Achieved', 'W3 Target', 'W3 Achieved', 'W4 Target', 'W4 Achieved'], keyCols: [0, 4],
    rows: () => db.all('SELECT * FROM ojt_performance ORDER BY seq').map(r => {
      const w = JSON.parse(r.weeks || '[]');
      return [r.emp_id, r.name, r.trainer, r.team, r.metric, r.type, blank(r.weight), r.kind, blank(r.target), blank(r.achieved), blank(r.pct), blank(r.score),
        r.date_from, r.date_to, r.data].concat([0, 1, 2, 3].flatMap(k => [blank((w[k] || {}).target), blank((w[k] || {}).achieved)]));
    }) },
  'WhatsApp Log': { header: ['Sent On', 'Trainer', 'Emp ID', 'Candidate', 'Candidate Phone', 'Sent To', 'Template', 'Status', 'Detail'], appendOnly: true,
    rows: () => db.all('SELECT * FROM whatsapp_log ORDER BY id').map(r => ({ key: 'wa#' + r.id, values: [when(r.sent_on), r.trainer, r.emp_id, r.candidate, r.candidate_phone, r.sent_to, r.template, r.status, r.detail] })) },
  'Attendance': { attendance: true }
};

const colLetter = c => { let s = ''; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
const hashOf = v => JSON.stringify(v);

/** Trainer Desk's rows for a tab: Map key -> { values, hash }. */
function desired(spec) {
  const out = new Map();
  spec.rows().forEach(r => {
    const values = Array.isArray(r) ? r : r.values;
    const key = Array.isArray(r) ? spec.keyCols.map(i => K(values[i])).join('|') : r.key;
    const cmp = spec.ignoreCols ? values.filter((v, i) => !spec.ignoreCols.includes(i)) : values;
    out.set(key, { values: values.map(v => blank(v)), hash: hashOf(cmp) });
  });
  return out;
}
function written(tab) { const m = new Map(); db.all('SELECT key, hash FROM mirror_rows WHERE tab = ?', tab).forEach(r => m.set(r.key, r.hash)); return m; }
function remember(tab, key, hash) {
  if (hash === null) db.run('DELETE FROM mirror_rows WHERE tab = ? AND key = ?', tab, key);
  else db.run('INSERT INTO mirror_rows (tab, key, hash) VALUES (?, ?, ?) ON CONFLICT(tab, key) DO UPDATE SET hash = excluded.hash', tab, key, hash);
}

/** The tab's sheet properties, creating the tab (with its header) when it is missing. */
async function ensureTab(meta, name, header) {
  let p = (meta.sheets.find(s => s.properties.title === name) || {}).properties;
  if (p) return p;
  await G.sheetsBatchUpdate(CONFIG.TRACKER_ID, [{ addSheet: { properties: { title: name, gridProperties: { frozenRowCount: 1, rowCount: 200, columnCount: Math.max(header.length, 26) } } } }]);
  await G.sheetsWrite(CONFIG.TRACKER_ID, [{ range: G.quoteTab(name) + '!A1', values: [header] }]);
  const fresh = await G.sheetsMeta(CONFIG.TRACKER_ID);
  meta.sheets = fresh.sheets;
  return meta.sheets.find(s => s.properties.title === name).properties;
}

/** Makes sure the grid has at least rows x cols cells. */
async function ensureSize(p, rows, cols) {
  const need = [];
  if (p.gridProperties.rowCount < rows) need.push({ appendDimension: { sheetId: p.sheetId, dimension: 'ROWS', length: rows - p.gridProperties.rowCount + 100 } });
  if (p.gridProperties.columnCount < cols) need.push({ appendDimension: { sheetId: p.sheetId, dimension: 'COLUMNS', length: cols - p.gridProperties.columnCount } });
  if (!need.length) return;
  await G.sheetsBatchUpdate(CONFIG.TRACKER_ID, need);
  if (p.gridProperties.rowCount < rows) p.gridProperties.rowCount = rows + 100;
  if (p.gridProperties.columnCount < cols) p.gridProperties.columnCount = cols;
}

/** Deletes sheet rows (1-based numbers), bottom first so the numbers stay right. */
async function deleteRows(p, nums) {
  if (!nums.length) return;
  const req = [...nums].sort((a, b) => b - a).map(n => ({ deleteDimension: { range: { sheetId: p.sheetId, dimension: 'ROWS', startIndex: n - 1, endIndex: n } } }));
  await G.sheetsBatchUpdate(CONFIG.TRACKER_ID, req);
  p.gridProperties.rowCount -= nums.length;
}
const shiftAfter = (n, deleted) => n - deleted.filter(d => d < n).length;

/** One ordinary tab: add, change or remove only Trainer Desk's rows. Returns how many rows changed. */
async function syncTab(meta, name, spec) {
  const want = desired(spec), had = written(name);
  const changed = [...want].filter(([k, r]) => had.get(k) !== r.hash);
  const gone = [...had.keys()].filter(k => !want.has(k));
  if (!changed.length && !gone.length) return 0;
  const id = CONFIG.TRACKER_ID, tab = G.quoteTab(name);
  const p = await ensureTab(meta, name, spec.header);
  const width = spec.header.length;

  if (spec.appendOnly) {
    const [colA] = await G.sheetsValues(id, [tab + '!A:A']);
    const fresh = changed.filter(([k]) => !had.has(k));
    if (fresh.length) {
      const first = Math.max(colA.length, 1) + 1;
      await ensureSize(p, first + fresh.length, width);
      await G.sheetsWrite(id, [{ range: tab + '!A' + first, values: fresh.map(([, r]) => r.values) }]);
    }
    fresh.forEach(([k, r]) => remember(name, k, r.hash));
    gone.forEach(k => remember(name, k, null));
    return fresh.length;
  }

  const [grid] = await G.sheetsValues(id, [tab]);
  const rowOf = new Map();
  grid.forEach((r, i) => { if (!i) return; const k = spec.keyCols.map(c => K(r[c])).join('|'); if (k.replace(/\|/g, '') && !rowOf.has(k)) rowOf.set(k, i + 1); });
  const data = [];
  if (!grid.length || !(grid[0] || []).some(v => String(v).trim())) data.push({ range: tab + '!A1', values: [spec.header] });

  const del = gone.map(k => rowOf.get(k)).filter(Boolean);
  await deleteRows(p, del);
  let last = 1;
  grid.forEach((r, i) => { if (r.some(v => String(v).trim())) last = i + 1; });
  last = Math.max(1, shiftAfter(last + 1, del) - 1);
  const add = [];
  changed.forEach(([k, r]) => {
    const at = rowOf.get(k);
    if (at) data.push({ range: tab + '!A' + shiftAfter(at, del), values: [r.values] });
    else add.push(r.values);
  });
  if (add.length) data.push({ range: tab + '!A' + (last + 1), values: add });
  await ensureSize(p, last + 1 + add.length, width);
  if (data.length) await G.sheetsWrite(id, data);
  changed.forEach(([k, r]) => remember(name, k, r.hash));
  gone.forEach(k => remember(name, k, null));
  return changed.length + gone.length;
}

/**
 * Attendance: one row per trainee, one column per date from column E. New dates get a column in date order;
 * Trainer Desk writes the rows of its own trainees only.
 */
async function syncAttendance(meta) {
  const name = 'Attendance', id = CONFIG.TRACKER_ID, tab = G.quoteTab(name);
  const people = new Map();
  db.all('SELECT * FROM attendance ORDER BY emp_id, date').forEach(r => {
    const p = people.get(r.emp_id) || { base: [r.emp_id, r.name, r.trainer, r.doj], marks: {} };
    p.marks[r.date] = r.code;
    people.set(r.emp_id, p);
  });
  const had = written(name);
  const changed = [...people].filter(([k, v]) => had.get(k) !== hashOf(v));
  const gone = [...had.keys()].filter(k => !people.has(k));
  if (!changed.length && !gone.length) return 0;
  const p = await ensureTab(meta, name, ['Emp ID', 'Employee Name', 'Trainer', 'DOJ']);
  const locale = db.getMeta('locale', 'en_US');
  const read = async () => (await G.sheetsValues(id, [tab]))[0];
  let grid = await read();
  const headIso = () => (grid[0] || []).map((v, i) => (i >= 4 ? parseSheetDate(v, locale) : ''));

  // 1. A column for every date Trainer Desk has marks on, kept in date order.
  const dates = [...new Set(changed.flatMap(([, v]) => Object.keys(v.marks)))].sort();
  let head = headIso(), inserted = false;
  for (const d of dates) {
    if (head.indexOf(d) >= 0) continue;
    let slot = head.length;
    for (let i = 4; i < head.length; i++) { if (head[i] && head[i] > d) { slot = i; break; } }
    slot = Math.max(slot, 4);
    if (slot < head.length) {
      await G.sheetsBatchUpdate(id, [{ insertDimension: { range: { sheetId: p.sheetId, dimension: 'COLUMNS', startIndex: slot, endIndex: slot + 1 }, inheritFromBefore: true } }]);
      p.gridProperties.columnCount++;
    } else await ensureSize(p, 1, slot + 1);
    await G.sheetsWrite(id, [{ range: tab + '!' + colLetter(slot + 1) + '1', values: [[d]] }]);
    head.splice(slot, 0, d);
    inserted = true;
  }
  if (inserted || !grid.length) grid = await read();
  head = headIso();
  if (!grid.length || !String((grid[0] || [])[0] || '').trim()) await G.sheetsWrite(id, [{ range: tab + '!A1', values: [['Emp ID', 'Employee Name', 'Trainer', 'DOJ']] }]);

  // 2. Trainer Desk's rows: change in place, add at the bottom, remove the ones it no longer has.
  const rowOf = new Map();
  grid.forEach((r, i) => { const k = K(r[0]); if (i && k && !rowOf.has(k)) rowOf.set(k, i + 1); });
  const del = gone.map(k => rowOf.get(k)).filter(Boolean);
  await deleteRows(p, del);
  let last = 1;
  grid.forEach((r, i) => { if (r.some(v => String(v).trim())) last = i + 1; });
  last = Math.max(1, shiftAfter(last + 1, del) - 1);
  const width = Math.max(head.length, 4), data = [], add = [];
  const line = v => v.base.concat(head.slice(4).map(d => (d && v.marks[d]) || ''));
  changed.forEach(([k, v]) => {
    const at = rowOf.get(K(k));
    if (at) data.push({ range: tab + '!A' + shiftAfter(at, del), values: [line(v)] });
    else add.push(line(v));
  });
  if (add.length) data.push({ range: tab + '!A' + (last + 1), values: add });
  await ensureSize(p, last + 1 + add.length, width);
  if (data.length) await G.sheetsWrite(id, data);
  changed.forEach(([k, v]) => remember(name, k, hashOf(v)));
  gone.forEach(k => remember(name, k, null));
  return changed.length + gone.length;
}

let busy = false;
/** Writes every changed tab to the tracker. Returns the tabs written. */
export async function mirrorNow() {
  if (busy || SERVER.demo || !SERVER.mirror || !G.sheetsConnected()) return [];
  busy = true;
  try {
    const dirty = db.all('SELECT tab, since FROM mirror_dirty');
    if (!dirty.length) return [];
    const meta = await G.sheetsMeta(CONFIG.TRACKER_ID);
    const done = [];
    for (const d of dirty) {
      const spec = TABS[d.tab];
      if (!spec) { db.run('DELETE FROM mirror_dirty WHERE tab = ?', d.tab); continue; }
      const startedAt = new Date().toISOString();
      try {
        const n = spec.attendance ? await syncAttendance(meta) : await syncTab(meta, d.tab, spec);
        // Changes made while this tab was being written keep it dirty for the next round.
        db.run('DELETE FROM mirror_dirty WHERE tab = ? AND since = ?', d.tab, d.since);
        db.run('UPDATE mirror_dirty SET since = ? WHERE tab = ? AND since < ?', startedAt, d.tab, startedAt);
        if (n) done.push(d.tab + ' (' + n + ')');
      } catch (e) {
        log(d.tab, 'not written:', e.message);
      }
    }
    if (done.length) log('written to the tracker:', done.join(', '));
    return done.map(x => x.replace(/ \(\d+\)$/, ''));
  } finally {
    busy = false;
  }
}

let timer = null, soon = null, started = false;
/** Writes changes a few seconds after they are saved (several quick saves go out together). */
function mirrorSoon() {
  if (!started || soon || SERVER.demo || !SERVER.mirror) return;
  soon = setTimeout(async () => {
    soon = null;
    let done = [];
    try { done = await mirrorNow(); } catch (e) { log(e.message); }
    // Changed again while writing: go again. If Google failed, the regular timer retries (no hammering).
    if (done.length && db.isOpen() && db.get('SELECT 1 FROM mirror_dirty LIMIT 1')) mirrorSoon();
  }, SERVER.mirrorDelaySeconds * 1000);
}
export function start() {
  started = true;
  db.onDirty(mirrorSoon);
  timer = setInterval(() => mirrorNow().catch(e => log(e.message)), SERVER.mirrorSeconds * 1000);
  mirrorSoon();
}
export function stop() { started = false; clearInterval(timer); clearTimeout(soon); }
