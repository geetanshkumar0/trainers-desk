/**
 * Google APIs: Sheets (read + write, as the connected "sheets account") and Gmail (approval e-mails).
 * The sheets account is connected once through /admin/connect; its refresh token is kept in the database.
 */
import fs from 'node:fs';
import { SERVER } from './config.js';
import * as db from './db.js';

const cache = {};   // kind -> { token, exp }

export async function postForm(url, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Google token error: ' + (j.error_description || j.error || r.status));
  return j;
}

export function sheetsAccount() { return (db.getMeta('sheets_token', null) || {}).email || ''; }
export function sheetsConnected() { return !!(db.getMeta('sheets_token', null) || {}).refresh_token; }
/** client: 'google' when connected through /admin/connect, 'sheets' for a token made with SHEETS_CLIENT_ID. */
export function saveSheetsToken(refreshToken, email, client) {
  db.setMeta('sheets_token', { refresh_token: refreshToken, email, client: client || 'google', saved: new Date().toISOString() });
  delete cache.sheets;
}
/** Brings over the token file the previous version kept in DATA_DIR (once). */
export function adoptOldTokenFile(file) {
  if (sheetsConnected() || !fs.existsSync(file)) return false;
  const t = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!t.refresh_token) return false;
  saveSheetsToken(t.refresh_token, t.email || '', 'sheets');
  return true;
}
export function mailConfigured() { return !!SERVER.botTokenFile && fs.existsSync(SERVER.botTokenFile); }

async function accessToken(kind) {
  const c = cache[kind];
  if (c && c.exp > Date.now() + 60000) return c.token;
  let params;
  if (kind === 'sheets') {
    const t = db.getMeta('sheets_token', null);
    if (!t || !t.refresh_token) throw new Error('The Google account for the sheets is not connected. A setup admin can connect it at /admin/connect.');
    const own = t.client === 'sheets' ? [SERVER.sheetsClientId, SERVER.sheetsClientSecret] : [SERVER.googleClientId, SERVER.googleClientSecret];
    params = { client_id: own[0], client_secret: own[1], refresh_token: t.refresh_token, grant_type: 'refresh_token' };
  } else {
    const t = JSON.parse(fs.readFileSync(SERVER.botTokenFile, 'utf8'));
    params = { client_id: t.client_id, client_secret: t.client_secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' };
  }
  const j = await postForm('https://oauth2.googleapis.com/token', params);
  cache[kind] = { token: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 };
  return j.access_token;
}

async function gapi(kind, url, opts = {}) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers: Object.assign({ Authorization: 'Bearer ' + await accessToken(kind) }, opts.body ? { 'Content-Type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if ((r.status === 429 || r.status >= 500) && attempt < 3) { await new Promise(res => setTimeout(res, 2000 * (attempt + 1))); continue; }
    const body = await r.text();
    let j; try { j = JSON.parse(body); } catch (e) { j = { raw: body }; }
    if (!r.ok) {
      const err = new Error('Google API ' + r.status + ': ' + ((j.error && (j.error.message || j.error)) || body.slice(0, 200)));
      err.status = r.status;
      throw err;
    }
    return j;
  }
}

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';
const q = t => "'" + String(t).replace(/'/g, "''") + "'";

/** Title, time zone, locale and every tab (id, title, grid size). */
export function sheetsMeta(id) {
  return gapi('sheets', SHEETS + id + '?fields=properties(title,timeZone,locale),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))');
}

/** Values of ranges (a tab name = the whole tab). render: UNFORMATTED_VALUE (dates as text) or FORMATTED_VALUE. */
export async function sheetsValues(id, ranges, render) {
  if (!ranges.length) return [];
  const query = ranges.map(t => 'ranges=' + encodeURIComponent(/!/.test(t) || /^'.*'$/.test(t) ? t : q(t))).join('&');
  const j = await gapi('sheets', SHEETS + id + '/values:batchGet?' + query +
    '&majorDimension=ROWS&valueRenderOption=' + (render || 'UNFORMATTED_VALUE') + '&dateTimeRenderOption=FORMATTED_STRING');
  return (j.valueRanges || []).map(v => v.values || []);
}

/** Writes cells. data: [{ range: "'Tab'!A1", values: [[...]] }]. Text is read as if typed (dates become dates). */
export function sheetsWrite(id, data) {
  return gapi('sheets', SHEETS + id + '/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'USER_ENTERED', data } });
}

export function sheetsClear(id, ranges) {
  return gapi('sheets', SHEETS + id + '/values:batchClear', { method: 'POST', body: { ranges } });
}

export function sheetsBatchUpdate(id, requests) {
  return gapi('sheets', SHEETS + id + ':batchUpdate', { method: 'POST', body: { requests } });
}

export const quoteTab = q;

/** Sends an HTML e-mail from the bot account. */
export async function sendMail(to, subject, html) {
  const enc = s => '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
  const mime = ['To: ' + to, 'Subject: ' + enc(subject), 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', html].join('\r\n');
  const raw = Buffer.from(mime, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return gapi('bot', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', body: { raw } });
}
