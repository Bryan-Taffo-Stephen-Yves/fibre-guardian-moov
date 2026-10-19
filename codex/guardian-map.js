(function () {
  'use strict';
  const h = React.createElement, {useState, useRef, useEffect} = React;
  const WIDTH = 540, HEIGHT = 430;
  const PLACES = [
    {id:'YOP-07',name:'Yopougon',area:'Niangon',x:120,y:205},
    {id:'COC-03',name:'Cocody',area:'Cité des Arts',x:410,y:100},
    {id:'MAR-02',name:'Marcory',area:'Résidentiel',x:330,y:330}
  ];
  const LABELS = {reported:'Signalement reçu',proposed:'Analyse préparée',approved:'Plan approuvé',dispatched:'Équipe affectée',assigned:'Équipe affectée',en_route:'Votre équipe arrive',on_site:'Intervention en cours',repairing:'Réparation en cours',verifying:'Contrôle du réseau',resolved:'Connexion rétablie'};
  let nextId = 0;
  const clamp = (n, low, high) => Math.max(low, Math.min(high,n));
  function toCoordinates(x,y) { return {lat:5.33+(1-clamp(y,0,HEIGHT)/HEIGHT)*.04,lon:-4.09+clamp(x,0,WIDTH)/WIDTH*.06}; }
  function toPoint(value) {
    if(!value || value.lat==='' || value.lon==='' || !Number.isFinite(Number(value.lat)) || !Number.isFinite(Number(value.lon))) return null;
    const x=(Number(value.lon)+4.09)/.06*WIDTH, y=(1-(Number(value.lat)-5.33)/.04)*HEIGHT;
    if(x<-.01 || x>WIDTH+.01 || y<-.01 || y>HEIGHT+.01) return null;
    return {x:clamp(x,0,WIDTH),y:clamp(y,0,HEIGHT)};
  }
  function viewportAt(zoom,center) {
    const width=WIDTH/zoom,height=HEIGHT/zoom;
    return {x:clamp(center.x-width/2,0,WIDTH-width),y:clamp(center.y-height/2,0,HEIGHT-height),width,height};
  }
  function centerToReveal(point,view,padding=40) {
    const margin=Math.min(padding,view.width*.4,view.height*.4);
    return point.x<view.x+margin || point.x>view.x+view.width-margin || point.y<view.y+margin || point.y>view.y+view.height-margin
      ? {x:clamp(point.x,0,WIDTH),y:clamp(point.y,0,HEIGHT)} : null;
  }
  function arrivalDetails(status,position) {
    if(status==='en_route') {
      const seconds=position?.eta;
      if(Number.isFinite(seconds)&&seconds>0)return {value:String(Math.ceil(seconds/60)),caption:'min · estimation',numeric:true};
      return {value:'À confirmer',caption:Number.isFinite(seconds)?'Arrivée estimée atteinte':'Estimation indisponible',numeric:false};
    }
    const values={dispatched:['Départ à venir','Équipe affectée'],assigned:['Départ à venir','Équipe affectée'],on_site:['Sur place','Arrivée confirmée'],repairing:['Réparation','Équipe sur place'],verifying:['Vérification','Retour du service'],resolved:['Terminée','Intervention clôturée']};
    const [value,caption]=values[status]||['À confirmer','Consultez le dossier'];
    return {value,caption,numeric:false};
  }
  function Icon({name}) {
    const paths={plus:'M12 5v14M5 12h14',minus:'M5 12h14',center:'M12 2v4M12 18v4M2 12h4M18 12h4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',layers:'m12 3 10 6-10 6L2 9Zm-9 11 9 5 9-5M3 18l9 5 9-5',pin:'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0',arrow:'M5 12h14m-6-6 6 6-6 6'};
    return h('svg',{viewBox:'0 0 24 24',width:18,height:18,fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:paths[name]||paths.pin}));
  }
  function City({id}) {
    const blocks=[
      [20,18,66,51],[103,18,83,51],[202,18,58,51],[280,18,70,51],[369,18,57,39],[449,18,65,44],
      [20,88,64,68],[103,88,83,58],[202,88,57,65],[281,88,68,56],[369,134,54,47],[446,84,68,69],
      [21,174,64,61],[105,238,80,34],[203,174,55,62],[281,174,72,62],[373,204,52,47],[444,175,70,64],
      [20,253,66,65],[102,291,83,55],[204,256,57,60],[282,256,71,53],[447,261,64,47],
      [21,337,62,60],[106,364,77,34],[203,337,61,65],[282,364,65,39],[443,364,67,35]
    ];
    const roads='M0 78H540M0 164H540M0 246H540M0 325H540M94 0V430M193 0V430M270 0V430M362 0V430M435 0V430';
    return h('g',{'aria-hidden':true},
      h('rect',{width:WIDTH,height:HEIGHT,fill:'var(--moov-neutral-100)'}),
      blocks.map(([x,y,w,hh],i)=>h('g',{key:i},h('rect',{x,y:y+2,width:w,height:hh,rx:7,fill:'var(--moov-neutral-200)'}),h('rect',{x,y,width:w,height:hh-2,rx:7,fill:i%5===0?'var(--moov-primary-100)':'var(--moov-neutral-150)'}),h('path',{d:'M'+(x+8)+' '+(y+8)+'h'+(w-16),stroke:'var(--moov-neutral-25)',strokeWidth:2}))),
      h('path',{d:roads,stroke:'var(--moov-neutral-200)',strokeWidth:16,fill:'none'}),h('path',{d:roads,stroke:'var(--moov-neutral-25)',strokeWidth:13,fill:'none'}),
      h('path',{d:'M-15 293C84 269 133 179 224 174S336 167 419 64L465 -15',stroke:'var(--moov-neutral-200)',strokeWidth:25,fill:'none'}),
      h('path',{d:'M-15 293C84 269 133 179 224 174S336 167 419 64L465 -15',stroke:'var(--moov-warning-100)',strokeWidth:20,fill:'none'}),
      h('path',{d:'M-15 293C84 269 133 179 224 174S336 167 419 64L465 -15',stroke:'var(--moov-accent-100)',strokeWidth:2,strokeDasharray:'7 7',fill:'none'}),
      h('path',{d:'M371 430C387 388 392 357 427 337S486 308 543 309V430Z',fill:'var(--moov-neutral-200)'}),
      h('path',{d:'M371 430C387 388 392 357 427 337S486 308 543 309',stroke:'var(--moov-neutral-100)',strokeWidth:12,fill:'none'}),
      h('path',{d:'M394 426C408 382 417 370 450 354S504 333 537 334',stroke:'var(--moov-neutral-300)',strokeWidth:1,fill:'none'}),
      h('path',{d:'M411 426C427 385 446 383 476 366S516 352 540 352',stroke:'var(--moov-neutral-300)',strokeWidth:1,fill:'none'}),
      h('path',{d:'M24 17H84V69H24ZM202 88H259V153H202ZM445 175H514V239H445',fill:'var(--moov-primary-100)'}),
      [[36,29],[64,51],[223,101],[240,130],[463,192],[493,217]].map(([cx,cy],k)=>h('g',{key:'tree'+k},h('circle',{cx,cy:cy+2,r:8,fill:'var(--moov-neutral-300)',opacity:.55}),h('circle',{cx,cy,r:7,fill:'var(--moov-primary-100)'}))),
      h('text',{className:'g-map-street',x:207,y:241},'AV. DES ATELIERS'),h('text',{className:'g-map-street',x:23,y:322},'BD. DU QUARTIER'),
      h('text',{className:'g-map-street',x:341,y:242,transform:'rotate(-90 341 242)'},'AV. DES JARDINS'),
      h('text',{className:'g-map-water',x:443,y:393},'Lagune'),
      h('rect',{width:WIDTH,height:HEIGHT,fill:'url(#'+id+'-shade)',pointerEvents:'none'})
    );
  }
  function Van({position,id}) {
    return h('g',{className:'g-map-van',transform:'translate('+position.x+' '+position.y+')','aria-label':'Véhicule de l’équipe'},
      h('ellipse',{cx:0,cy:17,rx:27,ry:8,fill:'var(--moov-neutral-900)',opacity:.16}),
      h('path',{d:'M-25-9Q-25-15-19-15H9L23-6V12H-25Z',fill:'url(#'+id+'-van)',stroke:'var(--moov-neutral-900)',strokeWidth:1.5}),
      h('path',{d:'M-19-20H5L9-15H-25Z',fill:'var(--moov-primary-50)',stroke:'var(--moov-primary-100)',strokeWidth:1}),
      h('path',{d:'M5-15H9L23-6H9Z',fill:'var(--moov-primary-100)'}),
      h('path',{d:'M8-11H10L19-5V2H8Z',fill:'var(--moov-neutral-800)'}),h('path',{d:'M-20-10H2V6H-20Z',fill:'var(--moov-primary-100)'}),
      h('path',{d:'m-13-3 3-3 3 3-3 3Z',fill:'var(--moov-neutral-800)'}),h('path',{d:'M4-11V10',stroke:'var(--moov-neutral-400)',strokeWidth:1}),
      h('rect',{x:19,y:5,width:5,height:3,rx:1,fill:'var(--moov-primary-50)'}),h('rect',{x:-26,y:4,width:3,height:4,rx:1,fill:'var(--moov-accent-500)'}),
      [-15,15].map(x=>h('g',{key:x},h('circle',{cx:x,cy:12,r:7,fill:'var(--moov-neutral-900)',stroke:'var(--moov-white)',strokeWidth:1.5}),h('circle',{cx:x,cy:12,r:3,fill:'var(--moov-neutral-400)'})))
    );
  }
  function View({segments=[],incident,onSelect,onPick,selectedPoint,selectedSegment}) {
    const [zoom,Z] = useState(1),[center,C] = useState({x:270,y:215}),[network,N] = useState(true),[chosen,CH] = useState(null),[size,SIZE]=useState({width:540,height:430});
    const svg = useRef(null),idRef=useRef(null);if(!idRef.current)idRef.current='guardian-map-'+(++nextId);const id=idRef.current;
    useEffect(()=>{const element=svg.current;if(!element)return;const update=()=>{const rect=element.getBoundingClientRect();SIZE({width:rect.width,height:rect.height});};update();if(typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(update);observer.observe(element);return()=>observer.disconnect();},[]);
    useEffect(()=>{CH(null);},[incident?.id]);
    const p=incident?.position, active=selectedSegment||chosen||incident?.segment_id||incident?.segment,arrival=arrivalDetails(incident?.status,p);
    const point=toPoint(selectedPoint),outside=!!selectedPoint&&!point;
    const view=viewportAt(zoom,center),place=PLACES.find(v=>v.id===active),markerScale=Math.min(1.7,Math.max(.8,.95/Math.max(.1,Math.min(size.width/view.width,size.height/view.height))));
    const list=segments.length?segments:PLACES.filter(v=>!onPick&&v.id===active).map(v=>({id:v.id,zone:v.name,online:incident?.status==='resolved'?20:0,total:20,synthetic:true}));
    const focus=point||p||place||{x:270,y:215};
    const btn=(label,icon,fn,props={})=>h('button',{type:'button',className:'g-map-control',onClick:fn,title:label,'aria-label':label,...props},h(Icon,{name:icon}));
    function choose(value) { CH(value);onSelect?.(value); }
    function keepVisible(target,padding=40) { if(zoom<=1)return;const next=centerToReveal(target,view,padding);if(next)C(next); }
    function pick(event) {
      if(!onPick||event.target.closest('[data-map-marker]'))return;
      const matrix=svg.current.getScreenCTM();if(!matrix)return;
      // The inverse SVG matrix accounts for responsive sizing, zoom and meet letterboxing.
      const cursor=svg.current.createSVGPoint();cursor.x=event.clientX;cursor.y=event.clientY;
      const local=cursor.matrixTransform(matrix.inverse());
      if(local.x<0||local.x>WIDTH||local.y<0||local.y>HEIGHT)return;
      const coords=toCoordinates(local.x,local.y);onPick(coords.lat,coords.lon);
    }
    function keyMove(event) {
      if(!onPick||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();const base=point||{x:270,y:215},step=event.shiftKey?30:10;
      const coords=toCoordinates(base.x+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0),base.y+(event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0));keepVisible(toPoint(coords));onPick(coords.lat,coords.lon);
    }
    return h('section',{className:'g-map'+(onPick?' g-map--pick':''),'aria-label':onPick?'Localiser le signalement sur le plan':'Carte du réseau et des interventions'},
      h('div',{className:'g-map-stage'},
        h('svg',{ref:svg,className:'g-map-canvas',viewBox:[view.x,view.y,view.width,view.height].join(' '),preserveAspectRatio:'xMidYMid meet',role:'group',tabIndex:onPick?0:undefined,'aria-label':onPick?'Plan du quartier : cliquez pour placer le repère, ou utilisez les flèches du clavier.':'Plan des zones, du réseau et du véhicule de l’équipe',onClick:pick,onKeyDown:keyMove},
          h('defs',null,h('linearGradient',{id:id+'-shade',x1:0,y1:0,x2:1,y2:1},h('stop',{stopColor:'var(--moov-white)',stopOpacity:.05}),h('stop',{offset:1,stopColor:'var(--moov-neutral-300)',stopOpacity:.12})),h('linearGradient',{id:id+'-van',x1:0,y1:0,x2:0,y2:1},h('stop',{stopColor:'var(--moov-primary-50)'}),h('stop',{offset:.55,stopColor:'var(--moov-primary-100)'}),h('stop',{offset:1,stopColor:'var(--moov-primary-200)'}))),
          h(City,{id}),
          network&&!onPick&&h('g',{'aria-hidden':true},h('path',{d:'M120 205L225 205L280 164L410 100M280 164L330 330',fill:'none',stroke:'var(--moov-primary-200)',strokeWidth:8,strokeLinecap:'round',strokeLinejoin:'round',opacity:.65}),h('path',{d:'M120 205L225 205L280 164L410 100M280 164L330 330',fill:'none',stroke:'var(--moov-neutral-500)',strokeWidth:2,strokeDasharray:'3 5',strokeLinecap:'round'}),h('circle',{cx:280,cy:164,r:5,fill:'var(--moov-white)',stroke:'var(--moov-neutral-500)',strokeWidth:2})),
          p&&h('g',{'aria-hidden':true,className:'g-map-route'},
            // Trajet restant : épais, de l'orange (le véhicule) au vert (l'arrivée), comme une application de VTC.
            h('defs',null,h('linearGradient',{id:id+'-route',gradientUnits:'userSpaceOnUse',x1:p.x,y1:p.y,x2:p.targetX,y2:p.targetY},h('stop',{stopColor:'var(--moov-accent-500)'}),h('stop',{offset:.45,stopColor:'var(--moov-warning-300)'}),h('stop',{offset:1,stopColor:'var(--moov-success-500)'}))),
            h('path',{d:'M'+p.fromX+' '+p.fromY+'L'+p.x+' '+p.y,fill:'none',stroke:'var(--moov-neutral-300)',strokeWidth:4,strokeLinecap:'round',strokeDasharray:'1 8'}),
            h('path',{d:'M'+p.x+' '+p.y+'L'+p.targetX+' '+p.targetY,fill:'none',stroke:'var(--moov-white)',strokeWidth:14,strokeLinecap:'round'}),
            h('path',{d:'M'+p.x+' '+p.y+'L'+p.targetX+' '+p.targetY,fill:'none',stroke:'url(#'+id+'-route)',strokeWidth:8,strokeLinecap:'round'}),
            h('circle',{cx:p.fromX,cy:p.fromY,r:5,fill:'var(--moov-white)',stroke:'var(--moov-neutral-500)',strokeWidth:2}),
            h('g',{className:'g-map-dest',transform:'translate('+p.targetX+' '+p.targetY+')'},h('circle',{r:9,fill:'var(--moov-white)',stroke:'var(--moov-neutral-900)',strokeWidth:3.5}),h('g',{transform:'translate(-17 -58)'},h('rect',{width:34,height:34,rx:10,fill:'var(--moov-primary)',stroke:'var(--moov-white)',strokeWidth:3}),h('path',{d:'M9 17 17 10l8 7M11 16v9h12v-9',fill:'none',stroke:'var(--moov-white)',strokeWidth:2.2,strokeLinecap:'round',strokeLinejoin:'round'})),h('path',{d:'M0-24V-10',stroke:'var(--moov-primary)',strokeWidth:2.5}))),
          list.map(seg=>{const loc=PLACES.find(v=>v.id===seg.id)||{x:270,y:190,name:seg.id};const down=seg.online<seg.total,selected=active===seg.id;return h('g',{key:seg.id,'data-map-marker':true,transform:'translate('+loc.x+' '+loc.y+') scale('+markerScale+')',className:'g-map-node'+(selected?' is-selected':''),role:onSelect?'button':undefined,tabIndex:onSelect?0:undefined,'aria-pressed':onSelect?selected:undefined,'aria-label':seg.id+' · '+(seg.zone||loc.name)+(seg.synthetic?'':' · '+seg.online+' sur '+seg.total+' box en ligne'),onFocus:()=>keepVisible(loc,65*markerScale),onClick:e=>{e.stopPropagation();choose(seg.id);},onKeyDown:e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(seg.id);}}},
            h('circle',{r:25,fill:selected?'color-mix(in srgb,var(--moov-primary-100) 43.9%,transparent)':'color-mix(in srgb,var(--moov-white) 50.2%,transparent)',stroke:selected?'var(--moov-primary-400)':'var(--moov-white)',strokeWidth:1}),
            h('circle',{r:14,fill:down?'var(--moov-accent-500)':'var(--moov-primary-100)',stroke:'var(--moov-white)',strokeWidth:4}),
            h('text',{y:4,textAnchor:'middle',className:'g-map-node-status'},down?'!':'✓'),
            h('rect',{x:-47,y:29,width:94,height:34,rx:10,fill:selected?'var(--moov-neutral-900)':'color-mix(in srgb,var(--moov-white) 92.9%,transparent)',stroke:selected?'var(--moov-neutral-900)':'var(--moov-neutral-200)',strokeWidth:1}),
            h('text',{y:43,textAnchor:'middle',className:'g-map-node-name',fill:selected?'var(--moov-white)':'var(--moov-neutral-800)'},loc.name),
            h('text',{y:55,textAnchor:'middle',className:'g-map-node-id',fill:selected?'var(--moov-primary-100)':'var(--moov-neutral-600)'},seg.id)
          );}),
          onPick&&point&&h('g',{'data-map-marker':true,transform:'translate('+point.x+' '+point.y+')',className:'g-map-report-pin'},h('ellipse',{cy:9,rx:18,ry:5,fill:'var(--moov-neutral-900)',opacity:.14}),h('path',{d:'M0 6S-15-8-15-18a15 15 0 1 1 30 0C15-8 0 6 0 6Z',fill:'var(--moov-neutral-900)',stroke:'var(--moov-white)',strokeWidth:3}),h('circle',{cy:-18,r:6,fill:'var(--moov-primary-100)'})),
          p&&h(Van,{position:p,id})
        ),
        h('div',{className:'g-map-top'},h('span',{className:'g-map-badge'},h('i'),'PLAN DU RÉSEAU'),h('span',{className:'g-map-north','aria-label':'Orientation schématique nord'},'↑',h('small',null,'N'))),
        h('div',{className:'g-map-tools',role:'group','aria-label':'Outils de la carte'},btn('Agrandir la carte','plus',()=>Z(v=>Math.min(2.5,v+.5)),{disabled:zoom>=2.5}),btn('Réduire la carte','minus',()=>Z(v=>Math.max(1,v-.5)),{disabled:zoom<=1}),btn('Recentrer la carte','center',()=>{C({x:focus.x,y:focus.y});Z(1.5);}),!onPick&&btn('Afficher le réseau','layers',()=>N(v=>!v),{'aria-pressed':network})),
        zoom>1&&h('button',{type:'button',className:'g-map-reset',onClick:()=>{Z(1);C({x:270,y:215});}},'Vue complète · '+zoom.toFixed(1)+'×'),
        p&&h('div',{className:'g-map-trip'},h('span',{className:'g-map-driver'},h(Icon,{name:'arrow'})),h('div',null,h('strong',null,p.technician||'Équipe terrain'),h('small',null,LABELS[incident?.status]||'Trajet de l’équipe')),h('div',{className:'g-map-arrival','data-numeric':arrival.numeric},h('strong',null,arrival.value),h('small',null,arrival.caption))),
        onPick&&h('div',{className:'g-map-location'},h('span',{className:'g-map-driver'},h(Icon,{name:'pin'})),h('div',null,h('strong',null,outside?'Coordonnées hors de ce plan':point?'Emplacement du signalement':'Placez votre repère'),h('small',null,outside?'Vos coordonnées sont conservées. Ce plan n’est pas géographique.':point?Number(selectedPoint.lat).toFixed(5)+' · '+Number(selectedPoint.lon).toFixed(5):'Cliquez sur le plan ou utilisez les flèches.')))
      ),
      h('footer',{className:'g-map-footer'},h('span',null,h('i',{className:'g-map-legend-dot'}),onPick?'Position déclarée':'Réseau schématique'),h('small',null,'Plan schématique'))
    );
  }
  window.FGMap={View,toCoordinates,toPoint,viewportAt,centerToReveal,arrivalDetails};
})();
