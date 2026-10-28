/** Google sign-in (company accounts only) and signed session cookies. */
import crypto from 'node:crypto';
import * as db from './db.js';
import * as G from './google.js';
import { SERVER } from './config.js';
import { cookies } from './web.js';

const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

function secret() {
  let s = db.getMeta('session_secret', '');
  if (!s) { s = crypto.randomBytes(32).toString('hex'); db.setMeta('session_secret', s); }
  return s;
}

export function sign(obj) { const body = b64u(JSON.stringify(obj)); return body + '.' + b64u(crypto.createHmac('sha256', secret()).update(body).digest()); }
export function verify(tok) {
  if (!tok || tok.indexOf('.') < 0) return null;
  const [body, sig] = tok.split('.');
  const want = b64u(crypto.createHmac('sha256', secret()).update(body).digest());
  if (!sig || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try { const o = JSON.parse(unb64u(body)); return o.exp && o.exp > Date.now() ? o : null; } catch (e) { return null; }
}

/** The signed-in user's e-mail, or ''. In the local preview everyone is DEMO_USER. */
export function userOf(req) {
  if (SERVER.demo) return SERVER.demoUser;
  const s = verify(cookies(req).desk_session);
  return s ? s.email : '';
}

const COOKIE_PATH = () => SERVER.base || '/';
const secure = () => (SERVER.origin.startsWith('https:') ? '; Secure' : '');
export const sessionCookie = email => 'desk_session=' + encodeURIComponent(sign({ email, exp: Date.now() + 24 * 3600000 })) +
  '; Path=' + COOKIE_PATH() + '; HttpOnly' + secure() + '; SameSite=Lax; Max-Age=86400';
export const clearCookie = () => 'desk_session=; Path=' + COOKIE_PATH() + '; Max-Age=0; HttpOnly' + secure() + '; SameSite=Lax';

const redirectUri = () => SERVER.origin + SERVER.base + '/auth/callback';

/** kind 'login' (who is this?) or 'connect' (the account that reads and writes the sheets, offline access). */
export function authUrl(kind, next, hint) {
  const state = sign({ kind, next: next || SERVER.base + '/', n: crypto.randomBytes(8).toString('hex'), exp: Date.now() + 10 * 60000 });
  const scope = kind === 'connect' ? 'openid email https://www.googleapis.com/auth/spreadsheets' : 'openid email profile';
  const q = new URLSearchParams({ client_id: SERVER.googleClientId, redirect_uri: redirectUri(), response_type: 'code', scope, state, hd: SERVER.domain,
    prompt: kind === 'connect' ? 'consent select_account' : 'select_account' });
  if (kind === 'connect') q.set('access_type', 'offline');
  if (hint) q.set('login_hint', hint);
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString();
}

/** Finishes a sign-in. Returns { kind, email, next, refreshToken } or throws with a message for the person. */
export async function finish(url) {
  const st = verify(url.searchParams.get('state'));
  if (!st) throw Object.assign(new Error('That sign-in link has expired.'), { expired: true });
  if (url.searchParams.get('error')) throw new Error('Sign-in cancelled: ' + url.searchParams.get('error'));
  const tok = await G.postForm('https://oauth2.googleapis.com/token', {
    code: url.searchParams.get('code'), client_id: SERVER.googleClientId, client_secret: SERVER.googleClientSecret, redirect_uri: redirectUri(), grant_type: 'authorization_code'
  });
  // The ID token comes straight from Google over TLS, so its claims can be read without a signature check.
  const claims = JSON.parse(unb64u(String(tok.id_token).split('.')[1]));
  const email = String(claims.email || '').toLowerCase();
  if (claims.aud !== SERVER.googleClientId || !claims.email_verified || !email.endsWith('@' + SERVER.domain)) {
    throw Object.assign(new Error('Only verified @' + SERVER.domain + ' accounts can use Trainer Desk.'), { forbidden: true });
  }
  return { kind: st.kind, email, next: st.next && st.next.startsWith(SERVER.base) ? st.next : SERVER.base + '/', refreshToken: tok.refresh_token || '' };
}
