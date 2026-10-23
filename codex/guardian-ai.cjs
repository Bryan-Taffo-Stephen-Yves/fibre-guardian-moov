'use strict';
// Guardian rédigé par Claude (Anthropic), côté serveur uniquement.
// Le moteur à règles décide toujours : faits vérifiés, action proposée, offre. Claude reformule
// seulement sa réponse pour l'abonné, sans pouvoir ajouter d'action ni de chiffre (garde-fous ci-dessous,
// portés de src/agent.js). Sans clé, en cas d'erreur, de délai ou de garde-fou non respecté,
// la réponse du moteur à règles est gardée telle quelle : l'abonné ne voit aucune différence.
// La clé est lue uniquement dans la variable d'environnement ANTHROPIC_API_KEY.
// Appel HTTP direct (fetch de Node 22) : codex/ doit fonctionner sans npm install.
const API='https://api.anthropic.com/v1/messages';
const MODEL=()=>process.env.ANTHROPIC_MODEL||'claude-opus-5-5';
const TIMEOUT_MS=Number(process.env.GUARDIAN_AI_TIMEOUT_MS)||8000; // Le navigateur abandonne à 12 s.
const PER_USER=20,PER_USER_MS=600000;   // 20 réponses rédigées par abonné toutes les 10 minutes.
const PER_DAY=400,DAY_MS=86400000;      // Plafond global de dépense : 400 réponses par jour.
const ACTIONS={reboot:'redémarrer la box à distance (bouton proposé sous la réponse)',upgrade:'passer au forfait supérieur (offre affichée sous la réponse, l’abonné peut refuser)',devices:'vérifier la liste des appareils connectés',qos:'donner la priorité à un appareil pendant 30 minutes (l’abonné confirme)',tracking:'suivre l’intervention du technicien'};
const FORBIDDEN=/simul|fictif|démo\b|\bLLM\b|modèle de langage|intelligence artificielle|\bIA\b|Claude|Anthropic|Alexa|Siri|ChatGPT|moteur à règles/i;

let transport=(url,init)=>fetch(url,init),injected=false;
function setTransport(fn){injected=!!fn;transport=fn||((url,init)=>fetch(url,init));}
// Pendant node --test, jamais d'appel réel (coût, réseau) : seuls les tests qui injectent un faux transport l'activent.
function available(){return process.env.GUARDIAN_AI!=='0'&&/^\S{20,}$/.test(process.env.ANTHROPIC_API_KEY||'')&&(injected||!process.env.NODE_TEST_CONTEXT);}

