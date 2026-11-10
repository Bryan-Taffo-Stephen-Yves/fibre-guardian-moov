'use strict';
// Fibre Access (thème 9) : tarif étudiant vérifié par un conseiller (photo effacée ensuite), pack voisins réservé
// à la même commune, paiement d'un mois en 2 ou 3 fois sans frais ; chiffres réservés à l'équipe Moov.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs'),noc=require('./noc-store.cjs');
const AC=require('./acces.cjs');
const NOW=Date.UTC(2026,10,10,10),DAY=86400000,PHOTO='data:image/jpeg;base64,'+'A'.repeat(400);

async function setup(){
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);noc.migrate(s);AC.migrate(s);const ids={};
 for(const [n,seg] of [['awa','YOP-07'],['yao','YOP-07'],['ali','YOP-07'],['aya','COC-03'],['kader',null]]){
  const u=(await s.register({email:n+'@example.test',name:n==='awa'?'Awa Koné':n,password:'acces-password-12'})).user;ids[n]=u.id;
  if(seg){journey.put(s,u.id,journey.seed());noc.join(s,u.id,{segment:seg,consent:true});}
 }
 operator.grant(s,'kader@example.test','agent');return {s,ids};
}

test('Carte étudiante : vérifiée par un conseiller, −30 % sur le forfait, photo effacée',async()=>{
 const {s,ids}=await setup();
 assert.throws(()=>AC.act(s,ids.awa,{action:'student',school:'IUGB',until:NOW-DAY,photo:PHOTO},NOW),{status:400},'carte expirée refusée');
 let st=AC.act(s,ids.awa,{action:'student',school:'IUGB, Grand-Bassam',until:NOW+200*DAY,photo:PHOTO},NOW);
 assert.equal(st.student.status,'verification');assert.equal(st.price,20000,'pas de réduction avant la vérification');
 assert.throws(()=>AC.act(s,ids.awa,{action:'student',school:'IUGB',until:NOW+200*DAY,photo:PHOTO},NOW),{status:409});
 assert.throws(()=>AC.list(s,ids.awa,NOW),{status:403});
 const l=AC.list(s,ids.kader,NOW);assert.equal(l.cards[0].name,'Awa K.');assert.equal(l.cards[0].photo,PHOTO);
 AC.decide(s,ids.kader,{id:ids.awa,decision:'valide'},NOW);
 st=AC.state(s,ids.awa,NOW);assert.equal(st.student.status,'valide');assert.equal(st.price,14000);
 assert.equal(s.get('SELECT photo FROM acces_etudiants WHERE user_id=?',ids.awa).photo,null,'photo effacée après la décision');
 assert.equal(journey.get(s,ids.awa).notifications[0].title,'Tarif étudiant activé');
 assert.equal(AC.state(s,ids.awa,NOW+201*DAY).student.status,'expire');
});

test('Pack voisins : même commune seulement, prix partagé, 4 foyers au plus',async()=>{
 const {s,ids}=await setup();
 let st=AC.act(s,ids.awa,{action:'pack-open',pack:'voisins-300',confirm:true},NOW);
 assert.equal(st.pack.commune,'Yopougon');assert.equal(st.pack.share,36000);
 const code=st.pack.code;assert.match(code,/^FAM-[A-Z0-9]{4}$/);
 assert.throws(()=>AC.act(s,ids.aya,{action:'pack-join',code},NOW),{status:409},'un foyer de Cocody ne rejoint pas un pack de Yopougon');
 AC.act(s,ids.yao,{action:'pack-join',code:code.toLowerCase()},NOW);st=AC.act(s,ids.ali,{action:'pack-join',code},NOW);
 assert.equal(st.pack.homes.length,3);assert.equal(st.pack.share,12000);assert.equal(st.pack.mbpsEach,100);
 assert.equal(journey.get(s,ids.awa).notifications[0].title,'Un voisin a rejoint votre pack');
 AC.act(s,ids.awa,{action:'pack-leave'},NOW);assert.equal(AC.state(s,ids.yao,NOW).pack.owner,true,'le foyer suivant reprend le pack');
});

test('Payer son mois en 3 fois : parts sans frais, une à une, pas deux fois le même mois',async()=>{
 const {s,ids}=await setup();
 assert.throws(()=>AC.act(s,ids.awa,{action:'split',parts:4,confirm:true},NOW),{status:400});
 let st=AC.act(s,ids.awa,{action:'split',parts:3,confirm:true},NOW);
 assert.deepEqual(st.split.parts.map(p=>p.amount),[6700,6650,6650]);assert.equal(st.split.parts.reduce((n,p)=>n+p.amount,0),20000);
 assert.deepEqual(st.split.parts.map(p=>p.due-NOW),[0,10*DAY,20*DAY]);
 assert.throws(()=>AC.act(s,ids.awa,{action:'split-pay',part:1},NOW),{status:409},'les parts se paient dans l’ordre');
 st=AC.act(s,ids.awa,{action:'split-pay',part:0},NOW);assert.ok(st.split.parts[0].paid);
 assert.throws(()=>AC.act(s,ids.awa,{action:'split',parts:2,confirm:true},NOW),{status:409});
 const l=AC.list(s,ids.kader,NOW);assert.equal(l.splits,1);assert.equal(l.left,13300);
});
