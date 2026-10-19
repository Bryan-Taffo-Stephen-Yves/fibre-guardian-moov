/* Suivi du technicien en direct, partagé par l'espace client, l'espace Moov et la scène du jury.
   Présentation inspirée des applications de VTC : la carte en grand, puis une feuille avec
   « Koffi arrive dans 2 min », la fiche du technicien (note, numéro, véhicule) et trois actions rondes.
   Le serveur donne le trajet (départ, durée, distance) ; l'écran fait avancer le véhicule chaque seconde. */
(function(){
 'use strict';
 const h=React.createElement,{useState:S,useEffect:E,useRef:R}=React;
 const HM=new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Abidjan',hour:'numeric',minute:'2-digit'});
 const hm=t=>HM.format(t).replace(/^0?(\d+):(\d+)/,'$1 h $2');
 const km1=n=>(Math.round(n*10)/10).toFixed(1).replace('.',',');
 const reduced=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 // « 1 min 20 s », « 45 s ».
 function left(ms){const s=Math.max(0,Math.ceil(ms/1000));if(s<60)return s+' s';const m=Math.floor(s/60),r=s%60;return m+' min'+(r?' '+String(r).padStart(2,'0')+' s':'');}
 // Minutes arrondies pour le grand titre : « 2 min », « 1 min », « moins d'1 min ».
 const minutes=ms=>ms<60000?'moins d’1 min':Math.round(ms/60000)+' min';
 const firstName=name=>String(name||'').split(/\s+/)[0];
 const initials=name=>String(name||'T').split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();

 function Icon({d,size=22}){return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.9,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,focusable:false},h('path',{d}));}
 const I={phone:'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',person:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0',route:'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4M6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8',chevron:'m9 6 6 6-6 6',star:'m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7Z',close:'m6 6 12 12M18 6 6 18',van:'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4M17 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4'};

 // Avancement local : on part de la valeur du serveur et on avance au rythme de l'horloge de l'appareil.
 function useProgress(position){
  const anchor=R(null),[now,setNow]=S(Date.now());
  const key=position?position.progress+':'+position.departedAt:'';
  if(!anchor.current||anchor.current.key!==key)anchor.current={key,progress:position?.progress||0,at:Date.now()};
  E(()=>{if(!position)return;const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[!!position]);
  if(!position)return {p:0,now};
  const dur=position.durationMs||120000,p=Math.min(1,anchor.current.progress+(now-anchor.current.at)/dur);
  return {p,now,remaining:(1-p)*dur,dur};
 }

 // Appel au technicien : l'écran d'appel reste dans l'application (voir « À propos de la démo »).
 function CallSheet({tech,onClose}){
  const [sec,T]=S(0),[state,ST]=S('ringing'),close=R(null);
  E(()=>{close.current?.focus();const a=setTimeout(()=>ST('live'),2200),t=setInterval(()=>T(v=>v+1),1000);const k=e=>{if(e.key==='Escape')onClose();};addEventListener('keydown',k);return()=>{clearTimeout(a);clearInterval(t);removeEventListener('keydown',k);};},[]);
  const talk=Math.max(0,sec-2),mm=String(Math.floor(talk/60)).padStart(2,'0')+':'+String(talk%60).padStart(2,'0');
  return h('div',{className:'lt-call',role:'dialog','aria-modal':'true','aria-label':'Appel à '+tech.name},
   h('div',{className:'lt-call-card'},
    h('span',{className:'lt-call-avatar'+(state==='ringing'&&!reduced()?' is-ringing':''),'aria-hidden':true},initials(tech.name)),
    h('strong',null,tech.name),h('span',{className:'lt-call-number'},tech.phone||''),
    h('span',{className:'lt-call-state',role:'status'},state==='ringing'?'Appel en cours…':'En ligne · '+mm),
    state==='live'&&h('p',null,'« Bonjour, ici '+firstName(tech.name)+' de Moov. Je suis en route, j’arrive très vite. »'),
    h('button',{type:'button',ref:close,className:'lt-hangup',onClick:onClose,'aria-label':'Raccrocher'},h(Icon,{d:I.phone,size:26}))));
 }

 // incident : { status, position, technician, events } ; map : rendu de la carte (reçoit l'incident à jour).
 function Card({incident:i,map,compact}){
  const pos=i.status==='en_route'?i.position:null,{p,now,remaining}=useProgress(pos);
  const [call,C]=S(false),[details,D]=S(false);
  const at=kind=>(i.events||[]).filter(e=>e.kind===kind).map(e=>e.at).pop()||null;
  const order=['dispatched','en_route','on_site','verifying','resolved'],rank=order.indexOf(i.status);
  const arrived=rank>=2||(pos&&p>=1);
  const tech={name:pos?.technician||i.technician?.name||'Votre technicien',team:pos?.team||i.technician?.team||'',phone:pos?.phone||i.technician?.phone||'',rating:pos?.rating||i.technician?.rating||null,missions:pos?.missions||i.technician?.missions||null,vehicle:pos?.vehicle||i.technician?.vehicle||''};
  const live=pos?{...pos,progress:p,eta:Math.ceil(remaining/1000),x:Math.round(pos.fromX+(pos.targetX-pos.fromX)*p),y:Math.round(pos.fromY+(pos.targetY-pos.fromY)*p)}:null;
  const km=pos?.distanceKm||0,pct=Math.round(p*100),first=firstName(tech.name);
  const title=i.status==='dispatched'?first+' prépare son départ':arrived?first+' est arrivé chez vous':first+' arrive dans '+minutes(remaining);
  const sub=i.status==='dispatched'?'Vous serez prévenu dès son départ.':arrived?'L’intervention commence.':'Vers '+hm(now+remaining)+' · encore '+km1(km*(1-p))+' km';
  const steps=[
   {k:'dispatched',t:'Technicien affecté',at:at('dispatched'),s:tech.team},
   {k:'en_route',t:'Départ',at:at('en_route'),s:rank>=1?'Départ de l’agence '+tech.team.replace(/^Fibre\s+/,''):'Pas encore parti'},
   {k:'road',t:'En route',s:arrived?(at('on_site')&&at('en_route')?'Trajet de '+Math.max(1,Math.round((at('on_site')-at('en_route'))/60000))+' min':'Trajet terminé'):rank===1?'Encore '+left(remaining):'',done:arrived},
   {k:'on_site',t:'Arrivée',at:at('on_site'),s:arrived?'Sur place':''},
   {k:'verifying',t:'Réparation terminée',at:at('verifying'),s:rank>=3?'Vérification de votre connexion':''}
  ].map(s=>({...s,done:s.done!==undefined?s.done:rank>=order.indexOf(s.k)&&order.indexOf(s.k)>=0}));
  const current=steps.findIndex(s=>!s.done);
  return h('section',{className:'lt'+(compact?' lt--compact':'')+(live?' lt--live':''),'aria-label':'Suivi du technicien en direct'},
   live&&h('div',{className:'lt-map'},map({...i,position:live}),h('span',{className:'lt-badge'+(reduced()?' is-still':'')},h('i'),arrived?'Arrivé':'En direct')),
   h('div',{className:'lt-sheet'},
    live&&h('span',{className:'lt-grabber','aria-hidden':true}),
    h('div',{className:'lt-head'},
     h('h3',{className:'lt-title',role:'status','aria-live':'polite'},title,!arrived&&pos&&h('span',{className:'lt-title-chevron','aria-hidden':true},h(Icon,{d:I.chevron,size:16}))),
     h('span',{className:'lt-sub'},sub)),
    live&&h('div',{className:'lt-bar',role:'progressbar','aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':pct,'aria-label':'Trajet parcouru : '+pct+' %'},h('i',{style:{width:pct+'%'}})),
    h('div',{className:'lt-actions'},
     h('button',{type:'button',className:'lt-act',onClick:()=>D(true),'aria-expanded':details},h('span',{className:'lt-act-ico lt-act-ico--tech'},h('span',{className:'lt-mini-avatar','aria-hidden':true},initials(tech.name)),tech.rating&&h('b',{className:'lt-rating'},String(tech.rating).replace('.',','))),h('span',null,'Technicien')),
     h('button',{type:'button',className:'lt-act',onClick:()=>C(true),disabled:!tech.phone},h('span',{className:'lt-act-ico'},h(Icon,{d:I.phone})),h('span',null,'Appeler '+first)),
     h('button',{type:'button',className:'lt-act',onClick:()=>D(!details),'aria-expanded':details},h('span',{className:'lt-act-ico'},h(Icon,{d:I.route})),h('span',null,details?'Masquer le trajet':'Détails du trajet'))),
    h('div',{className:'lt-who'},
     h('span',{className:'lt-avatar','aria-hidden':true},initials(tech.name),h('i')),
     h('div',{className:'lt-who-main'},h('b',null,tech.name),h('span',null,(tech.team?tech.team+' · ':'')+'Technicien Moov'),
      tech.rating&&h('span',{className:'lt-stars'},h(Icon,{d:I.star,size:14}),String(tech.rating).replace('.',','),tech.missions&&h('small',null,' · '+tech.missions+' interventions'))),
     h('div',{className:'lt-who-side'},tech.phone&&h('a',{className:'lt-phone',href:'#',onClick:e=>{e.preventDefault();C(true);}},tech.phone),tech.vehicle&&h('span',{className:'lt-vehicle'},h(Icon,{d:I.van,size:15}),tech.vehicle))),
    (details||!compact&&!live)&&h('ol',{className:'lt-steps','aria-label':'Fiche du trajet'},steps.map((s,k)=>{const state=s.done?'done':k===current?'now':'next';
     return h('li',{key:s.k,className:'lt-step '+state,'aria-current':state==='now'?'step':undefined},
      h('span',{className:'lt-dot','aria-hidden':true},s.done?h(Icon,{d:'m5 12 5 5 9-10',size:13}):''),
      h('span',{className:'lt-step-t'},h('b',null,s.t),h('span',{className:'j-sr'},state==='done'?' (fait)':state==='now'?' (en cours)':' (à venir)'),s.s&&h('small',null,s.s)),
      h('span',{className:'lt-step-h'},s.done&&s.at?hm(s.at):''));}))),
   call&&h(CallSheet,{tech,onClose:()=>C(false)}));
 }
 window.FGLiveTrip={Card,left};
})();
