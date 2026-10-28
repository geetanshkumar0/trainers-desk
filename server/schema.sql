-- Trainer Desk database (SQLite, opened with node:sqlite).
-- Dates are 'yyyy-MM-dd' text in the sheet time zone; timestamps are ISO-8601 UTC text.
--
-- Two kinds of table:
--   in_*   inputs copied from Google Sheets. The sync replaces their contents; never edit them here.
--   others owned by Trainer Desk. This database is the only place they are kept
--          (their rows are also written into the tracker's app tabs when SHEET_MIRROR is on; see mirror.js).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

/* ================================================================== */
/* Inputs from Google Sheets                                          */
/* ================================================================== */

-- Master Dashboard, one row per sheet row. row_no NULL = added by Trainer Desk, not yet in the sheet.
CREATE TABLE IF NOT EXISTS in_master (
  seq INTEGER PRIMARY KEY,
  row_no INTEGER,
  emp_id TEXT NOT NULL,
  trainer TEXT NOT NULL DEFAULT '',       -- lower case e-mail
  manager TEXT NOT NULL DEFAULT '',
  mentor TEXT NOT NULL DEFAULT '',
  doj TEXT NOT NULL DEFAULT '',
  work_mode TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  sub_team TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',        -- Employment Status
  lateral TEXT NOT NULL DEFAULT '',
  training_start TEXT NOT NULL DEFAULT '',
  kc_score REAL,
  kc_attempt TEXT NOT NULL DEFAULT '',
  kc_status TEXT NOT NULL DEFAULT '',
  mock_attempt TEXT NOT NULL DEFAULT '',
  mock_status TEXT NOT NULL DEFAULT '',
  training_end TEXT NOT NULL DEFAULT '',  -- Final Mock/Training End Date
  training_days REAL,
  ojt_start TEXT NOT NULL DEFAULT '',
  ojt_pct REAL,
  ojt_end TEXT NOT NULL DEFAULT '',
  attrition_day REAL,
  lwd TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS in_master_trainer ON in_master (trainer);
CREATE INDEX IF NOT EXISTS in_master_emp ON in_master (emp_id);

-- HR_WFO / HR_WFH, in sheet order.
CREATE TABLE IF NOT EXISTS in_hr (
  seq INTEGER PRIMARY KEY,
  sheet TEXT NOT NULL,
  emp_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  doj TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS in_hr_emp ON in_hr (emp_id);

CREATE TABLE IF NOT EXISTS in_also_mapped (emp_id TEXT PRIMARY KEY);   -- Sonika Dashboard col C
CREATE TABLE IF NOT EXISTS in_removed (emp_id TEXT PRIMARY KEY);       -- Removed col C / D

-- Scoring_Master M/N/O, in sheet order (who trains, manages and mentors whom).
CREATE TABLE IF NOT EXISTS in_org (seq INTEGER PRIMARY KEY, trainer TEXT NOT NULL, manager TEXT NOT NULL DEFAULT '', mentor TEXT NOT NULL DEFAULT '');
-- T&D Performance Tracker B/C: display names.
CREATE TABLE IF NOT EXISTS in_names (email TEXT PRIMARY KEY, name TEXT NOT NULL);

-- KC Sheet. key = Emp ID (upper case) or official e-mail (lower case).
CREATE TABLE IF NOT EXISTS in_kc (seq INTEGER PRIMARY KEY, key TEXT NOT NULL, date TEXT NOT NULL DEFAULT '', attempt TEXT NOT NULL DEFAULT '', score REAL, status TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS in_kc_key ON in_kc (key);

-- Intervention Required: BQ projects required (first row per trainer), and its month list.
CREATE TABLE IF NOT EXISTS in_bq_months (seq INTEGER PRIMARY KEY, month TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS in_bq_required (trainer TEXT NOT NULL, month TEXT NOT NULL, n REAL NOT NULL);
-- Tenure Intervention Effectiveness: one row per intervention.
CREATE TABLE IF NOT EXISTS in_bq_done (seq INTEGER PRIMARY KEY, date TEXT NOT NULL, trainer TEXT NOT NULL, effectiveness REAL);

CREATE TABLE IF NOT EXISTS in_departments (seq INTEGER PRIMARY KEY, department TEXT NOT NULL, sub_team TEXT NOT NULL DEFAULT '');
-- Candidates the previous Trainer Desk assigned (from its WhatsApp Log tab): they count as claimed here too.
CREATE TABLE IF NOT EXISTS in_prior_claims (emp_id TEXT PRIMARY KEY, trainer TEXT NOT NULL DEFAULT '', claimed_on TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS in_trainer_templates (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', template TEXT NOT NULL DEFAULT '');

-- Dumps book: OJT targets (kept as the sheet grid; its layout carries values down), talktime and dump rows.
CREATE TABLE IF NOT EXISTS in_grids (name TEXT PRIMARY KEY, grid TEXT NOT NULL, display TEXT);
CREATE TABLE IF NOT EXISTS in_talktime (emp_id TEXT NOT NULL, date TEXT NOT NULL, secs INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS in_talktime_emp ON in_talktime (emp_id, date);
CREATE TABLE IF NOT EXISTS in_dump_rows (source TEXT NOT NULL, date TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', value REAL, lead TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS in_dump_rows_src ON in_dump_rows (source, email);

-- Which inputs loaded, when, and how many rows.
CREATE TABLE IF NOT EXISTS sync_status (name TEXT PRIMARY KEY, rows INTEGER, loaded_on TEXT, error TEXT);

/* ================================================================== */
/* Owned by Trainer Desk                                              */
/* ================================================================== */

-- Everyone claimed through Trainer Desk. Batches, Attendance, Active NHT Details, OJT Performance and Approvals
-- only show these people; the rest of Master Dashboard is used only by the Performance Dashboards.
CREATE TABLE IF NOT EXISTS claims (
  emp_id TEXT PRIMARY KEY, trainer TEXT NOT NULL, claimed_by TEXT NOT NULL, claimed_on TEXT NOT NULL, training_start TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS excluded_candidates (
  emp_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '', doj TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL, removed_by TEXT NOT NULL, removed_on TEXT NOT NULL
);

-- Attendance: one row per trainee and day.
CREATE TABLE IF NOT EXISTS attendance (
  emp_id TEXT NOT NULL, date TEXT NOT NULL, code TEXT NOT NULL,
  trainer TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', doj TEXT NOT NULL DEFAULT '',
  marked_by TEXT NOT NULL, marked_on TEXT NOT NULL,
  PRIMARY KEY (emp_id, date)
);
CREATE TABLE IF NOT EXISTS attendance_log (
  id INTEGER PRIMARY KEY, changed_on TEXT NOT NULL, changed_by TEXT NOT NULL, trainer TEXT NOT NULL,
  emp_id TEXT NOT NULL, date TEXT NOT NULL, old_code TEXT NOT NULL, new_code TEXT NOT NULL
);

-- Every change a trainer or admin makes in Active NHT Details, OJT Performance or (for a saved mark) Attendance.
CREATE TABLE IF NOT EXISTS change_requests (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  requested_on TEXT NOT NULL, requested_by TEXT NOT NULL, trainer TEXT NOT NULL,
  emp_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', field TEXT NOT NULL,
  old_text TEXT NOT NULL DEFAULT '', new_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Superseded')),
  reviewed_by TEXT NOT NULL DEFAULT '', reviewed_on TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS change_requests_emp ON change_requests (emp_id, field, status);
CREATE INDEX IF NOT EXISTS change_requests_status ON change_requests (status);

CREATE TABLE IF NOT EXISTS mock_scores (
  id INTEGER PRIMARY KEY,
  emp_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', trainer TEXT NOT NULL,
  mock_date TEXT NOT NULL, attempt TEXT NOT NULL, score REAL, status TEXT NOT NULL,
  final INTEGER NOT NULL DEFAULT 0, entered_by TEXT NOT NULL DEFAULT '', approved_by TEXT NOT NULL DEFAULT '', approved_on TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS mock_scores_emp ON mock_scores (emp_id);

CREATE TABLE IF NOT EXISTS nht_status (
  emp_id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', trainer TEXT NOT NULL DEFAULT '',
  ojt_entered TEXT NOT NULL DEFAULT '', ojt_eligible TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '', updated_on TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ojt_team (
  emp_id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', trainer TEXT NOT NULL DEFAULT '',
  team TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '', updated_on TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ojt_manual_inputs (
  emp_id TEXT NOT NULL, metric TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', trainer TEXT NOT NULL DEFAULT '',
  achieved REAL NOT NULL, updated_by TEXT NOT NULL DEFAULT '', updated_on TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (emp_id, metric)
);

-- Built by the OJT refresh (admins, and every morning).
CREATE TABLE IF NOT EXISTS ojt_dashboard (
  seq INTEGER PRIMARY KEY,
  emp_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', trainer TEXT NOT NULL DEFAULT '', work_mode TEXT NOT NULL DEFAULT '',
  doj TEXT NOT NULL DEFAULT '', training_end TEXT NOT NULL DEFAULT '', ojt_start TEXT NOT NULL DEFAULT '', ojt_end TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '', ojt_day INTEGER NOT NULL DEFAULT 0, talk_days INTEGER NOT NULL DEFAULT 0, talk_hours REAL NOT NULL DEFAULT 0,
  last_talk TEXT NOT NULL DEFAULT '', updated_on TEXT NOT NULL DEFAULT '',
  team TEXT NOT NULL DEFAULT '', team_set INTEGER NOT NULL DEFAULT 0, achievement REAL, score REAL,
  result TEXT NOT NULL DEFAULT '', pass_rule TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ojt_dashboard_trainer ON ojt_dashboard (trainer);
CREATE INDEX IF NOT EXISTS ojt_dashboard_emp ON ojt_dashboard (emp_id);

CREATE TABLE IF NOT EXISTS ojt_performance (
  seq INTEGER PRIMARY KEY,
  emp_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', trainer TEXT NOT NULL DEFAULT '', team TEXT NOT NULL DEFAULT '',
  metric TEXT NOT NULL, type TEXT NOT NULL DEFAULT '', weight REAL, kind TEXT NOT NULL DEFAULT '',
  target REAL, achieved REAL, pct REAL, score REAL, date_from TEXT NOT NULL DEFAULT '', date_to TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '', weeks TEXT NOT NULL DEFAULT '[]'      -- [{ target, achieved }] x 4
);
CREATE INDEX IF NOT EXISTS ojt_performance_emp ON ojt_performance (emp_id);

CREATE TABLE IF NOT EXISTS whatsapp_log (
  id INTEGER PRIMARY KEY, sent_on TEXT NOT NULL, trainer TEXT NOT NULL, emp_id TEXT NOT NULL, candidate TEXT NOT NULL DEFAULT '',
  candidate_phone TEXT NOT NULL DEFAULT '', sent_to TEXT NOT NULL DEFAULT '', template TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL, detail TEXT NOT NULL DEFAULT ''
);

/* ================================================================== */
/* Work waiting to go out: Master Dashboard writes and e-mails        */
/* ================================================================== */
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('master_append', 'master_set', 'mail')),
  payload TEXT NOT NULL,
  created_on TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_try TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting', 'done', 'failed')),
  done_on TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS outbox_state ON outbox (state, id);

-- App tabs changed since they were last copied back to the tracker.
CREATE TABLE IF NOT EXISTS mirror_dirty (tab TEXT PRIMARY KEY, since TEXT NOT NULL);
-- Rows Trainer Desk has written into each tracker tab (so it only ever changes or removes its own rows).
CREATE TABLE IF NOT EXISTS mirror_rows (tab TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (tab, key));
