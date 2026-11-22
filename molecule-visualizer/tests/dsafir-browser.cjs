// Run independently against a real localhost tblite bridge and the repository preview.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { clickWorkspaceCommand } = require('./workspace-commands.cjs');

async function startupToken(engine) {
  let output = '', errors = '';
  engine.stderr.on('data', chunk => { errors += chunk; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Bridge startup timeout: ' + errors)), 20000);
    engine.stdout.on('data', chunk => {
      output += chunk;
      const match = /Token: (\S+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    engine.once('exit', code => {
      clearTimeout(timer);
      reject(Error('Bridge exited ' + code + ': ' + errors));
    });
  });
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const port = 8774;
  const url = 'http://127.0.0.1:8765';
  const engine = spawn(process.env.PYTHON || 'python', [
    path.join(root, 'local-engine/bridge.py'), '--engine', 'tblite', '--port', String(port),
    '--allow-origin', url, '--no-history', '--site-dir', root,
  ], {env: {...process.env, OMP_NUM_THREADS:'1', OPENBLAS_NUM_THREADS:'1'}});
  let browser, alternateEngine;
  try {
    const token = await startupToken(engine);
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:1366,height:900}});
    const errors = [], jobs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/api/jobs')) jobs.push(request.postDataJSON());
    });
    await page.goto(url + '/molecule-visualizer/');
    await page.waitForSelector('canvas');

    const pair = fs.readFileSync(path.join(root, 'examples/ammonia-inversion.xyz'), 'utf8');
    const servedExample = await page.request.get('http://127.0.0.1:' + port + '/examples/ammonia-inversion.xyz');
    assert.equal(servedExample.status(), 200);
    assert.equal(await servedExample.text(), pair);
    const third = pair.slice(0, pair.indexOf('\n4\n') + 1);
    await page.locator('#fileInput').setInputFiles({
      name:'endpoints.xyz', mimeType:'chemical/x-xyz', buffer:Buffer.from(pair + third)
    });
    await page.waitForFunction(() => MoleculeVisualizer.App.getState().metadata.trajectory?.length === 3);
    const projected = await page.evaluate(() => {
      const atom = MoleculeVisualizer.App.renderer().projectedAtoms.find(a => a.index === 2);
      return {x:atom.x,y:atom.y};
    });
    await page.locator('canvas').click({position:projected});
    assert.equal(await page.evaluate(() => MoleculeVisualizer.App.getState().selectedAtomIds.size), 1);
    await clickWorkspaceCommand(page, '#btnDSAFIR');
    assert.equal(await page.locator('#engineMode').inputValue(), 'dsafir');
    assert.equal(await page.locator('#dsafirEnd').inputValue(), '2');
    await page.fill('#engineURL', 'http://127.0.0.1:' + port);
    await page.fill('#engineToken', token);
    await page.click('#engineConnect');
    await page.waitForFunction(() => document.getElementById('engineConnected').textContent.includes('接続済み'));
    assert.equal(jobs.length, 0);
    await page.uncheck('#engineLive');

    await page.selectOption('#dsafirStart', '1');
    await page.selectOption('#dsafirEnd', '0');
    await page.locator('#engineDSAFIRSettings details > summary').click();
    await page.fill('#engineSteps', '1');
    await page.fill('#dsafirStep', '0.025');
    await page.fill('#dsafirThreshold', '0.05');
    await page.fill('#dsafirDelta', '1.8');
    assert.equal(await page.locator('#dsafirDelta').evaluate(el => el === document.activeElement), true);

    async function submitAndRead() {
      const receipt = page.waitForResponse(res => res.request().method() === 'POST' && res.url().endsWith('/api/jobs'));
      await page.click('#engineRun');
      assert.equal((await receipt).ok(), true);
      await page.waitForSelector('#engineResult:not([hidden])');
      const download = page.waitForEvent('download');
      await page.click('#engineDownload');
      const json = fs.readFileSync(await (await download).path(), 'utf8');
      assert.equal(json.includes(token), false);
      return JSON.parse(json);
    }
    const partial = await submitAndRead();
    assert.equal(jobs[0].maxSteps, 1);
    assert.deepEqual(jobs[0].dsafir, {delta:1.8,stepSize:.025,threshold:.05});
    assert.equal(jobs[0].images.length, 2);
    assert.ok(jobs[0].images[0][0][2] < 0 && jobs[0].images[1][0][2] > 0);
    assert.equal(partial.result.dsafir.connected, false);
    assert.ok(partial.result.dsafir.gap > .05);
    assert.equal(await page.locator('#engineApply').isDisabled(), true);
    const handoff = page.locator('#dsafirRelaxPrepare');
    assert.ok(!await handoff.isVisible() || await handoff.isDisabled(), 'An incomplete DS-AFIR path cannot be relaxed as a connected band');
    assert.equal(await page.locator('#engineXYZ').isDisabled(), true);
    assert.equal(await page.locator('#engineEnergyRows button').count(), 0);
    assert.match(await page.locator('#engineResultSummary').textContent(), /ステップ上限/);
    await page.click('#engineProfile');
    assert.match(await page.locator('#profileLegend').textContent(), /未接続/);
    await page.click('#profileDetails');
    assert.equal(await page.evaluate(() => MoleculeVisualizer.App.getState().metadata.trajectory.length), 3);

    await page.fill('#engineSteps', '300');
    const report = await submitAndRead(), result = report.result;
    assert.equal(result.dsafir.connected, true);
    assert.ok(result.dsafir.gap <= .05);
    assert.deepEqual(result.atomIds, jobs[1].atomIds);
    assert.ok(result.images.length > 3 && result.energies.length === result.images.length);
    assert.ok(Math.max(...result.energies) > Math.max(result.energies[0],result.energies.at(-1)) + .01);
    assert.match(await page.locator('#engineResultSummary').textContent(), /経路接続/);
    assert.equal(await page.locator('#engineEnergyRows button').count(), result.images.length);
    await page.click('#engineXYZ');
    const savedXYZ = page.waitForEvent('download');
    await page.click('#trajectorySaveAll');
    const xyz = fs.readFileSync(await (await savedXYZ).path(), 'utf8').trimEnd().split(/\r?\n/);
    assert.equal(xyz.length, result.images.length * 6);
    for (let i = 0; i < result.images.length; ++i) {
      assert.equal(xyz[6*i].trim(), '4');
      for (let j = 0; j < 4; ++j) {
        const [element, ...coords] = xyz[6*i+2+j].trim().split(/\s+/);
        assert.equal(element, result.symbols[j]);
        assert.ok(coords.every((value, k) => Math.abs(Number(value) - result.images[i][j][k]) < 1e-6));
      }
    }
    await page.click('#trajectoryClose');
    await page.click('#btnExternalEngine');
    await page.click('#engineApply');
    const applied = await page.evaluate(() => {
      const state = MoleculeVisualizer.App.getState();
      return state.metadata.trajectory.map(f => ({ids:f.atoms.map(a => a.id), xyz:f.atoms.map(a => [a.x,a.y,a.z])}));
    });
    assert.deepEqual(applied.map(frame => frame.xyz), result.images);
    for (const frame of applied) assert.deepEqual(frame.ids, result.atomIds);
    assert.match(await page.locator('#activityJobs').textContent(), /DS-AFIR.*完了/);
    await page.setViewportSize({width:390,height:844});
    await clickWorkspaceCommand(page, '#btnDSAFIR');
    assert.ok(await page.locator('#engineDialog').evaluate(el => el.scrollWidth <= el.clientWidth + 2));
    await page.click('#engineClose');
    await page.setViewportSize({width:1366,height:900});
    const transferFile = path.join(root, 'examples/malonaldehyde-proton-transfer.xyz');
    await page.locator('#fileInput').setInputFiles(transferFile);
    await page.waitForFunction(() => MoleculeVisualizer.App.getState().atoms.length === 9);
    await clickWorkspaceCommand(page, '#btnDSAFIR');
    if (!await page.locator('#dsafirDelta').isVisible())
      await page.locator('#engineDSAFIRSettings details > summary').click();
    await page.fill('#dsafirDelta', '1.5');
    await page.fill('#dsafirStep', '0.1');
    await page.fill('#dsafirThreshold', '0.12');
    for (const mode of ['cineb', 'lup', 'neb']) {
      await page.selectOption('#engineMode', 'dsafir');
      // The previous result/transfer may have created a longer input trajectory.
      const endpoints = await page.locator('#dsafirEnd option').count();
      await page.selectOption('#dsafirStart', '0');
      await page.selectOption('#dsafirEnd', String(endpoints-1));
      const source = (await submitAndRead()).result;
      assert.equal(source.dsafir.connected, true);
      const submitted = jobs.length;
      // The actual DS job's charge/spin must survive intervening form edits.
      await page.fill('#engineCharge', '1');
      await page.fill('#engineMultiplicity', '2');
      await page.selectOption('#dsafirRelaxMode', mode);
      const nodes = mode === 'cineb' ? source.images.length : 10;
      await page.fill('#dsafirRelaxCount', String(nodes));
      await handoff.click();
      assert.equal(await page.locator('#engineMode').inputValue(), mode);
      assert.equal(await page.locator('#engineScope').inputValue(), 'all');
      assert.equal(await page.locator('#engineCharge').inputValue(), String(source.charge));
      assert.equal(await page.locator('#engineMultiplicity').inputValue(), String(source.multiplicity));
      assert.equal(jobs.length, submitted, 'Preparing a band must not start the calculation');
      const band = await page.evaluate(() => MoleculeVisualizer.App.getState().metadata.trajectory.map(f => ({
        ids:f.atoms.map(a => a.id), xyz:f.atoms.map(a => [a.x,a.y,a.z])
      })));
      assert.equal(band.length, nodes);
      for (const f of band) assert.deepEqual(f.ids, source.atomIds);
      assert.deepEqual(band[0].xyz, source.images[0]);
      assert.deepEqual(band.at(-1).xyz, source.images.at(-1));
      const highest = source.energies.indexOf(Math.max(...source.energies));
      assert.ok(band.some(f => JSON.stringify(f.xyz) === JSON.stringify(source.images[highest])),
        'Subsampling must keep the highest-energy geometry');

      const relaxed = (await submitAndRead()).result;
      assert.equal(jobs.length, submitted+1);
      assert.equal(jobs.at(-1).mode, mode);
      assert.deepEqual(jobs.at(-1).images, band.map(f => f.xyz));
      assert.equal(jobs.at(-1).dsafir, undefined);
      assert.deepEqual(jobs.at(-1).atomIds, source.atomIds);
      assert.deepEqual(relaxed.images[0], source.images[0]);
      assert.deepEqual(relaxed.images.at(-1), source.images.at(-1));
      assert.equal(relaxed.energies.length, nodes);
      assert.equal(relaxed.mode, mode);
      assert.equal(relaxed.converged, true, mode + ' should converge for proton transfer');
      assert.ok(relaxed.effectiveFmax <= jobs.at(-1).fmax);
      assert.ok(Math.max(...relaxed.energies) < Math.max(...source.energies) - .04,
        'On this proton-transfer surface, relaxation lowers the initial high-energy path');
    }
    await page.selectOption('#engineMode', 'dsafir');
    const otherSource = (await submitAndRead()).result;
    assert.equal(otherSource.dsafir.connected, true);
    const alternateURL = 'http://127.0.0.1:8777';
    alternateEngine = spawn(process.env.PYTHON || 'python', [
      path.join(root, 'local-engine/bridge.py'), '--engine', 'tblite', '--method', 'GFN1-xTB',
      '--port', '8777', '--allow-origin', url, '--no-history'
    ], {env: {...process.env, OMP_NUM_THREADS:'1', OPENBLAS_NUM_THREADS:'1'}});
    const altToken = await startupToken(alternateEngine);
    await page.fill('#engineURL', alternateURL);
    await page.fill('#engineToken', altToken);
    await page.click('#engineConnect');
    await page.waitForFunction(() => document.getElementById('engineConnected').textContent.includes('GFN1-xTB'));
    const submissions = jobs.length;
    assert.equal(await page.locator('#dsafirRelaxPotential').inputValue(), 'source');
    await handoff.click();
    assert.match(await page.locator('#dsafirRelaxHelp').textContent(), /同じ計算エンジン・モデル/);
    assert.equal(jobs.length, submissions);
    await page.selectOption('#dsafirRelaxPotential', 'current');
    await page.selectOption('#dsafirRelaxMode', 'neb');
    await page.fill('#dsafirRelaxCount', '10');
    await handoff.click();
    assert.equal(await page.locator('#engineMode').inputValue(), 'neb');
    assert.equal(jobs.length, submissions);
    const crossReport = await submitAndRead(), cross = crossReport.result;
    assert.equal(JSON.stringify(crossReport).includes(altToken), false);
    assert.equal(cross.method, 'GFN1-xTB');
    assert.deepEqual(cross.images[0], otherSource.images[0]);
    assert.deepEqual(cross.images.at(-1), otherSource.images.at(-1));
    // Verify the entire reported profile against fresh GFN1 single points.
    const submittedEvaluation = await page.request.post(alternateURL + '/api/jobs', {
      headers:{Authorization:'Bearer '+altToken}, data:{mode:'evaluate', symbols:cross.symbols,
        charge:cross.charge, multiplicity:cross.multiplicity, images:cross.images}
    });
    assert.ok(submittedEvaluation.ok());
    const evalId = (await submittedEvaluation.json()).id;
    let reference;
    for (let i = 0; i < 100; i++) {
      const response = await page.request.get(alternateURL + '/api/jobs/' + evalId, {
        headers:{Authorization:'Bearer '+altToken}
      });
      const state = await response.json();
      if (state.status === 'completed') {reference = state.result; break;}
      assert.ok(['queued','starting','running'].includes(state.status), state.error || state.status);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(reference && reference.energies.length === cross.energies.length);
    cross.energies.forEach((value,i) => assert.ok(Math.abs(value-reference.energies[i])<1e-5));
    assert.ok(Math.abs(otherSource.energies[0]-cross.energies[0])>1e-4);
    assert.deepEqual(errors, []);
    console.log('DS-AFIR: paths and data handoff, three explicit relaxations, and alternate GFN1 potential verified.');
  } finally {
    try { await browser?.close(); } finally { engine.kill(); alternateEngine?.kill(); }
  }
}
run().catch(error => {console.error(error); process.exitCode = 1;});
