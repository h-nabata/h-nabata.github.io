// Submit an unrestricted butadiene path through the actual UI to the native g-xTB bridge.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {openCalculationPane, openDetails} = require('./workspace-commands.cjs');
const {startupToken} = require('./native-bridge-test.cjs');

async function run(){
  const binary = process.env.GXTB_TEST_BINARY;
  if(!binary) throw Error('Set GXTB_TEST_BINARY to a g-xTB-enabled xtb executable.');
  const root = path.resolve(__dirname, '..'), port = 8779;
  const engine = spawn(process.env.PYTHON || 'python', ['-u', path.join(root, 'local-engine/bridge.py'),
    '--engine', 'gxtb', '--binary', binary, '--port', String(port), '--no-history', '--site-dir', root],
    {env:{...process.env, OMP_NUM_THREADS:'1', OPENBLAS_NUM_THREADS:'1'}});
  let browser;
  try{
    const token = await startupToken(engine);
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:1280, height:950}});
    const errors = [];
    page.on('pageerror', error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+port+'/');
    await page.locator('#fileInput').setInputFiles(path.join(root, 'tests/fixtures/butadiene-disrotatory-asymmetric.xyz'));
    await page.waitForFunction(()=>MoleculeVisualizer.App.getState().metadata.trajectory?.length===9);
    const xyz = await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.trajectory
      .map(frame=>frame.atoms.map(atom=>[atom.x,atom.y,atom.z])));
    await page.click('#btnExternalEngine');
    await openCalculationPane(page, 'connection');
    await page.selectOption('#engineChoice','gxtb');
    await page.fill('#engineToken', token);
    await page.click('#engineConnect');
    await page.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('接続済み'));
    for(const mode of ['neb','cineb','lup']){
      await openCalculationPane(page, 'setup');
      await page.selectOption('#engineMode', mode);
      if(mode!=='neb') await page.selectOption('#engineEndpointMode', 'relax');
      await page.uncheck('#engineLive');
      await openDetails(page, '#engineNumericOptions');
      await page.selectOption('#enginePathOptimizer','band-lbfgs');
      await page.fill('#engineSteps','3');
      if(mode!=='neb') await page.fill('#engineClimb','1');
      await page.fill('#engineMove','.013');
      assert.equal(await page.locator('#engineMirror').isChecked(),false);
      const submission = page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/jobs'));
      await page.click('#engineRun');
      const receipt = await submission;
      assert.ok(receipt.ok());
      const data = receipt.request().postDataJSON();
      assert.equal(data.optimizer,'band-lbfgs');
      assert.equal(data.maxMove,.013);
      assert.equal(data.pathSymmetry,undefined);
      assert.deepEqual(data.images,xyz);
      await page.waitForSelector('#engineResult:not([hidden])');
      const download = page.waitForEvent('download');
      await page.click('#engineDownload');
      const report = JSON.parse(fs.readFileSync(await (await download).path(),'utf8'));
      const r = report.result;
      assert.equal(r.mode,mode);
      assert.equal(r.optimizer,'band-lbfgs');
      assert.equal(r.engine,'gxtb');
      assert.equal(r.reason,'step_limit');
      assert.ok(r.diagnostics.stepRadius>0 && r.diagnostics.stepRadius<=.013);
      assert.equal(r.pathSymmetry,undefined);
      if(mode==='neb') {
        assert.deepEqual(r.images[0],xyz[0]);
        assert.deepEqual(r.images.at(-1),xyz.at(-1));
      } else {
        assert.equal(r.endpointMode,'relax');
        assert.notDeepEqual(r.images[0],xyz[0]);
        assert.notDeepEqual(r.images.at(-1),xyz.at(-1));
      }
      console.log(mode, r.steps, r.evaluations, r.effectiveFmax);
    }
    assert.deepEqual(errors, []);
  } finally {
    try {await browser?.close();} finally {engine.kill();}
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
