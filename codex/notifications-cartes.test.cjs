'use strict';
// « Notifications » du client : une seule carte par panne, qui se met à jour, avec les étapes dans l'ordre et en mots simples.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),{createGuardianServer}=require('./pilot-server.cjs');
const {seedDemo,DEMO,NEIGHBOURS}=require('./seed-demo.cjs'),N=require('./noc-store.cjs');

async function seeded(){
 const store=new Store(':memory:'),server=createGuardianServer({store});
 const saved=process.env[DEMO.admin.env];process.env[DEMO.admin.env]='direction-test-2026';
 try{await seedDemo(store);}finally{if(saved===undefined)delete process.env[DEMO.admin.env];else process.env[DEMO.admin.env]=saved;}
 const uid=email=>store.get('SELECT id FROM users WHERE email=?',email).id,chef=uid(DEMO.admin.email),rose=uid(NEIGHBOURS.find(n=>n.segment==='BAS-01').email);
 const op=(d,id)=>{const i=N.overview(store,chef).incidents.find(x=>x.id===id);return N.operate(store,chef,{...d,id,version:i.version});};
 return {store,server,chef,rose,op,close:()=>server.close()};
}

test('Une panne de bout en bout = une seule carte, étapes dans l’ordre, sans doublon ni jargon',async()=>{
 const t=await seeded();
 try{
  N.operate(t.store,t.chef,{type:'simulate',segment:'BAS-01',scenario:'fiber'});
  const id=N.client(t.store,t.rose).incidents.find(i=>!i.terminal&&i.mode==='demo').id;
  let box=N.notifications(t.store,t.rose);
  assert.equal(box.cards.filter(c=>c.id===id).length,1);assert.equal(box.unreadCards,box.cards.filter(c=>!c.read).length);
  t.op({type:'approve',note:'Plan conforme.'},id);t.op({type:'dispatch',technician:'awa',safety:true},id);
  t.op({type:'advance'},id);t.op({type:'advance'},id);t.store.run('UPDATE noc_checklist SET done=1');t.op({type:'advance'},id);
  N.operate(t.store,t.chef,{type:'simulate',segment:'BAS-01',scenario:'normal'});t.op({type:'verify'},id);
  // Le conseiller envoie aussi son message tout prêt « rétabli » : il ne doit pas faire une deuxième ligne.
  N.event(t.store,id,t.chef,'support.template','Le retour à la normale a été vérifié sur les mesures du réseau.',{template:'resolved'});
  box=N.notifications(t.store,t.rose);
  const mine=box.cards.filter(c=>c.id===id);assert.equal(mine.length,1,'une seule carte pour la panne');
  const card=mine[0];assert.ok(box.items.filter(n=>n.incidentId===id).length>card.steps.length,'les messages bruts sont regroupés');
  assert.equal(card.title,'Internet est revenu');assert.match(card.body,/Internet est revenu dans votre quartier/);
  const kinds=card.steps.map(s=>s.kind);assert.equal(new Set(kinds).size,kinds.length,'chaque étape une seule fois');
  assert.deepEqual(kinds,['detected','plan.proposed','plan.approved','dispatched','en_route','on_site','verifying','resolved']);
  for(let k=1;k<card.steps.length;k++)assert.ok(card.steps[k].at>=card.steps[k-1].at,'ordre chronologique');
  const words=card.steps.map(s=>s.text).join(' ');
  assert.doesNotMatch(words,/habilité|segment|Analyse préparée|affectée|simulateur|mesures du/i,'pas de jargon');
  for(let k=1;k<box.cards.length;k++)assert.ok(box.cards[k].at<=box.cards[k-1].at,'les cartes vont de la plus récente à la plus ancienne');
  assert.equal(card.read,false);assert.equal(N.readNotifications(t.store,t.rose,{ids:card.ids}).cards.find(c=>c.id===id).read,true,'« Marquer comme lu » lit toute la carte');
 }finally{t.close();}
});
