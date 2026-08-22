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

function leaderboard(mode, limit = 50) {
  const m = db[mode] || {};
  return Object.values(m)
    .sort((a, b) => b.elo - a.elo)
    .slice(0, limit)
    .map(p => ({ name: p.name, elo: p.elo, wins: p.wins, losses: p.losses }));
}

module.exports = { getProfile, recordResult, leaderboard };
