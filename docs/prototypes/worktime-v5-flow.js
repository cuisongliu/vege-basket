/* V5: enterprise tabs and one acceptance decision owned by the immutable task creator. */
const recorded = id => approved(id)+pending(id);
const readAllEntries = t => canAccept(t)||canReview(project(t.projectId));
const projectTabs = [['tasks','项目待办','list-todo'],['journal','项目日记','notebook-pen'],['delivery','交付工作台','package'],['hours','项目工时','clock-3']];

const availableProjectTabs = () => projectTabs.filter(([key])=>key!=='hours'||admin());

function projectView() {
  const p=project(state.projectId);
  if(!availableProjectTabs().some(([key])=>key===state.tab))state.tab='tasks';
  return `<div class="project-location"><a class="project-back" href="#basket" data-nav="basket">${icon('arrow-left')}项目篮子</a><span>企业项目</span></div>
    ${heading('',p.name,`${esc(p.description)} · ${p.members.length} 位成员`, `<label class="project-switch"><span class="sr-only">切换项目</span><select id="project-switch" class="control">${visibleProjects().map(p=>`<option value="${p.id}" ${p.id===state.projectId?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><button class="btn" data-action="activity">${icon('activity')}待办动态</button>`)}
    <div class="project-tabs" role="tablist" aria-label="项目内容">${availableProjectTabs().map(([key,label,glyph])=>`<button role="tab" id="project-tab-${key}" aria-controls="project-tabpanel" aria-selected="${state.tab===key}" tabindex="${state.tab===key?0:-1}" data-project-tab="${key}" class="${state.tab===key?'active':''}">${icon(glyph)}${label}${key==='tasks'?`<small>${projectTasks(p.id).filter(t=>t.status!=='done').length}</small>`:''}</button>`).join('')}</div>
    <div role="tabpanel" id="project-tabpanel" aria-labelledby="project-tab-${state.tab}" tabindex="0">${state.tab==='tasks'?projectTodos():state.tab==='journal'?journalView():state.tab==='delivery'?deliveryView():statsView(p.id)}</div>`;
}

function filteredProjectTasks() {
  return projectTasks(state.projectId).filter(t=>(state.filter==='all'||t.status===state.filter)&&
    (state.todoScope==='mine'?t.assignee===user():state.todoScope==='accept'?t.status==='review'&&canAccept(t):true)&&
    `${t.id} ${t.title} ${person(t.assignee).name}`.includes(state.query.trim()));
}

function projectTodos() {
  const ts=projectTasks(state.projectId),mine=ts.filter(t=>t.status==='review'&&canAccept(t)).length;
  return `<section class="panel tasks-panel"><div class="tasks-toolbar"><div class="task-status-tabs">${[['all','全部'],['open','进行中'],['review','待验收'],['done','已完成']].map(([key,label])=>`<button data-task-status="${key}" aria-pressed="${state.filter===key}" class="${state.filter===key?'active':''}">${label}<small>${key==='all'?ts.length:ts.filter(t=>t.status===key).length}</small></button>`).join('')}</div>${canCreateTask(project(state.projectId))?button('new-task','添加待办','plus',true):''}</div>
    <div class="task-filters"><label class="search-box">${icon('search')}<input id="project-task-search" aria-label="搜索项目待办" placeholder="搜索待办、编号或负责人" value="${esc(state.query)}"></label><select id="todo-scope" class="control" aria-label="待办范围"><option value="all" ${state.todoScope==='all'?'selected':''}>全部待办</option><option value="mine" ${state.todoScope==='mine'?'selected':''}>我负责的</option><option value="accept" ${state.todoScope==='accept'?'selected':''}>待我验收${mine?' · '+mine:''}</option></select><span class="task-rule">提交后由创建人验收成果与工时</span></div>
    <div id="v4-task-list">${projectTodoRows()}</div></section>`;
}

function projectTodoRows() {
  const rows=filteredProjectTasks();
  const actionLabel=t=>t.status==='review'&&canAccept(t)?'验收':t.status==='review'?'查看提交':'查看';
  return `<div class="table-wrap task-table-desktop"><table class="project-todo-table"><thead><tr><th>待办 / 所属模块</th><th>负责人</th><th>创建人</th><th class="num">预估</th>${admin()?'<th class="num">已记录</th>':''}<th>状态</th><th class="num">操作</th></tr></thead><tbody>${rows.map(t=>`<tr><td><button class="task-link" data-task="${t.id}">${icon(t.status==='done'?'circle-check':t.status==='review'?'circle-dot':'circle')}<span class="task-text">${esc(t.title)}<small>#${t.id} · ${esc(t.module)} · ${t.due.slice(5)} 截止</small></span></button></td><td>${personLabel(t.assignee)}</td><td><span class="creator-name">${person(t.creatorId).name}</span></td><td class="num number">${t.estimate==null?'未预估':h(t.estimate)+'h'}</td>${admin()?`<td class="num"><span class="number">${t.legacy?'未记录':h(recorded(t.id))+'h'}</span><p>${t.legacy?'':pending(t.id)?`${h(pending(t.id))}h 未确认`:'已确认'}</p></td>`:''}<td>${badge(t.status)}</td><td class="num"><button class="btn ${canAccept(t)&&t.status==='review'?'primary':'quiet'}" data-task="${t.id}">${actionLabel(t)}</button></td></tr>`).join('')}</tbody></table></div>
    <div class="v4-task-cards">${rows.map(t=>`<article class="v4-task-card"><div class="line"><button class="task-link" data-task="${t.id}">${esc(t.title)}</button>${badge(t.status)}</div><p>#${t.id} · ${esc(t.module)} · ${t.due.slice(5)} 截止</p><div class="task-people"><span>负责人 ${person(t.assignee).name}</span><span>创建人 ${person(t.creatorId).name}</span></div><div class="task-card-bottom"><span>预估 <b>${t.estimate==null?'未填':h(t.estimate)+'h'}</b></span>${admin()?`<span>已记录 <b>${t.legacy?'未记录':h(recorded(t.id))+'h'}</b></span>`:''}<button class="btn ${canAccept(t)&&t.status==='review'?'primary':'quiet'}" data-task="${t.id}">${actionLabel(t)}</button></div></article>`).join('')}</div>
    ${rows.length?'':'<div class="empty">没有符合条件的待办<p>试试调整筛选条件。</p></div>'}<div class="list-caption"><span>共 ${rows.length} 项待办</span><span>${admin()?'已记录包含已确认与未确认投入':'本人投入请前往「我的工时」查看'}</span></div>`;
}

function journalView() {
  const rows=journals.filter(j=>j.projectId===state.projectId).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
  return `<div class="journal-tab-layout"><section class="panel journal-compose-panel"><div class="section-heading"><h2>记录项目日记</h2><small>2026-09-22 · 周二</small></div><textarea id="journal-draft" aria-label="项目日记" placeholder="记录今天的进展、决策、问题或方案...">${esc(state.journalDrafts[state.projectId]||'')}</textarea><div class="journal-save-row"><span>按项目保留草稿</span>${button('save-journal','保存到今日日记','notebook-pen',true)}</div></section><section class="panel journal-history-panel"><div class="section-heading"><h2>项目日记</h2><small>${rows.length} 条记录</small></div>${rows.map(j=>`<article class="journal-entry"><div class="journal-meta">${personLabel(j.userId)}<time>${j.date} ${j.time}</time></div><div class="journal-content">${esc(j.content)}</div></article>`).join('')||'<div class="empty">还没有项目日记<p>记录第一条进展，方便下次接上项目上下文。</p></div>'}</section></div>`;
}

function deliveryView() {
  const rows=deliveries.filter(d=>d.projectId===state.projectId);
  const selected=rows.find(d=>d.id===state.deliveryId)||rows[0];
  if(!selected)return '<section class="panel"><div class="empty">暂无交付事件<p>交付工作台沿用现有事件与安装包流程；此项目暂无演示数据。</p></div></section>';
  state.deliveryId=selected.id;
  const packageName=selected.packages.includes(state.packageName)?state.packageName:selected.packages[0];
  return `<div class="delivery-tab-layout"><aside class="panel delivery-events"><div class="section-heading"><h2>交付事件</h2><small>${rows.length}</small></div>${rows.map(d=>`<button class="delivery-event ${d.id===selected.id?'active':''}" data-delivery="${d.id}"><strong>${esc(d.title)}</strong><span>版本发布 · ${d.date}</span><span class="line"><span>交付人 ${person(d.owner).name}</span><span class="chip ${d.status==='done'?'green':'blue'}">${d.status==='done'?'已交付':'进行中'}</span></span></button>`).join('')}</aside><section class="panel delivery-content"><div class="section-heading"><div><h2>操作文档</h2><p>${esc(selected.title)} · ${selected.date}</p></div><span class="chip ${selected.status==='done'?'green':'blue'}">${selected.status==='done'?'已交付':'已发布'}</span></div><p class="delivery-readonly">事件发布后，基本信息、安装包和文档保持只读。</p><div class="delivery-document">${esc(selected.content)}</div><div class="package-section"><div class="section-heading"><h2>安装包列表</h2><small>${selected.packages.length} 个安装包</small></div><div class="package-layout"><div class="package-picker">${selected.packages.map(name=>`<button class="${name===packageName?'active':''}" data-package="${name}">${icon('package')}<span>${esc(name)}<small>${selected.version}</small></span></button>`).join('')}</div><article class="package-document"><h3>${esc(packageName)}</h3><p>版本 ${selected.version} · linux/amd64</p><div class="package-note">安装说明</div><p>按事件操作文档核对环境与版本，完成安装后执行约定的健康检查并保留交付记录。</p><div class="package-note">验证范围</div><p>服务启动、关键接口连通、业务主链路与回滚准备。</p></article></div></div></section></div>`;
}

function createTaskForm() {
  const p=project(state.projectId);if(!canCreateTask(p))return toast('企业待办仅限组织管理员创建');
  modal('添加企业待办',p.name,`<div class="creator-banner">${icon('user-round-check')}<span>创建人 <strong>${person(user()).name}</strong> · 提交后由创建人验收</span></div>
    ${field('task-title','待办标题 <em>*</em>','<input id="task-title" name="title" maxlength="100" placeholder="描述一个可验收的工作结果" required>')}
    <div class="field-row">${field('task-assignee','负责人 <em>*</em>',`<select id="task-assignee" name="assignee">${p.members.map(id=>`<option value="${id}">${person(id).name}</option>`).join('')}</select>`)}${field('task-due','截止日期 <em>*</em>','<input id="task-due" name="due" type="date" value="2026-09-25">')}</div>
    <div class="field-row">${field('task-module','所属模块','<select id="task-module" name="module"><option>结算</option><option>库存</option><option>售后</option><option>测试</option><option>任务</option></select>')}${field('task-priority','优先级','<select id="task-priority" name="priority"><option>中优先级</option><option>高优先级</option><option>低优先级</option></select>')}</div>
    ${field('task-estimate','预估工时 / 小时 <em>*</em>','<input id="task-estimate" name="estimate" type="number" min="0.25" max="10000" step="0.25" placeholder="例如 6.5">','按 0.25 小时递增，实际工时在执行与提交验收时填写。')}
    ${field('task-note','待办详情','<textarea id="task-note" name="note" maxlength="500" placeholder="补充任务范围、交付物与验收标准"></textarea>')}`,'创建待办',form=>{
      if(!canCreateTask(p))throw new Error('当前身份不能创建企业待办。');
      const title=String(form.get('title')).trim();if(!title)invalid('task-title','请填写待办标题。');
      const estimate=requiredEstimate(form.get('estimate'),'task-estimate'),assignee=String(form.get('assignee')),due=String(form.get('due'));
      if(!p.members.includes(assignee))invalid('task-assignee','请选择有效项目成员。');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(due))invalid('task-due','请填写截止日期。');
      const id=Math.max(...tasks.map(t=>t.id))+1;
      tasks.push({id,projectId:p.id,title,assignee,creatorId:user(),estimate,initialEstimate:estimate,status:'open',module:String(form.get('module')),priority:String(form.get('priority')),due,note:String(form.get('note')).trim()||'暂无补充说明。',result:'',returnReason:'',version:1});
      event(`#${id} 创建待办，预估 ${h(estimate)}h，由创建人验收`);state.tab='tasks';state.filter='all';state.query='';state.todoScope='all';refresh('待办已创建');openTask(id);
    },true);
}

