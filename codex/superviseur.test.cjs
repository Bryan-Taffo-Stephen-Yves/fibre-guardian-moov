'use strict';
// Guardian Superviseur : réservé à l'équipe Moov, fidèle au réseau, et il ne déclenche jamais rien seul.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),{createGuardianServer}=require('./pilot-server.cjs');
const {seedDemo,DEMO}=require('./seed-demo.cjs'),N=require('./noc-store.cjs'),S=require('./superviseur.cjs'),AI=require('./guardian-ai.cjs');

async function seeded(){
 const store=new Store(':memory:'),server=createGuardianServer({store});
 const saved=process.env[DEMO.admin.env];process.env[DEMO.admin.env]='direction-test-2026';
 try{await seedDemo(store);}finally{if(saved===undefined)delete process.env[DEMO.admin.env];else process.env[DEMO.admin.env]=saved;}
 const uid=email=>store.get('SELECT id FROM users WHERE email=?',email).id;
 return {store,chef:uid(DEMO.admin.email),awa:uid(DEMO.client.email),sim:(segment,scenario)=>N.operate(store,uid(DEMO.admin.email),{type:'simulate',segment,scenario}),close:()=>server.close()};
}
// La démo pré-remplie contient déjà une panne à Cocody : on part d'un réseau calme.
async function calm(){const t=await seeded();t.sim('COC-03','normal');return t;}

test('Un compte client ne peut ni lire le superviseur, ni lui parler, ni transmettre',async()=>{
 const t=await seeded();
 try{
  assert.throws(()=>S.bilan(t.store,t.awa),e=>e.status===403);
  await assert.rejects(S.ask(t.store,t.awa,{question:'Quel quartier va le plus mal ?'}),e=>e.status===403);
  assert.throws(()=>S.signal(t.store,t.awa,{key:'x'}),e=>e.status===403);
 }finally{t.close();}
});

test('Réseau calme : bulletin rassurant, huit agents surveillés, signal faible repéré avec sa cause',async()=>{
 const t=await calm();
 try{
  const b=S.bilan(t.store,t.chef);
  assert.equal(b.numbers.total,240);assert.equal(b.numbers.online,240);assert.equal(b.numbers.touched,0);
  assert.ok(['ok','watch'].includes(b.headline.tone));assert.match(b.headline.text,/240 box sur 240/);
  assert.equal(b.agents.length,8);assert.ok(b.agents.every(a=>a.name&&a.text&&['ok','warn','bad','info'].includes(a.tone)));
  const weak=b.findings.find(f=>f.key.startsWith('signal:')&&f.level==='attention');
  assert.ok(weak,'la box faible du Labo remonte');assert.match(weak.cause,/Connecteur sale|plié|Fibre/);assert.equal(weak.go.page,'labo');
  assert.ok(!b.findings.some(f=>f.level==='critique'||f.level==='majeure'));
 }finally{t.close();}
});

test('Une coupure remonte en premier, avec la cause, le dossier et le bon écran pour valider',async()=>{
 const t=await calm();
 try{
  t.sim('YOP-07','fiber');N.scan(t.store);
  const b=S.bilan(t.store,t.chef),f=b.findings[0];
  assert.equal(f.key,'panne:YOP-07');assert.equal(f.level,'critique');assert.match(f.title,/12 box sur 20 éteintes/);
  assert.match(f.cause,/Fibre coupée/);assert.equal(f.go.page,'approvals');assert.ok(f.incidentId);
  assert.equal(b.headline.tone,'bad');assert.match(b.headline.text,/Yopougon/);
  assert.equal(b.numbers.pending,1);assert.equal(b.agents.find(a=>a.key==='analyse').tone,'warn');
  assert.ok(b.journal.some(j=>/J’ai ouvert un dossier pour Yopougon/.test(j.text)),'journal de l’agent');
  // Coupure de courant : il conseille de ne pas envoyer de technicien.
  t.sim('MAR-02','power');const m=S.bilan(t.store,t.chef).findings.find(x=>x.key==='panne:MAR-02');
  assert.match(m.cause,/courant/);assert.match(m.advice,/inutile d’envoyer un technicien|Validez/);
  // Panne de la centrale : toute la commune dans un seul problème.
  t.sim('COC-03','olt');const c=S.bilan(t.store,t.chef);
  assert.ok(c.findings.some(x=>x.key==='panne:COC-03'&&/Toute la commune de Cocody/.test(x.title)));
  assert.ok(!c.findings.some(x=>x.key==='panne:PAL-02'),'les quartiers voisins ne sont pas répétés');
 }finally{t.close();}
});

