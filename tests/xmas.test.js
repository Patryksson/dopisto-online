const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load() {
  const ctx = { window: {}, document: { addEventListener() {}, hidden: false, documentElement: { classList: { add() {} } }, querySelector: () => null, createElement: () => ({ setAttribute() {} }), body: { appendChild() {} } },
    location: { search: '' }, addEventListener() {}, matchMedia: () => ({ matches: false }), innerWidth: 800, innerHeight: 600, localStorage: { getItem: () => null, setItem() {} }, URLSearchParams, Date };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'client', 'xmas.js'), 'utf8'), ctx);
  return ctx.xmasSeason;
}

test('vánoční sezóna: 1. advent až 6. ledna', () => {
  const s = load();
  assert.equal(s(new Date(2026, 10, 28)), false);   // den před 1. adventem 2026 (29. 11.)
  assert.equal(s(new Date(2026, 10, 29)), true);
  assert.equal(s(new Date(2026, 11, 24)), true);
  assert.equal(s(new Date(2027, 0, 6)), true);
  assert.equal(s(new Date(2027, 0, 7)), false);
  assert.equal(s(new Date(2027, 5, 1)), false);
  assert.equal(s(new Date(2027, 10, 27)), false);   // 2027: 25. 12. je sobota → 1. advent 28. 11.
  assert.equal(s(new Date(2027, 10, 28)), true);
});
