'use strict';
// Déménagement : le client déclare sa nouvelle adresse, un conseiller l'appelle et confirme, le technicien installe
// le jour choisi, le client est rattaché à son nouveau quartier, puis il dit si c'est réglé et note le service.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs'),noc=require('./noc-store.cjs');
const SC=require('./service-client.cjs'),DM=require('./demenagement.cjs');
const HOUR=3600000;

async function setup(){
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);noc.migrate(s);SC.migrate(s);DM.migrate(s);const ids={};
 for(const [n,name] of [['awa','Awa Koné'],['kader','Kader Diallo'],['bob','Bob Zadi']]){ids[n]=(await s.register({email:n+'@example.test',name,password:'demenagement-password-123'})).user.id;}
 operator.grant(s,'kader@example.test','agent');
 for(const u of Object.values(ids))journey.put(s,u,journey.seed());
 s.run("INSERT OR REPLACE INTO noc_members(user_id,segment_id) VALUES(?,'YOP-07')",ids.awa);
 return {s,ids};
}
const t=Date.UTC(2026,10,24,9);   // mardi 24 novembre, 9 h à Abidjan

test('Déménagement de bout en bout : demande, appel du conseiller, installation, nouveau quartier, avis du client',async()=>{
 const {s,ids}=await setup();
 const st=DM.state(s,ids.awa,t);
 assert.equal(st.current,null);assert.ok(st.choices.length>=10);assert.ok(!st.choices.some(c=>new Date(c.day).getUTCDay()===0),'jamais le dimanche');
 const day=st.choices[1].day;
 const r=DM.ask(s,ids.awa,{commune:'Cocody',quartier:'Riviera Palmeraie',repere:'Derrière la pharmacie',day,slot:'matin'},t);
 assert.equal(r.current.status,'demande');assert.equal(r.current.covered,true);assert.match(r.current.text,/vous appelle avant 13 h 00/);
 assert.match(journey.get(s,ids.awa).notifications[0].body,/confirmer votre nouvelle adresse/);
 assert.throws(()=>DM.ask(s,ids.awa,{commune:'Cocody',quartier:'Riviera',day,slot:'matin'},t),/déjà une demande/);
 // Le conseiller voit la demande dans « À rappeler », avec l'adresse ; il prend, appelle, confirme.
 const q=SC.queue(s,ids.kader,t+HOUR),item=q.items.find(i=>i.kind==='demenagement');
 assert.match(item.title,/Riviera Palmeraie, Cocody/);assert.match(item.detail,/Derrière la pharmacie/);
 assert.ok(q.outcomes.find(o=>o.key==='demenagement').only==='demenagement');
 SC.act(s,ids.kader,{id:item.id,action:'take'},t+HOUR);
 SC.act(s,ids.kader,{id:item.id,action:'result',outcome:'demenagement'},t+2*HOUR);
 let c=DM.state(s,ids.awa,t+2*HOUR).current;assert.equal(c.status,'planifie');assert.match(c.text,/C’est confirmé/);assert.equal(c.steps[1].label,'Kader a appelé');
 // Pas de « C'est réglé ? » avant l'installation, même 3 jours plus tard (le jour n'est pas venu).
 assert.equal(SC.mine(s,ids.awa,day-HOUR).items[0].status,'appele');
 // Le jour venu, après le créneau : la fibre est installée, le client change de quartier, on lui demande son avis.
 c=DM.state(s,ids.awa,day+12*HOUR+1).current;assert.equal(c.status,'fait');
 assert.equal(s.get('SELECT segment_id FROM noc_members WHERE user_id=?',ids.awa).segment_id,'PAL-02','Riviera Palmeraie → Cocody · Palmeraie');
 const m=SC.mine(s,ids.awa,day+12*HOUR+1).items[0];assert.equal(m.status,'reglee');assert.equal(m.canAnswer,true);
 SC.answer(s,ids.awa,{id:m.id,answer:'oui'},day+13*HOUR);SC.answer(s,ids.awa,{id:m.id,rating:5},day+13*HOUR);
 assert.equal(SC.mine(s,ids.awa,day+13*HOUR).items[0].rating,5);
});

