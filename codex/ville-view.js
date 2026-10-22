/* « Est-ce que c'est général ? » : la carte des pannes du client, comme celle des coupures de courant.
   La même maquette 3D que le simulateur de l'équipe Moov, en lecture seule : on regarde, on ne déclenche rien.
   Les données viennent de /api/ville (ville.cjs) : l'état de chaque quartier, rien sur les autres clients. */
(function(){
 'use strict';
 const h=React.createElement,{useState:S,useEffect:E}=React;
 const TOUCHED=['panne','courant','lent'];
 const LABEL={panne:'Panne en cours',courant:'Coupure de courant',lent:'Internet ralenti',retabli:'Rétabli',normal:'Tout va bien'};
 const TONE={panne:'down',courant:'down',lent:'warn',retabli:'ok',normal:'calm'};
 const where=q=>q.quartier===q.commune?q.commune:q.quartier+', '+q.commune;
 // Nom court, le même que sur les bulles de la carte : « Grand-Bassam » plutôt que « Quartier France ».
 const short=q=>window.FGSim3D?.NAMES?.[q.id]||q.quartier;
 const time=at=>new Date(at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
 const narrowQuery='(max-width: 760px)';

 // La carte se met à jour toutes les 5 secondes, comme la surveillance des box.
 function useVille(api,every=5000){
  const [data,D]=S(null),[error,X]=S('');
  E(()=>{let alive=true,t;const load=async()=>{try{const d=await api('/ville');if(alive){D(d);X('');}}catch(e){if(alive)X(e.message||'La carte n’est pas disponible pour le moment.');}finally{if(alive)t=setTimeout(load,every);}};load();return()=>{alive=false;clearTimeout(t);};},[]);
  return [data,error];
 }
 function useNarrow(){const [m,M]=S(()=>!!window.matchMedia?.(narrowQuery).matches);E(()=>{const q=window.matchMedia?.(narrowQuery);if(!q)return;const f=()=>M(q.matches);q.addEventListener('change',f);return()=>q.removeEventListener('change',f);},[]);return m;}

 // Le verdict en une phrase : la panne est-elle chez moi seulement, ou ailleurs aussi ?
 function verdict(data){
  const qs=data.quartiers,mine=qs.find(q=>q.chezMoi),others=qs.filter(q=>!q.chezMoi&&TOUCHED.includes(q.state)),k=others.length;
  const also=k?(k>1?k+' autres quartiers sont':'Un autre quartier est')+' aussi touché'+(k>1?'s':'')+' à Abidjan.':'Ailleurs à Abidjan, la fibre marche.';
  const back=mine?.retour?' Retour prévu vers '+mine.retour+'.':'';
  const box='Si internet ne marche pas chez vous, la panne vient sans doute de votre box : Guardian peut la vérifier avec vous.';
  if(mine&&mine.state==='courant')return {tone:'down',mine,others,title:'Coupure de courant dans votre quartier',text:'Ce n’est pas une panne Moov : le courant est coupé à '+mine.quartier+' (CIE). Votre box repartira toute seule au retour du courant. '+also+' Vous n’avez pas à vous inquiéter.'};
  if(mine&&mine.state==='lent')return {tone:'warn',mine,others,title:'Internet ralenti dans votre quartier',text:'Beaucoup de monde se connecte en même temps à '+mine.quartier+'. Internet ralentit sans couper, et Moov surveille. '+also+' Vous n’avez pas à vous inquiéter.'};
  if(mine&&mine.state==='panne')return {tone:'down',mine,others,title:k?'Vous n’êtes pas seul':'Seul votre quartier est touché',text:(k?'La fibre est coupée à '+mine.quartier+'. '+also:'La panne vient du réseau de '+mine.quartier+'. '+also)+' Ce n’est pas votre box : Moov est déjà dessus.'+back+' Vous n’avez pas à vous inquiéter.'};
  if(k)return {tone:'calm',mine,others,ask:!!mine,title:mine?'Chez vous, la fibre marche':(k>1?k+' quartiers touchés':'Un quartier touché')+' à Abidjan',text:(k>1?k+' quartiers ont':'Un quartier a')+' une panne ailleurs à Abidjan'+(mine?', pas le vôtre. '+box:'. Moov est déjà dessus.')};
  return {tone:'calm',mine,others,ask:!!mine,title:'Tout Abidjan a la fibre',text:'Aucune panne dans les '+qs.length+' quartiers suivis par Moov. '+box};
 }

 function Dot({state}){return h('i',{className:'vl-dot is-'+TONE[state],'aria-hidden':true});}
 function Pills({quartiers,max=4}){
  if(!quartiers.length)return null;const shown=quartiers.slice(0,max),more=quartiers.length-shown.length;
  return h('ul',{className:'vl-pills','aria-label':'Quartiers touchés'},shown.map(q=>h('li',{key:q.id,className:'is-'+TONE[q.state]},h(Dot,{state:q.state}),h('span',null,short(q)),h('small',null,LABEL[q.state]))),more>0&&h('li',{className:'is-more'},'+ '+more));
 }

 // Accueil : le verdict et un bouton vers la carte.
 function Card({api,onOpen,onGuardian}){
  const [data]=useVille(api,8000);if(!data)return null;
  const v=verdict(data);
  return h('section',{className:'j-card vl-card is-'+v.tone,'aria-labelledby':'vl-card-title'},
   h('div',{className:'vl-card-icon','aria-hidden':true},h('svg',{viewBox:'0 0 24 24',width:24,height:24,fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round'},h('path',{d:'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2ZM9 4v14M15 6v14'}))),
   h('div',{className:'vl-card-text'},
    h('small',null,'Est-ce que c’est général ?'),
    h('h2',{id:'vl-card-title'},v.title),
    h('p',null,v.text),
    h(Pills,{quartiers:v.others})),
   h('div',{className:'vl-card-actions'},
    h('button',{type:'button',className:'j-button primary',onClick:onOpen},'Voir la carte d’Abidjan'),
    v.ask&&onGuardian&&h('button',{type:'button',className:'j-text-button',onClick:onGuardian},'Vérifier ma box avec Guardian')));
 }

 // Fiche d'un quartier touché sur la carte : son état, où en est Moov, l'heure de retour.
 function Detail({q}){
  if(!q)return null;const off=q.boxEteintes,touched=TOUCHED.includes(q.state);
  return h('div',{className:'vl-detail is-'+TONE[q.state],role:'status'},
   h('div',{className:'vl-detail-head'},h(Dot,{state:q.state}),h('strong',null,where(q)),q.chezMoi&&h('span',{className:'vl-home-tag'},'Chez vous')),
   h('p',null,LABEL[q.state]+(touched&&q.state!=='lent'&&off?' · '+off+' box sur '+q.box+' sans internet':'')+(q.state==='retabli'?' · la fibre est revenue':'')),
   touched&&h('p',{className:'vl-detail-step'},q.state==='courant'?'Ce n’est pas Moov : la box repart seule au retour du courant.':(q.etape||'Moov surveille')+(q.retour?' · retour prévu vers '+q.retour:'')));
 }

 function View({api,onGuardian}){
  const [data,error]=useVille(api),narrow=useNarrow(),[picked,P]=S(null),[rot,setRot]=S(-18);
  if(!data)return h('section',{className:'j-card vl-page'},h('h1',null,'Carte des pannes'),h('p',{className:error?'vl-error':undefined,role:error?'alert':undefined},error||'Chargement de la carte d’Abidjan…'));
  const v=verdict(data),qs=data.quartiers,selected=picked||v.mine?.id||null,q=qs.find(x=>x.id===selected);
  // La maquette du simulateur attend des poteaux et des dossiers : on lui donne seulement l'état de chaque quartier.
  const segments=qs.map(x=>({id:x.id,online:x.box-x.boxEteintes,total:x.box,alarm:x.state==='lent'?'UPLINK_HIGH':'NONE'}));
  const incidents=qs.filter(x=>x.state!=='normal').map(x=>x.state==='retabli'?{segment_id:x.id,status:'resolved',updated:data.at}:{segment_id:x.id,status:'reported',plan:{cause:x.state==='lent'?'UPLINK_CONGESTION':null}});
  const calm=qs.filter(x=>!TOUCHED.includes(x.state));
  return h('div',{className:'vl-page'},
   h('header',{className:'vl-head'},
    h('div',null,h('h1',null,'Carte des pannes'),h('p',null,'Comme pour une coupure de courant : regardez si la panne est seulement chez vous, ou ailleurs aussi.')),
    h('span',{className:'vl-live'},h('i',{'aria-hidden':true}),'En direct · '+time(data.at))),
   h('section',{className:'j-card vl-verdict is-'+v.tone},
    h('h2',null,v.title),h('p',null,v.text),
    v.ask&&onGuardian&&h('button',{type:'button',className:'j-button primary',onClick:onGuardian},'Vérifier ma box avec Guardian')),
   h('section',{className:'j-card vl-map'},
    h('div',{className:'vl-map-head'},
     h('h2',null,'Abidjan maintenant'),
     h('div',{className:'sm-tools',role:'group','aria-label':'Orientation de la carte'},
      h('button',{type:'button',onClick:()=>setRot(r=>r-30),'aria-label':'Tourner à gauche'},'↺'),
      h('button',{type:'button',onClick:()=>setRot(r=>r+30),'aria-label':'Tourner à droite'},'↻'),
      h('button',{type:'button',onClick:()=>{setRot(-18);P(null);},'aria-label':'Revenir à mon quartier'},'⌂'))),
    h('div',{className:'vl-viewport'},window.FGSim3D?.Scene&&h(window.FGSim3D.Scene,{segments,incidents,rotation:rot,zoom:narrow?1.25:1.1,pan:[0,0],ratio:narrow?1:1.75,selected,onPick:P,compact:narrow})),
    h(Detail,{q}),
    h('ul',{className:'sm-legend'},[['calm','Tout va bien'],['warn','Internet ralenti'],['down','Panne ou coupure'],['ok','Rétabli']].map(([k,t])=>h('li',{key:k},h('i',{className:'is-'+k,'aria-hidden':true}),t)))),
   h('section',{className:'j-card vl-list'},
    h('h2',null,'Quartier par quartier'),
    v.others.length||(v.mine&&TOUCHED.includes(v.mine.state))?h('ul',{className:'vl-rows'},qs.filter(x=>TOUCHED.includes(x.state)).map(x=>h('li',{key:x.id},h('button',{type:'button',className:'vl-row'+(x.id===selected?' is-selected':''),'aria-pressed':x.id===selected,onClick:()=>P(x.id)},h(Dot,{state:x.state}),h('span',null,h('strong',null,where(x)),h('small',null,LABEL[x.state]+(x.retour?' · retour vers '+x.retour:''))),x.chezMoi&&h('span',{className:'vl-home-tag'},'Chez vous'))))):h('p',{className:'vl-empty'},'Aucune panne en ce moment.'),
    calm.length>0&&h('p',{className:'vl-calm'},h(Dot,{state:'normal'}),'Tout va bien à '+calm.map(x=>short(x)+(x.chezMoi?' (chez vous)':'')).join(', ')+'.'),
    h('p',{className:'vl-note'},'Moov montre seulement l’état de chaque quartier. Aucun nom ni numéro de client n’apparaît sur cette carte.')));
 }

 window.FGVille={Card,View,verdict};
})();
