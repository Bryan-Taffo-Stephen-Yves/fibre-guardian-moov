'use strict';
// Réclamations : délai de réponse promis, « Ce n'est pas réglé » (deux niveaux), recours ARTCI,
// réponse de l'équipe Moov avec le bon rôle, et client prévenu.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs'),noc=require('./noc-store.cjs');
const RC=require('./reclamation.cjs');
const HOUR=3600000,DAY=24*HOUR;

async function setup(){
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);noc.migrate(s);RC.migrate(s);const ids={};
 for(const n of ['awa','yao','fatou','kader']){const u=(await s.register({email:n+'@example.test',name:n==='awa'?'Awa Koné':n,password:'reclam-password-123'})).user;ids[n]=u.id;}
 operator.grant(s,'fatou@example.test','supervisor');operator.grant(s,'kader@example.test','agent');
 for(const u of [ids.awa,ids.yao])journey.put(s,u,journey.seed());
 return {s,ids};
}
// Un dossier du client, avec un premier événement à l'heure donnée (les tables habituelles, sans passer par l'écran).
function dossier(s,uid,iid,status,at){
 s.run("INSERT INTO noc_incidents(id,reporter,source,mode,status,title,description,created,updated) VALUES(?,?,?,?,?,?,?,?,?)",iid,uid,'customer_report','local',status,'Internet coupé','Test',at,at);
 s.run('INSERT INTO noc_events VALUES(?,?,?,?,?,?,?)',iid+'-e1',iid,uid,'received','Votre signalement est bien reçu.','{}',at);
 if(status==='resolved')s.run('INSERT INTO noc_events VALUES(?,?,?,?,?,?,?)',iid+'-e2',iid,null,'resolved','Internet est revenu.','{}',at+HOUR);
}
const item=(s,uid,iid,now)=>RC.decorate(s,uid,noc.client(s,uid),now).incidents.find(i=>i.id===iid);

test('Un dossier pas encore pris en main promet une réponse sous 4 h, puis se dit en retard',async()=>{
 const {s,ids}=await setup(),t=Date.UTC(2026,10,24,9);
 dossier(s,ids.awa,'d-1','reported',t);
 let i=item(s,ids.awa,'d-1',t+HOUR);
 assert.equal(i.promise.by,t+4*HOUR);assert.equal(i.promise.late,false);assert.match(i.promise.text,/^Réponse promise avant/);
 assert.equal(i.reclamation.canClaim,false,'pas de réclamation tant que la promesse court');
 i=item(s,ids.awa,'d-1',t+5*HOUR);
 assert.equal(i.promise.late,true);assert.match(i.promise.text,/en retard/);
 assert.equal(i.reclamation.canClaim,true,'promesse non tenue : le client peut relancer');
});

