/* Optional developer QA: requires Playwright + Edge; not loaded by the application. */
const {chromium}=require('playwright');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
(async()=>{
  const out=path.resolve(__dirname,'../../verification');fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[],remote=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});
  await context.route(/^https?:/,route=>route.abort());
  await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href);
  await page.getByRole('heading',{level:1}).waitFor();
  await page.getByRole('button',{name:'Ne pas faire la visite'}).click();
  await page.screenshot({path:path.join(out,'home-desktop.png'),fullPage:true});
  const screens=[['Diagnostic','diagnostic'],['Wi-Fi maison','wifi'],['Assistant','assistant'],['Supervision','supervision'],['Relation client','retention'],['Impact Moov','economics'],['Les 4 histoires','stories'],['Aide','help']];
  const overflow=[];
  for(const width of [1440,390,360]){
    await page.setViewportSize({width,height:width===1440?1050:844});
    for(const [name,id] of [['Vue d’ensemble','home'],...screens]){
      await page.locator('.sidebar').getByRole('button',{name,exact:true}).click();
      await page.getByRole('heading',{level:1}).waitFor();
      const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
      if(size.scroll>size.width+1)overflow.push({id,...size});
      if(width!==360)await page.screenshot({path:path.join(out,`${id}-${width}.png`),fullPage:true});
    }
    await page.getByRole('button',{name:'Vos données & les limites'}).click();
    const dataSize=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
    if(dataSize.scroll>dataSize.width+1)overflow.push({id:'data',...dataSize});
    if(width!==360)await page.screenshot({path:path.join(out,`data-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1050});
  await page.emulateMedia({reducedMotion:'no-preference'});
  for(const [name,id] of [['Vue d’ensemble','home'],['Diagnostic','diagnostic'],['Wi-Fi maison','wifi'],['Supervision','supervision']]){
    await page.locator('.sidebar').getByRole('button',{name,exact:true}).click();
    await page.locator('.fg-scene__stage canvas').waitFor({timeout:10000});
    assert.equal(await page.locator('.fg-scene__stage canvas').count(),1,'Exactly one active 3D canvas');
    await page.screenshot({path:path.join(out,`${id}-3d.png`),fullPage:true});
  }
  console.log(JSON.stringify({errors,remote,overflow,screenshots:out},null,2));
  assert.deepEqual(errors,[],'Browser runtime errors');assert.deepEqual(remote,[],'Remote request from offline UI');assert.deepEqual(overflow,[],'Horizontal page overflow');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
