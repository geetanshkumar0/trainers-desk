/**
 * The SQLite database (node:sqlite, built into Node.js 22.13+). One connection for the whole process.
 * node:sqlite is synchronous, so a function that does its reads and writes without awaiting in between
 * can never interleave with another request; tx() also wraps them in one transaction.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let db = null;
const cache = new Map();

export function open(file) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  const fresh = !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  db.exec(fs.readFileSync(path.join(HERE, 'schema.sql'), 'utf8'));
  if (fresh) db.exec('PRAGMA user_version = ' + MIGRATIONS.length);   // a new database already has every column
  migrate();
  return db;
}

/**
 * Changes to tables that already exist on the server. schema.sql only creates what is missing, so a new column
 * on an existing table goes here, as the next item (never edit or reorder old ones). Each runs once.
 * Example: "ALTER TABLE attendance ADD COLUMN note TEXT NOT NULL DEFAULT ''"
 */
const MIGRATIONS = [];

function migrate() {
  const at = db.prepare('PRAGMA user_version').get().user_version;
  MIGRATIONS.slice(at).forEach((sql, i) => {
    db.exec('BEGIN');
    try { db.exec(sql); db.exec('PRAGMA user_version = ' + (at + i + 1)); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  });
}

export const isOpen = () => !!db;

export function close() { if (db) { db.close(); db = null; cache.clear(); } }

function stmt(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}

/** All rows as plain objects. */
export const all = (sql, ...params) => stmt(sql).all(...params).map(plain);
/** First row, or null. */
export const get = (sql, ...params) => { const r = stmt(sql).get(...params); return r ? plain(r) : null; };
/** INSERT / UPDATE / DELETE. Returns { changes, lastInsertRowid }. */
export const run = (sql, ...params) => stmt(sql).run(...params);
export const exec = sql => db.exec(sql);

function plain(r) { return Object.assign({}, r); }

let depth = 0;
/** Runs fn inside one transaction (nested calls join the outer one). Rolls back if fn throws. */
export function tx(fn) {
  if (depth) { depth++; try { return fn(); } finally { depth--; } }
  db.exec('BEGIN IMMEDIATE');
  depth = 1;
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (x) { /* already rolled back */ }
    throw e;
  } finally {
    depth = 0;
  }
}

/** Inserts many rows into a table: rows are objects with the same keys. */
export function insertMany(table, rows) {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  const s = stmt('INSERT INTO ' + table + ' (' + cols.join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')');
  rows.forEach(r => s.run(...cols.map(c => (r[c] === undefined ? null : r[c]))));
  return rows.length;
}

export function getMeta(key, fallback) { const r = get('SELECT value FROM meta WHERE key = ?', key); return r ? JSON.parse(r.value) : fallback; }
export function setMeta(key, value) { run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value)); }

/** Writes a consistent copy of the database to file (safe while the app is running). */
export function backup(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.unlinkSync(file);
  db.exec("VACUUM INTO '" + file.replace(/'/g, "''") + "'");
}

/** Notes that an app tab changed, so the mirror copies it back to the tracker. */
export function markDirty(...tabs) {
  const now = new Date().toISOString();
  tabs.forEach(t => run('INSERT INTO mirror_dirty (tab, since) VALUES (?, ?) ON CONFLICT(tab) DO NOTHING', t, now));
}
