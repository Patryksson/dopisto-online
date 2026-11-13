const test = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./helpers');

test('hlavičky zabezpečení: CSP na stránce, HSTS jen přes HTTPS', async () => {
  const srv = await startServer();
  try {
    const r = await fetch(srv.url + '/');
    const csp = r.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.equal(r.headers.get('strict-transport-security'), null);   // obyčejné HTTP
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    const s = await fetch(srv.url + '/', { headers: { 'x-forwarded-proto': 'https' } });
    assert.match(s.headers.get('strict-transport-security') || '', /max-age=\d+/);
  } finally { await srv.stop(); }
});

test('hudba při hledání: MP3 se servíruje a v nastavení je výchozí vypnuto', async () => {
  const srv = await startServer();
  try {
    const r = await fetch(srv.url + '/audio/search-loop-v1.mp3');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'audio/mpeg');
    assert.ok((await r.arrayBuffer()).byteLength > 100000);
    const js = await (await fetch(srv.url + '/app.js')).text();
    assert.match(js, /searchMusic:(false|!1)/);
  } finally { await srv.stop(); }
});
