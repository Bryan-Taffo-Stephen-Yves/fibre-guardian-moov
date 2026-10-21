'use strict';
// Les sons du téléphone : la ligne qui sonne (440 Hz, 1,5 s toutes les 5 s), les touches (DTMF) et le silence quand on coupe le son.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function load(){
 const played=[],timers=[];
 class Node{connect(){}}
 class Osc extends Node{constructor(){super();this.frequency={value:0};}start(at){played.push({hz:this.frequency.value,at});}stop(){}}
 class Gain extends Node{constructor(){super();this.gain={setValueAtTime(){},linearRampToValueAtTime(){}};}}
 class Ctx{constructor(){this.state='suspended';this.currentTime=0;this.destination={};}resume(){this.state='running';return Promise.resolve();}createOscillator(){return new Osc();}createGain(){return new Gain();}}
 const window={AudioContext:Ctx};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'sonnerie.js'),'utf8'),{window,setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:id=>{if(timers[id-1])timers[id-1].fn=null;}});
 return {S:window.FGSonnerie,played,timers};
}
test('La ligne sonne « tuut… tuut » jusqu’à ce qu’on décroche',()=>{
 const {S,played,timers}=load();assert.equal(S.unlock(),true);
 const rings=[];const stop=S.ringback({onRing:n=>rings.push(n)});
 assert.deepEqual(played.map(p=>p.hz),[440]);assert.equal(timers.at(-1).ms,5000,'Une sonnerie toutes les 5 secondes');
 timers.at(-1).fn();assert.deepEqual(rings,[1,2]);assert.equal(played.length,2);
 stop();assert.equal(timers.at(-1).fn,null,'Plus de sonnerie après avoir décroché');
});
test('Chaque touche joue ses deux notes, et rien quand le son est coupé',()=>{
 const {S,played}=load();S.key('5');assert.deepEqual(played.map(p=>p.hz),[770,1336]);
 S.key('x');assert.equal(played.length,2,'Touche inconnue : aucun son');
 S.mute(true);S.key('1');S.ringback()();S.end();assert.equal(played.length,2);assert.equal(S.isMuted(),true);
 S.mute(false);S.end();assert.deepEqual(played.slice(2).map(p=>p.hz),[425,425,425],'Trois bips de fin d’appel');
});
test('Sans son dans le navigateur, le téléphone marche quand même',()=>{
 const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'sonnerie.js'),'utf8'),{window,setTimeout,clearTimeout});
 assert.equal(window.FGSonnerie.unlock(),false);window.FGSonnerie.key('1');const stop=window.FGSonnerie.ringback();stop();window.FGSonnerie.end();
});
