const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8765/molecule-visualizer/');await page.waitForSelector('canvas');
  const result=await page.evaluate(async()=>{
   const M=MoleculeVisualizer,app=M.App,r=app.renderer();
   const s=M.Model.createState({atoms:Array.from({length:1000},(_,i)=>({id:'a'+(i+1),element:'C',x:i%20,y:Math.floor(i/20)%20,z:Math.floor(i/400)}))});
   app.setState(s,false);
   const before=JSON.stringify(app.getState().atoms),draw=r.draw.bind(r);let count=0;
   r.draw=()=>{count++;draw();};
   for(let i=0;i<80;i++){r.rollCamera(.001);r.requestDraw();}
   const queued=count;await new Promise(requestAnimationFrame);
   const rendered=count,after=JSON.stringify(app.getState().atoms),p=r.projectedAtoms[0],hit=r.pickAtom(p.x,p.y);
   r.draw=draw;
   return {queued,rendered,unchanged:before===after,hit:!!hit,n:r.projectedAtoms.length};
  });
  assert.deepEqual(result,{queued:0,rendered:1,unchanged:true,hit:true,n:1000});
  const cache=await page.evaluate(()=>{
    const M=MoleculeVisualizer,r=M.App.renderer(),s=M.App.getState(),start=r.projectionBuilds;
    s.selectedAtomIds=new Set([s.atoms[0].id]);r.updateSelection(s);
    const reused=r.projectionBuilds===start,old=r.projectedAtoms[0].x;
    s.atoms[0].x+=.1;r.renderState(s,true);
    return {reused,moved:r.projectedAtoms[0].x!==old,sprites:r.atomSprites?.size||0};
  });assert.equal(cache.reused,true);assert.equal(cache.moved,true);assert.ok(cache.sprites>0&&cache.sprites<=64);
  const rows=await page.evaluate(()=>{
   const body=document.querySelector('#atomTable tbody'),first=body.firstElementChild,checkbox=first.querySelector('input');
   const observer=new MutationObserver(()=>{});observer.observe(body,{childList:true,subtree:true});
   document.getElementById('btnSelectAll').click();document.getElementById('btnClearSel').click();
   const created=observer.takeRecords().reduce((n,r)=>n+r.addedNodes.length,0);observer.disconnect();
   return {same:first===body.firstElementChild,checkbox:checkbox===body.firstElementChild.querySelector('input'),created,count:body.children.length};
  });assert.deepEqual(rows,{same:true,checkbox:true,created:0,count:1000});
  const polling=await page.evaluate(async()=>{
   const M=MoleculeVisualizer,request=M.EngineUI.request,calls=[];
   M.EngineUI.request=async(c,path)=>{calls.push(path);return {status:'running',preview:{images:[]},previewVersion:2};};
   try{
    const j={id:'a'.repeat(32),connection:{info:{compactPolling:1}}};
    await M.EngineUI.pollJob(j,true);await M.EngineUI.pollJob(j,true);await M.EngineUI.pollJob(j,false);await M.EngineUI.pollJob(j,true);
    const old={id:j.id,connection:{info:{}}};await M.EngineUI.pollJob(old,true);
    return calls;
   }finally{M.EngineUI.request=request;}
  });
  assert.match(polling[0],/preview=1&after=0&compact=1$/);
  assert.match(polling[1],/preview=1&after=0&since=2&compact=1$/);
  assert.match(polling[2],/\?compact=1$/);
  assert.doesNotMatch(polling[3],/since=/);
  assert.match(polling[4],/preview=1&after=0$/);assert.doesNotMatch(polling[4],/compact=/);
  await page.screenshot({path:'test-artifacts/performance-browser.png'});
  assert.deepEqual(errors,[]);
  console.log('Performance browser checks passed: coalescing, picking, coordinates, stable table rows, compact polling and legacy fallback.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