const plain=text=>String(text??'').replace(/(\d)[\s  ](?=\d{3}\b)/g,'$1');
const numbers=text=>(plain(text).match(/\d+(?:[.,]\d+)?/g)||[]).map(n=>n.replace(',','.'));
// Chaque nombre de la réponse doit déjà figurer dans la réponse du moteur, les faits ou les mesures.
function guard(text,sources){
 if(typeof text!=='string')return {ok:false,why:'réponse vide'};
 const reply=text.trim();
 if(reply.length<12||reply.length>700)return {ok:false,why:'longueur'};
 if(/[*#`_>|]|\n\s*[-•]/.test(reply))return {ok:false,why:'mise en forme'};
 if(FORBIDDEN.test(reply))return {ok:false,why:'vocabulaire interdit'};
 if(/\btu\b|\bton\b|\btes\b|\bta\b/i.test(reply))return {ok:false,why:'tutoiement'};
 const allowed=new Set(['0','1','2','3']);
 for(const n of numbers(sources.join(' '))){allowed.add(n);allowed.add(String(Math.round(+n)));}
 const bad=numbers(reply).filter(n=>!allowed.has(n)&&!allowed.has(String(+n)));
 if(bad.length)return {ok:false,why:'chiffre absent des mesures : '+bad.join(', ')};
 const sentences=reply.split(/[.!?…](?:\s|$)/).filter(s=>s.trim().length>2).length;
 if(sentences>5)return {ok:false,why:'réponse trop longue'};
 return {ok:true,text:reply};
}

function context({name,question,draft,facts,proof,action,snapshot,history,meaning}){
 const m=snapshot?.metrics||{},plan=snapshot?.plan||{};
 const devices=(snapshot?.devices||[]).filter(d=>!d.blocked).map(d=>d.name+' : '+d.mbps+' Mbps'+(d.limit?' (limité à '+d.limit+' Mbps)':''));
 const measures=['État de la connexion : '+(m.state||'inconnu'),'Débit disponible : '+(m.capacity??'inconnu')+' Mbps','Débit utilisé : '+(m.used??'inconnu')+' Mbps',m.latency!=null?'Latence : '+m.latency+' ms':'Latence : non mesurable','Appareils connectés : '+(m.connected??'inconnu')+' (habituellement '+(snapshot?.usual??'?')+')',plan.mbps?'Forfait : '+plan.name+', '+plan.mbps+' Mbps, '+plan.price+' FCFA par mois':'',devices.length?'Appareils : '+devices.join(' ; '):''].filter(Boolean);
 const lines=[...(facts||[]),...(proof?.measured||[])].map(f=>f.label+' : '+f.value);
 const past=(history||[]).slice(-6).map(x=>(x.role==='user'?'Abonné':'Guardian')+' : '+x.text);
 return {measures,lines,past,
  user:'Prénom de l’abonné : '+(name||'inconnu')+'\n\nMesures de sa box, à l’instant :\n'+measures.join('\n')+'\n\nPoints vérifiés :\n'+(lines.join('\n')||'aucun')+(past.length?'\n\nDébut de la conversation :\n'+past.join('\n'):'')+'\n\nAction proposée par Fibre Guardian : '+(ACTIONS[action]||'aucune, seulement expliquer')+'\n\nRéponse validée à reformuler :\n« '+draft+' »\n\nMessage de l’abonné :\n« '+question+' »'+(meaning&&meaning.lang!=='fr'?'\n(écrit en '+meaning.lang+' ; sens : « '+meaning.french+' ». Réponds en français simple, sans te moquer de sa façon de parler.)':'')};
}

const SYSTEM='Tu es Guardian, l’assistant de Moov Africa Côte d’Ivoire pour les abonnés à la fibre. Tu parles à un abonné qui n’est pas technicien.\n'+
 'Ta tâche : reformuler la « réponse validée » pour qu’elle réponde directement au message de l’abonné, de façon chaleureuse et claire. Le fond de la réponse validée est décidé par Fibre Guardian : tu ne le changes pas.\n'+
 'Règles strictes :\n'+
 '1. Français simple, vouvoiement, 2 à 4 phrases courtes, sans liste, sans titre, sans emoji, sans mise en forme.\n'+
 '2. Garde le même conseil et la même action que la réponse validée. N’ajoute aucune autre action, offre, promesse, délai ou remboursement.\n'+
 '3. N’utilise aucun chiffre qui ne figure pas dans les mesures, les points vérifiés ou la réponse validée. Écris les unités en entier si besoin (Mbps, FCFA, minutes).\n'+
 '4. Explique un mot technique en quelques mots s’il est indispensable.\n'+
 '5. Ne parle jamais de toi comme d’une intelligence artificielle ou d’un programme, et ne cite aucune marque d’assistant.\n'+
 '6. Si la réponse validée dit qu’une cause n’est pas encore prouvée, garde exactement cette prudence et le test proposé : ne présente jamais une supposition comme une certitude.\n'+
 '7. Si le message de l’abonné est hors sujet, réponds en une phrase aimable puis reviens à sa connexion avec la réponse validée.\n'+
 'Réponds uniquement par le texte destiné à l’abonné.';

function budget(store,uid){
 if(!store)return true;
 try{store.rate('guardian-ai:'+uid,PER_USER,PER_USER_MS);store.rate('guardian-ai:jour',PER_DAY,DAY_MS);return true;}catch{return false;}
}

// Appel commun à l'API Messages. Renvoie le message reçu, ou null (erreur, délai, refus) : l'appelant garde alors sa réponse sans Claude.
async function send(body,{timeoutMs=TIMEOUT_MS,log,what}){
 try{
  const res=await transport(API,{method:'POST',signal:AbortSignal.timeout(timeoutMs),headers:{'content-type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','anthropic-beta':'server-side-fallback-2026-07-01'},body:JSON.stringify({model:MODEL(),fallbacks:'default',...body})});
  if(!res.ok){log('Guardian : '+what+' refusée ('+res.status+'), réponse sans Claude gardée.');return null;}
  const msg=await res.json();
  if(msg.stop_reason==='refusal'||msg.stop_reason==='max_tokens')return null;
  return msg;
 }catch(e){log('Guardian : Claude indisponible pour '+what+' ('+(e.name==='TimeoutError'?'délai dépassé':e.message)+'), réponse sans Claude gardée.');return null;}
}
const text=msg=>(msg?.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim();
function json(msg){try{return JSON.parse(text(msg));}catch{return null;}}

// Comprendre le nouchi, le dioula ou un français très familier : le sens en français simple sert au moteur à règles.
const UNDERSTAND='Tu aides Guardian, l’assistant fibre de Moov Africa Côte d’Ivoire, à comprendre les messages des abonnés. Ils écrivent en français, en nouchi (argot ivoirien) ou en dioula, parfois mélangés.\n'+
 'Donne la langue principale du message et son sens en français standard simple, en une ou deux phrases courtes, à la première personne comme si l’abonné parlait. Garde les chiffres tels quels, n’ajoute rien qui ne soit pas dans le message. Si le message est déjà en français standard, recopie-le.';
const UNDERSTAND_SCHEMA={type:'object',properties:{lang:{type:'string',enum:['fr','nouchi','dioula','autre']},french:{type:'string'}},required:['lang','french'],additionalProperties:false};
async function understand(message,{store,uid,log=()=>{},timeoutMs=4500}={}){
 if(!available()||!message)return null;
 if(!budget(store,uid))return null;
 const msg=await send({max_tokens:600,output_config:{effort:'low',format:{type:'json_schema',schema:UNDERSTAND_SCHEMA}},system:UNDERSTAND,messages:[{role:'user',content:'Message de l’abonné : « '+String(message).slice(0,1200)+' »'}]},{timeoutMs,log,what:'la compréhension du message'});
 const r=json(msg);
 if(!r||!['fr','nouchi','dioula','autre'].includes(r.lang)||typeof r.french!=='string')return null;
 const french=r.french.trim();
 if(french.length<2||french.length>300||/[*#`|]/.test(french)||FORBIDDEN.test(french))return null;
 return {lang:r.lang,french};
}

// Lire les voyants d'une box fibre sur une photo. Claude décrit seulement ce qu'il voit ; l'interprétation,
// croisée avec les mesures de la box et l'état du quartier, reste faite par des règles (box-reading.cjs).
const LEDS='Tu lis la photo de la face avant d’une box fibre (ONT ou routeur GPON, par exemple Huawei, ZTE, Nokia, Sagemcom) envoyée par un abonné de Moov Africa Côte d’Ivoire.\n'+
 'Décris uniquement les voyants que tu vois réellement, avec leur nom imprimé quand il est lisible : Power ou PWR (alimentation), PON ou GPON (signal fibre), LOS (perte du signal fibre), Internet ou WAN, Wi-Fi ou WLAN, LAN ou ETH, TEL ou Phone, WPS. Pour chacun : allumé, éteint ou clignotant (flou de mouvement ou halo partiel), et sa couleur.\n'+
 'Si la photo est floue, trop sombre, ne montre pas une box ou ne montre qu’une partie des voyants, dis-le avec le champ quality et is_box. N’invente jamais un voyant que tu ne vois pas. model : marque et modèle s’ils sont lisibles, sinon chaîne vide.';
const LED_SCHEMA={type:'object',properties:{
 is_box:{type:'boolean'},quality:{type:'string',enum:['bonne','floue','sombre','partielle']},model:{type:'string'},
 leds:{type:'array',items:{type:'object',properties:{name:{type:'string',enum:['power','pon','los','internet','wifi','lan','phone','wps','autre']},state:{type:'string',enum:['allume','eteint','clignote','inconnu']},color:{type:'string',enum:['vert','rouge','orange','bleu','blanc','aucune','inconnue']}},required:['name','state','color'],additionalProperties:false}}
},required:['is_box','quality','model','leds'],additionalProperties:false};
async function readLeds(image,{store,uid,log=()=>{},timeoutMs=9000}={}){
 if(!available())return null;
 const m=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(image||''));if(!m)return null;
 if(!budget(store,uid))return null;
 const msg=await send({max_tokens:1500,output_config:{effort:'low',format:{type:'json_schema',schema:LED_SCHEMA}},system:LEDS,messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:m[1],data:m[2]}},{type:'text',text:'Voici la photo de ma box. Quels voyants vois-tu ?'}]}]},{timeoutMs,log,what:'la lecture de la photo'});
 const r=json(msg);
 if(!r||typeof r.is_box!=='boolean'||!Array.isArray(r.leds))return null;
 return {isBox:r.is_box,quality:r.quality,model:String(r.model||'').slice(0,60),leds:r.leds.slice(0,12).filter(l=>l&&typeof l.name==='string').map(l=>({name:l.name,state:l.state,color:l.color}))};
}