function renderTask() {
  const t=task(state.taskId),p=project(t.projectId),creator=canAccept(t),own=t.assignee===user();
  const rows=ownEntries(t.id).filter(e=>readAllEntries(t)||e.userId===user()).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
  const full=readAllEntries(t),a=sum(rows.filter(e=>e.status==='approved')),pn=sum(rows.filter(e=>e.status==='pending'));
  const summary=t.status==='done'?`<div class="accept-result">${icon('circle-check')}<div><strong>任务已完成 · ${full?'实际':'我的投入'} ${t.legacy?'未记录':h(a)+'h'}</strong><p>${t.acceptedBy?person(t.acceptedBy).name+' 已验收通过':'历史完成记录'}${full&&t.estimate!=null&&!t.legacy?` · ${approved(t.id)===t.estimate?'符合预估':approved(t.id)>t.estimate?'超出预估 '+h(approved(t.id)-t.estimate)+'h':'比预估少 '+h(t.estimate-approved(t.id))+'h'}`:''}</p></div></div>`:
    t.status==='review'?`<div class="accept-wait">${icon('clock-3')}<div><strong>${creator?'待你验收':'等待创建人 '+person(t.creatorId).name+' 验收'}</strong><p>${full?'成果与 '+h(recorded(t.id))+'h 累计实际投入一并确认。':'由创建人一并确认成果与实际投入。'}</p></div></div>`:
    t.returnReason?`<div class="return-message"><strong>创建人已退回修改</strong><p>${esc(t.returnReason)}</p><small>原有工时保留，修改后重新提交验收。</small></div>`:'';
  $('#detail').innerHTML=`<header class="dialog-header"><div><small>#${t.id} · ${esc(p.name)}</small><h2 id="detail-title">${esc(t.title)}</h2><div class="task-detail-meta">${badge(t.status)}<span>${esc(t.module)}</span></div></div><button class="btn quiet icon" data-action="close-detail" aria-label="关闭任务详情">${icon('x')}</button></header>
    <div class="dialog-body"><div class="task-identity"><div><span>负责人</span>${personLabel(t.assignee)}</div><div><span>创建人 · 负责验收</span>${personLabel(t.creatorId)}</div></div><p class="detail-description">${esc(t.note)}</p>${summary}
    <div class="drawer-summary"><div><label>预估工时</label><b class="number">${t.estimate==null?'未预估':h(t.estimate)+'h'}</b>${canCreateTask(p)&&t.status==='open'?'<button class="text-btn" data-action="estimate">调整预估</button>':''}</div><div><label>${full?'已确认实际':'我的已确认'}</label><b class="number">${t.legacy?'未记录':h(a)+'h'}</b></div><div><label>${full?'未确认投入':'我的未确认'}</label><b class="number amber-text">${h(pn)}h</b></div></div>
    ${t.result?`<section class="submitted-result"><h3>本次交付说明</h3><p>${esc(t.result)}</p></section>`:''}
    <div class="drawer-actions">${canLog(t)?button('log-task','记录工时','plus'):''}${t.status==='open'&&own?button('submit-acceptance','提交验收','send',true):''}${t.status==='review'&&creator?button('reject-task','退回修改','undo-2')+button('accept-task','验收通过','check',true):''}${t.status==='review'&&own?button('withdraw-submission','撤回提交','rotate-ccw'):''}${t.status==='done'&&creator?button('reopen','重新打开','rotate-ccw'):''}</div>
    <div class="section-heading"><h2>工时明细</h2><small>${readAllEntries(t)?'全部记录':'本人记录'} · ${rows.length} 条</small></div>${rows.map(e=>`<article class="log-row"><div class="date mono">${e.date.slice(5).replace('-','.')}</div><div><p>${esc(e.note)}</p><small>${person(e.userId).name}</small>${e.reason?`<small>${esc(e.reason)}</small>`:''}<div class="actions">${entryActions(e)}</div></div><div class="num"><b class="number">${h(e.minutes)}h</b><div>${badge(e.status)}</div></div></article>`).join('')||'<div class="empty">暂无工时记录<p>可在执行中记录，也可在提交验收时补录。</p></div>'}
    <section class="audit-strip"><h3>任务动态</h3>${history.filter(e=>(full||e.userId===user())&&e.message.includes('#'+t.id+' ')).map(e=>`<div class="event-row">${icon('history')}<span>${esc(e.message)}<br>${person(e.userId).name} · ${e.time}</span></div>`).join('')||'<p class="hint">暂无新的变更</p>'}</section></div>`;
  bind($('#detail'));paintIcons();
}

