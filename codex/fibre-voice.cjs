'use strict';
// « Parler à Guardian » (le centre des avis du thème 8 est dans avis.cjs) : le client parle à Guardian au lieu d'écrire (page « Parler à Guardian », fibre-voice-view.js).
// Ici, côté serveur : on note seulement le sujet et la langue de chaque question posée à la voix (jamais le son,
// jamais le texte), pour que l'équipe Moov voie ce que les clients demandent quand ils parlent.
const O=require('./operator-store.cjs');
const DAY=86400000;
// Sujets reconnus par Guardian (journey-store.cjs, intent) et leur nom pour l'équipe Moov.
const SUBJECT={coupure:'Internet coupé',lent:'Internet lent',suivi:'Où en est le technicien',reboot:'Redémarrer la box',wifi:'Wi-Fi',voyants:'Voyants de la box',prix:'Prix et facture',upgrade:'Changer de forfait',humain:'Parler à un conseiller',resiliation:'Résilier',usage:'Usages (jeux, films, travail)',salut:'Bonjour',merci:'Merci',inconnu:'Autre demande'};
const LANGS=['fr','nouchi','dioula','autre'];

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS voice_requests(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,at INTEGER NOT NULL,subject TEXT NOT NULL,lang TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS voice_requests_at ON voice_requests(at);
 `);}

function record(s,uid,{subject,lang},now=Date.now()){
 s.run('INSERT INTO voice_requests(user_id,at,subject,lang) VALUES(?,?,?,?)',uid,now,SUBJECT[subject]?subject:'inconnu',LANGS.includes(lang)?lang:'fr');
}

// Vue de l'équipe Moov : les 7 derniers jours.
function stats(s,uid,now=Date.now()){
 O.requireOperator(s,uid);
 const rows=s.all('SELECT user_id,at,subject,lang FROM voice_requests WHERE at>=?',now-7*DAY);
 const count=(list,key)=>{const m=new Map();for(const r of list)m.set(r[key],(m.get(r[key])||0)+1);return [...m].sort((a,b)=>b[1]-a[1]);};
 const asked=rows.filter(r=>!['salut','merci'].includes(r.subject));
 return {total:rows.length,today:rows.filter(r=>r.at>=now-DAY).length,clients:new Set(rows.map(r=>r.user_id)).size,
  subjects:count(asked,'subject').slice(0,5).map(([k,n])=>({subject:SUBJECT[k],count:n})),
  langs:count(rows,'lang').map(([k,n])=>({lang:k,count:n}))};
}
module.exports={migrate,record,stats,SUBJECT};
