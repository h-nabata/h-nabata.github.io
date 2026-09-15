(function (global) {
  "use strict";

  const MV = global.MoleculeVisualizer = global.MoleculeVisualizer || {};

  const ELEMENT_COLORS = {
    H: "#f7f7f7", C: "#2f3437", N: "#3155d4", O: "#d82424", F: "#49b35d",
    P: "#e88a1a", S: "#d8b11e", Cl: "#2ca24f", Br: "#8b3b21", I: "#6f3d91",
    B: "#d28b6c", Si: "#c5a56a", Li: "#8f6fd6", Na: "#7b5bd6", K: "#6f43c8",
    Mg: "#58a65c", Al: "#9aa0a6", Ca: "#4fa66b", Fe: "#c26b33", Cu: "#bb6a38", Zn: "#8796a8"
  };

  const ELEMENT_RADII = {
    H: 0.28, C: 0.38, N: 0.37, O: 0.36, F: 0.34, P: 0.44, S: 0.44,
    Cl: 0.45, Br: 0.48, I: 0.52
  };

  function Renderer3DMol(containerId) {
    this.containerId = containerId;
    this.container = null;
    this.canvas = null;
    this.ctx = null;
    this.state = null;
    this.projectedAtoms = [];
    this.projectedBonds = [];
    this.onAtomClick = null;
    this.onBondClick = null;
    this.onAtomDragStart = null;
    this.onAtomsDrag = null;
    this.onDragEnd = null;
    this.onBoxSelect = null;
    this.mode = "select";
    this.rotX = -0.45;
    this.rotY = 0.65;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.currentScale = 80;
    this.pointer = null;
    this.selectionBox = null;
    this.keyboardActive = false;
    this.pointerInside = false;
    this.cameraCenter = null; this.cameraSpan = null;
  }

  Renderer3DMol.prototype.ensureViewer = function () {
    if (this.canvas) return;
    this.container = document.getElementById(this.containerId);
    if (!this.container) throw new Error("Viewer container not found.");
    this.container.innerHTML = "";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "mv-canvas";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("aria-label", "Molecule editor canvas");
    this.canvas.setAttribute("role", "application");
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.installCanvasEvents();
    if (global.ResizeObserver) new ResizeObserver(() => { this.resize(); this.draw(); }).observe(this.container);
    this.resize();
  };

  Renderer3DMol.prototype.setInteractionMode = function (mode) {
    this.mode = mode || "select";
  };

  Renderer3DMol.prototype.resize = function () {
    if (!this.canvas || !this.container) return;
    const rect = this.container.getBoundingClientRect();
    const dpr = global.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  Renderer3DMol.prototype.renderState = function (state, preserveCamera) {
    this.ensureViewer();
    this.state = state;
    if (!preserveCamera || !this.cameraCenter) this.fit();
    this.resize();
    this.draw();
  };

  Renderer3DMol.prototype.updateSelection = function (state) {
    this.state = state;
    this.draw();
  };

  Renderer3DMol.prototype.render = function () {
    this.draw();
  };

  Renderer3DMol.prototype.focusCanvas = function () {
    if (!this.canvas) return;
    this.keyboardActive = true;
    try {
      this.canvas.focus({ preventScroll: true });
    } catch (error) {
      this.canvas.focus();
    }
  };

  Renderer3DMol.prototype.hasKeyboardFocus = function () {
    if (!this.canvas) return false;
    return document.activeElement === this.canvas || this.keyboardActive;
  };

  Renderer3DMol.prototype.center = function () {
    const atoms = this.state && this.state.atoms ? this.state.atoms : [];
    if (atoms.length === 0) return { x: 0, y: 0, z: 0 };
    return atoms.reduce((acc, atom) => ({
      x: acc.x + atom.x / atoms.length,
      y: acc.y + atom.y / atoms.length,
      z: acc.z + atom.z / atoms.length
    }), { x: 0, y: 0, z: 0 });
  };

  Renderer3DMol.prototype.rotate = function (p) {
    const cy = Math.cos(this.rotY), sy = Math.sin(this.rotY);
    const cx = Math.cos(this.rotX), sx = Math.sin(this.rotX);
    const x1 = p.x * cy + p.z * sy;
    const z1 = -p.x * sy + p.z * cy;
    const y2 = p.y * cx - z1 * sx;
    const z2 = p.y * sx + z1 * cx;
    return { x: x1, y: y2, z: z2 };
  };

  Renderer3DMol.prototype.project = function (atom, center, scale, width, height) {
    const rotated = this.rotate({
      x: atom.x - center.x,
      y: atom.y - center.y,
      z: atom.z - center.z
    });
    return {
      atom,
      x: width / 2 + this.panX + rotated.x * scale,
      y: height / 2 + this.panY - rotated.y * scale,
      z: rotated.z,
      radius: this.atomRadius(atom.element, scale)
    };
  };

  Renderer3DMol.prototype.draw = function () {
    if (!this.ctx || !this.state) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = "#f9fbfc";
    this.ctx.fillRect(0, 0, width, height);

    const atoms = this.state.atoms || [];
    if (atoms.length === 0) {
      this.projectedAtoms = []; this.projectedBonds = [];
      this.drawEmpty(width, height);
      return;
    }
    const center = this.cameraCenter || this.center();
    const span = this.cameraSpan || this.estimateSpan(center);
    const scale = Math.min(width, height) / Math.max(4.2, span * 1.15) * this.zoom;
    this.currentScale = scale;
    this.projectedAtoms = atoms.map((atom,index) => Object.assign(this.project(atom, center, scale, width, height), {index:index+1}));
    const atomById = new Map(this.projectedAtoms.map(pa => [pa.atom.id, pa]));

    this.projectedBonds = (this.state.bonds || []).flatMap(bond => {
      const a=atomById.get(bond.atom1),b=atomById.get(bond.atom2);if(!a||!b)return [];
      const cell=this.state.metadata.cell;
      if(!cell)return [{bond,a,b}];
      const image=MV.Periodic.minimumImage([b.atom.x-a.atom.x,b.atom.y-a.atom.y,b.atom.z-a.atom.z],cell);
      if(!image.shift.some(Boolean))return [{bond,a,b}];
      const offset=MV.Periodic.cartesian(image.shift,cell);
      const translate=(atom,sign)=>this.project({x:atom.x+sign*offset[0],y:atom.y+sign*offset[1],z:atom.z+sign*offset[2]},center,scale,width,height);
      return [{bond,a,b:translate(b.atom,1)},{bond,a:translate(a.atom,-1),b}];
    });
    if (this.state.metadata.cell) this.drawCell(center,scale,width,height);

    if (this.state.viewSettings.style !== "vdw") this.projectedBonds
      .slice()
      .sort((m, n) => ((m.a.z + m.b.z) / 2) - ((n.a.z + n.b.z) / 2))
      .forEach(item => this.drawBond(item));

    this.projectedAtoms
      .slice()
      .sort((a, b) => a.z - b.z)
      .forEach(pa => this.drawAtom(pa));

    const selected=[...this.state.selectedAtomIds].map(id=>atomById.get(id)).filter(Boolean);
    if(selected.length>=2&&selected.length<=4){
      const ctx=this.ctx;ctx.save();ctx.strokeStyle='#087e85';ctx.lineWidth=1.5;ctx.setLineDash([3,4]);ctx.beginPath();selected.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();ctx.setLineDash([]);
      try{const atoms=selected.map(p=>p.atom),text=atoms.length===2?MV.Geometry.distance(...atoms).toFixed(3)+' Å':atoms.length===3?MV.Geometry.angle(...atoms).toFixed(2)+'°':MV.Geometry.dihedral(...atoms).toFixed(2)+'°';ctx.fillStyle='#075c64';ctx.font='bold 13px sans-serif';ctx.textAlign='left';ctx.fillText(text,16,25);}catch(e){}ctx.restore();
    }
    if (this.selectionBox) this.drawSelectionBox();
  };

  Renderer3DMol.prototype.drawEmpty = function (width, height) {
    this.ctx.fillStyle = "#6b7280";
    this.ctx.font = "14px Arial, sans-serif";
    this.ctx.textAlign = "center";
    this.ctx.fillText("ファイルを開く・座標を貼り付ける・下のサンプルから始める", width / 2, height / 2);
  };

  Renderer3DMol.prototype.estimateSpan = function (center) {
    let max = 1;
    (this.state.atoms || []).forEach(atom => {
      const dx = atom.x - center.x;
      const dy = atom.y - center.y;
      const dz = atom.z - center.z;
      max = Math.max(max, Math.sqrt(dx * dx + dy * dy + dz * dz));
    });
    if(this.state.metadata.cell)this.cellCorners().forEach(p=>{max=Math.max(max,Math.hypot(p.x-center.x,p.y-center.y,p.z-center.z));});
    return max * 2;
  };

  Renderer3DMol.prototype.cellCorners = function(){
    return Array.from({length:8},(_,i)=>{const p=MV.Periodic.cartesian([i&1,(i>>1)&1,(i>>2)&1],this.state.metadata.cell);return {x:p[0],y:p[1],z:p[2]};});
  };
  Renderer3DMol.prototype.drawCell = function(center,scale,width,height){
    const corners=this.cellCorners().map(p=>this.project(p,center,scale,width,height)),ctx=this.ctx;ctx.save();ctx.lineWidth=1;ctx.strokeStyle='#8babb8';ctx.setLineDash([5,3]);
    corners.forEach((p,i)=>{[1,2,4].forEach(bit=>{if(i&bit)return;const q=corners[i|bit];ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();});});
    ctx.setLineDash([]);['a','b','c'].forEach((label,i)=>{const p=corners[0],q=corners[1<<i];ctx.strokeStyle=['#d35c59','#48a775','#527bce'][i];ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.fillStyle=ctx.strokeStyle;ctx.font='bold 13px sans-serif';ctx.fillText(label,q.x+5,q.y-5);});ctx.restore();
  };

  Renderer3DMol.prototype.drawBond = function (item) {
    const selected = this.state.selectedBondIds && this.state.selectedBondIds.has(item.bond.id);
    const manual = item.bond.source === "manual";
    const order = item.bond.order === 4 ? 2 : Math.max(1, Math.min(3, Number(item.bond.order) || 1));
    const dx = item.b.x - item.a.x;
    const dy = item.b.y - item.a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const offsets = order === 1 ? [0] : (order === 2 ? [-3.5, 3.5] : [-5, 0, 5]);
    this.ctx.lineCap = "round";
    const style = this.state.viewSettings.style;
    offsets.forEach((offset, lineIndex) => {
      this.ctx.setLineDash(item.bond.type !== "covalent" || (item.bond.order === 4 && lineIndex === 1) ? [5,4] : []);
      this.ctx.beginPath();
      this.ctx.moveTo(item.a.x + nx * offset, item.a.y + ny * offset);
      this.ctx.lineTo(item.b.x + nx * offset, item.b.y + ny * offset);
      this.ctx.lineWidth = selected ? 5 : (style === "wire" ? 1.4 : Math.max(2, Math.min(10,this.currentScale * .09)));
      this.ctx.strokeStyle = selected ? "#07959c" : (item.bond.type === "covalent" ? "#85969e" : "#b08d58");
      this.ctx.globalAlpha = item.bond.source === "inferred" ? 0.72 : 0.95;
      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
      this.ctx.setLineDash([]);
    });
  };

  Renderer3DMol.prototype.drawAtom = function (pa) {
    const selected = this.state.selectedAtomIds && this.state.selectedAtomIds.has(pa.atom.id);
    const color = ELEMENT_COLORS[pa.atom.element] || "#9ca3af";
    const grad = this.ctx.createRadialGradient(pa.x - pa.radius * 0.35, pa.y - pa.radius * 0.45, pa.radius * 0.1, pa.x, pa.y, pa.radius);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.22, color);
    grad.addColorStop(1, "#111827");

    if (selected) {
      this.ctx.beginPath();
      this.ctx.arc(pa.x, pa.y, pa.radius + 7, 0, Math.PI * 2);
      this.ctx.fillStyle = "rgba(8, 156, 163, 0.18)";
      this.ctx.fill();
      this.ctx.lineWidth = 2;
      this.ctx.strokeStyle = "#07959c";
      this.ctx.stroke();
    }

    this.ctx.beginPath();
    this.ctx.arc(pa.x, pa.y, pa.radius, 0, Math.PI * 2);
    this.ctx.fillStyle = grad;
    this.ctx.fill();
    this.ctx.lineWidth = 1.4;
    this.ctx.strokeStyle = pa.atom.element === "H" ? "#9ca3af" : "#111827";
    this.ctx.stroke();

    if (this.state.viewSettings && this.state.viewSettings.showIndexLabels) {
      const idx = pa.index;
      this.ctx.fillStyle = "#111827";
      this.ctx.font = "12px Arial, sans-serif";
      this.ctx.textAlign = "center";
      this.ctx.fillText(`${idx} ${pa.atom.element}`, pa.x, pa.y - pa.radius - 9);
    }
  };

  Renderer3DMol.prototype.fit = function () {
    this.cameraCenter = this.state?.metadata.cell ? (()=>{const v=MV.Periodic.cartesian([.5,.5,.5],this.state.metadata.cell);return {x:v[0],y:v[1],z:v[2]};})() : this.center(); this.cameraSpan = this.estimateSpan(this.cameraCenter);
    this.zoom = 1; this.panX = 0; this.panY = 0; this.draw();
  };
  Renderer3DMol.prototype.atomRadius = function(element,scale) {
    const style=this.state?.viewSettings?.style || "stickball";
    if(style==="wire") return 3;
    if(style==="stick") return Math.max(3,Math.min(10,scale*.07));
    if(style==="vdw") {const vdw={H:1.2,C:1.7,N:1.55,O:1.52,F:1.47,P:1.8,S:1.8,Cl:1.75,Br:1.85,I:1.98}; return Math.max(4,(vdw[element]||1.8)*scale);}
    return Math.max(5,(ELEMENT_RADII[element]||.4)*scale*.8);
  };
  Renderer3DMol.prototype.installCanvasEvents = function () {
    const self=this, touches=new Map(); let gesture=null;
    this.canvas.addEventListener("focus",()=>self.keyboardActive=true);
    this.canvas.addEventListener("blur",()=>self.keyboardActive=false);
    this.canvas.addEventListener("keydown",e=>self.onKeyDown?.(e));
    const pinch=()=>{const [a,b]=[...touches.values()];return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,d:Math.hypot(a.x-b.x,a.y-b.y)};};
    this.canvas.addEventListener("pointerdown",function(e){
      self.focusCanvas();const p=self.eventPoint(e);touches.set(e.pointerId,p);self.canvas.setPointerCapture(e.pointerId);
      if(touches.size===2){if(self.pointer?.historyStarted) self.onDragEnd?.(e);self.pointer=null;self.selectionBox=null;gesture=pinch();return;}
      if(touches.size>2)return;
      const atom=self.pickAtom(p.x,p.y),bond=atom?null:self.pickBond(p.x,p.y);
      let action=e.button===2||e.altKey?"pan":self.mode==="box"?"box":self.mode==="move"&&atom?"move":"rotate";
      self.pointer={id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false,atomId:atom?.id,bondId:bond?.id,action,historyStarted:false};
      if(action==="box")self.selectionBox={x1:p.x,y1:p.y,x2:p.x,y2:p.y};
      e.preventDefault();
    });
    this.canvas.addEventListener("pointermove",function(e){
      if(!touches.has(e.pointerId))return;const p=self.eventPoint(e);touches.set(e.pointerId,p);
      if(gesture&&touches.size===2){const next=pinch();self.zoom=Math.max(.1,Math.min(12,self.zoom*next.d/Math.max(1,gesture.d)));self.panX+=next.x-gesture.x;self.panY+=next.y-gesture.y;gesture=next;self.draw();return;}
      const ptr=self.pointer;if(!ptr||ptr.id!==e.pointerId)return;
      if(!ptr.moved&&Math.hypot(e.clientX-ptr.x,e.clientY-ptr.y)<5)return;
      ptr.moved=true;const dx=e.clientX-ptr.lastX,dy=e.clientY-ptr.lastY;ptr.lastX=e.clientX;ptr.lastY=e.clientY;
      if(ptr.action==="box"){self.selectionBox.x2=p.x;self.selectionBox.y2=p.y;}
      else if(ptr.action==="pan"){self.panX+=dx;self.panY+=dy;}
      else if(ptr.action==="move"){
        if(!ptr.historyStarted){self.onAtomDragStart?.(ptr.atomId,e);ptr.historyStarted=true;}
        self.onAtomsDrag?.(ptr.atomId,self.screenDeltaToWorld(dx,dy,e.shiftKey),e);
      }else {self.rotY+=dx*.008;self.rotX+=dy*.008;}
      self.draw();
    });
    const finish=function(e){
      touches.delete(e.pointerId);if(gesture){if(touches.size<2)gesture=null;self.pointer=null;return;}
      const ptr=self.pointer;if(!ptr||ptr.id!==e.pointerId)return;self.pointer=null;
      if(ptr.historyStarted)self.onDragEnd?.(e);
      if(ptr.action==="box"){const ids=self.atomIdsInBox(self.selectionBox);self.selectionBox=null;if(e.type!=="pointercancel")self.onBoxSelect?.(ids,e);}
      else if(!ptr.moved&&ptr.action!=="pan"&&e.type!=="pointercancel") {if(ptr.atomId)self.onAtomClick?.(ptr.atomId,e,self);else if(ptr.bondId)self.onBondClick?.(ptr.bondId,e,self);else self.onBlankClick?.(e);}
      self.draw();
    };
    this.canvas.addEventListener("pointerup",finish);this.canvas.addEventListener("pointercancel",finish);this.canvas.addEventListener("lostpointercapture",finish);
    this.canvas.addEventListener("wheel",e=>{e.preventDefault();self.zoom=Math.max(.1,Math.min(12,self.zoom*Math.exp(-e.deltaY*.001)));self.draw();},{passive:false});
    this.canvas.addEventListener("contextmenu",e=>e.preventDefault());
    global.addEventListener("resize",()=>{self.resize();self.draw();});
  };

  Renderer3DMol.prototype.screenDeltaToWorld = function (dx, dy, zMode) {
    const scale = this.currentScale || 80;
    const sx = dx / scale;
    const sy = -dy / scale;
    if (zMode) return { x: 0, y: 0, z: sy };

    const cy = Math.cos(this.rotY), syy = Math.sin(this.rotY);
    const cx = Math.cos(this.rotX), sxx = Math.sin(this.rotX);
    const rx = sx;
    const ry = sy;
    const rz = 0;

    const y1 = ry * cx + rz * sxx;
    const z1 = -ry * sxx + rz * cx;
    return {
      x: rx * cy - z1 * syy,
      y: y1,
      z: rx * syy + z1 * cy
    };
  };

  Renderer3DMol.prototype.drawSelectionBox = function () {
    const b = this.selectionBox;
    const x = Math.min(b.x1, b.x2);
    const y = Math.min(b.y1, b.y2);
    const w = Math.abs(b.x2 - b.x1);
    const h = Math.abs(b.y2 - b.y1);
    this.ctx.fillStyle = "rgba(37, 99, 235, 0.12)";
    this.ctx.strokeStyle = "#2563eb";
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([5, 4]);
    this.ctx.fillRect(x, y, w, h);
    this.ctx.strokeRect(x, y, w, h);
    this.ctx.setLineDash([]);
  };

  Renderer3DMol.prototype.atomIdsInBox = function (box) {
    if (!box) return [];
    const x1 = Math.min(box.x1, box.x2);
    const x2 = Math.max(box.x1, box.x2);
    const y1 = Math.min(box.y1, box.y2);
    const y2 = Math.max(box.y1, box.y2);
    return this.projectedAtoms
      .filter(pa => pa.x >= x1 && pa.x <= x2 && pa.y >= y1 && pa.y <= y2)
      .map(pa => pa.atom.id);
  };

  Renderer3DMol.prototype.eventPoint = function (event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  Renderer3DMol.prototype.handlePick = function (event) {
    const p = this.eventPoint(event);
    const atom = this.pickAtom(p.x, p.y);
    if (atom && typeof this.onAtomClick === "function") {
      this.onAtomClick(atom.id, event, this);
      return;
    }
    const bond = this.pickBond(p.x, p.y);
    if (bond && typeof this.onBondClick === "function") this.onBondClick(bond.id, event, this);
  };

  Renderer3DMol.prototype.pickAtom = function (x, y) {
    const sorted=this.projectedAtoms.slice().sort((a,b)=>b.z-a.z);
    const hit=sorted.find(pa=>Math.hypot(x-pa.x,y-pa.y)<=Math.max(10,pa.radius+3));
    return hit ? hit.atom : null;
  };

  Renderer3DMol.prototype.pickBond = function (x, y) {
    if(this.state?.viewSettings?.style === "vdw") return null;
    let best = null;
    let bestD = Infinity;
    this.projectedBonds.forEach(item => {
      const d = pointToSegmentDistance(x, y, item.a.x, item.a.y, item.b.x, item.b.y);
      if (d < 9 && d < bestD) {
        best = item.bond;
        bestD = d;
      }
    });
    return best;
  };

  function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
    const x = x1 + t * dx;
    const y = y1 + t * dy;
    const ex = px - x;
    const ey = py - y;
    return Math.sqrt(ex * ex + ey * ey);
  }

  MV.Renderer3DMol = Renderer3DMol;
})(window);

