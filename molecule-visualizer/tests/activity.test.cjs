const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function workspace(request) {
  const nodes = new Map(), timers = new Map();
  let next = 0;
  function element(id) {
    if (!nodes.has(id)) nodes.set(id, {textContent:'',dataset:{}});
    return nodes.get(id);
  }
  const MV = {EngineUI:{request, modeLabel:mode=>({dsafir:'DS-AFIR',optimize:'MIN',afir:'AFIR-MIN'})[mode]}};
  const context = {window:{MoleculeVisualizer:MV}, document:{getElementById:element},
    setTimeout:fn=>{timers.set(++next,fn);return next;}, clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../activity-ui.js'),'utf8'), context);
  async function tick() {
    const entry = [...timers][0];
    assert.ok(entry,'expected a scheduled refresh');
    timers.delete(entry[0]);entry[1]();
    await new Promise(resolve=>setImmediate(resolve));
  }
  return {activity:MV.Activity, state:()=>element('activityJobs').dataset.state,
    output:(id='activityJobs')=>element(id).textContent, timers, tick};
}

test('changing editing tools or draft calculation leaves the executed method, engine, gap and queue intact', () => {
  const {activity,output,state} = workspace();
  const c = {info:{engine:'tblite',method:'GFN2-xTB'}};
  activity.connect(c);
  activity.submitted(c,{id:'one',status:'running'},'dsafir');
  activity.submitted(c,{id:'two',status:'queued'},'afir');
  activity.recordJob({...c},{id:'one',status:'running',progress:{phase:'dsafir',side:'reactant',step:8,gap:.23456}},'dsafir',false);
  activity.showMethod('MIN');
  activity.showEditor('原子移動モード');
  assert.equal(output('activityEditor'),'原子移動モード');
  assert.equal(output('activityMethod'),'MIN');
  assert.equal(output(),'DS-AFIR · 実行中');
  assert.equal(output('activityJobDetail'),'tblite / GFN2-xTB · 8ステップ · 反応物側を探索 · 探索点間 0.235 Å');
  assert.match(output('activityQueue'),/待機中 1件 · AFIR-MIN/);
  assert.equal(output('activityConnection'),'接続済み · tblite / GFN2-xTB');
  activity.recordJob(c,{id:'two',status:'cancelled'});
  assert.equal(output('activityLast'),'直近 · AFIR-MIN · 中止');
  activity.recordJob(c,{id:'one',status:'completed',result:{reason:'step_limit',steps:9,dsafir:{connected:false,gap:.234}}},'dsafir',false);
  assert.equal(state(),'unconnected');
  assert.equal(output('activityJobHeading'),'直近の計算');
  assert.match(output(),/DS-AFIR · 探索点が未接続/);
});

test('local and server work can overlap, and disconnecting does not stop or relabel the local worker', () => {
  const {activity,output,state} = workspace();
  const c = {info:{engine:'uma'}}, worker = {};
  activity.connect(c);
  activity.update(worker,'配座生成','running','32%');
  activity.recordJob(c,{id:'one',mode:'optimize',status:'running'},null,false,'一括最適化 · 入力 2/3');
  activity.recordJob(c,{id:'one',status:'stopping'});
  activity.recordJob(c,{id:'one',status:'running'},'optimize',false);
  assert.match(output('activityConcurrent'),/一括最適化 · 入力 2\/3 · 中止処理中/);
  activity.connect(null);
  activity.recordJob(c,{id:'one',status:'error'});
  assert.equal(output(),'配座生成 · 実行中');
  assert.equal(output('activityJobDetail'),'32%');
  assert.equal(output('activityConnection'),'未接続');
  activity.update(worker,'配座生成','error','時間上限');
  assert.equal(state(),'error');
  assert.equal(output(),'配座生成 · 失敗');
  assert.equal(output('activityJobDetail'),'時間上限');
});

test('a delayed history listing cannot resurrect a job that started and finished while the request was in flight', async () => {
  let deliver;
  const {activity,output,timers} = workspace(()=>new Promise(resolve=>{deliver=resolve;}));
  const c = {info:{history:true}};
  activity.connect(c);
  activity.submitted(c,{id:'one',status:'running'},'dsafir');
  activity.recordJob(c,{id:'one',status:'completed'},'dsafir',false);
  deliver({jobs:[{id:'one',status:'running',mode:'dsafir'}]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(output(),'DS-AFIR · 完了');
  assert.equal(timers.size,0);
});

test('history tracks recovered queued jobs through transport errors, resumed running and terminal state', async () => {
  let index = 0;
  const states = [{jobs:[{id:'one',mode:'optimize',status:'queued'}]}, Error('offline'),
    {jobs:[{id:'one',mode:'optimize',status:'running',steps:2}]},
    {jobs:[{id:'one',mode:'optimize',status:'error'}]}];
  const {activity,output,timers,tick,state} = workspace(async()=>{
    const next = states[index++];
    if (next instanceof Error) throw next;
    return next;
  });
  const c = {info:{history:true}};
  activity.connect(c);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state(),'queued');
  await tick();
  assert.equal(state(),'unknown');
  assert.equal(output('activityConnection'),'応答未確認');
  await tick();
  assert.equal(output(),'MIN · 実行中');
  assert.equal(output('activityJobDetail'),'2ステップ');
  assert.equal(output('activityConnection'),'接続済み');
  await tick();
  assert.equal(state(),'error');
  assert.equal(timers.size,0);
});

test('a long waiting list stays compact and the most recent unarchived outcome remains visible', async () => {
  const rows = Array.from({length:9},(_,i)=>({id:'q'+i,mode:'optimize',status:'queued',steps:0}));
  const {activity,output} = workspace(async()=>({jobs:[...rows,
    {id:'old',mode:'dsafir',status:'completed',updatedAt:10},
    {id:'recent',mode:'afir',status:'error',updatedAt:20},
    {id:'archived',mode:'dsafir',status:'completed',updatedAt:30,archived:true}]}));
  const c = {info:{history:true}};
  activity.connect(c);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(output(),'待機中 9件');
  assert.equal(output('activityJobDetail'),'MIN ×9');
  assert.equal(output('activityLast'),'直近 · AFIR-MIN · 失敗');
  activity.recordJob(c,{id:'q0',status:'running',progress:{phase:'vibrations'}},'vibrations',false);
  assert.equal(output('activityJobDetail'),'振動解析中');
  assert.match(output('activityQueue'),/待機中 8件/);
  activity.recordJob(c,{id:'q0',status:'running',progress:{phase:'vibrations',vibrationDone:3,vibrationTotal:18}},'vibrations',false);
  assert.equal(output('activityJobDetail'),'振動解析 · 力の評価 3/18');
});

test('history completion and a partially failed analysis do not imply successful convergence', async () => {
  const c = {info:{history:true,engine:'tblite',method:'GFN2-xTB'}};
  const {activity,output,state} = workspace(async()=>({jobs:[{id:'old',mode:'dsafir',status:'completed'}]}));
  activity.connect(c);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(output(),'DS-AFIR · 実行終了');
  activity.recordJob(c,{id:'new',mode:'optimize',status:'completed',result:{reason:'converged',
    steps:37,vibrations:{status:'failed'}}});
  assert.equal(state(),'partial');
  assert.match(output('activityJobDetail'),/37ステップ · 振動解析が未完了/);
});
