'use strict';
const crypto=require('node:crypto');
const id=()=>crypto.randomUUID(),token=()=>crypto.randomBytes(32).toString('base64url');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
class Problem extends Error { constructor(status,message){super(message);this.status=status;} }
const insist=(ok,msg,status=400)=>{if(!ok)throw new Problem(status,msg);};
function word(v,label,max=100){insist(typeof v==='string'&&v.trim().length>0&&v.trim().length<=max&&!/[\u0000-\u001f]/.test(v),label+' invalide.');return v.trim();}
function paragraph(v,label,max=2000){insist(typeof v==='string'&&v.trim().length>0&&v.trim().length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v),label+' invalide.');return v.trim();}
function number(v,label,min=0,max=1e9,nullable=true){if(v===null||v===undefined){insist(nullable,label+' requis.');return null;}insist(typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max,label+' invalide.');return v;}
function metrics(raw={}){
 insist(raw&&typeof raw==='object'&&!Array.isArray(raw),'Mesures invalides.');
 const out={};for(const [key,min,max] of [['downloadMbps',0,100000],['uploadMbps',0,100000],['latencyMs',0,120000],['jitterMs',0,120000],['lossPct',0,100],['wifiDbm',-150,0],['opticalDbm',-100,10],['connected',0,10000]])out[key]=number(raw[key],key,min,max);
 return out;
}
function diagnose(m,scope='gateway'){
 const evidence=[];let kind='unknown',title='Mesures insuffisantes',advice='Effectuez un nouveau test et comparez les observations.';
 if(m.opticalDbm!==null&&m.opticalDbm < -36){kind='optical';title='Signal optique très faible';evidence.push(m.opticalDbm+' dBm mesurés');advice='Conservez les mesures et contactez le support fibre.';}
 else if(m.lossPct!==null&&m.lossPct>=50){kind='loss';title='Nombreuses requêtes sans réponse';evidence.push(m.lossPct+' % de sondes sans réponse');advice='Vérifiez l’alimentation et la liaison vers la passerelle, puis répétez le test.';}
 else if(m.wifiDbm!==null&&m.wifiDbm < -72){kind='wifi';title='Signal Wi-Fi faible';evidence.push(m.wifiDbm+' dBm');advice='Comparez un second emplacement et un test près de la box.';}
 else if(m.latencyMs!==null&&m.latencyMs>100){kind='latency';title='Temps de réponse élevé';evidence.push(Math.round(m.latencyMs)+' ms');advice='Comparez avant et après arrêt des transferts volumineux.';}
 else if(m.downloadMbps!==null&&m.downloadMbps<5){kind='slow';title='Transfert de test lent';evidence.push(m.downloadMbps.toFixed(1)+' Mbps pendant le test');advice='Vérifiez si une limitation de test est active, puis recommencez après son retrait.';}
 else if(m.downloadMbps!==null||m.latencyMs!==null){kind='observed';title='Test reçu';if(m.downloadMbps!==null)evidence.push(m.downloadMbps.toFixed(1)+' Mbps');if(m.latencyMs!==null)evidence.push(Math.round(m.latencyMs)+' ms');advice='Comparez plusieurs relevés effectués avec le même protocole.';}
 return {kind,title,evidence,advice,scope,notice:scope==='participant'?'Mesure active entre cet appareil et le serveur Guardian. Elle ne mesure pas à elle seule le débit Internet, le signal radio ou l’état de la fibre.':'Le diagnostic porte uniquement sur les métriques effectivement transmises.'};
}
function recording(raw){
 insist(raw&&raw.schema==='guardian.recording.v1'&&Array.isArray(raw.frames)&&raw.frames.length>0&&raw.frames.length<=5000,'Enregistrement attendu : guardian.recording.v1, de 1 à 5 000 relevés.');
 let previous=-1;const frames=raw.frames.map(f=>{insist(f&&['simulation','participant','collector'].includes(f.source),'Provenance du relevé manquante.');const at=number(f.at,'Horodatage',0,8640000000000000,false);insist(at>previous,'Les relevés doivent être ordonnés, sans doublon.');previous=at;const m=metrics(f.metrics);return {at,source:f.source,metrics:m,diagnosis:diagnose(m,f.source)};});
 // An imported file is never promoted to a live measurement or a command source.
 return {schema:raw.schema,name:word(raw.name||'Enregistrement importé','Nom',100),mode:'replay',provenance:'Fichier importé, provenance déclarée non certifiée',frames};
}
function floorplan(raw){
 insist(raw&&Array.isArray(raw.rooms)&&raw.rooms.length>0&&raw.rooms.length<=12,'Le plan doit contenir de 1 à 12 pièces.');const seen=new Set();
 const rooms=raw.rooms.map(r=>{const rid=word(r.id,'Identifiant pièce',50);insist(/^[a-zA-Z0-9_-]+$/.test(rid)&&!seen.has(rid),'Identifiant de pièce invalide ou dupliqué.');seen.add(rid);return {id:rid,name:word(r.name,'Nom de pièce',60),x:number(r.x,'Position X',0,60,false),y:number(r.y,'Position Y',0,60,false),width:number(r.width,'Largeur',1,30,false),length:number(r.length,'Longueur',1,30,false),walls:number(r.walls??1,'Cloisons',0,8,false)};});
 insist(seen.has(raw.routerRoom),'Choisissez la pièce de la box.');return {rooms,routerRoom:raw.routerRoom};
}
function placement(plan){
 const center=r=>[r.x+r.width/2,r.y+r.length/2];
 const estimate=(a,b)=>{const p=center(a),q=center(b),distance=Math.max(1,Math.hypot(p[0]-q[0],p[1]-q[1]));return Math.round(-30-20*Math.log10(distance)-(a.id===b.id?0:(a.walls+b.walls)*4));};
 const candidates=plan.rooms.map(a=>{const signals=plan.rooms.map(b=>({room:b.id,dbm:estimate(a,b)}));return {room:a.id,signals,worst:Math.min(...signals.map(s=>s.dbm))};}).sort((a,b)=>b.worst-a.worst);
 return {current:candidates.find(c=>c.room===plan.routerRoom),recommended:candidates[0],notice:'Estimation selon les dimensions et cloisons déclarées. Aucun relevé radio ni localisation automatique.'};
}
module.exports={id,token,hash,Problem,insist,word,paragraph,number,metrics,diagnose,recording,floorplan,placement};
