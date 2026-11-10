'use strict';
// Fibre+ (thème 10) : contenus inclus dès 300 Mb/s (activés tout seuls, client prévenu, 3 mois offerts),
// pack jeux en ligne payant dès 100 Mb/s et inclus à 500 Mb/s ; chiffres réservés à l'équipe Moov.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs'),noc=require('./noc-store.cjs');
const FP=require('./fibreplus.cjs');
const NOW=Date.UTC(2026,10,10,10),DAY=86400000;

async function setup(){
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);noc.migrate(s);FP.migrate(s);const ids={};
 for(const [n,k] of [['awa',1],['yao',3],['ali',4],['moussa',0],['kader',null]]){
  const u=(await s.register({email:n+'@example.test',name:n,password:'fibreplus-pass-12'})).user;ids[n]=u.id;
  if(k!==null){const st=journey.seed();st.plan={...journey.PLANS[k]};journey.put(s,u.id,st);}
 }
 operator.grant(s,'kader@example.test','agent');return {s,ids};
}

test('À 300 Mb/s, « Films et séries » est inclus tout seul, avec 3 mois offerts et une notification',async()=>{
 const {s,ids}=await setup();
 const low=FP.state(s,ids.awa,NOW);assert.equal(low.included,false);assert.equal(low.content,null);
 assert.throws(()=>FP.act(s,ids.awa,{action:'content',content:'cours'},NOW),{status:409});
 const st=FP.state(s,ids.yao,NOW);
 assert.equal(st.content.id,'films');assert.equal(new Date(st.content.giftUntil).toISOString().slice(0,10),'2027-02-10');
 assert.equal(journey.get(s,ids.yao).notifications[0].title,'Fibre+ : Films et séries inclus');
 FP.state(s,ids.yao,NOW);assert.equal(journey.get(s,ids.yao).notifications.filter(n=>n.title.startsWith('Fibre+')).length,1,'prévenu une seule fois');
});

test('Changer de contenu inclus : une fois par mois',async()=>{
 const {s,ids}=await setup();FP.state(s,ids.yao,NOW);
 assert.throws(()=>FP.act(s,ids.yao,{action:'content',content:'cours'},NOW+DAY),{status:409});
 const st=FP.act(s,ids.yao,{action:'content',content:'cours'},NOW+31*DAY);assert.equal(st.content.id,'cours');
 assert.throws(()=>FP.act(s,ids.yao,{action:'content',content:'jeux'},NOW+70*DAY),{status:400});
});

test('Pack jeux : payant dès 100 Mb/s, inclus à 500 Mb/s, refusé à 50 Mb/s',async()=>{
 const {s,ids}=await setup();
 assert.throws(()=>FP.act(s,ids.moussa,{action:'gaming',on:true,confirm:true},NOW),{status:409});
 assert.throws(()=>FP.act(s,ids.awa,{action:'gaming',on:true},NOW),{status:400},'confirmation obligatoire');
 let st=FP.act(s,ids.awa,{action:'gaming',on:true,confirm:true},NOW);assert.equal(st.gaming.on,true);assert.equal(st.gaming.free,false);
 assert.match(journey.get(s,ids.awa).notifications[0].body,/5.000.F seront ajoutés/);
 assert.equal(FP.state(s,ids.ali,NOW).gaming.free,true);
 assert.throws(()=>FP.act(s,ids.ali,{action:'gaming',on:false,confirm:true},NOW),{status:409});
 const m=FP.summary(s,ids.kader,NOW);
 assert.equal(m.gaming,2);assert.equal(m.gamingPaying,1);assert.equal(m.revenue,5000);
 assert.throws(()=>FP.summary(s,ids.awa,NOW),{status:403});
 st=FP.act(s,ids.awa,{action:'gaming',on:false,confirm:true},NOW);assert.equal(st.gaming.on,false);
});
