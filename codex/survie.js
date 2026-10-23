/* Mode survie : « Plus d'internet ? Guardian répond quand même. »
   Un téléphone à l'écran compose le *144#, comme pour Moov Money : le menu USSD vient du serveur (ussd.cjs),
   le signalement arrive au centre d'opérations Moov et le SMS de suivi s'affiche sur le téléphone. */
(function(){
 'use strict';
 const h=React.createElement,{useState:S,useEffect:E,useRef:R}=React;
 const CODE='*144#',KEYS=[['1',''],['2','ABC'],['3','DEF'],['4','GHI'],['5','JKL'],['6','MNO'],['7','PQRS'],['8','TUV'],['9','WXYZ'],['*',''],['0','+'],['#','']];
 const OFFERS=[['Signaler une panne','Sans photo ni internet. Le dossier arrive chez Moov.'],['Suivre mon dossier','Où en est la réparation, en une ligne.'],['Mon technicien','Son nom, son numéro, et dans combien de minutes il arrive.'],['Panne dans mon quartier ?','Inutile d’appeler si Moov est déjà au courant.'],['Le suivi par SMS','Un lien pour voir le technicien arriver sur la carte.'],['Appeler le 111','Le serveur vocal de Moov vous dit d’abord ce qu’il sait déjà.']];
 const slow=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 const wait=ms=>new Promise(r=>setTimeout(r,slow()?Math.min(ms,150):ms));
 // *144# ouvre le menu ; *144*2# va directement au choix 2, comme sur les vrais menus.
 function parse(dialed){const m=String(dialed).match(/^\*144((?:\*[0-9]+)*)#$/);return m?m[1].replace(/^\*/,''):null;}
 function Bars(){return h('span',{className:'sv-bars','aria-hidden':true},[1,2,3,4].map(i=>h('i',{key:i,style:{height:3+i*2.5+'px'}})));}
 function NoWifi(){return h('svg',{width:15,height:15,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round','aria-hidden':true},h('path',{d:'M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19h.01M3 3l18 18'}));}

 // Le service client à appeler depuis le téléphone (numéro d'exemple, signalé dans « À propos de la démo »).
 const SERVICE='111',SERVICE_NAME='Service client Moov';
 const RING_MS=6500; // On décroche au début de la deuxième sonnerie.
 const PHONE_PATH='M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1Z';
 const icon=(d,size=26,stroke=false)=>h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:stroke?'none':'currentColor',stroke:stroke?'currentColor':'none',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d}));
 const two=n=>String(n).padStart(2,'0');
 const sound=()=>window.FGSonnerie;
 const voiceOk=()=>typeof window!=='undefined'&&'speechSynthesis' in window;
 function suggestion(typed){if(parse(typed)!==null)return 'Guardian · sans internet';if(typed===SERVICE)return SERVICE_NAME;return null;}

 // Le clavier, la fenêtre USSD et l'écran d'appel, comme sur un iPhone.
 function Phone({api,dial,onChange}){
  const [typed,T]=S(''),[step,ST]=S('dialer'),[screen,SC]=S(null),[history,HI]=S(''),[reply,RP]=S(''),[sms,SM]=S(null),[open,O]=S(false),[hint,HN]=S('');
  const [call,CA]=S(null),[lines,LI]=S(0),[secs,SEC]=S(0),[speaker,SPK]=S(true);
  const input=R(null),alive=R(true),smsTimer=R(null),ring=R(null),timers=R([]),spoken=R(0);
  const later=(fn,ms)=>{const t=setTimeout(fn,ms);timers.current.push(t);return t;};
  function stopAll(){ring.current?.();ring.current=null;timers.current.forEach(clearTimeout);timers.current=[];if(voiceOk())speechSynthesis.cancel();}
  E(()=>()=>{alive.current=false;clearTimeout(smsTimer.current);stopAll();},[]);
  E(()=>{if(dial){T(dial.code);HN('');}},[dial]);
  E(()=>{if(step==='reply')input.current?.focus();},[step]);
  // Appel en ligne : le chronomètre, puis les phrases du serveur vocal une à une.
  E(()=>{if(call?.phase!=='live')return;const t=setInterval(()=>SEC(v=>v+1),1000);return()=>clearInterval(t);},[call?.phase]);
  E(()=>{if(call?.phase!=='live'||!call.data||lines>=call.data.lines.length)return;const t=setTimeout(()=>LI(v=>v+1),lines?1400:400);return()=>clearTimeout(t);},[call,lines]);
  E(()=>{if(!speaker||!voiceOk()||call?.phase!=='live'||!call.data)return;while(spoken.current<lines){const u=new SpeechSynthesisUtterance(call.data.lines[spoken.current++]);u.lang='fr-FR';u.rate=1.02;speechSynthesis.speak(u);}},[lines,speaker,call]);
  E(()=>{sound()?.mute(!speaker);if(!speaker&&voiceOk())speechSynthesis.cancel();},[speaker]);

  async function send(text){
   ST('running');let r;
   try{[r]=await Promise.all([api('/ussd','POST',{text}),wait(text?700:1300)]);}
   catch(e){r={end:true,message:e.message||'Le service est momentanément indisponible. Réessayez.'};}
   if(!alive.current)return;
   HI(text);RP('');SC(r);ST('ussd');
   if(r.sms){onChange?.();clearTimeout(smsTimer.current);smsTimer.current=setTimeout(()=>{if(alive.current){SM({...r.sms,at:new Date()});O(false);}},slow()?100:1600);}
  }
  // L'appel au service client : la ligne sonne, puis le serveur vocal décroche.
  function startCall(){
   ST('call');SEC(0);LI(0);spoken.current=0;CA({phase:'ringing',data:null,done:null,error:''});
   const answer=api('/noc/call','POST',{type:'start'}).catch(e=>({error:e.message||'L’appel n’a pas abouti.'}));
   ring.current=sound()?.ringback()||null;
   later(async()=>{ring.current?.();ring.current=null;const data=await answer;if(!alive.current)return;
    if(data.error){sound()?.end();CA({phase:'over',data:null,done:null,error:data.error});later(close,2200);return;}
    CA({phase:'live',data,done:null,error:''});},slow()?600:RING_MS);
  }
  function hangUp(){stopAll();sound()?.end();CA(c=>({...(c||{}),phase:'over'}));later(close,1400);}
  async function finish(outcome){
   try{await api('/noc/call','POST',{type:'end',outcome,incident:call?.data?.incident||null});}catch{}
   if(!alive.current)return;stopAll();sound()?.end();CA(c=>({...c,phase:'over',done:outcome}));later(close,2600);
  }
  function dialNow(){
   sound()?.unlock();const text=parse(typed);SM(null);O(false);
   if(text!==null){HN('');send(text);return;}
   if(typed===SERVICE){HN('');startCall();return;}
   HN(typed?'Ce numéro ne répond pas. Composez '+CODE+' ou le '+SERVICE+'.':'Composez '+CODE+' ou appelez le '+SERVICE+'.');
  }
  function answer(e){e.preventDefault();const v=reply.trim();if(!/^[0-9]{1,2}$/.test(v))return;send(history?history+'*'+v:v);}
  function close(){stopAll();ST('dialer');SC(null);HI('');RP('');T('');CA(null);}
  function press(k){sound()?.unlock();sound()?.key(k);HN('');T(v=>(v+k).slice(0,18));}
  function type(k){sound()?.unlock();sound()?.key(k);RP(v=>(v+k).slice(0,2));}
  const time=new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}),match=suggestion(typed);
  const ready=call?.data&&lines>=call.data.lines.length;
  return h('div',{className:'sv-phone','aria-label':'Téléphone sans internet'},h('div',{className:'sv-notch','aria-hidden':true}),
   h('div',{className:'sv-screen'},
    h('div',{className:'sv-status'},h('b',null,time),h('span',{className:'sv-carrier'},h(Bars),'Moov',h(NoWifi))),
    sms&&!open&&h('button',{type:'button',className:'sv-sms-banner',onClick:()=>O(!open),'aria-expanded':open},h('span',{className:'sv-sms-icon','aria-hidden':true},'SMS'),h('span',null,h('strong',null,sms.from),h('small',null,sms.text+(sms.link?'lien de suivi':'')))),
    open&&sms&&h('section',{className:'sv-messages','aria-label':'Message reçu'},h('header',null,h('strong',null,sms.from),B('Fermer',()=>O(false),'sv-link')),h('div',{className:'sv-bubble'},h('p',null,sms.text,sms.link&&h('a',{href:sms.link,target:'_blank',rel:'noopener'},location.origin.replace(/^https?:\/\//,'')+sms.link)),h('time',null,sms.at.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})))),
    h('div',{className:'sv-dialer'},
     h('span',{className:'sv-offline'},h(NoWifi),'Pas d’internet sur ce téléphone'),
     h('label',{className:'sv-display'},h('span',{className:'sv-sr'},'Numéro à composer'),h('input',{value:typed,inputMode:'none',autoComplete:'off',spellCheck:false,placeholder:CODE,onChange:e=>{HN('');T(e.target.value.replace(/[^0-9*#]/g,'').slice(0,18));},onKeyDown:e=>{if(e.key==='Enter')dialNow();}})),
     hint?h('p',{className:'sv-hint',role:'status'},hint):h('p',{className:'sv-match'+(match?' is-on':'')},match?h(React.Fragment,null,h('span',{className:'sv-match-dot','aria-hidden':true}),match):' '),
     h('div',{className:'sv-keys'},KEYS.map(([k,sub])=>h('button',{key:k,type:'button',className:'sv-key'+(k==='*'||k==='#'?' is-sign':''),onClick:()=>press(k),'aria-label':k==='*'?'Étoile':k==='#'?'Dièse':k},h('b',null,k),sub&&h('small',null,sub)))),
     h('div',{className:'sv-actions'},h('span'),h('button',{type:'button',className:'sv-call',onClick:dialNow,'aria-label':'Appeler'},icon(PHONE_PATH,30)),
      h('button',{type:'button',className:'sv-erase',onClick:()=>T(v=>v.slice(0,-1)),'aria-label':'Effacer',disabled:!typed},h('svg',{width:30,height:22,viewBox:'0 0 30 22','aria-hidden':true},h('path',{d:'M9 1h18a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H9L1 11Z',fill:'currentColor'}),h('path',{d:'m13 7 8 8m0-8-8 8',stroke:'var(--moov-neutral-900)',strokeWidth:2.2,strokeLinecap:'round'})))),
     h('nav',{className:'sv-tabs','aria-hidden':true},h('span',null,icon('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',20,true),'Récents'),h('span',null,icon('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',20,true),'Contacts'),h('span',{className:'is-on'},icon('M6 5h.01M12 5h.01M18 5h.01M6 11h.01M12 11h.01M18 11h.01M6 17h.01M12 17h.01M18 17h.01',20,true),'Clavier'))),
    // Fenêtre USSD : plein écran gris, texte centré, deux boutons en bas (comme sur iPhone).
    ['running','ussd','reply'].includes(step)&&h('div',{className:'sv-ussd'+(step==='reply'?' is-reply':''),role:'dialog','aria-label':'Menu '+CODE},
     step==='running'?h('div',{className:'sv-ussd-text sv-running',role:'status'},h('span',{className:'sv-spinner','aria-hidden':true}),'Requête USSD en cours…')
     :h(React.Fragment,null,
      h('p',{className:'sv-ussd-text'},screen.message),
      step==='reply'?h('form',{className:'sv-ussd-form',onSubmit:answer},
        h('input',{ref:input,className:'sv-reply',value:reply,inputMode:'none',maxLength:2,'aria-label':'Votre choix',placeholder:'Votre choix',onChange:e=>RP(e.target.value.replace(/[^0-9]/g,''))}),
        h('div',{className:'sv-ussd-buttons'},h('button',{type:'button',className:'is-light',onClick:close},'Annuler'),h('button',{type:'submit',className:'is-dark',disabled:!reply},'Envoyer')),
        h('div',{className:'sv-pad'},['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k,i)=>k?h('button',{key:i,type:'button',onClick:()=>k==='⌫'?RP(v=>v.slice(0,-1)):type(k),'aria-label':k==='⌫'?'Effacer le choix':k},k):h('span',{key:i}))))
      :h('div',{className:'sv-ussd-buttons'},h('button',{type:'button',className:'is-light',onClick:close,autoFocus:true},'Fermer'),!screen.end&&h('button',{type:'button',className:'is-dark',onClick:()=>ST('reply')},'Répondre')))),
    // Écran d'appel : la ligne sonne, puis le serveur vocal de Moov répond.
    step==='call'&&call&&h('section',{className:'sv-calling'+(call.phase!=='ringing'?' is-live':''),'aria-label':'Appel au '+SERVICE_NAME},
     h('header',null,h('span',{className:'sv-calling-avatar'+(call.phase==='ringing'?' is-ringing':''),'aria-hidden':true},h('i'),h('i'),'M'),
      h('h3',null,SERVICE_NAME),
      h('p',{role:'status'},call.phase==='ringing'?'Appel…':call.phase==='over'?(call.error||'Appel terminé'):two(Math.floor(secs/60))+':'+two(secs%60))),
     call.phase!=='ringing'&&call.data&&!call.done&&h('ol',{className:'sv-calling-lines','aria-live':'polite'},call.data.lines.slice(0,lines).map((l,i)=>h('li',{key:i},l))),
     call.done&&h('p',{className:'sv-calling-done'},call.done==='called'?'Un conseiller Moov vous rappelle. Sa réponse arrivera aussi par SMS.':'Merci. Moov vous prévient par SMS à chaque étape.'),
     call.phase==='live'&&ready&&!call.done&&h('div',{className:'sv-calling-choices'},
      call.data.known&&h('button',{type:'button',className:'is-light',onClick:()=>finish('reassured')},'C’est bon, je raccroche'),
      h('button',{type:'button',className:'is-glass',onClick:()=>finish('called')},'Parler à un conseiller')),
     h('div',{className:'sv-calling-grid'},
      h('button',{type:'button','aria-pressed':!speaker,onClick:()=>{sound()?.unlock();SPK(v=>!v);}},h('span',null,speaker?icon('M4 9v6h4l5 4V5L8 9Zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4Z',24):icon('M4 9v6h4l5 4V5L8 9ZM16 9l5 6m0-6-5 6',24,true)),speaker?'Haut-parleur':'Son coupé'),
      h('button',{type:'button',disabled:true},h('span',null,icon('M6 5h.01M12 5h.01M18 5h.01M6 11h.01M12 11h.01M18 11h.01M6 17h.01M12 17h.01M18 17h.01',24,true)),'Clavier'),
      h('button',{type:'button',disabled:true},h('span',null,icon('M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm-6-3a6 6 0 0 0 12 0M12 18v3',24,true)),'Micro')),
     call.phase!=='over'&&h('button',{type:'button',className:'sv-hang',onClick:hangUp,'aria-label':'Raccrocher'},icon(PHONE_PATH,30)))),
   h('div',{className:'sv-home-bar','aria-hidden':true}));
 }
 function B(label,onClick,className){return h('button',{type:'button',className,onClick},label);}

 function View({api,onChange,onNavigate}){
  const [dial,D]=S(null);
  return h('div',{className:'sv'},
   h('header',{className:'sv-intro'},h('span',{className:'j-tag'},'MODE SURVIE'),h('h1',null,'Plus d’internet ?',h('br'),'Guardian répond quand même.'),
    h('p',null,'Tapez ',h('strong',null,CODE),' sur votre téléphone, comme pour Moov Money. Ça marche sans internet, sur tous les téléphones, même les plus simples. Vous pouvez aussi appeler le ',h('strong',null,SERVICE),'.'),
    h('div',{className:'sv-code'},h('span',{className:'sv-code-chip'},CODE),h('button',{type:'button',className:'j-button primary',onClick:()=>D({code:CODE,n:Date.now()})},'Essayer ici'),h('button',{type:'button',className:'j-button',onClick:()=>D({code:SERVICE,n:Date.now()})},'Composer le '+SERVICE)),
    // Recommandation de Codex (2026-10-23) : le jury voit tout de suite que *144# est un code d'exemple.
    h('p',{className:'sv-example'},h('span',{className:'sv-example-tag'},'Exemple'),CODE+' et le '+SERVICE+' sont des numéros d’exemple : le vrai code court sera créé par Moov. Ici, le menu tourne dans l’application et retrouve le même dossier, la même étape et la même suite que l’application.')),
   h('div',{className:'sv-stage'},h(Phone,{api,dial,onChange})),
   h('section',{className:'sv-offers j-card'},h('h2',null,'Ce que vous pouvez faire'),h('ol',null,OFFERS.map(([t,d],i)=>h('li',{key:t},h('span',{className:'sv-num'},i+1),h('div',null,h('strong',null,t),h('p',null,d))))),
    h('div',{className:'sv-note'},h('strong',null,'Votre signalement compte autant.'),h('p',null,'Il arrive au centre d’opérations Moov exactement comme depuis l’application. Les SMS vous préviennent ensuite à chaque étape.')),
    onNavigate&&h('button',{type:'button',className:'j-button',onClick:()=>onNavigate('tracking')},'Voir le suivi dans l’application')));
 }
 window.FGSurvie={View,Phone,parse,CODE,SERVICE};
})();
