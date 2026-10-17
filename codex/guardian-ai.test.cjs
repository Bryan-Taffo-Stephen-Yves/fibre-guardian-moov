'use strict';
// Guardian rédigé par Claude : faux transport (aucun appel réseau), repli silencieux sur le moteur à règles.
const {test,afterEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ai=require('./guardian-ai.cjs'),envFile=require('./env-file.cjs');
const {createGuardianServer}=require('./pilot-server.cjs');
const KEY='sk-ant-test-0000000000000000000000';

afterEach(()=>{ai.setTransport(null);delete process.env.ANTHROPIC_API_KEY;});

async function client(){
 const server=createGuardianServer({db:':memory:',onError:()=>{}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'ia@example.test',password:'ia-password-1234',name:'Awa Test'})});
 const {user}=await res.json(),cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const request=async(p,body)=>{const r=await fetch(base+'/api'+p,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 let state=(await request('/journey/start',{})).data.state;
 const action=async data=>{const r=await request('/journey/action',{version:state.version,...data});if(r.status===200)state=r.data.state;return r;};
 return {server,request,action,get state(){return state;}};
}
const reply=text=>async()=>({ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text}]})});

test('Sans clé : la réponse du moteur à règles est gardée, sans appel ni avertissement',async()=>{
 let calls=0;ai.setTransport(async()=>{calls++;throw new Error('ne doit pas être appelé');});
 const c=await client();
 try{
  await c.action({type:'scenario',value:'slow'});
  await c.action({type:'chat',text:'Ma connexion est lente'});
  assert.equal(calls,0);assert.equal(c.state.messages.at(-1).action,'reboot');assert.match(c.state.messages.at(-1).text,/redémarrer/);
  assert.equal((await c.request('/health')).data.assistant,'regles');
 }finally{c.server.close();}
});

test('Avec clé : la réponse rédigée remplace le texte, les faits et l’action restent ceux du moteur',async()=>{
 process.env.ANTHROPIC_API_KEY=KEY;let sent;
 ai.setTransport(async(url,init)=>{sent={url,init,body:JSON.parse(init.body)};return reply('Bonjour Awa, votre débit est tombé à 12 Mbps alors que votre forfait prévoit 100 Mbps. Vos appareils ne sont pas en cause. Je vous propose de redémarrer votre box à distance.')();});
 const c=await client();
 try{
  await c.action({type:'scenario',value:'slow'});
  await c.action({type:'chat',text:'Internet rame ce soir'});
  const last=c.state.messages.at(-1);
  assert.match(last.text,/^Bonjour Awa, votre débit est tombé à 12 Mbps/);assert.equal(last.action,'reboot');assert.ok(last.facts.length>0);
  assert.equal(sent.url,'https://api.anthropic.com/v1/messages');
  assert.equal(sent.init.headers['x-api-key'],KEY);assert.equal(sent.init.headers['anthropic-beta'],'server-side-fallback-2026-07-01');
  assert.equal(sent.body.model,'claude-opus-5-5');assert.equal(sent.body.fallbacks,'default');assert.deepEqual(sent.body.output_config,{effort:'low'});
  assert.match(sent.body.messages[0].content,/Internet rame ce soir/);assert.match(sent.body.messages[0].content,/Débit disponible : 12 Mbps/);
  assert.ok(!JSON.stringify(c.state).includes(KEY),'la clé ne sort jamais du serveur');
  assert.equal((await c.request('/health')).data.assistant,'claude');
 }finally{c.server.close();}
});

test('Garde-fous : chiffre inventé, refus, erreur ou délai : repli sur le moteur à règles',async()=>{
 process.env.ANTHROPIC_API_KEY=KEY;
 const cases=[
  reply('Votre débit est de 12 Mbps. Je vous offre 5000 FCFA de remise et un redémarrage.'),
  async()=>({ok:true,json:async()=>({stop_reason:'refusal',content:[]})}),
  async()=>({ok:false,status:529,json:async()=>({})}),
  async()=>{const e=new Error('délai');e.name='TimeoutError';throw e;},
  reply('En tant qu’IA, je vous conseille de redémarrer la box.')
 ];
 for(const transport of cases){
  ai.setTransport(transport);const c=await client();
  try{
   await c.action({type:'scenario',value:'slow'});const r=await c.action({type:'chat',text:'Ma connexion est lente'});
   assert.equal(r.status,200);assert.match(c.state.messages.at(-1).text,/^Votre débit est tombé à 12 Mbps/);
  }finally{c.server.close();}
 }
});

test('guard : chiffres, longueur, vouvoiement et vocabulaire',()=>{
 const src=['Débit disponible : 12 Mbps','Forfait : 100 Mbps, 25 000 FCFA par mois'];
 assert.ok(ai.guard('Votre forfait de 25 000 FCFA prévoit 100 Mbps, vous recevez 12 Mbps.',src).ok);
 assert.equal(ai.guard('Vous avez 48 Mbps.',src).ok,false);
 assert.equal(ai.guard('Tu devrais redémarrer ta box maintenant.',src).ok,false);
 assert.equal(ai.guard('Voici :\n- redémarrez la box\n- attendez',src).ok,false);
 assert.equal(ai.guard('Phrase une. Phrase deux. Phrase trois. Phrase quatre. Phrase cinq. Phrase six.',src).ok,false);
 assert.equal(ai.guard('Le mode démo est simulé, redémarrez la box.',src).ok,false);
});

test('Budget : au-delà de 20 réponses rédigées en 10 minutes, retour au moteur à règles',async()=>{
 process.env.ANTHROPIC_API_KEY=KEY;let calls=0;
 ai.setTransport(async()=>{calls++;return reply('Bonjour, votre connexion est stable et vos appareils fonctionnent bien.')();});
 const c=await client();
 try{for(let i=0;i<22;i++)await c.action({type:'chat',text:'Comment va ma connexion ?'});assert.equal(calls,20);}
 finally{c.server.close();}
});

test('Fichier .env local : lu sans écraser une variable déjà définie, BOM et CRLF du Bloc-notes acceptés',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fg-env-'));
 try{
  fs.writeFileSync(path.join(dir,'.env'),'﻿# Ma clé\r\nANTHROPIC_API_KEY="sk-ant-local-123"\r\nGUARDIAN_PORT=9000\r\n');
  const env={GUARDIAN_PORT:'8186'},r=envFile.load(dir,env);
  assert.equal(env.ANTHROPIC_API_KEY,'sk-ant-local-123');assert.equal(env.GUARDIAN_PORT,'8186');assert.deepEqual(r.applied,['ANTHROPIC_API_KEY']);
  fs.renameSync(path.join(dir,'.env'),path.join(dir,'.env.txt'));const env2={};envFile.load(dir,env2);assert.equal(env2.ANTHROPIC_API_KEY,'sk-ant-local-123');
  assert.deepEqual(envFile.load(fs.mkdtempSync(path.join(os.tmpdir(),'fg-vide-')),{}),{file:null,applied:[]});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Le fichier .env est ignoré par git et par l’image Docker',()=>{
 const root=path.resolve(__dirname,'..');
 assert.match(fs.readFileSync(path.join(root,'.gitignore'),'utf8'),/^\.env$/m);
 assert.match(fs.readFileSync(path.join(root,'.dockerignore'),'utf8'),/^\*\*\/\.env$/m);
 assert.ok(!fs.readFileSync(path.join(__dirname,'guardian-ai.cjs'),'utf8').includes('sk-ant-'),'aucune clé dans le code');
});
