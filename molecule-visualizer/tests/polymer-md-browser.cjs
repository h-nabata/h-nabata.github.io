// Run the published polymer examples through native calculators and the browser's importer/player.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const {openCalculationPane, openDetails} = require('./workspace-commands.cjs');
const {startupToken} = require('./native-bridge-test.cjs');
const app = path.resolve(__dirname, '..');

function bondPairs(state) {
  const lookup = new Map(state.atoms.map((a,i)=>[a.id,i]));
  return state.bonds.map(b=>[lookup.get(b.atom1),lookup.get(b.atom2)].sort((a,b)=>a-b).join('-'))
    .sort();
}
// A primitive cell contains two carbons per strand. Each is bonded to the
// other atom in this cell AND its periodic copy; both contacts share an editor bond.
async function checkPrimitiveBackbone(page, name) {
  const lines=(await fs.readFile(path.join(app,'examples',name),'utf8')).trim().split('\n');
  const half=lines.slice(2).filter(line=>Number(line.split(/\s+/)[3])<2.534);
  const text=[half.length,lines[1].replace('5.068"', '2.534"'),...half].join('\n')+'\n';
  await page.locator('#fileInput').setInputFiles({name:'primitive-pe.xyz',mimeType:'text/plain',buffer:Buffer.from(text)});
  await page.waitForFunction(()=>MoleculeVisualizer.App.getState().atoms.length===12);
  const drawn=await page.evaluate(()=>{
    const m=MoleculeVisualizer, r=m.App.renderer(), state=m.App.getState();
    const [a,b]=[state.atoms[0].id,state.atoms[3].id];
    const bond=m.Model.findBondBetween(state,a,b);
    const segments=()=>r.projectedBonds.filter(p=>p.bond.id===bond.id).length;
    r.draw(); const inferred=segments();
    m.Model.addOrUpdateBond(state,a,b,2,'covalent','manual');r.draw();
    const manual=segments();
    state.selectedBondIds.add(bond.id);m.Model.removeSelectedBonds(state);
    m.Bonding.refreshInferredBonds(state);r.draw();
    return [inferred,manual,segments()];
  });
  assert.deepEqual(drawn,[3,3,0],'one intracell segment and one crossing at each end of the backbone');
}

