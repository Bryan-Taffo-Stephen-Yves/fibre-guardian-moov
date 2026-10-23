'use strict';
// Recommandation de Codex (2026-10-23) : Guardian affirmait « le Wi-Fi passe mal à travers les murs » sans mesurer le Wi-Fi.
// Maintenant sa réponse sépare ce qu'il a mesuré, ce qu'il suppose, le test à faire et ce que chaque résultat voudra dire.
const {test,afterEach}=require('node:test'),assert=require('node:assert/strict');
const {createGuardianServer}=require('./pilot-server.cjs'),ai=require('./guardian-ai.cjs');
const KEY='sk-ant-test-0000000000000000000000';
afterEach(()=>{ai.setTransport(null);delete process.env.ANTHROPIC_API_KEY;});

async function client(){
 const server=createGuardianServer({db:':memory:',onError:()=>{}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'preuves@example.test',password:'preuves-password-1234',name:'Awa Test'})});
 const {user}=await res.json(),cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const request=async(p,body)=>{const r=await fetch(base+'/api'+p,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 let state=(await request('/journey/start',{})).data.state;
 const action=async data=>{const r=await request('/journey/action',{version:state.version,...data});if(r.status===200)state=r.data.state;return r;};
 const ask=async text=>{const r=await action({type:'chat',text});assert.equal(r.status,200,text);return state.messages.at(-1);};
 return {server,ask,action,get state(){return state;}};
}
const label=(proof,l)=>proof.measured.find(m=>m.label===l)?.value;

test('Wi-Fi : Guardian ne conclut pas sans mesure, il dit ce qu’il mesure et le test qui tranche',async()=>{
 const c=await client();
 try{
  const a=await c.ask('Mon wifi ne marche pas dans la chambre');
  assert.match(a.text,/je ne peux pas encore conclure/);
  assert.doesNotMatch(a.text,/Le souci vient du Wi-Fi/,'plus d’affirmation sans preuve');
  assert.equal(label(a.proof,'Débit qui arrive à votre box'),'100 Mbps (forfait 100 Mbps)');
  assert.equal(label(a.proof,'Temps de réponse de la ligne'),'18 ms');
  assert.match(label(a.proof,'Lumière de la fibre à la box'),/dBm \(normale\)/);
  assert.match(label(a.proof,'Signal Wi-Fi dans vos pièces'),/Non mesuré/,'ce qui n’est pas mesuré est dit');
  assert.ok(a.proof.assumed.some(v=>/Wi-Fi/.test(v)),'le Wi-Fi est une supposition');
  assert.ok(a.proof.tests.some(v=>/près de la box/.test(v))&&a.proof.tests.some(v=>/autre téléphone/.test(v))&&a.proof.tests.some(v=>/câble/.test(v)));
  assert.equal(a.proof.confirms.length,3,'chaque résultat du test a sa conclusion');
 }finally{c.server.close();}
});

test('Connexion lente : mesures d’abord, cause supposée ensuite, et le test qui tranche',async()=>{
 const c=await client();
 try{
  const calm=await c.ask('Ma connexion est lente');
  assert.match(calm.text,/100 Mbps arrivent à votre box et le temps de réponse est de 18 ms/);
  assert.match(calm.text,/je ne peux pas encore conclure/);
  assert.equal(calm.action,'usage');
  // Maison saturée : la supposition change (partage du débit), le test aussi (pause du gros usage).
  await c.action({type:'scenario',value:'download'});
  const busy=await c.ask('Internet rame');
  assert.match(busy.text,/je ne peux pas encore le prouver/);
  assert.ok(busy.proof.tests.some(v=>/pause/.test(v)));
  assert.notDeepEqual(busy.proof.assumed,calm.proof.assumed,'deux situations, deux hypothèses');
 }finally{c.server.close();}
});

test('Débit anormalement bas : le redémarrage est le test, et le résultat dit quoi faire ensuite',async()=>{
 const c=await client();
 try{
  await c.action({type:'scenario',value:'slow'});
  const a=await c.ask('C’est lent');
  assert.equal(a.action,'reboot');
  assert.equal(label(a.proof,'Débit qui arrive à votre box'),'12 Mbps (forfait 100 Mbps)');
  assert.ok(a.proof.confirms.some(v=>/transmets la panne à Moov/.test(v)));
 }finally{c.server.close();}
});

test('Avec Claude : une reformulation qui efface la prudence est refusée',async()=>{
 process.env.ANTHROPIC_API_KEY=KEY;
 ai.setTransport(async(url,init)=>{const b=JSON.parse(init.body);const text=b.output_config?.format?JSON.stringify({lang:'fr',french:'Mon wifi ne marche pas dans la chambre'}):'Le Wi-Fi passe mal à travers les murs de votre chambre. Rapprochez la box.';return {ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text}]})};});
 const c=await client();
 try{
  const a=await c.ask('Mon wifi ne marche pas dans la chambre');
  assert.match(a.text,/je ne peux pas encore conclure/,'la réponse prudente du moteur est gardée');
  assert.ok(a.proof,'les preuves restent affichées');
 }finally{c.server.close();}
});
