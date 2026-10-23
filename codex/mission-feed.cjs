'use strict';
// Bandeaux « en direct » d'une mission (façon notification de téléphone), pour les trois rôles :
// - le client : ses propres notifications (signalement reçu, technicien en route, arrivé, réparation, internet revenu) ;
// - le technicien : nouvelle mission, nouvelle consigne ou nouveau message de l'équipe Moov ;
// - l'équipe Moov : nouveau signalement client, départ, arrivée, compte rendu du technicien, rétablissement.
// Lecture seule : chaque rôle ne voit que ce qu'il voit déjà ailleurs (mêmes règles que les écrans existants).
const N=require('./noc-store.cjs'),O=require('./operator-store.cjs');
const first=n=>String(n||'').split(' ')[0];
// « de Direction », « d’Ibrahim » : élision devant une voyelle.
const de=n=>(/^[aeiouyàâéèêîôh]/i.test(first(n))?'d’':'de ')+first(n);
const CLIENT={received:'Signalement reçu',dispatched:'Un technicien est choisi',en_route:'Votre technicien est en route',on_site:'Votre technicien est arrivé',verifying:'Réparation terminée',resolved:'Internet est revenu'};
const TEAM_KINDS=['received','superviseur.signal','dispatched','en_route','on_site','verifying','resolved'];

function pings(s,uid,since){
 const now=Date.now(),from=Number(since);
 // Premier appel : on renvoie seulement l'heure du serveur, pour ne pas rejouer l'historique.
 if(!Number.isFinite(from)||from<=0||from>now)return {now,items:[]};
 const after=Math.max(from,now-10*60000),role=require('./noc-workspace.cjs').sessionRole(s,uid);
 let items=[];
 if(role==='subscriber'){
  items=N.notifications(s,uid).items.filter(n=>!n.read&&n.createdAt>after).map(n=>({id:n.id,kind:n.kind,title:CLIENT[n.kind]||'Moov Fibre',body:n.body,at:n.createdAt,incident:n.incidentId,page:'tracking'}));
 }else if(role==='technician'){
  const tech=s.get('SELECT technician_id FROM noc_field_accounts WHERE user_id=?',uid)?.technician_id;
  const mine="SELECT id FROM noc_incidents WHERE mode='demo' AND technician=?";
  items=[
   ...s.all("SELECT e.id,e.at,e.incident_id,i.segment_id FROM noc_events e JOIN noc_incidents i ON i.id=e.incident_id WHERE e.kind='dispatched' AND e.at>? AND e.incident_id IN ("+mine+")",after,tech).map(r=>({id:r.id,kind:'mission',title:'Nouvelle mission',body:'Moov vous envoie à '+(N.zoneName(s,r.segment_id)||'un client')+'.',at:r.at,incident:r.incident_id})),
   ...s.all("SELECT e.id,e.at,e.incident_id FROM noc_events e WHERE e.kind='on_site' AND e.actor IS NULL AND e.at>? AND e.incident_id IN ("+mine+")",after,tech).map(r=>({id:r.id,kind:'on_site',title:'Vous êtes arrivé',body:'Le client et l’équipe Moov sont prévenus. Vos consignes sont prêtes.',at:r.at,incident:r.incident_id})),
   ...s.all("SELECT c.id,c.body,c.created AS at,u.name FROM noc_checklist c JOIN users u ON u.id=c.author WHERE c.created>? AND c.author<>? AND c.case_key IN (SELECT 'incident:'||id FROM noc_incidents WHERE mode='demo' AND technician=?)",after,uid,tech).map(r=>({id:r.id,kind:'instruction',title:'Nouvelle consigne '+de(r.name),body:r.body,at:r.at})),
   ...s.all("SELECT e.id,e.body,e.at,u.name FROM noc_workspace_events e JOIN users u ON u.id=e.actor WHERE e.kind='note' AND e.at>? AND e.actor<>? AND e.case_key IN (SELECT 'incident:'||id FROM noc_incidents WHERE mode='demo' AND technician=?)",after,uid,tech).map(r=>({id:r.id,kind:'message',title:'Message '+de(r.name),body:r.body,at:r.at}))];
 }else{
  O.requireOperator(s,uid);
  items=[
   ...s.all("SELECT e.id,e.kind,e.at,e.incident_id,i.segment_id,i.source,i.technician FROM noc_events e JOIN noc_incidents i ON i.id=e.incident_id WHERE i.mode='demo' AND e.at>? AND (e.actor IS NULL OR e.actor<>?) AND e.kind IN ("+TEAM_KINDS.map(()=>'?').join(',')+")",after,uid,...TEAM_KINDS).filter(r=>r.kind!=='received'||r.source!=='telemetry').map(r=>{const t=first(N.TECHS.find(v=>v.id===r.technician)?.name),zone=N.zoneName(s,r.segment_id)||'Zone à confirmer';
    return {id:r.id,kind:r.kind,title:({received:'Nouveau signalement client','superviseur.signal':'Guardian Superviseur : décision attendue',dispatched:t+' est affecté',en_route:t+' est en route',on_site:t+' est arrivé sur place',verifying:t+' a terminé la réparation',resolved:'Connexion rétablie'})[r.kind],body:zone+' · dossier '+N.ref(r.incident_id),at:r.at,incident:r.incident_id,page:r.kind==='superviseur.signal'?'approvals':'missions'};}),
   ...s.all("SELECT e.id,e.body,e.at,e.case_key,u.name FROM noc_workspace_events e JOIN users u ON u.id=e.actor WHERE e.kind='note' AND e.at>? AND e.actor<>? AND e.actor IN (SELECT user_id FROM noc_field_accounts)",after,uid).map(r=>({id:r.id,kind:'report',title:'Note '+de(r.name),body:r.body,at:r.at,incident:String(r.case_key||'').replace(/^incident:/,''),page:'operations'}))];
 }
 return {now,items:items.sort((a,b)=>a.at-b.at).slice(-4)};
}
module.exports={pings};
