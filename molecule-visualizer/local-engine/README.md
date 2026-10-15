# 外部エンジン連携と経路緩和

Molecule Studioの「外部エンジン / 経路緩和」から、このPCで動く **tblite** または **g-xTB** を利用できます。ブラウザに実行ファイルのパスを渡す方式ではなく、ユーザーが起動した `bridge.py` が計算を仲介します。GitHub Pagesに計算サーバーや座標をアップロードする必要はありません。

## 1. 導入

Python 3.10以上を使用します。[bridge.py](./bridge.py) を保存してください。以下の手順はbridge.pyだけをダウンロードした場合にも使えます。[requirements.txt](./requirements.txt) は基本パッケージ（numpy・ase・psutil）の一覧で、tbliteは含みません。

### 計算エンジンを選ぶ

使いたい計算手法に応じて、**tbliteまたはg-xTBのどちらか一方**を導入します。

| 起動時の指定 | 計算手法 | 必要なもの | このアプリで扱える系 |
|---|---|---|---|
| `--engine tblite` | GFN2-xTB（既定）、GFN1-xTB、IPEA1-xTB | tbliteのPython API（condaでは`tblite-python`） | 非周期系・固定セルの周期系 |
| `--engine gxtb --binary …` | g-xTB | 公式のg-xTB対応xtb実行ファイルと付属ライブラリ | 非周期系 |

