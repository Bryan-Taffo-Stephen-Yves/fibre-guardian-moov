'use strict';
// Échange de box : une box qui ne s'allume plus se remplace en un geste (agence ou technicien),
// l'équipe Moov fait avancer la demande, le client est prévenu à chaque étape.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs');
const EB=require('./echange-box.cjs');
const DAY=86400000;

async function setup(){
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);EB.migrate(s);const ids={};
 for(const n of ['awa','fatou']){const u=(await s.register({email:n+'@example.test',name:n==='awa'?'Awa Koné':'Fatou',password:'echange-password-123'})).user;ids[n]=u.id;}
 operator.grant(s,'fatou@example.test','agent');
 journey.put(s,ids.awa,journey.seed());
 return {s,ids};
}

test('Retrait en agence : code de retrait, box prête, puis échangée ; le client est prévenu à chaque étape',async()=>{
 const {s,ids}=await setup(),t=Date.UTC(2026,10,24,9);
 assert.throws(()=>EB.ask(s,ids.awa,{mode:'agence',agence:'yop',tried:false},t),/autre prise/,'il faut avoir essayé une autre prise');
 const r=EB.ask(s,ids.awa,{mode:'agence',agence:'yop',tried:true,reason:'Après la coupure de courant'},t);
 assert.equal(r.current.status,'demandee');assert.match(r.current.code,/^BX-[0-9A-F]{6}$/);assert.equal(r.current.agence,'Agence Moov de Yopougon');
 assert.throws(()=>EB.ask(s,ids.awa,{mode:'agence',agence:'coc',tried:true},t),/déjà une demande/);
 assert.match(journey.get(s,ids.awa).notifications[0].body,/code de retrait/);
 // Le client ne peut pas faire avancer sa propre demande.
 assert.throws(()=>EB.list(s,ids.awa,t));
 const l=EB.list(s,ids.fatou,t+2*DAY);assert.equal(l.open.length,1);assert.equal(l.open[0].late,true);assert.equal(l.open[0].name,'Awa Koné');
 assert.throws(()=>EB.advance(s,ids.fatou,{id:r.current.id,to:'envoye'},t),/déjà avancé/,'une demande en agence ne passe pas par « technicien envoyé »');
 EB.advance(s,ids.fatou,{id:r.current.id,to:'prete'},t+DAY);
 assert.equal(journey.get(s,ids.awa).notifications[0].title,'Votre box neuve est prête');
 assert.throws(()=>EB.cancel(s,ids.awa,t+DAY),/déjà prête/);
 const done=EB.advance(s,ids.fatou,{id:r.current.id,to:'echangee'},t+DAY+1000);
 assert.equal(done.open.length,0);assert.equal(done.done,1);
 assert.equal(EB.state(s,ids.awa,t+DAY+2000).current.status,'echangee','le client voit « Box échangée » pendant 3 jours');
 assert.equal(EB.state(s,ids.awa,t+5*DAY).current,null);
});

test('Technicien à domicile : jour suivant (jamais le dimanche), créneau, annulation possible tant que rien n’est parti',async()=>{
 const {s,ids}=await setup(),saturday=Date.UTC(2026,10,28,10);
 assert.throws(()=>EB.ask(s,ids.awa,{mode:'technicien',slot:'nuit',tried:true},saturday),/matin ou l’après-midi/);
 const r=EB.ask(s,ids.awa,{mode:'technicien',slot:'matin',tried:true},saturday);
 assert.match(r.current.when,/^lundi 30 novembre, entre 8 h et 12 h$/,'pas de passage le dimanche');
 assert.equal(r.current.code,null);
 const c=EB.cancel(s,ids.awa,saturday+1000);assert.equal(c.current,null);
 assert.throws(()=>EB.cancel(s,ids.awa,saturday+2000),/Aucune demande/);
});

test('Technicien envoyé après le jour prévu : le passage est reporté au prochain jour possible, et la demande est en retard après le créneau',async()=>{
 const {s,ids}=await setup(),t=Date.UTC(2026,10,24,9);
 const r=EB.ask(s,ids.awa,{mode:'technicien',slot:'matin',tried:true},t);
 assert.match(r.current.when,/^mercredi 25 novembre/);
 assert.equal(EB.list(s,ids.fatou,Date.UTC(2026,10,25,11)).open[0].late,false,'pas en retard pendant le créneau');
 assert.equal(EB.list(s,ids.fatou,Date.UTC(2026,10,25,13)).open[0].late,true,'en retard après midi');
 EB.advance(s,ids.fatou,{id:r.current.id,to:'envoye'},Date.UTC(2026,10,27,9));
 const v=EB.state(s,ids.awa,Date.UTC(2026,10,27,9)).current;
 assert.equal(v.step,'Technicien prévu');assert.match(v.when,/^samedi 28 novembre/);
 assert.match(journey.get(s,ids.awa).notifications[0].body,/samedi 28 novembre/);
});
