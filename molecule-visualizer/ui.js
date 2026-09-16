(function (global) {
  "use strict";

  const MV = global.MoleculeVisualizer = global.MoleculeVisualizer || {};
  const Model = MV.Model;
  const Bonding = MV.Bonding;
  const Geometry = MV.Geometry;
  const IO = MV.IO;
  const History = MV.History;
  const Renderer3DMol = MV.Renderer3DMol;

  let state = Model.createState();
  let renderer = null;
  let history = new History(120);
  let editMode = "select";
  let moveMode = false;
  const drag = {
    active: false,
    lastClientX: 0,
    lastClientY: 0,
    scaleXY: 0.01,
    scaleZ: 0.01,
    mode: "xy"
  };
  let dragMoved = false;

  function byId(id) { return document.getElementById(id); }
  function setStatus(msg, error) { const el = byId("statusBadge"); if (el) { el.textContent = msg; el.classList.toggle("error",Boolean(error)); } if(byId("exportDialog")?.open) byId("exportMessage").textContent=msg; }
  function report(error) { const message=error.message||String(error); setStatus(message,true); if(byId("importDialog").open)byId("importError").textContent=message; if(byId("fragDialog").open)byId("fragmentError").textContent=message; }
  function numberInput(id, min=-1e6, max=1e6) {const el=byId(id), value=Number(el.value);if(el.value.trim()==="" || !Number.isFinite(value) || value<min || value>max)throw Error("数値が空欄または範囲外です。");return value;}
  function additive(event){return Boolean(event&&(event.ctrlKey||event.metaKey||event.shiftKey))||byId("multiSelect").checked;}
  let saveTimer;
  function saveLocal(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem("molecule-studio-v1",IO.stateToProjectText(state));byId("saveState").textContent="この端末に保存済み";}catch(e){byId("saveState").textContent="自動保存できません。ファイルで保存してください。";}},350);}
  function syncUI(){
    const selected=selectedAtoms();byId("structureStats").textContent=`${state.atoms.length} 原子 · ${state.bonds.length} 結合`;
    if(document.activeElement!==byId("structureTitle"))byId("structureTitle").value=state.metadata.title||"無題の構造";
    byId("selectionSummary").textContent=selected.length ? `選択順: ${selected.slice(0,8).map(atomLabel).join(" → ")}${selected.length>8?` ほか ${selected.length-8} 原子`:""}` : "原子をクリックして選択";
    ["atomCharge","btnApplyCharge"].forEach(id=>byId(id).disabled=selected.length!==1);
    if(selected.length===1)byId("atomCharge").value=selected[0].charge||0;else byId("atomCharge").value="";
    syncXYZEditor();
    byId("btnUndo").disabled=!history.undoStack.length;byId("btnRedo").disabled=!history.redoStack.length;
    ["btnDeleteSel","btnChangeElem","btnTranslate"].forEach(id=>byId(id).disabled=!selected.length);
    byId("btnAddBond").disabled=selected.length!==2;
    ["btnUpdateBond","btnDeleteBond"].forEach(id=>byId(id).disabled=!state.selectedBondIds.size);
    [["Distance",2],["Angle",3],["Dihedral",4]].forEach(([name,n])=>["Apply","Measure"].forEach(action=>byId("btn"+action+name).disabled=selected.length!==n));
    byId("styleSelect").value=state.viewSettings.style;byId("btnToggleIndex").setAttribute("aria-pressed",String(state.viewSettings.showIndexLabels));
    const values=selected;
    try{setMeasure(values.length===2?`${Geometry.distance(...values).toFixed(3)} Å`:values.length===3?`${Geometry.angle(...values).toFixed(2)}°`:values.length===4?`${Geometry.dihedral(...values).toFixed(2)}°`:"2 / 3 / 4 原子を順に選択してください");}catch(e){setMeasure(e.message);}
  }
  let xyzDirty=false, xyzBase='', xyzDisplayBase='';
  function editorXYZ(s){const format=byId('coordinateFormat');if(s.metadata.cell)format.value='xyz';const mol=format.value==='mol3000';byId('xyzHeader').disabled=mol;return mol?IO.stateToMolV3000Text(s):MV.Periodic.editorText(s,byId('xyzHeader').checked);}
  function syncXYZEditor(){
    const el=byId('dataText');if(!el)return;
    let text;try{text=IO.stateToXYZText(state);}catch(error){byId('xyzEditStatus').textContent=error.message;return;}
    if(!xyzDirty){const display=editorXYZ(state);if(el.value!==display)el.value=display;xyzBase=text;xyzDisplayBase=display;}
    byId('xyzEditStatus').textContent=xyzDirty?(text!==xyzBase?'編集中に構造が変更されました。「現在の構造を再表示」で更新してから編集してください。':'未適用の編集があります。'):'表示中の構造と同期しています。';
  }
  function applyXYZEditor(){
    if(xyzDirty&&IO.stateToXYZText(state)!==xyzBase)throw Error('構造が変更されています。編集内容を控え、「現在の構造を再表示」で更新してください。');
    const input=IO.normalizeXYZInput(byId('dataText').value),isMol=/V[23]000/.test(input),parsed=isMol?IO.parseMolToState(input):IO.parseXYZToState(input);
    if(parsed.metadata.trajectory)throw Error('ここでは現在の1フレームを編集してください。複数フレームは「ファイルを開く」から読み込めます。');
    const next=Model.cloneState(state),same=next.atoms.length===parsed.atoms.length&&next.atoms.every((a,i)=>a.element===parsed.atoms[i].element);
    if(isMol){next.atoms=parsed.atoms;next.bonds=parsed.bonds;next.metadata={...next.metadata,...parsed.metadata,cell:null};next.selectedAtomIds.clear();next.selectedBondIds.clear();next.metadata.suppressedBondKeys=[];byId('coordinateFormat').value='mol3000';}
    else if(same)next.atoms.forEach((a,i)=>{const b=parsed.atoms[i];Object.assign(a,{x:b.x,y:b.y,z:b.z});if(Object.keys(b.xyzExtras||{}).length)a.xyzExtras=b.xyzExtras;});
    else{next.atoms=parsed.atoms;next.bonds=[];next.selectedAtomIds.clear();next.selectedBondIds.clear();next.metadata.suppressedBondKeys=[];}
    if(/^\s*\d+\s*\n/.test(input))next.metadata.title=parsed.metadata.title;
    if(parsed.metadata.cell){if(next.metadata.cell&&!/\bLattice=/.test(input))parsed.metadata.cell.pbc=next.metadata.cell.pbc.slice();next.metadata.cell=parsed.metadata.cell;}
    if(!isMol)Bonding.refreshInferredBonds(next);
    pushHistory('structure text');xyzDirty=false;setState(next,true);setStatus('座標・構造データを適用しました。「戻す」で復元できます。');
  }
  function setMeasure(msg) { const el = byId("measureBadge"); if (el) el.textContent = msg; }
  function pushHistory(label) { history.push(label, state); }

  function setMode(mode) {
    editMode = mode;
    moveMode = mode === "move";
    [["toolSelect", "select"], ["toolBond", "bond"], ["toolMove", "move"], ["toolBox", "box"]].forEach(item => {
      const el = byId(item[0]);
      if (el) { el.classList.toggle("active", item[1] === mode); el.setAttribute("aria-pressed",String(item[1]===mode)); }
    });
    const modeBadge = byId("modeBadge");
    if (modeBadge) modeBadge.textContent = ({select:"選択モード",move:"原子移動モード",bond:"結合モード",box:"範囲選択モード"})[mode];
    if (renderer && typeof renderer.setInteractionMode === "function") renderer.setInteractionMode(mode);
    const btn = byId("btnToggleMove");
    if (btn) btn.textContent = `移動モード: ${moveMode ? "ON" : "OFF"}`;
    setStatus(({select:"クリックで選択。ドラッグで回転します。",move:"原子をドラッグして移動。ShiftでZ方向へ移動します。",bond:"原子を2つ順にクリックして結合します。",box:"ドラッグした範囲の原子を選択します。"})[mode]);
  }

  function atomLabel(atom) {
    const idx = state.atoms.findIndex(a => a.id === atom.id);
    return `${idx + 1}:${atom.element}`;
  }

  function selectedAtoms() {
    return Array.from(state.selectedAtomIds)
      .map(id => state.atoms.find(atom => atom.id === id))
      .filter(Boolean);
  }

  function render(preserveCamera) {
    renderer.renderState(state, Boolean(preserveCamera));
    saveLocal();
    updateAtomTable();
    updateBondTable();
    syncUI();
    MV.Studio?.sync();
  }

  function setState(nextState, preserveCamera) {
    state = nextState;
    Model.sanitizeSelection(state);
    render(preserveCamera);
  }

  function rerenderSelectionOnly() {
    renderer.updateSelection(state);
    updateAtomTable();
    updateBondTable();
    syncUI();
    MV.Studio?.sync();
  }

  function refreshBondsAndRender(preserveCamera) {
    Bonding.refreshInferredBonds(state);
    render(preserveCamera);
  }

  function loadText(text) {
    const nextState=IO.parseAuto(text);
    pushHistory("load");nextState.viewSettings=Object.assign({},state.viewSettings,nextState.viewSettings);
    setState(nextState,false);setStatus(`${state.atoms.length} 原子を読み込みました。`);
    byId("importError").textContent="";byId("importDialog").close();
  }
  function loadFromTextarea(){loadText(byId("xyz_input").value);}
  function loadMolFromTextarea(){loadFromTextarea();}

  function toggleMoveMode() {
    setMode(moveMode ? "select" : "move");
  }

  function toggleIndexLabels() {
    state.viewSettings.showIndexLabels = !state.viewSettings.showIndexLabels;
    const btn = byId("btnToggleIndex");
    if (btn) btn.textContent = "原子番号";
    renderer.updateSelection(state);
    syncUI(); saveLocal();
    setStatus(state.viewSettings.showIndexLabels ? "Index labels ON" : "Index labels OFF");
  }

  function onStyleChange() {
    state.viewSettings.style = byId("styleSelect").value;
    renderer.updateSelection(state);
    syncUI(); saveLocal();
    setStatus(`Style: ${state.viewSettings.style}`);
  }

  function copyText(text, okMessage) {
    if (!navigator.clipboard) {
      byId("exportText").value=text;
      setStatus("コピー機能を利用できません。下のテキスト欄から手動でコピーしてください。");
      return;
    }
    navigator.clipboard.writeText(text).then(() => setStatus(okMessage)).catch(() => {byId("exportText").value=text;setStatus("コピーできませんでした。下の欄から手動でコピーしてください。");});
  }

  function copyXYZ() { copyText(IO.stateToXYZText(state), "XYZをコピーしました。"); }
  function copyMol() { copyText(IO.stateToMolText(state), "MOLをコピーしました。"); }

  function downloadText(text, filename) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function downloadXYZ() {
    downloadText(IO.stateToXYZText(state), safeFilename()+".xyz");
    setStatus("XYZを保存しました。");
  }

  function downloadSDF() {
    downloadText(IO.stateToSDFText(state), safeFilename()+".sdf");
    setStatus("SDFを保存しました。");
  }

  function clearSelection() {
    Model.setSelectedAtoms(state, []);
    Model.setSelectedBonds(state, []);
    rerenderSelectionOnly();
    setStatus("選択を解除しました。");
  }

  function deleteSelected() {
    if (state.selectedAtomIds.size === 0) return;
    pushHistory("deleteAtoms");
    Model.removeSelectedAtoms(state);
    refreshBondsAndRender(true);
    setStatus("選択原子を削除しました。");
  }

  function changeSelectedElement() {
    if (state.selectedAtomIds.size === 0) return;
    const newElem = byId("editElem").value.trim();
    if (!newElem) return;
    pushHistory("changeElem");
    state.atoms.forEach(atom => {
      if (state.selectedAtomIds.has(atom.id)) atom.element = newElem;
    });
    refreshBondsAndRender(true);
    setStatus(`Element changed to ${newElem}`);
  }

  function selectAll() {
    Model.selectAllAtoms(state);
    rerenderSelectionOnly();
    setStatus("全原子を選択しました。");
  }

  function selectNone() { clearSelection(); }

  function selectInvert() {
    Model.invertAtomSelection(state);
    rerenderSelectionOnly();
    setStatus("選択を反転しました。");
  }

  function selectByElement() {
    const element = byId("selByElem").value.trim();
    if (!element) return;
    Model.setSelectedAtoms(state, state.atoms.filter(atom => atom.element === element).map(atom => atom.id));
    rerenderSelectionOnly();
    setStatus(`Selected element: ${element}`);
  }

  function canvasHasFocus() {
    return Boolean(renderer && typeof renderer.hasKeyboardFocus === "function" && renderer.hasKeyboardFocus());
  }

  function consumeShortcut(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
  }

  function adjacencyMap() {
    const map = new Map(state.atoms.map(atom => [atom.id, new Set()]));
    state.bonds.forEach(bond => {
      if (!map.has(bond.atom1) || !map.has(bond.atom2)) return;
      map.get(bond.atom1).add(bond.atom2);
      map.get(bond.atom2).add(bond.atom1);
    });
    return map;
  }

  function expandSelectionOneBond() {
    if (state.selectedAtomIds.size === 0) return;
    const adj = adjacencyMap();
    const next = new Set(state.selectedAtomIds);
    state.selectedAtomIds.forEach(atomId => {
      const neighbors = adj.get(atomId);
      if (!neighbors) return;
      neighbors.forEach(id => next.add(id));
    });
    Model.setSelectedAtoms(state, Array.from(next));
    Model.setSelectedBonds(state, []);
    rerenderSelectionOnly();
    setStatus(`Expanded selection: ${state.selectedAtomIds.size} atom(s)`);
  }

  function selectConnectedMoleculesFromSelection() {
    if (state.selectedAtomIds.size === 0) return;
    const adj = adjacencyMap();
    const visited = new Set();
    const stack = Array.from(state.selectedAtomIds);
    while (stack.length > 0) {
      const atomId = stack.pop();
      if (visited.has(atomId)) continue;
      visited.add(atomId);
      const neighbors = adj.get(atomId);
      if (!neighbors) continue;
      neighbors.forEach(id => {
        if (!visited.has(id)) stack.push(id);
      });
    }
    Model.setSelectedAtoms(state, Array.from(visited));
    Model.setSelectedBonds(state, []);
    rerenderSelectionOnly();
    setStatus(`Selected connected molecule: ${state.selectedAtomIds.size} atom(s)`);
  }

  function addAtom() {
    const element = byId("addElem").value.trim() || "C";
    const mode = byId("addMode").value;
    const dist = numberInput("addDist",0.01,100);
    let x = numberInput("addX");
    let y = numberInput("addY");
    let z = numberInput("addZ");

    if(state.atoms.length>=2000)throw Error("原子数の上限は2000です。");
    if(mode==="nearSelected"&&state.selectedAtomIds.size!==1)throw Error("追加位置の基準となる原子を1つ選択してください。");
    if (mode === "nearSelected" && state.selectedAtomIds.size > 0) {
      const base = selectedAtoms()[0];
      if (base) { x = base.x; y = base.y; z = base.z + (Number.isFinite(dist) ? dist : 1.1); }
    } else if (mode === "origin") {
      x = 0; y = 0; z = 0;
    }

    pushHistory("addAtom");
    const atom = Model.createAtom({ element, x, y, z });
    state.atoms.push(atom);
    Model.setSelectedAtoms(state, [atom.id]);
    refreshBondsAndRender(true);
    setStatus(`Added atom: ${element}`);
  }

  function openFragmentDialog() {
    const dlg = byId("fragDialog");
    if (dlg) { byId("fragmentError").textContent=""; dlg.showModal(); }
  }

  function centroid(atoms) {
    if (atoms.length === 0) return { x: 0, y: 0, z: 0 };
    return atoms.reduce((acc, atom) => ({
      x: acc.x + atom.x / atoms.length,
      y: acc.y + atom.y / atoms.length,
      z: acc.z + atom.z / atoms.length
    }), { x: 0, y: 0, z: 0 });
  }

  function applyFragment() {
    const parsed = IO.parseXYZAtoms(byId("fragText").value);
    if (parsed.atoms.length === 0) {
      throw Error("原子団の座標を読み取れません。");
    }

    const place = byId("fragPlace").value;
    const scale = numberInput("fragScale",.01,100);
    const ox = numberInput("fragOX");
    const oy = numberInput("fragOY");
    const oz = numberInput("fragOZ");
    const jitter = numberInput("fragJitter");
    const anchorIndex = Math.max(1, Number(byId("fragAnchorIndex").value || "1")) - 1;
    const bondDistance = numberInput("fragBondDistance");
    const bondOrder = Number(byId("fragBondOrder").value || "1");
    if(state.atoms.length+parsed.atoms.length>2000)throw Error("原子数の上限は2000です。");
    if(!Number.isInteger(anchorIndex)||!parsed.atoms[anchorIndex])throw Error("アンカー番号が範囲外です。");
    if((place==="anchorBond"||place==="nearSelected")&&state.selectedAtomIds.size!==1)throw Error("接続先の原子を1つ選んでください。");
    if(bondDistance<=0||jitter<0)throw Error("距離は正、ずらし幅は0以上にしてください。");
    const hostAnchor = selectedAtoms()[0] || null;
    const fragAnchor = parsed.atoms[anchorIndex] || parsed.atoms[0];

    let bx = 0, by = 0, bz = 0;
    if ((place === "nearSelected" || place === "anchorBond") && hostAnchor) {
      bx = hostAnchor.x;
      by = hostAnchor.y;
      bz = hostAnchor.z + 1.2;
    }
    if (place === "anchorBond" && hostAnchor && fragAnchor) {
      bx = hostAnchor.x - fragAnchor.x * scale;
      by = hostAnchor.y - fragAnchor.y * scale;
      bz = hostAnchor.z + bondDistance - fragAnchor.z * scale;
    }

    pushHistory("addFragment");
    const addedIds = [];
    let newAnchorId = null;
    parsed.atoms.forEach((atom, i) => {
      const jx = jitter ? (Math.random() - 0.5) * jitter : 0;
      const jy = jitter ? (Math.random() - 0.5) * jitter : 0;
      const jz = jitter ? (Math.random() - 0.5) * jitter : 0;
      const newAtom = Model.createAtom({
        element: atom.element,
        x: bx + ox + atom.x * scale + jx,
        y: by + oy + atom.y * scale + jy,
        z: bz + oz + atom.z * scale + jz
      });
      state.atoms.push(newAtom);
      addedIds.push(newAtom.id);
      if (i === anchorIndex) newAnchorId = newAtom.id;
    });

    if (place === "anchorBond" && hostAnchor && newAnchorId) {
      Model.addOrUpdateBond(state, hostAnchor.id, newAnchorId, bondOrder, "covalent", "manual");
    }
    Model.setSelectedAtoms(state, addedIds);
    refreshBondsAndRender(true);
    setStatus(`Fragment added: +${addedIds.length} atoms${place === "anchorBond" ? ", anchored" : ""}`);
  }

  function addBondFromSelection() {
    const atoms = selectedAtoms();
    if (atoms.length !== 2) {
      setStatus("Select exactly 2 atoms to add a bond");
      return;
    }
    pushHistory("addBond");
    const bond = Model.addOrUpdateBond(state, atoms[0].id, atoms[1].id, byId("bondOrder").value, byId("bondType").value, "manual");
    Model.setSelectedBonds(state, bond ? [bond.id] : []);
    render(true);
    setStatus("結合を作成・更新しました。");
  }

  function handleAtomClick(atomId, event) {
    const isAdditive = additive(event);
    if (editMode === "bond") {
      const next = new Set(state.selectedAtomIds.size===2 ? [] : state.selectedAtomIds);
      if (next.has(atomId)) next.delete(atomId);
      else next.add(atomId);
      if (next.size > 2) {
        const ids = Array.from(next);
        next.clear();
        next.add(ids[ids.length - 2]);
        next.add(ids[ids.length - 1]);
      }
      Model.setSelectedAtoms(state, Array.from(next));
      if (state.selectedAtomIds.size === 2) {
        pushHistory("quickBond");
        const atoms = selectedAtoms();
        const bond = Model.addOrUpdateBond(state, atoms[0].id, atoms[1].id, byId("bondOrder").value, byId("bondType").value, "manual");
        Model.setSelectedBonds(state, bond ? [bond.id] : []);
        render(true);
        setStatus("2原子を結合しました。");
      } else {
        rerenderSelectionOnly();
        setStatus("2つ目の原子を選択してください。");
      }
      return;
    }

    Model.toggleAtomSelection(state, atomId, isAdditive);
    Model.setSelectedBonds(state, []);
    rerenderSelectionOnly();
    setStatus(`Selected atoms: ${state.selectedAtomIds.size}`);
  }

  function handleBondClick(bondId, event) {
    const isAdditive = additive(event);
    Model.toggleBondSelection(state, bondId, isAdditive);
    const bond = state.bonds.find(item => item.id === bondId);
    if (bond) {
      Model.setSelectedAtoms(state, [bond.atom1, bond.atom2]);
      byId("bondOrder").value = String(bond.order || 1);
      byId("bondType").value = bond.type || "covalent";
    }
    rerenderSelectionOnly();
    setStatus("結合を選択しました。");
  }

  function atomIdsForDrag(atomId) {
    if (state.selectedAtomIds.has(atomId)) return Array.from(state.selectedAtomIds);
    Model.setSelectedAtoms(state, [atomId]);
    Model.setSelectedBonds(state, []);
    rerenderSelectionOnly();
    return [atomId];
  }

  function handleAtomDragStart(atomId) {
    atomIdsForDrag(atomId);
    pushHistory("dragAtoms");
    dragMoved = false;
    setStatus(`Dragging ${state.selectedAtomIds.size} atom(s)`);
  }

  function handleAtomsDrag(atomId, delta) {
    const ids = atomIdsForDrag(atomId);
    const selected = new Set(ids);
    state.atoms.forEach(atom => {
      if (!selected.has(atom.id)) return;
      atom.x += delta.x;
      atom.y += delta.y;
      atom.z += delta.z;
    });
    dragMoved = true;
    renderer.updateSelection(state);
  }

  let groupDragIds=[];
  function startGroupDrag(atomId){
    groupDragIds=Array.from(state.selectedAtomIds);
    if(!groupDragIds.length&&atomId){
      const seen=new Set([atomId]),queue=[atomId];
      for(let i=0;i<queue.length;i++)state.bonds.forEach(b=>{const other=b.atom1===queue[i]?b.atom2:b.atom2===queue[i]?b.atom1:null;if(other&&!seen.has(other)){seen.add(other);queue.push(other);}});
      groupDragIds=queue;
    }
    if(!groupDragIds.length){setStatus('原子・結合からドラッグするか、対象原子を選択してください。');return false;}
    pushHistory('transform group');dragMoved=false;return true;
  }
  function transformGroup(action,dx,dy){
    const atoms=state.atoms.filter(a=>groupDragIds.includes(a.id));
    if(action==='groupMove'){
      const delta=renderer.screenDeltaToWorld(dx,dy,false);atoms.forEach(a=>{a.x+=delta.x;a.y+=delta.y;a.z+=delta.z;});
    }else{
      const center=['x','y','z'].map(k=>atoms.reduce((v,a)=>v+a[k],0)/atoms.length);
      const rotate=(axis,angle)=>{const c=Math.cos(angle),sin=Math.sin(angle);atoms.forEach(a=>{const v=[a.x-center[0],a.y-center[1],a.z-center[2]],dot=v.reduce((sum,x,i)=>sum+x*axis[i],0),cross=[axis[1]*v[2]-axis[2]*v[1],axis[2]*v[0]-axis[0]*v[2],axis[0]*v[1]-axis[1]*v[0]];[a.x,a.y,a.z]=v.map((x,i)=>center[i]+x*c+cross[i]*sin+axis[i]*dot*(1-c));});};
      rotate(renderer.viewVectorToWorld([0,1,0]),dx*.008);rotate(renderer.viewVectorToWorld([1,0,0]),dy*.008);
    }
    dragMoved=true;renderer.updateSelection(state);
  }
  function handleCanvasDragEnd() {
    if (!dragMoved) return;
    dragMoved = false;
    Bonding.refreshInferredBonds(state);
    render(true);
    groupDragIds=[];setStatus("構造の移動・回転を確定しました。");
  }

  function handleBoxSelect(atomIds, event) {
    if (additive(event)) {
      const next = new Set(state.selectedAtomIds);
      atomIds.forEach(id => next.add(id));
      Model.setSelectedAtoms(state, Array.from(next));
    } else {
      Model.setSelectedAtoms(state, atomIds);
    }
    Model.setSelectedBonds(state, []);
    rerenderSelectionOnly();
    setStatus(`Box selected: ${atomIds.length} atom(s)`);
  }

  function setSelectedBondOrder(order) {
    const normalized = Number(order);
    if (![1, 2, 3].includes(normalized)) return;
    byId("bondOrder").value = String(normalized);
    if (state.selectedBondIds.size > 0) {
      pushHistory("shortcutBondOrder");
      Model.updateSelectedBonds(state, { order: normalized, source: "manual" });
      render(true);
      setStatus(`Bond order: ${normalized}`);
      return;
    }
    if (state.selectedAtomIds.size === 2) {
      pushHistory("shortcutBondCreate");
      const atoms = selectedAtoms();
      const bond = Model.addOrUpdateBond(state, atoms[0].id, atoms[1].id, normalized, byId("bondType").value, "manual");
      Model.setSelectedBonds(state, bond ? [bond.id] : []);
      render(true);
      setStatus(`Bond order: ${normalized}`);
    }
  }

  function updateSelectedBonds() {
    if (state.selectedBondIds.size === 0) return;
    pushHistory("updateBond");
    Model.updateSelectedBonds(state, {
      order: byId("bondOrder").value,
      type: byId("bondType").value,
      source: "manual"
    });
    render(true);
    setStatus("結合を更新しました。");
  }

  function deleteSelectedBonds() {
    if (state.selectedBondIds.size === 0) return;
    pushHistory("deleteBond");
    Model.removeSelectedBonds(state);
    render(true);
    setStatus("結合を削除しました。");
  }

  function reinferBonds() {
    pushHistory("reinferBonds");
    state.metadata.suppressedBondKeys=[];
    refreshBondsAndRender(true);
    setStatus("推定結合を再計算しました。手動の結合は保持しています。");
  }

  function applyDistance() {
    const atoms = selectedAtoms();
    if (atoms.length !== 2) { setStatus("Select exactly 2 atoms for distance"); return; }
    const target = numberInput("targetDistance",0.001,1e5);
    if (!Number.isFinite(target) || target <= 0) return;
    pushHistory("setDistance");
    const moved = Geometry.setDistance(atoms[0], atoms[1], target);
    Object.assign(atoms[1], moved);
    refreshBondsAndRender(true);
    setMeasure(`d=${Geometry.distance(atoms[0], atoms[1]).toFixed(3)} A`);
    setStatus("距離を変更しました。");
  }

  function measureDistance() {
    const atoms = selectedAtoms();
    if (atoms.length !== 2) { setStatus("Select exactly 2 atoms for distance"); return; }
    const value = Geometry.distance(atoms[0], atoms[1]);
    byId("targetDistance").value = value.toFixed(3);
    setMeasure(`d=${value.toFixed(3)} A`);
  }

  function applyAngle() {
    const atoms = selectedAtoms();
    if (atoms.length !== 3) { setStatus("Select exactly 3 atoms for angle A-B-C"); return; }
    const target = numberInput("targetAngle",0,180);
    if (!Number.isFinite(target)) return;
    const result=Geometry.setAngle(atoms[0], atoms[1], atoms[2], target);
    pushHistory("setAngle");
    Object.assign(atoms[2], result);
    refreshBondsAndRender(true);
    setMeasure(`angle=${Geometry.angle(atoms[0], atoms[1], atoms[2]).toFixed(2)} deg`);
    setStatus("角度を変更しました。");
  }

  function measureAngle() {
    const atoms = selectedAtoms();
    if (atoms.length !== 3) { setStatus("Select exactly 3 atoms for angle A-B-C"); return; }
    const value = Geometry.angle(atoms[0], atoms[1], atoms[2]);
    byId("targetAngle").value = value.toFixed(2);
    setMeasure(`angle=${value.toFixed(2)} deg`);
  }

  function applyDihedral() {
    const atoms = selectedAtoms();
    if (atoms.length !== 4) { setStatus("Select exactly 4 atoms for dihedral A-B-C-D"); return; }
    const target = numberInput("targetDihedral",-180,180);
    if (!Number.isFinite(target)) return;
    const result=Geometry.setDihedral(atoms[0], atoms[1], atoms[2], atoms[3], target);
    pushHistory("setDihedral");
    Object.assign(atoms[3], result);
    refreshBondsAndRender(true);
    setMeasure(`dihedral=${Geometry.dihedral(atoms[0], atoms[1], atoms[2], atoms[3]).toFixed(2)} deg`);
    setStatus("二面角を変更しました。");
  }

  function measureDihedral() {
    const atoms = selectedAtoms();
    if (atoms.length !== 4) { setStatus("Select exactly 4 atoms for dihedral A-B-C-D"); return; }
    const value = Geometry.dihedral(atoms[0], atoms[1], atoms[2], atoms[3]);
    byId("targetDihedral").value = value.toFixed(2);
    setMeasure(`dihedral=${value.toFixed(2)} deg`);
  }

  function undo() {
    const previous = history.undo(state);
    if (!previous) return;
    setState(previous, true);
    setStatus("1つ前の編集に戻しました。");
  }

  function redo() {
    const next = history.redo(state);
    if (!next) return;
    setState(next, true);
    setStatus("編集をやり直しました。");
  }

  function updateAtomTable() {
    const tbody = document.querySelector("#atomTable tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    state.atoms.forEach((atom, i) => {
      const tr = document.createElement("tr");
      if (state.selectedAtomIds.has(atom.id)) tr.classList.add("selected");
      [String(i + 1), atom.element, atom.x.toFixed(3), atom.y.toFixed(3), atom.z.toFixed(3)].forEach(value => {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      });
      const tdS = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.setAttribute("aria-label",`${i+1}番を選択`);
      cb.checked = state.selectedAtomIds.has(atom.id);
      cb.addEventListener("click", ev => ev.stopPropagation());
      cb.addEventListener("change", ev => {
        ev.stopPropagation();
        const next = new Set(state.selectedAtomIds);
        if (cb.checked) next.add(atom.id); else next.delete(atom.id);
        Model.setSelectedAtoms(state, Array.from(next));
        rerenderSelectionOnly();
      });
      tdS.appendChild(cb);
      tr.appendChild(tdS);
      tr.addEventListener("click", ev => {
        Model.toggleAtomSelection(state, atom.id, additive(ev));
        rerenderSelectionOnly();
      });
      tbody.appendChild(tr);
    });
  }

  function updateBondTable() {
    const tbody = document.querySelector("#bondTable tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    state.bonds.forEach((bond, i) => {
      const a1 = state.atoms.find(atom => atom.id === bond.atom1);
      const a2 = state.atoms.find(atom => atom.id === bond.atom2);
      const tr = document.createElement("tr");
      if (state.selectedBondIds.has(bond.id)) tr.classList.add("selected");
      [String(i + 1), a1 ? atomLabel(a1) : "?", a2 ? atomLabel(a2) : "?", String(bond.order), bond.type, bond.source].forEach(value => {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      });
      const tdS = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.setAttribute("aria-label",`${i+1}番を選択`);
      cb.checked = state.selectedBondIds.has(bond.id);
      cb.addEventListener("click", ev => ev.stopPropagation());
      cb.addEventListener("change", ev => {
        ev.stopPropagation();
        const next = new Set(state.selectedBondIds);
        if (cb.checked) next.add(bond.id); else next.delete(bond.id);
        Model.setSelectedBonds(state, Array.from(next));
        rerenderSelectionOnly();
      });
      tdS.appendChild(cb);
      tr.appendChild(tdS);
      tr.addEventListener("click", ev => {
        Model.toggleBondSelection(state, bond.id, additive(ev));
        Model.setSelectedAtoms(state, [bond.atom1, bond.atom2]);
        byId("bondOrder").value = String(bond.order || 1);
        byId("bondType").value = bond.type || "covalent";
        rerenderSelectionOnly();
      });
      tbody.appendChild(tr);
    });
  }

  function onKeyDown(e) {
    if (e.defaultPrevented) return;
    const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
    const editingText = tag === "textarea" || tag === "input" || tag === "select";
    const inCanvas = canvasHasFocus();
    const key = e.key.toLowerCase();

    if(editingText || !inCanvas || document.querySelector("dialog[open]"))return;
    if(e.ctrlKey||e.metaKey){
      if(key==="a"){consumeShortcut(e);selectAll();return;}
      if(key==="z"){consumeShortcut(e);e.shiftKey?redo():undo();return;}
      if(key==="y"){consumeShortcut(e);redo();return;}
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && !editingText) {
      consumeShortcut(e);
      if (state.selectedBondIds.size > 0) deleteSelectedBonds();
      else deleteSelected();
      return;
    }
    if (editingText && !inCanvas) return;
    if (key === "v" || key === "s") { consumeShortcut(e); setMode("select"); return; }
    if (key === "b") { consumeShortcut(e); setMode("bond"); return; }
    if (key === "m") { consumeShortcut(e); setMode("move"); return; }
    if (inCanvas && key === "e") { consumeShortcut(e); expandSelectionOneBond(); return; }
    if (inCanvas && key === "w") { consumeShortcut(e); selectConnectedMoleculesFromSelection(); return; }
    if (key === "escape") { consumeShortcut(e); MV.Studio?.clearAxis(); clearSelection(); return; }
    if (key === "a" && !(e.ctrlKey || e.metaKey)) { consumeShortcut(e); selectAll(); return; }
    if (key === "1" || key === "2" || key === "3") { consumeShortcut(e); setSelectedBondOrder(Number(key)); return; }
    if (key === "r") {
      consumeShortcut(e);
      renderer.fit();
      renderer.rotX = -0.45;
      renderer.rotY = 0.65;
      renderer.zoom = 1;
      renderer.panX = 0;
      renderer.panY = 0;
      renderer.render();
      setStatus("表示をリセットしました。");
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      consumeShortcut(e);
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      consumeShortcut(e);
      redo();
      return;
    }
  }

  function bind(id, event, handler) {
    const el = byId(id);
    if (el) el.addEventListener(event, ev=>{try{const result=handler(ev);if(result?.catch)result.catch(report);}catch(error){report(error);}});
  }

  function wireUI() {
    bind("btnRender", "click", loadFromTextarea);
    bind("btnImportMol", "click", loadMolFromTextarea);
    bind("btnToggleMove", "click", toggleMoveMode);
    bind("toolSelect", "click", () => setMode("select"));
    bind("toolBond", "click", () => setMode("bond"));
    bind("toolMove", "click", () => setMode("move"));
    bind("btnToggleIndex", "click", toggleIndexLabels);
    bind("btnCopyXYZ", "click", copyXYZ);
    bind("btnDownloadXYZ", "click", downloadXYZ);
    bind("btnCopyMol", "click", copyMol);
    bind("btnDownloadSdf", "click", downloadSDF);
    bind("btnUndo", "click", undo);
    bind("btnRedo", "click", redo);
    bind("btnClearSel", "click", clearSelection);
    bind("btnDeleteSel", "click", deleteSelected);
    bind("btnChangeElem", "click", changeSelectedElement);
    bind("btnAddAtom", "click", addAtom);
    bind("btnAddFragment", "click", openFragmentDialog);
    bind("btnSelectAll", "click", selectAll);
    bind("btnSelectNone", "click", selectNone);
    bind("btnSelectInvert", "click", selectInvert);
    bind("btnSelectByElem", "click", selectByElement);
    bind("styleSelect", "change", onStyleChange);
    bind("btnAddBond", "click", addBondFromSelection);
    bind("btnUpdateBond", "click", updateSelectedBonds);
    bind("btnDeleteBond", "click", deleteSelectedBonds);
    bind("btnReinferBonds", "click", reinferBonds);
    bind("btnApplyDistance", "click", applyDistance);
    bind("btnMeasureDistance", "click", measureDistance);
    bind("btnApplyAngle", "click", applyAngle);
    bind("btnMeasureAngle", "click", measureAngle);
    bind("btnApplyDihedral", "click", applyDihedral);
    bind("btnMeasureDihedral", "click", measureDihedral);
    bind("btnFragApply", "click", ev => {
      ev.preventDefault();
      if(applyFragment()!==false) byId("fragDialog").close();
    });
    document.addEventListener("keydown", e=>{try{onKeyDown(e);}catch(error){report(error);}}, true);
  }

  function safeFilename(){return String(state.metadata.title||'structure').replace(/[\\/:*?"<>|\r\n]/g,'_').slice(0,80)||'structure';}
  function exampleState(name){
    const xyz={water:'3\nWater\nO 0 0 0\nH 0.9572 0 0\nH -0.239987 0.926627 0',methane:'5\nMethane\nC 0 0 0\nH .629 .629 .629\nH -.629 -.629 .629\nH -.629 .629 -.629\nH .629 -.629 -.629',ethanol:'9\nEthanol\nC -0.75 0 0\nC .75 0 0\nO 1.35 1.20 0\nH -1.13 .51 .89\nH -1.13 .51 -.89\nH -1.13 -1.02 0\nH 1.13 -.51 .89\nH 1.13 -.51 -.89\nH 2.30 1.10 0'};
    if(name!=='benzene')return IO.parseXYZToState(xyz[name]);
    const atoms=[];for(const [element,r] of [['C',1.397],['H',2.48]])for(let i=0;i<6;i++)atoms.push(Model.createAtom({element,x:r*Math.cos(i*Math.PI/3),y:r*Math.sin(i*Math.PI/3),z:0}));
    const result=Model.createState({atoms,metadata:{title:'Benzene',sourceFormat:'sample'}});
    for(let i=0;i<6;i++){Model.addOrUpdateBond(result,atoms[i].id,atoms[(i+1)%6].id,i%2?1:2,'covalent','manual');Model.addOrUpdateBond(result,atoms[i].id,atoms[i+6].id,1,'covalent','manual');}return result;
  }
  function setupStudio(){
    ['addElem','editElem','selByElem'].forEach(id=>{const el=byId(id);el.replaceChildren(...IO.ELEMENTS.map(e=>{const o=document.createElement('option');o.value=e;o.textContent=e;return o;}));});
    byId('addElem').value='C';byId('editElem').value='C';byId('addMode').value='custom';
    const aromatic=document.createElement('option');aromatic.value='4';aromatic.textContent='芳香族';byId('bondOrder').append(aromatic);
    document.querySelectorAll('[data-close]').forEach(el=>el.addEventListener('click',()=>byId(el.dataset.close).close()));
    bind('toolBox','click',()=>setMode('box'));
    bind('btnOpen','click',()=>byId('fileInput').click());
    bind('btnPaste','click',()=>{byId('importError').textContent='';byId('importDialog').showModal();byId('xyz_input').focus();});
    bind('btnHelp','click',()=>byId('helpDialog').showModal());
    bind('btnExport','click',()=>{byId('exportText').value=IO.stateToXYZText(state);byId('exportMessage').textContent='';byId('exportDialog').showModal();});
    bind('btnDownloadMol3000','click',()=>downloadText(IO.stateToMolV3000Text(state),'structure.mol'));
    bind('btnExportText','click',()=>byId('exportText').value=IO.stateToXYZText(state));
    bind('btnSaveProject','click',()=>{downloadText(IO.stateToProjectText(state),safeFilename()+'.json');setStatus('プロジェクトを保存しました。');});
    bind('btnNew','click',()=>{pushHistory('new');state=Model.createState();setMode('select');render(false);setStatus('新規構造です。原子追加またはサンプルから始めてください。');});
    bind('structureTitle','change',()=>{pushHistory('rename');state.metadata.title=byId('structureTitle').value.trim()||'無題の構造';saveLocal();syncUI();});
    const readFile=async file=>{if(!file)return;if(file.size>10*1024*1024)throw Error('ファイルは10MB以下にしてください。');const text=await file.text();loadText(text);if(!state.metadata.title||state.metadata.title==='無題の構造')state.metadata.title=file.name.replace(/\.[^.]+$/,'');saveLocal();syncUI();};
    bind('fileInput','change',async e=>{try{await readFile(e.target.files[0]);}finally{e.target.value='';}});
    const app=document.querySelector('.mv-app');
    app.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();app.classList.add('drag-over');}});
    app.addEventListener('dragleave',e=>{if(!app.contains(e.relatedTarget))app.classList.remove('drag-over');});
    app.addEventListener('drop',async e=>{e.preventDefault();app.classList.remove('drag-over');try{if(e.dataTransfer.files.length!==1)throw Error('ファイルは1つずつ開いてください。');await readFile(e.dataTransfer.files[0]);}catch(error){report(error);}});
    document.querySelectorAll('[data-example]').forEach(el=>el.addEventListener('click',()=>{pushHistory('sample');setState(exampleState(el.dataset.example),false);setStatus('サンプルを読み込みました。以前の構造は「戻す」で復元できます。');}));
    const tabs=[...document.querySelectorAll('[data-tab]')];
    function activate(tab){tabs.forEach(t=>{const active=t===tab;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;byId('pane-'+t.dataset.tab).hidden=!active;});}
    tabs.forEach((tab,i)=>{tab.tabIndex=i===0?0:-1;tab.addEventListener('click',()=>activate(tab));tab.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;activate(tabs[next]);tabs[next].focus();});});
    bind('btnApplyCharge','click',()=>{const atoms=selectedAtoms();if(atoms.length!==1)return;const charge=numberInput('atomCharge',-15,15);if(!Number.isInteger(charge))throw Error('形式電荷は整数にしてください。');pushHistory('charge');atoms[0].charge=charge;render(true);setStatus('形式電荷を変更しました。');});
    bind('dataText','input',()=>{xyzDirty=byId('dataText').value!==xyzDisplayBase;syncXYZEditor();});
    bind('coordinateFormat','change',()=>{
      const select=byId('coordinateFormat'),target=select.value;
      try{if(xyzDirty)applyXYZEditor();select.value=target;if(target==='mol3000'&&state.metadata.cell)throw Error('周期セルはXYZ + TVで編集してください。');syncXYZEditor();}
      catch(error){select.value=/V3000/.test(byId('dataText').value)?'mol3000':'xyz';report(error);}
    });
    bind('xyzHeader','change',()=>{
      try{
        if(xyzDirty){const draft=IO.parseXYZToState(byId('dataText').value);if(draft.metadata.trajectory)throw Error('1フレームのみ入力してください。');
          if(!/^\s*\d+\s*\n/.test(IO.normalizeXYZInput(byId('dataText').value)))draft.metadata={...state.metadata,...draft.metadata,title:state.metadata.title,cell:draft.metadata.cell||state.metadata.cell};
          byId('dataText').value=editorXYZ(draft);
        }
        syncXYZEditor();
      }catch(error){byId('xyzHeader').checked=!byId('xyzHeader').checked;byId('xyzEditStatus').textContent='入力を修正してからヘッダーを切り替えてください。'+error.message;}
    });
    bind('dataReset' ,'click',()=>{xyzDirty=false;syncXYZEditor();});
    bind('cellLowerTriangular','click',()=>{try{if(xyzDirty)applyXYZEditor();MV.App.change('lower triangular cell',s=>{MV.Periodic.lowerTriangular(s);Bonding.refreshInferredBonds(s);},true);setStatus('原子と格子を一緒に回転し、TVを下三角化しました。');}catch(error){report(error);}});
    bind('dataApply','click',()=>{try{applyXYZEditor();}catch(error){byId('xyzEditStatus').textContent=error.message;report(error);}});
    bind('btnDataDock','click',()=>{byId('tab-atoms').click();byId('dataText').focus();byId('dataText').scrollIntoView?.({block:'center',behavior:'smooth'});});
    bind('btnTranslate','click',()=>{const delta=['translateX','translateY','translateZ'].map(id=>numberInput(id));if(!state.selectedAtomIds.size)return;pushHistory('translate');selectedAtoms().forEach(a=>['x','y','z'].forEach((k,i)=>a[k]+=delta[i]));refreshBondsAndRender(true);setStatus('選択原子を平行移動しました。');});
    bind('btnFit','click',()=>renderer.fit());
    bind('btnZoomIn','click',()=>{renderer.zoom=Math.min(12,renderer.zoom*1.2);renderer.draw();});
    bind('btnZoomOut','click',()=>{renderer.zoom=Math.max(.1,renderer.zoom/1.2);renderer.draw();});
    [['XY',0,0],['XZ',Math.PI/2,0],['YZ',0,Math.PI/2]].forEach(([name,x,y])=>bind('btnView'+name,'click',()=>{renderer.rotX=x;renderer.rotY=y;renderer.draw();}));
    bind('btnPNG','click',()=>{const a=document.createElement('a');a.download=safeFilename()+'.png';a.href=renderer.canvas.toDataURL('image/png');a.click();setStatus('表示画像を保存しました。');});
    bind('btnSelectConnected','click',selectConnectedMoleculesFromSelection);bind('btnExpandSelection','click',expandSelectionOneBond);
    global.addEventListener('pagehide',()=>{try{localStorage.setItem('molecule-studio-v1',IO.stateToProjectText(state));}catch(error){/* Export remains available when storage is blocked. */}});
  }

  function init() {
    renderer = new Renderer3DMol("viewer");
    renderer.ensureViewer();
    renderer.onAtomContextSelect = atomId => {
      const ids=new Set(state.selectedAtomIds);ids.add(atomId);
      Model.setSelectedAtoms(state,[...ids]);Model.setSelectedBonds(state,[]);
      rerenderSelectionOnly();setStatus('原子を追加選択しました。Altドラッグで選択原子群を操作できます。');
    };
    renderer.onAtomClick = function (atomId, event, viewer) {
      handleAtomClick(atomId, event);
      if (viewer) viewer.render();
    };
    renderer.onBondClick = function (bondId, event, viewer) {
      handleBondClick(bondId, event);
      if (viewer) viewer.render();
    };
    renderer.onGroupDragStart = startGroupDrag;
    renderer.onGroupDrag = transformGroup;
    renderer.onAtomDragStart = handleAtomDragStart;
    renderer.onAtomsDrag = handleAtomsDrag;
    renderer.onDragEnd = handleCanvasDragEnd;
    renderer.onBoxSelect = handleBoxSelect;
    renderer.onBlankClick = () => clearSelection();
    renderer.onKeyDown = e=>{try{onKeyDown(e);}catch(error){report(error);}};
    wireUI();
    setupStudio();
    setMode("select");
    const styleSelect = byId("styleSelect");
    if (styleSelect) styleSelect.value = state.viewSettings.style;
    const initial = byId("xyz_input").value.trim();
    if (initial) loadFromTextarea(); else {
      try {const saved=localStorage.getItem("molecule-studio-v1");if(saved){state=IO.parseProject(saved);setStatus("前回の編集を復元しました。");}else state=exampleState("water");}catch(error){setStatus("前回の編集を復元できませんでした。ファイルから読み込んでください。",true);}
      render(false);
    }
  }

  MV.App = {
    init,
    getState: function () { return state; },
    setState,
    renderer: () => renderer,
    change(label, fn, fit=false) { const next=Model.cloneState(state); const result=fn(next)||next; pushHistory(label); setState(result,!fit); },
    setStatus, loadText
  };
})(window);