function entryActions(e) {
  const t=task(e.taskId);
  return e.userId===user()&&canLog(t)&&['pending','returned'].includes(e.status)?`<button class="text-btn" data-edit-entry="${e.id}">修改记录</button>`:'';
}

function submitAcceptanceForm() {
  const t=task(state.taskId);if(!t||t.status!=='open'||t.assignee!==user()||!visible(project(t.projectId)))return;
  const version=t.version,total=recorded(t.id);
  modal('提交任务验收',t.title,`<div class="creator-banner">${icon('user-round-check')}<span>提交给创建人 <strong>${person(t.creatorId).name}</strong></span></div><div class="form-summary"><span>已记录实际 / 预估</span><b class="number">${h(total)}h / ${t.estimate==null?'未预估':h(t.estimate)+'h'}</b></div>
    ${field('submit-result','交付说明 <em>*</em>',`<textarea id="submit-result" name="result" maxlength="1000" placeholder="说明完成内容、交付结果和验证情况">${esc(t.result||'')}</textarea>`)}
    <div class="field-row">${field('extra-hours','补录实际工时 / 小时','<input id="extra-hours" name="hours" type="number" min="0" max="24" step="0.25" value="0">','已有记录不用重复填写')}${field('extra-date','补录工作日期',`<input id="extra-date" name="date" type="date" value="${TODAY}" max="${TODAY}">`)}</div>
    <div class="completion-total"><span>本次提交的累计实际工时</span><b class="number" id="preview-total">${h(total)}h</b></div><p class="hint">提交后锁定本次成果与工时，等待创建人验收。需要修改时可撤回提交。</p>`,'确认提交验收',form=>{
      if(t.status!=='open'||t.assignee!==user()||t.version!==version)throw new Error('任务状态已变化，请关闭后重新查看。');
      const result=String(form.get('result')).trim();if(!result)invalid('submit-result','请填写交付说明。');
      const n=minutes(form.get('hours'),'extra-hours',true);if(total+n<=0)invalid('extra-hours','请填写实际投入，不能以 0 小时提交验收。');
      if(n){const date=String(form.get('date'));validateDate(date,'extra-date');dailyLimit(date,n);entries.push({id:Math.max(0,...entries.map(e=>e.id))+1,taskId:t.id,userId:user(),date,minutes:n,note:result,status:'pending',reason:''});}
      t.result=result;t.returnReason='';t.status='review';t.submittedBy=user();t.submittedMinutes=recorded(t.id);t.version++;event(`#${t.id} 提交验收，累计实际 ${h(t.submittedMinutes)}h，交由创建人 ${person(t.creatorId).name} 处理`);refresh('已提交，等待创建人验收');
    });
  $('#extra-hours').oninput=e=>$('#preview-total').textContent=h(total+Math.max(0,Number(e.target.value)||0)*60)+'h';
}

