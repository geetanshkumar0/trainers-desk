/** Small HTTP helpers: a router, JSON in/out, cookies, static files. No framework. */
import fs from 'node:fs';
import path from 'node:path';

export function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }, headers || {}));
  res.end(body);
}
export const json = (res, code, obj) => send(res, code, JSON.stringify(obj === undefined ? null : obj), { 'Content-Type': 'application/json; charset=utf-8' });
export const redirect = (res, to, headers) => send(res, 302, '', Object.assign({ Location: to }, headers || {}));
export const html = (res, code, body) => send(res, code, body, { 'Content-Type': 'text/html; charset=utf-8' });
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function readJson(req, limit = 2e6) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(Object.assign(new Error('Bad request'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

export function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}

/** Routes like 'GET /api/trainers/:email/batches'. handler(ctx) where ctx = { req, res, params, query, user }. */
export class Router {
  constructor() { this.routes = []; }
  on(method, pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    this.routes.push({ method, re, keys, handler });
    return this;
  }
  get(p, h) { return this.on('GET', p, h); }
  post(p, h) { return this.on('POST', p, h); }
  match(method, pathname) {
    let allowed = false;
    for (const r of this.routes) {
      const m = pathname.match(r.re);
      if (!m) continue;
      if (r.method !== method) { allowed = true; continue; }
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
    return allowed ? { wrongMethod: true } : null;
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };

/** Serves a file from dir, or returns false. */
export function serveStatic(res, dir, rel, maxAge) {
  const file = path.join(dir, path.normalize('/' + rel).slice(1));
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': maxAge ? 'public, max-age=' + maxAge : 'no-cache' });
  return true;
}
