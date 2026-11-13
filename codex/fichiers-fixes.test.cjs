'use strict';
// Fichiers fixes (pages, scripts, styles) : copie gardée par le navigateur (ETag + 304) et envoi compressé.
const {test}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),zlib=require('node:zlib'),fs=require('node:fs'),path=require('node:path');
const {createGuardianServer}=require('./pilot-server.cjs');

function get(port,p,headers={}){
 return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,method:'GET',path:p,headers},res=>{const parts=[];res.on('data',c=>parts.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts)}));});req.on('error',reject);req.end();});
}
async function start(){const server=createGuardianServer({db:':memory:'});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,port:server.address().port};}

test('Un script est envoyé compressé, identique au fichier une fois décompressé',async()=>{
 const {server,port}=await start();
 try{
  const r=await get(port,'/codex/app.js',{'Accept-Encoding':'gzip, deflate, br'});
  assert.equal(r.status,200);
  assert.equal(r.headers['content-encoding'],'gzip');
  assert.equal(r.headers['vary'],'Accept-Encoding');
  const original=fs.readFileSync(path.join(__dirname,'app.js'));
  assert.ok(r.body.length<original.length/2,'la version compressée doit être bien plus légère');
  assert.deepEqual(zlib.gunzipSync(r.body),original);
 }finally{server.close();}
});

test('Sans gzip accepté, le fichier part tel quel',async()=>{
 const {server,port}=await start();
 try{
  const r=await get(port,'/codex/app.js');
  assert.equal(r.status,200);
  assert.equal(r.headers['content-encoding'],undefined);
  assert.deepEqual(r.body,fs.readFileSync(path.join(__dirname,'app.js')));
 }finally{server.close();}
});

test('Le navigateur revalide sa copie : 304 vide si rien n’a changé, jamais de vieille version',async()=>{
 const {server,port}=await start();
 try{
  const first=await get(port,'/codex/index.html');
  assert.equal(first.status,200);
  assert.equal(first.headers['cache-control'],'no-cache');
  assert.match(first.headers['etag'],/^"[A-Za-z0-9_-]{22}"$/);
  const again=await get(port,'/codex/index.html',{'If-None-Match':first.headers['etag']});
  assert.equal(again.status,304);
  assert.equal(again.body.length,0);
  const other=await get(port,'/codex/index.html',{'If-None-Match':'"ancienne-version"'});
  assert.equal(other.status,200);
  assert.ok(other.body.length>0);
 }finally{server.close();}
});

test('Les réponses de l’API restent sans copie (no-store) et les chemins interdits restent fermés',async()=>{
 const {server,port}=await start();
 try{
  const api=await get(port,'/api/health');
  assert.equal(api.headers['cache-control'],'no-store');
  assert.equal(api.headers['etag'],undefined);
  for(const p of ['/codex/pilot-server.cjs','/codex/.local/pilot.sqlite','/server/server.mjs'])
   assert.equal((await get(port,p)).status,404,p);
  assert.equal((await get(port,'/codex/')).status,200);
 }finally{server.close();}
});
