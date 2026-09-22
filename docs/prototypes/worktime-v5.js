/* V5 enterprise-only prototype domain. In-memory sample data; no network or persistent writes. */
const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const h = minutes => new Intl.NumberFormat('en', {maximumFractionDigits:2}).format(minutes / 60);
const sum = rows => rows.reduce((total, row) => total + row.minutes, 0);
const TODAY = '2026-09-22';
const people = [
  {id:'zhou',name:'周予安',job:'组织管理员',color:''},
  {id:'lin',name:'林知远',job:'开发工程师',color:'blue'},
  {id:'gu',name:'顾南枝',job:'测试工程师',color:'amber'},
  {id:'shen',name:'沈亦航',job:'组织管理员',color:''},
];
const person = id => people.find(p => p.id === id);
const avatar = id => `<span class="avatar ${person(id).color}">${person(id).name[0]}</span>`;
const personLabel = id => `<span class="mini-owner">${avatar(id)}${person(id).name}</span>`;
const labels = {open:'进行中',review:'待验收',done:'已完成',pending:'未确认',approved:'已确认',returned:'已退回',void:'已作废',paused:'已暂停'};
const badge = status => `<span class="chip ${['done','approved'].includes(status)?'green':['pending','review'].includes(status)?'amber':status==='returned'?'red':status==='open'?'blue':''}">${labels[status]}</span>`;
let projects, tasks, entries, history, journals, deliveries;
function seed() {
  projects = [
    {id:1,name:'零售后台重构',description:'收银、库存与售后体验的统一升级',scope:'enterprise',owner:'zhou',members:['zhou','lin','gu','shen'],status:'open',tag:'核心业务',symbol:'layers',color:''},
    {id:2,name:'门店巡检小程序',description:'从现场巡检到异常闭环，让门店协作更轻',scope:'enterprise',owner:'zhou',members:['zhou','gu','shen'],status:'open',tag:'门店运营',symbol:'scan-line',color:'blue'},
    {id:3,name:'供应链数据看板',description:'打通采购、履约与库存分析',scope:'enterprise',owner:'zhou',members:['zhou','lin','shen'],status:'open',tag:'数据服务',symbol:'chart-no-axes-combined',color:'amber'},
    {id:4,name:'会员积分迁移',description:'历史积分核对与迁移验收',scope:'enterprise',owner:'zhou',members:['zhou','shen'],status:'done',tag:'客户增长',symbol:'waypoints',color:''},
  ];
  tasks = [
    [128,1,'重构结算页优惠计算','lin',16,'done','结算'],[131,1,'库存预警接口与消息卡片','lin',12,'open','库存'],
    [136,1,'退款单状态机补齐','lin',20,'review','售后'],[142,1,'结算流程回归与兼容性验证','gu',8,'review','测试'],
    [145,1,'细化门店数据访问权限','zhou',6,'done','权限'],[149,1,'订单迁移校验与灰度切换','zhou',10,'open','订单'],
    [152,1,'补齐商品搜索空态','gu',4,'done','测试'],[108,1,'历史收银配置整理','lin',null,'done','配置'],
    [201,2,'巡检离线缓存与补传','shen',18,'open','巡检'],[202,2,'门店巡检回归测试','gu',14,'open','测试'],[203,2,'巡检结果导出','zhou',8,'done','报表'],
    [301,3,'采购看板聚合接口','lin',22,'open','接口'],[302,3,'履约趋势可视化','shen',16,'done','图表'],[303,3,'统一指标计算口径','zhou',8,'done','数据'],
    [401,4,'历史积分迁移与校验','shen',24,'done','迁移'],[402,4,'积分差异复核','zhou',10,'done','验收'],
  ].map(([id,projectId,title,assignee,estimate,status,module])=>({id,projectId,title,assignee,creatorId:id===136?'shen':'zhou',result:status==='review'?'已完成约定范围并附上验证结果，请确认交付成果与实际投入。':'',returnReason:'',acceptedBy:status==='done'?'zhou':null,version:1,estimate:estimate==null?null:estimate*60,initialEstimate:estimate==null?null:estimate*60,status,module,due:'2026-09-25',note:'按确认范围推进，完成后提交验收。',legacy:id===108}));
  const source = [
    [128,'lin',2,4.5],[128,'lin',9,6],[128,'lin',15,8],[131,'lin',16,4],[131,'lin',18,2],[131,'lin',21,3,'pending'],
    [136,'lin',3,7],[136,'lin',10,8],[136,'lin',17,3],[136,'lin',21,3,'pending'],
    [142,'gu',7,3.5],[142,'gu',14,3],[142,'gu',22,1.5,'pending'],[145,'zhou',8,4.5],[149,'zhou',20,7],[152,'gu',11,3],
    [201,'shen',4,6],[201,'shen',12,5],[201,'shen',19,4.5],[202,'gu',8,5],[202,'gu',16,6],[202,'gu',22,2,'pending'],[203,'zhou',6,7],
    [301,'lin',5,7.5],[301,'lin',13,6],[301,'lin',22,4,'pending'],[302,'shen',6,7],[302,'shen',14,8.5],[303,'zhou',11,7],
    [401,'shen',1,8],[401,'shen',5,7.5],[401,'shen',9,7],[402,'zhou',13,8.5],
  ];
  entries=source.map(([taskId,userId,day,hours,status='approved'],i)=>({id:i+1,taskId,userId,date:`2026-09-${String(day).padStart(2,'0')}`,minutes:hours*60,status,note:taskId===131?'接口联调与失败重试验证':taskId===142?'结算主链路与兼容性回归':'完成阶段开发、联调与结果核验',reason:status==='returned'?'请补充具体处理内容，并核对投入时长。':''}));
  for (const e of entries) {
    const t=tasks.find(t=>t.id===e.taskId);
    if(t.status!=='done'&&t.id!==149&&e.status==='approved')e.status='pending';
  }
  history=[{message:'#149 任务重开，保留上次验收确认的 7h',userId:'zhou',time:'09.21 09:30'}];
  journals=[
    {id:1,projectId:1,userId:'zhou',date:'2026-09-22',time:'10:24',content:'本周交付与验收安排\n结算链路进入回归阶段，库存预警继续联调。任务完成后提交成果与实际工时，由任务创建人统一验收。\n结算回归覆盖优惠叠加、退款及网络恢复；灰度切换前核对迁移结果。'},
    {id:2,projectId:1,userId:'lin',date:'2026-09-21',time:'17:35',content:'接口联调进展\n库存预警接口已接通，待补充失败重试验证，相关投入已记录到对应待办。'}
  ];
  deliveries=[
    {id:1,projectId:1,title:'零售后台 v2.4 灰度交付',date:'2026-09-25',owner:'zhou',status:'open',packages:['retail-api','retail-web'],version:'2.4.0',content:'交付前检查\n核对迁移校验结果、备份记录与环境配置。\n灰度验证\n先在试点门店验证订单、退款与库存链路，再按既定窗口逐步开放。\n回滚准备\n保留上一版本安装包与数据校验记录。'},
    {id:2,projectId:1,title:'库存消息服务 v1.8 交付',date:'2026-09-18',owner:'shen',status:'done',packages:['inventory-service'],version:'1.8.0',content:'交付记录\n安装包核对完成，消息订阅与异常恢复已验证。\n交付结果\n已完成试点门店上线并记录观察结果。'}
  ];
}
seed();
let state={role:'developer',scope:'enterprise',view:'ledger',projectId:1,tab:'tasks',period:'month',offset:0,query:'',filter:'all',taskId:null,hoursTab:'overview',tag:'all',todoScope:'all',projectContexts:{},journalDrafts:{},deliveryId:1,packageName:'',myTab:'stats',myProject:'all',myStatus:'all'};
const user = () => state.role==='admin'?'zhou':state.role==='admin2'?'shen':state.role==='tester'?'gu':'lin';
const admin = () => ['admin','admin2'].includes(state.role);
const project = id => projects.find(p=>p.id===Number(id));
const task = id => tasks.find(t=>t.id===Number(id));
const visibleProjects = () => projects.filter(p=>p.scope==='enterprise'&&(admin()||p.members.includes(user())));
const visible = p => Boolean(p&&visibleProjects().some(v=>v.id===p.id));
const canCreateProject = () => admin();
const canCreateTask = p => visible(p)&&admin();
const canReview = p => visible(p)&&admin();
const canAccept = t => Boolean(t&&visible(project(t.projectId))&&t.creatorId===user());
const canLog = t => Boolean(t&&t.status==='open'&&visible(project(t.projectId))&&t.assignee===user());
const ownEntries = id => entries.filter(e=>e.taskId===Number(id));
const approved = id => sum(ownEntries(id).filter(e=>e.status==='approved'));
const pending = id => sum(ownEntries(id).filter(e=>e.status==='pending'));
const projectTasks = id => tasks.filter(t=>t.projectId===Number(id));
const contextName = () => '青禾零售科技';
const range = () => {
  if(state.period==='month'){const d=new Date(Date.UTC(2026,8+state.offset,1));return {start:d.toISOString().slice(0,10),end:new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).toISOString().slice(0,10)};}
  const d=new Date('2026-09-21T00:00:00Z');d.setUTCDate(d.getUTCDate()+state.offset*7);const end=new Date(d);end.setUTCDate(d.getUTCDate()+6);return {start:d.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
};
const within = e => e.date>=range().start&&e.date<=range().end;
const scopeTasks = (projectId=null) => tasks.filter(t=>visible(project(t.projectId))&&(!projectId||t.projectId===Number(projectId)));
const scopeEntries = (projectId=null,period=true) => entries.filter(e=>scopeTasks(projectId).some(t=>t.id===e.taskId)&&(!period||within(e)));
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),2800);}
function paintIcons(){lucide.createIcons();}
function event(message){history.unshift({message,userId:user(),time:'09.22 16:42'});}
const routeLink=(view,label,glyph)=>`<a href="#${view}" data-nav="${view}" class="${state.view===view?'active':''}">${icon(glyph)}${label}${view==='review'?`<small>${scopeTasks().filter(t=>t.status==='review'&&canAccept(t)).length}</small>`:''}</a>`;
const button=(action,text,glyph='plus',primary=false)=>`<button class="btn ${primary?'primary':''}" data-action="${action}">${glyph?icon(glyph):''}${text}</button>`;
function totals(id=null){const ts=scopeTasks(id),es=scopeEntries(id);const comparable=ts.filter(t=>t.status==='done'&&t.estimate!=null&&!t.legacy&&approved(t.id)>0);return {estimate:ts.reduce((n,t)=>n+(t.estimate||0),0),approved:sum(es.filter(e=>e.status==='approved')),pending:sum(es.filter(e=>e.status==='pending')),comparable:comparable.length,delta:comparable.reduce((n,t)=>n+approved(t.id)-t.estimate,0),missing:ts.filter(t=>t.estimate==null).length};}
function periodToolbar(){return `<div class="period-row"><div class="right"><div class="segment">${['week','month'].map(p=>`<button data-period="${p}" class="${state.period===p?'active':''}">${p==='week'?'周':'月'}</button>`).join('')}</div><span class="mono">${range().start.replaceAll('-','.')} ~ ${range().end.slice(5).replace('-','.')}</span><div class="right"><button class="btn quiet icon" data-offset="-1" aria-label="上一周期">${icon('chevron-left')}</button><button class="btn quiet icon" data-offset="1" aria-label="下一周期" ${state.offset===0?'disabled':''}>${icon('chevron-right')}</button></div></div><span class="muted">按工作日期 · Asia/Shanghai</span></div>`;}
function metrics(id=null){const t=totals(id);return `<div class="metrics">${[['flag','任务预估 · 累计',h(t.estimate),`${scopeTasks(id).length} 项任务 · ${t.missing} 项未预估`,''],['circle-check','本周期已确认',h(t.approved),'包含进行中及已完成任务',''],['hourglass','本周期未确认',h(t.pending),'任务验收通过后确认','amber-text'],['git-compare-arrows','完结偏差 · 累计',(t.delta>0?'+':'')+h(t.delta),`${t.comparable} 项已完成且有预估的任务`,t.delta>0?'red-text':'green-text']].map(([glyph,label,value,note,color])=>`<section class="metric"><div class="metric-label">${icon(glyph)}${label}</div><div class="metric-value"><b class="${color}">${value}</b><span>小时</span></div><p>${note}</p></section>`).join('')}</div>`;}
const legend=()=>'<div class="legend"><span><i></i>已确认</span><span><i class="pending"></i>未确认</span></div>';
function chart(id=null,personal=false){const r=range(),bins=[];if(state.period==='month'){for(let day=1;day<=Number(r.end.slice(8));day+=7){const end=Math.min(day+6,Number(r.end.slice(8)));bins.push({start:r.start.slice(0,8)+String(day).padStart(2,'0'),end:r.start.slice(0,8)+String(end).padStart(2,'0'),label:`${day}–${end}日`});}}else for(let i=0;i<7;i++){const d=new Date(r.start+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+i);const date=d.toISOString().slice(0,10);bins.push({start:date,end:date,label:date.slice(5).replace('-','/')});}
  const rows=personal?myEntries():scopeEntries(id);if(!rows.some(e=>['approved','pending'].includes(e.status)))return '<div class="empty">本周期暂无投入记录<p>切换周期查看历史工时。</p></div>';
  const points=bins.map(b=>({...b,a:sum(rows.filter(e=>e.status==='approved'&&e.date>=b.start&&e.date<=b.end))/60,p:sum(rows.filter(e=>e.status==='pending'&&e.date>=b.start&&e.date<=b.end))/60}));const max=Math.max(10,Math.ceil(Math.max(...points.map(p=>Math.max(p.a,p.p)))/10)*10),w=innerWidth<760?350:620,x=i=>42+i*(w-70)/(points.length-1),y=v=>190-v/max*157;
  const path=key=>points.filter(p=>p.start<=TODAY).map((p,i)=>`${i?'L':'M'}${x(i)} ${y(p[key])}`).join(' ');
  return `<div class="chart"><svg viewBox="0 0 ${w} 228" role="img" aria-label="${state.period==='week'?'每日':'月内分段'}工时趋势"><title>已确认与未确认分列，未来日期不绘制工时</title><text x="9" y="13">h</text>${[0,1,2,3,4].map(i=>`<line x1="36" x2="${w-16}" y1="${y(max*i/4)}" y2="${y(max*i/4)}" stroke="var(--line)" stroke-dasharray="3 5"/><text x="28" y="${y(max*i/4)+4}" text-anchor="end">${max*i/4}</text>`).join('')}<path d="${path('a')}" fill="none" stroke="var(--brand)" stroke-width="2.5"/><path d="${path('p')}" fill="none" stroke="var(--amber)" stroke-width="1.5" stroke-dasharray="4 5"/>${points.map((p,i)=>`<text x="${x(i)}" y="219" text-anchor="middle">${p.label}</text>${p.start<=TODAY?`<circle cx="${x(i)}" cy="${y(p.a)}" r="3.5" fill="var(--surface)" stroke="var(--brand)" stroke-width="2"><title>${p.label}：确认 ${p.a}h，未确认 ${p.p}h</title></circle>`:''}`).join('')}</svg></div>`;
}
function memberBars(id=null){const rows=scopeEntries(id),data=people.map(p=>({...p,a:sum(rows.filter(e=>e.userId===p.id&&e.status==='approved')),p:sum(rows.filter(e=>e.userId===p.id&&e.status==='pending'))})).filter(p=>p.a+p.p>0).sort((a,b)=>b.a+b.p-a.a-a.p),max=Math.max(1,...data.map(p=>p.a+p.p));return data.map(p=>`<button class="allocation-row text-btn" data-member="${p.id}" style="width:100%;text-align:left"><span class="line">${personLabel(p.id)}<span class="number">${h(p.a)} <small>h${p.p?` <span class="amber-text">+ ${h(p.p)} 待确认</span>`:''}</small></span></span><span class="bar"><span class="approved" style="width:${p.a/max*100}%"></span><span class="pending" style="width:${p.p/max*100}%"></span></span></button>`).join('')||'<div class="empty">本周期暂无成员投入</div>';}
function projectStatsTable(){
  const rows=visibleProjects().map(p=>({p,t:totals(p.id)}));
  return `<div class="section-heading"><h2>项目投入明细</h2><small>点击项目查看任务与工时</small></div><div class="table-wrap task-table-desktop"><table><thead><tr><th>项目</th><th class="num">任务预估 · 累计</th><th class="num">本周期确认</th><th class="num">本周期未确认</th><th class="num">完结偏差 · 累计</th><th></th></tr></thead><tbody>${rows.map(({p,t})=>`<tr><td><a href="#project-${p.id}" data-project="${p.id}" data-hours="true">${esc(p.name)}</a><p>${projectTasks(p.id).length} 项任务 · ${labels[p.status]}</p></td><td class="num number">${h(t.estimate)}h</td><td class="num number">${h(t.approved)}h</td><td class="num number amber-text">${h(t.pending)}h</td><td class="num number ${t.delta>0?'red-text':'green-text'}">${t.comparable?(t.delta>0?'+':'')+h(t.delta)+'h':'暂无可比任务'}</td><td><a href="#project-${p.id}" data-project="${p.id}" data-hours="true" aria-label="查看${esc(p.name)}工时">${icon('arrow-up-right')}</a></td></tr>`).join('')}</tbody></table></div><div class="mobile-task-cards">${rows.map(({p,t})=>`<a href="#project-${p.id}" data-project="${p.id}" data-hours="true" class="mobile-task"><div class="line"><b>${esc(p.name)}</b>${icon('arrow-up-right')}</div><p>${projectTasks(p.id).length} 项任务 · 完结累计偏差 ${t.comparable?(t.delta>0?'+':'')+h(t.delta)+'h':'暂无可比任务'}</p><div class="numbers"><span><small>累计预估</small>${h(t.estimate)}h</span><span><small>本周期确认</small>${h(t.approved)}h</span><span class="amber-text"><small>本周期未确认</small>${h(t.pending)}h</span></div></a>`).join('')}</div><div class="list-caption"><span>共 ${rows.length} 个项目 · 预估与偏差为累计口径</span><span>工时单位：小时</span></div>`;
}
function memberTable(id=null){const rows=scopeEntries(id);return `<div class="section-heading"><div><h2>成员投入明细</h2><p>统计当前周期，项目数按实际参与记录计算</p></div>${legend()}</div>${memberBars(id)}<div class="table-wrap"><table><thead><tr><th>成员</th><th class="num">参与项目</th><th class="num">参与任务</th><th class="num">已确认</th><th class="num">未确认</th><th class="num">已退回</th></tr></thead><tbody>${people.filter(p=>scopeEntries(id,false).some(e=>e.userId===p.id)).map(p=>{const es=rows.filter(e=>e.userId===p.id),valid=es.filter(e=>['pending','approved'].includes(e.status));return `<tr><td>${personLabel(p.id)}</td><td class="num">${new Set(valid.map(e=>task(e.taskId).projectId)).size}</td><td class="num">${new Set(valid.map(e=>e.taskId)).size}</td><td class="num number">${h(sum(es.filter(e=>e.status==='approved')))}h</td><td class="num number amber-text">${h(sum(es.filter(e=>e.status==='pending')))}h</td><td class="num">${es.filter(e=>e.status==='returned').length} 条</td></tr>`;}).join('')}</tbody></table></div>`;}
function dailyTable(id=null){const rows=scopeEntries(id).filter(e=>['approved','pending'].includes(e.status)),dates=[...new Set(rows.map(e=>e.date))].sort().reverse();return `<div class="section-heading"><h2>每日投入明细</h2><small>按工作日期归属</small></div><div class="table-wrap"><table><thead><tr><th>工作日期</th><th class="num">参与人数</th><th class="num">已确认</th><th class="num">未确认</th></tr></thead><tbody>${dates.map(d=>{const es=rows.filter(e=>e.date===d);return `<tr><td class="mono">${d}</td><td class="num">${new Set(es.map(e=>e.userId)).size}</td><td class="num number">${h(sum(es.filter(e=>e.status==='approved')))}h</td><td class="num number amber-text">${h(sum(es.filter(e=>e.status==='pending')))}h</td></tr>`;}).join('')}</tbody></table>${dates.length?'':'<div class="empty">本周期暂无投入记录</div>'}</div>`;}
function taskSection(id){return `<div class="table-top"><h2>任务工时 <small>项目累计</small></h2><div class="head-actions"><label class="search-box">${icon('search')}<input id="task-search" aria-label="搜索任务" placeholder="搜索任务或编号" value="${esc(state.query)}"></label><select class="control" id="task-filter" aria-label="任务状态">${[['all','全部状态'],['open','进行中'],['review','待验收'],['done','已完成']].map(([v,l])=>`<option value="${v}" ${state.filter===v?'selected':''}>${l}</option>`).join('')}</select></div></div><div id="tasks">${taskList(id)}</div>`;}
function taskList(id){const rows=projectTasks(id).filter(t=>(state.filter==='all'||t.status===state.filter)&&(`${t.id} ${t.title}`.includes(state.query.trim())));return `<div class="table-wrap task-table-desktop"><table><thead><tr><th>任务 / 所属模块</th><th>负责人</th><th class="num">预估</th><th class="num">累计确认</th><th class="num">未确认</th><th>状态</th></tr></thead><tbody>${rows.map(t=>`<tr><td><button class="task-link" data-task="${t.id}">${icon(t.status==='done'?'circle-check':'circle-dashed')}<span class="task-text">${esc(t.title)}<small>#${t.id} · ${esc(t.module)}</small></span></button></td><td>${personLabel(t.assignee)}</td><td class="num number">${t.estimate==null?'未预估':h(t.estimate)+'h'}</td><td class="num number">${t.legacy?'未记录':h(approved(t.id))+'h'}</td><td class="num number amber-text">${h(pending(t.id))}h</td><td>${badge(t.status)}</td></tr>`).join('')}</tbody></table></div><div class="mobile-task-cards">${rows.map(t=>`<a href="#task-${t.id}" class="mobile-task" data-task="${t.id}"><div class="line"><b>${esc(t.title)}</b>${badge(t.status)}</div><p>#${t.id} · ${person(t.assignee).name} · ${esc(t.module)}</p><div class="numbers"><span><small>预估</small>${t.estimate==null?'未预估':h(t.estimate)+'h'}</span><span><small>累计确认</small>${t.legacy?'未记录':h(approved(t.id))+'h'}</span><span class="amber-text"><small>未确认</small>${h(pending(t.id))}h</span></div></a>`).join('')}</div>${rows.length?'':'<div class="empty">没有符合条件的任务</div>'}<div class="list-caption"><span>共 ${rows.length} 项任务 · 历史缺失不按零计算</span><span>新任务预估必填</span></div>`;}
function navigate(view){state.view=view;state.tab='overview';state.query='';state.filter='all';state.member=null;state.tag='all';state.hoursTab='overview';render();window.scrollTo(0,0);}
function openProject(id,hours=false){if(!visible(project(id)))return;state.projectId=Number(id);state.view='project';state.tab=hours&&admin()?'hours':'tasks';state.hoursTab='overview';state.query='';state.filter='all';state.todoScope='all';render();window.scrollTo(0,0);}
function bindDomain(root=document){
  root.querySelectorAll('[data-nav]').forEach(el=>el.onclick=e=>{e.preventDefault();navigate(el.dataset.nav);});
  root.querySelectorAll('[data-project]').forEach(el=>el.onclick=e=>{e.preventDefault();openProject(el.dataset.project,Boolean(el.dataset.hours));});
  root.querySelectorAll('[data-task]').forEach(el=>el.onclick=e=>{e.preventDefault();openTask(Number(el.dataset.task));});
  root.querySelectorAll('[data-action]').forEach(el=>el.onclick=()=>action(el.dataset.action));
  root.querySelectorAll('[data-tab]').forEach(el=>el.onclick=()=>{state.tab=el.dataset.tab;render();});
  root.querySelectorAll('[data-period]').forEach(el=>el.onclick=()=>{state.period=el.dataset.period;state.offset=0;render();});
  root.querySelectorAll('[data-offset]').forEach(el=>el.onclick=()=>{state.offset=Math.min(0,state.offset+Number(el.dataset.offset));render();});
  root.querySelectorAll('[data-filter]').forEach(el=>el.onclick=()=>{state.filter=el.dataset.filter;render();});
  root.querySelectorAll('[data-member]').forEach(el=>el.onclick=()=>memberDetail(el.dataset.member));
  root.querySelectorAll('[data-edit-entry]').forEach(el=>el.onclick=()=>logForm(null,Number(el.dataset.editEntry)));
  if($('#role'))$('#role').onchange=e=>{state.role=e.target.value;state.myProject='all';state.myStatus='all';$('#detail').close();$('#form-dialog').close();navigate('basket');};
  if($('#search'))$('#search').oninput=e=>{state.query=e.target.value;$('#project-list').innerHTML=projectList();bind($('#project-list'));paintIcons();};
  if($('#task-search'))$('#task-search').oninput=e=>{state.query=e.target.value;$('#tasks').innerHTML=taskList(state.projectId);bind($('#tasks'));paintIcons();};
  for(const selector of ['#task-filter','#entry-filter'])if($(selector))$(selector).onchange=e=>{state.filter=e.target.value;render();};
}
function openTask(id){const t=task(id);if(!t||!visible(project(t.projectId)))return;state.taskId=id;renderTask();if(!$('#detail').open)$('#detail').showModal();}
function memberDetail(id){if(!admin())return;const pid=state.view==='project'?state.projectId:null,rows=scopeEntries(pid).filter(e=>e.userId===id),a=sum(rows.filter(e=>e.status==='approved'));modal(`${person(id).name}的投入`,`${contextName()} · 当前统计周期`,`<div class="form-summary"><span>已确认 / 未确认</span><b class="number">${h(a)}h / ${h(sum(rows.filter(e=>e.status==='pending')))}h</b></div>${visibleProjects().filter(p=>rows.some(e=>task(e.taskId).projectId===p.id)).map(p=>`<div class="audit-row"><span>${esc(p.name)}</span><b class="number">${h(sum(rows.filter(e=>task(e.taskId).projectId===p.id&&e.status==='approved')))}h</b></div>`).join('')||'<div class="empty">本周期暂无投入</div>'}<p class="hint">成员汇总按填报人计算，任务改派不改变历史归属。</p>`,'知道了',()=>$('#form-dialog').close());}
function modal(title,subtitle,body,label,onSubmit,wide=false){const dialog=$('#form-dialog');dialog.className=wide?'form-wide':'';dialog.innerHTML=`<form id="entry-form" novalidate><header class="dialog-header"><div><h2 id="form-title">${title}</h2><p>${esc(subtitle)}</p></div><button class="btn quiet icon" type="button" data-close-form aria-label="关闭表单">${icon('x')}</button></header><div class="dialog-body">${body}<p class="error" id="form-error" role="alert"></p></div><footer class="dialog-footer"><button type="button" class="btn" data-close-form>取消</button><button class="btn primary" type="submit">${label}</button></footer></form>`;dialog.querySelectorAll('[data-close-form]').forEach(el=>el.onclick=()=>dialog.close());$('#entry-form').onsubmit=e=>{e.preventDefault();$('#form-error').textContent='';dialog.querySelectorAll('.error-field').forEach(el=>el.textContent='');dialog.querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));try{onSubmit(new FormData(e.target));}catch(error){if(error.field&&$('#'+error.field)){const input=$('#'+error.field);input.setAttribute('aria-invalid','true');$('#'+error.field+'-error').textContent=error.message;input.focus();}else $('#form-error').textContent=error.message;}};paintIcons();if(!dialog.open)dialog.showModal();}
function invalid(field,message){const error=new Error(message);error.field=field;throw error;}
function field(id,label,control,hint=''){return `<div class="field"><label for="${id}">${label}</label>${control}<p>${hint}</p><span class="error-field" id="${id}-error" role="alert"></span></div>`;}
function requiredEstimate(value,id){const n=Number(value);if(!String(value).trim()||!Number.isFinite(n)||n<.25||n>10000||!Number.isInteger(n*4))invalid(id,'请填写预估工时：0.25 至 10,000 小时，按 0.25 小时递增。');return n*60;}
function refresh(message){$('#form-dialog').close();render();if($('#detail').open)renderTask();if(message)toast(message);}
function minutes(value,id,zero=false){const n=Number(value);if(!String(value).trim()||!Number.isFinite(n)||n<(zero?0:.25)||n>24||!Number.isInteger(n*4))invalid(id,`请填写 ${zero?'0':'0.25'} 至 24 小时，按 0.25 小时递增。`);return n*60;}
function validateDate(value,id){const d=new Date(value+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==value||value<'2026-09-01'||value>TODAY)invalid(id,'请选择 2026-09-01 至 2026-09-22 之间的工作日期。');}
function dailyLimit(date,n,skip){if(sum(entries.filter(e=>e.userId===user()&&e.date===date&&e.id!==skip&&['approved','pending'].includes(e.status)))+n>1440)throw new Error('当天跨项目累计投入不能超过 24 小时。');}
function estimateForm(){const t=task(state.taskId);if(!canCreateTask(project(t.projectId)))return;modal('调整任务预估',t.title,`${field('estimate-hours','预估工时 / 小时 <em>*</em>',`<input id="estimate-hours" name="hours" type="number" min="0.25" max="10000" step="0.25" value="${t.estimate==null?'':h(t.estimate)}">`,`初始预估：${t.initialEstimate==null?'历史未预估':h(t.initialEstimate)+'h'}。调整不会改变已记录的实际投入。`)}${field('estimate-reason','调整原因 <em>*</em>','<textarea id="estimate-reason" name="reason" maxlength="500" placeholder="说明任务范围或预估依据的变化"></textarea>')}`,'保存预估',form=>{const n=requiredEstimate(form.get('hours'),'estimate-hours'),reason=String(form.get('reason')).trim();if(!reason)invalid('estimate-reason','请填写调整原因。');const before=t.estimate;t.estimate=n;event(`#${t.id} 预估由 ${before==null?'未预估':h(before)+'h'} 调整为 ${h(n)}h：${reason}`);refresh('预估已更新，初始值与变更原因保留');});}
function exportCsv(){if(state.view==='ledger')return exportMyCsv();if(!admin())return;const rows=scopeEntries(state.view==='project'?state.projectId:null);const cell=v=>{const s=String(v);return '"'+(/^[=+@-]/.test(s)?"'":'')+s.replaceAll('"','""')+'"';};const csv='\uFEFF'+[['项目','任务','工作日期','填报人','工时','状态'],...rows.map(e=>[project(task(e.taskId).projectId).name,task(e.taskId).title,e.date,person(e.userId).name,h(e.minutes),labels[e.status]])].map(r=>r.map(cell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='Veges-工时明细.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已导出当前周期内有权查看的流水');}
document.addEventListener('input',e=>{if(e.target.closest('#form-dialog')){e.target.removeAttribute('aria-invalid');const error=document.getElementById(e.target.id+'-error');if(error)error.textContent='';}});
window.matchMedia('(max-width: 760px)').addEventListener('change',()=>document.querySelectorAll('[data-chart]').forEach(el=>{el.innerHTML=chart(Number(el.dataset.chart)||null,el.hasAttribute('data-personal-chart'));}));
