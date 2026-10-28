/**
 * What a trainer may change about a trainee, and how each change is described.
 * The first time a trainer sets a field it saves straight away; changing it again needs an admin.
 * Admins' changes always save straight away.
 */
import { ordinal, attemptNumber, isIso, normId, norm } from './common.js';
import { addDaysIso, prettyDate } from '../dates.js';

/** Department List rows -> [[department, [sub-teams]]] in list order, duplicates removed. */
export function departmentsFromRows(rows) {
  const order = [], subs = {};
  rows.forEach(r => {
    const d = String(r.department || '').trim(), s = String(r.subTeam || '').trim();
    if (!d) return;
    if (!subs[d]) { subs[d] = []; order.push(d); }
    if (s && !subs[d].includes(s)) subs[d].push(s);
  });
  return order.map(d => [d, subs[d]]);
}

/** '' when the pair is allowed, otherwise the reason. A department with no sub-teams takes an empty sub-team. */
export function checkDepartment(list, dept, sub) {
  const row = list.find(x => x[0] === dept);
  if (!row) return 'Pick a department from the list.';
  if (!row[1].length) return sub ? dept + ' has no sub-teams.' : '';
  return row[1].includes(sub) ? '' : 'Pick a sub-team of ' + dept + '.';
}

/** OJT team key 'Department|Team' -> label shown to people. */
export function teamLabel(k) {
  const p = String(k || '').split('|');
  return !p[1] ? '' : p[1].indexOf(p[0]) === 0 ? p[1] : p[1] + ' (' + p[0] + ')';
}

/**
 * Validates a change and describes it. Returns { error } or { first, value, oldText, newText }.
 * ctx: { departments, today, trainee, mocks, updated, kc, teams, manual, batchHasMock }
 *   updated:      { field: true } for fields already set through Trainer Desk for this trainee
 *                 (a value that came from the sheet does not count)
 *   batchHasMock: a new mock is being saved in the same Save, so the OJT questions are open
 * Mocks record date, attempt and status only (no score).
 */
