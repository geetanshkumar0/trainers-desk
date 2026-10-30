'use strict';
/* Minimal SMTP client using node:net and node:tls. Supports implicit TLS (port 465), STARTTLS, AUTH PLAIN/LOGIN. */
const net = require('node:net');
const tls = require('node:tls');
const os = require('node:os');
const crypto = require('node:crypto');

function encodeHeader(s) { return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`; }
function addr(s) { const m = String(s).match(/<([^>]+)>/); return (m ? m[1] : String(s)).trim(); }
function wrap64(buf) { return buf.toString('base64').replace(/.{1,76}/g, '$&\r\n'); }

function sendMail(cfg, msg, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let sock, buf = '', step = 0, features = '', done = false;
    const fail = e => { if (done) return; done = true; try { sock.destroy(); } catch (x) {} reject(e instanceof Error ? e : new Error(String(e))); };
    const timer = setTimeout(() => fail(new Error('SMTP server did not respond in time.')), timeoutMs);
    const write = line => sock.write(line + '\r\n');
    const fromAddr = addr(cfg.from), toAddr = addr(msg.to);
    const fromName = String(cfg.from).includes('<') ? String(cfg.from).split('<')[0].trim().replace(/^"|"$/g, '') : '';
    const data = [
      `From: ${fromName ? `${encodeHeader(fromName)} <${fromAddr}>` : fromAddr}`, `To: ${msg.toName ? `${encodeHeader(msg.toName)} <${toAddr}>` : toAddr}`,
      `Subject: ${encodeHeader(msg.subject)}`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${fromAddr.split('@')[1] || 'kcpicktimer'}>`,
      'MIME-Version: 1.0', ...(msg.html ? (b => [`Content-Type: multipart/alternative; boundary="${b}"`, '', `--${b}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap64(Buffer.from(msg.body || '', 'utf8')),
        `--${b}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap64(Buffer.from(msg.html, 'utf8')), `--${b}--`])('kc-' + crypto.randomBytes(12).toString('hex'))
        : ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap64(Buffer.from(msg.body, 'utf8'))])].join('\r\n');
    const queue = [];
    const plan = () => {
      queue.length = 0;
      if (cfg.user) { if (/AUTH[^\n]*PLAIN/i.test(features)) queue.push(['AUTH PLAIN ' + Buffer.from(`\0${cfg.user}\0${cfg.pass || ''}`).toString('base64'), 235]);
        else { queue.push(['AUTH LOGIN', 334], [Buffer.from(cfg.user).toString('base64'), 334], [Buffer.from(cfg.pass || '').toString('base64'), 235]); } }
      queue.push([`MAIL FROM:<${fromAddr}>`, 250], [`RCPT TO:<${toAddr}>`, [250, 251]], ['DATA', 354], [data + '\r\n.', 250], ['QUIT', 221]);
    };
    const onLine = (code, text, last) => {
      if (!last) { if (step === 1 || step === 3) features += text + '\n'; return; }
      if (step === 0) { if (code !== 220) return fail(new Error(`SMTP greeting failed: ${code} ${text}`)); step = 1; features = ''; return write(`EHLO ${os.hostname() || 'kcpicktimer'}`); }
      if (step === 1) {
        if (code !== 250) return fail(new Error(`EHLO failed: ${code} ${text}`)); features += text;
        if (!cfg.secure && /STARTTLS/i.test(features) && !(sock instanceof tls.TLSSocket)) { step = 2; return write('STARTTLS'); }
        step = 4; plan(); return next(null);
      }
      if (step === 2) {
        if (code !== 220) return fail(new Error(`STARTTLS failed: ${code} ${text}`));
        const plain = sock; plain.removeAllListeners('data');
        sock = tls.connect({socket:plain, servername:cfg.host, rejectUnauthorized:cfg.rejectUnauthorized !== false}, () => { step = 3; features = ''; write(`EHLO ${os.hostname() || 'kcpicktimer'}`); });
        sock.on('data', onData); sock.on('error', fail); return;
      }
      if (step === 3) { if (code !== 250) return fail(new Error(`EHLO after STARTTLS failed: ${code}`)); features += text; step = 4; plan(); return next(null); }
      return next(code, text);
    };
    let pending = null;
    const next = (code, text) => {
      if (pending) { const ok = Array.isArray(pending[1]) ? pending[1].includes(code) : code === pending[1]; if (!ok) return fail(new Error(`SMTP error after "${pending[0].split(' ')[0]}": ${code} ${text}`)); if (pending[0] === 'QUIT') { done = true; clearTimeout(timer); sock.end(); return resolve({ok:true}); } }
      pending = queue.shift(); if (!pending) return; write(pending[0]);
    };
    const onData = chunk => {
      buf += chunk.toString('utf8'); let i;
      while ((i = buf.indexOf('\r\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); const m = line.match(/^(\d{3})([ -])(.*)$/); if (m) onLine(Number(m[1]), m[3], m[2] === ' '); }
    };
    sock = cfg.secure ? tls.connect({host:cfg.host, port:cfg.port || 465, servername:cfg.host, rejectUnauthorized:cfg.rejectUnauthorized !== false}) : net.connect({host:cfg.host, port:cfg.port || 587});
    sock.on('data', onData); sock.on('error', fail); sock.on('close', () => { if (!done) fail(new Error('SMTP connection closed unexpectedly.')); });
  });
}
module.exports = {sendMail};
