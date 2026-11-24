'use strict';
// « J'ai payé mais je suis coupé » : ligne suspendue pour facture impayée, rétablie dans la seconde au paiement,
// Guardian donne la vraie raison, et une facture ne se paie pas deux fois (d'un coup + en plusieurs fois).
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs'),noc=require('./noc-store.cjs');
const FL=require('./fidelite.cjs'),AC=require('./acces.cjs'),LG=require('./ligne.cjs'),SIM=require('./simulations.cjs');
const DAY=86400000;

async function setup(){
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);noc.migrate(s);FL.migrate(s);AC.migrate(s);LG.migrate(s);
 const u=(await s.register({email:'awa@example.test',name:'Awa Koné',password:'ligne-password-123'})).user;
 journey.put(s,u.id,journey.seed());
 return {s,uid:u.id};
}

test('Facture non payée 5 jours après l’échéance : ligne suspendue, puis rétablie dès le paiement Moov Money',async()=>{
 const {s,uid}=await setup(),now=Date.UTC(2026,10,10,9);
 const b=FL.state(s,uid,now).bill;
 assert.equal(LG.state(s,uid,now).status,'active','pas de suspension avant l’échéance');
 // Le client ouvre l'application 6 jours après l'échéance : la facture du mois est toujours celle-là dans ce test.
 s.run('UPDATE fidelite_factures SET due=? WHERE user_id=? AND month=?',now-6*DAY,uid,b.month);
 let l=LG.state(s,uid,now);
 assert.equal(l.status,'suspendue');assert.equal(l.amount,b.amount);
 let st=journey.get(s,uid);assert.ok(st.suspended);assert.match(st.notifications[0].title,/Internet suspendu/);
 // Guardian donne la vraie raison et propose de payer.
journey.act(s,uid,{type:'chat',version:st.version,text:'Je n’ai plus internet'});
 const said=journey.get(s,uid).messages.at(-1);
 assert.match(said.text,/suspendu car la facture/);assert.equal(said.action,'payer');
 // « J'ai payé » sans paiement : on dit ce qui manque, la ligne reste suspendue.
 const miss=LG.paid(s,uid,now);assert.equal(miss.lifted,false);assert.match(miss.text,/ne trouvons pas encore/);
 // Paiement Moov Money : la ligne revient tout de suite.
 FL.pay(s,uid,{confirm:true,month:b.month},now+1000);
 l=LG.state(s,uid,now+1000);
 assert.equal(l.status,'active');assert.ok(l.lifted);
 st=journey.get(s,uid);assert.equal(st.suspended,null);assert.equal(st.notifications[0].title,'Internet rétabli');
 assert.throws(()=>LG.paid(s,uid,now+2000),/ligne est active/);
});

test('« J’ai payé » quand le paiement est déjà enregistré : la ligne revient tout de suite',async()=>{
 const {s,uid}=await setup(),now=Date.UTC(2026,10,10,9);
 const b=FL.state(s,uid,now).bill;
 s.run('INSERT INTO ligne_suspensions(user_id,month,amount,since,origin) VALUES(?,?,?,?,?)',uid,b.month,b.amount,now-DAY,'auto');
 s.run("UPDATE fidelite_factures SET paid_at=?,channel='moov_money' WHERE user_id=? AND month=?",now-3600000,uid,b.month);
 const r=LG.paid(s,uid,now);
 assert.equal(r.lifted,true);assert.match(r.text,/ligne est rétablie/);
});

test('Payer en plusieurs fois : la 1re part rallume la ligne, et la facture ne se paie plus d’un coup',async()=>{
 const {s,uid}=await setup(),now=Date.UTC(2026,10,10,9);
 const b=FL.state(s,uid,now).bill;
 s.run('INSERT INTO ligne_suspensions(user_id,month,amount,since,origin) VALUES(?,?,?,?,?)',uid,b.month,b.amount,now-DAY,'demo');
 AC.act(s,uid,{action:'split',parts:2,confirm:true},now);
 assert.equal(LG.state(s,uid,now).status,'suspendue','choisir d’étaler ne suffit pas : il faut payer la 1re part');
 assert.equal(FL.state(s,uid,now).bill.split.count,2);
 assert.throws(()=>FL.pay(s,uid,{confirm:true,month:b.month},now),/se paie déjà en plusieurs fois/,'pas de 2e paiement de la même facture');
 AC.act(s,uid,{action:'split-pay',part:0},now+1000);
 assert.equal(LG.state(s,uid,now+1000).status,'active');
 AC.act(s,uid,{action:'split-pay',part:1},now+2000);
 const bill=FL.state(s,uid,now+2000).bill;assert.equal(bill.paid,true);assert.equal(bill.channel,'plusieurs_fois');
});

test('Facture déjà payée d’un coup : on ne peut plus la payer en plusieurs fois',async()=>{
 const {s,uid}=await setup(),now=Date.UTC(2026,10,10,9);
 const b=FL.state(s,uid,now).bill;
 FL.pay(s,uid,{confirm:true,month:b.month},now);
 assert.throws(()=>AC.act(s,uid,{action:'split',parts:3,confirm:true},now),/déjà payée/);
});

test('Régie : la scène « Ligne suspendue » coupe la ligne du client et Guardian lui explique pourquoi',async()=>{
 const {s,uid}=await setup(),now=Date.UTC(2026,10,10,9);
 const snap=SIM.run(s,uid,{scene:'suspendue'},now);
 assert.ok(snap);
 const st=journey.get(s,uid);
 assert.ok(st.suspended,'la suspension est gardée dans le parcours');
 assert.match(st.messages.at(-1).text,/internet est suspendu/);
 assert.equal(LG.state(s,uid,now).status,'suspendue');
});
