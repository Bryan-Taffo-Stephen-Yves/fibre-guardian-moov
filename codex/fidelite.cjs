'use strict';
// Fibre Loyalty+ (thème 2) : fidélité par paliers. Le client gagne des points en payant sa facture en ligne
// (Moov Money), en payant à temps, en restant sans impayé et en parrainant un proche ; il les échange contre des avantages.
// 12 factures de suite payées à temps : niveau Argent automatique et débit boosté gratuit pendant un mois.
// Dans la démonstration, les factures passées sont rejouées, le paiement Moov Money est simulé et le débit boosté
// est affiché au client sans être appliqué à une vraie box (page « À propos de la démo »).
const crypto=require('node:crypto');
const O=require('./operator-store.cjs');
const {insist}=require('./pilot-model.cjs');
const DAY=86400000;
const POINTS={online:40,onTime:10,quarter:100,filleul:300};
const TIERS=[{id:'bronze',name:'Bronze',min:0},{id:'argent',name:'Argent',min:1000},{id:'or',name:'Or',min:2000}];
const STREAK=12,BOOST_DAYS=30;
const REWARDS=[
 {id:'boost',name:'Débit boosté 7 jours',detail:'Le forfait au-dessus du vôtre, sans rien payer.',points:300,days:7},
 {id:'wifi',name:'Visite Wi-Fi à domicile',detail:'Un technicien place votre box et vos répéteurs au bon endroit.',points:600},
 {id:'mois',name:'1 mois d’abonnement offert',detail:'Déduit de votre prochaine facture.',points:1500}
];

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS fidelite_factures(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,month TEXT NOT NULL,amount INTEGER NOT NULL,due INTEGER NOT NULL,paid_at INTEGER,channel TEXT,PRIMARY KEY(user_id,month));
 CREATE TABLE IF NOT EXISTS fidelite_echanges(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,reward TEXT NOT NULL,points INTEGER NOT NULL,at INTEGER NOT NULL,until INTEGER);
 `);}

// Mois au format « 2026-11 » ; échéance : dernier jour du mois, 23 h 59 (Abidjan, heure UTC).
const monthOf=t=>new Date(t).toISOString().slice(0,7);
const shift=(month,n)=>{const [y,m]=month.split('-').map(Number),d=new Date(Date.UTC(y,m-1+n,1));return d.toISOString().slice(0,7);};
const dueOf=month=>{const [y,m]=month.split('-').map(Number);return Date.UTC(y,m,1)-60000;};
const MONTHS=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const monthName=month=>MONTHS[Number(month.slice(5))-1]+' '+month.slice(0,4);
const J=()=>require('./journey-store.cjs');
const planOf=(s,uid)=>J().get(s,uid)?.plan||J().PLANS[1];
const shortName=name=>{const p=String(name||'').trim().split(/\s+/).filter(Boolean);return p.length?p[0]+(p[1]?' '+p[1][0].toUpperCase()+'.':''):'Client';};

// Factures passées d'un client de la démonstration (seed-demo.cjs) : mois payés à temps, en ligne ou en agence, ou en retard.
function history(s,uid,{months=11,agence=[],late=[]}={},now=Date.now()){
 const cur=monthOf(now),price=planOf(s,uid).price;
 for(let k=months;k>=1;k--){
  const m=shift(cur,-k),due=dueOf(m),paid=late.includes(k)?due+12*DAY:due-20*DAY;
  s.run('INSERT OR IGNORE INTO fidelite_factures VALUES(?,?,?,?,?,?)',uid,m,price,due,paid,agence.includes(k)?'agence':'moov_money');
 }
}

// La facture du mois en cours existe dès que le client ouvre sa page.
function bill(s,uid,now){
 const m=monthOf(now);
 s.run('INSERT OR IGNORE INTO fidelite_factures(user_id,month,amount,due) VALUES(?,?,?,?)',uid,m,planOf(s,uid).price,dueOf(m));
 return s.get('SELECT * FROM fidelite_factures WHERE user_id=? AND month=?',uid,m);
}

// Points gagnés, facture par facture (du plus ancien au plus récent), sans compter le mois en cours non payé.
function ledger(s,uid,now){
 const rows=s.all('SELECT * FROM fidelite_factures WHERE user_id=? ORDER BY month',uid).filter(r=>r.paid_at||r.due<now);
 let earned=0,run=0,streak=0;const lines=[];
 for(const r of rows){
  const onTime=!!r.paid_at&&r.paid_at<=r.due;let p=0;
  if(r.paid_at&&r.channel==='moov_money')p+=POINTS.online;
  if(onTime){p+=POINTS.onTime;run++;streak++;}else{run=0;streak=0;}
  if(onTime&&run%3===0)p+=POINTS.quarter;
  earned+=p;lines.push({month:r.month,label:monthName(r.month),amount:r.amount,paidAt:r.paid_at,channel:r.channel,onTime,late:!onTime,points:p});
 }
 const filleuls=s.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='parrainage_filleuls'").n?s.get('SELECT COUNT(*) AS n FROM parrainage_filleuls WHERE parrain_id=?',uid).n:0;
 earned+=filleuls*POINTS.filleul;
 const spent=s.get('SELECT COALESCE(SUM(points),0) AS n FROM fidelite_echanges WHERE user_id=?',uid).n;
 return {earned,spent,points:earned-spent,streak,filleuls,lines};
}

function tierOf(l){
 let t=[...TIERS].reverse().find(x=>l.earned>=x.min);
 if(l.streak>=STREAK&&t.id==='bronze')t=TIERS[1];
 return t;
}

function state(s,uid,now=Date.now()){
 const b=bill(s,uid,now),l=ledger(s,uid,now),tier=tierOf(l),next=TIERS[TIERS.indexOf(tier)+1]||null,plan=planOf(s,uid);
 const boost=s.get("SELECT * FROM fidelite_echanges WHERE user_id=? AND reward IN ('argent','boost') AND until>? ORDER BY until DESC LIMIT 1",uid,now);
 const faster=J().PLANS.find(p=>p.mbps>plan.mbps)||plan;
 return {points:l.points,earned:l.earned,tier:{id:tier.id,name:tier.name},next:next?{id:next.id,name:next.name,missing:Math.max(0,next.min-l.earned),min:next.min}:null,
  progress:next?Math.max(0,Math.min(100,Math.round((l.earned-tier.min)/(next.min-tier.min)*100))):100,
  streak:l.streak,streakGoal:STREAK,filleuls:l.filleuls,rules:POINTS,
  bill:{month:b.month,label:monthName(b.month),amount:b.amount,due:b.due,paid:!!b.paid_at,paidAt:b.paid_at,channel:b.channel,late:!b.paid_at&&now>b.due},
  boost:boost?{mbps:faster.mbps,until:boost.until,why:boost.reward==='argent'?'Cadeau du niveau Argent':'Échangé contre vos points'}:null,
  plan:{mbps:plan.mbps,price:plan.price},
  rewards:REWARDS.map(r=>({...r,canAfford:l.points>=r.points})),
  history:l.lines.slice(-6).reverse(),
  exchanges:s.all('SELECT reward,points,at,until FROM fidelite_echanges WHERE user_id=? ORDER BY at DESC LIMIT 5',uid).map(e=>({...e,name:e.reward==='argent'?'Débit boosté offert (niveau Argent)':REWARDS.find(r=>r.id===e.reward)?.name||e.reward}))};
}

function notify(s,uid,title,body,now){
 const st=J().get(s,uid);if(!st)return;st.notifications=st.notifications||[];
 st.notifications.unshift({key:crypto.randomUUID(),home:'home-1',at:now,title,body,read:false});st.notifications=st.notifications.slice(0,100);J().put(s,uid,st);
}

// Paiement de la facture du mois avec Moov Money (simulé dans la démonstration ; le montant vient du serveur).
function pay(s,uid,d,now=Date.now()){
 return s.transaction(()=>{
  insist(d&&d.confirm===true,'Confirmez le paiement.');
  const before=state(s,uid,now);insist(!before.bill.paid,'Votre facture de '+before.bill.label+' est déjà payée.',409);
  insist(d.month===before.bill.month,'Cette facture n’est plus à payer. Rechargez la page.',409);
  s.run("UPDATE fidelite_factures SET paid_at=?,channel='moov_money' WHERE user_id=? AND month=?",now,uid,before.bill.month);
  const after=state(s,uid,now),won=after.earned-before.earned;
  // Premier passage au niveau Argent par 12 mois payés à temps : un mois de débit boosté offert.
  if(after.tier.id!=='bronze'&&before.tier.id==='bronze'){
   s.run('INSERT INTO fidelite_echanges VALUES(?,?,?,?,?,?)',crypto.randomUUID(),uid,'argent',0,now,now+BOOST_DAYS*DAY);
   notify(s,uid,'Vous passez au niveau Argent','Merci pour votre fidélité : '+(after.streak>=STREAK?STREAK+' factures payées à temps. ':'')+'Votre débit est boosté gratuitement pendant un mois.',now);
  }else notify(s,uid,'Facture payée : +'+won+' points','Merci ! Votre facture de '+after.bill.label+' est réglée avec Moov Money.',now);
  return {...state(s,uid,now),won,promoted:after.tier.id!==before.tier.id?after.tier:null};
 });
}

// Échanger des points contre un avantage.
function redeem(s,uid,d,now=Date.now()){
 return s.transaction(()=>{
  const r=REWARDS.find(x=>x.id===d?.reward);insist(r,'Avantage inconnu.');insist(d.confirm===true,'Confirmez l’échange.');
  const st=state(s,uid,now);insist(st.points>=r.points,'Il vous manque '+(r.points-st.points)+' points pour cet avantage.',409);
  s.run('INSERT INTO fidelite_echanges VALUES(?,?,?,?,?,?)',crypto.randomUUID(),uid,r.id,r.points,now,r.days?now+r.days*DAY:null);
  notify(s,uid,r.name+' : c’est fait',r.id==='wifi'?'Un conseiller vous appelle pour choisir le jour de la visite.':r.id==='mois'?'Votre prochaine facture sera de 0 F.':'Votre débit passe au forfait au-dessus pendant 7 jours.',now);
  return state(s,uid,now);
 });
}

// Vue de l'équipe Moov : clients par niveau, factures payées en ligne ce mois-ci, derniers échanges.
function summary(s,uid,now=Date.now()){
 O.requireOperator(s,uid);
 const staff=new Set([...s.all('SELECT user_id FROM operator_grants'),...s.all('SELECT user_id FROM noc_field_accounts')].map(r=>r.user_id));
 const users=s.all('SELECT DISTINCT f.user_id,u.name FROM fidelite_factures f JOIN users u ON u.id=f.user_id').filter(u=>!staff.has(u.user_id));
 const tiers=Object.fromEntries(TIERS.map(t=>[t.id,0]));let points=0;
 for(const u of users){const l=ledger(s,u.user_id,now);tiers[tierOf(l).id]++;points+=l.points;}
 const month=s.all('SELECT paid_at,channel FROM fidelite_factures WHERE month=?',monthOf(now)).filter(r=>r.paid_at);
 return {clients:users.length,tiers:TIERS.map(t=>({id:t.id,name:t.name,count:tiers[t.id]})),points,
  paidThisMonth:month.length,onlineThisMonth:month.filter(r=>r.channel==='moov_money').length,
  exchanges:s.all('SELECT e.reward,e.points,e.at,u.name FROM fidelite_echanges e JOIN users u ON u.id=e.user_id ORDER BY e.at DESC LIMIT 4').map(e=>({name:shortName(e.name),what:e.reward==='argent'?'Passage au niveau Argent':REWARDS.find(r=>r.id===e.reward)?.name||e.reward,points:e.points,at:e.at}))};
}
module.exports={migrate,history,state,pay,redeem,summary,POINTS,TIERS,REWARDS,STREAK,monthOf};
