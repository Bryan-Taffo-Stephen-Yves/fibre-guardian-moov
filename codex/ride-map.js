/* Carte de suivi façon VTC : un quartier dessiné (rues, immeubles en relief, lagune, parc),
   le trajet du technicien en bleu, la camionnette qui roule et tourne aux carrefours, la caméra qui la suit.
   Tout est dessiné dans la page (aucune tuile à télécharger) : la carte marche aussi hors ligne.
   Le quartier est stylisé, pas un plan cadastral. La vue 3D incline le plan et donne de la hauteur aux immeubles.
   Performance : le décor est calculé une fois ; à chaque image, seuls la caméra et le véhicule bougent (attributs SVG). */
(function(){
 'use strict';
 const h=React.createElement,{useMemo:M,useEffect:E,useRef:R,memo}=React;
 const SIZE=1600,TILT=.62;
 const reduced=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 // Hasard reproductible : le même quartier à chaque affichage.
 function rng(seed){let a=seed>>>0;return()=>{a=a+0x6D2B79F5>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}

 // Repères affichés selon le quartier de l'intervention.
 const PLACES={
  'YOP-07':{home:'Niangon',base:'Agence Moov Yopougon',main:'Boulevard de Niangon',cross:'Rue du Marché',landmarks:['Carrefour Siporex','Marché de Niangon','École du quartier'],water:'Lagune Ébrié'},
  'COC-03':{home:'Cité des Arts',base:'Agence Moov Cocody',main:'Boulevard Latrille',cross:'Rue des Jardins',landmarks:['Carrefour de la Vie','Cité des Arts','Lycée du quartier'],water:'Baie de Cocody'},
  'MAR-02':{home:'Marcory Résidentiel',base:'Agence Moov Marcory',main:'Boulevard VGE',cross:'Rue de la Paix',landmarks:['Centre commercial','Marché de Marcory','Église du quartier'],water:'Lagune Ébrié'}
 };
 const place=segment=>PLACES[segment]||PLACES['YOP-07'];

 // Le quartier : rues (dont deux boulevards), îlots, immeubles, un parc et la lagune au sud-est.
 function city(){
  const r=rng(7),xs=[],ys=[];
  for(let k=0;k<=11;k++){xs.push(Math.round(k*150-25+(k%2?8:-6)));ys.push(Math.round(k*150-25+(k%3?-7:9)));}
  const MAIN_X=5,MAIN_Y=6,width=(axis,k)=>(axis==='x'?k===MAIN_X:k===MAIN_Y)?34:18;
  const water=(x,y)=>y>x*-0.55+1880;
  const blocks=[],parks=[],buildings=[];
  for(let i=0;i<xs.length-1;i++)for(let j=0;j<ys.length-1;j++){
   const x0=xs[i]+width('x',i)/2+4,x1=xs[i+1]-width('x',i+1)/2-4,y0=ys[j]+width('y',j)/2+4,y1=ys[j+1]-width('y',j+1)/2-4;
   if(water((x0+x1)/2,(y0+y1)/2))continue;
   const block={x0,y0,x1,y1};blocks.push(block);
   if(i===3&&j===2||i===8&&j===7){parks.push(block);continue;}
   const cols=r()<.5?2:3,rows=r()<.6?2:3,gw=(x1-x0)/cols,gh=(y1-y0)/rows,near=Math.min(Math.abs(i-MAIN_X+.5),Math.abs(j-MAIN_Y+.5));
   for(let c=0;c<cols;c++)for(let w=0;w<rows;w++){
    if(r()<.12)continue;
    const pad=3+r()*5,bx0=x0+c*gw+pad,bx1=x0+(c+1)*gw-pad,by0=y0+w*gh+pad,by1=y0+(w+1)*gh-pad;
    const tall=near<1.2?30+r()*44:10+r()*22;
    buildings.push({x0:bx0,y0:by0,x1:bx1,y1:by1,h:Math.round(tall),tone:r()<.07?'warm':r()<.15?'blue':'plain'});
   }
  }
  buildings.sort((a,b)=>a.y1-b.y1);
  const waterPath='M-400 2100L2000 780L2000 2200L-400 2200Z';
  // Trajet : de l'agence (sud-ouest) au client (nord-est), en suivant les rues et le boulevard.
  const route=[[xs[4],ys[8]-40],[xs[4],ys[7]],[xs[MAIN_X],ys[7]],[xs[MAIN_X],ys[5]],[xs[6],ys[5]],[xs[6],ys[4]+60]];
  return {xs,ys,MAIN_X,MAIN_Y,width,blocks,parks,buildings,waterPath,route};
 }
 const CITY=city();

 // Longueurs cumulées du trajet et point situé à une fraction donnée.
 function measure(route){let total=0;const seg=route.slice(1).map((p,k)=>{const a=route[k],len=Math.hypot(p[0]-a[0],p[1]-a[1]);total+=len;return {a,b:p,len,end:total};});return {seg,total};}
 const PATH=measure(CITY.route);
 function along(p){const d=Math.max(0,Math.min(1,p))*PATH.total;const s=PATH.seg.find(v=>d<=v.end)||PATH.seg.at(-1),t=s.len?(d-(s.end-s.len))/s.len:1;return {x:s.a[0]+(s.b[0]-s.a[0])*t,y:s.a[1]+(s.b[1]-s.a[1])*t,angle:Math.atan2(s.b[1]-s.a[1],s.b[0]-s.a[0])};}

 // Décor : calculé une fois par mode (2D ou 3D). k écrase la profondeur, les toits montent de la hauteur de l'immeuble.
 const World=memo(function World({k,segment}){
  const c=CITY,d=k<1,info=place(segment),Y=v=>v*k,lift=b=>d?b.h:0;
  const roads=[];
  c.xs.forEach((x,i)=>roads.push({key:'x'+i,x1:x,y1:0,x2:x,y2:SIZE,w:c.width('x',i),main:i===c.MAIN_X}));
  c.ys.forEach((y,j)=>roads.push({key:'y'+j,x1:0,y1:y,x2:SIZE,y2:y,w:c.width('y',j),main:j===c.MAIN_Y}));
  const label=(text,x,y,cls,rot=0)=>h('text',{x,y:Y(y),className:'rm-label '+(cls||''),transform:rot?`rotate(${rot} ${x} ${Y(y)})`:undefined},text);
  return h('g',{className:'rm-world'},
   h('rect',{x:-400,y:-400*k,width:SIZE+800,height:(SIZE+800)*k,className:'rm-ground'}),
   h('path',{d:c.waterPath,className:'rm-water',transform:`scale(1 ${k})`}),
   c.blocks.map((b,n)=>h('rect',{key:n,x:b.x0,y:Y(b.y0),width:b.x1-b.x0,height:Y(b.y1-b.y0),rx:6,className:'rm-block'})),
   c.parks.map((b,n)=>h('g',{key:'p'+n},h('rect',{x:b.x0,y:Y(b.y0),width:b.x1-b.x0,height:Y(b.y1-b.y0),rx:10,className:'rm-park'}),[.25,.5,.75].flatMap(fx=>[.3,.7].map(fy=>h('circle',{key:fx+'-'+fy,cx:b.x0+(b.x1-b.x0)*fx,cy:Y(b.y0+(b.y1-b.y0)*fy)-(d?6:0),r:9,className:'rm-tree'}))))),
   roads.map(r=>h('line',{key:'c'+r.key,x1:r.x1,y1:Y(r.y1),x2:r.x2,y2:Y(r.y2),strokeWidth:r.w+4,className:'rm-road-edge'})),
   roads.map(r=>h('line',{key:r.key,x1:r.x1,y1:Y(r.y1),x2:r.x2,y2:Y(r.y2),strokeWidth:r.w,className:'rm-road'+(r.main?' rm-road--main':'')})),
   roads.filter(r=>r.main).map(r=>h('line',{key:'m'+r.key,x1:r.x1,y1:Y(r.y1),x2:r.x2,y2:Y(r.y2),className:'rm-road-mid'})),
   c.buildings.map((b,n)=>{const H=lift(b),x=b.x0,w=b.x1-b.x0,y0=Y(b.y0),y1=Y(b.y1);
    return h('g',{key:n,className:'rm-bld rm-bld--'+b.tone},
     d&&h('rect',{x:x+3,y:y1-2,width:w,height:6,className:'rm-shadow'}),
     d&&h('path',{d:`M${x} ${y1}H${x+w}V${y1-H}H${x}Z`,className:'rm-wall'}),
     h('rect',{x,y:y0-H,width:w,height:y1-y0,rx:2,className:'rm-roof'}));}),
   label(info.main,c.xs[c.MAIN_X]+4,c.ys[2]+40,'rm-label--street',-90),
   label(info.main,c.xs[c.MAIN_X]+4,c.ys[8]+40,'rm-label--street',-90),
   label(info.cross,c.xs[2]+40,c.ys[c.MAIN_Y]-6,'rm-label--street'),
   label(info.landmarks[0],c.xs[c.MAIN_X]+22,c.ys[c.MAIN_Y]+28,'rm-label--place'),
   label(info.landmarks[1],c.xs[3]+20,c.ys[2]+70,'rm-label--park'),
   label(info.landmarks[2],c.xs[8]+16,c.ys[7]+70,'rm-label--park'),
   label(info.water,1180,1500,'rm-label--water'));
 });

 // Camionnette Moov vue de dessus ; elle pivote dans le sens de la rue.
 function VanShape(){return h('g',{className:'rm-van-shape'},
  h('ellipse',{cx:2,cy:3,rx:20,ry:11,className:'rm-van-shadow'}),
  h('rect',{x:-19,y:-10,width:38,height:20,rx:6,className:'rm-van-body'}),
  h('rect',{x:7,y:-8,width:9,height:16,rx:3,className:'rm-van-glass'}),
  h('rect',{x:-15,y:-7,width:19,height:14,rx:3,className:'rm-van-roof'}),
  h('circle',{cx:-5.5,cy:0,r:3.2,className:'rm-van-logo'}));}

 /* Props : progress (0 à 1), moving (le véhicule roule), segment, mode ('3d' ou '2d'), etaLabel (« 3 min »),
    follow (la caméra suit le véhicule), arrived. getProgress() peut renvoyer l'avancement en continu. */
 function Map({getProgress,segment,mode='3d',etaLabel,arrived,follow=true,label}){
  const k=mode==='3d'?TILT:1,box=R(null),size=R({w:400,h:600}),svg=R(null),camera=R(null),van=R(null),done=R(null),rest=R(null),bubble=R(null),state=R({x:null,y:null,zoom:1});
  const Y=v=>v*k,home=CITY.route.at(-1),base=CITY.route[0],info=place(segment);
  const routeD='M'+CITY.route.map(p=>p[0]+' '+Y(p[1])).join('L');
  const lengthK=M(()=>measure(CITY.route.map(p=>[p[0],Y(p[1])])).total,[k]);
  E(()=>{
   let frame=0,alive=true;const still=reduced();
   function draw(){
    if(!alive)return;
    const p=Math.max(0,Math.min(1,getProgress())),pt=along(p),X=pt.x,YY=Y(pt.y);
    // Angle à l'écran : en 3D, la profondeur est écrasée, l'angle aussi.
    const angle=Math.atan2(Math.sin(pt.angle)*k,Math.cos(pt.angle))*180/Math.PI;
    van.current?.setAttribute('transform',`translate(${X} ${YY}) rotate(${angle}) scale(${mode==='3d'?1.7:1.5})`);
    const traveled=p*lengthK;
    done.current?.setAttribute('stroke-dasharray',traveled+' '+(lengthK+10));
    rest.current?.setAttribute('stroke-dasharray','0 '+traveled+' '+(lengthK-traveled+10));
    // Caméra : cadre le véhicule et la maison, avance en douceur (ou d'un coup si l'appareil réduit les animations).
    // Caméra : cadre le véhicule et la maison (avec la bulle d'arrivée), avance en douceur.
    const s=state.current,hx=home[0],hy=Y(home[1]),{w,h:hh}=size.current;
    const tx=(X+hx)/2,ty=(YY+hy)/2-24,tz=Math.max(.6,Math.min(1.8,Math.min(w/(Math.abs(X-hx)+220),hh/(Math.abs(YY-hy)+300))));
    if(s.x===null||still){s.x=tx;s.y=ty;s.zoom=tz;}else{s.x+=(tx-s.x)*.05;s.y+=(ty-s.y)*.05;s.zoom+=(tz-s.zoom)*.04;}
    camera.current?.setAttribute('transform',`translate(${w/2} ${hh*.5}) scale(${s.zoom}) translate(${-s.x} ${-s.y})`);
    bubble.current?.setAttribute('transform',`translate(${hx} ${hy}) scale(${1/Math.max(.8,s.zoom)})`);
    frame=still?setTimeout(()=>requestAnimationFrame(draw),1000):requestAnimationFrame(draw);
   }
   // La carte prend la taille de son cadre : pas de rognage, la caméra centre au bon endroit.
   const fit=()=>{const r=box.current?.getBoundingClientRect();if(!r||!r.width)return;size.current={w:r.width,h:r.height};svg.current?.setAttribute('viewBox',`0 0 ${r.width} ${r.height}`);};
   fit();const ro=typeof ResizeObserver==='function'?new ResizeObserver(fit):null;ro?.observe(box.current);
   draw();
   return()=>{alive=false;ro?.disconnect();cancelAnimationFrame(frame);clearTimeout(frame);};
  },[k,follow,getProgress]);
  return h('div',{ref:box,className:'rm rm--'+mode,role:'img','aria-label':label||'Carte du trajet du technicien'},
   h('svg',{ref:svg,viewBox:'0 0 400 600',className:'rm-svg','aria-hidden':true},
    h('g',{ref:camera},
     h(World,{k,segment}),
     h('path',{d:routeD,className:'rm-route-casing'}),
     h('path',{ref:done,d:routeD,className:'rm-route-done'}),
     h('path',{ref:rest,d:routeD,className:'rm-route'}),
     h('g',{transform:`translate(${base[0]} ${Y(base[1])})`,className:'rm-base'},h('circle',{r:13}),h('path',{d:'M-6 4V-2l6-5 6 5v6Z'}),h('text',{y:30,className:'rm-pin-label'},info.base)),
     h('g',{transform:`translate(${home[0]} ${Y(home[1])})`},h('circle',{r:26,className:'rm-home-pulse'+(arrived?' is-still':'')}),h('circle',{r:10,className:'rm-home-dot'})),
     h('g',{ref:van,className:'rm-van'},h('circle',{r:24,className:'rm-van-halo'}),h(VanShape)),
     h('g',{ref:bubble,className:'rm-eta'+(arrived?' is-arrived':'')},
      h('path',{d:'M-34 -76h68a12 12 0 0 1 12 12v22a12 12 0 0 1-12 12h-24l-10 12-10-12h-24a12 12 0 0 1-12-12v-22a12 12 0 0 1 12-12Z',className:'rm-eta-bg'}),
      h('text',{y:-48,className:'rm-eta-big'},arrived?'Arrivé':etaLabel||''),
      h('text',{y:-34,className:'rm-eta-small'},arrived?info.home:'jusqu’à vous')))));
 }

 // Portrait illustré du technicien : visage, casquette Moov, tenue de travail. Couleur de peau selon la personne.
 const SKINS=['var(--moov-illu-skin-1)','var(--moov-illu-skin-3)','var(--moov-illu-skin-8)','var(--moov-illu-skin-2)','var(--moov-illu-skin-5)'];
 function Portrait({name='',size=56}){
  const n=[...String(name)].reduce((a,ch)=>a+ch.charCodeAt(0),0),skin=SKINS[n%SKINS.length],woman=/^(Awa|Amina|Aya|Mariam|Fatou|Adjoua)/i.test(name);
  return h('svg',{width:size,height:size,viewBox:'0 0 64 64',className:'rm-portrait','aria-hidden':true},
   h('circle',{cx:32,cy:32,r:32,className:'rm-portrait-bg'}),
   h('path',{d:'M10 64c2-12 11-18 22-18s20 6 22 18Z',className:'rm-portrait-shirt'}),
   h('path',{d:'M26 46l6 7 6-7',className:'rm-portrait-collar'}),
   h('rect',{x:27,y:38,width:10,height:9,rx:3,style:{fill:skin}}),
   woman&&h('path',{d:'M17 31c0-13 7-19 15-19s15 6 15 19c0 6-2 10-4 12H21c-2-2-4-6-4-12Z',className:'rm-portrait-hair'}),
   h('ellipse',{cx:32,cy:30,rx:11,ry:13,style:{fill:skin}}),
   h('circle',{cx:27.5,cy:30,r:1.4,className:'rm-portrait-eye'}),h('circle',{cx:36.5,cy:30,r:1.4,className:'rm-portrait-eye'}),
   h('path',{d:'M28 36c2.4 2 5.6 2 8 0',className:'rm-portrait-smile'}),
   h('path',{d:'M20 25c0-8 5-12 12-12s12 4 12 12Z',className:'rm-portrait-cap'}),
   h('path',{d:'M30 25h19c0 2-2 3-4 3H30Z',className:'rm-portrait-brim'}),
   h('circle',{cx:32,cy:19,r:2.2,className:'rm-portrait-badge'}));
 }
 window.FGRideMap={Map,Portrait,place,along};
})();