async function download(page, button) {
  const waiting = page.waitForEvent('download');
  await page.click(button);
  return fs.readFile(await (await waiting).path(), 'utf8');
}
async function run(browser, periodic) {
  const engine = periodic ? 'tblite' : 'rdkit';
  const url = 'http://127.0.0.1:' + (periodic ? 8808 : 8807);
  const server = spawn(process.env.PYTHON||'python', ['-u',path.join(app,'local-engine/bridge.py'),
    '--engine',engine,'--port',new URL(url).port,'--site-dir',app,'--no-history'],
    {env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});
  let page;
  try {
    const token = await startupToken(server);
    page = await browser.newPage({viewport:{width:1200,height:840}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);
    const name = periodic ? 'polyethylene-periodic.xyz' : 'polyethylene-20.sdf';
    if(periodic)await checkPrimitiveBackbone(page,name);
    const href = await page.locator('a[download][href="./examples/'+name+'"]').getAttribute('href');
    const sample = await page.request.get(new URL(href,page.url()).href);
    assert.ok(sample.ok(), 'sample '+name+' returned HTTP '+sample.status());
    const mimeType = periodic ? 'chemical/x-xyz' : 'chemical/x-mdl-sdfile';
    assert.ok(sample.headers()['content-type'].startsWith(mimeType));
    await page.locator('#fileInput').setInputFiles({name,mimeType,buffer:await sample.body()});
    const count = periodic ? 24 : 122;
    await page.waitForFunction(n=>MoleculeVisualizer.App.getState().atoms.length===n,count);
    const readState = ()=>page.evaluate(()=>{
      const s=MoleculeVisualizer.App.getState();
      return {atoms:s.atoms.map(({id,element,x,y,z})=>({id,element,x,y,z})),bonds:s.bonds,cell:s.metadata.cell};
    });
    const initial=await readState(), pairs=bondPairs(initial);
    assert.equal(pairs.length,periodic?24:121);
    if(periodic)for(const key of ['0-9','12-21'])assert.ok(pairs.includes(key));
    await page.click('#btnExternalEngine');
    await openCalculationPane(page,'connection');
    await page.selectOption('#engineChoice',engine);
    await page.fill('#engineURL',url);await page.fill('#engineToken',token);await page.click('#engineConnect');
    await page.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('接続済み'));
    await openCalculationPane(page,'setup');
    await page.selectOption('#engineMode','md');
    await page.selectOption('#mdEnsemble',periodic?'npt':'nvt');
    if(periodic) {
      await openDetails(page,'#mdCouplingSettings');
      await page.fill('#mdBarostatInterval','1');await page.fill('#mdVolumeMove','.2');
    }
    await page.fill('#mdSteps',periodic?'5':'200');await page.fill('#mdStride',periodic?'2':'1');
    await page.fill('#mdTimestep','.25');await page.uncheck('#engineLive');
    const submitted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/jobs'));
    await page.click('#engineRun');
    const response=await submitted;assert.ok(response.ok(),await response.text());
    const request=response.request().postDataJSON();
    assert.deepEqual(request.symbols,initial.atoms.map(a=>a.element));
    if(!periodic){
      assert.equal(request.forceField.model,'MMFF94');
      assert.deepEqual(request.forceField.bonds.map(([i,j])=>[i,j].sort((a,b)=>a-b).join('-')).sort(),pairs);
    }
    await page.waitForSelector('#mdResult:not([hidden])',{timeout:120000});
    const {result}=JSON.parse(await download(page,'#engineDownload'));
    const tr=result.trajectory;
    const picked=periodic?[0,1,2,3]:[0,67,133,200];
    assert.deepEqual(tr.stepNumbers,periodic?[0,2,4,5]:Array.from({length:201},(_,i)=>i));
    assert.ok(tr.totalEV.every(Number.isFinite));
    if(periodic)assert.ok(result.volumeAccepted>0);
    await page.click('#engineXYZ');
    await page.fill('#trajectoryCount','4');
    const xyz=await download(page,periodic?'#trajectorySaveAll':'#trajectorySaveSelected');
    await page.click('#trajectoryClose');await page.click('#btnExternalEngine');
    await openCalculationPane(page,'results');await page.click('#mdApplyTrajectory');
    if(!periodic){
      await page.fill('#trajectoryCount','4');await page.click('#trajectoryApply');
    }
    await page.waitForFunction(()=>MoleculeVisualizer.App.getState().metadata.trajectory?.length===4);
    await page.click('#frameNext');
    const frames=await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.trajectory);
    for(const [i,f] of frames.entries()){
      assert.deepEqual(f.atoms.map(a=>a.id),initial.atoms.map(a=>a.id));assert.deepEqual(bondPairs(f),pairs);
      assert.deepEqual(f.atoms.map(a=>[a.x,a.y,a.z]),tr.images[picked[i]]);
      if(periodic)assert.deepEqual(f.metadata.cell,tr.cells[picked[i]]);
    }
    await page.click('#btnExport');
    const projectText=await download(page,'#btnSaveProject');
    await page.locator('#exportDialog [data-close]').click();
    await page.locator('#fileInput').setInputFiles({name:'polymer.json',mimeType:'application/json',
      buffer:Buffer.from(projectText)});
    await page.waitForFunction(()=>MoleculeVisualizer.App.getState().metadata.sourceFile==='polymer.json');
    const saved=await readState();
    assert.deepEqual(bondPairs(saved),pairs);
    assert.deepEqual(saved.atoms.map(a=>a.id),initial.atoms.map(a=>a.id));
    // The extended XYZ contains positions and cells. Read connectivity inferred from those positions.
    const file={name:'polymer-md.xyz',mimeType:'text/plain',buffer:Buffer.from(xyz)};
    await page.locator('#fileInput').setInputFiles(file);
    await page.waitForFunction(()=>MoleculeVisualizer.App.getState().metadata.sourceFile==='polymer-md.xyz');
    const parsed=await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.trajectory);
    assert.equal(parsed.length,4);
    for(const [i,f] of parsed.entries()){
      assert.deepEqual(f.atoms.map(a=>a.element),request.symbols);assert.deepEqual(bondPairs(f),pairs);
      if(periodic)assert.deepEqual(f.metadata.cell,tr.cells[picked[i]]);
      f.atoms.forEach((a,j)=>[a.x,a.y,a.z].forEach((v,k)=>assert.ok(Math.abs(v-tr.images[picked[i]][j][k])<1e-10)));
    }
    assert.deepEqual(errors,[]);
    console.log(name,engine,result.md.ensemble,count,'atoms;',pairs.length,'bonds;',tr.stepNumbers.length,'native frames, 4 round-tripped');
  } finally {try{await page?.close();}finally{server.kill();}}
}

(async()=>{
  const browser=await chromium.launch({headless:true});
  try{await run(browser,false);await run(browser,true);}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
