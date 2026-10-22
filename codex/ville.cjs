'use strict';
// « Est-ce que c'est général ? » : la carte des pannes vue par le client, comme la carte des coupures de courant.
// Le client voit l'état de chaque quartier suivi : normal, panne, coupure de courant, internet ralenti.
// Seulement des chiffres par quartier : ni nom, ni numéro, ni dossier, ni technicien d'un autre client.
const A=require('./appels.cjs');
const OPEN=['reported','proposed','approved','rejected','dispatched','en_route','on_site','verifying'];
const RECENT=10*60000;
const plainZone=zone=>{const [commune,area]=String(zone).split(' · ');return {commune,area:area&&area!==commune?area:commune};};
// Où en est Moov, en mots simples. Pas d'étape tant que le dossier n'est pas validé.
const STEP={reported:'Panne repérée par Moov',proposed:'Panne repérée par Moov',rejected:'Panne repérée par Moov',approved:'Réparation validée',dispatched:'Équipe affectée',en_route:'Équipe en route',on_site:'Équipe sur place',verifying:'Dernières vérifications'};
// Cause en clair, d'après le dossier ou, à défaut, l'alarme du quartier.
function causeOf(plan,alarm){
 const c=plan?.cause||'';
 if(c==='POWER_OUTAGE'||alarm==='DYING_GASP')return 'courant';
 if(c==='UPLINK_CONGESTION'||alarm==='UPLINK_HIGH')return 'debit';
 if(c==='OLT_FAILURE'||alarm==='OLT_DOWN'||alarm==='UPSTREAM')return 'central';
 return 'fibre';
}
function snapshot(s,uid,now=Date.now()){
 const mine=s.get('SELECT segment_id FROM noc_members WHERE user_id=?',uid)?.segment_id||null;
 const quartiers=s.all('SELECT id,zone,online,total,alarm FROM noc_segments ORDER BY id').map(g=>{
  const row=s.get("SELECT * FROM noc_incidents WHERE segment_id=? AND mode='demo' AND status IN ("+OPEN.map(()=>'?').join(',')+") ORDER BY created DESC LIMIT 1",g.id,...OPEN);
  const i=row?{...row,plan:row.plan?JSON.parse(row.plan):null}:null;
  const z=plainZone(g.zone),off=Math.max(0,g.total-g.online);
  const cause=i||g.alarm!=='NONE'||off>0?causeOf(i?.plan,g.alarm):null;
  const state=cause==='debit'?'lent':cause==='courant'?'courant':cause?'panne':s.get("SELECT 1 AS x FROM noc_incidents WHERE segment_id=? AND mode='demo' AND status='resolved' AND updated>=?",g.id,now-RECENT)?'retabli':'normal';
  let retour=null;
  if(i){const e=A.estimate(i,s.all('SELECT kind,at FROM noc_events WHERE incident_id=? ORDER BY at,rowid',i.id),now);if(e?.at)retour=A.clock(Math.ceil(e.at/300000)*300000);}
  return {id:g.id,commune:z.commune,quartier:z.area,state,cause,boxEteintes:off,box:g.total,etape:i?STEP[i.status]||null:null,retour,chezMoi:g.id===mine};
 });
 return {mine,at:now,quartiers};
}
module.exports={snapshot,causeOf};
