/* GRRM-style avoiding model function (AMF). Energies in eV, alpha in kJ/mol.
 * The coefficients below differentiate the energy-dependent coupling as well.
 * They are force coefficients, not electronic-state populations. */
(function(global){
  'use strict';
  const K=96.48533212331002,keys=['state1EV','state2EV','gapEV','couplingEV','lowerEV','upperEV','weight1','weight2'];
  function normalize(s){
    if(!s||s.model!=='amf'||!['lower','upper'].includes(s.surface)||!Number.isFinite(s.alphaKJMol)||s.alphaKJMol<0||s.alphaKJMol>10000||!Array.isArray(s.multiplicities)||s.multiplicities.length!==2||s.multiplicities.some(m=>!Number.isInteger(m)||m<1||m>101)||s.multiplicities[0]===s.multiplicities[1])throw Error('ModelFは上下いずれかの面、α=0〜10000 kJ/mol、異なる2つのスピン多重度を指定してください。');
    return {model:'amf',surface:s.surface,alphaKJMol:s.alphaKJMol,multiplicities:s.multiplicities.slice()};
  }
  function validateInput(data,info){
    if(!data.modelF)return;
    const s=normalize(data.modelF);
    if(info&&info.modelF?.version!==1)throw Error('ModelFを使用するにはbridge.py 1.14.0以降へ更新・再起動して再接続してください。');
    if(s.multiplicities[0]!==data.multiplicity)throw Error('ModelFの状態1の多重度が計算条件と一致しません。');
    if(info?.uma&&s.multiplicities.some(m=>m>100))throw Error('UMAのスピン多重度は1〜100です。');
    if(data.thermochemistry)throw Error('ModelF面では電子縮退度が一意に定まらないため熱化学補正は未対応です。振動解析のみ使用できます。');
  }
  function components(e1,e2,s){
    if(!Number.isFinite(e1)||!Number.isFinite(e2))throw Error('ModelFの状態エネルギーが不正です。');
    const delta=e1-e2,a=s.alphaKJMol/K;let u=0,shift=0,derivative=Math.sign(delta);
    if(a>0&&Math.abs(delta)<27*a){const t=delta/a,decay=Math.exp(-t*t),radius=Math.hypot(delta,a*decay);u=a/2*decay;derivative=delta/radius*(1-2*decay*decay);shift=2*u*(u/(radius+Math.abs(delta)));}
    const w=.5*(1+(s.surface==='lower'?-1:1)*derivative);
    return {state1EV:e1,state2EV:e2,gapEV:delta,couplingEV:u,lowerEV:Math.min(e1,e2)-shift,upperEV:Math.max(e1,e2)+shift,weight1:w,weight2:1-w};
  }
  function row(result,i){return Object.fromEntries(Object.entries(result.surfaceComponents||{}).map(([k,v])=>[k,Array.isArray(v)?v[i]:v]));}
  function validateResult(result,data){
    if(!data.modelF){if(result?.modelF)throw Error('指定していないModelF面の結果です。');return;}
    const s=normalize(data.modelF),expected=JSON.stringify(s);
    for(const r of [result,...(result?.trajectory?[result.trajectory]:[])]){
      if(!r||JSON.stringify(normalize(r.modelF))!==expected||!Array.isArray(r.energies)||r.images?.length!==r.energies.length)throw Error('ModelFの入力条件・結果が一致しません。');
      const c=r.surfaceComponents;
      if(!c||keys.some(k=>!Array.isArray(c[k])||c[k].length!==r.energies.length||!c[k].every(Number.isFinite)))throw Error('ModelFの両状態・上下両面のエネルギーがありません。');
      for(let i=0;i<r.energies.length;i++){
        const got=row(r,i),check=components(got.state1EV,got.state2EV,s);
        if(keys.some(k=>Math.abs(check[k]-got[k])>1e-7)||!Number.isFinite(r.energies[i])||Math.abs(r.energies[i]-check[s.surface+'EV'])>1e-7)throw Error('ModelFの状態エネルギー・カップリング・追跡面の対応が不正です。');
        if(data.solvation)for(const n of [1,2]){const a=got[`state${n}UmaEV`],b=got[`state${n}SolvationEV`];if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(got[`state${n}EV`]-a-b)>1e-7)throw Error('ModelFの各状態のUMA・溶媒補正エネルギーが一致しません。');}
      }
    }
  }
  function attach(state,data,result,i){
    const m=state.metadata;
    delete m.modelF;
    for(const key of ['externalCalculation','afirCalculation'])if(m[key]){delete m[key].modelF;delete m[key].surfaceComponents;}
    if(!data.modelF)return;
    m.modelF=normalize(data.modelF);
    for(const key of ['externalCalculation','afirCalculation'])if(m[key]){m[key].modelF=normalize(data.modelF);if(result?.surfaceComponents)m[key].surfaceComponents=row(result,i);}
  }
  function label(s){return s?`AMF${s.surface==='lower'?'下側':'上側'} · M=${s.multiplicities.join('/')} · α=${s.alphaKJMol} kJ/mol`:'';}
  function csv(result,data){
    validateResult(result,data);const t=result.trajectory||result,s=normalize(data.modelF),extra=Object.keys(t.surfaceComponents).filter(k=>!keys.includes(k));
    const header=['frame','surface','alpha_kJ_mol','multiplicity1','multiplicity2','selected_eV',...keys,...extra];
    return header.join(',')+'\n'+t.energies.map((e,i)=>[i+1,s.surface,s.alphaKJMol,...s.multiplicities,e,...[...keys,...extra].map(k=>t.surfaceComponents[k][i])].join(',')).join('\n')+'\n';
  }
  const api={normalize,validateInput,components,row,validateResult,attach,label,csv,K};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  (global.MoleculeVisualizer=global.MoleculeVisualizer||{}).ModelF=api;
})(typeof window!=='undefined'?window:globalThis);
