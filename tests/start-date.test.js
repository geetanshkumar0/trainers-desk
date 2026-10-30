/** The one-time clean-up for 30 Oct 2026: everything recorded before that day goes; work from that day stays. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-start-'));
const db = await import('../server/db.js');
const file = path.join(dir, 'td.db');

test('records from before 30 Oct 2026 are removed, later ones kept, once', () => {
  db.open(file);                                        // a database that already existed before the clean-up
  db.exec('PRAGMA user_version = 0');
  const old = '2026-10-28T09:00:00.000Z', lateEvening = '2026-10-29T18:00:00.000Z', today = '2026-10-30T05:00:00.000Z';
  [['NBT1', old], ['NBT2', lateEvening], ['NBT3', today]].forEach(([id, on]) => {
    db.run('INSERT INTO claims (emp_id, trainer, claimed_by, claimed_on) VALUES (?, ?, ?, ?)', id, 't@x', 't@x', on);
    db.run('INSERT INTO attendance (emp_id, date, code, trainer, marked_by, marked_on) VALUES (?, ?, ?, ?, ?, ?)', id, '2026-10-28', 'P', 't@x', 't@x', on);
    db.run("INSERT INTO change_requests (id, requested_on, requested_by, trainer, emp_id, field, status) VALUES (?, ?, 't@x', 't@x', ?, 'Department', 'Pending')", 'CR-' + id, on, id);
    db.run("INSERT INTO mock_scores (emp_id, trainer, mock_date, attempt, status, approved_on) VALUES (?, 't@x', '2026-10-28', '1st', 'Pass', ?)", id, on);
    db.run("INSERT INTO nht_status (emp_id, ojt_entered, updated_on) VALUES (?, 'Yes', ?)", id, on);
  });
  db.run("INSERT INTO excluded_candidates (emp_id, reason, removed_by, removed_on) VALUES ('NBT9', 'x', 'a@x', ?)", old);
  db.close();
  db.open(file);                                        // the new version starts: the clean-up runs
  for (const t of ['claims', 'attendance', 'change_requests', 'mock_scores', 'nht_status']) {
    assert.deepEqual(db.all('SELECT emp_id FROM ' + t + ' ORDER BY emp_id').map(r => r.emp_id), ['NBT3'], t + ': only work from 30 Oct (India time) stays');
  }
  assert.equal(db.get('SELECT COUNT(*) n FROM excluded_candidates').n, 1, 'admins\' removals from the unclaimed list are kept');
  assert.ok(db.get("SELECT 1 FROM mirror_dirty WHERE tab = 'Attendance'"), 'the tracker tabs are cleaned up too');
  // It runs once: work saved afterwards is never removed by it again.
  db.run('INSERT INTO claims (emp_id, trainer, claimed_by, claimed_on) VALUES (?, ?, ?, ?)', 'NBT4', 't@x', 't@x', old);
  db.close();
  db.open(file);
  assert.equal(db.get("SELECT COUNT(*) n FROM claims WHERE emp_id = 'NBT4'").n, 1);
  db.close();
});

test('a brand-new database is left alone', () => {
  db.open(path.join(dir, 'new.db'));
  assert.equal(db.get('PRAGMA user_version').user_version, 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
