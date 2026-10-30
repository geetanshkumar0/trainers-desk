'use strict';
/*
 * Pick Timer (KC slot booking, PIA close-out, score sheet, analytics) running inside Trainer Desk at /pick-timer/.
 *
 * - Sign-in is Trainer Desk's Google sign-in: Trainer Desk passes the signed-in e-mail, so there is no second login.
 * - Admins and roles are Pick Timer's own, separate from Trainer Desk's: the built-in admins in site-admins.js
 *   (and PICK_TIMER_ADMINS), plus the people an admin adds under Site administration > Users with their role.
 *   Being a Trainer Desk admin or trainer gives no access here.
 * - The business rules are public/core.js (shared with the browser).
 * - Data: its own SQLite file (pick-timer.db) in Trainer Desk's data folder. Email goes out through its own SMTP
 *   settings. Scores are read from PIA's score sheet, through Trainer Desk's Google account (or an Apps Script link).
 *   Nothing is written to Google.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Core = require('../public/core.js');
const {Store} = require('./store.js');
const {sendMail} = require('./mailer.js');
const {fetchSheet} = require('./sheet.js');

const PUBLIC = path.join(__dirname, '..', 'public');
const STATIC = {'': 'index.html', 'index.html': 'index.html', 'app.css': 'app.css', 'app.js': 'app.js', 'core.js': 'core.js'};
const TYPES = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8'};

/**
 * opts: { dataDir, demo, readSheet(sheetId, tab) -> { headers, rows }, sheetsAccount() -> e-mail, defaultSheet: { sheetId, tab }, log }
 * Returns { handle(req, res, sub, who), hasAccess(who), start(), stop(), deliverMail(), syncSheet(), backup(file), state() }
 *   who: { email } of the person Trainer Desk signed in.
 */
