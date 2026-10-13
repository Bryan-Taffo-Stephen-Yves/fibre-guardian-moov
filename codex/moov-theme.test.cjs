'use strict';
// Charte Moov Africa : toutes les couleurs viennent de moov-theme.css, et les couples principaux restent lisibles (WCAG AA).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const theme=fs.readFileSync(path.join(__dirname,'moov-theme.css'),'utf8');
const value=name=>{const m=theme.match(new RegExp('--'+name+':(#[0-9a-f]{6}|var\\(--([\\w-]+)\\))'));assert.ok(m,'variable --'+name+' absente');return m[2]?value(m[2]):m[1];};
const lum=hex=>hex.match(/\w\w/g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
const ratio=(a,b)=>{const [x,y]=[lum(value(a)),lum(value(b))].sort((p,q)=>q-p);return (x+.05)/(y+.05);};

test('Bleu et orange Moov retenus pour la charte',()=>{
 assert.equal(value('moov-primary'),'#005ca8');assert.equal(value('moov-accent'),'#f28e39');
});

test('Aucune couleur écrite en dur hors de moov-theme.css',()=>{
 const skip=new Set(['moov-theme.css','theme.js','sw.js']);
 const files=fs.readdirSync(__dirname).filter(f=>/\.(css|js)$/.test(f)&&!skip.has(f));
 const found=[];
 for(const f of files){const s=fs.readFileSync(path.join(__dirname,f),'utf8');
  for(const m of s.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsla?\(\s*\d/g)){const before=s.slice(Math.max(0,m.index-12),m.index);if(/&$|href=['"]?$|url\(['"]?$/.test(before))continue;found.push(f+' : '+s.slice(m.index,m.index+12));}}
 assert.deepEqual(found,[],'couleurs à remplacer par une variable --moov-*');
});

test('Contrastes AA des couples principaux',()=>{
 for(const [fg,bg] of [['moov-on-primary','moov-primary'],['moov-on-primary','moov-primary-hover'],['moov-ink','moov-page'],['moov-text-muted','moov-surface'],['moov-text-muted','moov-page'],['moov-neutral-500','moov-page'],['moov-neutral-500','moov-neutral-150'],['moov-ink','moov-primary-100'],['moov-accent-text','moov-surface'],['moov-accent','moov-primary-900'],['moov-primary-100','moov-primary-900'],['moov-danger','moov-surface'],['moov-success-700','moov-success-100']])
  assert.ok(ratio(fg,bg)>=4.5,fg+' sur '+bg+' : '+ratio(fg,bg).toFixed(2)+':1');
});
