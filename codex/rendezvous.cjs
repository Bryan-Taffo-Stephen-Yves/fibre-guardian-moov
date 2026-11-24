'use strict';
// Créneau de dépannage (problème n°4 des clients fibre) : « le technicien vient quand ? » et « il n'est jamais venu ».
//  - Sur son dossier de réparation (Ma réparation), le client choisit quand il est chez lui :
//    un des 3 prochains jours (jamais le dimanche), le matin (8 h - 12 h) ou l'après-midi (14 h - 18 h).
//    Il peut le changer tant que le technicien n'est pas parti.
//  - Créneau passé sans technicien sur place : le dossier est « en retard » chez le client (avec des excuses
//    et un nouveau créneau à choisir) et dans le Superviseur ; le client est prévenu une seule fois par créneau.
//  - L'équipe Moov voit les rendez-vous (Superviseur, onglet Clients) : les retards d'abord, puis ceux du jour.
// Les pannes détectées par le réseau (dossiers de zone) se réparent dans la rue : pas de rendez-vous.
const O=require('./operator-store.cjs');
const {insist}=require('./pilot-model.cjs');
const HOUR=3600000,DAY=24*HOUR,DAYS=3,MAX_CHANGES=4;
const SLOTS={matin:{label:'entre 8 h et 12 h',from:8,to:12},apres:{label:'entre 14 h et 18 h',from:14,to:18}};
const OPEN=['reported','proposed','approved','rejected','dispatched'];   // le créneau se choisit ou se change
const WAITING=[...OPEN,'en_route'];                                       // le technicien n'est pas encore sur place

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS rendezvous(incident_id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,day INTEGER NOT NULL,slot TEXT NOT NULL,changes INTEGER NOT NULL DEFAULT 0,late_noticed INTEGER,created INTEGER NOT NULL,updated INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS rendezvous_user ON rendezvous(user_id);
 `);}

const J=()=>require('./journey-store.cjs');
const midnight=t=>{const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());};   // Abidjan = UTC
const dayName=t=>new Date(t).toLocaleDateString('fr-FR',{timeZone:'Africa/Abidjan',weekday:'long',day:'numeric',month:'long'});
const endOf=r=>r.day+SLOTS[r.slot].to*HOUR;
// Les jours proposés : aujourd'hui si l'après-midi n'a pas commencé, puis les jours suivants, sans le dimanche.
function days(now){
 const out=[];let t=midnight(now);
 if(now<t+SLOTS.apres.from*HOUR&&new Date(t).getUTCDay()!==0)out.push(t);
 while(out.length<DAYS){t+=DAY;if(new Date(t).getUTCDay()!==0)out.push(t);}
 return out;
}
function slotsOf(day,now){return Object.entries(SLOTS).filter(([,v])=>day+v.from*HOUR>now).map(([id,v])=>({id,label:v.label}));}
function choices(now){return days(now).map(d=>({day:d,label:dayName(d),today:d===midnight(now),slots:slotsOf(d,now)})).filter(d=>d.slots.length);}
const label=r=>dayName(r.day)+', '+SLOTS[r.slot].label;

function incident(s,iid){return s.get('SELECT id,reporter,source,status,technician FROM noc_incidents WHERE id=?',iid);}
// Un signalement du client lui-même (application ou *144#) ; pas une panne détectée par la supervision du réseau.
const eligible=i=>!!i&&!!i.reporter&&i.source!=='telemetry';
function notify(s,uid,title,body,now){
 const st=J().get(s,uid);if(!st)return;st.notifications=st.notifications||[];
 st.notifications.unshift({key:'rdv:'+now+':'+title.length,home:'home-1',at:now,title,body,read:false,page:'tracking'});
 st.notifications=st.notifications.slice(0,100);J().put(s,uid,st);
}
function late(r,i,now){return !!r&&WAITING.includes(i.status)&&now>endOf(r);}

// Ajoute à chaque dossier du client : son rendez-vous, s'il est en retard, et les créneaux qu'il peut choisir.
function decorate(s,uid,data,now=Date.now()){
 if(!data||!Array.isArray(data.incidents))return data;
 for(const v of data.incidents){
  const i=incident(s,v.id);
  if(!eligible(i)||i.reporter!==uid||!WAITING.includes(i.status)){v.rendezvous=null;continue;}
  const r=s.get('SELECT * FROM rendezvous WHERE incident_id=?',i.id),isLate=late(r,i,now);
  // Prévenu une seule fois par créneau manqué.
  if(isLate&&r.late_noticed!==endOf(r)){
   s.run('UPDATE rendezvous SET late_noticed=? WHERE incident_id=?',endOf(r),i.id);
   notify(s,uid,'Le technicien n’est pas venu à l’heure','Pardon : il devait passer '+label(r)+'. Choisissez un nouveau créneau dans « Ma réparation », il passe en priorité.',now);
  }
  v.rendezvous={
   current:r?{day:r.day,slot:r.slot,label:label(r),late:isLate}:null,
   canChange:OPEN.includes(i.status)&&(!r||r.changes<MAX_CHANGES),
   choices:OPEN.includes(i.status)?choices(now):[]
  };
 }
 return data;
}

// Le client choisit (ou change) son créneau.
function choose(s,uid,d,now=Date.now()){return s.transaction(()=>{
 const i=incident(s,String(d?.incident||''));insist(i&&i.reporter===uid,'Dossier introuvable.',404);
 insist(eligible(i),'Cette panne se répare dans la rue : pas besoin d’être chez vous.',409);
 insist(OPEN.includes(i.status),'Le technicien est déjà parti : appelez le 111 pour changer l’heure.',409);
 const day=Number(d.day);
 insist(choices(now).some(c=>c.day===day&&c.slots.some(x=>x.id===d.slot)),'Choisissez un des créneaux proposés.');
 const r=s.get('SELECT * FROM rendezvous WHERE incident_id=?',i.id);
 if(r){insist(r.changes<MAX_CHANGES,'Vous avez déjà changé plusieurs fois : appelez le 111 pour fixer l’heure avec un conseiller.',409);
  s.run('UPDATE rendezvous SET day=?,slot=?,changes=changes+1,updated=? WHERE incident_id=?',day,d.slot,now,i.id);}
 else s.run('INSERT INTO rendezvous(incident_id,user_id,day,slot,created,updated) VALUES(?,?,?,?,?,?)',i.id,uid,day,d.slot,now,now);
 const v={day,slot:d.slot};
 notify(s,uid,r?'Rendez-vous changé':'Rendez-vous noté','Le technicien passe chez vous '+label(v)+'. Vous le suivrez ici dès son départ.',now);
 return {ok:true,label:label(v)};
});}

// Équipe Moov : les rendez-vous à venir, les retards d'abord.
function list(s,uid,now=Date.now()){
 O.requireOperator(s,uid);
 const rows=s.all("SELECT r.*,i.status,i.technician,i.title,u.name FROM rendezvous r JOIN noc_incidents i ON i.id=r.incident_id JOIN users u ON u.id=r.user_id WHERE i.status IN ("+WAITING.map(()=>'?').join(',')+")",...WAITING)
  .map(r=>({id:r.incident_id,name:String(r.name||'Client').split(' ').slice(0,2).join(' '),title:r.title,when:label(r),end:endOf(r),late:late(r,r,now),today:r.day===midnight(now),changes:r.changes,assigned:!!r.technician}))
  .sort((a,b)=>Number(b.late)-Number(a.late)||a.end-b.end);
 return {items:rows,late:rows.filter(r=>r.late).length,today:rows.filter(r=>r.today).length};
}

// Équipe Moov (Centre d'opérations, déjà filtré par ses droits) : le rendez-vous du client sur chaque dossier.
function forTeam(s,data,now=Date.now()){
 if(!data||!Array.isArray(data.incidents))return data;
 for(const v of data.incidents){const r=s.get('SELECT * FROM rendezvous WHERE incident_id=?',v.id);v.rendezvous=r&&WAITING.includes(v.status)?{label:label(r),late:now>endOf(r)}:null;}
 return data;
}

module.exports={migrate,decorate,choose,list,forTeam,choices,SLOTS};
