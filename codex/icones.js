/* Icônes Fibre Guardian : dessinées pour l'app, pas prises d'une bibliothèque.
   Chaque icône a trois couches :
   - un fond doux (la forme pleine, en transparence de la couleur du bouton) ;
   - le trait (la couleur du bouton) ;
   - un détail en orange Moov (l'aiguille, le # de *144#, l'antenne de Guardian…) qui donne le caractère.
   Les couleurs viennent du CSS (classes fgi-f, fgi-l, fgi-a dans design-system.css) : aucune couleur ici. */
(function(){
 'use strict';
 const h=React.createElement;
 const ring=(cx,cy,r)=>'M'+(cx-r)+' '+cy+'a'+r+' '+r+' 0 1 0 '+(2*r)+' 0a'+r+' '+r+' 0 1 0 '+(-2*r)+' 0Z';
 // f = fond plein doux, l = trait, a = détail orange en trait, A = détail orange plein, w = petit trou clair
 const ICONS={
  // Compteur de vitesse : l'aiguille orange part vers le haut débit.
  gauge:[['f','M3.5 16.5a8.5 8.5 0 0 1 17 0Z'],['l','M3.5 16.5a8.5 8.5 0 0 1 17 0M3 19.5h18M7 10.5l.8.8M12 8v1.1M17 10.5l-.8.8'],['a','M12 16.5l3.8-4.6'],['A',ring(12,16.5,1.6)]],
  // Guardian : sa tête-bulle, ses yeux, son sourire et son antenne.
  guardian:[['f','M5 10a4.5 4.5 0 0 1 4.5-4.5h5A4.5 4.5 0 0 1 19 10v3.5a4.5 4.5 0 0 1-4.5 4.5H12l-4 3v-3.3A4.5 4.5 0 0 1 5 13.5Z'],['l','M5 10a4.5 4.5 0 0 1 4.5-4.5h5A4.5 4.5 0 0 1 19 10v3.5a4.5 4.5 0 0 1-4.5 4.5H12l-4 3v-3.3A4.5 4.5 0 0 1 5 13.5ZM9.6 10.6v.9M14.4 10.6v.9M10 14c1.2.9 2.8.9 4 0M12 5.5V3.6'],['A',ring(12,2.6,1.3)]],
  // Box Moov qui diffuse le Wi-Fi.
  devices:[['f','M4.5 14h15a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-3A1.5 1.5 0 0 1 4.5 14Z'],['l','M4.5 14h15a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-3A1.5 1.5 0 0 1 4.5 14ZM7 17h.01M10 17h.01M15 17h3'],['a','M7.2 7.6a7 7 0 0 1 9.6 0M9.6 10.2a3.4 3.4 0 0 1 4.8 0'],['A',ring(12,12,1)]]
  ,
  // Carte du quartier : la fibre court jusqu'à l'épingle orange.
  map:[['f','M3 6.5 8.5 4.5l7 2 5.5-2v13l-5.5 2-7-2L3 19.5Z'],['l','M3 6.5 8.5 4.5l7 2 5.5-2v13l-5.5 2-7-2L3 19.5ZM6 16.5c1.8-1.8 3.8.6 6-1.4'],['A','M18 9.2c0 2.4-3 5.3-3 5.3s-3-2.9-3-5.3a3 3 0 0 1 6 0Z'],['w',ring(15,9.2,1.05)]],
  // Forfait : des barres qui montent, une flèche qui file.
  up:[['f','M4 20v-4.5h3.2V20ZM10.4 20v-7.5h3.2V20ZM16.8 20V10h3.2v10Z'],['l','M4 20v-4.5h3.2V20ZM10.4 20v-7.5h3.2V20ZM16.8 20V10h3.2v10Z'],['a','M4 10.5l4.5-4.5 3 3L17 3.5M14 3.5h3v3']],
  // Panne : un câble fibre coupé, l'éclair au milieu.
  alert:[['f','M5.2 15.6 8.4 12.4l3.2 3.2-3.2 3.2ZM12.4 8.4l3.2-3.2 3.2 3.2-3.2 3.2Z'],['l','M5.2 15.6 8.4 12.4l3.2 3.2-3.2 3.2ZM12.4 8.4l3.2-3.2 3.2 3.2-3.2 3.2ZM3 21l3.6-3.6M17.4 6.6 21 3'],['a','M12.9 9.6 11 12.2h2.2l-1.9 2.6']],
  // Mon compte : une carte d'abonné avec sa photo.
  user:[['f','M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z'],['l','M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM5.6 16a3 3 0 0 1 5.8 0M14 10h4.5M14 13.5h3'],['A',ring(8.5,10.3,1.9)]],
  // Sans internet : le téléphone et le # du *144#.
  sms:[['f','M7.5 2.5h9A1.5 1.5 0 0 1 18 4v16a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V4a1.5 1.5 0 0 1 1.5-1.5Z'],['l','M7.5 2.5h9A1.5 1.5 0 0 1 18 4v16a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V4a1.5 1.5 0 0 1 1.5-1.5ZM11 18.5h2'],['a','M10.8 7.5l-.6 6M13.8 7.5l-.6 6M9.3 9.6h5.4M9 11.6h5.4']],
  gift:[['f','M4.5 11h15v8.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1Z'],['l','M4.5 11h15v8.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1ZM3 7.5h18V11H3ZM12 7.5v13'],['a','M12 7.5S10.4 3.6 8 4.4c-1.8.6-.8 3.1 4 3.1Zm0 0s1.6-3.9 4-3.1c1.8.6.8 3.1-4 3.1Z']],
  // Mes données : le bouclier et son cadenas.
  shield:[['f','m12 3 8 3v6c0 5.6-8 9-8 9s-8-3.4-8-9V6Z'],['l','m12 3 8 3v6c0 5.6-8 9-8 9s-8-3.4-8-9V6Z'],['A','M9.3 11.5h5.4v4.3H9.3Z'],['a','M10.4 11.5V10a1.6 1.6 0 0 1 3.2 0v1.5']],
  folder:[['f','M3 7.5A2 2 0 0 1 5 5.5h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],['l','M3 7.5A2 2 0 0 1 5 5.5h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],['a','m8.5 13.5 2.5 2.5 4.8-5']],
  bell:[['f','M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15Z'],['l','M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15ZM12 3v2'],['a','M10 21h4']],
  // Accueil : la maison, et la fibre qui entre par la porte.
  home:[['f','M4.5 10 12 4l7.5 6v9.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1Z'],['l','M3 11 12 3.8l9 7.2M4.5 10v9.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V10'],['a','M10 20.5v-4a2 2 0 0 1 4 0v4']],
  wallet:[['f','M4 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a1 1 0 0 1 1-1Z'],['l','M4 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a1 1 0 0 1 1-1ZM4 7l11-3.5V7'],['A',ring(17,13.5,1.6)]]
 };
 // Les autres noms utilisés dans l'app renvoient vers ces dessins.
 const ALIAS={chat:'guardian',notifications:'bell',compte:'user',ville:'map',survie:'sms',report:'alert',phone:'sms'};
 const name=n=>ICONS[n]?n:ALIAS[n]&&ICONS[ALIAS[n]]?ALIAS[n]:null;
 function Icon({name:n,size=24,className}){
  const k=name(n);if(!k)return null;
  return h('svg',{className:'fgi'+(className?' '+className:''),width:size,height:size,viewBox:'0 0 24 24','aria-hidden':true,focusable:false,'data-icon':k},
   ICONS[k].map(([t,d],i)=>h('path',{key:i,d,className:'fgi-'+({f:'f',l:'l',a:'a',A:'af',w:'w'}[t]),
    fill:t==='f'||t==='A'||t==='w'?'currentColor':'none',fillOpacity:t==='f'?.18:undefined,
    stroke:t==='l'||t==='a'?'currentColor':'none',strokeWidth:t==='l'||t==='a'?1.7:undefined,strokeLinecap:'round',strokeLinejoin:'round'})));
 }
 // Onde de lumière au toucher : on note où le doigt a touché, le CSS dessine l'onde (design-system.css, .is-tap).
 const TAP='.ac-svc,.ch-row,.ac-promo';
 try{document.addEventListener('pointerdown',e=>{const b=e.target&&e.target.closest&&e.target.closest(TAP);if(!b||b.disabled)return;const r=b.getBoundingClientRect();
  b.style.setProperty('--rx',Math.round(e.clientX-r.left)+'px');b.style.setProperty('--ry',Math.round(e.clientY-r.top)+'px');
  b.classList.remove('is-tap');void b.offsetWidth;b.classList.add('is-tap');clearTimeout(b._fgTap);b._fgTap=setTimeout(()=>b.classList.remove('is-tap'),650);},{passive:true});}catch(_){}
 window.FGIcones={Icon,has:n=>!!name(n),names:Object.keys(ICONS)};
})();
