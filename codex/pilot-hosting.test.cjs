'use strict';
// Hébergement derrière un proxy HTTPS (Railway…) et réglages par variables d'environnement.
const {test}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {createGuardianServer}=require('./pilot-server.cjs');

function call(port,{method='GET',path:p='/api/health',headers={},body}={}){
 return new Promise((resolve,reject)=>{const data=body?JSON.stringify(body):null;
  const req=http.request({host:'127.0.0.1',port,method,path:p,headers:{...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}),...headers}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{let json=null;try{json=JSON.parse(text);}catch{}resolve({status:res.statusCode,headers:res.headers,json});});});
  req.on('error',reject);if(data)req.write(data);req.end();});
}
async function hosted(){const server=createGuardianServer({db:':memory:',proxy:true,origin:'https://guardian.example'});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,port:server.address().port};}
const HOSTED={Host:'guardian.example','X-Forwarded-Proto':'https'};

test('Mode hébergé : une adresse https est obligatoire',()=>{
 assert.throws(()=>createGuardianServer({db:':memory:',proxy:true}),/GUARDIAN_ORIGIN/);
 assert.throws(()=>createGuardianServer({db:':memory:',proxy:true,origin:'http://guardian.example'}),/https/);
});

test('Mode hébergé : HTTP est redirigé vers HTTPS, et le cookie de session est Secure',async()=>{
 const {server,port}=await hosted();
 try{
  const plain=await call(port,{headers:{Host:'guardian.example','X-Forwarded-Proto':'http'},path:'/codex/'});
  assert.equal(plain.status,308);assert.equal(plain.headers.location,'https://guardian.example/codex/');
  assert.equal((await call(port,{headers:{Host:'autre.example','X-Forwarded-Proto':'https'}})).status,403,'un autre nom de domaine est refusé');
  const health=await call(port,{headers:HOSTED});assert.equal(health.status,200);assert.match(health.headers['strict-transport-security'],/max-age=/);
  const r=await call(port,{method:'POST',path:'/api/auth/register',headers:HOSTED,body:{email:'heberge@example.test',password:'heberge-password-123',name:'Test Hébergé'}});
  assert.equal(r.status,200);assert.match(r.headers['set-cookie'][0],/; Secure/);assert.match(r.headers['set-cookie'][0],/HttpOnly/);
 }finally{server.close();}
});

test('Mode hébergé : la limite de connexions est comptée par visiteur, pas pour tout le proxy',async()=>{
 const {server,port}=await hosted();
 try{
  const login=ip=>call(port,{method:'POST',path:'/api/auth/login',headers:{...HOSTED,'X-Real-IP':ip},body:{email:'personne@example.test',password:'mauvais-mot-de-passe'}});
  for(let i=0;i<15;i++)assert.equal((await login('41.202.10.1')).status,401);
  assert.equal((await login('41.202.10.1')).status,429,'le même visiteur est freiné');
  assert.equal((await login('41.202.10.2')).status,401,'un autre visiteur n’est pas bloqué');
  const otp=()=>call(port,{method:'POST',path:'/api/journey/otp/request',headers:{...HOSTED,'X-Real-IP':'41.202.10.3'},body:{mode:'demo',phone:'+2250700009999',name:'Test'}});
  for(let i=0;i<3;i++)assert.equal((await otp()).status,200);
  assert.equal((await otp()).status,429,'3 codes SMS par numéro et par 10 minutes');
 }finally{server.close();}
});

test('Sans proxy déclaré, un en-tête X-Real-IP inventé ne contourne pas la limite',async()=>{
 const server=createGuardianServer({db:':memory:'});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 try{
  let last;for(let i=0;i<16;i++)last=await call(port,{method:'POST',path:'/api/auth/login',headers:{Host:'127.0.0.1:'+port,'X-Real-IP':'10.0.0.'+i},body:{email:'x@example.test',password:'mauvais-mot-de-passe'}});
  assert.equal(last.status,429);
 }finally{server.close();}
});

test('PORT et GUARDIAN_DATA_DIR : le serveur écoute sur le port donné et installe la démo dans le dossier de données',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guardian-data-')),port=3000+Math.floor(Math.random()*500);
 const child=spawn(process.execPath,[path.join(__dirname,'serveur-local.cjs')],{env:{...process.env,PORT:String(port),GUARDIAN_DATA_DIR:dir,GUARDIAN_DEMO_ADMIN_PASSWORD:'',GUARDIAN_PORT:''},stdio:['ignore','pipe','pipe']});
 let out='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>out+=c);
 try{
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('démarrage trop long : '+out)),60000);child.stdout.on('data',()=>{if(/Ctrl\+C/.test(out)){clearTimeout(t);resolve();}});child.on('exit',c=>{clearTimeout(t);reject(new Error('arrêt '+c+' : '+out));});});
  assert.equal((await call(port,{headers:{Host:'127.0.0.1:'+port}})).status,200);
  assert.ok(fs.existsSync(path.join(dir,'pilot.sqlite')),'la base est dans le dossier de données');
  const creds=fs.readFileSync(path.join(dir,'identifiants-demo.txt'),'utf8');assert.match(creds,/direction@demo\.fibre-guardian\.ci/);
  const generated=creds.match(/direction@demo\.fibre-guardian\.ci \/ (\S+)/)[1];assert.ok(!out.includes(generated),'le mot de passe généré n’apparaît pas dans les journaux');
 }finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});}
});
