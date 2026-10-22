'use strict';
// Banc d'essai des agents IA de Guardian, avec des messages de vrais clients (2026-10-21).
// Avant cette série, 15 messages sur 18 recevaient la même réponse (« Que souhaitez-vous faire : jouer, regarder un film… »),
// et pendant une panne le client lisait le code du quartier (« YOP-07 ») au lieu de son nom.
// Aucun appel réseau réel : Claude est remplacé par un faux transport quand il le faut.
const {test,afterEach}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),{createGuardianServer}=require('./pilot-server.cjs');
const {seedDemo,DEMO,NEIGHBOURS}=require('./seed-demo.cjs'),N=require('./noc-store.cjs'),A=require('./appels.cjs'),F=require('./sim-flow.js');
const journey=require('./journey-store.cjs'),ai=require('./guardian-ai.cjs');
const KEY='sk-ant-test-0000000000000000000000';
afterEach(()=>{ai.setTransport(null);delete process.env.ANTHROPIC_API_KEY;});

// Ce que le client ne doit jamais lire : codes internes, jargon d'équipe, mots techniques interdits à l'écran.
const NEVER=/\b[A-Z]{3}-\d{2}\b|simul|fictif|moteur à règles|\bLLM\b|responsable technique|partage du débit ou un forfait supérieur ne corrige/;

