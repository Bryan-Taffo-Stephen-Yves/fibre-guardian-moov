'use strict';
// Nouveau parcours : laboratoire isolé par compte. Aucune commande réseau réelle.
const crypto=require('node:crypto');
const {id,token,hash,insist,word,paragraph,number}=require('./pilot-model.cjs');
const operator=require('./operator-store.cjs');
const usage=require('./journey-usage.cjs');
const langues=require('./langues.cjs'),boxReading=require('./box-reading.cjs');
const {rebootGate}=require('./ui-model.js');
const REBOOT_MS=20000; // Durée affichée d’un redémarrage de box à distance.
const STEPS=['reported','confirmed','assigned','en_route','on_site','repairing','verifying','resolved'];
const LABELS=['Signalement reçu','Incident confirmé','Équipe affectée','En route','Sur place','Réparation en cours','Vérification du réseau','Connexion rétablie'];
const TECHS=[{id:'awa',name:'Awa',team:'Équipe fibre Ouest',skill:'fibre',available:true},{id:'yao',name:'Yao',team:'Équipe fibre Centre',skill:'fibre',available:true}];
function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS journey_otp(id TEXT PRIMARY KEY,proof TEXT NOT NULL,code TEXT NOT NULL,name TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,used INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS journey_state(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS citizen_reports(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created INTEGER NOT NULL,zone TEXT NOT NULL,description TEXT NOT NULL,photo TEXT NOT NULL,lat REAL NOT NULL,lon REAL NOT NULL,status TEXT NOT NULL DEFAULT 'received',response TEXT NOT NULL DEFAULT '');
 `);usage.migrate(s);s.run('DELETE FROM journey_otp WHERE expires<?',Date.now());}
const DEVICE_LIMITS=[5,10,20],MANUAL_LIMIT_MS=30*86400000;
function seed(){return {version:0,mode:'simulation',created:Date.now(),scenario:'normal',usual:4,capacity:100,plan:{id:'demo-100',name:'Essentiel démo',mbps:100,price:25000},zone:'Yopougon · Niangon',segment:'YOP-07',selectedHome:'home-1',devices:[
 {id:'phone',name:'iPhone de Koffi',demand:5,protected:true,recognized:true},
 {id:'mac',name:'MacBook de Hady',demand:12,protected:true,recognized:true},
 {id:'tv',name:'LG TV du salon',demand:20,recognized:true},
 {id:'ps5',name:'PS5 de Kevin',demand:6,recognized:true}],
 homes:[{id:'home-1',name:'Mon foyer',segment:'YOP-07'},{id:'home-2',name:'Foyer Awa',segment:'YOP-07'},{id:'home-3',name:'Foyer Koné',segment:'YOP-07'},{id:'home-4',name:'Foyer Hady',segment:'YOP-07'},{id:'home-5',name:'Foyer témoin',segment:'YOP-08'}],
 incidents:[],notifications:[],audit:[],messages:[],proposal:null,technicians:TECHS};}
function get(s,uid){const row=s.get('SELECT body FROM journey_state WHERE user_id=?',uid);return row?JSON.parse(row.body):null;}
function put(s,uid,state){s.run('INSERT INTO journey_state VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET body=excluded.body',uid,JSON.stringify(state));}
function audit(st,action,detail){st.audit.unshift({id:id(),at:Date.now(),action,detail});st.audit=st.audit.slice(0,100);}
function notify(st,incident,title){for(const home of st.homes.filter(h=>h.segment===incident.segment)){const key=incident.id+':'+incident.status+':'+home.id;if(!st.notifications.some(n=>n.key===key))st.notifications.unshift({key,home:home.id,at:Date.now(),title,body:'Incident '+incident.reference+' · '+incident.zone,read:false});}st.notifications=st.notifications.slice(0,100);}
function active(st){return st.incidents.find(i=>i.segment===st.segment&&i.status!=='resolved'&&i.status!=='false_alarm');}
function snapshot(st){const now=Date.now(),down=!!active(st),rebooting=!down&&st.rebootUntil>now,cap=down||rebooting?0:st.scenario==='slow'?12:st.capacity;
 const devices=st.devices.map(d=>({...d,limit:d.until>now?d.limit:null,until:d.until>now?d.until:null}));
 const demand=devices.map(d=>d.blocked?0:Math.min(d.demand,d.limit??Infinity)),total=demand.reduce((a,b)=>a+b,0);
 devices.forEach((d,i)=>{d.mbps=Math.round((total>cap?demand[i]*cap/total:demand[i])*10)/10;});
 return {...st,devices,metrics:{at:now,capacity:cap,used:Math.round(devices.reduce((a,d)=>a+d.mbps,0)*10)/10,latency:down||rebooting?null:total>cap?85:18,connected:devices.filter(d=>!d.blocked).length,state:down?'panne':rebooting?'redémarrage':total>cap?'dégradée':'stable',rebootUntil:rebooting?st.rebootUntil:null},incidents:st.incidents.map(i=>({...i,progress:i.status==='en_route'?Math.min(1,(now-i.departed)/120000):STEPS.indexOf(i.status)>3?1:0,eta:i.status==='en_route'?Math.max(0,Math.ceil((120000-(now-i.departed))/1000)):null}))};}
function validatePhoto(value){insist(typeof value==='string'&&value.length<480000,'Photo limitée à 350 Ko.');const m=value.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);insist(m,'Photo PNG ou JPEG requise.');const bytes=Buffer.from(m[2],'base64');insist(bytes.length>12&&bytes.length<=350000,'Taille de photo invalide.');insist(m[1]==='png'?bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a':bytes[0]===255&&bytes[1]===216&&bytes[2]===255,'Format de photo invalide.');return value;}
function diagnostic(st,text,context=null){const snap=snapshot(st),fault=context||active(st),connected=snap.devices.filter(d=>!d.blocked),largest=connected.slice().sort((a,b)=>b.mbps-a.mbps)[0];
 const facts=[{label:'Incident du segment',value:fault?(fault.segment||fault.reference||st.segment):'Aucun incident ouvert'},{label:'Appareils connectés',value:connected.length+' / '+st.usual+' habituels'},{label:'Plus gros usage',value:largest?largest.name+' · '+largest.mbps+' Mbps':'Aucun appareil actif'}];
 if(fault){st.proposal=null;st.upgrade=null;const stages={reported:'Votre signalement est reçu, une analyse est attendue.',proposed:'Le plan attend la validation du responsable technique.',approved:'Le plan est approuvé ; la prise en charge est en préparation.',dispatched:'Une équipe est affectée. Son départ n’est pas encore confirmé.',en_route:'Le technicien est en route.'+(fault.position?.eta?' Arrivée estimée dans '+Math.ceil(fault.position.eta/60)+' minute(s).':' Confirmation d’arrivée attendue.'),on_site:'Le technicien est actuellement sur place pour traiter l’incident.',verifying:'La réparation est déclarée ; nous vérifions le retour du réseau.',rejected:'Le support doit revoir le plan d’intervention.'};return {message:'Un incident concerne '+(fault.segment||st.segment)+'. '+(stages[fault.status]||'La prise en charge est en cours.')+' Le partage du débit ou un forfait supérieur ne corrige pas cet incident. Consultez le suivi partagé.',facts,action:'tracking'};}
 const requested=Number(text.match(/(\d+)\s*(?:mbps|mégabits|megabits)/i)?.[1]||0),plan=st.plan||{id:'demo-100',name:'Essentiel démo',mbps:100,price:25000};
 if(/forfait|upgrade|plus de débit|plus rapide/i.test(text)||requested>plan.mbps){
  st.proposal=null;st.upgrade=null;
  if(st.scenario==='slow')return {message:'Votre débit est anormalement bas : un forfait plus rapide ne réglerait pas ce souci. Commençons par redémarrer votre box à distance.',facts};
  if(st.declinedUntil>Date.now())return {message:'C’est noté. Je ne vous proposerai pas d’autre offre pendant 24 heures.',facts};
  if(plan.mbps>=200)return {message:'Vous avez déjà le forfait 200 Mbps, notre offre la plus rapide.',facts};
  if(requested>200)return {message:'Notre offre la plus rapide est à 200 Mbps. Je ne peux pas vous promettre plus.',facts};
  if(requested<=plan.mbps&&snap.metrics.used<snap.metrics.capacity*.9)return {message:'Vos mesures ne justifient pas un achat : votre forfait suffit pour l’instant. Dites-moi le débit dont vous avez besoin.',facts};
  const quote={id:id(),from:plan,to:{id:'demo-200',name:'Confort démo',mbps:200,price:30000},amount:30000-plan.price,expires:Date.now()+300000};
  st.upgrade=quote;
  return {message:'Pour ce besoin, votre forfait peut passer de '+plan.mbps+' à 200 Mbps : complément unique de '+quote.amount.toLocaleString('fr-FR')+' FCFA, puis 30 000 FCFA par mois. Le gain réel dépend aussi de votre Wi-Fi.',facts,action:'upgrade'};
 }
 if(st.scenario==='slow'&&!(st.rebootUntil>Date.now()))return {message:'Votre débit est tombé à '+snap.metrics.capacity+' Mbps alors que votre offre prévoit '+plan.mbps+' Mbps. Vos appareils n’en sont pas la cause. Un redémarrage de la box règle souvent ce souci : voulez-vous la redémarrer à distance ?',facts,action:'reboot'};
 if(connected.length>st.usual+1)return {message:'Le nombre d’appareils est inhabituel. Un appareil nouveau n’est pas forcément un intrus : vérifiez ceux auxquels vous avez donné le mot de passe avant de les bloquer.',facts,action:'devices'};
 if(/jeu|gaming|film|visio|meeting|télécharg|download|dévelop|bureau|travail|compil|docker|limite/i.test(text)){
  const usageName=/jeu|gaming/i.test(text)?'gaming':/visio|meeting/i.test(text)?'visioconférence':/film/i.test(text)?'film':/dévelop|bureau|travail|compil|docker/i.test(text)?'travail':'téléchargement';
  const target=st.devices.find(d=>d.id===(usageName==='gaming'||usageName==='téléchargement'?'ps5':usageName==='film'?'tv':'mac'));
  let others=st.devices.filter(d=>!d.blocked&&!d.protected&&d.id!==target.id);
  if(['work','developers'].includes(st.usageContext)){
   // Un contexte professionnel n'autorise pas à réduire les autres tâches de l'équipe.
   const normalized=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
   const permits=/(limite|limiter|peut attendre|non prioritaire)/.test(normalized)&&!/(ne\b.{0,35}limit|pas\b.{0,35}limit|limit.{0,35}\bpas)/.test(normalized);
   others=permits?others.filter(d=>d.id==='tv'?/\btv\b|television/.test(normalized):d.id==='ps5'?/\bps5\b|console/.test(normalized):normalized.includes(d.name.toLowerCase())):[];
   if(!others.length){st.proposal=null;return {message:'Dans votre contexte '+(st.usageContext==='developers'?'d’équipe de développeurs':'de télétravail')+', les dépôts, sauvegardes et visios peuvent légitimement utiliser beaucoup de débit. Je ne limite aucun appareil sur la seule base de son volume. Indiquez un usage qui peut attendre, par exemple « Pour ma visio, la TV peut attendre », avant une proposition à confirmer. Les appareils protégés restent intouchables.',facts,action:'devices'};}
  }
  const limits=others.map(d=>({id:d.id,name:d.name,mbps:usageName==='film'?8:5}));
  if(!limits.length)return {message:'Les autres appareils actifs sont protégés. Je ne peux pas réduire leur débit. Arrêtez un transfert volontairement ou vérifiez le Wi-Fi.',facts};
  st.proposal={id:id(),usage:usageName,target:target.id,limits,minutes:30,expires:Date.now()+300000};
  return {message:'Pour votre '+usageName+', je propose un partage temporaire pendant 30 minutes. Aucune limite n’est réglée sous 2 Mbps ; les appareils protégés ne sont pas limités. Le débit obtenu dépend de la capacité partagée. Confirmez avant application.',facts,proposal:st.proposal};
 }
 return {message:(snap.metrics.used>=snap.metrics.capacity*.9?'La connexion est très sollicitée. ': 'J’ai vérifié vos mesures. ')+(largest?largest.name+' utilise actuellement '+largest.mbps+' Mbps. ':'')+(['work','developers'].includes(st.usageContext)?'Cet usage peut être nécessaire au travail : un gros volume n’est pas une anomalie. Quelle tâche souhaitez-vous préserver, et quels transferts peuvent attendre ?':'Que souhaitez-vous faire : jouer, regarder un film, télécharger ou participer à une visio ?'),facts,action:'usage'};
}
async function requestOtp(s,d,ip){insist(d.mode==='demo','Connexion par SMS momentanément indisponible. Réessayez plus tard.',503);s.rate('otp-ip:'+ip,8,600000);const phone=String(d.phone||'').replace(/[\s()-]/g,'');insist(/^\+[1-9]\d{7,14}$/.test(phone),'Numéro au format international, par exemple +2250700000001.');s.rate('otp-phone:'+hash(phone),3,600000);const name=word(d.name||'Visiteur','Nom',60),cid=id(),proof=token(),code=String(crypto.randomInt(100000,1000000));s.run('DELETE FROM journey_otp WHERE expires<?',Date.now());s.run('INSERT INTO journey_otp(id,proof,code,name,expires) VALUES(?,?,?,?,?)',cid,hash(proof),hash(cid+code),name,Date.now()+300000);return {id:cid,proof,demoCode:code,expires:Date.now()+300000,mode:'demo',notice:'Code envoyé. Il est valable 5 minutes.'};}
async function verifyOtp(s,d,ip){s.rate('otp-verify:'+ip,25,600000);const row=s.get('SELECT * FROM journey_otp WHERE id=?',String(d.id||''));insist(row&&row.proof===hash(String(d.proof||''))&&!row.used&&row.expires>Date.now()&&row.attempts<5,'Code expiré ou trop de tentatives. Demandez un nouveau code.',401);s.run('UPDATE journey_otp SET attempts=attempts+1 WHERE id=?',row.id);insist(hash(row.id+String(d.code||''))===row.code,'Code incorrect.',401);s.run('UPDATE journey_otp SET used=1 WHERE id=?',row.id);const result=await s.register({email:'demo-'+id()+'@guardian.invalid',name:row.name,password:token()});put(s,result.user.id,seed());return result.user;}
function sharedFault(s,uid){const noc=require('./noc-store.cjs');return noc.client(s,uid).incidents.find(noc.isOpen)||null;}
// Incident de quartier réparé dans les dernières 24 h : l'accueil le signale au client.
function zoneNews(s,uid,now=Date.now()){const noc=require('./noc-store.cjs');const i=noc.client(s,uid).incidents.filter(x=>x.status==='resolved'&&x.restorationVerified&&x.events?.length).map(x=>({segment:x.segment,start:x.events[0].at,end:x.events.at(-1).at})).filter(x=>now-x.end<24*3600000).sort((a,b)=>b.end-a.end)[0];return i||null;}
function snapshotFor(s,uid,st){const result={...snapshot(st),usageContext:st.usageContext||'home',sharedIncident:sharedFault(s,uid),zoneNews:zoneNews(s,uid)};usage.observe(s,uid,result);return result;}
function act(s,uid,d){return s.transaction(()=>{let st=get(s,uid);insist(st,'Démarrez votre démonstration.',409);insist(d.version===st.version,'Le parcours a été actualisé. Réessayez.',409);const now=Date.now();
 usage.observe(s,uid,{...st,sharedIncident:sharedFault(s,uid)},now);
 if(d.type==='scenario'){
  insist(['normal','download','slow','devices'].includes(d.value),'Scénario inconnu.');const changed=st.scenario!==d.value;st.scenario=d.value;
  if(d.value!=='devices')st.devices=st.devices.filter(x=>!x.guest);
  st.devices.find(x=>x.id==='ps5').demand=d.value==='download'?110:6;
  if(changed){st.proposal=null;st.upgrade=null;} // Un partage proposé sur un autre scénario ne doit plus être validable.
  if(d.value==='devices'){
   for(const guest of [{id:'guest-1',name:'Samsung Galaxy invité',demand:8,guest:true,recognized:false},{id:'guest-2',name:'Smart TV LED 32 pouces',demand:15,guest:true,recognized:false}])if(!st.devices.some(x=>x.id===guest.id))st.devices.push(guest);
   const connected=snapshot(st).metrics.connected;
   if(changed&&connected>st.usual+1)st.notifications.unshift({key:id(),home:'home-1',at:now,title:'Nombre inhabituel d’appareils',body:connected+' appareils au lieu des '+st.usual+' habituels. Vérifiez avant de bloquer.',read:false});
   st.notifications=st.notifications.slice(0,100);
  }
  audit(st,'scenario',d.value);
 }else if(d.type==='chat'){
  // d.meaning est ajouté par le serveur (langues.cjs ou Claude), jamais accepté tel quel du navigateur (voir pilot-server).
  const text=paragraph(d.text,'Message',1200),meaning=d.meaning&&['nouchi','dioula','autre'].includes(d.meaning.lang)?{lang:d.meaning.lang,french:String(d.meaning.french||'').slice(0,300)}:null,fault=sharedFault(s,uid);
  const reply=diagnostic(st,meaning?.french?text+' '+meaning.french:text,fault);
  const voice=meaning?.lang==='dioula'?langues.voice(langues.voiceKey({fault,action:reply.action,state:snapshot(st).metrics.state,greeting:/^\s*(bonjour|salut|i ni|a ni)/i.test(text)&&text.length<40})):null;
  st.messages.push({id:id(),role:'user',text,...(meaning?{lang:meaning.lang,meaning:meaning.french||null}:{})},{id:id(),role:'assistant',text:reply.message,facts:reply.facts,action:reply.action,...(voice?{voice}:{})});st.messages=st.messages.slice(-30);
 }else if(d.type==='apply'){
  const p=st.proposal;insist(d.confirm===true&&p&&d.id===p.id&&p.expires>now,'Confirmation valide requise.',409);insist(!active(st)&&!sharedFault(s,uid),'Une panne de zone est en cours : action annulée.',409);
  for(const l of p.limits){const dev=st.devices.find(v=>v.id===l.id);insist(dev&&!dev.protected&&!dev.blocked,'Appareil indisponible ou protégé.',409);insist(l.mbps>=2,'Plancher de sécurité requis.');dev.limit=l.mbps;dev.until=now+p.minutes*60000;}
  audit(st,'qos.confirm',p.usage+' · 30 minutes · simulation');st.proposal=null;
  }else if(d.type==='upgrade-decline'){st.upgrade=null;st.declinedUntil=now+86400000;audit(st,'upgrade.declined','Offres suspendues pendant 24 heures');
 }else if(d.type==='upgrade-pay'){
  // Paiement purement fictif, idempotent. Montant et forfait contrôlés côté serveur.
  insist(d.confirm===true,'Confirmez le paiement pour continuer.');
  if(st.payment?.quoteId!==d.id){
   const q=st.upgrade;insist(q&&q.id===d.id&&q.expires>now,'Offre expirée ou introuvable.',409);
   insist(!active(st)&&!sharedFault(s,uid),'Incident de zone en cours : aucun achat proposé.',409);
   insist(st.scenario!=='slow'&&(st.plan?.id||'demo-100')===q.from.id&&q.to.id==='demo-200'&&q.amount===q.to.price-q.from.price&&q.amount===5000,'Offre modifiée ou devenue inapplicable.',409);
   st.plan=q.to;st.capacity=q.to.mbps;st.payment={quoteId:q.id,amount:q.amount,at:now,mode:'simulation'};st.upgrade=null;
   audit(st,'upgrade.activated','Paiement simulé 5 000 FCFA · 200 Mbps · aucun débit réel');
   st.messages.push({id:id(),role:'assistant',text:'Paiement confirmé : 5 000 FCFA. Votre forfait 200 Mbps est actif.'});
  }
 }else if(d.type==='reboot'){
  // Redémarrage à distance demandé par le client : même garde-fou que le laboratoire (rebootGate, 2 fois en 10 minutes).
  insist(d.confirm===true,'Confirmez le redémarrage de votre box.');
  insist(!active(st)&&!sharedFault(s,uid),'Un incident de zone est en cours : redémarrer votre box ne réglera pas la coupure. Suivez plutôt l’intervention.',409);
  insist(!(st.rebootUntil>now),'Votre box est déjà en train de redémarrer.',409);
  const gate=rebootGate(st.reboots||[],now,true);insist(gate.ok,gate.message,429);
  const fixed=st.scenario==='slow';st.reboots=gate.recent.concat(now);st.rebootUntil=now+REBOOT_MS;
  if(fixed){st.scenario='normal';st.proposal=null;st.upgrade=null;}
  st.notifications.unshift({key:id(),home:'home-1',at:now,title:'Redémarrage de votre box',body:fixed?'Votre box redémarre. Le débit habituel revient dans quelques secondes.':'Votre box redémarre. Internet revient dans quelques secondes.',read:false});st.notifications=st.notifications.slice(0,100);
  audit(st,'box.reboot','Redémarrage à distance confirmé par le client');
 }else if(d.type==='cancel-proposal'){st.proposal=null;
 }else if(d.type==='restore'){for(const dev of st.devices){dev.limit=null;dev.until=null;}st.proposal=null;audit(st,'qos.restore','Limites temporaires annulées');
 }else if(d.type==='device'){
  const dev=st.devices.find(v=>v.id===d.id);insist(dev,'Appareil inconnu.',404);insist(['recognize','block','unblock','limit','unlimit','remove'].includes(d.action),'Action inconnue.');
  if(d.action==='recognize')dev.recognized=true;
  else{insist(!dev.protected,'Cet appareil est protégé.',403);insist(d.confirm===true,'Confirmation obligatoire.');
   // Limite choisie par le client : reste en place jusqu'à ce qu'il l'enlève (plancher de 2 Mbps conservé).
   if(d.action==='limit'){insist(DEVICE_LIMITS.includes(d.mbps),'Débit proposé : '+DEVICE_LIMITS.join(', ')+' Mbps.');insist(!dev.blocked,'Débloquez d’abord cet appareil.',409);dev.limit=d.mbps;dev.until=now+MANUAL_LIMIT_MS;dev.manual=true;}
   else if(d.action==='unlimit'){dev.limit=null;dev.until=null;dev.manual=false;}
   else if(d.action==='remove'){st.devices=st.devices.filter(v=>v.id!==dev.id);if(st.proposal&&(st.proposal.target===dev.id||st.proposal.limits.some(l=>l.id===dev.id)))st.proposal=null;}
   else dev.blocked=d.action==='block';}
  audit(st,'device.'+d.action,dev.name+(d.action==='limit'?' · '+d.mbps+' Mbps':''));
 }else if(d.type==='usage-context'){
  insist(d.confirm===true,'Confirmez le contexte d’usage.');insist(Object.hasOwn(usage.CONTEXTS,d.value),'Contexte inconnu.');st.usageContext=d.value;st.proposal=null;audit(st,'usage.context',usage.CONTEXTS[d.value].label+' · aucune action sur le débit');
 }else if(d.type==='baseline'){st.usual=snapshot(st).metrics.connected;audit(st,'baseline','Nombre habituel confirmé : '+st.usual);
 }else if(d.type==='report'){
  insist(d.consent===true,'Consentement au partage requis.');insist(st.incidents.length<15,'Maximum 15 incidents dans ce parcours.');const description=paragraph(d.description,'Description',500),zone=word(d.zone,'Zone',100);number(d.lat,'Latitude',-90,90,false);number(d.lon,'Longitude',-180,180,false);const photo=validatePhoto(d.photo);const existing=active(st);
  insist(!existing,'Un incident est déjà ouvert sur votre segment. Utilisez « Je suis aussi touché ».',409);
  const incident={id:id(),reference:'FG-'+String(st.incidents.length+1).padStart(3,'0'),segment:st.segment,zone,description,photo,lat:d.lat,lon:d.lon,status:'reported',created:now,events:[{at:now,label:LABELS[0]}],confirmations:['home-1'],electrical:d.kind==='pole',kind:d.kind};st.incidents.unshift(incident);audit(st,'report',incident.reference);
 }else if(d.type==='affected'){
  const i=st.incidents.find(v=>v.id===d.id),home=st.homes.find(v=>v.id===d.home);insist(i&&home&&home.segment===i.segment,'Foyer non concerné.',403);if(!i.confirmations.includes(home.id))i.confirmations.push(home.id);
 }else if(d.type==='assign'){
  const i=st.incidents.find(v=>v.id===d.id),tech=st.technicians.find(v=>v.id===d.technician);insist(i?.status==='confirmed'&&tech,'Confirmez d’abord l’incident.',409);insist(!st.incidents.some(v=>v.id!==i.id&&v.technician?.id===tech.id&&!['resolved','false_alarm'].includes(v.status)),'Technicien déjà en intervention.',409);insist(!i.electrical||d.safety===true,'Confirmez la mise en sécurité par le gestionnaire électrique.');i.technician=tech;i.status='assigned';i.events.push({at:now,label:LABELS[2]});notify(st,i,'Une équipe fibre a été affectée. Départ à venir.');audit(st,'dispatch',i.reference+' · '+tech.name);
 }else if(d.type==='advance'){
  const i=st.incidents.find(v=>v.id===d.id);insist(i,'Incident introuvable.',404);const step=STEPS.indexOf(i.status);insist(step>=0&&step<7&&step!==1,'Assignez une équipe ou choisissez un incident actif.',409);
  if(i.status==='verifying')insist(d.verified===true,'Le contrôle de la ligne doit être confirmé.');
  i.status=STEPS[step+1];if(i.status==='en_route')i.departed=now;if(i.status==='on_site')i.arrived=now;
  if(i.status==='resolved'){i.resolved=now;i.verification={source:'simulateur',at:now,online:true,mbps:100};}
  i.events.push({at:now,label:LABELS[step+1]});notify(st,i,i.status==='en_route'?'L’équipe est en route · arrivée dans environ 2 minutes.':LABELS[step+1]);audit(st,'incident.'+i.status,i.reference);
 }else if(d.type==='confirm-restored'){const i=st.incidents.find(v=>v.id===d.id);insist(i?.status==='resolved','Attendez le contrôle de rétablissement.',409);i.customerConfirmed=now;audit(st,'customer.restored',i.reference);
 }else if(d.type==='read'){for(const n of st.notifications)if(n.home===d.home)n.read=true;
 }else if(d.type==='reset'){usage.clear(s,uid);st=seed();st.version=d.version;
 }else insist(false,'Action inconnue.',404);
 if(d.type==='report')require('./noc-store.cjs').importReport(s,uid,st.incidents[0],{mode:'demo'});st.version++;put(s,uid,st);return snapshotFor(s,uid,st);
 });}
function reportReal(s,uid,d){insist(d.consent===true,'Consentement au partage de la photo et de la position requis.');s.rate('citizen:'+uid,5,86400000);const photo=validatePhoto(d.photo),rid=id();s.run('INSERT INTO citizen_reports(id,user_id,created,zone,description,photo,lat,lon) VALUES(?,?,?,?,?,?,?,?)',rid,uid,Date.now(),word(d.zone,'Zone',100),paragraph(d.description,'Description',500),photo,number(d.lat,'Latitude',-90,90,false),number(d.lon,'Longitude',-180,180,false));require('./noc-store.cjs').importReport(s,uid,s.get('SELECT * FROM citizen_reports WHERE id=?',rid));return {id:rid,notice:'Signalement transmis au support. Vous serez prévenu de sa prise en charge.'};}
function realReports(s,user){const staff=['admin','supervisor','agent'].includes(operator.role(s,user.id));return {reports:staff?s.all('SELECT * FROM citizen_reports ORDER BY created DESC LIMIT 100'):s.all('SELECT * FROM citizen_reports WHERE user_id=? ORDER BY created DESC LIMIT 30',user.id),staff};}
function respondReal(s,user,d,{withinTransaction=false}={}){operator.requireOperator(s,user.id);insist(['received','reviewing','resolved'].includes(d.status),'Statut invalide.');const response=paragraph(d.response,'Réponse',1000);const execute=()=>{const row=s.get('SELECT * FROM citizen_reports WHERE id=?',String(d.id||''));insist(row,'Signalement introuvable.',404);if(row.status===d.status&&row.response===response)return {ok:true};const noc=require('./noc-store.cjs');noc.importReport(s,row.user_id,row);s.run('UPDATE citizen_reports SET status=?,response=? WHERE id=?',d.status,response,row.id);noc.syncLocalReport(s,{...row,status:d.status,response},user.id);s.event(null,user.id,'citizen.response',row.id);return {ok:true};};return withinTransaction?execute():s.transaction(execute);}
// Remplace le texte d'une réponse de Guardian par sa version rédigée (mêmes faits, même action).
// « La photo qui parle » : la lecture des voyants (Claude ou téléphone) est croisée avec les mesures, puis ajoutée à la conversation.
// La photo elle-même n'est jamais conservée.
function boxPhoto(s,uid,d,reading){return s.transaction(()=>{const st=get(s,uid);insist(st,'Démarrez votre démonstration.',409);insist(d.version===st.version,'Le parcours a été actualisé. Réessayez.',409);
 const snap={...snapshot(st),sharedIncident:sharedFault(s,uid)},r=boxReading.interpret(reading,snap);
 const dioula=st.messages.filter(m=>m.role==='user').at(-1)?.lang==='dioula',voice=dioula&&r.verdict?langues.voice(langues.voiceKey({verdict:r.verdict})):null;
 st.messages.push({id:id(),role:'user',text:'Voici une photo de ma box.',photo:true},{id:id(),role:'assistant',text:r.message,facts:r.facts,action:r.action,verdict:r.verdict,concord:r.concord,...(voice?{voice}:{})});st.messages=st.messages.slice(-30);
 audit(st,'photo.read',(reading.source==='claude'?'Lecture Guardian':'Lecture sur le téléphone')+' · '+(r.verdict||'à reprendre')+' · photo non conservée');st.version++;put(s,uid,st);return snapshotFor(s,uid,st);});}
function refine(s,uid,messageId,text){const st=get(s,uid);if(!st)return null;const m=st.messages.find(x=>x.id===messageId&&x.role==='assistant');if(!m)return snapshotFor(s,uid,st);m.text=text;put(s,uid,st);return snapshotFor(s,uid,st);}
module.exports={migrate,seed,get,put,snapshot,snapshotFor,refine,boxPhoto,requestOtp,verifyOtp,act,reportReal,realReports,respondReal};
