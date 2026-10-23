'use strict';
// Mode survie : le menu USSD *144# de Guardian, utilisable sans internet depuis n'importe quel téléphone.
// Même format qu'une passerelle USSD d'opérateur : chaque appel reçoit tout ce que le client a tapé
// depuis le début (« 1*2*1 ») et renvoie un écran qui continue (CON) ou qui termine la session (END).
// Brancher une vraie passerelle ne demande que de relier son numéro d'appelant au compte client.
const {insist}=require('./pilot-model.cjs');
const journey=require('./journey-store.cjs'),noc=require('./noc-store.cjs');

const CODE='*144#';
const MAX=182; // Un écran USSD ne dépasse pas 182 caractères.
const KINDS={1:['outage','Plus d’internet du tout'],2:['slow','Internet très lent'],3:['pole','Câble ou poteau tombé']};
const STATUS={reported:'Signalement reçu',proposed:'En analyse chez Moov',approved:'Intervention validée',rejected:'En cours de réexamen',dispatched:'Technicien affecté',en_route:'Technicien en route',on_site:'Technicien sur place',verifying:'Contrôle de la ligne',resolved:'Connexion rétablie',closed:'Dossier clôturé'};
const MENU='Moov Fibre Guardian\n1. Signaler une panne\n2. Suivre mon dossier\n3. Mon technicien\n4. Panne dans mon quartier ?\n5. Recevoir le suivi par SMS\n0. Quitter';

const con=message=>({end:false,message});
const end=(message,sms=null)=>({end:true,message,...(sms?{sms}:{})});
const minutes=s=>Math.max(1,Math.ceil(s/60));

// « 1*0*2 » : le 0 d'un sous-menu revient en arrière, comme sur les menus Moov Money.
function path(text){
 insist(typeof text==='string'&&text.length<=40&&/^[0-9*#]*$/.test(text),'Saisie USSD invalide.');
 const steps=[];for(const t of text.split('*').filter(Boolean)){if(t==='0'&&steps.length)steps.pop();else steps.push(t);}return steps;
}
// Le dossier du client : d'abord le sien, sinon une panne déjà connue sur son quartier.
function situation(s,uid){
 const st=journey.get(s,uid),mine=st?journey.active(st):null,list=noc.client(s,uid).incidents;
 const live=mine&&list.find(i=>i.id===mine.id);
 const shared=list.find(i=>noc.isOpen(i)&&i.mode==='demo'&&(!mine||i.id!==mine.id));
 return {st,mine,live,shared};
}
// Le SMS reprend le même dossier que l'application : numéro, état et prochaine étape.
function trackSms(s,uid,i){
 if(i?.status==='en_route'){const link=noc.trackLink(s,uid,{id:i.id});return {from:'Moov',text:'Moov Fibre : dossier '+i.ref+'. '+i.technician.name+' arrive. Suivez-le en direct : ',link:link.url};}
 return {from:'Moov',text:'Moov Fibre : dossier '+i.ref+' · '+(STATUS[i.status]||'Signalement reçu')+'. Suite : '+i.next+' Infos : '+CODE};
}

function respond(s,uid,{text=''}={}){
 s.rate('ussd:'+uid,120,600000);
 const steps=path(text),[first,...rest]=steps;
 const r=screen(s,uid,first,rest);
 insist(r.message.length<=MAX,'Écran USSD trop long.',500);
 return {...r,code:CODE};
}
function screen(s,uid,first,rest){
 if(!first)return con(MENU);
 if(first==='0')return end('Merci. Guardian reste joignable au '+CODE+', même sans internet.');
 const {st,mine,live,shared}=situation(s,uid),ref=live?.ref||(mine?noc.ref(mine.id):null);
 if(first==='1'){
  if(mine)return end('Vous avez déjà le dossier '+ref+' : '+(STATUS[live?.status]||'Signalement reçu')+'.\nTapez 2 dans le menu pour le suivre.');
  if(shared)return end('Moov connaît déjà cette panne : dossier '+shared.ref+'.\n'+shared.next+'\nInutile de signaler : vous serez prévenu par SMS.');
  const [kind,confirm]=rest;
  if(!kind)return con('Quel est le problème ?\n1. Plus d’internet du tout\n2. Internet très lent\n3. Câble ou poteau tombé\n0. Retour');
  if(!KINDS[kind])return end('Choix inconnu. Recomposez le '+CODE+'.');
  const home=noc.memberZone(s,uid)?.zone||st?.zone||'Yopougon · Niangon',zone=home.split(' · ').pop();
  if(!confirm)return con('Signaler « '+KINDS[kind][1]+' » pour votre ligne à '+zone+' ?\n1. Oui, envoyer\n2. Non');
  if(confirm!=='1')return end('Rien n’a été envoyé. Recomposez le '+CODE+' si besoin.');
  const incident=journey.reportByCode(s,uid,{kind:KINDS[kind][0],description:KINDS[kind][1]+' · signalé par le '+CODE+' (sans internet)',zone:home});
  const n=noc.ref(incident.id);
  return end('Signalement reçu : dossier '+n+'.\nL’équipe Moov l’analyse. Un SMS vous prévient à chaque étape.',{from:'Moov',text:'Moov Fibre : dossier '+n+' reçu, le même que dans l’application. Suivez-le au '+CODE+', même sans internet.'});
 }
 if(first==='2'){
  if(!mine)return end(shared?'Panne du quartier : dossier '+shared.ref+'\nÉtat : '+(STATUS[shared.status]||'en cours')+'.\nSuite : '+shared.next:'Aucun dossier ouvert. Tapez 1 dans le menu pour signaler une panne.');
  const tech=live?.position?.eta!=null?'\nArrivée dans '+minutes(live.position.eta)+' min environ.':'';
  return end('Dossier '+ref+'\nÉtat : '+(STATUS[live?.status]||'Signalement reçu')+'.'+(live?'\nSuite : '+live.next:'')+tech);
 }
 if(first==='3'){
  const i=live||shared;
  if(!i)return end('Aucune intervention en cours sur votre ligne.');
  if(!i.technician)return end('Pas encore de technicien : Moov analyse la panne. Vous serez prévenu dès qu’il part.');
  const t=i.technician;
  if(i.status==='en_route')return end(t.name+' est en route.\nArrivée dans '+minutes(i.position?.eta||120)+' min environ.\nTél : '+t.phone);
  if(i.status==='on_site')return end(t.name+' est chez vous, au travail.\nTél : '+t.phone);
  return end(t.name+' ('+t.team+') s’occupe de votre panne.\nÉtat : '+(STATUS[i.status]||'en cours')+'.');
 }
 if(first==='4'){
  if(shared){const a=shared.area;return end('Oui : panne en cours dans votre quartier'+(a?' ('+(a.total-a.online)+' box sur '+a.total+' touchées)':'')+'.\nDossier '+shared.ref+' : '+(STATUS[shared.status]||'Moov s’en occupe')+'.');}
  if(mine)return end('Pas de panne générale. Votre dossier '+ref+' est suivi.');
  return end('Aucune panne connue dans votre quartier.\nSi vous n’avez plus internet, tapez 1 pour signaler.');
 }
 if(first==='5'){
  const i=live||shared;
  if(!i)return end('Aucun dossier à suivre. Tapez 1 dans le menu pour signaler une panne.');
  return end('C’est envoyé. Vous allez recevoir un SMS de Moov.',trackSms(s,uid,i));
 }
 return end('Choix inconnu. Recomposez le '+CODE+'.');
}
module.exports={CODE,MAX,MENU,respond,path};
