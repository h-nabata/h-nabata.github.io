document.addEventListener('DOMContentLoaded', async () => {
  const candidates=[...document.querySelectorAll('a[href]')].filter(a=>{
    if(a.closest('header,nav,footer,.top-wrapper,.mirror-article-header,.mirror-cards,.site-search-results,pre,code') || a.hasAttribute('download') || a.dataset.ogp==='off') return false;
    if(a.matches('.mirror-link-card,[data-ogp="card"]')) return true;
    const p=a.parentElement;
    return p.tagName==='P' && p.children.length===1 && p.textContent.trim()===a.getAttribute('href') && /^https?:\/\//.test(a.getAttribute('href'));
  });
  if(!candidates.length)return;
  let cache;
  try {const res=await fetch('/assets/ogp/link-cache.json');if(!res.ok)return;cache=await res.json();} catch(e){return;}
  for(const a of candidates){
    let url;try{url=new URL(a.href);}catch(e){continue;}
    if(!['https:','http:'].includes(url.protocol))continue;
    const key=url.origin===location.origin?url.pathname:url.href;
    const data=cache[key]||cache[url.href.split('#')[0]];
    if(!data?.title)continue; // Keep the existing link when metadata is unavailable.
    const body=document.createElement('span');body.className='ogp-card__body';
    for(const [name,text] of [['title',data.title],['description',data.description],['domain',url.hostname]]){
      if(!text)continue;const span=document.createElement('span');span.className='ogp-card__'+name;span.textContent=text;body.append(span);
    }
    a.replaceChildren(body);a.classList.add('ogp-card');
    if(a.target==='_blank')a.rel='noopener noreferrer';
    if(data.image && data.image.startsWith('/') && !data.image.startsWith('//')){
      const img=document.createElement('img');img.className='ogp-card__image';img.alt='';img.loading='lazy';img.decoding='async';img.src=data.image;img.addEventListener('error',()=>img.remove(),{once:true});a.append(img);
    }
  }
});
