/** Performance Dashboards (Old and New). */
import * as db from '../db.js';
import * as data from '../data.js';
import { CONFIG } from '../config.js';
import { today } from '../dates.js';
import { tdPrepare, tdBuildView, ncBuildView } from '../logic/performance.js';
import { isMonth, UserError } from '../logic/common.js';

const months = () => db.all('SELECT month FROM in_bq_months ORDER BY seq').map(r => r.month);

function bq() {
  const required = {};
  db.all('SELECT trainer, month, n FROM in_bq_required').forEach(r => { (required[r.trainer] = required[r.trainer] || {})[r.month] = r.n; });
  return { required, done: db.all('SELECT date, trainer, effectiveness FROM in_bq_done ORDER BY seq') };
}

/** The T&D Performance Tracker's scorecard for everyone the signed-in person may see. month 'yyyy-MM' (by DOJ) or ''. */
export function getPerformanceOld(user, month) {
  const s = data.session(user);
  if (s.role === 'none') throw new UserError('You do not have access.', 403);
  month = isMonth(month) ? month : '';
  const view = tdBuildView(tdPrepare(data.masterRows('')), bq(), data.org(), s, month, CONFIG.HEAD_EMAILS);
  view.months = months();
  view.today = today();
  return view;
}

/** New Cal metrics for everyone the signed-in person may see. */
export function getPerformanceNew(user, month) {
  const s = data.session(user);
  if (s.role === 'none') throw new UserError('You do not have access.', 403);
  month = isMonth(month) ? month : '';
  const day = today();
  const view = ncBuildView(tdPrepare(data.masterRows('')), data.org(), s, month, CONFIG.HEAD_EMAILS, day);
  view.months = months();
  view.today = day;
  return view;
}
