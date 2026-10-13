'use strict';
// Audit réel du navigateur, avec comptes fictifs et base jetable : aucune donnée du pilote touchée.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createGuardianServer } = require('./pilot-server.cjs');
const operator = require('./operator-store.cjs');
const out = path.resolve(__dirname, '../../verification/responsive');
const phase = process.argv.includes('--before') ? 'before' : 'after';
fs.mkdirSync(out, { recursive: true });
const sizes = [[320,568],[390,844],[600,800],[601,600],[768,700],[820,600],[850,600],[851,600],[1024,768],[1440,900],[1920,1080],[844,390]];
const routes = ['Vue d’ensemble','Diagnostic','Ma maison','Incidents','Wi-Fi maison','Assistant','Supervision','Relation client','Impact Moov','Les 4 histoires','Aide','Mon espace réel','Espace administrateur'];
const results = [], errors = [];
async function inspect(page, name) {
  for (const [width, height] of sizes) {
    await page.setViewportSize({width,height});
    await page.evaluate(() => window.scrollTo(0,0));
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const issues = await page.evaluate(() => {
      const issues = [];
      if (document.documentElement.scrollWidth > innerWidth + 2) issues.push({kind:'page',width:document.documentElement.scrollWidth});
      for (const el of document.querySelectorAll('main *, [role=dialog] *, .sidebar, .sidebar *')) {
        if (!(el instanceof HTMLElement) || !el.getClientRects().length) continue;
        const s = getComputedStyle(el), r = el.getBoundingClientRect();
        if (!r.width || !r.height || s.position === 'absolute' || s.position === 'fixed') continue;
        if (el.closest('[aria-hidden="true"],.sv-sr-only') || el.matches('input,select,textarea,canvas')) continue;
        // Les tableaux et menus à défilement sont intentionnels ; leur contenu doit y rester.
        if (el.scrollWidth > el.clientWidth + 3 && s.overflowX === 'visible') issues.push({kind:'content',tag:el.tagName,cls:el.className,extra:el.scrollWidth-el.clientWidth,text:el.textContent.slice(0,70)});
      }
      const sidebar = document.querySelector('.sidebar'), nav = sidebar?.querySelector('nav'), bottom = sidebar?.querySelector('.sidebar-bottom');
      if (sidebar && innerWidth > 600 && (sidebar.getBoundingClientRect().height > innerHeight || bottom.getBoundingClientRect().bottom > innerHeight + 2)) issues.push({kind:'navigation',height:sidebar.getBoundingClientRect().height,bottom:bottom.getBoundingClientRect().bottom});
      if (nav && nav.scrollHeight > nav.clientHeight + 3 && getComputedStyle(nav).overflowY === 'visible') issues.push({kind:'nav-clipped'});
      for (const modal of document.querySelectorAll('[aria-modal=true]')) {const r=modal.getBoundingClientRect(); if(r.top < -2 || r.bottom > innerHeight+2) issues.push({kind:'dialog-clipped'});}
      if(innerWidth<=600) for(const field of document.querySelectorAll('main input:not([type=checkbox]):not([type=radio]):not([type=range]), main select, main textarea')) {
        if(field.getClientRects().length && parseFloat(getComputedStyle(field).fontSize)<16) issues.push({kind:'small-field',tag:field.tagName});
      }
      return issues;
    });
    results.push({name,width,height,issues});
    if (issues.length) console.log(name+' '+width+'x'+height+' '+JSON.stringify(issues));
    if (['Vue d’ensemble','Wi-Fi maison','Espace administrateur','Compte connecté','Client Mon plan','Client Tests réels','Tests réels renseignés','Réglages','Participant','Participant résultat'].includes(name) && [320,820,1440].includes(width)) {
      await page.screenshot({path:path.join(out,phase+'-'+name.replace(/[^\p{L}0-9]/gu,'-')+'-'+width+'.png'),fullPage:width===1440});
      const section = name==='Espace administrateur'?page.locator('.approvals'):name==='Client Mon plan'?page.locator('.pilot-room'):name==='Tests réels renseignés'?page.locator('.lab-devices'):null;
      if(section && await section.count()){await section.first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,phase+'-detail-'+name.replace(/[^\p{L}0-9]/gu,'-')+'-'+width+'.png')});}
    }
  }
}
(async()=>{
 const server=createGuardianServer({db:':memory:',onError:e=>errors.push(e.message)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/codex/?classic=1');await page.getByRole('button',{name:'Ne pas faire la visite'}).click();
  if(!process.argv.includes('--portals')) for(const name of routes){await page.locator('.sidebar').getByRole('button',{name,exact:true}).click();await inspect(page,name);}
  if(!process.argv.includes('--portals')) {
    await page.getByRole('button',{name:'Vos données & les limites',exact:true}).click();await inspect(page,'Mes données');
    await page.locator('.sidebar').getByRole('button',{name:'Mon espace réel',exact:true}).click();
    for(const label of ['Créer un compte','Récupérer mon compte']) {await page.getByRole('button',{name:label,exact:true}).click();await inspect(page,label);}
  }
  const email='layout-admin@example.test',password='Layout-test-only-123';
  let res=await page.request.post(base+'/api/auth/register',{data:{email,password,name:'Administrateur de démonstration'}});assert.equal(res.status(),200);
  operator.grant(server.guardianStore,email,'admin');
  res=await page.request.post(base+'/api/auth/login',{data:{email,password}});const user=(await res.json()).user;
  const headers={'x-csrf-token':user.csrf};
  res=await page.request.post(base+'/api/homes',{headers,data:{name:'Maison de démonstration avec un nom particulièrement long'}});assert.equal(res.status(),201);
  const home=await res.json();
  res=await page.request.post(base+'/api/homes/'+home.id+'/collector',{headers,data:{model:'Collecteur fictif du test de mise en page'}});assert.equal(res.status(),200);
  const collector=await res.json();
  res=await page.request.post(base+'/api/collector/ingest',{headers:{authorization:'Bearer '+collector.secret},data:{sequence:1,at:Date.now(),metrics:{downloadMbps:25,latencyMs:90,connected:1},devices:[{id:'layout-phone',name:'iPhone du foyer de démonstration',rx:987654321,tx:4567}]}});assert.equal(res.status(),200);
  res=await page.request.post(base+'/api/homes/'+home.id+'/labs',{headers,data:{name:'Session de test de mise en page'}});assert.equal(res.status(),200);
  const lab=await res.json();
  res=await page.request.post(base+'/api/homes/'+home.id+'/ticket',{headers,data:{subject:'Dossier-'+ 'abc'.repeat(25),detail:'Une description longue avec une référence sans espaces : '+ 'reference'.repeat(30)}});assert.equal(res.status(),200);
  const ticket=await res.json();
  res=await page.request.post(base+'/api/homes/'+home.id+'/ticket/share',{headers,data:{id:ticket.id,share:true,consent:true}});assert.equal(res.status(),200);
  for(const action of ['notify','dispatch','restart','change']){res=await page.request.post(base+'/api/operator/approvals',{headers,data:{action,adapter:'mock',justification:'Vérification responsive : '+ 'identifiant'.repeat(12)}});assert.equal(res.status(),201);}
  await page.reload();await page.locator('.sidebar').getByRole('button',{name:'Mon espace réel',exact:true}).click();await page.getByRole('navigation',{name:'Espace connecté'}).waitFor();
  await inspect(page,'Compte connecté');
  const tabs=await page.getByRole('navigation',{name:'Espace connecté'}).getByRole('button').allTextContents();
  for(const tab of tabs){await page.getByRole('navigation',{name:'Espace connecté'}).getByRole('button',{name:tab,exact:true}).click();await inspect(page,'Client '+tab);}
  await page.locator('.sidebar').getByRole('button',{name:'Espace administrateur',exact:true}).click();await page.getByRole('heading',{name:'Demandes clients'}).waitFor();
  await page.locator('.operator-ticket').first().click();await page.getByLabel('Réponse visible par le client').waitFor();
  await page.getByText('Modes, plages horaires et arrêt d’urgence',{exact:true}).click();
  await inspect(page,'Espace administrateur');
  await page.getByRole('button',{name:'Réglages',exact:true}).click();await inspect(page,'Réglages');
  await page.getByRole('button',{name:'C’est réglé',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);
  await page.goto(lab.url);await page.getByRole('heading',{name:'Votre appareil, votre test'}).waitFor();await inspect(page,'Participant');
  await page.getByLabel('Nom de votre appareil').fill('Téléphone de démonstration');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Rejoindre la session'}).click();
  await page.getByRole('button',{name:'Mesurer maintenant'}).click();await page.getByText('Résultat envoyé au propriétaire.',{exact:false}).waitFor();await inspect(page,'Participant résultat');
  await page.goto(base+'/codex/?classic=1');await page.locator('.sidebar').getByRole('button',{name:'Mon espace réel',exact:true}).click();
  await page.getByRole('navigation',{name:'Espace connecté'}).getByRole('button',{name:'Tests réels',exact:true}).click();await page.getByRole('heading',{name:'Téléphone de démonstration',exact:true}).waitFor();
  await inspect(page,'Tests réels renseignés');await page.getByRole('button',{name:'Voir l’historique',exact:true}).click();await page.getByRole('heading',{name:'Les relevés reçus',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
 } finally {
  await browser.close();await new Promise(r=>server.close(r));
  const report={phase,cases:results.length,failures:results.filter(r=>r.issues.length).length,errors,results};
  fs.writeFileSync(path.join(out,phase+'.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({phase,cases:report.cases,failures:report.failures,errors}));
  if(phase==='after'&&(report.failures||errors.length))process.exitCode=1;
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
