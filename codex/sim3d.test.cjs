'use strict';
// Simulateur de pannes : maquette 3D d'Abidjan, un poteau par quartier, panne choisie et rétablissement.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const S=require('./sim3d.js'),A=require('./abidjan-map.js'),N=require('./noc-store.cjs'),O=require('./operator-store.cjs'),{createGuardianServer}=require('./pilot-server.cjs');

test('Onze poteaux, chacun nommé et posé dans sa commune',()=>{
 const ids=Object.keys(A.SEGMENTS);
 assert.equal(ids.length,11);
 for(const id of ids){
  assert.ok(S.NAMES[id],'nom affiché pour '+id);
  const c=A.COMMUNES.find(v=>v.id===A.SEGMENTS[id].commune);
  assert.ok(c&&S.inside(A.SEGMENTS[id].at,c.shape),id+' dans '+A.SEGMENTS[id].commune);
 }
});

test('Les bâtiments sont stables d’un affichage à l’autre et ne cachent aucun poteau',()=>{
 const a=S.buildings(),b=S.buildings();
 assert.ok(a.length>200,'une vraie ville');assert.deepEqual(a,b);
 for(const k of a)for(const s of Object.values(A.SEGMENTS)){const p=A.project(s.at);assert.ok(Math.hypot(k.p[0]-p[0],k.p[1]-p[1])>=16);}
 assert.ok(a.some(k=>k.segment==='ABO-01'),'les immeubles d’Abobo s’éteignent avec son poteau');
});

test('Relief : un toit et au plus deux murs visibles, quelle que soit l’orientation',()=>{
 const k=S.buildings()[0];
 for(const r of [-90,-18,0,45,180]){const f=S.faces(S.view(r),k);assert.ok(f.roof.startsWith('M'));assert.ok(f.walls.length>=1&&f.walls.length<=2);}
});

test('Cadrage : tous les poteaux tiennent dans la vue de départ, sur ordinateur et sur téléphone',()=>{
 for(const [ratio,zoom] of [[1.62,1.1],[1.2,1.3]]){
  const v=S.view(-18),[x,y,w,hh]=S.frame(-18,zoom,[0,0],ratio);
  for(const s of Object.values(A.SEGMENTS)){const [px,py]=v.at(A.project(s.at));assert.ok(px>x&&px<x+w&&py>y&&py<y+hh,'poteau visible');}
 }
});

test('Bulles rangées sans se chevaucher, toujours dans le cadre',()=>{
 const v=S.view(-18),vb=S.frame(-18,1.1,[0,0],1.62);
 const out=S.place(Object.keys(A.SEGMENTS).map(id=>({id,a:v.at(A.project(A.SEGMENTS[id].at),30),name:'Poteau '+S.NAMES[id]})),vb,1080,false);
 const k=1080/vb[2],box=o=>{const w=(7.4*o.name.length+36)/k,hh=32/k;return [o.at[0]-w/2,o.at[1]-hh,o.at[0]+w/2,o.at[1]];};
 const all=Object.values(out).map(box);
 for(const b of all)assert.ok(b[0]>=vb[0]&&b[2]<=vb[0]+vb[2],'bulle dans le cadre');
 let overlaps=0;for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){const a=all[i],b=all[j];if(a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1])overlaps++;}
 assert.equal(overlaps,0);
});

test('État du poteau : calme, panne, débit en baisse, réparé',()=>{
 const seg={id:'YOP-07',online:20,total:20};
 assert.equal(S.stateOf(seg,[]).tone,'calm');
 assert.equal(S.stateOf({...seg,online:10},[]).tone,'down');
 assert.equal(S.stateOf(seg,[{segment_id:'YOP-07',status:'proposed',terminal:false,plan:{cause:'UPLINK_CONGESTION'}}]).tone,'warn');
 assert.equal(S.stateOf(seg,[{segment_id:'YOP-07',status:'resolved',terminal:true,updated:Date.now()}]).tone,'ok');
 assert.deepEqual(S.FAULTS.map(f=>f.id),['pole','fiber','power','congestion']);
});

test('La panne choisie sur un poteau est retenue, et le rétablissement remet le quartier en ligne',async()=>{
 const server=createGuardianServer({db:':memory:',onError:()=>{}}),s=server.guardianStore;
 try{
  const u=(await s.register({email:'chef@example.test',password:'chef-password-1234',name:'Chef'})).user;O.grant(s,'chef@example.test','admin');
  N.operate(s,u.id,{type:'simulate',segment:'ABO-01',scenario:'pole'});
  let o=N.overview(s,u.id),g=o.segments.find(v=>v.id==='ABO-01');
  assert.equal(g.scenario,'pole');assert.equal(g.online,10);
  assert.ok(o.incidents.some(i=>i.segment_id==='ABO-01'&&!i.terminal),'Guardian ouvre un dossier pour Abobo');
  assert.equal(o.segments.find(v=>v.id==='YOP-07').scenario,null,'les autres quartiers ne sont pas touchés');
  N.operate(s,u.id,{type:'simulate',segment:'ABO-01',scenario:'normal'});
  g=N.overview(s,u.id).segments.find(v=>v.id==='ABO-01');assert.equal(g.scenario,'normal');assert.equal(g.online,g.total);
  const client=(await s.register({email:'abonne@example.test',password:'abonne-password-1234',name:'Abonné'})).user;
  assert.throws(()=>N.operate(s,client.id,{type:'simulate',segment:'ABO-01',scenario:'pole'}),'un abonné ne peut pas créer de panne');
 }finally{server.close();}
});

test('Le simulateur est chargé dans le portail Moov et n’utilise que les couleurs de marque',()=>{
 const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
 assert.match(read('bootstrap.js'),/'sim3d\.js'/);
 assert.match(read('index.html'),/sim3d\.css/);
 assert.match(read('noc-view.js'),/\['simulator','Simulateur','cube'\]/);
 assert.doesNotMatch(read('sim3d.css'),/#[0-9a-f]{3,8}\b|rgba?\(/i);
 assert.doesNotMatch(read('sim3d.js'),/fictif|moteur à règles|pas de LLM/i);
});
