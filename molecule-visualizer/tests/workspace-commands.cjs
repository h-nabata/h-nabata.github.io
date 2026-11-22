// Follow the same menu path as a user before invoking a workspace command.
async function clickWorkspaceCommand(page, selector) {
  const command = page.locator(selector);
  const menu = command.locator('xpath=ancestor::details[1]');
  if (!await menu.evaluate(element => element.open)) {
    await menu.locator(':scope > summary').click();
  }
  await command.click();
}
module.exports = {clickWorkspaceCommand};
