(() => {
  const symbols = (
    "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn " +
    "Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr " +
    "Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra " +
    "Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og"
  ).split(" ");
  const atomicNumbers = new Map(symbols.map((symbol, index) => [symbol, index + 1]));
  const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][+-]?\d+)?$/;
  const number = value => numeric.test(value) ? Number(value.replace(/[dD]/, "E")) : NaN;
  const chargePattern = /^([+-]?\d+)\s+([+-]?\d+)$/;
  const jobPattern = /^(?:FREQ|MIN|SADDLE(?:\+IRC)?|IRC|LUP|ADDF|LADD|SCW|2PSHS|MC-AFIR|SC-AFIR(?:10|[2-9])?|DS-AFIR|REPATH|RESTRUCT|REENERGY|RCMC|GRRM)$/;
  const requiresInfile = new Set(["LUP", "REPATH", "RESTRUCT", "REENERGY", "RCMC"]);
  const doubleEnded = new Set(["2PSHS", "SCW", "DS-AFIR"]);
  const afirSearch = /^(?:MC-AFIR|SC-AFIR(?:10|[2-9])?)$/;
  const gaussianDirectives = new Set([
    "chk", "oldchk", "mem", "nproc", "nprocshared", "nproclinda", "lindaworkers",
    "cpu", "gpucpu", "rwf", "int", "d2e", "nosave", "save", "subst", "kjob"
  ]);
  const grrmDirectives = new Set(["infile", "link"]);
  const coordinateSections = new Map([
    ["externalatoms", "External Atoms"], ["frozenatoms", "Frozen Atoms"],
    ["reactant", "Reactant"], ["product", "Product"]
  ]);
  const optionBlocks = new Map([
    ["addinteraction", "Add Interaction"], ["bondcondition", "Bond Condition"],
    ["prioritypath", "Priority Path"], ["readmultipleinfile", "ReadMultipleInFile"],
    ["readcommongeometry", "ReadCommonGeometry"], ["secondinput", "Second Input"],
    ["gauinpb", "GauInpB"], ["tmoleinpb", "TmoleInpB"], ["molproinput", "Molpro Input"]
  ]);
  const externalBlocks = new Set(["secondinput", "gauinpb", "tmoleinpb", "molproinput"]);
  const molproBlocks = new Map([["stable=opt", "Stable=Opt"], ["heslow", "HESLOW"], ["sphigh", "SPHIGH"]]);
  const optionKey = line => line.toLowerCase().replace(/\s/g, "");
  const link1 = /^--\s*link1\s*--$/i;
  const fragmentPattern = /^fragm\.?\s*\d+\s*=\s*(.*)$/i;
  const targetPattern = /^(target|universalforcetarget|decdctarget|dcdectarget|bondcontarget|matchdectarget)\s*=\s*(.*)$/i;
  const gammaPattern = /^gamma\b\s*=\s*(\S+)(?:\s+set\s+(\S+))?$/i;
  const gammaName = /^(gamma|ganma|gammaa)\b/i;

  function checkDirective(line, index, header, report) {
    const match = line.match(/^%\s*([\w-]+)(?=\s|=|$)/);
    if (!match) return;
    const name = match[1].toLowerCase();
    const assignment = line.slice(match[0].length).match(/^\s*=\s*(.*)$/);

    if (gaussianDirectives.has(name)) {
      const replacement = name === "mem" ? " GaussianのメモリはOptions内のGauMem（単位MW）で指定します。"
        : /^(nproc|nprocshared)$/.test(name) ? " Gaussianのプロセッサ数はOptions内のGauProcで指定します。"
        : /^(chk|oldchk)$/.test(name) ? " 既存のチェックポイントから軌道を読む場合はOptions内のMO GUESSを確認してください。"
        : "";
      report("error", "%" + match[1] + " はGaussianのLink 0指令です",
        "GRRMの入力では設定として使えません。" + replacement, index);
      return;
    }
    // GRRM also allows percent-prefixed comments in the preamble.
    if (!grrmDirectives.has(name)) return;
    if (!header) {
      report("error", "%" + name + " の位置を確認してください", "GRRMの % 指令は # のジョブ指定より前に置きます。", index);
      return;
    }
    if (!assignment?.[1] || assignment[1].startsWith("=")) {
      const example = name === "infile" ? "%infile=previous_job" : "%link=siesta-3.1";
      report("error", "%" + name + " に値が必要です", example + " のように指定してください。", index);
      return;
    }
    if (header.has(name)) report("warning", "%" + name + " が重複しています", "指定を1行にまとめてください。", index);
    header.set(name, assignment[1]);
  }

  function readGeometry(lines, start, job, report) {
    const sections = new Map([["initial", {atoms: [], line: start}]]);
    let section = sections.get("initial");
    let complete = true;
    let i = start;
    let gap = null;
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (!line) {
        gap ??= i;
        continue;
      }
      if (/^options$/i.test(line)) {
        if (gap !== null) report("warning", "座標とOptionsの間に空行があります", "Optionsを座標の直後に置いてください。", gap);
        i++;
        break;
      }
      if (link1.test(line)) break;
      const key = optionKey(line);
      if (optionBlocks.has(key) || /^(?:nofc|moguess=|gau(?:mem|proc)=|sublink=)/.test(key)) {
        report("error", "Options 行がありません", "座標とオプションの間に Options を置いてください。", i);
        break;
      }
      if (gap !== null) {
        report("warning", "座標欄に空行があります", "電荷・多重度から座標欄の末尾までは空行を挟まず記述してください。", gap);
        gap = null;
      }
      if (line.startsWith("%")) {
        checkDirective(line, i, null, report);
        continue;
      }
      if (coordinateSections.has(key)) {
        if (sections.has(key)) report("warning", coordinateSections.get(key) + " が重複しています", "座標欄の見出しを確認してください。", i);
        else sections.set(key, {atoms: [], line: i});
        section = sections.get(key);
        continue;
      }
      const [label, x, y, z] = line.split(/\s+/);
      if (!/^[A-Za-z]{1,2}$/.test(label) || ![x, y, z].every(value => Number.isFinite(number(value)))) {
        report("error", "直交座標を読み取れません", "元素記号と3つの数値を指定してください。GRRMの座標欄はZ-matrixに対応しません。", i);
        complete = false;
        continue;
      }
      // TV entries define lattice vectors. Part numbers and ONIOM fields follow XYZ.
      if (label.toUpperCase() === "TV") continue;
      const symbol = label[0].toUpperCase() + label.slice(1).toLowerCase();
      if (!atomicNumbers.has(symbol)) {
        report("warning", "元素記号を原子番号に変換できません", label + " の綴りを確認してください。", i);
      } else if (symbol !== label) {
        report("warning", "元素記号の大文字・小文字を確認してください", label + " は " + symbol + " と表記します。", i);
      }
      section.atoms.push(symbol);
    }

    const initial = sections.get("initial").atoms;
    if (!initial.length) {
      report("error", "初期座標がありません", "電荷・多重度の次の行から原子の直交座標を記述してください。", start - 1);
    }
    for (const [key, entry] of sections) {
      if (key !== "initial" && !entry.atoms.length) {
        report("error", coordinateSections.get(key) + " の座標がありません", "見出しの直後に原子の直交座標を記述してください。", entry.line);
      }
    }
    const external = sections.get("externalatoms")?.atoms ?? [];
    const frozen = sections.get("frozenatoms")?.atoms ?? [];
    const atoms = [...initial, ...external, ...frozen];
    const reactant = sections.get("reactant");
    if (doubleEnded.has(job) && !reactant) {
      report("error", "Reactant の座標がありません", job + "では初期座標の後に Reactant ともう一方の端点の座標を指定します。", start - 1);
    }
    if (complete && initial.length) {
      const endpoints = [[reactant, [...initial, ...external], "Reactant"]];
      if (!external.length && !frozen.length) endpoints.push([sections.get("product"), initial, "Product"]);
      for (const [endpoint, reference, name] of endpoints) {
        if (endpoint?.atoms.length && (endpoint.atoms.length !== reference.length ||
          endpoint.atoms.some((symbol, j) => symbol !== reference[j]))) {
          report("warning", name + " の原子数または元素順序が一致しません", "初期構造と端点の原子の対応を確認してください。", endpoint.line);
        }
      }
    }
    return {atoms, complete: complete && initial.length > 0, next: i};
  }

  function checkAtomList(value, label, atomCount, index, report) {
    if (!atomCount || !/^-?\d+(?:\s*-\s*-?\d+)?(?:[\s,]+-?\d+(?:\s*-\s*-?\d+)?)*$/.test(value)) return;
    for (const match of value.matchAll(/(-?\d+)(?:\s*-\s*(-?\d+))?/g)) {
      const first = Number(match[1]);
      const last = Number(match[2] ?? first);
      if (first < 1 || last < first || last > atomCount) {
        report("warning", label + " の原子番号が範囲外です",
          match[0] + " を指定しています。入力座標の原子番号は 1～" + atomCount + " です。", index);
        return;
      }
    }
  }

  function checkOptions(lines, start, job, header, atomCount, report) {
    const isMolpro = /^molpro/i.test(header.get("link") ?? "");
    let block = null;
    let hasInteraction = false;
    let hasSublink = false;
    let gap = null;
    const finish = closed => {
      if (!closed) report("error", block.name + " の END がありません", "ブロックを単独行の END で閉じてください。", block.line);
      if (block.key === "addinteraction" && !block.hasGamma) {
        report("warning", "Add Interaction 内に GAMMA がありません", "GAMMA = 100 のように衝突エネルギーを指定してください。", block.line);
      }
      block = null;
    };

    for (let i = start; i < lines.length; i++) {
      const line = lines[i];
      if (link1.test(line) && !block?.external) {
        report("error", "--Link1-- はGaussianの区切りです", "GRRMの1つの入力ファイルには1つのジョブを記述します。", i);
        break;
      }
      if (block?.external) {
        // The external program's input can contain its own blanks, delimiters and comments.
        if (/^end$/i.test(line)) finish(true);
        continue;
      }
      if (!line) {
        gap ??= i;
        continue;
      }
      if (gap !== null) {
        report("warning", "Options 内に空行があります", "Optionsとその各設定の間は空けずに記述してください。", gap);
        gap = null;
      }
      const key = optionKey(line);
      const molproBlock = isMolpro ? molproBlocks.get(key) : undefined;
      const blockName = optionBlocks.get(key) ?? molproBlock;
      if (blockName) {
        if (block) finish(false);
        block = {key, name: blockName, line: i, hasGamma: false, external: Boolean(molproBlock) || externalBlocks.has(key)};
        hasInteraction ||= key === "addinteraction";
      } else if (key === "end") {
        if (block) finish(true);
      } else if (line.startsWith("%")) {
        checkDirective(line, i, null, report);
      } else if (gammaName.test(line) && (!block || block.key === "addinteraction")) {
        if (!/^gamma\b/i.test(line)) {
          report("warning", "GAMMA の綴りを確認してください", "Add Interaction 内では GAMMA と記述します。", i);
        } else if (!block) {
          report("warning", "GAMMA が Add Interaction の外にあります", "GAMMA は Add Interaction と END の間に記述します。", i);
        } else {
          block.hasGamma = true;
          const gamma = line.match(gammaPattern);
          const values = gamma?.slice(1).filter(value => value !== undefined).map(number);
          if (!values?.every(Number.isFinite)) {
            report("warning", "GAMMA の値を読み取れません", "GAMMA = 100 または GAMMA = 100 set 50 の書式を確認してください。", i);
          } else if (values.some(value => value < 0)) {
            report("error", "GAMMA に負の値があります", "GAMMA の値には0以上を指定します。", i);
          }
        }
      } else if (block?.key === "addinteraction") {
        const fragment = line.match(fragmentPattern);
        const target = line.match(targetPattern);
        if (fragment) checkAtomList(fragment[1], "Fragm.", atomCount, i, report);
        if (target?.[1].toLowerCase() === "target") checkAtomList(target[2], target[1], atomCount, i, report);
      } else if (block?.key === "prioritypath") {
        const pair = line.match(/^(\d+)\s+(\d+)\s+(?:plus|minus|[+-])$/i);
        if (pair) checkAtomList(pair.slice(1).join(","), "Priority Path", atomCount, i, report);
      } else if (!block) {
        const target = line.match(targetPattern);
        if (target && target[1].toLowerCase() !== "target") checkAtomList(target[2], target[1], atomCount, i, report);
        const resource = line.match(/^(GauMem|GauProc)\b\s*(.*)$/i);
        if (resource && !/^=\s*0*[1-9]\d*$/.test(resource[2])) {
          report("warning", resource[1] + " の値を確認してください", "Options内で = に続けて正の整数を指定してください。", i);
        }
        hasSublink ||= /^sub\s*link\s*=\s*[^=\s]/i.test(line);
      }
    }
    if (block) finish(false);
    if (afirSearch.test(job) && !hasInteraction) {
      report("error", "Add Interaction が見つかりません", job + "では Options に Add Interaction、GAMMA、END を記述します。");
    }
    if (header.get("link")?.toLowerCase() === "non-supported" && !hasSublink) {
      report("error", "sublink の指定がありません", "%link=non-supported では Options に sublink=実行するプログラム を指定します。");
    }
  }

  function check(text) {
    const lines = text.split(/\r\n?|\n/).map(line => line.trim());
    const issues = [];
    const report = (severity, title, detail, index) => {
      issues.push({severity, title, detail, line: index === undefined ? undefined : index + 1});
    };
    if (!text.trim()) {
      report("error", "入力が空です", "ファイルを読み込むか、入力テキストを貼り付けてください。");
      return issues;
    }

    const header = new Map();
    let i = 0;
    while (i < lines.length && (!lines[i] || lines[i].startsWith("%"))) {
      if (lines[i]) checkDirective(lines[i], i, header, report);
      i++;
    }
    const route = lines[i]?.match(/^#\s*([^/\s]+)(.*)$/);
    if (!route) {
      report("error", "GRRMのジョブ指定がありません", "# MIN/B3LYP/6-31G のように # に続けてジョブタイプを指定してください。", i < lines.length ? i : undefined);
      return issues;
    }
    const job = route[1].toUpperCase();
    const routeTail = route[2].trim();
    const jobKnown = jobPattern.test(job);
    if (!jobKnown) {
      const gaussianRoute = /^(?:[PNT]|OPT(?:[=(].*)?|SP|HF|[RU]HF|[RU]?B3LYP|[RU]?MP[234]|[RU]?PBE0|CCSD(?:\(T\))?)$/.test(job);
      report(gaussianRoute ? "error" : "warning",
        gaussianRoute ? "Gaussian形式のルート指定です" : "GRRMのジョブタイプを確認してください",
        "# の直後には MIN、SADDLE、SC-AFIR、LUP などのGRRMジョブタイプを指定します。", i);
    } else if (routeTail && !/^\/\s*\S/.test(routeTail)) {
      report("error", "ジョブタイプの後の計算レベル指定を確認してください", "計算レベルは # MIN/B3LYP/6-31G のように / で区切ります。", i);
    } else if (!routeTail && !header.has("link") && job !== "RCMC") {
      report("warning", "計算レベルが指定されていません", "Gaussianを連携する場合はジョブタイプの後ろに /計算レベル を記述します。", i);
    }
    if (requiresInfile.has(job) && !header.has("infile")) {
      report("error", job + " に %infile がありません", "# より前に %infile=参照するジョブ名 を指定してください。", i);
    }

    const routeLine = i++;
    while (i < lines.length && !lines[i]) i++;
    let chargeMatch = lines[i]?.match(chargePattern);
    if (!chargeMatch && i < lines.length) {
      // A title card may be followed by the charge line. Diagnose it without using it as input.
      const titleLine = i;
      while (i < lines.length && lines[i] && !lines[i].startsWith("#") && !link1.test(lines[i]) &&
        !/^options$/i.test(lines[i]) && !chargePattern.test(lines[i])) {
        if (lines[i].startsWith("%")) checkDirective(lines[i], i, null, report);
        i++;
      }
      while (i < lines.length && !lines[i]) i++;
      chargeMatch = lines[i]?.match(chargePattern);
      if (chargeMatch) {
        report("error", "電荷・多重度の前に余分な行があります",
          "GRRMではジョブ指定の後の空行に続けて電荷と多重度を書きます。Gaussianのタイトルカードは削除してください。", titleLine);
      }
    }
    if (!chargeMatch) {
      report("error", "電荷・スピン多重度を読み取れません", "ジョブ指定と空行の直後に 0 1 のように整数2つで記述してください。",
        i < lines.length ? i : routeLine);
      return issues;
    }
    const chargeLine = i;
    const charge = Number(chargeMatch[1]);
    const multiplicity = Number(chargeMatch[2]);
    const validCharge = Number.isSafeInteger(charge);
    const validMultiplicity = Number.isSafeInteger(multiplicity) && multiplicity >= 1;
    if (!validCharge || !validMultiplicity) {
      report("error", "電荷またはスピン多重度が不正です", "電荷は整数、多重度は1以上の整数で指定してください。", chargeLine);
    }

    const geom = readGeometry(lines, i + 1, job, report);
    if (geom.complete) {
      report("info", "座標ブロックを読み取りました",
        geom.atoms.length + " 原子、電荷 " + charge + "、多重度 " + multiplicity + " と読み取りました。", chargeLine);
      // External backends can obtain charge and spin from their own input.
      if (jobKnown && job !== "RCMC" && !header.has("link") && validCharge && validMultiplicity &&
        geom.atoms.every(symbol => atomicNumbers.has(symbol))) {
        const electrons = geom.atoms.reduce((sum, symbol) => sum + atomicNumbers.get(symbol), 0) - charge;
        if (electrons < 0 || multiplicity - 1 > electrons) {
          report("error", "電子数とスピン多重度の組み合わせが不正です", "電荷・原子組成・多重度を確認してください。", chargeLine);
        } else if (electrons % 2 === multiplicity % 2) {
          report("warning", "電子数とスピン多重度の偶奇が一致しません", "入力座標と電荷から求めた電子数を確認してください。", chargeLine);
        }
      }
    }
    checkOptions(lines, geom.next, job, header, geom.complete ? geom.atoms.length : 0, report);
    return issues;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = check;
    return;
  }

  const fileInput = document.getElementById("grrm-input-file");
  const textInput = document.getElementById("grrm-input-text");
  const runButton = document.getElementById("grrm-check-run");
  const clearButton = document.getElementById("grrm-check-clear");
  const status = document.getElementById("grrm-check-status");
  const results = document.getElementById("grrm-check-results");
  const samplePreview = document.getElementById("grrm-sample-preview");
  const sampleContent = document.getElementById("grrm-sample-content");
  const sampleLoad = document.getElementById("grrm-sample-load");
  const sampleClose = document.getElementById("grrm-sample-close");
  if (!runButton || !textInput) return;
  let activeSample = null;
  let inputVersion = 0;

  function hideResults() {
    results.replaceChildren();
    results.hidden = true;
  }

  function replaceInput(value, message) {
    inputVersion++;
    textInput.value = value;
    hideResults();
    status.textContent = message;
  }

  for (const button of document.querySelectorAll("[data-grrm-sample]")) {
    button.addEventListener("click", () => {
      const template = document.getElementById("grrm-sample-" + button.dataset.grrmSample);
      activeSample?.setAttribute("aria-pressed", "false");
      activeSample = button;
      button.setAttribute("aria-pressed", "true");
      sampleContent.replaceChildren(template.content.cloneNode(true));
      samplePreview.hidden = false;
      status.textContent = button.textContent + "のサンプルを表示しました。";
    });
  }

  sampleClose?.addEventListener("click", () => {
    samplePreview.hidden = true;
    activeSample.setAttribute("aria-pressed", "false");
    activeSample.focus();
    activeSample = null;
    status.textContent = "サンプルを閉じました。";
  });

  sampleLoad?.addEventListener("click", () => {
    const sampleText = sampleContent.querySelector("code").textContent;
    if (textInput.value.trim() && textInput.value.trimEnd() !== sampleText &&
      !window.confirm("入力欄の内容をサンプルに置き換えますか？")) return;
    if (fileInput) fileInput.value = "";
    replaceInput(sampleText + "\n", activeSample.textContent + "のサンプルを入力欄に読み込みました。");
    textInput.focus();
  });

  function show(issues) {
    results.replaceChildren();
    results.hidden = false;
    const counts = {error:0,warning:0,info:0};
    issues.forEach(x=>counts[x.severity]++);
    const summary=document.createElement("p");
    summary.className="check-summary";
    summary.textContent="確認項目 "+issues.length+" 件：エラー候補 "+counts.error+" 件 / 要確認 "+counts.warning+" 件 / 情報 "+counts.info+" 件";
    results.append(summary);
    const list=document.createElement("ul");
    list.className="check-list";
    for(const item of issues){
      const li=document.createElement("li");
      li.className="check-item "+item.severity;
      const title=document.createElement("strong");
      title.textContent=(item.severity==="error"?"エラー候補":item.severity==="warning"?"要確認":"情報")+"： "+item.title;
      const detail=document.createElement("span");
      detail.textContent=item.detail;
      li.append(title,detail);
      if(item.line){const line=document.createElement("div");line.className="check-line";line.textContent="行 "+item.line;li.append(line);}
      list.append(li);
    }
    results.append(list);
  }

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const version = ++inputVersion;
    try {
      const value = await file.text();
      if (version !== inputVersion) return;
      replaceInput(value, file.name + " を読み込みました。内容はこの端末内で処理されます。");
    } catch {
      if (version === inputVersion) status.textContent = "ファイルを読み込めませんでした。";
    }
  });
  textInput.addEventListener("input", () => {
    inputVersion++;
    if (!results.hidden) {
      hideResults();
      status.textContent = "入力が変更されました。";
    }
  });
  runButton.addEventListener("click",()=>{
    const issues=check(textInput.value);
    show(issues);
    status.textContent="静的チェックが完了しました。";
  });
  clearButton?.addEventListener("click",()=>{
    if (fileInput) fileInput.value = "";
    replaceInput("", "入力をクリアしました。");
  });
})();
