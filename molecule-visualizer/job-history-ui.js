/* Server-side jobs; the active bridge owns both the queue and saved results. */
(function (global) {
  'use strict';
  const MV = global.MoleculeVisualizer, $ = id => document.getElementById(id);
  const statuses = {queued:'待機中', running:'実行中', stopping:'中止処理中', completed:'実行完了', cancelled:'中止', error:'失敗', interrupted:'中断'};
  const active = status => ['queued','running','stopping'].includes(status);
  let jobs = [], timer = null, session = 0, refreshing = null, lastInfo = null;
  const message = value => { $('jobHistoryMessage').textContent = value; };
  function el(tag, value, cls) {
    const node = document.createElement(tag);
    if (value != null) node.textContent = value;
    if (cls) node.className = cls;
    return node;
  }
  function api(path, body) {
    const c = MV.EngineUI.getConnection();
    if (!c || c.info !== lastInfo) throw Error('計算エンジンへの接続を確認してください。');
    return MV.EngineUI.request(c, path, body);
  }
  function action(label, run) {
    const b = el('button', label, 'mv-btn');
    b.type = 'button';
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await run(); } catch (e) { message(e.message); } finally { b.disabled = false; }
    });
    return b;
  }
  function saved(id) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw Error('計算IDが不正です。');
    return api('/api/jobs/' + id);
  }
  function makeRow(j) {
    const tr = el('tr'), info = el('td', MV.EngineUI.modeLabel(j.mode) || j.mode || '計算');
    tr.dataset.jobId = j.id;
    const date = j.createdAt ? new Date(j.createdAt).toLocaleString() : j.id.slice(0,8);
    info.append(el('small', [date, j.parentId && '再開', j.archived && 'アーカイブ'].filter(Boolean).join(' · ')));
    const state = el('td'), badge = el('span', statuses[j.status] || j.status, 'job-state');
    if (active(j.status)) badge.classList.add('job-active');
    if (['error','interrupted'].includes(j.status)) badge.classList.add('job-error');
    state.append(badge);
    const cell = el('td'), group = el('div', null, 'job-actions');
    if (active(j.status)) {
      group.append(action('進捗を追跡', async () => {
        if (MV.EngineUI.revealTrackedProgress(j.id)) return;
        const selection = session, full = await saved(j.id);
        if (selection !== session || !$('jobHistoryDialog').open) return;
        await MV.EngineUI.watchSaved(full);
      }), action('中止', async () => { await api('/api/jobs/'+j.id+'/cancel', {}); await refresh(); }));
    } else {
      if (j.hasResult !== false) group.append(action('結果を開く', async () => MV.EngineUI.restoreJob(await saved(j.id))));
      group.append(action('入力を復元', async () => MV.EngineUI.restoreJob(await saved(j.id), true)));
      const more = el('details', null, 'job-more');
      more.append(el('summary','再開・履歴の管理'));
      const label = j.resumeKind === 'optimizer_state' ? '最適化状態から継続' : j.resumeKind === 'scan_remaining' ? '未完了のスキャンを再開' :
        j.resumeKind === 'restart' || ['irc','vibrations','dsafir'].includes(j.mode) ? '保存条件で再実行' : '保存構造から再開';
      if (j.resumable !== false) more.append(action(label, async () => {
        const resumed = await api('/api/jobs/'+j.id+'/resume', {});
        message('計算'+resumed.id.slice(0,8)+'をキューへ追加しました。');
        await refresh();
      }));
      more.append(action(j.archived ? '一覧へ戻す' : 'アーカイブ', async () => {
        await api('/api/jobs/'+j.id+'/archive', {archived:!j.archived}); await refresh();
      }));
      if (j.archived) more.append(action('完全に削除', async () => {
        if (!global.confirm('この計算の入力・結果・履歴をローカル保存先から完全に削除します。よろしいですか？')) return;
        await api('/api/jobs/'+j.id+'/delete', {}); await refresh();
      }));
      group.append(more);
    }
    cell.append(group); tr.append(info,state,cell);
    return tr;
  }
  function render() {
    const body = $('jobHistoryRows'), filter = $('jobHistoryFilter').value;
    const list = jobs.filter(j => (!j.archived || $('jobHistoryArchived').checked) &&
      (filter === 'all' || (filter === 'active') === active(j.status)));
    // The server sorts by creation date. Keep the running job and its queue above history.
    const rank = j => !active(j.status) ? 2 : j.status === 'queued' ? 1 : 0;
    list.sort((a,b) => rank(a)-rank(b) || (a.status === 'queued' && b.status === 'queued' ? String(a.createdAt).localeCompare(String(b.createdAt)) : 0));
    const existing = new Map([...body.children].map(row => [row.dataset.jobId,row]));
    list.forEach((j,i) => {
      const signature = JSON.stringify([j.mode,j.status,j.archived,j.hasResult,j.resumeKind,j.resumable,j.parentId,j.createdAt]);
      let row = existing.get(j.id);
      if (row?.dataset.signature !== signature) {
        const fresh = makeRow(j);
        fresh.dataset.signature = signature;
        if (row) row.replaceWith(fresh);
        row = fresh;
      }
      if (body.children[i] !== row) body.insertBefore(row,body.children[i] || null);
      existing.delete(j.id);
    });
    for (const row of existing.values()) row.remove();
    if (!list.length) {
      const tr = el('tr'), cell = el('td', jobs.length ? '条件に一致する計算はありません。' : 'この接続には計算履歴がありません。');
      cell.colSpan = 3; tr.append(cell); body.append(tr);
    }
  }
  function connected() {
    const c = MV.EngineUI.getConnection(), supported = !!(c?.info.history || c?.info.persistentHistory);
    $('engineHistory').disabled = !supported;
    $('jobHistoryConnect').hidden = supported;
    $('jobHistoryContent').hidden = !supported;
    if (!supported) $('jobHistoryConnectionHelp').textContent = c ? '接続中のエンジンは履歴に対応していません。bridge.pyを更新して再接続してください。' : '履歴は計算を実行したPCに保存されています。ローカルエンジンに接続すると、そのPCのジョブを確認できます。';
    if (lastInfo !== (c?.info || null)) {
      lastInfo = c?.info || null; session++; refreshing = null; jobs = [];
      $('jobHistoryRows').replaceChildren();
      $('jobRuntimeSummary').textContent = ''; $('jobHistoryStorage').textContent = '';
      $('jobRuntimeUnload').disabled = true;
    }
    return supported;
  }
  async function refresh() {
    if (!connected()) return;
    if (refreshing) return refreshing;
    const token = session;
    refreshing = (async () => {
      try {
        const [list,runtime] = await Promise.all([api('/api/jobs'),api('/api/runtime')]);
        if (token !== session || lastInfo !== MV.EngineUI.getConnection()?.info) return;
        jobs = list.jobs || []; render();
        $('jobHistoryStorage').textContent = list.storage?.enabled === false ? 'ディスク保存は無効です。サーバーを終了すると履歴は消えます。' : list.storage?.directory || runtime.historyPath || 'サーバーの履歴ディレクトリ';
        $('jobRuntimeSummary').textContent = (runtime.modelLoaded ? 'モデル常駐中' : '常駐モデルなし') + ' · 実行 '+(runtime.runningId ? 1 : 0)+'件 · 待機 '+(runtime.queuedCount ?? 0)+'件' +
          (runtime.reusedJobs != null ? ' · モデル再利用 '+runtime.reusedJobs+'回' : '');
        $('jobRuntimeUnload').disabled = !!runtime.runningId || !!runtime.queuedCount || !runtime.modelLoaded;
        if (list.storage?.error || runtime.storageError) message(list.storage?.error || runtime.storageError);
      } catch (e) { if (token === session) message(e.message); }
      finally { if (token === session) refreshing = null; }
    })();
    return refreshing;
  }
  function open() {
    if ($('engineDialog').open) $('engineDialog').close();
    const dialog = $('jobHistoryDialog');
    if (!dialog.open) dialog.showModal();
    message('');
    if (connected()) refresh();
    clearInterval(timer); timer = setInterval(refresh, 3000);
  }
  function changed() { if ($('jobHistoryDialog').open) refresh(); }
  function init() {
    $('btnJobHistory').onclick = open; $('engineHistory').onclick = open;
    $('jobHistoryRefresh').onclick = refresh; $('jobHistoryArchived').onchange = render; $('jobHistoryFilter').onchange = render;
    $('jobHistoryDialog').addEventListener('close', () => { clearInterval(timer); timer = null; session++; refreshing = null; });
    $('jobOpenConnection').onclick = () => {
      $('jobHistoryDialog').close(); MV.EngineUI.showSettings(); MV.CalculationPanel.show('connection',true);
    };
    $('jobRuntimeUnload').onclick = async () => {
      try { await api('/api/runtime/unload', {}); message('常駐モデルを解放しました。次の計算時に再読み込みします。'); await refresh(); }
      catch (e) { message(e.message); }
    };
    connected();
  }
  MV.JobHistoryUI = {init, open, refresh, changed, connected};
})(window);
