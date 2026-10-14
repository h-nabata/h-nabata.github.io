# このフォルダーの開発上の制約

- 公開ホームページ用の汎用コードと公開可能な小さな試験データだけを扱う。研究用リポジトリの構造、結果、ログ、実行ファイル、認証情報は混ぜない。
- 分子データを外部サーバーへ送らない。物理計算は明示的な実行操作でlocalhostのサービスへ渡す。接続Tokenをプロジェクトや結果へ保存しない。
- AFIRの人工項・物理エネルギー・合計を分ける。人工力下の収束をTS検証と呼ばない。原子IDを全構造で保持する。
- 数値処理と失敗状態はAFIR.md、実測と未実施事項はAFIR-VALIDATION.mdに記録する。
- 変更後は`node --test molecule-visualizer/tests/*.test.cjs`と`python -m unittest discover -s molecule-visualizer/tests -p 'test_*.py' -v`をリポジトリのルートから実行する。実g-xTB試験には`GXTB_TEST_BINARY`を明示する。skipを合格に数えない。
- ブラウザで原子選択・実行・結果適用・保存を確認する。変更した計算条件が、編集中の入力欄も含めて実際のジョブへ渡ることを検証する。