function acceptTaskForm(reject=false) {
  const t=task(state.taskId);if(!t||t.status!=='review'||!canAccept(t))return toast('仅任务创建人可以验收此待办');
  const version=t.version,total=recorded(t.id),newMinutes=pending(t.id);
  modal(reject?'退回任务修改':'验收通过并确认工时',t.title,`<div class="creator-banner">${icon('user-round-check')}<span>你是此任务的创建人 · ${person(t.creatorId).name}</span></div>
    <div class="acceptance-numbers"><div><span>预估工时</span><b>${t.estimate==null?'未预估':h(t.estimate)+'h'}</b></div><div><span>累计实际</span><b>${h(total)}h</b></div><div><span>本次待确认</span><b class="amber-text">${h(newMinutes)}h</b></div></div>
    <section class="submitted-result"><h3>交付说明</h3><p>${esc(t.result||'已提交任务成果，请结合任务要求核验。')}</p></section>
    ${reject?field('reject-reason','退回原因 <em>*</em>','<textarea id="reject-reason" name="reason" maxlength="500" placeholder="说明尚未满足的要求或需要更正的工时"></textarea>'):`<p class="hint">确认后任务变为已完成，本次 ${h(newMinutes)}h 未确认投入转为已确认。历史已确认记录不重复累计。</p>${t.assignee===user()?'<p class="status-msg">此任务由你创建并负责，本次本人验收将记录在任务动态中。</p>':''}`}`,
    reject?'确认退回':'确认通过并完成',form=>{
      if(!canAccept(t)||t.status!=='review'||t.version!==version)throw new Error('任务或权限已变化，请重新查看。');
      if(reject){const reason=String(form.get('reason')).trim();if(!reason)invalid('reject-reason','请填写退回原因。');t.status='open';t.returnReason=reason;event(`#${t.id} 创建人退回修改：${reason}，保留已有工时`);}
      else {if(recorded(t.id)<=0)throw new Error('缺少实际工时，无法验收通过。');for(const e of ownEntries(t.id))if(e.status==='pending')e.status='approved';t.status='done';t.acceptedBy=user();t.acceptedAt=TODAY;t.legacy=false;event(`#${t.id} 创建人验收通过，确认累计实际 ${h(approved(t.id))}h`);}
      t.version++;refresh(reject?'已退回负责人修改':'任务已完成，项目与全部项目统计已同步');
    });
}

