'use strict';
// Redémarrage de la box à distance depuis l'accueil client : accord explicite, limite rebootGate, refus pendant une panne de zone.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createGuardianServer}=require('./pilot-server.cjs');

async function client(){
 const server=createGuardianServer({db:':memory:'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'reboot@example.test',password:'reboot-password-123',name:'Test Redémarrage'})});
 const {user}=await res.json(),cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const request=async(path,body)=>{const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 let state=(await request('/journey/start',{})).data.state;
 const action=async data=>{const r=await request('/journey/action',{version:state.version,...data});if(r.status===200)state=r.data.state;return r;};
 return {server,request,action,get state(){return state;}};
}

test('Connexion lente : Guardian propose le redémarrage, qui rétablit le débit après une courte coupure',async()=>{
 const c=await client();
 try{
  await c.action({type:'scenario',value:'slow'});assert.equal(c.state.metrics.capacity,12);
  await c.action({type:'chat',text:'Ma connexion est lente'});assert.equal(c.state.messages.at(-1).action,'reboot');assert.match(c.state.messages.at(-1).text,/redémarrer/);
  assert.equal((await c.action({type:'reboot'})).status,400,'un redémarrage sans accord explicite est refusé');
  const r=await c.action({type:'reboot',confirm:true});assert.equal(r.status,200);
  assert.equal(c.state.metrics.state,'redémarrage');assert.equal(c.state.metrics.capacity,0);assert.ok(c.state.metrics.rebootUntil>Date.now());
  assert.equal(c.state.scenario,'normal');assert.ok(c.state.notifications.some(n=>n.title==='Redémarrage de votre box'));
  assert.equal((await c.action({type:'reboot',confirm:true})).status,409,'pas de second redémarrage pendant le premier');
 }finally{c.server.close();}
});

test('Limite rebootGate : 2 redémarrages en 10 minutes au maximum',async()=>{
 const c=await client();
 try{
  const realNow=Date.now;let offset=0;Date.now=()=>realNow()+offset;
  try{
   assert.equal((await c.action({type:'reboot',confirm:true})).status,200);offset+=30000;
   assert.equal((await c.action({type:'reboot',confirm:true})).status,200);offset+=30000;
   const third=await c.action({type:'reboot',confirm:true});assert.equal(third.status,429);assert.match(third.data.error,/2 redémarrages en 10 minutes/);
   offset+=600000;assert.equal((await c.action({type:'reboot',confirm:true})).status,200);
  }finally{Date.now=realNow;}
 }finally{c.server.close();}
});
