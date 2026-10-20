'use strict';
// Déroulé d'une panne dans le simulateur : agents de Guardian, messages envoyés et étapes validées par Moov.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const F=require('./sim-flow.js'),N=require('./noc-store.cjs'),O=require('./operator-store.cjs'),{createGuardianServer}=require('./pilot-server.cjs');

async function setup(){
 const server=createGuardianServer({db:':memory:',onError:()=>{}}),s=server.guardianStore;
 const u=(await s.register({email:'chef@example.test',password:'chef-password-1234',name:'Chef'})).user;O.grant(s,'chef@example.test','admin');
 const view=()=>N.overview(s,u.id),find=(o,seg)=>o.incidents.find(i=>i.segment_id===seg);
 const act=(seg,body)=>{const i=find(view(),seg);return N.operate(s,u.id,{id:i.id,version:i.version,...body});};
 return {server,s,u,view,find,act,sim:(segment,scenario)=>N.operate(s,u.id,{type:'simulate',segment,scenario})};
}

test('Quatre agents travaillent l’un après l’autre, au moins 5 secondes avant que les messages partent',()=>{
 assert.deepEqual(F.AGENTS.map(a=>a.name),['Agent Surveillance','Agent Diagnostic','Agent Plan','Agent Messages']);
 assert.ok(F.THINK>=5000&&F.THINK<=15000,'entre 5 et 15 s');
 const t0=1e12,i={segment_id:'YOP-07',created:t0,plan:{cause:'FIBER_CUT_DISTRIBUTION',dispatch:true,steps:[]},events:[{kind:'detected',at:t0,detail:JSON.stringify({online:10,total:20,alarm:'LOS'})}]},seg={id:'YOP-07',online:10,total:20};
 const at=ms=>F.agents(i,seg,[],t0+ms).map(a=>a.state);
 assert.deepEqual(at(0),['waiting','waiting','waiting','waiting']);
 assert.deepEqual(at(1500),['working','waiting','waiting','waiting']);
 assert.deepEqual(at(4000),['done','working','waiting','waiting']);
 assert.deepEqual(at(F.THINK),['done','done','done','done']);
 assert.match(F.agents(i,seg,[],t0+F.THINK)[0].result,/10 box éteintes sur 20/);
 assert.equal(F.messages(i,seg,[],t0+F.THINK-1).length,0,'rien ne part avant la fin de l’analyse');
});

test('Poteau tombé : équipe, mail, technicien et client prévenus ; puis en route, sur place et réparé',async()=>{
 const t=await setup();
 try{
  t.sim('YOP-07','pole');let o=t.view(),i=t.find(o,'YOP-07'),seg=o.segments.find(g=>g.id==='YOP-07');
  assert.equal(i.scenario,'pole');assert.equal(F.kindOf(i,seg),'pole');
  assert.equal(F.nearest('YOP-07',o.technicians).id,'awa','l’équipe la plus proche de Niangon');
  const later=Date.now()+F.THINK+10;let m=F.messages(i,seg,o.technicians,later);
  assert.ok(m.some(x=>x.to==='team'&&x.channel==='whatsapp'&&/poteau endommagé, 10 clients sans internet/.test(x.body)));
  const mail=m.find(x=>x.channel==='mail');assert.ok(mail&&/Niangon/.test(mail.subject));assert.ok(mail.lines.some(([k,v])=>k==='Matériel'&&/poteau/.test(v)));
  assert.ok(m.some(x=>x.to==='tech'&&/Préparez-vous/.test(x.body)));
  assert.ok(m.some(x=>x.to==='client'&&/Vous n’avez rien à faire/.test(x.body)));
  t.act('YOP-07',{type:'approve',note:'ok'});t.act('YOP-07',{type:'dispatch',technician:'awa',safety:true});t.act('YOP-07',{type:'advance'});
  o=t.view();i=t.find(o,'YOP-07');m=F.messages(i,seg,o.technicians,Date.now()+F.THINK+10);
  assert.ok(m.some(x=>x.to==='client'&&/Awa est en route, arrivée vers \d{2} h \d{2}/.test(x.body)),'heure d’arrivée annoncée');
  t.act('YOP-07',{type:'advance'});t.act('YOP-07',{type:'advance'});t.sim('YOP-07','normal');t.act('YOP-07',{type:'verify'});
  o=t.view();i=t.find(o,'YOP-07');assert.equal(i.status,'resolved');
  m=F.messages(i,seg,o.technicians,Date.now()+F.THINK+10);
  assert.ok(m.some(x=>x.to==='client'&&/C’est réparé/.test(x.body)));
  assert.ok(m.some(x=>x.to==='client'&&x.channel==='app'&&/Comment s’est passée/.test(x.body)));
 }finally{t.server.close();}
});

