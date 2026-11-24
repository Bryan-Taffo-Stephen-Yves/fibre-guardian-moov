'use strict';
// Panne qui revient (problème n°5 des clients fibre) : « ça coupe encore, c'est la 3e fois ce mois-ci ».
// Le client qui subit une coupure après l'autre change d'opérateur ; Moov doit le voir avant lui.
//  - Dès la 3e coupure en 30 jours dans un quartier, chaque client du quartier a un dossier prioritaire :
//    il est prévenu (« 3e coupure en 30 jours : Moov s'en occupe en priorité ») et un conseiller l'appelle sous 2 h
//    (file « À rappeler », service-client.cjs) : il écoute, explique la cause, envoie si besoin un technicien
//    vérifier toute la ligne, puis le client dit si c'est réglé.
//  - Dans le Centre d'opérations, chaque nouveau dossier de ce quartier porte « Panne qui revient : 3e en 30 jours »,
//    pour chercher la vraie cause (câble fragile, poteau, chantier) au lieu de réparer la même chose.
// Plusieurs dossiers ouverts à moins de 6 h d'écart comptent pour une seule coupure (le même incident signalé plusieurs fois).
const DAY=86400000,WINDOW=30*DAY,MERGE=6*3600000,THRESHOLD=3,DUE=2*3600000;
const ordinal=n=>n===1?'1re':n+'e';

// Les coupures d'un quartier sur 30 jours, regroupées. Seules comptent les pannes détectées par le réseau
// (pas un client qui signale sa propre box) ; une panne d'OLT compte pour tous les quartiers de la commune.
// Les coupures des scènes de la Régie ne comptent que pour le client de la scène (sim:true).
function outages(s,segment,now,{sim=false}={}){
 const commune=String(s.get('SELECT zone FROM noc_segments WHERE id=?',segment)?.zone||'').split('·')[0].trim();
 const rows=s.all("SELECT i.id,i.created FROM noc_incidents i JOIN noc_segments g ON g.id=i.segment_id WHERE i.source='telemetry' AND i.mode='demo' AND i.created>=? AND i.status NOT IN ('false_alarm','rejected') AND (i.segment_id=? OR (i.plan LIKE '%OLT_FAILURE%' AND g.zone LIKE ?))"+(sim?'':" AND i.id NOT LIKE 'sim-recurrente-%'")+" ORDER BY i.created",now-WINDOW,segment,commune+' ·%');
 const out=[];for(const r of rows){const last=out[out.length-1];if(last&&r.created-last.at<MERGE)last.ids.push(r.id);else out.push({at:r.created,ids:[r.id]});}
 return out;
}
const day=t=>new Date(t).toLocaleDateString('fr-FR',{timeZone:'Africa/Abidjan',day:'numeric',month:'long'});

// Ouvre les dossiers prioritaires qui manquent (un par client et par période de 30 jours). Appelé à la lecture.
const last=new WeakMap();
// only : la scène de la Régie ne touche que son client.
function sweep(s,now=Date.now(),{force=false,only=null}={}){
 if(!force&&now-(last.get(s)||0)<30000)return 0;last.set(s,now);
 const SC=require('./service-client.cjs'),J=require('./journey-store.cjs');
 const staff=new Set([...s.all('SELECT user_id FROM operator_grants'),...(has(s,'noc_field_accounts')?s.all('SELECT user_id FROM noc_field_accounts'):[])].map(r=>r.user_id));
 let made=0;
 for(const g of s.all('SELECT id,zone FROM noc_segments')){
  const list=outages(s,g.id,now,{sim:!!only});if(list.length<THRESHOLD)continue;
  for(const m of s.all('SELECT user_id FROM noc_members WHERE segment_id=?',g.id)){
   if(only&&m.user_id!==only)continue;
   if(staff.has(m.user_id))continue;
   if(s.get("SELECT 1 FROM sc_demandes WHERE kind='panne' AND user_id=? AND created>=?",m.user_id,now-WINDOW))continue;
   const zone=String(g.zone||'').split('·').pop().trim()||'votre quartier',n=list.length;
   SC.open(s,{uid:m.user_id,kind:'panne',ref:m.user_id+':'+g.id+':'+list[0].at,incident:list[n-1].ids[0],level:1,due:now+DUE,silent:true,
    title:ordinal(n)+' coupure en 30 jours · '+g.zone,detail:'Coupures le '+list.map(o=>day(o.at)).join(', le ')+'.'},now);
   const st=J.get(s,m.user_id);
   if(st){st.notifications=st.notifications||[];
    st.notifications.unshift({key:'panne-recurrente:'+g.id+':'+now,home:'home-1',at:now,read:false,page:'tracking',title:ordinal(n)+' coupure en 30 jours à '+zone+' : Moov s’en occupe en priorité',
     body:'Pardon pour ces coupures. Votre dossier est prioritaire : un conseiller vous appelle dans les 2 heures pour en parler et, si besoin, envoyer un technicien vérifier toute votre ligne.'});
    st.notifications=st.notifications.slice(0,100);J.put(s,m.user_id,st);}
   made++;
  }
 }
 return made;
}
const has=(s,t)=>!!s.get('SELECT 1 FROM sqlite_master WHERE name=?',t);

// Centre d'opérations : « Panne qui revient » sur les dossiers d'un quartier touché au moins 3 fois en 30 jours.
function forTeam(s,data,now=Date.now()){
 if(!data||!Array.isArray(data.incidents))return data;
 const cache=new Map();
 for(const v of data.incidents){
  const seg=v.segment_id||v.segment;if(!seg){v.recurrent=null;continue;}
  if(!cache.has(seg))cache.set(seg,outages(s,seg,now).length);
  const n=cache.get(seg);v.recurrent=n>=THRESHOLD?{count:n,text:'Panne qui revient : '+ordinal(n)+' coupure en 30 jours dans ce quartier. Cherchez la cause de fond (câble, poteau, chantier).'}:null;
 }
 return data;
}

module.exports={outages,sweep,forTeam,THRESHOLD};
