# mynote.html への移植メモ

## 状況
- Google Sites 側の「参考資料と備忘録」は、多数の節を含む長いページ。
- GitHub Pages 側の `mynote.html` は、`【発表資料作成の基本】` までで止まっており、末尾に `（以下、工事中）` がある。
- したがって、Google Sites 側の後半節はまだ未移植。

## Google Sites 側で確認できる後半の節
- 〖学会発表･論文執筆の際に役立つかもしれない項目〗
- 〖博士課程への進学を検討している方へ〗
- 〖デスクトップPCの自作について〗
- 〖LANケーブルを差しているのにイーサネットに接続できない場合〗
- 〖遠隔でPCを起動するWake-on-LAN（WOL）の設定手順〗
- 〖ストレージを追加してOS別にデュアルブートする〗
- 〖グラフィックボード換装後にdriverを更新してログインループに陥った場合〗
- 〖VPN接続まわり〗
- 〖Pythonの環境構築について〗
- 〖Juliaの環境構築について〗
- 〖Google Colaboratory関連〗
- 〖GitHub関連〗
- 〖Database関連〗
- 〖ウェブサイト関連〗
- 〖ChatGPT関連〗
- 〖Cifファイル関連〗
- 〖表面モデル関連〗
- 〖VESTA関連〗
- 〖Gaussianプログラムの計算をstand-aloneで実行する手順〗
- 〖電子状態計算ソフトウェア「SIESTA」関連〗
- 〖SIESTAのJOBを分子研計算機に投入するシェルスクリプトの例〗
- 〖電子状態計算ソフトウェア「Quantum ESPRESSO」関連〗
- 〖電子状態計算ソフトウェア「TURBOMOLE」関連〗
- 〖電子状態計算ソフトウェア「Orca」関連〗
- 〖電子状態計算ソフトウェア「DFTB+」関連〗
- 〖GrimmeのDFT-D（D2）パラメータ〗
- 〖確定申告･納税周りについて〗
- 〖資産形成について〗
- 〖北海道内の研究室旅行の行先候補一覧〗
- 〖研究の「さしすせそ」〗

## そのまま貼り足せる section 雛形
```html
<section id="publication-writing">
  <h2>【学会発表･論文執筆の際に役立つかもしれない項目】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="doctoral-course">
  <h2>【博士課程への進学を検討している方へ】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="desktop-pc-build">
  <h2>【デスクトップPCの自作について】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="ethernet-trouble">
  <h2>【LANケーブルを差しているのにイーサネットに接続できない場合】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="wol">
  <h2>【遠隔でPCを起動するWake-on-LAN（WOL）の設定手順】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="dual-boot-storage">
  <h2>【ストレージを追加してOS別にデュアルブートする】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="gpu-login-loop">
  <h2>【グラフィックボード換装後にdriverを更新してログインループに陥った場合】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="vpn">
  <h2>【VPN接続まわり】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="python-setup">
  <h2>【Pythonの環境構築について】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="julia-setup">
  <h2>【Juliaの環境構築について】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="google-colab">
  <h2>【Google Colaboratory関連】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="github">
  <h2>【GitHub関連】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="database">
  <h2>【Database関連】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="website">
  <h2>【ウェブサイト関連】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="chatgpt">
  <h2>【ChatGPT関連】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="cif-files">
  <h2>【Cifファイル関連】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="surface-model">
  <h2>【表面モデル関連】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="vesta">
  <h2>【VESTA関連】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="gaussian-standalone">
  <h2>【Gaussianプログラムの計算をstand-aloneで実行する手順】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="siesta-related">
  <h2>【電子状態計算ソフトウェア「SIESTA」関連】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="siesta-job-script">
  <h2>【SIESTAのJOBを分子研計算機に投入するシェルスクリプトの例】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="qe-related">
  <h2>【電子状態計算ソフトウェア「Quantum ESPRESSO」関連】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="turbomole-related">
  <h2>【電子状態計算ソフトウェア「TURBOMOLE」関連】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="orca-related">
  <h2>【電子状態計算ソフトウェア「Orca」関連】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="dftb-related">
  <h2>【電子状態計算ソフトウェア「DFTB+」関連】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="grimme-d2">
  <h2>【GrimmeのDFT-D（D2）パラメータ】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="tax-filing">
  <h2>【確定申告･納税周りについて】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="asset-building">
  <h2>【資産形成について】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="lab-trip-hokkaido">
  <h2>【北海道内の研究室旅行の行先候補一覧】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>

<section id="research-sasisuseso">
  <h2>【研究の「さしすせそ」】</h2>
  <ul>
    <li>TODO</li>
  </ul>
</section>
```

## 差し込み位置
現状の `mynote.html` では `【発表資料作成の基本】` の直後に `（以下、工事中）` が置かれているため、
上の section 群はその直前に入れるのが自然。
