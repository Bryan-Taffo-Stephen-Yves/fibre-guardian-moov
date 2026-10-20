'use strict';
// Un client par poteau : chacun ne reçoit que les alertes de son quartier (toute la commune si son équipement central tombe).
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),{createGuardianServer}=require('./pilot-server.cjs');
const {seedDemo,DEMO,NEIGHBOURS}=require('./seed-demo.cjs'),N=require('./noc-store.cjs');
require('./abidjan-map.js');const F=require('./sim-flow.js'),G=require('./abidjan-map.js');

async function seeded(){
 const store=new Store(':memory:'),server=createGuardianServer({store});
 const saved=process.env[DEMO.admin.env];process.env[DEMO.admin.env]='direction-test-2026';
 try{await seedDemo(store);}finally{if(saved===undefined)delete process.env[DEMO.admin.env];else process.env[DEMO.admin.env]=saved;}
 const uid=email=>store.get('SELECT id FROM users WHERE email=?',email).id,chef=uid(DEMO.admin.email);
 const who=Object.fromEntries([['awa',DEMO.client.email],...NEIGHBOURS.map(n=>[n.segment,n.email])].map(([k,e])=>[k,uid(e)]));
 const unread=u=>N.notifications(store,u).unreadCount,sim=(segment,scenario)=>N.operate(store,chef,{type:'simulate',segment,scenario});
 return {store,server,chef,who,unread,sim,close:()=>server.close()};
}

test('La démo a un client par poteau du simulateur, Grand-Bassam compris, avec le mot de passe d’Awa',async()=>{
 const t=await seeded();
 try{
  const poles=Object.keys(G.SEGMENTS);assert.equal(poles.length,12);
  for(const segment of poles){const m=t.store.all('SELECT user_id FROM noc_members WHERE segment_id=?',segment);assert.ok(m.length>=1,'un client à '+segment);}
  assert.equal(N.client(t.store,t.who['BAS-01']).zone,'Grand-Bassam · Quartier France');
  assert.equal(N.client(t.store,t.who['PLA-01']).zone,'Plateau','pas de « Plateau · Plateau »');
  assert.equal(N.client(t.store,t.who.awa).zones.length,12,'les douze quartiers au choix');
  const r=await t.store.login('rose.ehui@demo.fibre-guardian.ci',DEMO.client.fallback);assert.equal(r.name,'Rose Ehui');
  const seg=N.overview(t.store,t.chef).segments.find(g=>g.id==='BAS-01');assert.equal(seg.clients,1);assert.deepEqual(seg.people,['Rose Ehui']);
 }finally{t.close();}
});

test('Panne à Grand-Bassam : seule la cliente de Grand-Bassam est prévenue, et seule elle apprend que c’est rétabli',async()=>{
 const t=await seeded();
 try{
  const before=Object.fromEntries(Object.entries(t.who).map(([k,u])=>[k,t.unread(u)]));
  t.sim('BAS-01','fiber');
  assert.ok(t.unread(t.who['BAS-01'])>before['BAS-01'],'Rose est prévenue');
  for(const [k,u] of Object.entries(t.who))if(k!=='BAS-01')assert.equal(t.unread(u),before[k],k+' ne reçoit rien');
  const alert=N.client(t.store,t.who['BAS-01']).incidents.find(i=>!i.terminal);assert.equal(alert.zone,'Grand-Bassam · Quartier France');
  const mid=t.unread(t.who['BAS-01']);t.sim('BAS-01','normal');
  assert.ok(t.unread(t.who['BAS-01'])>mid,'Rose apprend que c’est revenu');
  for(const [k,u] of Object.entries(t.who))if(k!=='BAS-01')assert.equal(t.unread(u),before[k],k+' ne reçoit toujours rien');
 }finally{t.close();}
});

test('Équipement central de Cocody : les trois quartiers de Cocody sont prévenus, pas les autres communes',async()=>{
 const t=await seeded();
 try{
  const before=Object.fromEntries(Object.entries(t.who).map(([k,u])=>[k,t.unread(u)]));
  t.sim('COC-03','normal');t.sim('COC-03','olt');
  for(const k of ['PAL-02','RIV-04']){const c=N.client(t.store,t.who[k]),open=c.incidents.find(i=>!i.terminal);assert.ok(open,k+' voit la panne de sa commune');assert.equal(open.zone,'Cocody · toute la commune');assert.ok(t.unread(t.who[k])>before[k],k+' est prévenu');}
  for(const k of ['awa','BAS-01','MAR-02','PLA-01'])assert.equal(t.unread(t.who[k]),before[k],k+' ne reçoit rien');
  const o=N.overview(t.store,t.chef),seg=o.segments.find(g=>g.id==='COC-03'),r=F.reach(o.incidents.find(i=>i.segment_id==='COC-03'&&!i.terminal),seg,o.segments);
  assert.equal(r.wide,true);assert.equal(r.count,3);assert.match(r.who,/Aya Kouadio, Serge Gnagne et 1 autre client/);
  assert.equal(F.reach(null,o.segments.find(g=>g.id==='BAS-01'),o.segments).who,'Rose Ehui');
 }finally{t.close();}
});

test('Le signalement d’un client part dans son propre quartier',async()=>{
 const t=await seeded();
 try{
  N.importReport(t.store,t.who['BAS-01'],{id:'rapport-bassam',zone:'Grand-Bassam',description:'Câble au sol devant la maison.',created:Date.now()},{mode:'demo'});
  assert.equal(t.store.get("SELECT segment_id FROM noc_incidents WHERE id='rapport-bassam'").segment_id,'BAS-01');
  assert.ok(!N.client(t.store,t.who.awa).incidents.some(i=>i.id==='rapport-bassam'),'Awa ne voit pas le dossier de Grand-Bassam');
 }finally{t.close();}
});
