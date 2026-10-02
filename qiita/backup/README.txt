Qiita記事バックアップ

items.json.gz: gzip圧縮。展開するとitems.jsonになります。 APIで取得した公開記事の原文Markdown・Qiita生成HTML・メタデータ。
<記事ID>.md.txt: 個別の原文Markdown。拡張子を.mdに変更して利用できます。
manifest.json: 取得日時、記事数、画像URLとローカル保存先、取得に失敗した画像。
qiita-article-original.css: 取得時のQiita記事CSS。
画像本体: リポジトリの assets/qiita/images/ に保存。

更新方法（Python 3とlxmlが必要）:
  python scripts/sync_qiita.py

公開記事のみを取得します。削除された記事の既存ミラーページは削除しません。
元記事の変更を反映したいときに再実行し、差分を確認してコミットしてください。
取得時点の旧版はGitの履歴から復元できます。
