'use strict';
// « La fibre arrive-t-elle chez moi ? » : le client hors zone le sait tout de suite, demande à être prévenu (et, s'il veut,
// l'appel d'un conseiller), l'équipe voit les communes les plus demandées, un responsable ouvre la commune, chaque client
// qui attendait est prévenu et peut commander.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs');
const SC=require('./service-client.cjs'),EL=require('./eligibilite.cjs'),W=require('./welcome.cjs');
const HOUR=3600000,t=Date.UTC(2026,10,24,9);

async function setup(){
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);W.migrate(s);SC.migrate(s);EL.migrate(s);const ids={};
 for(const [n,role] of [['awa',null],['yao',null],['bob',null],['kader','agent'],['fatou','supervisor']]){
  ids[n]=(await s.register({email:n+'@example.test',name:n[0].toUpperCase()+n.slice(1)+' Test',password:'eligibilite-password-123'})).user.id;
  if(role)operator.grant(s,n+'@example.test',role);journey.put(s,ids[n],journey.seed());
 }
 return {s,ids};
}

test('Hors zone : prévenez-moi, appel du conseiller, communes les plus demandées, ouverture, commande',async()=>{
 const {s,ids}=await setup();
 let w=W.state(s,ids.awa,t);assert.ok(w.other.includes('Bingerville'));assert.ok(!w.zone.includes('Bingerville'));assert.equal(w.alerte,null);
 assert.throws(()=>W.act(s,ids.awa,{action:'order',plan:w.plans[0].id,commune:'Bingerville',quartier:'Cité Feh Kessé'},t),/pas encore couverte/);
 // Awa demande aussi l'appel d'un conseiller ; Yao veut seulement être prévenu.
 EL.ask(s,ids.yao,{commune:'Bingerville',quartier:'Résidentiel'},t);
 EL.ask(s,ids.awa,{commune:'Bingerville',quartier:'Cité Feh Kessé',call:true},t);
 EL.ask(s,ids.bob,{commune:'Anyama',quartier:'Centre'},t);
 assert.match(journey.get(s,ids.awa).notifications[0].body,/Un conseiller vous appelle avant 13 h 00/);
 assert.match(journey.get(s,ids.yao).notifications[0].body,/vous recevez un message ici/);
 const q=SC.queue(s,ids.kader,t);assert.equal(q.items.length,1,'seule Awa a demandé un appel');
 assert.equal(q.items[0].kind,'eligibilite');assert.match(q.items[0].detail,/1 autre client attend aussi/);
 assert.equal(W.state(s,ids.yao,t).alerte.others,1);
 // L'équipe voit Bingerville d'abord (2 demandes) ; un conseiller ne peut pas ouvrir une commune.
 const l=EL.list(s,ids.kader,t);assert.deepEqual(l.items.map(i=>[i.commune,i.count]),[['Bingerville',2],['Anyama',1]]);assert.equal(l.canOpen,false);
 assert.throws(()=>EL.open(s,ids.kader,{commune:'Bingerville',confirm:true},t),/responsable/);
 assert.throws(()=>EL.list(s,ids.awa,t),/./);
 assert.throws(()=>EL.open(s,ids.fatou,{commune:'Bingerville'},t),/Confirmez/);
 // La fibre arrive à Bingerville : Awa et Yao sont prévenus, la demande d'Awa au service client se clôt, la commande marche.
 const r=EL.open(s,ids.fatou,{commune:'Bingerville',confirm:true},t+HOUR);
 assert.deepEqual(r.items.map(i=>i.commune),['Anyama']);assert.equal(r.opened[0].told,2);
 for(const u of [ids.awa,ids.yao])assert.match(journey.get(s,u).notifications[0].title,/La fibre Moov arrive à Bingerville/);
 assert.equal(SC.mine(s,ids.awa,t+HOUR).items[0].status,'reglee');
 w=W.state(s,ids.awa,t+HOUR);assert.ok(w.zone.includes('Bingerville'));assert.equal(w.alerte.status,'arrivee');assert.ok(!w.other.includes('Bingerville'));
 W.act(s,ids.awa,{action:'order',plan:w.plans[0].id,commune:'Bingerville',quartier:'Cité Feh Kessé'},t+2*HOUR);
 assert.equal(W.state(s,ids.awa,t+2*HOUR).order.commune,'Bingerville');
 assert.throws(()=>EL.ask(s,ids.bob,{commune:'Bingerville',quartier:'Centre'},t+2*HOUR),/arrive déjà/);
 assert.throws(()=>EL.open(s,ids.fatou,{commune:'Bingerville',confirm:true},t+2*HOUR),/arrive déjà/);
});

test('Une seule demande par client, annulation, saisie contrôlée',async()=>{
 const {s,ids}=await setup();
 assert.throws(()=>EL.ask(s,ids.awa,{commune:'Cocody',quartier:'Riviera'},t),/commune/,'Cocody est déjà couverte : pas dans la liste');
 assert.throws(()=>EL.ask(s,ids.awa,{commune:'Bingerville',quartier:'<script>'},t),/quartier/);
 EL.ask(s,ids.awa,{commune:'Bingerville',quartier:'Centre'},t);EL.ask(s,ids.awa,{commune:'Songon',quartier:'Agban',call:true},t);
 assert.equal(s.get("SELECT COUNT(*) n FROM elig_demandes WHERE user_id=? AND status='attente'",ids.awa).n,1);
 assert.equal(EL.state(s,ids.awa,t).mine.commune,'Songon');
 assert.equal(SC.queue(s,ids.kader,t).items.length,1);
 EL.cancel(s,ids.awa,t+HOUR);
 assert.equal(EL.state(s,ids.awa,t+HOUR).mine,null);assert.equal(SC.queue(s,ids.kader,t+HOUR).items.length,0);
 assert.throws(()=>EL.cancel(s,ids.awa,t+HOUR),/Aucune demande/);
});

test('Commune ouverte : un déménagement déjà demandé devient possible ; la demande d’appel suit le changement de commune',async()=>{
 const {s,ids}=await setup();require('./noc-store.cjs').migrate(s);const DM=require('./demenagement.cjs');DM.migrate(s);
 DM.ask(s,ids.awa,{commune:'Bingerville',quartier:'Centre'},t);
 const id=SC.queue(s,ids.kader,t).items[0].id;SC.act(s,ids.kader,{id,action:'take'},t);
 EL.open(s,ids.fatou,{commune:'Bingerville',confirm:true},t+HOUR);
 SC.act(s,ids.kader,{id,action:'result',outcome:'demenagement'},t+2*HOUR);
 assert.equal(DM.state(s,ids.awa,t+2*HOUR).current.status,'planifie');
 EL.ask(s,ids.yao,{commune:'Anyama',quartier:'Centre',call:true},t);EL.ask(s,ids.yao,{commune:'Songon',quartier:'Agban'},t+HOUR);
 assert.match(SC.queue(s,ids.kader,t+HOUR).items.find(i=>i.kind==='eligibilite').title,/Agban, Songon/);
 EL.ask(s,ids.bob,{commune:'Autre ville',quartier:'Korhogo'},t);assert.match(journey.get(s,ids.bob).notifications[0].body,/demandez l’appel/);
});
