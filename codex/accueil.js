/* Accueil client, simple comme pour un enfant.
   1. Un grand voyant : vert, ça marche ; orange, c'est lent ; rouge, panne. Une phrase, un bouton.
   2. Quatre gros boutons avec un dessin : parler, tester, signaler, appeler.
   3. Deux cartes au plus, seulement si elles concernent le client maintenant.
   Les offres, la fidélité et le parrainage vivent dans « Mon compte ». */
(function(){
 'use strict';
 const h=React.createElement;
 const P={
  check:'M5 12.5 10 17.5 19 7',
  slow:'M12 13 16 9M4.5 17a8 8 0 1 1 15 0',
  down:'M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19h.01M3 3l18 18',
  refresh:'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  box:'M3 14h18v5H3zM7 16.5h.01M11 16.5h.01M8 14l-2-8M16 14l2-8',
  truck:'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
  mic:'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3M5 11a7 7 0 0 0 14 0M12 18v3',
  gauge:'M4.5 17a8 8 0 1 1 15 0M12 13l4-4',
  alert:'M12 4 2.5 20h19zM12 10v4.5M12 17.5h.01',
  phone:'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1',
  devices:'M3 5h13v9H3zM7 18h5M20 9v9h-4V9z',
  arrow:'M5 12h14M13 6l6 6-6 6',
  sms:'M7 3h10v18H7zM11 18h2',
  bell:'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4',
  list:'M4 7h10M4 12h16M4 17h7M18 5v4M16 7h4'
 };
 function Icon({d,size=24,stroke=2}){return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:stroke,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,focusable:false},h('path',{d}));}
 const first=n=>String(n||'').trim().split(/\s+/)[0]||'';

 // Ce que dit le voyant. Une seule réponse, la plus importante d'abord.
 function status({state,fault}){
  const m=state.metrics||{},plan=state.plan?.mbps||100,got=Math.round(m.capacity||0),inc=state.sharedIncident;
  if(m.state==='redémarrage')return {tone:'wait',icon:P.refresh,title:'Votre box redémarre',text:'Internet revient dans quelques secondes. Ne touchez à rien.'};
  if(inc){const tech=first(inc.technician?.name);
   const text={dispatched:(tech?tech+', technicien Moov,':'Une équipe Moov')+' va partir chez vous.',en_route:(tech||'Le technicien')+' est en route vers votre quartier.',on_site:(tech||'L’équipe')+' est sur place et répare la fibre.',verifying:'C’est réparé. Moov vérifie que tout revient.'}[inc.status]||'Moov l’a vue et s’en occupe. Vous n’avez rien à faire.';
   return {tone:'down',icon:P.down,title:'Panne dans votre quartier',text,action:'track',actionLabel:'Suivre la réparation'};}
  if(fault)return {tone:'slow',icon:P.truck,title:'Moov s’occupe de votre problème',text:'Votre signalement est bien arrivé. On vous prévient à chaque étape.',action:'track',actionLabel:'Voir où ça en est'};
  if(m.latency===null)return {tone:'down',icon:P.box,title:'Votre box ne répond pas',text:'Vérifiez qu’elle est branchée et que ses lumières sont allumées.',action:'guardian',actionLabel:'Me faire aider par Guardian'};
  if(state.scenario==='slow'||got<.8*plan)return {tone:'slow',icon:P.slow,title:'Votre internet est lent',text:'Vous recevez '+got+' Mb/s au lieu de '+plan+'. Redémarrer la box règle souvent le souci.',action:'reboot',actionLabel:'Redémarrer ma box',second:'guardian',secondLabel:'Demander à Guardian'};
  if(state.optical?.state==='fading')return {tone:'slow',icon:P.slow,title:'Une coupure se prépare',text:state.prevention?'Un technicien passe avant la coupure. Tout est prévu.':'Internet marche encore. Choisissez juste en dessous quand le technicien peut passer.'};
  return {tone:'ok',icon:P.check,title:'Votre internet marche bien',text:'Vous recevez '+got+' Mb/s, tout ce que prévoit votre offre.'};
 }

 // Heure courte d'une notification : « 14 h 05 » aujourd'hui, sinon « lun. 9 nov. ».
 function when(at){const d=new Date(at),now=new Date();return d.toDateString()===now.toDateString()?d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}).replace(':',' h '):d.toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'});}
 function kind(n){const t=String(n.title||'').toLowerCase();return /répar|rétabli|revenu|terminé/.test(t)?{icon:P.check,tone:'ok'}:/technicien|équipe|route|place/.test(t)?{icon:P.truck,tone:'info'}:/panne|coupure|lent|baisse|alerte|inconnu/.test(t)?{icon:P.alert,tone:'warn'}:{icon:P.bell,tone:'info'};}

 // Accueil façon application bancaire épurée : un en-tête bleu arrondi avec le chiffre clé et deux gros boutons,
 // un bandeau qui dit ce qui se passe, quatre actions rapides en tuiles, puis les derniers messages.
 function Home({state,user,fault,busy,on,call,cards,recent=[],bell=0,demo}){
  const s=status({state,fault}),m=state.metrics||{},extra=Math.max(0,(m.connected||0)-(state.usual||0)),plan=state.plan?.mbps||100;
  const run=k=>({track:on.track,guardian:on.guardian,reboot:on.reboot,devices:on.devices})[k];
  const shown=(cards||[]).filter(Boolean).slice(0,2),cut=s.tone==='down',got=cut?0:Math.round(m.capacity||0);
  const alertAction=s.action||(s.tone==='ok'&&'devices'),alertLabel=s.action?s.actionLabel:extra?extra+' appareil'+(extra>1?'s':'')+' inconnu'+(extra>1?'s':''):(m.connected||0)+' appareil'+((m.connected||0)>1?'s':'')+' connecté'+((m.connected||0)>1?'s':'');
  const tile=(icon,label,onClick,more)=>h('button',{type:'button',className:'ac-quick-tile',onClick,...more},h(Icon,{d:icon,size:26}),h('span',null,label));
  return h('div',{className:'ac'},
   h('header',{className:'ac-hero'},
    h('div',{className:'ac-top'},
     h('span',{className:'ac-face'},window.FGAvatar?h(FGAvatar.Face,{name:user.name,size:48,role:'client'}):first(user.name).slice(0,1)),
     h('div',{className:'ac-hi'},h('small',null,'Bonjour !'),h('strong',null,user.name)),
     h('div',{className:'ac-top-actions'},demo,h('button',{type:'button',className:'ac-round',onClick:on.bell,'aria-label':'Mes messages'+(bell?' : '+bell+' à lire':'')},h(Icon,{d:P.bell,size:22}),bell>0&&h('i',{className:'ac-round-dot','aria-hidden':true})))),
    h('div',{className:'ac-key'},
     h('span',null,cut?'Votre connexion':'Débit reçu par votre box'),
     h('strong',null,got,h('small',null,' Mb/s')),
     h('p',null,'Offre '+plan+' Mb/s'+(state.homeZone?' · '+state.homeZone.zone:''))),
    h('div',{className:'ac-hero-actions'},
     h('button',{type:'button',className:'ac-hero-btn',onClick:on.voice},h(Icon,{d:P.mic,size:20}),'Parler à Guardian'),
     on.test&&h('button',{type:'button',className:'ac-hero-btn',onClick:on.test,disabled:busy},h(Icon,{d:P.gauge,size:20}),'Tester ma connexion'))),
   h('section',{className:'ac-alert ac-'+s.tone,role:'status','aria-live':'polite'},
    h('span',{className:'ac-alert-ico','aria-hidden':true},h(Icon,{d:s.icon,size:26,stroke:2.3})),
    h('div',null,h('h2',null,s.title),h('p',null,s.text)),
    (alertAction||s.second)&&h('div',{className:'ac-alert-actions'},
     alertAction&&h('button',{type:'button',className:'ac-go'+(s.tone==='ok'?' soft'+(extra?' warn':''):''),onClick:run(alertAction),disabled:busy&&alertAction!=='devices'},s.tone==='ok'&&h(Icon,{d:P.devices,size:18}),alertLabel),
     s.second&&h('button',{type:'button',className:'ac-go ghost',onClick:run(s.second),disabled:busy},s.secondLabel))),
   shown.length>0&&h('div',{className:'ac-cards'},shown),
   h('section',{className:'ac-quick','aria-labelledby':'ac-quick-title'},
    h('h2',{id:'ac-quick-title'},'Actions rapides'),
    h('div',{className:'ac-quick-row'},
     tile(P.alert,'Signaler',on.report),
     call,
     tile(P.sms,'*144#',on.survie,{'aria-label':'Sans internet : composez *144#'}),
     tile(P.devices,'Appareils',on.devices))),
   h('section',{className:'ac-recent','aria-labelledby':'ac-recent-title'},
    h('div',{className:'ac-recent-head'},h('h2',{id:'ac-recent-title'},'Derniers messages'),h('button',{type:'button',className:'ac-round small',onClick:on.bell,'aria-label':'Voir tous mes messages'},h(Icon,{d:P.list,size:18}))),
    recent.length?h('ul',null,recent.filter((n,i,all)=>all.findIndex(x=>x.title===n.title&&x.body===n.body)===i).slice(0,3).map(n=>{const k=kind(n);return h('li',{key:n.key||n.id||n.at},h('button',{type:'button',onClick:on.bell},
     h('span',{className:'ac-recent-ico '+k.tone,'aria-hidden':true},h(Icon,{d:k.icon,size:20})),
     h('span',{className:'ac-recent-txt'},h('b',null,n.title),h('small',null,when(n.at))),
     h('span',{className:'ac-recent-tag'+(n.read?'':' new')},n.read?'Lu':'Nouveau')));})):
     h('p',{className:'ac-recent-empty'},'Pas de message pour l’instant. Guardian vous écrit ici dès qu’il se passe quelque chose.')));
 }
 // Le téléphone n'est pas sur le Wi-Fi de la box : le serveur voit des données mobiles, ou le réseau d'un autre opérateur.
 // (Une page web ne peut pas lire le nom du Wi-Fi.) Sur données mobiles, Guardian peut quand même redémarrer la box à distance.
 const short=op=>String(op||'').replace(/\s+(c[oô]te|ci\b|s\.?a\.?\b).*$/i,'').trim();
 function Where({where,busy,onReboot}){
  const kind=where?.cellular?'mobile':where?.place,[hid,setHid]=React.useState(()=>{try{return sessionStorage.getItem('fg-where-ok')||'';}catch{return '';}});
  if(kind!=='mobile'&&kind!=='autre'||hid===kind)return null;
  const hide=()=>{try{sessionStorage.setItem('fg-where-ok',kind);}catch{}setHid(kind);},op=short(where.operator),phone=/iPhone|iPad|Android/.test(navigator.userAgent);
  return h('section',{className:'ac-where ac-where-'+kind,role:'status'},
   h('span',{className:'ac-where-ico','aria-hidden':true},h(Icon,{d:kind==='mobile'?P.sms:P.box,size:24})),
   h('div',null,h('h2',null,'Vous n’êtes pas sur le Wi-Fi de votre box'),
    h('p',null,kind==='mobile'?(phone?'Ce téléphone utilise ses données mobiles':'Cet appareil passe par les données mobiles d’un téléphone')+(op?' '+op:'')+'. Si le Wi-Fi de la maison ne marche plus, Guardian peut redémarrer votre box d’ici.':(phone?'Ce téléphone':'Cet appareil')+' est sur un autre réseau'+(op?' ('+op+')':'')+'. Pour suivre votre fibre Moov, connectez-vous au Wi-Fi de votre box.')),
   h('div',{className:'ac-where-actions'},
    kind==='mobile'&&onReboot&&h('button',{type:'button',className:'ac-where-go',onClick:onReboot,disabled:busy},h(Icon,{d:P.refresh,size:18}),'Redémarrer ma box'),
    h('button',{type:'button',className:'ac-where-ok',onClick:hide},'Compris')));
 }
 window.FGAccueil={Home,status,Where};
})();