**通常配布版tblite 0.7.0はg-xTBに対応していません（2026年10月15日確認）。** [tbliteの組み込み手法](https://tblite.readthedocs.io/en/latest/spec/methods.html)は上表の3種類です。[公式g-xTB](https://github.com/grimme-lab/g-xtb)は改変版tbliteを内部で使用していますが、通常配布版tbliteのPython APIとは異なります。g-xTBが目的なら、下の「g-xTBの実行ファイルを使う」へ進んでください。

### Windowsでtbliteを使う（推奨：Miniforge）

1. [Miniforge公式配布ページ](https://conda-forge.org/download/)からWindows x86_64版をインストールします。
2. スタートメニューの「Miniforge Prompt」を開き、専用環境を作ります。既存のPythonや仮想環境を削除する必要はありません。

```bat
conda create -n molecule-studio -c conda-forge --override-channels python=3.12 numpy ase psutil "tblite-python>=0.4,<1"
conda activate molecule-studio
python -c "import numpy, ase, psutil; from tblite.interface import Calculator; print('OK')"
```

3. `OK`が表示されたら、bridge.pyの保存先へ移動して起動します。次のパスは実際の保存先に置き換えてください。

```bat
cd /d "C:\Users\ユーザー名\Downloads"
python bridge.py --engine tblite --allow-origin https://h-nabata.github.io
```

次回以降もMiniforge Promptで `conda activate molecule-studio` を実行し、保存先へ移動してから起動します。conda-forgeでのPython APIのパッケージ名は **`tblite-python`** です。`tblite`だけの導入ではPython APIを導入したことにはなりません。[tblite公式Pythonチュートリアル](https://tblite.readthedocs.io/en/latest/tutorial/python/singlepoint.html)もこのパッケージを使用しています。

#### pipで「Unknown compiler(s)」が出た場合

Windows用の対応wheelが見つからないと、pipは `tblite-….tar.gz` を取得してソースからビルドします。`Unknown compiler(s): … ifort … ifx … gfortran …` は、そのビルドに必要なFortranコンパイラが見つからないというエラーです。Visual StudioのC/C++コンパイラだけでは足りません。利用者のコマンド入力の誤りではなく、以前の案内がWindowsでのバイナリ配布条件を説明していませんでした。

通常の導入ではコンパイラを追加する必要はありません。上記のMiniforge環境を新しく作ってください。`pip install tblite`を繰り返したり、`--only-binary`を外してソースビルドを始めたりする必要はありません。自前ビルドを行う場合は[公式のビルド要件](https://tblite.readthedocs.io/en/latest/installation.html)を確認してください。

### WSL / Linux / macOSでtbliteを使う

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install "numpy>=1.24,<3" "ase>=3.23,<4" "psutil>=5.9,<8"
python -m pip install --only-binary=:all: 'tblite>=0.4,<1'
python -c "import numpy, ase, psutil; from tblite.interface import Calculator; print('OK')"
python bridge.py --engine tblite --allow-origin https://h-nabata.github.io
```

`--only-binary=:all:` は対応wheelがない場合にソースビルドへ進むことを防ぎます。「No matching distribution found」なら、そのOS・CPU・Pythonに対応するwheelを取得できていません。その場合はMiniforgeを導入して、Windowsの例と同じ `conda create` と `conda activate` を使えます（フォルダー移動には通常の `cd` を使用）。Windows＋WSLで既存の計算エンジンを利用する場合は、サービスもそのWSL内で起動します。

### g-xTBの実行ファイルを使う

このアダプタは、[公式g-xTBリポジトリ](https://github.com/grimme-lab/g-xtb) が配布する **`xtb --gxtb --grad` 対応版**を対象にしています。旧版の独立した `gxtb` 実行ファイルとはコマンド形式が異なります。実行ファイルと付属ライブラリはユーザーがローカルに導入します。g-xTB使用時はtbliteのPythonパッケージは不要です。

[公式のbinariesフォルダー](https://github.com/grimme-lab/g-xtb/tree/main/binaries)からOSに対応する配布物を取得し、展開してください。通常版のxtbではなく、g-xTB対応版を指定します。

#### Windows（コマンドプロンプト）

Python 3.10以上を用意し、bridge.pyの保存先で専用環境を作ります。以下の2種類のパスを実際の保存先に置き換えてください。付属DLLも配布時の配置を保ち、xtb.exeがあるbinフォルダーをPATHへ追加します。

```bat
cd /d "C:\Users\ユーザー名\Downloads"
python -m venv .venv-gxtb
.venv-gxtb\Scripts\python.exe -m pip install "numpy>=1.24,<3" "ase>=3.23,<4" "psutil>=5.9,<8"
set "PATH=C:\path\to\g-xtb\bin;%PATH%"
"C:\path\to\g-xtb\bin\xtb.exe" --help
.venv-gxtb\Scripts\python.exe bridge.py --engine gxtb --binary "C:\path\to\g-xtb\bin\xtb.exe" --allow-origin https://h-nabata.github.io
```

`--help`で起動でき、`--gxtb`と`--grad`が使える版であることを確認します。`set`は現在のコマンドプロンプトだけに適用されます。次回も保存先へ移動し、PATHを設定してから最後の起動コマンドを実行してください。仮想環境の作成とpipによる導入は初回だけです。

#### WSL / Linux / macOS

```sh
python3 -m venv .venv-gxtb
source .venv-gxtb/bin/activate
python -m pip install "numpy>=1.24,<3" "ase>=3.23,<4" "psutil>=5.9,<8"
/absolute/path/to/xtb --help
python bridge.py --engine gxtb --binary /absolute/path/to/xtb --allow-origin https://h-nabata.github.io
```

`/absolute/path/to/xtb`は対応実行ファイルの絶対パスに置き換えます。macOSでは付属ライブラリも配置し、公式READMEの案内に従ってください。WSLではLinux用バイナリとWSL内のPythonを使います。

既にtblite用のPython環境を作った場合は、その環境を再利用し、g-xTB対応実行ファイルを指定して起動することもできます。g-xTB使用時はtbliteのPythonパッケージを呼び出しません。空白のあるパスは引用符で囲みます。サービスは引数配列と `shell=False` で実行し、ブラウザからコマンド・任意の引数・ファイルパスは受け取りません。

### 起動後の接続（両エンジン共通）

起動するとURLと、起動のたびに変わる `Token` が表示されます。アプリの接続先URLと接続トークン欄へ入力し、「接続を確認」を押してください。ブラウザからローカルネットワークへの接続許可が求められた場合は許可します。接続トークンはブラウザの永続ストレージ・プロジェクト・結果JSONに保存しません。

端末はアプリの利用中開いたままにします。エンジンを切り替える場合はCtrl+Cでサービスを停止し、もう一方の `--engine` で起動して、新しく表示されたTokenで接続し直してください。

### 公開サイトから接続できない場合

ブラウザ・組織のポリシーによってHTTPSサイトからlocalhostへの接続が制限される場合があります。ブラウザ全体のセキュリティ設定を無効化する必要はありません。リポジトリを手元に取得して、アプリも同じローカルサービスから配信できます。

```bash
python bridge.py --engine tblite --site-dir /path/to/h-nabata.github.io/molecule-visualizer
```

`http://127.0.0.1:8766/` を開き、端末に表示されたTokenで接続します。この場合、公開サイト用の `--allow-origin` は不要です。`--site-dir` には必ずアプリのフォルダーを指定してください。

## 2. 操作

1. 構造を読み込み、座標欄の未適用編集を適用します。経路の場合は「反応経路の初期構造」から3〜20構造を生成するか、複数構造XYZ/SDFなどを読み込みます。
2. 「外部エンジン / 経路緩和」で接続し、**系全体の電荷とスピン多重度**を確認します。多重度は `2S+1`、エンジンへ渡す不対電子数は多重度−1です。g-xTBの閉殻一重項では `--uhf` を付けません。
3. 操作、収束閾値、最大ステップ数などを設定して計算します。経路の元素・原子数・File-order・セルは全フレームで同じである必要があります。
4. エネルギー図、数値表、収束状態を確認して「結果を構造へ適用」を押します。適用前の描画構造は変わりません。計算開始後に構造・編集欄が変更された場合は上書きを拒否します。適用は1回のUndoで戻せます。
5. 「エネルギー・力・履歴をJSON保存」で入力条件、座標、各原子の力、全エネルギー、ステップ履歴を保存できます。適用した構造列は既存の全フレームXYZ/SDF/プロジェクト保存も利用できます。

一度に実行するジョブは1つ、最大500原子・20構造です。電荷・スピンの偶奇、非有限座標、周期最小像で0.1 Å未満の重なりを検査します。電子計算のSCF失敗はエラーとして停止し、未検証の構造を自動適用しません。最大ステップ到達は「未収束」と表示します。

bridge.py 1.1.2以降では、外部エンジンの最大ステップ数を1〜10,000で指定できます（既定値150）。1.1.1以前の上限は1,000です。AFIRの既定値・上限は10,000です。旧サービスの場合はファイルを差し替えて再起動し、新しいTokenで再接続してください。

収束しきい値と最大変位の上下ボタンは0.01刻み、ばね定数は0.1刻みです。0.00001などの細かな値は直接入力できます。計算に使える下限は収束しきい値0.00001、最大変位・ばね定数0.001で、0は拒否します。

「計算を中止」でネイティブ計算も停止します。接続を失ったりブラウザを閉じたりした場合、計算はローカル側で継続することがあります。端末の **Ctrl+C** でサービスと計算を停止できます。既定のジョブ上限は30分、g-xTBの1評価上限は120秒、計算スレッド数は1です。必要ならサービス起動時に `--job-timeout 3600 --evaluation-timeout 300 --threads 4` などを指定します。終了した計算は次の計算で置き換わるため、必要な結果は保存してください。

## 3. 緩和方式

座標単位はÅ、エネルギーはeV、力はeV/Åです。tbliteとg-xTBの原子単位を変換し、`F = −∇E` とします。質量重み付けなしの、**全原子をまとめた3N次元Cartesian空間**で接線を定義します。個々の原子で独立に射影する方式ではありません。

局所単位接線を `τᵢ` とすると、物理的な力の直交成分は次の通りです。

```text
F⊥ᵢ = Fᵢ − (Fᵢ · τᵢ) τᵢ
```

| 操作 | 内部構造への力 | 端点 |
|---|---|---|
| 評価 | 移動なし。物理的な力・エネルギーを取得 | 移動なし |
| 単一構造の最適化 | 全物理力 | 現在の1構造のみ |
| 直交方向のみ緩和（既定の経路モード） | `F⊥`。接線方向のばね・再配置なし | 固定 |
| NEB | `F⊥ + k (隣接距離の差) τ` | 固定 |
| CI-NEB | 通常像はNEB。CI像は `F − 2(F·τ)τ`、ばねなし | 固定 |

接線には隣接構造のエネルギー差を重みにしたimproved tangentを使用します。エネルギーが同じ場合は幾何学的な接線にフォールバックします。CIは指定ステップ以降の最高エネルギーの内部構造1つです。**CI像は意図的に接線方向へ登るので、「直交方向のみ」ではありません。** 最高点の候補が変わると積分器の速度をリセットします。

座標更新は変位上限付きFIRE方式です。直交モードでは力の射影に加え、蓄積した速度と実際の更新量を毎ステップの接線へ再射影します。変位上限は各構造の全3N成分に共通の係数で適用します。原子ごとに異なる係数で切り詰めると直交性が壊れるため、その方式は使いません。報告される接線方向最大更新は `max |ΔRᵢ·τᵢ|` です。

「接線方向に動かない」は**各ステップの局所接線に対して**成立します。経路の曲率・接線自体は緩和で変化するため、最初の経路上の弧長や端点間の直線への射影位置を厳密に固定する制約ではありません。直交力が収束しても、接線方向の物理力が残ることがあります。構造が不適切に全方向へ最小化されることは防ぎますが、得られた経路・最高点が真の最小エネルギー経路・一次鞍点であることまでは保証しません。端点の事前最適化、適切な原子対応、必要な遷移状態・振動解析は別途行ってください。

ブラウザ内の**初期経路の衝突緩和**も変更しました。距離補間の人工的な目的関数の勾配、弱い平滑化項、初期の対称性を崩す摂動を、幾何学的な局所接線に直交する方向へ射影します。端点を固定し、隣接構造を同じ反復時点で評価します。こちらは電子エネルギーを計算せず、NEBのばねやCI像も使用しません。

## 4. 周期系・対応範囲

- **tblite:** 固定格子と周期方向をそのまま渡します。格子・座標をBohrへ変換します。GFN2-xTB（既定）、GFN1-xTB、IPEA1-xTBは `--method` で選択できます。元素は最大Rn（Z=86）、実際のパラメータ対応はエンジンが判定します。
- **g-xTB:** このアダプタは非周期系専用です。周期セルが有効な入力は拒否します。元素の上限はLr（Z=103）。`xtb --gxtb --grad` のTurbomole形式gradientからエネルギー・勾配を読み、元素順序と返された座標も照合します。
- 周期経路は**連続した、折り返していないCartesian座標**で入力します。緩和中に原子ごとの最小像へ経路を再写像しません。境界をまたぐ短い初期経路は、初期構造生成の「周期系で終点の最小像を使う」で作れます。この初期生成では終点が周期等価な座標になりますが、外部緩和へ渡した後は両端点を一切動かしません。
- 可変セルNEB、原子位置の固定、溶媒、外場、電荷・スピン状態をまたぐ経路、複数電子状態の追跡には対応していません。現在のUIでは系全体の電荷・多重度を全構造に共通して指定します。POSCARのselective dynamicsは外部緩和の拘束条件には使用しません。
- CIFの部分占有は計算前に確定した構造へ整理します。SMILES/MOLの結合次数は電子計算へ強制せず、元素・座標・総電荷・多重度を渡します。同位体は通常のBorn–Oppenheimerエネルギーに影響せず、質量を使う計算は行いません。

## 5. 接続の境界

サービスは **127.0.0.1のみ**に待ち受けます。毎回のランダムBearerトークン、Hostヘッダーの限定、許可Originとの完全一致、JSON POST、入力サイズ・数値・ジョブ数の制限を併用します。CORSだけを認証として使用しません。`--allow-origin` は信頼するサイトだけに指定してください。

サービスの接続権限は、その許可したサイトのJavaScriptを信頼することを意味します。トークンの漏洩や許可サイトの侵害まで防ぐサンドボックスではありません。管理者権限で起動する必要はありません。計算の各評価は一時フォルダーで実行し、中止・失敗・完了後に削除します。任意のシェルコマンドやユーザーのファイルを読み書きするAPIは提供しません。

## 6. 検証と参考仕様

```bash
python -m unittest discover -s molecule-visualizer/tests -p 'test_*.py' -v
node --test molecule-visualizer/tests/*.test.cjs
```

テストはリポジトリのルートで実行します。解析的二重井戸ポテンシャルでの収束、実際の変位の直交性、端点固定、ASEのimproved-tangent NEB/CI力との一致、tblite実計算の有限差分勾配・単一最適化・固定セル経路、HTTP認証・Origin・Host検証、ネイティブ子プロセスの中止を検査します。`GXTB_TEST_BINARY=/absolute/path/to/xtb` を環境変数に設定するとg-xTBの実エネルギー・勾配の有限差分検証も実行します。

g-xTBは公式配布 `xtb-6.7.1-gxtb-140526-linux-x86_64` で検証しています。別バージョンやOSでは導入後に単一構造の評価から確認してください。

- [tblite Python API](https://tblite.readthedocs.io/en/latest/api/python.html)
- [g-xTB公式の実行方法](https://github.com/grimme-lab/g-xtb)
- [xtbのTurbomole gradient出力](https://github.com/grimme-lab/xtb/blob/main/src/io/writer/turbomole.f90)
- Henkelman & Jónsson, *Improved tangent estimate in the nudged elastic band method*, J. Chem. Phys. 113, 9978 (2000), [DOI](https://doi.org/10.1063/1.1323224)
- Henkelman, Uberuaga & Jónsson, *A climbing image nudged elastic band method*, J. Chem. Phys. 113, 9901 (2000), [DOI](https://doi.org/10.1063/1.1329672)

## 7. 複数フラグメントAFIR（1.2.0）

AFIRを利用する場合は、このフォルダーの`bridge.py`を最新版の1.2.0へ更新して再起動します。最大ステップ数の既定値・上限は10,000です。1.1.0のAFIR上限は500ステップで、1.1.1以降は10,000です。追加のPython依存関係はありません。NEBと同じ接続画面を使います。[AFIR操作説明](../AFIR.md)を参照してください。

AFIRは非周期分子専用です。人工項を加えたエネルギーのFIRE最適化を実行し、物理エネルギーと人工項、原子ID付きの全評価フレームを区別して返します。中止時は受領済みの途中フレームを保持し、子プロセスの終了後に停止を報告します。結果はサービスのメモリ上にあるため、終了前にブラウザからJSONを保存してください。

Windowsでの実g-xTB試験と、残る未検証範囲は[追加検証記録](../AFIR-VALIDATION.md)に記載しています。NEBの従来の検証記録とは区別します。

## 8. ライブ表示と結果の対話的な確認（1.2.0）

最新版のbridge.pyをダウンロードして再起動・再接続すると、「計算中のエネルギー・構造を表示」を利用できます。既定ではオフで、追加の依存パッケージはありません。

AFIRは探索ステップごとの物理エネルギーと人工項を加えたエネルギーを表示します。NEB・CI-NEB・直交緩和は、最後に全構造の評価がそろった経路のエネルギープロファイルを更新します。ライブ中の構造表示は経路の中央の構造です。単一構造の評価・最適化では、最新または最終の1点を表示します（単一構造最適化の全座標履歴は今回の対象外です）。

外部エンジンのライブ表示を開始すると設定ウィンドウを閉じ、構造エリアとグラフを表示します。「計算設定・結果」でウィンドウへ戻り、「計算を中止」で停止できます。通常の結果も「エネルギープロファイルと構造を見る」から点・スライダーを選択してプレビューできます。入力の置き換えは「結果を構造へ適用」で行います。

APIでは /api/info の livePreview: 1 が対応を示します。GET /api/jobs/{id}?preview=1&after={取得済み件数} で任意の進捗表示を取得します。AFIRは1応答最大1,000件のエネルギー差分と最新1構造だけを返します。経路はジョブ入力の livePreview: true を指定した場合に最新の完全な経路を保持します。通常のGETは途中座標を返しません。Host・Origin・Bearer Tokenの検証は従来どおり必要です。分子データを外部サーバーへ送信しません。
