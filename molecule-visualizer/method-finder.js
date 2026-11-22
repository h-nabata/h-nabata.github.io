document.addEventListener('DOMContentLoaded', () => {
  const menu = document.getElementById('workspaceMethodChooser');
  const search = document.getElementById('methodSearch');
  const input = document.getElementById('methodInput');
  const status = document.getElementById('methodFilterStatus');
  const sections = [...menu.querySelectorAll('#methodCatalog > section')];

  function normalize(text) {
    return text.normalize('NFKC').toLowerCase().replace(/[\s()\-‐‑‒–—−]/gu, '');
  }
  const methods = sections.flatMap(section => {
    const heading = section.querySelector('h2').textContent;
    return [...section.querySelectorAll('button')].map(button => ({
      button,
      inputs: button.dataset.inputs.split(' '),
      text: normalize([button.textContent, heading, button.dataset.keywords || ''].join(' '))
    }));
  });
  function filter() {
    const terms = search.value.trim().split(/\s+/u).map(normalize).filter(Boolean);
    let count = 0;
    for (const method of methods) {
      const matchesInput = input.value === 'all' || method.inputs.includes(input.value);
      method.button.hidden = !matchesInput || !terms.every(term => method.text.includes(term));
      if (!method.button.hidden) count++;
    }
    sections.forEach(section => { section.hidden = !section.querySelector('button:not([hidden])'); });
    if (!count) status.textContent = '該当する手法がありません。構造の種類や検索語を変更してください。';
    else status.textContent = terms.length || input.value !== 'all' ? count + '件の手法' : '';
  }
  input.addEventListener('change', filter);
  search.addEventListener('input', filter);
  menu.addEventListener('toggle', () => {
    if (!menu.open) {
      search.value = '';
      input.value = 'all';
      filter();
    }
  });
  menu.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
    const fromSearch = event.target === search;
    if ((!fromSearch || event.key !== 'Enter') && !['ArrowDown','ArrowUp'].includes(event.key)) return;
    const choices = methods.map(method => method.button).filter(button => !button.hidden && !button.disabled);
    const index = choices.indexOf(event.target);
    if ((!fromSearch && index < 0) || !choices.length) return;
    event.preventDefault();
    if (fromSearch && event.key === 'Enter' && choices.length === 1) choices[0].click();
    else if (event.key === 'ArrowUp') (index <= 0 ? search : choices[index-1]).focus();
    else choices[Math.min(index+1, choices.length-1)].focus();
  });
  document.getElementById('methodFilters').hidden = false;
});
