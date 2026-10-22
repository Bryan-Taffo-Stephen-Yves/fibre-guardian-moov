(function(){
 'use strict';
 // Accueil client réorganisé : suivi automatique du technicien, gros bouton « Signaler », page Compte.
 const h=React.createElement,{useState:S,useEffect:E,useRef:R}=React;
 const STAGE={reported:'Signalement reçu',confirmed:'Panne confirmée',assigned:'Technicien choisi',en_route:'En route',on_site:'Sur place',repairing:'Réparation en cours',verifying:'Vérification du réseau',resolved:'Internet est revenu'};
 const ORDER=['reported','confirmed','assigned','en_route','on_site','repairing','verifying','resolved'];
 function Icon({name,size=20}){const p={truck:'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4',alert:'M12 8v5M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',arrow:'M5 12h14m-6-6 6 6-6 6',phone:'M7 3h10v18H7zM11 18h2',map:'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2ZM9 4v14M15 6v14',bell:'M18 8a6 6 0 0 0-12 0v7l-3 3h18l-3-3ZM10 21h4',user:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0',wallet:'M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3zM3 7l12-3v3M17 13h.01',info:'M12 16v-5M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18',logout:'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',check:'m5 12 5 5 9-10',star:'m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z',camera:'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',chevron:'m9 6 6 6-6 6',shield:'m12 3 8 3v6c0 6-8 9-8 9s-8-3-8-9V6Zm-4 9 3 3 5-6'}[name];
  return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,focusable:false},h('path',{d:p}));}
 function Face({name,size=44,role}){return window.FGAvatar?h(FGAvatar.Face,{name,size,role}):window.FGRideMap?.Portrait?h(FGRideMap.Portrait,{name,size}):h('span',{className:'ch-face',style:{width:size,height:size}},(name||'?').slice(0,1));}
 const first=n=>(n||'').split(' ')[0];
 const mins=s=>s==null?null:Math.max(1,Math.ceil(s/60));

 // Le suivi apparaît tout seul dès qu'un technicien est choisi pour votre quartier.
 function LiveTrip({api,onTrack}){
  const [data,D]=S(null),[,tick]=S(0),alive=R(true);
  E(()=>{alive.current=true;const load=()=>api('/noc/client').then(r=>{if(alive.current)D(r);}).catch(()=>{});load();const t=setInterval(load,4000);addEventListener('fg-mission-ping',load);return()=>{alive.current=false;clearInterval(t);removeEventListener('fg-mission-ping',load);};},[]);
  // Le serveur dit « dispatched » quand le technicien est choisi : la carte apparaît dès ce moment-là.
  const list=(data?.incidents||[]).map(i=>i.status==='dispatched'?{...i,status:'assigned'}:i);
  const live=list.find(i=>!i.terminal&&i.technician&&['assigned','en_route','on_site','repairing','verifying'].includes(i.status));
  const done=!live&&list.find(i=>i.terminal&&i.status==='resolved'&&i.technician&&!i.feedback&&Date.now()-new Date(i.events?.at(-1)?.at||0).getTime()<6*3600e3);
  const item=live||done;
  // Compte à rebours à la seconde pendant le trajet (30 s en démo), d'après l'heure de départ donnée par le serveur.
  const pos=item?.status==='en_route'?item.position:null,leftMs=pos?.departedAt?Math.max(0,(pos.durationMs||0)-(Date.now()-pos.departedAt)):null;
  E(()=>{if(!pos)return;const t=setInterval(()=>tick(v=>v+1),1000);return()=>clearInterval(t);},[!!pos]);
  if(!item)return null;
  const t=item.technician,eta=leftMs==null||leftMs<1000?null:leftMs<60000?[Math.ceil(leftMs/1000),'s']:[mins(leftMs/1000),'min'],step=Math.max(0,ORDER.indexOf(item.status));
  const title=done?'Internet est revenu':item.status==='en_route'?first(t.name)+' arrive':item.status==='assigned'?first(t.name)+' va venir chez vous':item.status==='on_site'?first(t.name)+' est arrivé':STAGE[item.status];
  const sub=done?'Comment s’est passée l’intervention ? Votre avis aide Moov.':(item.zone||'Votre quartier')+(item.restore?.label?' · retour prévu vers '+item.restore.label:'');
  return h('button',{type:'button',className:'ch-live'+(done?' done':''),onClick:onTrack,'aria-label':title+'. Ouvrir le suivi en direct'},
   h('span',{className:'ch-live-pulse','aria-hidden':true}),
   h('div',{className:'ch-live-top'},h('span',{className:'ch-live-tag'},h('i'),done?'Terminé':'En direct'),h('span',{className:'ch-live-step'},STAGE[item.status])),
   h('div',{className:'ch-live-main'},h(Face,{name:t.name,size:52}),h('div',null,h('strong',null,title),h('small',null,sub)),eta&&!done?h('em',null,eta[0],h('small',null,eta[1])):null),
   !done&&h('div',{className:'ch-live-bar','aria-hidden':true},ORDER.slice(2).map((k,i)=>h('i',{key:k,className:step>=i+2?'on':''}))),
   h('div',{className:'ch-live-foot'},h('span',null,t.vehicle||t.team||'Équipe Moov'),h('b',null,done?'Noter '+first(t.name):'Suivre en direct',h(Icon,{name:'arrow',size:17}))));
 }

 // Le geste principal du client : signaler, en un appui.
 function ReportHero({onReport,onSurvie,call}){
  return h('section',{className:'ch-report','aria-label':'Signaler un problème'},
   h('button',{type:'button',className:'ch-report-main',onClick:onReport},h('span',{className:'ch-report-icon'},h(Icon,{name:'alert',size:26})),h('span',null,h('strong',null,'Signaler un problème'),h('small',null,'Une photo, un lieu : Moov s’en occupe.')),h(Icon,{name:'arrow',size:22})),
   h('div',{className:'ch-report-more'},call,h('button',{type:'button',className:'ch-chip',onClick:onSurvie},h(Icon,{name:'phone',size:17}),'Sans internet · *144#')));
 }

 // Onglet Compte : tout ce qui n'est pas quotidien, au même endroit.
 function Account({user,state,bell,go,onAbout,onLogout,busy}){
  const plan=state?.plan,zone=state?.homeZone?.zone;
  const row=(icon,label,hint,onClick,extra)=>h('button',{type:'button',className:'ch-row',onClick},h('span',{className:'ch-row-icon'},h(Icon,{name:icon,size:19})),h('span',null,h('b',null,label),hint&&h('small',null,hint)),extra,h(Icon,{name:'chevron',size:18}));
  return h('div',{className:'ch-account'},
   h('section',{className:'ch-profile'},h(Face,{name:user.name,size:72,role:'client'}),h('div',null,h('h1',null,user.name),h('p',null,zone?'Fibre Moov · '+zone:'Client Moov Fibre')),
    plan&&h('div',{className:'ch-plan'},h('div',null,h('small',null,'Votre offre'),h('strong',null,plan.mbps+' Mb/s')),h('div',null,h('small',null,'Chaque mois'),h('strong',null,(plan.price||0).toLocaleString('fr-FR')+' F')),h('button',{type:'button',className:'ch-chip strong',onClick:()=>go('forfait')},'Changer de forfait'),state?.nextPlan&&h('p',{className:'ch-plan-next'},'À partir du '+new Date(state.nextPlan.at).toLocaleDateString('fr-FR',{day:'numeric',month:'long'}).replace(/^1 /,'1er ')+' : '+state.nextPlan.plan.mbps+' Mb/s pour '+(state.nextPlan.plan.price||0).toLocaleString('fr-FR')+' F par mois.'))),
   h('section',{className:'ch-group'},h('h2',null,'Suivi et alertes'),
    row('bell','Notifications',bell?bell+' non lue'+(bell>1?'s':''):'Tout est lu',()=>go('notifications'),bell?h('span',{className:'ch-badge'},bell>9?'9+':bell):null),
    row('truck','Suivi du technicien','Où en est votre intervention',()=>go('tracking')),
    row('map','Carte des pannes','Est-ce que c’est général ?',()=>go('ville'))),
   h('section',{className:'ch-group'},h('h2',null,'En cas de coupure'),
    row('alert','Signaler un problème','Photo et lieu, en une minute',()=>go('report')),
    row('phone','Sans internet · *144#','Guardian répond même hors ligne',()=>go('survie'))),
   h('section',{className:'ch-group'},h('h2',null,'L’application'),
    row('info','À propos de la démo','Ce qui est réel et ce qui est simulé',onAbout)),
   h('button',{type:'button',className:'ch-logout',onClick:onLogout,disabled:busy},h(Icon,{name:'logout',size:19}),'Se déconnecter'));
 }
 window.FGClientHome={LiveTrip,ReportHero,Account,Icon};
})();
