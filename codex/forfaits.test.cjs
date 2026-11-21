'use strict';
// Changer de forfait depuis le compte : grille publique, complément payé avec Moov Money, forfait moins cher au mois suivant.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createGuardianServer}=require('./pilot-server.cjs');
const J=require('./journey-store.cjs');
// Montant attendu, calculé ici à la main : différence × jours restants (aujourd'hui compris) ÷ jours du mois, à l'heure d'Abidjan (UTC).
function attendu(diff,at=new Date()){const d=new Date(at),mois=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();return Math.round(diff*(mois-d.getUTCDate()+1)/mois);}

async function client(){
 const server=createGuardianServer({db:':memory:'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'forfait@example.test',password:'forfait-password-123',name:'Test Forfait'})});
 const {user}=await res.json(),cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const request=async(path,body)=>{const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 let state=(await request('/journey/start',{})).data.state;
 const action=async data=>{const r=await request('/journey/action',{version:state.version,...data});if(r.status===200)state=r.data.state;return r;};
 return {server,request,action,user,get state(){return state;}};
}

test('La grille suit les prix publics de la fibre Moov, du moins cher au plus cher',()=>{
 assert.deepEqual(J.PLANS.map(p=>[p.mbps,p.price]),[[50,15000],[100,20000],[200,25000],[300,30000],[500,60000]]);
 assert.equal(J.seed().plan.price,20000,'100 Mb/s à 20 000 F, comme dans le dossier du jury');
});

test('Forfait plus rapide : le serveur calcule le complément et ne change rien sans paiement confirmé',async()=>{
 const c=await client();
 try{
  assert.equal(c.state.plans.length,5);
  assert.equal((await c.action({type:'plan-quote',to:'demo-inconnu'})).status,400);
  assert.equal((await c.action({type:'plan-quote',to:'demo-50'})).status,409,'un forfait moins cher ne se paie pas');
  await c.action({type:'plan-quote',to:'demo-300'});
  const q=c.state.upgrade;assert.equal(q.diff,10000);assert.equal(q.amount,attendu(10000,q.at));assert.equal(q.to.mbps,300);
  assert.equal(q.nextBilling,J.nextMonth(q.at));assert.equal(c.state.upgradeCosts['demo-300'].diff,10000);assert.equal(q.source,'compte');assert.equal(c.state.plan.mbps,100);
  assert.equal((await c.action({type:'upgrade-pay',id:q.id})).status,400,'paiement sans accord refusé');
  await c.action({type:'upgrade-pay',id:q.id,confirm:true});
  assert.equal(c.state.plan.mbps,300);assert.equal(c.state.capacity,300);assert.equal(c.state.payment.amount,attendu(10000,q.at));
  assert.equal(J.monthPrice(c.state,Date.now()),20000,'ce mois-ci, la facture garde l’ancien prix');assert.equal(J.monthPrice(c.state,q.nextBilling),30000,'nouveau prix dès le 1er');assert.equal(c.state.upgrade,null);
  const n=c.state.notifications.find(n=>n.title==='Nouveau forfait actif');assert.ok(n);
  assert.ok(n.body.includes(q.amount.toLocaleString('fr-FR')+' FCFA reçu'),'la notification dit le montant payé');assert.match(n.body,/À partir du 1er .+, votre forfait coûte 30.000 FCFA par mois/);
  await c.action({type:'upgrade-pay',id:q.id,confirm:true});
  assert.equal(c.state.audit.filter(a=>a.action==='upgrade.activated').length,1,'paiement idempotent');
 }finally{c.server.close();}
});

test('Refermer le paiement retire l’offre sans bloquer les propositions de Guardian',async()=>{
 const c=await client();
 try{
  await c.action({type:'plan-quote',to:'demo-200'});assert.ok(c.state.upgrade);
  await c.action({type:'plan-cancel'});assert.equal(c.state.upgrade,null);assert.ok(!c.state.declinedUntil);
 }finally{c.server.close();}
});

test('Pas d’achat pendant une connexion anormalement lente',async()=>{
 const c=await client();
 try{
  await c.action({type:'scenario',value:'slow'});
  assert.equal((await c.action({type:'plan-quote',to:'demo-200'})).status,409);assert.equal(c.state.upgrade,null);
 }finally{c.server.close();}
});

test('Forfait moins cher : sans paiement, au 1er du mois suivant, annulable',async()=>{
 const c=await client();
 try{
  assert.equal((await c.action({type:'plan-change',to:'demo-50'})).status,400,'accord explicite requis');
  assert.equal((await c.action({type:'plan-change',to:'demo-300',confirm:true})).status,409,'un forfait plus rapide passe par le paiement');
  await c.action({type:'plan-change',to:'demo-50',confirm:true});
  assert.equal(c.state.plan.mbps,100,'le forfait actuel reste jusqu’à la fin du mois');assert.equal(c.state.nextPlan.plan.mbps,50);
  const d=new Date(c.state.nextPlan.at);assert.equal(d.getUTCDate(),1);assert.ok(c.state.nextPlan.at>Date.now());
  assert.ok(c.state.notifications.some(n=>n.title==='Changement de forfait enregistré'));
  await c.action({type:'plan-change',to:'demo-100',confirm:true});assert.equal(c.state.nextPlan,null,'garder son forfait annule le changement');
  assert.equal((await c.action({type:'plan-change',to:'demo-100',confirm:true})).status,409);
 }finally{c.server.close();}
});

