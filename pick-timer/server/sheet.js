'use strict';
/* Reads PIA's score sheet through the Apps Script web app (read only). Uses the built-in fetch. */
async function fetchSheet(cfg, timeoutMs = 30000) {
  if (!cfg || !cfg.url) throw Object.assign(new Error('The score sheet is not linked yet. Ask the administrator to set it up in Site administration › Score sheet.'), {status:409});
  const url = new URL(cfg.url);
  url.searchParams.set('key', cfg.key || '');
  let r;
  try { r = await fetch(url, {redirect:'follow', signal:AbortSignal.timeout(timeoutMs)}); }
  catch (e) { throw Object.assign(new Error(`Could not reach the score sheet: ${e.name === 'TimeoutError' ? 'it took too long to answer' : e.message}.`), {status:502}); }
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch (e) {
    throw Object.assign(new Error(`The score sheet link did not return data (HTTP ${r.status}). Check the Apps Script is deployed as a web app with access "Anyone", and that the URL ends in /exec.`), {status:502});
  }
  if (!data.ok) throw Object.assign(new Error(`The score sheet refused the request: ${data.error || 'unknown error'}`), {status:502});
  if (!Array.isArray(data.headers) || !Array.isArray(data.rows)) throw Object.assign(new Error('The score sheet returned data in an unexpected shape. Use the Apps Script supplied with the tool.'), {status:502});
  return data;
}
module.exports = {fetchSheet};
