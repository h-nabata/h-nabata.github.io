/* Server-side history and FIFO queue. Authentication is read from EngineUI only. */
(function(global){
  'use strict';
  const MV=global.MoleculeVisualizer,$=id=>document.getElementById(id);
  const statuses={queued:'待機中',running:'実行中',stopping:'終了処理中',completed:'完了',cancelled:'中止',error:'失敗',interrupted:'中断（サーバー停止）'};
  const modes={evaluate:'エネルギー評価',optimize:'MIN',afir:'AFIR-MIN',cineb:'CI-NEB',neb:'NEB',perpendicular:'経路の直交緩和',ts:'TS',irc:'IRC',scan:'緩和スキャン',vibrations:'振動解析'};
  let refreshing=false,timer=null;
  function message(text){$('jobHistoryMessage').textContent=text;}
  function el(tag,text,cls){const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;}
  async function api(path,body){const c=MV.EngineUI.getConnection();if(!c)throw Error('計算エンジンへ接続してから履歴を開いてください。');if(!c.info.history&&!c.info.persistentHistory)throw Error('接続中のサーバーは計算履歴に対応していません。');return MV.EngineUI.request(c,path,body);}
  function button(text,fn){const b=el('button',text,'mv-btn');b.type='button';b.addEventListener('click',async()=>{b.disabled=true;try{await fn();}catch(e){message(e.message);}finally{b.disabled=false;}});return b;}
  async function saved(id){if(!/^[a-f0-9]{32}$/.test(id))throw Error('計算IDが不正です。');return api('/api/jobs/'+id);}
  async function refresh(){
    if(refreshing)return;refreshing=true;
    try{
      const [list,runtime]=await Promise.all([api('/api/jobs'),api('/api/runtime')]);
      $('jobHistoryStorage').textContent=list.storage?.enabled===false?'ディスク保存は無効です。このサーバーを終了すると履歴は消えます。':list.storage?.directory||runtime.historyPath||'サーバー側の履歴ディレクトリ';
      $('jobRuntimeSummary').textContent=`${runtime.modelLoaded?'モデル常駐中':'常駐モデルなし'} · 実行 ${runtime.runningId?'1':'0'}件 · 待機 ${runtime.queuedCount??0}件`+(runtime.reusedJobs!=null?` · モデル再利用 ${runtime.reusedJobs}回`:'');
      $('jobRuntimeUnload').disabled=!!runtime.runningId||!!runtime.queuedCount||!runtime.modelLoaded;
      if(list.storage?.error||runtime.storageError)message(list.storage?.error||runtime.storageError);
      const rows=$('jobHistoryRows');rows.replaceChildren();
      for(const j of list.jobs||[]){if(j.archived&&!$('jobHistoryArchived').checked)continue;const tr=el('tr');tr.dataset.jobId=j.id;
        const date=j.createdAt?new Date(j.createdAt).toLocaleString():j.id.slice(0,8);tr.append(el('td',date),el('td',(modes[j.mode]||j.mode||'計算')+(j.parentId?' · 再開':'')),el('td',(statuses[j.status]||j.status)+(j.archived?' · アーカイブ':'')));
        const actions=el('td'),active=['queued','running','stopping'].includes(j.status);
        if(active){actions.append(button('進捗を追跡',async()=>{if(MV.EngineUI.isBusy())throw Error('現在追跡中の計算が終了してから選択してください。');const full=await saved(j.id);$('jobHistoryDialog').close();$('engineDialog').close();MV.EngineUI.watchSaved(full);}),button('中止',async()=>{await api(`/api/jobs/${j.id}/cancel`,{});await refresh();}));}
        else{actions.append(button('結果を開く',async()=>MV.EngineUI.restoreJob(await saved(j.id))));actions.append(button('入力を復元',async()=>MV.EngineUI.restoreJob(await saved(j.id),true)));
          actions.append(button(j.resumeKind==='scan_remaining'?'未完了のスキャンを再開':j.resumeKind==='restart'||['irc','vibrations'].includes(j.mode)?'保存条件で再実行':'保存構造から再開',async()=>{const resumed=await api(`/api/jobs/${j.id}/resume`,{});message(`計算${resumed.id.slice(0,8)}をキューへ追加しました。保存済みの元の結果も保持します。`);await refresh();}));
          actions.append(button(j.archived?'一覧へ戻す':'アーカイブ',async()=>{await api(`/api/jobs/${j.id}/archive`,{archived:!j.archived});await refresh();}));
          if(j.archived)actions.append(button('完全に削除',async()=>{if(!global.confirm('この計算の入力・結果・履歴をローカル保存先から完全に削除します。よろしいですか？'))return;await api(`/api/jobs/${j.id}/delete`,{});await refresh();}));
        }
        tr.append(actions);rows.append(tr);
      }
      if(!rows.children.length){const tr=el('tr'),td=el('td','保存された計算はありません。');td.colSpan=4;tr.append(td);rows.append(tr);}
    }catch(e){message(e.message);}finally{refreshing=false;}
  }
  async function open(){if($('engineDialog').open)$('engineDialog').close();$('jobHistoryDialog').showModal();message('');await refresh();clearInterval(timer);timer=setInterval(()=>{if($('jobHistoryDialog').open)refresh();else{clearInterval(timer);timer=null;}},3000);}
  function changed(){if($('jobHistoryDialog').open)refresh();}
  function connected(){const info=MV.EngineUI.getConnection()?.info;$('engineHistory').disabled=!(info?.history||info?.persistentHistory);}
  function init(){$('btnJobHistory').onclick=open;$('engineHistory').onclick=open;$('jobHistoryRefresh').onclick=refresh;$('jobHistoryArchived').onchange=refresh;$('jobRuntimeUnload').onclick=async()=>{try{await api('/api/runtime/unload',{});message('常駐モデルを解放しました。次の計算時に再読み込みします。');await refresh();}catch(e){message(e.message);}};connected();}
  MV.JobHistoryUI={init,open,refresh,changed,connected};
})(window);
