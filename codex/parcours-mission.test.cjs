'use strict';
// Parcours complet d'une mission : signalement du client → validation et affectation par Moov → trajet de 30 s →
// arrivée automatique (client, équipe et technicien prévenus) → consignes de Guardian et de l'équipe → compte rendu → vérification.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store}=require('./pilot-store.cjs'),{createGuardianServer}=require('./pilot-server.cjs');
const {seedDemo,DEMO}=require('./seed-demo.cjs'),N=require('./noc-store.cjs'),W=require('./noc-workspace.cjs'),F=require('./mission-feed.cjs');

async function seeded(){
 const store=new Store(':memory:'),server=createGuardianServer({store});
 const saved=process.env[DEMO.admin.env];process.env[DEMO.admin.env]='direction-test-2026';
 try{await seedDemo(store);}finally{if(saved===undefined)delete process.env[DEMO.admin.env];else process.env[DEMO.admin.env]=saved;}
 const uid=email=>store.get('SELECT id FROM users WHERE email=?',email).id;
 return {store,chef:uid(DEMO.admin.email),awa:uid(DEMO.client.email),ibrahim:uid(DEMO.technician.email),close:()=>server.close()};
}
const row=(s,id)=>N.overview(s.store,s.chef).incidents.find(i=>i.id===id);
const item=(s,uid,id)=>W.overview(s.store,uid).queue.find(q=>q.key==='incident:'+id);
const work=(s,uid,id,type,extra={})=>{const q=item(s,uid,id);return W.action(s.store,uid,{key:q.key,type,version:q.version,sourceVersion:q.sourceVersion,...extra});};
const op=(s,id,type,extra={})=>N.operate(s.store,s.chef,{id,type,version:row(s,id).version,...extra});

test('Le client signale, Moov affecte Ibrahim, il arrive tout seul après 30 s et chacun est prévenu',async()=>{
 const s=await seeded();
 try{
  const since=Date.now()-1;
  N.refreshTelemetry(s.store); // relevé du jour (la démo pré-remplie a des mesures anciennes)
  const inc={id:'parcours-1',zone:'Yopougon · Niangon',description:'Câble tombé ou coupé · Le câble est tombé devant chez moi.',created:Date.now()};
  N.importReport(s.store,s.awa,inc,{mode:'demo'});N.scan(s.store);
  const r=row(s,'parcours-1');assert.equal(r.status,'proposed');
  assert.equal(r.plan.cause,'DROP_CABLE','Guardian part de ce que le client a vu');assert.equal(r.plan.dispatch,true);
  assert.ok(F.pings(s.store,s.chef,since).items.some(p=>p.kind==='received'&&p.title==='Nouveau signalement client'),'l’équipe Moov est prévenue');
  op(s,'parcours-1','approve',{note:'Photo nette, on envoie Ibrahim.'});op(s,'parcours-1','dispatch',{technician:'ibrahim',safety:true});
  assert.ok(F.pings(s.store,s.ibrahim,since).items.some(p=>p.kind==='mission'),'Ibrahim reçoit sa mission');
  assert.ok(F.pings(s.store,s.awa,since).items.some(p=>p.kind==='dispatched'),'Awa sait qu’un technicien est choisi');
  work(s,s.chef,'parcours-1','instruct',{body:'Portail bleu, appeler Mme Koné en arrivant.'});
  assert.ok(F.pings(s.store,s.ibrahim,since).items.some(p=>p.kind==='instruction'&&p.title==='Nouvelle consigne de Direction'));
  work(s,s.ibrahim,'parcours-1','advance',{confirm:true});
  const moving=row(s,'parcours-1');assert.equal(moving.status,'en_route');assert.equal(moving.position.durationMs,30000);
  assert.equal(N.arrivals(s.store),0,'pas encore arrivé');
  // 30 s plus tard : arrivée automatique, sans bouton.
  assert.equal(N.arrivals(s.store,Date.now()+N.TRIP_MS+10),1);
  const here=row(s,'parcours-1');assert.equal(here.status,'on_site');
  assert.match(here.events.at(-1).public_text,/^Ibrahim est arrivé/);
  assert.ok(F.pings(s.store,s.awa,since).items.some(p=>p.kind==='on_site'&&p.title==='Votre technicien est arrivé'),'Awa est prévenue');
  assert.ok(F.pings(s.store,s.chef,since).items.some(p=>p.kind==='on_site'&&p.title==='Ibrahim est arrivé sur place'),'l’équipe est prévenue');
  assert.ok(F.pings(s.store,s.ibrahim,since).items.some(p=>p.kind==='on_site'&&p.title==='Vous êtes arrivé'));
  // Consigne cochée, puis « C'est réparé » avec le compte rendu.
  const q=item(s,s.ibrahim,'parcours-1');assert.equal(q.plan.steps.length,3,'Ibrahim voit les étapes de Guardian');
  work(s,s.ibrahim,'parcours-1','check',{itemId:q.checklist[0].id,done:true});
  work(s,s.ibrahim,'parcours-1','advance',{confirm:true,report:'Câble remplacé, lumière mesurée : -21 dBm.'});
  assert.equal(row(s,'parcours-1').status,'verifying');
  assert.ok(item(s,s.chef,'parcours-1').notes.some(n=>n.body==='Compte rendu : Câble remplacé, lumière mesurée : -21 dBm.'));
  assert.ok(F.pings(s.store,s.chef,since).items.some(p=>p.kind==='report'&&p.title==='Note d’Ibrahim'));
  // Le quartier n'avait pas d'alarme : un relevé neuf, 20 s après la réparation, permet la vérification.
  assert.throws(()=>op(s,'parcours-1','verify'),/ne prouvent pas encore/);
  s.store.run('UPDATE noc_incidents SET repair_at=repair_at-25000 WHERE id=?','parcours-1');
  N.refreshTelemetry(s.store);op(s,'parcours-1','verify');
  assert.equal(row(s,'parcours-1').status,'resolved');
 }finally{s.close();}
});