test('Baisse de débit et coupure CIE : personne ne se déplace, le client sait quoi faire',async()=>{
 const t=await setup();
 try{
  t.sim('COC-03','congestion');t.sim('MAR-02','power');const o=t.view(),later=Date.now()+F.THINK+10;
  for(const [seg,kind,text] of [['COC-03','congestion',/plus lent.*Inutile de redémarrer/],['MAR-02','power',/pas une panne Moov/]]){
   const i=t.find(o,seg),g=o.segments.find(x=>x.id===seg),m=F.messages(i,g,o.technicians,later);
   assert.equal(F.kindOf(i,g),kind);assert.equal(i.plan.dispatch,false);
   assert.ok(m.some(x=>x.to==='client'&&text.test(x.body)));
   assert.equal(m.filter(x=>x.to==='tech').length,0,'aucun technicien prévenu');
  }
  t.act('COC-03',{type:'approve',note:'capacité'});t.sim('COC-03','normal');
  assert.equal(t.find(t.view(),'COC-03').status,'approved','le dossier attend la vérification du responsable');
  t.act('COC-03',{type:'verify'});const i=t.find(t.view(),'COC-03');assert.equal(i.status,'resolved');
  assert.ok(F.messages(i,o.segments.find(x=>x.id==='COC-03'),[],Date.now()+F.THINK+10).some(x=>x.to==='client'&&/débit est revenu/.test(x.body)));
  const a=N.overview(t.s,t.u.id).alerts.find(x=>x.segment==='MAR-02');assert.equal(a.cause,'POWER_OUTAGE','l’alerte Moov connaît la cause');
 }finally{t.server.close();}
});

test('Rétablir avant tout départ clôt le dossier ; une équipe déjà affectée n’est jamais effacée',async()=>{
 const t=await setup();
 try{
  t.sim('ABO-01','fiber');t.sim('ABO-01','normal');
  const i=t.find(t.view(),'ABO-01');assert.equal(i.status,'closed');assert.ok(i.events.some(e=>e.kind==='closed'));
  assert.ok(F.messages(i,{id:'ABO-01',total:20,online:20},[],Date.now()+F.THINK+10).some(x=>x.to==='client'&&/revenu à la normale/.test(x.body)));
  t.sim('YOP-07','fiber');t.act('YOP-07',{type:'approve',note:'ok'});t.act('YOP-07',{type:'dispatch',technician:'koffi',safety:true});t.sim('YOP-07','normal');
  assert.equal(t.find(t.view(),'YOP-07').status,'dispatched','la mission en cours reste ouverte');
 }finally{t.server.close();}
});

test('Les écrans du déroulé sont chargés, en couleurs de marque, et la page « À propos » le dit',()=>{
 const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
 assert.match(read('bootstrap.js'),/'sim-flow\.js', 'sim-flow-view\.js', 'sim3d\.js'/);
 assert.match(read('index.html'),/sim-flow\.css/);
 assert.doesNotMatch(read('sim-flow.css'),/#[0-9a-f]{3,8}\b|rgba?\(/i);
 for(const f of ['sim-flow.js','sim-flow-view.js'])assert.doesNotMatch(read(f),/simulée?s?\b|fictif|moteur à règles|pas de LLM/i);
 assert.match(read('demo.js'),/WhatsApp et mail/);assert.match(read('demo.js'),/Agents de Guardian/);
});
