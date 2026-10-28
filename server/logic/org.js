/** Who trains, manages and mentors whom, and what the signed-in person may open. */
import { norm, prettyName } from './common.js';

/**
 * rows: [{ trainer, manager, mentor }] in Scoring_Master order; names: { email: display name }.
 * Returns the session: role, admin flag and the trainers this person may open.
 */
export function resolveSession(email, org, heads, admins) {
  const nameOf = e => org.names[e] || prettyName(e);
  const isHead = heads.map(norm).includes(email);
  const isAdmin = !!email && (admins || []).map(norm).includes(email);
  let isTrainer = false, isManager = false, isMentor = false;
  const mine = new Set();
  org.rows.forEach(r => {
    if (r.trainer === email) { isTrainer = true; mine.add(r.trainer); }
    if (r.manager === email) { isManager = true; mine.add(r.trainer); }
    if (r.mentor === email) { isMentor = true; mine.add(r.trainer); }
  });
  const role = !email ? 'none' : isHead ? 'head' : isManager ? 'manager' : isMentor ? 'mentor' : isTrainer ? 'trainer' : isAdmin ? 'admin' : 'none';
  const seeAll = role === 'head' || role === 'admin';      // an admin outside the trainer map sees everyone
  const seen = new Set(), list = [];
  org.rows.forEach(r => {
    if ((seeAll || mine.has(r.trainer)) && !seen.has(r.trainer)) { seen.add(r.trainer); list.push({ email: r.trainer, name: nameOf(r.trainer) }); }
  });
  list.sort((a, b) => (a.email === email ? -1 : b.email === email ? 1 : a.name.localeCompare(b.name)));
  const labels = { head: 'Head', manager: 'Manager', mentor: 'Mentor', trainer: 'Trainer', admin: 'Admin', none: '' };
  return { email, name: email ? nameOf(email) : '', role, roleLabel: labels[role], isTrainer, isAdmin, trainers: role === 'none' ? [] : list };
}
