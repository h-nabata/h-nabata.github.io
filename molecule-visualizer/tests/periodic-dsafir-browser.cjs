// Real GFN2-xTB check of surface DS-AFIR, frozen substrate and transfer to CI-NEB.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const {startupToken} = require('./native-bridge-test.cjs');
const {clickWorkspaceCommand, openCalculationPane, openDetails} = require('./workspace-commands.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const port = 8991;
  const origin = 'http://127.0.0.1:' + port;
  const service = spawn(process.env.PYTHON || 'python', [
    path.join(root, 'local-engine/bridge.py'), '--engine', 'tblite', '--port', String(port),
    '--site-dir', root, '--no-history', '--allow-origin', origin
  ], {env:{...process.env, OPENBLAS_NUM_THREADS:'1', OMP_NUM_THREADS:'1'}});
  let browser;
  try {
    const token = await startupToken(service);
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:1366,height:950}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.waitForSelector('canvas');
    await page.locator('#fileInput').setInputFiles(path.join(root, 'examples/graphene-li-dsafir.xyz'));
    await page.waitForFunction(() => MoleculeVisualizer.App.getState().metadata.trajectory?.length === 2);
    await clickWorkspaceCommand(page, '#btnConstraints');
    await page.fill('#constraintAtoms', '1-12');
    await page.check('#constraintEnabled');
    await page.click('#constraintApply');
    await clickWorkspaceCommand(page, '#btnDSAFIR');
    await openCalculationPane(page, 'connection');
    await page.fill('#engineURL', origin);
    await page.fill('#engineToken', token);
    await page.click('#engineConnect');
    await page.waitForFunction(() => document.getElementById('engineConnected').textContent.includes('接続済み'));
    // Unknown product: run two independent single-pair trials from the same
    // surface and keep the separately registered manual fragment definition.
    await clickWorkspaceCommand(page, '#btnAFIR');
    const active = await page.evaluate(() => {
      const li=MoleculeVisualizer.App.renderer().projectedAtoms.find(a=>a.atom.element==='Li');
      return {x:li.x,y:li.y};
    });
    await page.click('#btnClearSel');
    await page.locator('canvas').click({position:active});
    await page.fill('#afirName','Adsorbate');
    await page.click('#afirAddFragment');
    const carbon=await page.evaluate(()=>{
      const renderer=MoleculeVisualizer.App.renderer();
      const atom=renderer.projectedAtoms.find(p=>p.atom.element==='C'&&renderer.pickAtom(p.x,p.y)?.id===p.atom.id);
      return {x:atom.x,y:atom.y};
    });
    await page.locator('canvas').click({position:carbon});
    await page.fill('#afirName','Manual substrate group');
    await page.click('#afirAddFragment');
    await page.selectOption('#afirMode','repel');
    await page.click('#afirAddPair');
    await page.locator('canvas').click({position:active});
    await page.fill('#afirMultiplicity','2');
    await page.fill('#afirSteps','2');
    await page.uncheck('#afirLive');
    const manual = await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.afir);
    assert.equal(manual.fragments[0].label,'Adsorbate');
    assert.deepEqual(manual.pairs.map(p=>p.mode),['repel']);
    const requests=[];
    page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/jobs'))requests.push(r.postDataJSON());});
    await openDetails(page,'#afirNearby');
    await page.click('#afirNearbyFind');
    assert.ok(await page.locator('#afirNearbyPair option').count()>=2);
    await page.fill('#afirNearbyRadius','3.9');
    assert.ok(await page.locator('#afirNearbyResults').isHidden());
    await page.click('#afirNearbyFind');
    await page.selectOption('#afirNearbyPair',{index:1});
    assert.equal(requests.length,0);
    for(const candidateIndex of [1,0]){
      await page.selectOption('#afirNearbyPair',{index:candidateIndex});
      const posted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/jobs'));
      await page.click('#afirNearbyRun');
      const response=await posted;
      assert.ok(response.ok(),await response.text());
      await page.waitForSelector('#afirResult:not([hidden])',{timeout:90000});
      await page.waitForFunction(()=>!MoleculeVisualizer.AFIRUI.isBusy());
      const last=requests.at(-1);
      assert.equal(last.mode,'afir');
      assert.equal(last.maxSteps,2);
      assert.equal(last.afir.pairs.length,1);
      assert.equal(last.afir.pairs[0].mode,'attract');
      assert.equal(last.fixedAtoms.length,12);
      assert.ok(last.afir.fragments.some(f=>f.atomIds.includes(manual.fragments[0].atomIds[0])));
      assert.deepEqual(await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.afir),manual);
    }
    assert.equal(requests.length,2);
    assert.deepEqual(requests[0].images,requests[1].images);
    assert.notDeepEqual(requests[0].afir.fragments,requests[1].afir.fragments);
    console.log('Active-site AFIR submitted two distinct frozen-surface trials from the same input.');
    await clickWorkspaceCommand(page, '#btnDSAFIR');
    await openCalculationPane(page, 'setup');
    assert.equal(await page.inputValue('#dsafirImage'), 'nearest');
    await page.uncheck('#engineLive');
    await page.fill('#engineMultiplicity', '2');
    await openDetails(page, '#engineNumericOptions');
    await page.fill('#engineSteps', '120');
    await openDetails(page, '#engineDSAFIRSettings details');
    await page.fill('#dsafirStep', '0.08');
    await page.fill('#dsafirThreshold', '0.10');
    await page.fill('#dsafirDelta', '2.0');

    async function submit() {
      const posted = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/jobs'));
      await page.click('#engineRun');
      const response = await posted;
      assert.ok(response.ok(), await response.text());
      await page.waitForSelector('#engineResult:not([hidden])', {timeout:240000});
      const pending = page.waitForEvent('download');
      await page.click('#engineDownload');
      return JSON.parse(await fs.readFile(await (await pending).path(), 'utf8'));
    }
    const ds = await submit();
    const fixed = Array.from({length:12}, (_,i) => i);
    assert.deepEqual(ds.input.fixedAtoms, fixed);
    assert.deepEqual(ds.result.cell.pbc, [true,true,true]);
    assert.ok(ds.result.dsafir.connected);
    assert.equal(ds.result.dsafir.endpointImage, 'nearest');
    assert.ok(Math.abs(ds.result.images.at(-1)[12][0] - 2.46) < 1e-6);
    const anchors = ds.input.images[0].slice(0,12);
    for (const image of ds.result.images) assert.deepEqual(image.slice(0,12), anchors);

    await page.fill('#dsafirRelaxCount', '7');
    await page.selectOption('#dsafirRelaxMode', 'cineb');
    await page.click('#dsafirRelaxPrepare');
    assert.equal(await page.inputValue('#engineMode'), 'cineb');
    await openDetails(page, '#engineNumericOptions');
    await page.fill('#engineSteps', '2');
    await page.fill('#engineClimb', '0');
    const band = await submit();
    assert.deepEqual(band.input.cell, ds.input.cell);
    assert.deepEqual(band.input.fixedAtoms, fixed);
    assert.equal(band.result.images.length, 7);
    for (const image of band.result.images) assert.deepEqual(image.slice(0,12), anchors);
    assert.deepEqual(errors, []);
    console.log('Periodic surface DS-AFIR connected at step', ds.result.steps, 'and retained the substrate in CI-NEB.');
  } finally {
    await browser?.close();
    service.kill();
  }
}
main().catch(error => { console.error(error); process.exitCode=1; });
