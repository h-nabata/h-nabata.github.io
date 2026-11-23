// Run the UI against actual g-xTB and RDKit bridges, then play and export the MD frames.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const {openCalculationPane, openDetails} = require('./workspace-commands.cjs');
const {startupToken} = require('./native-bridge-test.cjs');

const app = path.resolve(__dirname, '..');
const water = `Water
  Molecule Studio    3D

  3  2  0  0  0  0            999 V2000
    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
    1.0200    0.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0
   -0.2400    0.9300    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
  1  3  1  0  0  0  0
M  END
`;

async function download(page, button) {
  const event = page.waitForEvent('download');
  await page.click(button);
  return fs.readFile(await (await event).path(), 'utf8');
}

async function verifyRun(browser, engine, ensemble, port) {
  const url = 'http://127.0.0.1:' + port;
  const args = ['-u', path.join(app,'local-engine/bridge.py'), '--engine',engine, '--port',String(port),
    '--site-dir',app, '--no-history'];
  if (engine === 'gxtb') {
    assert.ok(process.env.GXTB_TEST_BINARY, 'Set GXTB_TEST_BINARY to a g-xTB-enabled xtb binary');
    args.push('--binary', process.env.GXTB_TEST_BINARY);
  }
  const service = spawn(process.env.PYTHON || 'python', args,
    {env:{...process.env, OMP_NUM_THREADS:'1', OPENBLAS_NUM_THREADS:'1'}});
  let page;
  try {
    const token = await startupToken(service);
    page = await browser.newPage({viewport:{width:1200,height:880}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.locator('#fileInput').setInputFiles({name:'water.mol',mimeType:'chemical/x-mdl-molfile',
      buffer:Buffer.from(water)});
    await page.waitForFunction(()=>MoleculeVisualizer.App.getState().atoms.length===3 &&
      MoleculeVisualizer.App.getState().atoms[1].x===1.02);
    await page.click('#btnExternalEngine');
    await openCalculationPane(page,'connection');
    await page.selectOption('#engineChoice',engine);
    await page.fill('#engineURL',url);
    await page.fill('#engineToken',token);
    await page.click('#engineConnect');
    await page.waitForFunction(()=>document.getElementById('engineConnected').textContent.includes('接続済み'));
    await openCalculationPane(page,'setup');
    await page.selectOption('#engineMode','md');
    await page.selectOption('#mdEnsemble',ensemble);
    await page.fill('#mdSteps','11');
    await page.fill('#mdTimestep','.25');
    await page.fill('#mdTemperature','300');
    await page.fill('#mdStride','4');
    await openDetails(page,'#mdVelocitySettings');
    await page.fill('#mdSeed','727');
    await page.check('#mdRemoveCOM');
    if (engine==='rdkit') await page.selectOption('#mdForceField','MMFF94');
    if (ensemble==='nvt') await page.fill('#mdFriction','15');
    if(ensemble==='nve') await page.uncheck('#engineLive');
    else await page.check('#engineLive');
    const submission = page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/jobs'));
    await page.click('#engineRun');
    const response = await submission;
    assert.ok(response.ok(), await response.text());
    const request = response.request().postDataJSON();
    assert.equal(request.mode,'md');
    assert.equal(request.maxSteps,11);
    assert.equal(request.md.ensemble,ensemble);
    assert.equal(request.md.timestepFs,.25);
    assert.equal(request.md.seed,727);
    if (engine==='rdkit') {
      assert.equal(request.forceField.model,'MMFF94');
      assert.deepEqual(request.forceField.formalCharges,[0,0,0]);
      assert.deepEqual(request.forceField.bonds,[[0,1,1],[0,2,1]]);
    }

    await page.waitForSelector('#mdResult:not([hidden])', {state:'attached'});
    if (ensemble==='nvt') {
      await page.click('#profileDetails');
      await openCalculationPane(page,'results');
    }
    await page.waitForSelector('#mdResult:not([hidden])');
    const display = await page.locator('#mdResult').innerText();
    assert.match(display,/fs/);
    assert.match(display,/eV/);
    assert.match(display,/K/);
    const report = JSON.parse(await download(page,'#engineDownload')).result;
    assert.equal(report.engine,engine);
    assert.equal(report.mode,'md');
    assert.equal(report.steps,11);
    const trajectory = report.trajectory;
    assert.deepEqual(trajectory.stepNumbers,[0,4,8,11]);
    assert.deepEqual(trajectory.timeFs,[0,1,2,2.75]);
    assert.notDeepEqual(trajectory.images[0],trajectory.images.at(-1));
    assert.deepEqual(trajectory.images.at(-1),report.images[0]);
    for (let i=0; i<4; ++i) {
      assert.ok(trajectory.temperatureK[i]>0);
      assert.ok(Math.abs(trajectory.totalEV[i]-trajectory.energies[i]-trajectory.kineticEV[i])<1e-9);
    }
    await page.click('#engineXYZ');
    const xyz = await download(page,'#trajectorySaveAll');
    assert.equal(xyz.match(/^3\r?$/gm)?.length,4);
    assert.match(xyz,/time_fs=2.75/);
    assert.match(xyz,/total_eV=/);
    await page.click('#trajectoryClose');
    await page.click('#btnExternalEngine');
    await openCalculationPane(page,'results');
    await page.click('#mdApplyTrajectory');
    await page.waitForFunction(()=>MoleculeVisualizer.App.getState().metadata.trajectory?.length===4);
    const xyzOnScreen = await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.trajectory
      .map(frame=>frame.atoms.map(atom=>[atom.x,atom.y,atom.z])));
    for (let i=0; i<4; ++i) {
      for (let a=0; a<3; ++a) {
        for(let axis=0; axis<3; ++axis) {
          assert.ok(Math.abs(xyzOnScreen[i][a][axis]-trajectory.images[i][a][axis])<1e-6);
        }
      }
    }
    assert.equal(await page.locator('#frameRange').getAttribute('max'),'3');
    assert.ok(await page.locator('#framePlay').isEnabled());
    assert.deepEqual(errors,[]);
    console.log(engine,ensemble,report.steps,trajectory.timeFs.at(-1),'fs',trajectory.images.length,'frames');
  } finally {
    try {await page?.close();} finally {service.kill();}
  }
}

async function main() {
  const browser = await chromium.launch({headless:true});
  try {
    await verifyRun(browser,'gxtb','nve',8781);
    await verifyRun(browser,'rdkit','nvt',8782);
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
