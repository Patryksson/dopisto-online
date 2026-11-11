const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, sleep } = require('./helpers');
const { matchesPattern } = require('../server/dictionary');

const WORDS = fs.readFileSync(path.join(__dirname, '..', 'server', 'data', 'words.txt'), 'utf8')
  .split('\n').map(w => w.trim()).filter(w => w.length > 3);

let srv;
test.before(async () => { srv = await startServer(); });
test.afterEach(async () => { await srv.closeBots(); });
test.after(async () => { await srv.stop(); });

async function lobby(n) {
  const bots = Array.from({ length: n }, () => srv.bot());
  await Promise.all(bots.map(b => b.connected));
  bots[0].emit('br_create_lobby', { nickname: 'Host1' });
  const l = await bots[0].wait('br_lobby');
  for (let i = 1; i < n; i++) bots[i].emit('br_join_lobby', { nickname: 'Hrac' + i, code: l.code });
  for (let i = 0; i < 40 && !(bots[0].last('br_lobby') || { players: [] }).players.length >= n; i++) await sleep(50);
  return { bots, code: l.code };
}

test('Royale lobby: neznámý kód; páté připojení hru automaticky spustí a další se už nepřipojí', async () => {
  const x = srv.bot(); await x.connected;
  x.emit('br_join_lobby', { nickname: 'Nikdo', code: 'NOPE1' });
  assert.match((await x.wait('br_error')).message, /Kód/);
  const { bots, code } = await lobby(5);
  const f = await bots[0].wait('br_found', null, 3000).catch(() => bots[0].last('br_found'));
  assert.equal(f.players.length, 5);
  const y = srv.bot(); await y.connected;
  y.emit('br_join_lobby', { nickname: 'Sesty', code });
  await y.wait('br_error');
  assert.equal(y.count('br_found'), 0);
});

test('Royale lobby: nastavení času tahu jen z povolených hodnot', async () => {
  const a = srv.bot(); await a.connected;
  a.emit('br_create_lobby', { nickname: 'Cas', turnSec: 20 });
  assert.equal((await a.wait('br_lobby')).turnSec, 20);
  const b = srv.bot(); await b.connected;
  b.emit('br_create_lobby', { nickname: 'Cas2', turnSec: 9999 });
  assert.equal((await b.wait('br_lobby')).turnSec, 15);
});

test('Royale lobby: start s jedním hráčem nespustí hru; hostem start jde, ostatní ne', async () => {
  const a = srv.bot(); await a.connected;
  a.emit('br_create_lobby', { nickname: 'Sam' });
  await a.wait('br_lobby');
  a.emit('br_start_lobby');
  await sleep(300);
  assert.equal(a.count('br_found'), 0);
  const { bots } = await lobby(3);
  bots[1].emit('br_start_lobby');
  await sleep(300);
  assert.equal(bots[1].count('br_found'), 0);
  bots[0].emit('br_start_lobby');
  const f = await bots[0].wait('br_found');
  assert.equal(f.players.length, 3);
});

test('Royale: platné slovo přepne tah, tah mimo pořadí se ignoruje', async () => {
  const { bots } = await lobby(3);
  bots[0].emit('br_start_lobby');
  const f = await bots[0].wait('br_found');
  await bots[0].wait('br_tick', t => t.phase === 'turn', 8000);
  const names = ['Host1', 'Hrac1', 'Hrac2'];
  const turn = bots[0].last('br_tick').turn;
  const mover = bots[names.indexOf(f.players.find(p => p.seat === turn).name)];
  const other = bots[names.indexOf(f.players.find(p => p.seat === (turn + 1) % 3).name)];
  const pattern = (bots[0].last('br_state') || f.state).pattern;
  const w = WORDS.find(x => matchesPattern(x, pattern));
  const base = bots[0].count('br_state');
  other.emit('br_submit_word', { roomId: f.roomId, word: w });
  await sleep(300);
  assert.equal(bots[0].count('br_state'), base, 'cizí tah se nezapočítal');
  mover.emit('br_submit_word', { roomId: f.roomId, word: w });
  const s = await bots[0].wait('br_state', st => st.usedCount === 1);
  assert.notEqual(s.turn, turn);
  assert.equal(s.players.length, 3);
});

test('Royale: odchod hráče z rozehrané hry ho vyřadí', async () => {
  const { bots } = await lobby(3);
  bots[0].emit('br_start_lobby');
  const f = await bots[0].wait('br_found');
  await bots[0].wait('br_tick', t => t.phase === 'turn', 8000);
  bots[1].emit('br_leave', { roomId: f.roomId });
  const s = await bots[0].wait('br_state', st => st.players.some(p => p.name === 'Hrac1' && (p.left || !p.alive)), 6000);
  assert.ok(s);
});
