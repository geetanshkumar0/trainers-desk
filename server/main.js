/**
 * Trainer Desk server. Node.js 22.13+ (built-in SQLite), no dependencies.
 *   /                    the page (public/index.html)
 *   /api/...             the REST API (routes.js)
 *   /auth/*              Google sign-in, company accounts only
 *   /admin/connect       connects the Google account that reads and writes the sheets (setup admins, once)
 *   /admin/status        sync, outbox and mirror status (setup admins)
 *   /pick-timer/         Pick Timer: KC slot booking and PIA close-out (pick-timer/), same sign-in
 *   /healthz             liveness
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { CONFIG, SERVER } from './config.js';
import * as db from './db.js';
import * as G from './google.js';
import * as auth from './auth.js';
import * as sync from './sync.js';
import * as outbox from './outbox.js';
import * as mirror from './mirror.js';
import * as ojt from './services/ojt.js';
import { MODE as WA_MODE } from './services/whatsapp.js';
import routes, { setPickTimerAccess } from './routes.js';
import { readScoreSheet } from './scoresheet.js';
import { isoDay } from './dates.js';
import { send, json, redirect, html, esc, serveStatic } from './web.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, '..', 'public');
const BASE = SERVER.base;
const log = (...a) => console.log(new Date().toISOString(), ...a);
const { createPickTimer } = createRequire(import.meta.url)('../pick-timer/server/mount.js');
let pickTimer = null;

// Pick Timer has its own admins and roles: Trainer Desk only tells it who signed in.
const pickTimerUser = email => ({ email });


function page(title, body) {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) +
    ' · Trainer Desk</title><style>body{font-family:system-ui,sans-serif;background:#0b1020;color:#e7ecf7;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}' +
    'main{max-width:460px;padding:32px;border-radius:18px;background:#141a30;box-shadow:0 20px 60px #0008}a{color:#8fb4ff}h1{font-size:22px;margin:0 0 12px}</style></head><body><main><h1>' +
    esc(title) + '</h1>' + body + '</main></body></html>';
}

function status() {
  const s = sync.syncState;
  return {
    database: SERVER.dbFile, demo: SERVER.demo, sheetsAccount: G.sheetsAccount(), sheetsConnected: G.sheetsConnected(),
    sync: { lastOk: s.lastOk, lastError: s.lastError, lastMs: s.lastMs, inputs: db.all('SELECT * FROM sync_status ORDER BY name') },
    outbox: outbox.status(),
    mirror: { on: SERVER.mirror, waiting: db.all('SELECT tab, since FROM mirror_dirty') },
    ojtRefreshed: db.getMeta('ojt_refreshed', null), claimed: db.get('SELECT COUNT(*) n FROM claims').n, claimedBefore: db.get('SELECT COUNT(*) n FROM in_prior_claims').n,
    whatsapp: WA_MODE, mail: { configured: G.mailConfigured(), to: SERVER.mailTo || null, override: SERVER.mailOverride || null }
  };
}

async function handle(req, res) {
  const url = new URL(req.url, SERVER.origin);
  const p = url.pathname;
  if (BASE && p === BASE) return redirect(res, BASE + '/');
  if (!p.startsWith(BASE + '/')) return send(res, 404, 'Not found');
  const sub = p.slice(BASE.length);

  if (sub === '/healthz') return json(res, 200, { ok: !!db.get('SELECT 1 FROM sync_status WHERE name = ?', CONFIG.MASTER_SHEET) });

  /* ---- sign-in ---- */
  if (sub === '/auth/login') return redirect(res, SERVER.demo ? BASE + '/' : auth.authUrl('login', url.searchParams.get('next')));
  if (sub === '/auth/logout') return redirect(res, BASE + '/auth/login', { 'Set-Cookie': auth.clearCookie() });
  if (sub === '/auth/callback') {
    try {
      const done = await auth.finish(url);
      if (done.kind === 'connect') {
        const me = auth.userOf(req);
        if (!SERVER.setupAdmins.includes(me)) return html(res, 403, page('Not allowed', '<p>Only setup admins can connect the sheets account.</p>'));
        if (!done.refreshToken) return html(res, 400, page('Try again', '<p>Google did not return a long-lived token. <a href="' + BASE + '/admin/connect">Connect again</a>.</p>'));
        G.saveSheetsToken(done.refreshToken, done.email, 'google');
        log('sheets account connected:', done.email, 'by', me);
        sync.syncTracker('account connected').catch(() => null);
        return html(res, 200, page('Connected', '<p>The sheets are now read and saved as <b>' + esc(done.email) + '</b>.</p><p><a href="' + BASE + '/admin/status">Status</a> · <a href="' + BASE + '/">Open Trainer Desk</a></p>'));
      }
      log('sign-in:', done.email);
      return redirect(res, done.next, { 'Set-Cookie': auth.sessionCookie(done.email) });
    } catch (e) {
      if (e.forbidden) return html(res, 403, page('Not allowed', '<p>' + esc(e.message) + '</p>'));
      // A reloaded sign-in link: Google's one-time code is already spent. Carry on if already signed in.
      log('sign-in callback failed:', e.message);
      return redirect(res, auth.userOf(req) ? BASE + '/' : BASE + '/auth/login');
    }
  }

  /* ---- static files ---- */
  if (/^\/(css|js|vendor)\//.test(sub) || sub === '/favicon.svg') {
    return serveStatic(res, PUBLIC, sub, 3600) || send(res, 404, 'Not found');
  }

  const user = auth.userOf(req);

  /* ---- Pick Timer ---- */
  if (sub === '/pick-timer') return redirect(res, BASE + '/pick-timer/');
  if (sub.startsWith('/pick-timer/')) {
    if (!user) return sub === '/pick-timer/' ? redirect(res, BASE + '/auth/login?next=' + encodeURIComponent(BASE + '/pick-timer/')) : json(res, 401, { error: 'Please sign in again.' });
    return pickTimer.handle(req, res, sub.slice('/pick-timer/'.length), pickTimerUser(user));
  }

  /* ---- API ---- */
  if (sub.startsWith('/api/')) {
    if (!user) return json(res, 401, { error: 'Please sign in again.', login: true });
    if (req.method === 'POST' && !/^application\/json/.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Send JSON.' });
    const m = routes.match(req.method, sub);
    if (!m) return json(res, 404, { error: 'Unknown address ' + sub });
    if (m.wrongMethod) return json(res, 405, { error: 'Method not allowed' });
    const t0 = Date.now();
    try {
      const out = await m.handler({ req, res, params: m.params, query: url.searchParams, user });
      log('[api]', user, req.method, sub, (Date.now() - t0) + 'ms');
      return json(res, 200, out);
    } catch (e) {
      const code = e.status || (e instanceof TypeError || e instanceof ReferenceError ? 500 : 400);
      log('[api]', user, req.method, sub, 'ERROR', code, code === 500 ? e.stack : e.message);
      return json(res, code, { error: code === 500 ? 'Something went wrong on the server.' : e.message });
    }
  }

  /* ---- admin ---- */
  if (sub === '/admin/connect' || sub === '/admin/status' || sub === '/admin/sync') {
    if (!user) return redirect(res, BASE + '/auth/login?next=' + encodeURIComponent(p));
    if (!SERVER.setupAdmins.includes(user) && !SERVER.demo) return html(res, 403, page('Not allowed', '<p>Only setup admins can open this page.</p>'));
    if (sub === '/admin/connect') return redirect(res, auth.authUrl('connect', BASE + '/admin/status', SERVER.sheetsAccountHint));
    if (sub === '/admin/sync') { await sync.syncTracker('admin').catch(() => null); await mirror.mirrorNow().catch(() => null); return redirect(res, BASE + '/admin/status'); }
    return json(res, 200, status());
  }

  /* ---- the page ---- */
  if (sub === '/' || sub === '/index.html') {
    if (!user) return redirect(res, BASE + '/auth/login');
    let page = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    if (SERVER.demo) page = page.replace('<html lang="en">', '<html lang="en" data-preview>');
    return html(res, 200, page);
  }
  return send(res, 404, 'Not found');
}

