'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
test('Le technicien arrive sur « Mes missions » et passe par les actions vérifiées du serveur',()=>{
 const context={window:{},React:{createElement(){},useState(){},useEffect(){},useRef(){}}};vm.runInNewContext(read('tech-view.js'),context);
 assert.equal(typeof context.window.FGTech.App,'function');
 const view=read('tech-view.js');assert.match(view,/api\('\/noc\/workspace'\)/);assert.match(view,/'\/noc\/workspace\/action'/);
 for(const label of ['Je pars','Je suis arrivé','C’est réparé'])assert.ok(view.includes(label),label);
 const journey=read('journey.js');assert.match(journey,/user\.role==='technician'&&window\.FGTech&&!LAB/);
 const boot=read('bootstrap.js');assert.ok(boot.indexOf("'tech-view.js'")>0&&boot.indexOf("'tech-view.js'")<boot.indexOf("'journey.js'"));
});
