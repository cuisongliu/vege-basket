import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Archive,
  ArrowRight,
  Check,
  Clock,
  DotsThree,
  CaretDown,
  CaretLeft,
  CaretRight,
  PencilSimple,
  DownloadSimple,
  FileText,
  Lightbulb,
  MagnifyingGlass,
  NotePencil,
  PaperPlaneTilt,
  Plus,
  SignIn,
  SignOut,
  Sparkle,
  Target,
  Tray,
  Trash,
  WarningCircle,
  ArrowLeft,
} from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  archiveDraft,
  createDraft,
  createJournalEntry,
  createProject,
  createRiskFromJournal,
  createSummary,
  createSummaryFromContent,
  createTodo,
  fetchCurrentUser,
  getAuthToken,
  loginAccount,
  registerAccount,
  clearAuthToken,
  removeDraft,
  removeJournalEntry,
  removeProject,
  removeTodo,
  resolveRisk,
  updateJournalEntry,
  updateProject,
  updateTodo,
  setAuthToken,
  sendAiChat,
  updateCurrentUser,
  type AiChatMessage,
  type AuthUser,
  type WorkspaceData,
} from './api'
import type {
  InboxItem,
  JournalEntry,
  Priority,
  Project,
  ProjectStatus,
  Summary,
  Todo,
} from './types'
import './App.css'

type View = 'project' | 'inbox' | 'search' | 'summaries'
type DisplayAiChatMessage = AiChatMessage & { createdAt: string }

function getShanghaiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(date)

  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    time: `${pick('hour')}:${pick('minute')}:${pick('second')}`,
  }
}

function getTodayStamp() {
  return getShanghaiDateParts().date
}

function getCurrentDateTimeStamp() {
  const parts = getShanghaiDateParts()
  return `${parts.date} ${parts.time}`
}

function addDays(dateStamp: string, delta: number) {
  const [year, month, day] = dateStamp.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + delta)
  return formatDateStamp(date)
}

function formatDateStamp(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatMonthTitle(year: number, month: number) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month, 1))
}

const today = getTodayStamp()

const statusCopy: Record<ProjectStatus, string> = {
  active: '进行中',
  paused: '暂停',
  completed: '已结束',
  archived: '归档',
}

const priorityCopy: Record<Priority, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

const initialProjects: Project[] = [
  {
    id: 1,
    name: 'AIGC 内容工作台',
    status: 'active',
    createdAt: '2026-05-12 09:40',
    updatedAt: '今天 15:20',
    tags: ['AI', '内容生产', 'MVP'],
    risks: ['模型输出质量波动，需要确认评估标准'],
    journals: [
      {
        id: 101,
        createdAt: `${today} 15:20:00`,
        content:
          '确认第一版以批量生成和人工精修为核心，不做复杂团队协作。下一步需要整理内容模板和评估维度。',
      },
      {
        id: 102,
        createdAt: '2026-05-14 18:40:00',
        content:
          '和设计侧讨论了编辑器结构，决定先保留单栏写作体验，把素材面板放到右侧抽屉。',
      },
    ],
  },
  {
    id: 2,
    name: '数据看板重构',
    status: 'active',
    createdAt: '2026-05-10 14:20',
    updatedAt: '今天 11:05',
    tags: ['数据', '体验优化'],
    risks: ['旧指标口径不一致，可能影响上线验收'],
    journals: [
      {
        id: 201,
        createdAt: `${today} 11:05:00`,
        content:
          '梳理了核心指标口径，发现转化漏斗和留存报表的数据源不一致，需要约业务方统一定义。',
      },
    ],
  },
  {
    id: 3,
    name: '内部知识库迁移',
    status: 'paused',
    createdAt: '2026-05-08 10:15',
    updatedAt: '昨天 18:40',
    tags: ['知识库', '迁移'],
    risks: ['历史文档质量参差，自动整理前需要抽样检查'],
    journals: [
      {
        id: 301,
        createdAt: '2026-05-14 19:06:00',
        content:
          '导入了第一批历史 Markdown。暂时不做结构化解析，先进入草稿箱，后续用 AI 帮助归类。',
      },
    ],
  },
  {
    id: 4,
    name: '支付链路稳定性',
    status: 'completed',
    createdAt: '2026-05-01 16:30',
    updatedAt: '05-12 17:30',
    tags: ['交易', '稳定性'],
    risks: [],
    journals: [
      {
        id: 401,
        createdAt: '2026-05-12 17:30:00',
        content: '完成异常重试策略复盘，产出上线后监控清单。',
      },
    ],
  },
]

const initialTodos: Todo[] = [
  {
    id: 1,
    projectId: 1,
    title: '整理内容模板的评估维度',
    dueDate: today,
    priority: 'high',
    done: false,
  },
  {
    id: 2,
    projectId: 2,
    title: '约业务方确认转化漏斗口径',
    dueDate: today,
    priority: 'high',
    done: false,
  },
  {
    id: 3,
    projectId: 3,
    title: '抽样检查 20 篇迁移文档',
    dueDate: '2026-05-17',
    priority: 'medium',
    done: false,
  },
  {
    id: 4,
    projectId: 4,
    title: '补充监控清单归档链接',
    dueDate: '2026-05-13',
    priority: 'low',
    done: true,
  },
]

const initialInbox: InboxItem[] = [
  {
    id: 1,
    source: 'manual',
    content:
      '想到一个 AIGC 工作台的关键点：生成结果需要能按品牌语气做二次筛选，不只是批量产出。',
    createdAt: '今天 14:42',
    suggestedProjectId: 1,
    processed: false,
  },
  {
    id: 2,
    source: 'feishu',
    content:
      '飞书群转发：业务方反馈数据看板里“激活用户”的口径和周报不一致，希望本周先统一。',
    createdAt: '今天 10:18',
    suggestedProjectId: 2,
    processed: false,
  },
  {
    id: 3,
    source: 'manual',
    content: '知识库迁移可以先用 AI 做主题聚类，但不要自动改原文。',
    createdAt: '昨天 19:06',
    suggestedProjectId: 3,
    processed: true,
  },
]

const initialSummaries: Summary[] = [
  {
    id: 1,
    projectId: 1,
    type: 'weekly',
    title: '第 20 周周总结',
    period: '2026-05-11 至 2026-05-15',
    createdAt: '今天 15:35',
    content:
      '本周明确了 AIGC 内容工作台的第一版边界：批量生成、人工精修、模板评估。主要风险是模型输出质量稳定性，建议下周先建立小样本评估表。',
  },
]

