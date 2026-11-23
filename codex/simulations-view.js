/* Page « Simulations » (?section=simulations, ouverte depuis le badge « Démo ») : six situations à rejouer en un geste.
   Chaque bouton appelle POST /api/journey/simulation ; le serveur (simulations.cjs) joue la scène sur le compte du client
   lui-même. Les messages arrivent dans « Mes messages », en bandeau et en notification du téléphone, comme en vrai.
   La carte « En cours » suit la scène en direct (l'application relit l'état toutes les 3 secondes). */
(function(){
 'use strict';
 const h=React.createElement,{useState:S,useEffect:E}=React;
 const Icon=({name,size=22})=>window.FGIcones&&FGIcones.has(name)?h(FGIcones.Icon,{name,size}):null;
 const fcfa=n=>Number(n||0).toLocaleString('fr-FR')+' FCFA';
 const mmss=s=>Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
 // [clé, titre, ce que la personne va voir, icône, teinte]
 const SCENES=[
  ['foule','Plusieurs personnes sur votre Wi-Fi','Quatre appareils se connectent en une minute. Guardian vous écrit à chaque arrivée.','devices','primary'],
  ['urgent','Alerte urgente','Un appareil inconnu arrive. Sans réponse de votre part en une minute, Guardian le bloque.','alert','danger'],
  ['conso','Un appareil consomme beaucoup','La console télécharge 40 Go. Guardian prévient et propose un forfait plus rapide, à payer avec Moov Money.','gauge','accent'],
  ['sature','La fibre est occupée dans le quartier','Trop de foyers connectés en même temps : le débit baisse quelques minutes.','up','warning'],
  ['panne','Panne et technicien','Un câble est coupé. Suivez le technicien jusqu’à la réparation, étape par étape.','shield','danger'],
  ['voisin','Coupure dans un quartier voisin','Guardian vous prévient que le débit peut baisser chez vous.','map','primary'],
 ];
 const TITLE=Object.fromEntries(SCENES.map(s=>[s[0],s[1]]));
 const PANNE=[['confirmed','Panne confirmée'],['assigned','Technicien choisi'],['en_route','En route'],['on_site','Sur place'],['repairing','Réparation'],['verifying','Vérification'],['resolved','Internet revenu']];

 // Le compte à rebours de l'alerte urgente avance chaque seconde entre deux relectures de l'état.
 function useNow(on){const [now,N]=S(Date.now());E(()=>{if(!on)return;const t=setInterval(()=>N(Date.now()),1000);return()=>clearInterval(t);},[on]);return now;}

 function Live({st,state,busy,onDevice,onPay,go,onStop}){
  const read=useNow(!!(st.urgent||st.busy)),drift=Math.floor((read-(state.metrics?.at||read))/1000);
  const left=st.urgent?Math.max(0,st.urgent.left-drift):0,busyLeft=st.busy?Math.max(0,st.busy.left-drift):0;
  const panne=(state.incidents||[]).find(i=>i.sim),at=panne?PANNE.findIndex(p=>p[0]===panne.status):-1;
  const unknown=(state.devices||[]).filter(d=>d.sim&&!d.recognized&&!d.blocked&&!d.urgentUntil);
  return h('section',{className:'sim-live','aria-live':'polite'},
   h('div',{className:'sim-live-head'},h('span',{className:'sim-pulse','aria-hidden':true}),h('div',null,h('small',null,'EN COURS'),h('h2',null,TITLE[st.scene]||'Simulation'))),
   st.urgent&&h('div',{className:'sim-urgent'+(left<=10?' is-late':'')},
    h('div',{className:'sim-count',role:'timer','aria-label':left+' secondes pour répondre'},h('strong',null,left),h('small',null,'s')),
    h('div',null,h('p',null,h('b',null,st.urgent.name)),h('p',null,'Répondez avant la fin du compte à rebours. Sinon, Guardian le bloque pour vous.')),
     h('div',{className:'sim-row sim-urgent-actions'},h('button',{type:'button',className:'sim-btn',disabled:busy,onClick:()=>onDevice(st.urgent.id,'recognize')},'C’est à moi'),h('button',{type:'button',className:'sim-btn is-danger',disabled:busy,onClick:()=>onDevice(st.urgent.id,'block')},'Bloquer'))),
   st.blocked.map(d=>h('div',{key:d.id,className:'sim-note is-done'},h(Icon,{name:'shield',size:20}),h('p',null,h('b',null,'Guardian a bloqué « '+d.name+' ». '),'Vous n’avez pas répondu à temps.'),h('button',{type:'button',className:'sim-link',disabled:busy,onClick:()=>onDevice(d.id,'unblock')},'Débloquer'))),
   unknown.length>0&&h('div',{className:'sim-note'},h(Icon,{name:'devices',size:20}),h('p',null,h('b',null,unknown.length+' appareil'+(unknown.length>1?'s':'')+' à reconnaître. '),'Guardian vous a écrit pour chacun.'),h('button',{type:'button',className:'sim-link',onClick:()=>go('devices')},'Voir')),
   st.pending>0&&st.scene==='foule'&&h('p',{className:'sim-wait'},'D’autres appareils arrivent…'),
   st.busy&&h('div',{className:'sim-note is-warn'},h(Icon,{name:'up',size:20}),h('p',null,h('b',null,'Débit réduit à '+state.metrics.capacity+' Mb/s. '),'Retour à la normale dans '+mmss(busyLeft)+'.')),
   panne&&h('ol',{className:'sim-steps','aria-label':'Étapes de la réparation'},PANNE.map(([k,label],n)=>h('li',{key:k,className:n<at?'is-done':n===at?'is-now':''},h('span',{'aria-hidden':true}),h('b',null,label),n===1&&panne.technician&&n<=at&&h('small',null,panne.technician.name)))),
   st.upgrade&&h('div',{className:'sim-offer'},h('div',null,h('small',null,'PROPOSITION DE GUARDIAN'),h('p',null,h('b',null,st.upgrade.from.mbps+' → '+st.upgrade.to.mbps+' Mb/s')),h('p',null,fcfa(st.upgrade.amount)+' pour la fin du mois, puis '+fcfa(st.upgrade.to.price)+' par mois.')),
    h('button',{type:'button',className:'sim-btn is-accent',disabled:busy,onClick:()=>onPay(st.upgrade)},'Payer avec Moov Money')),
   state.payment?.at>=st.at&&st.scene==='conso'&&h('div',{className:'sim-note is-done'},h(Icon,{name:'wallet',size:20}),h('p',null,h('b',null,'Paiement reçu : '+fcfa(state.payment.amount)+'. '),'Votre forfait est passé à '+state.plan.mbps+' Mb/s.')),
   h('div',{className:'sim-row sim-live-actions'},h('button',{type:'button',className:'sim-btn is-ghost',onClick:()=>go('notifications')},'Mes messages'),h('button',{type:'button',className:'sim-btn is-ghost',onClick:()=>go('guardian')},'Parler à Guardian'),h('button',{type:'button',className:'sim-link',disabled:busy,onClick:onStop},'Tout remettre comme avant')));
 }

 function View({state,busy,onRun,onDevice,onPay,go,scenarios,onScenario}){
  if(!state)return h('p',{className:'j-loading',role:'status'},'Chargement…');
  const st=state.simulation||{scene:null,blocked:[]};
  return h('div',{className:'sim-page'},
   h('header',{className:'sim-head'},h('h1',null,'Simulations'),h('p',null,'Rejouez en un geste ce que Guardian sait gérer. Tout se passe sur votre compte : les messages arrivent comme en vrai, sur cette page et sur votre téléphone.')),
   st.scene&&h(Live,{st,state,busy,onDevice,onPay,go,onStop:()=>onRun('stop')}),
   h('ul',{className:'sim-grid'},SCENES.map(([k,title,text,icon,tone])=>h('li',{key:k},
    h('button',{type:'button',className:'sim-card tone-'+tone+(st.scene===k?' is-on':''),disabled:busy,'aria-pressed':st.scene===k,onClick:()=>{onRun(k);requestAnimationFrame(()=>scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}));}},
     h('span',{className:'sim-ico'},h(Icon,{name:icon,size:24})),h('span',{className:'sim-txt'},h('strong',null,title),h('small',null,text)),h('span',{className:'sim-go'},st.scene===k?'Rejouer':'Lancer'))))),
   // Les cinq états de la box déjà connus (« La fibre faiblit », « Débit réduit »…) : ils restent ici, en plus petit.
   scenarios&&h('section',{className:'sim-box'},h('h2',null,'L’état de votre box'),h('p',null,'Changez l’état de la box, puis regardez l’accueil.'),
    h('div',{className:'sim-chips'},Object.entries(scenarios).map(([v,label])=>h('button',{type:'button',key:v,className:'sim-chip'+(state.scenario===v?' is-on':''),'aria-pressed':state.scenario===v,disabled:busy,onClick:()=>onScenario(v)},label)))),
   h('p',{className:'sim-foot'},'Pour recevoir les alertes même quand l’application est fermée, activez « Alertes sur ce téléphone » dans Mon compte.'));
 }
 window.FGSimulations={View,SCENES};
})();
