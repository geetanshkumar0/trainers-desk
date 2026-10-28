# Trainer Desk

[![Tests](../../actions/workflows/test.yml/badge.svg)](../../actions/workflows/test.yml)

Live at **https://nbtrainerdesk.duckdns.org** (Google sign-in, @nobroker.in only).

Trainer Desk helps the T&D team run batches from day one to the end of OJT: unclaimed candidates, attendance, Active NHT Details, OJT Performance, the two performance dashboards, batch summaries and admin approvals.

## A trainee's path

1. **Unclaimed Candidates**: everyone in HR_WFO / HR_WFH who joined after 20 Oct 2026 (`UNCLAIMED_FROM` in `server/config.js`) and is not yet in Master Dashboard. New joiners show up within a minute of being added to the HR sheets. A trainer selects people and assigns them to themselves.
2. **Active NHT Details** and **Attendance Tracker**: a claimed trainee appears in both straight away. In Active NHT Details the trainer sets the **department and sub-team first**; the training start date, mock and OJT sections stay locked until then.
3. **OJT Performance**: when **OJT Entered** and **OJT Eligible** are both **Yes**, the trainee leaves Active NHT Details and moves to OJT Performance. A final mock **Pass** keeps them in Active NHT Details until those answers are given; a final mock **Fail** ends training. (Trainees whose final mock was recorded before 28 Oct 2026 stay where they were: a Pass is already in OJT.)
4. Every change is saved at once and copied to the tracker within seconds: Master Dashboard for claims, departments, start dates and final mocks; the app tabs (Attendance, NHT Status, Mock Scores, Change Requests, ...) for the rest.

## Built with

- **Server:** JavaScript on **Node.js 22.13 or newer**. No packages to install: no `npm install`, no `node_modules`.
- **Database:** **SQLite**, built into Node.js (`node:sqlite`). One file: `data/trainer-desk.db`.
- **Browser:** plain **HTML, CSS and JavaScript**. No React, Angular or other framework. (The 3D background uses the Three.js library, bundled in `public/vendor/`.)

## How data flows

```
 Google Sheets (other teams own these)            Trainer Desk (owns its own data)
 ─────────────────────────────────────            ─────────────────────────────────
 Master Dashboard, HR_WFO/WFH, KC Sheet,   ──►   SQLite in_* tables (copied every 60 s)
 Scoring_Master, Talktime, dumps, targets…        │
                                                  │  the rules (server/logic/)
                                                  ▼
                                           SQLite: attendance, change requests, mocks,
                                           NHT status, OJT team / inputs, exclusions,
                                           OJT dashboard, WhatsApp log
                                                  │
 Master Dashboard  ◄── outbox (in order, retried) ┤  claims, department, training start, final mock
 Tracker app tabs  ◄── mirror (read-only copy)    ┘  Attendance, Change Requests, Mock Scores, …
```

- **Inputs** (sheets other teams keep up to date) are read into SQLite every `REFRESH_SECONDS`. Talktime and the OJT dumps are large, so they are read only by the OJT refresh.
- **Trainer Desk's own data** lives only in SQLite. That covers attendance, change requests and approvals, mock scores, NHT status, OJT team and manual inputs, excluded candidates, the OJT dashboard and the WhatsApp log.
- **Master Dashboard is still written** when someone claims a candidate, sets a department or training start date, or records a final mock, because the sheet's formulas and other tabs depend on it. Each write is saved in the database first and then sent to Google by the **outbox**, in order. If Google is slow or down, nothing is lost: it retries, and the page already shows the new value.
- **Mirror:** a few seconds after each save (`MIRROR_DELAY_SECONDS`), the app tabs that changed are copied back to the tracker with the same columns as before (Attendance, Change Requests, Mock Scores, NHT Status, OJT Team, OJT Manual Inputs, OJT Dashboard, OJT Performance, Excluded Candidates, Attendance Log, WhatsApp Log), so reports built on them keep working. **These tabs are now copies: edits made there are overwritten.** Make changes in Trainer Desk. Turn the copy off with `SHEET_MIRROR=off`.
- **First start:** before anything can be saved, Trainer Desk reads the existing app tabs from the tracker into SQLite once. This only happens while its own tables are empty, so it can never overwrite data saved in Trainer Desk.

## Folders

```
server/
  main.js            web server: pages, sign-in, /api, admin pages, timers, nightly backup
  config.js          rules and sheet names (what CONFIG was in Code.gs) + settings from .env
  schema.sql         every database table, with comments
  db.js              SQLite connection and helpers
  routes.js          the REST API (one line per endpoint)
  logic/             the rules, with no database or Google code: batches, candidates, attendance,
                     changes (what may be changed and how), performance (Old + New), ojt
  services/          each screen's reads and saves: candidates, attendance, changes (NHT + approvals),
                     performance, ojt (summary + refresh), whatsapp
  data.js            read helpers shared by the services
  sync.js            input sheets -> SQLite
  outbox.js          Master Dashboard writes and e-mails, sent in order with retries
  mirror.js          app tabs -> tracker (copy), and the one-time import from the old tabs
  google.js          Google Sheets and Gmail API calls
  auth.js            Google sign-in and session cookies
  web.js             small HTTP helpers (router, JSON, static files)
public/
  index.html         the page
  css/app.css        page styles;  css/theme.css  the visual design (loads last, so it wins)
  js/app.js          the screens;  js/api.js  REST calls;  js/background.js  3D background + theme switch
preview/             runs everything on your laptop with MADE-UP data (no Google)
tests/               automated tests, including a fake Google Sheets API
docker-compose.yml   how the server runs it
.env.example         the settings the server needs (no secret values here)
```

