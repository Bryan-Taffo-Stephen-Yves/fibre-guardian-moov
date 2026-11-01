/* « Le jury vit la panne » et la régie dans la poche.
   - Membre du jury (?jury=CODE) : le téléphone devient celui d'un abonné anonyme de Yopougon. À la coupure,
     il vibre et sonne avec le message de Guardian, suit le technicien, reçoit un certificat de réparation et note.
   - Régie (?section=regie) : un téléphone de l'administrateur déclenche chaque scène et remet tout à zéro.
     Le serveur revérifie le rôle à chaque appel ; l'écran ne fait que proposer les boutons.
   - Réseau de démo : la salle porte le nom du partage de connexion de l'équipe, qui joue la box du quartier.
     La panne (fibre ou courant) est jouée sur la copie de ce Wi-Fi ; les inscrits sont prévenus quand un responsable valide. */
(function(){
 'use strict';
 const h=React.createElement,{useState:S,useEffect:E,useRef:R}=React;
 const HM=new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Abidjan',hour:'numeric',minute:'2-digit'});
 const hm=t=>t?HM.format(t).replace(/^0?(\d+):(\d+)/,'$1 h $2'):'';
 const DAY=new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Abidjan',day:'numeric',month:'long',year:'numeric'});
 const firstName=name=>String(name||'Votre technicien').split(/\s+/)[0];
 const B=(label,onClick,props={})=>h('button',{type:'button',onClick,...props},label);

 // Appels à l'API, avec le jeton anti-falsification de la session en cours.
 function useApi(){
  const csrf=R('');
  async function api(path,method='GET',body){
   const r=await fetch('/api'+path,{method,credentials:'same-origin',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json',...(csrf.current?{'X-CSRF-Token':csrf.current}:{})},body:body===undefined?undefined:JSON.stringify(body)});
   const data=await r.json().catch(()=>({}));
   if(!r.ok){const e=new Error(data.error||'Service momentanément indisponible.');e.status=r.status;throw e;}
   if(data.user?.csrf)csrf.current=data.user.csrf;
   return data;
  }
  return {api,csrf};
 }

 // Son, vibration et écran allumé : le navigateur ne les autorise qu'après un geste de la personne.
 const signal={
  ctx:null,ready:false,lock:null,
  unlock(){
   try{const A=window.AudioContext||window.webkitAudioContext;if(A&&!this.ctx)this.ctx=new A();this.ctx?.resume?.();}catch(_){}
   try{navigator.vibrate?.(40);}catch(_){}
   this.ready=true;this.awake();
  },
  awake(){try{if(navigator.wakeLock&&!this.lock)navigator.wakeLock.request('screen').then(l=>{this.lock=l;l.addEventListener?.('release',()=>{this.lock=null;});}).catch(()=>{});}catch(_){}},
  tone(freq,start,length,volume=.18){const c=this.ctx;if(!c)return;const o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.value=freq;g.gain.setValueAtTime(.0001,c.currentTime+start);g.gain.exponentialRampToValueAtTime(volume,c.currentTime+start+.02);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+start+length);o.connect(g).connect(c.destination);o.start(c.currentTime+start);o.stop(c.currentTime+start+length+.05);},
  alarm(){try{navigator.vibrate?.([400,150,400,150,800]);}catch(_){}try{this.ctx?.resume?.();for(let k=0;k<3;k++){this.tone(880,k*.7,.25);this.tone(660,k*.7+.3,.3);}}catch(_){}},
  chime(){try{navigator.vibrate?.([120,80,120]);}catch(_){}try{this.ctx?.resume?.();this.tone(660,0,.18,.12);this.tone(990,.2,.3,.12);}catch(_){}}
 };
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&signal.ready)signal.awake();});

 function Header({right,onAbout}){
  return h('header',{className:'jy-top'},
   h('span',{className:'jy-brand'},h('span',{className:'jy-mark','aria-hidden':true},h(Mark)),h('span',null,h('strong',null,'Fibre Guardian'),h('small',null,'Moov Africa'))),
   h('span',{className:'jy-top-right'},right,window.FGDemo&&h(window.FGDemo.Badge,{onClick:onAbout})));
 }
 function Robot(){return window.FGJourney?.Robot?h(window.FGJourney.Robot,{small:true}):null;}
 function Mark(){return h('svg',{viewBox:'0 0 24 24','aria-hidden':true},h('path',{d:'M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z'}),h('path',{className:'jy-mark-check',d:'m8.5 12 2.5 2.5 4.5-5'}));}
 function Bubble({children,tone}){return h('div',{className:'jy-bubble'+(tone?' jy-bubble--'+tone:'')},h('span',{className:'jy-bubble-who'},h('span',{className:'jy-mark jy-mark--round'},h(Mark)),h('span',null,h('b',null,'Guardian'),h('small',null,'Votre assistant Moov'))),h('p',null,children));}

 // ---------- Membre du jury ----------
 const STAGES=[['detected','Coupure détectée'],['plan.approved','Plan validé par Moov'],['dispatched','Technicien affecté'],['en_route','En route'],['on_site','Sur place'],['resolved','Connexion rétablie']];
 const RANK={reported:0,proposed:0,rejected:0,approved:1,dispatched:2,en_route:3,on_site:4,verifying:4,resolved:5,closed:5};
 // Coupure de courant : personne à envoyer, les box repartent toutes seules au retour du courant.
 const POWER_STAGES=[['detected','Coupure de courant détectée'],['plan.approved','Confirmée par Moov'],['resolved','Courant et connexion revenus']];
 const POWER_RANK={reported:0,proposed:0,rejected:0,approved:1,verifying:1,resolved:2,closed:2};
 const isPower=scene=>scene?.cause==='POWER_OUTAGE';
 function guardianSays(scene,segment){
  const tech=firstName(scene.technician?.name||scene.position?.technician),down=Math.max(0,(segment?.total||0)-(segment?.online||0));
  // Dossier clôturé sans réparation : tout est revenu à la normale (avant le départ, ou la mission s'est arrêtée).
  if(scene.status==='closed')return scene.technician?'Tout est revenu à la normale : la mission de '+tech+' s’arrête. Votre connexion fonctionne, vous n’avez rien à faire.':'Tout est revenu à la normale avant même le départ d’un technicien. Votre connexion fonctionne, vous n’avez rien à faire.';
  if(isPower(scene)&&scene.status!=='resolved')return 'Le courant est coupé dans votre quartier : ce n’est pas votre box. Elle repartira toute seule au retour du courant. Vous n’avez rien à faire : je vous préviens dès que tout est revenu.';
  const cause=scene.cause==='UPLINK_CONGESTION'?'Le réseau de votre quartier est très chargé : ce n’est pas votre box.':'Ce n’est pas votre box : le câble fibre de votre quartier est touché.';
  return ({
   dispatched:tech+' est affecté à votre quartier. Il prépare son matériel et part tout de suite.',
   en_route:tech+' est en route. Suivez son arrivée sur la carte, minute par minute.',
   on_site:tech+' est arrivé. Il répare le câble ; je surveille le retour du signal.',
   verifying:'La réparation est faite. Je vérifie que la connexion revient chez tout le monde.',
   resolved:'Votre connexion est rétablie et vérifiée. Merci pour votre patience !'
  })[scene.status]||cause+(down?' '+down+' foyers sont concernés.':'')+' Moov est déjà prévenu et prépare l’intervention. Vous n’avez pas à vous inquiéter : je vous préviens à chaque étape.';
 }
 const TOASTS={dispatched:t=>t+' est affecté à votre quartier',en_route:t=>t+' est en route vers vous',on_site:t=>t+' est arrivé dans votre quartier',verifying:()=>'Réparation terminée, vérification en cours',resolved:()=>'Connexion rétablie et vérifiée'};

 function Certificate({c}){
  // Coupure de courant : rien n'a été réparé et personne n'est venu, le courant est revenu.
  const power=c.cause==='POWER_OUTAGE';
  const rows=[['Quartier',c.zone],[power?'Coupure de courant détectée':'Coupure détectée',hm(c.detectedAt)],!power&&['Technicien sur place',c.arrivedAt?hm(c.arrivedAt)+(c.technician?' · '+c.technician:''):'—'],['Connexion rétablie',hm(c.restoredAt)],['Durée totale',c.durationMin+' min'],['Mesures du quartier',c.online!=null?c.online+' foyers sur '+c.total+' en ligne':'Vérifiées'],['Vérifié par',c.verifiedBy]].filter(Boolean);
  return h('section',{className:'jy-cert','aria-label':'Certificat de réparation'},
   h('div',{className:'jy-cert-head'},h('span',{className:'jy-seal','aria-hidden':true},h('svg',{viewBox:'0 0 48 48'},h('circle',{cx:24,cy:24,r:20}),h('path',{d:'m15 24 6 6 12-12'}))),h('div',null,h('small',null,power?'CERTIFICAT DE RETOUR DU SERVICE':'CERTIFICAT DE RÉPARATION'),h('strong',null,power?'Le courant et votre connexion sont revenus':'Votre fibre est réparée'),h('span',null,'Référence '+c.reference))),
   h('dl',{className:'jy-cert-rows'},rows.map(([k,v])=>h('div',{key:k},h('dt',null,k),h('dd',null,v)))),
   h('p',{className:'jy-cert-sign'},'Signé par Guardian, le '+DAY.format(c.restoredAt||Date.now())+'.'));
 }

 function Stages({scene}){
  // Chaque étape garde l'heure où elle a eu lieu la première fois : une nouvelle analyse ne fait pas reculer la frise.
  const power=isPower(scene),list=power?POWER_STAGES:STAGES,closed=scene.status==='closed',first=k=>(scene.events||[]).find(e=>e.kind===k)?.at||null;
  const when=k=>first(k)||(closed&&k==='resolved'?first('closed'):null);
  const rank=Math.max((power?POWER_RANK:RANK)[scene.status]??0,first('plan.approved')?1:0);
  return h('ol',{className:'jy-stages','aria-label':'Étapes de l’intervention'},list.map(([k,label],n)=>{
    // Dossier clôturé avant la fin : seules les étapes qui ont vraiment eu lieu sont cochées.
    const state=closed?(when(k)?'done':'skip'):n<rank||(n===rank&&scene.status==='resolved')?'done':n===rank?'now':'next';
    return h('li',{key:k,className:'jy-stage '+(state==='skip'?'next is-skip':state),'aria-current':state==='now'?'step':undefined},h('span',{className:'jy-stage-dot','aria-hidden':true},state==='done'?'✓':''),h('span',{className:'jy-stage-label'},label,h('span',{className:'j-sr'},state==='done'?' (fait)':state==='now'?' (en cours)':state==='skip'?' (pas nécessaire)':' (à venir)')),h('small',null,state==='skip'?'Pas nécessaire':state!=='next'?hm(when(k)):''));}));
 }

 function Juror({code}){
  const {api}=useApi();
  const [phase,P]=S('loading'),[me,M]=S(null),[error,X]=S(''),[busy,BZ]=S(false),[consent,C]=S(false),[first,F]=S(''),[phone,PH]=S(''),[places,PL]=S(0),[ready,RD]=S(signal.ready),[about,AB]=S(false),[toast,T]=S(''),[alerting,AL]=S(null);
  const last=R(null),failures=R(0),toastTimer=R(0),alertingRef=R(null),firstRef=R(null),phoneRef=R(null),errorRef=R(null);
  // Une erreur sur le prénom ou le numéro s'affiche sous son champ ; les autres juste au-dessus du bouton, toujours à l'écran.
  const firstError=phase==='join'&&!!error&&/prénom/i.test(error),phoneError=phase==='join'&&!!error&&!firstError&&places>0&&/WhatsApp/.test(error);
  E(()=>{if(phase!=='join'||!error)return;requestAnimationFrame(()=>{if(firstError)firstRef.current?.focus();else if(phoneError)phoneRef.current?.focus();else errorRef.current?.scrollIntoView({block:'center'});});},[error,phase]);
  // Places WhatsApp de la salle (0 : le champ n'apparaît pas, l'alerte arrive seulement sur cette page).
  E(()=>{if(phase!=='join'||!code)return;let live=true;api('/jury/places').then(r=>{if(live)PL(r.whatsapp||0);}).catch(()=>{});return()=>{live=false;};},[phase]);
  const ackKey='fg-jury-vu';
  const acked=id=>{try{return sessionStorage.getItem(ackKey)===id;}catch(_){return false;}};
  async function load(){
   try{const m=await api('/jury/me');failures.current=0;M(m);P('joined');X('');react(m);}
   catch(e){if(e.status===401||e.status===404){failures.current++;if(failures.current>4||phase!=='joined'){P('join');if(phase==='joined')X('Votre accès a expiré. Scannez à nouveau le code affiché.');}}else X('Connexion au réseau interrompue. Nouvel essai dans un instant.');}
  }
  // Alerte à la coupure, puis un signal plus doux à chaque étape.
  function react(m){
   const s=m.scene,prev=last.current;last.current=s?{id:s.id,status:s.status}:null;
   if(!s)return;
   if(!s.terminal&&!acked(s.id)){if(alertingRef.current!==s.id){alertingRef.current=s.id;AL(s.id);signal.alarm();}return;}
   if(prev&&prev.id===s.id&&prev.status!==s.status&&TOASTS[s.status]){signal.chime();clearTimeout(toastTimer.current);T(TOASTS[s.status](firstName(s.technician?.name||s.position?.technician)));toastTimer.current=setTimeout(()=>T(''),6000);}
  }
  E(()=>{let live=true;api('/session').then(r=>{if(!live)return;if(r.user)load();else P('join');}).catch(()=>{if(live){P('join');X('Service momentanément indisponible. Réessayez dans un instant.');}});return()=>{live=false;};},[]);
  E(()=>{if(phase!=='joined')return;const t=setInterval(load,2000);return()=>clearInterval(t);},[phase]);
  async function join(e){e.preventDefault();if(busy||!consent)return;signal.unlock();RD(true);BZ(true);X('');try{await api('/jury/join','POST',{code,consent:true,...(first.trim()?{firstName:first.trim()}:{}),...(places>0&&phone.trim()?{whatsapp:phone.trim()}:{})});await load();}catch(err){X(err.message);}finally{BZ(false);}}
  // « Suivre l'intervention » : la régie voit que cette personne a vu l'alerte (un nouvel essai au prochain affichage si le réseau coupe).
  function follow(){const id=alerting;try{sessionStorage.setItem(ackKey,id);}catch(_){}AL(null);api('/jury/seen','POST',{id}).catch(()=>{});requestAnimationFrame(()=>document.querySelector('.jy-follow')?.scrollIntoView({block:'start'}));}
  function enable(){signal.unlock();RD(true);signal.chime();}
  const scene=me?.scene,active=scene&&!scene.terminal,seg=me?.segment,net=me?.network,power=isPower(scene);
  const where=net?'Réseau '+net+' · '+(me?.zone||''):me?.zone;
  const live=scene&&window.FGLiveTrip&&['dispatched','en_route','on_site'].includes(scene.status)&&scene.technician;
  const content=phase==='loading'?h('p',{className:'jy-loading',role:'status'},'Connexion à votre quartier…'):
   phase==='join'?h('form',{className:'jy-join',onSubmit:join},
    h('div',{className:'jy-join-art','aria-hidden':true},h('span',{className:'jy-ring r1'}),h('span',{className:'jy-ring r2'}),h(Robot)),
    h('p',{className:'jy-kicker'},'MEMBRE DU JURY'),
    h('h1',null,'Vivez la panne',h('br'),'comme un abonné.'),
    h('p',null,'Pendant la démonstration, ce téléphone devient celui d’un abonné Moov Fibre à Yopougon, quartier Niangon.'),
    h('ul',{className:'jy-promises'},h('li',null,places>0?'Un prénom et un numéro WhatsApp si vous voulez, rien d’autre.':'Un prénom si vous voulez, jamais de numéro de téléphone.'),h('li',null,'Guardian vous prévient s’il se passe quelque chose.'),h('li',null,'Tout s’efface à la fin de la démonstration.')),
    !code&&h('p',{className:'jy-error',role:'alert'},'Scannez le code QR affiché par l’équipe pour rejoindre le quartier.'),
     h('label',{className:'jy-field'},h('span',null,'Votre prénom ',h('small',null,'(facultatif)')),
      h('input',{ref:firstRef,type:'text',value:first,onChange:e=>F(e.currentTarget.value),maxLength:30,autoComplete:'given-name',autoCapitalize:'words',enterKeyHint:'done',placeholder:'Par exemple : Awa','aria-invalid':firstError||undefined,'aria-describedby':firstError?'jy-first-error':undefined}),
      firstError?h('small',{id:'jy-first-error',className:'jy-field-error',role:'alert'},error):h('small',null,'Il s’affiche sur le grand écran de la démonstration.')),
     places>0&&h('label',{className:'jy-field'},h('span',null,'Votre numéro WhatsApp ',h('small',null,'(facultatif)')),
      // Comme le prénom : l'aide est déjà lue avec le champ (elle est dans le label) ; l'erreur seule est reliée en plus.
      h('input',{ref:phoneRef,type:'tel',value:phone,onChange:e=>PH(e.currentTarget.value),maxLength:25,autoComplete:'tel-national',inputMode:'tel',enterKeyHint:'done',placeholder:'Par exemple : 07 07 12 34 56','aria-invalid':phoneError||undefined,'aria-describedby':phoneError?'jy-phone-error':undefined}),
      phoneError?h('small',{id:'jy-phone-error',className:'jy-field-error',role:'alert'},error):h('small',null,'Guardian vous écrit sur WhatsApp : répondez « OUI » pour y recevoir l’alerte. Numéro jamais affiché, effacé à la fin. '+(places>1?'Encore '+places+' places.':'Dernière place.'))),
     h('label',{className:'jy-check'},h('input',{type:'checkbox',checked:consent,onChange:e=>C(e.currentTarget.checked)}),h('span',null,'J’accepte de recevoir les alertes de ce quartier pendant la démonstration.')),
     error&&!firstError&&!phoneError&&h('p',{ref:errorRef,className:'jy-error',role:'alert'},error),
     h('button',{type:'submit',className:'jy-primary',disabled:busy||!consent||!code},busy?'Un instant…':'Devenir abonné à Niangon'),
     h('small',{className:'jy-hint'},'Montez le son et gardez cette page ouverte.')):
   h('div',{className:'jy-layout'+(scene?' has-scene':'')},h('div',{className:'jy-col'},
    h('section',{className:'jy-status jy-status--'+(active?'down':'ok'),'aria-live':'polite'},
     h('span',{className:'jy-pill'},h('i',{'aria-hidden':true}),active?'Coupure en cours':scene?.status==='resolved'?'Connexion rétablie':'Tout va bien'),
     h('h1',null,active?(power?'Votre quartier est privé de courant':'Votre quartier est privé de fibre'):'Votre fibre fonctionne'),
     h('p',null,where+' · Abonné n° '+me.number),
     seg&&h('div',{className:'jy-meter'},h('div',{className:'jy-meter-bar'},h('i',{style:{width:Math.round(seg.online/seg.total*100)+'%'}})),h('span',null,h('b',null,seg.online),' foyers sur '+seg.total+' connectés dans le quartier'))),
     h(Bubble,{tone:active?'alert':['resolved','closed'].includes(scene?.status)?'ok':null},scene?guardianSays(scene,seg):net?'Je veille sur le réseau '+net+'. Dès qu’un responsable Moov confirme une panne, je vous préviens ici'+(me.whatsapp==='on'?' et sur WhatsApp.':'.'):'Je veille sur votre connexion. Si quelque chose arrive dans votre quartier, je vous préviens tout de suite'+(me.whatsapp==='on'?', ici et sur WhatsApp.':'.')),
     // Plan déjà validé puis remis à jour : l'heure revient avec la nouvelle validation (pas « dès que l'équipe a validé »).
     active&&scene.restore?.pending&&(scene.events||[]).some(e=>e.kind==='plan.approved')?h('p',{className:'ap-restore is-pending'},h('span',{className:'ap-restore-dot','aria-hidden':true}),h('span',null,'Moov met le plan à jour : la nouvelle heure de retour arrive dans un instant.')):
     active&&window.FGAppel&&h(window.FGAppel.Restore,{restore:scene.restore}),
    !ready&&h('button',{type:'button',className:'jy-secondary',onClick:enable},'Activer le son et la vibration'),
    !scene&&h('ul',{className:'jy-tips'},h('li',null,'Gardez cette page ouverte pendant la démonstration.'),h('li',null,'Votre téléphone vibrera si votre quartier est touché.'),me.whatsapp==='on'&&h('li',null,'Guardian vous écrit aussi sur WhatsApp. Répondez « Stop » pour arrêter.'),me.whatsapp==='pending'&&h('li',{className:'jy-tip-wa'},'Répondez « OUI » au message de Guardian sur WhatsApp pour y recevoir l’alerte aussi.'))),
    scene&&h('div',{className:'jy-col'},scene.certificate&&h(Certificate,{c:scene.certificate}),
    scene.certificate&&window.FGNoc&&h('div',{className:'jy-rate'},h(window.FGNoc.Feedback,{api,incident:scene,onSaved:load})),
    h('section',{className:'jy-card jy-follow'},h('h2',null,'Votre intervention'),h(Stages,{scene}),
     live&&h(window.FGLiveTrip.Card,{incident:scene,map:incident=>window.FGNoc?h(window.FGNoc.NetworkMap,{incident}):null})),
    // Le client qui veut quand même appeler : le serveur vocal lui dit d'abord ce que Moov sait déjà (appel évité ou non, compté à la régie).
    active&&window.FGAppel&&h('section',{className:'jy-card jy-call'},h('p',null,'Vous voulez quand même appeler Moov ? Le service client sait déjà tout.'),
     h(window.FGAppel.CallButton,{api,className:'jy-secondary',calledNote:'L’équipe Moov la voit tout de suite, avec l’état de la panne.'}))),
    error&&h('p',{className:'jy-error',role:'alert'},error));
  return h('div',{className:'jy'},
h(Header,{right:me&&h('span',{className:'jy-who',title:me.first||undefined},me.first?me.first.split(' ')[0]:'Jury n° '+me.number),onAbout:()=>AB(true)}),
   h('main',{id:'main',className:'jy-main',tabIndex:-1},content),
   toast&&h('div',{className:'jy-toast',role:'status'},h('i',{'aria-hidden':true}),toast),
   alerting&&scene&&h('div',{className:'jy-alert',role:'alertdialog','aria-modal':true,'aria-labelledby':'jy-alert-title'},
    h('div',{className:'jy-alert-pulse','aria-hidden':true},h('span'),h('span'),h('b',null,'!')),
    h('p',{className:'jy-kicker'},'ALERTE GUARDIAN · '+hm(scene.created||Date.now())),
    h('h2',{id:'jy-alert-title'},power?'Coupure de courant':net?'Coupure sur votre réseau':'Coupure dans votre quartier'),
    net&&h('p',{className:'jy-alert-net'},net),
    h('p',null,guardianSays(scene,seg)),
    scene.restore?.label&&h('p',{className:'jy-alert-eta'},'Internet revient vers ',h('b',null,scene.restore.label)),
    h('button',{type:'button',className:'jy-primary jy-primary--light',onClick:follow,autoFocus:true},'Suivre l’intervention')),
   about&&window.FGDemo&&h(window.FGDemo.About,{user:null,onClose:()=>AB(false)}));
 }

 // ---------- Régie ----------
 function QR({text,label}){
  if(!window.qrcode)return null;
  const q=window.qrcode(0,'M');q.addData(text);q.make();
  const n=q.getModuleCount(),pad=4,size=n+pad*2;let d='';
  for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(q.isDark(r,c))d+='M'+(c+pad)+' '+(r+pad)+'h1v1h-1z';
  return h('svg',{className:'jy-qr',viewBox:'0 0 '+size+' '+size,role:'img','aria-label':label,shapeRendering:'crispEdges'},h('rect',{width:size,height:size}),h('path',{d}));
 }
 const STEPS=[['cut','Couper la fibre à Niangon','Les téléphones du jury vibrent avec l’alerte de Guardian.'],['send','Envoyer le technicien','Plan validé, Koffi affecté et en route.'],['arrive','Le technicien est arrivé','Koffi est sur place, la réparation commence.'],['repair','Réparer et vérifier','Les mesures reviennent, le jury reçoit son certificat.']];
 const STATUS={reported:'Coupure détectée',proposed:'Coupure détectée, plan prêt',approved:'Plan validé',dispatched:'Technicien affecté',en_route:'Technicien en route',on_site:'Technicien sur place',verifying:'Vérification des mesures',resolved:'Connexion rétablie et vérifiée',closed:'Dossier clôturé',rejected:'Plan refusé'};
 // Réseau de démo : la panne se choisit, puis un responsable valide avant que les inscrits soient prévenus.
 const NET_STATUS={reported:'Panne repérée par Guardian',proposed:'Panne repérée : un responsable doit valider',approved:'Panne validée : les inscrits sont prévenus'};
 function stepsFor(network,scene){
  if(!network)return STEPS;
  const cut=['cut','Simuler une panne sur '+network,'Guardian la repère en 5 secondes. Les inscrits ne voient encore rien.'];
  const validate=['validate','Valider et prévenir les inscrits','Un responsable confirme le diagnostic : tous les téléphones inscrits vibrent.'];
  if(scene?.cause==='POWER_OUTAGE')return [cut,validate,['repair','Le courant revient','Les box repartent seules, Guardian vérifie, tout repasse au vert.']];
  return [cut,validate,['send','Envoyer le technicien','Koffi est affecté et part tout de suite.'],STEPS[2],STEPS[3]];
 }
 const STEP_DONE={cut:'Coupure envoyée : les téléphones du jury vibrent.',validate:'Panne validée : les téléphones inscrits vibrent.',send:'Koffi est en route. Le jury le voit arriver sur la carte.',arrive:'Koffi est sur place.',repair:'Connexion rétablie et vérifiée. Le jury reçoit son certificat.'};
 const TONE={ok:'ok',box:'ok',lent:'warn',faible:'warn',instable:'warn','box-charge':'warn','box-clignote':'warn'};
 const mbps=v=>v==null?null:String(Math.round(v*10)/10).replace('.',',')+' Mb/s';

 // Ce que montre la copie pendant la panne, en une phrase faite de ses chiffres (pas le message prévu pour le client).
 function twinSays(t){
  const box=t.devices.find(d=>d.kind==='box'),n=t.summary.devices,on=t.summary.online,cut=n-on;
  return 'Sur la copie : '+(box?'box « '+box.stateLabel.toLowerCase()+' »':'box coupée')+', '+(cut?cut+' appareil'+(cut>1?'s':'')+' sur '+n+' sans Internet':'les appareils restent connectés')+'. Votre vrai partage de connexion marche toujours.';
 }
 // Les inscrits, pour le grand écran : prénom (ou numéro), puis alerte reçue et alerte vue.
 function Members({members,big}){
  if(!members?.length)return h('p',{className:'jy-hint'},'Personne n’est encore inscrit. Projetez le code QR.');
  return h('ul',{className:'jy-members'+(big?' is-big':''),'aria-label':'Inscrits'},members.map(m=>{const name=m.name||'Membre n° '+m.number,st=m.seen?'seen':m.delivered?'got':null;
   return h('li',{key:m.number,className:'jy-member'+(st?' is-'+st:'')},
    // Initiale ou numéro, jamais un visage deviné d'après le prénom.
    h('span',{className:'jy-member-dot jy-member-dot--'+(m.number%3),'aria-hidden':true},m.name?[...m.name][0].toUpperCase():m.number),
    h('span',{className:'jy-member-name'},name),
    // Numéro donné : un petit pictogramme, jamais le numéro.
    m.whatsapp&&h('span',{className:'jy-member-wa',role:'img','aria-label':'aussi sur WhatsApp',title:'Alerte aussi sur WhatsApp'},h('svg',{viewBox:'0 0 24 24',width:14,height:14,'aria-hidden':true},h('path',{d:'M20 11.5a8.5 8.5 0 0 1-12.4 7.6L3 20.5l1.4-4.4A8.5 8.5 0 1 1 20 11.5Z',fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinejoin:'round'}))),
    st&&h('small',null,st==='seen'?'✓ a vu l’alerte':'alerte reçue'));}));
 }

 // Le réseau de démo : sa copie Wi-Fi, et la panne jouée sur cette copie (le vrai Wi-Fi n'est jamais touché).
 function Network({net,api,busy}){
  const [link,LK]=S(null),[error,X]=S(''),[asking,AS]=S(false);
  const copy=net.copy,twin=net.twin,devices=twin?twin.devices:copy?.devices||[];
  async function ask(){if(asking)return;AS(true);X('');try{LK(await api('/test/link','POST',{}));}catch(e){X(e.message);}finally{AS(false);}}
  const facts=copy?[copy.network,mbps(copy.downloadMbps),copy.latencyMs!=null?Math.round(copy.latencyMs)+' ms':null].filter(Boolean).join(' · '):'';
  return h('section',{className:'jy-card jy-net'},
   h('div',{className:'jy-row'},h('div',null,h('p',{className:'jy-kicker'},'VOTRE RÉSEAU DE DÉMO'),h('h2',null,net.ssid)),
    h('span',{className:'jy-net-state'+(twin?' is-down':copy?' is-up':'')},twin?twin.label:copy?'En ligne':'Pas encore copié')),
   copy?h(React.Fragment,null,
    h('p',{className:'jy-net-facts'},'Copie faite à '+hm(copy.created)+(facts?' · '+facts:'')),
    h('ul',{className:'jy-devs','aria-label':'Appareils de la copie'},devices.map(d=>h('li',{key:d.id,className:'jy-dev is-'+(TONE[d.state]||'down')+(d.added?' is-added':'')},
     h('i',{'aria-hidden':true}),h('span',null,h('b',null,d.label),h('small',null,d.stateLabel+(d.played?' · votre partage de connexion':'')))))),
    twin?h('p',{className:'jy-net-text',role:'status'},twinSays(twin)):h('small',{className:'jy-net-note'},'La panne est jouée sur cette copie : votre vrai partage de connexion n’est jamais coupé.'),
    !twin&&!link&&B(asking?'Un instant…':'Refaire la copie',ask,{className:'jy-ghost',disabled:asking||busy})):
    h('p',null,'Donnez ce nom à votre partage de connexion. Sur un téléphone ou un PC branché dessus, ouvrez le test de connexion : Guardian copie ce réseau en 20 secondes.'),
   link?h('div',{className:'jy-net-link'},h(QR,{text:link.url,label:'Code QR du test de connexion'}),
     h('p',null,'Scannez avec l’appareil branché sur ',h('b',null,net.ssid),', puis touchez « Lancer le test ».'),
     h('a',{className:'jy-secondary',href:link.url,target:'_blank',rel:'noopener'},'Ouvrir le test sur cet appareil'),B('Fermer',()=>LK(null),{className:'jy-ghost'})):
    !copy&&B(asking?'Un instant…':'Copier ce réseau',ask,{className:'jy-secondary',disabled:asking||busy}),
   error&&h('p',{className:'jy-error',role:'alert'},error));
 }
 function dur(sec){return sec<60?sec+' s':Math.floor(sec/60)+' min '+String(sec%60).padStart(2,'0')+' s';}
 function since(t,now){const s=Math.max(0,Math.floor((now-t)/1000));return Math.floor(s/60)+' min '+String(s%60).padStart(2,'0')+' s';}

 function Regie(){
  const {api,csrf}=useApi();
  const [user,U]=S(undefined),[data,D]=S(null),[busy,BZ]=S(''),[error,X]=S(''),[notice,N]=S(''),[confirm,CF]=S(false),[show,SH]=S(false),[about,AB]=S(false),[now,NOW]=S(Date.now()),[ssid,SS]=S('MOOV-FIBRE-DEMO');
  async function load(){try{D(await api('/regie'));X('');}catch(e){if(e.status===401)U(null);else if(e.status===403)D(null),X(e.message);else X(e.message);}}
  E(()=>{api('/session').then(r=>{U(r.user);if(r.user)csrf.current=r.user.csrf;}).catch(e=>{U(null);X(e.message);});},[]);
  E(()=>{if(!user||user.role!=='admin')return;load();const t=setInterval(()=>{load();NOW(Date.now());},2000);return()=>clearInterval(t);},[user?.id,user?.role]);
  E(()=>{if(!show)return;const k=e=>{if(e.key==='Escape')SH(false);};document.addEventListener('keydown',k);return()=>document.removeEventListener('keydown',k);},[show]);
  async function run(type,message,extra={}){if(busy)return;BZ(extra.fault?type+':'+extra.fault:type);X('');N('');const start=performance.now();try{const r=await api('/regie','POST',type==='reset'?{type,confirm:true}:{type,...extra});if(r.user){U(r.user);csrf.current=r.user.csrf;}D(r);N(typeof message==='function'?message(performance.now()-start):message);CF(false);}catch(e){X(e.message);if(e.status===401)U(null);}finally{BZ('');}}
  async function login(e){e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));BZ('login');X('');try{const r=await api('/auth/login','POST',{email:f.email,password:f.password});U(r.user);}catch(err){X(err.message);}finally{BZ('');}}
  const header=h(Header,{right:h('span',{className:'jy-who'},'Régie'),onAbout:()=>AB(true)});
  if(user===undefined)return h('div',{className:'jy jy--regie'},header,h('main',{className:'jy-main'},h('p',{className:'jy-loading',role:'status'},'Ouverture de la régie…')));
  if(!user||user.role!=='admin')return h('div',{className:'jy jy--regie'},header,h('main',{id:'main',className:'jy-main'},
   h('form',{className:'jy-card jy-login',onSubmit:login},h('p',{className:'jy-kicker'},'RÉGIE DE LA DÉMONSTRATION'),h('h1',null,'Connexion administrateur'),
    user&&h('p',{className:'jy-error',role:'alert'},'Ce compte n’a pas le rôle administrateur. Connectez-vous avec le compte de la direction.'),
    h('label',null,'Adresse e-mail',h('input',{name:'email',type:'email',required:true,autoComplete:'username'})),h('label',null,'Mot de passe',h('input',{name:'password',type:'password',required:true,autoComplete:'current-password'})),
    h('button',{type:'submit',className:'jy-primary',disabled:!!busy},busy?'Connexion…':'Ouvrir la régie'),error&&h('p',{className:'jy-error',role:'alert'},error))));
  const room=data?.room,scene=data?.scene,next=data?.next,network=room?.network||null,steps=stepsFor(network,scene),order=steps.map(s=>s[0]);
  const doneUpTo=!scene||['resolved','closed','rejected'].includes(scene.status)?(scene?.status==='resolved'?order.length:0):order.indexOf(next);
  const alert=data?.report?.alert;
  return h('div',{className:'jy jy--regie'},header,h('main',{id:'main',className:'jy-main jy-regie'},
   h('section',{className:'jy-card jy-room'},
    h('div',{className:'jy-row'},h('div',null,h('p',{className:'jy-kicker'},'1 · SALLE DU JURY'),h('h2',null,room?room.jurors+' membre'+(room.jurors>1?'s':'')+' du jury connecté'+(room.jurors>1?'s':''):'Salle fermée')),room&&h('span',{className:'jy-code','aria-label':'Code de la salle'},room.code)),
    room?h(React.Fragment,null,
     network&&h('p',{className:'jy-net-chip'},'Réseau ',h('b',null,network)),
     h('button',{type:'button',className:'jy-qr-wrap',onClick:()=>SH(true),'aria-label':'Projeter le code QR en grand'},h(QR,{text:room.url,label:'Code QR pour rejoindre la démonstration'})),
     h('p',{className:'jy-url'},room.url),
     h(Members,{members:data?.members}),
     h('div',{className:'jy-actions'},B('Projeter le code QR',()=>SH(true),{className:'jy-secondary'}),B('Fermer la salle',()=>run('close','Salle fermée. Les membres déjà connectés gardent leur accès.'),{className:'jy-ghost',disabled:!!busy}))):
     h('form',{className:'jy-open',onSubmit:e=>{e.preventDefault();run('open','Salle ouverte. Projetez le code QR.',{ssid});}},
      h('p',null,'Ouvrez la salle au début de la présentation : un code QR apparaît, chaque membre du jury le scanne avec son téléphone et s’inscrit à votre réseau de démo.'),
      h('label',{className:'jy-field'},h('span',null,'Nom du réseau de démo'),h('input',{type:'text',value:ssid,maxLength:32,required:true,onChange:e=>SS(e.currentTarget.value),autoCapitalize:'characters',spellCheck:false}),
       h('small',null,'Le nom de votre partage de connexion : il joue la box du quartier.')),
      h('button',{type:'submit',className:'jy-primary',disabled:!!busy||!ssid.trim()},busy==='open'?'Ouverture…':'Ouvrir la salle du jury'))),
   data?.network&&h(Network,{net:data.network,api,busy:!!busy}),
   h('section',{className:'jy-card'},
    h('div',{className:'jy-row'},h('div',null,h('p',{className:'jy-kicker'},'2 · LA SCÈNE'),h('h2',null,scene?(network&&NET_STATUS[scene.status])||STATUS[scene.status]||scene.status:'Le réseau va bien')),scene&&!['resolved','closed'].includes(scene.status)&&h('span',{className:'jy-timer'},since(scene.created,now))),
    h('ol',{className:'jy-steps'},steps.map(([k,label,detail],n)=>{const isNext=room&&next===k,done=n<doneUpTo&&!isNext;if(k==='cut'&&isNext&&scene?.status==='resolved')label=network?'Rejouer : nouvelle panne sur '+network:'Rejouer : couper la fibre';if(k==='repair'&&scene?.hold){label='Contrôle ciblé et vérification';detail='Le technicien rétablit les derniers foyers, les mesures confirment le retour.';}
     const message=k==='repair'&&scene?.cause==='POWER_OUTAGE'?'Le courant est revenu : tout repasse au vert.':STEP_DONE[k];
     // Réseau de démo : deux pannes au choix, chacune jouée sur la copie du Wi-Fi.
     if(k==='cut'&&network&&isNext)return h('li',{key:k},h('div',{className:'jy-step is-next jy-step--choice'},
      h('span',{className:'jy-step-n','aria-hidden':true},n+1),h('span',null,h('strong',null,label),h('small',null,detail),
       h('span',{className:'jy-choice'},
        B(busy==='cut:fiber'?'En cours…':'Fibre coupée',()=>run('cut','Fibre coupée sur '+network+'. Guardian a repéré la panne : validez pour prévenir les inscrits.',{fault:'fiber'}),{className:'jy-choice-btn',disabled:!!busy}),
        B(busy==='cut:power'?'En cours…':'Courant coupé',()=>run('cut','Courant coupé sur '+network+'. Guardian a repéré la panne : validez pour prévenir les inscrits.',{fault:'power'}),{className:'jy-choice-btn',disabled:!!busy})))));
     return h('li',{key:k},h('button',{type:'button',className:'jy-step'+(isNext?' is-next':'')+(done?' is-done':''),disabled:!isNext||!!busy,onClick:()=>run(k,message)},
      h('span',{className:'jy-step-n','aria-hidden':true},done?'✓':n+1),h('span',null,h('strong',null,busy===k?'En cours…':label),h('small',null,detail))));})),
    room&&next==='repair'&&!scene?.hold&&scene?.cause!=='POWER_OUTAGE'&&h('div',{className:'jy-variant'},h('p',null,h('b',null,'Variante pour le jury : '),'la réparation principale est faite, mais 4 foyers restent coupés. Guardian doit refuser de clôturer.'),B(busy==='partial'?'En cours…':'Réparation partielle',()=>run('partial','Réparation partielle : 4 foyers restent coupés. Guardian garde le dossier ouvert.'),{className:'jy-secondary',disabled:!!busy})),
    scene?.hold&&h('p',{className:'jy-hint',role:'status'},'Guardian refuse la clôture : '+scene.hold.remaining+' foyers encore coupés. Étape 4 : contrôle ciblé, puis vérification.'),
    !room&&h('p',{className:'jy-hint'},'Ouvrez d’abord la salle du jury.')),
   data?.report&&h('section',{className:'jy-card jy-report'},h('p',{className:'jy-kicker'},'RAPPORT DE PREUVES'),h('h2',null,data.report.verified?'Service rétabli et vérifié':'Scène en cours'),
    h('dl',null,data.report.rows.map(r=>h('div',{key:r.key},h('dt',null,r.label),h('dd',null,r.seconds==null?'—':dur(r.seconds)))),
     h('div',null,h('dt',null,'Box coupées à la détection'),h('dd',null,data.report.offline==null?'—':data.report.offline+' sur '+data.report.total)),
     h('div',null,h('dt',null,'Abonnés rétablis, mesurés'),h('dd',null,data.report.restored==null?'—':String(data.report.restored))),
     network&&alert?[
      h('div',{key:'a'},h('dt',null,'Validation → alerte sur les téléphones'),h('dd',null,alert.delivered+' sur '+alert.members+(alert.seconds!=null?' · '+dur(alert.seconds):''))),
      h('div',{key:'b'},h('dt',null,'Ont vu l’alerte'),h('dd',null,alert.seen+' sur '+alert.delivered)),
      h('div',{key:'c'},h('dt',null,'Appels évités'),h('dd',null,alert.avoided+(alert.called?' · '+alert.called+(alert.called>1?' ont appelé':' a appelé'):'')))]:
     h('div',null,h('dt',null,'Clients prévenus · ont lu'),h('dd',null,data.report.notified+' · '+data.report.read))),
    data.report.partial&&h('p',null,'Réparation partielle jouée : Guardian a refusé la clôture tant que des foyers restaient coupés.'),
    h('small',null,data.report.source+'. Rien n’est estimé ici ; les économies en francs sont des estimations, sur la page Impact.')),
   h('section',{className:'jy-card jy-score'},h('p',{className:'jy-kicker'},'3 · AVIS DU JURY'),data?.ratings?.count?h('p',null,h('b',null,String(data.ratings.average).replace('.',',')+' / 5'),' · '+data.ratings.count+' avis'):h('p',null,'Les notes du jury apparaîtront ici après la réparation.')),
   h('section',{className:'jy-card jy-reset'},h('p',{className:'jy-kicker'},'REMISE À ZÉRO'),h('p',null,'Remet la démonstration dans son état de départ. Le jury et la régie restent connectés.'),
    confirm?h('div',{className:'jy-actions'},B(busy==='reset'?'Remise à zéro…':'Confirmer',()=>run('reset',ms=>'Tout est remis à zéro en '+(ms/1000).toFixed(1).replace('.',',')+' s. Le jury reste connecté.'),{className:'jy-danger',disabled:!!busy}),B('Annuler',()=>CF(false),{className:'jy-ghost',disabled:!!busy})):
    B('Tout remettre à zéro',()=>CF(true),{className:'jy-danger-outline',disabled:!!busy})),
   (notice||error)&&h('p',{className:error?'jy-error':'jy-notice',role:error?'alert':'status'},error||notice),
   h('a',{className:'jy-link',href:'?portal=moov&section=overview'},'Ouvrir la console de l’équipe Moov')),
    // Beaucoup d'inscrits : le code QR à gauche, la liste à droite (grand écran), pour que tout tienne sans défiler.
    show&&room&&h('div',{className:'jy-project'+(data?.members?.length>8?' is-crowded':''),role:'dialog','aria-modal':true,'aria-label':'Code QR en grand',onClick:()=>SH(false)},
     h('div',{className:'jy-project-main'},
      h('p',{className:'jy-kicker'},'MEMBRES DU JURY'),h('h2',null,network?'Scannez pour vous inscrire au réseau de démo':'Scannez pour devenir abonné à Niangon'),h(QR,{text:room.url,label:'Code QR pour rejoindre la démonstration'}),
      h('p',{className:'jy-project-code'},'Code ',h('b',null,room.code)),network&&h('p',null,'Réseau de démo ',h('b',null,network)),h('p',null,room.jurors+' membre'+(room.jurors>1?'s':'')+' du jury connecté'+(room.jurors>1?'s':''))),
     data?.members?.length>0&&h(Members,{members:data.members,big:true}),h('small',null,'Touchez l’écran pour revenir à la régie.')),
   about&&window.FGDemo&&h(window.FGDemo.About,{user,onClose:()=>AB(false)}));
 }

 function route(href=location.href){const q=new URL(href).searchParams;return q.has('jury')?'jury':q.get('section')==='regie'?'regie':null;}
 window.FGJury={Juror,Regie,route,code:()=>new URLSearchParams(location.search).get('jury')||''};
})();
