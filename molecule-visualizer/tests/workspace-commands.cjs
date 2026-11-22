// Navigate through the same controls a user operates; keep requested panels explicit.
async function openDetails(page, selector) {
  const disclosure = page.locator(selector);
  if (!await disclosure.evaluate(element => element.open))
    await disclosure.locator(':scope > summary').click();
}

async function clickWorkspaceCommand(page, selector) {
  const command = page.locator(selector);
  const menu = command.locator('xpath=ancestor::details[1]');
  if (!await menu.evaluate(element => element.open))
    await menu.locator(':scope > summary').click();
  await command.click();
}

async function openInspector(page, section) {
  const tab = page.locator('#inspector-tab-' + section);
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
}

async function openCalculationPane(page, section) {
  const tabs = {setup:'engineTabSetup', connection:'engineTabConnection', results:'engineTabResults'};
  if (!tabs[section]) throw Error('Unknown calculation tab: ' + section);
  const tab = page.locator('#' + tabs[section]);
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
}

module.exports = {clickWorkspaceCommand, openDetails, openInspector, openCalculationPane};
