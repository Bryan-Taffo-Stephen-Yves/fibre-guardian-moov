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
  sms:'M7 3h10v18H7zM11 18h2'
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

 function Home({state,user,fault,busy,on,call,cards}){
  const s=status({state,fault}),m=state.metrics||{},extra=Math.max(0,(m.connected||0)-(state.usual||0));
  const run=k=>({track:on.track,guardian:on.guardian,reboot:on.reboot})[k];
  const shown=(cards||[]).filter(Boolean).slice(0,2);
  return h('div',{className:'ac'},
   h('header',{className:'ac-hello'},
    window.FGAvatar&&h(FGAvatar.Sticker,{name:user.name,role:'client',pose:s.tone==='ok'?'wave':'phone',size:64,className:'ac-face'}),
    h('div',null,h('h1',null,'Bonjour '+first(user.name)),state.homeZone&&h('p',null,state.homeZone.zone))),
   h('section',{className:'ac-light ac-'+s.tone,role:'status','aria-live':'polite'},
    h('span',{className:'ac-dot','aria-hidden':true},h('i'),h('b',null,h(Icon,{d:s.icon,size:34,stroke:2.4}))),
    h('div',{className:'ac-say'},h('h2',null,s.title),h('p',null,s.text),
     s.tone==='ok'&&h('button',{type:'button',className:'ac-pill'+(extra?' warn':''),onClick:on.devices},h(Icon,{d:P.devices,size:18}),extra?extra+' appareil'+(extra>1?'s':'')+' inconnu'+(extra>1?'s':'')+' sur votre Wi-Fi':(m.connected||0)+' appareil'+((m.connected||0)>1?'s':'')+' connecté'+((m.connected||0)>1?'s':''),h(Icon,{d:P.arrow,size:16}))),
    (s.action||s.second)&&h('div',{className:'ac-light-actions'},
     s.action&&h('button',{type:'button',className:'ac-go',onClick:run(s.action),disabled:busy},s.actionLabel),
     s.second&&h('button',{type:'button',className:'ac-go ghost',onClick:run(s.second),disabled:busy},s.secondLabel))),
   h('nav',{className:'ac-tiles','aria-label':'Que voulez-vous faire ?'},
    h('button',{type:'button',className:'ac-tile is-main',onClick:on.voice},h('span',{className:'ac-ico'},h(Icon,{d:P.mic,size:28})),'Parler à Guardian'),
    on.test&&h('button',{type:'button',className:'ac-tile',onClick:on.test,disabled:busy},h('span',{className:'ac-ico'},h(Icon,{d:P.gauge,size:28})),'Tester ma connexion'),
    h('button',{type:'button',className:'ac-tile',onClick:on.report},h('span',{className:'ac-ico'},h(Icon,{d:P.alert,size:28})),'Signaler un problème'),
    call),
   h('button',{type:'button',className:'ac-survie',onClick:on.survie},h(Icon,{d:P.sms,size:18}),h('span',null,'Plus d’internet du tout ? Composez ',h('b',null,'*144#'))),
   shown.length>0&&h('div',{className:'ac-cards'},shown));
 }
 window.FGAccueil={Home,status};
})();
