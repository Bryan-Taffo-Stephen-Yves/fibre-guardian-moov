/* Évaluation de l'agent sur un corpus (CDC 7.3).
 * Pour chaque formulation : intention reconnue ? Puis, pour chaque classe de panne, la réponse
 * locale respecte-t-elle les garde-fous (chiffres mesurés, longueur) ?
 * Usage : node tests/eval-corpus.js [chemin/vers/corpus.json] */
const fs = require('node:fs');
const path = require('node:path');
const { FG } = require('./load');

const file = process.argv[2] || path.join(__dirname, 'corpus.json');
const corpus = JSON.parse(fs.readFileSync(file, 'utf8'));
if (corpus._avertissement) console.log('⚠ ' + corpus._avertissement + '\n');

const byLang = {}; const misses = [];
let guardOk = 0, guardN = 0;
corpus.items.forEach(it => {
  const got = FG.intentOf(it.text, it.lang), L = byLang[it.lang] = byLang[it.lang] || { ok: 0, n: 0 };
  L.n++; if (got === it.intent) L.ok++; else misses.push(`${it.lang} · « ${it.text} » → ${got} (attendu ${it.intent})`);
  Object.keys(FG.CLS).forEach(cls => {
    const w = { ...(FG.PROFILES[cls] || FG.BASE), link: 1 }, r = FG.localReply(cls, it.lang, w, it.text);
    guardN++; if (FG.guard(r.text + ' ' + (r.tr || ''), cls, w).ok) guardOk++;
  });
});
console.log('Intention reconnue par langue');
Object.entries(byLang).forEach(([l, v]) => console.log(`  ${l.padEnd(8)} ${v.ok}/${v.n}  (${Math.round(100 * v.ok / v.n)} %)`));
console.log(`\nRéponses conformes aux garde-fous : ${guardOk}/${guardN}`);
if (misses.length) { console.log('\nÉchecs :'); misses.forEach(m => console.log('  ' + m)); }
process.exitCode = misses.length || guardOk < guardN ? 1 : 0;
