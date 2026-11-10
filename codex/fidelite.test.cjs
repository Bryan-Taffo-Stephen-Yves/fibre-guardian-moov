'use strict';
// Fibre Loyalty+ (thème 2) : points gagnés en payant en ligne et à temps, niveau Argent automatique après 12 mois
// payés à temps avec débit boosté offert, échanges de points, et chiffres réservés à l'équipe Moov.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs'),noc=require('./noc-store.cjs');
const FL=require('./fidelite.cjs');
const NOW=Date.UTC(2026,10,10,10);

async function setup(){
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);noc.migrate(s);FL.migrate(s);const ids={};
 for(const n of ['awa','yao','kader']){const u=(await s.register({email:n+'@example.test',name:n==='awa'?'Awa Koné':n,password:'fidelite-password-1'})).user;ids[n]=u.id;}
 operator.grant(s,'kader@example.test','agent');for(const u of [ids.awa,ids.yao])journey.put(s,u,journey.seed());
 return {s,ids};
}

test('Facture du mois et jauge : « Plus que 230 points avant le niveau Argent »',async()=>{
 const {s,ids}=await setup();FL.history(s,ids.awa,{months:11,agence:[7,4]},NOW);
 const st=FL.state(s,ids.awa,NOW);
 // 9 factures en ligne (50) + 2 en agence (10) + 3 trimestres sans impayé (100).
 assert.equal(st.points,9*50+2*10+3*100);assert.equal(st.tier.id,'bronze');
 assert.deepEqual([st.next.name,st.next.missing],['Argent',230]);assert.equal(st.streak,11);
 assert.deepEqual([st.bill.label,st.bill.amount,st.bill.paid,st.bill.late],['novembre 2026',20000,false,false]);
 assert.equal(new Date(st.bill.due).toISOString(),'2026-11-30T23:59:00.000Z','échéance : fin du mois');
});

test('La 12e facture payée à temps : niveau Argent, débit boosté un mois et client prévenu ; pas deux paiements',async()=>{
 const {s,ids}=await setup();FL.history(s,ids.awa,{months:11,agence:[7,4]},NOW);
 const month=FL.state(s,ids.awa,NOW).bill.month;
 assert.throws(()=>FL.pay(s,ids.awa,{month},NOW),{status:400},'confirmation obligatoire');
 const r=FL.pay(s,ids.awa,{confirm:true,month},NOW);
 assert.equal(r.won,50+100,'en ligne et à temps, plus le 4e trimestre sans impayé');
 assert.equal(r.tier.id,'argent');assert.deepEqual(r.promoted,{id:'argent',name:'Argent'});
 assert.deepEqual([r.boost.mbps,r.boost.until],[200,NOW+30*86400000]);
 assert.equal(journey.get(s,ids.awa).notifications[0].title,'Vous passez au niveau Argent');
 assert.throws(()=>FL.pay(s,ids.awa,{confirm:true,month},NOW),{status:409});
});

test('Une facture en retard remet la série à zéro et ne rapporte pas les points « à temps »',async()=>{
 const {s,ids}=await setup();FL.history(s,ids.yao,{months:6,late:[3]},NOW);
 const st=FL.state(s,ids.yao,NOW);
 assert.equal(st.streak,2);assert.equal(st.history.find(b=>b.late).points,40);
 assert.equal(st.points,6*40+5*10+100,'les 3 premiers mois à temps rapportent le bonus trimestre');
});

test('Échanger des points : refusé s’il en manque, accepté sinon ; chiffres pour Moov seulement',async()=>{
 const {s,ids}=await setup();FL.history(s,ids.awa,{months:11,agence:[7,4]},NOW);FL.history(s,ids.yao,{months:24},NOW);
 assert.throws(()=>FL.redeem(s,ids.awa,{reward:'mois',confirm:true},NOW),{status:409});
 const st=FL.redeem(s,ids.awa,{reward:'boost',confirm:true},NOW);
 assert.equal(st.points,770-300);assert.equal(st.boost.why,'Échangé contre vos points');
 assert.equal(FL.state(s,ids.yao,NOW).tier.id,'or','24 mois en ligne et à temps : niveau Or');
 const m=FL.summary(s,ids.kader,NOW);
 assert.equal(m.clients,2);assert.deepEqual(m.tiers.map(t=>t.count),[1,0,1]);assert.equal(m.exchanges[0].name,'Awa K.');
 assert.throws(()=>FL.summary(s,ids.awa,NOW),{status:403});
});
