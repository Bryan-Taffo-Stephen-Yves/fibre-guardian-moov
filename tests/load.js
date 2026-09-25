// Charge les modules du navigateur dans Node, dans le même ordre que index.html.
const path = require('node:path');
const src = p => require(path.join(__dirname, '..', 'src', p));
src('engine.js'); src('fleet.js'); src('lang/manifest.js');
globalThis.FG.LANG_FILES.forEach(id => src(`lang/${id}.js`));
src('agent.js'); src('vision.js');
// Générateur pseudo-aléatoire reproductible (mulberry32).
function rng(seed = 1) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
module.exports = { FG: globalThis.FG, rng };
