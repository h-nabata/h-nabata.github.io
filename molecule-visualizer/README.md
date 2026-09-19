# Molecule Studio

分子と周期構造の編集ワークスペース。GitHub Pages上で動作し、構造データの変換と3D生成はブラウザ内で実行します。

## 主な操作

- XYZ / 拡張XYZ / 連続XYZ / POSCAR / MOL・SDF V2000 / V3000 / プロジェクトJSONを開く、貼り付ける、ドロップする。
- ヘッダー表示はチェックボックスで切替可能。XYZ入力はヘッダーを自動判別し、CR/LF/CRLF・Unicode改行、全角/半角スペース・タブを正規化します。原子パネルの大きなXYZテキスト欄で全原子の座標を編集し、「構造へ適用」で反映。同じ原子数・元素順なら形式電荷と手動結合を保持します。入力中の内容は自動更新で上書きされず、「現在の構造を再表示」で破棄して同期できます。「保存 / 書き出し」で現在のXYZ、全フレームXYZ、POSCAR、SDF、プロジェクトを保存。
- クリックで選択、原子上の右クリックで選択へ追加（再クリックで解除しない）、Shift/Ctrl/⌘で追加選択、ダブルクリックで連結分子を選択。左ドラッグで表示回転、右ドラッグで矩形選択、Alt＋左で選択原子群の平行移動、Alt＋右で重心まわりの回転（未選択時は開始位置の原子・結合の連結部分）、中ボタンドラッグでパン、ホイールでズーム。
- Mで原子移動、Vで選択、Bで結合。X/Y/Zで移動方向を拘束（同じキーで解除）。矢印でX/Y方向、PageUp/DownでZ方向に0.01 Å移動、Shift併用で0.1 Å。
- Rで全体表示、Eで隣接選択、Wで分子選択、Deleteで削除、Ctrl/⌘ Zで戻す。キーは描画領域にフォーカスがあるときに使用。
- 「測定・移動」で距離・角度・二面角、原子団の平行移動・重心まわりの剛体回転。画面にも測定値を表示。
- 軌跡はフレーム移動・再生・フレームごとの編集・全フレーム書き出しに対応。編集は自動保存されるが、プロジェクトファイルの保存も推奨。

## 周期構造

格子ベクトルを行として格納（Å）。a/b/c方向の周期境界、任意の非特異な斜交セルに対応。拡張XYZの`Lattice`、`pbc`、`Properties`を読み書きし、追加列も保持します。追加列の値（force等）は座標編集に追随して再計算しません。

POSCARは元素名を含むVASP 5形式、Direct/Cartesian、正スケール/負の体積指定、Selective dynamicsを保持。速度・追加ブロックは情報損失を防ぐため拒否します。Selective dynamicsは保存する制約情報で、画面操作を拘束する機能ではありません。CIFの空間群展開は未実装です。

セル編集はCartesian保持または分率座標保持を選択。折り返し、実原子を複製するスーパーセル生成が可能。セル線と軸、境界をまたぐ結合を表示。結合推定は原子対あたり最小像1本で、周期像自身との結合や同じ原子対の複数近接像は対象外です。通常の測定・幾何編集は表示座標を使用し、2原子の最小像距離は別欄に表示します。

## Ketcher・SMILES・3D生成

「2D描画 / SMILES」でKetcherを開き、SMILESを描画、描画からSMILES/MOLを保存、現在の非周期3D構造を取り込み。SMILES欄に入力して「SMILES → 3D / XYZ」を押すと、描画ボタンを経由せず3D座標を生成し、原子パネルのXYZ欄で編集・保存できます。「描画中の構造に水素追加 → 3D生成」とともにOpen BabelのUFFを使用します。計算はWeb Worker内で行い、中止・120秒タイムアウトに対応。