function App() {
  const [loggedIn, setLoggedIn] = useState(Boolean(getAuthToken()))
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authError, setAuthError] = useState('')
  const [view, setView] = useState<View>('search')
  const [projects, setProjects] = useState(initialProjects)
  const [todos, setTodos] = useState(initialTodos)
  const [inbox, setInbox] = useState(initialInbox)
  const [summaries, setSummaries] = useState(initialSummaries)
  const [selectedProjectId, setSelectedProjectId] = useState(1)
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false)
  const [workspaceError, setWorkspaceError] = useState('')
  const [journalDraft, setJournalDraft] = useState('')
  const [inboxDraft, setInboxDraft] = useState('')
  const [todoDraft, setTodoDraft] = useState('')
  const [todoDueDate, setTodoDueDate] = useState(today)
  const [todoPriority, setTodoPriority] = useState<Priority>('medium')
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectTags, setNewProjectTags] = useState('')
  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all')
  const [tagFilter, setTagFilter] = useState('全部')
  const initialAiMessages: DisplayAiChatMessage[] = []
  const [aiMessages, setAiMessages] = useState<DisplayAiChatMessage[]>(initialAiMessages)
  const [aiDraft, setAiDraft] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')

  const applyWorkspace = useCallback((data: WorkspaceData) => {
    setProjects(data.projects)
    setTodos(data.todos)
    setInbox(data.inbox)
    setSummaries(data.summaries)
    setSelectedProjectId((current) => {
      if (data.projects.some((project) => project.id === current)) return current
      return data.projects[0]?.id ?? current
    })
  }, [])

  useEffect(() => {
    if (!loggedIn) return

    fetchCurrentUser()
      .then((data) => {
        setAuthUser(data.user)
        applyWorkspace(data.workspace)
        setWorkspaceError('')
      })
      .catch(() => {
        clearAuthToken()
        setLoggedIn(false)
        setWorkspaceError('')
        setAuthError('登录状态已失效，请重新登录。')
      })
      .finally(() => setWorkspaceLoaded(true))
  }, [applyWorkspace, loggedIn])

  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? projects[0]

  const todayJournal = selectedProject?.journals.find((entry) =>
    entry.createdAt.startsWith(today),
  )

  const projectTodos = selectedProject
    ? todos.filter((todo) => todo.projectId === selectedProject.id)
    : []
  const allTags = ['全部', ...Array.from(new Set(projects.flatMap((p) => p.tags)))]

  const filteredResults = useMemo(() => {
    const query = search.trim().toLowerCase()
    return projects.filter((project) => {
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter
      const matchesTag = tagFilter === '全部' || project.tags.includes(tagFilter)
      const projectText = [
        project.name,
        project.tags.join(' '),
        project.journals.map((entry) => entry.content).join(' '),
        todos
          .filter((todo) => todo.projectId === project.id)
          .map((todo) => todo.title)
          .join(' '),
        summaries
          .filter((summary) => summary.projectId === project.id)
          .map((summary) => summary.content)
          .join(' '),
      ]
        .join(' ')
        .toLowerCase()
      const matchesQuery = !query || projectText.includes(query)
      return matchesStatus && matchesTag && matchesQuery
    })
  }, [projects, search, statusFilter, summaries, tagFilter, todos])

  async function signIn(email: string, password: string, mode: 'login' | 'register') {
    setAuthError('')
    try {
      const result =
        mode === 'register'
          ? await registerAccount({ email, password })
          : await loginAccount({ email, password })
      setAuthToken(result.token)
      setAuthUser(result.user)
      applyWorkspace(result.workspace)
      setLoggedIn(true)
      setWorkspaceLoaded(true)
    } catch {
      setAuthError(mode === 'register' ? '注册失败，请确认邮箱未被使用且密码不少于 6 位。' : '登录失败，请检查邮箱和密码。')
    }
  }

  function signOut() {
    clearAuthToken()
    setLoggedIn(false)
    setAuthUser(null)
    setAuthError('')
    setWorkspaceError('')
    setWorkspaceLoaded(false)
  }

  async function updateDisplayName(displayName: string) {
    const nextDisplayName = displayName.trim()
    if (!nextDisplayName) return

    try {
      const result = await updateCurrentUser({ displayName: nextDisplayName })
      setAuthUser(result.user)
      setWorkspaceError('')
    } catch {
      setWorkspaceError('昵称更新失败，请稍后再试。')
    }
  }

  async function runMutation(operation: () => Promise<WorkspaceData>) {
    try {
      const data = await operation()
      applyWorkspace(data)
      setWorkspaceError('')
      return data
    } catch {
      setWorkspaceError('操作没有写入数据库，请确认后端服务和数据库连接正常。')
      return null
    }
  }

  function selectProject(projectId: number) {
    setSelectedProjectId(projectId)
    setJournalDraft('')
    setView('project')
  }

  function changeNewProjectDialogOpen(open: boolean) {
    setIsNewProjectDialogOpen(open)
    if (!open) {
      setNewProjectName('')
      setNewProjectTags('')
    }
  }

  async function addProject() {
    const name = newProjectName.trim()
    if (!name) return

    const tags = newProjectTags
      .split(/[\s,，、]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)

    const data = await runMutation(() =>
      createProject({ name, tags: tags.length > 0 ? tags : ['新项目'] }),
    )
    const createdProject = data?.projects.find((project) => project.name === name)
    if (createdProject) setSelectedProjectId(createdProject.id)
    setNewProjectName('')
    setNewProjectTags('')
    setJournalDraft('')
    setIsNewProjectDialogOpen(false)
    setView(createdProject ? 'project' : 'search')
  }

  async function saveJournal() {
    const content = journalDraft.trim()
    if (!content || !selectedProject) return

    await runMutation(() => createJournalEntry(selectedProject.id, content))
    setJournalDraft('')
  }

  async function renameProject(projectId: number, name: string) {
    const nextName = name.trim()
    if (!nextName) return

    await runMutation(() => updateProject(projectId, { name: nextName }))
  }

  async function updateProjectStatus(projectId: number, status: ProjectStatus) {
    await runMutation(() => updateProject(projectId, { status }))
  }

  async function deleteProject(projectId: number) {
    const nextProject = projects.find((project) => project.id !== projectId)
    await runMutation(() => removeProject(projectId))
    setSelectedProjectId(nextProject?.id ?? 0)
    setJournalDraft('')
    setTodoDraft('')
    setTodoDueDate(today)
    setTodoPriority('medium')
    setView('project')
  }

  async function deleteJournalEntry(projectId: number, entryId: number) {
    await runMutation(() => removeJournalEntry(projectId, entryId))
  }

  async function editJournalEntry(projectId: number, entryId: number, content: string) {
    const nextContent = content.trim()
    if (!nextContent) return

    await runMutation(() => updateJournalEntry(projectId, entryId, nextContent))
  }

  async function markJournalAsRisk(projectId: number, entryId: number) {
    await runMutation(() => createRiskFromJournal(projectId, entryId))
  }

  async function resolveProjectRisk(projectId: number, content: string) {
    await runMutation(() => resolveRisk(projectId, content))
  }

  async function addInboxItem() {
    const content = inboxDraft.trim()
    if (!content) return
    await runMutation(() =>
      createDraft({ content, suggestedProjectId: selectedProject?.id }),
    )
    setInboxDraft('')
  }

  async function archiveInboxItem(item: InboxItem, projectId: number) {
    await runMutation(() => archiveDraft(item.id, projectId))
  }

  async function deleteInboxItem(itemId: number) {
    await runMutation(() => removeDraft(itemId))
  }

  async function addTodo(projectId?: number) {
    const title = todoDraft.trim()
    const targetProjectId = projectId ?? selectedProject?.id
    if (!title || !targetProjectId) return
    await runMutation(() =>
      createTodo({
        projectId: targetProjectId,
        title,
        dueDate: todoDueDate,
        priority: todoPriority,
      }),
    )
    setTodoDraft('')
    setTodoDueDate(today)
    setTodoPriority('medium')
  }

  async function toggleTodo(todoId: number) {
    const todo = todos.find((item) => item.id === todoId)
    if (!todo) return
    await runMutation(() => updateTodo(todoId, { done: !todo.done }))
  }

  async function deleteTodo(todoId: number) {
    await runMutation(() => removeTodo(todoId))
  }

  async function generateSummary(projectId: number, type: Summary['type']) {
    await runMutation(() => createSummary(projectId, type))
    setView('summaries')
  }

  async function generateSummaryFromAiMessage(message: DisplayAiChatMessage) {
    const content = message.content.trim()
    const projectId = selectedProject?.id ?? projects[0]?.id
    if (!content || !projectId) return

    await runMutation(() =>
      createSummaryFromContent({
        content,
        projectId,
        title: `${message.createdAt.slice(0, 10)} AI 生成总结`,
        type: 'weekly',
      }),
    )
  }

  async function sendAgentMessage() {
    const content = aiDraft.trim()
    if (!content || aiBusy) return

    const nextMessages: DisplayAiChatMessage[] = [
      ...aiMessages,
      { role: 'user', content, createdAt: getCurrentDateTimeStamp() },
    ]
    setAiMessages(nextMessages)
    setAiDraft('')
    setAiBusy(true)
    setAiError('')

    try {
      const result = await sendAiChat(
        nextMessages.map(({ role, content: messageContent }) => ({
          role,
          content: messageContent,
        })),
      )
      setAiMessages([
        ...nextMessages,
        {
          role: 'assistant',
          content: result.message,
          createdAt: getCurrentDateTimeStamp(),
        },
      ])
    } catch {
      setAiError('AI Agent 暂时没有响应，请检查后端服务或 API 配置。')
    } finally {
      setAiBusy(false)
    }
  }

  function exportMarkdown(projectId?: number) {
    const targets = projectId
      ? projects.filter((project) => project.id === projectId)
      : projects
    const body = targets
      .map((project) => {
        const projectTodosText = todos
          .filter((todo) => todo.projectId === project.id)
          .map((todo) => `- [${todo.done ? 'x' : ' '}] ${todo.title}`)
          .join('\n')
        const journalsText = project.journals
          .map((entry) => `### ${entry.createdAt}\n\n${entry.content}`)
          .join('\n\n')
        const summariesText = summaries
          .filter((summary) => summary.projectId === project.id)
          .map((summary) => `### ${summary.title}\n\n${summary.content}`)
          .join('\n\n')

        return `# ${project.name}

状态：${statusCopy[project.status]}
标签：${project.tags.join('、')}
最近更新：${project.updatedAt}

## 日记

${journalsText || '暂无日记'}

## 待办

${projectTodosText || '暂无待办'}

## 总结

${summariesText || '暂无总结'}`
      })
      .join('\n\n---\n\n')

    const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = projectId ? `${targets[0]?.name}.md` : '项目驾驶舱导出.md'
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!loggedIn) {
    return <LoginScreen error={authError} onSignIn={signIn} />
  }

  if (!workspaceLoaded && !authUser) {
    return <WorkspaceBootScreen />
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="brand-block">
          <div className="brand-mark">PM</div>
          <div>
            <p className="eyebrow">个人项目驾驶舱</p>
            <h1>项目篮子</h1>
          </div>
        </div>
        <nav className="nav-list">
          <NavButton active={view === 'search'} onClick={() => setView('search')}>
            <Target size={18} weight="duotone" /> 项目篮子
          </NavButton>
          <NavButton active={view === 'inbox'} onClick={() => setView('inbox')}>
            <Tray size={18} weight="duotone" /> 草稿箱
          </NavButton>
          <NavButton active={view === 'summaries'} onClick={() => setView('summaries')}>
            <FileText size={18} weight="duotone" /> AI 总结
          </NavButton>
        </nav>
        <AccountMenu
          user={authUser}
          onRename={updateDisplayName}
          onSignOut={signOut}
        />
      </aside>

      <section className={view === 'project' ? 'workspace cockpit-workspace' : 'workspace'}>
        <header className="topbar">
          <div>
            <div className="topbar-title-row">
              {view === 'project' && (
                <Button
                  className="detail-back-button"
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="返回项目篮子"
                  title="返回项目篮子"
                  onClick={() => setView('search')}
                >
                  <ArrowLeft size={18} />
                </Button>
              )}
              <h2>{getViewTitle(view, selectedProject?.name ?? '项目篮子')}</h2>
              {view === 'project' && selectedProject && (
                <ProjectTags tags={selectedProject.tags} />
              )}
            </div>
          </div>
          <div className="topbar-actions">
            <Button className="ghost-button" variant="outline" type="button" onClick={() => exportMarkdown()}>
              <DownloadSimple size={17} /> 批量导出
            </Button>
            {view === 'search' ? (
              <Dialog
                open={isNewProjectDialogOpen}
                onOpenChange={changeNewProjectDialogOpen}
              >
                <DialogTrigger asChild>
                  <Button className="solid-button" type="button">
                    <Plus size={17} /> 新建项目
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>新建项目</DialogTitle>
                    <DialogDescription>
                      先建立一个新的项目篮子，之后可以继续补充日记、待办和风险。
                    </DialogDescription>
                  </DialogHeader>
                  <form
                    className="new-project-dialog-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      addProject()
                    }}
                  >
                    <Label>
                      项目名称
                      <Input
                        autoFocus
                        aria-label="新项目名称"
                        placeholder="例如：增长实验复盘"
                        required
                        value={newProjectName}
                        onChange={(event) => setNewProjectName(event.target.value)}
                      />
                    </Label>
                    <Label>
                      标签
                      <Input
                        aria-label="项目标签"
                        placeholder="可选，用逗号或空格分隔"
                        value={newProjectTags}
                        onChange={(event) => setNewProjectTags(event.target.value)}
                      />
                    </Label>
                    <DialogFooter>
                      <Button
                        className="ghost-button"
                        variant="outline"
                        type="button"
                        onClick={() => changeNewProjectDialogOpen(false)}
                      >
                        取消
                      </Button>
                      <Button className="solid-button" type="submit">
                        <Plus size={15} /> 创建项目
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            ) : (
              <Button className="solid-button" type="button" onClick={() => setView('inbox')}>
                <Plus size={17} /> 快速捕捉
              </Button>
            )}
          </div>
        </header>

        {(!workspaceLoaded || workspaceError) && (
          <div className={workspaceError ? 'sync-banner error' : 'sync-banner'}>
            {workspaceError || '正在从数据库同步工作区...'}
          </div>
        )}

        {view === 'project' && selectedProject && (
          <ProjectDetail
            exportMarkdown={exportMarkdown}
            generateSummary={generateSummary}
            journalDraft={journalDraft}
            onAddTodo={addTodo}
            onDraftChange={setJournalDraft}
            onSaveJournal={saveJournal}
            onRenameProject={renameProject}
            onUpdateProjectStatus={updateProjectStatus}
            onDeleteProject={deleteProject}
            onDeleteJournalEntry={deleteJournalEntry}
            onEditJournalEntry={editJournalEntry}
            onMarkJournalAsRisk={markJournalAsRisk}
            onResolveRisk={resolveProjectRisk}
            onDeleteTodo={deleteTodo}
            onTodoDueDateChange={setTodoDueDate}
            onTodoDraftChange={setTodoDraft}
            onTodoPriorityChange={setTodoPriority}
            onToggleTodo={toggleTodo}
            project={selectedProject}
            projects={projects}
            projectTodos={projectTodos}
            todoDueDate={todoDueDate}
            todoDraft={todoDraft}
            todoPriority={todoPriority}
            todayJournal={todayJournal}
          />
        )}

        {view === 'project' && !selectedProject && (
          <EmptyWorkspace
            isNewProjectDialogOpen={isNewProjectDialogOpen}
            newProjectName={newProjectName}
            newProjectTags={newProjectTags}
            onAddProject={addProject}
            onNewProjectDialogOpenChange={changeNewProjectDialogOpen}
            onNewProjectNameChange={setNewProjectName}
            onNewProjectTagsChange={setNewProjectTags}
          />
        )}

        {view === 'inbox' && (
          <InboxView
            archiveInboxItem={archiveInboxItem}
            inbox={inbox}
            inboxDraft={inboxDraft}
            onAddInboxItem={addInboxItem}
            onDeleteInboxItem={deleteInboxItem}
            onDraftChange={setInboxDraft}
            projects={projects}
          />
        )}

        {view === 'search' && (
          <SearchView
            allTags={allTags}
            filteredResults={filteredResults}
            search={search}
            statusFilter={statusFilter}
            tagFilter={tagFilter}
            onProjectClick={selectProject}
            onSearchChange={setSearch}
            onStatusChange={setStatusFilter}
            onTagChange={setTagFilter}
          />
        )}

        {view === 'summaries' && (
          <SummaryView
            aiBusy={aiBusy}
            aiDraft={aiDraft}
            aiError={aiError}
            aiMessages={aiMessages}
            onAiDraftChange={setAiDraft}
            onCreateSummaryFromAiMessage={generateSummaryFromAiMessage}
            onResetAiChat={() => {
              setAiMessages(initialAiMessages)
              setAiDraft('')
              setAiError('')
            }}
            onSendAgentMessage={sendAgentMessage}
            projects={projects}
            summaries={summaries}
          />
        )}
      </section>
    </main>
  )
}

