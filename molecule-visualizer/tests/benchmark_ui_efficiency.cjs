// CI comparison against the public pre-change baseline. Timing is reported, not a flaky pass threshold.
'use strict';
const {chromium}=require('playwright'),{execFileSync}=require('node:child_process'),fs=require('node:fs'),assert=require('node:assert/strict');
const revision='f70b9b8ca1f1ba7f88eac09a7fcd3a5ed862a87c';
(async()=>{
 const old={};for(const file of ['model','ui','measurements','structure-analysis-ui'])old[file+'.js']=execFileSync('git',['show',revision+':molecule-visualizer/'+file+'.js'],{encoding:'utf8'});
 const browser=await chromium.launch({headless:true});
 try{
  const rows=[];
  for(const label of ['before','after']){
   const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   if(label==='before')await page.route('**/*.js*',route=>{const name=new URL(route.request().url()).pathname.split('/').pop();return old[name]?route.fulfill({body:old[name],contentType:'application/javascript'}):route.continue();});
   await page.goto('http://127.0.0.1:8765/molecule-visualizer/');await page.waitForSelector('canvas');
   const result=await page.evaluate(async()=>{
    const M=MoleculeVisualizer,atoms=Array.from({length:1000},(_,i)=>({id:'a'+i,element:i%3?'C':'H',x:i%20*1.4,y:Math.floor(i/20)%20*1.4,z:Math.floor(i/400)*1.4}));
    const bonds=atoms.slice(1).map((a,i)=>({id:'b'+i,atom1:atoms[i].id,atom2:a.id,order:1,source:'manual'}));
    M.App.setState(M.Model.createState({atoms,bonds}),false);
    document.querySelector('.mv-atom-list').open=true;
    const before=JSON.stringify(M.App.getState().atoms),times=[],allocated=[];
    const observer=new MutationObserver(()=>{}),body=document.querySelector('#atomTable tbody');observer.observe(body,{childList:true,subtree:true});
    for(let i=0;i<40;i++){
     await new Promise(requestAnimationFrame);observer.takeRecords();
     const start=performance.now();document.getElementById(i%2?'btnClearSel':'btnSelectAll').click();
     // Force table layout so both variants include the cost of their DOM writes.
     body.getBoundingClientRect();const elapsed=performance.now()-start;
     const created=observer.takeRecords().reduce((n,r)=>n+r.addedNodes.length,0);
     if(i>=10){times.push(elapsed);allocated.push(created);}
    }
    observer.disconnect();times.sort((a,b)=>a-b);
    return {atoms:atoms.length,bonds:bonds.length,medianSelectionMS:times[Math.floor(times.length/2)],medianInsertedTableNodes:allocated.sort((a,b)=>a-b)[15],unchanged:before===JSON.stringify(M.App.getState().atoms)};
   });
   assert.equal(result.unchanged,true);assert.deepEqual(errors,[]);rows.push({label,...result});
   if(label==='after'){assert.equal(result.medianInsertedTableNodes,0);await page.screenshot({path:'test-artifacts/efficiency-browser.png'});}
   await context.close();
  }
  fs.writeFileSync('test-artifacts/efficiency-browser-benchmark.json',JSON.stringify({baseline:revision,rows},null,2));console.log(JSON.stringify(rows));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