3D生成は初期配座の作成であり、量子化学最適化・配座探索の網羅性を保証するものではありません。金属錯体や未知の力場パラメータは失敗する場合があります。MOL V2000 / V3000の同位体（M ISO / MASS）、ラジカル（M RAD / RAD）、原子・結合の立体指定（parity / CFG）、形式電荷、原子マッピングを原子・結合モデルに保持し、Undo/Redo・プロジェクト・MOL書き出しへ引き継ぎます。V3000のSTEABS/STEREL/STERACも保持します。座標・結合を編集しても立体フラグを自動再判定するわけではないため、化学的な立体整合性はKetcher等で確認してください。Sgroup・多中心結合・抽象的なクエリ原子は現在対象外です。XYZ由来の推定結合は単結合のため、SMILES出力前にKetcherで結合次数・価数を確認してください。周期セルはMOL/SMILESに変換できません。

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

## 座標編集欄のTV（GRRM風）

原子座標の後に次の3行を入力して「構造へ適用」します。単位はÅ、TVは原子や結合の対象になりません。

```text
TV 4.0 0.0 0.0
TV 1.0 5.0 0.0
TV 2.0 3.0 6.0
```

ヘッダーの有無を切り替えてもTVを表示します。ヘッダーの数は原子数のみ（読み込みではTVを含む行数も受け付けます）。一般の3×3格子も読み込めます。「格子を下三角化」は現在フレームの格子と全原子を同じ直交変換で回転し、距離・分率座標を保持します。左手系の格子はcの対角成分が負になります。TVだけでは周期方向を指定できないため、新規読み込みは3方向周期、座標編集では既存の周期方向を維持します。TVを含まない座標の適用でも既存セルを保持します。解除は周期セルダイアログを使います。通常のXYZファイル保存は互換性のためLattice付き拡張XYZです。

SMILESの3D生成はKetcherの描画更新を待たず、直接Open Babelへ渡します。生成後はダイアログを閉じ、描画を全体表示し、XYZ欄を同期します。未適用XYZがあった場合は「生成前の未適用XYZを復元用に表示」に保持します。

## MOL座標の直接編集

座標欄にMOL V2000 / V3000全体を貼り付けて「構造へ適用」すると自動判別します。「表示形式」でXYZ + TVとMOL V3000を切り替えられます。MOL入力では座標だけでなく結合と化学属性も更新します。表示形式を切り替える際、未適用の有効な編集は先に適用します。無効な入力は保持し、既存構造を変更しません。「保存 / 書き出し」にはMOL V3000保存もあります。周期格子を含む構造はXYZ + TVを使用してください。

フォーマット仕様: https://discover.3ds.com/sites/default/files/2020-08/biovia_ctfileformats_2020.pdf
V2000質量差の基準質量数: Open Babel 3.1.1 `src/elements.cpp` の最頻同位体（元素データ）。

表示回転は正規化クォータニオンを累積する仮想トラックボール方式です。左ドラッグで任意の配向へ回転でき、固定された上下軸・極による制限はありません。画面中央付近で傾け、外周に沿ってドラッグすると画面法線まわりにロールします。表示だけが変化し、原子座標・格子は不変です。XY/XZ/YZ表示で基準配向へ戻せます。原子移動・Alt操作の画面方向変換にも同じ回転の逆変換を使用します。

回転はマウスの移動量を逐次積算します。仮想球面の端点への対応は使わず、上下左右・斜め方向ともドラッグを続ければ360度を超えて何周でも回転できます。外周の接線方向はロール、半径方向は継続的な傾きとして扱います。ポインターキャプチャで描画領域外の移動も受け付けます（実際の画面端など、OSがポインター移動を止める位置では一度持ち直してください）。