/** A copy of the database every night (and at start if today's is missing); the last 14 are kept in DATA_DIR/backups. */
function startBackups() {
  const dir = path.join(SERVER.dataDir, 'backups');
  const run = () => {
    const day = isoDay(), file = path.join(dir, 'trainer-desk-' + day + '.db');
    if (fs.existsSync(file)) return;
    try {
      db.backup(file);
      if (pickTimer) pickTimer.backup(path.join(dir, 'pick-timer-' + day + '.db'));
      fs.readdirSync(dir).filter(f => /^(trainer-desk|pick-timer)-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort((a, b) => a.slice(-13).localeCompare(b.slice(-13)))
        .slice(0, -28).forEach(f => fs.unlinkSync(path.join(dir, f)));   // 14 days of both
      log('[backup] saved', file);
    } catch (e) { log('[backup] failed:', e.message); }
  };
  run();
  return setInterval(run, 3600000);
}

export function startServer() {
  db.open(SERVER.dbFile);
  pickTimer = createPickTimer({ dataDir: SERVER.dataDir, demo: SERVER.demo, readSheet: readScoreSheet, sheetsAccount: () => G.sheetsAccount(), defaultSheet: CONFIG.PICK_TIMER_SHEET });
  setPickTimerAccess(email => pickTimer.hasAccess(pickTimerUser(email)));
  pickTimer.start();
  if (G.adoptOldTokenFile(path.join(SERVER.dataDir, 'sheets_token.json'))) log('sheets token brought over from sheets_token.json');
  const server = http.createServer((req, res) => {
    handle(req, res).catch(e => { log('ERROR', req.url, e.stack || e.message); if (!res.headersSent) send(res, 500, 'Server error'); });
  });
  server.listen(SERVER.port, () => log('Trainer Desk on :' + SERVER.port + ' at ' + SERVER.origin + BASE + '/' + (SERVER.demo ? ' (local preview, made-up data)' : '')));
  outbox.start();
  if (!SERVER.demo) {
    // Trainer Desk starts with only its own data: nothing is imported from the old app tabs.
    sync.start(SERVER.refreshSeconds).then(() => {
      try { ojt.buildOjtDashboard(); } catch (e) { log('[ojt] rebuild at start failed:', e.message); }   // from the data already here
      mirror.start();
    });
    ojt.startDaily();
    startBackups();
  }
  const stop = () => { log('stopping'); server.close(); sync.stop(); outbox.stop(); mirror.stop(); pickTimer.stop(); pickTimer.close(); db.close(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
