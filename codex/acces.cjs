'use strict';
// Fibre Access (thème 9) : offres solidaires pour les budgets serrés.
// 1. Tarif étudiant : la carte étudiante est photographiée dans l'application, un conseiller Moov la vérifie,
//    puis le forfait coûte 30 % de moins jusqu'à la fin de validité de la carte. La photo est effacée après la décision.
// 2. Pack voisins : un foyer ouvre un pack, jusqu'à 3 autres foyers de la même commune le rejoignent avec un code ;
//    le débit et le prix du pack sont partagés à parts égales.
// 3. Paiement en plusieurs fois : un client en difficulté paie son mois en 2 ou 3 fois, sans frais, au lieu de résilier.
// Dans la démonstration, aucune facture n'est modifiée : les montants sont calculés et affichés (« À propos de la démo »).
const crypto=require('node:crypto');
const O=require('./operator-store.cjs');
const {insist}=require('./pilot-model.cjs');
const DAY=86400000,HOUR=3600000,CHECK=24*HOUR,MAX_PHOTO=480000,STUDENT=30,MAX_YEARS=2,STEP=10*DAY;
const PACKS=[{id:'voisins-300',name:'Pack voisins 300',mbps:300,price:36000,homes:4},{id:'voisins-500',name:'Pack voisins 500',mbps:500,price:60000,homes:4}];
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS acces_etudiants(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,school TEXT NOT NULL,until INTEGER NOT NULL,photo TEXT,status TEXT NOT NULL,note TEXT,deadline INTEGER,checked_by TEXT REFERENCES users(id),created INTEGER NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS acces_packs(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,pack TEXT NOT NULL,commune TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS acces_pack_foyers(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,pack_id TEXT NOT NULL REFERENCES acces_packs(id) ON DELETE CASCADE,at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS acces_echeances(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,month TEXT NOT NULL,amount INTEGER NOT NULL,parts TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(user_id,month));
 `);}

const J=()=>require('./journey-store.cjs');
const planOf=(s,uid)=>J().get(s,uid)?.plan||J().PLANS[1];
// Commune du foyer : le quartier suivi (noc_members), sinon celui du parcours client.
const communeOf=(s,uid)=>{let zone='';try{zone=s.get('SELECT g.zone FROM noc_members m JOIN noc_segments g ON g.id=m.segment_id WHERE m.user_id=?',uid)?.zone||'';}catch{}return (zone||String(J().get(s,uid)?.zone||'')).split(' · ')[0]||'Abidjan';};
const shortName=name=>{const p=String(name||'').trim().split(/\s+/).filter(Boolean);return p.length?p[0]+(p[1]?' '+p[1][0].toUpperCase()+'.':''):'Client';};
const round50=n=>Math.round(n/50)*50;
const monthOf=t=>new Date(t).toISOString().slice(0,7);
const MONTHS=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const monthName=m=>MONTHS[Number(m.slice(5))-1];
function text(v,label,max){insist(typeof v==='string'&&v.trim().length>=2&&v.trim().length<=max&&!/[\u0000-\u001f<>]/.test(v),label+' : de 2 à '+max+' caractères.');return v.trim();}
function photo(v){insist(typeof v==='string'&&v.length<MAX_PHOTO&&/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(v),'Photo JPEG ou PNG de moins de 350 Ko requise.');return v;}
function notify(s,uid,title,body,now){const st=J().get(s,uid);if(!st)return;st.notifications=st.notifications||[];st.notifications.unshift({key:crypto.randomUUID(),home:'home-1',at:now,title,body,read:false});st.notifications=st.notifications.slice(0,100);J().put(s,uid,st);}

function packView(s,uid){
 const m=s.get('SELECT p.* FROM acces_pack_foyers f JOIN acces_packs p ON p.id=f.pack_id WHERE f.user_id=?',uid);if(!m)return null;
 const offer=PACKS.find(p=>p.id===m.pack),homes=s.all('SELECT f.user_id,f.at,u.name FROM acces_pack_foyers f JOIN users u ON u.id=f.user_id WHERE f.pack_id=? ORDER BY f.at',m.id);
 return {code:'FAM-'+m.code,name:offer.name,mbps:offer.mbps,price:offer.price,commune:m.commune,owner:m.owner===uid,max:offer.homes,
  homes:homes.map(h=>({name:shortName(h.name),me:h.user_id===uid})),share:round50(offer.price/homes.length),mbpsEach:Math.round(offer.mbps/homes.length)};
}

// Côté client : les trois offres et où il en est.
function state(s,uid,now=Date.now()){
 const plan=planOf(s,uid),st=s.get('SELECT * FROM acces_etudiants WHERE user_id=?',uid),month=monthOf(now);
 const student=st?{school:st.school,until:st.until,status:st.until<now&&st.status==='valide'?'expire':st.status,note:st.note||'',deadline:st.deadline}:null;
 const active=student?.status==='valide';
 const e=s.get('SELECT * FROM acces_echeances WHERE user_id=? AND month=?',uid,month);
 const price=active?round50(plan.price*(100-STUDENT)/100):plan.price;
 return {plan:{mbps:plan.mbps,price:plan.price},price,student,studentPrice:round50(plan.price*(100-STUDENT)/100),studentDiscount:STUDENT,
  pack:packView(s,uid),packs:PACKS.map(p=>({...p,share:round50(p.price/p.homes),mbpsEach:Math.round(p.mbps/p.homes)})),commune:communeOf(s,uid),
  split:e?{month:monthName(e.month),amount:e.amount,parts:JSON.parse(e.parts)}:null,splitMonth:monthName(month),splitAmount:price};
}

function act(s,uid,d,now=Date.now()){return s.transaction(()=>{
 insist(d&&typeof d.action==='string','Action manquante.');
 if(d.action==='student'){
  const row=s.get('SELECT status,until FROM acces_etudiants WHERE user_id=?',uid);
  insist(!row||row.status==='refuse'||(row.status==='valide'&&row.until<now),row?.status==='verification'?'Votre carte est déjà en cours de vérification.':'Votre tarif étudiant est déjà actif.',409);
  const school=text(d.school,'Votre école',80),until=Number(d.until);
  insist(Number.isFinite(until)&&until>now&&until<now+MAX_YEARS*366*DAY,'Indiquez la date de fin de validité inscrite sur la carte.');
  const pic=photo(d.photo);
  s.run("INSERT INTO acces_etudiants(user_id,school,until,photo,status,deadline,created,updated) VALUES(?,?,?,?,'verification',?,?,?) ON CONFLICT(user_id) DO UPDATE SET school=excluded.school,until=excluded.until,photo=excluded.photo,status='verification',note=NULL,deadline=excluded.deadline,updated=excluded.updated",uid,school,until,pic,now+CHECK,now,now);
 }else if(d.action==='pack-open'){
  insist(!s.get('SELECT 1 FROM acces_pack_foyers WHERE user_id=?',uid),'Vous faites déjà partie d’un pack.',409);
  const offer=PACKS.find(p=>p.id===d.pack);insist(offer,'Choisissez un pack.');insist(d.confirm===true,'Confirmez l’ouverture du pack.');
  let code;for(let i=0;i<20&&!code;i++){const c=Array.from(crypto.randomBytes(4),b=>ALPHABET[b%ALPHABET.length]).join('');if(!s.get('SELECT 1 FROM acces_packs WHERE code=?',c))code=c;}
  const id=crypto.randomUUID();
  s.run('INSERT INTO acces_packs VALUES(?,?,?,?,?,?)',id,code,uid,offer.id,communeOf(s,uid),now);s.run('INSERT INTO acces_pack_foyers VALUES(?,?,?)',uid,id,now);
 }else if(d.action==='pack-join'){
  insist(!s.get('SELECT 1 FROM acces_pack_foyers WHERE user_id=?',uid),'Vous faites déjà partie d’un pack.',409);
  const code=String(d.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^FAM/,'');insist(/^[A-Z0-9]{4}$/.test(code),'Le code ressemble à FAM-7KQ2 : vérifiez-le.');
  const p=s.get('SELECT * FROM acces_packs WHERE code=?',code);insist(p,'Code de pack inconnu. Vérifiez-le avec votre voisin.',404);
  insist(p.commune===communeOf(s,uid),'Ce pack est réservé aux foyers de '+p.commune+'.',409);
  const n=s.get('SELECT COUNT(*) AS n FROM acces_pack_foyers WHERE pack_id=?',p.id).n;insist(n<PACKS.find(x=>x.id===p.pack).homes,'Ce pack est déjà complet.',409);
  s.run('INSERT INTO acces_pack_foyers VALUES(?,?,?)',uid,p.id,now);
  notify(s,p.owner,'Un voisin a rejoint votre pack','Le prix de chaque foyer baisse : '+round50(PACKS.find(x=>x.id===p.pack).price/(n+1)).toLocaleString('fr-FR')+' F par mois.',now);
 }else if(d.action==='pack-leave'){
  const m=s.get('SELECT p.* FROM acces_pack_foyers f JOIN acces_packs p ON p.id=f.pack_id WHERE f.user_id=?',uid);insist(m,'Vous ne faites partie d’aucun pack.',409);
  s.run('DELETE FROM acces_pack_foyers WHERE user_id=?',uid);
  const left=s.all('SELECT user_id FROM acces_pack_foyers WHERE pack_id=? ORDER BY at',m.id);
  if(!left.length)s.run('DELETE FROM acces_packs WHERE id=?',m.id);else if(m.owner===uid)s.run('UPDATE acces_packs SET owner=? WHERE id=?',left[0].user_id,m.id);
 }else if(d.action==='split'){
  insist([2,3].includes(d.parts),'Choisissez 2 ou 3 fois.');insist(d.confirm===true,'Confirmez le paiement en plusieurs fois.');
  const month=monthOf(now);insist(!s.get('SELECT 1 FROM acces_echeances WHERE user_id=? AND month=?',uid,month),'Votre mois est déjà payé en plusieurs fois.',409);
  const total=state(s,uid,now).splitAmount,first=total-round50(total/d.parts)*(d.parts-1);
  const parts=Array.from({length:d.parts},(_,k)=>({amount:k?round50(total/d.parts):first,due:now+k*STEP,paid:null}));
  s.run('INSERT INTO acces_echeances VALUES(?,?,?,?,?,?)',crypto.randomUUID(),uid,month,total,JSON.stringify(parts),now);
 }else if(d.action==='split-pay'){
  const e=s.get('SELECT * FROM acces_echeances WHERE user_id=? AND month=?',uid,monthOf(now));insist(e,'Aucun paiement en plusieurs fois ce mois-ci.',409);
  const parts=JSON.parse(e.parts),k=parts.findIndex(p=>!p.paid);insist(k>=0,'Tout est déjà payé. Merci !',409);insist(d.part===k,'Cette part n’est plus à payer. Rechargez la page.',409);
  parts[k].paid=now;s.run('UPDATE acces_echeances SET parts=? WHERE id=?',JSON.stringify(parts),e.id);
 }else insist(false,'Action inconnue.');
 return state(s,uid,now);
});}

// Équipe Moov : cartes étudiantes à vérifier, packs voisins, mois payés en plusieurs fois.
function list(s,uid,now=Date.now()){
 O.requireOperator(s,uid);
 const cards=s.all("SELECT a.*,u.name FROM acces_etudiants a JOIN users u ON u.id=a.user_id WHERE a.status='verification' ORDER BY a.deadline").map(r=>({id:r.user_id,name:shortName(r.name),school:r.school,until:r.until,photo:r.photo,deadline:r.deadline,late:now>r.deadline}));
 const splits=s.all('SELECT * FROM acces_echeances WHERE month=?',monthOf(now)).map(e=>JSON.parse(e.parts));
 return {cards,students:s.get("SELECT COUNT(*) AS n FROM acces_etudiants WHERE status='valide' AND until>?",now).n,
  packs:s.get('SELECT COUNT(*) AS n FROM acces_packs').n,homes:s.get('SELECT COUNT(*) AS n FROM acces_pack_foyers').n,
  splits:splits.length,left:splits.reduce((n,p)=>n+p.filter(x=>!x.paid).reduce((a,x)=>a+x.amount,0),0)};
}

// Un conseiller valide ou refuse une carte étudiante ; dans les deux cas la photo est effacée.
function decide(s,uid,d,now=Date.now()){return s.transaction(()=>{
 O.requireOperator(s,uid);
 insist(d&&typeof d.id==='string'&&['valide','refuse'].includes(d.decision),'Décision incomplète.');
 const r=s.get("SELECT * FROM acces_etudiants WHERE user_id=? AND status='verification'",d.id);insist(r,'Cette carte n’est plus à vérifier.',409);
 const note=d.decision==='refuse'?text(d.note,'Motif',160):null;
 s.run('UPDATE acces_etudiants SET status=?,note=?,photo=NULL,checked_by=?,updated=? WHERE user_id=?',d.decision,note,uid,now,d.id);
 const plan=planOf(s,d.id),until=new Date(r.until).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});
 if(d.decision==='valide')notify(s,d.id,'Tarif étudiant activé','Votre forfait '+plan.mbps+' Mb/s passe à '+round50(plan.price*(100-STUDENT)/100).toLocaleString('fr-FR')+' F par mois jusqu’au '+until+'.',now);
 else notify(s,d.id,'Carte étudiante à reprendre',note,now);
 s.event(null,uid,'acces.etudiant.'+d.decision,r.school);
 return list(s,uid,now);
});}
module.exports={migrate,state,act,list,decide,PACKS,STUDENT};
