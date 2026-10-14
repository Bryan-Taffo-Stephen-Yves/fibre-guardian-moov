// Run Edge suites sequentially to avoid WebGL/browser resource contention.
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../../verification/buttons');fs.mkdirSync(out,{recursive:true});
const suites=['buttons-check','line-actions-check','browser-check','journeys-check','household-check','analytics-check','scenario-repro','scenario-check','incidents-check','audit-regression-check','extra-flows-check'];
const requested=process.argv.slice(2);if(requested.some(n=>!suites.includes(n)))throw Error('Unknown suite');
const summary=path.join(out,'suite-results.json');
const results=requested.length&&fs.existsSync(summary)?JSON.parse(fs.readFileSync(summary,'utf8')):[];
for(const name of requested.length?requested:suites){
 console.log('START '+name);const start=Date.now(),r=spawnSync(process.execPath,[path.join(__dirname,name+'.cjs')],{encoding:'utf8',timeout:180000,windowsHide:true});
 console.log(r.stdout||'');if(r.stderr)console.error(r.stderr);const entry={suite:name,status:r.status===0?'PASS':'FAIL',durationMs:Date.now()-start,error:r.error?.message||null};const index=results.findIndex(r=>r.suite===name);if(index<0)results.push(entry);else results[index]=entry;console.log(JSON.stringify(entry));fs.writeFileSync(path.join(out,name+'.log'),(r.stdout||'')+(r.stderr||''));
}fs.writeFileSync(path.join(out,'suite-results.json'),JSON.stringify(results,null,2));if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