表示コントロールに「XYZ座標軸」「カメラをリセット」「重心を原点へ」を追加。XYZ軸は画面右上の世界座標方向の表示で、周期格子のa/b/cとは独立しています。表示設定はプロジェクトと自動保存に保持します。カメラリセットは向き・ズーム・パンを初期化し全体を収め、原子座標は変更しません。重心は元素の原子量で重み付けし、同位体指定時は質量数を質量の近似として使用します。周期系では登録原子のみ（TV・描画上の周期像を含まない）の重心を使い、格子ベクトルを維持して原子全体を平行移動します。セルへの折り返しは行わず、Undo可能です。無限周期系そのものの重心を定義する操作ではありません。
質量データ: https://github.com/openbabel/openbabel/blob/openbabel-3-1-1/src/elementtable.h （Blue Obelisk元素データ）。周期系にも通常の分子と同じ連続回転を適用します。

### Camera and editing additions

- Shift + left drag (horizontal movement) rolls the camera continuously about its viewing direction. Camera target/position, world coordinates and cell vectors stay fixed; Alt group gestures take precedence. Use Z to constrain atom movement.
- Projection selector offers the existing orthographic mode and perspective with 10–90° vertical FOV. Target-plane scale is preserved while FOV changes camera distance/perspective strength; wheel remains zoom. XYZ axes now start at the actual Cartesian origin, share atom/cell projection and scale, and can move offscreen when the origin is outside the view. Labels X/Y/Z differ from lattice a/b/c. Axes are a visible overlay, not depth-occluded geometry.
- B with exactly two selected atoms toggles their bond; holding B does not repeat. Otherwise B enters bond mode. Deletion suppression and undo are preserved.
- Ten complex samples include indene, fluorene, norbornene, adamantane, cubane, anthracene, biphenyl, caffeine, aspirin and 18-crown-6. SMILES are converted with explicit H and UFF by the pinned Open Babel worker on first use, validated against C/H composition and cached for this page session. Loading is cancellable and undoable; concurrent structural edits prevent late results from replacing newer work.

### Lightweight relaxation

`relax.js` adjusts existing coordinates with bond-length springs (covalent radii and bond-order factors), ideal 1–3 distance springs for approximate angles, and soft short-range nonbonded repulsion. It never rebuilds coordinates, adds H or changes bonds/chemical metadata. Current bond orders therefore matter; XYZ inference alone cannot identify double/aromatic bonds. Supported elements: H, B, C, N, O, F, Si, P, S, Cl, Br, I; up to 500 atoms. The worker runs at most 300 iterations with an approximately 1.8-second iteration budget (individual evaluations may extend this); it is cancellable, checks for concurrent structural changes, and applies one undoable update. Periodic structures use minimum-image pairs with fixed cell; self-image interactions and multiple images are omitted.

This is geometric cleanup, not UFF, an energy in physical units, a conformer search, or quantum optimization. It lacks torsional, electrostatic and explicit stereochemical constraints; verify chirality/planarity after substantial edits. Unsupported elements, including metal/ionic crystals, are explicitly rejected. Status displays reduction of the arbitrary-unit geometric objective. Source coordinates, bonds and cell are retained if processing fails or is cancelled.

### Structural text input and generated trajectories

The coordinate editor and file import now share `Formats.parse`. Input format can be selected explicitly in the editor, or detected automatically. Accepted input: XYZ/extXYZ/GRRM TV, MOL V2000/V3000, multi-record SDF, CIF 1.1, PDB (including MODEL), MOL2, VASP 5 POSCAR, Gaussian GJF/COM Cartesian blocks, ORCA inline `* xyz` Cartesian blocks, and the project's JSON format. After importing, the editor displays normalized XYZ/TV or MOL V3000. Multiple structures become editable frames; per-record SDF properties and bonds are preserved. Export supports all-frame XYZ and SDF; project JSON preserves the entire document. SMILES/3D generation remains in the dedicated Ketcher panel.

