'use strict';
// Fibre+ (thème 10) : la fibre devient un bouquet. À partir de 300 Mb/s, l'abonnement inclut un service de contenus
// (films et séries, ou cours en ligne) avec des mois offerts, activé tout seul et changeable une fois par mois.
// Le pack jeux en ligne (latence réduite : la console passe en priorité sur la box) s'ajoute à tout forfait
// dès 100 Mb/s, et il est inclus à 500 Mb/s. Dans la démonstration, les partenaires de contenus sont génériques :
// aucun compte n'est créé chez eux et aucune facture n'est modifiée (« À propos de la démo »).
const crypto=require('node:crypto');
const O=require('./operator-store.cjs');
const {insist}=require('./pilot-model.cjs');
const DAY=86400000,INCLUDED=300,GAMING_MIN=100,GAMING_FREE=500,GAMING_PRICE=5000,GIFT_MONTHS=3,SWITCH=30*DAY;
const CONTENTS=[
 {id:'films',name:'Films et séries',detail:'Films africains et internationaux, séries ivoiriennes, en HD sur la télé et le téléphone.',value:4000},
 {id:'cours',name:'Cours en ligne',detail:'Soutien scolaire du CP à la Terminale, langues, informatique et bureautique.',value:3500}
];

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS fibreplus(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,content TEXT,since INTEGER,gift_until INTEGER,gaming INTEGER NOT NULL DEFAULT 0,gaming_since INTEGER,updated INTEGER NOT NULL);
 `);}

const J=()=>require('./journey-store.cjs');
const planOf=(s,uid)=>J().get(s,uid)?.plan||J().PLANS[1];
function notify(s,uid,title,body,now){const st=J().get(s,uid);if(!st)return;st.notifications=st.notifications||[];st.notifications.unshift({key:crypto.randomUUID(),home:'home-1',at:now,title,body,read:false});st.notifications=st.notifications.slice(0,100);J().put(s,uid,st);}
const addMonths=(t,n)=>{const d=new Date(t);d.setUTCMonth(d.getUTCMonth()+n);return d.getTime();};

// Dès que le forfait atteint 300 Mb/s, le contenu inclus s'active tout seul et le client est prévenu (une seule fois).
function sync(s,uid,now=Date.now()){
 const plan=planOf(s,uid);if(plan.mbps<INCLUDED)return false;
 const row=s.get('SELECT content FROM fibreplus WHERE user_id=?',uid);if(row?.content)return false;
 const c=CONTENTS[0],gift=addMonths(now,GIFT_MONTHS);
 s.run('INSERT INTO fibreplus(user_id,content,since,gift_until,updated) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET content=excluded.content,since=excluded.since,gift_until=excluded.gift_until,updated=excluded.updated',uid,c.id,now,gift,now);
 notify(s,uid,'Fibre+ : '+c.name+' inclus','Votre abonnement '+plan.mbps+' Mb/s inclut désormais '+c.name.toLowerCase()+', avec '+GIFT_MONTHS+' mois offerts chez notre partenaire. Vous pouvez choisir les cours en ligne à la place.',now);
 return true;
}

function state(s,uid,now=Date.now()){
 sync(s,uid,now);
 const plan=planOf(s,uid),row=s.get('SELECT * FROM fibreplus WHERE user_id=?',uid)||{},content=CONTENTS.find(c=>c.id===row.content);
 const included=plan.mbps>=INCLUDED,gamingFree=plan.mbps>=GAMING_FREE;
 return {plan:{mbps:plan.mbps,price:plan.price},included,includedFrom:INCLUDED,
  content:included&&content?{...content,since:row.since,giftUntil:row.gift_until,canSwitch:now-row.since>=SWITCH,switchAt:row.since+SWITCH}:null,
  contents:CONTENTS,
  gaming:{on:gamingFree||!!row.gaming,free:gamingFree,price:GAMING_PRICE,min:GAMING_MIN,freeFrom:GAMING_FREE,allowed:plan.mbps>=GAMING_MIN,since:row.gaming_since||null}};
}

function act(s,uid,d,now=Date.now()){return s.transaction(()=>{
 insist(d&&typeof d.action==='string','Action manquante.');
 const st=state(s,uid,now);
 if(d.action==='content'){
  insist(st.included,'Les contenus sont inclus à partir du forfait '+INCLUDED+' Mb/s.',409);
  const c=CONTENTS.find(x=>x.id===d.content);insist(c,'Choisissez un contenu.');
  insist(st.content?.id!==c.id,'C’est déjà votre contenu inclus.',409);
  insist(!st.content||st.content.canSwitch,'Vous pourrez changer de contenu à partir du '+new Date(st.content?.switchAt).toLocaleDateString('fr-FR',{day:'numeric',month:'long'})+'.',409);
  s.run('UPDATE fibreplus SET content=?,since=?,updated=? WHERE user_id=?',c.id,now,now,uid);
 }else if(d.action==='gaming'){
  insist(typeof d.on==='boolean'&&d.confirm===true,'Confirmez votre choix.');
  insist(!st.gaming.free,'Le pack jeux est déjà inclus dans votre forfait.',409);
  insist(!d.on||st.gaming.allowed,'Le pack jeux demande au moins '+GAMING_MIN+' Mb/s.',409);
  insist(st.gaming.on!==d.on,d.on?'Le pack jeux est déjà actif.':'Le pack jeux n’est pas actif.',409);
  s.run('INSERT INTO fibreplus(user_id,gaming,gaming_since,updated) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET gaming=excluded.gaming,gaming_since=excluded.gaming_since,updated=excluded.updated',uid,d.on?1:0,d.on?now:null,now);
  if(d.on)notify(s,uid,'Pack jeux en ligne activé','Votre console passe en priorité sur la box pour une latence réduite. '+GAMING_PRICE.toLocaleString('fr-FR')+' F seront ajoutés à votre prochaine facture.',now);
 }else insist(false,'Action inconnue.');
 return state(s,uid,now);
});}

// Équipe Moov : qui profite de quoi, et ce que rapporte le pack jeux chaque mois.
function summary(s,uid,now=Date.now()){
 O.requireOperator(s,uid);
 const staff=new Set([...s.all('SELECT user_id FROM operator_grants'),...s.all('SELECT user_id FROM noc_field_accounts')].map(r=>r.user_id));
 const clients=s.all('SELECT user_id,body FROM journey_state').filter(r=>!staff.has(r.user_id)).map(r=>{let p;try{p=JSON.parse(r.body).plan;}catch{}return {uid:r.user_id,mbps:p?.mbps||100};});
 const rows=new Map(s.all('SELECT * FROM fibreplus').map(r=>[r.user_id,r]));
 const eligible=clients.filter(c=>c.mbps>=INCLUDED),count=id=>eligible.filter(c=>rows.get(c.uid)?.content===id).length;
 const paying=clients.filter(c=>c.mbps<GAMING_FREE&&rows.get(c.uid)?.gaming).length,freeGaming=clients.filter(c=>c.mbps>=GAMING_FREE).length;
 return {clients:clients.length,eligible:eligible.length,contents:CONTENTS.map(c=>({id:c.id,name:c.name,count:count(c.id)})),
  gaming:paying+freeGaming,gamingPaying:paying,revenue:paying*GAMING_PRICE,
  upsell:clients.filter(c=>c.mbps>=200&&c.mbps<INCLUDED).length};
}
module.exports={migrate,sync,state,act,summary,CONTENTS,INCLUDED,GAMING_PRICE};