async function client(){
 const server=createGuardianServer({db:':memory:',onError:()=>{}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'banc@example.test',password:'banc-password-1234',name:'Awa Test'})});
 const {user}=await res.json(),cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const request=async(p,body)=>{const r=await fetch(base+'/api'+p,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 let state=(await request('/journey/start',{})).data.state;
 const action=async data=>{const r=await request('/journey/action',{version:state.version,...data});if(r.status===200)state=r.data.state;return r;};
 const ask=async text=>{const r=await action({type:'chat',text});assert.equal(r.status,200,text);return state.messages.at(-1);};
 return {server,user,ask,action,get state(){return state;}};
}

// Message du client → ce que Guardian doit faire. « says » : un bout de la réponse attendue.
const CALM=[
 ['Bonjour',{intent:'salut',says:/^Bonjour ! J’ai vérifié votre ligne : tout va bien, 100 Mbps/}],
 ['Bonsoir Guardian',{intent:'salut',says:/^Bonjour !/}],
 ['Internet est coupé chez moi depuis ce matin',{intent:'coupure',says:/aucune panne n’est signalée dans votre quartier/,action:'reboot'}],
 ['Rien ne marche à la maison',{intent:'coupure',action:'reboot'}],
 ['Mon voisin a internet mais pas moi',{intent:'coupure',action:'reboot'}],
 ['Mon wifi ne marche pas dans la chambre',{intent:'wifi',says:/Le souci vient du Wi-Fi/}],
 ['Le wifi capte mal à l’étage',{intent:'wifi',says:/Rapprochez-vous de la box/}],
 ['La box clignote rouge',{intent:'voyants',says:/Photo de ma box/}],
 ['Le voyant LOS est allumé',{intent:'voyants',says:/Photo de ma box/}],
 ['Redémarre ma box s’il vous plaît',{intent:'reboot',says:/redémarrer votre box à distance/,action:'reboot'}],
 ['Je veux parler à un conseiller',{intent:'humain',says:/Appeler Moov/,action:'report'}],
 ['Le service client ne répond pas',{intent:'humain',action:'report'}],
 ['Le technicien arrive quand ?',{intent:'suivi',says:/Aucune intervention n’est en cours/}],
 ['C’est combien mon forfait ?',{intent:'prix',says:/100 Mbps pour 25\s000 FCFA par mois/}],
 ['Je veux résilier mon abonnement',{intent:'resiliation',says:/agence Moov/}],
 ['Merci beaucoup',{intent:'merci',says:/^Avec plaisir/}],
 ['ok merci',{intent:'merci',says:/^Avec plaisir/}],
 ['Ma connexion est lente le soir',{intent:'lent',says:/utilise actuellement/,action:'usage'}],
 ['Comment va ma connexion ?',{intent:'lent',action:'usage'}],
 ['Je veux regarder un film ce soir',{intent:'usage',proposal:true}],
 ['Je veux 200 Mbps',{intent:'upgrade',action:'upgrade'}],
 ['Quelle est la capitale du Mali ?',{intent:'inconnu',says:/Je m’occupe de votre connexion Moov Fibre/}],
 // Nouchi et dioula : compris sans réseau grâce aux packs de langue.
 ['y a fohi depuis ce matin dèh',{intent:'coupure',lang:'nouchi',action:'reboot'}],
 ['yako, faut j appelle gars de moov',{intent:'humain',lang:'nouchi',action:'report'}],
 ['N ka connexion man nyi',{intent:'lent',lang:'dioula',action:'usage'}]
];

test('Banc d’essai : chaque demande de client reçoit une réponse qui lui correspond',async()=>{
 const c=await client(),answers=new Set();
 try{
  for(const [text,want] of CALM){
   assert.equal(journey.intent(text+(want.lang?' '+require('./langues.cjs').detect(text).french:'')),want.intent,text);
   const a=await c.ask(text),q=c.state.messages.at(-2);
   if(want.says)assert.match(a.text,want.says,text);
   if('action' in want)assert.equal(a.action,want.action,text);
   if(want.proposal)assert.ok(c.state.proposal,text);
   if(want.lang)assert.equal(q.lang,want.lang,text);
   assert.doesNotMatch(a.text,NEVER,text);
   answers.add(a.text);
   if(c.state.proposal)await c.action({type:'cancel-proposal'});
   if(c.state.upgrade)await c.action({type:'upgrade-decline'});
  }
  assert.ok(answers.size>=14,'une réponse propre à chacune des 14 sortes de demandes (avant : 4 réponses en tout) : '+answers.size);
 }finally{c.server.close();}
});

test('« Redémarre ma box » : le bouton marche aussi quand la ligne est normale',async()=>{
 const c=await client();
 try{
  const a=await c.ask('Tu peux redémarrer la box ?');assert.equal(a.action,'reboot');
  assert.equal((await c.action({type:'reboot',confirm:true})).status,200);
  assert.match((await c.ask('Redémarre ma box')).text,/déjà en train de redémarrer/);
 }finally{c.server.close();}
});

async function seeded(){
 const store=new Store(':memory:'),server=createGuardianServer({store});
 const saved=process.env[DEMO.admin.env];process.env[DEMO.admin.env]='direction-test-2026';
 try{await seedDemo(store);}finally{if(saved===undefined)delete process.env[DEMO.admin.env];else process.env[DEMO.admin.env]=saved;}
 const uid=email=>store.get('SELECT id FROM users WHERE email=?',email).id,chef=uid(DEMO.admin.email);
 const rose=uid(NEIGHBOURS.find(n=>n.segment==='BAS-01').email);
 journey.put(store,rose,journey.seed());
 const ask=text=>{const v=journey.get(store,rose).version;journey.act(store,rose,{version:v,type:'chat',text});return journey.get(store,rose).messages.at(-1);};
 const op=(d,id)=>{const i=id&&N.overview(store,chef).incidents.find(x=>x.id===id);return N.operate(store,chef,{...d,...(i?{id,version:i.version}:{})});};
 return {store,server,chef,rose,ask,op};
}

test('Pendant une panne : Guardian dit la même chose que le serveur vocal, avec le nom du quartier et l’heure de retour',async()=>{
 const t=await seeded();
 try{
  N.operate(t.store,t.chef,{type:'simulate',segment:'BAS-01',scenario:'fiber'});
  let a=t.ask('Internet est coupé');
  assert.match(a.text,/^Nous savons déjà qu’internet est coupé dans votre quartier \(Quartier France, Grand-Bassam\) : un câble de fibre est coupé\./);
  assert.match(a.text,/Vous aurez l’heure de retour dès que le plan est validé/);assert.equal(a.action,'tracking');assert.doesNotMatch(a.text,NEVER);
  const i=N.client(t.store,t.rose).incidents.find(x=>!x.terminal);t.op({type:'approve',note:'Plan conforme.'},i.id);
  a=t.ask('Ça revient quand ?');
  const vocal=A.call(t.store,t.rose,{type:'start'}),hour=vocal.lines.find(l=>/devrait revenir vers/.test(l));
  assert.ok(hour);assert.ok(a.text.includes(hour),'même heure que le serveur vocal : '+hour);
  assert.match(t.ask('Bonjour').text,/^Bonjour ! Nous savons déjà/);
  assert.match(t.ask('Merci').text,/^Avec plaisir\. Je vous préviens dès que votre internet revient\./);
 }finally{t.server.close();}
});

test('Les huit pannes du simulateur : le client reçoit une explication juste, sans code ni jargon',async()=>{
 const want={fiber:/câble de fibre est coupé/,pole:/câble de fibre est coupé|une panne touche/,works:/chantier a arraché un câble/,flood:/armoire de rue a pris l’eau/,theft:/câble a été volé/,olt:/toute la commune de Grand-Bassam : un équipement central est en panne/,power:/le courant est coupé \(CIE\)/,congestion:/réseau est très chargé/};
 for(const [scenario,re] of Object.entries(want)){
  const t=await seeded();
  try{
   N.operate(t.store,t.chef,{type:'simulate',segment:'BAS-01',scenario});
   const a=t.ask('Ma connexion ne marche plus');
   assert.match(a.text,re,scenario);assert.doesNotMatch(a.text,NEVER,scenario);assert.equal(a.action,'tracking',scenario);
   // Les agents du simulateur (surveillance, diagnostic, plan, messages) disent la même cause au client.
   const o=N.overview(t.store,t.chef),i=o.incidents.find(x=>x.segment_id==='BAS-01'),seg=o.segments.find(g=>g.id==='BAS-01');
   const out=F.messages(i,seg,o.technicians,Date.now()+F.THINK+10),toClient=out.find(m=>m.to==='client');
   assert.ok(toClient,scenario);assert.doesNotMatch(toClient.body,NEVER,scenario);
   assert.equal(F.agents(i,seg,o.technicians,Date.now()+F.THINK+10).every(x=>x.state==='done'&&x.result),true,scenario);
   if(scenario==='power'){i.status!=='resolved'&&t.op({type:'approve',note:'CIE.'},i.id);assert.match(t.ask('Ça revient quand ?').text,/repartira toute seule au retour du courant/);}
  }finally{t.server.close();}
 }
});

test('Avec Claude : une phrase française que les règles ne comprennent pas est traduite en sens simple, puis reformulée',async()=>{
 process.env.ANTHROPIC_API_KEY=KEY;const bodies=[];
 ai.setTransport(async(url,init)=>{const b=JSON.parse(init.body);bodies.push(b);
  const text=b.output_config?.format?JSON.stringify({lang:'fr',french:'Internet ne marche plus chez moi.'}):'J’ai vérifié votre ligne : votre box reçoit bien 100 Mbps et aucune panne n’est signalée dans votre quartier. Un redémarrage de la box règle souvent ce souci.';
  return {ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text}]})};});
 const c=await client();
 try{
  const a=await c.ask('YouTube refuse de s’ouvrir depuis hier soir');
  assert.equal(bodies.length,2,'une compréhension puis une reformulation');
  assert.match(bodies[0].messages[0].content,/YouTube refuse/);
  assert.equal(a.action,'reboot','le sens donné par Claude guide la réponse');
  assert.match(a.text,/^J’ai vérifié votre ligne : votre box reçoit bien 100 Mbps/);
  assert.equal(c.state.messages.at(-2).lang,undefined,'pas d’étiquette de langue pour du français');
  // Une phrase déjà comprise par les règles ne coûte pas d'appel de compréhension.
  bodies.length=0;await c.ask('Mon wifi ne marche pas');assert.equal(bodies.filter(b=>b.output_config?.format).length,0);
 }finally{c.server.close();}
});

test('Avec Claude : un sens inventé ou hors sujet ne change rien, la réponse reste celle des règles',async()=>{
 process.env.ANTHROPIC_API_KEY=KEY;
 ai.setTransport(async(url,init)=>{const b=JSON.parse(init.body);const text=b.output_config?.format?JSON.stringify({lang:'fr',french:'Quelle est la capitale du Mali ?'}):'Bamako est la capitale. Pour votre connexion, je reste disponible.';return {ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text}]})};});
 const c=await client();
 try{
  const a=await c.ask('Quelle est la capitale du Mali ?');
  assert.equal(a.action,undefined);assert.equal(c.state.messages.at(-2).lang,undefined);
  assert.match(a.text,/Bamako|Je m’occupe de votre connexion/);
 }finally{c.server.close();}
});