test('Un plan validé reste affectable quand les box renvoient les mêmes mesures',async()=>{
 const s=await seeded();
 try{
  N.refreshTelemetry(s.store);
  N.importReport(s.store,s.awa,{id:'parcours-2',zone:'Yopougon',description:'Poteau penché devant la maison',created:Date.now()},{mode:'demo'});N.scan(s.store);
  assert.equal(row(s,'parcours-2').plan.cause,'POLE_DAMAGE');
  op(s,'parcours-2','approve',{note:'OK'});
  // Le relevé de routine arrive après 2 min 30 : mêmes valeurs, nouvelle heure.
  s.store.run('UPDATE noc_segments SET sample_at=sample_at-160000 WHERE id=?','YOP-07');s.store.run("UPDATE noc_incidents SET plan=json_set(plan,'$.segmentSample',json_extract(plan,'$.segmentSample')-160000) WHERE id=?",'parcours-2');
  N.refreshTelemetry(s.store);
  op(s,'parcours-2','dispatch',{technician:'ibrahim',safety:true});
  assert.equal(row(s,'parcours-2').status,'dispatched');
 }finally{s.close();}
});

test('Le premier appel aux bandeaux ne rejoue pas l’historique et chaque écran charge le bandeau',async()=>{
 const s=await seeded();
 try{
  const r=F.pings(s.store,s.awa,null);assert.deepEqual(r.items,[]);assert.ok(r.now>0);
  const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
  assert.ok(read('bootstrap.js').indexOf("'mission-ping.js'")<read('bootstrap.js').indexOf("'journey.js'"));
  assert.match(read('index.html'),/mission-ping\.css/);assert.match(read('journey.js'),/FGMissionPing\.Banner/);
  assert.doesNotMatch(read('mission-ping.css'),/#[0-9a-f]{3,6}\b/i,'couleurs de marque seulement');
 }finally{s.close();}
});
