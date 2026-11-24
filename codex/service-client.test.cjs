'use strict';
// Service client : chaque plainte suit un parcours complet, de la demande du client à sa note,
// en passant par la file « À rappeler » du conseiller, l'appel, et un responsable si ce n'est pas réglé.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs'),noc=require('./noc-store.cjs');
const RC=require('./reclamation.cjs'),EB=require('./echange-box.cjs'),RV=require('./rendezvous.cjs'),SC=require('./service-client.cjs');
const HOUR=3600000,DAY=24*HOUR;

async function setup(){
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);noc.migrate(s);RC.migrate(s);EB.migrate(s);RV.migrate(s);SC.migrate(s);const ids={};
 for(const [n,name] of [['awa','Awa Koné'],['kader','Kader Diallo'],['moussa','Moussa Bakayoko'],['fatou','Fatou Bamba']]){ids[n]=(await s.register({email:n+'@example.test',name,password:'service-password-123'})).user.id;}
 operator.grant(s,'kader@example.test','agent');operator.grant(s,'moussa@example.test','agent');operator.grant(s,'fatou@example.test','supervisor');
 journey.put(s,ids.awa,journey.seed());
 return {s,ids};
}
function dossier(s,uid,iid,status,at){
 s.run("INSERT INTO noc_incidents(id,reporter,source,mode,status,title,description,created,updated) VALUES(?,?,?,?,?,?,?,?,?)",iid,uid,'customer_report','demo',status,'Internet coupé','Test',at,at);
 s.run('INSERT INTO noc_events VALUES(?,?,?,?,?,?,?)',iid+'-e1',iid,uid,'received','Votre signalement est bien reçu.','{}',at);
 if(status==='resolved')s.run('INSERT INTO noc_events VALUES(?,?,?,?,?,?,?)',iid+'-e2',iid,null,'resolved','Internet est revenu.','{}',at+HOUR);
}
const last=(s,uid)=>journey.get(s,uid).notifications[0];
const item=(s,uid,now)=>SC.mine(s,uid,now).items[0];

test('Réclamation de bout en bout : file du conseiller, appel, « C’est réglé ? », note du client',async()=>{
 const {s,ids}=await setup(),t=Date.UTC(2026,10,24,8);
 dossier(s,ids.awa,'inc-1','resolved',t-2*HOUR);
 RC.claim(s,ids.awa,{id:'inc-1',text:'Internet coupe encore le soir'},t);
 let c=item(s,ids.awa,t);
 assert.equal(c.status,'recue');assert.match(c.text,/vous appelle avant 12\sh\s00/);assert.equal(c.steps[0].done,true);assert.equal(c.steps[1].done,false);
 // La demande arrive dans la file des conseillers, pas chez le client.
 assert.throws(()=>SC.queue(s,ids.awa,t));
 let q=SC.queue(s,ids.kader,t+10*60000);assert.equal(q.items.length,1);assert.equal(q.items[0].name,'Awa Koné');assert.equal(q.items[0].detail,'Internet coupe encore le soir');
 SC.act(s,ids.kader,{id:q.items[0].id,action:'take'},t+10*60000);
 assert.equal(last(s,ids.awa).title,'Kader s’occupe de votre demande');
 c=item(s,ids.awa,t+11*60000);assert.equal(c.agent,'Kader');assert.equal(c.steps[1].label,'Kader');
 assert.throws(()=>SC.act(s,ids.moussa,{id:c.id,action:'take'},t+11*60000),/autre conseiller/,'un seul conseiller par demande');
 // Pas de réponse au premier appel : le client est prévenu, la demande reste ouverte.
 SC.act(s,ids.kader,{id:c.id,action:'result',outcome:'absent'},t+20*60000);
 assert.equal(last(s,ids.awa).title,'Nous avons essayé de vous appeler');
 assert.match(item(s,ids.awa,t+21*60000).text,/sans réponse/);
 // Deuxième appel : réglé au téléphone. La réclamation a sa réponse, et le client dit si c'est bon.
 SC.act(s,ids.kader,{id:c.id,action:'result',outcome:'regle',note:'Box redémarrée avec vous, câble remis en place.'},t+HOUR);
 assert.equal(s.get('SELECT status,outcome FROM reclamations').outcome,'regle');
 c=item(s,ids.awa,t+HOUR);assert.equal(c.status,'reglee');assert.equal(c.canAnswer,true);assert.match(c.text,/câble remis en place/);
 assert.equal(last(s,ids.awa).title,'Est-ce réglé pour vous ?');
 SC.answer(s,ids.awa,{id:c.id,answer:'oui'},t+2*HOUR);
 c=item(s,ids.awa,t+2*HOUR);assert.equal(c.canRate,true);
 assert.throws(()=>SC.answer(s,ids.awa,{id:c.id,rating:6},t+2*HOUR),/1 à 5/);
 SC.answer(s,ids.awa,{id:c.id,rating:5},t+2*HOUR);
 q=SC.queue(s,ids.fatou,t+3*HOUR);assert.equal(q.items.length,0);assert.equal(q.stats.rating,5);assert.equal(q.stats.taken,10);assert.equal(q.stats.solved,1);
});

