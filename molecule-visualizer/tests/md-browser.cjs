// Submit MD to native bridges, then check the stored thermodynamics, cells, exports and playback.
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

async function verifyRun(browser, engine, ensemble, port, thermostat) {
  const variableCell = ensemble === 'npt';
  const periodic = engine === 'tblite';
  const atomCount = variableCell ? 2 : periodic ? 1 : 3;
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
    let input = periodic
      ? {name:'helium.xyz', mimeType:'text/plain', buffer:Buffer.from('1\nLattice="8 0 0 0 8 0 0 0 8" pbc="T T T"\nHe 1 1 1\n')}
      : {name:'water.mol', mimeType:'chemical/x-mdl-molfile', buffer:Buffer.from(water)};
    if (variableCell) {
      const sampleURL = await page.locator('#mdCellExample a').getAttribute('href');
      const sample = await page.request.get(new URL(sampleURL, url).href);
      assert.ok(sample.ok(), sample.statusText());
      input = {name:'silicon-npt.xyz', mimeType:'text/plain', buffer:await sample.body()};
    }
    await page.locator('#fileInput').setInputFiles(input);
    await page.waitForFunction(n=>MoleculeVisualizer.App.getState().atoms.length===n &&
      (n!==3 ? MoleculeVisualizer.App.getState().metadata.cell?.pbc.every(Boolean) :
        MoleculeVisualizer.App.getState().atoms[1].x===1.02), atomCount);
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
    if (ensemble === 'nve') {
      assert.equal(await page.locator('#mdThermostat').isVisible(), false);
    } else {
      assert.equal(await page.inputValue('#mdThermostat'), 'nose-hoover-chain');
      if (thermostat !== 'nose-hoover-chain') await page.selectOption('#mdThermostat',thermostat);
      await openDetails(page,'#mdCouplingSettings');
      if (thermostat === 'langevin') await page.fill('#mdFriction','15');
      else await page.fill('#mdThermostatTime','25');
    }
    if (variableCell) {
      await page.fill('#mdPressure','1');
      await page.fill('#mdBarostatInterval','1');
      await page.fill('#mdVolumeMove','2');
    } else {
      assert.equal(await page.locator('#mdPressure').isVisible(), false);
      if (periodic) await page.check('#mdRecordPressure');
      else assert.ok(await page.locator('#mdEnsemble option[value=npt]').evaluate(option=>option.disabled), JSON.stringify({
        errors, message:await page.locator('#mdEnsembleHelp').textContent()}));
    }
    await page.fill('#mdSteps','11');
    await page.fill('#mdTimestep','.25');
    await page.fill('#mdTemperature','300');
    await page.fill('#mdStride','4');
    await openDetails(page,'#mdVelocitySettings');
    await page.fill('#mdSeed','727');
    if (!periodic) await page.check('#mdRemoveCOM');
    if (engine==='rdkit') await page.selectOption('#mdForceField','MMFF94');
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
    if (thermostat) assert.equal(request.md.thermostat,thermostat);
    if (thermostat==='langevin') assert.equal(request.md.frictionPerPs,15);
    if (thermostat && thermostat!=='langevin') assert.equal(request.md.thermostatTimeFs,25);
    if (variableCell) {
      assert.equal(request.md.pressureBar,1);
      assert.equal(request.md.barostatInterval,1);
      assert.equal(request.md.volumeStepPercent,2);
    } else if (periodic) {
      assert.equal(request.md.recordPressure,true);
      assert.ok(!Object.hasOwn(request.md,'barostat'));
    }
    if (engine==='rdkit') {
      assert.equal(request.forceField.model,'MMFF94');
      assert.deepEqual(request.forceField.formalCharges,[0,0,0]);
      assert.deepEqual(request.forceField.bonds,[[0,1,1],[0,2,1]]);
    }

    await page.waitForSelector('#mdResult:not([hidden])', {state:'attached'});
    let previewCell;
    if (ensemble!=='nve') {
      const title = await page.locator('#profileTitle').innerText();
      assert.ok(title.includes(ensemble.toUpperCase()));
      assert.ok(title.includes({'nose-hoover-chain':'Nosé–Hoover',bussi:'Bussi',langevin:'Langevin'}[thermostat]));
      if (periodic) {
        assert.match(await page.locator('#profileValue').innerText(),/Å³.*bar/);
        previewCell = await page.evaluate(()=>MoleculeVisualizer.App.renderer().state.metadata.cell);
      }
      await page.click('#profileDetails');
      await openCalculationPane(page,'results');
    }
    await page.waitForSelector('#mdResult:not([hidden])');
    await openDetails(page,'#mdResult details');
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
    if (periodic) {
      assert.match(display,/bar/);
      assert.deepEqual(previewCell,trajectory.cells.at(-1));
      if (variableCell) assert.notDeepEqual(trajectory.cells[0],trajectory.cells.at(-1));
      else for (const h of trajectory.cells) assert.deepEqual(h,trajectory.cells[0]);
      const initialVolume = variableCell ? 5.43**3/4 : 512;
      assert.ok(Math.abs(trajectory.volumeA3[0]-initialVolume)<1e-8);
      assert.equal(trajectory.pressureBar.length,4);
      assert.ok(trajectory.pressureBar.every(Number.isFinite));
      const component = variableCell ? 1 : 0;
      const initialLength = trajectory.cells[0].vectors[0][component];
      for (const [i,h] of trajectory.cells.entries()) {
        const scaledVolume = initialVolume*(h.vectors[0][component]/initialLength)**3;
        assert.ok(Math.abs(scaledVolume-trajectory.volumeA3[i])<1e-8);
      }
    }
    assert.deepEqual(trajectory.images.at(-1),report.images[0]);
    for (let i=0; i<4; ++i) {
      assert.ok(trajectory.temperatureK[i]>0);
      assert.ok(Math.abs(trajectory.totalEV[i]-trajectory.energies[i]-trajectory.kineticEV[i])<1e-9);
    }
    await page.click('#engineXYZ');
    const xyz = await download(page,'#trajectorySaveAll');
    assert.equal(xyz.match(new RegExp('^'+atomCount+'\\r?$','gm'))?.length,4);
    if (periodic) {
      const lattices = [...xyz.matchAll(/Lattice="([^"]+)"/g)].map(m=>m[1].split(/\s+/).map(Number));
      assert.equal(lattices.length,4);
      for (const [i,h] of lattices.entries()) {
        trajectory.cells[i].vectors.flat().forEach((v,j)=>assert.ok(Math.abs(h[j]-v)<1e-5));
      }
      assert.match(xyz,/pressure_bar=/);
      assert.match(xyz,/volume_A3=/i);
    }
    assert.match(xyz,/time_fs=2.75/);
    assert.match(xyz,/total_eV=/);
    await page.click('#trajectoryClose');
    await page.click('#btnExternalEngine');
    await openCalculationPane(page,'results');
    await page.click('#mdApplyTrajectory');
    await page.waitForFunction(()=>MoleculeVisualizer.App.getState().metadata.trajectory?.length===4);
    const xyzOnScreen = await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.trajectory
      .map(frame=>frame.atoms.map(atom=>[atom.x,atom.y,atom.z])));
    if (periodic) {
      const played = await page.evaluate(()=>MoleculeVisualizer.App.getState().metadata.trajectory
        .map(frame=>frame.metadata.cell));
      assert.deepEqual(played,trajectory.cells);
    }
    for (let i=0; i<4; ++i) {
      for (let a=0; a<atomCount; ++a) {
        for(let axis=0; axis<3; ++axis) {
          assert.ok(Math.abs(xyzOnScreen[i][a][axis]-trajectory.images[i][a][axis])<1e-6);
        }
      }
    }
    assert.equal(await page.locator('#frameRange').getAttribute('max'),'3');
    assert.ok(await page.locator('#framePlay').isEnabled());
    await page.click('#frameNext');
    const selected = Number(await page.inputValue('#frameRange'));
    const readout = await page.locator('#mdFrameReadout').innerText();
    assert.ok(readout.includes(ensemble.toUpperCase()));
    assert.ok(readout.includes(trajectory.timeFs[selected]+' fs'));
    if (periodic) {
      assert.ok(readout.includes(Number(trajectory.pressureBar[selected].toPrecision(6))+' bar'));
      assert.ok(readout.includes(Number(trajectory.volumeA3[selected].toPrecision(6))+' Å³'));
    }
    assert.deepEqual(errors,[]);
    console.log(engine,ensemble,thermostat||'',report.steps,trajectory.timeFs.at(-1),'fs',trajectory.images.length,'frames');
  } finally {
    try {await page?.close();} finally {service.kill();}
  }
}

async function main() {
  const browser = await chromium.launch({headless:true});
  try {
    await verifyRun(browser,'gxtb','nve',8781);
    await verifyRun(browser,'rdkit','nvt',8782,'nose-hoover-chain');
    await verifyRun(browser,'rdkit','nvt',8783,'langevin');
    await verifyRun(browser,'tblite','npt',8784,'bussi');
    await verifyRun(browser,'tblite','nvt',8785,'nose-hoover-chain');
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