function createPickTimer(opts) {
  const log = opts.log || ((...a) => console.log(new Date().toISOString(), '[pick-timer]', ...a));
  const store = new Store(opts.dataDir, 'pick-timer.db');
  const fresh = store.isEmpty();
  let S = fresh ? Core.newState() : store.load();
  const env = {
    now: () => Date.now(),
    uid: p => p + crypto.randomBytes(6).toString('hex'),
    fetchSheet: cfg => cfg.sheetId ? readGoogleSheet(cfg) : (opts.demo && !cfg.url) ? Promise.resolve(Core.demoSheet(S, Date.now())) : fetchSheet(cfg),
    sendTestEmail: (cfg, to) => sendMail(cfg, {to, subject: `Test email from ${S.settings.name}`, body: 'Email from Pick Timer is working.', html: '<p>Email from <b>Pick Timer</b> is working.</p>'})
  };
  const ADMINS = [...new Set([...require('./site-admins.js'), ...String(process.env.PICK_TIMER_ADMINS || '').split(',')]
    .map(e => String(e).trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
  if (fresh) S.settings.name = 'Pick Timer';
  if (fresh && opts.demo) Core.seedDemo(S, env, ADMINS[0]);
  // PIA's score sheet, read through Trainer Desk's Google account, unless an admin has linked something else.
  if (opts.defaultSheet && !S.settings.sheet.sheetId && !S.settings.sheet.url && !opts.demo) Object.assign(S.settings.sheet, opts.defaultSheet);

  /* Pick Timer's own built-in admins (their role and access cannot be changed in Pick Timer). */
  function syncAdmins() {
    const emails = ADMINS;
    for (const u of S.users) {
      // Earlier, Trainer Desk admins and trainers were let in automatically. Pick Timer's people are now its own.
      if (u.builtin && !emails.includes(u.email)) { delete u.builtin; u.active = false; }
      if (u.addedBy === 'Trainer Desk') { delete u.addedBy; u.active = false; }
    }
    for (const email of emails) {
      let u = S.users.find(x => x.email === email);
      if (!u) { u = {id: env.uid('u'), name: email.split('@')[0].split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' '), email, createdAt: Date.now()}; S.users.push(u); }
      Object.assign(u, {role: 'admin', active: true, builtin: true});
      delete u.pwhash; delete u.mustChangePassword;
    }
  }
  syncAdmins();
  store.save(S);

  /* Operations run one at a time, so seat counts can never race. */
  let chain = Promise.resolve();
  const serial = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  const mutate = fn => serial(async () => { try { return await fn(); } finally { store.save(S); } });

  /** The Pick Timer user for the signed-in person: only people in Pick Timer's own user list. */
  function userFor(who) {
    const email = String(who && who.email || '').toLowerCase();
    const u = email && S.users.find(x => x.email === email);
    return u && u.active !== false ? u : null;
  }
  const hasAccess = who => !!userFor(who);

  /** PIA's score sheet through Trainer Desk's Google account, in the same shape as the Apps Script returns. */
  async function readGoogleSheet(cfg) {
    if (!opts.readSheet) throw Object.assign(new Error('Reading Google Sheets is not available here. Use the Apps Script link instead.'), {status: 409});
    let data;
    try { data = await opts.readSheet(cfg.sheetId, cfg.tab); }
    catch (e) {
      const who = opts.sheetsAccount ? opts.sheetsAccount() : '';
      if (e.status === 403 || e.status === 404) throw Object.assign(new Error(`Could not open the score sheet. Share it (view access is enough) with ${who || 'the Google account Trainer Desk uses for its sheets'}.`), {status: 502});
      if (e.status === 400) throw Object.assign(new Error(`The score sheet has no tab named "${cfg.tab}".`), {status: 502});
      throw Object.assign(new Error('Could not read the score sheet: ' + e.message), {status: 502});
    }
    return {ok: true, sheet: cfg.tab, headers: data.headers, rows: data.rows};
  }

  function send(res, status, body, headers) {
    const raw = Buffer.isBuffer(body) || typeof body === 'string';
    res.writeHead(status, Object.assign({'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store'},
      raw ? {} : {'Content-Type': 'application/json; charset=utf-8'}, headers || {}));
    res.end(raw ? body : JSON.stringify(body));
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let n = 0; const chunks = [];
      req.on('data', c => { n += c.length; if (n > 2e6) { reject(Object.assign(new Error('Request too large.'), {status: 413})); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(Object.assign(new Error('Invalid request.'), {status: 400})); } });
      req.on('error', reject);
    });
  }

  /** sub: the path after /pick-timer/ ('' for the page). who: the signed-in Trainer Desk user. */
  async function handle(req, res, sub, who) {
    try {
      if (req.method === 'GET' && Object.prototype.hasOwnProperty.call(STATIC, sub)) {
        const f = path.join(PUBLIC, STATIC[sub]);
        return send(res, 200, fs.readFileSync(f), {'Content-Type': TYPES[path.extname(f)], 'Cache-Control': 'no-cache'});
      }
      if (req.method === 'GET' && sub === 'apps-script.gs') return send(res, 200, fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs')), {'Content-Type': 'text/plain; charset=utf-8'});
      if (!sub.startsWith('api/')) return send(res, 404, 'Not found', {'Content-Type': 'text/plain'});
      if (req.method === 'POST' && req.headers['x-requested-with'] !== 'kc') return send(res, 403, {error: 'Missing request header.'});

      if (req.method === 'GET' && sub === 'api/boot') {
        const me = userFor(who);
        if (me) { if (!me.lastLogin || Date.now() - me.lastLogin > 3600e3) await mutate(() => { me.lastLogin = Date.now(); }); return send(res, 200, {view: Core.view(S, me.id, Date.now())}); }
        return send(res, 200, {noAccess: true, email: who.email, site: S.settings.name});
      }
      if (req.method === 'POST' && sub === 'api/op') {
        const me = userFor(who);
        if (!me) return send(res, 403, {error: `${who.email} does not have access to ${S.settings.name}. Ask an administrator to add you.`});
        const b = await readBody(req);
        if (b.op === 'saveSettings' && b.params && b.params.section === 'sso') return send(res, 400, {error: 'Sign-in is handled by Trainer Desk.'});
        const result = await mutate(() => Core.run(S, env, me.id, String(b.op || ''), b.params || {}));
        return send(res, 200, {result, view: Core.view(S, me.id, Date.now())});
      }
      return send(res, 404, {error: 'Not found.'});
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500 && !e.status) log('error', e.stack || e.message);
      if (!res.headersSent) send(res, status, {error: status >= 500 && !e.status ? 'Something went wrong on the server.' : e.message});
    }
  }

  /* ---------- background: email delivery (30 s) and score sheet sync (15 min) ---------- */
  let mailing = false;
  async function deliverMail() {
    if (mailing || !S.settings.smtp.enabled || !S.settings.smtp.host) return;
    mailing = true;
    try {
      for (const m of S.emailLog.filter(x => x.status === 'queued').slice(0, 25)) {
        if (Date.now() - m.at > 3 * 864e5) { await mutate(() => { m.status = 'not sent'; m.error = 'Queued for more than 3 days before email was turned on.'; }); continue; }
        try { await sendMail(S.settings.smtp, {to: m.to, subject: m.subject, body: m.text, html: m.html}); await mutate(() => { m.status = 'sent'; m.sentAt = Date.now(); m.error = ''; }); }
        catch (e) { await mutate(() => { m.tries = (m.tries || 0) + 1; m.error = e.message; if (m.tries >= 3) m.status = 'failed'; }); }
      }
    } finally { mailing = false; }
  }
  async function syncSheet() {
    if (!S.settings.sheet.url && !S.settings.sheet.sheetId && !opts.demo) return;
    try { const data = await env.fetchSheet(S.settings.sheet); await mutate(() => Core.applySheet(S, env, null, data)); }
    catch (e) { await mutate(() => { S.syncLog.push({id: env.uid('sy'), at: Date.now(), by: null, rows: 0, added: 0, updated: 0, removed: 0, unchanged: 0, skipped: [], error: e.message}); }); }
  }
  const timers = [];
  function start() {
    timers.push(setInterval(() => deliverMail().catch(e => log('mail', e.message)), 30e3));
    timers.push(setInterval(() => syncSheet().catch(e => log('sync', e.message)), 15 * 60e3));
    timers.forEach(t => t.unref && t.unref());
  }
  function stop() { timers.splice(0).forEach(clearInterval); }
  /** A consistent copy of the database (for Trainer Desk's nightly backup). */
  function backup(file) { store.backup(file); }

  return {handle, hasAccess, start, stop, deliverMail, syncSheet, backup, state: () => S, close: () => store.close()};
}

module.exports = {createPickTimer};
