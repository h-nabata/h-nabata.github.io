#!/usr/bin/env python3
"""Build page descriptions and cached link cards. Run after sync_qiita.py.
Requires Python 3, PyYAML and lxml. Only public HTTP(S) targets are fetched.
Existing successful cache entries survive unavailable external sites.
"""
import concurrent.futures, hashlib, ipaddress, json, re, socket, urllib.request
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urldefrag
import yaml
from lxml import html
ROOT=Path(__file__).resolve().parents[1]
SITE='https://h-nabata.github.io'
DEFAULT_IMAGE='/top.png'
DESCRIPTIONS={
    '/':'Hitoshi Nabataの個人ホームページ。計算化学・反応経路探索、プログラミング、ローカルLLMの研究・技術ノートを掲載しています。',
    '/toc.html':'研究・技術ノート、GRRM関連ツール、分子構造エディタ、Qiita記事ミラーへのリンクをまとめた目次です。',
    '/grrm-tips.html':'反応経路自動探索プログラムGRRMの利用上の注意点、入力設定、計算環境に関する技術メモです。',
    '/mynote.html':'計算化学・プログラミング・論文執筆などの参考資料と備忘録をまとめています。',
    '/search.html':'ホームページ内の技術ノート、ツール、Qiita記事ミラーを検索できます。',
    '/qiita/':'筆者のQiita公開記事を分野別に整理したミラーです。本文・画像・原文Markdownをバックアップしています。'
}

def safe_url(url):
    p=urlsplit(url)
    if p.scheme not in ('http','https') or not p.hostname or p.username or p.password or p.port not in (None,80,443):raise ValueError('Not a public HTTP(S) URL')
    host=p.hostname.lower().rstrip('.')
    if '.' not in host or host.endswith(('.local','.localhost','.internal','.lan','.test','.invalid','.example')):raise ValueError('Non-public hostname')
    try: literal=ipaddress.ip_address(host)
    except ValueError: literal=None
    if literal is not None and not literal.is_global:raise ValueError('Non-public address')
    # A configured HTTP proxy resolves public hostnames itself.
    if not urllib.request.getproxies().get(p.scheme):
        addresses=socket.getaddrinfo(host,p.port or (443 if p.scheme=='https' else 80),type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(x[4][0]).is_global for x in addresses):raise ValueError('Non-public address')
    return url
class PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        safe_url(newurl)
        return super().redirect_request(req,fp,code,msg,headers,newurl)
opener=urllib.request.build_opener(PublicRedirect())
def get(url,limit):
    safe_url(url)
    with opener.open(urllib.request.Request(url,headers={'User-Agent':'h-nabata-ogp-cache/1.0'}),timeout=12) as r:
        data=r.read(limit+1)
        if len(data)>limit:raise ValueError('Response too large')
        return data,r.url,r.headers.get_content_type()
def clean(text,limit):return re.sub(r'\s+',' ',text or '').strip()[:limit]
def page(path):
    raw=path.read_text(encoding='utf-8');front={}
    if raw.startswith('---\n'):
        _,fm,raw=raw.split('---',2);front=yaml.safe_load(fm) or {}
    doc=html.fromstring(raw or '<div></div>')
    for el in doc.xpath('//script|//style|//nav|//footer|//header|//pre|//code|//*[contains(concat(" ",normalize-space(@class)," ")," top-wrapper ")]'):
        if el.getparent() is not None:el.getparent().remove(el)
    title=front.get('title') or clean(' '.join(doc.xpath('//title/text()')),160) or path.stem
    description=front.get('description') or clean(' '.join(' '.join(p.itertext()) for p in doc.xpath('//p') if ' '.join(p.itertext()).strip() and not re.match(r'^https?://\S+$',' '.join(p.itertext()).strip())),180)
    description=description or 'Hitoshi Nabataの研究・技術ノート。'+title
    image=front.get('ogp_image') or DEFAULT_IMAGE
    if front.get('qiita_id'):
        first=doc.xpath('//img[starts-with(@src,"/assets/qiita/images/")]/@src')
        if first and not first[0].lower().endswith('.gif'):image=first[0]
    rel=path.relative_to(ROOT).as_posix()
    url=front.get('permalink') or ('/'+rel[:-10] if rel.endswith('index.html') else '/'+rel)
    return url,{'title':title,'description':front.get('description') or DESCRIPTIONS.get(url,description),'image':image},doc

def metadata(url):
    data,final,kind=get(url,2_000_000)
    if kind not in ('text/html','application/xhtml+xml'):raise ValueError('Not HTML')
    d=html.fromstring(data)
    def meta(*names):
        for name in names:
            values=d.xpath('//meta[@property=$n or @name=$n]/@content',n=name)
            if values and values[0].strip():return values[0]
        return ''
    title=clean(meta('og:title','twitter:title') or ' '.join(d.xpath('//title/text()')),200)
    if not title:raise ValueError('No title')
    result={'title':title,'description':clean(meta('og:description','twitter:description','description'),240)}
    image=meta('og:image','twitter:image')
    if image:
        try:
            image_url=urljoin(final,image);blob,_,mime=get(image_url,3_000_000)
            ext={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif'}.get(mime)
            if ext:
                name=hashlib.sha256(image_url.encode()).hexdigest()[:24]+ext
                out=ROOT/'assets/ogp/images'/name;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(blob)
                result['image']='/assets/ogp/images/'+name
        except Exception:pass
    return result

def main():
    path=ROOT/'assets/ogp/link-cache.json'
    cache=json.loads(path.read_text()) if path.exists() else {}
    pages={};links=set()
    for p in ROOT.rglob('*.html'):
        if any(x in p.relative_to(ROOT).parts for x in ('.git','_layouts','_includes','vendor','backup','_site')) or p.name=='header.html':continue
        url,info,doc=page(p);pages[url]=info
        for a in doc.xpath('//a[@href]'):
            parent=a.getparent();href=a.get('href');text=' '.join(parent.itertext()).strip()
            if 'mirror-link-card' in a.get('class','').split() or a.get('data-ogp')=='card' or (parent.tag=='p' and len(parent)==1 and text==href):
                target=urldefrag(urljoin(SITE+url,href))[0]
                if target.startswith(('http://','https://')) and urlsplit(target).netloc!=urlsplit(SITE).netloc:links.add(target)
    # Local cards use site metadata, with the same cached-image interface.
    for url,info in pages.items():cache[url]=dict(info)
    def fetch(url):
        try:return url,metadata(url),None
        except Exception as e:return url,None,str(e)
    failures=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for url,info,error in pool.map(fetch,sorted(links)):
            if info:cache[url]=info
            else:failures.append({'url':url,'reason':error})
    (ROOT/'_data/page_ogp.json').write_text(json.dumps(pages,ensure_ascii=False,indent=2)+'\n')
    path.write_text(json.dumps(cache,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'pages':len(pages),'external_links':len(links),'cached':sum(u in cache for u in links),'unavailable':len(failures)},ensure_ascii=False))
    (ROOT/'assets/ogp/fetch-report.json').write_text(json.dumps(failures,ensure_ascii=False,indent=2)+'\n')
if __name__=='__main__':main()
