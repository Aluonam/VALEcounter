const assert = require('assert');
const { Game } = require('../public/game.js');

let t = 1_000_000;
const events = [];
const g = new Game({ now: () => t, onEvent: (e) => events.push(e) });
['a', 'b', 'c'].forEach((id) => g.join(id, id.toUpperCase()));
g.bet('a', 3); g.bet('b', 10); g.bet('c', 4);
g.start('Laura');

// Una sola persona no basta
g.tap('a'); assert.strictEqual(g.state.vales.length, 0);
// Misma persona dos veces tampoco
t += 300; g.tap('a'); assert.strictEqual(g.state.vales.length, 0);
// Segunda persona dentro de la ventana -> cuenta
t += 500; g.tap('b'); assert.strictEqual(g.state.vales.length, 1);
assert.strictEqual(g.state.vales[0].first, 'a');
// Rezagado en el cooldown no abre otro vale
t += 300; g.tap('c'); t += 100; g.tap('a'); assert.strictEqual(g.state.vales.length, 1);
// Fuera de ventana: no cuenta
t += 5000; g.tap('a'); t += 2500; g.tap('b'); assert.strictEqual(g.state.vales.length, 1);
// Dos vales rápidos más -> metralleta
t += 100; g.tap('c'); assert.strictEqual(g.state.vales.length, 2);
t += 1500; g.tap('b'); t += 200; g.tap('a'); assert.strictEqual(g.state.vales.length, 3);
const keys = g.state.achievements.map((a) => a.key);
assert(keys.includes('primera-sangre') && keys.includes('metralleta'), keys);

// Silencio sepulcral
t += 121_000; g.tick();
assert(g.state.achievements.some((a) => a.key === 'silencio-sepulcral'));

const r = g.finish();
assert.strictEqual(r.total, 3);
assert.deepStrictEqual(r.betWinners.map((w) => w.name), ['A']);
assert(g.state.achievements.some((a) => a.key === 'oraculo' && a.user === 'A'));
assert.strictEqual(r.perMinute.reduce((x, y) => x + y, 0), 3);
assert.strictEqual(r.podium[0].name, 'B');

g.reset();
assert.strictEqual(g.state.phase, 'lobby');
assert.strictEqual(g.state.users.a.bet, null);
console.log('OK: todas las pruebas pasan');
