# 構造ファイルの読み込み

「開く」またはページへのドラッグ＆ドロップで、以下の構造を読み込めます。拡張子が共通の COM / INP / IN / LOG / OUT は内容で判別します。「全原子の座標・構造データ」の入力形式から明示的な形式指定もできます。

## GRRM .com

単独の入力構造に加え、Reactant / Product の各構造をフレームとして読み込みます。Frozen Atoms は各構造へ共通に追加し、その原子を固定します。External Atoms も表示しますが、GRRMのmicroiteration計算は再現しません。Options以降は座標として扱いません。ReadCommonGeometryの座標を再追加することもありません。

Gaussianの .com は別の文法として判別し、タイトルを含むCartesian入力とLink1による複数ジョブに対応します。入力ファイルの命令・計算手法は実行せず、サーバーへの接続も開始しません。

%infile があるGRRM入力では、.com自体に書かれた座標を表示します。参照先の経路を読み込むには、その.logファイルも別途開いてください。

## 対応範囲

すべての座標を内部ではÅへ統一します。表の形式名と拡張子は代表例です。

| 形式・拡張子 | 読み込む内容・範囲 |
| --- | --- |
| GRRM .com | Cartesian、電荷・多重度、Reactant / Product、External / Frozen Atoms、3本のTV |
| GRRM .log | # Geometry of、# NODE、# ITR.、# STEPで始まるCartesianブロック。EQ/TS一覧・経路。エネルギー・勾配は取り込まない |
| GRRM INP4GEN.rrm | NATOM、NFROZENATOMに基づく構造と固定原子。計算条件は取り込まない |
| Gaussian .gjf / .gau / .com | Cartesian、Link1、電荷・多重度、Units=Bohr/AU、固定フラグ -1、D/T・Iso指定、3本のTV |
| Gaussian .log / .out | Standard orientationを優先。存在しない場合はInput、次いでZ-Matrix orientationのCartesian表。ファイル内の選択された表をフレーム化。最後の不完全な表は警告して除外 |
| ORCA .inp / .in | * xyz、%coords CTyp xyz、$new_job、電荷・多重度、Bohrs指定 |
| ORCA xyzfile | 入力と参照XYZを一緒に選択。同名の参照ファイルを端末内で解決し、XYZを重複フレームとして追加しない。自動ダウンロード・任意パスの参照はしない |
| ORCA .out / .log | CARTESIAN COORDINATES (ANGSTROEM)を優先し、ない場合は(A.U.)。電荷・多重度・収束状態は別途確認 |
| XYZ / extXYZ / .txt | 複数フレーム、ヘッダーあり・なし、TV、格子・PBC・追加列（既存対応） |
| MOL / SDF / SD | V2000 / V3000、複数レコード、結合・同位体・形式電荷・立体指定等（既存対応） |
| CIF | CIF 1.1、複数dataブロック、座標・格子・明示的な対称操作（既存対応）。部分占有は警告 |
| PDB / ENT | MODEL、CRYST1、CONECT、altloc空白/A（既存対応） |
| PDBQT | MODEL、AutoDock原子型と部分電荷。結合は推定。未知の原子型はエラー |
| MOL2 | 複数MOLECULE、明示結合、部分電荷（既存対応） |
| POSCAR / CONTCAR / .vasp | 明示的な元素名、Direct / Cartesian、格子、Selective dynamics（既存対応） |
| XDATCAR | VASP5、固定ヘッダーの複数configuration。元素名のないVASP4・可変セルは対象外 |
| GROMACS .gro | 固定幅・可変精度の座標、連結フレーム、3/9成分のbox、nm→Å。速度は対象外。元素は原子名から推定するためCA等は要確認 |
| Gaussian .fchk / .fch | Atomic numbersとCurrent cartesian coordinates、電荷・多重度。Bohr→Å |
| CUBE / CUB | 原子座標のみ。標準Bohr・負の格子数でÅを指定する旧形式。密度・軌道・格子表示は対象外 |
| Molden / MLD | [GEOMETRIES] XYZを優先して全フレーム。なければ[Atoms] Angs/AU、次いで[FR-COORD] Bohr。軌道・振動変位は対象外 |
| TURBOMOLE coord | $coord（既定Bohr / angs）、原子固定 f。fracや周期セル定義は対象外 |
| Q-Chem .in / .inp | $molecule Cartesian、fragment区切り、@@@、INPUT_BOHR。read・Z-matrixは対象外 |
| NWChem .nw / .inp | geometry…end内の明示Cartesian。angstrom / au / bohr / atomic。対称展開・geometry内の追加指令は対象外 |
| GAMESS .inp | $DATA、C1、原子番号・Cartesian、UNITS=BOHR、ICHARG/MULT。対称展開・原子別基底定義は対象外 |
| DFTB .gen | C / S / F、元素表、格子、分率座標。原点は0 0 0のみ。#コメント対応 |
| SIESTA .fdf | species表、Cartesian（既定Bohr）、Ang / ScaledCartesian / Fractional、LatticeConstant（既定1 Ang）、格子ベクトル・格子定数 |
| SIESTA .XV / .STRUCT_OUT / .STRUCT_IN | XVはBohr座標と格子、STRUCTはÅ格子と分率座標。速度は対象外 |
| Quantum ESPRESSO .in | ibrav=0、明示CELL_PARAMETERS、ATOMIC_POSITIONS、angstrom / bohr / alat / crystal、移動可否フラグ。可変セル出力・ibrav展開は対象外 |
| XCrySDen .xsf / .axsf | ATOMSまたは3次元PRIMVEC / PRIMCOORD、アニメーション。SLAB / POLYMERは対象外 |
| FHI-aims geometry.in | atom / atom_frac、3本のlattice_vector。混在座標・部分周期は対象外。constrain_relaxation等は適用せず警告 |
| プロジェクト .json | 本アプリのプロジェクトを復元。他ファイルと混ぜず単独で開く |

