# Working on Trainer Desk

- **Pushing to `main` puts it live.** The server checks GitHub every 5 minutes and deploys new commits once `npm test` passes (see `deploy/README.md`). After making a change: run `npm test`, check it in `npm run preview`, then commit and push to `main` so it reaches the server.
- **Stack:** Node.js 22.13+ with no dependencies, built-in SQLite (`node:sqlite`), plain HTML/CSS/JS in `public/`. Do not add frameworks or npm packages.
- **Data rules:**
  - Batches, Attendance, Active NHT Details, OJT Performance and Approvals show only trainees claimed in Trainer Desk (`claims` table).
  - The full live Master Dashboard is used only by the Performance Dashboards (`data.liveMasterRows()`).
  - Nothing is imported from the old app tabs.
  - Trainer Desk writes only its own rows in the tracker tabs (`server/mirror.js`) and never rewrites a whole tab.
- **Never commit** `.env`, `data/` or database files. Keep the repository private: `server/config.js` holds sheet IDs and staff e-mails.
