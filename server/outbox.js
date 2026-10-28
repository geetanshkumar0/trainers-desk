/**
 * Work that has to leave the server: Master Dashboard writes and e-mails.
 * A write is saved in SQLite (outbox + the local copy of Master Dashboard) in the same transaction as the
 * change that caused it, so nothing is lost if Google is slow or down. A worker sends the queue in order and
 * retries with back-off; failures show on /admin/status.
 */
import * as db from './db.js';
import * as G from './google.js';
import { CONFIG, SERVER } from './config.js';
import { normId, norm } from './logic/common.js';

const log = (...a) => console.log(new Date().toISOString(), '[outbox]', ...a);
const MAX_ATTEMPTS = 20;

// Master Dashboard header -> in_master column, for the columns Trainer Desk writes.
const WRITABLE = {
  'Emp ID': 'emp_id', 'Trainer': 'trainer', 'Training Start Date': 'training_start', 'Department': 'department', 'Sub-Team': 'sub_team',
  'Final Mock Clearance / Fail Attempts': 'mock_attempt', 'Final Mock Status': 'mock_status', 'Final Mock/Training End Date': 'training_end'
};

function enqueue(kind, payload) {
  db.run('INSERT INTO outbox (kind, payload, created_on) VALUES (?, ?, ?)', kind, JSON.stringify(payload), new Date().toISOString());
  setImmediate(() => kick().catch(e => log('worker error', e.message)));
}

/* ---------------- local copy of Master Dashboard ---------------- */

