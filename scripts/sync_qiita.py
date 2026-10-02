#!/usr/bin/env python3
"""Snapshot h-nabata's public Qiita articles; run from repository root.
Uses only Python stdlib plus lxml for preserving rendered HTML.
Never deletes older snapshots/pages. No API token is needed for public items.
"""
import concurrent.futures, datetime, gzip, hashlib, html, json, re, urllib.request
from pathlib import Path
from urllib.parse import urlparse, unquote, urljoin
from lxml import html as lh

ROOT = Path(__file__).resolve().parents[1]
USER = 'h-nabata'
NOW = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).isoformat(timespec='seconds')
DATE = NOW[:10]
def get(url):
    req = urllib.request.Request(url, headers={'User-Agent':'h-nabata-article-backup/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r: return r.read()
def put(path, text):
    p=ROOT/path; p.parent.mkdir(parents=True,exist_ok=True); p.write_text(text,encoding='utf-8')
def category(a):
    tags={t['name'].lower() for t in a['tags']}; title=a['title'].lower()
    if '出版社' in title: return '研究・論文執筆'
    if any(t in tags for t in ['llm','ローカルllm','ollama','llm-jp']) or any(s in title for s in ['llm','deepseek','mcp']): return 'LLM・生成AI'
    if any(s in title for s in ['nnp','uma','orbmol','grrm','化学','結晶','スラブ','xyz','smiles','chemdraw','psi4','openbabel','rdkit','rdkit']): return '計算化学・分子構造'
    if any(s in title for s in ['linux','wsl','gcc','ssh','mobaxterm','rename']): return '計算環境・Linux'
    return 'プログラミング・可視化'
def css_blocks(s):
    start=0; depth=0; quote=None; escape=False
    for i,c in enumerate(s):
        if quote:
            if escape: escape=False
            elif c=='\\': escape=True
            elif c==quote: quote=None
        elif c in "\"'": quote=c
        elif c=='{': depth+=1
        elif c=='}':
            depth-=1
            if depth==0:
                yield s[start:i+1]; start=i+1
def article_css(s):
    out=[]
    for b in css_blocks(s):
        h,body=b.split('{',1); body=body[:-1]; h=re.sub(r'/\*.*?\*/','',h,flags=re.S).strip()
        if h.startswith('@media'):
            inner=article_css(body)
            if inner: out.append(h+'{'+inner+'}')
        elif h==':root': out.append('.qiita-mirror{'+body+'}')
        elif '.it-MdContent' in h or '.co-Item_text .highlight' in h:
            out.append(','.join('.qiita-mirror '+x.strip() for x in h.split(','))+'{'+body+'}')
    return '\n'.join(out)
def main():
    items=[]
    for page in range(1,100):
        batch=json.loads(get(f'https://qiita.com/api/v2/users/{USER}/items?per_page=100&page={page}'))
        items.extend(a for a in batch if a['user']['id']==USER and not a['private'])
        if len(batch)<100: break
    items.sort(key=lambda a:a['created_at'],reverse=True)
    archive=ROOT/'qiita/backup/items.json.gz';archive.parent.mkdir(parents=True,exist_ok=True);archive.write_bytes(gzip.compress(json.dumps(items,ensure_ascii=False,indent=2).encode(),mtime=0))
    # Keep Qiita's article styles scoped so they do not reset the site's header.
    source=get(items[0]['url']).decode()
    css_url=next(u for u in re.findall(r'<link[^>]+href="([^"]+\.css[^\"]*)"',source) if 'cdn.qiita.com/assets/public/article-' in u)
    original=get(css_url).decode()
    put('qiita/backup/qiita-article-original.css',original)
    put('assets/qiita-original.css','/* Article rules extracted from '+css_url+'; retrieved '+NOW+' */\n'+article_css(original))
    urls=sorted(set(re.findall(r'<img[^>]+src="([^"]+)"','\n'.join(a['rendered_body'] for a in items))))
    image_map={}; failures=[]
    def download(u):
        try:
            d=get(u); ext=Path(urlparse(u).path).suffix.lower()
            if ext not in ['.png','.jpg','.jpeg','.gif','.svg','.webp']: ext='.png'
            path='assets/qiita/images/'+hashlib.sha256(u.encode()).hexdigest()[:24]+ext
            p=ROOT/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(d)
            return u,'/'+path,None
        except Exception as e: return u,u,str(e)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for u,path,error in pool.map(download,urls):
            image_map[u]=path
            if error: failures.append({'url':u,'error':error})
    entries=[]
    for a in items:
        ident=a['id']; tags=[t['name'] for t in a['tags']]; cat=category(a)
        put(f'qiita/backup/{ident}.md.txt',a['body'])
        doc=lh.fragment_fromstring(a['rendered_body'],create_parent='div')
        for img in doc.xpath('.//img[@src]'):
            original=img.get('data-canonical-src',img.get('src'));img.set('src',image_map.get(original,original));img.attrib.pop('srcset',None);img.set('loading','lazy');img.set('decoding','async')
        for iframe in doc.xpath('.//iframe'):
            data=iframe.get('data-content','');src=iframe.get('src','')
            if '/mermaid' in src:
                node=lh.Element('pre',{'class':'mermaid'});node.text=json.loads(data)['data']
            elif '/link-card' in src:
                link=unquote(data);node=lh.Element('a',{'href':link,'class':'mirror-link-card'});node.text=link
            else:
                node=lh.Element('a',{'href':urljoin(a['url'],src),'class':'mirror-link-card'});node.text='埋め込みコンテンツを元サイトで開く'
            node.tail=iframe.tail;iframe.getparent().replace(iframe,node)
        own_urls={item['url']:'/qiita/'+item['id']+'.html' for item in items}
        for link in doc.xpath('.//a[@href]'):
            href=link.get('href');base,sep,fragment=href.partition('#')
            if base in own_urls: link.set('href',own_urls[base]+(sep+fragment if sep else ''))
            elif href in image_map: link.set('href',image_map[href])
        body=''.join(lh.tostring(e,encoding='unicode') for e in doc)
        # Jekyll Liquid must never interpret code or templates in the original article.
        body=body.replace('{% endraw %}','&#123;% endraw %&#125;')
        front={'layout':'qiita-mirror','title':a['title'],'qiita_id':ident,'qiita_url':a['url'],'qiita_created':a['created_at'],'qiita_updated':a['updated_at'],'mirror_saved':NOW,'mirror_category':cat,'mirror_tags':tags,'permalink':f'/qiita/{ident}.html'}
        fm='---\n'+'\n'.join(k+': '+json.dumps(v,ensure_ascii=False) for k,v in front.items())+'\n---\n'
        put(f'qiita/{ident}.html',fm+'{% raw %}\n<div class="it-MdContent co-Item_text">\n'+body+'\n</div>\n{% endraw %}\n')
        entries.append({**front,'url':front['permalink']})
    put('_data/qiita_articles.json',json.dumps(entries,ensure_ascii=False,indent=2))
    manifest={'user':USER,'retrieved_at':NOW,'article_count':len(items),'image_count':len(urls),'image_failures':failures,'images':image_map,'css_source':css_url}
    put('qiita/backup/manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2))
    print(json.dumps({k:v for k,v in manifest.items() if k not in ['images']},ensure_ascii=False))
if __name__=='__main__':main()
