'use strict';
// Fair Deal (thème 4) : après une coupure confirmée et réparée, Guardian calcule un geste pour chaque client du quartier
// touché (jours offerts au prorata de son forfait), mais c'est un responsable Moov qui le valide ou le refuse.
// Règle de la démonstration, à régler avec Moov : 1 jour offert pour toute coupure du réseau confirmée,
// + 1 jour par tranche de 24 h commencée au-delà de la première, + 1 jour si l'heure de retour promise n'a pas été tenue.
// Dans la démonstration, aucune facture n'est modifiée : le client reçoit une notification dans l'application.
const crypto=require('node:crypto');
const O=require('./operator-store.cjs');
const {insist}=require('./pilot-model.cjs');
const DAY=86400000,HOUR=3600000,WINDOW=30*DAY,LATE=15*60000,DONE=['resolved','closed'],DECIDERS=['supervisor','admin'];

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS fair_deal(incident_id TEXT NOT NULL REFERENCES noc_incidents(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,days INTEGER NOT NULL,amount INTEGER NOT NULL,reasons TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'proposed',decided_by TEXT REFERENCES users(id),decided_at INTEGER,created INTEGER NOT NULL,PRIMARY KEY(incident_id,user_id));
 `);}

const round10=n=>Math.round(n/10)*10;
// Le geste d'un client pour une coupure : jours et raisons, montant au prorata de son forfait (30 jours).
function gesture({created,ended,promised=null,price=20000}){
 const hours=Math.max(0,(ended-created)/HOUR),reasons=['Coupure du réseau confirmée : 1 jour offert'];
 let days=1;const extra=Math.max(0,Math.ceil(hours/24)-1);
 if(extra){days+=extra;reasons.push('Coupure de '+Math.round(hours)+' h : +'+extra+' jour'+(extra>1?'s':''));}
 if(promised&&ended>promised+LATE){days+=1;reasons.push('Heure de retour promise non tenue : +1 jour');}
 return {days,amount:round10(days*price/30),reasons};
}

const shortName=name=>{const p=String(name||'').trim().split(/\s+/).filter(Boolean);return p.length?p[0]+(p[1]?' '+p[1][0].toUpperCase()+'.':''):'Client';};
const staffIds=s=>new Set([...s.all('SELECT user_id FROM operator_grants'),...s.all('SELECT user_id FROM noc_field_accounts')].map(r=>r.user_id));

// Prépare les gestes des coupures réparées qui n'en ont pas encore (une seule fois par coupure et par client).
function prepare(s,now=Date.now()){
 const staff=staffIds(s),J=require('./journey-store.cjs');
 const done=s.all("SELECT * FROM noc_incidents WHERE mode='demo' AND status IN ('resolved','closed') AND updated>=? AND id NOT IN (SELECT incident_id FROM fair_deal)",now-WINDOW);
 for(const inc of done){
  if(!inc.segment_id)continue;
  const eta=s.get('SELECT promised FROM noc_eta WHERE incident_id=?',inc.id);
  for(const m of s.all('SELECT user_id FROM noc_members WHERE segment_id=?',inc.segment_id)){
   if(staff.has(m.user_id))continue;
   const st=J.get(s,m.user_id),g=gesture({created:inc.created,ended:inc.updated,promised:eta?.promised,price:st?.plan?.price||20000});
   s.run('INSERT OR IGNORE INTO fair_deal(incident_id,user_id,days,amount,reasons,created) VALUES(?,?,?,?,?,?)',inc.id,m.user_id,g.days,g.amount,JSON.stringify(g.reasons),now);
  }
 }
}

// Vue de l'équipe Moov : gestes groupés par coupure, à valider ou refuser d'un coup.
function list(s,uid,now=Date.now()){
 const role=O.requireOperator(s,uid);prepare(s,now);
 const rows=s.all("SELECT f.*,u.name,i.title,i.created AS started,i.updated AS ended,g.zone FROM fair_deal f JOIN users u ON u.id=f.user_id JOIN noc_incidents i ON i.id=f.incident_id LEFT JOIN noc_segments g ON g.id=i.segment_id WHERE f.created>=? ORDER BY f.created DESC",now-WINDOW);
 const groups=new Map();
 for(const r of rows){
  const g=groups.get(r.incident_id)||{incidentId:r.incident_id,title:r.title,zone:r.zone||'',started:r.started,ended:r.ended,status:r.status,clients:[],days:0,amount:0};
  g.clients.push({name:shortName(r.name),days:r.days,amount:r.amount,reasons:JSON.parse(r.reasons)});g.days+=r.days;g.amount+=r.amount;
  if(r.status==='proposed')g.status='proposed';groups.set(r.incident_id,g);
 }
 const all=[...groups.values()];
 return {canDecide:DECIDERS.includes(role),pending:all.filter(g=>g.status==='proposed'),decided:all.filter(g=>g.status!=='proposed').slice(0,5)};
}

// Un responsable valide (ou refuse) le geste de toute une coupure ; les clients sont prévenus dans l'application.
function decide(s,uid,d,now=Date.now()){
 return s.transaction(()=>{
  const role=O.requireOperator(s,uid);insist(DECIDERS.includes(role),'Seul un responsable peut accorder un geste commercial.',403);
  insist(d&&typeof d.incidentId==='string'&&['validate','refuse'].includes(d.decision),'Décision incomplète.');
  if(d.decision==='validate')insist(d.confirm===true,'Confirmez le geste avant de le valider.');
  const rows=s.all("SELECT * FROM fair_deal WHERE incident_id=? AND status='proposed'",d.incidentId);insist(rows.length,'Aucun geste en attente pour cette coupure.',409);
  const status=d.decision==='validate'?'validated':'refused';
  s.run("UPDATE fair_deal SET status=?,decided_by=?,decided_at=? WHERE incident_id=? AND status='proposed'",status,uid,now,d.incidentId);
  if(status==='validated'){
   const J=require('./journey-store.cjs');
   for(const r of rows){const st=J.get(s,r.user_id);if(!st)continue;st.notifications=st.notifications||[];
    st.notifications.unshift({key:crypto.randomUUID(),home:'home-1',at:now,title:'Moov vous offre '+r.days+' jour'+(r.days>1?'s':''),body:'Pour la coupure que vous avez subie, '+r.amount.toLocaleString('fr-FR')+'\u00a0F seront déduits de votre prochaine facture. Merci de votre patience.',read:false});
    st.notifications=st.notifications.slice(0,100);st.fairDeal=(st.fairDeal||[]).concat({incidentId:r.incident_id,days:r.days,amount:r.amount,at:now}).slice(-20);J.put(s,r.user_id,st);}
  }
  s.run('INSERT INTO noc_events(id,incident_id,actor,kind,public_text,detail,at) VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),d.incidentId,uid,'fairdeal.'+status,
   status==='validated'?'Geste commercial accordé à '+rows.length+' client'+(rows.length>1?'s':''):'Geste commercial refusé',JSON.stringify({clients:rows.length,amount:rows.reduce((a,r)=>a+r.amount,0)}),now);
  return list(s,uid,now);
 });
}
module.exports={migrate,gesture,prepare,list,decide};