test('« Non, toujours pas » : la demande monte chez un responsable (2 h), puis les recours',async()=>{
 const {s,ids}=await setup(),t=Date.UTC(2026,10,24,8);
 dossier(s,ids.awa,'inc-2','resolved',t-2*HOUR);
 RC.claim(s,ids.awa,{id:'inc-2'},t);
 let id=item(s,ids.awa,t).id;
 SC.act(s,ids.kader,{id,action:'take'},t);SC.act(s,ids.kader,{id,action:'result',outcome:'regle'},t+HOUR);
 SC.answer(s,ids.awa,{id,answer:'non',text:'Toujours coupé le soir'},t+2*HOUR);
 const c=item(s,ids.awa,t+2*HOUR);
 assert.equal(c.level,2);assert.match(c.text,/Un responsable Moov vous appelle avant 12\sh\s00/);
 assert.equal(s.get('SELECT COUNT(*) n FROM reclamations').n,2,'la réclamation monte aussi d’un niveau');
 assert.throws(()=>SC.act(s,ids.kader,{id:c.id,action:'take'},t+2*HOUR),/responsable/);
 SC.act(s,ids.fatou,{id:c.id,action:'take'},t+2*HOUR);
 SC.act(s,ids.fatou,{id:c.id,action:'result',outcome:'regle'},t+3*HOUR);
 SC.answer(s,ids.awa,{id:c.id,answer:'non'},t+4*HOUR);
 assert.equal(item(s,ids.awa,t+4*HOUR).status,'recours');assert.match(last(s,ids.awa).body,/ARTCI/);
});

test('Échange de box : rappel du conseiller, échange confirmé, puis « C’est réglé ? » quand la box est échangée',async()=>{
 const {s,ids}=await setup(),t=Date.UTC(2026,10,24,8);
 const r=EB.ask(s,ids.awa,{mode:'agence',agence:'yop',tried:true},t);
 let c=item(s,ids.awa,t);assert.equal(c.kind,'echange');assert.equal(c.status,'recue');
 SC.act(s,ids.kader,{id:c.id,action:'take'},t);
 SC.act(s,ids.kader,{id:c.id,action:'result',outcome:'echange'},t);
 c=item(s,ids.awa,t);assert.equal(c.status,'appele');assert.match(c.text,/échange de box est confirmé/);
 EB.advance(s,ids.kader,{id:r.current.id,to:'prete'},t+HOUR);
 assert.equal(item(s,ids.awa,t+HOUR).status,'appele');
 EB.advance(s,ids.kader,{id:r.current.id,to:'echangee'},t+DAY);
 c=item(s,ids.awa,t+DAY);assert.equal(c.status,'reglee');assert.equal(c.canAnswer,true);
 // Sans réponse du client en 48 h, la demande se ferme toute seule.
 assert.equal(item(s,ids.awa,t+4*DAY).status,'confirmee');
});

