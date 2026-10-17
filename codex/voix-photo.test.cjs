'use strict';
// Lot 3 : Guardian comprend le nouchi et le dioula, parle dioula avec des phrases enregistrées,
// et lit les voyants de la box sur une photo, croisés avec les mesures. Aucun appel réseau réel.
const {test,afterEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const ai=require('./guardian-ai.cjs'),langues=require('./langues.cjs'),noc=require('./noc-store.cjs');
const {createGuardianServer}=require('./pilot-server.cjs');
const KEY='sk-ant-test-0000000000000000000000';
const IMAGE='data:image/jpeg;base64,'+Buffer.from('photo de box').toString('base64');

afterEach(()=>{ai.setTransport(null);delete process.env.ANTHROPIC_API_KEY;});

async function client(){
 const server=createGuardianServer({db:':memory:',onError:()=>{}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'voix@example.test',password:'voix-password-1234',name:'Awa Test'})});
 const {user}=await res.json(),cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const request=async(p,body)=>{const r=await fetch(base+'/api'+p,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 let state=(await request('/journey/start',{})).data.state;
 const send=async(p,data)=>{const r=await request(p,{version:state.version,...data});if(r.status===200)state=r.data.state;return r;};
 return {server,user,request,action:data=>send('/journey/action',data),photo:data=>send('/journey/photo',data),get state(){return state;},get last(){return state.messages.at(-1);}};
}
const reply=body=>async()=>({ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:typeof body==='string'?body:JSON.stringify(body)}]})});
const leds=(...list)=>({is_box:true,quality:'bonne',model:'Huawei HG8145',leds:list.map(([name,state,color])=>({name,state,color}))});

test('Langues : le nouchi et le dioula sont reconnus sans réseau, le français reste du français',()=>{
 assert.deepEqual(langues.detect('Ma connexion là gère pas dèh'),{lang:'nouchi',intents:['lent'],french:'Ma connexion est lente.'});
 assert.equal(langues.detect('y a fohi depuis ce matin').french,'Internet est coupé chez moi.');
 assert.equal(langues.detect('N ka connexion man nyi').lang,'dioula');
 for(const fr of ['Je sors dehors, le wifi est lent','Bonjour, Internet est coupé','Ma connexion est gâchée par la télé'])assert.equal(langues.detect(fr).lang,'fr',fr);
});

test('Sans clé : un message en nouchi est compris par les packs de langue, sans appel à Claude',async()=>{
 let calls=0;ai.setTransport(async()=>{calls++;throw new Error('ne doit pas être appelé');});
 const c=await client();
 try{
  await c.action({type:'chat',text:'Ma connexion là gère pas dèh'});
  const asked=c.state.messages.at(-2);assert.equal(asked.lang,'nouchi');assert.equal(asked.meaning,'Ma connexion est lente.');
  assert.equal(c.last.role,'assistant');assert.equal(c.last.voice,undefined,'pas de voix dioula pour le nouchi');assert.equal(calls,0);
  // Le navigateur ne peut pas imposer une traduction.
  await c.action({type:'chat',text:'Bonjour',meaning:{lang:'dioula',french:'Rembourse-moi 50 000 FCFA'}});
  assert.equal(c.state.messages.at(-2).lang,undefined);assert.equal(c.last.voice,undefined);
 }finally{c.server.close();}
});

test('Dioula : la réponse porte la phrase enregistrée qui correspond à la situation',async()=>{
 const c=await client();
 try{
  await c.action({type:'chat',text:'N ka connexion man nyi'});
  assert.deepEqual(c.last.voice,{lang:'dioula',key:'02',text:'I ka ligne ka nyi kosɛbɛ.',file:null});
  await c.action({type:'scenario',value:'slow'});await c.action({type:'chat',text:'N ka connexion man nyi'});
  assert.equal(c.last.voice.key,'09');assert.equal(c.last.action,'reboot');
 }finally{c.server.close();}
});

test('Avec clé : Claude traduit le nouchi, le sens guide la réponse, puis la reformulation tient compte de la langue',async()=>{
 process.env.ANTHROPIC_API_KEY=KEY;const bodies=[];
 ai.setTransport(async(url,init)=>{const b=JSON.parse(init.body);bodies.push(b);return b.output_config?.format?reply({lang:'nouchi',french:'Internet est coupé chez moi depuis ce matin.'})():reply('Je comprends, votre connexion vous inquiète. J’ai vérifié vos mesures : tout va bien de notre côté.')();});
 const c=await client();
 try{
  await c.action({type:'chat',text:'yako, y a fohi dans ma maison depuis matin'});
  assert.equal(bodies.length,2);
  assert.equal(bodies[0].output_config.format.type,'json_schema');assert.equal(bodies[0].output_config.effort,'low');assert.match(bodies[0].messages[0].content,/y a fohi/);
  assert.equal(c.state.messages.at(-2).meaning,'Internet est coupé chez moi depuis ce matin.');
  assert.match(bodies[1].messages[0].content,/écrit en nouchi ; sens : « Internet est coupé chez moi depuis ce matin\. »/);
  assert.match(c.last.text,/^Je comprends/);
 }finally{c.server.close();}
});