test('Transmettre au responsable : une ligne au journal, aucune action réseau, aucun message aux clients',async()=>{
 const t=await calm();
 try{
  t.sim('YOP-07','fiber');N.scan(t.store);
  const before=t.store.get('SELECT status,version FROM noc_incidents WHERE segment_id=?','YOP-07'),notes=t.store.get('SELECT COUNT(*) AS n FROM noc_notifications').n;
  const b=S.signal(t.store,t.chef,{key:'panne:YOP-07'});
  assert.ok(b.findings.find(f=>f.key==='panne:YOP-07').signaled);
  assert.ok(b.journal.some(j=>j.kind==='superviseur.signal'));
  assert.deepEqual(t.store.get('SELECT status,version FROM noc_incidents WHERE segment_id=?','YOP-07'),before,'le dossier ne bouge pas');
  assert.equal(t.store.get('SELECT COUNT(*) AS n FROM noc_notifications').n,notes,'aucune notification client');
  assert.throws(()=>S.signal(t.store,t.chef,{key:'panne:YOP-07'}),e=>e.status===409);
  assert.throws(()=>S.signal(t.store,t.chef,{key:'panne:inconnue'}),e=>e.status===404);
  // Panne réglée puis nouvelle panne au même endroit : la transmission d'avant ne compte plus.
  t.sim('YOP-07','normal');t.sim('YOP-07','fiber');N.scan(t.store);
  assert.ok(!S.bilan(t.store,t.chef).findings.find(f=>f.key==='panne:YOP-07').signaled);
 }finally{t.close();}
});

test('Questions : réponse par règles sans clé, avec les vrais chiffres',async()=>{
 const t=await calm();
 try{
  t.sim('YOP-07','fiber');N.scan(t.store);
  const worst=await S.ask(t.store,t.chef,{question:'Quel quartier va le plus mal ?'});
  assert.equal(worst.writer,'regles');assert.match(worst.answer,/12 box sur 20/);assert.match(worst.answer,/Mon conseil/);
  const team=await S.ask(t.store,t.chef,{question:'Où sont les techniciens ?'});assert.match(team.answer,/5 techniciens sur 5 sont disponibles/);
  const place=await S.ask(t.store,t.chef,{question:'Et Adjamé ?'});assert.match(place.answer,/Adjamé · Adjamé Liberté va bien : 20 box sur 20/);
  const plateau=await S.ask(t.store,t.chef,{question:'Comment va le Plateau ?'});assert.match(plateau.answer,/box 13/);assert.doesNotMatch(plateau.answer,/probable\)/);
  const resume=await S.ask(t.store,t.chef,{question:'Fais-moi le résumé pour le directeur'});assert.match(resume.answer,/Attention/);
  await assert.rejects(S.ask(t.store,t.chef,{question:''}),e=>e.status===400);
 }finally{t.close();}
});

test('Avec la clé, Claude rédige à partir de l’état ; un chiffre inventé est refusé',async()=>{
 const t=await calm(),key=process.env.ANTHROPIC_API_KEY;
 process.env.ANTHROPIC_API_KEY='sk-test-'+'x'.repeat(30);
 let reply='',seen='';
 AI.setTransport(async(url,init)=>{seen=JSON.parse(init.body).messages[0].content;return {ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:reply}]})};});
 try{
  t.sim('YOP-07','fiber');N.scan(t.store);
  reply='C’est Yopougon · Niangon : 12 box sur 20 sont éteintes, sans doute une fibre coupée. Je vous conseille de valider le plan et d’envoyer une équipe avec un réflectomètre.';
  const ok=await S.ask(t.store,t.chef,{question:'Quel quartier va le plus mal ?'});
  assert.equal(ok.writer,'claude');assert.equal(ok.answer,reply);assert.match(seen,/État du réseau/);assert.match(seen,/Problème 1 \[critique\]/);
  reply='Yopougon a 57 box éteintes depuis 3 jours.';
  const bad=await S.ask(t.store,t.chef,{question:'Quel quartier va le plus mal ?'});
  assert.equal(bad.writer,'regles','chiffre absent de l’état : réponse par règles');
 }finally{AI.setTransport(null);if(key===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=key;t.close();}
});
