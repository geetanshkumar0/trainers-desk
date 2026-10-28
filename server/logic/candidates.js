/** Unclaimed candidates: people in the HR sheets who are not mapped to a trainer yet. */
import { norm } from './common.js';

/**
 * hr: in_hr rows in sheet order ({ empId, name, status, doj, location, source, department }).
 * mapped / removed: Set of Emp IDs. excluded: { empId: { reason, by, on } }.
 * Admins also get excluded rows (flagged) so they can restore them; everyone else never sees them.
 * fromIso: people who joined before this date are left out ('' = no cut-off).
 */
export function buildUnclaimed(hr, mapped, removed, excluded, isAdmin, fromIso) {
  const seen = new Set(), out = [];
  excluded = excluded || {};
  hr.forEach(row => {
    const id = row.empId;
    if (!id || mapped.has(id) || seen.has(id)) return;
    if (excluded[id] && !isAdmin) return;
    if (fromIso && row.doj && row.doj < fromIso) return;
    seen.add(id);
    out.push({
      empId: id, name: row.name,
      mode: id.indexOf('A') >= 0 ? 'WFH' : 'WFO',             // Master Dashboard's rule: an "A" in the Emp ID means WFH
      active: norm(row.status) === 'active', doj: row.doj,
      location: row.location, source: row.source, department: row.department,
      removedBefore: removed.has(id), excluded: excluded[id] || null
    });
  });
  out.sort((a, b) => (a.doj < b.doj ? 1 : a.doj > b.doj ? -1 : a.name.localeCompare(b.name)));
  return out;
}

/** Splits requested IDs into those that can be assigned and those that cannot, with the reason. */
export function planAssignment(ids, mapped, inHr, excluded) {
  const assign = [], skipped = [];
  ids.forEach(id => {
    if (mapped.has(id)) skipped.push({ empId: id, reason: 'Already mapped to a trainer' });
    else if (excluded && excluded[id]) skipped.push({ empId: id, reason: 'Removed from the list by an admin' });
    else if (!inHr.has(id)) skipped.push({ empId: id, reason: 'Not found in the HR sheets' });
    else assign.push(id);
  });
  return { assign, skipped };
}
