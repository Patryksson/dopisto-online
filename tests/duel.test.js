const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, sleep } = require('./helpers');

const WORDS = fs.readFileSync(path.join(__dirname, '..', 'server', 'data', 'words.txt'), 'utf8')
  .split('\n').map(w => w.trim()).filter(w => w.length >= 4 && w.startsWith('ko'));

let srv;
test.before(async () => { srv = await startServer(); });
test.afterEach(async () => { await srv.closeBots(); });
test.after(async () => { await srv.stop(); });

// soukromý duel v režimu „2 písmena“ s pevným zadáním „ko“
async function duel(nickA, nickB) {
  const a = srv.bot(), b = srv.bot();
  await Promise.all([a.connected, b.connected]);
  a.emit('create_lobby', { nickname: nickA, mode: 2, pattern: 'ko' });
  const { code, pattern } = await a.wait('lobby_created');
  assert.equal(pattern, 'ko');
  const fa = a.wait('match_found'), fb = b.wait('match_found');
  b.emit('join_lobby', { nickname: nickB, code });
  const [ma, mb] = await Promise.all([fa, fb]);
  const p = ma.youAre === 0 ? [a, b] : [b, a];
  return { a, b, ma, mb, roomId: ma.roomId, byIdx: p, first: ma.turn };
}

test('lobby: špatný kód, připojení k sobě, nepovolené zadání', async () => {
  const a = srv.bot(); await a.connected;
  a.emit('join_lobby', { nickname: 'Tester', code: 'ZZZZZ' });
  assert.match((await a.wait('lobby_error')).message, /Kód/);
  a.emit('create_lobby', { nickname: 'Tester', mode: 2, pattern: 'qq' });
  assert.match((await a.wait('lobby_error', d => /zadání/.test(d.message))).message, /zadání/);
  a.emit('create_lobby', { nickname: 'Tester', mode: 2 });
  const { code } = await a.wait('lobby_created');
  assert.match(code, /^[A-HJ-KM-NP-Z2-9]{5}$/);
  a.emit('join_lobby', { nickname: 'Tester', code });
  assert.match((await a.wait('lobby_error', d => /sám/.test(d.message))).message, /sám/);
});

test('lobby: neplatný režim se ignoruje, nevhodná přezdívka je odmítnuta', async () => {
  const a = srv.bot(); await a.connected;
  a.emit('create_lobby', { nickname: 'Dobry', mode: 'hacker' });
  a.emit('create_lobby', { nickname: 'admin', mode: 2 });
  await a.wait('nickname_rejected');
  await sleep(150);
  assert.equal(a.count('lobby_created'), 0);
});

test('duel: platné slovo projde a přepne tah', async () => {
  const d = await duel('Alice', 'Bob');
  await sleep(100);
  const mover = d.byIdx[d.first];
  const st = mover.wait('state_update', s => s.usedWordsCount === 1);
  mover.emit('submit_word', { roomId: d.roomId, word: WORDS[0] });
  const s = await st;
  assert.notEqual(s.turn, d.first);
});

test('duel: slovo mimo zadání je odmítnuto bez trestu, tah zůstává', async () => {
  const d = await duel('Carl', 'Dana');
  const mover = d.byIdx[d.first];
  mover.emit('submit_word', { roomId: d.roomId, word: 'pes' });
  const r = await mover.wait('word_rejected');
  assert.match(r.reason, /začínat/);
  assert.equal(r.penaltyMs, undefined);
});

test('duel: duplicita a slovo mimo slovník = trest času', async () => {
  const d = await duel('Eda', 'Fanda');
  const m0 = d.byIdx[0], m1 = d.byIdx[1];
  const first = d.byIdx[d.first], second = d.byIdx[1 - d.first];
  first.emit('submit_word', { roomId: d.roomId, word: WORDS[1] });
  await second.wait('state_update', s => s.usedWordsCount === 1);
  second.emit('submit_word', { roomId: d.roomId, word: WORDS[1] });
  const dup = await second.wait('word_rejected');
  assert.match(dup.reason, /použito/); assert.ok(dup.penaltyMs > 0);
  second.emit('submit_word', { roomId: d.roomId, word: 'kozzzzq' });
  const nd = await second.wait('word_rejected', r => /slovníku/.test(r.reason));
  assert.ok(nd.penaltyMs > 0);
});

