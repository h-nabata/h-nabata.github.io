# OGPとリンクカード

全ページの共有用メタタグは `_includes/ogp.html` で生成します。
通常の記事ページと独立したTheoChem25図表ページに適用しています。

ページのYAML front matterで `description`、`ogp_title`、`ogp_image` を設定すると優先されます。
設定を省略すると、本文から作成した説明、記事画像、共通画像 `/top.png` を使います。
`ogp_image` はサイト内の絶対パス、または公開HTTPS画像のURLにします。
Qiita転載ページの `og:url` はホームページ側のURL、canonicalは元記事のURLです。

## 記事内のカード

URLだけを記した段落、Qiitaから取り込んだリンクカード、および `data-ogp="card"` を付けたリンクが対象です。
文中のリンク・ナビゲーション・ダウンロードリンクは変えません。

```html
<p><a href="https://example.org/article" data-ogp="card">関連記事</a></p>
```

`data-ogp="off"` を付けると通常リンクのまま表示できます。
キャッシュに情報がない場合、JavaScriptが無効な場合、取得に失敗した場合は元のリンクを残します。
タイトルや説明はテキストとして配置し、外部ページのHTMLは挿入しません。
サムネイルはサイト内に保存して配信します。

## 更新

Python 3に `lxml` と `PyYAML` が必要です。

```sh
python -m pip install lxml PyYAML
python scripts/build_ogp.py
```

ページの説明を更新し、対象リンクのOGPを取得して `assets/ogp/link-cache.json` に保存します。
前回成功した情報は、今回リンク先が取得できなくても保持します。
取得できなかったURLは `assets/ogp/fetch-report.json` に記録します。
生成した `_data/page_ogp.json`、`assets/ogp/` をGitに保存して公開してください。
Qiitaの同期スクリプトからも、この更新処理を呼び出します。
定期実行は設定していません。SNS側のキャッシュ更新は各サービスの仕様に依存します。
