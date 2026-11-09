'use strict';
// Barre des rôles de la démo : passer de Client à Conseiller, Technicien, Superviseur ou Direction en un geste.
// Sécurité :
// - la barre ne s'ouvre que sur un appareil où la direction s'est connectée avec son mot de passe : elle y dépose
//   un « passe de démo » (cookie HttpOnly, SameSite=Strict, 12 heures) ;
// - sans ce passe, rien n'apparaît et aucune connexion n'est accordée (un client ou un juré ne voit jamais la barre) ;
// - chaque bouton ouvre une vraie session sur un compte de démo précis : les droits restent ceux du compte,
//   vérifiés côté serveur à chaque action, et le rôle attendu est revérifié avant d'ouvrir la session ;
// - aucun mot de passe n'est dans ce fichier ni envoyé au navigateur.
const crypto=require('node:crypto');
const {DEMO,STAFF}=require('./seed-demo.cjs');
const operator=require('./operator-store.cjs'),workspace=require('./noc-workspace.cjs'),{insist}=require('./pilot-model.cjs');

const HOURS=12,TTL=HOURS*3600000;
const staff=role=>STAFF.find(m=>m.role===role).email;
// Ordre de la barre : du client à la direction. « page » = l'écran ouvert après le changement.
const ROLES=[
 {key:'client',label:'Client',email:DEMO.client.email,role:'subscriber',page:'?portal=client&section=home'},
 {key:'conseiller',label:'Conseiller',email:staff('agent'),role:'agent',page:'?portal=moov&section=operations'},
 {key:'technicien',label:'Technicien',email:DEMO.technician.email,role:'technician',page:'?portal=client&section=home'},
 {key:'superviseur',label:'Superviseur',email:staff('supervisor'),role:'supervisor',page:'?portal=moov&section=superviseur'},
 {key:'direction',label:'Direction',email:DEMO.admin.email,role:'admin',page:'?portal=moov&section=operations'}
];
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
// Ce que la barre affiche : rien sans passe valide.
function list(s,secret,uid){
 if(!valid(s,secret))return {active:false};
 return {active:true,roles:ROLES.map(r=>{const u=account(s,r);return {key:r.key,label:r.label,name:u?.name||null,ready:!!u,current:!!u&&u.id===uid};})};
}
// Choisir un rôle : le passe est exigé, puis le compte de démo doit avoir exactement le rôle attendu.
function pick(s,secret,key){
 insist(valid(s,secret),'La barre des rôles n’est pas activée sur cet appareil.',403);
 const r=ROLES.find(x=>x.key===key);insist(r,'Rôle inconnu.',404);
 const u=account(s,r);insist(u,'Ce compte de démo n’est pas prêt. Réinitialisez la démo.',404);
 s.event(null,u.id,'demo.rolebar.switch','Entrée par la barre des rôles : '+r.label);
 return {user:u,page:r.page,role:r.key};
}
module.exports={migrate,open,close,list,pick,valid,ROLES,TTL};