function acceptanceQueue() {
  const rows=scopeTasks().filter(t=>t.status==='review'&&canAccept(t));
  return `${heading('','待我验收','仅展示由你创建、且已提交验收的企业待办')}
    <section class="panel acceptance-queue"><div class="section-heading"><h2>${rows.length} 项待办等待验收</h2><small>一次确认交付成果与实际工时</small></div>${rows.map(t=>`<article class="queue-row"><div><div class="queue-title"><button class="text-btn" data-task="${t.id}">${esc(t.title)}</button>${badge(t.status)}</div><p>${esc(project(t.projectId).name)} · #${t.id} · 负责人 ${person(t.assignee).name}</p><p class="queue-result">${esc(t.result)}</p></div><div class="queue-hours"><span>预估 / 累计实际</span><b>${t.estimate==null?'未预估':h(t.estimate)+'h'} / ${h(recorded(t.id))}h</b></div><button class="btn primary" data-task="${t.id}">查看并验收 ${icon('arrow-right')}</button></article>`).join('')||'<div class="empty">暂无待你验收的任务<p>负责人提交你创建的待办后，会显示在这里。</p></div>'}</section>`;
}

function action(name) {
  if(name==='new-project')return createProjectForm();if(name==='new-task')return createTaskForm();
  if(name==='log')return logForm();if(name==='log-task')return logForm(state.taskId);if(name==='estimate')return estimateForm();if(name==='export')return exportCsv();
  if(name==='submit-acceptance')return submitAcceptanceForm();if(name==='accept-task')return acceptTaskForm();if(name==='reject-task')return acceptTaskForm(true);
  if(name==='close-detail')return $('#detail').close();
  if(name==='save-journal') {const content=String($('#journal-draft').value).trim();if(!content)return toast('请先填写日记内容');journals.push({id:Math.max(0,...journals.map(j=>j.id))+1,projectId:state.projectId,userId:user(),date:TODAY,time:'16:42',content});state.journalDrafts[state.projectId]='';render();return toast('日记已保存到当前项目');}
  if(name==='activity')return modal('待办动态',project(state.projectId).name,history.filter(e=>(admin()||e.userId===user())&&projectTasks(state.projectId).some(t=>e.message.includes('#'+t.id+' '))).map(e=>`<div class="audit-row"><span>${esc(e.message)}</span><span>${person(e.userId).name} · ${e.time}</span></div>`).join('')||'<div class="empty">暂无新的任务动态</div>','知道了',()=>$('#form-dialog').close());
  if(name==='reset')return modal('重置演示数据？','所有操作仅保存在页面内存。','<p>将恢复初始待办、工时、日记与演示身份。</p>','确认重置',()=>{seed();$('#detail').close();state={role:'developer',scope:'enterprise',view:'ledger',projectId:1,tab:'tasks',period:'month',offset:0,query:'',filter:'all',taskId:null,hoursTab:'overview',tag:'all',todoScope:'all',projectContexts:{},journalDrafts:{},deliveryId:1,packageName:'',myTab:'stats',myProject:'all',myStatus:'all'};refresh('已恢复初始样例');});
  if(name==='reopen'||name==='withdraw-submission') {
    const t=task(state.taskId),reopen=name==='reopen';
    if(reopen?!canAccept(t)||t.status!=='done':t.assignee!==user()||t.status!=='review')return;
    const version=t.version;
    return modal(reopen?'重新打开任务？':'撤回本次验收提交？',t.title,`<p>${reopen?'保留所有已确认实际投入，返工新增工时，完成后再次提交创建人验收。':'任务回到进行中，交付说明与工时记录保留，可修改后重新提交。'}</p>`,reopen?'确认重开':'确认撤回',()=>{
      if(t.version!==version||(reopen?!canAccept(t):t.assignee!==user()))throw new Error('任务或权限已变化，请重新查看。');
      t.status='open';t.version++;event(`#${t.id} ${reopen?'创建人重新打开任务':'负责人撤回验收提交'}，保留历史工时`);refresh(reopen?'任务已重新打开':'已撤回，可继续修改');
    });
  }
}

