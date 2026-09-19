/* File-order measurements in Å/degrees. Definitions are document-wide; atom-ID
 * bindings prevent a deletion/reorder within a visited frame from retargeting a pin. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,G=MV.Geometry,P=MV.Periodic;
  const TYPES={distance:{name:'原子間距離',count:2,unit:'Å'},angle:{name:'結合角',count:3,unit:'°'},dihedral:{name:'二面角',count:4,unit:'°'},planeDistance:{name:'平面からの距離',count:4,unit:'Å'},cone:{name:'Tolman円錐角（4原子近似）',count:4,unit:'°'},planeGap:{name:'平面間距離',count:6,unit:'Å'}};
  // Bondi radii (Å), as tabulated by Morfeus. No invented fallback for missing elements.
  const RADII={H:1.2,He:1.4,Li:1.81,C:1.7,N:1.55,O:1.52,F:1.47,Ne:1.54,Na:2.27,Mg:1.73,Si:2.1,P:1.8,S:1.8,Cl:1.75,Ar:1.88,K:2.75,Ga:1.87,As:1.85,Se:1.9,Br:1.83,Kr:2.02,In:1.93,Sn:2.17,Te:2.06,I:1.98,Xe:2.16,Tl:1.96,Pb:2.02};
  const MAX_PINS=64,PI=Math.PI,add=G.vadd,sub=G.vsub,mul=G.vscale,dot=G.dot,cross=G.cross,norm=G.norm;
  const unit=v=>{const n=norm(v);if(n<1e-10)throw Error('重なった点から方向を定義できません。');return mul(v,1/n);};
  const average=ps=>mul(ps.reduce(add,{x:0,y:0,z:0}),1/ps.length),clamp=v=>Math.max(-1,Math.min(1,v)),angle=(u,v)=>Math.acos(clamp(dot(u,v)));
  function config(state,create=false){
    const c=state.metadata.measurements;
    if(c&&c.version===1&&Array.isArray(c.items))return c;
    if(create)return state.metadata.measurements={version:1,items:[],nextId:1,type:'dihedral',minimumImage:false,coneVdw:true};
    return {version:1,items:[],nextId:1,type:'dihedral',minimumImage:false,coneVdw:true};
  }
  function selectedIndices(state){const map=new Map(state.atoms.map((a,i)=>[a.id,i]));return [...state.selectedAtomIds].map(id=>map.get(id)).filter(i=>i!==undefined);}
  function selectedType(state){const c=config(state),n=state.selectedAtomIds.size;return n===2?'distance':n===3?'angle':n===6?'planeGap':n===4&&['dihedral','planeDistance','cone'].includes(c.type)?c.type:n===4?'dihedral':null;}
  function descriptor(state){const type=selectedType(state);if(!type)return null;const c=config(state),indices=selectedIndices(state);return {id:'selected',type,indices,elements:indices.map(i=>state.atoms[i].element),options:{minimumImage:Boolean(c.minimumImage),coneVdw:c.coneVdw!==false,radii:Array.isArray(c.coneRadii)?c.coneRadii.slice():null}};}
  function valid(item){return item&&TYPES[item.type]&&Array.isArray(item.indices)&&item.indices.length===TYPES[item.type].count&&new Set(item.indices).size===item.indices.length&&item.indices.every(i=>Number.isInteger(i)&&i>=0&&i<20000);}
  function frameKey(state,index){return String(index??state.metadata.frameIndex??0);}
  function bind(state){for(const item of config(state).items.slice(0,MAX_PINS)){
    if(!valid(item))continue;const k=frameKey(state);item.bindings=item.bindings&&typeof item.bindings==='object'&&!Array.isArray(item.bindings)?item.bindings:{};
    if(!Object.prototype.hasOwnProperty.call(item.bindings,k))item.bindings[k]=item.indices.map((i,j)=>state.atoms[i]&&(!item.elements||state.atoms[i].element===item.elements[j])?state.atoms[i].id:null);
  }}
  function resolve(state,item,index){
    if(!valid(item))throw Error('計測定義が不正です。');
    const ids=item.bindings?.[frameKey(state,index)];
    if(ids&&(!Array.isArray(ids)||ids.length!==item.indices.length))throw Error('原子の対応データが不正です。');
    const atoms=ids?ids.map(id=>state.atoms.find(a=>a.id===id)):item.indices.map(i=>state.atoms[i]);
    if(atoms.some(a=>!a))throw Error('指定原子が存在しません（削除・原子数の違い）。');
    if(item.elements&&atoms.some((a,i)=>a.element!==item.elements[i]))throw Error('指定File-orderの元素が異なります。');
    if(atoms.some(a=>![a.x,a.y,a.z].every(Number.isFinite)))throw Error('座標が有限値ではありません。');return atoms;
  }
  function plane(points){const a=sub(points[1],points[0]),b=sub(points[2],points[0]),v=cross(a,b);if(norm(a)<1e-9||norm(b)<1e-9||norm(v)/(norm(a)*norm(b))<1e-8)throw Error('3原子が一直線または重なっており、平面を定義できません。');return {normal:unit(v),center:average(points)};}
  function unwrap(atoms,cell,type){
    const ps=atoms.map(a=>({x:a.x,y:a.y,z:a.z}));if(!cell)return ps;
    const near=(i,j)=>{const d=sub(ps[i],ps[j]),v=P.minimumImage([d.x,d.y,d.z],cell).vector;ps[i]=add(ps[j],{x:v[0],y:v[1],z:v[2]});};
    if(type==='angle'){near(0,1);near(2,1);}else if(type==='dihedral'){near(0,1);near(2,1);near(3,2);}else if(type==='planeGap'){near(1,0);near(2,0);near(3,0);near(4,3);near(5,3);}else for(let i=1;i<ps.length;i++)near(i,0);return ps;
  }
  /* Smallest spherical cap enclosing three vdW caps. Feasibility uses cap
   * centers, boundary samples and all pairwise boundary intersections. This
   * also covers collinear/coplanar directions and caps larger than hemispheres. */
  function enclosingCone(vectors,radii){
    const lengths=vectors.map(norm),u=vectors.map(unit),alpha=lengths.map((d,i)=>{if(!Number.isFinite(radii[i])||radii[i]<0||radii[i]>=d)throw Error('円錐の頂点がvdW球の内側にあるか、半径が不正です。');return Math.asin(radii[i]/d);});
    function feasible(theta){
      if(alpha.some(a=>theta<a-1e-12))return null;
      const bounds=alpha.map(a=>Math.cos(theta-a));
      const accepts=n=>u.every((v,i)=>dot(n,v)>=bounds[i]-2e-12);
      const candidates=u.map(v=>({...v}));
      for(let i=0;i<3;i++){
        const axis=Math.abs(u[i].x)<.8?{x:1,y:0,z:0}:{x:0,y:1,z:0},p=unit(cross(u[i],axis)),q=cross(u[i],p),s=Math.sqrt(Math.max(0,1-bounds[i]**2));
        for(const v of [p,mul(p,-1),q,mul(q,-1)])candidates.push(add(mul(u[i],bounds[i]),mul(v,s)));
        for(let j=i+1;j<3;j++){
          const d=dot(u[i],u[j]),den=1-d*d;if(den<1e-13)continue;
          const base=add(mul(u[i],(bounds[i]-d*bounds[j])/den),mul(u[j],(bounds[j]-d*bounds[i])/den)),height=1-dot(base,base);
          if(height<-1e-11)continue;const off=mul(unit(cross(u[i],u[j])),Math.sqrt(Math.max(0,height)));
          candidates.push(add(base,off),sub(base,off));
        }
      }
      return candidates.find(accepts)||null;
    }
    let low=Math.max(...alpha),high=PI,axis=feasible(high);
    if(!axis)throw Error('円錐を構成できません。');
    for(let i=0;i<45;i++){const mid=(low+high)/2,candidate=feasible(mid);if(candidate){high=mid;axis=candidate;}else low=mid;}
    return {value:2*high*180/PI,axis,halfAngle:high};
  }
  function evaluate(state,item,index){
    try{
      if(item.options?.minimumImage&&!state.metadata.cell)throw Error('このフレームには周期セルがありません。');
      const atoms=resolve(state,item,index),type=item.type,cell=item.options?.minimumImage?state.metadata.cell:null,points=unwrap(atoms,cell,type),[a,b,c,d]=points;
      let value,anchor=average(points),segments=[],polygons=[],note='';
      const chain=ps=>ps.slice(1).map((p,i)=>[ps[i],p]);
      if(type==='distance'){value=G.distance(a,b);segments=[[a,b]];}
      if(type==='angle'){value=G.angle(a,b,c);segments=[[a,b],[b,c]];anchor=add(b,mul(sub(average([a,c]),b),.4));}
      if(type==='dihedral'){value=G.dihedral(a,b,c,d);segments=chain(points);polygons=[[a,b,c],[b,c,d]];}
      if(type==='planeDistance'){const p=plane([a,b,c]),signed=dot(p.normal,sub(d,a)),foot=sub(d,mul(p.normal,signed));value=Math.abs(signed);segments=[[d,foot]];polygons=[[a,b,c]];anchor=average([d,foot]);note='ABC平面からDまでの垂直距離（絶対値）';}
      if(type==='planeGap'){
        const p=plane(points.slice(0,3)),q=plane(points.slice(3)),parallel=Math.abs(dot(p.normal,q.normal)),degrees=Math.acos(clamp(parallel))*180/PI;polygons=[points.slice(0,3),points.slice(3)];
        if(1-parallel<5e-13){const signed=dot(p.normal,sub(q.center,p.center)),foot=sub(q.center,mul(p.normal,signed));value=Math.abs(signed);segments=[[foot,q.center]];anchor=average([foot,q.center]);note='平行な無限平面ABC–DEFの垂直距離';}
        else{value=0;note=`無限平面は交差するため0 Å（平面間角 ${degrees.toFixed(4)}°）`;}
      }
      if(type==='cone'){
        const useVdw=item.options?.coneVdw!==false,radii=points.slice(1).map((_,i)=>useVdw?(item.options?.radii?.[i]??RADII[atoms[i+1].element]):0);
        if(radii.some(r=>!Number.isFinite(r)))throw Error('Bondi半径が未登録の元素です。B/C/Dの半径を指定してください。');
        const cone=enclosingCone([sub(b,a),sub(c,a),sub(d,a)],radii);value=cone.value;segments=[[a,b],[a,c],[a,d]];polygons=[[b,c,d]];anchor=add(a,mul(cone.axis,.6*Math.min(...points.slice(1).map(p=>norm(sub(p,a))))));
        note=`Aを頂点にB/C/D${useVdw?'のvdW球':'の中心'}を包む最小円錐の全頂角。4原子近似、M–P距離の規格化なし。半径 ${radii.join('/')} Å`;
      }
      if(!Number.isFinite(value))throw Error('計測値を定義できません。');
      return {ok:true,value,unit:TYPES[type].unit,points,segments,polygons,anchor,note:note+(cell?' · 最小像で展開':''),atoms};
    }catch(error){return {ok:false,value:null,unit:TYPES[item?.type]?.unit||'',note:error.message};}
  }
  function pin(state){
    const item=descriptor(state);if(!item)throw Error('2・3・4・6原子を順に選択してください。');
    const value=evaluate(state,item);if(!value.ok)throw Error(value.note);const c=config(state,true);if(c.items.length>=MAX_PINS)throw Error(`固定表示は最大${MAX_PINS}件です。`);
    if(c.items.some(p=>p.type===item.type&&JSON.stringify(p.indices)===JSON.stringify(item.indices)&&JSON.stringify(p.options)===JSON.stringify(item.options)))throw Error('同じ計測をすでに固定しています。');
    const serial=Number.isSafeInteger(c.nextId)&&c.nextId>0?c.nextId:1;c.nextId=serial+1;item.id='M'+serial;item.bindings={};c.items.push(item);bind(state);return item;
  }
  function visible(state){const pins=config(state).items.slice(0,MAX_PINS).map(item=>({item,result:evaluate(state,item),pinned:true})),active=descriptor(state);if(active&&!pins.some(p=>p.item.type===active.type&&JSON.stringify(p.item.indices)===JSON.stringify(active.indices)&&JSON.stringify(p.item.options)===JSON.stringify(active.options)))pins.push({item:active,result:evaluate(state,active),pinned:false});return pins;}
  function transferSelection(from,to){const indices=selectedIndices(from);to.selectedAtomIds=new Set(indices.filter(i=>to.atoms[i]).map(i=>to.atoms[i].id));to.selectedBondIds=new Set();return indices.length-to.selectedAtomIds.size;}
  function csvField(value){if(typeof value==='number')return Number.isFinite(value)?String(value):'';let text=String(value??'');if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
  function csv(state){
    const items=config(state).items.slice(0,MAX_PINS);if(!items.length)throw Error('固定した計測値がありません。');
    const frames=state.metadata.trajectory||[state],current=state.metadata.frameIndex||0;
    const rows=[['frame','title',...items.flatMap(m=>[`${m.id} ${TYPES[m.type]?.name||m.type} [${m.indices.map(i=>i+1).join('-')}] (${TYPES[m.type]?.unit||''})`,`${m.id} status`])]];
    frames.forEach((f,k)=>{const s=k===current?state:MV.Model.createState(f);rows.push([k+1,s.metadata.title||'',...items.flatMap(m=>{const r=evaluate(s,m,k);return [r.ok?Number(r.value.toFixed(10)):'',r.ok?(r.note||'OK'):'NA: '+r.note];})]);});return '\ufeff'+rows.map(row=>row.map(csvField).join(',')).join('\r\n')+'\r\n';
  }
  const originalProject=MV.IO.parseProject;
  MV.IO.parseProject=function(text){
    const state=originalProject(text),c=state.metadata.measurements;if(c==null)return state;
    if(typeof c!=='object'||c.version!==1||!Array.isArray(c.items)||c.items.length>MAX_PINS)throw Error('固定計測データが不正です。');
    const ids=new Set();for(const item of c.items){
      if(!valid(item)||typeof item.id!=='string'||!/^M[1-9][0-9]{0,8}$/.test(item.id)||ids.has(item.id)||!Array.isArray(item.elements)||item.elements.length!==item.indices.length||item.elements.some(e=>typeof e!=='string'))throw Error('固定計測の種類・原子番号・IDが不正です。');ids.add(item.id);
      if(item.options?.radii!=null&&(!Array.isArray(item.options.radii)||item.options.radii.length!==3||item.options.radii.some(r=>!Number.isFinite(r)||r<=0||r>10)))throw Error('固定計測のvdW半径が不正です。');
      if(item.bindings!=null&&(typeof item.bindings!=='object'||Array.isArray(item.bindings)||Object.entries(item.bindings).some(([k,v])=>!/^\d{1,3}$/.test(k)||!Array.isArray(v)||v.length!==item.indices.length||v.some(id=>id!==null&&(typeof id!=='string'||id.length>128)))))throw Error('固定計測の原子対応が不正です。');
    }
    c.nextId=Math.max(1,...c.items.map(m=>Number(m.id.slice(1))+1));return state;
  };
  MV.Measurements={TYPES,RADII,MAX_PINS,config,selectedIndices,selectedType,descriptor,bind,resolve,evaluate,pin,visible,transferSelection,csv,enclosingCone};
})(window);
