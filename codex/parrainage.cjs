'use strict';
// Parrainage (thème 5) : chaque client a un code à partager (par WhatsApp, depuis son propre téléphone).
// Un nouveau client entre le code d'un proche dans son compte. Quand le filleul a 3 mois d'abonnement,
// un mois est offert aux deux. Dans la démonstration, aucun vrai contrat ni facture n'est touché :
// la date du mois offert est calculée et affichée, l'équipe Moov voit les parrainages dans le Superviseur.
const crypto=require('node:crypto');
const {insist}=require('./pilot-model.cjs');
const DAY=86400000,REWARD_DAYS=90,NEW_CLIENT_DAYS=30,ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS parrainage_codes(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,code TEXT UNIQUE NOT NULL,at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS parrainage_filleuls(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,parrain_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,code TEXT NOT NULL,at INTEGER NOT NULL);
 `);}

// « Awa K. » : jamais le nom complet ni le numéro d'un autre client.
function shortName(name){const parts=String(name||'').trim().split(/\s+/).filter(Boolean);if(!parts.length)return 'Un client Moov';return parts[0]+(parts[1]?' '+parts[1][0].toUpperCase()+'.':'');}
const clean=code=>String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^MOOV/,'');
const show=code=>'MOOV-'+code;

function codeFor(s,uid){
 const row=s.get('SELECT code FROM parrainage_codes WHERE user_id=?',uid);if(row)return row.code;
 for(let i=0;i<20;i++){
  const bytes=crypto.randomBytes(5),code=Array.from(bytes,b=>ALPHABET[b%ALPHABET.length]).join('');
  if(!s.get('SELECT 1 FROM parrainage_codes WHERE code=?',code)){s.run('INSERT INTO parrainage_codes VALUES(?,?,?)',uid,code,Date.now());return code;}
 }
 throw new Error('Impossible de créer un code de parrainage.');
}

function state(s,uid,now=Date.now()){
 const code=codeFor(s,uid),user=s.get('SELECT created FROM users WHERE id=?',uid);
 const filleuls=s.all('SELECT f.at,u.name FROM parrainage_filleuls f JOIN users u ON u.id=f.user_id WHERE f.parrain_id=? ORDER BY f.at DESC',uid)
  .map(f=>({name:shortName(f.name),at:f.at,rewardAt:f.at+REWARD_DAYS*DAY,rewarded:now>=f.at+REWARD_DAYS*DAY}));
 const mine=s.get('SELECT f.at,f.code,u.name FROM parrainage_filleuls f JOIN users u ON u.id=f.parrain_id WHERE f.user_id=?',uid);
 const canUse=!mine&&!!user&&now-user.created<=NEW_CLIENT_DAYS*DAY;
 return {code:show(code),filleuls,months:filleuls.filter(f=>f.rewarded).length,pending:filleuls.filter(f=>!f.rewarded).length,
  parrain:mine?{name:shortName(mine.name),at:mine.at,rewardAt:mine.at+REWARD_DAYS*DAY}:null,canUse,rewardDays:REWARD_DAYS,newClientDays:NEW_CLIENT_DAYS};
}

// Page d'accueil publique « ?parrain=MOOV-XXXXX » : seulement le prénom et l'initiale du parrain.
function lookup(s,code){const c=clean(code);insist(/^[A-Z0-9]{5}$/.test(c),'Code de parrainage inconnu.',404);
 const row=s.get('SELECT u.name FROM parrainage_codes p JOIN users u ON u.id=p.user_id WHERE p.code=?',c);insist(row,'Code de parrainage inconnu.',404);
 return {code:show(c),parrain:shortName(row.name),rewardDays:REWARD_DAYS};}

function use(s,uid,d,now=Date.now()){
 return s.transaction(()=>{
  const c=clean(d&&d.code);insist(/^[A-Z0-9]{5}$/.test(c),'Ce code ne ressemble pas à un code de parrainage (exemple : MOOV-7KQ2D).');
  const owner=s.get('SELECT user_id FROM parrainage_codes WHERE code=?',c);insist(owner,'Code de parrainage inconnu. Vérifiez-le avec la personne qui vous l’a donné.',404);
  insist(owner.user_id!==uid,'C’est votre propre code : partagez-le plutôt avec vos proches.',409);
  insist(!s.get('SELECT 1 FROM parrainage_filleuls WHERE user_id=?',uid),'Vous avez déjà utilisé un code de parrainage.',409);
  insist(!s.get('SELECT 1 FROM parrainage_filleuls WHERE user_id=? AND parrain_id=?',owner.user_id,uid),'Cette personne a déjà utilisé votre code : vous ne pouvez pas vous parrainer l’un l’autre.',409);
  const user=s.get('SELECT created FROM users WHERE id=?',uid);insist(user&&now-user.created<=NEW_CLIENT_DAYS*DAY,'Le code de parrainage s’utilise dans les '+NEW_CLIENT_DAYS+' jours qui suivent l’abonnement.',409);
  s.run('INSERT INTO parrainage_filleuls VALUES(?,?,?,?)',uid,owner.user_id,c,now);
  return state(s,uid,now);
 });
}

// Vue de l'équipe Moov (Superviseur) : chiffres et derniers parrainages, prénoms abrégés seulement.
function summary(s,now=Date.now()){
 const rows=s.all('SELECT f.at,a.name AS parrain,b.name AS filleul FROM parrainage_filleuls f JOIN users a ON a.id=f.parrain_id JOIN users b ON b.id=f.user_id ORDER BY f.at DESC');
 return {codes:s.get('SELECT COUNT(*) AS n FROM parrainage_codes').n,filleuls:rows.length,rewarded:rows.filter(r=>now>=r.at+REWARD_DAYS*DAY).length,
  recent:rows.slice(0,5).map(r=>({parrain:shortName(r.parrain),filleul:shortName(r.filleul),at:r.at,rewardAt:r.at+REWARD_DAYS*DAY}))};
}

module.exports={migrate,codeFor,state,lookup,use,summary,shortName,clean,REWARD_DAYS,NEW_CLIENT_DAYS};
