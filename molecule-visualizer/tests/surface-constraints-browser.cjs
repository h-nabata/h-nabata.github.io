// Native local job. POSCAR direction locks are in fractional coordinates, including for Cartesian input.
const { chromium }=require('playwright');
const { spawn }=require('node:child_process');
const { strict:assert }=require('node:assert');
const fs=require('node:fs/promises');
const path=require('node:path');
const {startupToken}=require('./native-bridge-test.cjs');
const {clickWorkspaceCommand,openCalculationPane,openDetails}=require('./workspace-commands.cjs');

const input=[
  'Periodic H2O, skew cell','1','12 0 0','3 12 0','.2 .3 13','O H','1 2',
  'Selective dynamics','Cartesian','4 4 4 F F F','4.7 4.8 4.1 F T T','3.5 4.78 3.87 T T T',''
].join('\n');

async function paint(page, indices) {
  await page.locator('#viewer canvas').scrollIntoViewIfNeeded();
  const bounds=await page.evaluate(indices=>{
    const renderer=MoleculeVisualizer.App.renderer(),rect=renderer.canvas.getBoundingClientRect();
    const points=renderer.projectedAtoms.filter(a=>indices.includes(a.index));
    const xs=points.map(p=>p.x+rect.x),ys=points.map(p=>p.y+rect.y);
    return [Math.min(...xs)-5,Math.min(...ys)-5,Math.max(...xs)+5,Math.max(...ys)+5];
  },indices);
  await page.mouse.move(bounds[0],bounds[1]);await page.mouse.down();
  await page.mouse.move(bounds[2],bounds[3],{steps:6});await page.mouse.up();
}

async function run(){
  const root=path.resolve(__dirname,'..'),port=Number(process.env.SURFACE_UI_PORT||8936);
  const service=spawn(process.env.PYTHON||'python',['-u',path.join(root,'local-engine/bridge.py'),
    '--engine','tblite','--port',String(port),'--site-dir',root,'--no-history'],
    {env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});
  let browser;
  try {
    const token=await startupToken(service);
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1300,height:980}});
    await page.goto('http://127.0.0.1:'+port);await page.waitForSelector('canvas');
    await page.locator('#fileInput').setInputFiles({name:'POSCAR',mimeType:'text/plain',buffer:Buffer.from(input)});
    await page.waitForFunction(()=>MoleculeVisualizer.App.getState().metadata.sourceFormat==='poscar');
    const fixed=()=>page.evaluate(()=>MoleculeVisualizer.Constraints.indices(MoleculeVisualizer.App.getState()));
    assert.deepEqual(await fixed(),[0]);
    await page.click('#toolFreeze');await paint(page,[1,3]);
    assert.deepEqual(await fixed(),[0,2]);
    await clickWorkspaceCommand(page,'#btnConstraints');
    await page.click('#constraintBoxRemove');await paint(page,[3]);
    assert.deepEqual(await fixed(),[0]);
    await page.click('#btnUndo');assert.deepEqual(await fixed(),[0,2]);
    await page.click('#btnRedo');assert.deepEqual(await fixed(),[0]);
    await page.click('#toolSelect');
    await page.click('#btnExternalEngine');await openCalculationPane(page,'connection');
    await page.fill('#engineURL','http://127.0.0.1:'+port);await page.fill('#engineToken',token);
    await page.click('#engineConnect');
    await page.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('接続済み'));
    await openCalculationPane(page,'setup');await page.selectOption('#engineMode','optimize');
    await openDetails(page,'#engineNumericOptions');await page.uncheck('#engineLive');
    await page.selectOption('#engineOptimizer','lbfgs');await page.fill('#engineSteps','3');await page.fill('#engineFmax','0.0001');
    const sent=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/api/jobs'));
    await page.click('#engineRun');
    const request=(await sent).postDataJSON();assert.deepEqual(request.fixedAtoms,[0]);
    assert.deepEqual(request.fixedComponents,[{atom:1,axes:[true,false,false],basis:'fractional'}]);
    await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy(),{},{timeout:60000});
    assert.equal(await page.locator('#engineResult').evaluate(x=>x.hidden),false,await page.locator('#engineMessage').textContent());
    await openCalculationPane(page,'results');
    const event=page.waitForEvent('download');await page.click('#engineDownload');
    const {result}=JSON.parse(await fs.readFile(await(await event).path(),'utf8'));
    const fractionA=p=>p[0]/12-p[1]/48+(.3/48-.2/12)*p[2]/13;
    for(const frame of result.trajectory.images){
      assert.deepEqual(frame[0],request.images[0][0]);
      assert.ok(Math.abs(fractionA(frame[1])-fractionA(request.images[0][1]))<1e-9);
    }
    assert.ok(Math.abs(result.images[0][1][0]-request.images[0][1][0])>1e-6);
    await page.click('#engineApply');assert.deepEqual(await fixed(),[0]);
    console.log('PASS rectangle add/remove/undo; native GFN2-xTB POSCAR FFF and skew fractional-a across '+result.trajectory.images.length+' frames.');
  }finally{service.kill();await browser?.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
