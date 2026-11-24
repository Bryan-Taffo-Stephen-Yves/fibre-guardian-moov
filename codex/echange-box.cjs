'use strict';
// Échange de box (problème n°3 des clients fibre) : une box qui ne s'allume plus, souvent après un délestage,
// ne se répare pas au téléphone. Le client demande l'échange en un geste, au lieu d'aller « voir en agence » sans savoir quoi faire.
//  - Guardian le propose quand la photo montre une box éteinte (box-reading.cjs).
//  - Le client confirme qu'il a essayé une autre prise, puis choisit : retirer une box neuve en agence (avec un code),
//    ou recevoir un technicien qui apporte la box et branche tout (créneau du matin ou de l'après-midi).
//  - L'équipe Moov suit les demandes dans le Superviseur (onglet Clients) : « Box prête » ou « Technicien envoyé », puis « Échangée ».
//  - Le client est prévenu à chaque étape ; l'échange est gratuit sous garantie (la box reste à Moov).
const crypto=require('node:crypto');
const O=require('./operator-store.cjs');
const {insist}=require('./pilot-model.cjs');
const HOUR=3600000,DAY=24*HOUR;
const AGENCES=[
 {id:'yop',name:'Agence Moov de Yopougon',commune:'Yopougon'},
 {id:'coc',name:'Agence Moov de Cocody',commune:'Cocody'},
 {id:'pla',name:'Agence Moov du Plateau',commune:'Plateau'},
 {id:'mar',name:'Agence Moov de Marcory',commune:'Marcory'},
 {id:'abo',name:'Agence Moov d’Abobo',commune:'Abobo'}
];
const SLOTS={matin:'entre 8 h et 12 h',apres:'entre 14 h et 18 h'};
const STEPS={demandee:'Demande reçue',prete:'Box prête en agence',envoye:'Technicien prévu',echangee:'Box échangée',annulee:'Demande annulée'};

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS box_echanges(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,mode TEXT NOT NULL,agence TEXT,slot TEXT,day INTEGER,code TEXT,reason TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'demandee',created INTEGER NOT NULL,updated INTEGER NOT NULL,done_by TEXT REFERENCES users(id));
 CREATE INDEX IF NOT EXISTS box_echange_user ON box_echanges(user_id,status);
 `);}

const J=()=>require('./journey-store.cjs');
const dayName=t=>new Date(t).toLocaleDateString('fr-FR',{timeZone:'Africa/Abidjan',weekday:'long',day:'numeric',month:'long'});
// Le jour de passage du technicien : demain (ou après-demain si on est dimanche soir, pas de passage le dimanche).
function nextDay(now){let t=now+DAY;if(new Date(t).getUTCDay()===0)t+=DAY;return Date.UTC(new Date(t).getUTCFullYear(),new Date(t).getUTCMonth(),new Date(t).getUTCDate());}
function communeOf(s,uid){const st=J().get(s,uid);return String(st?.zone||st?.homeZone?.zone||'').split('·')[0].trim();}
function open(s,uid){return s.get("SELECT * FROM box_echanges WHERE user_id=? AND status NOT IN ('echangee','annulee') ORDER BY created DESC LIMIT 1",uid);}
function view(r){
 if(!r)return null;
 const ag=AGENCES.find(a=>a.id===r.agence);
 return {id:r.id,mode:r.mode,status:r.status,step:STEPS[r.status],agence:ag?ag.name:null,code:r.mode==='agence'?r.code:null,
  when:r.mode==='technicien'?dayName(r.day)+', '+SLOTS[r.slot]:null,created:r.created,updated:r.updated};
}
function notify(s,uid,title,body,now){
 const st=J().get(s,uid);if(!st)return;st.notifications=st.notifications||[];
 st.notifications.unshift({key:'echange:'+crypto.randomUUID(),home:'home-1',at:now,title,body,read:false,page:'tracking'});
 st.notifications=st.notifications.slice(0,100);J().put(s,uid,st);
}

// Ce que voit le client : sa demande en cours (ou la dernière échangée depuis moins de 3 jours) et les choix possibles.
function state(s,uid,now=Date.now()){
 const cur=open(s,uid)||s.get("SELECT * FROM box_echanges WHERE user_id=? AND status='echangee' AND updated>? ORDER BY updated DESC LIMIT 1",uid,now-3*DAY);
 const commune=communeOf(s,uid);
 return {current:view(cur),agences:AGENCES.slice().sort((a,b)=>(b.commune===commune)-(a.commune===commune)).map(a=>({id:a.id,name:a.name})),
  slots:Object.entries(SLOTS).map(([id,label])=>({id,label})),day:dayName(nextDay(now))};
}

function ask(s,uid,d,now=Date.now()){return s.transaction(()=>{
 insist(d&&d.tried===true,'Essayez d’abord une autre prise : beaucoup de box « mortes » repartent sur une prise qui marche.');
 insist(!open(s,uid),'Vous avez déjà une demande d’échange en cours.',409);
 insist(['agence','technicien'].includes(d.mode),'Choisissez : en agence, ou un technicien chez vous.');
 const reason=String(d.reason||'').trim().slice(0,300);
 let agence=null,slot=null,day=null,code=null;
 if(d.mode==='agence'){insist(AGENCES.some(a=>a.id===d.agence),'Choisissez votre agence.');agence=d.agence;code='BX-'+crypto.randomBytes(3).toString('hex').toUpperCase();}
 else{insist(Object.hasOwn(SLOTS,d.slot),'Choisissez le matin ou l’après-midi.');slot=d.slot;day=nextDay(now);}
 const id=crypto.randomUUID();
 s.run('INSERT INTO box_echanges(id,user_id,mode,agence,slot,day,code,reason,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)',id,uid,d.mode,agence,slot,day,code,reason,now,now);
 const v=view(s.get('SELECT * FROM box_echanges WHERE id=?',id));
 notify(s,uid,'Échange de box demandé',d.mode==='agence'?'Nous préparons une box neuve à l’'+v.agence.replace(/^Agence/,'agence')+'. Vous serez prévenu quand elle est prête. Votre code de retrait : '+code+'. Un conseiller vous appelle dans les 4 heures pour tout confirmer.':'Un technicien vous apporte une box neuve '+v.when+'. Gardez l’ancienne box et son chargeur : il les reprend. Un conseiller vous appelle dans les 4 heures pour tout confirmer.',now);
 // Un conseiller rappelle le client pour confirmer l'adresse et le moment (file « À rappeler », service-client.cjs).
 require('./service-client.cjs').open(s,{uid,kind:'echange',ref:id,title:d.mode==='agence'?'Échange en agence · '+v.agence:'Échange chez le client · '+v.when,detail:reason,silent:true},now);
 return state(s,uid,now);
});}

function cancel(s,uid,now=Date.now()){
 const r=open(s,uid);insist(r,'Aucune demande d’échange en cours.',404);insist(r.status==='demandee',r.status==='prete'?'Votre box neuve est déjà prête à l’agence : si vous n’en avez plus besoin, dites-le au guichet.':'Le technicien est déjà prévu : appelez le 111 pour changer le rendez-vous.',409);
 s.run("UPDATE box_echanges SET status='annulee',updated=? WHERE id=?",now,r.id);
 require('./service-client.cjs').cancelRef(s,'echange',r.id,now);
 return state(s,uid,now);
}

// Équipe Moov : demandes à traiter, la plus ancienne d'abord.
function list(s,uid,now=Date.now()){
 O.requireOperator(s,uid);
 const rows=s.all("SELECT e.*,u.name FROM box_echanges e JOIN users u ON u.id=e.user_id WHERE e.status NOT IN ('echangee','annulee') ORDER BY e.created").map(r=>({...view(r),name:String(r.name||'Client').split(' ').slice(0,2).join(' '),reason:r.reason,late:r.mode==='technicien'&&r.day?now>r.day+(r.slot==='matin'?12:18)*HOUR:now-r.created>DAY}));
 return {open:rows,done:s.get("SELECT COUNT(*) n FROM box_echanges WHERE status='echangee' AND updated>?",now-7*DAY).n};
}

// Étape suivante : agence → « prete » puis « echangee » ; technicien → « envoye » puis « echangee ».
function advance(s,uid,d,now=Date.now()){
 O.requireOperator(s,uid);
 const r=s.get('SELECT * FROM box_echanges WHERE id=?',d?.id);insist(r,'Demande introuvable.',404);
 const next={demandee:r.mode==='agence'?'prete':'envoye',prete:'echangee',envoye:'echangee'}[r.status];
 insist(next&&d.to===next,'Cette demande a déjà avancé. Rechargez la page.',409);
 s.run('UPDATE box_echanges SET status=?,updated=?,done_by=? WHERE id=?',next,now,uid,r.id);
 // Demande traitée après le jour prévu : le technicien passe au prochain jour possible, et le client le voit.
 if(next==='envoye'&&r.day+DAY<=now)s.run('UPDATE box_echanges SET day=? WHERE id=?',nextDay(now),r.id);
 const v=view(s.get('SELECT * FROM box_echanges WHERE id=?',r.id));
 if(next==='prete')notify(s,r.user_id,'Votre box neuve est prête','Passez la retirer à l’'+v.agence.replace(/^Agence/,'agence')+' avec votre code '+r.code+' et l’ancienne box.',now);
 if(next==='envoye')notify(s,r.user_id,'Le technicien arrive avec votre box neuve','Il passe '+v.when+'. Préparez l’ancienne box et son chargeur.',now);
 if(next==='echangee'){notify(s,r.user_id,'Box échangée','Votre nouvelle box est installée. Tout marche ? Dites-le dans « Ma réparation ».',now);
  require('./service-client.cjs').settle(s,'echange',r.id,{outcome:'echange',message:'Votre nouvelle box est installée.',by:uid,quiet:true},now);}
 return list(s,uid,now);
}

module.exports={migrate,state,ask,cancel,list,advance,AGENCES,SLOTS};
