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
  activity.recordJob({...c},{id:'one',status:'running',progress:{step:8,gap:.23456}},'dsafir',false);
  activity.showMethod('MIN');
  activity.showEditor('原子移動モード');
  assert.equal(output('activityEditor'),'原子移動モード');
  assert.equal(output('activityMethod'),'MIN');
  assert.match(output(),/DS-AFIR · 実行中 · tblite \/ GFN2-xTB · 8ステップ · 探索点間 0.235 Å/);
  assert.match(output(),/AFIR-MIN · 待機中/);
  activity.recordJob(c,{id:'two',status:'cancelled'});
  activity.recordJob(c,{id:'one',status:'completed',result:{reason:'step_limit',steps:9,dsafir:{connected:false,gap:.234}}},'dsafir',false);
  assert.equal(state(),'unconnected');
  assert.match(output(),/直近 · DS-AFIR · 探索点が未接続/);
});

test('local and server work can overlap, and disconnecting does not stop or relabel the local worker', () => {
  const {activity,output,state} = workspace();
  const c = {info:{engine:'uma'}}, worker = {};
  activity.connect(c);
  activity.update(worker,'配座生成','running','32%');
  activity.recordJob(c,{id:'one',mode:'optimize',status:'running'},null,false,'一括最適化 · 入力 2/3');
  activity.recordJob(c,{id:'one',status:'stopping'});
  activity.recordJob(c,{id:'one',status:'running'},'optimize',false);
  assert.match(output(),/一括最適化 · 入力 2\/3 · 中止処理中/);
  activity.connect(null);
  activity.recordJob(c,{id:'one',status:'error'});
  assert.equal(output(),'配座生成 · 実行中 · 32%');
  activity.update(worker,'配座生成','error','時間上限');
  assert.equal(state(),'error');
  assert.equal(output(),'直近 · 配座生成 · 失敗 · 時間上限');
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
  assert.match(output(),/直近 · DS-AFIR · 完了/);
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
  await tick();
  assert.match(output(),/MIN · 実行中 · 2ステップ/);
  await tick();
  assert.equal(state(),'error');
  assert.equal(timers.size,0);
});
