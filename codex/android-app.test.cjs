'use strict';
// Application Android (PWABuilder) : lien vérifié entre l'application et le site, et fiche d'installation complète.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createGuardianServer}=require('./pilot-server.cjs');
const FP='AB:'.repeat(31)+'CD';

async function start(options){const server=createGuardianServer({db:':memory:',...options});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,base:'http://127.0.0.1:'+server.address().port};}

test('assetlinks.json : absent sans réglage, publié avec le paquet et l’empreinte',async()=>{
 let s=await start({});
 try{assert.equal((await fetch(s.base+'/.well-known/assetlinks.json')).status,404);}finally{s.server.close();}
 s=await start({android:{package:'ci.fibreguardian.app',fingerprints:[FP.toLowerCase()]}});
 try{
  const r=await fetch(s.base+'/.well-known/assetlinks.json');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/application\/json/);
  const [link]=await r.json();
  assert.deepEqual(link.relation,['delegate_permission/common.handle_all_urls']);
  assert.equal(link.target.package_name,'ci.fibreguardian.app');assert.deepEqual(link.target.sha256_cert_fingerprints,[FP]);
  assert.equal((await fetch(s.base+'/.well-known/autre.json')).status,404,'le reste du dossier caché reste fermé');
 }finally{s.server.close();}
});

test('Réglages Android invalides : le serveur refuse de démarrer',()=>{
 assert.throws(()=>createGuardianServer({db:':memory:',android:{package:'pas un paquet',fingerprints:[FP]}}),/GUARDIAN_ANDROID_PACKAGE/);
 assert.throws(()=>createGuardianServer({db:':memory:',android:{package:'ci.fibreguardian.app',fingerprints:['12:34']}}),/GUARDIAN_ANDROID_SHA256/);
});

test('Manifeste : icônes, captures d’écran présentes et à la bonne taille',()=>{
 const m=JSON.parse(fs.readFileSync(path.join(__dirname,'manifest.webmanifest'),'utf8'));
 assert.equal(m.display,'standalone');assert.ok(m.icons.some(i=>i.sizes==='512x512'&&i.purpose==='maskable'));
 assert.ok(m.screenshots.some(s=>s.form_factor==='narrow')&&m.screenshots.some(s=>s.form_factor==='wide'));
 for(const s of m.screenshots){const png=fs.readFileSync(path.join(__dirname,s.src));const [w,h]=s.sizes.split('x').map(Number);assert.equal(png.readUInt32BE(16),w,s.src);assert.equal(png.readUInt32BE(20),h,s.src);assert.ok(s.label);}
});
