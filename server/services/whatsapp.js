/**
 * WhatsApp message to each candidate a trainer claims (Meta WhatsApp Cloud API).
 *   WA_MODE=off   only logs what would be sent
 *   WA_MODE=test  sends, but always to WA_TEST_TO (never to the candidate)
 *   WA_MODE=live  sends to the candidate's number
 * Template body ({{1}}..{{4}}): candidate first name, trainer name, training start date, trainer phone.
 */
import * as db from '../db.js';
import * as data from '../data.js';
import { prettyName } from '../logic/common.js';

const env = process.env;
export const MODE = (env.WA_MODE || 'off').toLowerCase();
const TEST_TO = env.WA_TEST_TO || '', PHONE_ID = env.WA_PHONE_NUMBER_ID || '', TOKEN = env.WHATSAPP_ACCESS_TOKEN || '';
const API = env.WA_API_VERSION || 'v25.0', DEFAULT_TEMPLATE = env.WA_TEMPLATE || 'nht_trainer_assigned', LANG = env.WA_LANG || 'en';
const log = (...a) => console.log(new Date().toISOString(), '[whatsapp]', ...a);

/** 10-digit Indian mobile -> 91XXXXXXXXXX; '' when it does not look like one. */
export function normalisePhone(v) {
  let s = String(v == null ? '' : v).replace(/\.0$/, '').replace(/\D/g, '');
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2);
  if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
  return /^[6-9]\d{9}$/.test(s) ? '91' + s : '';
}

function niceDate(iso) {
  if (!iso) return 'to be confirmed';
  const p = iso.split('-'), m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1];
  const d = +p[2], suf = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th';
  return d + suf + ' ' + m + ' ' + p[0];
}

/** Sends one template message. Returns { status: sent | logged | failed | skipped, to, template, id, error, note }. */
export async function send(msg) {
  const real = normalisePhone(msg.phone);
  const to = MODE === 'test' ? normalisePhone(TEST_TO) : real;
  const template = msg.template || DEFAULT_TEMPLATE;
  if (MODE === 'off') return { status: 'logged', to: '', template, note: 'WA_MODE=off' };
  if (MODE === 'live' && !real) return { status: 'skipped', to: '', template, error: 'No valid mobile number for the candidate' };
  if (!to) return { status: 'skipped', to: '', template, error: 'No test number set' };
  if (!PHONE_ID || !TOKEN) return { status: 'failed', to, template, error: 'WhatsApp is not configured on the server' };
  if ((msg.params || []).some(p => !String(p || '').trim())) return { status: 'skipped', to, template, error: 'A template value is empty: ' + JSON.stringify(msg.params) };
  const body = { messaging_product: 'whatsapp', to, type: 'template',
    template: { name: template, language: { code: LANG }, components: [{ type: 'body', parameters: msg.params.map(p => ({ type: 'text', text: String(p) })) }] } };
  try {
    const r = await fetch('https://graph.facebook.com/' + API + '/' + PHONE_ID + '/messages', {
      method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { status: 'failed', to, template, error: (j.error && (j.error.error_user_msg || j.error.message)) || ('HTTP ' + r.status) };
    return { status: 'sent', to, template, id: j.messages && j.messages[0] && j.messages[0].id };
  } catch (e) {
    return { status: 'failed', to, template, error: e.message };
  }
}

/** After a claim: one message per assigned candidate, each logged in whatsapp_log. Never throws. */
export async function afterClaim(result, trainingStart) {
  try {
    if (!result || !result.assigned || !result.assigned.length) return;
    const org = data.org(), t = result.trainer;
    const tpl = db.get('SELECT * FROM in_trainer_templates WHERE email = ?', t) || {};
    const trainer = { name: tpl.name || org.names[t] || prettyName(t), phone: tpl.phone || '', template: tpl.template || '' };
    for (const id of result.assigned) {
      const c = db.get('SELECT name, phone FROM in_hr WHERE emp_id = ? ORDER BY seq LIMIT 1', id) || { name: '', phone: '' };
      const first = String(c.name || '').trim().split(/\s+/)[0] || 'there';
      const r = await send({ phone: c.phone, template: trainer.template, params: [first, trainer.name, niceDate(trainingStart), trainer.phone || 'the training team'] });
      log(r.status, id, '->', r.to || '-', r.error || r.id || r.note || '');
      db.run('INSERT INTO whatsapp_log (sent_on, trainer, emp_id, candidate, candidate_phone, sent_to, template, status, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        new Date().toISOString(), t, id, c.name || '', String(c.phone || ''), r.to ? '+' + r.to : '', r.template,
        r.status + (MODE === 'test' ? ' (test number)' : ''), r.error || r.id || r.note || '');
      db.markDirty('WhatsApp Log');
    }
  } catch (e) { log('error:', e.message); }
}
