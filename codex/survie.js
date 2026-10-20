/* Mode survie : « Plus d'internet ? Guardian répond quand même. »
   Un téléphone à l'écran compose le *144#, comme pour Moov Money : le menu USSD vient du serveur (ussd.cjs),
   le signalement arrive au centre d'opérations Moov et le SMS de suivi s'affiche sur le téléphone. */
(function(){
 'use strict';
 const h=React.createElement,{useState:S,useEffect:E,useRef:R}=React;
 const CODE='*144#',KEYS=[['1',''],['2','ABC'],['3','DEF'],['4','GHI'],['5','JKL'],['6','MNO'],['7','PQRS'],['8','TUV'],['9','WXYZ'],['*',''],['0','+'],['#','']];
 const OFFERS=[['Signaler une panne','Sans photo ni internet. Le dossier arrive chez Moov.'],['Suivre mon dossier','Où en est la réparation, en une ligne.'],['Mon technicien','Son nom, son numéro, et dans combien de minutes il arrive.'],['Panne dans mon quartier ?','Inutile d’appeler si Moov est déjà au courant.'],['Le suivi par SMS','Un lien pour voir le technicien arriver sur la carte.']];
 const slow=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 const wait=ms=>new Promise(r=>setTimeout(r,slow()?Math.min(ms,150):ms));
 // *144# ouvre le menu ; *144*2# va directement au choix 2, comme sur les vrais menus.
 function parse(dialed){const m=String(dialed).match(/^\*144((?:\*[0-9]+)*)#$/);return m?m[1].replace(/^\*/,''):null;}
 function Bars(){return h('span',{className:'sv-bars','aria-hidden':true},[1,2,3,4].map(i=>h('i',{key:i,style:{height:3+i*2.5+'px'}})));}
 function NoWifi(){return h('svg',{width:15,height:15,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round','aria-hidden':true},h('path',{d:'M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19h.01M3 3l18 18'}));}

 function Phone({api,dial,onChange}){
  const [typed,T]=S(''),[step,ST]=S('dialer'),[screen,SC]=S(null),[history,HI]=S(''),[reply,RP]=S(''),[sms,SM]=S(null),[open,O]=S(false),[hint,HN]=S('');
  const input=R(null),alive=R(true),smsTimer=R(null);
  E(()=>()=>{alive.current=false;clearTimeout(smsTimer.current);},[]);
  E(()=>{if(dial){T(dial.code);HN('');}},[dial]);
  E(()=>{if(step==='dialog'&&!screen?.end)input.current?.focus();},[step,screen]);
  async function send(text){
   ST('running');let r;
   try{[r]=await Promise.all([api('/ussd','POST',{text}),wait(text?700:1300)]);}
   catch(e){r={end:true,message:e.message||'Le service est momentanément indisponible. Réessayez.'};}
   if(!alive.current)return;
   HI(text);RP('');SC(r);ST('dialog');
   if(r.sms){onChange?.();clearTimeout(smsTimer.current);smsTimer.current=setTimeout(()=>{if(alive.current){SM({...r.sms,at:new Date()});O(false);}},slow()?100:1600);}
  }
  function call(){const text=parse(typed);SM(null);O(false);if(text===null){HN(typed?'Ce code n’existe pas. Composez '+CODE+'.':'Composez '+CODE+' pour joindre Guardian.');return;}HN('');send(text);}
  function answer(e){e.preventDefault();const v=reply.trim();if(!/^[0-9]{1,2}$/.test(v))return;send(history?history+'*'+v:v);}
  function close(){ST('dialer');SC(null);HI('');RP('');T('');}
  function press(k){HN('');T(v=>(v+k).slice(0,18));}
  const time=new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  return h('div',{className:'sv-phone','aria-label':'Téléphone sans internet'},h('div',{className:'sv-notch','aria-hidden':true}),
   h('div',{className:'sv-screen'},
    h('div',{className:'sv-status'},h('b',null,time),h('span',{className:'sv-carrier'},h(Bars),'Moov',h(NoWifi))),h('span',{className:'sv-offline'},h(NoWifi),'Pas d’internet sur ce téléphone'),
    sms&&!open&&h('button',{type:'button',className:'sv-sms-banner',onClick:()=>O(!open),'aria-expanded':open},h('span',{className:'sv-sms-icon','aria-hidden':true},'SMS'),h('span',null,h('strong',null,sms.from),h('small',null,sms.text+(sms.link?'lien de suivi':'')))),
    open&&sms&&h('section',{className:'sv-messages','aria-label':'Message reçu'},h('header',null,h('strong',null,sms.from),B('Fermer',()=>O(false),'sv-link')),h('div',{className:'sv-bubble'},h('p',null,sms.text,sms.link&&h('a',{href:sms.link,target:'_blank',rel:'noopener'},location.origin.replace(/^https?:\/\//,'')+sms.link)),h('time',null,sms.at.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})))),
    h('div',{className:'sv-dialer'},
     h('label',{className:'sv-display'},h('span',{className:'sv-sr'},'Numéro à composer'),h('input',{value:typed,inputMode:'none',autoComplete:'off',spellCheck:false,placeholder:CODE,onChange:e=>{HN('');T(e.target.value.replace(/[^0-9*#]/g,'').slice(0,18));},onKeyDown:e=>{if(e.key==='Enter')call();}})),
     h('p',{className:'sv-hint',role:'status'},hint||' '),
     h('div',{className:'sv-keys'},KEYS.map(([k,sub])=>h('button',{key:k,type:'button',className:'sv-key',onClick:()=>press(k),'aria-label':k==='*'?'Étoile':k==='#'?'Dièse':k},h('b',null,k),h('small',null,sub||' ')))),
     h('div',{className:'sv-actions'},h('span'),h('button',{type:'button',className:'sv-call',onClick:call,'aria-label':'Appeler'},h('svg',{width:28,height:28,viewBox:'0 0 24 24',fill:'currentColor','aria-hidden':true},h('path',{d:'M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1Z'}))),
      h('button',{type:'button',className:'sv-erase',onClick:()=>T(v=>v.slice(0,-1)),'aria-label':'Effacer',disabled:!typed},'⌫'))),
    step!=='dialer'&&h('div',{className:'sv-veil'},
     step==='running'?h('div',{className:'sv-dialog sv-running',role:'status'},h('span',{className:'sv-spinner','aria-hidden':true}),'Exécution du code USSD…')
     :h('form',{className:'sv-dialog',role:'dialog','aria-label':'Menu '+CODE,onSubmit:screen.end?e=>{e.preventDefault();close();}:answer},
       h('p',{className:'sv-text'},screen.message),
       !screen.end&&h('input',{ref:input,className:'sv-reply',value:reply,inputMode:'numeric',maxLength:2,'aria-label':'Votre choix',onChange:e=>RP(e.target.value.replace(/[^0-9]/g,''))}),
       h('div',{className:'sv-buttons'},screen.end?h('button',{type:'submit',autoFocus:true},'OK'):h(React.Fragment,null,h('button',{type:'button',onClick:close},'Annuler'),h('button',{type:'submit',disabled:!reply},'Envoyer')))))),
   h('div',{className:'sv-home-bar','aria-hidden':true}));
 }
 function B(label,onClick,className){return h('button',{type:'button',className,onClick},label);}

 function View({api,onChange,onNavigate}){
  const [dial,D]=S(null);
  return h('div',{className:'sv'},
   h('header',{className:'sv-intro'},h('span',{className:'j-tag'},'MODE SURVIE'),h('h1',null,'Plus d’internet ?',h('br'),'Guardian répond quand même.'),
    h('p',null,'Tapez ',h('strong',null,CODE),' sur votre téléphone, comme pour Moov Money. Ça marche sans internet, sur tous les téléphones, même les plus simples.'),
    h('div',{className:'sv-code'},h('span',{className:'sv-code-chip'},CODE),h('button',{type:'button',className:'j-button primary',onClick:()=>D({code:CODE,n:Date.now()})},'Essayer ici'))),
   h('div',{className:'sv-stage'},h(Phone,{api,dial,onChange})),
   h('section',{className:'sv-offers j-card'},h('h2',null,'Ce que vous pouvez faire'),h('ol',null,OFFERS.map(([t,d],i)=>h('li',{key:t},h('span',{className:'sv-num'},i+1),h('div',null,h('strong',null,t),h('p',null,d))))),
    h('div',{className:'sv-note'},h('strong',null,'Votre signalement compte autant.'),h('p',null,'Il arrive au centre d’opérations Moov exactement comme depuis l’application. Les SMS vous préviennent ensuite à chaque étape.')),
    onNavigate&&h('button',{type:'button',className:'j-button',onClick:()=>onNavigate('tracking')},'Voir le suivi dans l’application')));
 }
 window.FGSurvie={View,Phone,parse,CODE};
})();
