// Exercise an actual GFN2-xTB saddle from import through both IRC branches and result application.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { startupToken } = require('./native-bridge-test.cjs');
const { openCalculationPane, openDetails } = require('./workspace-commands.cjs');

async function compute(page, mode) {
  await openCalculationPane(page, 'setup');
  await page.selectOption('#engineMode', mode);
  await page.fill('#engineMultiplicity', '2');
  await page.uncheck('#engineLive');
  if (mode === 'vibrations') {
    await openDetails(page, '#engineAdditionalOptions');
    await page.click('#gammaThermoSettings summary');
    await page.check('#gammaThermoEnabled');
    await page.fill('#gammaTemperature', '310');
    await page.fill('#gammaCutoff', '40');
  } else {
    await openDetails(page, '#engineNumericOptions');
    await page.fill('#engineFmax', '.009');
    await page.fill('#engineSteps', '70');
    await page.fill('#ircStepSize', '.15');
    await page.fill('#ircGammaThreshold', '30');
  }
  const [sent] = await Promise.all([
    page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/api/jobs')),
    page.click('#engineRun')
  ]);
  const request = sent.postDataJSON();
  assert.equal(request.fixedAtoms.length, 8);
  assert.equal(request.mode, mode);
  await page.waitForFunction(() => !MoleculeVisualizer.EngineUI.isBusy(), {}, {timeout: 160000});
  assert.equal(await page.locator('#engineResult').evaluate(e => e.hidden), false,
               await page.locator('#engineMessage').textContent());
  await openCalculationPane(page, 'results');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#engineDownload')]);
  return JSON.parse(await fs.readFile(await download.path(), 'utf8'));
}

async function run() {
  const root = path.resolve(__dirname, '..'), port = String(process.env.PERIODIC_IRC_PORT || 8947);
  const url = 'http://127.0.0.1:' + port;
  const service = spawn(process.env.PYTHON || 'python', ['-u', path.join(root, 'local-engine/bridge.py'),
    '--engine', 'tblite', '--port', port, '--site-dir', root, '--no-history'],
    {env: {...process.env, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1'}});
  let browser;
  try {
    const token = await startupToken(service);
    browser = await chromium.launch({headless: true});
    const page = await browser.newPage({viewport: {width: 1280, height: 950}});
    await page.goto(url);
    await page.locator('#fileInput').setInputFiles(path.join(root, 'examples/graphene-li-surface-ts.vasp'));
    await page.waitForFunction(() => MoleculeVisualizer.App.getState().atoms.length === 9);
    await page.click('#btnExternalEngine');
    await openCalculationPane(page, 'connection');
    await page.fill('#engineURL', url);
    await page.fill('#engineToken', token);
    await page.click('#engineConnect');
    await page.waitForFunction(() => document.getElementById('engineConnected').textContent.includes('接続済み'));
    const v = (await compute(page, 'vibrations')).result.vibrations;
    assert.equal(v.spectrum, 'gamma');
    assert.equal(v.modes.length, 3);
    assert.equal(v.significantImaginaryCount, 1);
    assert.equal(v.harmonicThermo.temperatureK, 310);
    assert.equal(v.harmonicThermo.cutoffCM, 40);
    assert.equal(v.harmonicThermo.includedModes, 2);
    assert.match(await page.locator('#researchResult').textContent(), /310 K/);
    const {input, result} = await compute(page, 'irc');
    assert.equal(input.irc.imaginaryThreshold, 30);
    assert.equal(result.converged, true);
    assert.ok(['forward','reverse'].every(d => result.branches[d].endpointVerifiedMinimum));
    for (const xyz of result.images) assert.deepEqual(xyz.slice(0, 8), input.images[0].slice(0, 8));
    await page.click('#engineApply');
    const count = await page.evaluate(() => MoleculeVisualizer.App.getState().metadata.trajectory.length);
    assert.equal(count, result.images.length);
    console.log('Periodic GFN2-xTB Γ modes, harmonic quantities, frozen-substrate IRC and trajectory passed.');
  } finally {
    service.kill();
    await browser?.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