## Where to make a change

| You want to change | Edit |
|---|---|
| Rules, limits, sheet names, admins | `server/config.js` |
| What a trainer may change, approval rules | `server/logic/changes.js` |
| Batch, attendance, dashboard or OJT calculations | the matching file in `server/logic/` |
| What a screen loads or saves | the matching file in `server/services/` |
| A new table | `server/schema.sql` (`CREATE TABLE IF NOT EXISTS ...`) |
| A new column on an existing table | add an `ALTER TABLE` line to `MIGRATIONS` in `server/db.js`, and the column to `schema.sql` |
| Screens, wording, buttons | `public/js/app.js` |
| Colours, fonts, spacing | `public/css/theme.css` |

## Try a change on your laptop first (Node.js 22.13 or newer)

```bash
npm run preview
```

Open http://localhost:5177. It runs the real server and page on made-up trainees, and you are signed in as the manager "Priya Nair" (also an admin). Saves go to a throwaway database in `preview/.data/`, which is wiped every time you start the preview. Nothing goes to Google, e-mail or WhatsApp. To look as someone else, start it with `DEMO_USER=aditi.rao@nobroker.in npm run preview`.

```bash
npm test
```

This runs the end-to-end tests against a fake Google Sheets API. They cover the sync, the first-start import, claims written to Master Dashboard (including Google being down), the mirror, the OJT refresh and access rules.

## Moving the live server to this version

1. Back up the server folder, then put this project in its place. Keep the `data/` folder and `.env`.
2. In `.env`, compare against `.env.example`. The new settings are `SHEET_MIRROR`, `MIRROR_DELAY_SECONDS` and `MIRROR_SECONDS`.
3. `docker compose up -d` (it now uses `node:22-alpine`).
4. On first start, the saved nbhr token (`data/sheets_token.json`) is moved into the database. Trainer Desk reads the sheets, imports the existing app tabs, and then starts the mirror. Saving is blocked for those few seconds, with the message "starting up".
5. Open `/admin/status` and check that `importedFromSheets` shows the row counts, `sync.lastError` is empty and `outbox.failed` is empty.

## Admin pages (setup admins only)

- `/admin/status`: what was last read from each sheet, writes waiting or failed, tabs waiting to be copied, last OJT refresh, mail and WhatsApp mode.
- `/admin/sync`: reads the sheets and copies the tabs now.
- `/admin/connect`: connects the Google account that reads and writes the sheets (one time, or to switch accounts).

## Backups

The database is copied every night to `data/backups/trainer-desk-YYYY-MM-DD.db`, and the last 14 are kept. To restore, stop the server and copy a backup over `data/trainer-desk.db`. Also back up the whole `data/` folder off the server from time to time.

## Rules

- **Never commit `.env` or `data/`.** They hold tokens, keys and everyone's records. `.gitignore` already leaves them out.
- **Keep the GitHub repository private.** `server/config.js` contains sheet IDs and staff e-mails.
- **Check before pushing.** Run `npm test` and `npm run preview`, and click through what you changed.

## Server settings (`.env`, on the server only)

| Setting | Meaning |
|---|---|
| `PUBLIC_ORIGIN`, `BASE_PATH` | Site address (`https://nbtrainerdesk.duckdns.org`, empty path) |
| `TRACKER_ID`, `DUMPS_ID` | The Google Sheet IDs (blank = the ones in `config.js`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in client |
| `SHEETS_CLIENT_ID`, `SHEETS_CLIENT_SECRET` | Client the existing nbhr sheets token was made with |
| `ALLOWED_DOMAIN` | `nobroker.in` |
| `SETUP_ADMINS` | Who can open the admin pages |
| `DESK_EXTRA_ADMINS` | Trainer Desk admins in addition to `ADMIN_EMAILS` in `config.js` |
| `MAIL_TO` | Every e-mail goes here instead of the admins |
| `MAIL_TO_OVERRIDE` | Testing only: redirect every e-mail and mark the subject "[for …]" |
| `REFRESH_SECONDS` | How often the input sheets are read (60) |
| `SHEET_MIRROR` | Copy app tabs back to the tracker (`on`) |
| `MIRROR_DELAY_SECONDS`, `MIRROR_SECONDS` | Copy a change this many seconds after it is saved (5); retry anything left over this often (300) |
| `WA_MODE` | `off` (log only), `test` (only to `WA_TEST_TO`) or `live` (to candidates) |
| `WA_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WA_TEMPLATE`, `WA_API_VERSION` | WhatsApp Cloud API |
| `DATA_DIR` | Where the database and backups live (`/data` in Docker) |

## GitHub

- Keep the repository **private**.
- Every push runs `npm test` on GitHub Actions (`.github/workflows/test.yml`); the result shows under the **Actions** tab.
