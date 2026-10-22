'use strict';
// Changer de forfait depuis le compte : grille publique, complément payé avec Moov Money, forfait moins cher au mois suivant.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createGuardianServer}=require('./pilot-server.cjs');
const J=require('./journey-store.cjs');

async function client(){
 const server=createGuardianServer({db:':memory:'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'forfait@example.test',password:'forfait-password-123',name:'Test Forfait'})});
 const {user}=await res.json(),cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const request=async(path,body)=>{const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 let state=(await request('/journey/start',{})).data.state;
 const action=async data=>{const r=await request('/journey/action',{version:state.version,...data});if(r.status===200)state=r.data.state;return r;};
 return {server,request,action,get state(){return state;}};
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
  const q=c.state.upgrade;assert.equal(q.amount,10000);assert.equal(q.to.mbps,300);assert.equal(q.source,'compte');assert.equal(c.state.plan.mbps,100);
  assert.equal((await c.action({type:'upgrade-pay',id:q.id})).status,400,'paiement sans accord refusé');
  await c.action({type:'upgrade-pay',id:q.id,confirm:true});
  assert.equal(c.state.plan.mbps,300);assert.equal(c.state.capacity,300);assert.equal(c.state.payment.amount,10000);assert.equal(c.state.upgrade,null);
  assert.ok(c.state.notifications.some(n=>n.title==='Nouveau forfait actif'));
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
  const d=new Date(c.state.nextPlan.at);assert.equal(d.getDate(),1);assert.ok(c.state.nextPlan.at>Date.now());
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
 assert.equal(new Date(J.nextMonth(Date.UTC(2026,11,15))).getMonth(),0,'décembre passe à janvier');
});
