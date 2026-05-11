# SPEC

MVP仕様: YAML/JSON入力またはローカルLLM経由自然言語入力を構造化し、molSimplifyで3D初期構造生成、ASEで検証、成果物をrun directoryへ保存する。

- オフライン優先
- molSimplify CLI優先
- 失敗時最大N回再試行
- 実行ログ完全保存
