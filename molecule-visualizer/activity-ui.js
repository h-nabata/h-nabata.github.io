/* Workspace status follows submitted jobs independently of the settings form. */
(function (global) {
  'use strict';
  const MV = global.MoleculeVisualizer;
  const active = new Map();
  const phases = {queued:'待機中', starting:'開始中', running:'実行中', stopping:'中止処理中',
    completed:'完了', no_resolved_peak:'未収束（経路上の極大を確認できず）', step_limit:'未収束（ステップ上限）', unconnected:'探索点が未接続（ステップ上限）',
    cancelled:'中止', interrupted:'中断', error:'失敗', unknown:'状態不明'};
  const terminal = new Set(['completed', 'no_resolved_peak', 'step_limit', 'unconnected', 'cancelled', 'interrupted', 'error']);
  let last = null, connection = null, timer = null, listing = null;

  function text(id, value) {
    const node = document.getElementById(id);
    if (node && node.textContent !== value) node.textContent = value;
    return node;
  }
  function render() {
    const records = [...active.values()];
    const current = records.filter(r => r.status !== 'queued');
    const queued = records.filter(r => r.status === 'queued');
    const describe = r => [r.label, phases[r.status], r.detail].filter(Boolean).join(' · ');
    const lines = current.map(describe);
    if (queued.length === 1) lines.push(describe(queued[0]));
    if (queued.length > 1) lines.push('待機中 ' + queued.length + '件（' + queued.slice(0,2).map(r => r.label).join('、') + (queued.length > 2 ? 'ほか' : '') + '）');
    if (!lines.length && last) lines.push('直近 · ' + describe(last));
    const node = text('activityJobs', lines.join('\n') || '実行中の計算はありません');
    if (node) node.dataset.state = (current[0] || queued[0] || last)?.status || 'idle';
  }
  function update(key, label, status, detail = '') {
    if (!Object.hasOwn(phases, status)) return;
    const record = {label, status, detail};
    if (terminal.has(status)) {
      active.delete(key);
      last = record;
    } else active.set(key, {...active.get(key), ...record});
    render();
  }
  function canList() { return connection?.info.history || connection?.info.persistentHistory; }
  function schedule() {
    if (!canList() || timer || listing || ![...active.values()].some(r => r.detached)) return;
    timer = setTimeout(() => { timer = null; refresh(); }, 3500);
  }
  function engineDescription(info, data) {
    if (info.engine === 'llmlip') {
      const model = data?.llmlip;
      return ['llmlip.rs',model?.model,model?.head].filter(Boolean).join(' / ');
    }
    if (info.engine === 'uma') {
      const solvent = data?.solvation;
      return ['UMA', info.uma?.model, solvent && 'AnySolv · ' + solvent.solvent].filter(Boolean).join(' / ');
    }
    return info.engine === 'tblite' ? [info.engine, info.method].filter(Boolean).join(' / ') : info.method || info.engine;
  }
  function recordJob(c, state, mode, detached, context) {
    if (!connection || c?.info !== connection.info || typeof state?.id !== 'string' || !state.id || !Object.hasOwn(phases, state.status)) return;
    const id = state.id, previous = active.get(id);
    if (listing) listing.changed.add(id);
    mode = mode || state.data?.mode || state.mode;
    const label = context || previous?.context || MV.EngineUI?.modeLabel?.(mode) || previous?.label || mode || 'ローカル計算';
    const p = state.progress || {}, reason = state.result?.reason;
    let status = state.status;
    if (status === 'running' && previous?.status === 'stopping') status = 'stopping';
    if (status === 'completed' && reason === 'step_limit') status = state.result?.dsafir ? 'unconnected' : 'step_limit';
    if (status === 'completed' && reason === 'no_resolved_peak') status = reason;
    if (status === 'completed' && reason === 'failed') status = 'error';
    const engine = state.data || !previous ? engineDescription(c.info,state.data) : previous.engine;
    const surface = state.data ? state.data.modelF?.surface : previous?.surface;
    const details = [engine, surface && 'ModelF · ' + surface];
    if (p.phase === 'loading_model') details.push('モデル読込中');
    else if (p.phase === 'vibrations') details.push('振動解析 ' + (p.vibrationDone ?? 0) + '/' + (p.vibrationTotal ?? '?'));
    else {
      const step = p.step ?? state.result?.steps ?? state.steps;
      if (Number.isInteger(step)) details.push(step + 'ステップ');
    }
    const gap = p.gap ?? state.result?.dsafir?.gap;
    if (Number.isFinite(gap)) details.push('探索点間 ' + gap.toFixed(3) + ' Å');
    if (status === 'unknown') details.push('履歴・キューで再確認');
    update(id, label, status, details.filter(Boolean).join(' · '));
    if (active.has(id)) Object.assign(active.get(id), {engine, surface, detached: detached ?? previous?.detached ?? true, context: context || previous?.context});
    schedule();
  }
  async function refresh() {
    if (listing || !canList()) return;
    const c = connection, request = {changed:new Set()};
    listing = request;
    try {
      const list = await MV.EngineUI.request(c, '/api/jobs');
      if (connection !== c || !Array.isArray(list.jobs)) return;
      const ids = new Set(list.jobs.map(s => s.id));
      for (const state of list.jobs) {
        const current = active.get(state.id);
        // Direct job polls and submissions supersede an in-flight history listing.
        if (request.changed.has(state.id) || (current && !current.detached)) continue;
        if (!current && terminal.has(state.status)) continue;
        recordJob(c, state, state.mode, true);
      }
      for (const [id,record] of active) {
        if (record.detached && !ids.has(id) && !request.changed.has(id)) {
          active.delete(id);
          last = {...record, status:'unknown', detail:'履歴に見つかりません'};
        }
      }
      render();
    } catch (_) {
      if (connection === c) for (const [id,record] of active) {
        if (record.detached && !request.changed.has(id)) update(id, record.label, 'unknown', '履歴・キューで再確認');
      }
    } finally {
      if (listing === request) listing = null;
      schedule();
    }
  }
  function connect(c) {
    if (connection === c) return;
    clearTimeout(timer); timer = null; listing = null;
    for (const [key,r] of active) if (typeof key === 'string') {
      active.delete(key);
      last = {label:r.label, status:'unknown', detail:'エンジン未接続'};
    }
    connection = c;
    render();
    if (canList()) refresh();
  }
  function submitted(c, state, mode) {
    recordJob(c, {...state, status:state.status || 'starting'}, mode, true);
  }
  function pollFailed(j) {
    recordJob(j.connection, {id:j.id,status:'unknown'}, j.data?.mode, true, j.activityLabel);
  }
  MV.Activity = {update, connect, submitted, recordJob, pollFailed,
    showMethod:label => { if (label) text('activityMethod',label); },
    showEditor:label => text('activityEditor',label)};
})(window);
