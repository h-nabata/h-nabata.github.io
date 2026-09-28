(() => {
  const nodeFile=document.getElementById("network-node-file");
  const edgeFile=document.getElementById("network-edge-file");
  const nodeText=document.getElementById("network-node-text");
  const edgeText=document.getElementById("network-edge-text");
  const mapping=document.getElementById("network-mapping");
  const status=document.getElementById("network-status");
  const view=document.getElementById("network-view");
  const svg=document.getElementById("network-svg");
  if(!svg) return;
  const NS="http://www.w3.org/2000/svg";
  let nodesTable=null, edgesTable=null, graph=null, drawn=[];
  let viewBox={x:0,y:0,w:1200,h:800};
  let drag=null;

  function splitRow(line,delimiter) {
    if(delimiter==="whitespace") return line.trim().split(/\s+/);
    const out=[]; let cell="",quoted=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){if(quoted&&line[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
      else if(ch===delimiter&&!quoted){out.push(cell.trim());cell="";}
      else cell+=ch;
    }
    out.push(cell.trim());
    return out;
  }
  function parseTable(text) {
    const lines=text.replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n").split("\n")
      .map((line,index)=>({line,index:index+1})).filter(x=>x.line.trim()&&!/^\s*[#;]/.test(x.line));
    if(!lines.length) return null;
    const first=lines[0].line;
    const delimiter=first.includes("\t")?"\t":first.includes(",")?",":"whitespace";
    const rows=lines.map(x=>({cells:splitRow(x.line,delimiter),line:x.index}));
    const width=Math.max(...rows.map(r=>r.cells.length));
    rows.forEach(r=>{while(r.cells.length<width)r.cells.push("");});
    const headerWord=/^\s*(?:id|eq(?:_?id)?|node(?:_?id)?|number|index|source|src|from|target|dst|to|edge|ts|pt|ea|barrier|energy|name|label|connection|activation)(?:\s|[_-]|$)/i;
    const firstData=rows[0].cells;
    const header=firstData.some(x=>headerWord.test(x));
    const names=header?firstData.map((x,i)=>x.trim()||"列 "+(i+1)):Array.from({length:width},(_,i)=>"列 "+(i+1));
    const data=header?rows.slice(1):rows;
    return {names,data:data.filter(r=>r.cells.some(x=>x!== "")),delimiter,header};
  }
  function idKey(value) {
    let v=String(value??"").trim().replace(/^["']|["']$/g,"");
    return v.replace(/^EQ\s*/i,"").replace(/^0+(?=\d)/,"");
  }
  function columnIndex(table,regex,fallback=null) {
    if(!table)return fallback;
    const i=table.names.findIndex(x=>regex.test(x));
    return i>=0?i:fallback;
  }
  function optionSelect(id,table,selected,allowNone=false) {
    const el=document.getElementById(id); if(!el||!table)return;
    el.replaceChildren();
    if(allowNone){const o=document.createElement("option");o.value="-1";o.textContent="使用しない";el.append(o);}
    table.names.forEach((name,i)=>{const o=document.createElement("option");o.value=String(i);o.textContent=(i+1)+": "+name;el.append(o);});
    el.value=String(selected??(allowNone?-1:0));
  }
  function prepMapping() {
    if(!nodesTable||!edgesTable)return;
    optionSelect("network-node-id-col",nodesTable,columnIndex(nodesTable,/(^|\b)(id|eq|node|number|index)(\b|$)/i,0));
    optionSelect("network-node-label-col",nodesTable,columnIndex(nodesTable,/(name|label|title|structure|species)/i,-1),true);
    optionSelect("network-edge-source-col",edgesTable,columnIndex(edgesTable,/(source|src|from|start|node\s*a|eq\s*a|initial)/i,0));
    optionSelect("network-edge-target-col",edgesTable,columnIndex(edgesTable,/(target|dst|to|end|node\s*b|eq\s*b|final)/i,1));
    optionSelect("network-edge-ea-col",edgesTable,columnIndex(edgesTable,/(^|\b)(ea|barrier|activation|energy)(\b|_)/i,-1),true);
    mapping.hidden=false;
    status.textContent="NODE "+nodesTable.data.length+" 行、EDGE "+edgesTable.data.length+" 行を読み込みました。列の対応を確認してください。";
  }
  async function readFile(input,target) {
    const file=input?.files?.[0];
    if(file) target.value=await file.text();
  }
  async function loadTables() {
    await Promise.all([readFile(nodeFile,nodeText),readFile(edgeFile,edgeText)]);
    nodesTable=parseTable(nodeText.value);
    edgesTable=parseTable(edgeText.value);
    if(!nodesTable||!edgesTable){
      mapping.hidden=true;
      status.textContent="NODEとEDGEの両方の表を読み込んでください。";
      return;
    }
    prepMapping();
  }
  nodeFile?.addEventListener("change",loadTables);
  edgeFile?.addEventListener("change",loadTables);
  nodeText?.addEventListener("input",()=>{nodesTable=parseTable(nodeText.value);if(nodesTable&&edgesTable)prepMapping();});
  edgeText?.addEventListener("input",()=>{edgesTable=parseTable(edgeText.value);if(nodesTable&&edgesTable)prepMapping();});

  function val(table,row,col) {
    const i=Number(col);
    return Number.isInteger(i)&&i>=0?String(row.cells[i]??"").trim():"";
  }
  function buildGraph() {
    if(!nodesTable||!edgesTable) {status.textContent="NODEとEDGEのデータを読み込んでください。";return;}
    const nodeCol=document.getElementById("network-node-id-col").value;
    const labelCol=document.getElementById("network-node-label-col").value;
    const fromCol=document.getElementById("network-edge-source-col").value;
    const toCol=document.getElementById("network-edge-target-col").value;
    const eaCol=document.getElementById("network-edge-ea-col").value;
    const map=new Map();
    for(const row of nodesTable.data){
      const raw=val(nodesTable,row,nodeCol), id=idKey(raw);
      if(!id) continue;
      if(!map.has(id))map.set(id,{id,label:labelCol==="-1"?raw:(val(nodesTable,row,labelCol)||raw),row:row.cells,line:row.line});
    }
    const edges=[];
    let dropped=0;
    for(const row of edgesTable.data){
      const rawA=val(edgesTable,row,fromCol),rawB=val(edgesTable,row,toCol);
      const a=idKey(rawA),b=idKey(rawB);
      if(!a||!b){dropped++;continue;}
      if(!map.has(a))map.set(a,{id:a,label:"EQ"+a,row:[],missing:true});
      if(!map.has(b))map.set(b,{id:b,label:"EQ"+b,row:[],missing:true});
      const rawEa=val(edgesTable,row,eaCol);
      const numericText=rawEa.replace(/,/g,"").match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][+-]?\d+)?/);
      const ea=numericText?Number(numericText[0].replace(/[dD]/,"E")):null;
      edges.push({a,b,ea,row:row.cells,line:row.line});
    }
    if(!map.size){status.textContent="ノードIDを読み取れませんでした。列の対応を選び直してください。";return;}
    graph={nodes:[...map.values()],edges};
    const unresolved=edges.filter(e=>map.get(e.a)?.missing||map.get(e.b)?.missing).length;
    if(unresolved) status.textContent="描画準備完了。EDGEの端点から "+unresolved+" 件のノードを補いました。列の対応を確認してください。";
    else status.textContent="描画準備完了。";
    drawGraph();
  }
  function makeLayout(nodeList) {
    const n=nodeList.length, pos=new Map();
    const cx=600,cy=400;
    if(n===1){pos.set(nodeList[0].id,{x:cx,y:cy});return pos;}
    const radius=n<8?Math.min(240,70+n*22):Math.min(355,175+Math.log(n)*22);
    nodeList.forEach((node,i)=>{
      const angle=-Math.PI/2+2*Math.PI*i/n;
      pos.set(node.id,{x:cx+radius*Math.cos(angle),y:cy+radius*.88*Math.sin(angle)});
    });
    return pos;
  }
  function elt(name,attrs={}) {
    const e=document.createElementNS(NS,name);
    for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));
    return e;
  }
  function drawGraph() {
    if(!graph)return;
    svg.replaceChildren();
    const positions=makeLayout(graph.nodes);
    const edgesGroup=elt("g",{class:"network-edges"});
    graph.edges.forEach((edge,i)=>{
      const a=positions.get(edge.a),b=positions.get(edge.b); if(!a||!b)return;
      const line=elt("line",{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:"network-edge","data-ea":edge.ea??""});
      const title=elt("title");
      title.textContent=edge.ea===null?"EQ"+edge.a+" ↔ EQ"+edge.b+" · Ea不明":"EQ"+edge.a+" ↔ EQ"+edge.b+" · Ea "+edge.ea;
      line.append(title); edgesGroup.append(line);
    });
    svg.append(edgesGroup);
    const nodeGroup=elt("g",{class:"network-nodes"});
    const radius=graph.nodes.length>800?2.4:graph.nodes.length>250?3.2:graph.nodes.length>80?4:6;
    graph.nodes.forEach(node=>{
      const p=positions.get(node.id);
      const g=elt("g",{class:"network-node",transform:"translate("+p.x+" "+p.y+")",tabindex:"0",role:"img","aria-label":node.label});
      const c=elt("circle",{r:radius});
      const title=elt("title");
      title.textContent=node.label+(node.missing?" (NODE表にIDなし)":"")+" · ID "+node.id;
      g.append(c,title);
      if(graph.nodes.length<=90){
        const t=elt("text",{x:radius+3,y:4});
        t.textContent=node.label.length>24?node.label.slice(0,21)+"…":node.label;
        g.append(t);
      }
      nodeGroup.append(g);
    });
    svg.append(nodeGroup);
    view.hidden=false;
    drawn=[...svg.querySelectorAll(".network-edge")];
    setupEaFilter();
    fit();
    renderStats();
  }
  function setupEaFilter() {
    const range=document.getElementById("network-ea-filter");
    const output=document.getElementById("network-ea-value");
    const eas=graph.edges.map(e=>e.ea).filter(Number.isFinite);
    if(!range)return;
    if(!eas.length){range.disabled=true;range.value=100;output.textContent="Eaデータなし";drawn.forEach(e=>e.classList.remove("filtered"));return;}
    const sorted=[...eas].sort((a,b)=>a-b);
    range.min=String(sorted[0]);range.max=String(sorted.at(-1));range.value=String(sorted.at(-1));range.disabled=sorted[0]===sorted.at(-1);
    output.textContent=Number(range.value).toPrecision(4);
    range.oninput=()=>{
      const limit=Number(range.value);
      output.textContent=limit.toPrecision(4);
      drawn.forEach(el=>{const ea=Number(el.dataset.ea);el.classList.toggle("filtered",Number.isFinite(ea)&&ea>limit);});
    };
  }
  function renderStats() {
    const stats=document.getElementById("network-stats");
    const known=graph.edges.filter(e=>Number.isFinite(e.ea));
    const values=[
      "EQノード "+graph.nodes.length+" 件",
      "反応エッジ "+graph.edges.length+" 件",
      "Ea取得 "+known.length+" 件",
      "連結成分 "+componentsCount(graph.nodes,graph.edges)
    ];
    stats.replaceChildren();
    values.forEach(v=>{const s=document.createElement("span");s.textContent=v;stats.append(s);});
  }
  function componentsCount(ns,es) {
    const adj=new Map(ns.map(n=>[n.id,[]]));
    es.forEach(e=>{adj.get(e.a)?.push(e.b);adj.get(e.b)?.push(e.a);});
    const seen=new Set();let count=0;
    for(const n of ns){if(seen.has(n.id))continue;count++;const stack=[n.id];seen.add(n.id);while(stack.length){const x=stack.pop();for(const y of adj.get(x)||[])if(!seen.has(y)){seen.add(y);stack.push(y);}}}
    return count;
  }
  function setViewBox() {svg.setAttribute("viewBox",viewBox.x+" "+viewBox.y+" "+viewBox.w+" "+viewBox.h);}
  function fit() {viewBox={x:0,y:0,w:1200,h:800};setViewBox();}
  document.getElementById("network-draw")?.addEventListener("click",buildGraph);
  document.getElementById("network-fit")?.addEventListener("click",fit);
  document.getElementById("network-ea-filter")?.addEventListener("input",()=>{});
  svg.addEventListener("wheel",event=>{
    event.preventDefault();
    const factor=event.deltaY<0?.88:1.14;
    const rect=svg.getBoundingClientRect();
    const px=(event.clientX-rect.left)/rect.width,py=(event.clientY-rect.top)/rect.height;
    const wx=viewBox.x+px*viewBox.w,wy=viewBox.y+py*viewBox.h;
    const nw=viewBox.w*factor,nh=viewBox.h*factor;
    viewBox={x:wx-px*nw,y:wy-py*nh,w:nw,h:nh};setViewBox();
  },{passive:false});
  svg.addEventListener("pointerdown",event=>{if(event.button!==0)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,box:{...viewBox}};svg.setPointerCapture(event.pointerId);});
  svg.addEventListener("pointermove",event=>{
    if(!drag||drag.id!==event.pointerId)return;
    const rect=svg.getBoundingClientRect();
    const dx=(event.clientX-drag.x)*drag.box.w/rect.width,dy=(event.clientY-drag.y)*drag.box.h/rect.height;
    viewBox={...drag.box,x:drag.box.x-dx,y:drag.box.y-dy};setViewBox();
  });
  svg.addEventListener("pointerup",event=>{if(drag?.id===event.pointerId)drag=null;});
  document.getElementById("network-save-svg")?.addEventListener("click",()=>{
    const clone=svg.cloneNode(true);
    clone.setAttribute("xmlns",NS);clone.setAttribute("width","1200");clone.setAttribute("height","800");clone.setAttribute("viewBox","0 0 1200 800");
    const blob=new Blob([new XMLSerializer().serializeToString(clone)],{type:"image/svg+xml;charset=utf-8"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download="grrm-reaction-network.svg";a.click();URL.revokeObjectURL(url);
  });
})();
