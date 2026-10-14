const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path'),{pathToFileURL}=require('node:url');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],remote=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});await context.route(/^https?:/,r=>r.abort());
 await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href);
 await page.getByRole('button',{name:'Ne pas faire la visite'}).click();
 await page.locator('.sidebar').getByRole('button',{name:'Ma maison',exact:true}).click();
 await page.getByRole('heading',{name:'Comprendre. Partager. Garder la main.'}).waitFor();
 assert.equal(await page.locator('.hh-device').count(),5);
 await page.getByRole('button',{name:'Mettre le foyer en pause',exact:true}).click();
 const volume=page.getByTestId('volume-console'),day=await volume.innerText();await page.getByLabel('Période de consommation').selectOption('month');assert.notEqual(await volume.innerText(),day);await page.getByLabel('Période de consommation').selectOption('day');
 const consoleCard=page.locator('[data-device="console"]');
 assert.equal(await page.locator('[data-device="owner"]').getByRole('button',{name:'Bloquer',exact:true}).isDisabled(),true);
 await consoleCard.getByRole('button',{name:'Bloquer',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Annuler'}).click();assert.equal(await consoleCard.locator('.hh-state').innerText(),'Connecté');
 await consoleCard.getByRole('button',{name:'Suspendre',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirmer la simulation'}).click();assert.equal(await page.getByTestId('house-connected').innerText(),'4 / 5');assert.equal(await volume.innerText(),day);await consoleCard.getByRole('button',{name:'Reconnecter'}).click();
 await consoleCard.getByRole('button',{name:'Bloquer',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirmer la simulation'}).click();assert.equal(await consoleCard.locator('.hh-state').innerText(),'Bloqué');await consoleCard.getByRole('button',{name:'Débloquer'}).click();
 await page.getByLabel('Accès au foyer (démo)').selectOption('visitor');assert.equal(await consoleCard.getByRole('button',{name:'Bloquer',exact:true}).isDisabled(),true);assert.equal(await page.getByLabel('Limite de PlayStation 5 de Koffi').isDisabled(),true);await page.getByLabel('Accès au foyer (démo)').selectOption('owner');
 await page.getByRole('button',{name:'Essayer l’emplacement conseillé'}).click();assert.notEqual(await page.getByLabel('Emplacement de la box',{exact:true}).inputValue(),'salon');await page.getByLabel('Emplacement de la box',{exact:true}).selectOption('salon');
 await page.getByRole('button',{name:'Gros téléchargement',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Mettre le foyer en pause',exact:true}).count(),1);await page.locator('.hh-alert').waitFor({timeout:16000});
 await page.getByLabel('Limite de PlayStation 5 de Koffi').selectOption('10');await page.waitForFunction(()=>Number(document.querySelector('[data-device="console"] progress').value)<=10);await page.getByRole('button',{name:'Mettre le foyer en pause',exact:true}).click();
 await page.locator('.sidebar').getByRole('button',{name:'Vue d’ensemble',exact:true}).click();await page.locator('.sidebar').getByRole('button',{name:'Ma maison',exact:true}).click();assert.equal(await page.getByLabel('Limite de PlayStation 5 de Koffi').inputValue(),'10');
 for(const width of [1440,390,360]){await page.setViewportSize({width,height:width===1440?1050:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.resolve(__dirname,'../../verification',`household-${width}.png`),fullPage:true});}
 await page.setViewportSize({width:1440,height:1050});await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('.fg-scene__stage canvas').waitFor();assert.equal(await page.locator('canvas').count(),1);await page.screenshot({path:path.resolve(__dirname,'../../verification','household-3d.png'),fullPage:true});
 await page.getByRole('button',{name:'Vos données & les limites'}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Télécharger mon rapport'}).click();
 const report=JSON.parse(require('node:fs').readFileSync(await (await download).path(),'utf8'));assert.equal(report.simulation,true);assert.equal(report.foyer.devices.length,5);assert.equal(report.foyer.devices.find(d=>d.id==='console').limit,10);
 await page.getByRole('button',{name:'Effacer mes données de session'}).click();await page.getByRole('button',{name:'Effacer la session',exact:true}).click();
 await page.locator('.sidebar').getByRole('button',{name:'Ma maison',exact:true}).click();assert.match(await page.getByTestId('volume-console').innerText(),/^0 Mo/);assert.equal(await page.locator('.hh-alert').count(),0);assert.equal(await page.locator('.hh-log li').count(),0);assert.equal(await page.getByRole('button',{name:'Reprendre le foyer',exact:true}).count(),1);
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);console.log('Household UI passed: confirmations, permissions, volumes, alert, rate limit, persistence, mobile, 3D, offline, export and erasure.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
