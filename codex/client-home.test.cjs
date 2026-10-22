'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
test('L’onglet Compte a son propre lien et l’accueil client garde ses 4 onglets',()=>{
 const context={window:{},URL,URLSearchParams,React:{createElement(){}}};vm.runInNewContext(read('journey.js'),context);
 const {readRoute,routeUrl}=context.window.FGJourney,url=routeUrl('compte','http://localhost/codex/');
 assert.equal(readRoute(url),'compte');assert.equal(url.searchParams.get('portal'),'client');
 assert.match(read('journey.js'),/nav\('Accueil','home'\),nav\('Guardian','guardian'\),nav\('Appareils','devices'\),nav\('Compte','compte'\)/);
});
test('Le suivi en direct et le bouton Signaler sont chargés avant le parcours client',()=>{
 const boot=read('bootstrap.js');assert.ok(boot.indexOf("'client-home.js'")>0&&boot.indexOf("'client-home.js'")<boot.indexOf("'journey.js'"));
 const context={window:{},React:{createElement(){},useState(){},useEffect(){},useRef(){}}};vm.runInNewContext(read('client-home.js'),context);
 for(const k of ['LiveTrip','ReportHero','Account'])assert.equal(typeof context.window.FGClientHome[k],'function',k);
});
