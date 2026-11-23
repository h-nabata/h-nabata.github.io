/* Workspace status follows submitted jobs independently of the settings form. */
(function (global) {
  'use strict';
  const MV = global.MoleculeVisualizer;
  const active = new Map();
  const phases = {queued:'待機中', starting:'開始中', running:'実行中', stopping:'中止処理中',
    completed:'完了', finished:'実行終了', partial:'一部未完了', no_resolved_peak:'未収束（経路上の極大を確認できず）', step_limit:'未収束（ステップ上限）', unconnected:'探索点が未接続（ステップ上限）',
    cancelled:'中止', interrupted:'中断', error:'失敗', unknown:'状態不明'};
  const terminal = new Set(['completed', 'finished', 'partial', 'no_resolved_peak', 'step_limit', 'unconnected', 'cancelled', 'interrupted', 'error']);
  let last = null, connection = null, timer = null, listing = null;

  function text(id, value) {
    const node = document.getElementById(id);
    if (node && node.textContent !== value) node.textContent = value;
    return node;
  }
  function render() {
    const records = [...active.values()];
    const priority = {running:0, starting:1, stopping:2, unknown:3};
    const current = records.filter(r => r.status !== 'queued').sort((a,b) => priority[a.status]-priority[b.status]);
    const queued = records.filter(r => r.status === 'queued');
    const describe = r => r.label + ' · ' + phases[r.status];
    const counts = new Map();
    for (const job of queued) counts.set(job.label, (counts.get(job.label) || 0) + 1);
    const groups = [...counts].slice(0,2);
    const queueNames = groups.map(([label,count]) => count === 1 ? label : label + ' ×' + count);
    const remaining = queued.length - groups.reduce((sum, group) => sum + group[1], 0);
    if (remaining) queueNames.push('ほか' + remaining + '件');
    const queueSummary = '待機中 ' + queued.length + '件';
    const primary = current[0] || queued[0] || last;
    const queueOnly = !current.length && queued.length > 1;
    text('activityJobHeading', !records.length && last ? '直近の計算' : '計算状況');
    const headline = queueOnly ? queueSummary : primary ? describe(primary) : '実行中の計算はありません';
    const node = text('activityJobs', headline);
    if (node) node.dataset.state = primary?.status || 'idle';
    // A modal hides the live workspace region. Keep its visible copy short;
    // engineMessage already announces progress inside the dialog.
    const showInDialog = records.length > 0 || primary?.status === 'unknown';
    const phase = queueOnly ? queueNames[0] : primary?.status === 'running' && primary.phaseLabel;
    const panel = text('engineActivityStatus', showInDialog ? ['ジョブ', headline, phase].filter(Boolean).join(' · ') : '');
    if (panel) panel.hidden = !showInDialog;
    text('activityJobDetail', queueOnly ? queueNames.join('、') : primary?.detail || '');
    text('activityConcurrent', current.length > 1 ?
      'ほかに ' + current.slice(1,3).map(describe).join('、') + (current.length > 3 ? ' ほか' + (current.length-3) + '件' : '') : '');
    text('activityQueue', current.length && queued.length ? queueSummary + ' · ' + queueNames.join('、') : '');
    text('activityLast', records.length && last ? '直近 · ' + describe(last) : '');
  }
  function saveRecord(key, record, updatedAt) {
    if (terminal.has(record.status)) {
      active.delete(key);
      if (!last || updatedAt >= last.updatedAt) last = {...record, key, updatedAt};
    } else active.set(key, {...active.get(key), ...record});
  }
  function update(key, label, status, detail = '') {
    if (!Object.hasOwn(phases, status)) return;
    saveRecord(key, {label, status, detail}, Date.now());
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
  function showConnection(reachable) {
    const label = connection ? (reachable ? '接続済み' : '応答未確認') : '未接続';
    const node = text('activityConnection', [label, connection && engineDescription(connection.info)].filter(Boolean).join(' · '));
    if (node) node.dataset.state = connection ? (reachable ? 'connected' : 'unknown') : 'disconnected';
  }
  function pathSCFPhase(progress) {
    if (!['path_step_retry', 'path_step_failed'].includes(progress.phase)) return '';
    const step = Number.isInteger(progress.step) ? 'ステップ' + progress.step + ' · ' : '';
    const count = Number.isInteger(progress.scfStepRetries) ? '（通算' + progress.scfStepRetries + '回）' : '';
    const action = progress.phase === 'path_step_retry' ? 'SCF未収束のため刻み幅を縮めて再試行' : '刻み幅を縮めてもSCF未収束';
    return step + action + count;
  }
  function progressDetail(status, p, result, listStep) {
    if (status === 'queued' || status === 'unknown') return '';
    if (!terminal.has(status) && p.phase === 'loading_model') return 'モデル読込中';
    if (!terminal.has(status) && p.phase === 'vibrations') {
      return Number.isInteger(p.vibrationDone) && Number.isInteger(p.vibrationTotal)
        ? '振動解析 · 力の評価 ' + p.vibrationDone + '/' + p.vibrationTotal : '振動解析中';
    }
    const retry = pathSCFPhase(p);
    if (!terminal.has(status) && retry) return retry;
    const fields = [];
    if (Number.isInteger(result?.scfFailedStep)) fields.push('ステップ'+result.scfFailedStep+'でSCF未収束');
    if (result?.scfStepRetries>0) fields.push('刻み幅を縮めて再試行 '+result.scfStepRetries+'回');
    const step = result?.steps ?? p.step ?? (listStep > 0 ? listStep : null);
    if (Number.isInteger(step)) fields.push(step + 'ステップ');
    if (!terminal.has(status) && p.phase === 'dsafir') {
      if (p.side === 'reactant') fields.push('反応物側を探索');
      if (p.side === 'product') fields.push('生成物側を探索');
    }
    const gap = result?.dsafir?.gap ?? p.gap;
    if (Number.isFinite(gap)) fields.push('探索点間 ' + gap.toFixed(3) + ' Å');
    if (Number.isInteger(p.climbingImage)) fields.push('登坂ノード ' + (p.climbingImage+1));
    if (!terminal.has(status) && p.phase === 'scan' && Number.isInteger(p.scanNode) && Number.isInteger(p.scanTotal)) {
      fields.push('スキャン点 ' + (p.scanNode+1) + '/' + p.scanTotal);
    }
    return fields.join(' · ');
  }
  function recordJob(c, state, mode, detached, context, fromListing = false) {
    if (!connection || c?.info !== connection.info || typeof state?.id !== 'string' || !state.id || !Object.hasOwn(phases, state.status)) return;
    const id = state.id, previous = active.get(id);
    if (listing && !fromListing) listing.changed.add(id);
    if (!fromListing) showConnection(state.status !== 'unknown');
    mode = mode || state.data?.mode || state.mode;
    const label = context || previous?.context || MV.EngineUI?.modeLabel?.(mode) || previous?.label || mode || 'ローカル計算';
    const p = state.progress || {}, reason = state.result?.reason;
    let status = state.status;
    if (status === 'running' && previous?.status === 'stopping') status = 'stopping';
    if (status === 'completed' && reason === 'step_limit') status = state.result?.dsafir ? 'unconnected' : 'step_limit';
    if (status === 'completed' && reason === 'no_resolved_peak') status = reason;
    if (status === 'completed' && reason === 'failed') status = 'error';
    if (status === 'completed' && ['cancelled','interrupted'].includes(reason)) status = reason;
    if (status === 'completed' && (state.result?.vibrations?.status === 'failed' || state.result?.thermochemistry?.status === 'failed')) status = 'partial';
    if (status === 'completed' && fromListing && !state.result) status = 'finished';
    const engine = state.data || !previous ? engineDescription(c.info,state.data) : previous.engine;
    const surface = state.data ? state.data.modelF?.surface : previous?.surface;
    const details = [engine, surface && 'ModelF · ' + surface, progressDetail(status,p,state.result,state.steps)];
    if (status === 'unknown') details.push('履歴・キューで再確認');
    if (status === 'partial') details.push(state.result.vibrations?.status === 'failed' ? '振動解析が未完了' : '熱化学量の計算が未完了');
    if (status === 'error' && state.error) details.push(String(state.error).split('\n')[0].slice(0,100));
    const phaseLabel = status === 'running' && (pathSCFPhase(p) || (p.phase === 'loading_model' ? 'モデル読込中' :
      p.phase === 'dsafir' && p.side === 'reactant' ? '反応物側を探索' :
      p.phase === 'dsafir' && p.side === 'product' ? '生成物側を探索' :
      p.phase === 'vibrations' ? '振動解析中' : Number.isInteger(p.step) ? p.step + 'ステップ' : ''));
    saveRecord(id, {label, status, phaseLabel, detail:details.filter(Boolean).join(' · '), engine, surface,
      detached: detached ?? previous?.detached ?? true, context: context || previous?.context}, state.updatedAt || Date.now());
    if (!fromListing) { render(); schedule(); }
  }
  async function refresh() {
    if (listing || !canList()) return;
    const c = connection, request = {changed:new Set()};
    listing = request;
    try {
      const list = await MV.EngineUI.request(c, '/api/jobs');
      if (connection !== c || !Array.isArray(list.jobs)) return;
      if (!request.changed.size) showConnection(true);
      const ids = new Set(list.jobs.map(s => s.id));
      // The history endpoint supplies job status, not convergence or a path.
      // Show its latest terminal job only when no newer local report is known.
      const recent = list.jobs.filter(s => !s.archived && terminal.has(s.status) && !request.changed.has(s.id) && !active.has(s.id))
        .reduce((best,s) => !best || (s.updatedAt || s.createdAt || 0) > (best.updatedAt || best.createdAt || 0) ? s : best,null);
      if (recent && (!last || (recent.id !== last.key && recent.updatedAt > last.updatedAt))) recordJob(c, recent, recent.mode, true, null, true);
      for (const state of list.jobs) {
        const current = active.get(state.id);
        // Direct job polls and submissions supersede an in-flight history listing.
        if (request.changed.has(state.id) || (current && !current.detached)) continue;
        if (!current && terminal.has(state.status)) continue;
        recordJob(c, state, state.mode, true, null, true);
      }
      for (const [id,record] of active) {
        if (record.detached && !ids.has(id) && !request.changed.has(id)) {
          active.delete(id);
          last = {...record, key:id, updatedAt:Date.now(), status:'unknown', detail:'履歴に見つかりません'};
        }
      }
      render();
    } catch (_) {
      if (connection === c) {
        if (!request.changed.size) showConnection(false);
        for (const [id,record] of active) {
          if (record.detached && !request.changed.has(id)) saveRecord(id,{...record,status:'unknown',detail:'履歴・キューで再確認'},Date.now());
        }
        render();
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
      last = {key, updatedAt:Date.now(), label:r.label, status:'unknown', detail:'エンジン未接続'};
    }
    if (c && typeof last?.key === 'string') last = null;
    connection = c;
    showConnection(!!c);
    render();
    if (canList()) refresh();
  }
  function submitted(c, state, mode) {
    recordJob(c, {...state, status:state.status || 'starting'}, mode, true);
  }
  function pollFailed(j) {
    recordJob(j.connection, {id:j.id,status:'unknown'}, j.data?.mode, true, j.activityLabel);
  }
  MV.Activity = {update, connect, submitted, recordJob, pollFailed, pathSCFPhase,
    showMethod:label => { if (label) text('activityMethod',label); },
    showEditor:label => text('activityEditor',label)};
})(window);
