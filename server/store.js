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

// ==== Hlášení chyb / nahlášení hráčů (soubor reports.json, max 500 záznamů) ====
const REPORTS_FILE = path.join(__dirname, 'data', 'reports.json');
function addReport(r) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8')); } catch {}
  list.push({ ...r, at: new Date().toISOString() });
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(list.slice(-500), null, 1));
}

module.exports = { addReport, getProfile, recordResult, leaderboard, recordDaily, dailyLeaderboard };
