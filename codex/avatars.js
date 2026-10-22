(function(){
 'use strict';
 // Avatars illustrés façon « bitmoji », dessinés maison en SVG (aucune image externe).
 // Face : portrait rond. Sticker : personnage avec un geste (saluer, pouce levé, téléphone, outils).
 const h=React.createElement;
 const V=n=>'var(--moov-'+n+')';
 const SKIN=[1,2,3,4,5,8].map(n=>V('illu-skin-'+n)),HAIR=[1,2,3].map(n=>V('illu-hair-'+n)),WAX=[1,2,3,4].map(n=>V('illu-wax-'+n));
 const WOMEN=/^(Awa|Amina|Aya|Mariam|Fatou|Adjoua|Rose|Aïcha|Aicha|Akissi|Affoué|Nadia|Salimata|Grace|Fanta|Aminata|Kadi|Mireille|Esther|Prisca)/i;
 // Personnages de la démo : un visage reconnaissable d'un écran à l'autre.
 const CAST={
  'Awa Koné':{woman:true,hair:'wrap',skin:2,wax:0,role:'client'},
  'Koffi N’Guessan':{hair:'fade',skin:0,beard:true,role:'tech'},
  'Ibrahim Traoré':{hair:'fade',skin:4,beard:true,role:'tech'},
  'Awa Kouamé':{woman:true,hair:'braids',skin:1,role:'tech'},
  'Amina Traoré':{woman:true,hair:'bun',skin:5,role:'tech'},
  'Yao Konan':{hair:'fade',skin:3,role:'tech'},
  'Rose Ehui':{woman:true,hair:'afro',skin:5,wax:3,role:'client'},
  'Direction technique':{woman:true,hair:'afro',skin:4,glasses:true,role:'team'}
 };
 let seq=0;
 function persona(name='',role){
  const n=[...String(name)].reduce((a,ch)=>(a*31+ch.charCodeAt(0))>>>0,7),known=CAST[name]||{};
  const woman=known.woman??WOMEN.test(name);
  const hair=known.hair||(woman?['wrap','braids','bun','afro'][n%4]:['fade','afro','fade','locks'][n%4]);
  return {woman,hair,skin:SKIN[known.skin??n%SKIN.length],hairColor:HAIR[n%HAIR.length],wax:WAX[known.wax??(n>>>3)%WAX.length],beard:known.beard??(!woman&&n%3===0),glasses:known.glasses??(!CAST[name]&&n%7===0),role:role||known.role||'tech',bg:['primary-50','accent-50','success-50'][(n>>>2)%3]};
 }
 // Couches dessinées dans un repère 100 × 100, tête centrée vers (50, 42).
 function backHair(p){
  if(p.hair==='afro')return h('g',{fill:p.hairColor},h('circle',{cx:50,cy:34,r:27}),h('circle',{cx:28,cy:42,r:11}),h('circle',{cx:72,cy:42,r:11}));
  if(p.hair==='braids')return h('g',{fill:p.hairColor},h('rect',{x:23,y:34,width:9,height:42,rx:4.5}),h('rect',{x:68,y:34,width:9,height:42,rx:4.5}));
  if(p.hair==='locks')return h('g',{fill:p.hairColor},[26,33,67,74].map(x=>h('rect',{key:x,x:x-3.5,y:30,width:7,height:30,rx:3.5})));
  if(p.hair==='bun'&&p.role!=='tech')return h('circle',{cx:50,cy:13,r:9,fill:p.hairColor});
  return null;
 }
 function frontHair(p){
  if(p.role==='tech')return h('g',null,
   p.hair==='bun'&&h('circle',{cx:30,cy:30,r:7,fill:p.hairColor}),
   h('path',{d:'M27 37C27 20 38 13 50 13s23 7 23 24Z',fill:V('primary-700')}),
   h('path',{d:'M27 37h50c1 3-2 5-6 5H33c-4 0-6-2-6-5Z',fill:V('primary-900')}),
   h('circle',{cx:50,cy:24,r:4.2,fill:V('accent-500')}),h('path',{d:'M48 24.4l1.4 1.4 2.6-2.8',fill:'none',stroke:V('white'),strokeWidth:1.3,strokeLinecap:'round',strokeLinejoin:'round'}));
  if(p.hair==='wrap')return h('g',null,
   h('path',{d:'M24 41C21 18 37 9 50 9c14 0 30 9 26 32-5-9-15-13-26-13s-21 4-26 13Z',fill:p.wax}),
   h('ellipse',{cx:63,cy:11,rx:9,ry:6,fill:p.wax,transform:'rotate(-24 63 11)'}),h('ellipse',{cx:43,cy:9,rx:8,ry:5,fill:p.wax,transform:'rotate(18 43 9)'}),
   [[34,22],[44,17],[56,17],[66,22],[40,28],[60,28],[50,22]].map(([x,y])=>h('circle',{key:x+'-'+y,cx:x,cy:y,r:1.8,fill:V('accent-100'),opacity:.85})));
  const d={fade:'M28 39C27 22 38 14 50 14s23 8 22 25c-4-8-12-12-22-12s-18 4-22 12Z',afro:'M27 40c-1-14 8-24 23-24s24 10 23 24c-5-7-12-10-23-10s-18 3-23 10Z',braids:'M28 40C27 22 38 14 50 14s23 8 22 26c-3-6-8-11-14-12-2 3-6 4-8 4s-6-1-8-4c-6 1-11 6-14 12Z',bun:'M28 40C27 23 38 15 50 15s23 8 22 25c-4-8-12-12-22-12s-18 4-22 12Z',locks:'M28 39C27 22 38 14 50 14s23 8 22 25c-4-8-12-12-22-12s-18 4-22 12Z'}[p.hair];
  return h('path',{d,fill:p.hairColor});
 }
 function outfit(p){
  if(p.role==='tech')return h('g',null,h('path',{d:'M12 100c2-17 15-27 38-27s36 10 38 27Z',fill:V('primary')}),h('path',{d:'M16 90h68v5H15Z',fill:V('accent-500'),opacity:.95}),h('path',{d:'M42 73l8 9 8-9',fill:'none',stroke:V('white'),strokeWidth:2.4,strokeLinejoin:'round'}));
  if(p.role==='team')return h('g',null,h('path',{d:'M12 100c2-17 15-27 38-27s36 10 38 27Z',fill:V('primary-800')}),h('path',{d:'M40 74l10 26 10-26c-3-1-7-1-10-1s-7 0-10 1Z',fill:V('white')}),h('path',{d:'M44 74l6 18 6-18',fill:'none',stroke:V('accent-500'),strokeWidth:1.8}),h('rect',{x:46,y:88,width:8,height:10,rx:1.5,fill:V('accent-500')}));
  return h('g',null,h('path',{d:'M12 100c2-17 15-27 38-27s36 10 38 27Z',fill:p.wax}),
   [[26,88],[38,82],[62,82],[74,88],[50,94],[32,96],[68,96]].map(([x,y])=>h('circle',{key:x+'-'+y,cx:x,cy:y,r:2.4,fill:V('white'),opacity:.55})),
   h('path',{d:'M40 74c3 5 7 7 10 7s7-2 10-7',fill:'none',stroke:p.woman?V('accent-200'):V('white'),strokeWidth:p.woman?2.6:2,strokeLinecap:'round',opacity:.9}));
 }
 function face(p){
  const dark=V('neutral-900');
  return h('g',null,
   h('rect',{x:43.5,y:58,width:13,height:17,rx:6,fill:p.skin}),h('path',{d:'M43.5 64c4 3 9 3 13 0v4c-4 3-9 3-13 0Z',fill:dark,opacity:.12}),
   h('ellipse',{cx:28,cy:45,rx:4.2,ry:5.6,fill:p.skin}),h('ellipse',{cx:72,cy:45,rx:4.2,ry:5.6,fill:p.skin}),
   p.woman&&p.role!=='tech'&&h('g',{fill:V('accent-500')},h('circle',{cx:27.5,cy:52,r:2.2}),h('circle',{cx:72.5,cy:52,r:2.2})),
   h('path',{d:'M28 40c0-15 9-23 22-23s22 8 22 23c0 15-9 26-22 26S28 55 28 40Z',fill:p.skin}),
   p.beard&&h('path',{d:'M30 47c2 12 10 19 20 19s18-7 20-19c-3 6-8 9-11 9-3-3-6-4-9-4s-6 1-9 4c-3 0-8-3-11-9Z',fill:p.hairColor,opacity:.92}),
   h('path',{d:'M36 34.5q5-3 9 0M55 34.5q4-3 9 0',fill:'none',stroke:p.hairColor,strokeWidth:2.2,strokeLinecap:'round'}),
   h('ellipse',{cx:41,cy:42.5,rx:4.4,ry:4.9,fill:V('illu-sclera')}),h('ellipse',{cx:59,cy:42.5,rx:4.4,ry:4.9,fill:V('illu-sclera')}),
   h('circle',{cx:41.6,cy:43.2,r:2.9,fill:dark}),h('circle',{cx:59.6,cy:43.2,r:2.9,fill:dark}),
   h('circle',{cx:42.6,cy:42,r:1,fill:V('white')}),h('circle',{cx:60.6,cy:42,r:1,fill:V('white')}),
   p.woman&&h('path',{d:'M36.4 39.6l-1.8-1.4M63.6 39.6l1.8-1.4',stroke:dark,strokeWidth:1.3,strokeLinecap:'round'}),
   p.glasses&&h('g',{fill:'none',stroke:dark,strokeWidth:1.6},h('rect',{x:34.5,y:37,width:13,height:11,rx:4.5}),h('rect',{x:52.5,y:37,width:13,height:11,rx:4.5}),h('path',{d:'M47.5 41h5'})),
   h('path',{d:'M47.5 50.5q2.5 2.2 5 0',fill:'none',stroke:dark,strokeWidth:1.5,strokeLinecap:'round',opacity:.45}),
   h('circle',{cx:35,cy:51,r:4,fill:V('illu-blush'),opacity:.32}),h('circle',{cx:65,cy:51,r:4,fill:V('illu-blush'),opacity:.32}),
   h('path',{d:'M41.5 55c5 6.5 12 6.5 17 0Z',fill:V('illu-lip')}),h('path',{d:'M42.6 55.3h14.8c-.4 1.6-1.2 2.4-1.9 2.6H44.5c-.8-.2-1.5-1-1.9-2.6Z',fill:V('white')}));
 }
 function character(p){return h(React.Fragment,null,backHair(p),outfit(p),face(p),frontHair(p));}
 function Face({name='',size=56,role,className=''}){
  const p=persona(name,role),[id]=React.useState(()=>'fga'+(++seq));
  return h('svg',{width:size,height:size,viewBox:'0 0 100 100',className:('fg-avatar '+className).trim(),'aria-hidden':true,focusable:false},
   h('defs',null,h('clipPath',{id},h('circle',{cx:50,cy:50,r:50}))),
   h('g',{clipPath:'url(#'+id+')'},h('rect',{width:100,height:100,fill:V(p.bg)}),h('g',{transform:'translate(0 6)'},character(p))));
 }
 function hand(p,x,y,s=1){return h('g',{transform:'translate('+x+' '+y+') scale('+s+')'},h('rect',{x:-7,y:-7,width:14,height:14,rx:6,fill:p.skin}),h('path',{d:'M-3.5 -6.5v-5a2.2 2.2 0 0 1 4.4 0v5M1 -6.5v-6a2.2 2.2 0 0 1 4.4 0v6',fill:p.skin}),h('path',{d:'M-2 -1h5',stroke:V('neutral-900'),strokeWidth:.8,opacity:.25}));}
 function sleeve(p){return p.role==='tech'?V('primary'):p.role==='team'?V('primary-800'):p.wax;}
 function pose(p,kind){
  const arm=d=>h('path',{d,fill:'none',stroke:sleeve(p),strokeWidth:11,strokeLinecap:'round'});
  if(kind==='wave')return h('g',{className:'fg-sticker-wave'},arm('M76 88C88 80 92 70 88 60'),h('g',{transform:'rotate(-14 88 52)'},hand(p,88,52,1.1)));
  if(kind==='thumbs')return h('g',null,arm('M26 90C24 86 27 82 32 80'),h('rect',{x:27,y:72,width:14,height:13,rx:5,fill:p.skin}),h('rect',{x:30,y:60,width:6,height:15,rx:3,fill:p.skin}));
  if(kind==='phone')return h('g',null,arm('M28 90C28 87 31 84 36 82'),h('rect',{x:33,y:62,width:15,height:25,rx:3,fill:V('neutral-900'),transform:'rotate(-10 40 74)'}),h('rect',{x:35,y:65,width:11,height:17,rx:1.5,fill:V('primary-200'),transform:'rotate(-10 40 74)'}),hand(p,38,84,.9));
  if(kind==='tools')return h('g',null,arm('M74 90C80 88 84 86 86 82'),h('g',{transform:'rotate(28 88 76)'},h('rect',{x:85,y:56,width:6,height:24,rx:2,fill:V('neutral-400')}),h('path',{d:'M82 57a6 6 0 0 1 12 0l-3-1v-4h-6v4Z',fill:V('neutral-400')})),hand(p,88,80,.95));
  return null;
 }
 function Sticker({name='',size=120,role,pose:kind='wave',say,className=''}){
  const p=persona(name,role);
  return h('span',{className:('fg-sticker '+className).trim(),style:{'--s':size+'px'}},
   h('svg',{width:size,height:size,viewBox:'0 -6 100 112',role:'img','aria-label':name?name+' en illustration':'Illustration',focusable:false},
    h('ellipse',{cx:50,cy:103,rx:34,ry:4,fill:V('neutral-900'),opacity:.08}),
    h('circle',{cx:50,cy:50,r:46,fill:V(p.bg)}),
    h('g',{className:'fg-sticker-body'},character(p),pose(p,kind))),
   say&&h('span',{className:'fg-sticker-say'},say));
 }
 window.FGAvatar={Face,Sticker,persona};
})();
