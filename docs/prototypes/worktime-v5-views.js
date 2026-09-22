/* Existing Veges shell and search/cockpit structure, extended only for enterprise time. */
const unchangedNav = (label, glyph) => `<span class="nav-existing" title="现有功能，本次原型不展开">${icon(glyph)}${label}</span>`;

function render() {
  state.scope = 'enterprise';
  if(!admin()&&state.view==='stats'){state.view='ledger';state.myTab='stats';}
  if(!admin()&&state.view==='project'&&state.tab==='hours')state.tab='tasks';
  if (!['basket','stats','project','ledger','review'].includes(state.view)) state.view = 'basket';
  if (state.view === 'project' && !visible(project(state.projectId))) state.view = 'basket';

  $('#app').innerHTML = `<div class="shell">
    <aside class="sidebar">
      <div class="brand"><img src="../../public/favicon.svg" alt=""><div><small>Veges</small><b>项目篮子</b></div><span class="bell" aria-label="通知">${icon('bell')}</span></div>
      <div class="organization-label">${icon('building-2')}<span>青禾零售科技</span>${icon('chevrons-up-down')}</div>
      <nav class="nav" aria-label="主导航">
        <div class="nav-label">日常工作</div>
        ${routeLink('basket','项目篮子','panels-top-left')}
        ${unchangedNav('我的待办','list-todo')}${admin()||scopeTasks().some(canAccept)?routeLink('review','待我验收','clipboard-check'):''}${unchangedNav('周报管理','calendar-days')}
        <div class="nav-label">协作与交付</div>
        ${unchangedNav(state.role==='tester'?'测试工作台':'Bug 工作台',state.role==='tester'?'flask-conical':'bug')}
        ${unchangedNav('安装包市场','package')}${unchangedNav('镜像同步','container')}
        <div class="nav-label">企业工时</div>
        ${admin()?routeLink('stats','工时统计','chart-no-axes-combined'):''}${routeLink('ledger','我的工时','clock-3')}
      </nav>
      <div class="sidebar-bottom"><div class="account-card"><span class="account-dot"></span><div><strong>${person(user()).name}</strong><small>${person(user()).job}</small></div>${icon('chevrons-up-down')}</div>
        <label class="demo-role-label" for="role">演示身份</label><select id="role" class="persona"><option value="admin" ${state.role==='admin'?'selected':''}>周予安 · 组织管理员</option><option value="admin2" ${state.role==='admin2'?'selected':''}>沈亦航 · 组织管理员</option><option value="developer" ${state.role==='developer'?'selected':''}>开发工程师</option><option value="tester" ${state.role==='tester'?'selected':''}>测试工程师</option></select>
      </div>
    </aside>
    <main class="workspace" id="main" tabindex="-1">${state.view==='basket'?basketView():state.view==='stats'?statsView():state.view==='project'?projectView():state.view==='review'?acceptanceQueue():ledgerView()}
      <footer class="prototype-foot"><span>企业工时交互原型 · 示例数据</span><a href="worktime-v5-design.md">设计说明</a><button class="text-btn" data-action="reset">重置演示</button></footer>
    </main>
  </div>`;
  if(state.view==='project')$('.nav [data-nav="basket"]').classList.add('active');
  bind(); paintIcons();
}

function heading(_eyebrow, title, subtitle, actions='') {
  return `<header class="page-head"><div><h1>${esc(title)}</h1>${subtitle?`<p>${subtitle}</p>`:''}</div><div class="head-actions">${actions}</div></header>`;
}

function basketView() {
  return `${heading('', '项目篮子','',canCreateProject()?button('new-project','新建项目','plus',true):'')}
    <section class="search-panel panel" aria-label="搜索企业项目">
      <div class="search-controls">
        <label class="search-field">关键词<span class="search-box">${icon('search')}<input id="search" placeholder="搜索项目、简介..." value="${esc(state.query)}"></span></label>
        <label class="search-field">状态<select id="project-status" class="control">${[['all','全部状态'],['open','进行中'],['done','已结束']].map(([v,l])=>`<option value="${v}" ${state.filter===v?'selected':''}>${l}</option>`).join('')}</select></label>
        <label class="search-field">标签<select id="project-tag" class="control"><option value="all">全部标签</option>${[...new Set(visibleProjects().map(p=>p.tag))].map(t=>`<option ${state.tag===t?'selected':''}>${esc(t)}</option>`).join('')}</select></label>
      </div><div id="project-list">${projectList()}</div>
    </section>
    <div class="basket-footer"><span>${admin()?'企业项目与待办由组织管理员创建。':'仅显示你有权访问的企业项目；新项目与待办请联系组织管理员。'}</span>${admin()?`<a href="#stats" data-nav="stats">${icon('chart-no-axes-combined')}查看全部项目工时 ${icon('arrow-right')}</a>`:'<a href="#ledger" data-nav="ledger">查看我的工时</a>'}</div>`;
}