## 複数ファイル・文字コード・制限

- ファイル選択で渡された順番に構造を連結します。1件でも読み込みに失敗すると現在の構造を維持します。読み込み待ちの間に編集した場合も、その編集を上書きしません。
- 元素数と並びが全フレームで一致する場合、ファイル内の原子順にIDを揃えます。原子の並べ替え・構造重ね合わせ・化学的な対応推定は行いません。同じ元素の原子でも、反応経路として使用する前に対応を確認してください。
- 原子数・元素順序が異なる構造も閲覧用の構造列として読み込み、警告します。経路計算には一致した原子対応が必要です。
- 1構造は1〜2000原子、1回のインポートは最大200構造・合計100000原子。一度に最大200ファイル・合計50MiB。既存のXYZ/MOL/CIF/JSON等のパーサーには10MiBのテキスト上限も適用します。計算機能には別途、原子数・画像数の上限があります。
- UTF-8（BOM可）、BOM付きUTF-16 LE/BE、Shift_JISに対応します。UTF-8として不正な場合にShift_JISを試します。CRLF / LF / CRを正規化します。
- 不明な原子名、非有限数、不足した座標、曖昧な単位などを推測して埋めません。エラーになった場合は明示的なCartesian座標を含むXYZ等へ変換してください。
- Z-matrix入力、ghost/dummy原子、外部include、参照のみで実座標を含まない入力、任意の出力ログ、圧縮ファイル、バイナリ軌跡・チェックポイント（CHK、GBW、DCD、XTC、TRR、ASE TRAJ、HDF5等）は直接読み込みません。FCHK / XYZ / POSCAR等へ変換してください。
- 読み込んだログの座標は計算の収束やTS検証を保証しません。GRRM・Gaussian・ORCA入力の計算方法や溶媒設定も本アプリの計算条件へ転記しません。
- Frozen Atoms / Gaussian -1 / TURBOMOLE f は本アプリの原子固定へ変換します。Selective dynamics等の軸別フラグは構造データとして保持しますが、原子全体の固定へ勝手に置き換えません。固定原子を使える計算モードは既存の制限に従います。

## 参照仕様

- [GRRM入力](https://afir.sci.hokudai.ac.jp/manual/grrm17/grrm17_12.html)、[構造指定](https://afir.sci.hokudai.ac.jp/manual/grrm17/grrm17_51.html)、[LUP](https://afir.sci.hokudai.ac.jp/manual/grrm17/conventional-calculations/grrm17_15.html)、[INP4GEN](https://afir.sci.hokudai.ac.jp/manual/grrm17/interfaces-with-electronic-structure-calculation-programs/grrm17_48.html)
- [ORCA座標](https://www.faccts.de/docs/orca/6.1/manual/contents/essentialelements/coordinates.html)、[Q-Chem構造](https://manual.q-chem.com/6.1/Ch3.S3.SS2.html)
- [Molden形式](https://www.theochem.ru.nl/molden/molden_format.html)、[DFTB+ GEN実装](https://github.com/dftbplus/dftbplus/blob/main/tools/dptools/src/dptools/gen.py)
- [SIESTA仕様](https://docs.siesta-project.org/projects/siesta/en/5.4/reference/siesta.html)
- Gaussianログ、GRO、TURBOMOLE、XSF等は公開されている[ASEの入出力実装](https://docs.ase-lib.org/ase/io/io.html)も参照。原子順、単位、セルを小さな合成データで検証します。
