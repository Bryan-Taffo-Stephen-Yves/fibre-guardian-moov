/* « Le client n'appelle plus » côté écran (serveur : appels.cjs).
   Restore : l'heure de retour promise, sur la carte du quartier et dans le suivi.
   CallButton / CallSheet : « Appeler Moov » ouvre l'appel ; le serveur vocal dit d'abord ce que Moov sait déjà.
   Calls : la carte « Appels évités » du tableau de bord de l'équipe Moov. Couleurs : variables de marque uniquement. */
(function(){
 'use strict';
 const h=React.createElement,{useEffect:E,useRef:R,useState:S}=React;
 const PHONE='M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1Z';
 const icon=(d,size=18)=>h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'currentColor','aria-hidden':true},h('path',{d}));
 const two=n=>String(n).padStart(2,'0');

 // « Internet revient vers 19 h 45 ». En retard : la nouvelle heure, dite franchement.
 function Restore({restore,compact=false}){
  if(!restore||restore.power)return null;
  if(restore.pending)return h('p',{className:'ap-restore is-pending'+(compact?' is-compact':'')},h('span',{className:'ap-restore-dot','aria-hidden':true}),'L’heure de retour arrive dès que l’équipe a validé l’intervention.');
  return h('p',{className:'ap-restore'+(restore.late?' is-late':'')+(compact?' is-compact':''),role:'status'},
   h('span',{className:'ap-restore-dot','aria-hidden':true}),
   h('span',null,'Internet revient vers ',h('b',null,restore.label)),
   restore.late&&h('small',null,'Nouvelle heure'));
 }

 function CallSheet({api,onClose,onGuardian,onSupport}){
  const [data,D]=S(null),[shown,SH]=S(0),[error,X]=S(''),[done,DONE]=S(null),[busy,BZ]=S(false),[seconds,SEC]=S(0),[voice,VOICE]=S(true),[ringing,RG]=S(true);
  const box=R(null),list=R(null),spoken=R(0),ring=R(null),hasVoice=typeof window!=='undefined'&&'speechSynthesis' in window,sound=window.FGSonnerie;
  E(()=>{let live=true;api('/noc/call','POST',{type:'start'}).then(r=>{if(live)D(r);}).catch(e=>{if(live)X(e.message||'L’appel n’a pas abouti. Réessayez.');});
   // La ligne sonne d'abord (« tuut… tuut »), puis le serveur vocal décroche au début de la deuxième sonnerie.
   ring.current=sound?.ringback()||null;const pick=setTimeout(()=>{ring.current?.();ring.current=null;RG(false);},matchMedia('(prefers-reduced-motion: reduce)').matches?600:6500);
   const prev=document.activeElement;box.current?.focus();
   const key=e=>{if(e.key==='Escape')close();};document.addEventListener('keydown',key);
   return()=>{live=false;clearTimeout(pick);ring.current?.();document.removeEventListener('keydown',key);if(hasVoice)speechSynthesis.cancel();sound?.mute(false);prev?.focus?.();};},[]);
  E(()=>{if(ringing)return;const t=setInterval(()=>SEC(v=>v+1),1000);return()=>clearInterval(t);},[ringing]);
  // Les phrases arrivent une à une, comme au téléphone ; la voix les lit si le téléphone sait le faire.
  E(()=>{if(ringing||!data||shown>=data.lines.length)return;const t=setTimeout(()=>SH(v=>v+1),shown?1300:500);return()=>clearTimeout(t);},[data,shown]);
  E(()=>{if(!voice||!hasVoice||!data)return;while(spoken.current<shown){const u=new SpeechSynthesisUtterance(data.lines[spoken.current++]);u.lang='fr-FR';u.rate=1.02;speechSynthesis.speak(u);}},[shown,voice,data]);
  E(()=>{sound?.mute(!voice);if(!voice&&hasVoice)speechSynthesis.cancel();},[voice]);
  E(()=>{const el=list.current;if(el)el.scrollTop=el.scrollHeight;},[shown]);
  function close(){ring.current?.();ring.current=null;if(hasVoice)speechSynthesis.cancel();if(!done)sound?.end();onClose();}
  async function finish(outcome){if(busy)return;BZ(true);X('');
   try{await api('/noc/call','POST',{type:'end',outcome,incident:data?.incident||null});if(hasVoice)speechSynthesis.cancel();
    if(outcome==='guardian'){onClose();onGuardian?.();return;}DONE(outcome);}
   catch(e){X(e.message||'Réessayez dans un instant.');}finally{BZ(false);}}
  const ready=data&&shown>=data.lines.length;
  // Rendu au niveau de la page : l'appel ne prend pas le style de la carte qui contient le bouton.
  return ReactDOM.createPortal(h('div',{className:'ap-layer',onClick:e=>{if(e.target===e.currentTarget)close();}},
   h('section',{className:'ap-call',role:'dialog','aria-modal':'true','aria-labelledby':'ap-title',tabIndex:-1,ref:box},
    h('header',{className:'ap-head'},
     h('span',{className:'ap-avatar'+(ringing?' is-ringing':''),'aria-hidden':true},h('i'),h('i'),icon(PHONE,26)),
     h('h2',{id:'ap-title'},'Service client Moov'),
     h('p',null,done?'Appel terminé':ringing?'Appel…':data?'En ligne · '+two(Math.floor(seconds/60))+':'+two(seconds%60):'Appel en cours…')),
    !done&&h('ol',{className:'ap-lines','aria-live':'polite',ref:list},(ringing?[]:data?.lines||[]).slice(0,shown).map((l,i)=>h('li',{key:i,className:i===0?'is-hello':''},l)),
     data&&!ready&&!ringing&&h('li',{className:'ap-typing','aria-hidden':true},h('i'),h('i'),h('i'))),
    done&&h('div',{className:'ap-done',role:'status'},
     done==='reassured'?[h('strong',{key:'a'},'Merci, à tout à l’heure.'),h('p',{key:'b'},'Guardian vous prévient à chaque étape, jusqu’au retour d’internet.')]
     :[h('strong',{key:'a'},'Votre demande est transmise.'),h('p',{key:'b'},'Un conseiller Moov vous répond ici, dans vos notifications.')]),
    error&&h('p',{className:'ap-error',role:'alert'},error),
    h('div',{className:'ap-actions'},
     done?h('button',{type:'button',className:'ap-primary',onClick:()=>{close();if(done==='called')onSupport?.();}},done==='called'?'Voir mes notifications':'Fermer')
     :ready?[
      data.known?h('button',{key:'ok',type:'button',className:'ap-primary',disabled:busy,onClick:()=>finish('reassured')},'C’est bon, je raccroche')
       :h('button',{key:'ok',type:'button',className:'ap-primary',disabled:busy,onClick:()=>finish('guardian')},'Vérifier ma box avec Guardian'),
      h('button',{key:'agent',type:'button',className:'ap-secondary',disabled:busy,onClick:()=>finish('called')},'Parler à un conseiller')]
     :h('button',{type:'button',className:'ap-hang',onClick:close,'aria-label':'Raccrocher'},icon(PHONE,26)),
     !done&&hasVoice&&h('button',{type:'button',className:'ap-voice','aria-pressed':voice,onClick:()=>VOICE(v=>!v)},voice?'Couper le son':'Écouter')))),document.body);
 }

 function CallButton({api,onGuardian,onSupport,className='j-button',label='Appeler Moov'}){
  const [open,O]=S(false);
  return h(React.Fragment,null,
   h('button',{type:'button',className:className+' ap-call-button',onClick:()=>{window.FGSonnerie?.unlock();O(true);}},icon(PHONE,17),h('span',null,label)),
   open&&h(CallSheet,{api,onClose:()=>O(false),onGuardian,onSupport}));
 }

 // Tableau de bord Moov : ce qui compte pour le service client.
 function Calls({calls}){
  if(!calls)return null;
  const pct=calls.informed?Math.round(100*calls.avoided/calls.informed):0;
  return h('section',{className:'oc-card ap-board oc-rise',style:{'--i':2}},
   h('div',{className:'oc-section-title'},h('div',null,h('h2',null,'Appels évités'),h('p',{className:'oc-sub'},'Clients prévenus avant d’appeler, sur 24 heures.'))),
   h('div',{className:'ap-board-big'},h('strong',null,calls.avoided.toLocaleString('fr-FR')),h('span',null,calls.informed?'sur '+calls.informed.toLocaleString('fr-FR')+' client'+(calls.informed>1?'s':'')+' prévenu'+(calls.informed>1?'s':'')+' · '+pct+' %':'Aucune panne de quartier sur 24 heures')),
   h('div',{className:'ap-board-bar',role:'img','aria-label':pct+' % des clients prévenus n’ont pas appelé'},h('i',{style:{width:pct+'%'}})),
   h('ul',{className:'ap-board-stats'},
    h('li',null,h('b',null,calls.opened),h('span',null,'ont lu l’alerte')),
    h('li',null,h('b',null,calls.reassured),h('span',null,'rassurés au téléphone')),
    h('li',{className:calls.called?'is-warn':''},h('b',null,calls.called),h('span',null,'ont appelé quand même'))),
   calls.rows?.length>0&&h('ul',{className:'ap-board-rows'},calls.rows.map(r=>h('li',{key:r.id},h('span',{className:'ap-board-zone'+(r.open?' is-open':'')},r.zone),h('span',null,r.avoided+' / '+r.informed+' sans appel')))));
 }

 window.FGAppel={Restore,CallButton,CallSheet,Calls};
})();