function projectList() {
  const rows=visibleProjects().filter(p=>(state.filter==='all'||p.status===state.filter)&&(state.tag==='all'||p.tag===state.tag)&&`${p.name} ${p.description}`.includes(state.query.trim()));
  return `<div class="search-results">${rows.map(p=>`<article class="result-item"><button class="result-main" data-project="${p.id}"><div class="result-meta-row">${badge(p.status)}<span>${admin()?'组织管理':'协作'}</span><span>创建于 2026-09-${String(p.id).padStart(2,'0')}</span></div><div class="result-title-row"><h3>${esc(p.name)}</h3><span class="project-tag">${p.tag}</span></div><p>${esc(p.description)}</p></button><div class="result-actions">${admin()?`<button class="btn" data-project="${p.id}" data-hours="true">${icon('clock-3')}项目工时</button>`:''}<button class="btn quiet icon" data-project="${p.id}" aria-label="进入${esc(p.name)}">${icon('chevron-right')}</button></div></article>`).join('')||'<div class="empty">没有符合条件的项目<p>试试其他关键词或筛选条件。</p></div>'}</div><div class="list-caption">共 ${rows.length} 个企业项目 · ${admin()?'当前组织全部项目':'仅包含有访问权限的项目'}</div>`;
}

function statsView(id=null) {
  if(!admin())return '<div class="empty">项目与组织工时统计仅限组织管理员查看。</div>';
  const local=Boolean(id),tab=local?state.hoursTab:state.tab, attr=local?'data-hours-tab':'data-tab';
  const tabs=[['overview',local?'项目总览':'全部项目'],['members','成员投入'],['trend','周 / 月趋势']];
  if(local)tabs.push(['tasks','任务明细']);
  return `${local?'':heading('','工时统计',`青禾零售科技 · ${admin()?'全部企业项目':'有权访问的企业项目'}`,button('export','导出明细','download'))}
    <section class="panel hours-panel"><div class="subtabs">${tabs.map(([v,l])=>`<button ${attr}="${v}" class="${tab===v?'active':''}">${l}</button>`).join('')}</div>
    ${periodToolbar()}${metrics(id)}
    ${tab==='members'?memberTable(id):tab==='tasks'?taskSection(id):`
      <div class="stats-grid"><section><div class="section-heading"><div><h2>投入趋势</h2><p>${state.period==='week'?'按工作日期每日汇总':'按自然月汇总，图中每段为连续 7 日'}</p></div>${legend()}</div><div data-chart="${id||''}">${chart(id)}</div><div class="chart-foot"><span>已确认为正式实际工时</span><span>未确认单独展示</span></div></section>
      <section><div class="section-heading"><div><h2>成员投入</h2><p>按实际填报人归属</p></div><button class="text-btn" ${attr}="members">全部 ${icon('arrow-up-right')}</button></div>${memberBars(id)}</section></div>
      ${tab==='trend'?dailyTable(id):local?taskSection(id):projectStatsTable()}`}
    </section>`;
}


function createProjectForm() {
  if(!canCreateProject())return toast('企业项目仅限组织管理员创建');
  modal('新建企业项目','青禾零售科技',`${field('project-name','项目名称 <em>*</em>','<input id="project-name" name="name" maxlength="60" placeholder="例如：门店经营分析" required>')}${field('project-description','项目简介','<textarea id="project-description" name="description" maxlength="200" placeholder="简要描述项目目标"></textarea>')}<p class="hint">新建待办时需要填写预估工时。</p>`,'创建项目',form=>{
    if(!canCreateProject())throw new Error('当前身份不能创建企业项目。');
    const name=String(form.get('name')).trim();if(!name)invalid('project-name','请填写项目名称。');
    const id=Math.max(...projects.map(p=>p.id))+1;
    projects.push({id,name,description:String(form.get('description')).trim(),scope:'enterprise',owner:user(),members:[user()],status:'open',tag:'新项目',symbol:'folder',color:''});
    $('#form-dialog').close();openProject(id);toast('企业项目已创建');
  });
}

function bindBase(root=document) {
  bindDomain(root);
  root.querySelectorAll('[data-hours-tab]').forEach(el=>el.onclick=()=>{state.hoursTab=el.dataset.hoursTab;render();});
  if($('#project-status'))$('#project-status').onchange=e=>{state.filter=e.target.value;render();};
  if($('#project-tag'))$('#project-tag').onchange=e=>{state.tag=e.target.value;render();};
}
