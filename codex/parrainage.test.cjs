'use strict';
// Parrainage (thème 5) et bilan du forfait (SmartOffer, ajustement) : règles côté serveur.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createGuardianServer}=require('./pilot-server.cjs');
const PR=require('./parrainage.cjs');

async function server(){const srv=createGuardianServer({db:':memory:'});await new Promise(r=>srv.listen(0,'127.0.0.1',r));return {srv,base:'http://127.0.0.1:'+srv.address().port};}
async function client(base,email,name){
 const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'parrain-password-123',name})});
 const {user}=await res.json(),cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 return async(path,body,method)=>{const r=await fetch(base+'/api'+path,{method:method||(body?'POST':'GET'),headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
}

test('Chaque client a un code stable, et le lien public ne montre que prénom et initiale',async()=>{
 const {srv,base}=await server();
 try{
  const awa=await client(base,'awa@example.test','Awa Koné Diallo');
  const a=(await awa('/parrainage')).data;assert.match(a.code,/^MOOV-[A-Z0-9]{5}$/);assert.equal((await awa('/parrainage')).data.code,a.code);
  const pub=await (await fetch(base+'/api/parrainage/code?code='+a.code.toLowerCase())).json();
  assert.equal(pub.parrain,'Awa K.');assert.equal(pub.code,a.code);assert.ok(!JSON.stringify(pub).includes('example.test'));
  assert.equal((await fetch(base+'/api/parrainage/code?code=MOOV-ZZZZZ')).status,404);
 }finally{srv.close();}
});

test('Le filleul utilise le code une seule fois ; pas son propre code, pas de parrainage croisé',async()=>{
 const {srv,base}=await server();
 try{
  const awa=await client(base,'awa2@example.test','Awa Koné'),yao=await client(base,'yao@example.test','Yao Konan'),eve=await client(base,'eve@example.test','Ève');
  const code=(await awa('/parrainage')).data.code,yaoCode=(await yao('/parrainage')).data.code;
  assert.equal((await awa('/parrainage',{code})).status,409,'son propre code');
  assert.equal((await yao('/parrainage',{code:'n’importe quoi'})).status,400);
  const ok=await yao('/parrainage',{code:code.replace('MOOV-','moov ')});assert.equal(ok.status,200);
  assert.equal(ok.data.parrain.name,'Awa K.');assert.equal(ok.data.canUse,false);assert.equal(ok.data.parrain.rewardAt-ok.data.parrain.at,PR.REWARD_DAYS*86400000);
  assert.equal((await yao('/parrainage',{code:(await eve('/parrainage')).data.code})).status,409,'une seule fois');
  assert.equal((await awa('/parrainage',{code:yaoCode})).status,409,'pas l’un l’autre');
  const mine=(await awa('/parrainage')).data;assert.equal(mine.filleuls.length,1);assert.equal(mine.filleuls[0].name,'Yao K.');assert.equal(mine.pending,1);
 }finally{srv.close();}
});

test('Un ancien client ne peut plus utiliser de code',()=>{
 const rows={users:{u1:{created:0}},codes:[{user_id:'p',code:'ABCDE'}]};
 const s={transaction:f=>f(),get:(q,...a)=>/FROM parrainage_codes WHERE code/.test(q)?rows.codes.find(c=>c.code===a[0]):/FROM users/.test(q)?rows.users[a[0]]:undefined,run(){},all:()=>[]};
 assert.throws(()=>PR.use(s,'u1',{code:'MOOV-ABCDE'},(PR.NEW_CLIENT_DAYS+1)*86400000),/30 jours/);
});

test('Le bilan du forfait conseille de monter, de descendre, ou d’attendre',async()=>{
 const {srv,base}=await server();
 try{
  const c=await client(base,'bilan@example.test','Client Bilan');
  assert.equal((await c('/journey/bilan')).status,409,'parcours non démarré');
  await c('/journey/start',{});
  assert.equal((await c('/journey/bilan')).data.verdict,'tot');
  const up=(await c('/journey/bilan/demo',{profile:'soir'})).data;assert.equal(up.verdict,'monter');assert.equal(up.to.mbps,200);assert.equal(up.extra,5000);assert.ok(up.satDays>=6);
  const down=(await c('/journey/bilan/demo',{profile:'calme'})).data;assert.equal(down.verdict,'baisser');assert.equal(down.to.mbps,50);assert.equal(down.saving,5000);
  assert.equal((await c('/journey/bilan/demo',{profile:'autre'})).status,400);
  assert.equal((await c('/journey/state')).data.state.plan.mbps,100,'le bilan ne change jamais le forfait tout seul');
 }finally{srv.close();}
});

test('Le Superviseur compte les parrainages',()=>{
 const s={get:()=>({n:3}),all:()=>[{at:0,parrain:'Awa Koné',filleul:'Yao Konan'}]};
 const r=PR.summary(s,PR.REWARD_DAYS*86400000);assert.deepEqual([r.codes,r.filleuls,r.rewarded],[3,1,1]);assert.equal(r.recent[0].filleul,'Yao K.');
});
