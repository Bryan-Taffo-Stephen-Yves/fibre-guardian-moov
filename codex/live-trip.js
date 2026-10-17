/* Suivi du technicien en direct, partagé par l'espace client et l'espace Moov.
   Inspiré de la carte de trajet de Fibre Welcome : carte avec le véhicule, distance parcourue,
   vitesse, fiche du trajet horodatée et fiche du technicien. Le serveur donne le trajet
   (départ, durée, distance) ; l'écran fait avancer le véhicule chaque seconde entre deux actualisations. */
(function(){
 'use strict';
 const h=React.createElement,{useState:S,useEffect:E,useRef:R}=React;
 const HM=new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Abidjan',hour:'numeric',minute:'2-digit'});
 const hm=t=>HM.format(t).replace(/^0?(\d+):(\d+)/,'$1 h $2');
 const km1=n=>(Math.round(n*10)/10).toFixed(1).replace('.',',');
 const reduced=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 // « 1 min 20 s », « 45 s ».
 function left(ms){const s=Math.max(0,Math.ceil(ms/1000));if(s<60)return s+' s';const m=Math.floor(s/60),r=s%60;return m+' min'+(r?' '+String(r).padStart(2,'0')+' s':'');}
 // Vitesse du moment : la moyenne du trajet, qui varie doucement (8 à 60 km/h).
 function speed(km,durMs,now){const avg=km/Math.max(durMs,60000)*3600000,v=avg*(1+.16*Math.sin(now/6500)+.06*Math.sin(now/1900));return Math.max(8,Math.min(60,Math.round(v)));}
 const firstName=name=>String(name||'').split(/\s+/)[0];

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

 function Gauge({kmh}){
  const max=60,f=Math.max(0,Math.min(1,kmh/max));
  return h('div',{className:'lt-gauge',role:'img','aria-label':'Vitesse : '+kmh+' kilomètres par heure'},
   h('svg',{viewBox:'0 0 120 68','aria-hidden':true},
    h('path',{d:'M14 60A46 46 0 0 1 106 60',pathLength:100,className:'lt-g-track'}),
    h('path',{d:'M14 60A46 46 0 0 1 106 60',pathLength:100,className:'lt-g-fill',strokeDasharray:Math.round(f*100)+' 100'})),
   h('span',{className:'lt-g-v'},h('b',null,kmh),h('i',null,'km/h')));
 }

 // incident : { status, position, technician, events } ; map : rendu de la carte (reçoit l'incident à jour).
 function Card({incident:i,map,compact}){
  const pos=i.status==='en_route'?i.position:null,{p,now,remaining,dur}=useProgress(pos);
  const at=kind=>(i.events||[]).filter(e=>e.kind===kind).map(e=>e.at).pop()||null;
  const order=['dispatched','en_route','on_site','verifying','resolved'],rank=order.indexOf(i.status);
  const arrived=rank>=2||(pos&&p>=1);
  const name=pos?.technician||i.technician?.name||'Votre technicien',team=pos?.team||i.technician?.team||'';
  const live=pos?{...pos,progress:p,eta:Math.ceil(remaining/1000),x:Math.round(pos.fromX+(pos.targetX-pos.fromX)*p),y:Math.round(pos.fromY+(pos.targetY-pos.fromY)*p)}:null;
  const km=pos?.distanceKm||0,pct=Math.round(p*100);
  const title=i.status==='dispatched'?firstName(name)+' prépare son départ':arrived?firstName(name)+' est arrivé':firstName(name)+' arrive dans '+left(remaining);
  const steps=[
   {k:'dispatched',t:'Technicien affecté',at:at('dispatched'),s:team},
   {k:'en_route',t:'Départ',at:at('en_route'),s:rank>=1?'Départ de l’agence '+team.replace(/^Fibre\s+/,''):'Pas encore parti'},
   {k:'road',t:'En route',s:arrived?(at('on_site')&&at('en_route')?'Trajet de '+Math.max(1,Math.round((at('on_site')-at('en_route'))/60000))+' min':'Trajet terminé'):rank===1?'Encore '+left(remaining):'',done:arrived},
   {k:'on_site',t:'Arrivée',at:at('on_site'),s:arrived?'Sur place':''},
   {k:'verifying',t:'Réparation terminée',at:at('verifying'),s:rank>=3?'Vérification de votre connexion':''}
  ].map(s=>({...s,done:s.done!==undefined?s.done:rank>=order.indexOf(s.k)&&order.indexOf(s.k)>=0}));
  const current=steps.findIndex(s=>!s.done);
  return h('section',{className:'lt'+(compact?' lt--compact':''),'aria-label':'Suivi du technicien en direct'},
   live&&h('div',{className:'lt-map'},map({...i,position:live})),
   h('div',{className:'lt-side'},
    h('div',{className:'lt-head'},live&&h('span',{className:'lt-badge'+(reduced()?' is-still':'')},h('i'),arrived?'Arrivé':'En direct'),h('strong',{className:'lt-title'},title),pos&&!arrived&&h('span',{className:'lt-sub'},'Arrivée prévue vers '+hm(now+remaining))),
    live&&h('div',{className:'lt-dist'},
     h('div',{className:'lt-dist-main'},
      h('span',{className:'lt-lab'},'Distance'),
      h('span',{className:'lt-km'},h('b',null,km1(km*p)+' km'),h('span',null,' sur '+km1(km)+' km')),
      h('div',{className:'lt-bar',role:'progressbar','aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':pct,'aria-label':'Trajet parcouru'},h('i',{style:{width:pct+'%'}})),
      h('span',{className:'lt-pct'},h('b',null,pct+' %'),' du trajet')),
     !arrived&&h('div',{className:'lt-speed'},h('span',{className:'lt-lab'},'Vitesse'),h(Gauge,{kmh:speed(km,dur,now)}))),
    !compact&&h('ol',{className:'lt-steps','aria-label':'Fiche du trajet'},steps.map((s,k)=>{const state=s.done?'done':k===current?'now':'next';
     return h('li',{key:s.k,className:'lt-step '+state,'aria-current':state==='now'?'step':undefined},
      h('span',{className:'lt-dot','aria-hidden':true},s.done?'✓':''),
      h('span',{className:'lt-step-t'},h('b',null,s.t),h('span',{className:'j-sr'},state==='done'?' (fait)':state==='now'?' (en cours)':' (à venir)'),s.s&&h('small',null,s.s)),
      h('span',{className:'lt-step-h'},s.done&&s.at?hm(s.at):''));})),
    h('div',{className:'lt-who'},h('span',{className:'lt-avatar','aria-hidden':true},firstName(name)[0]||'T'),h('div',null,h('b',null,name),h('span',null,(team?team+' · ':'')+'Technicien Moov')),h('span',{className:'lt-tag'},arrived?'Sur place':i.status==='dispatched'?'Affecté':'En route'))));
 }
 window.FGLiveTrip={Card,left};
})();