function WorkspaceBootScreen() {
  return (
    <main className="workspace-boot-screen" aria-busy="true">
      <div className="workspace-boot-panel">
        <div className="brand-mark">PM</div>
        <div>
          <p className="eyebrow">个人项目驾驶舱</p>
          <h1>正在同步工作区</h1>
          <p>稍等一下，正在连接线上数据。</p>
        </div>
      </div>
    </main>
  )
}

function LoginScreen({
  error,
  onSignIn,
}: {
  error: string
  onSignIn: (email: string, password: string, mode: 'login' | 'register') => void
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  return (
    <main className="login-screen">
      <section className="login-panel">
        <div className="login-copy">
          <div className="login-brand-title">Veges</div>
          <div className="login-copy-body">
            <p className="eyebrow">Personal project cockpit</p>
            <h1>每天重新接上每个项目的上下文。</h1>
            <p>
              把不同项目的进展、决策、风险、待办和聊天线索放回对应篮子里，让你从早上打开产品的第一分钟就知道今天该推进什么。
            </p>
          </div>
        </div>
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault()
            onSignIn(email, password, mode)
          }}
        >
          <div className="auth-mode-switch">
            <Button
              className={mode === 'login' ? 'auth-mode active' : 'auth-mode'}
              type="button"
              variant="ghost"
              onClick={() => setMode('login')}
            >
              登录
            </Button>
            <Button
              className={mode === 'register' ? 'auth-mode active' : 'auth-mode'}
              type="button"
              variant="ghost"
              onClick={() => setMode('register')}
            >
              注册
            </Button>
          </div>
          <Label>
            邮箱
            <Input
              autoComplete="email"
              placeholder="you@example.com"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Label>
          <Label>
            密码
            <Input
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              minLength={6}
              placeholder="至少 6 位"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Label>
          {error && <p className="form-error">{error}</p>}
          <Button className="solid-button wide" type="submit">
            <SignIn size={18} /> {mode === 'register' ? '创建账号' : '进入驾驶舱'}
          </Button>
          <p className="form-note">
            {mode === 'register'
              ? '注册后会创建你的个人工作区，密码会加密保存。'
              : '使用你注册时设置的邮箱和密码登录。'}
          </p>
        </form>
      </section>
    </main>
  )
}

function NavButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <Button
      className={active ? 'nav-button active' : 'nav-button'}
      variant="ghost"
      onClick={onClick}
      type="button"
    >
      {children}
    </Button>
  )
}

function ProjectTags({
  compact = false,
  tags,
}: {
  compact?: boolean
  tags: string[]
}) {
  if (tags.length === 0) return null

  return (
    <span className={compact ? 'project-tags compact' : 'project-tags'}>
      {tags.slice(0, compact ? 2 : 3).map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
      {tags.length > (compact ? 2 : 3) && <span>+{tags.length - (compact ? 2 : 3)}</span>}
    </span>
  )
}

function getUserDisplayName(user: AuthUser | null) {
  if (!user) return 'Veges'
  return user.displayName || user.email.split('@')[0] || user.email
}

function AccountMenu({
  user,
  onRename,
  onSignOut,
}: {
  user: AuthUser | null
  onRename: (displayName: string) => void
  onSignOut: () => void
}) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [displayNameDraft, setDisplayNameDraft] = useState(getUserDisplayName(user))
  const displayName = getUserDisplayName(user)
  const accountMeta = user?.email ?? '尚未登录'

  return (
    <div className="sidebar-footer">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="account-trigger" variant="outline" type="button">
            <span className="account-status-dot" aria-hidden />
            <span className="account-copy">
              <strong>{displayName}</strong>
              <small>{accountMeta}</small>
            </span>
            <CaretDown size={16} weight="bold" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="account-menu-content">
          <DropdownMenuItem
            onSelect={() => {
              setDisplayNameDraft(displayName)
              setRenameDialogOpen(true)
            }}
          >
            <PencilSimple /> 修改昵称
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onSignOut} variant="destructive">
            <SignOut /> 退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改昵称</DialogTitle>
            <DialogDescription>
              昵称会显示在左下角账号卡片里，仅用于你的个人工作区识别。
            </DialogDescription>
          </DialogHeader>
          <form
            className="new-project-dialog-form"
            onSubmit={(event) => {
              event.preventDefault()
              onRename(displayNameDraft)
              setRenameDialogOpen(false)
            }}
          >
            <Label>
              昵称
              <Input
                autoFocus
                maxLength={32}
                required
                value={displayNameDraft}
                onChange={(event) => setDisplayNameDraft(event.target.value)}
              />
            </Label>
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => setRenameDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit">保存昵称</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EmptyWorkspace({
  isNewProjectDialogOpen,
  newProjectName,
  newProjectTags,
  onAddProject,
  onNewProjectDialogOpenChange,
  onNewProjectNameChange,
  onNewProjectTagsChange,
}: {
  isNewProjectDialogOpen: boolean
  newProjectName: string
  newProjectTags: string
  onAddProject: () => void
  onNewProjectDialogOpenChange: (open: boolean) => void
  onNewProjectNameChange: (value: string) => void
  onNewProjectTagsChange: (value: string) => void
}) {
  return (
    <Card className="panel empty-workspace">
      <p className="eyebrow">新的个人工作区</p>
      <h3>先创建第一个项目篮子。</h3>
      <p>
        每个项目都会拥有自己的日记、待办、风险和总结。创建后就可以开始记录今天的上下文。
      </p>
      <Dialog
        open={isNewProjectDialogOpen}
        onOpenChange={onNewProjectDialogOpenChange}
      >
        <DialogTrigger asChild>
          <Button className="solid-button" type="button">
            <Plus size={17} /> 创建第一个项目
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>
              先建立一个新的项目篮子，之后可以继续补充日记、待办和风险。
            </DialogDescription>
          </DialogHeader>
          <form
            className="new-project-dialog-form"
            onSubmit={(event) => {
              event.preventDefault()
              onAddProject()
            }}
          >
            <Label>
              项目名称
              <Input
                autoFocus
                aria-label="新项目名称"
                placeholder="例如：增长实验复盘"
                required
                value={newProjectName}
                onChange={(event) => onNewProjectNameChange(event.target.value)}
              />
            </Label>
            <Label>
              标签
              <Input
                aria-label="项目标签"
                placeholder="可选，用逗号或空格分隔"
                value={newProjectTags}
                onChange={(event) => onNewProjectTagsChange(event.target.value)}
              />
            </Label>
            <DialogFooter>
              <Button
                className="ghost-button"
                variant="outline"
                type="button"
                onClick={() => onNewProjectDialogOpenChange(false)}
              >
                取消
              </Button>
              <Button className="solid-button" type="submit">
                <Plus size={15} /> 创建项目
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function ProjectDetail({
  exportMarkdown,
  generateSummary,
  journalDraft,
  onAddTodo,
  onDraftChange,
  onSaveJournal,
  onRenameProject,
  onUpdateProjectStatus,
  onDeleteProject,
  onDeleteJournalEntry,
  onEditJournalEntry,
  onMarkJournalAsRisk,
  onResolveRisk,
  onDeleteTodo,
  onTodoDueDateChange,
  onTodoDraftChange,
  onTodoPriorityChange,
  onToggleTodo,
  project,
  projects,
  projectTodos,
  todoDueDate,
  todoDraft,
  todoPriority,
  todayJournal,
}: {
  exportMarkdown: (projectId?: number) => void
  generateSummary: (projectId: number, type: Summary['type']) => void
  journalDraft: string
  onAddTodo: () => void
  onDraftChange: (value: string) => void
  onSaveJournal: () => void
  onRenameProject: (projectId: number, name: string) => void
  onUpdateProjectStatus: (projectId: number, status: ProjectStatus) => void
  onDeleteProject: (projectId: number) => void
  onDeleteJournalEntry: (projectId: number, entryId: number) => void
  onEditJournalEntry: (
    projectId: number,
    entryId: number,
    content: string,
  ) => void
  onMarkJournalAsRisk: (projectId: number, entryId: number) => void
  onResolveRisk: (projectId: number, content: string) => void
  onDeleteTodo: (todoId: number) => void
  onTodoDueDateChange: (value: string) => void
  onTodoDraftChange: (value: string) => void
  onTodoPriorityChange: (value: Priority) => void
  onToggleTodo: (id: number) => void
  project: Project
  projects: Project[]
  projectTodos: Todo[]
  todoDueDate: string
  todoDraft: string
  todoPriority: Priority
  todayJournal?: JournalEntry
}) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [projectNameDraft, setProjectNameDraft] = useState(project.name)
  const [editingJournalId, setEditingJournalId] = useState<number | null>(null)
  const [journalEditDraft, setJournalEditDraft] = useState('')
  const journalDates = useMemo(
    () => Array.from(new Set(project.journals.map((entry) => entry.createdAt.slice(0, 10)))),
    [project.journals],
  )
  const defaultJournalDate = journalDates.includes(today)
    ? today
    : journalDates[0] ?? today
  const [selectedJournalDate, setSelectedJournalDate] = useState(defaultJournalDate)
  const visibleJournals = project.journals.filter((entry) =>
    entry.createdAt.startsWith(selectedJournalDate),
  )

  useEffect(() => {
    setSelectedJournalDate(defaultJournalDate)
    setEditingJournalId(null)
    setJournalEditDraft('')
  }, [defaultJournalDate, project.id])

  useEffect(() => {
    if (journalDates.length > 0 && !journalDates.includes(selectedJournalDate)) {
      setSelectedJournalDate(defaultJournalDate)
    }
  }, [defaultJournalDate, journalDates, selectedJournalDate])

  return (
    <div className="detail-layout">
      <Card className="panel journal-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">项目日记</p>
            <div className="project-title-row">
              <h3>{project.name}</h3>
              <ProjectTags tags={project.tags} />
            </div>
          </div>
          <div className="project-header-actions">
            <div className="project-status-control">
              <span>项目状态</span>
              <Select
                value={project.status}
                onValueChange={(value) =>
                  onUpdateProjectStatus(project.id, value as ProjectStatus)
                }
              >
                <SelectTrigger aria-label="修改项目状态">
                  <SelectValue placeholder="选择状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">进行中</SelectItem>
                  <SelectItem value="paused">暂停</SelectItem>
                  <SelectItem value="completed">已结束</SelectItem>
                  <SelectItem value="archived">归档</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <ProjectActionsMenu
              exportProject={() => exportMarkdown(project.id)}
              generateWeeklySummary={() => generateSummary(project.id, 'weekly')}
              onDeleteProject={() => onDeleteProject(project.id)}
              onRenameClick={() => {
                setProjectNameDraft(project.name)
                setRenameDialogOpen(true)
              }}
              projectName={project.name}
            />
          </div>
          <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>重命名项目</DialogTitle>
                <DialogDescription>
                  修改后会同步更新项目列表和当前详情页标题。
                </DialogDescription>
              </DialogHeader>
              <form
                className="new-project-dialog-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  onRenameProject(project.id, projectNameDraft)
                  setRenameDialogOpen(false)
                }}
              >
                <Label>
                  项目名称
                  <Input
                    autoFocus
                    required
                    value={projectNameDraft}
                    onChange={(event) => setProjectNameDraft(event.target.value)}
                  />
                </Label>
                <DialogFooter>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => setRenameDialogOpen(false)}
                  >
                    取消
                  </Button>
                  <Button type="submit">保存名称</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
        <article className="today-note">
          <div className="note-date">
            <Clock size={17} /> 最新记录 · {todayJournal?.createdAt ?? today}
          </div>
          <p>{todayJournal?.content ?? '今天还没有项目日记。'}</p>
        </article>
        <Label className="textarea-label">
          追加今日记录
          <Textarea
            placeholder="记录今天的进展、决策、问题或方案..."
            value={journalDraft}
            onChange={(event) => onDraftChange(event.target.value)}
          />
        </Label>
        <Button className="solid-button" type="button" onClick={onSaveJournal}>
          <NotePencil size={17} /> 保存到今日日记
        </Button>

        <div className="history-list">
          {visibleJournals.length > 0 ? (
            visibleJournals.map((entry) => (
              <article className="history-item" key={entry.id}>
                <div className="history-item-header">
                  <time>{entry.createdAt}</time>
                  <span className="history-actions">
                    <Button
                      className="history-edit-button"
                      variant="ghost"
                      size="icon"
                      type="button"
                      aria-label="编辑日记"
                      title="编辑日记"
                      onClick={() => {
                        setEditingJournalId(entry.id)
                        setJournalEditDraft(entry.content)
                      }}
                    >
                      <PencilSimple size={15} />
                    </Button>
                    <Button
                      className="history-risk-button"
                      variant="ghost"
                      size="icon"
                      type="button"
                      aria-label="标记为风险"
                      title="标记为风险"
                      onClick={() => onMarkJournalAsRisk(project.id, entry.id)}
                    >
                      <WarningCircle size={15} />
                    </Button>
                    <ConfirmDialog
                      confirmLabel="删除日记"
                      description={`这条 ${entry.createdAt} 的日记删除后将无法在当前预览数据中恢复。`}
                      onConfirm={() => onDeleteJournalEntry(project.id, entry.id)}
                      title="确认删除这条日记？"
                      trigger={
                        <Button
                          className="history-delete-button"
                          variant="ghost"
                          size="icon"
                          type="button"
                          aria-label="删除日记"
                        >
                          <Trash size={15} />
                        </Button>
                      }
                    />
                  </span>
                </div>
                {editingJournalId === entry.id ? (
                  <form
                    className="journal-edit-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const nextContent = journalEditDraft.trim()
                      if (!nextContent) return
                      onEditJournalEntry(project.id, entry.id, nextContent)
                      setEditingJournalId(null)
                      setJournalEditDraft('')
                    }}
                  >
                    <Textarea
                      autoFocus
                      aria-label="编辑日记内容"
                      value={journalEditDraft}
                      onChange={(event) => setJournalEditDraft(event.target.value)}
                    />
                    <div className="journal-edit-actions">
                      <Button
                        className="ghost-button"
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEditingJournalId(null)
                          setJournalEditDraft('')
                        }}
                      >
                        取消
                      </Button>
                      <Button
                        className="solid-button"
                        type="submit"
                        disabled={!journalEditDraft.trim()}
                      >
                        保存修改
                      </Button>
                    </div>
                  </form>
                ) : (
                  <p>{entry.content}</p>
                )}
              </article>
            ))
          ) : (
            <p className="empty-state">这一天还没有日记记录。</p>
          )}
        </div>
        <div className="journal-pagination" aria-label="日记日期选择">
          <Button
            className="ghost-button"
            type="button"
            variant="outline"
            onClick={() => {
              setSelectedJournalDate((date) => addDays(date, -1))
              setEditingJournalId(null)
              setJournalEditDraft('')
            }}
          >
            上一天
          </Button>
          <JournalDatePicker
            datesWithEntries={journalDates}
            value={selectedJournalDate}
            onChange={(date) => {
              setSelectedJournalDate(date)
              setEditingJournalId(null)
              setJournalEditDraft('')
            }}
          />
          <span>{visibleJournals.length} 条</span>
          <Button
            className="ghost-button"
            type="button"
            variant="outline"
            onClick={() => {
              setSelectedJournalDate((date) => addDays(date, 1))
              setEditingJournalId(null)
              setJournalEditDraft('')
            }}
          >
            下一天
          </Button>
        </div>
      </Card>

      <Card className="panel side-panel">
        <PanelTitle icon={<Check size={18} />} title="项目待办" />
        <div className="todo-form">
          <Input
            placeholder="添加一个下一步..."
            value={todoDraft}
            onChange={(event) => onTodoDraftChange(event.target.value)}
          />
          <div className="todo-form-meta">
            <JournalDatePicker
              ariaLabel="待办截止日期"
              datesWithEntries={[]}
              value={todoDueDate}
              onChange={onTodoDueDateChange}
            />
            <Select
              value={todoPriority}
              onValueChange={(value) => onTodoPriorityChange(value as Priority)}
            >
              <SelectTrigger aria-label="待办优先级">
                <SelectValue placeholder="优先级" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="high">高优先级</SelectItem>
                <SelectItem value="medium">中优先级</SelectItem>
                <SelectItem value="low">低优先级</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="solid-button wide" type="button" onClick={() => onAddTodo()}>
            <Plus size={17} /> 添加待办
          </Button>
        </div>
        <TodoList
          todos={projectTodos}
          projects={projects}
          onDeleteTodo={onDeleteTodo}
          onToggleTodo={onToggleTodo}
          compact
        />
        <div className="side-section">
          <PanelTitle icon={<WarningCircle size={18} />} title="风险与阻塞" />
          <div className="risk-list">
            {project.risks.length > 0 ? (
              project.risks.map((risk) => (
                <article key={risk} className="risk-item">
                  <div className="risk-item-header">
                    <strong>{project.name}</strong>
                    <Button
                      className="risk-resolve-button"
                      variant="ghost"
                      type="button"
                      aria-label="解决风险"
                      title="解决风险"
                      onClick={() => onResolveRisk(project.id, risk)}
                    >
                      解决
                    </Button>
                  </div>
                  <p>{risk}</p>
                </article>
              ))
            ) : (
              <p className="empty-state">当前项目还没有记录风险。</p>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}

function JournalDatePicker({
  ariaLabel = '选择日期',
  datesWithEntries,
  onChange,
  value,
}: {
  ariaLabel?: string
  datesWithEntries: string[]
  onChange: (date: string) => void
  value: string
}) {
  const selectedDate = new Date(`${value}T00:00:00`)
  const [displayMonth, setDisplayMonth] = useState(() => ({
    month: selectedDate.getMonth(),
    year: selectedDate.getFullYear(),
  }))
  const entryDates = useMemo(() => new Set(datesWithEntries), [datesWithEntries])
  const firstDay = new Date(displayMonth.year, displayMonth.month, 1)
  const firstWeekday = firstDay.getDay()
  const daysInMonth = new Date(displayMonth.year, displayMonth.month + 1, 0).getDate()
  const previousMonthDays = new Date(displayMonth.year, displayMonth.month, 0).getDate()
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const dayOffset = index - firstWeekday + 1
    const date =
      dayOffset < 1
        ? new Date(displayMonth.year, displayMonth.month - 1, previousMonthDays + dayOffset)
        : dayOffset > daysInMonth
          ? new Date(displayMonth.year, displayMonth.month + 1, dayOffset - daysInMonth)
          : new Date(displayMonth.year, displayMonth.month, dayOffset)
    return {
      currentMonth: date.getMonth() === displayMonth.month,
      day: date.getDate(),
      stamp: formatDateStamp(date),
    }
  })

  useEffect(() => {
    const date = new Date(`${value}T00:00:00`)
    setDisplayMonth({ month: date.getMonth(), year: date.getFullYear() })
  }, [value])

  function changeMonth(delta: number) {
    setDisplayMonth((current) => {
      const date = new Date(current.year, current.month + delta, 1)
      return { month: date.getMonth(), year: date.getFullYear() }
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={ariaLabel}
          className="journal-date-trigger"
          type="button"
          variant="outline"
        >
          {value}
          <CaretDown size={13} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="journal-calendar" sideOffset={8}>
        <div className="journal-calendar-header">
          <button type="button" aria-label="上个月" onClick={() => changeMonth(-1)}>
            <CaretLeft size={18} />
          </button>
          <strong>{formatMonthTitle(displayMonth.year, displayMonth.month)}</strong>
          <button type="button" aria-label="下个月" onClick={() => changeMonth(1)}>
            <CaretRight size={18} />
          </button>
        </div>
        <div className="journal-calendar-weekdays">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="journal-calendar-grid">
          {calendarDays.map((day) => (
            <DropdownMenuItem
              className={[
                'journal-calendar-day',
                day.currentMonth ? '' : 'outside',
                entryDates.has(day.stamp) ? 'has-entry' : '',
                day.stamp === value ? 'selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              key={day.stamp}
              onSelect={() => onChange(day.stamp)}
            >
              {day.day}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ConfirmDialog({
  confirmLabel,
  description,
  onConfirm,
  title,
  trigger,
}: {
  confirmLabel: string
  description: string
  onConfirm: () => void
  title: string
  trigger: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            className="destructive-button"
            type="button"
            onClick={() => {
              onConfirm()
              setOpen(false)
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProjectActionsMenu({
  exportProject,
  generateWeeklySummary,
  onDeleteProject,
  onRenameClick,
  projectName,
}: {
  exportProject: () => void
  generateWeeklySummary: () => void
  onDeleteProject: () => void
  onRenameClick: () => void
  projectName: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="project-menu-trigger"
          variant="outline"
          size="icon"
          type="button"
          aria-label="打开项目操作菜单"
        >
          <DotsThree size={19} weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onRenameClick}>
          <PencilSimple /> 重命名
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={exportProject}>
          <DownloadSimple /> 导出项目
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={generateWeeklySummary}>
          <Sparkle /> 生成周总结
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <ConfirmDialog
          confirmLabel="删除项目"
          description={`删除「${projectName}」后，这个项目下的日记、待办和总结都会从当前工作区移除。`}
          onConfirm={onDeleteProject}
          title="确认删除这个项目？"
          trigger={
            <DropdownMenuItem
              onSelect={(event) => event.preventDefault()}
              variant="destructive"
            >
              <Trash /> 删除项目
            </DropdownMenuItem>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function InboxView({
  archiveInboxItem,
  inbox,
  inboxDraft,
  onAddInboxItem,
  onDeleteInboxItem,
  onDraftChange,
  projects,
}: {
  archiveInboxItem: (item: InboxItem, projectId: number) => void
  inbox: InboxItem[]
  inboxDraft: string
  onAddInboxItem: () => void
  onDeleteInboxItem: (itemId: number) => void
  onDraftChange: (value: string) => void
  projects: Project[]
}) {
  return (
    <div className="inbox-layout">
      <Card className="panel capture-panel">
        <PanelTitle icon={<Tray size={18} />} title="快速捕捉" />
        <Label className="textarea-label capture-textarea-label">
          新线索
          <span className="capture-input-wrap">
            <Textarea
              placeholder="把会议记录、聊天片段、想法或解决方案先丢进来..."
              value={inboxDraft}
              onChange={(event) => onDraftChange(event.target.value)}
            />
            <Button className="solid-button capture-submit-button" type="button" onClick={onAddInboxItem}>
              <PaperPlaneTilt size={17} /> 放入今日草稿箱
            </Button>
          </span>
        </Label>
      </Card>

      <Card className="panel inbox-list-panel">
      <PanelTitle icon={<Archive size={18} />} title="待归档内容" />
        <div className="inbox-list">
          {inbox.map((item) => (
            <article className={item.processed ? 'inbox-item processed' : 'inbox-item'} key={item.id}>
              <div className="inbox-meta">
                <span>{item.source === 'feishu' ? '飞书转发' : '手动记录'}</span>
                <span>{item.createdAt}</span>
              </div>
              <p>{item.content}</p>
              {item.suggestedProjectId && (
                <div className="suggestion">
                  <Lightbulb size={16} />
                  AI 建议归档到：
                  {projects.find((project) => project.id === item.suggestedProjectId)?.name}
                </div>
              )}
              {!item.processed && (
                <ArchiveControl
                  item={item}
                  projects={projects}
                  onArchive={archiveInboxItem}
                  onDelete={onDeleteInboxItem}
                />
              )}
            </article>
          ))}
        </div>
      </Card>
    </div>
  )
}

function ArchiveControl({
  item,
  onArchive,
  onDelete,
  projects,
}: {
  item: InboxItem
  onArchive: (item: InboxItem, projectId: number) => void
  onDelete: (itemId: number) => void
  projects: Project[]
}) {
  const suggestedProjectExists = projects.some(
    (project) => project.id === item.suggestedProjectId,
  )
  const defaultProjectId =
    suggestedProjectExists && item.suggestedProjectId
      ? item.suggestedProjectId
      : projects[0]?.id
  const [selectedProjectId, setSelectedProjectId] = useState(
    String(defaultProjectId ?? ''),
  )

  if (projects.length === 0) {
    return (
      <div className="archive-control empty">
        <p className="empty-state">先创建项目后再归档。</p>
        <ConfirmDialog
          confirmLabel="删除草稿"
          description="删除后，这条待归档内容会从今日草稿箱移除。"
          onConfirm={() => onDelete(item.id)}
          title="确认删除这条草稿？"
          trigger={
            <Button
              className="archive-delete-button"
              variant="ghost"
              type="button"
            >
              <Trash size={14} /> 删除
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="archive-control">
      <Label>
        归档项目
        <Select
          value={selectedProjectId}
          onValueChange={setSelectedProjectId}
        >
          <SelectTrigger>
            <SelectValue placeholder="选择项目" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((project) => (
              <SelectItem key={project.id} value={String(project.id)}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
      <Button
        className="archive-confirm-button"
        type="button"
        disabled={!selectedProjectId}
        onClick={() => onArchive(item, Number(selectedProjectId))}
      >
        确认归档
      </Button>
      <ConfirmDialog
        confirmLabel="删除草稿"
        description="删除后，这条待归档内容会从今日草稿箱移除。"
        onConfirm={() => onDelete(item.id)}
        title="确认删除这条草稿？"
        trigger={
          <Button
            className="archive-delete-button"
            variant="ghost"
            type="button"
          >
            <Trash size={14} /> 删除
          </Button>
        }
      />
    </div>
  )
}

function SearchView({
  allTags,
  filteredResults,
  onProjectClick,
  onSearchChange,
  onStatusChange,
  onTagChange,
  search,
  statusFilter,
  tagFilter,
}: {
  allTags: string[]
  filteredResults: Project[]
  onProjectClick: (id: number) => void
  onSearchChange: (value: string) => void
  onStatusChange: (value: ProjectStatus | 'all') => void
  onTagChange: (value: string) => void
  search: string
  statusFilter: ProjectStatus | 'all'
  tagFilter: string
}) {
  return (
    <Card className="panel search-panel">
      <div className="search-controls">
        <Label className="search-field">
          <span>关键词</span>
          <span className="search-input-wrap">
            <MagnifyingGlass size={16} />
            <Input
              placeholder="搜索项目、日记、待办、总结..."
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </span>
        </Label>
        <Label>
          状态
          <Select
            value={statusFilter}
            onValueChange={(value) => onStatusChange(value as ProjectStatus | 'all')}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="active">进行中</SelectItem>
              <SelectItem value="paused">暂停</SelectItem>
              <SelectItem value="completed">已结束</SelectItem>
              <SelectItem value="archived">归档</SelectItem>
            </SelectContent>
          </Select>
        </Label>
        <Label>
          标签
          <Select value={tagFilter} onValueChange={onTagChange}>
            <SelectTrigger>
              <SelectValue placeholder="选择标签" />
            </SelectTrigger>
            <SelectContent>
              {allTags.map((tag) => (
                <SelectItem key={tag} value={tag}>
                  {tag}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
      </div>
      <div className="search-results">
        {filteredResults.map((project) => (
          <button key={project.id} className="result-item" type="button" onClick={() => onProjectClick(project.id)}>
            <div>
              <div className="result-meta-row">
                <Badge className={`status-pill ${project.status}`}>{statusCopy[project.status]}</Badge>
                <span>创建于 {project.createdAt}</span>
              </div>
              <h3>{project.name}</h3>
              <p>{project.journals[0]?.content}</p>
            </div>
            <ArrowRight size={18} />
          </button>
        ))}
      </div>
    </Card>
  )
}

function SummaryView({
  aiBusy,
  aiDraft,
  aiError,
  aiMessages,
  onAiDraftChange,
  onCreateSummaryFromAiMessage,
  onResetAiChat,
  onSendAgentMessage,
  projects,
  summaries,
}: {
  aiBusy: boolean
  aiDraft: string
  aiError: string
  aiMessages: DisplayAiChatMessage[]
  onAiDraftChange: (value: string) => void
  onCreateSummaryFromAiMessage: (message: DisplayAiChatMessage) => void
  onResetAiChat: () => void
  onSendAgentMessage: () => void
  projects: Project[]
  summaries: Summary[]
}) {
  const [selectedSummaryId, setSelectedSummaryId] = useState<number | null>(null)
  const [isComposing, setIsComposing] = useState(false)
  const selectedSummary =
    summaries.find((summary) => summary.id === selectedSummaryId) ?? null
  const selectedProject = selectedSummary
    ? projects.find((project) => project.id === selectedSummary.projectId)
    : null

  return (
    <div className="summary-layout">
      <Card className="panel ai-agent-panel">
        <div className="agent-hero">
          <div className="agent-orb">
            V
          </div>
          <div>
            <h3>项目总结助理</h3>
            <p>Veges AI Agent</p>
          </div>
          <Button
            className="agent-new-chat-button"
            type="button"
            variant="ghost"
            size="icon"
            aria-label="新建对话"
            title="新建对话"
            onClick={onResetAiChat}
          >
            <Plus size={28} />
          </Button>
        </div>
        <div className="agent-messages">
          {aiMessages.map((message, index) => (
            <article
              className={`agent-message ${message.role}`}
              key={`${message.role}-${index}`}
            >
              <div className="agent-message-content">
                <MarkdownPreview content={message.content} compact />
              </div>
              {message.role === 'assistant' && (
                <div className="agent-message-footer">
                  <time className="agent-message-time">{message.createdAt}</time>
                  {index > 0 && (
                    <Button
                      className="agent-summary-button"
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="生成总结文档"
                      title="生成总结文档"
                      onClick={() => onCreateSummaryFromAiMessage(message)}
                    >
                      <FileText size={14} weight="bold" />
                    </Button>
                  )}
                </div>
              )}
            </article>
          ))}
          {aiBusy && (
            <article className="agent-message assistant">
              <div className="agent-message-content">
                <MarkdownPreview content="正在整理项目上下文..." compact />
              </div>
            </article>
          )}
        </div>
        {aiError && <p className="form-error">{aiError}</p>}
        <div className="agent-composer">
          <Textarea
            placeholder="例如：帮我生成本周所有进行中项目的总结，并列出下周最关键的 3 个动作..."
            value={aiDraft}
            onCompositionEnd={() => setIsComposing(false)}
            onCompositionStart={() => setIsComposing(true)}
            onChange={(event) => onAiDraftChange(event.target.value)}
            onKeyDown={(event) => {
              const nativeEvent = event.nativeEvent as KeyboardEvent
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !isComposing &&
                !nativeEvent.isComposing
              ) {
                event.preventDefault()
                onSendAgentMessage()
              }
            }}
          />
          <Button
            className="agent-send-button"
            type="button"
            disabled={aiBusy || !aiDraft.trim()}
            variant="ghost"
            size="icon"
            aria-label="发送消息"
            onClick={onSendAgentMessage}
          >
            <PaperPlaneTilt size={18} weight="bold" />
          </Button>
        </div>
      </Card>
      <Card className="panel summary-list">
        {selectedSummary ? (
          <SummaryDocumentDetail
            projectName={selectedProject?.name ?? '未命名项目'}
            summary={selectedSummary}
            onBack={() => setSelectedSummaryId(null)}
          />
        ) : (
          <SummaryDocumentList
            projects={projects}
            summaries={summaries}
            onSelect={setSelectedSummaryId}
          />
        )}
      </Card>
    </div>
  )
}

function SummaryDocumentList({
  onSelect,
  projects,
  summaries,
}: {
  onSelect: (id: number) => void
  projects: Project[]
  summaries: Summary[]
}) {
  return (
    <>
      <PanelTitle icon={<FileText size={18} />} title="总结文档" />
      <div className="summary-doc-list">
        {summaries.length === 0 ? (
          <p className="empty-state">还没有总结文档。</p>
        ) : (
          summaries.map((summary) => {
            const project = projects.find((item) => item.id === summary.projectId)
            return (
              <button
                className="summary-doc-item"
                key={summary.id}
                type="button"
                onClick={() => onSelect(summary.id)}
              >
                <span>{project?.name ?? '未命名项目'}</span>
                <strong>{summary.title}</strong>
                <small>{summary.period} · {summary.createdAt}</small>
              </button>
            )
          })
        )}
      </div>
    </>
  )
}

function SummaryDocumentDetail({
  onBack,
  projectName,
  summary,
}: {
  onBack: () => void
  projectName: string
  summary: Summary
}) {
  return (
    <article className="summary-doc-detail">
      <Button className="ghost-button summary-back-button" variant="outline" type="button" onClick={onBack}>
        <ArrowLeft size={15} /> 返回列表
      </Button>
      <div className="summary-doc-meta">
        <span>{projectName}</span>
        <span>{summary.createdAt}</span>
      </div>
      <h3>{summary.title}</h3>
      <small>{summary.period}</small>
      <MarkdownPreview content={summary.content} />
    </article>
  )
}

function MarkdownPreview({
  compact = false,
  content,
}: {
  compact?: boolean
  content: string
}) {
  const lines = content.split('\n')
  const blocks: ReactNode[] = []
  let index = 0

  function parseInline(text: string) {
    const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
    return parts.map((part, partIndex) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={partIndex}>{part.slice(2, -2)}</strong>
      }
      return <span key={partIndex}>{part}</span>
    })
  }

  function renderHeading(level: number, text: string, key: number) {
    if (level <= 1) return <h3 key={key}>{parseInline(text)}</h3>
    if (level === 2) return <h4 key={key}>{parseInline(text)}</h4>
    return <h5 key={key}>{parseInline(text)}</h5>
  }

  while (index < lines.length) {
    const text = lines[index].trim()

    if (!text) {
      index += 1
      continue
    }

    if (/^---+$/.test(text)) {
      blocks.push(<hr key={index} />)
      index += 1
      continue
    }

    const heading = text.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      blocks.push(renderHeading(heading[1].length, heading[2], index))
      index += 1
      continue
    }

    if (/^[-*]\s+/.test(text)) {
      const items: ReactNode[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        const item = lines[index].trim().replace(/^[-*]\s+/, '')
        items.push(<li key={index}>{parseInline(item)}</li>)
        index += 1
      }
      blocks.push(<ul key={`ul-${index}`}>{items}</ul>)
      continue
    }

    if (/^\d+[.)]\s+/.test(text)) {
      const items: ReactNode[] = []
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) {
        const item = lines[index].trim().replace(/^\d+[.)]\s+/, '')
        items.push(<li key={index}>{parseInline(item)}</li>)
        index += 1
      }
      blocks.push(<ol key={`ol-${index}`}>{items}</ol>)
      continue
    }

    if (/^[^：:]{2,12}[：:]/.test(text)) {
      const [title, ...rest] = text.split(/[：:]/)
      blocks.push(
        <section className="markdown-section" key={index}>
          <h4>{parseInline(title)}</h4>
          {rest.join('：').trim() && <p>{parseInline(rest.join('：').trim())}</p>}
        </section>,
      )
      index += 1
      continue
    }

    blocks.push(<p key={index}>{parseInline(text)}</p>)
    index += 1
  }

  return <div className={compact ? 'markdown-preview compact' : 'markdown-preview'}>{blocks}</div>
}

function TodoList({
  compact = false,
  onDeleteTodo,
  onToggleTodo,
  projects,
  todos,
}: {
  compact?: boolean
  onDeleteTodo: (id: number) => void
  onToggleTodo: (id: number) => void
  projects: Project[]
  todos: Todo[]
}) {
  if (todos.length === 0) {
    return <p className="empty-state">暂时没有待办。</p>
  }

  return (
    <div className={compact ? 'todo-list compact' : 'todo-list'}>
      {todos.map((todo) => {
        const project = projects.find((item) => item.id === todo.projectId)
        return (
          <article
            className={todo.done ? 'todo-item done' : 'todo-item'}
            key={todo.id}
          >
            <button
              className="checkmark"
              type="button"
              onClick={() => onToggleTodo(todo.id)}
              aria-label={todo.done ? '标记为未完成' : '标记为已完成'}
            >
              {todo.done ? <Check size={14} /> : null}
            </button>
            <span className="todo-main">
              <strong>{todo.title}</strong>
              <small>
                {compact ? `截止 ${todo.dueDate}` : `${project?.name} · 截止 ${todo.dueDate}`}
              </small>
            </span>
            <span className="todo-actions">
              <Badge className={`priority ${todo.priority}`}>
                {priorityCopy[todo.priority]}
              </Badge>
              <ConfirmDialog
                confirmLabel="删除待办"
                description={`删除「${todo.title}」后，这条待办将从当前项目移除。`}
                onConfirm={() => onDeleteTodo(todo.id)}
                title="确认删除这条待办？"
                trigger={
                  <Button
                    className="todo-delete-button"
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label="删除待办"
                  >
                    <Trash size={14} />
                  </Button>
                }
              />
            </span>
          </article>
        )
      })}
    </div>
  )
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <h3>{title}</h3>
    </div>
  )
}

function getViewTitle(view: View, projectName: string) {
  if (view === 'project') return projectName
  if (view === 'inbox') return '草稿箱'
  if (view === 'search') return '项目篮子'
  return 'AI 总结文档'
}

export default App
