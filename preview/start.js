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
const mirror = await import('../server/mirror.js');
const ojt = await import('../server/services/ojt.js');
const { today } = await import('../server/dates.js');
const fake = await import('./fake-data.js');

db.open(SERVER.dbFile);
const data = fake.build(today());
sync.ingestTracker(data.tracker, 'en_US', new Date().toISOString());
sync.ingestTargets(data.targets.values, data.targets.display);
sync.ingestDumps(data.talk, {}, 'en_US');
mirror.importGrids(data.appTabs, 'en_US');          // same path the live server uses for the old tabs
ojt.buildOjtDashboard([]);
db.close();

const { startServer } = await import('../server/main.js');
startServer();
