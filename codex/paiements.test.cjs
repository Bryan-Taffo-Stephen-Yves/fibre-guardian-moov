'use strict';
// « Mes paiements » (Mon compte) : factures, parts et forfaits payés, du plus récent au plus ancien, avec une référence
// de reçu qui ne change pas ; chaque client ne voit que ses propres paiements.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs'),noc=require('./noc-store.cjs');
const FL=require('./fidelite.cjs'),AC=require('./acces.cjs'),PA=require('./paiements.cjs');
const NOW=Date.UTC(2026,10,10,10);

async function setup(){
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);noc.migrate(s);FL.migrate(s);AC.migrate(s);const ids={};
 for(const n of ['awa','yao']){const u=(await s.register({email:n+'@example.test',name:n,password:'paiements-password-1'})).user;ids[n]=u.id;journey.put(s,u.id,journey.seed());}
 return {s,ids};
}

test('Factures payées (en ligne ou en agence), du plus récent au plus ancien, 12 au plus',async()=>{
 const {s,ids}=await setup();FL.history(s,ids.awa,{months:11,agence:[2]},NOW);
 const r=PA.list(s,ids.awa);
 assert.equal(r.total,11);assert.equal(r.items.length,11);
 assert.equal(r.items[0].label,'Facture de octobre 2026');assert.equal(r.items[0].amount,20000);assert.equal(r.items[0].channel,'moov_money');
 assert.equal(r.items[1].channel,'agence','septembre payé en agence');
 assert.ok(r.items.every((p,i)=>!i||r.items[i-1].at>=p.at),'trié du plus récent');
 assert.match(r.items[0].ref,/^MM[0-9A-F]{8}$/);
 assert.equal(PA.list(s,ids.awa).items[0].ref,r.items[0].ref,'la référence ne change pas');
 assert.equal(PA.list(s,ids.yao).total,0,'Yao ne voit pas les paiements d’Awa');
 FL.history(s,ids.awa,{months:15},NOW);assert.equal(PA.list(s,ids.awa).items.length,12);
});

test('Passage à un forfait plus rapide : gardé avec sa référence, celle de l’écran « Paiement réussi »',async()=>{
 const {s,ids}=await setup();
 const st=journey.get(s,ids.awa);
 st.payment={at:NOW-1000,amount:1500,mode:'simulation'};journey.put(s,ids.awa,st);
 let r=PA.list(s,ids.awa);
 assert.equal(r.items.length,1,'un ancien compte garde son dernier passage');assert.equal(r.items[0].kind,'forfait');
 st.payments=[{at:NOW,amount:3333,mbps:200,ref:'MMABCDEF12'}];st.payment={at:NOW,amount:3333,ref:'MMABCDEF12'};journey.put(s,ids.awa,st);
 r=PA.list(s,ids.awa);
 assert.equal(r.items.length,1,'pas de doublon');assert.deepEqual([r.items[0].label,r.items[0].amount,r.items[0].ref],['Passage à 200 Mb/s',3333,'MMABCDEF12']);
});
