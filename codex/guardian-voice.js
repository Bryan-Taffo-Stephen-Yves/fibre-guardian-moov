/* Guardian parle et regarde.
   - Voix : les réponses de Guardian sont lues à voix haute (voix française du téléphone), ou jouées
     en dioula quand une phrase enregistrée par une personne qui parle dioula existe (voix/dioula/).
   - Photo : l'abonné photographie sa box ; l'image est réduite sur le téléphone, une première lecture
     des voyants y est faite (src/vision.js) puis le serveur la complète et la croise avec les mesures. */
(function(){
 'use strict';
 const h=React.createElement,{useState:S,useEffect:E,useRef:R}=React;
 const KEY='fg-voix';
 const listeners=new Set();
 let enabled=(()=>{try{return localStorage.getItem(KEY)==='1';}catch(_){return false;}})(),audio=null,speakingId=null;
 const notify=()=>listeners.forEach(fn=>fn());
 function setEnabled(v){enabled=!!v;try{localStorage.setItem(KEY,enabled?'1':'0');}catch(_){}if(!enabled)stop();notify();}
 function frenchVoice(){const list=window.speechSynthesis?.getVoices?.()||[];return list.find(v=>/^fr[-_]FR/i.test(v.lang)&&/google|natural|neural|amélie|thomas/i.test(v.name))||list.find(v=>/^fr[-_]FR/i.test(v.lang))||list.find(v=>/^fr/i.test(v.lang))||null;}
 function stop(){try{audio?.pause();}catch(_){}audio=null;try{window.speechSynthesis?.cancel();}catch(_){}speakingId=null;notify();}
 function tts(text,id){
  if(!window.speechSynthesis||!window.SpeechSynthesisUtterance)return false;
  const u=new SpeechSynthesisUtterance(String(text).replace(/\bMbps\b/g,'mégabits par seconde').replace(/\bFCFA\b/g,'francs CFA').replace(/\bWi-Fi\b/gi,'wifi'));
  u.lang='fr-FR';u.rate=1.02;const v=frenchVoice();if(v)u.voice=v;
  u.onend=u.onerror=()=>{if(speakingId===id){speakingId=null;notify();}};
  window.speechSynthesis.speak(u);return true;
 }
 // message : { id, text, voice?: { lang:'dioula', key, text, file } }
 function speak(message){
  stop();if(!message?.text)return;speakingId=message.id||'x';notify();
  const file=message.voice?.file;
  if(file&&/^[\w-]+\.(mp3|m4a|ogg|opus)$/.test(file)){
   audio=new Audio('voix/dioula/'+file);audio.onended=()=>{speakingId=null;audio=null;notify();};
   audio.play().catch(()=>{audio=null;if(!tts(message.text,speakingId)){speakingId=null;notify();}});return;
  }
  if(!tts(message.text,speakingId)){speakingId=null;notify();}
 }
 function useVoice(){const [,tick]=S(0);E(()=>{const fn=()=>tick(n=>n+1);listeners.add(fn);return()=>listeners.delete(fn);},[]);return {enabled,speakingId};}
 const supported=()=>!!(window.speechSynthesis||window.Audio);

 const Speaker=({on})=>h('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:'M4 9h3l5-4v14l-5-4H4z'}),on?h('path',{d:'M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11'}):h('path',{d:'m17 9 5 6m0-6-5 6'}));

 // Bouton d'en-tête : Guardian lit (ou non) ses réponses à voix haute.
 function Toggle(){
  const v=useVoice();if(!supported())return null;
  return h('button',{type:'button',className:'gv-toggle'+(v.enabled?' on':''),'aria-pressed':v.enabled,onClick:()=>{setEnabled(!v.enabled);},title:v.enabled?'Guardian lit ses réponses à voix haute':'Guardian ne parle pas'},h(Speaker,{on:v.enabled}),h('span',null,v.enabled?'Voix activée':'Voix'));
 }
 // Sous une réponse : l'écouter, et voir la phrase dioula quand il y en a une.
 function Listen({message}){
  const v=useVoice(),playing=v.speakingId===message.id;if(!supported())return null;
  return h('div',{className:'gv-listen'},
   message.voice?.text&&h('p',{className:'gv-dioula',lang:'dyu'},h('span',null,'En dioula'),message.voice.text),
   h('button',{type:'button',className:'gv-play'+(playing?' playing':''),onClick:()=>playing?stop():speak(message),'aria-label':playing?'Arrêter la lecture':'Écouter cette réponse'+(message.voice?.file?' en dioula':'')},h(Speaker,{on:true}),playing?'Arrêter':message.voice?.file?'Écouter en dioula':'Écouter'));
 }
 // Sous un message de l'abonné écrit en nouchi ou en dioula : ce que Guardian a compris.
 function Meaning({message}){
  if(!message.lang||!message.meaning)return null;
  return h('small',{className:'gv-meaning'},({nouchi:'Nouchi',dioula:'Dioula'})[message.lang]||'Compris','. Guardian a compris : « '+message.meaning+' »');
 }

 // Photo de la box : image réduite (1024 px) envoyée au serveur, et lecture locale de secours.
 function loadImage(file){return new Promise((ok,ko)=>{const url=URL.createObjectURL(file),im=new Image();im.onload=()=>{URL.revokeObjectURL(url);ok(im);};im.onerror=()=>{URL.revokeObjectURL(url);ko(new Error('Image illisible. Reprenez la photo.'));};im.src=url;});}
 function draw(im,max){const s=Math.min(1,max/Math.max(im.naturalWidth,im.naturalHeight)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(im.naturalWidth*s));c.height=Math.max(1,Math.round(im.naturalHeight*s));c.getContext('2d').drawImage(im,0,0,c.width,c.height);return c;}
 async function prepare(file){
  if(!/^image\//.test(file.type||''))throw new Error('Choisissez une photo.');
  const im=await loadImage(file),big=draw(im,1024),image=big.toDataURL('image/jpeg',.82);
  let local=null;
  try{const small=draw(im,480),data=small.getContext('2d').getImageData(0,0,small.width,small.height),r=window.FG?.vision?.analyze([data],{opt:-20});if(r)local=r.ok?{ok:true,visual:r.visual,reading:r.reading}:{ok:false,reason:r.reason};}catch(_){local=null;}
  return {image,local,preview:draw(im,320).toDataURL('image/jpeg',.7)};
 }
 const Camera=()=>h('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinejoin:'round','aria-hidden':true},h('path',{d:'M4 8h3l2-3h6l2 3h3v11H4z'}),h('circle',{cx:12,cy:13,r:3.5}));
 function PhotoButton({onPhoto,onError,disabled,label,className}){
  const input=R(null);
  async function picked(e){const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(!file)return;try{onPhoto(await prepare(file));}catch(err){onError?.(err.message);}}
  return h(React.Fragment,null,
   h('input',{ref:input,type:'file',accept:'image/*',capture:'environment',className:'j-sr',tabIndex:-1,'aria-hidden':true,onChange:picked}),
   h('button',{type:'button',className:className||'j-button gv-photo',disabled,onClick:()=>input.current?.click(),'aria-label':label||'Envoyer une photo de ma box',title:'Photo de ma box'},h(Camera),label&&h('span',null,label)));
 }

 window.FGVoice={speak,stop,useVoice,setEnabled,isEnabled:()=>enabled,Toggle,Listen,Meaning,PhotoButton,Camera,prepare};
})();
