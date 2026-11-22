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
  let browser;
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
    assert.deepEqual(errors, []);
    console.log('DS-AFIR: endpoint selection, focused settings, partial and joined paths, JSON, applied geometry/IDs, desktop/mobile controls passed.');
  } finally {
    try { await browser?.close(); } finally { engine.kill(); }
  }
}
run().catch(error => {console.error(error); process.exitCode = 1;});
