'use strict';
// Toujours éveillé : le serveur ouvre sa propre adresse publique pour que Render ne l'endorme pas.
const test = require('node:test'), assert = require('node:assert/strict');
const E = require('./garder-eveille.cjs');

test('Adresse visitée : seulement sur Render ou avec GUARDIAN_KEEPALIVE_URL, en https', () => {
  assert.equal(E.target({}), '', 'en local, rien ne tourne');
  assert.equal(E.target({GUARDIAN_ORIGIN: 'https://fibre-guardian-moov.onrender.com'}), '', 'sans RENDER, rien');
  assert.equal(E.target({RENDER: 'true', GUARDIAN_ORIGIN: 'https://fibre-guardian-moov.onrender.com'}), 'https://fibre-guardian-moov.onrender.com/api/health');
  assert.equal(E.target({RENDER: 'true', RENDER_EXTERNAL_URL: 'https://autre.onrender.com'}), 'https://autre.onrender.com/api/health');
  assert.equal(E.target({GUARDIAN_KEEPALIVE_URL: 'https://exemple.ci/'}), 'https://exemple.ci/api/health');
  assert.equal(E.target({GUARDIAN_KEEPALIVE_URL: 'http://exemple.ci/'}), '', 'jamais en http');
  assert.equal(E.target({RENDER: 'true', GUARDIAN_ORIGIN: 'https://x.onrender.com', GUARDIAN_KEEPALIVE: '0'}), '', 'GUARDIAN_KEEPALIVE=0 arrête tout');
  assert.ok(E.EVERY_MS < 15 * 60 * 1000, 'plus souvent que la mise en veille de Render (15 min)');
});

test('Visite régulière, panne signalée une seule fois puis retour signalé', async () => {
  const logs = [], calls = [];
  let tick = null, cleared = false, ok = true;
  const stop = E.start({RENDER: 'true', GUARDIAN_ORIGIN: 'https://x.onrender.com'}, {
    log: m => logs.push(m),
    fetchImpl: async url => { calls.push(url); if (!ok) throw new Error('hors ligne'); return {ok: true, status: 200}; },
    setTimer: (fn, ms) => { tick = fn; assert.equal(ms, E.EVERY_MS); return {unref() {}}; },
    clearTimer: () => { cleared = true; },
  });
  assert.equal(typeof stop, 'function');
  assert.match(logs[0], /Toujours éveillé : visite de https:\/\/x\.onrender\.com\/api\/health toutes les 10 minutes/);
  await tick();
  assert.deepEqual(calls, ['https://x.onrender.com/api/health']);
  ok = false; await tick(); await tick();
  assert.equal(logs.filter(l => /visite manquée/.test(l)).length, 1, 'une seule ligne par panne');
  ok = true; await tick();
  assert.match(logs.at(-1), /répond de nouveau/);
  stop(); assert.ok(cleared);
  assert.equal(E.start({}, {setTimer: () => assert.fail('rien ne doit tourner en local')}), null);
});
