'use strict';
// Rendez-vous du technicien : seul le client qui a signalé la panne choisit quand il est chez lui,
// parmi les créneaux proposés, et seulement avant le départ. L'équipe et le technicien voient ce choix.
// Les pastilles de la note (« En retard », « Poli et souriant »…) sont bien classées par avis.cjs.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs'),noc=require('./noc-store.cjs');
const WEL=require('./welcome.cjs'),AV=require('./avis.cjs');

async function setup(){
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);noc.migrate(s);WEL.migrate(s);AV.migrate(s);const ids={};
 for(const n of ['awa','yao']){ids[n]=(await s.register({email:n+'@example.test',name:n,password:'rdv-password-123'})).user.id;}
 const now=Date.now();
 s.run("INSERT INTO noc_incidents(id,segment_id,reporter,source,mode,status,title,description,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)",'inc-rdv','YOP-07',ids.awa,'customer_report','demo','approved','Signalement · Yopougon','Câble tombé',now,now);
 return {s,ids};
}

test('Le client qui a signalé la panne choisit un créneau, puis peut le changer',async()=>{
 const {s,ids}=await setup();
 const item=noc.client(s,ids.awa).incidents.find(i=>i.id==='inc-rdv');
 assert.equal(item.mine,true);assert.equal(item.rdv,null);assert.equal(item.rdvSlots.length,6,'3 jours, matin et après-midi');
 const at=item.rdvSlots[2];
 const r=noc.rdv(s,ids.awa,{id:'inc-rdv',at});
 assert.equal(r.rdv.at,at);assert.match(r.rdv.label,/entre (8 h et 12 h|14 h et 18 h)$/);
 const again=noc.client(s,ids.awa).incidents.find(i=>i.id==='inc-rdv');
 assert.equal(again.rdv.at,at);assert.ok(!again.events.some(e=>e.kind==='rdv'),'événement interne');
 noc.rdv(s,ids.awa,{id:'inc-rdv',at:0});
 assert.equal(noc.rdvOf(s,'inc-rdv').at,null);assert.equal(noc.rdvOf(s,'inc-rdv').label,'dès que possible');
});

test('Un créneau inventé, un autre client ou un technicien déjà parti sont refusés',async()=>{
 const {s,ids}=await setup();
 assert.throws(()=>noc.rdv(s,ids.awa,{id:'inc-rdv',at:Date.now()+3600000}),/moments proposés/);
 assert.throws(()=>noc.rdv(s,ids.yao,{id:'inc-rdv',at:0}),e=>e.status===404);
 s.run("UPDATE noc_incidents SET status='en_route' WHERE id='inc-rdv'");
 assert.throws(()=>noc.rdv(s,ids.awa,{id:'inc-rdv',at:0}),e=>e.status===409);
 assert.deepEqual(noc.client(s,ids.awa).incidents.find(i=>i.id==='inc-rdv').rdvSlots,[],'plus de choix une fois parti');
});

test('Les pastilles de la note sont classées par sujet',()=>{
 const t=AV.tones('En retard, Mal expliqué, Pas poli, Chantier sale');
 assert.deepEqual(t.filter(x=>x.bad).map(x=>x.key).sort(),['explications','politesse','proprete','retard']);
 const g=AV.tones('À l’heure, Poli et souriant, Bien expliqué, Travail propre');
 assert.deepEqual(g.filter(x=>!x.bad).map(x=>x.key).sort(),['explications','politesse','proprete','retard']);
});

test('Les voisins du quartier ne voient ni le rendez-vous ni son annonce',async()=>{
 const {s,ids}=await setup();noc.join(s,ids.yao,{segment:'YOP-07',consent:true});
 noc.rdv(s,ids.awa,{id:'inc-rdv',at:noc.rdvSlots()[0]});
 const seen=noc.client(s,ids.yao).incidents.find(i=>i.id==='inc-rdv');
 assert.ok(seen,'le voisin suit bien la panne de son quartier');
 assert.equal(seen.rdv,null);assert.deepEqual(seen.rdvSlots,[]);assert.ok(!seen.events.some(e=>/Rendez-vous|chez lui/.test(e.public_text)));
 assert.ok(!JSON.stringify(noc.notifications(s,ids.yao)).includes('Rendez-vous'));
});

test('Pas de rendez-vous pour une panne de rue ; null n’est pas « dès que possible »',async()=>{
 const {s,ids}=await setup();
 assert.throws(()=>noc.rdv(s,ids.awa,{id:'inc-rdv',at:null}),/moments proposés/);
 s.run("UPDATE noc_incidents SET plan=? WHERE id='inc-rdv'",JSON.stringify({cause:'POLE_DAMAGE'}));
 assert.deepEqual(noc.client(s,ids.awa).incidents.find(i=>i.id==='inc-rdv').rdvSlots,[]);
 assert.throws(()=>noc.rdv(s,ids.awa,{id:'inc-rdv',at:0}),e=>e.status===409);
});

test('Créneaux à 8 h et 14 h heure d’Abidjan, jamais le dimanche',()=>{
 const sl=noc.rdvSlots(Date.UTC(2026,10,21,22));// samedi soir
 assert.equal(sl.length,6);for(const at of sl){const d=new Date(at);assert.ok([8,14].includes(d.getUTCHours()));assert.notEqual(d.getUTCDay(),0);}
 assert.equal(new Date(sl[0]).getUTCDate(),23,'dimanche sauté');
});

test('Un rendez-vous futur remplace l’heure de retour ; une panne de rue efface le rendez-vous',async()=>{
 const {s,ids}=await setup();noc.rdv(s,ids.awa,{id:'inc-rdv',at:noc.rdvSlots()[1]});
 assert.equal(noc.client(s,ids.awa).incidents.find(i=>i.id==='inc-rdv').restore??null,null);
 s.run("UPDATE noc_incidents SET plan=? WHERE id='inc-rdv'",JSON.stringify({cause:'OLT_FAILURE'}));
 assert.equal(noc.rdvOf(s,'inc-rdv'),null);assert.equal(noc.client(s,ids.awa).incidents.find(i=>i.id==='inc-rdv').rdv,null);
});
