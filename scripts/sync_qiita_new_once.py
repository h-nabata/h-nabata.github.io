#!/usr/bin/env python3
"""Add newly published public Qiita articles without modifying existing mirrors."""
import datetime, gzip, hashlib, json, re
from pathlib import Path
from urllib.parse import urlparse, unquote, urljoin
from lxml import html as lh
from sync_qiita import get, put, category

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).isoformat(timespec='seconds')
entries_path = ROOT / '_data/qiita_articles.json'
entries = json.loads(entries_path.read_text(encoding='utf-8'))
old_ids = {e['qiita_id'] for e in entries}
items = []
for page in range(1,100):
    batch = json.loads(get(f'https://qiita.com/api/v2/users/h-nabata/items?per_page=100&page={page}'))
    items.extend(a for a in batch if a['user']['id']=='h-nabata' and not a['private'])
    if len(batch)<100: break
new = [a for a in items if a['id'] not in old_ids]
print('public:',len(items),'existing:',len(old_ids),'new:',len(new),flush=True)
for a in new: print(a['id'],a['title'],flush=True)
if not new: raise SystemExit('No new public articles')
if len({a['id'] for a in items}) != len(items): raise ValueError('duplicate API ids')
manifest_path = ROOT/'qiita/backup/manifest.json'
manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
image_map=manifest['images']
urls=sorted(set(re.findall(r'<img[^>]+src="([^"]+)"','\n'.join(a['rendered_body'] for a in new))))
for u in urls:
    if u in image_map and (ROOT/image_map[u].lstrip('/')).exists(): continue
    data=get(u)
    if not data: raise ValueError('empty image: '+u)
    ext=Path(urlparse(u).path).suffix.lower()
    if ext not in ['.png','.jpg','.jpeg','.gif','.svg','.webp']: ext='.png'
    path='assets/qiita/images/'+hashlib.sha256(u.encode()).hexdigest()[:24]+ext
    p=ROOT/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
    image_map[u]='/'+path
    print('image',path,len(data),flush=True)
own_urls={e['qiita_url']:e['url'] for e in entries}
own_urls.update({a['url']:'/qiita/'+a['id']+'.html' for a in new})
for a in new:
    ident=a['id']; tags=[t['name'] for t in a['tags']]; cat=category(a)
    put(f'qiita/backup/{ident}.md.txt',a['body'])
    doc=lh.fragment_fromstring(a['rendered_body'],create_parent='div')
    for img in doc.xpath('.//img[@src]'):
        original=img.get('data-canonical-src',img.get('src'))
        src=img.get('src')
        img.set('src',image_map.get(original,image_map.get(src,src)))
        img.attrib.pop('srcset',None);img.set('loading','lazy');img.set('decoding','async')
    for iframe in doc.xpath('.//iframe'):
        data=iframe.get('data-content','');src=iframe.get('src','')
        if '/mermaid' in src:
            node=lh.Element('pre',{'class':'mermaid'});node.text=json.loads(data)['data']
        elif '/link-card' in src:
            link=unquote(data);node=lh.Element('a',{'href':link,'class':'mirror-link-card'});node.text=link
        else:
            node=lh.Element('a',{'href':urljoin(a['url'],src),'class':'mirror-link-card'});node.text='埋め込みコンテンツを元サイトで開く'
        node.tail=iframe.tail;iframe.getparent().replace(iframe,node)
    for link in doc.xpath('.//a[@href]'):
        href=link.get('href');base,sep,fragment=href.partition('#')
        if base in own_urls: link.set('href',own_urls[base]+(sep+fragment if sep else ''))
        elif href in image_map: link.set('href',image_map[href])
    body=''.join(lh.tostring(e,encoding='unicode') for e in doc)
    body=body.replace('{% endraw %}','&#123;% endraw %&#125;')
    front={'layout':'qiita-mirror','title':a['title'],'qiita_id':ident,'qiita_url':a['url'],'qiita_created':a['created_at'],'qiita_updated':a['updated_at'],'mirror_saved':NOW,'mirror_category':cat,'mirror_tags':tags,'permalink':f'/qiita/{ident}.html'}
    fm='---\n'+'\n'.join(k+': '+json.dumps(v,ensure_ascii=False) for k,v in front.items())+'\n---\n'
    put(f'qiita/{ident}.html',fm+'{% raw %}\n<div class="it-MdContent co-Item_text">\n'+body+'\n</div>\n{% endraw %}\n')
    entries.append({**front,'url':front['permalink']})
entries.sort(key=lambda a:a['qiita_created'],reverse=True)
put('_data/qiita_articles.json',json.dumps(entries,ensure_ascii=False,indent=2))
archive=ROOT/'qiita/backup/items.json.gz'
existing=json.loads(gzip.decompress(archive.read_bytes()))
assert {a['id'] for a in existing} == old_ids
combined=existing+new
combined.sort(key=lambda a:a['created_at'],reverse=True)
archive.write_bytes(gzip.compress(json.dumps(combined,ensure_ascii=False,indent=2).encode(),mtime=0))
manifest['article_count']=len(entries)
manifest['image_count']=len(image_map)
manifest['last_added_at']=NOW
manifest['snapshot_note']='既存記事は以前の取得時点を保持し、新規記事のみlast_added_atに追加'
put('qiita/backup/manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2))
p=ROOT/'qiita/index.html'
s=p.read_text(encoding='utf-8')
s=re.sub(r'一覧更新: <time datetime="[^"]+">[^<]+</time>',f'一覧更新: <time datetime="{NOW[:10]}">{NOW[:10].replace("-","/")}</time>',s)
p.write_text(s,encoding='utf-8')
print('completed:',len(entries),'articles',flush=True)