CIF imports cell lengths/angles, fractional or Cartesian atom sites and listed symmetry operations, expands the unit cell, and deduplicates equivalent positions. Coordinates with standard uncertainties and quoted/semicolon values are handled. Non-P1 files without explicit symmetry operations are rejected rather than silently losing symmetry. P1/unspecified symmetry without operations uses identity. Partial occupancies are retained as extXYZ columns and surfaced as a warning; this is not a disorder-resolution algorithm. CIF 2.0 compound values, superspace and space-group lookup by number/name alone are not implemented. PDB reads blank/A alternate locations, infers geometry bonds and respects CONECT; it does not expand biological assemblies or symmetry. MOL2 partial charges are retained as extra columns, not confused with formal charges. Quantum input readers import Cartesian coordinates, charge and multiplicity only; external `xyzfile`, Z-matrices and multi-job Link1 inputs are rejected. Units=Bohr is converted to Å.

`generation.js` / `generation-worker.js` implement two bounded background operations. Both are cancellable and applied as a single undoable update; stale results never replace changed structures or edited generation inputs. Current unapplied coordinate drafts must be applied/reset first.

- Random structures: 1–20 candidates with a reproducible integer seed. Non-ring single-bond torsions are sampled, amide C–N bonds are excluded, and severe nonbonded clashes are rejected. Bond lengths, angles and atom file order are preserved. Ring puckering, energetic ranking and exhaustive conformer search are not included. Rigid orientations use uniform unit quaternions (Haar rotations), about the molecular centroid; for periodic orientation-only sampling the atoms and cell rotate together about the origin. Torsion modes: up to 500 atoms, nonperiodic only. Orientation: up to 2000 atoms. Failed clash/duplicate sampling or the 8-second sampling budget may yield fewer candidates, reported explicitly.
- Reaction initial paths: two single structures with identical element sequence and atom count; no automatic permutation of equivalent atoms. 2–20 images including exact input endpoints by default. Cartesian linear interpolation supports up to 2000 atoms. Distance interpolation supports up to 300 atoms, minimizing weighted deviations from interpolated endpoint pair distances with weak neighboring-image smoothing and a Cartesian tether; weights are inverse fourth powers of target distances (floored at 0.5 Å). The full 3N gradient (including smoothing/tether terms) and seeded symmetry-breaking perturbations are projected perpendicular to the local geometric tangent. Actual updates use a common scalar per image, and each sweep uses frozen neighboring coordinates. No parallel spring or reparametrization is applied. Up to 250 sweeps / a 6-second sweep budget; this is inspired by pair-distance interpolation, **not an IDPP-NEB implementation or an energy/force calculation**. Endpoint coordinates remain untouched. Identical endpoints remain identical. Intermediate bonds are inferred per frame; endpoint bonds and properties are retained. Near contacts are reported. Periodic endpoints must have the same cell/PBC; pair distances use minimum images, and an optional shortest-image interpolation maps the final endpoint to a periodic equivalent. Self-image interactions are not included. No automatic alignment is performed, so orient nonperiodic endpoints consistently before generating.

References for the structural readers and interpolation concept:
- [IUCr CIF 1.1 specification](https://www.iucr.org/what-we-do/digital-standards/cif/cif1)
- [wwPDB 3.3 coordinate records](https://www.wwpdb.org/documentation/file-format-content/format33/sect9.html)
- [Smidstrup et al., Improved initial guess for minimum energy path calculations (2014)](https://arxiv.org/abs/1406.1512)

## Local energy engines and path relaxation

See [the setup and numerical guide](local-engine/README.md). The new external-engine panel supports authenticated localhost jobs with tblite (including fixed cells) and the official `xtb --gxtb --grad` binary (nonperiodic), single-point energies/forces, single-structure optimization, strict perpendicular path relaxation, NEB and optional CI-NEB. Endpoints stay fixed. Results are reviewed before applying, preserve atom order and cell, and support Undo and JSON export. Tokens are never persisted. The helper must be started explicitly by the user; this GitHub Pages site cannot execute a native binary by pathname alone.

Tests: `python -m unittest discover -s molecule-visualizer/tests -p 'test_*.py' -v` after installing `local-engine/requirements.txt` and `tblite`. `tests/engine-browser.cjs` covers the real local-service connection, energy display, stale-result protection, fixed-cell path application, frame navigation, Undo, and the mobile local-UI fallback.
