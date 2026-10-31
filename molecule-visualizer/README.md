# Molecule Studio

分子と周期構造の編集ワークスペース。GitHub Pages上で動作し、構造データの変換と3D生成はブラウザ内で実行します。

## 主な操作

- bridge.py **1.15.0**で、[llmlip.rs（CPU・β版）](./local-engine/README.md#llmlip-cpu)を追加しました。変換済みのローカルモデルを選び、PyTorch・CUDAなしでエネルギー・力を計算し、既存のMIN・AFIR・CI-NEB・LUP・TS・IRC・振動解析へ渡します。モデルごとの対応範囲を確認し、未対応機能は無効化します。

- bridge.py **1.12.0**で、TV固定・相似伸縮・格子角固定・a/b/cのみ・ab同率・cベクトルのみ・全ひずみのセルMINを選択できます。可変セルは3方向周期のtblite、FIRE/L-BFGS用です。外圧・応力閾値を指定でき、軌跡にフレームごとのセルを保存します。
- 「拘束一覧」から選択順の2/3/4原子を距離/角度/二面角の固定・スキャンへ指定できます。XYZ成分ごとの原子固定、剛体原子団、重心間距離のみの固定も追加しています。現在値・目標値と有効状態を一覧・描画で確認できます。
- 段階MIN（FIRE→L-BFGS・停滞回復）、内部状態を保存した途中再開、適応/往復スキャン、2次元ヒートマップ、名前付き条件に対応します。
- 計算パネルの「計算手順をまとめて実行」でMIN→振動、経路→TS→振動→IRC、配座生成→MIN→重複除去を実行できます。未収束・失敗・中止・振動条件の不一致で後続計算を止めます。PCではパネルを開いたまま分子選択が可能です。[数値処理と対応範囲](./AFIR.md#最適化計算手順の拡張bridgepy-1120)を参照してください。

- 描画エリア下の「セルを削除」で、表示中の構造の格子ベクトルと周期境界条件を削除し、非周期構造にできます。原子のCartesian座標・ID・結合・選択・カメラは保持し、Undo／Redoに対応します。構造列では現在のフレームのみが対象です。未適用の座標編集や計算実行中は削除せず、その旨を表示します。周期セル設定ダイアログの「周期セルを解除」も同じ操作です。

- 「原子団の重心」で選択原子を1つ以上の原子団に登録し、重心の相対位置または絶対位置を固定して緩和できます。内部構造は自由。非周期MIN・AFIR-MIN・緩和スキャン・一括MINに対応し、原子固定・内部座標拘束を併用可能です。bridge.py 1.11.0以降が必要です。[操作と制限](RESEARCH.md#原子団の重心を固定した緩和)を参照してください。

- 「AFIR / 原子団に人工力」と「全原子の座標・構造データ」は、右下を上下にドラッグして高さを調整できます。見出しの「低く」「高く」は80pxずつ調整し、「戻す」で画面サイズに応じた初期の高さへ戻します。タッチ操作・キーボードでもボタンを使えます。内容は各パネル内でスクロールし、見出しと高さの操作は上部に残ります。スクロール端からページ全体へスクロールが連鎖するのを抑えます。高さは同じページ内の表示切替では保持し、再読み込みで初期値に戻ります。座標欄自体の高さ変更と内部スクロールも引き続き使えます。
- XYZ / 拡張XYZ / 連続XYZ / POSCAR / MOL・SDF V2000 / V3000 / プロジェクトJSONを開く、貼り付ける、ドロップする。
- ヘッダー表示はチェックボックスで切替可能。XYZ入力はヘッダーを自動判別し、CR/LF/CRLF・Unicode改行、全角/半角スペース・タブを正規化します。原子パネルの大きなXYZテキスト欄で全原子の座標を編集し、「構造へ適用」で反映。同じ原子数・元素順なら形式電荷と手動結合を保持します。入力中の内容は自動更新で上書きされず、「現在の構造を再表示」で破棄して同期できます。「保存 / 書き出し」で現在のXYZ、全フレームXYZ、POSCAR、SDF、プロジェクトを保存。
- クリックで選択、原子上の右クリックで選択へ追加（選択済みの原子は右クリックで解除）、Shift/Ctrl/⌘で追加選択、ダブルクリックで連結分子を選択。左ドラッグで表示回転、右ドラッグで囲んだ原子を現在の選択へ追加、Alt＋左で選択原子群の平行移動、Alt＋右で重心まわりの回転（未選択時は開始位置の原子・結合の連結部分）、中ボタンドラッグでパン、ホイールでズーム。
- Mで原子移動、Vで選択、Bで選択原子同士の結合を一括削除、Shift+Bで未接続ペアへ結合を生成。X/Y/Zで移動方向を拘束（同じキーで解除）。矢印でX/Y方向、PageUp/DownでZ方向に0.01 Å移動、Shift併用で0.1 Å。
- Rで全体表示、Eで隣接選択、Wで分子選択、Deleteで削除、Ctrl/⌘ Zで戻す。キーは描画領域にフォーカスがあるときに使用。
- 「測定・移動」で距離・角度・二面角、原子団の平行移動・重心まわりの剛体回転。画面にも測定値を表示。
- 軌跡はフレーム移動・再生・フレームごとの編集・全フレーム書き出しに対応。編集は自動保存されるが、プロジェクトファイルの保存も推奨。

## AFIR結果の抽出・NEBへの取り込み

計算後の「構造列を保存・抽出」でノード数と抽出方法を指定します。AFIRでは両端点と平滑化前の物理エネルギー最高点を必ず残し、移動平均で判定した極大点も突出量順に優先します。最高点が内部なら最低3ノードです。移動平均の幅は既定5フレーム（1で無効）、極大点の最小突出量は既定0.01 eVです。設定変更に応じて元の曲線・平滑化した曲線・抽出点を表示します。平滑化で元の座標や出力エネルギーは変更しません。

「抽出列を描画へ反映・再生」でFRAMESとグラフに反映できます。「抽出列をNEB入力に取り込む」は3〜20ノードをNEBの条件画面へ渡します。原子ID・セル・電荷・多重度を引き継ぎ、計算は明示的に実行したときだけ開始します。NEBにはAFIRの人工力を加えません。詳細な抽出規則と上限は[AFIR.md](./AFIR.md)を参照してください。

## 描画エリアのショートカット

描画エリアにフォーカスがある場合に使用します。入力欄・選択欄の編集中、IMEの変換中、ダイアログ表示中には適用しません。macOSではCtrlの代わりに⌘も使用できます。

| キー | 操作 |
|---|---|
| Ctrl+E | 現在の選択原子に直接結合した原子を追加し、結合1本分だけ広げる |
| Ctrl+W | 選択原子から結合をたどれる全原子を追加する。未選択の別分子は含まない |
| Ctrl+A | 連結関係にかかわらず全原子を選択する |
| Ctrl+R | 全原子の選択／未選択を反転する |
| [ / ] | B側の原子団を結合A–Bまわりに左／右へ5°回転する |
| , / . | B側の原子団を結合方向に0.1 Å平行移動し、Aへ近づける／Aから離す |
| Ctrl+Z / Ctrl+Y | 座標編集を元に戻す／やり直す（Ctrl+Shift+Zもやり直し） |

結合操作では、結合した2原子を**固定側A、動かす側Bの順**に選びます。A–B結合をグラフから除いたとき、Bからたどれる原子団全体が可動側です。AからBを見る向きで、`[`は左回り、`]`は右回りです。選択順を逆にすると可動側が入れ替わります。回転時のA/Bの座標と結合長、可動原子団内の形、原子ID・結合表を保持します。平行移動ではBも含めて動かし、A–Bの距離だけを0.1 Å変えます。`,` / `.`の代わりに`<` / `>`も使えます。

環内の結合は片側を分離できないため拒否します。可動側に周期境界をまたぐ結合がある場合、軸が定義できない場合、距離が0.1 Å以下になる接近、未適用の座標編集がある場合も、座標・履歴を変更せず理由を表示します。構造最適化ではなく幾何編集です。結合の再推定は自動で行いません。

`[`・`]`・`,`・`.`は長押しで反復し、1回の反復につき5°回転／0.1 Å移動します。反復の開始と速度はOSのキーリピート設定に従います。押してから離すまでを一つの編集とし、途中の構造をUndo履歴に追加しません。Ctrl+Zで長押し前の構造へ、Redoで長押し後の構造へ戻せます。キーを押し直した操作は別の履歴です。キーを離したとき、フォーカスを外したとき、タブを切り替えたとき、選択や別の編集操作を始めたときに区切り、長押し中の自動保存も終了時まで待ちます。途中で操作を拒否した場合は、最後に成立した構造を保持し、その長押しの反復を停止します。

Ctrl+E・Ctrl+Rは長押しで反復しません。E・W単独の既存ショートカットも保持し、R単独は視点のリセットです。ブラウザがCtrl+Wをタブ終了として優先する環境では、W単独または「連結分子を選択」を使用してください。ブラウザやOSの予約キーには制限があります（[MDN Keyboard API](https://developer.mozilla.org/en-US/docs/Web/API/Keyboard_API)）。ブラウザ全体のキー設定は変更しません。

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

表示回転は画面を基準にした自由回転方式です。横ドラッグは画面の上下方向の軸、縦ドラッグは画面の左右方向の軸、斜めドラッグはその移動方向に直交する画面内の軸まわりに回転します。正規化クォータニオンを累積し、分子や世界座標の上下軸には固定しないため、上下反転を含めて任意の配向へ連続して回せます。表示だけが変化し、原子座標・格子は不変です。XY/XZ/YZ表示で基準配向へ戻せます。原子移動・Alt操作の画面方向変換にも同じ回転の逆変換を使用します。

回転角はドラッグの移動量に比例し、感度は1 CSS pxにつき0.008 radです。開始位置・画面中心からの距離・パン・ズーム・投影方式によって軸や感度を変えません。従来の「外周で自動的にロールを混ぜる」処理を廃止し、ロールはShift＋左ドラッグの左右移動で明示的に操作します。仮想球面の端点への対応は使わず、上下左右・斜め方向ともドラッグを続ければ360度を超えて何周でも回転できます。ポインターキャプチャで描画領域外の移動も受け付けます（実際の画面端など、OSがポインター移動を止める位置では一度持ち直してください）。

表示コントロールに「XYZ座標軸」「カメラをリセット」「重心を原点へ」を追加。XYZ軸は画面右上の世界座標方向の表示で、周期格子のa/b/cとは独立しています。表示設定はプロジェクトと自動保存に保持します。カメラリセットは向き・ズーム・パンを初期化し全体を収め、原子座標は変更しません。重心は元素の原子量で重み付けし、同位体指定時は質量数を質量の近似として使用します。周期系では登録原子のみ（TV・描画上の周期像を含まない）の重心を使い、格子ベクトルを維持して原子全体を平行移動します。セルへの折り返しは行わず、Undo可能です。無限周期系そのものの重心を定義する操作ではありません。
質量データ: https://github.com/openbabel/openbabel/blob/openbabel-3-1-1/src/elementtable.h （Blue Obelisk元素データ）。周期系にも通常の分子と同じ連続回転を適用します。

### Camera and editing additions

- Shift + left drag (horizontal movement) rolls the camera continuously about its viewing direction. Camera target/position, world coordinates and cell vectors stay fixed; Alt group gestures take precedence. Use Z to constrain atom movement.
- Projection selector offers the existing orthographic mode and perspective with 10–90° vertical FOV. Target-plane scale is preserved while FOV changes camera distance/perspective strength; wheel remains zoom. XYZ axes now start at the actual Cartesian origin, share atom/cell projection and scale, and can move offscreen when the origin is outside the view. Labels X/Y/Z differ from lattice a/b/c. Axes are a visible overlay, not depth-occluded geometry.
- With two or more selected atoms, B deletes every bond whose endpoints are both selected. Shift+B adds every missing pair using the bond order/type controls, regardless of distance. Existing bonds and all boundary bonds retain their properties. Both operations preserve atom selection and coordinates, ignore key repeats, and form one undo step. Deleted pairs stay suppressed during automatic bond inference; explicit creation clears suppression for those pairs. A creation exceeding 10,000 new bonds is rejected before editing. B with zero or one selected atom still enters bond mode. Text input, modifiers other than Shift, open dialogs, pending coordinate edits, and active calculations do not trigger a bond edit.
- Ten complex samples include indene, fluorene, norbornene, adamantane, cubane, anthracene, biphenyl, caffeine, aspirin and 18-crown-6. SMILES are converted with explicit H and UFF by the pinned Open Babel worker on first use, validated against C/H composition and cached for this page session. Loading is cancellable and undoable; concurrent structural edits prevent late results from replacing newer work.

### Lightweight relaxation

`relax.js` adjusts existing coordinates with bond-length springs (covalent radii and bond-order factors), ideal 1–3 distance springs for approximate angles, and soft short-range nonbonded repulsion. It never rebuilds coordinates, adds H or changes bonds/chemical metadata. Current bond orders therefore matter; XYZ inference alone cannot identify double/aromatic bonds. Supported elements: H, B, C, N, O, F, Si, P, S, Cl, Br, I; up to 500 atoms. The worker runs at most 300 iterations with an approximately 1.8-second iteration budget (individual evaluations may extend this); it is cancellable, checks for concurrent structural changes, and applies one undoable update. Periodic structures use minimum-image pairs with fixed cell; self-image interactions and multiple images are omitted.

This is geometric cleanup, not UFF, an energy in physical units, a conformer search, or quantum optimization. It lacks torsional, electrostatic and explicit stereochemical constraints; verify chirality/planarity after substantial edits. Unsupported elements, including metal/ionic crystals, are explicitly rejected. Status displays reduction of the arbitrary-unit geometric objective. Source coordinates, bonds and cell are retained if processing fails or is cancelled.

### Structural text input and generated trajectories

The coordinate editor and file import now share `Formats.parse`. Input format can be selected explicitly in the editor, or detected automatically. Accepted input: XYZ/extXYZ/GRRM TV, MOL V2000/V3000, multi-record SDF, CIF 1.1, PDB (including MODEL), MOL2, VASP 5 POSCAR, Gaussian GJF/COM Cartesian blocks, ORCA inline `* xyz` Cartesian blocks, and the project's JSON format. After importing, the editor displays normalized XYZ/TV or MOL V3000. Multiple structures become editable frames; per-record SDF properties and bonds are preserved. Export supports all-frame XYZ and SDF; project JSON preserves the entire document. SMILES/3D generation remains in the dedicated Ketcher panel.

CIF imports cell lengths/angles, fractional or Cartesian atom sites and listed symmetry operations, expands the unit cell, and deduplicates equivalent positions. Coordinates with standard uncertainties and quoted/semicolon values are handled. Non-P1 files without explicit symmetry operations are rejected rather than silently losing symmetry. P1/unspecified symmetry without operations uses identity. Partial occupancies are retained as extXYZ columns and surfaced as a warning; this is not a disorder-resolution algorithm. CIF 2.0 compound values, superspace and space-group lookup by number/name alone are not implemented. PDB reads blank/A alternate locations, infers geometry bonds and respects CONECT; it does not expand biological assemblies or symmetry. MOL2 partial charges are retained as extra columns, not confused with formal charges. Quantum input readers import Cartesian coordinates, charge and multiplicity only; external `xyzfile`, Z-matrices and multi-job Link1 inputs are rejected. Units=Bohr is converted to Å.

`generation.js` / `generation-worker.js` implement two bounded background operations. Both are cancellable and applied as a single undoable update; stale results never replace changed structures or edited generation inputs. Current unapplied coordinate drafts must be applied/reset first.

- Random structures: 1–20 candidates with a reproducible integer seed. Non-ring single-bond torsions and eligible ring crankshaft moves are sampled; amide C–N bonds are excluded and severe nonbonded clashes are rejected. Bond lengths and atom file order are preserved. Ring moves retain closure and bound angle deviations (see below). Energetic ranking and exhaustive conformer search are not included. Rigid orientations use uniform unit quaternions (Haar rotations), about the molecular centroid; for periodic orientation-only sampling the atoms and cell rotate together about the origin. Torsion modes: up to 500 atoms, nonperiodic only. Orientation: up to 2000 atoms. Failed clash/duplicate sampling or the 8-second sampling budget may yield fewer candidates, reported explicitly.
- Reaction initial paths: two single structures with identical element sequence and atom count; no automatic permutation of equivalent atoms. 2–20 images including exact input endpoints by default. Cartesian linear interpolation supports up to 2000 atoms. Distance interpolation supports up to 300 atoms, minimizing weighted deviations from interpolated endpoint pair distances with weak neighboring-image smoothing and a Cartesian tether; weights are inverse fourth powers of target distances (floored at 0.5 Å). The full 3N gradient (including smoothing/tether terms) and seeded symmetry-breaking perturbations are projected perpendicular to the local geometric tangent. Actual updates use a common scalar per image, and each sweep uses frozen neighboring coordinates. No parallel spring or reparametrization is applied. Up to 250 sweeps / a 6-second sweep budget; this is inspired by pair-distance interpolation, **not an IDPP-NEB implementation or an energy/force calculation**. Endpoint coordinates remain untouched. Identical endpoints remain identical. Intermediate bonds are inferred per frame; endpoint bonds and properties are retained. Near contacts are reported. Periodic endpoints must have the same cell/PBC; pair distances use minimum images, and an optional shortest-image interpolation maps the final endpoint to a periodic equivalent. Self-image interactions are not included. No automatic alignment is performed, so orient nonperiodic endpoints consistently before generating.

References for the structural readers and interpolation concept:
- [IUCr CIF 1.1 specification](https://www.iucr.org/what-we-do/digital-standards/cif/cif1)
- [wwPDB 3.3 coordinate records](https://www.wwpdb.org/documentation/file-format-content/format33/sect9.html)
- [Smidstrup et al., Improved initial guess for minimum energy path calculations (2014)](https://arxiv.org/abs/1406.1512)

## Local energy engines and path relaxation

See [the setup and numerical guide](local-engine/README.md). The new external-engine panel supports authenticated localhost jobs with tblite (including fixed cells) and the official `xtb --gxtb --grad` binary (nonperiodic), single-point energies/forces, single-structure optimization, strict perpendicular path relaxation, NEB and optional CI-NEB. Endpoints stay fixed. Results are reviewed before applying, preserve atom order and cell, and support Undo and JSON export. Tokens are never persisted. The helper must be started explicitly by the user; this GitHub Pages site cannot execute a native binary by pathname alone.

Tests: `python -m unittest discover -s molecule-visualizer/tests -p 'test_*.py' -v` after installing `local-engine/requirements.txt` and `tblite`. `tests/engine-browser.cjs` covers the real local-service connection, energy display, stale-result protection, fixed-cell path application, frame navigation, Undo, and the mobile local-UI fallback.

## Ring conformers and persistent measurements

- Random conformer generation now includes ring single bonds by default. A correlated crankshaft move rotates a graph component about two ring atoms; all bonds crossing the component end on that axis. This preserves every bond length and ring closure exactly, including attached hydrogens and substituents. Moves introducing more than 20° deviation from any starting bond angle, strong nonbonded overlap, or inversion of a nonplanar local center are rejected. The maximum attempted crankshaft angle is adjustable (1–90°, default 30°). At most 24 local attempts per proposal, the existing 8-second sampling budget and maximum 20 structures remain.
- Aromatic/multiple bonds, amide links and short sp²-like C–C bonds in XYZ are protected. Only graph components with two independent paths between the anchors are moved; rotating a whole ring rigidly does not count as a ring conformer. Some small rings, fused rings and rigid cages have no eligible moves. This is geometric initial sampling, not exhaustive conformer enumeration or an energy-weighted distribution. Bond orders should be verified, particularly with XYZ. No unsupported ring flexibility is silently fabricated. Periodic conformer changes retain the existing requirement to extract a nonperiodic molecular structure first.
- Frame changes preserve the ordered atom selection by **File-order** (including nonconsecutive indices). Atom IDs can differ between frames. Missing indices are omitted with a notice. A selected distance/angle/dihedral updates immediately while stepping or playing frames. Four selected atoms also enable point-to-plane distance and cone angle; six enable plane-to-plane distance.
- “この計測を固定” keeps up to 64 measurements after deselection. Dashed guides, planes and labeled values follow the current atom coordinates and camera; values are also available in the persistent table. Click a table entry to select its atoms, remove entries individually, or use “固定表示を全解除”. Pin changes support Undo. The project JSON and local autosave preserve definitions; XYZ and MOL do not embed them. Definitions are document-wide, not independently copied into each trajectory snapshot.
- Pins identify File-order across frames and bind to IDs when a frame is visited, so later deletion/reordering in that frame cannot silently switch the measured atom. Missing atoms, changed element identities or degenerate geometry are displayed as undefined, without retaining an old value. Newly imported unrelated structures clear the old document's pins. Random structures with the same atom order and external-engine results carry compatible pins forward.
- “全フレームの計測値をCSV保存” downloads one row per frame and value/status columns for each pinned measurement. It includes the current frame's edits, signed dihedrals, original target indices, units and undefined-value reasons. UTF-8 BOM supports Japanese labels in Excel; text cells are escaped against spreadsheet formulas.

### Measurement conventions

Atom letters refer to selection order, not sorted atom numbers. Distances are Å and angles are degrees.

| Type | Definition |
|---|---|
| Distance (2 atoms) | A–B |
| Angle (3 atoms) | A–B–C, vertex B |
| Dihedral (4 atoms) | Signed A–B–C–D, −180…180° |
| Plane distance (4 atoms) | Absolute perpendicular distance from D to the infinite plane ABC |
| Cone angle (4 atoms) | A is the apex; the full angle of the smallest circular cone enclosing the B/C/D vdW spheres. Bondi radii are shown and can be edited; disabling vdW uses atom centers. Missing radii require manual entry. This **four-atom ligand cone approximation** is not the original Tolman protocol: it does not evaluate the whole ligand, normalize M–P to 2.28 Å, optimize the ligand or perform Tolman's asymmetric-ligand averaging. Choose the three atoms delimiting the ligand's exterior. |
| Plane gap (6 atoms) | Infinite planes ABC and DEF. Parallel planes: perpendicular distance. Nonparallel planes intersect, so the mathematical minimum distance is **0**, with an intersection note and interplane angle. This is not a centroid separation or a finite-triangle distance. |

“周期最小像で計測” is optional and stored separately for every pin. For angle and dihedral, neighboring vectors are unwrapped sequentially; for a plane, its other vertices are placed near its first vertex; the second plane's first vertex is placed near the first plane's first vertex. This is a local minimum-image convention, not minimization over every lattice-translated infinite plane. By default all measurements use the displayed Cartesian coordinates.

The cone solver checks intersections of spherical-cap boundaries and bisects the enclosing half-angle, including one- and two-sphere support and degenerate direction sets. General ligand cone angles differ from classical Tolman values; see [Morfeus's definitions and Bondi radii discussion](https://digital-chemistry-laboratory.github.io/morfeus/cone_angle.html), [its Bondi data table](https://github.com/digital-chemistry-laboratory/morfeus/blob/main/morfeus/data.py), and [Bilbrey et al., JCC 2013](https://doi.org/10.1002/jcc.23217).

Regression tests include analytic geometry for all six types, rigid-motion invariance, periodic measurements, frame-ID changes, project persistence, CSV contents, atom deletion, ring bond-length/closure and stereochemical checks, and real browser Worker/navigation/rendering/export interactions.

## 複数フラグメントAFIR

「AFIR / 原子団に人工力」から、描画上で複数の原子団とペアを指定して探索できます。設定と表示はブラウザ内で行い、探索時のエネルギー・力だけを、このPCのg-xTBまたはtbliteへ依頼します。外部サーバーには分子データを送りません。[操作・数式・データ形式](./AFIR.md)と[検証記録](./AFIR-VALIDATION.md)を参照してください。ローカルサービスは1.1.0へ更新してください。

## 構造ファイルの入力

GRRM .comの単独・複数構造、共有Frozen Atomsに対応。複数ファイルをまとめてドロップできます。追加した量子化学・MD・周期系形式と制限は[IMPORT-FORMATS.md](IMPORT-FORMATS.md)を参照してください。

### 2状態のポテンシャル面（bridge 1.14.0）

異なるスピン多重度の2状態をAMFで合成し、下側／上側の面でMIN・AFIR・CI-NEB・LUP系などを実行できます。平滑化パラメータα、各状態のエネルギーとカップリング、上下両面の比較・CSV保存、条件保存と再開に対応します。[ModelFの使い方・式・適用範囲](./MODEL-F)を参照してください。ローカルのbridge.pyを更新し、再起動・再接続が必要です。

### リソース効率（bridge 1.13.0）

周期近傍探索、剛体の並進・回転による投影、混合拘束の対象成分への縮約と行列再利用、可逆配列の再開保存、履歴追記と必要時読み込みを実装。MIN・スキャンに疎行列の前処理L-BFGSを追加し、可変セルには√Nで変位配分を調整する設定を追加しました。tblite／g-xTBの独立評価はローカルの `--workers` で並列化できます。

Undoでは不変の軌跡フレームを共有し、編集フレームとフレーム配列は分離します。単一フレーム出力は軌跡を丸ごとコピーしません。描画は座標・カメラ・セル・スタイルが同じ場合に投影と深度順を再利用し、正投影の原子画像を最大64件キャッシュします。初回の軌跡共有にはコピーと凍結の処理が必要です。計算・保存・Undo・描画の実測と条件はAFIR-VALIDATION.mdを参照してください。
