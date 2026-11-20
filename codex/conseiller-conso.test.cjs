'use strict';
// Conseiller conso : l'appareil qui prend le plus de données, et le forfait qui va à la maison (forfait-bilan.cjs),
// dans l'écran Appareils et dans la conversation avec Guardian. Vrais chiffres du PC qui partage sa connexion s'il compte.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createGuardianServer}=require('./pilot-server.cjs');

async function server(){const srv=createGuardianServer({db:':memory:'});await new Promise(r=>srv.listen(0,'127.0.0.1',r));return {srv,base:'http://127.0.0.1:'+srv.address().port};}
async function client(base,email){
 const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'conso-password-123',name:'Client Conso'})});
 const {user}=await res.json(),cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 return async(path,body)=>{const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
}

test('Conseiller conso : part de chaque appareil sur 7 jours et forfait du bilan, en une phrase simple',async()=>{
 const {srv,base}=await server();
 try{
  const c=await client(base,'conso@example.test');
  assert.equal((await c('/journey/conso')).status,409,'parcours non démarré');
  await c('/journey/start',{});
  let r=(await c('/journey/conso')).data;
  assert.equal(r.source,null);assert.match(r.text,/pas encore assez de mesures/);assert.deepEqual(r.devices,[]);
  // 7 jours de soirées saturées : le bilan conseille de monter, le conseiller dit qui prend le plus.
  await c('/journey/bilan/demo',{profile:'soir'});
  r=(await c('/journey/conso')).data;
  assert.equal(r.source,'box');assert.equal(r.verdict,'monter');assert.equal(r.to.mbps,200);
  assert.ok(r.devices.length>=2&&r.devices.length<=4);
  assert.ok(r.devices.every((d,i)=>i===0||d.share<=r.devices[i-1].share),'du plus gros au plus petit');
  assert.ok(Math.abs(r.devices.reduce((a,d)=>a+d.share,0)-100)<=4,'les parts font environ 100 %');
  assert.match(r.text,new RegExp('^« '+r.devices[0].name+' » a pris '+r.devices[0].share+' % des données de la maison ces 7 derniers jours \\(\\d+(,\\d)? (Go|Mo)\\)\\.'));
  assert.match(r.text,/le forfait 200 Mb\/s vous irait mieux \(\+ 5 000 F par mois\)/);
  // Maison calme : il conseille de descendre, avec l'économie.
  await c('/journey/bilan/demo',{profile:'calme'});
  r=(await c('/journey/conso')).data;
  assert.equal(r.verdict,'baisser');assert.match(r.text,/le forfait 50 Mb\/s vous suffirait, et vous économiseriez 5 000 F par mois/);
  assert.equal((await c('/journey/state')).data.state.plan.mbps,100,'le conseiller ne change jamais le forfait tout seul');
  // Dans la conversation : « Qui consomme le plus ? » reçoit la même réponse, avec les chiffres.
  const st=(await c('/journey/state')).data.state;
  const after=(await c('/journey/action',{type:'chat',text:'Qui consomme le plus chez moi ?',version:st.version})).data.state;
  const last=after.messages[after.messages.length-1];
  assert.equal(last.role,'assistant');assert.equal(last.text,r.text);assert.equal(last.action,'devices');
  assert.ok(last.facts.length>=2&&/% des données$/.test(last.facts[0].value));
 }finally{srv.close();}
});

test('Conseiller conso : avec le PC qui partage sa connexion, les vrais chiffres passent devant',async()=>{
 const {srv,base}=await server();
 try{
  const c=await client(base,'conso-pc@example.test');
  await c('/journey/start',{});
  const link=(await c('/test/link',{})).data;
  const send=b=>fetch(base+'/api/test/wifi',{method:'POST',headers:{'X-Test-Token':link.token,'Content-Type':'application/json'},body:JSON.stringify({ssid:'PC-PARTAGE',signal:'80',...b})});
  const hot={ip:'192.168.137.1',prefix:24,gateway:'192.168.137.1',mac:'3E-22-FB-11-22-33',medium:'hotspot',devices:[{ip:'192.168.137.20',mac:'DA-11-22-33-44-55'},{ip:'192.168.137.21',mac:'7E-11-22-33-44-66'}]};
  // Moins de 5 Mo comptés : pas encore assez, Guardian n'invente rien.
  await send({scan:hot,count:'on',usage:[{ip:'192.168.137.20',down:1e6,up:1e5}]});
  assert.equal((await c('/journey/conso')).data.source,null);
  await new Promise(r=>setTimeout(r,3100));
  await send({scan:hot,count:'on',usage:[{ip:'192.168.137.20',down:45e6,up:5e6},{ip:'192.168.137.21',down:9e6,up:1e6}]});
  const r=(await c('/journey/conso')).data;
  assert.equal(r.source,'pc');assert.equal(r.devices[0].share,83);assert.equal(r.devices[1].share,17);
  assert.match(r.text,/^« Téléphone ou tablette \d » a pris 83 % des données de la maison depuis le lancement de Guardian \(50 Mo\)\. C’est lui qui remplit le plus votre ligne\./);
  assert.match(r.text,/quelques jours de mesures/,'pas de bilan de 7 jours : pas de forfait conseillé au hasard');
 }finally{srv.close();}
});
