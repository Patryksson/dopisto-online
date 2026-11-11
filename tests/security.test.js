const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, sleep } = require('./helpers');

let srv;
test.before(async () => { srv = await startServer(); });
test.afterEach(async () => { await srv.closeBots(); });
test.after(async () => { await srv.stop(); });

const get = async (p) => fetch(srv.url + p);

test('HTTP: bezpečnostní hlavičky, bez X-Powered-By', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('HTTP: server nevydává zdrojáky serveru ani data', async () => {
  for (const p of ['/server/index.js', '/server/data/elo.json', '/server/data/reports.json', '/package.json', '/../package.json', '/.env']) {
    const r = await get(p);
    const body = await r.text();
    assert.ok(r.status === 404 || /<!doctype html>/i.test(body), p + ' → ' + r.status);
    assert.ok(!body.includes('require('), p + ' nesmí vydat kód');
  }
});

test('HTTP: __ORIGIN__ se v indexu i service workeru nahradí a nevypíše se podvržený Host', async () => {
  const html = await (await get('/')).text();
  assert.ok(!html.includes('__ORIGIN__'));
  const r = await fetch(srv.url + '/', { headers: { 'X-Forwarded-Host': '"><script>alert(1)</script>' } });
  assert.ok(!(await r.text()).includes('<script>alert(1)'));
});

test('přezdívky přes socket: HTML se neprosadí, vulgarismus/rezervované jméno ano odmítnuto', async () => {
  const a = srv.bot(); await a.connected;
  a.emit('create_lobby', { nickname: '<img src=x onerror=1>', mode: 2 });
  const l = await a.wait('lobby_created', null, 3000).catch(() => null);
  const b = srv.bot(); await b.connected;
  if (l) {
    b.emit('join_lobby', { nickname: 'Dobry', code: l.code });
    const m = await b.wait('match_found');
    assert.doesNotMatch(m.opponent, /[<>"']/);
  }
  b.emit('create_lobby', { nickname: 'аdmin', mode: 2 });
  await b.wait('nickname_rejected');
});

test('nesmyslné payloady nezpůsobí pád serveru', async () => {
  const a = srv.bot(); await a.connected;
  for (const ev of ['find_match', 'create_lobby', 'join_lobby', 'submit_word', 'start_daily_challenge', 'br_create_lobby', 'br_join_lobby', 'submit_report']) {
    for (const bad of [null, 5, 'x', [], { nickname: {} }, { code: {} }]) a.emit(ev, bad);
  }
  await sleep(400);
  const b = srv.bot(); await b.connected;   // server stále žije
  const n = await new Promise(r => b.socket.emit('get_online', r));
  assert.ok(n >= 1);
});

test('rate limit: spamování události odpojí socket', async () => {
  const a = srv.bot(); await a.connected;
  const gone = new Promise(r => a.socket.on('disconnect', r));
  for (let i = 0; i < 200; i++) a.emit('find_match', { nickname: 'Spam' + i, mode: 2 });
  await Promise.race([gone, sleep(4000).then(() => { throw new Error('socket nebyl odpojen'); })]);
});

test('příliš velký paket je odmítnut (maxHttpBufferSize)', async () => {
  const a = srv.bot(); await a.connected;
  const gone = new Promise(r => a.socket.on('disconnect', r));
  a.emit('submit_report', { type: 'bug', text: 'x'.repeat(50 * 1024) });
  await Promise.race([gone, sleep(3000).then(() => { throw new Error('velký paket prošel'); })]);
});

test('hlášení: platné se uloží, příliš krátké ne, limit 5/hod na IP', async () => {
  const res = [];
  for (let i = 0; i < 7; i++) {
    const a = srv.bot(); await a.connected;
    const r = await new Promise(ok => a.socket.emit('submit_report', { type: 'bug', text: 'Něco se rozbilo ' + i, contact: '', nickname: 'T' }, ok));
    res.push(r);
    a.close(); await sleep(60);
  }
  assert.equal(res.slice(0, 5).every(r => r.ok), true);
  assert.equal(res[5].ok, false);
  assert.match(res[5].message, /hodně hlášení/);
  const saved = JSON.parse(fs.readFileSync(path.join(srv.dataDir, 'reports.json'), 'utf8'));
  assert.equal(saved.length, 5);
});

test('hlášení: krátký text je odmítnut hned', async () => {
  const a = srv.bot(); await a.connected;
  const r = await new Promise(ok => a.socket.emit('submit_report', { type: 'bug', text: 'ab' }, ok));
  assert.equal(r.ok, false);
});

test('limit spojení z jedné IP (10) a podvržená X-Forwarded-For ho neobejde', async () => {
  const { connect } = require('./helpers');
  const ok = [], bad = [];
  const socks = [];
  for (let i = 0; i < 14; i++) {
    const b = connect(srv.url, { headers: { 'X-Forwarded-For': `9.9.9.${i}, 5.5.5.5` } });  // proxy připojí skutečnou IP na konec; podvržená je jen první položka
    socks.push(b);
    await Promise.race([b.connected.then(() => ok.push(i)), new Promise(r => b.socket.on('connect_error', () => { bad.push(i); r(); }))]);
  }
  socks.forEach(s => s.close());
  assert.ok(ok.length <= 10, `prošlo ${ok.length} spojení`);
  assert.ok(bad.length >= 4);
});
