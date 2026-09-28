(() => {
  const fileInput = document.getElementById("grrm-input-file");
  const textInput = document.getElementById("grrm-input-text");
  const runButton = document.getElementById("grrm-check-run");
  const clearButton = document.getElementById("grrm-check-clear");
  const status = document.getElementById("grrm-check-status");
  const results = document.getElementById("grrm-check-results");
  if (!runButton || !textInput) return;

  const atomicNumbers = {H:1,He:2,Li:3,Be:4,B:5,C:6,N:7,O:8,F:9,Ne:10,Na:11,Mg:12,Al:13,Si:14,P:15,S:16,Cl:17,Ar:18,K:19,Ca:20,Sc:21,Ti:22,V:23,Cr:24,Mn:25,Fe:26,Co:27,Ni:28,Cu:29,Zn:30,Ga:31,Ge:32,As:33,Se:34,Br:35,Kr:36,Rb:37,Sr:38,Y:39,Zr:40,Nb:41,Mo:42,Tc:43,Ru:44,Rh:45,Pd:46,Ag:47,Cd:48,In:49,Sn:50,Sb:51,Te:52,I:53,Xe:54,Cs:55,Ba:56,La:57,Ce:58,Pr:59,Nd:60,Pm:61,Sm:62,Eu:63,Gd:64,Tb:65,Dy:66,Ho:67,Er:68,Tm:69,Yb:70,Lu:71,Hf:72,Ta:73,W:74,Re:75,Os:76,Ir:77,Pt:78,Au:79,Hg:80,Tl:81,Pb:82,Bi:83,Po:84,At:85,Rn:86,Fr:87,Ra:88,Ac:89,Th:90,Pa:91,U:92};
  const add = (list, severity, title, detail, line) => list.push({severity,title,detail,line});
  const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][+-]?\d+)?$/;
  const coordPattern = /^([A-Z][a-z]?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][+-]?\d+)?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][+-]?\d+)?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][+-]?\d+)?)(?:\s+.*)?$/;

  function coordinates(lines) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].trim().match(/^([+-]?\d+)\s+(\d+)\s*$/);
      if (!m) continue;
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const atoms = [];
      while (j < lines.length) {
        const match = lines[j].trim().match(coordPattern);
        if (!match) break;
        atoms.push({symbol:match[1], line:j+1});
        j++;
      }
      if (atoms.length) return {charge:Number(m[1]), multiplicity:Number(m[2]), atoms, chargeLine:i+1};
    }
    return null;
  }

  function check(text) {
    const lines = text.replace(/\r\n?/g,"\n").split("\n");
    const clean = lines.map(line => line.replace(/\s*[!;].*$/,""));
    const issues = [];
    const all = clean.join("\n");
    const lower = all.toLowerCase();

    if (!text.trim()) {
      add(issues,"error","入力が空です","ファイルを読み込むか、入力テキストを貼り付けてください。");
      return issues;
    }
    if (/\bganma\b/i.test(all) || /\bgammaa\b/i.test(all)) {
      add(issues,"warning","gammaの綴りを確認してください","「ganma」などの誤記が見つかりました。GRRMが意図したオプションとして読み取るか、入力と PARAM.rrm を確認してください。");
    }
    const isAfir = /\b(?:mc[-_ ]?afir|sc[-_ ]?afir)\b/i.test(all);
    const starts = [...all.matchAll(/\badd\s+interaction\b/ig)];
    const ends = [...all.matchAll(/^\s*end\s*$/gim)];
    if (isAfir && starts.length === 0) {
      add(issues,"warning","Add Interaction が見つかりません","MC-AFIR / SC-AFIR を指定しています。意図した探索設定か確認してください。");
    }
    if (starts.length && ends.length < starts.length) {
      add(issues,"error","Add Interaction の END が不足している可能性","Add Interaction の開始数より、単独行の END が少なくなっています。ブロックの閉じ忘れを確認してください。");
    }
    if (ends.length > starts.length && starts.length > 0) {
      add(issues,"info","END の数を確認してください","END が Add Interaction の数より多く見つかりました。別のセクション用 END であれば問題ありません。");
    }
    if (starts.length) {
      for (const m of starts) {
        const lineNo = all.slice(0,m.index).split("\n").length;
        const tail = clean.slice(lineNo).join("\n").split(/^\s*end\s*$/im)[0] || "";
        const gamma = tail.match(/\bgamma\s*(?:=|:)?\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][+-]?\d+)?)/i);
        if (!gamma) add(issues,"warning","Add Interaction 内の gamma を確認してください","このブロック内から gamma の数値を判定できませんでした。");
        else {
          const value = Number(gamma[1].replace(/[dD]/,"E"));
          if (value < 0) add(issues,"error","gamma に負の値があります","GRRM Tips では gamma は 0 以上とされています。",lineNo+1);
        }
      }
    }
    const gammaLines = clean.map((line,i)=>({line,i})).filter(x=>/\bgamma\b/i.test(x.line));
    for (const g of gammaLines) {
      if (/\bgamma\s*(?:=|:)\s*[-+]?\s*(?:[A-Za-z]|$)/i.test(g.line) || /\bgamma\s*(?:=|:)\s*$/i.test(g.line)) {
        add(issues,"warning","gamma の値を読み取れません","値の指定漏れや書式を確認してください。",g.i+1);
      }
    }
    if (!/\b(?:#|sc[-_ ]?afir|mc[-_ ]?afir|ad(df|df|df)|lup|repath|mesx|meci)\b/i.test(all)) {
      add(issues,"info","計算タイプを特定できません","GRRMジョブタイプの自動判定は限定的です。入力全体を目視でも確認してください。");
    }

    const geom = coordinates(clean);
    if (geom) {
      if (!Number.isInteger(geom.multiplicity) || geom.multiplicity < 1) {
        add(issues,"error","スピン多重度が不正です","多重度は1以上の整数で指定してください。",geom.chargeLine);
      }
      const unknown = geom.atoms.filter(a=>!atomicNumbers[a.symbol]);
      if (unknown.length) add(issues,"warning","元素記号を原子番号に変換できません",unknown.map(a=>a.symbol).join(", ")+"。座標行の誤記や未対応元素がないか確認してください。",unknown[0].line);
      else {
        const electrons = geom.atoms.reduce((n,a)=>n+atomicNumbers[a.symbol],0)-geom.charge;
        if (electrons < 0) add(issues,"error","電荷が原子組成と整合しません","読み取った電子数が負になっています。",geom.chargeLine);
        if (geom.multiplicity > electrons) add(issues,"error","多重度が電子数を超えています","電荷・原子組成・多重度の組み合わせを確認してください。",geom.chargeLine);
        if ((electrons + geom.multiplicity) % 2 !== 1) add(issues,"warning","電子数とスピン多重度の偶奇が合わない可能性","読取座標に基づく簡易チェックです。座標や電荷・多重度の書式が特殊な場合は誤判定になり得ます。",geom.chargeLine);
      }
      add(issues,"info","座標ブロックを読み取りました",geom.atoms.length+" 原子、電荷 "+geom.charge+"、多重度 "+geom.multiplicity+" と判定しました。",geom.chargeLine);
      const refs=[];
      for (let i=0;i<clean.length;i++) {
        const line=clean[i];
        let valueText="";
        const fragment=line.match(/\bfragm\.?\s*\d+\s*(?:=|:)\s*(.*)$/i);
        const target=line.match(/\b(?:target|universalforcetarget|decdctarget|priority\s+path)\b\s*(?:=|:)\s*(.*)$/i);
        if(fragment) valueText=fragment[1];
        else if(target) valueText=target[1];
        if(!valueText) continue;
        const ranges=[...valueText.matchAll(/\b(\d+)\s*[-–]\s*(\d+)\b/g)];
        if(ranges.length){
          for(const range of ranges){
            const first=Number(range[1]),last=Number(range[2]);
            if(first>0&&last>=first&&last-first<10000)for(let k=first;k<=last;k++)refs.push({n:k,line:i+1});
          }
        }else{
          for(const n of valueText.matchAll(/\b\d+\b/g))refs.push({n:Number(n[0]),line:i+1});
        }
      }
      const invalid=refs.find(x=>x.n>geom.atoms.length);
      if (invalid) add(issues,"warning","原子番号が座標数を超えています","原子番号 "+invalid.n+" は読取原子数 "+geom.atoms.length+" を超えています。フラグメント番号などを含むため、該当行を確認してください。",invalid.line);
    } else {
      add(issues,"info","標準的な座標ブロックを検出できません","Gaussian形式の「電荷 多重度」に続く直交座標を読み取れませんでした。別形式の入力や座標行の書き方を確認してください。");
    }

    const unique = new Map();
    for (const item of issues) {
      const key=[item.severity,item.title,item.line||"",item.detail].join("|");
      if(!unique.has(key)) unique.set(key,item);
    }
    return [...unique.values()];
  }

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
    const file=fileInput.files?.[0];
    if(!file) return;
    textInput.value=await file.text();
    status.textContent=file.name+" を読み込みました。内容はこの端末内で処理されます。";
  });
  runButton.addEventListener("click",()=>{
    const issues=check(textInput.value);
    show(issues);
    status.textContent="静的チェックが完了しました。";
  });
  clearButton?.addEventListener("click",()=>{
    textInput.value="";
    if(fileInput) fileInput.value="";
    results.replaceChildren();
    results.hidden=true;
    status.textContent="入力をクリアしました。";
  });
})();
