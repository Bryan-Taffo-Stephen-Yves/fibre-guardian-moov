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

function context({name,question,draft,facts,action,snapshot,history}){
 const m=snapshot?.metrics||{},plan=snapshot?.plan||{};
 const devices=(snapshot?.devices||[]).filter(d=>!d.blocked).map(d=>d.name+' : '+d.mbps+' Mbps'+(d.limit?' (limité à '+d.limit+' Mbps)':''));
 const measures=['État de la connexion : '+(m.state||'inconnu'),'Débit disponible : '+(m.capacity??'inconnu')+' Mbps','Débit utilisé : '+(m.used??'inconnu')+' Mbps',m.latency!=null?'Latence : '+m.latency+' ms':'Latence : non mesurable','Appareils connectés : '+(m.connected??'inconnu')+' (habituellement '+(snapshot?.usual??'?')+')',plan.mbps?'Forfait : '+plan.name+', '+plan.mbps+' Mbps, '+plan.price+' FCFA par mois':'',devices.length?'Appareils : '+devices.join(' ; '):''].filter(Boolean);
 const lines=(facts||[]).map(f=>f.label+' : '+f.value);
 const past=(history||[]).slice(-6).map(x=>(x.role==='user'?'Abonné':'Guardian')+' : '+x.text);
 return {measures,lines,past,
  user:'Prénom de l’abonné : '+(name||'inconnu')+'\n\nMesures de sa box, à l’instant :\n'+measures.join('\n')+'\n\nPoints vérifiés :\n'+(lines.join('\n')||'aucun')+(past.length?'\n\nDébut de la conversation :\n'+past.join('\n'):'')+'\n\nAction proposée par Fibre Guardian : '+(ACTIONS[action]||'aucune, seulement expliquer')+'\n\nRéponse validée à reformuler :\n« '+draft+' »\n\nMessage de l’abonné :\n« '+question+' »'};
}

const SYSTEM='Tu es Guardian, l’assistant de Moov Africa Côte d’Ivoire pour les abonnés à la fibre. Tu parles à un abonné qui n’est pas technicien.\n'+
 'Ta tâche : reformuler la « réponse validée » pour qu’elle réponde directement au message de l’abonné, de façon chaleureuse et claire. Le fond de la réponse validée est décidé par Fibre Guardian : tu ne le changes pas.\n'+
 'Règles strictes :\n'+
 '1. Français simple, vouvoiement, 2 à 4 phrases courtes, sans liste, sans titre, sans emoji, sans mise en forme.\n'+
 '2. Garde le même conseil et la même action que la réponse validée. N’ajoute aucune autre action, offre, promesse, délai ou remboursement.\n'+
 '3. N’utilise aucun chiffre qui ne figure pas dans les mesures, les points vérifiés ou la réponse validée. Écris les unités en entier si besoin (Mbps, FCFA, minutes).\n'+
 '4. Explique un mot technique en quelques mots s’il est indispensable.\n'+
 '5. Ne parle jamais de toi comme d’une intelligence artificielle ou d’un programme, et ne cite aucune marque d’assistant.\n'+
 '6. Si le message de l’abonné est hors sujet, réponds en une phrase aimable puis reviens à sa connexion avec la réponse validée.\n'+
 'Réponds uniquement par le texte destiné à l’abonné.';

function budget(store,uid){
 if(!store)return true;
 try{store.rate('guardian-ai:'+uid,PER_USER,PER_USER_MS);store.rate('guardian-ai:jour',PER_DAY,DAY_MS);return true;}catch{return false;}
}

// Renvoie le texte rédigé, ou null pour garder la réponse du moteur à règles.
async function rephrase(input,{store,uid,log=()=>{}}={}){
 if(!available()||!input?.draft||!input?.question)return null;
 if(!budget(store,uid))return null;
 const c=context(input);
 try{
  const res=await transport(API,{method:'POST',signal:AbortSignal.timeout(TIMEOUT_MS),headers:{'content-type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','anthropic-beta':'server-side-fallback-2026-07-01'},
   body:JSON.stringify({model:MODEL(),max_tokens:2000,output_config:{effort:'low'},system:SYSTEM,messages:[{role:'user',content:c.user}],fallbacks:'default'})});
  if(!res.ok){log('Guardian : réponse Claude refusée ('+res.status+'), réponse du moteur gardée.');return null;}
  const msg=await res.json();
  if(msg.stop_reason==='refusal'||msg.stop_reason==='max_tokens')return null;
  const text=(msg.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim();
  const g=guard(text,[input.draft,...c.measures,...c.lines]);
  if(!g.ok){log('Guardian : garde-fou ('+g.why+'), réponse du moteur gardée.');return null;}
  return g.text;
 }catch(e){log('Guardian : Claude indisponible ('+(e.name==='TimeoutError'?'délai dépassé':e.message)+'), réponse du moteur gardée.');return null;}
}

module.exports={available,rephrase,guard,setTransport,SYSTEM};
