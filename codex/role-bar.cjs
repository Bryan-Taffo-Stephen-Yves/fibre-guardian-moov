'use strict';
// Comptes de démo et barre des rôles : Client, Conseiller, Technicien, Superviseur, Direction.
// - Page de connexion : « Comptes de démo », un bouton par rôle, sans rien taper (comme dans Dabali).
//   Client, Conseiller, Technicien et Superviseur s'ouvrent pour tout le monde, avec les droits normaux de leur rôle.
// - La Direction (réglages, équipe, Régie, « Tout remettre à zéro ») reste derrière son mot de passe :
//   sans lui, son bouton ouvre la connexion avec l'adresse déjà remplie.
// - Exception : sur un appareil où la direction connectée a activé la barre (« À propos de la démo »),
//   un passe (cookie HttpOnly, SameSite=Strict, 12 heures) permet aussi d'ouvrir la Direction en un geste.
// - Chaque bouton ouvre une vraie session sur un compte de démo précis : le rôle attendu est revérifié,
//   et les droits restent vérifiés côté serveur à chaque action. Aucun mot de passe ici ni dans le navigateur.
// - GUARDIAN_DEMO_ACCOUNTS=off retire les comptes de démo (seul le passe de la direction reste).
const crypto=require('node:crypto');
const {DEMO,STAFF}=require('./seed-demo.cjs');
const operator=require('./operator-store.cjs'),workspace=require('./noc-workspace.cjs'),{insist}=require('./pilot-model.cjs');

const HOURS=12,TTL=HOURS*3600000;
const staff=role=>STAFF.find(m=>m.role===role).email;
// Ordre de la barre : du client à la direction. « page » = l'écran ouvert après le changement.
// « open » : ouvert à tous sans mot de passe. La Direction ne l'est pas.
const ROLES=[
 {key:'client',label:'Client',email:DEMO.client.email,role:'subscriber',open:true,page:'?portal=client&section=home'},
 {key:'conseiller',label:'Conseiller',email:staff('agent'),role:'agent',open:true,page:'?portal=moov&section=operations'},
 {key:'technicien',label:'Technicien',email:DEMO.technician.email,role:'technician',open:true,page:'?portal=client&section=home'},
 {key:'superviseur',label:'Superviseur',email:staff('supervisor'),role:'supervisor',open:true,page:'?portal=moov&section=superviseur'},
 {key:'direction',label:'Direction',email:DEMO.admin.email,role:'admin',open:false,page:'?portal=moov&section=operations',login:'?portal=moov&compte=direction'}
];
const enabled=()=>String(process.env.GUARDIAN_DEMO_ACCOUNTS||'').toLowerCase()!=='off';
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');

function migrate(s){s.db.exec('CREATE TABLE IF NOT EXISTS demo_passes(token TEXT PRIMARY KEY,created_by TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL)');}
function valid(s,secret,now=Date.now()){if(!secret||secret.length>100)return false;migrate(s);return !!s.get('SELECT token FROM demo_passes WHERE token=? AND expires>?',hash(secret),now);}
// Seule la direction (rôle admin vérifié en base) peut ouvrir la barre sur son appareil.
function open(s,uid,now=Date.now()){
 insist(operator.role(s,uid)==='admin','Seule la direction peut activer la barre des rôles.',403);
 migrate(s);s.run('DELETE FROM demo_passes WHERE expires<=?',now);
 const secret=crypto.randomBytes(32).toString('base64url');
 s.run('INSERT INTO demo_passes VALUES(?,?,?,?)',hash(secret),uid,now,now+TTL);
 s.event(null,uid,'demo.rolebar.open','Barre des rôles activée sur un appareil pour '+HOURS+' h');
 return {secret,maxAge:HOURS*3600};
}
function close(s,secret){if(secret&&secret.length<=100){migrate(s);s.run('DELETE FROM demo_passes WHERE token=?',hash(secret));}return {ok:true};}
function account(s,r){const u=s.get('SELECT id,email,name FROM users WHERE email=?',r.email);return u&&workspace.sessionRole(s,u.id)===r.role?u:null;}
// Ce que la page de connexion et la barre affichent.
// La barre apparaît avec le passe, ou pour une session ouverte sur un compte de démo (pas pour un juré inscrit avec son numéro).
function list(s,secret,uid){
 const pass=valid(s,secret),accounts=enabled();
 if(!pass&&!accounts)return {active:false,accounts:false};
 const roles=ROLES.map(r=>{const u=account(s,r);return {key:r.key,label:r.label,name:u?.name||null,ready:!!u,current:!!u&&u.id===uid,locked:!pass&&!r.open,email:!r.open?r.email:undefined,login:r.login};});
 return {active:pass||roles.some(r=>r.current),accounts,pass,roles};
}
// Choisir un rôle : ouvert à tous pour les rôles « open », sinon le passe de la direction est exigé.
function pick(s,secret,key){
 const r=ROLES.find(x=>x.key===key);insist(r,'Rôle inconnu.',404);
 const pass=valid(s,secret);
 insist(pass||enabled(),'Les comptes de démo ne sont pas ouverts sur ce site.',403);
 insist(pass||r.open,'Le compte Direction demande son mot de passe.',403);
 const u=account(s,r);insist(u,'Ce compte de démo n’est pas prêt. Réinitialisez la démo.',404);
 s.event(null,u.id,'demo.rolebar.switch','Entrée par les comptes de démo : '+r.label+(pass?' (barre de la direction)':''));
 return {user:u,page:r.page,role:r.key};
}
module.exports={migrate,open,close,list,pick,valid,ROLES,TTL};
