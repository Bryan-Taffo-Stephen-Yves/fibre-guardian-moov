(function(){
 'use strict';
 // Application du technicien : « Mes missions ». Le serveur ne renvoie que les missions affectées à ce compte
 // (/noc/workspace, périmètre « assigned ») et revérifie chaque action ; cet écran ne fait que les présenter.
 const h=React.createElement,{useState:S,useEffect:E,useRef:R}=React;
 const STEPS=[['dispatched','Affectée'],['en_route','En route'],['on_site','Sur place'],['verifying','Vérification']];
 const NEXT={dispatched:{label:'Je pars',hint:'Le client verra votre fourgon arriver sur la carte.',confirm:'Confirmer le départ'},en_route:{label:'Je suis arrivé',hint:'Le client sera prévenu que vous êtes sur place.',confirm:'Confirmer l’arrivée'},on_site:{label:'C’est réparé',hint:'Moov vérifiera le retour du réseau avant de prévenir les clients.',confirm:'Confirmer la réparation'}};
 const STATUS={dispatched:'Mission affectée',en_route:'En route',on_site:'Sur place',verifying:'Moov vérifie le réseau',resolved:'Internet est revenu',closed:'Dossier clôturé'};
 const CAUSE={FIBER_CUT_DISTRIBUTION:'Câble de fibre coupé',ROADWORK_CUT:'Câble arraché par un chantier',CABINET_FLOOD:'Armoire de rue inondée',CABLE_THEFT:'Câble volé',OLT_FAILURE:'Équipement central en panne',UPLINK_CONGESTION:'Réseau très chargé',POWER_OUTAGE:'Courant coupé (CIE)',DROP_CABLE:'Câble tombé devant chez le client',POLE_DAMAGE:'Poteau endommagé',CABINET_OPEN:'Boîtier de rue abîmé'};
 function Icon({name,size=20}){const p={truck:'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4',pin:'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0',check:'m5 12 5 5 9-10',tool:'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5Z',flag:'M5 21V4h11l-2 4 2 4H5',clock:'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18',logout:'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',note:'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3',grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',arrow:'M5 12h14m-6-6 6 6-6 6',shield:'m12 3 8 3v6c0 6-8 9-8 9s-8-3-8-9V6Zm-4 9 3 3 5-6'}[name];
  return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,focusable:false},h('path',{d:p}));}
 function Face({name,size=44}){return window.FGRideMap?.Portrait?h(FGRideMap.Portrait,{name,size}):h('span',{className:'tv-face',style:{width:size,height:size}},(name||'?').slice(0,1));}
 const first=n=>(n||'').split(' ')[0];
 // Compte rendu en un geste : le technicien coche ce qu'il a fait, puis complète s'il veut.
 const REPORT_CHIPS=['Câble remplacé','Connecteur nettoyé','Soudure refaite','Box redémarrée','Lumière mesurée : -21 dBm','Client satisfait'];
 const hour=v=>v?new Date(v).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}).replace(':',' h '):'';
 const place=(m,segments)=>{const z=segments?.find(s=>s.id===m.segment)?.zone;return z?String(z).replace(/\s*·\s*/,' · '):m.segment||'Zone à confirmer';};

 function App({api,user,onLogout,onAbout,onTeam}){
  const [data,D]=S(null),[error,X]=S(''),[busy,BZ]=S(false),[pick,P]=S(null),[ask,A]=S(false),[note,NT]=S(''),[report,RP]=S(''),[toast,T]=S(''),alive=R(true);
  function load(){return api('/noc/workspace').then(r=>{if(alive.current){D(r);X('');}}).catch(e=>{if(alive.current)X(e.message||'Vos missions sont momentanément indisponibles.');});}
  E(()=>{alive.current=true;load();const t=setInterval(load,4000);addEventListener('fg-mission-ping',load);return()=>{alive.current=false;clearInterval(t);removeEventListener('fg-mission-ping',load);};},[]);
  E(()=>{if(!toast)return;const t=setTimeout(()=>T(''),3200);return()=>clearTimeout(t);},[toast]);
  async function act(m,type,extra={},done=''){if(busy)return false;BZ(true);X('');try{const r=await api('/noc/workspace/action','POST',{key:m.key,type,version:m.version,sourceVersion:m.sourceVersion,...extra});D(r);A(false);if(done)T(done);return true;}catch(e){X(e.message||'Action impossible pour le moment.');await load();return false;}finally{BZ(false);}}
  const missions=(data?.queue||[]).filter(m=>m.kind==='incident'),open=missions.filter(m=>!m.terminal),closed=missions.filter(m=>m.terminal);
  const current=open.find(m=>m.key===pick)||open.find(m=>['en_route','on_site'].includes(m.status))||open[0]||null;
  const segments=data?.network?.segments||[],live=current&&data?.network?.incidents?.find(i=>i.id===current.id);
  const me=data?.technicians?.[0],finished=!current&&closed.find(m=>m.status==='resolved'&&Date.now()-m.updatedAt<20*60000);
  return h('div',{className:'tv'},
   h('header',{className:'tv-head'},h('div',{className:'tv-who'},h(Face,{name:user.name,size:44}),h('div',null,h('small',null,me?.team||'Équipe terrain Moov'),h('strong',null,'Bonjour '+first(user.name)))),
    h('div',{className:'tv-head-actions'},window.FGDemo&&h(FGDemo.Badge,{onClick:onAbout}),h('button',{type:'button',className:'tv-icon-btn',onClick:onLogout,'aria-label':'Se déconnecter',title:'Se déconnecter'},h(Icon,{name:'logout'})))),
   h('main',{className:'tv-main',id:'main'},
    h('div',{className:'tv-title'},h('h1',null,'Mes missions'),h('p',null,open.length?open.length+' mission'+(open.length>1?'s':'')+' en cours aujourd’hui':'Aucune mission en cours')),
    error&&h('div',{className:'tv-error',role:'alert'},error,h('button',{type:'button',onClick:load},'Réessayer')),
    !data&&!error&&h('div',{className:'tv-card tv-loading',role:'status'},'Chargement de vos missions…'),
    data&&h('div',{className:'tv-grid'},
     h('div',{className:'tv-col'},current?mission(current):finished?doneCard(finished):h('section',{className:'tv-card tv-empty'},window.FGAvatar?h(FGAvatar.Sticker,{name:user.name,role:'tech',pose:'thumbs',size:130,say:'Tout est calme !'}):h('span',{className:'tv-empty-icon'},h(Icon,{name:'truck',size:30})),h('h2',null,'Pas de mission pour l’instant'),h('p',null,'Moov vous prévient ici dès qu’une intervention vous est confiée. Gardez l’application ouverte.'))),
     h('aside',{className:'tv-col'},day(),me&&h('section',{className:'tv-card tv-me'},h('h2',null,'Mon équipe'),h('div',{className:'tv-me-row'},h(Face,{name:me.name,size:40}),h('div',null,h('b',null,me.name),h('small',null,me.vehicle||me.team)),h('span',{className:'tv-chip'+(me.busy?' busy':'')},me.busy?'En mission':'Disponible')),h('div',{className:'tv-me-stats'},h('div',null,h('strong',null,String(me.rating).replace('.',',')),h('small',null,'Note clients')),h('div',null,h('strong',null,me.missions),h('small',null,'Interventions'))),onTeam&&h('button',{type:'button',className:'tv-link',onClick:onTeam},h(Icon,{name:'grid',size:17}),'Vue complète de l’équipe'))))),
   toast&&h('div',{className:'tv-toast',role:'status'},h(Icon,{name:'check',size:18}),toast));

  function mission(m){
   const step=STEPS.findIndex(([k])=>k===m.status),next=NEXT[m.status],list=m.checklist||[],left=list.filter(c=>!c.done).length,blocked=m.status==='on_site'&&left>0;
   return h(React.Fragment,null,
    h('section',{className:'tv-card tv-mission','data-status':m.status},
     h('div',{className:'tv-mission-top'},h('span',{className:'tv-live'},h('i'),STATUS[m.status]||m.statusLabel),h('small',null,'Affectée à '+hour(m.createdAt))),
     h('h2',null,place(m,segments)),
     h('p',{className:'tv-mission-sub'},m.plan?.cause?CAUSE[m.plan.cause]||m.title:m.title),
     h('ol',{className:'tv-steps','aria-label':'Étapes de la mission'},STEPS.map(([k,l],i)=>h('li',{key:k,className:i<step?'done':i===step?'on':''},h('span',null,i<step?h(Icon,{name:'check',size:14}):i+1),l))),
     next&&m.allowed?.advance?h('div',{className:'tv-action'},
      ask?h('div',{className:'tv-confirm'},m.status==='on_site'?reportBox():h('p',null,next.hint),h('div',null,h('button',{type:'button',className:'tv-btn ghost',onClick:()=>A(false),disabled:busy},'Annuler'),h('button',{type:'button',className:'tv-btn primary',onClick:()=>act(m,'advance',m.status==='on_site'?{confirm:true,report:report.trim()}:{confirm:true},m.status==='dispatched'?'Bonne route ! Le client vous voit arriver.':m.status==='en_route'?'Arrivée signalée au client.':'Compte rendu envoyé. Moov vérifie le réseau.').then(ok=>{if(ok&&m.status==='on_site')RP('');}),disabled:busy||(m.status==='on_site'&&report.trim().length<3)},busy?'Envoi…':next.confirm))):
      h('button',{type:'button',className:'tv-btn primary big',onClick:()=>A(true),disabled:busy||blocked},h(Icon,{name:m.status==='dispatched'?'truck':m.status==='en_route'?'pin':'check',size:22}),next.label),
      blocked&&h('p',{className:'tv-hint'},'Cochez d’abord '+(left>1?'les '+left+' consignes':'la consigne')+' ci-dessous.')):
     m.status==='verifying'?h('div',{className:'tv-wait'},h(Icon,{name:'clock',size:20}),h('p',null,'Merci ! Moov vérifie que les box du quartier se rallument. Vous serez prévenu ici.')):null,
     ['dispatched','en_route'].includes(m.status)&&h('div',{className:'tv-map'},live?.status==='en_route'&&live.position&&window.FGLiveTrip?h(FGLiveTrip.Card,{incident:live,compact:true,map:incident=>h(FGNoc.NetworkMap,{segments,incident})}):window.FGNoc?h(FGNoc.NetworkMap,{segments,incident:live||null}):null)),
    guardian(m),team(m,list,left),
    m.allowed?.note&&h('section',{className:'tv-card'},h('h2',null,'Note pour l’équipe'),h('form',{className:'tv-note',onSubmit:e=>{e.preventDefault();const body=note.trim();if(body)act(m,'note',{body},'Note envoyée à l’équipe.').then(ok=>{if(ok)NT('');});}},h('textarea',{value:note,onChange:e=>NT(e.target.value),rows:2,maxLength:1000,placeholder:'Ex. : câble arraché au carrefour, il faut une nacelle.','aria-label':'Note pour l’équipe'}),h('button',{type:'submit',className:'tv-btn',disabled:busy||!note.trim()},h(Icon,{name:'note',size:17}),'Envoyer'))));
  }
  // Ce que l'agent IA Guardian conseille, d'après l'analyse validée par un responsable Moov.
  function guardian(m){
   if(!m.plan)return null;
   return h('section',{className:'tv-card tv-ai'},
    h('div',{className:'tv-ai-head'},h('span',{className:'tv-ai-orb','aria-hidden':true}),h('div',null,h('small',null,'Agent IA Guardian'),h('h2',null,'Guardian vous guide'))),
    h('p',{className:'tv-ai-title'},m.plan.title),
    m.plan.steps?.length>0&&h('ol',{className:'tv-ai-steps'},m.plan.steps.map((v,k)=>h('li',{key:k},h('span',null,k+1),h('p',null,v)))),
    h('div',{className:'tv-plan-meta'},h('span',null,h(Icon,{name:'shield',size:16}),'Plan validé par un responsable Moov')));
  }
  // Consignes à cocher et messages de l'équipe Moov (centre d'opérations).
  function team(m,list,left){
   const msgs=(m.notes||[]).filter(n=>n.author!==user.name&&!/^Compte rendu/.test(n.body)).slice(-3);
   return h('section',{className:'tv-card tv-team'},
    h('div',{className:'tv-row'},h('h2',null,'Consignes de l’équipe Moov'),list.length>0&&h('span',{className:'tv-count'},(list.length-left)+'/'+list.length)),
    list.length?h('ul',{className:'tv-checklist'},list.map(c=>h('li',{key:c.id},h('label',{className:c.done?'done':''},h('input',{type:'checkbox',checked:c.done,disabled:busy||!m.allowed?.check,onChange:e=>act(m,'check',{itemId:c.id,done:e.target.checked})}),h('span',{className:'tv-box','aria-hidden':true},h(Icon,{name:'check',size:15})),h('span',null,c.body,h('small',null,c.done&&c.completedBy?'Fait par '+c.completedBy+(c.completedAt?' à '+hour(c.completedAt):''):'De '+c.author)))))):
     h('p',{className:'tv-muted'},'Pas encore de consigne. Elles s’affichent ici dès que l’équipe Moov en ajoute.'),
    msgs.length>0&&h('ul',{className:'tv-msgs','aria-label':'Messages de l’équipe'},msgs.map(n=>h('li',{key:n.id},h(Face,{name:n.author,size:30}),h('div',null,h('b',null,first(n.author)+' · '+hour(n.at)),h('p',null,n.body))))));
  }
  function reportBox(){
   const add=t=>RP(v=>v.toLowerCase().includes(t.toLowerCase())?v:v.trim()?v.trim().replace(/\.$/,'')+', '+t.charAt(0).toLowerCase()+t.slice(1)+'.':t+'.');
   return h('div',{className:'tv-report'},h('p',null,'Votre compte rendu pour l’équipe Moov :'),
    h('div',{className:'tv-chips'},REPORT_CHIPS.map(t=>h('button',{type:'button',key:t,className:'tv-chip-btn'+(report.toLowerCase().includes(t.toLowerCase())?' on':''),onClick:()=>add(t)},t))),
    h('textarea',{value:report,onChange:e=>RP(e.target.value),rows:3,maxLength:1000,placeholder:'Ex. : câble arraché remplacé sur 12 m, lumière revenue chez la cliente.','aria-label':'Compte rendu de l’intervention'}),
    h('small',{className:'tv-muted'},'Moov vérifiera ensuite que les box se reconnectent.'));
  }
  function doneCard(m){
   const rep=(m.notes||[]).filter(n=>/^Compte rendu/.test(n.body)).pop();
   return h('section',{className:'tv-card tv-done'},h('span',{className:'tv-done-icon'},h(Icon,{name:'check',size:30})),h('h2',null,'Mission terminée, bravo !'),h('p',null,'Internet est revenu à '+place(m,segments)+'. Moov a vérifié les box du quartier.'),rep&&h('blockquote',null,rep.body.replace(/^Compte rendu : /,'')),h('small',{className:'tv-muted'},'Vous serez prévenu ici dès qu’une nouvelle mission vous est confiée.'));
  }
  function day(){
   const rows=[...open,...closed].slice(0,8);
   return h('section',{className:'tv-card tv-day'},h('div',{className:'tv-row'},h('h2',null,'Missions du jour'),h('span',{className:'tv-count'},closed.length+' terminée'+(closed.length>1?'s':''))),
    rows.length?h('ul',null,rows.map(m=>h('li',{key:m.key},h('button',{type:'button',className:'tv-day-row'+(current&&m.key===current.key?' on':''),disabled:m.terminal,onClick:()=>{P(m.key);A(false);scrollTo({top:0,behavior:'smooth'});}},h('span',{className:'tv-dot '+(m.terminal?'done':m.status)}),h('span',null,h('b',null,place(m,segments)),h('small',null,(STATUS[m.status]||m.statusLabel)+' · '+hour(m.updatedAt))),!m.terminal&&h(Icon,{name:'arrow',size:17}))))):h('p',{className:'tv-muted'},'Vos interventions de la journée apparaîtront ici.'));
  }
 }
 window.FGTech={App};
})();
