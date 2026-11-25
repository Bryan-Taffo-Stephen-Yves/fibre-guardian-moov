'use strict';
// « J'ai payé mais je suis toujours coupé » (problème n°2 des clients fibre) : l'état de la ligne est visible,
// et un paiement rallume internet tout de suite.
//  - Facture d'un mois passé toujours pas payée 5 jours après son échéance : ligne suspendue.
//    Même chose pour une part en retard de plus de 5 jours quand le client paie en plusieurs fois.
//    Le client est prévenu, Guardian sait pourquoi internet ne marche pas, « Mon compte » le montre.
//  - Dès que ce qui manquait est payé (facture, ou part en retard), la ligne est rétablie dans la même seconde.
//    Une suspension ne se lève que sur un paiement.
//  - « J'ai payé, internet ne revient pas » : le serveur relit les paiements et rallume la ligne s'il trouve
//    le paiement ; sinon il dit clairement ce qui manque.
// Dans la démonstration, la Régie peut suspendre la ligne d'un client (scène « Ligne suspendue ») sans toucher à ses
// vraies factures ; aucune vraie box n'est coupée (page « À propos de la démo »).
const {insist}=require('./pilot-model.cjs');
const DAY=86400000,GRACE=5*DAY,RECENT=DAY;
const MONTHS=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const monthName=m=>MONTHS[Number(String(m).slice(5))-1]+' '+String(m).slice(0,4);
const monthOf=t=>new Date(t).toISOString().slice(0,7);
const shift=(month,n)=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1+n,1)).toISOString().slice(0,7);};
const dueOf=month=>{const [y,m]=month.split('-').map(Number);return Date.UTC(y,m,1)-60000;};
const J=()=>require('./journey-store.cjs');
const has=(s,t)=>!!s.get('SELECT 1 FROM sqlite_master WHERE name=?',t);

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS ligne_suspensions(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,month TEXT NOT NULL,amount INTEGER NOT NULL,since INTEGER NOT NULL,lifted_at INTEGER,origin TEXT NOT NULL DEFAULT 'auto',how TEXT,kind TEXT NOT NULL DEFAULT 'facture');
 `);}

function partsOf(s,uid,month){
 if(!has(s,'acces_echeances'))return null;
 const e=s.get('SELECT parts FROM acces_echeances WHERE user_id=? AND month=?',uid,month);if(!e)return null;
 try{return JSON.parse(e.parts)||[];}catch{return [];}
}
// Ce qui manque pour un mois : rien, la facture entière, ou une part en retard de plus de 5 jours.
function missing(s,uid,month,now){
 if(has(s,'fidelite_factures')&&s.get('SELECT 1 FROM fidelite_factures WHERE user_id=? AND month=? AND paid_at IS NOT NULL',uid,month))return null;
 const parts=partsOf(s,uid,month);
 if(parts){const late=parts.find(p=>p&&!p.paid&&now>p.due+GRACE);return late?{kind:'part',amount:late.amount}:null;}
 const f=has(s,'fidelite_factures')?s.get('SELECT amount,due FROM fidelite_factures WHERE user_id=? AND month=?',uid,month):null;
 if(!f)return null;
 return now>f.due+GRACE?{kind:'facture',amount:f.amount}:null;
}
// Un paiement arrivé après la suspension de démonstration (facture ou part).
function paidSince(s,uid,month,since){
 if(has(s,'fidelite_factures')&&s.get('SELECT 1 FROM fidelite_factures WHERE user_id=? AND month=? AND paid_at>=?',uid,month,since))return true;
 return (partsOf(s,uid,month)||[]).some(p=>p&&p.paid>=since);
}

function note(st,title,body,now,page='compte'){
 st.notifications=st.notifications||[];
 st.notifications.unshift({key:'ligne:'+now+':'+title.length,home:'home-1',at:now,title,body,read:false,page});
 st.notifications=st.notifications.slice(0,100);
}
const fmt=n=>Number(n||0).toLocaleString('fr-FR')+' F';

// open : le parcours du client déjà ouvert par l'appelant (Régie) ; sinon il est relu et enregistré ici.
function suspend(s,uid,{month,amount,kind},now,origin,open=null){
 s.run('INSERT INTO ligne_suspensions(user_id,month,amount,since,origin,kind) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET month=excluded.month,amount=excluded.amount,since=excluded.since,lifted_at=NULL,origin=excluded.origin,how=NULL,kind=excluded.kind',uid,month,amount,now,origin,kind);
 const st=open||J().get(s,uid);if(!st)return;
 st.suspended={month,label:monthName(month),amount,since:now,kind};
 const m=monthName(month).split(' ')[0];
 note(st,kind==='part'?'Internet suspendu : une part de '+m+' n’est pas payée':'Internet suspendu : facture de '+m+' non payée',kind==='part'?'Payez la part en retard ('+fmt(amount)+') dans Offres solidaires : internet revient tout de suite.':'Payez '+fmt(amount)+' avec Moov Money dans Mon compte : internet revient tout de suite.',now,kind==='part'?'acces':'compte');
 if(!open)J().put(s,uid,st);
}

function lift(s,uid,row,how,now){
 s.run('UPDATE ligne_suspensions SET lifted_at=?,how=? WHERE user_id=?',now,how,uid);
 const st=J().get(s,uid);if(!st)return;
 st.suspended=null;
 note(st,'Internet rétabli','Merci, votre paiement de '+monthName(row.month).split(' ')[0]+' est bien reçu. Votre box se reconnecte dans la minute.',now);
 J().put(s,uid,st);
}
// Les comptes de présentation (@demo.fibre-guardian.ci) ne sont jamais coupés d'eux-mêmes : le serveur de démonstration
// peut rester allumé d'un mois sur l'autre sans que personne paie leur facture. La Régie montre la suspension (scène « Ligne suspendue »).
const demoAccount=(s,uid)=>String(s.get('SELECT email FROM users WHERE id=?',uid)?.email||'').endsWith('@demo.fibre-guardian.ci');
const row=(s,uid)=>s.get('SELECT * FROM ligne_suspensions WHERE user_id=?',uid);

// L'état de la ligne, relu à chaque ouverture (et juste après chaque paiement).
function state(s,uid,now=Date.now()){
 let r=row(s,uid);
 if(r&&!r.lifted_at){
  const paid=r.origin==='demo'?paidSince(s,uid,r.month,r.since):!missing(s,uid,r.month,now);
  if(paid){lift(s,uid,r,'paiement',now);r=row(s,uid);}
 }else if(!demoAccount(s,uid)){
  // Le mois passé, puis le mois en cours (une part en retard) : le premier qui manque suspend la ligne.
  for(const month of [shift(monthOf(now),-1),monthOf(now)]){
   const m=missing(s,uid,month,now);
   if(m&&!(r&&r.month===month&&r.lifted_at>=now-GRACE&&r.how==='paiement-hors-appli')){suspend(s,uid,{month,...m},now,'auto');r=row(s,uid);break;}
  }
 }
 if(r&&!r.lifted_at){
  // Le client a choisi de payer ce mois en plusieurs fois après la suspension : ce qui manque est la part suivante,
  // qui se paie dans Offres solidaires (jamais la facture entière en plus des parts).
  const next=r.kind==='facture'&&(partsOf(s,uid,r.month)||[]).find(p=>p&&!p.paid);
  if(next)return {status:'suspendue',month:r.month,label:monthName(r.month),amount:next.amount,since:r.since,kind:'part',payable:false};
  return {status:'suspendue',month:r.month,label:monthName(r.month),amount:r.amount,since:r.since,kind:r.kind,payable:r.kind==='facture'};
 }
 return {status:'active',lifted:r&&r.lifted_at&&now-r.lifted_at<RECENT?{at:r.lifted_at,label:monthName(r.month)}:null};
}

// Payer la facture qui a fait suspendre la ligne, avec Moov Money (simulé dans la démonstration, le montant vient du serveur).
function pay(s,uid,now=Date.now()){return s.transaction(()=>{
 const r=row(s,uid);insist(r&&!r.lifted_at,'Votre ligne est active : rien à payer ici.',409);
 insist(r.kind==='facture'&&!partsOf(s,uid,r.month),'Payez la part en retard dans Offres solidaires.',409);
 // La facture du mois est réglée ici, une seule fois (« paid_at IS NULL ») : ensuite « Ma fidélité » la montre payée,
 // et elle ne se repaie ni d'un coup ni en plusieurs fois (un mois étalé est refusé juste au-dessus).
 if(has(s,'fidelite_factures'))s.run("UPDATE fidelite_factures SET paid_at=?,channel='moov_money' WHERE user_id=? AND month=? AND paid_at IS NULL",now,uid,r.month);
 lift(s,uid,r,'paiement',now);
 return {...state(s,uid,now),paid:r.amount};
});}

// « J'ai payé, internet ne revient pas » : on relit les paiements tout de suite.
function paid(s,uid,now=Date.now()){
 const before=row(s,uid);
 insist(before&&!before.lifted_at,'Votre ligne est active. Si internet ne marche pas, demandez à Guardian ou signalez une panne.',409);
 const after=state(s,uid,now);
 if(after.status==='active')return {ok:true,lifted:true,text:'C’est bon : votre paiement est bien reçu et votre ligne est rétablie. Votre box se reconnecte dans la minute.'};
 return {ok:true,lifted:false,text:'Nous ne trouvons pas encore votre paiement de '+monthName(before.month).split(' ')[0]+'. Vérifiez le SMS de confirmation Moov Money. Si l’argent est bien parti, appelez le 111 avec le numéro de transaction écrit dans ce SMS : un conseiller retrouve votre paiement.'};
}

// Régie (administrateur) : suspendre la ligne d'un client de la démonstration, sans toucher à ses factures ni à ses points.
function demoSuspend(s,uid,now=Date.now(),st=null){
 const month=monthOf(now),parts=partsOf(s,uid,month);
 // Une facture déjà réglée (d'un coup, ou toutes ses parts) ne peut pas être « suspendue » puis payée une 2e fois.
 const settled=(has(s,'fidelite_factures')&&s.get('SELECT 1 FROM fidelite_factures WHERE user_id=? AND month=? AND paid_at IS NOT NULL',uid,month))||(parts&&parts.length&&parts.every(p=>p&&p.paid));
 insist(!settled,'La facture de '+monthName(month).split(' ')[0]+' de ce client est déjà payée : rien à suspendre.',409);
 const amount=parts?(parts.find(p=>p&&!p.paid)||parts[0]).amount:(require('./fidelite.cjs').state(s,uid,now).bill.amount);
 const kind=parts&&parts.some(p=>p&&!p.paid)?'part':'facture';
 suspend(s,uid,{month,amount,kind},now,'demo',st);
 return {status:'suspendue',month,label:monthName(month),amount,since:now,kind};
}

module.exports={migrate,state,pay,paid,demoSuspend,missing,GRACE,dueOf};
