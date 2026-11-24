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

test('Facture du mois passé non payée 5 jours après l’échéance : ligne suspendue, puis rétablie dès le paiement Moov Money',async()=>{
 const {s,uid}=await setup(),now=Date.UTC(2026,10,10,9),prev='2026-10';
 FL.state(s,uid,now);
 s.run('INSERT INTO fidelite_factures(user_id,month,amount,due) VALUES(?,?,?,?)',uid,prev,25000,LG.dueOf(prev));
 assert.equal(LG.state(s,uid,Date.UTC(2026,10,3,9)).status,'active','pas de suspension pendant les 5 jours de grâce');
 let l=LG.state(s,uid,now);
 assert.equal(l.status,'suspendue');assert.equal(l.month,prev);assert.equal(l.amount,25000);assert.equal(l.kind,'facture');assert.equal(l.payable,true);
 let st=journey.get(s,uid);assert.ok(st.suspended);assert.match(st.notifications[0].title,/Internet suspendu/);
 // Guardian donne la vraie raison et propose de payer.
 journey.act(s,uid,{type:'chat',version:st.version,text:'Je n’ai plus internet'});
 const said=journey.get(s,uid).messages.at(-1);
 assert.match(said.text,/suspendu car la facture d’octobre|suspendu car la facture de octobre/);assert.equal(said.action,'payer');
 // « J'ai payé » sans paiement : on dit ce qui manque, la ligne reste suspendue.
 const miss=LG.paid(s,uid,now);assert.equal(miss.lifted,false);assert.match(miss.text,/ne trouvons pas encore/);
 assert.equal(LG.state(s,uid,now+500).status,'suspendue','une suspension ne se lève que sur un paiement');
 // Paiement Moov Money depuis « Mon compte » : la ligne revient tout de suite et la facture est payée.
 const r=LG.pay(s,uid,now+1000);
 assert.equal(r.status,'active');assert.ok(r.lifted);assert.equal(r.paid,25000);
 assert.ok(s.get('SELECT paid_at FROM fidelite_factures WHERE user_id=? AND month=?',uid,prev).paid_at);
 st=journey.get(s,uid);assert.equal(st.suspended,null);assert.equal(st.notifications[0].title,'Internet rétabli');
 assert.throws(()=>LG.pay(s,uid,now+2000),/ligne est active/,'pas de 2e paiement');
 assert.throws(()=>LG.paid(s,uid,now+2000),/ligne est active/);
});

test('Une part en retard de plus de 5 jours suspend la ligne ; la payer la rallume',async()=>{
 const {s,uid}=await setup(),start=Date.UTC(2026,10,2,9);
 FL.state(s,uid,start);
 AC.act(s,uid,{action:'split',parts:2,confirm:true},start);
 AC.act(s,uid,{action:'split-pay',part:0},start+1000);
 const parts=JSON.parse(s.get('SELECT parts FROM acces_echeances WHERE user_id=?',uid).parts);
 const late=parts[1].due+LG.GRACE+DAY;
 const l=LG.state(s,uid,late);
 assert.equal(l.status,'suspendue');assert.equal(l.kind,'part');assert.equal(l.payable,false);
 assert.throws(()=>LG.pay(s,uid,late),/Offres solidaires/,'une part se paie dans Offres solidaires');
 const st=journey.get(s,uid);
 journey.act(s,uid,{type:'chat',version:st.version,text:'internet coupé'});
 assert.equal(journey.get(s,uid).messages.at(-1).action,'payer-part');
 AC.act(s,uid,{action:'split-pay',part:1},late+1000);
 assert.equal(LG.state(s,uid,late+1000).status,'active');
 // Le mois payé en plusieurs fois compte dans les points de fidélité une fois la dernière part payée.
 const line=FL.state(s,uid,Date.UTC(2026,11,2,9)).history.find(x=>x.month==='2026-11');
 assert.ok(line&&line.paidAt,'le mois étalé est compté comme payé');
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
 // La scène ne touche ni aux factures ni aux points du client.
 assert.equal(s.get('SELECT COUNT(*) n FROM fidelite_factures WHERE user_id=? AND paid_at IS NOT NULL',uid).n,0);
 // Payer depuis « Mon compte » rallume la ligne.
 assert.equal(LG.pay(s,uid,now+1000).status,'active');
});

test('Étalement à cheval sur deux mois : la part en retard reste payable le mois suivant',async()=>{
 const {s,uid}=await setup(),start=Date.UTC(2026,10,25,9);
 FL.state(s,uid,start);
 AC.act(s,uid,{action:'split',parts:3,confirm:true},start);
 AC.act(s,uid,{action:'split-pay',part:0},start+1000);
 AC.act(s,uid,{action:'split-pay',part:1},Date.UTC(2026,11,5,9));
 const late=Date.UTC(2026,11,22,9);
 assert.equal(LG.state(s,uid,late).status,'suspendue');
 assert.equal(AC.state(s,uid,late).split.month,'novembre');
 AC.act(s,uid,{action:'split-pay',part:2},late+1000);
 assert.equal(LG.state(s,uid,late+1000).status,'active');
});

test('Compte de présentation : jamais coupé de lui-même d’un mois sur l’autre, la Régie seule le suspend',async()=>{
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);noc.migrate(s);FL.migrate(s);AC.migrate(s);LG.migrate(s);
 const uid=(await s.register({email:'awa.kone@demo.fibre-guardian.ci',name:'Awa Koné',password:'ligne-password-123'})).user.id;
 journey.put(s,uid,journey.seed());
 const now=Date.UTC(2026,11,10,9);FL.state(s,uid,now);
 s.run('INSERT INTO fidelite_factures(user_id,month,amount,due) VALUES(?,?,?,?)',uid,'2026-11',25000,LG.dueOf('2026-11'));
 assert.equal(LG.state(s,uid,now).status,'active');
 SIM.run(s,uid,{scene:'suspendue'},now);
 assert.equal(LG.state(s,uid,now).status,'suspendue');
});
