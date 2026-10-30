/** Pick Timer's score sheet, read with the Google account Trainer Desk uses for its sheets. */
import * as G from './google.js';

/**
 * Reads PIA's score sheet for Pick Timer, in the shape its Apps Script returns: the header row is the first of the top
 * 10 rows with an "Emp ID" cell; cells are as displayed, except Date of KC, which becomes yyyy-MM-dd.
 */
export async function readScoreSheet(sheetId, tab) {
  const range = G.quoteTab(tab);
  const [shown] = await G.sheetsValues(sheetId, [range], 'FORMATTED_VALUE');
  const [raw] = await G.sheetsValues(sheetId, [range], 'UNFORMATTED_VALUE', 'SERIAL_NUMBER');
  const key = v => String(v == null ? '' : v).toLowerCase().replace(/[^a-z]/g, '');
  const head = shown.slice(0, 10).findIndex(r => r.some(c => key(c) === 'empid'));
  if (head < 0) throw Object.assign(new Error('Could not find a header row with an "Emp ID" column in the first 10 rows.'), { status: 422 });
  const headers = shown[head].map(String);
  const dateCols = headers.map((h, i) => (['dateofkc', 'kcdate'].includes(key(h)) ? i : -1)).filter(i => i >= 0);
  const iso = n => new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5).toISOString().slice(0, 10);
  const rows = [];
  for (let r = head + 1; r < shown.length; r++) {
    const cells = (shown[r] || []).map(c => (c == null ? '' : String(c)));
    dateCols.forEach(i => { const v = (raw[r] || [])[i]; if (typeof v === 'number' && v > 20000) cells[i] = iso(v); });
    if (cells.some(c => c.trim() !== '')) rows.push({ row: r + 1, cells });
  }
  return { headers, rows };
}