export function checkChange(field, value, ctx) {
  value = value || {};
  const t = ctx.trainee;
  // Mock and OJT open once the trainee has a KC result; the OJT questions also need a mock.
  if ((field === 'Mock' || field === 'Mock Edit' || field === 'OJT Entered' || field === 'OJT Eligible') && !ctx.kc) {
    return { error: 'Mock and OJT open once a KC result for this trainee is in the KC Sheet.' };
  }
  if ((field === 'OJT Entered' || field === 'OJT Eligible') && !(ctx.mocks || []).length && !ctx.batchHasMock) {
    return { error: 'OJT opens once a mock is recorded for this trainee.' };
  }
  const updated = ctx.updated || {};

  if (field === 'Department') {
    const d = String(value.department || '').trim(), s = String(value.subTeam || '').trim();
    const err = checkDepartment(ctx.departments, d, s);
    if (err) return { error: err };
    if (d === t.department && s === t.subTeam) return { error: 'That is already the department.' };
    return { first: !updated['Department'], value: { department: d, subTeam: s },
      oldText: t.department ? t.department + (t.subTeam ? ' / ' + t.subTeam : '') : '', newText: d + (s ? ' / ' + s : '') };
  }

  if (field === 'Training Start Date') {
    const date = String(value.date || '');
    if (!isIso(date)) return { error: 'Pick a training start date.' };
    if (date > addDaysIso(ctx.today, 30)) return { error: 'Training start date cannot be more than 30 days ahead.' };
    if (t.doj && date < addDaysIso(t.doj, -30)) return { error: 'Training start date is more than 30 days before their DOJ.' };
    if (date === t.trainingStart) return { error: 'That is already the training start date.' };
    return { first: !updated['Training Start Date'], value: { date }, oldText: prettyDate(t.trainingStart), newText: prettyDate(date) };
  }

  if (field === 'Mock') {
    const md = String(value.date || ''), att = Number(value.attempt), status = String(value.status || '');
    if (!isIso(md)) return { error: 'Pick the mock date.' };
    if (md > ctx.today) return { error: 'Mock date cannot be in the future.' };
    if (t.doj && md < t.doj) return { error: 'Mock date is before their DOJ.' };
    if (!(att >= 1 && att <= 6 && att === Math.round(att))) return { error: 'Pick the attempt.' };
    if ((ctx.mocks || []).some(m => attemptNumber(m.attempt) === att)) return { error: ordinal(att) + ' attempt is already recorded.' };
    if (status !== 'Pass' && status !== 'Fail') return { error: 'Pick Pass or Fail.' };
    const fin = status === 'Pass' || !!value.final;
    return {
      first: true,                       // each attempt is a new entry, never a change to an earlier one
      value: { date: md, attempt: att, score: '', status, final: fin },
      oldText: (ctx.mocks || []).length ? ctx.mocks.length + ' earlier attempt(s)' : '',
      newText: ordinal(att) + ' attempt · ' + status + ' · ' + prettyDate(md) + (fin ? ' · final' : ' · retake allowed')
    };
  }

  if (field === 'OJT Entered' || field === 'OJT Eligible') {
    const ans = String(value.answer || '');
    if (ans !== 'Yes' && ans !== 'No') return { error: 'Pick Yes or No.' };
    const cur = field === 'OJT Entered' ? t.ojtEntered : t.ojtEligible;
    if (ans === cur) return { error: 'That is already the answer.' };
    return { first: !updated[field], value: { answer: ans }, oldText: cur ? field + ': ' + cur : '', newText: field + ': ' + ans };
  }

  if (field === 'Mock Edit') {
    const a2 = Number(value.attempt);
    const old = (ctx.mocks || []).filter(m => attemptNumber(m.attempt) === a2).slice(-1)[0];
    if (!old) return { error: 'That attempt is not recorded.' };
    if (old.final) return { error: 'The final attempt cannot be changed here.' };
    const d2 = String(value.date || ''), st2 = String(value.status || '');
    if (!isIso(d2)) return { error: 'Pick the mock date.' };
    if (d2 > ctx.today) return { error: 'Mock date cannot be in the future.' };
    if (st2 !== 'Pass' && st2 !== 'Fail') return { error: 'Pick Pass or Fail.' };
    const fin2 = st2 === 'Pass' || !!value.final;
    if (d2 === old.date && st2 === old.status && fin2 === !!old.final) return { error: 'Nothing has changed.' };
    const keep = old.score === '' || old.score === null || old.score === undefined || isNaN(Number(old.score)) ? '' : Number(old.score);
    const describe = (dd, st, f) => ordinal(a2) + ' attempt · ' + st + ' · ' + prettyDate(dd) + (f ? ' · final' : '');
    return { first: false, value: { date: d2, attempt: a2, score: keep, status: st2, final: fin2 },
      oldText: describe(old.date, old.status, old.final), newText: describe(d2, st2, fin2) };
  }

  if (field === 'OJT Team') {
    const team = (ctx.teams || []).find(x => x.key === value.team);
    if (!team) return { error: 'Pick an OJT team.' };
    if (team.key === t.team) return { error: 'That is already the OJT team.' };
    return { first: !updated['OJT Team'], value: { team: team.key },
      oldText: t.team ? teamLabel(t.team) + (t.teamSet ? '' : ' (default)') : '', newText: teamLabel(team.key) };
  }

  if (field.indexOf('OJT Input: ') === 0) {
    const metric = field.slice('OJT Input: '.length);
    const tm = (ctx.teams || []).find(x => x.key === t.team);
    const def = tm && tm.metrics.find(m => m.manual && m.name === metric);
    if (!def) return { error: metric + ' is not entered by hand for this trainee\'s OJT team.' };
    const raw = value.achieved;
    let n = Number(raw);
    if (raw === '' || raw === null || raw === undefined || isNaN(n) || n < 0) return { error: 'Enter ' + metric + ' as a number.' };
    const cap = def.target && def.target <= 10 ? 10 : 100;
    if (n > cap) return { error: metric + ' cannot be more than ' + cap + '.' };
    n = Math.round(n * 100) / 100;
    const prev = (ctx.manual || {})[metric];
    if (prev === n) return { error: 'That is already the value.' };
    return { first: !updated[field], value: { metric, achieved: n }, oldText: prev === undefined || prev === null ? '' : String(prev), newText: String(n) };
  }
  return { error: 'Unknown change.' };
}

/** Change requests -> { empId: { field: true } } for fields already set through Trainer Desk. */
export function updatedFields(list) {
  const out = {};
  list.forEach(q => { if (q.status === 'Approved') (out[q.empId] = out[q.empId] || {})[q.field] = true; });
  return out;
}

/** Pending requests -> { empId: { field: { newText, by, on, id } } } */
export function pendingByTrainee(list) {
  const out = {};
  list.forEach(q => { (out[q.empId] = out[q.empId] || {})[q.field] = { newText: q.newText, by: q.by, on: q.on, id: q.id }; });
  return out;
}

/** KC rows (one key) -> the latest entry: latest date; on the same date, the highest attempt. */
export function latestKc(rows) {
  let cur = null;
  rows.forEach(e => {
    if (!cur || e.date > cur.date || (e.date === cur.date && attemptNumber(e.attempt) > attemptNumber(cur.attempt))) cur = e;
  });
  return cur ? { date: cur.date, attempt: cur.attempt, score: cur.score, status: cur.status } : null;
}

export const kcKeys = (empId, email) => [normId(empId)].concat(email ? [norm(email)] : []);