test('Hors de la zone fibre : on le dit tout de suite, et un conseiller appelle pour trouver une solution',async()=>{
 const {s,ids}=await setup();
 const r=DM.ask(s,ids.awa,{commune:'Bingerville',quartier:'Cité Feh Kessé'},t);
 assert.equal(r.current.covered,false);assert.equal(r.current.when,null);assert.match(r.current.text,/chercher une solution/);
 assert.match(journey.get(s,ids.awa).notifications[0].body,/n’arrive pas encore à Bingerville/);
 const item=SC.queue(s,ids.kader,t).items[0];assert.match(item.title,/Hors zone fibre/);
 SC.act(s,ids.kader,{id:item.id,action:'take'},t);
 assert.throws(()=>SC.act(s,ids.kader,{id:item.id,action:'result',outcome:'echange'},t),/ne concerne pas/);
 SC.act(s,ids.kader,{id:item.id,action:'result',outcome:'regle',note:'Nous gardons votre ligne active ; je vous préviens quand la fibre arrive.'},t+HOUR);
 assert.equal(DM.state(s,ids.awa,t+HOUR).current.status,'conseille');
 assert.equal(SC.mine(s,ids.awa,t+HOUR).items[0].status,'reglee');
 assert.equal(s.get('SELECT segment_id FROM noc_members WHERE user_id=?',ids.awa).segment_id,'YOP-07','le client garde son quartier');
});

test('Annuler, et refuser une demande mal remplie',async()=>{
 const {s,ids}=await setup();
 assert.throws(()=>DM.ask(s,ids.awa,{commune:'Paris',quartier:'Centre'},t),/commune/);
 assert.throws(()=>DM.ask(s,ids.awa,{commune:'Cocody',quartier:'Riviera'},t),/jour/);
 assert.throws(()=>DM.ask(s,ids.awa,{commune:'Cocody',quartier:'<b>x</b>',day:DM.choices(t)[0].day,slot:'matin'},t),/quartier/);
 DM.ask(s,ids.awa,{commune:'Marcory',quartier:'Zone 4',day:DM.choices(t)[0].day,slot:'apres'},t);
 assert.equal(SC.queue(s,ids.kader,t).items.length,1);
 const r=DM.cancel(s,ids.awa,t+HOUR);assert.equal(r.current,null);
 assert.equal(SC.queue(s,ids.kader,t+HOUR).items.length,0,'la demande quitte la file');
 assert.throws(()=>DM.cancel(s,ids.awa,t+HOUR),/Aucune demande/);
 // Un autre client ne voit rien.
 assert.equal(DM.state(s,ids.bob,t).current,null);
});

test('Cas limites : « non » après l’installation, hors zone, confirmation tardive, commune sans quartier suivi',async()=>{
 const {s,ids}=await setup();
 const boss=(await s.register({email:'fatou@example.test',name:'Fatou Bamba',password:'demenagement-password-123'})).user.id;operator.grant(s,'fatou@example.test','supervisor');
 // Confirmation après le jour choisi : l'installation passe au premier jour possible, jamais « installée » d'office.
 const day=DM.choices(t)[0].day;DM.ask(s,ids.awa,{commune:'Attécoubé',quartier:'Santé',day,slot:'matin'},t);
 let id=SC.queue(s,ids.kader,t).items[0].id;SC.act(s,ids.kader,{id,action:'take'},t);
 const late=day+13*HOUR;SC.act(s,ids.kader,{id,action:'result',outcome:'demenagement'},late);
 let c=DM.state(s,ids.awa,late).current;assert.equal(c.status,'planifie');assert.ok(!/^Installation mercredi 25/.test(c.when),'nouvelle date : '+c.when);
 // Attécoubé n'a pas de quartier suivi : le client ne garde pas les alertes de l'ancien.
 c=DM.state(s,ids.awa,late+3*24*HOUR).current;assert.equal(c.status,'fait');
 assert.equal(s.get('SELECT segment_id FROM noc_members WHERE user_id=?',ids.awa),undefined);
 // « Non, toujours pas » : un responsable reprend ; sa demande se clôt comme les autres (pas bloquée pour toujours).
 const m=SC.mine(s,ids.awa,late+3*24*HOUR).items[0];SC.answer(s,ids.awa,{id:m.id,answer:'non',text:'Pas de signal'},late+3*24*HOUR);
 const up=SC.queue(s,boss,late+3*24*HOUR).items.find(i=>i.level===2);
 SC.act(s,boss,{id:up.id,action:'take'},late+3*24*HOUR);SC.act(s,boss,{id:up.id,action:'result',outcome:'technicien'},late+3*24*HOUR);
 assert.equal(SC.mine(s,ids.awa,late+5*24*HOUR).items.find(i=>i.level===2).status,'reglee');
 // Hors zone : ni technicien ni installation.
 DM.ask(s,ids.bob,{commune:'Anyama',quartier:'Centre'},t);
 id=SC.queue(s,ids.kader,t).items.find(i=>i.name==='Bob Zadi').id;SC.act(s,ids.kader,{id,action:'take'},t);
 for(const outcome of ['technicien','demenagement'])assert.throws(()=>SC.act(s,ids.kader,{id,action:'result',outcome},t),/Réglé au téléphone|ne concerne pas/);
 assert.equal(DM.state(s,ids.bob,t).current.status,'demande');
});
