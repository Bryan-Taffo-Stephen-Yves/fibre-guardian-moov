(function(){
 'use strict';
 // Accueil client réorganisé : suivi automatique du technicien, gros bouton « Signaler », page Compte.
 const h=React.createElement,{useState:S,useEffect:E,useRef:R}=React;
 const STAGE={reported:'Signalement reçu',confirmed:'Panne confirmée',assigned:'Technicien choisi',en_route:'En route',on_site:'Sur place',repairing:'Réparation en cours',verifying:'Vérification du réseau',resolved:'Internet est revenu'};
 const ORDER=['reported','confirmed','assigned','en_route','on_site','repairing','verifying','resolved'];
 function Icon({name,size=20}){const p={gift:'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7S10 3 7.5 4 9 7 12 7m0 0s2-4 4.5-3S15 7 12 7',copy:'M8 8h11v12H8zM5 16V4h11',gauge:'M4.5 17a8.5 8.5 0 1 1 15 0M12 13l3.5-4.5M12 13h.01',truck:'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4',alert:'M12 8v5M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',arrow:'M5 12h14m-6-6 6 6-6 6',phone:'M7 3h10v18H7zM11 18h2',map:'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2ZM9 4v14M15 6v14',bell:'M18 8a6 6 0 0 0-12 0v7l-3 3h18l-3-3ZM10 21h4',user:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0',wallet:'M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3zM3 7l12-3v3M17 13h.01',info:'M12 16v-5M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18',logout:'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',check:'m5 12 5 5 9-10',star:'m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z',camera:'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',chevron:'m9 6 6 6-6 6',shield:'m12 3 8 3v6c0 6-8 9-8 9s-8-3-8-9V6Zm-4 9 3 3 5-6',chat:'M20.5 11.5a8.5 8.5 0 0 1-12.6 7.4L3.5 20l1.2-4.2a8.5 8.5 0 1 1 15.8-4.3ZM8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01'}[name];
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
  const sub=done?'Comment s’est passée l’intervention ? Votre avis aide Moov.':(item.zone||'Votre quartier')+(item.restore?.label?' · retour prévu vers '+item.restore.label:'')+(item.ref?' · dossier '+item.ref:'');
  return h('button',{type:'button',className:'ch-live'+(done?' done':''),onClick:onTrack,'aria-label':title+'. Ouvrir le suivi en direct'},
   h('span',{className:'ch-live-pulse','aria-hidden':true}),
   h('div',{className:'ch-live-top'},h('span',{className:'ch-live-tag'},h('i'),done?'Terminé':'En direct'),h('span',{className:'ch-live-step'},STAGE[item.status])),
   h('div',{className:'ch-live-main'},h(Face,{name:t.name,size:52}),h('div',null,h('strong',null,title),h('small',null,sub)),eta&&!done?h('em',null,eta[0],h('small',null,eta[1])):null),
   !done&&h('div',{className:'ch-live-bar','aria-hidden':true},ORDER.slice(2).map((k,i)=>h('i',{key:k,className:step>=i+2?'on':''}))),
   h('div',{className:'ch-live-foot'},h('span',null,t.vehicle||t.team||'Équipe Moov'),h('b',null,done?'Noter '+first(t.name):'Suivre en direct',h(Icon,{name:'arrow',size:17}))));
 }

 // Le geste principal du client : signaler, en un appui.
 function ReportHero({onReport,onSurvie,onTest,call}){
  return h('section',{className:'ch-report','aria-label':'Signaler un problème'},
   h('button',{type:'button',className:'ch-report-main',onClick:onReport},h('span',{className:'ch-report-icon'},h(Icon,{name:'alert',size:26})),h('span',null,h('strong',null,'Signaler un problème'),h('small',null,'Une photo, un lieu : Moov s’en occupe.')),h(Icon,{name:'arrow',size:22})),
   h('div',{className:'ch-report-more'},onTest&&h('button',{type:'button',className:'ch-chip ch-chip-test',onClick:onTest},h(Icon,{name:'gauge',size:17}),'Tester ma connexion'),call,h('button',{type:'button',className:'ch-chip',onClick:onSurvie},h(Icon,{name:'phone',size:17}),'Sans internet · *144#')));
 }

 // Onglet Compte : tout ce qui n'est pas quotidien, au même endroit.
 // Alertes sur WhatsApp : le client relie son WhatsApp à son compte. L'application donne un code, WhatsApp s'ouvre avec
 // un message tout prêt pour Guardian ; quand le téléphone l'envoie, le client confirme ici le numéro qui a écrit
 // (« 07 •• •• •• 56 : est-ce bien le vôtre ? »). Guardian n'écrit qu'après cette confirmation.
 const NB=' '; // espace insécable : « Bonjour » ne se coupe jamais en fin de ligne
 const q=t=>'«'+NB+t+NB+'»';
 function Qr({text}){
  if(!window.qrcode)return null;
  const c=window.qrcode(0,'M');c.addData(text);c.make();
  const n=c.getModuleCount(),pad=3,size=n+pad*2;let d='';
  for(let r=0;r<n;r++)for(let k=0;k<n;k++)if(c.isDark(r,k))d+='M'+(k+pad)+' '+(r+pad)+'h1v1h-1z';
  return h('svg',{className:'ch-wa-qr',viewBox:'0 0 '+size+' '+size,role:'img','aria-label':'Code QR qui ouvre WhatsApp avec le message pour Guardian',shapeRendering:'crispEdges'},h('rect',{width:size,height:size}),h('path',{d}));
 }
 function WhatsAppCard({api,go}){
  const [d,D]=S(null),[busy,B]=S(false),[err,X]=S(''),[say,Y]=S(''),[sure,U]=S(false),[fresh,F]=S(false);
  const alive=R(true),was=R({state:null,problem:null}),title=R(null),box=R(null),seq=R(0),seen=R(false),yes=R(null),stopBtn=R(null);
  // Pas de place : « full » (offre du mois en pause) ou « places » (places gardées pour d'autres numéros).
  const NOPE={full:'Il n’y a plus de place pour les alertes WhatsApp ce mois-ci. Vos alertes continuent d’arriver ici, dans l’application.',places:'Toutes les places pour les alertes WhatsApp sont prises pour le moment. Vos alertes continuent d’arriver ici, dans l’application.'};
  // Chaque changement d'état est annoncé (lecteur d'écran). Le titre de la carte reprend le focus après un geste du client,
  // ou si le focus n'était nulle part ailleurs : jamais pendant qu'il écrit dans un autre champ.
  const show=(r,manual)=>{const before=was.current;was.current={state:r.state,problem:r.problem||null};D(r);
   if(NOPE[r.problem]&&before.problem!==r.problem)Y(NOPE[r.problem]);
   else if(before.state==='waiting'&&r.state==='confirm')Y('Guardian a reçu votre code. Confirmez que ce numéro est bien le vôtre.');
   else if(before.state==='confirm'&&r.state==='on'){F(true);Y('C’est fait : votre WhatsApp est relié à votre compte.');}
   else if(['waiting','confirm'].includes(before.state)&&r.state==='none'&&!manual)Y('Le code n’est plus valable. Touchez de nouveau '+q('Relier mon WhatsApp')+'.');
   const ae=document.activeElement,here=!ae||ae===document.body||box.current?.contains(ae);
   if(manual||((before.state!==r.state||before.problem!==(r.problem||null))&&here))setTimeout(()=>title.current?.focus(),0);};
  // Une réponse plus ancienne qu'un geste du client (« Annuler » pendant une mise à jour) est ignorée.
  const load=()=>{const n=seq.current;api('/whatsapp/compte').then(r=>{if(alive.current&&n===seq.current&&(r.state!==was.current.state||(r.problem||null)!==was.current.problem))show(r);}).catch(()=>{});};
  E(()=>{alive.current=true;const n=seq.current;api('/whatsapp/compte').then(r=>{if(alive.current&&n===seq.current){was.current={state:r.state,problem:r.problem||null};D(r);}}).catch(()=>{});return()=>{alive.current=false;};},[]);
  // En attente du message, puis de la confirmation : la carte se met à jour toute seule (code reçu, code expiré),
  // et tout de suite au retour de WhatsApp.
  E(()=>{if(!['waiting','confirm'].includes(d?.state)||busy)return;const t=setInterval(load,3000),back=()=>{if(document.visibilityState==='visible')load();};
   addEventListener('focus',back);document.addEventListener('visibilitychange',back);
   return()=>{clearInterval(t);removeEventListener('focus',back);document.removeEventListener('visibilitychange',back);};},[d?.state,busy]);
  // La carte n'apparaît que si Guardian peut lire WhatsApp ; une fois affichée, elle reste (pour dire ce qui vient de se passer).
  if(!d||(!seen.current&&!d.available&&d.state==='none'&&!d.problem))return null;
  seen.current=true;
  const call=async(method,path,done)=>{const n=++seq.current;B(true);X('');Y('');F(false);
   try{const r=await api(path||'/whatsapp/compte',method);if(!alive.current||n!==seq.current)return;U(false);show(r,true);if(done)Y(done);}
   catch(e){if(!alive.current)return;X(e.status?e.message:'La connexion est lente. Réessayez dans un instant.');
    // Puis l'état réel : code expiré, lien fait malgré une réponse perdue, mois en pause… L'erreur s'efface si l'état a changé.
    const m=++seq.current;api('/whatsapp/compte').then(r=>{if(alive.current&&m===seq.current&&(r.state!==was.current.state||(r.problem||null)!==was.current.problem)){X('');show(r);}}).catch(()=>{});}
   finally{if(alive.current)B(false);}};
  const state=d.state,where=d.zone||'votre quartier',full=!!NOPE[d.problem];
  const tag=state==='on'?h('span',{className:'ch-wa-tag on'},h(Icon,{name:'check',size:14}),'Activées'):['waiting','confirm'].includes(state)?h('span',{className:'ch-wa-tag wait'},h('i',{'aria-hidden':true}),'En attente'):null;
  // « 07 •• •• •• 56 » à l'écran ; « numéro qui finit par 56 » pour les lecteurs d'écran.
  const num=()=>h('span',{className:'ch-wa-num'},h('span',{'aria-hidden':true},d.number),h('span',{className:'ch-wa-sr'},'numéro qui finit par '+d.end));
  const steps=n=>h('ol',{className:'ch-wa-steps'},['Envoyer le message','Confirmer le numéro','C’est relié'].map((t,k)=>h('li',{key:t,className:k<n?'done':k===n?'now':undefined,'aria-current':k===n?'step':undefined},h('i',null,k<n?h(Icon,{name:'check',size:13}):String(k+1)),t)));
  const sub=state==='on'?h(React.Fragment,null,'Sur le ',num()):d.problem==='full'?'Pas de place ce mois-ci':full||(state==='none'&&d.refused)?'Plus de place pour le moment':state==='confirm'?'Dernière étape':state==='waiting'?'Plus que deux étapes':'Sans ouvrir l’application';
  return h('section',{className:'ch-wa','data-state':state,'aria-labelledby':'ch-wa-title',ref:box},
   h('div',{className:'ch-wa-head'},h('span',{className:'ch-wa-icon'},h(Icon,{name:'chat',size:22})),
    h('div',null,h('h2',{id:'ch-wa-title',ref:title,tabIndex:-1},'Vos alertes sur WhatsApp'),h('p',null,sub)),tag),
   h('p',{className:'ch-wa-sr',role:'status','aria-live':'polite'},say),
   full?h(React.Fragment,null,
    h('p',{className:'ch-wa-text'},NOPE[d.problem]),
    h('button',{type:'button',className:'ch-wa-link',onClick:()=>call('DELETE'),disabled:busy},'Compris')):
   state==='none'?h(React.Fragment,null,
    say&&h('p',{className:'ch-wa-note'},say),
    d.available&&d.refused?h(React.Fragment,null,
     h('p',{className:'ch-wa-text'},'Pour le moment, vos alertes arrivent ici, dans l’application.'),
     h('button',{type:'button',className:'ch-wa-link',onClick:()=>call('POST'),disabled:busy},'Essayer avec un autre téléphone')):
    d.available?h(React.Fragment,null,
     h('p',{className:'ch-wa-text'},'Guardian vous écrit sur WhatsApp dès qu’une panne touche '+where+'. Vous pouvez aussi lui répondre, comme ici.'),
     h('button',{type:'button',className:'ch-wa-go',onClick:()=>call('POST'),disabled:busy},busy?'Un instant…':'Relier mon WhatsApp'),
     h('small',{className:'ch-wa-hint'},'WhatsApp s’ouvre avec un message tout prêt : il suffit de l’envoyer, puis de revenir ici.')):
     h('p',{className:'ch-wa-text'},'Pour le moment, vos alertes arrivent ici, dans l’application.')):
   state==='waiting'?h(React.Fragment,null,
    steps(0),
    h('p',{className:'ch-wa-text'},'Touchez '+q('Ouvrir WhatsApp')+', puis envoyez à Guardian le message tout prêt. Il contient votre code : ',h('b',{className:'ch-wa-code'},d.code),'.'),
    h('div',{className:'ch-wa-open'},
     h('a',{className:'ch-wa-go',href:d.link,target:'_blank',rel:'noopener noreferrer'},h(Icon,{name:'chat',size:19}),'Ouvrir WhatsApp'),
     h('div',{className:'ch-wa-scan'},h(Qr,{text:d.link}),h('small',null,'Sur ordinateur ? Scannez ce code avec l’appareil photo de votre téléphone.'))),
    h('small',{className:'ch-wa-hint'},'Revenez ensuite ici pour confirmer votre numéro. Le code sert une seule fois, pendant 15 minutes.'),
    h('button',{type:'button',className:'ch-wa-link',onClick:()=>call('DELETE'),disabled:busy},'Annuler')):
   state==='confirm'?h(React.Fragment,null,
    steps(1),
    h('p',{className:'ch-wa-text'},'Guardian a reçu votre code depuis le ',num(),'. Est-ce bien votre WhatsApp ?'),
    h('div',{className:'ch-wa-actions'},
     h('button',{type:'button',className:'ch-wa-go',onClick:()=>call('POST','/whatsapp/compte/confirmer'),disabled:busy},busy?'Un instant…':'Oui, c’est mon numéro'),
     h('button',{type:'button',className:'ch-wa-link',onClick:()=>call('DELETE',null,'C’est noté : ce numéro n’est pas relié. Touchez '+q('Relier mon WhatsApp')+' pour recommencer.'),disabled:busy},'Non, ce n’est pas moi')),
    h('small',{className:'ch-wa-hint'},'Guardian vous écrira sur ce WhatsApp juste après.')):
   h(React.Fragment,null,
    fresh&&h('p',{className:'ch-wa-done'},h(Icon,{name:'check',size:18}),'C’est fait : votre WhatsApp est relié à votre compte.'),
    h('p',{className:'ch-wa-text'},d.zone?'Guardian vous écrit sur WhatsApp si une panne touche '+d.zone+'. Écrivez-lui '+q('Bonjour')+' : il connaît déjà votre dossier.':'Choisissez votre quartier : Guardian vous écrira sur WhatsApp si une panne le touche.'),
    sure?h('div',{className:'ch-wa-confirm',role:'group','aria-label':'Arrêter les alertes WhatsApp ?'},h('p',null,'Guardian ne vous écrira plus sur WhatsApp. Vos alertes resteront dans l’application.'),
      h('div',{className:'ch-wa-actions'},h('button',{type:'button',className:'ch-chip',ref:yes,onClick:()=>call('DELETE',null,'C’est noté : Guardian ne vous écrira plus sur WhatsApp.'),disabled:busy},'Oui, arrêter'),h('button',{type:'button',className:'ch-wa-link',onClick:()=>{U(false);setTimeout(()=>stopBtn.current?.focus(),0);},disabled:busy},'Non, garder'))):
     h('div',{className:'ch-wa-actions'},!d.zone&&h('button',{type:'button',className:'ch-chip strong',onClick:()=>go('tracking')},'Choisir mon quartier'),h('button',{type:'button',className:'ch-wa-link',ref:stopBtn,onClick:()=>{U(true);setTimeout(()=>yes.current?.focus(),0);}},'Arrêter les alertes WhatsApp'))),
   err&&h('p',{className:'ch-wa-error',role:'alert'},err));
 }

 // Parrainage (thème 5, parrainage.cjs) : le client partage son code par WhatsApp depuis son téléphone ; un nouveau client
 // entre le code d'un proche (ou il est déjà rempli s'il est arrivé par un lien ?parrain=). Un mois offert aux deux après 3 mois.
 function ParrainageCard({api}){
  const [d,D]=S(null),[code,C]=S(''),[err,X]=S(''),[done,Y]=S(''),[busy,U]=S(false),alive=R(true);
  E(()=>{alive.current=true;api('/parrainage').then(r=>{if(!alive.current)return;D(r);let saved='';try{saved=localStorage.getItem('fg-parrain')||'';}catch{}if(saved&&r.canUse&&saved!==r.code)C(saved);}).catch(()=>{});return()=>{alive.current=false;};},[]);
  if(!d)return null;
  const day=at=>new Date(at).toLocaleDateString('fr-FR',{day:'numeric',month:'long'});
  const link=location.origin+location.pathname+'?parrain='+encodeURIComponent(d.code);
  const text='Je suis chez Moov Fibre et Guardian règle mes soucis de connexion. Abonne-toi avec mon code '+d.code+' : on a chacun un mois offert après 3 mois. '+link;
  async function use(e){e.preventDefault();X('');U(true);try{const r=await api('/parrainage','POST',{code});if(!alive.current)return;D(r);C('');Y('');try{localStorage.removeItem('fg-parrain');}catch{}}catch(e){alive.current&&X(e.message||'Ce code n’a pas pu être utilisé.');}finally{alive.current&&U(false);}}
  async function copy(){try{await navigator.clipboard.writeText(text);Y('Message copié : collez-le où vous voulez.');}catch{Y('Votre code : '+d.code);}}
  return h('section',{className:'ch-parr','aria-labelledby':'ch-parr-title'},
   h('div',{className:'ch-parr-head'},h('span',{className:'ch-row-icon'},h(Icon,{name:'gift',size:20})),h('div',null,h('h2',{id:'ch-parr-title'},'Parrainez vos proches'),h('p',null,'Un mois offert pour vous et pour lui, quand il a 3 mois d’abonnement.'))),
   h('div',{className:'ch-parr-code'},h('small',null,'Votre code'),h('strong',null,d.code)),
   h('div',{className:'ch-parr-actions'},
    h('a',{className:'ch-wa-go',href:'https://wa.me/?text='+encodeURIComponent(text),target:'_blank',rel:'noopener'},'Partager sur WhatsApp'),
    h('button',{type:'button',className:'ch-chip',onClick:copy},h(Icon,{name:'copy',size:16}),'Copier le message')),
   d.filleuls.length>0&&h('ul',{className:'ch-parr-list'},d.filleuls.map((f,i)=>h('li',{key:f.at+':'+i},h('b',null,f.name),h('small',null,f.rewarded?'Mois offert le '+day(f.rewardAt):'Inscrit le '+day(f.at)+' · mois offert le '+day(f.rewardAt))))),
   d.parrain?h('p',{className:'ch-parr-note'},'Code accepté : vous et '+d.parrain.name+' aurez chacun un mois offert le '+day(d.parrain.rewardAt)+'.'):
    d.canUse&&h('form',{className:'ch-parr-form',onSubmit:use},h('label',{htmlFor:'ch-parr-input'},'Un proche vous a donné un code ?'),
     h('div',null,h('input',{id:'ch-parr-input',value:code,onChange:e=>C(e.target.value),placeholder:'MOOV-XXXXX',maxLength:12,autoCapitalize:'characters',autoComplete:'off',required:true}),h('button',{type:'submit',className:'ch-chip strong',disabled:busy||!code.trim()},busy?'Un instant…':'Valider'))),
   err&&h('p',{className:'ch-wa-error',role:'alert'},err),done&&h('p',{className:'ch-parr-done',role:'status'},done));
 }

 function Account({api,user,state,bell,go,onAbout,onLogout,busy}){
  const plan=state?.plan,zone=state?.homeZone?.zone;
  const row=(icon,label,hint,onClick,extra)=>h('button',{type:'button',className:'ch-row',onClick},h('span',{className:'ch-row-icon'},h(Icon,{name:icon,size:19})),h('span',null,h('b',null,label),hint&&h('small',null,hint)),extra,h(Icon,{name:'chevron',size:18}));
  return h('div',{className:'ch-account'},
   h('section',{className:'ch-profile'},h(Face,{name:user.name,size:72,role:'client'}),h('div',null,h('h1',null,user.name),h('p',null,zone?'Fibre Moov · '+zone:'Client Moov Fibre')),
    plan&&h('div',{className:'ch-plan'},h('div',null,h('small',null,'Votre offre'),h('strong',null,plan.mbps+' Mb/s')),h('div',null,h('small',null,'Chaque mois'),h('strong',null,(plan.price||0).toLocaleString('fr-FR')+' F')),h('button',{type:'button',className:'ch-chip strong',onClick:()=>go('forfait')},'Changer de forfait'),state?.nextPlan&&h('p',{className:'ch-plan-next'},'À partir du '+new Date(state.nextPlan.at).toLocaleDateString('fr-FR',{day:'numeric',month:'long'}).replace(/^1 /,'1er ')+' : '+state.nextPlan.plan.mbps+' Mb/s pour '+(state.nextPlan.plan.price||0).toLocaleString('fr-FR')+' F par mois.'))),
   api&&h(WhatsAppCard,{api,go}),
   api&&h(ParrainageCard,{api}),
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
 window.FGClientHome={LiveTrip,ReportHero,Account,WhatsAppCard,ParrainageCard,Icon};
})();