test('Le forfait choisi devient actif quand son mois commence',()=>{
 const now=Date.UTC(2026,9,22,12),st=J.seed();
 st.nextPlan={plan:J.PLANS[0],at:J.nextMonth(now),chosen:now};
 J.applyNextPlan(st,now);assert.equal(st.plan.mbps,100);
 J.applyNextPlan(st,J.nextMonth(now));assert.equal(st.plan.mbps,50);assert.equal(st.capacity,50);assert.equal(st.nextPlan,null);
 assert.equal(new Date(J.nextMonth(Date.UTC(2026,11,15))).getUTCMonth(),0,'décembre passe à janvier');
});

test('Complément au prorata des jours restants du mois, aujourd’hui compris',()=>{
 const p=J.prorata(10000,Date.UTC(2026,10,21,10));
 assert.deepEqual([p.diff,p.daysLeft,p.daysInMonth,p.amount],[10000,10,30,3333],'25 000 → 35 000 F le 21 novembre : 10 000 × 10 ÷ 30');
 assert.equal(p.nextBilling,Date.UTC(2026,11,1),'prix complet dès le 1er décembre à minuit');
 const first=J.prorata(10000,Date.UTC(2026,10,1,0,0,1));assert.equal(first.daysLeft,30);assert.equal(first.amount,10000,'le 1er du mois : différence entière');
 const last=J.prorata(10000,Date.UTC(2026,10,30,23,59));assert.equal(last.daysLeft,1);assert.equal(last.amount,333,'dernier jour : 1 jour sur 30');
 const leap=J.prorata(10000,Date.UTC(2028,1,15,12));assert.deepEqual([leap.daysLeft,leap.daysInMonth,leap.amount],[15,29,5172],'février bissextile : 29 jours');
 assert.equal(J.prorata(10000,Date.UTC(2028,1,29,12)).amount,345,'29 février : 1 jour sur 29');
 assert.equal(J.prorata(10000,Date.UTC(2027,1,28,12)).daysInMonth,28,'février ordinaire : 28 jours');
 assert.equal(J.prorata(5000,Date.UTC(2026,11,31,12)).nextBilling,Date.UTC(2027,0,1),'31 décembre : 1 jour, puis janvier');
 // Les jours se comptent à l'heure d'Abidjan (UTC) : 23 h 30 le 30 novembre reste le dernier jour, quel que soit le fuseau du serveur.
 assert.equal(J.prorata(10000,Date.UTC(2026,10,30,23,30)).daysLeft,1);
});

test('Un devis expire au plus tard à minuit le dernier jour du mois',()=>{
 const from=J.PLANS[1],to=J.PLANS[3];
 assert.equal(J.upgradeQuote(from,to,Date.UTC(2026,10,30,23,58)).expires,Date.UTC(2026,11,1),'pas au-delà du 1er décembre à minuit');
 assert.equal(J.upgradeQuote(from,to,Date.UTC(2026,10,21,10)).expires,Date.UTC(2026,10,21,10)+300000,'sinon 5 minutes');
});

test('Un devis du mois passé est refusé, un montant modifié aussi',async()=>{
 const c=await client(),s=c.server.guardianStore;
 try{
  await c.action({type:'plan-quote',to:'demo-300'});let raw=J.get(s,c.user.id);raw.upgrade.amount+=1;J.put(s,c.user.id,raw);
  assert.equal((await c.action({type:'upgrade-pay',id:raw.upgrade.id,confirm:true})).status,409,'montant qui ne suit pas la règle refusé');
  // Devis du dernier jour du mois précédent (1 jour), payé après minuit : le mois a changé, il faut un nouveau devis.
  raw=J.get(s,c.user.id);const prev=new Date();Object.assign(raw.upgrade,J.prorata(10000,Date.UTC(prev.getUTCFullYear(),prev.getUTCMonth(),0,23,59)));J.put(s,c.user.id,raw);
  const r=await c.action({type:'upgrade-pay',id:raw.upgrade.id,confirm:true});
  assert.equal(r.status,409);assert.match(r.data.error||JSON.stringify(r.data),/Le mois a changé/);assert.equal(c.state.plan.mbps,100);assert.ok(!c.state.payment);
 }finally{c.server.close();}
});

test('Passage à un forfait plus cher le 21 novembre : la facture de novembre garde l’ancien prix, pas de double paiement',async()=>{
 const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),noc=require('./noc-store.cjs'),FL=require('./fidelite.cjs'),AC=require('./acces.cjs');
 const s=new Store(':memory:');operator.migrate(s);J.migrate(s);noc.migrate(s);FL.migrate(s);AC.migrate(s);
 const uid=(await s.register({email:'facture@example.test',name:'Facture',password:'facture-password-1'})).user.id;
 // État laissé par upgrade-pay : 3 333 F payés le 21 novembre pour passer de 20 000 à 30 000 F.
 const at=Date.UTC(2026,10,21,10),q=J.prorata(10000,at),st=J.seed();
 st.plan={...J.PLANS[3]};st.payment={quoteId:'q',amount:q.amount,at,fromPrice:20000,nextBilling:q.nextBilling,mode:'simulation'};J.put(s,uid,st);
 assert.equal(FL.state(s,uid,at).bill.amount,20000,'novembre : 20 000 F (la différence est déjà payée)');
 assert.equal(AC.state(s,uid,at).splitAmount,20000,'payer novembre en plusieurs fois : même montant');
 assert.equal(FL.state(s,uid,Date.UTC(2026,11,3,10)).bill.amount,30000,'décembre : nouveau prix complet');
 assert.equal(AC.state(s,uid,Date.UTC(2026,11,3,10)).splitAmount,30000);
});
