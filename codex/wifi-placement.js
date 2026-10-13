/* Shared coordinates for the interactive, illustrative Wi-Fi plan. */
(function(root){
  'use strict';
  const points={salon:{x:-1.6,z:-1.03},chambre:{x:1.6,z:-1.03},cuisine:{x:-1.6,z:1.03},enfant:{x:1.6,z:1.03},centre:{x:0,z:0}};
  const relay={x:3.5*3.2/13,z:3.5*2.06/13};
  const bounds={minX:-2.75,maxX:2.75,minZ:-1.65,maxZ:1.65};
  function clamp(p){return {x:Math.round(Math.max(bounds.minX,Math.min(bounds.maxX,Number.isFinite(p?.x)?p.x:0))*100)/100,z:Math.round(Math.max(bounds.minZ,Math.min(bounds.maxZ,Number.isFinite(p?.z)?p.z:0))*100)/100};}
  function room(p){if(Math.abs(p.x)<.32||Math.abs(p.z)<.2)return 'centre';return p.z<0?(p.x<0?'salon':'chambre'):(p.x<0?'cuisine':'enfant');}
  function logical(p){const r=room(p);return {id:r,x:8.5+p.x*13/3.2,y:8.5+p.z*13/2.06,col:p.x<0?0:1,row:p.z<0?0:1};}
  const api={points,relay,bounds,clamp,room,logical};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.FGWifiPlacement=api;
})(typeof window!=='undefined'?window:globalThis);
