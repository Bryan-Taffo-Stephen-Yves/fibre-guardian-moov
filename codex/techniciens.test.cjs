'use strict';
// « Vos techniciens » (accueil client) : visage, équipe, quartier, note et missions, sans aucune donnée privée.
const {test}=require('node:test'),assert=require('node:assert/strict'),{Store}=require('./pilot-store.cjs');
const operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs'),noc=require('./noc-store.cjs');

test('Le client voit l’équipe sans téléphone, plaque ni position',()=>{
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);noc.migrate(s);
 const team=noc.publicTeam(s);
 assert.equal(team.length,noc.TECHS.length);
 for(const t of team){
  assert.deepEqual(Object.keys(t).sort(),['busy','id','missions','name','rating','team','zone']);
  assert.equal(typeof t.rating,'number');assert.equal(typeof t.busy,'boolean');
 }
 assert.equal(JSON.stringify(team).includes('+225'),false,'aucun numéro de téléphone');
 assert.equal(JSON.stringify(team).includes('Fourgon'),false,'aucune plaque');
});
