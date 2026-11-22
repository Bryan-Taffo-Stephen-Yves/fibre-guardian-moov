'use strict';
// « Mes paiements » (Mon compte) : tout ce que le client a payé, au même endroit, avec un reçu à garder ou à partager.
// Rien de nouveau n'est stocké ici : la liste relit les paiements déjà gardés par les autres modules :
//  - les factures du mois (fidelite.cjs, table fidelite_factures) ;
//  - les parts d'un mois payé en plusieurs fois (acces.cjs, table acces_echeances) ;
//  - les passages à un forfait plus rapide (journey-store.cjs, journey_state.payments).
// La référence d'un reçu est calculée à partir du paiement : elle reste la même à chaque ouverture.
const crypto=require('node:crypto');
const MONTHS=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const monthName=m=>MONTHS[Number(String(m).slice(5))-1]+' '+String(m).slice(0,4);
const ref=(uid,what,at)=>'MM'+crypto.createHash('sha256').update(uid+':'+what+':'+at).digest('hex').slice(0,8).toUpperCase();
const LIMIT=12;

function list(s,uid){
 const out=[];
 for(const r of s.all('SELECT month,amount,paid_at,channel FROM fidelite_factures WHERE user_id=? AND paid_at IS NOT NULL',uid))
  out.push({kind:'facture',label:'Facture de '+monthName(r.month),amount:r.amount,at:r.paid_at,channel:r.channel==='moov_money'?'moov_money':'agence',ref:ref(uid,'facture:'+r.month,r.paid_at)});
 for(const e of s.all('SELECT month,parts FROM acces_echeances WHERE user_id=?',uid)){
  let parts=[];try{parts=JSON.parse(e.parts);}catch{}
  parts.forEach((p,k)=>{if(p&&p.paid)out.push({kind:'part',label:'Part '+(k+1)+' sur '+parts.length+' · '+monthName(e.month),amount:p.amount,at:p.paid,channel:'moov_money',ref:ref(uid,'part:'+e.month+':'+k,p.paid)});});
 }
 const st=require('./journey-store.cjs').get(s,uid);
 // Les anciens comptes n'ont gardé que le dernier passage (payment) : on le reprend s'il manque dans la liste.
 const ups=Array.isArray(st?.payments)?st.payments.slice():[];
 if(st?.payment?.at&&!ups.some(p=>p.at===st.payment.at))ups.push({...st.payment});
 for(const p of ups)if(p&&p.at&&p.amount>0)
  out.push({kind:'forfait',label:p.mbps?'Passage à '+p.mbps+' Mb/s':'Passage à un forfait plus rapide',amount:p.amount,at:p.at,channel:'moov_money',ref:p.ref||ref(uid,'forfait',p.at)});
 out.sort((a,b)=>b.at-a.at);
 const total=out.length;
 return {items:out.slice(0,LIMIT),total,account:'FIBRE-'+String(uid||'').replace(/[^a-z0-9]/gi,'').slice(0,6).toUpperCase()};
}
module.exports={list,ref};
