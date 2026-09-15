# Molecule Studio

分子と周期構造の編集ワークスペース。GitHub Pages上で動作し、構造データの変換と3D生成はブラウザ内で実行します。

## 主な操作

- XYZ / 拡張XYZ / 連続XYZ / POSCAR / MOL・SDF V2000 / プロジェクトJSONを開く、貼り付ける、ドロップする。
- ヘッダー表示はチェックボックスで切替可能。XYZ入力はヘッダーを自動判別し、CR/LF/CRLF・Unicode改行、全角/半角スペース・タブを正規化します。原子パネルの大きなXYZテキスト欄で全原子の座標を編集し、「構造へ適用」で反映。同じ原子数・元素順なら形式電荷と手動結合を保持します。入力中の内容は自動更新で上書きされず、「現在の構造を再表示」で破棄して同期できます。「保存 / 書き出し」で現在のXYZ、全フレームXYZ、POSCAR、SDF、プロジェクトを保存。
- クリックで選択、Shift/Ctrl/⌘で追加選択、ダブルクリックで連結分子を選択。左ドラッグで表示回転、右ドラッグで矩形選択、Alt＋左で選択原子群の平行移動、Alt＋右で重心まわりの回転（未選択時は開始位置の原子・結合の連結部分）、中ボタンドラッグでパン、ホイールでズーム。
- Mで原子移動、Vで選択、Bで結合。X/Y/Zで移動方向を拘束（同じキーで解除）。矢印でX/Y方向、PageUp/DownでZ方向に0.01 Å移動、Shift併用で0.1 Å。
- Rで全体表示、Eで隣接選択、Wで分子選択、Deleteで削除、Ctrl/⌘ Zで戻す。キーは描画領域にフォーカスがあるときに使用。
- 「測定・移動」で距離・角度・二面角、原子団の平行移動・重心まわりの剛体回転。画面にも測定値を表示。
- 軌跡はフレーム移動・再生・フレームごとの編集・全フレーム書き出しに対応。編集は自動保存されるが、プロジェクトファイルの保存も推奨。

## 周期構造

格子ベクトルを行として格納（Å）。a/b/c方向の周期境界、任意の非特異な斜交セルに対応。拡張XYZの`Lattice`、`pbc`、`Properties`を読み書きし、追加列も保持します。追加列の値（force等）は座標編集に追随して再計算しません。

POSCARは元素名を含むVASP 5形式、Direct/Cartesian、正スケール/負の体積指定、Selective dynamicsを保持。速度・追加ブロックは情報損失を防ぐため拒否します。Selective dynamicsは保存する制約情報で、画面操作を拘束する機能ではありません。CIFの空間群展開は未実装です。

セル編集はCartesian保持または分率座標保持を選択。折り返し、実原子を複製するスーパーセル生成が可能。セル線と軸、境界をまたぐ結合を表示。結合推定は原子対あたり最小像1本で、周期像自身との結合や同じ原子対の複数近接像は対象外です。通常の測定・幾何編集は表示座標を使用し、2原子の最小像距離は別欄に表示します。

## Ketcher・SMILES・3D生成

「2D描画 / SMILES」でKetcherを開き、SMILESを描画、描画からSMILES/MOLを保存、現在の非周期3D構造を取り込み。「水素追加 → 3D構造を生成」はOpen BabelのUFFを使用します。計算はWeb Worker内で行い、中止・120秒タイムアウトに対応。

3D生成は初期配座の作成であり、量子化学最適化・配座探索の網羅性を保証するものではありません。金属錯体や未知の力場パラメータは失敗する場合があります。3D編集側のMOLパーサーは同位体・ラジカル・くさび結合等の立体指定を拒否します。Ketcher内ではこれらの描画やSMILES/MOL保存ができますが、3D側への転送はすべての構造に対応していません。XYZ由来の推定結合は単結合のため、SMILES出力前にKetcherで結合次数・価数を確認してください。周期セルはMOL/SMILESに変換できません。

上限：編集2000原子、軌跡200フレームかつ合計100000原子、MOL V2000は999原子・999結合、3D生成200原子。保存はブラウザのlocalStorage容量に依存し、失敗時は画面に表示します。初回Ketcher起動時には約9 MBの圧縮コードを取得します。最新のChrome/Edge/Firefox/Safari（DecompressionStream対応）が必要です。

## 保守

- `model.js` / `history.js`：状態・履歴
- `io.js` / `periodic.js`：形式・周期幾何
- `renderer3dmol.js`：Canvas投影・操作（ファイル名は互換性のため維持）
- `ui.js` / `studio.js`：基本編集・追加ワークスペース
- `chem-worker.js`：Open Babel変換
- `molecule-visualizer_style.css`：`.mv-app`に限定したCSS。上部の色・余白変数を編集

`node --test molecule-visualizer/tests/*.test.cjs` で計算・入出力・編集テスト。
`python molecule-visualizer/scripts/preview.py` でテーマなしプレビュー。
GitHub Actionsの読み取り専用テストでChromiumによるKetcher・UFF・周期系・モバイル幅を検証します。

依存エンジン：Ketcher 3.18.0（Apache-2.0）、Open Babel WebAssembly（Open Babel GPL、ラッパーはMIT）。`vendor/`にライセンスを同梱。取得元は`.github/workflows/molecule-vendor.yml`と`vendor/openbabel/SOURCE.txt`。ワークフローは依存物を成果物として取得するだけで、リポジトリへの自動書き込みは行いません。Ketcher本体は未改変のJSをgzip分割して配信し、`bootstrap.js`で解凍します。
