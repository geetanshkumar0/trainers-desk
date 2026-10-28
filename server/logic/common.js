/** Small helpers shared by the rules. */

export const norm = v => String(v == null ? '' : v).trim().toLowerCase();
export const normId = v => (v instanceof Date ? '' : String(v == null ? '' : v).trim().toUpperCase());
export const text = v => (v instanceof Date ? '' : String(v == null ? '' : v).trim());

/** "first.last2@x" -> "First Last" */
export function prettyName(email) {
  return String(email).split('@')[0].split(/[._]/).filter(String)
    .map(p => p.replace(/\d+$/, '')).filter(String)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

/** Unique, normalised, non-empty Emp IDs in the order given. */
export function cleanIds(ids) {
  const seen = new Set(), out = [];
  (ids || []).forEach(v => { const id = normId(v); if (id && !seen.has(id)) { seen.add(id); out.push(id); } });
  return out;
}

export function ordinal(n) {
  n = Number(n);
  const t = n % 100, u = n % 10;
  return n + (t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th');
}

export function attemptNumber(v) { const m = String(v == null ? '' : v).match(/\d+/); return m ? Number(m[0]) : 0; }

export const isIso = x => /^\d{4}-\d{2}-\d{2}$/.test(String(x || ''));
export const isMonth = x => /^\d{4}-\d{2}$/.test(String(x || ''));

/** An error the person can fix (shown as-is, HTTP 400). */
export class UserError extends Error {
  constructor(message, status) { super(message); this.status = status || 400; }
}
