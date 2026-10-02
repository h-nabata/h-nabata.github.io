document.addEventListener('DOMContentLoaded', async () => {
  const article = document.getElementById('mirror-article');
  if (article) {
    const toc = document.getElementById('mirror-toc-list');
    const ul = document.createElement('ul');
    article.querySelectorAll('h1,h2,h3').forEach((h,i) => {
      const id=h.querySelector('.fragment[id]')?.id || h.id || `mirror-heading-${i}`;
      if (!h.id && !h.querySelector('.fragment[id]')) h.id=id;
      const li=document.createElement('li');
      if (h.tagName==='H3') li.className='toc-sub';
      const a=document.createElement('a');a.href='#'+encodeURIComponent(id);a.textContent=h.textContent.trim();li.append(a);ul.append(li);
    });
    toc.append(ul);
    if (!ul.children.length) toc.parentElement.hidden=true;
    if (typeof window.renderMathInElement==='function') window.renderMathInElement(article,{delimiters:[{left:'$$',right:'$$',display:true},{left:'\\[',right:'\\]',display:true},{left:'\\(',right:'\\)',display:false},{left:'$',right:'$',display:false}],throwOnError:false});
    if (article.querySelector('.mermaid')) {
      try { const {default:mermaid}=await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'default'});await mermaid.run({nodes:article.querySelectorAll('.mermaid')}); } catch(e) { console.warn('Mermaid diagram source is preserved.',e); }
    }
  }
  const input=document.getElementById('mirror-query');
  if(input) {
    const cards=[...document.querySelectorAll('.mirror-card')];
    const filter=()=>{const words=input.value.normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);let n=0;cards.forEach(c=>{c.hidden=!words.every(w=>c.dataset.search.normalize('NFKC').toLowerCase().includes(w));if(!c.hidden)n++;});document.querySelectorAll('.mirror-category-section').forEach(s=>s.hidden=![...s.querySelectorAll('.mirror-card')].some(c=>!c.hidden));document.getElementById('mirror-filter-status').textContent=`${cards.length}記事中 ${n}件を表示`;};input.addEventListener('input',filter);filter();
  }
});
