/* Personal reports always scope by the current author before project/date filters. */
function myEntries(applyStatus=false) {
  return entries.filter(e=>e.userId===user()&&visible(project(task(e.taskId)?.projectId)))
    .filter(e=>within(e)&&(state.myProject==='all'||task(e.taskId).projectId===Number(state.myProject)))
    .filter(e=>!applyStatus||state.myStatus==='all'||e.status===state.myStatus);
}
function myProjectRows() {
  const rows=myEntries().filter(e=>['approved','pending'].includes(e.status));
  return visibleProjects().map(p=>{const es=rows.filter(e=>task(e.taskId).projectId===p.id);return {p,a:sum(es.filter(e=>e.status==='approved')),n:sum(es.filter(e=>e.status==='pending')),count:new Set(es.map(e=>e.taskId)).size};}).filter(r=>r.count).sort((a,b)=>b.a+b.n-a.a-a.n);
}
function personalProjectFilter() {
  return `<label class="personal-project-filter">项目<select id="my-project" class="control"><option value="all">全部企业项目</option>${visibleProjects().map(p=>`<option value="${p.id}" ${String(p.id)===state.myProject?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>`;
}
function ledgerView() {
  if(!['records','stats'].includes(state.myTab))state.myTab='stats';
  if(state.myProject!=='all'&&!visible(project(state.myProject)))state.myProject='all';
  return `${heading('','我的工时','查看我在各企业项目中的投入与确认进度',button('export','导出明细','download')+button('log','记录工时','plus',true))}
    <div class="personal-heading-note">${avatar(user())}<span>${person(user()).name}</span><span class="personal-scope">仅本人记录 · 不含个人项目</span></div>
    <div class="project-tabs personal-tabs" role="tablist" aria-label="我的工时内容">${[['records','工时记录','list'],['stats','工时统计','chart-no-axes-combined']].map(([key,label,glyph])=>`<button role="tab" id="my-tab-${key}" aria-controls="my-tabpanel" aria-selected="${state.myTab===key}" tabindex="${state.myTab===key?0:-1}" class="${state.myTab===key?'active':''}" data-my-tab="${key}">${icon(glyph)}${label}</button>`).join('')}</div>
    <section class="panel personal-panel" id="my-tabpanel" role="tabpanel" aria-labelledby="my-tab-${state.myTab}" tabindex="0">
      <div class="personal-toolbar">${personalProjectFilter()}${periodToolbar()}</div>
      ${state.myTab==='stats'?personalStats():personalRecords()}
    </section>`;
}
function personalStats() {
  const rows=myEntries(),a=sum(rows.filter(e=>e.status==='approved')),n=sum(rows.filter(e=>e.status==='pending')),projects=myProjectRows(),total=a+n;
  return `<div class="metrics personal-metrics">${[['本周期已记录',h(total),'小时','已确认与未确认之和',''],['已确认',h(a),'小时','任务创建人已验收',''],['未确认',h(n),'小时','随任务验收统一确认','amber-text'],['参与项目',projects.length,'个',new Set(rows.filter(e=>['approved','pending'].includes(e.status)).map(e=>e.taskId)).size+' 项有投入的任务','']].map(([label,value,unit,note,color])=>`<section class="metric"><div class="metric-label">${label}</div><div class="metric-value"><b class="${color}">${value}</b><span>${unit}</span></div><p>${note}</p></section>`).join('')}</div>
    <div class="stats-grid personal-charts"><section><div class="section-heading"><div><h2>我的投入趋势</h2><p>${state.period==='week'?'按工作日期每日汇总':'按自然月汇总，每段为连续 7 日'}</p></div>${legend()}</div><div data-chart="" data-personal-chart>${chart(null,true)}</div></section>
    <section><div class="section-heading"><div><h2>项目分布</h2><p>按我的已记录工时占比</p></div><small>${projects.length} 个项目</small></div>${projects.map(({p,a,n})=>`<button class="personal-allocation" data-my-drill="${p.id}"><span class="line"><span>${esc(p.name)}</span><b class="number">${h(a+n)}<small> h</small></b></span><span class="bar"><span class="approved" style="width:${total?a/total*100:0}%"></span><span class="pending" style="width:${total?n/total*100:0}%"></span></span><span class="allocation-caption"><span>${Math.round((a+n)/total*100)}% 的个人投入</span><span>查看记录 ${icon('arrow-right')}</span></span></button>`).join('')||'<div class="empty">本周期暂无项目投入</div>'}</section></div>
    <div class="section-heading personal-detail-heading"><div><h2>我的项目投入</h2><p>点击项目查看本人记录，所有数值随周期与项目筛选同步</p></div><small>单位：小时</small></div>
    <div class="table-wrap task-table-desktop"><table><thead><tr><th>项目</th><th class="num">参与任务</th><th class="num">已确认</th><th class="num">未确认</th><th class="num">已记录</th><th class="num">个人投入占比</th></tr></thead><tbody>${projects.map(({p,a,n,count})=>`<tr><td><button class="text-btn personal-project-link" data-my-drill="${p.id}">${esc(p.name)} ${icon('arrow-up-right')}</button><p>${esc(p.tag)}</p></td><td class="num number">${count}</td><td class="num number">${h(a)}</td><td class="num number amber-text">${h(n)}</td><td class="num number">${h(a+n)}</td><td class="num number">${Math.round((a+n)/total*100)}%</td></tr>`).join('')}</tbody></table></div>
    <div class="personal-project-cards">${projects.map(({p,a,n,count})=>`<button class="personal-project-card" data-my-drill="${p.id}"><span class="line"><strong>${esc(p.name)}</strong>${icon('arrow-up-right')}</span><small>${count} 项任务 · 占个人投入 ${Math.round((a+n)/total*100)}%</small><span class="numbers"><span><small>已确认</small>${h(a)}h</span><span class="amber-text"><small>未确认</small>${h(n)}h</span><span><small>已记录</small>${h(a+n)}h</span></span></button>`).join('')}</div>
    ${projects.length?'':'<div class="empty">本周期还没有我的工时<p>可切换周期，或记录一笔新的投入。</p></div>'}<div class="list-caption"><span>仅统计 ${person(user()).name} 的投入，不包含其他成员</span><span>已退回与已作废记录不计入投入</span></div>`;
}
function personalRecords() {
  const rows=myEntries(true).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
  return `<div class="personal-record-heading"><div><h2>投入记录 <small>${rows.length} 条</small></h2><p>先记录投入，完成后在任务中提交验收</p></div><select id="my-status" class="control" aria-label="工时确认状态">${[['all','全部确认状态'],['pending','未确认'],['approved','已确认']].map(([key,label])=>`<option value="${key}" ${state.myStatus===key?'selected':''}>${label}</option>`).join('')}</select></div>
    ${rows.map(e=>`<article class="personal-entry"><div><small>${e.date} · ${esc(project(task(e.taskId).projectId).name)}</small><button class="text-btn" data-task="${e.taskId}">${esc(task(e.taskId).title)} <span class="record-task-id">#${e.taskId}</span></button><p>${esc(e.note)}</p></div><div><b class="number">${h(e.minutes)}h</b>${badge(e.status)}${entryActions(e)}</div></article>`).join('')||'<div class="empty">没有符合条件的本人记录<p>调整筛选条件，或点击右上角记录工时。</p></div>'}
    <div class="list-caption"><span>仅本人记录 · 修改不会自动提交验收</span><span>共 ${rows.length} 条</span></div>`;
}
function logForm(taskId=null,editId=null) {
  const original=entries.find(e=>e.id===editId),selectedTask=task(original?.taskId||taskId),pid=selectedTask?.projectId||'';
  if(original&&(original.userId!==user()||!['pending','returned'].includes(original.status)||!canLog(selectedTask)))return toast('当前记录不可修改');
  if(taskId&&!canLog(selectedTask))return toast('当前任务不可填报');
  modal(original?'修改工时记录':'记录工时',original?'保留原项目与任务，修改本次投入':'先选择企业项目，再选择你负责的进行中任务',`
    ${field('log-project','所属项目 <em>*</em>',`<select id="log-project" name="project" ${original?'disabled':''}><option value="">请选择项目</option>${visibleProjects().map(p=>`<option value="${p.id}" ${p.id===pid?'selected':''}>${esc(p.name)}</option>`).join('')}</select>`)}
    ${field('log-task','关联任务 <em>*</em>','<select id="log-task" name="task" disabled><option value="">请先选择项目</option></select>','只显示当前项目中由你负责、可填报的进行中任务。')}
    <div id="log-project-hint" class="cascade-hint" aria-live="polite"></div>
    <div class="field-row">${field('log-date','工作日期 <em>*</em>',`<input id="log-date" name="date" type="date" min="2026-09-01" max="${TODAY}" value="${original?.date||TODAY}">`)}${field('log-hours','本次投入 / 小时 <em>*</em>',`<input id="log-hours" name="hours" type="number" step="0.25" min="0.25" max="24" value="${original?h(original.minutes):''}" placeholder="例如 1.5">`)}</div>
    ${field('log-note','工作说明 <em>*</em>',`<textarea id="log-note" name="note" maxlength="500" placeholder="具体完成了哪些工作？">${esc(original?.note||'')}</textarea>`)}
    <p class="hint">保存后计入“我的工时”，任务仍为进行中。提交任务验收后，由创建人一并确认成果与工时。</p>`,'保存工时',form=>{
      const p=project(original?selectedTask.projectId:form.get('project'));
      if(!visible(p))invalid('log-project','请选择有权访问的企业项目。');
      const t=task(original?selectedTask.id:form.get('task'));
      if(!canLog(t)||t.projectId!==p.id)invalid('log-task','请选择该项目中由你负责的进行中任务。');
      if(original&&(original.userId!==user()||!['pending','returned'].includes(original.status)))throw new Error('当前记录已不可修改。');
      const n=minutes(form.get('hours'),'log-hours'),date=String(form.get('date')),note=String(form.get('note')).trim();validateDate(date,'log-date');dailyLimit(date,n,editId);if(!note)invalid('log-note','请填写工作说明。');
      if(original)Object.assign(original,{minutes:n,date,note,status:'pending',reason:''});else entries.push({id:Math.max(0,...entries.map(e=>e.id))+1,taskId:t.id,userId:user(),date,minutes:n,note,status:'pending',reason:''});
      t.version++;event(`#${t.id} ${original?'修改':'记录'} ${h(n)}h 实际投入`);refresh('工时已保存，任务仍为进行中');
    });
  const updateTasks=(id,selection='')=>{
    const options=scopeTasks(Number(id)).filter(t=>id&&canLog(t)),select=$('#log-task');
    select.innerHTML=`<option value="">${!id?'请先选择项目':options.length?'请选择任务':'暂无可填报的任务'}</option>`+options.map(t=>`<option value="${t.id}">#${t.id} · ${esc(t.title)}</option>`).join('');
    select.disabled=Boolean(original)||!options.length;select.value=String(selection);
    $('#entry-form button[type="submit"]').disabled=!options.length;
    $('#log-project-hint').textContent=id&&!options.length?'该项目暂无由你负责的进行中任务。已提交验收或已完成的任务不能继续填报。':'';
    $('#log-task-error').textContent='';select.removeAttribute('aria-invalid');
  };
  updateTasks(pid,selectedTask?.id||'');
  $('#log-project').onchange=e=>updateTasks(e.target.value);
}
function personalExportRows() {return myEntries(state.myTab==='records');}
function exportMyCsv() {
  const rows=personalExportRows(),cell=v=>'"'+(/^[=+@-]/.test(String(v))?"'":'')+String(v).replaceAll('"','""')+'"';
  const csv='\uFEFF'+[['项目','任务','工作日期','填报人','工时','状态'],...rows.map(e=>[project(task(e.taskId).projectId).name,task(e.taskId).title,e.date,person(e.userId).name,h(e.minutes),labels[e.status]])].map(r=>r.map(cell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`Veges-我的工时-${range().start}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出当前筛选下的本人记录');
}
function bind(root=document) {
  bindFlow(root);
  const changeMyTab=(key,focus=false)=>{state.myTab=key;render();if(focus)$('#my-tab-'+key).focus();};
  root.querySelectorAll('[data-my-tab]').forEach(el=>{
    el.onclick=()=>changeMyTab(el.dataset.myTab);
    el.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();changeMyTab(e.key==='Home'?'records':e.key==='End'?'stats':state.myTab==='stats'?'records':'stats',true);}};
  });
  root.querySelectorAll('[data-my-drill]').forEach(el=>el.onclick=()=>{state.myProject=el.dataset.myDrill;state.myStatus='all';state.myTab='records';render();});
  if($('#my-project'))$('#my-project').onchange=e=>{state.myProject=e.target.value;render();};
  if($('#my-status'))$('#my-status').onchange=e=>{state.myStatus=e.target.value;render();};
}
render();
