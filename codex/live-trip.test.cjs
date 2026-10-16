'use strict';
// Suivi du technicien en direct : le serveur donne de quoi faire avancer le véhicule entre deux actualisations.
const {test}=require('node:test'),assert=require('node:assert/strict');
const N=require('./noc-store.cjs'),fs=require('node:fs'),path=require('node:path');

test('Trajet en route : départ, durée, distance et position cohérents',()=>{
 const departed=Date.now()-60000,p=N.position({technician:'koffi',segment_id:'YOP-07',status:'en_route',departed});
 assert.equal(p.durationMs,120000);assert.equal(p.departedAt,departed);
 assert.ok(p.distanceKm>=0.8&&p.distanceKm<5,'distance plausible en ville');
 assert.ok(Math.abs(p.progress-.5)<.02);assert.ok(p.eta>=59&&p.eta<=61);
 assert.equal(p.x,Math.round(p.fromX+(p.targetX-p.fromX)*p.progress));
});

test('Sur place : trajet terminé, plus d’estimation',()=>{
 const p=N.position({technician:'koffi',segment_id:'YOP-07',status:'on_site',departed:Date.now()-200000});
 assert.equal(p.progress,1);assert.equal(p.eta,null);
});

test('La carte de suivi est chargée et n’utilise que les couleurs de marque',()=>{
 assert.match(fs.readFileSync(path.join(__dirname,'bootstrap.js'),'utf8'),/'live-trip\.js', 'noc-command-view\.js'/);
 assert.match(fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),/live-trip\.css/);
 assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'live-trip.css'),'utf8'),/#[0-9a-f]{3,8}\b|rgba?\(/i);
 const js=fs.readFileSync(path.join(__dirname,'live-trip.js'),'utf8');
 assert.doesNotMatch(js,/simul|fictif/i,'aucun avertissement technique à l’écran');
});
