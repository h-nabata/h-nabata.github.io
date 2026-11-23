// Full browser + local FAIRChem inference. Uses the configured checkpoint without downloading browser assets.
// Run with PYTHON pointing to the UMA environment. UMA_TEST_CHECKPOINT optionally supplies a trusted local file.
const {chromium}=require('playwright');
const {spawn,execFileSync}=require('node:child_process');
const {strict:assert}=require('node:assert');
const fs=require('node:fs/promises');
const path=require('node:path');
const {startupToken}=require('./native-bridge-test.cjs');
const {openCalculationPane}=require('./workspace-commands.cjs');

const fixtures=`
import io,json
from ase.build import bulk,fcc111,add_adsorbate
from ase.io import write
solid=bulk('Si','diamond',a=5.45,cubic=True)
solid.positions[0]+=[.12,-.05,.08]
surface=fcc111('Cu',size=(2,2,3),a=3.62,vacuum=8.,orthogonal=True)
add_adsorbate(surface,'O',1.55,'fcc')
rows=[]
for atoms,task in [(solid,'omat'),(surface,'oc20')]:
    output=io.StringIO()
    write(output,atoms,format='extxyz',write_info=False)
    rows.append(dict(task=task,xyz=output.getvalue(),pbc=atoms.pbc.tolist(),count=len(atoms)))
print(json.dumps(rows))
`;

async function run(){
  const root=path.resolve(__dirname,'..'),python=process.env.PYTHON||'python';
  const systems=JSON.parse(execFileSync(python,['-c',fixtures],{encoding:'utf8'}));
  const port=Number(process.env.UMA_PERIODIC_UI_PORT||8935),model=process.env.UMA_TEST_MODEL||'uma-s-1p2p1';
  const checkpoint=process.env.UMA_TEST_CHECKPOINT;
  const args=['-u',path.join(root,'local-engine/bridge.py'),'--engine','uma','--uma-model',model,
    '--uma-device','cpu','--uma-precision','float32','--threads','1','--no-history','--site-dir',root,'--port',String(port)];
  if(checkpoint)args.push('--uma-checkpoint',checkpoint);
  const service=spawn(python,args,{env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});
  let browser;
  try{
    const token=await startupToken(service);
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1400,height:1020}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+port);await page.waitForSelector('canvas');
    for(const [i,system] of systems.entries()){
      if(i)await page.click('#engineClose');
      await page.locator('#fileInput').setInputFiles({name:system.task+'.xyz',mimeType:'text/plain',buffer:Buffer.from(system.xyz)});
      await page.waitForFunction(count=>MoleculeVisualizer.App.getState().atoms.length===count,system.count);
      await page.click('#btnExternalEngine');
      if(i===0){
        await openCalculationPane(page,'connection');await page.fill('#engineToken',token);
        await page.click('#engineConnect');
        await page.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('接続済み'));
      }
      await openCalculationPane(page,'setup');
      assert.equal(await page.inputValue('#engineUMATask'),system.task);
      await page.selectOption('#engineMode','evaluate');await page.uncheck('#engineLive');
      const sent=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/api/jobs'));
      await page.click('#engineRun');
      const input=(await sent).postDataJSON();
      assert.equal(input.umaTask,system.task);assert.deepEqual(input.cell.pbc,system.pbc);
      await page.waitForFunction(()=>!MoleculeVisualizer.EngineUI.isBusy(),undefined,{timeout:300000});
      assert.equal(await page.isVisible('#engineDownload'),true,await page.textContent('#engineMessage'));
      const event=page.waitForEvent('download');await page.click('#engineDownload');
      const report=JSON.parse(await fs.readFile(await(await event).path(),'utf8')),result=report.result;
      assert.equal(report.input.umaTask,system.task);assert.equal(result.provenance.uma.task,system.task);
      if(checkpoint)assert.match(result.provenance.uma.checkpointSHA256,/^[a-f0-9]{64}$/);
      assert.ok(Number.isFinite(result.energies[0]));assert.equal(result.forces[0].length,system.count);
      assert.ok(result.forces[0].every(f=>f.length===3&&f.every(Number.isFinite)));
      console.log('Completed',system.task,system.count,'atoms;',result.energies[0],'eV;',result.imageFmax[0],'eV/Å');
    }
    assert.deepEqual(errors,[]);
  }finally{service.kill();await browser?.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
