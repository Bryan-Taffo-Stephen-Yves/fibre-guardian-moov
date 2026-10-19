'use strict';
// « Guardian voit venir la panne » : la lumière qui arrive à la box (puissance optique, en dBm) baisse
// un peu chaque jour quand un connecteur s'encrasse ou qu'une fibre est pliée. Guardian suit la tendance
// sur 7 jours, estime le jour où la box décrochera, et propose un passage du technicien avant ce jour-là.
// Les mesures de la démo sont produites ici ; une vraie box les donnerait par l'ACS (TR-069).
const DAY=86400000,HOUR=3600000;
const NOMINAL=-18.6;   // ligne saine
const WARN=-24;        // la marge se réduit
const CUT=-27;         // en dessous, la box perd la synchronisation (sensibilité GPON classe B+ : −28 dBm, 1 dB de marge)
const DECLINE=.85;     // dB perdus par jour dans le scénario de démonstration
const FLOOR=-26.6;     // la démo ne coupe jamais vraiment la ligne : Guardian intervient avant
const START_DAYS=7;    // la baisse a commencé 7 jours avant l'activation du scénario

// Petit bruit de mesure stable d'un jour à l'autre (pas de hasard : la démo se rejoue à l'identique).
const jitter=k=>Math.round(Math.sin(k*12.9898+78.233)*43758.5453%1*.3*100)/100;
const round=v=>Math.round(v*10)/10;

// Une mesure par jour à midi, sur les `days` derniers jours (le dernier point est la mesure du moment).
function history({fadingSince=null,now=Date.now(),days=10}={}){
 const today=new Date(now);today.setHours(12,0,0,0);
 const points=[];
 for(let k=days-1;k>=0;k--){
  const at=k===0?now:today.getTime()-k*DAY,dayIndex=Math.floor(at/DAY);
  let value=NOMINAL+jitter(dayIndex);
  if(fadingSince){const elapsed=(at-(fadingSince-START_DAYS*DAY))/DAY;if(elapsed>0)value=Math.max(FLOOR,NOMINAL-DECLINE*elapsed)+jitter(dayIndex)/3;}
  points.push({at,dbm:round(value)});
 }
 return points;
}

// Droite des moindres carrés sur les 7 dernières mesures : pente en dB par jour.
function trend(points){
 const recent=points.slice(-7),n=recent.length;if(n<3)return 0;
 const xs=recent.map(p=>p.at/DAY),ys=recent.map(p=>p.dbm),mx=xs.reduce((a,b)=>a+b)/n,my=ys.reduce((a,b)=>a+b)/n;
 const num=xs.reduce((a,x,i)=>a+(x-mx)*(ys[i]-my),0),den=xs.reduce((a,x)=>a+(x-mx)**2,0);
 return den?num/den:0;
}

// Créneaux de passage : jours ouvrés (lundi à samedi), 10 h ou 15 h, au plus tard la veille de la coupure estimée.
function slots(now,cutAt){
 const out=[],start=new Date(now);start.setHours(0,0,0,0);
 for(let d=1;d<=10&&out.length<3;d++){
  const day=new Date(start.getTime()+d*DAY);if(day.getDay()===0)continue;
  for(const hour of [10,15]){const at=new Date(day);at.setHours(hour,0,0,0);if(at.getTime()<cutAt-12*HOUR&&out.length<3)out.push({id:'slot-'+at.getTime(),at:at.getTime()});}
 }
 // Ligne déjà au bord du seuil : on propose quand même le premier créneau, en urgence.
 if(!out.length){const day=new Date(start.getTime()+DAY);if(day.getDay()===0)day.setTime(day.getTime()+DAY);day.setHours(10,0,0,0);out.push({id:'slot-'+day.getTime(),at:day.getTime()});}
 return out;
}

// Prévision complète pour une ligne. technician : la personne qui passera (fiche de démonstration).
function forecast({fadingSince=null,now=Date.now(),technician=null}={}){
 const points=history({fadingSince,now}),current=points.at(-1).dbm,slope=trend(points);
 const falling=slope<-.25,critical=current<=CUT+1.5;
 // Une ligne déjà tout près du seuil est à risque même si la baisse s'est stabilisée.
 const daysLeft=falling?Math.max(0,(CUT-current)/slope):critical?1:null;
 const atRisk=(falling&&(current<=WARN||daysLeft<=10))||critical;
 const cutAt=atRisk?now+daysLeft*DAY:null;
 return {points,current,slope:Math.round(slope*100)/100,threshold:CUT,warn:WARN,nominal:NOMINAL,
  state:atRisk?'fading':current<=WARN?'low':'healthy',daysLeft:atRisk?Math.round(daysLeft*10)/10:null,cutAt,
  slots:atRisk?slots(now,cutAt):[],technician:atRisk?technician:null,source:'Mesure quotidienne de la box'};
}
module.exports={history,trend,slots,forecast,CUT,WARN,NOMINAL,DAY};