test('« Ce n’est pas réglé » : conseiller puis responsable, recours ARTCI au 2e niveau, client prévenu',async()=>{
 const {s,ids}=await setup(),t=Date.UTC(2026,10,24,9);
 dossier(s,ids.awa,'d-2','resolved',t);
 let i=item(s,ids.awa,'d-2',t+2*HOUR);
 assert.equal(i.promise,null);assert.equal(i.reclamation.canClaim,true);assert.equal(i.reclamation.recours,false);
 const r1=RC.claim(s,ids.awa,{id:'d-2',text:'Internet coupe encore le soir'},t+2*HOUR);
 assert.equal(r1.level,1);assert.equal(r1.due,t+6*HOUR);
 assert.equal(journey.get(s,ids.awa).notifications[0].title,'Votre réclamation est enregistrée');
 assert.throws(()=>RC.claim(s,ids.awa,{id:'d-2'},t+2*HOUR),/déjà entre les mains/);
 assert.throws(()=>RC.answer(s,ids.awa,{id:item(s,ids.awa,'d-2',t).reclamation.open.id,outcome:'regle'},t),/réservé/,'un client ne peut pas répondre');
 // L'équipe voit la réclamation, en retard après l'heure promise.
 let l=RC.list(s,ids.kader,t+7*HOUR);
 assert.equal(l.counts.open,1);assert.equal(l.counts.late,1);assert.equal(l.open[0].name,'Awa Koné');assert.equal(l.open[0].text,'Internet coupe encore le soir');
 RC.answer(s,ids.kader,{id:l.open[0].id,outcome:'intervention'},t+7*HOUR);
 assert.equal(journey.get(s,ids.awa).notifications[0].title,'Moov a répondu à votre réclamation');
 i=item(s,ids.awa,'d-2',t+8*HOUR);
 assert.equal(i.reclamation.open,null);assert.equal(i.reclamation.items[0].outcome,'Nouvelle intervention prévue');
 // Le technicien répare ; le client dit « Non, toujours pas » (parcours du service client, service-client.cjs) :
 // c'est la 2e fois, un responsable doit répondre, et le client voit ses recours.
 // (Avant le parcours complet, le client touchait de nouveau « Ce n'est pas réglé » ; ce bouton est remplacé par « Est-ce réglé ? ».)
 assert.equal(item(s,ids.awa,'d-2',t+8*HOUR).reclamation.canClaim,false,'un seul chemin : la demande du service client suit le dossier');
 s.run("INSERT INTO noc_events VALUES('d-2-e3','d-2',NULL,'resolved','Internet est revenu.','{}',?)",t+8*HOUR);
 const SC=require('./service-client.cjs'),dem=SC.mine(s,ids.awa,t+9*HOUR).items[0];assert.equal(dem.status,'reglee');
 SC.answer(s,ids.awa,{id:dem.id,answer:'non'},t+9*HOUR);
 const r2=s.get('SELECT level,due FROM reclamations WHERE level=2');
 assert.equal(r2.level,2);assert.equal(r2.due,t+11*HOUR);
 i=item(s,ids.awa,'d-2',t+9*HOUR);assert.equal(i.reclamation.recours,true);assert.equal(i.reclamation.ref,'D2');
 l=RC.list(s,ids.kader,t+9*HOUR);assert.equal(l.counts.high,1);
 assert.equal(l.open[0].canAnswer,false,'un conseiller ne répond pas au niveau 2');assert.equal(RC.list(s,ids.fatou,t+9*HOUR).open[0].canAnswer,true);
 assert.throws(()=>RC.answer(s,ids.fatou,{id:l.open[0].id,outcome:'constructor'},t+9*HOUR),/Choisissez/);
 assert.throws(()=>RC.answer(s,ids.kader,{id:l.open[0].id,outcome:'regle'},t+9*HOUR),/responsable/);
 RC.answer(s,ids.fatou,{id:l.open[0].id,outcome:'regle',message:'Le câble a été changé ce matin.'},t+10*HOUR);
 assert.match(journey.get(s,ids.awa).notifications[0].body,/Le câble a été changé ce matin\./);
 assert.throws(()=>RC.claim(s,ids.awa,{id:'d-2'},t+11*HOUR),/déjà chez un responsable/,'deux niveaux au plus, ensuite les recours');
});

test('Pas de réclamation sur le dossier d’un autre, ni sur une réparation vieille de plus de 7 jours',async()=>{
 const {s,ids}=await setup(),t=Date.UTC(2026,10,1,9);
 dossier(s,ids.awa,'d-3','resolved',t);
 assert.throws(()=>RC.claim(s,ids.yao,{id:'d-3'},t+2*HOUR),/introuvable/);
 assert.equal(item(s,ids.awa,'d-3',t+8*DAY).reclamation.canClaim,false);
 assert.throws(()=>RC.claim(s,ids.awa,{id:'d-3'},t+8*DAY),/plus de 7 jours/);
 assert.throws(()=>RC.list(s,ids.awa),/réservé/);
});

test('Un message du support après la fin ne relance pas les 7 jours ; un dossier de zone ne promet rien aux voisins',async()=>{
 const {s,ids}=await setup(),t=Date.UTC(2026,10,1,9);
 dossier(s,ids.awa,'d-4','resolved',t);
 s.run('INSERT INTO noc_events VALUES(?,?,?,?,?,?,?)','d-4-e3','d-4',ids.kader,'support.response','Réponse du support : connexion rétablie, tout va bien.','{}',t+9*DAY);
 assert.equal(item(s,ids.awa,'d-4',t+10*DAY).reclamation.canClaim,false);
 // Panne de quartier en préparation : Yao, voisin membre de la zone, ne voit pas de promesse « en retard ».
 s.run("INSERT INTO noc_incidents(id,segment_id,source,mode,status,title,description,created,updated) VALUES(?,?,?,?,?,?,?,?,?)",'z-1','YOP-07','telemetry','demo','proposed','Panne de quartier','Test',t,t);
 s.run('INSERT INTO noc_events VALUES(?,?,?,?,?,?,?)','z-1-e1','z-1',null,'detected','Guardian a repéré une coupure.','{}',t);
 noc.join(s,ids.yao,{segment:'YOP-07',consent:true});
 const z=item(s,ids.yao,'z-1',t+6*HOUR);
 assert.ok(z,'le voisin voit la panne');assert.equal(z.promise,null);assert.equal(z.reclamation.canClaim,false);
});
