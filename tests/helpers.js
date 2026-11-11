// Pomůcky pro testy: spuštění skutečného serveru na volném portu s dočasnými daty a „boti“.
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.join(__dirname, '..');

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}

function spawnServer(port, dataDir, env) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('Server nenaběhl')), 15000);
    proc.stdout.on('data', d => { if (String(d).includes('běží')) { clearTimeout(t); res(proc); } });
    proc.on('exit', c => { clearTimeout(t); rej(new Error('Server skončil: ' + c)); });
  });
}

async function startServer(env = {}) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dopisto-test-'));
  let proc = await spawnServer(port, dataDir, env);
  const url = `http://127.0.0.1:${port}`;
  const bots = [];
  return {
    url, port, dataDir,
    bot(opts = {}) { const b = connect(url, opts); bots.push(b); return b; },
    // Limit je 10 spojení z jedné IP – po každém testu boty zavřeme.
    async closeBots() { bots.splice(0).forEach(b => b.close()); await sleep(120); },
    // Restart se stejnými daty (ověření, že se věci ukládají na disk).
    async restart() {
      bots.splice(0).forEach(b => b.close());
      proc.kill('SIGTERM');
      await new Promise(r => proc.once('exit', r));
      proc = await spawnServer(port, dataDir, env);
    },
    async stop() {
      bots.forEach(b => b.close());
      proc.kill('SIGTERM');
      await new Promise(r => proc.once('exit', r));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

// Bot: socket + zaznamenané události + čekání na událost.
function connect(url, opts = {}) {
  const socket = io(url, { transports: ['websocket'], forceNew: true, extraHeaders: opts.headers, reconnection: false });
  const log = [];
  const waiters = [];
  socket.onAny((ev, data) => {
    log.push({ ev, data });
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (w.ev === ev && (!w.pred || w.pred(data))) { waiters.splice(i, 1); clearTimeout(w.t); w.res(data); }
    }
  });
  const bot = {
    socket, log,
    emit: (ev, data) => socket.emit(ev, data),
    count: ev => log.filter(l => l.ev === ev).length,
    last: ev => { const l = log.filter(x => x.ev === ev); return l.length ? l[l.length - 1].data : undefined; },
    wait(ev, pred, ms = 6000) {
      const old = log.find(l => l.ev === ev && (!pred || pred(l.data)));
      if (old && opts.replay) return Promise.resolve(old.data);
      return new Promise((res, rej) => {
        const w = { ev, pred, res, t: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); rej(new Error(`Timeout čekání na "${ev}"`)); }, ms) };
        waiters.push(w);
      });
    },
    close: () => socket.close(),
    connected: new Promise((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); }),
  };
  return bot;
}


// Dvojice botů v soukromém duelu (mód 1 = „1 písmeno“ je 'speed'? — mód předáváme z testu).
async function startDuel(srv, mode, nickA, nickB) {
  const a = srv.bot(), b = srv.bot();
  await Promise.all([a.connected, b.connected]);
  a.emit('create_lobby', { nickname: nickA, mode });
  const { code } = await a.wait('lobby_created');
  const fa = a.wait('match_found'), fb = b.wait('match_found');
  b.emit('join_lobby', { nickname: nickB, code });
  const [ma, mb] = await Promise.all([fa, fb]);
  const players = [ma.youAre === 0 ? a : b, ma.youAre === 0 ? b : a]; // podle indexu hráče
  return { a, b, ma, mb, players, roomId: ma.roomId, pattern: ma.pattern };
}

module.exports = { startServer, connect, sleep, freePort, ROOT };
