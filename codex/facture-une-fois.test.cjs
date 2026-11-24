'use strict';
// Une facture se paie une seule fois : d'un coup (Ma fidélité, ou Mon compte quand la ligne est suspendue)
// OU en plusieurs fois (Offres solidaires), jamais les deux. Le serveur le refuse dans tous les ordres,
// et l'écran Offres solidaires dit « déjà payée » au lieu de proposer de payer en plusieurs fois.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs'),noc=require('./noc-store.cjs');
const FL=require('./fidelite.cjs'),AC=require('./acces.cjs'),LG=require('./ligne.cjs'),PA=require('./paiements.cjs'),SIM=require('./simulations.cjs');
const NOW=Date.UTC(2026,10,10,9);

async function setup(){
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);noc.migrate(s);FL.migrate(s);AC.migrate(s);LG.migrate(s);
 const u=(await s.register({email:'awa@example.test',name:'Awa Koné',password:'facture-password-12'})).user;
 journey.put(s,u.id,journey.seed());
 return {s,uid:u.id};
}
// Tout ce qui a été encaissé pour la facture de novembre (Mes paiements).
const cashed=(s,uid)=>PA.list(s,uid).items.filter(i=>/novembre 2026/.test(i.label)).reduce((n,i)=>n+i.amount,0);
const refused=(fn,re)=>assert.throws(fn,e=>e.status===409&&re.test(e.message));

test('Payée d’un coup : ni 2e paiement, ni paiement en plusieurs fois ; l’écran le dit',async()=>{
 const {s,uid}=await setup(),b=FL.state(s,uid,NOW).bill;
 FL.pay(s,uid,{confirm:true,month:b.month},NOW);
 refused(()=>FL.pay(s,uid,{confirm:true,month:b.month},NOW),/déjà payée/);
 refused(()=>AC.act(s,uid,{action:'split',parts:2,confirm:true},NOW+1000),/déjà payée/);
 refused(()=>AC.act(s,uid,{action:'split-pay',part:0},NOW+2000),/Aucun paiement en plusieurs fois/);
 const a=AC.state(s,uid,NOW+3000);
 assert.equal(a.billPaid,NOW,'Offres solidaires sait que la facture est déjà payée');assert.equal(a.split,null);
 assert.equal(cashed(s,uid),b.amount,'la facture n’est encaissée qu’une fois');
});

test('Payée en plusieurs fois : plus de paiement d’un coup, ni pendant ni après les parts',async()=>{
 const {s,uid}=await setup(),b=FL.state(s,uid,NOW).bill;
 AC.act(s,uid,{action:'split',parts:3,confirm:true},NOW);
 refused(()=>FL.pay(s,uid,{confirm:true,month:b.month},NOW+500),/se paie déjà en plusieurs fois/);
 refused(()=>AC.act(s,uid,{action:'split',parts:2,confirm:true},NOW+600),/déjà payé en plusieurs fois/);
 for(const k of [0,1,2])AC.act(s,uid,{action:'split-pay',part:k},NOW+1000+k);
 refused(()=>FL.pay(s,uid,{confirm:true,month:b.month},NOW+5000),/déjà payée/);
 refused(()=>AC.act(s,uid,{action:'split-pay',part:2},NOW+6000),/Tout est déjà payé/);
 const bill=FL.state(s,uid,NOW+7000).bill;assert.equal(bill.paid,true);assert.equal(bill.channel,'plusieurs_fois');
 assert.equal(AC.state(s,uid,NOW+7000).billPaid,null,'le mois étalé reste affiché avec ses parts');
 assert.equal(cashed(s,uid),b.amount,'la somme des parts = la facture, rien de plus');
});

test('Filet de sécurité : une part n’est plus encaissée si la facture a été réglée d’un coup entre-temps',async()=>{
 const {s,uid}=await setup(),b=FL.state(s,uid,NOW).bill;
 AC.act(s,uid,{action:'split',parts:2,confirm:true},NOW);
 AC.act(s,uid,{action:'split-pay',part:0},NOW+1000);
 // Par exemple réglée en agence : la base dit « payée ».
 s.run("UPDATE fidelite_factures SET paid_at=?,channel='agence' WHERE user_id=? AND month=?",NOW+2000,uid,b.month);
 refused(()=>AC.act(s,uid,{action:'split-pay',part:1},NOW+3000),/déjà payée/);
});

test('Deux demandes de paiement coup sur coup : une seule passe',async()=>{
 const {s,uid}=await setup(),b=FL.state(s,uid,NOW).bill;
 FL.pay(s,uid,{confirm:true,month:b.month},NOW);
 // Même si la vérification d'avant laissait passer, la mise à jour ne touche qu'une facture non payée.
 assert.equal(s.run("UPDATE fidelite_factures SET paid_at=? WHERE user_id=? AND month=? AND paid_at IS NULL",NOW+1,uid,b.month).changes,0);
 assert.equal(s.get('SELECT paid_at FROM fidelite_factures WHERE user_id=? AND month=?',uid,b.month).paid_at,NOW,'la 1re date de paiement est gardée');
});

test('Ligne suspendue (scène de la Régie) payée dans Mon compte : la facture est réglée, Ma fidélité ne la redemande pas',async()=>{
 const {s,uid}=await setup(),b=FL.state(s,uid,NOW).bill;
 SIM.run(s,uid,{scene:'suspendue'},NOW);
 assert.equal(LG.state(s,uid,NOW).status,'suspendue');
 LG.pay(s,uid,NOW+1000);
 const bill=FL.state(s,uid,NOW+2000).bill;assert.equal(bill.paid,true,'Ma fidélité la montre payée');
 refused(()=>FL.pay(s,uid,{confirm:true,month:b.month},NOW+3000),/déjà payée/);
 refused(()=>AC.act(s,uid,{action:'split',parts:2,confirm:true},NOW+3000),/déjà payée/);
 assert.equal(cashed(s,uid),b.amount);
});

test('Ligne suspendue puis « payer en 2 fois » : on ne fait plus payer la facture entière en plus des parts',async()=>{
 const {s,uid}=await setup(),b=FL.state(s,uid,NOW).bill;
 SIM.run(s,uid,{scene:'suspendue'},NOW);
 AC.act(s,uid,{action:'split',parts:2,confirm:true},NOW+500);
 const l=LG.state(s,uid,NOW+600);
 assert.equal(l.status,'suspendue');assert.equal(l.kind,'part','ce qui manque est la 1re part');assert.equal(l.payable,false);
 refused(()=>LG.pay(s,uid,NOW+700),/Offres solidaires/);
 AC.act(s,uid,{action:'split-pay',part:0},NOW+800);
 assert.equal(LG.state(s,uid,NOW+900).status,'active');
 AC.act(s,uid,{action:'split-pay',part:1},NOW+1000);
 assert.equal(cashed(s,uid),b.amount);
});

test('Régie : pas de scène « Ligne suspendue » sur une facture déjà réglée (d’un coup ou en parts)',async()=>{
 const a=await setup(),b=FL.state(a.s,a.uid,NOW).bill;
 FL.pay(a.s,a.uid,{confirm:true,month:b.month},NOW);
 refused(()=>LG.demoSuspend(a.s,a.uid,NOW+1000),/déjà payée/);
 const c=await setup();FL.state(c.s,c.uid,NOW);
 AC.act(c.s,c.uid,{action:'split',parts:2,confirm:true},NOW);
 for(const k of [0,1])AC.act(c.s,c.uid,{action:'split-pay',part:k},NOW+1+k);
 refused(()=>LG.demoSuspend(c.s,c.uid,NOW+1000),/déjà payée/);
});