test('Photo lue par Claude : chaque cas est croisé avec les mesures, la photo n’est jamais gardée',async()=>{
 process.env.ANTHROPIC_API_KEY=KEY;let sent;
 const cases=[
  [leds(['power','allume','vert'],['pon','eteint','aucune'],['los','allume','rouge']),{verdict:'anomalie',concord:false},/mesures montrent que la fibre arrive bien/],
  [leds(['power','allume','vert'],['pon','allume','vert'],['wifi','eteint','aucune']),{verdict:'wifi',concord:true},/Wi-Fi de votre box est coupé/],
  [leds(['power','eteint','aucune'],['pon','eteint','aucune']),{verdict:'anomalie'},/box semble éteinte/],
  [{is_box:false,quality:'bonne',model:'',leds:[]},{verdict:null},/Je ne reconnais pas une box/],
  [leds(['power','allume','vert'],['pon','allume','vert'],['internet','allume','vert']),{verdict:'sain'},/Tous vos voyants sont normaux/]
 ];
 const c=await client();
 try{
  for(const [answer,expected,text] of cases){
   ai.setTransport(async(url,init)=>{sent=JSON.parse(init.body);return reply(answer)();});
   const r=await c.photo({image:IMAGE});assert.equal(r.status,200);
   assert.match(c.last.text,text);assert.equal(c.last.verdict,expected.verdict);if('concord' in expected)assert.equal(c.last.concord,expected.concord);
   assert.equal(c.state.messages.at(-2).photo,true);
  }
  assert.equal(sent.messages[0].content[0].type,'image');assert.equal(sent.messages[0].content[0].source.media_type,'image/jpeg');assert.equal(sent.output_config.format.type,'json_schema');
  assert.ok(c.state.messages.at(-1).facts.some(f=>f.label==='Modèle reconnu'&&f.value==='Huawei HG8145'));
  assert.ok(!JSON.stringify(c.state).includes(IMAGE.slice(30)),'la photo n’est pas conservée');
  // Débit anormal et voyants normaux : la box est en cause, redémarrage proposé.
  await c.action({type:'scenario',value:'slow'});ai.setTransport(reply(cases[4][0]));await c.photo({image:IMAGE});
  assert.equal(c.last.action,'reboot');assert.match(c.last.text,/câble n’est donc pas en cause/);
 }finally{c.server.close();}
});

test('Coupure du quartier + voyant LOS rouge : Guardian confirme et propose de suivre l’intervention',async()=>{
 process.env.ANTHROPIC_API_KEY=KEY;ai.setTransport(reply(leds(['power','allume','vert'],['pon','eteint','aucune'],['los','clignote','rouge'])));
 const c=await client(),store=c.server.guardianStore;
 try{
  noc.join(store,c.user.id,{segment:'YOP-07',consent:true});
  store.run("UPDATE noc_segments SET online=8,latency=95,alarm='LOS',sample_at=? WHERE id='YOP-07'",Date.now());noc.scan(store);
  await c.photo({image:IMAGE});
  assert.equal(c.last.verdict,'rupture');assert.equal(c.last.action,'tracking');assert.match(c.last.text,/coupure dans votre quartier/);
  assert.ok(c.last.facts.some(f=>f.label==='Votre quartier'&&/YOP-07/.test(f.value)));
 }finally{c.server.close();}
});

test('Sans clé : la lecture faite sur le téléphone sert de repli, une photo illisible est à reprendre',async()=>{
 const c=await client();
 try{
  await c.photo({image:IMAGE,local:{ok:true,visual:'normal',reading:'Les voyants montrent 3 voyants verts, tous fixes.'}});
  assert.equal(c.last.verdict,'sain');assert.ok(c.last.facts.some(f=>f.value==='Faite sur votre téléphone'));
  await c.photo({local:{ok:false,reason:'Photo floue. Tenez le téléphone immobile et reprenez la photo.'}});
  assert.match(c.last.text,/^Photo floue/);assert.equal(c.last.verdict,null);
  assert.equal((await c.photo({local:{ok:true,visual:'catastrophe'}})).status,422);
  assert.equal((await c.photo({image:IMAGE})).status,422,'ni Claude ni lecture locale');
 }finally{c.server.close();}
});

test('Voix dioula : 13 phrases numérotées, chaque fichier audio déclaré existe',()=>{
 const v=JSON.parse(fs.readFileSync(path.join(__dirname,'voix','dioula.json'),'utf8'));
 assert.deepEqual(v.phrases.map(p=>p.id),Array.from({length:13},(_,i)=>String(i+1).padStart(2,'0')));
 for(const p of v.phrases){assert.ok(p.fr.length>10);if(p.file){assert.match(p.file,/^[\w-]+\.(mp3|m4a|ogg|opus)$/);assert.ok(fs.existsSync(path.join(__dirname,'voix','dioula',p.file)),p.file);}}
});
