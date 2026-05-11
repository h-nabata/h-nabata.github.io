# local-molsimplify-agent

> **Research MVP**: 生成構造は初期構造候補です。必ず研究者が検証してください。

## Overview
オフライン優先の半自律AI分子構造生成ツール。LLMは解釈と計画のみ、3D生成はmolSimplify等に委譲。

## What this tool does
- YAML/JSONから決定論的に構造生成ワークフロー実行
- オプションで自然言語->構造化要求
- ASEベース検証レポート
- run directoryに再現ログ保存

## What this tool does not do
- 実験合成手順の提示
- 危険物製造の最適化
- LLM単体での構造“想像”

## Design philosophy
- molSimplify中心、CLIラッパー優先
- 外部送信デフォルト無効
- 無限リトライ禁止

## Installation
`INSTALL.md`参照。

## Quick start
```bash
lma doctor
lma generate examples/fe_h2o6.yaml
lma validate examples/example.xyz
```

## YAML input example
`examples/fe_h2o6.yaml`

## Natural language mode
```bash
lma run-agent "Generate an octahedral Fe(II) complex with six water ligands."
```

## Offline/local LLM mode
OllamaまたはOpenAI互換ローカルエンドポイントを設定可能。未設定でもYAMLモードは動作。

## molSimplify integration
CLI検出->help確認->最小入力サポート。未対応入力は明示エラー。

## Validation workflow
ASEで可読性・原子数・短距離接触・元素含有を確認。

## Optional relaxation with xTB
`lma relax FILE.xyz --method xtb`

## Output directory structure
`outputs/YYYY-MM-DD_run_0001/` に request/plan/log/report/structure を保存。

## Limitations
molSimplify CLI差分により一部錯体入力は未対応。

## Safety and responsible use
研究用3D初期構造支援のみ。

## Citation
`CITATION.cff` を参照。

## License
MIT。依存ソフトは同梱せず各ライセンスに従う。
