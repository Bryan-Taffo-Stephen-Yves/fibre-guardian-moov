'use strict';
// « Le jury met ses vrais chiffres » : le gain annuel pour Moov se recalcule à partir des chiffres du manager.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const I=require('./impact-view.js');

// Valeurs de départ réelles : abonnés internet fixe Moov (ARTCI), intervention à 10 000 F, fibre 100 Mb/s à 20 000 F,
// et la seule baisse d'appels mesurée publiée (−18 %).
test('Valeurs de départ : appels, déplacements et clients gardés sur 12 mois',()=>{
 const r=I.compute({});
 assert.equal(r.calls,12*12000*.18*1500);assert.equal(r.visits,12*2500*.4*10000);
 assert.equal(r.kept,900);assert.equal(r.revenue,900*20000*12);
 assert.equal(r.total,r.calls+r.visits+r.revenue);assert.equal(r.perSubscriber,r.total/66723);
});

test('Chaque chiffre de départ dit d’où il vient',()=>{
 for(const f of [...I.FIELDS,...I.RATES])assert.ok(f.source,f.key+' sans source');
 assert.equal(I.DEFAULTS.visitCost,10000);assert.equal(I.DEFAULTS.subscribers,66723);
});

test('Les chiffres du manager changent le total ; les valeurs absurdes sont bornées',()=>{
 const base=I.compute({}).total;
 assert.ok(I.compute({calls:24000}).total>base,'plus d’appels, plus de gain');
 assert.equal(I.compute({visitCost:0,visits:0,calls:0,lost:0}).total,0);
 const r=I.compute({callRate:5,calls:-10,subscribers:0});assert.equal(r.calls,0);assert.equal(r.perSubscriber,0);
 assert.equal(I.compute({callRate:5}).calls,12*12000*1*1500,'une part ne dépasse jamais 100 %');
});

test('Montants lisibles en français',()=>{
 assert.deepEqual(I.money(525600000),{value:'526',unit:'millions FCFA'});
 assert.equal(I.money(1240000000).unit,'milliard FCFA');assert.equal(I.money(2500000000).unit,'milliards FCFA');
 assert.equal(I.money(8760).unit,'FCFA');
});

test('L’écran est chargé côté Moov, en couleurs de marque, et la page À propos dit ce qui est estimé',()=>{
 const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
 assert.match(read('bootstrap.js'),/'impact-view\.js'/);assert.match(read('index.html'),/impact\.css/);
 assert.match(read('noc-view.js'),/\['impact','Impact','trend'\]/);
 assert.doesNotMatch(read('impact.css'),/#[0-9a-f]{3,8}\b|rgba?\(/i);
 assert.doesNotMatch(read('impact-view.js'),/simul|fictif/i);
 assert.match(read('demo.js'),/Impact pour Moov/);
});