function localAppend(rows) {
  rows.forEach(r => {
    if (db.get('SELECT 1 FROM in_master WHERE emp_id = ? AND trainer = ?', r.empId, r.trainer)) return;
    const hr = db.get('SELECT * FROM in_hr WHERE emp_id = ? ORDER BY seq LIMIT 1', r.empId) || {};
    const org = db.get('SELECT manager, mentor FROM in_org WHERE trainer = ? ORDER BY seq LIMIT 1', r.trainer) || {};
    // The sheet's formulas fill these in properly; until the next sync, show what the HR sheet says.
    db.run(`INSERT INTO in_master (row_no, emp_id, trainer, manager, mentor, doj, work_mode, name, phone, department, location, status, training_start)
            VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.empId, r.trainer, org.manager || '', org.mentor || '', hr.doj || '', r.empId.indexOf('A') >= 0 ? 'WFH' : 'WFO', hr.name || '', hr.phone || '',
      hr.department || '', hr.location || '', hr.status || '', r.trainingStart || '');
  });
}

function localSet(empId, trainer, set) {
  const cols = Object.keys(set).map(h => { if (!WRITABLE[h]) throw new Error('Trainer Desk does not write column "' + h + '"'); return WRITABLE[h]; });
  const res = db.run('UPDATE in_master SET ' + cols.map(c => c + ' = ?').join(', ') + ' WHERE emp_id = ? AND trainer = ?',
    ...Object.keys(set).map(h => set[h]), empId, trainer);
  return res.changes;
}

/** Adds candidates to Master Dashboard under a trainer. rows: [{ empId, trainer, trainingStart }] */
export function masterAppend(rows) {
  if (!rows.length) return;
  localAppend(rows);
  enqueue('master_append', { rows });
}

/** Sets Master Dashboard columns (by header) on the rows where this Emp ID sits under this trainer. */
export function masterSet(empId, trainer, set) {
  if (!localSet(empId, trainer, set)) throw new Error(empId + ' is no longer mapped to ' + trainer + ' in Master Dashboard.');
  enqueue('master_set', { empId, trainer, set });
}

/**
 * After a sync replaced the local copy: re-applies writes still waiting, and writes sent since the sync started
 * reading (the sheet it read may not have had them yet).
 */
export function applyMasterOverlay(since) {
  db.all("SELECT kind, payload FROM outbox WHERE kind IN ('master_append', 'master_set') AND (state = 'waiting' OR (state = 'done' AND done_on >= ?)) ORDER BY id", since || '')
    .forEach(o => {
      const p = JSON.parse(o.payload);
      if (o.kind === 'master_append') localAppend(p.rows);
      else localSet(p.empId, p.trainer, p.set);
    });
}

export function queueMail(to, subject, html) { enqueue('mail', { to, subject, html }); }

/* ---------------- sending ---------------- */

const colLetter = c => { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };

async function readMasterKeys() {
  const id = CONFIG.TRACKER_ID, tab = G.quoteTab(CONFIG.MASTER_SHEET);
  const [head] = await G.sheetsValues(id, [tab + '!1:1']);
  const h = (head[0] || []).map(x => String(x).trim());
  const col = name => { const i = h.indexOf(name); if (i < 0) throw new Error('Column "' + name + '" not found in Master Dashboard'); return i; };
  const cId = col('Emp ID'), cTrainer = col('Trainer');
  const [ids, trainers] = await G.sheetsValues(id, [tab + '!' + colLetter(cId) + ':' + colLetter(cId), tab + '!' + colLetter(cTrainer) + ':' + colLetter(cTrainer)]);
  return { tab, col, ids: ids.map(r => normId(r[0])), trainers: trainers.map(r => norm(r[0])) };
}

async function sendMasterAppend(p) {
  const k = await readMasterKeys();
  // A retry after a partial success must not add anyone twice.
  const already = new Set();
  k.ids.forEach((id, i) => { if (i && id) already.add(id + '|' + k.trainers[i]); });
  const rows = p.rows.filter(r => !already.has(r.empId + '|' + r.trainer));
  if (!rows.length) return;
  let last = 1;
  for (let r = k.ids.length - 1; r >= 1; r--) { if (k.ids[r]) { last = r + 1; break; } }
  const first = last + 1, end = first + rows.length - 1;
  const meta = await G.sheetsMeta(CONFIG.TRACKER_ID);
  const sh = meta.sheets.find(s => s.properties.title === CONFIG.MASTER_SHEET).properties;
  if (end > sh.gridProperties.rowCount) {
    await G.sheetsBatchUpdate(CONFIG.TRACKER_ID, [{ appendDimension: { sheetId: sh.sheetId, dimension: 'ROWS', length: end - sh.gridProperties.rowCount } }]);
  }
  const range = c => k.tab + '!' + colLetter(c) + first + ':' + colLetter(c) + end;
  const data = [
    { range: range(k.col('Emp ID')), values: rows.map(r => [r.empId]) },
    { range: range(k.col('Trainer')), values: rows.map(r => [r.trainer]) }
  ];
  if (rows.some(r => r.trainingStart)) data.push({ range: range(k.col('Training Start Date')), values: rows.map(r => [r.trainingStart || '']) });
  await G.sheetsWrite(CONFIG.TRACKER_ID, data);
}

async function sendMasterSet(p) {
  const k = await readMasterKeys();
  const rows = [];
  k.ids.forEach((id, i) => { if (i && id === p.empId && k.trainers[i] === p.trainer) rows.push(i + 1); });
  if (!rows.length) { const e = new Error(p.empId + ' is no longer mapped to ' + p.trainer + ' in Master Dashboard.'); e.permanent = true; throw e; }
  const data = [];
  rows.forEach(r => Object.keys(p.set).forEach(h => data.push({ range: k.tab + '!' + colLetter(k.col(h)) + r, values: [[p.set[h]]] })));
  await G.sheetsWrite(CONFIG.TRACKER_ID, data);
}

async function sendMail(p) {
  const to = SERVER.mailOverride || SERVER.mailTo || p.to;
  if (!G.mailConfigured()) { log('mail not configured; skipped:', p.subject); return; }
  await G.sendMail(to, (SERVER.mailOverride ? '[for ' + p.to + '] ' : '') + p.subject, p.html);
  log('mail sent to', to, '|', p.subject);
}

let busy = false, again = false;
/** Sends what is due. Master Dashboard writes go strictly in order; e-mails do not wait for them. */
export async function kick() {
  if (!db.isOpen()) return;
  if (busy) { again = true; return; }
  busy = true;
  try {
    do {
      again = false;
      const now = new Date().toISOString();
      const due = db.all("SELECT * FROM outbox WHERE state = 'waiting' AND next_try <= ? ORDER BY id LIMIT 50", now);
      let masterBlocked = !!db.get("SELECT 1 FROM outbox WHERE state = 'waiting' AND kind <> 'mail' AND next_try > ?", now);
      for (const o of due) {
        const isMaster = o.kind !== 'mail';
        if (isMaster && masterBlocked) continue;
        try {
          if (SERVER.demo) { /* local preview: nothing leaves the machine */ }
          else if (o.kind === 'master_append') await sendMasterAppend(JSON.parse(o.payload));
          else if (o.kind === 'master_set') await sendMasterSet(JSON.parse(o.payload));
          else await sendMail(JSON.parse(o.payload));
          db.run("UPDATE outbox SET state = 'done', done_on = ?, attempts = attempts + 1, last_error = '' WHERE id = ?", new Date().toISOString(), o.id);
        } catch (e) {
          const attempts = o.attempts + 1, dead = e.permanent || attempts >= MAX_ATTEMPTS;
          const wait = Math.min(30 * 60, 15 * Math.pow(2, attempts - 1)) * 1000;
          db.run('UPDATE outbox SET attempts = ?, last_error = ?, state = ?, next_try = ? WHERE id = ?',
            attempts, e.message, dead ? 'failed' : 'waiting', new Date(Date.now() + wait).toISOString(), o.id);
          log(o.kind, '#' + o.id, dead ? 'FAILED for good:' : 'failed, will retry:', e.message);
          if (isMaster && !dead) masterBlocked = true;
        }
      }
    } while (again);
  } finally {
    busy = false;
  }
}

let timer = null;
export function start() { timer = setInterval(() => kick().catch(e => log('worker error', e.message)), 10000); kick(); }
export function stop() { clearInterval(timer); }

export function status() {
  return {
    waiting: db.get("SELECT COUNT(*) n FROM outbox WHERE state = 'waiting'").n,
    failed: db.all("SELECT id, kind, created_on, attempts, last_error, payload FROM outbox WHERE state = 'failed' ORDER BY id DESC LIMIT 20"),
    oldestWaiting: (db.get("SELECT created_on FROM outbox WHERE state = 'waiting' ORDER BY id LIMIT 1") || {}).created_on || null
  };
}
