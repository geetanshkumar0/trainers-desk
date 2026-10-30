/**
 * KC Pick Timer: read-only link to the PIA score sheet.
 *
 * 1. Open the score sheet (signed in as the account the tool sends email from).
 * 2. Extensions > Apps Script. Replace everything with this file.
 * 3. Paste the key from Site administration > Score sheet into SECRET_KEY below.
 * 4. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 * 5. Copy the web app URL (ends in /exec) into Site administration > Score sheet.
 *
 * The script only reads. It returns the header row and the rows under it, and refuses any request
 * that does not carry the secret key.
 */
const SECRET_KEY = 'PASTE-THE-KEY-FROM-THE-TOOL-HERE';
const SHEET_NAME = '';   // tab name to read; leave blank to use the first tab

function doGet(e) {
  try {
    if (!SECRET_KEY || SECRET_KEY.indexOf('PASTE-') === 0) return out_({ok: false, error: 'SECRET_KEY has not been set in the Apps Script.'});
    if (!e || !e.parameter || e.parameter.key !== SECRET_KEY) return out_({ok: false, error: 'Wrong or missing key.'});
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
    if (!sh) return out_({ok: false, error: 'No tab named "' + SHEET_NAME + '".'});
    const range = sh.getDataRange();
    const values = range.getValues(), shown = range.getDisplayValues();
    const tz = ss.getSpreadsheetTimeZone();

    // The header row is the first of the top 10 rows that has an "Emp ID" cell.
    let head = -1;
    for (let i = 0; i < Math.min(10, shown.length) && head < 0; i++) {
      if (shown[i].some(function (c) { return String(c).toLowerCase().replace(/[^a-z]/g, '') === 'empid'; })) head = i;
    }
    if (head < 0) return out_({ok: false, error: 'Could not find a header row with an "Emp ID" column in the first 10 rows.'});

    const rows = [];
    for (let r = head + 1; r < shown.length; r++) {
      const cells = shown[r].map(function (c, j) {
        const v = values[r][j];
        return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : c;   // dates as 2026-10-29, whatever the display format
      });
      if (cells.some(function (c) { return String(c).trim() !== ''; })) rows.push({row: r + 1, cells: cells});
    }
    return out_({ok: true, sheet: sh.getName(), headers: shown[head], rows: rows});
  } catch (err) {
    return out_({ok: false, error: String(err && err.message || err)});
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