function changeProjectTab(key,focus=false) {
  if(!availableProjectTabs().some(([v])=>v===key))return;
  state.tab=key;render();
  if(focus)document.getElementById('project-tab-'+key).focus();
}

function bindFlow(root=document) {
  bindBase(root);
  root.querySelectorAll('[data-project-tab]').forEach(el=>{
    el.onclick=()=>changeProjectTab(el.dataset.projectTab);
    el.onkeydown=e=>{const keys=availableProjectTabs().map(([k])=>k),current=keys.indexOf(el.dataset.projectTab);let next;
      if(e.key==='ArrowRight')next=(current+1)%keys.length;else if(e.key==='ArrowLeft')next=(current+keys.length-1)%keys.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=keys.length-1;else return;
      e.preventDefault();changeProjectTab(keys[next],true);
    };
  });
  root.querySelectorAll('[data-task-status]').forEach(el=>el.onclick=()=>{state.filter=el.dataset.taskStatus;render();});
  if($('#project-task-search'))$('#project-task-search').oninput=e=>{state.query=e.target.value;$('#v4-task-list').innerHTML=projectTodoRows();bind($('#v4-task-list'));paintIcons();};
  if($('#todo-scope'))$('#todo-scope').onchange=e=>{state.todoScope=e.target.value;render();};
  if($('#project-switch'))$('#project-switch').onchange=e=>openProject(Number(e.target.value));
  if($('#journal-draft'))$('#journal-draft').oninput=e=>state.journalDrafts[state.projectId]=e.target.value;
  root.querySelectorAll('[data-delivery]').forEach(el=>el.onclick=()=>{state.deliveryId=Number(el.dataset.delivery);state.packageName='';render();});
  root.querySelectorAll('[data-package]').forEach(el=>el.onclick=()=>{state.packageName=el.dataset.package;render();});
}
