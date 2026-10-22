/* Suivi du technicien en direct, partagé par l'espace client, l'espace Moov, la scène du jury et le lien de suivi.
   Présentation des applications de VTC : la carte du quartier en grand (2D ou 3D) avec la camionnette qui roule,
   puis une feuille « Arrivée dans 3 min », la fiche du technicien (portrait, note, véhicule, plaque)
   et les actions Appeler, Message et Partager le suivi.
   Le serveur donne l'état et l'avancement du trajet ; l'écran fait avancer le véhicule en continu entre deux relevés. */
(function(){
 'use strict';
 const h=React.createElement,{useState:S,useEffect:E,useRef:R,useCallback:CB}=React;
 const HM=new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Abidjan',hour:'numeric',minute:'2-digit'});
 const hm=t=>HM.format(t).replace(/^0?(\d+):(\d+)/,'$1 h $2');
 const km1=n=>(Math.round(n*10)/10).toFixed(1).replace('.',',');
 const reduced=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 // « 1 min 20 s », « 45 s ».
 function left(ms){const s=Math.max(0,Math.ceil(ms/1000));if(s<60)return s+' s';const m=Math.floor(s/60),r=s%60;return m+' min'+(r?' '+String(r).padStart(2,'0')+' s':'');}
 // Le trajet de démonstration dure 30 s : sous la minute, on compte les secondes.
 const etaMin=ms=>ms<1000?'Il arrive':ms<60000?Math.ceil(ms/1000)+' s':Math.max(1,Math.ceil(ms/60000))+' min';
 const firstName=name=>String(name||'').split(/\s+/)[0];
 const initials=name=>String(name||'T').split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
 const store={get(k){try{return localStorage.getItem(k);}catch{return null;}},set(k,v){try{localStorage.setItem(k,v);}catch{}}};

 function Icon({d,size=22}){return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.9,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,focusable:false},h('path',{d}));}
 const I={phone:'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',chat:'M4 5h16v11H9l-5 4Z',share:'M12 3v12M7 8l5-5 5 5M5 13v7h14v-7',route:'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4M6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8',star:'m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7Z',close:'m6 6 12 12M18 6 6 18',send:'M4 12 20 4l-6 16-3-7Z',cube:'M12 3 20 7.5v9L12 21l-8-4.5v-9ZM12 12l8-4.5M12 12v9M12 12 4 7.5',map:'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2Zm0 0v14m6-12v14',check:'m5 12 5 5 9-10',shield:'m12 3 8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6Z'};

 // Avancement : on part de la valeur du serveur et on avance au rythme de l'horloge de l'appareil.
 function useProgress(i){
  const pos=i.status==='en_route'?i.position:null,anchor=R(null);
  const key=pos?pos.progress+':'+pos.departedAt:i.status;
  if(!anchor.current||anchor.current.key!==key)anchor.current={key,progress:pos?.progress||0,at:Date.now(),dur:pos?.durationMs||120000,status:i.status};
  const get=CB(()=>{const a=anchor.current;if(a.status==='dispatched')return 0;if(a.status!=='en_route')return 1;return Math.min(1,a.progress+(Date.now()-a.at)/a.dur);},[]);
  const [,tick]=S(0);E(()=>{const t=setInterval(()=>tick(v=>v+1),1000);return()=>clearInterval(t);},[]);
  const p=get();return {p,get,remaining:(1-p)*anchor.current.dur};
 }

 function useDialog(onClose){const ref=R(null);E(()=>{const prev=document.activeElement;ref.current?.focus();const k=e=>{if(e.key==='Escape')onClose();};addEventListener('keydown',k);return()=>{removeEventListener('keydown',k);prev?.focus?.();};},[]);return ref;}

 // Appel : l'écran d'appel reste dans l'application (voir « À propos de la démo »).
 function CallSheet({tech,onClose}){
  const [sec,T]=S(0),[state,ST]=S('ringing'),close=useDialog(onClose);
  E(()=>{const a=setTimeout(()=>ST('live'),2200),t=setInterval(()=>T(v=>v+1),1000);return()=>{clearTimeout(a);clearInterval(t);};},[]);
  const talk=Math.max(0,sec-2),mm=String(Math.floor(talk/60)).padStart(2,'0')+':'+String(talk%60).padStart(2,'0');
  return h('div',{className:'lt-call',role:'dialog','aria-modal':'true','aria-label':'Appel à '+tech.name},
   h('div',{className:'lt-call-card'},
    h('span',{className:'lt-call-avatar'+(state==='ringing'&&!reduced()?' is-ringing':'')},h(FGRideMap.Portrait,{name:tech.name,size:104})),
    h('strong',null,tech.name),h('span',{className:'lt-call-number'},tech.phone||''),
    h('span',{className:'lt-call-state',role:'status'},state==='ringing'?'Appel en cours…':'En ligne · '+mm),
    state==='live'&&h('p',null,'« Bonjour, ici '+firstName(tech.name)+' de Moov. Je suis en route, j’arrive très vite. »'),
    h('button',{type:'button',ref:close,className:'lt-hangup',onClick:onClose,'aria-label':'Raccrocher'},h(Icon,{d:I.phone,size:26}))));
 }

 // Messages au technicien : réponses rapides, il répond après quelques secondes (voir « À propos de la démo »).
 const QUICK=['Je suis à la maison','Le portail est bleu','Appelez-moi en arrivant','Combien de temps encore ?'];
 function answer(text,first,eta){
  if(/combien|temps|quand/i.test(text))return eta?'Encore '+eta+' environ. La circulation est fluide.':'J’arrive dans un instant.';
  if(/portail|maison|porte|immeuble/i.test(text))return 'Bien reçu, merci ! Je repère l’entrée en arrivant.';
  if(/appel/i.test(text))return 'D’accord, je vous appelle juste avant d’arriver.';
  return 'Bien reçu. À tout de suite, '+first+' de Moov.';
 }
 function MessageSheet({tech,etaText,keyId,onClose}){
  const first=firstName(tech.name),storeKey='fg-chat-'+keyId;
  const [log,L]=S(()=>{try{return JSON.parse(store.get(storeKey)||'[]');}catch{return [];}}),[typing,T]=S(false),[text,X]=S(''),close=useDialog(onClose),end=R(null);
  E(()=>{store.set(storeKey,JSON.stringify(log.slice(-30)));end.current?.scrollIntoView({block:'end'});},[log,typing]);
  function send(value){const v=value.trim();if(!v)return;const at=Date.now();L(l=>[...l,{who:'me',text:v,at}]);X('');T(true);setTimeout(()=>{T(false);L(l=>[...l,{who:'tech',text:answer(v,first,etaText),at:Date.now()}]);},reduced()?400:1800);}
  return h('div',{className:'lt-msg-overlay',onClick:e=>{if(e.target===e.currentTarget)onClose();}},
   h('section',{className:'lt-msg',role:'dialog','aria-modal':'true','aria-label':'Messages avec '+tech.name},
    h('header',{className:'lt-msg-head'},h(FGRideMap.Portrait,{name:tech.name,size:42}),h('div',null,h('strong',null,tech.name),h('small',null,'Technicien Moov · répond en général en 1 min')),h('button',{type:'button',ref:close,className:'lt-msg-close',onClick:onClose,'aria-label':'Fermer les messages'},h(Icon,{d:I.close,size:18}))),
    h('div',{className:'lt-msg-log','aria-live':'polite'},
     h('p',{className:'lt-msg-note'},h(Icon,{d:I.shield,size:14}),'Votre numéro reste masqué. Les messages passent par Moov.'),
     !log.length&&h('div',{className:'lt-bubble tech'},'Bonjour, c’est '+first+'. Je m’occupe de votre intervention. Une précision pour trouver votre adresse ?'),
     log.map((m,n)=>h('div',{key:n,className:'lt-bubble '+m.who},m.text,h('time',null,hm(m.at)))),
     typing&&h('div',{className:'lt-bubble tech lt-typing','aria-label':first+' écrit…'},h('i'),h('i'),h('i')),
     h('span',{ref:end})),
    h('div',{className:'lt-msg-quick'},QUICK.map(q=>h('button',{type:'button',key:q,onClick:()=>send(q)},q))),
    h('form',{className:'lt-msg-form',onSubmit:e=>{e.preventDefault();send(text);}},
     h('label',{className:'j-sr',htmlFor:'lt-msg-input'},'Votre message'),
     h('input',{id:'lt-msg-input',value:text,onChange:e=>X(e.target.value),placeholder:'Écrire à '+first+'…',maxLength:300,autoComplete:'off'}),
     h('button',{type:'submit','aria-label':'Envoyer',disabled:!text.trim()},h(Icon,{d:I.send,size:18})))));
 }

 // Fiche du technicien : portrait, note, nombre d'interventions, véhicule et plaque.
 function Driver({tech}){
  const [model,plate]=String(tech.vehicle||'').split(/\s·\s/);
  return h('div',{className:'lt-driver'},
   h('span',{className:'lt-driver-photo'},h(FGRideMap.Portrait,{name:tech.name,size:58}),tech.rating&&h('b',{className:'lt-driver-rating'},h(Icon,{d:I.star,size:11}),String(tech.rating).replace('.',','))),
   h('div',{className:'lt-driver-main'},h('strong',null,tech.name),h('span',null,model?model+' blanc':'Technicien Moov'),tech.missions&&h('small',null,tech.missions+' interventions réussies')),
   plate&&h('span',{className:'lt-plate',title:'Plaque d’immatriculation'},plate));
 }

 /* incident : { id, status, segment|segment_id, position, technician, events }.
    compact : version réduite (console Moov). api : permet de créer un lien de suivi à partager. */
 function Card({incident:i,compact,api,shareUrl,hero}){
  const {p,get,remaining}=useProgress(i);
  const [call,C]=S(false),[chat,CH]=S(false),[details,D]=S(false),[mode,MD]=S(()=>store.get('fg-ride-mode')||'3d'),[shared,SH]=S('');
  const at=kind=>(i.events||[]).filter(e=>e.kind===kind).map(e=>e.at).pop()||null;
  const order=['dispatched','en_route','on_site','verifying','resolved'],rank=order.indexOf(i.status);
  const arrived=rank>=2||(i.status==='en_route'&&p>=1),moving=i.status==='en_route'&&!arrived;
  const pos=i.position||{},src=i.technician||{};
  const tech={name:pos.technician||src.name||'Votre technicien',team:pos.team||src.team||'',phone:pos.phone||src.phone||'',rating:pos.rating||src.rating||null,missions:pos.missions||src.missions||null,vehicle:pos.vehicle||src.vehicle||''};
  const first=firstName(tech.name),segment=i.segment||i.segment_id,km=pos.distanceKm||0,pct=Math.round(p*100),now=Date.now();
  const big=i.status==='dispatched'?'Départ imminent':arrived?first+' est arrivé':etaMin(remaining);
  const title=i.status==='dispatched'?first+' se prépare à partir':arrived?'Votre technicien est devant chez vous':'Arrivée de '+first;
  const sub=i.status==='dispatched'?'Départ de l’'+(FGRideMap.place(segment).base)+'. Vous serez prévenu.':arrived?'L’intervention commence.':'Vers '+hm(now+remaining)+' · encore '+km1(km*(1-p))+' km';
  const steps=[
   {k:'dispatched',t:'Technicien affecté',at:at('dispatched'),s:tech.team},
   {k:'en_route',t:'Départ',at:at('en_route'),s:rank>=1?'Départ de l’agence':'Pas encore parti'},
   {k:'road',t:'En route',s:arrived?'Trajet terminé':rank===1?'Encore '+left(remaining):'',done:arrived},
   {k:'on_site',t:'Arrivée',at:at('on_site'),s:arrived?'Sur place':''},
   {k:'verifying',t:'Réparation terminée',at:at('verifying'),s:rank>=3?'Vérification de votre connexion':''}
  ].map(s=>({...s,done:s.done!==undefined?s.done:rank>=order.indexOf(s.k)&&order.indexOf(s.k)>=0}));
  const current=steps.findIndex(s=>!s.done);
  function toggleMode(){const next=mode==='3d'?'2d':'3d';MD(next);store.set('fg-ride-mode',next);}
  async function share(){
   try{
    const url=shareUrl||(await api('/track/link','POST',{id:i.id})).url,full=new URL(url,location.href).href;
    if(navigator.share){await navigator.share({title:'Suivi de mon technicien Moov',text:first+' arrive pour réparer ma fibre. Suivez son trajet :',url:full});SH('Lien partagé');}
    else{await navigator.clipboard.writeText(full);SH('Lien copié');}
   }catch(e){if(e?.name!=='AbortError')SH(e?.message||'Partage impossible pour le moment');}
   setTimeout(()=>SH(''),3500);
  }
  return h('section',{className:'lt lt--live'+(compact?' lt--compact':'')+(hero?' lt--hero':''),'aria-label':'Suivi du technicien en direct'},
   h('div',{className:'lt-stage'},
    h(FGRideMap.Map,{getProgress:get,segment,mode,etaLabel:etaMin(remaining),arrived,label:title}),
    h('span',{className:'lt-badge'+(reduced()?' is-still':'')},h('i'),arrived?'Arrivé':moving?'En direct':'Préparation'),
    h('button',{type:'button',className:'lt-mode',onClick:toggleMode,'aria-label':mode==='3d'?'Passer en vue 2D':'Passer en vue 3D'},h(Icon,{d:mode==='3d'?I.map:I.cube,size:18}),mode==='3d'?'2D':'3D')),
   h('div',{className:'lt-sheet'},
    h('span',{className:'lt-grabber','aria-hidden':true}),
    h('div',{className:'lt-eta-row'},
     h('div',null,h('span',{className:'lt-kicker'},title),h('strong',{className:'lt-big',role:'status','aria-live':'polite'},big),h('span',{className:'lt-sub'},sub)),
     moving&&h('span',{className:'lt-eta-clock','aria-hidden':true},h('b',null,hm(now+remaining)),h('small',null,'arrivée'))),
    h('div',{className:'lt-bar',role:'progressbar','aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':pct,'aria-label':'Trajet parcouru : '+pct+' %'},h('i',{style:{width:pct+'%'}})),
    h(Driver,{tech}),
    h('div',{className:'lt-actions'},
     h('button',{type:'button',className:'lt-act lt-act--primary',onClick:()=>C(true),disabled:!tech.phone},h('span',{className:'lt-act-ico'},h(Icon,{d:I.phone})),h('span',null,'Appeler')),
     h('button',{type:'button',className:'lt-act',onClick:()=>CH(true)},h('span',{className:'lt-act-ico'},h(Icon,{d:I.chat})),h('span',null,'Message')),
     (api||shareUrl)&&!compact&&h('button',{type:'button',className:'lt-act',onClick:share},h('span',{className:'lt-act-ico'},h(Icon,{d:I.share})),h('span',null,'Partager')),
     h('button',{type:'button',className:'lt-act',onClick:()=>D(!details),'aria-expanded':details},h('span',{className:'lt-act-ico'},h(Icon,{d:I.route})),h('span',null,'Étapes'))),
    shared&&h('p',{className:'lt-toast',role:'status'},h(Icon,{d:I.check,size:16}),shared),
    details&&h('ol',{className:'lt-steps','aria-label':'Étapes de l’intervention'},steps.map((s,k)=>{const state=s.done?'done':k===current?'now':'next';
     return h('li',{key:s.k,className:'lt-step '+state,'aria-current':state==='now'?'step':undefined},
      h('span',{className:'lt-dot','aria-hidden':true},s.done?h(Icon,{d:I.check,size:13}):''),
      h('span',{className:'lt-step-t'},h('b',null,s.t),h('span',{className:'j-sr'},state==='done'?' (fait)':state==='now'?' (en cours)':' (à venir)'),s.s&&h('small',null,s.s)),
      h('span',{className:'lt-step-h'},s.done&&s.at?hm(s.at):''));}))),
   call&&h(CallSheet,{tech,onClose:()=>C(false)}),
   chat&&h(MessageSheet,{tech,etaText:moving?etaMin(remaining):'',keyId:i.id||'suivi',onClose:()=>CH(false)}));
 }

 // Page ouverte depuis le lien de suivi (message WhatsApp ou SMS) : sans compte, en lecture seule.
 function Public({token}){
  const [data,D]=S(null),[error,X]=S('');
  E(()=>{let alive=true;async function load(){try{const r=await fetch('/api/track/'+encodeURIComponent(token),{headers:{Accept:'application/json'}});const j=await r.json();if(!r.ok)throw new Error(j.error||'Lien de suivi indisponible.');if(alive){D(j);X('');}}catch(e){if(alive)X(e.message);}}load();const t=setInterval(load,5000);return()=>{alive=false;clearInterval(t);};},[token]);
  const i=data?.incident,live=i&&['dispatched','en_route','on_site'].includes(i.status);
  return h('main',{className:'lt-public'},
   h('header',{className:'lt-public-head'},h('span',{className:'lt-public-logo','aria-hidden':true},'M'),h('div',null,h('strong',null,'Moov Africa · Fibre'),h('small',null,'Suivi de votre technicien'))),
   error&&!data&&h('div',{className:'lt-public-empty',role:'alert'},h('h1',null,'Ce lien n’est plus valable'),h('p',null,error),h('a',{className:'j-button primary',href:'./'},'Ouvrir Fibre Guardian')),
   !data&&!error&&h('div',{className:'lt-public-empty',role:'status'},h('p',null,'Chargement du suivi…')),
   live&&h(Card,{incident:i,shareUrl:location.href}),
   i&&!live&&h('div',{className:'lt-public-empty'},h('h1',null,['verifying','resolved'].includes(i.status)?'Intervention terminée':'Intervention en préparation'),h('p',null,['verifying','resolved'].includes(i.status)?'Votre connexion est en cours de vérification. Merci de votre patience.':'Un technicien va être affecté. Ce lien affichera son trajet dès son départ.'),h('a',{className:'j-button primary',href:'./'},'Ouvrir Fibre Guardian')));
 }
 const route=(href=location.href)=>new URL(href).searchParams.get('suivi')||'';
 window.FGLiveTrip={Card,Public,route,left};
})();
