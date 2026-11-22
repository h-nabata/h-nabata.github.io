// Exercise the history button through the panel that already owns the polling loop.
const assert = require('node:assert/strict');
const {openCalculationPane, openInspector, openDetails} = require('./workspace-commands.cjs');

module.exports = async function trackedJobHistory(browser) {
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const other = 'f'.repeat(32);
  const rows = new Map([[other, {id:other, mode:'optimize', status:'queued'}]]);
  const created = [], detailRequests = [];
  let id;
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url());
    const headers = {'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'Authorization, Content-Type', 'Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
    if (req.method() === 'OPTIONS') return route.fulfill({status:204, headers});
    let data;
    if (url.pathname === '/api/info') {
      data = {version:'1.18.0', engine:'tblite', method:'GFN2-xTB', modes:['evaluate','optimize','dsafir','afir','vibrations'], maxSteps:10000, maxImages:100, maxAFIRSteps:10000, vibrations:true, jobQueue:true, persistentHistory:true, compactPolling:1};
    } else if (url.pathname === '/api/runtime') {
      data = {runningId:id, queuedCount:1};
    } else if (url.pathname === '/api/jobs' && req.method() === 'POST') {
      const input = req.postDataJSON();
      created.push(input);
      id = created.length.toString(16).padStart(32,'0');
      data = {id, mode:input.mode, status:'running', progress:{step:2}, data:input};
      rows.set(id,data);
    } else if (url.pathname === '/api/jobs') {
      data = {jobs:[...rows.values()].map(({id,mode,status}) => ({id,mode,status}))};
    } else {
      const parts = url.pathname.split('/');
      data = rows.get(parts[3]);
      assert.ok(data, 'unknown job URL '+url.pathname);
      if (parts[4] === 'cancel') data.status = 'cancelled';
      else if (!url.search) detailRequests.push(parts[3]);
    }
    await route.fulfill({headers, json:data});
  });

  const track = job => page.locator('[data-job-id="'+job+'"]').getByRole('button',{name:'進捗を追跡'});
  async function checkRows() {
    await track(other).click();
    assert.ok(await page.locator('#jobHistoryDialog').isVisible());
    assert.match(await page.locator('#jobHistoryMessage').innerText(), /別の計算/);
    await track(id).click();
    assert.equal(await page.locator('#jobHistoryDialog').isVisible(),false);
  }
  async function openHistoryAndTrack() {
    await page.click('#engineHistory');
    await checkRows();
  }

  try {
    await page.goto('http://127.0.0.1:8765/molecule-visualizer/');
    await page.click('#btnExternalEngine');
    await page.uncheck('#engineLive');
    await page.click('#enginePanelConnect');
    await page.fill('#engineToken','local-test');
    await page.click('#engineConnect');
    await page.waitForFunction(() => !!MoleculeVisualizer.EngineUI.getConnection());
    await page.selectOption('#engineMode','optimize');
    await page.click('#engineRun');
    await page.waitForFunction(() => document.getElementById('engineMessage').textContent.includes('ステップ'));
    await openCalculationPane(page,'setup');
    await page.selectOption('#engineMode','dsafir');
    await openDetails(page,'#engineDSAFIRSettings > details');
    await page.fill('#dsafirDelta','2.75');
    assert.ok(await page.locator('#engineActivityStatus').isVisible());
    assert.match(await page.locator('#engineActivityStatus').innerText(), /単一構造の最適化.*実行中/);
    assert.match(await page.locator('#enginePanelMethod').innerText(), /DS-AFIR/);
    await openHistoryAndTrack();
    assert.ok(await page.locator('#enginePaneResults').isVisible());
    assert.equal(await page.locator('#enginePanelMethod').innerText(),'単一構造の最適化');
    await openCalculationPane(page,'setup');
    assert.equal(await page.locator('#engineMode').inputValue(),'dsafir');
    assert.equal(await page.locator('#dsafirDelta').inputValue(),'2.75');
    await openCalculationPane(page,'results');
    await page.click('#engineCancel');
    await page.waitForFunction(() => !MoleculeVisualizer.EngineUI.isBusy());
    await page.click('#engineClose');

    await page.evaluate(() => {
      const M = MoleculeVisualizer;
      M.App.change('AFIR history fixture', state => {
        const atoms = state.atoms, config = M.AFIR.defaults();
        config.fragments = [{id:'a',label:'A',atomIds:[atoms[0].id]}, {id:'b',label:'B',atomIds:[atoms[1].id]}];
        config.pairs = [{a:'a',b:'b',mode:'attract',gamma:0}];
        state.metadata.afir = config;
      });
    });
    await openInspector(page,'afir');
    await page.uncheck('#afirLive'); await page.click('#afirRun');
    await page.waitForFunction(() => document.getElementById('afirStatus').textContent.includes('AFIR探索中'));
    await openInspector(page,'coordinates');
    await page.click('#btnJobHistory');
    await checkRows();
    assert.ok(await page.locator('#afirStatus').isVisible());
    assert.equal(await page.evaluate(() => document.activeElement.id),'afirStatus');
    assert.equal(await page.locator('#engineDialog').isVisible(),false);
    await page.click('#afirCancel');
    await page.waitForFunction(() => !MoleculeVisualizer.AFIRUI.isBusy());

    await page.click('#btnExternalEngine');
    await page.selectOption('#engineMode','optimize');
    await openDetails(page,'details:has(> #engineSavedSettings)');
    await openDetails(page,'#workflowPanel');
    await page.click('#workflowRun');
    await page.waitForFunction(() => document.getElementById('workflowMessage').textContent.includes('ステップ'));
    await openHistoryAndTrack();
    assert.equal(await page.evaluate(() => document.activeElement.id),'workflowMessage');
    assert.ok(await page.locator('#workflowMessage').isVisible());
    await page.click('#workflowCancel');
    await page.waitForFunction(() => !MoleculeVisualizer.WorkflowUI.isBusy());
    assert.deepEqual(created.map(job => job.mode), ['optimize','afir','optimize']);
    assert.deepEqual(detailRequests, [], 'already-tracked rows must not fetch saved data or start a second tracker');
  } finally {
    await page.close();
  }
};
