const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'elo.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

let db = load();

function save() {
  fs.writeFileSync(FILE, JSON.stringify(db));
}

function key(nickname) {
  return nickname.trim().toLowerCase();
}

function getProfile(mode, nickname) {
  const m = db[mode] || (db[mode] = {});
  const k = key(nickname);
  if (!m[k]) m[k] = { name: nickname, elo: 1000, wins: 0, losses: 0 };
  return m[k];
}

function recordResult(mode, winnerName, loserName) {
  const winner = getProfile(mode, winnerName);
  const loser = getProfile(mode, loserName);
  const { computeElo } = require('./elo');
  const newWinnerElo = computeElo(winner.elo, loser.elo, 1);
  const newLoserElo = computeElo(loser.elo, winner.elo, 0);
  const before = { winner: winner.elo, loser: loser.elo };
  winner.elo = newWinnerElo;
  winner.wins += 1;
  winner.name = winnerName;
  loser.elo = newLoserElo;
  loser.losses += 1;
  loser.name = loserName;
  save();
  return { before, after: { winner: newWinnerElo, loser: newLoserElo } };
}

function leaderboard(mode, limit = 100) {
  const m = db[mode] || {};
  return Object.values(m)
    .sort((a, b) => b.elo - a.elo)
    .slice(0, limit)
    .map(p => ({ name: p.name, elo: p.elo, wins: p.wins, losses: p.losses }));
}

// ==== Denní výzva — nejlepší výsledek každé přezdívky za daný den (UTC) ====
function utcDateKey(d = new Date()) { return d.toISOString().slice(0, 10); }

function recordDaily(nickname, wordCount) {
  const day = utcDateKey();
  const daily = db.daily || (db.daily = {});
  const today = daily[day] || (daily[day] = {});
  const k = key(nickname);
  if (!today[k] || today[k].count < wordCount) today[k] = { name: nickname, count: wordCount };
  // uchovej jen posledních 7 dní
  Object.keys(daily).sort().slice(0, -7).forEach(d => delete daily[d]);
  save();
}

function dailyLeaderboard(limit = 20) {
  const today = (db.daily && db.daily[utcDateKey()]) || {};
  return Object.values(today).sort((a, b) => b.count - a.count).slice(0, limit);
}

// Statistiky dne: percentil, medián, průměr a rozložení. Počítají se jen
// dokončené pokusy (aspoň MIN_WORDS slov), ať průměr nestrhávají okamžitě ukončené hry.
const MIN_WORDS = 3, MIN_PLAYERS = 5;
function dailyStats(nickname, wordCount) {
  const daily = db.daily || {};
  const today = Object.values(daily[utcDateKey()] || {}).map(e => e.count).filter(c => c >= MIN_WORDS).sort((a, b) => a - b);
  const out = { total: today.length, enough: today.length >= MIN_PLAYERS };
  if (out.enough) {
    const below = today.filter(c => c < wordCount).length;
    const equal = today.filter(c => c === wordCount).length;
    out.percentile = Math.max(1, Math.min(99, Math.round(((below + equal / 2) / today.length) * 100)));
    out.avg = Math.round((today.reduce((a, b) => a + b, 0) / today.length) * 10) / 10;
    const m = today.length >> 1;
    out.median = today.length % 2 ? today[m] : Math.round(((today[m - 1] + today[m]) / 2) * 10) / 10;
    const bins = {};
    today.forEach(c => { const b = Math.floor(c / 5) * 5; bins[b] = (bins[b] || 0) + 1; });
    const myBin = Math.floor(wordCount / 5) * 5;
    const max = Math.max(...Object.values(bins), 1);
    const keys = Object.keys(bins).map(Number);
    const lo = Math.min(...keys, myBin), hi = Math.max(...keys, myBin);
    out.hist = [];
    for (let b = lo; b <= hi; b += 5) out.hist.push({ from: b, n: bins[b] || 0, h: (bins[b] || 0) / max, me: b === myBin });
  }
  // týden: tvůj průměr vs. průměr všech (jen dokončené pokusy)
  const k = key(nickname || '');
  let all = [], mine = [];
  Object.values(daily).forEach(day => Object.entries(day).forEach(([kk, e]) => {
    if (e.count < MIN_WORDS) return;
    all.push(e.count); if (kk === k) mine.push(e.count);
  }));
  if (mine.length >= 2 && all.length >= MIN_PLAYERS) {
    const av = a => Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10;
    out.week = { mine: av(mine), all: av(all), days: mine.length };
  }
  return out;
}

// ==== Hlášení chyb / nahlášení hráčů (soubor reports.json, max 500 záznamů) ====
const REPORTS_FILE = path.join(__dirname, 'data', 'reports.json');
function addReport(r) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8')); } catch {}
  list.push({ ...r, at: new Date().toISOString() });
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(list.slice(-500), null, 1));
}

module.exports = { addReport, getProfile, recordResult, leaderboard, recordDaily, dailyLeaderboard, dailyStats };
