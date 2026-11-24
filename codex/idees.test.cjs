'use strict';
// Boîte à idées : proposer, idée proche → voter pour elle, « Moi aussi », réponse d'un responsable à chaque étape,
// « C'est fait » envoyé à l'auteur et à tous les votants.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs');
const ID=require('./idees.cjs');
const HOUR=3600000,t=Date.UTC(2026,10,24,9);

async function setup(){
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);ID.migrate(s);const ids={};
 for(const [n,role] of [['awa',null],['yao',null],['bob',null],['kader','agent'],['fatou','supervisor']]){
  ids[n]=(await s.register({email:n+'@example.test',name:n[0].toUpperCase()+n.slice(1)+' Test',password:'idees-password-123'})).user.id;
  if(role)operator.grant(s,n+'@example.test',role);journey.put(s,ids[n],journey.seed());
 }
 return {s,ids};
}

test('Une idée de bout en bout : proposée, soutenue, étudiée, prévue, faite, et tout le monde est prévenu',async()=>{
 const {s,ids}=await setup();
 let r=ID.propose(s,ids.awa,{text:'Pouvoir choisir l’heure exacte du passage du technicien'},t);
 assert.ok(r.sent);assert.equal(r.mine[0].votes,1);assert.equal(r.mine[0].label,'Reçue');
 // Yao écrit presque la même chose : Guardian lui montre l'idée d'Awa ; il vote pour elle.
 r=ID.propose(s,ids.yao,{text:'Choisir l’heure du passage du technicien chez moi'},t+HOUR);
 assert.ok(r.similar,'idée proche trouvée');assert.equal(r.similar.text,'Pouvoir choisir l’heure exacte du passage du technicien');
 ID.vote(s,ids.yao,{id:r.similar.id},t+HOUR);ID.vote(s,ids.yao,{id:r.similar.id},t+HOUR);   // deux clics : une seule voix
 ID.propose(s,ids.bob,{text:'Recevoir la facture sur WhatsApp chaque mois'},t+HOUR);
 const id=r.similar.id;
 assert.deepEqual(ID.state(s,ids.bob,t+2*HOUR).open.map(i=>i.votes),[2,1],'la plus soutenue d’abord');
 // Un conseiller voit les idées mais ne décide pas ; un client ne voit pas la liste de l'équipe.
 assert.equal(ID.list(s,ids.kader,t).canAct,false);assert.equal(ID.list(s,ids.kader,t).items[0].next.length,0);
 assert.throws(()=>ID.decide(s,ids.kader,{id,status:'etude'},t),/responsable/);
 assert.throws(()=>ID.list(s,ids.awa,t),/./);
 // Le responsable fait avancer l'idée ; on ne saute pas d'étape.
 assert.throws(()=>ID.decide(s,ids.fatou,{id,status:'faite'},t),/Étape impossible/);
 let l=ID.decide(s,ids.fatou,{id,status:'etude'},t+3*HOUR);assert.equal(l.told,2);
 assert.match(journey.get(s,ids.yao).notifications[0].title,/à l’étude/);
 ID.decide(s,ids.fatou,{id,status:'prevue',answer:'Les créneaux d’une heure arrivent en décembre.'},t+4*HOUR);
 l=ID.decide(s,ids.fatou,{id,status:'faite'},t+5*HOUR);
 for(const u of [ids.awa,ids.yao]){const n=journey.get(s,u).notifications[0];assert.match(n.title,/C’est fait/);assert.match(n.body,/Merci/);}
 assert.equal(journey.get(s,ids.bob).notifications.filter(n=>/idée/.test(n.title)).length,0,'Bob n’a pas voté pour celle-ci');
 const st=ID.state(s,ids.bob,t+5*HOUR);assert.equal(st.done[0].id,id);assert.equal(st.done[0].answer,'Les créneaux d’une heure arrivent en décembre.');
 assert.throws(()=>ID.vote(s,ids.bob,{id},t+5*HOUR),/n’attend plus/);
});

test('« Pas pour l’instant » demande une raison ; saisie et abus contrôlés',async()=>{
 const {s,ids}=await setup();
 assert.throws(()=>ID.propose(s,ids.awa,{text:'court'},t),/10 à 280/);
 assert.throws(()=>ID.propose(s,ids.awa,{text:'<script>alert(1)</script> une idée'},t),/10 à 280/);
 const id=ID.propose(s,ids.awa,{text:'Une box qui tient 6 heures sans courant'},t).sent;
 assert.throws(()=>ID.vote(s,ids.awa,{id,off:true},t),/votre voix reste/);
 assert.throws(()=>ID.decide(s,ids.fatou,{id,status:'non'},t),/pourquoi/);
 ID.decide(s,ids.fatou,{id,status:'non',answer:'Le prix de la batterie doublerait celui de la box.'},t);
 assert.match(journey.get(s,ids.awa).notifications[0].body,/doublerait/);
 for(const k of ['Des tarifs pour les familles nombreuses','Un mode nuit pour couper le Wi-Fi','Une alerte avant la fin du forfait','Des points fidélité pour chaque parrainage'])ID.propose(s,ids.awa,{text:k,force:true},t);
 assert.throws(()=>ID.propose(s,ids.awa,{text:'Une sixième idée dans la même journée',force:true},t),/demain/);
 assert.equal(ID.close('Une alerte avant la fin du forfait','Recevoir une alerte avant la fin de mon forfait')>=0.5,true);
 assert.equal(ID.close('Une alerte avant la fin du forfait','Des tarifs pour les familles')<0.5,true);
});
