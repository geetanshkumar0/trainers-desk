/**
 * Local preview: the real server and page on made-up data. No Google, no WhatsApp, no sign-in.
 *   npm run preview      ->  http://localhost:5177
 * You are signed in as DEMO_USER (default priya.nair@nobroker.in, a manager and admin in the made-up data).
 * The database is a fresh file in preview/.data every run, so saves last until you stop it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(HERE, '.data');
fs.rmSync(dir, { recursive: true, force: true });
Object.assign(process.env, {
  DEMO: '1', PORT: process.env.PORT || '5177', DATA_DIR: dir, BASE_PATH: '',
  DESK_EXTRA_ADMINS: 'priya.nair@nobroker.in', DEMO_USER: process.env.DEMO_USER || 'priya.nair@nobroker.in'
});
process.env.PUBLIC_ORIGIN = 'http://localhost:' + process.env.PORT;

const { SERVER } = await import('../server/config.js');
const db = await import('../server/db.js');
const sync = await import('../server/sync.js');
const seed = await import('../server/seed.js');
const ojt = await import('../server/services/ojt.js');
const { today } = await import('../server/dates.js');
const fake = await import('./fake-data.js');

db.open(SERVER.dbFile);
const data = fake.build(today());
sync.ingestTracker(data.tracker, 'en_US', new Date().toISOString());
sync.ingestTargets(data.targets.values, data.targets.display);
sync.ingestDumps(data.talk, {}, 'en_US');
// Made-up history so every screen has something to show: these trainees count as claimed in Trainer Desk.
seed.importGrids(data.appTabs, 'en_US');
db.run(`INSERT OR IGNORE INTO nht_status (emp_id, name, trainer, ojt_entered, ojt_eligible, updated_by, updated_on)
  SELECT emp_id, name, trainer, 'Yes', 'Yes', entered_by, approved_on FROM mock_scores WHERE final = 1 AND status = 'Pass'`);
db.all('SELECT emp_id, trainer, training_start FROM in_master').forEach(r => db.run(
  'INSERT OR IGNORE INTO claims (emp_id, trainer, claimed_by, claimed_on, training_start) VALUES (?, ?, ?, ?, ?)', r.emp_id, r.trainer, r.trainer, new Date().toISOString(), r.training_start));
ojt.buildOjtDashboard([]);
db.close();

const { startServer } = await import('../server/main.js');
startServer();