// Guardian Superviseur (équipe Moov) : répondre à une question sur tout le réseau, à partir de l'état que l'agent voit.
// Mêmes garde-fous que pour les clients : aucun chiffre absent de l'état, pas de mise en forme, 5 phrases au plus.
const SUPERVISE='Tu es Guardian Superviseur, l’agent qui surveille tout le réseau fibre de Moov Africa Côte d’Ivoire pour l’équipe technique de Moov (superviseurs, support, direction).\n'+
 'On te donne l’état complet du réseau à l’instant, vu par les autres agents (détection des pannes, plans d’intervention, mesures du Labo, équipes terrain, serveur vocal, WhatsApp, prévisions), puis la question d’un membre de l’équipe et une réponse préparée.\n'+
 'Règles strictes :\n'+
 '1. Français simple et direct, vouvoiement, 2 à 4 phrases courtes, moins de 600 caractères, sans liste, sans titre, sans emoji, sans mise en forme.\n'+
 '2. Donne d’abord la réponse, puis la cause probable et l’action que tu conseilles. Tu ne déclenches jamais rien toi-même : un responsable valide.\n'+
 '3. N’utilise que des faits et des chiffres présents dans l’état. Si l’état ne permet pas de répondre, dis-le et reprends la réponse préparée.\n'+
 '4. Ne parle jamais de toi comme d’une intelligence artificielle ou d’un programme, et ne cite aucune marque d’assistant.\n'+
 'Réponds uniquement par le texte destiné à l’équipe.';
