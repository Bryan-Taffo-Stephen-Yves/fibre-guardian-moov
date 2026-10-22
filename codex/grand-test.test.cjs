'use strict';
// Défauts trouvés pendant le grand test avant le jury (22 octobre 2026).
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createGuardianServer}=require('./pilot-server.cjs');

async function local(){const server=createGuardianServer({db:':memory:',onError:()=>{}});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,base:'http://127.0.0.1:'+server.address().port};}
const otp=(base,phone)=>fetch(base+'/api/journey/otp/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'demo',phone,name:'Kouassi'})}).then(async r=>({status:r.status,data:await r.json()}));

test('Inscription : le numéro tapé comme sur la carte SIM est accepté',async()=>{
 const {server,base}=await local();
 try{
  for(const phone of ['07 07 07 07 01','0707070702','225 07 07 07 07 03','00225 0707070704','+225 07 07 07 07 05'])assert.equal((await otp(base,phone)).status,200,phone);
  const bad=await otp(base,'0707');assert.equal(bad.status,400);assert.match(bad.data.error,/07 00 00 00 01/,'l’exemple montre le format local');
 }finally{server.close();}
});

test('Inscription : deux écritures du même numéro partagent la limite de 3 codes',async()=>{
 const {server,base}=await local();
 try{
  // Les deux écritures d'un même numéro partagent la limite de 3 codes par 10 minutes.
  for(const phone of ['0707070709','+2250707070709','07 07 07 07 09'])assert.equal((await otp(base,phone)).status,200);
  assert.equal((await otp(base,'225 0707070709')).status,429);
 }finally{server.close();}
});
