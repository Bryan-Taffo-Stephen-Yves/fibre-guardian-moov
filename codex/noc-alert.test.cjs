'use strict';
// Alerte de l'équipe Moov : la panne repérée sur les mesures, et l'avance prise sur le premier client qui se plaint.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const N=require('./noc-store.cjs'),A=require('./noc-alert.js'),{createGuardianServer}=require('./pilot-server.cjs');

test('Panne repérée par Guardian : alerte avant tout appel, puis avance mesurée au premier signalement',async()=>{
 const server=createGuardianServer({db:':memory:',onError:()=>{}}),s=server.guardianStore;
 try{
  assert.deepEqual(N.alerts(s),[],'aucune alerte sur un réseau sain');
  s.run("UPDATE noc_segments SET online=8,alarm='LOS',sample_at=? WHERE id='YOP-07'",Date.now());N.scan(s);
  const [a]=N.alerts(s);assert.ok(a);assert.equal(a.segment,'YOP-07');assert.equal(a.offline,12);assert.equal(a.firstReport,null,'personne ne s’est encore plaint');
  const u=(await s.register({email:'plainte@example.test',password:'plainte-password-1234',name:'Plainte'})).user;
  const later=a.detectedAt+95000;
  N.importReport(s,u.id,{id:'report-1',zone:'Yopougon',description:'Plus d’internet',created:later},{mode:'demo'});
  assert.equal(N.alerts(s)[0].firstReport,later,'premier signalement client du quartier');
  s.run("UPDATE noc_incidents SET status='resolved'");assert.deepEqual(N.alerts(s),[],'plus d’alerte une fois la panne close');
 }finally{server.close();}
});

test('Durées lisibles',()=>{
 assert.equal(A.span(8000),'8 s');assert.equal(A.span(130000),'2 min 10 s');assert.equal(A.span(120000),'2 min');assert.equal(A.span(3900000),'1 h 05');
});

test('Le bandeau est chargé côté Moov, en couleurs de marque',()=>{
 const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
 assert.match(read('bootstrap.js'),/'noc-alert\.js'/);assert.match(read('index.html'),/noc-alert\.css/);
 assert.match(read('noc-view.js'),/FGNocAlert\.Banner/);
 assert.doesNotMatch(read('noc-alert.css'),/#[0-9a-f]{3,8}\b|rgba?\(/i);
 assert.doesNotMatch(read('noc-alert.js'),/simul|fictif/i);
});
