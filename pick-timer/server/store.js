'use strict';
/*
 * Persistence with Node's built-in SQLite (node:sqlite, Node 22.13+).
 * One table per collection (users, kcs, slot_rules, kc_sessions, attendees, approvals, results,
 * sync_log, email_log, settings), each row stored as JSON keyed by id. After every operation only
 * the rows that changed are written, in one transaction.
 */
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const Core = require('../public/core.js');

const TABLES = {users:'users', kcs:'kcs', slotRules:'slot_rules', sessions:'kc_sessions', attendees:'attendees', approvals:'approvals',
  results:'results', syncLog:'sync_log', emailLog:'email_log'};

class Store {
  constructor(dir, file) {
    fs.mkdirSync(dir, {recursive:true});
    this.db = new DatabaseSync(path.join(dir, file || 'kcpicktimer.db'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
    for (const t of [...Object.values(TABLES), 'settings']) this.db.exec(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS logins (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS logins_user ON logins(user_id);`);
    this.q = {
      lGet:this.db.prepare('SELECT user_id, expires FROM logins WHERE token = ?'),
      lPut:this.db.prepare('INSERT INTO logins (token, user_id, created, expires) VALUES (?, ?, ?, ?)'),
      lDel:this.db.prepare('DELETE FROM logins WHERE token = ?'),
      lDelUser:this.db.prepare('DELETE FROM logins WHERE user_id = ?'),
      lPurge:this.db.prepare('DELETE FROM logins WHERE expires < ?'),
    };
    this.cache = new Map();
  }
  isEmpty() { return !this.db.prepare('SELECT 1 FROM settings LIMIT 1').get(); }
  load() {
    const S = Core.newState();
    for (const [coll, t] of Object.entries(TABLES)) {
      S[coll] = this.db.prepare(`SELECT id, data FROM ${t}`).all().map(r => { this.cache.set(`${t}\0${r.id}`, r.data); return JSON.parse(r.data); });
    }
    S.syncLog.sort((a, b) => a.at - b.at); S.emailLog.sort((a, b) => a.at - b.at);
    const st = this.db.prepare('SELECT data FROM settings WHERE id = ?').get('site');
    if (st) { this.cache.set('settings\0site', st.data); const saved = JSON.parse(st.data); for (const k of Object.keys(saved)) S.settings[k] = typeof saved[k] === 'object' && saved[k] && !Array.isArray(saved[k]) ? {...S.settings[k], ...saved[k]} : saved[k]; }
    return S;
  }
  save(S) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [coll, t] of Object.entries(TABLES)) {
        const seen = new Set();
        const put = this.db.prepare(`INSERT INTO ${t} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`);
        for (const row of S[coll]) {
          const key = `${t}\0${row.id}`, json = JSON.stringify(row); seen.add(key);
          if (this.cache.get(key) !== json) { put.run(row.id, json); this.cache.set(key, json); }
        }
        const del = this.db.prepare(`DELETE FROM ${t} WHERE id = ?`);
        for (const key of [...this.cache.keys()]) if (key.startsWith(t + '\0') && !seen.has(key)) { del.run(key.slice(t.length + 1)); this.cache.delete(key); }
      }
      const json = JSON.stringify(S.settings);
      if (this.cache.get('settings\0site') !== json) { this.db.prepare('INSERT INTO settings (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run('site', json); this.cache.set('settings\0site', json); }
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  /** A consistent copy of the database (safe while running). */
  backup(file) {
    fs.mkdirSync(path.dirname(file), {recursive:true});
    if (fs.existsSync(file)) fs.unlinkSync(file);
    this.db.exec(`VACUUM INTO '${String(file).replace(/'/g, "''")}'`);
  }
  close() { this.db.close(); }
  /* sign-in sessions (not used inside Trainer Desk, which signs people in itself) */
  loginCreate(token, userId, ttl) { const now = Date.now(); this.q.lPut.run(token, userId, now, now + ttl); }
  loginGet(token) { const r = this.q.lGet.get(token); return r && r.expires > Date.now() ? r.user_id : null; }
  loginDelete(token) { this.q.lDel.run(token); }
  loginDeleteUser(userId) { this.q.lDelUser.run(userId); }
  loginPurge() { this.q.lPurge.run(Date.now()); }
}
module.exports = {Store, TABLES};
