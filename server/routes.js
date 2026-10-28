/** The REST API the page calls. Every route needs a signed-in user; errors come back as { error }. */
import { Router, readJson } from './web.js';
import * as candidates from './services/candidates.js';
import * as attendance from './services/attendance.js';
import * as changes from './services/changes.js';
import * as performance from './services/performance.js';
import * as ojt from './services/ojt.js';
import * as whatsapp from './services/whatsapp.js';

const r = new Router();
const body = ctx => readJson(ctx.req);

r.get('/api/session', ({ user }) => candidates.getSession(user));

/* trainers */
r.get('/api/trainers/:trainer/batches', ({ user, params }) => candidates.getTrainerBatches(user, params.trainer));
r.get('/api/trainers/:trainer/attendance', ({ user, params }) => attendance.getAttendance(user, params.trainer));
r.post('/api/trainers/:trainer/attendance', async ctx => attendance.saveAttendance(ctx.user, Object.assign(await body(ctx), { trainer: ctx.params.trainer })));
r.get('/api/trainers/:trainer/nht', ({ user, params }) => changes.getNhtCandidates(user, params.trainer));
r.post('/api/trainers/:trainer/nht/:empId', async ctx =>
  changes.submitPageChanges(ctx.user, Object.assign(await body(ctx), { trainer: ctx.params.trainer, empId: ctx.params.empId })));
r.post('/api/trainers/:trainer/changes', async ctx => changes.submitChange(ctx.user, Object.assign(await body(ctx), { trainer: ctx.params.trainer })));
r.get('/api/trainers/:trainer/ojt', ({ user, params }) => ojt.getOjtSummary(user, params.trainer));

/* unclaimed candidates */
r.get('/api/candidates', ({ user }) => candidates.getUnclaimedCandidates(user));
r.post('/api/candidates/assign', async ctx => {
  const req = await body(ctx);
  const out = candidates.assignCandidates(ctx.user, req);
  whatsapp.afterClaim(out, req.trainingStart);          // in the background; never fails the claim
  return out;
});
r.post('/api/candidates/exclude', async ctx => candidates.excludeCandidates(ctx.user, await body(ctx)));
r.post('/api/candidates/restore', async ctx => candidates.restoreCandidates(ctx.user, await body(ctx)));

/* approvals */
r.get('/api/approvals', ({ user }) => changes.getPendingApprovals(user));
r.post('/api/approvals/review', async ctx => changes.reviewRequests(ctx.user, await body(ctx)));

/* dashboards */
r.get('/api/performance/old', ({ user, query }) => performance.getPerformanceOld(user, query.get('month') || ''));
r.get('/api/performance/new', ({ user, query }) => performance.getPerformanceNew(user, query.get('month') || ''));
r.post('/api/ojt/refresh', ({ user }) => ojt.refreshOjtDashboard(user));

export default r;
