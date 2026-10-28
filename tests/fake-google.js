/**
 * A tiny in-memory stand-in for the Google Sheets API and the OAuth token endpoint, installed over global fetch.
 * Enough of the API for Trainer Desk: spreadsheet metadata, values batchGet / batchUpdate / batchClear,
 * and batchUpdate with addSheet / appendDimension. Like the real API, writing past the grid fails.
 */
const books = {};       // id -> { title, locale, timeZone, tabs: [{ sheetId, title, rows, cols, grid }] }

export function addBook(id, tabs, opts = {}) {
  books[id] = { title: opts.title || id, locale: opts.locale || 'en_US', timeZone: 'Asia/Kolkata',
    tabs: Object.keys(tabs).map((t, i) => ({ sheetId: i + 1, title: t, grid: tabs[t].map(r => r.slice()), rows: Math.max(tabs[t].length + 20, 50), cols: 40 })) };
  return books[id];
}
export function addTab(id, title, grid) {
  const b = books[id];
  b.tabs.push({ sheetId: b.tabs.length + 1000, title, grid: grid.map(r => r.slice()), rows: Math.max(grid.length + 20, 50), cols: 40 });
}
export const tab = (id, title) => books[id].tabs.find(t => t.title === title);
export const calls = [];

const colNum = s => s.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
function parseRange(r) {
  const m = r.match(/^'((?:[^']|'')+)'(?:!(.*))?$/) || r.match(/^([^!]+)(?:!(.*))?$/);
  const title = m[1].replace(/''/g, "'"), a1 = m[2] || '';
  let c1 = 1, r1 = 1, c2 = Infinity, r2 = Infinity, x;
  if ((x = a1.match(/^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/))) {
    c1 = colNum(x[1]); r1 = x[2] ? +x[2] : 1; c2 = x[3] ? colNum(x[3]) : (x[2] ? c1 : c1); r2 = x[4] ? +x[4] : (x[3] ? Infinity : (x[2] ? +x[2] : Infinity));
    if (!x[3] && !x[2]) c2 = c1;
  } else if ((x = a1.match(/^(\d+):(\d+)$/))) { r1 = +x[1]; r2 = +x[2]; }
  return { title, c1, r1, c2, r2 };
}
const trim = rows => {
  const out = rows.map(r => { const a = r.slice(); while (a.length && (a[a.length - 1] === '' || a[a.length - 1] == null)) a.pop(); return a; });
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
};

function read(book, range, render) {
  const p = parseRange(range), t = book.tabs.find(x => x.title === p.title);
  if (!t) throw Object.assign(new Error('Unable to parse range: ' + range), { status: 400 });
  const rows = [];
  for (let r = p.r1; r <= Math.min(p.r2, t.grid.length); r++) {
    const src = t.grid[r - 1] || [], row = [];
    for (let c = p.c1; c <= Math.min(p.c2, src.length); c++) { const v = src[c - 1]; row.push(v == null ? '' : render === 'FORMATTED_VALUE' ? String(v) : v); }
    rows.push(row);
  }
  return trim(rows);
}

function write(book, range, values) {
  const p = parseRange(range), t = book.tabs.find(x => x.title === p.title);
  if (!t) throw Object.assign(new Error('Unable to parse range: ' + range), { status: 400 });
  if (p.r1 + values.length - 1 > t.rows) throw Object.assign(new Error('Range (' + range + ') exceeds grid limits. Max rows: ' + t.rows), { status: 400 });
  values.forEach((row, i) => {
    const r = p.r1 - 1 + i;
    while (t.grid.length <= r) t.grid.push([]);
    row.forEach((v, j) => {
      // USER_ENTERED: numbers typed as text become numbers.
      t.grid[r][p.c1 - 1 + j] = typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && !/^0\d/.test(v) ? Number(v) : v;
    });
  });
}

function respond(status, obj) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } }); }

export function install() {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    const body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ url, method: opts.method || 'GET', body });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return respond(200, { access_token: 'fake', expires_in: 3600 });
    const m = url.match(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/([^/?:]+)(.*)$/);
    if (!m) return real(url, opts);
    const book = books[m[1]], rest = m[2];
    if (!book) return respond(404, { error: { message: 'Requested entity was not found.' } });
    try {
      if (rest.startsWith('?fields=')) {
        return respond(200, { properties: { title: book.title, timeZone: book.timeZone, locale: book.locale },
          sheets: book.tabs.map((t, i) => ({ properties: { sheetId: t.sheetId, title: t.title, index: i, gridProperties: { rowCount: t.rows, columnCount: t.cols } } })) });
      }
      if (rest.startsWith('/values:batchGet')) {
        const q = new URLSearchParams(rest.slice(rest.indexOf('?') + 1));
        return respond(200, { valueRanges: q.getAll('ranges').map(r => ({ range: r, values: read(book, r, q.get('valueRenderOption')) })) });
      }
      if (rest === '/values:batchUpdate') { body.data.forEach(d => write(book, d.range, d.values)); return respond(200, {}); }
      if (rest === '/values:batchClear') {
        body.ranges.forEach(r => {
          const p = parseRange(r), t = book.tabs.find(x => x.title === p.title);
          t.grid.forEach((row, i) => { if (i + 1 >= p.r1 && i + 1 <= p.r2) for (let c = p.c1; c <= Math.min(p.c2, row.length); c++) row[c - 1] = ''; });
        });
        return respond(200, {});
      }
      if (rest === ':batchUpdate') {
        body.requests.forEach(q => {
          if (q.addSheet) book.tabs.push({ sheetId: book.tabs.length + 100, title: q.addSheet.properties.title, grid: [], rows: q.addSheet.properties.gridProperties.rowCount, cols: q.addSheet.properties.gridProperties.columnCount });
          else if (q.appendDimension) {
            const t = book.tabs.find(x => x.sheetId === q.appendDimension.sheetId);
            if (q.appendDimension.dimension === 'ROWS') t.rows += q.appendDimension.length; else t.cols += q.appendDimension.length;
          } else if (q.insertDimension || q.deleteDimension) {
            const d = q.insertDimension || q.deleteDimension, t = book.tabs.find(x => x.sheetId === d.range.sheetId), n = d.range.endIndex - d.range.startIndex;
            if (d.range.dimension === 'COLUMNS') {
              t.grid.forEach(r => { if (q.insertDimension) { while (r.length < d.range.startIndex) r.push(''); r.splice(d.range.startIndex, 0, ...new Array(n).fill('')); } else r.splice(d.range.startIndex, n); });
              t.cols += q.insertDimension ? n : -n;
            } else {
              if (q.insertDimension) t.grid.splice(d.range.startIndex, 0, ...Array.from({ length: n }, () => [])); else t.grid.splice(d.range.startIndex, n);
              t.rows += q.insertDimension ? n : -n;
            }
          } else throw new Error('fake-google: unsupported request ' + Object.keys(q)[0]);
        });
        return respond(200, {});
      }
      return respond(400, { error: { message: 'fake-google: unsupported ' + rest } });
    } catch (e) {
      return respond(e.status || 500, { error: { message: e.message } });
    }
  };
}