test('Échange annulé par le client : la demande sort de la file ; technicien pas venu : rappel dans l’heure',async()=>{
 const {s,ids}=await setup(),t=Date.UTC(2026,10,23,7);
 EB.ask(s,ids.awa,{mode:'agence',agence:'yop',tried:true},t);EB.cancel(s,ids.awa,t+1000);
 assert.equal(SC.queue(s,ids.kader,t).items.length,0);
 dossier(s,ids.awa,'inc-3','dispatched',t);
 RV.choose(s,ids.awa,{incident:'inc-3',day:Date.UTC(2026,10,23),slot:'matin'},t);
 const late=Date.UTC(2026,10,23,12,30);
 RV.decorate(s,ids.awa,{incidents:[{id:'inc-3'}]},late);RV.decorate(s,ids.awa,{incidents:[{id:'inc-3'}]},late+60000);
 const q=SC.queue(s,ids.kader,late);
 assert.equal(q.items.length,1,'une seule demande par créneau manqué');assert.equal(q.items[0].kind,'retard');assert.equal(q.items[0].due,late+HOUR);
 // Technicien renvoyé : la demande attend la réparation, puis demande son avis au client.
 SC.act(s,ids.kader,{id:q.items[0].id,action:'take'},late);SC.act(s,ids.kader,{id:q.items[0].id,action:'result',outcome:'technicien'},late+60000);
 assert.equal(item(s,ids.awa,late+2*60000).status,'appele');
 s.run("INSERT INTO noc_events VALUES('inc-3-r','inc-3',NULL,'resolved','Internet est revenu.','{}',?)",late+3*HOUR);
 assert.equal(item(s,ids.awa,late+3*HOUR+1000).status,'reglee');
});

test('Relecture jury : un seul chemin pour répondre, un conseiller par demande, le recours arrive chez un responsable',async()=>{
 const {s,ids}=await setup(),t=Date.UTC(2026,10,24,8);
 dossier(s,ids.awa,'inc-9','resolved',t-2*HOUR);
 RC.claim(s,ids.awa,{id:'inc-9'},t);
 const id=item(s,ids.awa,t).id;
 SC.act(s,ids.kader,{id,action:'take'},t);
 // L'ancien bloc du Superviseur ne laisse pas un autre conseiller répondre à la place de Kader.
 const rid=s.get('SELECT id FROM reclamations').id;
 assert.throws(()=>RC.answer(s,ids.moussa,{id:rid,outcome:'regle'},t),/autre conseiller/);
 SC.act(s,ids.kader,{id,action:'result',outcome:'regle'},t+HOUR);
 assert.equal(journey.get(s,ids.awa).notifications.filter(n=>n.at===t+HOUR).length,1,'un seul message au client');
 // Pendant « Est-ce réglé ? », l'ancien bouton « Ce n'est pas réglé » disparaît.
 const d=RC.decorate(s,ids.awa,noc.client(s,ids.awa),t+HOUR).incidents.find(i=>i.id==='inc-9');
 assert.equal(d.reclamation.canClaim,false);
 SC.answer(s,ids.awa,{id,answer:'non'},t+2*HOUR);
 const lvl2=item(s,ids.awa,t+2*HOUR).id;
 SC.act(s,ids.fatou,{id:lvl2,action:'take'},t+2*HOUR);SC.act(s,ids.fatou,{id:lvl2,action:'result',outcome:'regle'},t+3*HOUR);
 SC.answer(s,ids.awa,{id:lvl2,answer:'non'},t+4*HOUR);
 let q=SC.queue(s,ids.fatou,t+4*HOUR);
 assert.equal(q.items.length,1);assert.equal(q.items[0].status,'recours');assert.equal(q.items[0].canAct,true);
 assert.equal(SC.queue(s,ids.kader,t+4*HOUR).items[0].canAct,false,'un conseiller ne traite pas un recours');
 assert.equal(item(s,ids.awa,t+5*DAY).status,'recours','le client voit toujours son dossier ouvert');
 SC.act(s,ids.fatou,{id:lvl2,action:'take'},t+5*HOUR);SC.act(s,ids.fatou,{id:lvl2,action:'result',outcome:'regle'},t+6*HOUR);
 assert.equal(item(s,ids.awa,t+6*HOUR).status,'reglee');
});

test('Effacement du compte d’un ancien conseiller : son nom part aussi des demandes',async()=>{
 const {s,ids}=await setup(),t=Date.UTC(2026,10,24,8),DP=require('./donnees.cjs');DP.migrate(s);
 const r=EB.ask(s,ids.awa,{mode:'agence',agence:'yop',tried:true},t),id=item(s,ids.awa,t).id;
 SC.act(s,ids.moussa,{id,action:'take'},t);
 operator.grant(s,'moussa@example.test','revoke');
 DP.erase(s,ids.moussa,{confirm:true});
 const row=s.get('SELECT agent_id,agent_name FROM sc_demandes WHERE id=?',id);
 assert.equal(row.agent_id,null);assert.equal(row.agent_name,null);
 assert.ok(r.current);
});
