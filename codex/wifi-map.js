/* Pointer and keyboard manipulation; the 3D and SVG views share one placement state. */
(function(root){
 'use strict';
 const h=React.createElement,{useRef,useState,useEffect,useLayoutEffect}=React,P=root.FGWifiPlacement;
 function WifiMap(props){
  const host=useRef(null),runtime=useRef(null),latest=useRef(props),drag=useRef(null),[live,setLive]=useState(false),[handles,setHandles]=useState({}),[held,setHeld]=useState(null);
  latest.current=props;
  const uid=React.useId(),label=id=>id==='box'?'la box':'le répéteur';
  const point=id=>id==='box'?latest.current.box:latest.current.relay;
  function update(){
   const r=runtime.current;if(!r)return;
   const value=latest.current;
   for(const id of ['box','repeater']){const p=id==='box'?value.box:value.relay;r.world.equipment[id].position.set(p.x,0,p.z);}
   r.world.equipment.repeater.visible=value.repeater;
   r.world.floors.forEach((m,i)=>m.color.set(value.qualities?.[i]?{good:FGTheme.color('--moov-primary-100'),fair:FGTheme.color('--moov-accent-200'),poor:FGTheme.color('--moov-danger-300')}[value.qualities[i]]:FGTheme.color('--moov-neutral-100')));
   r.world.scene.updateMatrixWorld(true);r.renderer.render(r.world.scene,r.world.camera);
   const positions={};for(const id of ['box','repeater']){const p=point(id),v=new root.THREE.Vector3(p.x,.72,p.z).project(r.world.camera);positions[id]={left:(v.x+1)*host.current.clientWidth/2,top:(1-v.y)*host.current.clientHeight/2};}
   if(value.repeater&&Math.abs(positions.box.left-positions.repeater.left)<90&&Math.abs(positions.box.top-positions.repeater.top)<52){const middle=(positions.box.top+positions.repeater.top)/2;positions.box.top=middle-27;positions.repeater.top=middle+27;}
   setHandles(positions);
  }
  function finish(event,cancel=false){
   const d=drag.current;if(!d||(event?.pointerId!==undefined&&event.pointerId!==d.pointer))return;
   drag.current=null;setHeld(null);if(d.target.hasPointerCapture?.(d.pointer))d.target.releasePointerCapture(d.pointer);
   if(cancel)latest.current.onMove(d.id,d.start,'cancel');else if(d.moved)latest.current.onMove(d.id,point(d.id),'commit');
  }
  function planePoint(clientX,clientY){
   const rect=host.current.getBoundingClientRect(),r=runtime.current;
   if(r){const ray=new root.THREE.Raycaster();ray.setFromCamera(new root.THREE.Vector2((clientX-rect.left)/rect.width*2-1,1-(clientY-rect.top)/rect.height*2),r.world.camera);const v=new root.THREE.Vector3();if(ray.ray.intersectPlane(new root.THREE.Plane(new root.THREE.Vector3(0,1,0),0),v))return {x:v.x,z:v.z};return null;}
   const scale=Math.min(rect.width/500,rect.height/300),ox=(rect.width-500*scale)/2,oy=(rect.height-300*scale)/2;
   return {x:((clientX-rect.left-ox)/scale-250)/57,z:((clientY-rect.top-oy)/scale-150)/51};
  }
  function begin(id,event){
   if(drag.current||event.isPrimary===false||event.button!==0||(id==='repeater'&&!latest.current.repeater))return;
   const world=planePoint(event.clientX,event.clientY);if(!world)return;
   event.preventDefault();event.stopPropagation();const start={...point(id)},target=event.currentTarget;
   drag.current={id,start,pointer:event.pointerId,target,offset:{x:start.x-world.x,z:start.z-world.z}};
   target.setPointerCapture(event.pointerId);target.focus?.({preventScroll:true});setHeld(id);
  }
  function move(event){const d=drag.current;if(!d||d.pointer!==event.pointerId)return;event.preventDefault();event.stopPropagation();const p=planePoint(event.clientX,event.clientY);if(p){const next=P.clamp({x:p.x+d.offset.x,z:p.z+d.offset.z});if(Math.hypot(next.x-d.start.x,next.z-d.start.z)>.02)d.moved=true;if(d.moved)latest.current.onMove(d.id,next,'preview');}}
  function pick(event){
   if(!runtime.current)return;const {world}=runtime.current,rect=host.current.getBoundingClientRect(),ray=new root.THREE.Raycaster();ray.setFromCamera(new root.THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),world.camera);
   const hits=ray.intersectObjects([world.equipment.box,...(latest.current.repeater?[world.equipment.repeater]:[])],true).filter(v=>!v.object.userData.decorative);
   if(!hits.length)return;let obj=hits[0].object;while(obj&&obj!==world.equipment.box&&obj!==world.equipment.repeater)obj=obj.parent;
   if(obj)begin(obj===world.equipment.box?'box':'repeater',event);
  }
  function keyboard(id,e){const steps={ArrowLeft:[-.15,0],ArrowRight:[.15,0],ArrowUp:[0,-.15],ArrowDown:[0,.15]};if(!steps[e.key])return;e.preventDefault();if(drag.current)return;const [x,z]=steps[e.key],p=point(id),scale=e.shiftKey?3:1;latest.current.onMove(id,P.clamp({x:p.x+x*scale,z:p.z+z*scale}),'commit');}
  useEffect(()=>{
   const key=e=>{if(e.key==='Escape'&&drag.current){e.preventDefault();finish(null,true);}};
   const blur=()=>finish(null,true);document.addEventListener('keydown',key);root.addEventListener('blur',blur);
   return()=>{document.removeEventListener('keydown',key);root.removeEventListener('blur',blur);drag.current=null;};
  },[]);
  useEffect(()=>{
   if(!props.repeater&&drag.current?.id==='repeater')finish(null,true);
  },[props.repeater]);
  useEffect(()=>{
   let renderer,world,observer,dead=false;const owner={},container=host.current;
   setLive(false);
   if(!props.enabled||!root.THREE||!root.FGScene.acquire(owner))return;
   function cleanup(){if(dead)return;dead=true;finish(null,true);observer?.disconnect();root.removeEventListener('resize',resize);if(renderer){renderer.domElement.removeEventListener('webglcontextlost',lost);renderer.dispose();renderer.forceContextLoss?.();renderer.domElement.remove();}world?.dispose();runtime.current=null;root.FGScene.release(owner);}
   function lost(e){e.preventDefault();cleanup();setLive(false);}
   function resize(){if(!runtime.current)return;if(drag.current)finish(null,true);const w=container.clientWidth,hh=container.clientHeight;if(!w||!hh)return;renderer.setSize(w,hh,false);const aspect=w/hh,extent=world.extent,halfHeight=Math.max(2.6,extent/aspect),halfWidth=Math.max(extent,2.6*aspect);Object.assign(world.camera,{left:-halfWidth,right:halfWidth,top:halfHeight,bottom:-halfHeight});world.camera.updateProjectionMatrix();update();}
   try{
    renderer=new root.THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(root.devicePixelRatio||1,1.65));renderer.setClearColor(0,0);renderer.shadowMap.enabled=true;renderer.shadowMap.type=root.THREE.PCFSoftShadowMap;renderer.outputColorSpace=root.THREE.SRGBColorSpace;renderer.toneMapping=root.THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
    renderer.domElement.setAttribute('aria-hidden','true');renderer.domElement.addEventListener('webglcontextlost',lost);container.prepend(renderer.domElement);world=root.FGScene.houseWorld(root.THREE);runtime.current={world,renderer};
    if(root.ResizeObserver){observer=new ResizeObserver(resize);observer.observe(container);}else root.addEventListener('resize',resize);resize();setLive(true);
   }catch(e){cleanup();setLive(false);}
   return cleanup;
  },[props.enabled]);
  useLayoutEffect(update,[props.box.x,props.box.z,props.relay.x,props.relay.z,props.repeater,(props.qualities||[]).join(',')]);
  const listeners={onPointerMove:move,onPointerUp:e=>finish(e),onPointerCancel:e=>finish(e,true),onLostPointerCapture:e=>finish(e,true)};
  function handle(id){const p=point(id),position=live?handles[id]:null;return h('button',{key:id,type:'button',className:'wifi-map-handle '+(held===id?'is-dragging':''),'data-equipment':id,'data-x':p.x,'data-z':p.z,style:position?{left:position.left,top:position.top}:undefined,hidden:!position,'aria-label':'Déplacer '+label(id),'aria-describedby':uid+'-help',onPointerDown:e=>begin(id,e),onKeyDown:e=>keyboard(id,e),...listeners},id==='box'?'↔ Box':'↔ Répéteur');}
  const toSvg=p=>({x:250+p.x*57,y:150+p.z*51});
  function svgDevice(id){const p=toSvg(point(id)),other=toSvg(point(id==='box'?'repeater':'box')),close=props.repeater&&Math.abs(p.x-other.x)<72&&Math.abs(p.y-other.y)<48,displayY=close?(p.y+other.y)/2+(id==='box'?-26:26):p.y;return h('g',{key:id},h('circle',{cx:p.x,cy:p.y,r:id==='box'?45:30,fill:'none',stroke:FGTheme.color('--moov-neutral-500'),strokeWidth:2,strokeDasharray:'5 5',pointerEvents:'none','aria-hidden':true}),close&&h('line',{x1:p.x,x2:p.x,y1:p.y,y2:displayY,stroke:FGTheme.color('--moov-neutral-600'),pointerEvents:'none'}),h('g',{transform:'translate('+p.x+' '+displayY+')',className:'wifi-map-svg-device',role:'button',tabIndex:0,'aria-label':'Déplacer '+label(id),'aria-describedby':uid+'-help','data-equipment':id,'data-x':point(id).x,'data-z':point(id).z,onPointerDown:e=>begin(id,e),onKeyDown:e=>keyboard(id,e),...listeners},h('rect',{x:-33,y:-20,width:66,height:40,rx:12,fill:id==='box'?FGTheme.color('--moov-neutral-900'):FGTheme.color('--moov-primary-100'),stroke:FGTheme.color('--moov-neutral-800')}),h('text',{textAnchor:'middle',y:4,fill:id==='box'?'var(--moov-white)':FGTheme.color('--moov-neutral-900'),fontSize:11},id==='box'?'↔ Box':'↔ Répéteur')));}
  return h('section',{className:'wifi-map','aria-label':'Carte interactive de couverture Wi-Fi','data-renderer':live?'3d':'2d'},h('div',{className:'wifi-map-heading'},h('strong',null,'Déplacez votre installation'),h('span',null,live?'Carte 3D':'Plan 2D interactif')),h('p',{id:uid+'-help',className:'wifi-map-help'},'Glissez la box ou le répéteur. Au clavier : flèches sur un équipement. Échap annule le geste.'),h('div',{className:'wifi-map-stage',ref:host,onPointerDown:pick,...listeners},!live&&h('svg',{viewBox:'0 0 500 300',className:'wifi-map-svg','aria-label':'Plan interactif du logement'},h('rect',{x:65,y:45,width:370,height:210,rx:15,fill:FGTheme.color('--moov-neutral-200')}),['Salon','Chambre','Cuisine','Chambre d’enfant'].map((name,i)=>h('g',{key:name},h('rect',{x:i%2?257:77,y:i<2?57:157,width:166,height:86,rx:6,fill:props.qualities?.[i]?{good:FGTheme.color('--moov-primary-100'),fair:FGTheme.color('--moov-accent-200'),poor:FGTheme.color('--moov-danger-300')}[props.qualities[i]]:FGTheme.color('--moov-neutral-100')}),h('text',{x:i%2?340:160,y:i<2?75:233,textAnchor:'middle',fontSize:12},name))),svgDevice('box'),props.repeater&&svgDevice('repeater')),live&&handle('box'),live&&props.repeater&&handle('repeater')),h('p',{className:'wifi-map-caption'},held?'Déplacement en cours · relâchez pour placer.':'Les couleurs indiquent un signal estimé, pas une mesure de votre Wi-Fi.'),!props.repeater&&h('p',{className:'wifi-map-caption'},'Activez le répéteur ci-dessous pour le déplacer lui aussi.'));
 }
 root.FGWifiMap=WifiMap;
})(window);
