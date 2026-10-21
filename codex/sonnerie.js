/* Les sons du téléphone, fabriqués dans le navigateur (aucun fichier audio).
   - ringback : la ligne qui sonne, « tuut… tuut » (440 Hz, 1,5 s de son puis 3,5 s de silence, comme en Côte d'Ivoire et en France).
   - touche : le petit son de chaque touche du clavier (fréquences DTMF officielles).
   - fin : les trois bips courts quand l'appel se termine.
   Sur iPhone, le son ne peut démarrer qu'après un toucher : chaque bouton appelle unlock() d'abord. */
(function(){
 'use strict';
 const DTMF={'1':[697,1209],'2':[697,1336],'3':[697,1477],'4':[770,1209],'5':[770,1336],'6':[770,1477],'7':[852,1209],'8':[852,1336],'9':[852,1477],'*':[941,1209],'0':[941,1336],'#':[941,1477]};
 const RING={hz:440,on:1.5,period:5};
 let ctx=null,muted=false;
 function audio(){
  if(ctx)return ctx;
  const A=typeof window!=='undefined'&&(window.AudioContext||window.webkitAudioContext);
  if(!A)return null;try{ctx=new A();}catch{ctx=null;}return ctx;
 }
 // À appeler dans le gestionnaire du toucher (règle des navigateurs mobiles).
 function unlock(){const c=audio();if(c&&c.state==='suspended')c.resume().catch(()=>{});return !!c;}
 // Une note douce : montée et descente de quelques millisecondes pour éviter les « clics ».
 function tone(freqs,start,length,volume){
  const c=audio();if(!c||muted)return [];
  const gain=c.createGain();gain.connect(c.destination);
  gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(volume,start+.015);
  gain.gain.setValueAtTime(volume,start+length-.03);gain.gain.linearRampToValueAtTime(0,start+length);
  return freqs.map(f=>{const o=c.createOscillator();o.type='sine';o.frequency.value=f;o.connect(gain);o.start(start);o.stop(start+length+.02);return o;});
 }
 function key(k){const c=audio();if(!c||!DTMF[k])return;tone(DTMF[k],c.currentTime,.12,.08);}
 // La ligne sonne jusqu'à stop() ; onRing(n) est prévenu à chaque sonnerie.
 function ringback({onRing}={}){
  const c=audio();let n=0,timer=null,stopped=false,live=[];
  function ring(){if(stopped)return;n++;onRing?.(n);if(c)live=tone([RING.hz],c.currentTime+.02,RING.on,.12);timer=setTimeout(ring,RING.period*1000);}
  ring();
  return function stop(){stopped=true;clearTimeout(timer);for(const o of live){try{o.stop();}catch{}}};
 }
 function end(){const c=audio();if(!c)return;for(let i=0;i<3;i++)tone([425],c.currentTime+i*.32,.18,.1);}
 function mute(value){muted=!!value;}
 window.FGSonnerie={unlock,key,ringback,end,mute,isMuted:()=>muted,RING,DTMF};
})();
