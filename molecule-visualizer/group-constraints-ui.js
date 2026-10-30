/* Group registration never runs a calculation; every edit has one undo step. */
(function(global){
  'use strict';
  const M=global.MoleculeVisualizer,C=M.GroupConstraints,$=id=>document.getElementById(id);
  let ready=false,last='';
  const busy=()=>M.EngineUI?.isBusy()||M.AFIRUI?.isBusy();
  const message=text=>{$('groupConstraintStatus').textContent=text;};
  const safe=fn=>{try{fn();}catch(e){last='';sync();message(e.message);}};
  function change(fn){
    if(busy())throw Error('計算終了後に重心拘束を変更してください。');
    if(/未適用|編集中/.test($('xyzEditStatus').textContent))throw Error('編集中の座標を先に適用してください。');
    M.App.useDisplayedStructure();
    M.App.change('group center constraints',state=>{const c=JSON.parse(JSON.stringify(C.config(state)));fn(c,state);state.metadata.groupConstraints=c;});
    message('重心拘束の設定を更新しました。計算開始時の位置を基準にします。');
  }
  function add(ids,label){
    if(!ids.length)throw Error('原子団にする原子を描画上で選択してください。');
    change(c=>{
      if(c.groups.length>=100)throw Error('登録できる原子団は100個までです。');
      if(c.groups.some(g=>g.enabled&&g.atomIds.some(id=>ids.includes(id))))throw Error('有効な原子団と原子が重複しています。先に対象を解除してください。');
      const id='center-'+Date.now().toString(36)+'-'+c.groups.length;
      c.groups.push({id,label:label||'原子団 '+(c.groups.length+1),enabled:true,atomIds:[...ids]});c.enabled=true;
    });
  }
  function open(){
    if(!busy())M.App.useDisplayedStructure();
    $('groupConstraintPanel').open=true;$('groupConstraintPanel').scrollIntoView({block:'nearest',behavior:'smooth'});
    if(!busy()){$('toolSelect').click();$('multiSelect').checked=true;}
    sync();
  }
  function sync(){
    if(!ready)return;const s=M.App.getState();let c;
    try{c=C.config(s);}catch(e){message(e.message);c=C.defaults();}
    const active=c.groups.filter(g=>g.enabled),signature=JSON.stringify([c,s.atoms.map(a=>[a.id,a.element])]);
    if(signature!==last){
      last=signature;$('groupConstraintEnabled').checked=c.enabled;$('groupConstraintMode').value=c.mode;
      const list=$('groupConstraintRows');list.replaceChildren();
      for(const group of c.groups){
        const row=document.createElement('div');row.className='mv-row';const label=document.createElement('label');label.className='mv-check';
        const check=document.createElement('input');check.type='checkbox';check.checked=group.enabled;check.setAttribute('aria-label',group.label+'を拘束対象にする');
        check.onchange=()=>safe(()=>change(c=>{c.groups.find(g=>g.id===group.id).enabled=check.checked;}));label.append(check,document.createTextNode(group.label));row.append(label);
        const numbers=document.createElement('span');numbers.className='mv-small';numbers.style.overflowWrap='anywhere';numbers.textContent=group.atomIds.map(id=>{const n=s.atoms.findIndex(a=>a.id===id);return n<0?'削除済み':n+1;}).join(', ');row.append(numbers);
        for(const [text,fn] of [['選択',()=>{const state=M.App.getState();state.selectedAtomIds=new Set(group.atomIds.filter(id=>state.atoms.some(a=>a.id===id)));state.selectedBondIds.clear();M.App.setState(state,true);}],['削除',()=>change(c=>{c.groups=c.groups.filter(g=>g.id!==group.id);if(!c.groups.length)c.enabled=false;})]]){const b=document.createElement('button');b.className='mv-btn';b.type='button';b.textContent=text;b.setAttribute('aria-label',group.label+'を'+text);b.onclick=()=>safe(fn);row.append(b);}
        list.append(row);
      }
    }
    const summary=c.enabled?`${active.length}原子団 · ${c.mode==='distances'?'重心間距離を固定':c.mode==='absolute'||active.length===1?'重心位置を固定':'相対位置を固定'}`:'オフ';
    for(const id of ['groupConstraintSummary','engineGroupConstraintSummary','afirGroupConstraintSummary'])$(id).textContent='重心拘束: '+summary;
    $('btnGroupConstraints').setAttribute('aria-pressed',String(c.enabled));
    for(const field of $('groupConstraintFields').querySelectorAll('input,button,select'))field.disabled=!!busy();
    $('groupConstraintAddSelected').disabled=!!busy()||!s.selectedAtomIds.size;
    const fragments=s.metadata.afir?.fragments||[],select=$('groupConstraintAFIR'),key=JSON.stringify(fragments);
    if(select.dataset.groups!==key){const prev=select.value;select.replaceChildren();for(const f of fragments){const o=document.createElement('option');o.value=f.id;o.textContent=f.label;select.append(o);}if(fragments.some(f=>f.id===prev))select.value=prev;select.dataset.groups=key;}
    $('groupConstraintAddAFIR').disabled=!!busy()||!fragments.length;
  }
  function init(){
    ready=true;$('btnGroupConstraints').onclick=()=>safe(open);
    for(const id of ['engineGroupConstraints','afirGroupConstraints'])$(id).onclick=()=>safe(()=>{$('engineDialog').close();open();});
    $('groupConstraintEnabled').onchange=()=>safe(()=>change(c=>{c.enabled=$('groupConstraintEnabled').checked;}));
    $('groupConstraintMode').onchange=()=>safe(()=>change(c=>{c.mode=$('groupConstraintMode').value;}));
    $('groupConstraintAddSelected').onclick=()=>safe(()=>{const s=M.App.getState();add(s.atoms.filter(a=>s.selectedAtomIds.has(a.id)).map(a=>a.id));});
    $('groupConstraintAddAFIR').onclick=()=>safe(()=>{const f=M.App.getState().metadata.afir?.fragments.find(f=>f.id===$('groupConstraintAFIR').value);if(f)add(f.atomIds,f.label);});
    $('groupConstraintClear').onclick=()=>safe(()=>{if(busy())throw Error('計算終了後に重心拘束を解除してください。');if(/未適用|編集中/.test($('xyzEditStatus').textContent))throw Error('編集中の座標を先に適用してください。');M.App.useDisplayedStructure();M.App.change('clear group center constraints',s=>{s.metadata.groupConstraints=C.defaults();});message('重心拘束をすべて解除しました。');});
    $('groupConstraintOptimize').onclick=()=>M.EngineUI.prepareSingle('optimize');
    sync();
  }
  M.GroupConstraintUI={init,sync,open};
})(window);
