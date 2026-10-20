'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const context={window:{},URL,URLSearchParams,React:{createElement(){}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'journey.js'),'utf8'),context);
const {readRoute,routeUrl}=context.window.FGJourney;
test('Chaque page client garde son lien profond au rechargement',()=>{
 for(const page of ['home','devices','report','tracking','notifications','survie','real','reports']){
  const url=routeUrl(page,'http://localhost/codex/?revision=design');
  assert.equal(readRoute(url),page);assert.equal(url.searchParams.get('portal'),'client');assert.equal(url.searchParams.get('revision'),'design');
 }
});
test('Les sections inconnues ne créent jamais un écran vide',()=>{assert.equal(readRoute('http://localhost/codex/?section=unknown'),'home');assert.equal(readRoute(routeUrl('unknown','http://localhost/codex/')),'home');});
test('Changer de portail ne conserve pas un onglet incompatible',()=>{
 const admin=routeUrl('noc','http://localhost/codex/?portal=client&section=devices');assert.equal(admin.searchParams.get('section'),'operations');assert.equal(readRoute(admin),'noc');
 const client=routeUrl('tracking','http://localhost/codex/?portal=moov&section=incidents');assert.equal(readRoute(client),'tracking');assert.equal(client.searchParams.get('portal'),'client');
});
test('La route cliente retire le mode classique et l’ancienne ancre',()=>{const url=routeUrl('real','http://localhost/codex/?classic=1#main');assert.equal(url.hash,'');assert.equal(url.searchParams.has('classic'),false);});
test('Les sections NOC restent pilotées par le portail opérateur',()=>{assert.equal(readRoute('http://localhost/codex/?portal=moov&section=missions'),'noc');});
test('L’ancien lien Administration réelle rejoint la même console opérateur',()=>{assert.equal(readRoute('http://localhost/codex/?portal=client&section=real-admin'),'noc');const url=routeUrl('real-admin','http://localhost/codex/');assert.equal(url.searchParams.get('portal'),'moov');assert.equal(url.searchParams.get('section'),'operations');});
