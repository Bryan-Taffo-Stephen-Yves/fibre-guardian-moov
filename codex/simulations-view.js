/* « Simulations » dans la Régie de l'équipe Moov (?section=regie, réservée à l'administrateur).
   L'administrateur choisit un client (Awa par défaut) et lance une situation en un geste. Le serveur (simulations.cjs)
   la joue sur le compte de ce client : son téléphone reçoit les messages de Guardian (bandeau, « Mes messages »,
   notification du téléphone) et c'est lui qui répond (« C'est à moi », paiement Moov Money…), comme en vrai.
   Ce panneau suit la scène en direct (relecture toutes les 2 secondes). */
(function(){
 'use strict';
 const h=React.createElement,{useState:S,useEffect:E,useRef:R}=React;
 const Icon=({name,size=22})=>window.FGIcones&&FGIcones.has(name)?h(FGIcones.Icon,{name,size}):null;
 const fcfa=n=>Number(n||0).toLocaleString('fr-FR')+' FCFA';
 const mmss=s=>Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
 // [clé, titre, ce que le client va vivre, icône, teinte]
 const SCENES=[
  ['foule','Plusieurs personnes sur son Wi-Fi','Quatre appareils se connectent en une minute. Guardian écrit au client à chaque arrivée.','devices','primary'],
  ['urgent','Alerte urgente','Un appareil inconnu arrive. Sans réponse du client en une minute, Guardian le bloque.','bell','danger'],
  ['conso','Un appareil consomme beaucoup','La console télécharge un jeu de 40 Go. Guardian prévient et propose un forfait plus rapide, à payer avec Moov Money.','gauge','accent'],
  ['sature','La fibre est occupée dans le quartier','Trop de foyers connectés en même temps : le débit du client baisse quelques minutes.','up','warning'],
  ['panne','Panne et technicien','Un câble est coupé. Le client suit le technicien jusqu’à la réparation, étape par étape.','alert','danger'],
  ['voisin','Coupure dans un quartier voisin','Guardian prévient le client que son débit peut baisser.','map','primary'],
  ['box','Box éteinte chez le client','Le quartier va bien, mais sa box ne répond plus. Guardian lui dit de vérifier la prise et le courant.','home','warning'],
  ['facture','Facture pas encore payée','Guardian rappelle la facture du mois, puis propose de la payer en 2 ou 3 fois, sans frais.','wallet','accent'],
  ['suspendue','Ligne suspendue (facture impayée)','Internet du client est suspendu. Il paie avec Moov Money, ou en plusieurs fois : internet revient tout de suite.','wallet','danger'],
  ['vol','Câble volé sur le poteau','Une voisine envoie la photo du poteau. Yao sécurise le poteau, remplace le câble, et le client suit chaque étape.','shield','danger'],
  ['chambre','Wi-Fi faible dans une chambre','La fibre va bien, mais la tablette de la chambre capte mal. Guardian explique où mettre la box.','guardian','warning'],
  ['recurrente','Panne qui revient','La 3e coupure en 30 jours dans son quartier : son dossier devient prioritaire et un conseiller doit l’appeler sous 2 h.','alert','danger'],
  ['retard','Technicien en retard','Le technicien Koffi est bloqué sur la route. Guardian prévient le client, puis Yao prend le relais.','user','warning'],
  ['arnaque','Message d’arnaque','Un faux SMS « Moov » demande le code Moov Money. Guardian prévient le client de ne jamais le donner.','sms','danger'],
 ];
 const TITLE=Object.fromEntries(SCENES.map(s=>[s[0],s[1]]));
 const PANNE=[['confirmed','Panne confirmée'],['assigned','Technicien choisi'],['en_route','En route'],['on_site','Sur place'],['repairing','Réparation'],['verifying','Vérification'],['resolved','Internet revenu']];

 function Live({st,stop,busy}){
  const [now,N]=S(Date.now()),read=R(Date.now());
  E(()=>{read.current=Date.now();},[st]);
  E(()=>{if(!st.urgent&&!st.busy&&!st.box)return;const t=setInterval(()=>N(Date.now()),1000);return()=>clearInterval(t);},[!!st.urgent,!!st.busy,!!st.box]);
  const drift=Math.max(0,Math.floor((now-read.current)/1000)),left=st.urgent?Math.max(0,st.urgent.left-drift):0,busyLeft=st.busy?Math.max(0,st.busy.left-drift):0;
  const at=st.panne?PANNE.findIndex(p=>p[0]===st.panne.status):['panne','vol','retard'].includes(st.scene)?PANNE.length-1:-1;
  return h('section',{className:'sim-live','aria-live':'polite'},
   h('div',{className:'sim-live-head'},h('span',{className:'sim-pulse','aria-hidden':true}),h('div',null,h('small',null,'EN COURS CHEZ '+String(st.client||'le client').toUpperCase()),h('h2',null,TITLE[st.scene]||'Simulation'))),
   st.urgent&&h('div',{className:'sim-urgent'+(left<=10?' is-late':'')},
    h('div',{className:'sim-count',role:'timer','aria-label':left+' secondes avant le blocage'},h('strong',null,left),h('small',null,'s')),
    h('div',null,h('p',null,h('b',null,st.urgent.name)),h('p',null,'Le client peut répondre « C’est à moi » ou « Bloquer » dans Appareils. Sinon, Guardian le bloque à la fin du compte à rebours.'))),
   st.blocked.map(d=>h('div',{key:d.id,className:'sim-note is-done'},h(Icon,{name:'shield',size:20}),h('p',null,h('b',null,'Guardian a bloqué « '+d.name+' ». '),'Le client n’a pas répondu à temps.'))),
   st.guests>0&&h('div',{className:'sim-note'},h(Icon,{name:'devices',size:20}),h('p',null,h('b',null,st.guests+' appareil'+(st.guests>1?'s':'')+' arrivé'+(st.guests>1?'s':'')+'. '),st.pending>0?'D’autres arrivent…':'Guardian a écrit pour chacun.')),
   st.panne?.late&&h('div',{className:'sim-note is-warn'},h(Icon,{name:'user',size:20}),h('p',null,h('b',null,st.panne.swapped?'Changement de technicien. ':'Le technicien a du retard. '),st.panne.swapped?(st.panne.technician||'Un autre technicien')+' a pris le relais.':'Guardian a prévenu le client.')),
   st.boxBack&&h('div',{className:'sim-note is-done'},h(Icon,{name:'home',size:20}),h('p',null,h('b',null,'Box revenue. '),'Le client a reçu « Votre box est revenue ». Vous pouvez arrêter la simulation.')),
   st.box&&h('div',{className:'sim-note is-warn'},h(Icon,{name:'home',size:20}),h('p',null,h('b',null,'Box du client éteinte. '),'Le courant revient dans '+mmss(Math.max(0,st.box.left-drift))+'.')),
   st.busy&&h('div',{className:'sim-note is-warn'},h(Icon,{name:'up',size:20}),h('p',null,h('b',null,'Débit du client réduit. '),'Retour à la normale dans '+mmss(busyLeft)+'.')),
   at>=0&&h('ol',{className:'sim-steps','aria-label':'Étapes de la réparation'},PANNE.map(([k,label],n)=>h('li',{key:k,className:n<at||(n===at&&k==='resolved')?'is-done':n===at?'is-now':''},h('span',{'aria-hidden':true}),h('b',null,label),n===1&&st.panne?.technician&&n<=at&&h('small',null,st.panne.technician)))),
   st.upgrade&&h('div',{className:'sim-offer'},h('div',null,h('small',null,'OFFRE ENVOYÉE PAR GUARDIAN'),h('p',null,h('b',null,st.upgrade.from.mbps+' → '+st.upgrade.to.mbps+' Mb/s')),h('p',null,fcfa(st.upgrade.amount)+' pour la fin du mois. Le client paie avec Moov Money depuis la conversation avec Guardian.'))),
   st.paid&&h('div',{className:'sim-note is-done'},h(Icon,{name:'wallet',size:20}),h('p',null,h('b',null,'Paiement reçu : '+fcfa(st.paid.amount)+'. '),'Forfait du client : '+st.paid.mbps+' Mb/s.')),
   h('div',{className:'sim-row sim-live-actions'},h('button',{type:'button',className:'sim-btn is-ghost',disabled:busy,onClick:stop},'Arrêter la simulation')));
 }

 function Panel({api}){
  const [data,D]=S(null),[client,C]=S(''),[busy,B]=S(''),[error,X]=S('');
  const alive=R(true);E(()=>()=>{alive.current=false;},[]);
  async function load(id=client){try{const r=await api('/regie/simulation'+(id?'?client='+encodeURIComponent(id):''));if(!alive.current)return;D(r);if(!id&&r.client)C(r.client);X('');}catch(e){if(alive.current)X(e.message);}}
  E(()=>{load(client);const t=setInterval(()=>load(client),2000);return()=>clearInterval(t);},[client]);
  async function run(scene){if(busy||!client)return;B(scene);X('');try{const r=await api('/regie/simulation','POST',{scene,client});D(r);}catch(e){X(e.message);}finally{B('');}}
  const st=data?.status||{scene:null,blocked:[]};
  return h('section',{id:'simulations',className:'jy-card sim-panel'},
   h('p',{className:'jy-kicker'},'SIMULATIONS'),h('h2',null,'Faire vivre une situation à un client'),
   h('p',null,'Choisissez le client, puis lancez une situation. Son téléphone reçoit les messages de Guardian comme en vrai, et c’est lui qui répond.'),
   data?.clients?.length>0&&h('label',{className:'jy-field'},h('span',null,'Client'),h('select',{value:client,onChange:e=>C(e.currentTarget.value)},data.clients.map(c=>h('option',{key:c.id,value:c.id},c.name)))),
   st.scene&&h(Live,{st:{...st,client:data?.clients?.find(c=>c.id===client)?.name},busy:!!busy,stop:()=>run('stop')}),
   h('ul',{className:'sim-grid'},SCENES.map(([k,title,text,icon,tone])=>h('li',{key:k},
    h('button',{type:'button',className:'sim-card tone-'+tone+(st.scene===k?' is-on':''),disabled:!!busy||!client,'aria-pressed':st.scene===k,onClick:()=>run(k)},
     h('span',{className:'sim-ico'},h(Icon,{name:icon,size:24})),h('span',{className:'sim-txt'},h('strong',null,title),h('small',null,text)),h('span',{className:'sim-go'},busy===k?'En cours…':st.scene===k?'Rejouer':'Lancer'))))),
   error&&h('p',{className:'jy-error',role:'alert'},error),
   h('small',null,'Pour les notifications application fermée, le client active « Alertes sur ce téléphone » dans Mon compte.'));
 }
 window.FGSimulations={Panel,SCENES};
})();
