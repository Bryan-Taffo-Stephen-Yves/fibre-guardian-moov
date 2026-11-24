'use strict';
// « J'ai payé mais je suis toujours coupé » (problème n°2 des clients fibre) : l'état de la ligne est visible,
// et un paiement rallume internet tout de suite.
//  - Facture du mois non payée 5 jours après l'échéance (et pas de paiement en plusieurs fois) : ligne suspendue.
//    Le client est prévenu, Guardian sait pourquoi internet ne marche pas, « Mon compte » le montre.
//  - Dès que la facture est payée (Moov Money) ou qu'une première part est réglée (Offres solidaires),
//    la ligne est rétablie dans la même seconde et le client en est prévenu.
//  - « J'ai payé, internet ne revient pas » : le serveur relit les paiements et rallume la ligne s'il trouve
//    le paiement ; sinon il dit clairement ce qui manque.
// Dans la démonstration, la Régie peut suspendre la ligne d'un client (scène « Ligne suspendue ») ; aucune vraie box
// n'est coupée (page « À propos de la démo »).
const {insist}=require('./pilot-model.cjs');
const DAY=86400000,GRACE=5*DAY,RECENT=DAY;
const MONTHS=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const monthName=m=>MONTHS[Number(String(m).slice(5))-1]+' '+String(m).slice(0,4);
const J=()=>require('./journey-store.cjs');

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS ligne_suspensions(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,month TEXT NOT NULL,amount INTEGER NOT NULL,since INTEGER NOT NULL,lifted_at INTEGER,origin TEXT NOT NULL DEFAULT 'auto',how TEXT);
 `);}

// Le mois est réglé : facture payée d'un coup, ou au moins une part payée quand le client a choisi d'étaler.
function paidFor(s,uid,month){
 if(s.get('SELECT 1 FROM fidelite_factures WHERE user_id=? AND month=? AND paid_at IS NOT NULL',uid,month))return 'facture';
 if(s.get("SELECT 1 FROM sqlite_master WHERE name='acces_echeances'")){
  const e=s.get('SELECT parts FROM acces_echeances WHERE user_id=? AND month=?',uid,month);
  if(e){let p=[];try{p=JSON.parse(e.parts);}catch{}if(p.some(x=>x&&x.paid))return 'part';}
 }
 return null;
}

function note(s,uid,st,title,body,now,page='compte'){
 st.notifications=st.notifications||[];
 st.notifications.unshift({key:'ligne:'+now+':'+title.length,home:'home-1',at:now,title,body,read:false,page});
 st.notifications=st.notifications.slice(0,100);
}
const fmt=n=>Number(n||0).toLocaleString('fr-FR')+' F';

// st : le parcours du client déjà ouvert par l'appelant (Régie) ; sinon il est relu et enregistré ici.
function suspend(s,uid,month,amount,now,origin,open=null){
 s.run('INSERT INTO ligne_suspensions(user_id,month,amount,since,origin) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET month=excluded.month,amount=excluded.amount,since=excluded.since,lifted_at=NULL,origin=excluded.origin,how=NULL',uid,month,amount,now,origin);
 const st=open||J().get(s,uid);if(!st)return;
 st.suspended={month,label:monthName(month),amount,since:now};
 note(s,uid,st,'Internet suspendu : facture de '+monthName(month).split(' ')[0]+' non payée','Payez '+fmt(amount)+' avec Moov Money, ou en 2 ou 3 fois : internet revient tout de suite.',now,'fidelite');
 if(!open)J().put(s,uid,st);
}

function lift(s,uid,row,how,now){
 s.run('UPDATE ligne_suspensions SET lifted_at=?,how=? WHERE user_id=?',now,how,uid);
 const st=J().get(s,uid);if(!st)return;
 st.suspended=null;
 note(s,uid,st,'Internet rétabli','Merci, votre paiement de '+monthName(row.month).split(' ')[0]+' est bien reçu. Votre box se reconnecte dans la minute.',now);
 J().put(s,uid,st);
}

// L'état de la ligne, relu à chaque ouverture (et juste après chaque paiement).
function state(s,uid,now=Date.now()){
 let row=s.get('SELECT * FROM ligne_suspensions WHERE user_id=?',uid);
 // Une suspension d'un mois passé ne bloque pas le client : la facture de ce mois-là ne se paie plus dans l'application.
 if(row&&!row.lifted_at&&row.month<new Date(now).toISOString().slice(0,7)){lift(s,uid,row,'mois suivant',now);row=s.get('SELECT * FROM ligne_suspensions WHERE user_id=?',uid);}
 if(row&&!row.lifted_at){const how=paidFor(s,uid,row.month);if(how){lift(s,uid,row,how,now);row=s.get('SELECT * FROM ligne_suspensions WHERE user_id=?',uid);}}
 else{
  const b=s.get("SELECT 1 FROM sqlite_master WHERE name='fidelite_factures'")?require('./fidelite.cjs').state(s,uid,now).bill:null;
  if(b&&!b.paid&&!b.split&&now>b.due+GRACE&&!(row&&row.month===b.month)){suspend(s,uid,b.month,b.amount,now,'auto');row=s.get('SELECT * FROM ligne_suspensions WHERE user_id=?',uid);}
 }
 if(row&&!row.lifted_at)return {status:'suspendue',month:row.month,label:monthName(row.month),amount:row.amount,since:row.since};
 return {status:'active',lifted:row&&row.lifted_at&&now-row.lifted_at<RECENT?{at:row.lifted_at,label:monthName(row.month)}:null};
}

// « J'ai payé, internet ne revient pas » : on relit les paiements tout de suite.
function paid(s,uid,now=Date.now()){
 const before=s.get('SELECT * FROM ligne_suspensions WHERE user_id=?',uid);
 insist(before&&!before.lifted_at,'Votre ligne est active. Si internet ne marche pas, demandez à Guardian ou signalez une panne.',409);
 const after=state(s,uid,now);
 if(after.status==='active')return {ok:true,lifted:true,text:'C’est bon : votre paiement est bien reçu et votre ligne est rétablie. Votre box se reconnecte dans la minute.'};
 return {ok:true,lifted:false,text:'Nous ne trouvons pas encore votre paiement de '+monthName(before.month).split(' ')[0]+'. Vérifiez le SMS de confirmation Moov Money. Si l’argent est bien parti, appelez le 111 avec le numéro de transaction écrit dans ce SMS : un conseiller retrouve votre paiement.'};
}

// Régie (administrateur) : suspendre la ligne d'un client de la démonstration pour montrer le parcours.
function demoSuspend(s,uid,now=Date.now(),st=null){
 const b=require('./fidelite.cjs').state(s,uid,now).bill;
 insist(!b.split,'Ce client paie ce mois en plusieurs fois : sa ligne reste allumée.',409);
 if(b.paid)s.run('UPDATE fidelite_factures SET paid_at=NULL,channel=NULL WHERE user_id=? AND month=?',uid,b.month);
 suspend(s,uid,b.month,b.amount,now,'demo',st);
 return {status:'suspendue',month:b.month,label:monthName(b.month),amount:b.amount,since:now};
}

module.exports={migrate,state,paid,demoSuspend,paidFor,GRACE};
