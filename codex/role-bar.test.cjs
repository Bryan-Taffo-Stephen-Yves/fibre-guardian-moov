'use strict';
// Barre des rôles de la démo : jamais de rôle sans le passe posé par la direction, et le serveur garde la main.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store}=require('./pilot-store.cjs');
const {createGuardianServer}=require('./pilot-server.cjs');
const {seedDemo,DEMO}=require('./seed-demo.cjs');
const O=require('./operator-store.cjs');

async function fresh(){
 const saved=process.env[DEMO.admin.env];process.env[DEMO.admin.env]='direction-test-2026';
 const store=new Store(':memory:');await seedDemo(store);
 if(saved===undefined)delete process.env[DEMO.admin.env];else process.env[DEMO.admin.env]=saved;
 const server=createGuardianServer({store});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {store,server,base:'http://127.0.0.1:'+server.address().port};
}
const cookies=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]);
function jar(list){const map={};for(const c of list){const [k,v]=c.split('=');if(v)map[k]=v;else delete map[k];}return map;}
const header=map=>Object.entries(map).map(([k,v])=>k+'='+v).join('; ');
async function call(base,route,{body,jarMap={},csrf}={}){
 const r=await fetch(base+'/api'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:header(jarMap),...(csrf?{'X-CSRF-Token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 Object.assign(jarMap,jar(cookies(r)));for(const k of Object.keys(jarMap))if(!jarMap[k])delete jarMap[k];
 return {status:r.status,data:await r.json()};
}
async function login(base,email,password){const j={};const r=await call(base,'/auth/login',{body:{email,password},jarMap:j});assert.equal(r.status,200,'connexion '+email);return {jar:j,csrf:r.data.user.csrf};}

test('Comptes de démo sans rien taper : Client, Conseiller, Technicien, Superviseur ; la Direction garde son mot de passe',async()=>{
 const {server,base}=await fresh();
 try{
  const first=(await call(base,'/demo/roles')).data;
  assert.equal(first.accounts,true);assert.equal(first.active,false,'pas de barre sans session de démo');
  assert.deepEqual(first.roles.filter(r=>r.locked).map(r=>r.key),['direction'],'seule la Direction est verrouillée');
  const expected={client:'subscriber',conseiller:'agent',technicien:'technician',superviseur:'supervisor'};
  for(const [key,role] of Object.entries(expected)){
   const j={};const r=await call(base,'/demo/roles/switch',{body:{role:key},jarMap:j});
   assert.equal(r.status,200,key);assert.equal(r.data.user.role,role);
   assert.equal((await call(base,'/session',{jarMap:j})).data.user.role,role,'le serveur confirme le rôle '+role);
   const bar=(await call(base,'/demo/roles',{jarMap:j})).data;
   assert.equal(bar.active,true,'la barre suit la session de démo');assert.equal(bar.roles.find(x=>x.current).key,key);
  }
  // La Direction : refusée sans mot de passe, même avec un faux passe ou depuis une session de démo.
  const j={};await call(base,'/demo/roles/switch',{body:{role:'superviseur'},jarMap:j});
  const r=await call(base,'/demo/roles/switch',{body:{role:'direction'},jarMap:j});
  assert.equal(r.status,403);assert.equal(r.data.user,undefined);
  assert.equal((await call(base,'/demo/roles/switch',{body:{role:'direction'},jarMap:{guardian_demo:'faux-passe'}})).status,403);
  assert.equal((await call(base,'/session',{jarMap:j})).data.user.role,'supervisor','la superviseure reste superviseure');
  // Le superviseur de démo ne peut ni remettre la démo à zéro ni activer la barre de la direction.
  assert.equal((await call(base,'/demo/reset',{body:{confirm:true},jarMap:j,csrf:(await call(base,'/session',{jarMap:j})).data.user.csrf})).status,403);
  // Quitter (bouton Direction) ferme la session actuelle.
  assert.equal((await call(base,'/demo/roles/leave',{body:{},jarMap:j})).status,200);
  assert.equal((await call(base,'/session',{jarMap:j})).data.user,null);
  // Un juré inscrit avec son numéro ne voit pas la barre.
  const juror={};const otp=await call(base,'/journey/otp/request',{body:{name:'Koné',phone:'0700000077',mode:'demo'},jarMap:juror});
  await call(base,'/journey/otp/verify',{body:{...otp.data,code:otp.data.demoCode},jarMap:juror});
  assert.ok((await call(base,'/session',{jarMap:juror})).data.user);
  assert.equal((await call(base,'/demo/roles',{jarMap:juror})).data.active,false);
 }finally{server.close();}
});

test('GUARDIAN_DEMO_ACCOUNTS=off : plus aucun compte de démo ouvert',async()=>{
 const {server,base}=await fresh();const saved=process.env.GUARDIAN_DEMO_ACCOUNTS;process.env.GUARDIAN_DEMO_ACCOUNTS='off';
 try{
  assert.deepEqual((await call(base,'/demo/roles')).data,{active:false,accounts:false});
  assert.equal((await call(base,'/demo/roles/switch',{body:{role:'client'}})).status,403);
 }finally{if(saved===undefined)delete process.env.GUARDIAN_DEMO_ACCOUNTS;else process.env.GUARDIAN_DEMO_ACCOUNTS=saved;server.close();}
});

test('Seule la direction connectée peut activer la barre sur son appareil',async()=>{
 const {server,base}=await fresh();
 try{
  const awa=await login(base,DEMO.client.email,'awa-demo-2026');
  const r=await call(base,'/demo/roles/open',{body:{},jarMap:awa.jar,csrf:awa.csrf});
  assert.equal(r.status,403);assert.equal(awa.jar.guardian_demo,undefined);
  const tech=await login(base,DEMO.technician.email,'ibrahim-demo-2026');
  assert.equal((await call(base,'/demo/roles/open',{body:{},jarMap:tech.jar,csrf:tech.csrf})).status,403);
  // Sans le jeton de formulaire, même la direction est refusée.
  const dir=await login(base,DEMO.admin.email,'direction-test-2026');
  assert.equal((await call(base,'/demo/roles/open',{body:{},jarMap:dir.jar})).status,403);
 }finally{server.close();}
});

test('Avec le passe de la direction : la Direction aussi en un geste, avec une vraie session vérifiée par le serveur',async()=>{
 const {store,server,base}=await fresh();
 try{
  const dir=await login(base,DEMO.admin.email,'direction-test-2026');
  assert.equal((await call(base,'/demo/roles/open',{body:{},jarMap:dir.jar,csrf:dir.csrf})).status,200);
  assert.ok(dir.jar.guardian_demo,'passe posé sur l’appareil');
  const list=(await call(base,'/demo/roles',{jarMap:dir.jar})).data;
  assert.equal(list.active,true);
  assert.deepEqual(list.roles.map(r=>r.key),['client','conseiller','technicien','superviseur','direction']);
  assert.ok(list.roles.every(r=>r.ready),'tous les comptes de démo sont prêts');
  assert.equal(list.roles.find(r=>r.current).key,'direction');
  const expected={client:'subscriber',conseiller:'agent',technicien:'technician',superviseur:'supervisor',direction:'admin'};
  for(const [key,role] of Object.entries(expected)){
   const before=dir.jar.guardian;
   const r=await call(base,'/demo/roles/switch',{body:{role:key},jarMap:dir.jar});
   assert.equal(r.status,200,key);assert.equal(r.data.user.role,role,key);assert.ok(r.data.page.startsWith('?portal='));
   assert.notEqual(dir.jar.guardian,before,'nouvelle session');
   assert.equal((await call(base,'/session',{jarMap:dir.jar})).data.user.role,role,'le serveur confirme le rôle '+role);
   assert.equal((await call(base,'/session',{jarMap:{guardian:before}})).data.user,null,'l’ancienne session est fermée');
   assert.ok(!('password' in r.data.user)&&!JSON.stringify(r.data).includes('demo-2026'),'aucun mot de passe renvoyé');
  }
  // Le client choisi par la barre reste un client : l'espace Moov lui est refusé.
  const c=await call(base,'/demo/roles/switch',{body:{role:'client'},jarMap:dir.jar});
  assert.equal((await call(base,'/noc/workspace',{jarMap:dir.jar})).status,403);
  assert.equal((await call(base,'/demo/roles/switch',{body:{role:'admin'},jarMap:dir.jar})).status,404,'rôle inconnu');
  // Un compte dont le rôle a changé n'est plus proposé.
  O.grant(store,'fatou.bamba@demo.fibre-guardian.ci','revoke');
  assert.equal((await call(base,'/demo/roles/switch',{body:{role:'superviseur'},jarMap:dir.jar})).status,404);
  assert.equal((await call(base,'/demo/roles',{jarMap:dir.jar})).data.roles.find(r=>r.key==='superviseur').ready,false);
  assert.ok(store.get("SELECT count(*) AS n FROM audit WHERE action='demo.rolebar.switch'").n>=6,'chaque changement est tracé');
  // Retirer la barre : le passe ne vaut plus rien.
  const pass=dir.jar.guardian_demo;
  assert.equal((await call(base,'/demo/roles/close',{body:{},jarMap:dir.jar})).status,200);
  assert.equal((await call(base,'/demo/roles/switch',{body:{role:'direction'},jarMap:{guardian_demo:pass}})).status,403);
  assert.equal((await call(base,'/demo/roles',{jarMap:dir.jar})).data.roles.find(r=>r.key==='direction').locked,true,'Direction de nouveau verrouillée');
  assert.ok(c.data.user);
 }finally{server.close();}
});

test('Le passe expire et survit à « Tout remettre à zéro » ; aucun mot de passe dans le code de la barre',async()=>{
 const R=require('./role-bar.cjs');
 const {store,server}=await fresh();
 try{
  const admin=store.get('SELECT id FROM users WHERE email=?',DEMO.admin.email).id;
  const p=R.open(store,admin,1000);
  assert.equal(R.valid(store,p.secret,1000+R.TTL-1),true);assert.equal(R.valid(store,p.secret,1000+R.TTL),false);
  const q=R.open(store,admin);
  await require('./seed-demo.cjs').resetDemo(store,{});
  assert.equal(R.valid(store,q.secret),true,'la barre reste après la remise à zéro');
  assert.equal(R.list(store,q.secret).roles.every(r=>r.ready),true,'les comptes sont recréés');
 }finally{server.close();}
 for(const f of ['role-bar.js','role-bar.cjs']){const src=fs.readFileSync(path.join(__dirname,f),'utf8');assert.ok(!/demo-2026|password\s*:/.test(src),f+' sans mot de passe');}
});