async function supervise({question,draft,etat},{store,uid,log=()=>{},timeoutMs=TIMEOUT_MS}={}){
 if(!available()||!question||!draft)return null;
 if(!budget(store,uid))return null;
 const msg=await send({max_tokens:2000,output_config:{effort:'low'},system:SUPERVISE,messages:[{role:'user',content:'État du réseau :\n'+etat.join('\n')+'\n\nRéponse préparée :\n« '+draft+' »\n\nQuestion de l’équipe :\n« '+question+' »'}]},{timeoutMs,log,what:'la réponse du superviseur'});
 if(!msg)return null;
 const g=guard(text(msg),[draft,...etat]);
 if(!g.ok){log('Guardian Superviseur : garde-fou ('+g.why+'), réponse préparée gardée.');return null;}
 return g.text;
}

// Renvoie le texte rédigé, ou null pour garder la réponse du moteur à règles.
async function rephrase(input,{store,uid,log=()=>{},timeoutMs=TIMEOUT_MS}={}){
 if(!available()||!input?.draft||!input?.question)return null;
 if(!budget(store,uid))return null;
 const c=context(input);
 try{
  const res=await transport(API,{method:'POST',signal:AbortSignal.timeout(timeoutMs),headers:{'content-type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','anthropic-beta':'server-side-fallback-2026-07-01'},
   body:JSON.stringify({model:MODEL(),max_tokens:2000,output_config:{effort:'low'},system:SYSTEM,messages:[{role:'user',content:c.user}],fallbacks:'default'})});
  if(!res.ok){log('Guardian : réponse Claude refusée ('+res.status+'), réponse du moteur gardée.');return null;}
  const msg=await res.json();
  if(msg.stop_reason==='refusal'||msg.stop_reason==='max_tokens')return null;
  const text=(msg.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim();
  const g=guard(text,[input.draft,...c.measures,...c.lines]);
  // Une supposition reste une supposition : Claude ne doit pas effacer le « je ne peux pas encore conclure ».
  if(g.ok&&/pas encore (conclure|le prouver)/.test(input.draft)&&!/conclu|prouv|certain|sûr|vérifi|test/i.test(text)){log('Guardian : garde-fou (prudence effacée), réponse du moteur gardée.');return null;}
  if(!g.ok){log('Guardian : garde-fou ('+g.why+'), réponse du moteur gardée.');return null;}
  return g.text;
 }catch(e){log('Guardian : Claude indisponible ('+(e.name==='TimeoutError'?'délai dépassé':e.message)+'), réponse du moteur gardée.');return null;}
}

module.exports={available,rephrase,understand,readLeds,supervise,guard,setTransport,SYSTEM,SUPERVISE};
