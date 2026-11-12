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