test('duel: tah mimo pořadí a cizí místnost se ignorují', async () => {
  const d = await duel('Gita', 'Hugo');
  const notMover = d.byIdx[1 - d.first];
  notMover.emit('submit_word', { roomId: d.roomId, word: WORDS[2] });
  const outsider = srv.bot(); await outsider.connected;
  outsider.emit('submit_word', { roomId: d.roomId, word: WORDS[2] });
  await sleep(300);
  assert.equal(d.a.count('word_rejected') + d.b.count('word_rejected'), 0);
  assert.equal(outsider.count('state_update'), 0);
  // ani po těchto pokusech není slovo „spotřebováno“
  const mover = d.byIdx[d.first];
  const st = mover.wait('state_update', s => s.usedWordsCount === 1);
  mover.emit('submit_word', { roomId: d.roomId, word: WORDS[2] });
  await st;
});

test('duel: vzdání = výhra soupeře, ELO se změní a uloží', async () => {
  const d = await duel('Ivo', 'Jana');
  const loser = d.byIdx[0];
  const over = d.a.wait('game_over');
  loser.emit('give_up', { roomId: d.roomId });
  const g = await over;
  assert.equal(g.reason, 'giveup');
  assert.equal(g.winnerIdx, 1);
  assert.ok(g.results[1].after > g.results[1].before);
  assert.ok(g.results[0].after < g.results[0].before);
  const saved = JSON.parse(fs.readFileSync(path.join(srv.dataDir, 'elo.json'), 'utf8'));
  assert.equal(saved['2'][g.results[1].name.toLowerCase()].wins, 1);
});

test('duel: odveta – žádost, přijetí, nový zápas se stejným zadáním režimu', async () => {
  const d = await duel('Karel', 'Lenka');
  d.byIdx[0].emit('give_up', { roomId: d.roomId });
  await d.a.wait('game_over'); await d.b.wait('game_over');
  d.a.emit('rematch_request', { roomId: d.roomId });
  await d.b.wait('rematch_offered');
  const na = d.a.wait('match_found', m => m.roomId !== d.roomId), nb = d.b.wait('match_found', m => m.roomId !== d.roomId);
  d.b.emit('rematch_accept', { roomId: d.roomId });
  const [x, y] = await Promise.all([na, nb]);
  assert.notEqual(x.roomId, d.roomId);
  assert.equal(x.roomId, y.roomId);
  assert.notEqual(x.youAre, y.youAre);
});

test('duel: odveta po odchodu soupeře není možná', async () => {
  const d = await duel('Milan', 'Nela');
  d.byIdx[0].emit('give_up', { roomId: d.roomId });
  await d.a.wait('game_over');
  d.b.emit('result_left', { roomId: d.roomId });
  await sleep(150);
  d.a.emit('rematch_request', { roomId: d.roomId });
  const r = await d.a.wait('rematch_unavailable');
  assert.ok(r.reason);
});

test('matchmaking: dva hráči ve frontě se spárují, stejná přezdívka ne', async () => {
  const a = srv.bot(), b = srv.bot(), c = srv.bot(), d = srv.bot();
  await Promise.all([a, b, c, d].map(x => x.connected));
  a.emit('find_match', { nickname: 'Same', mode: 2 });
  b.emit('find_match', { nickname: 'Same', mode: 2 });
  await sleep(1800);
  assert.equal(a.count('match_found') + b.count('match_found'), 0);
  c.emit('find_match', { nickname: 'Oto', mode: 2 });
  const [ma] = await Promise.all([c.wait('match_found', null, 15000)]);
  assert.ok(ma.opponent === 'Same');
  c.emit('cancel_find_match'); d.emit('cancel_find_match');
});

test('matchmaking: zrušení hledání vyřadí z fronty', async () => {
  const a = srv.bot(), b = srv.bot(); await Promise.all([a.connected, b.connected]);
  a.emit('find_match', { nickname: 'Zrus', mode: 'middle' });
  await a.wait('waiting_for_opponent');
  a.emit('cancel_find_match');
  await sleep(100);
  b.emit('find_match', { nickname: 'Dalsi', mode: 'middle' });
  await sleep(2500);
  assert.equal(a.count('match_found') + b.count('match_found'), 0);
});
