import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  Archive,
  AddressBook,
  Bell,
  Check,
  CornersIn,
  CornersOut,
  DotsThree,
  CaretDown,
  CaretLeft,
  CaretRight,
  PencilSimple,
  DownloadSimple,
  FileText,
  ListChecks,
  MagnifyingGlass,
  NotePencil,
  ChatTeardropText,
  PaperPlaneTilt,
  Password,
  Plus,
  ShoppingCartSimple,
  SignIn,
  SignOut,
  Sparkle,
  Sun,
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
  addProjectPackageItems,
  archiveDraft,
  acceptProjectInvitation,
  createProjectModule,
  createDraft,
  createJournalEntry,
  createProjectPackageEvent,
  createProjectPackageOperation,
  createProject,
  createRiskFromJournal,
  createSummary,
  createSummaryFromContent,
  createTodo,
  createTodoNote,
  exportProjectPackageTimeline,
  fetchPackageMarketBaseDetail,
  fetchPackageMarketBaseReleaseVersions,
  fetchPackageMarketCiVersions,
  fetchPackageMarketDetail,
  fetchPackageMarketReleaseVersions,
  fetchPackageMarketRules,
  fetchProjectPackageTimeline,
  fetchWorkspace,
  fetchAiSettings,
  fetchCurrentUser,
  fetchNotifications,
  getAuthToken,
  inviteProjectMember,
  markNotificationRead,
  loginAccount,
  registerAccount,
  clearAuthToken,
  removeDraft,
  removeJournalEntry,
  removeProjectPackageEvent,
  removeProjectPackageGroup,
  removeProjectPackageOperation,
  removeProject,
  removeProjectModule,
  removeProjectMember,
  removeTodo,
  resolveRiskFromJournal,
  declineProjectInvitation,
  updateJournalEntry,
  updateProjectPackageEvent,
  updateProjectPackageOperation,
  updateProject,
  updateTodo,
  updateTodoNote,
  updateAiSettings,
  updateCurrentPassword,
  setAuthToken,
  sendAiChat,
  updateCurrentUser,
  type AiAgentType,
  type AiChatMessage,
  type AiSettings,
  type AuthUser,
  type WorkspaceData,
} from './api'
import type {
  InboxItem,
  JournalVisibility,
  PackageMarketChannel,
  PackageMarketDetail,
  PackageMarketRule,
  PackageMarketVersion,
  NotificationCenterData,
  Priority,
  Project,
  ProjectModule,
  ProjectPackageTimeline,
  ProjectPackageEventType,
  ProjectPackageOperationKind,
  ProjectMembership,
  ProjectStatus,
  Summary,
  Todo,
  TodoNote,
} from './types'
import {
  ProjectPackageWorkbench,
  type ProjectPackageWorkbenchHandle,
} from './components/project-package-workbench'
import './App.css'

type View = 'project' | 'inbox' | 'notifications' | 'search' | 'summaries' | 'todos'
type DisplayAiChatMessage = AiChatMessage & { createdAt: string }
type ThemeMode = 'dark' | 'light'
type TodoUpdatePayload = Omit<Partial<Todo>, 'assigneeUserId' | 'moduleId'> & {
  assigneeUserId?: number | null
  moduleId?: number | null
}
type AdaptivePageSizeOptions = {
  compact: boolean
  defaultPageSize: number
  itemHeight: number
  maxPageSize: number
  minPageSize: number
  pagerHeight?: number
  reservedHeight: (viewportHeight: number) => number
}
type MentionOption = {
  id: number
  name: string
  role: string
}
type ProjectDetailTab = 'journal' | 'packages'

const aiAgentMeta: Record<AiAgentType, { avatar: string; subtitle: string; title: string }> = {
  'project-summary': {
    avatar: 'V',
    subtitle: 'Veges AI Agent',
    title: '项目总结助理',
  },
  'conversation-analysis': {
    avatar: '析',
    subtitle: '群聊对话分析 Agent',
    title: '对话分析助理',
  },
}

const themeStorageKey = 'veges.theme'

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark'

  try {
    return window.localStorage.getItem(themeStorageKey) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

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

function getProjectJournalSortKey(project: Project) {
  return project.journals[0]?.createdAt ?? project.updatedAt ?? project.createdAt
}

function useAdaptivePageSize({
  compact,
  defaultPageSize,
  itemHeight,
  maxPageSize,
  minPageSize,
  pagerHeight = 0,
  reservedHeight,
}: AdaptivePageSizeOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [itemsPerPage, setItemsPerPage] = useState(defaultPageSize)

  useEffect(() => {
    if (!compact) return
    const containerElement = containerRef.current
    if (!containerElement) return

    function updatePageSize() {
      const viewportHeight = window.innerHeight
      const containerTop = containerElement!.getBoundingClientRect().top
      const availableHeight = Math.max(
        itemHeight * minPageSize,
        viewportHeight - containerTop - reservedHeight(viewportHeight) - pagerHeight,
      )
      const nextItemsPerPage = Math.max(
        minPageSize,
        Math.min(maxPageSize, Math.floor(availableHeight / itemHeight)),
      )
      setItemsPerPage(nextItemsPerPage)
    }

    const resizeObserver = new ResizeObserver(updatePageSize)
    resizeObserver.observe(containerElement)
    updatePageSize()
    window.addEventListener('resize', updatePageSize)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updatePageSize)
    }
  }, [compact, itemHeight, maxPageSize, minPageSize, pagerHeight, reservedHeight])

  return { containerRef, itemsPerPage }
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

function TodoConfirmSelect({
  confirmed,
  disabled = false,
  onChange,
}: {
  confirmed: boolean
  disabled?: boolean
  onChange: (confirmed: boolean) => void
}) {
  return (
    <Select
      disabled={disabled}
      value={confirmed ? 'confirmed' : 'pending'}
      onValueChange={(value) => onChange(value === 'confirmed')}
    >
      <SelectTrigger className={confirmed ? 'todo-confirm-select confirmed' : 'todo-confirm-select'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="pending">未确认</SelectItem>
        <SelectItem value="confirmed">已确认</SelectItem>
      </SelectContent>
    </Select>
  )
}

function compareCreatedAtDesc<T extends { createdAt: string; id: number }>(left: T, right: T) {
  const createdAtDelta = right.createdAt.localeCompare(left.createdAt)
  if (createdAtDelta !== 0) return createdAtDelta
  return right.id - left.id
}

const initialProjects: Project[] = [
  {
    id: 1,
    accessRole: 'owner',
    name: 'AIGC 内容工作台',
    ownerName: 'Felix',
    ownerUserId: 1,
    status: 'active',
    createdAt: '2026-05-12 09:40',
    updatedAt: '今天 15:20',
    tags: ['AI', '内容生产', 'MVP'],
    risks: ['模型输出质量波动，需要确认评估标准'],
    riskJournalEntryIds: [101],
    modules: [],
    journals: [
      {
        id: 101,
        createdAt: `${today} 15:20:00`,
        authorUserId: 1,
        speakerName: 'Felix',
        visibility: 'private',
        content:
          '确认第一版以批量生成和人工精修为核心，不做复杂团队协作。下一步需要整理内容模板和评估维度。',
      },
      {
        id: 102,
        createdAt: '2026-05-14 18:40:00',
        authorUserId: 1,
        speakerName: 'Felix',
        visibility: 'private',
        content:
          '和设计侧讨论了编辑器结构，决定先保留单栏写作体验，把素材面板放到右侧抽屉。',
      },
    ],
  },
  {
    id: 2,
    accessRole: 'owner',
    name: '数据看板重构',
    ownerName: 'Felix',
    ownerUserId: 1,
    status: 'active',
    createdAt: '2026-05-10 14:20',
    updatedAt: '今天 11:05',
    tags: ['数据', '体验优化'],
    risks: ['旧指标口径不一致，可能影响上线验收'],
    riskJournalEntryIds: [201],
    modules: [],
    journals: [
      {
        id: 201,
        createdAt: `${today} 11:05:00`,
        authorUserId: 1,
        speakerName: 'Felix',
        visibility: 'private',
        content:
          '梳理了核心指标口径，发现转化漏斗和留存报表的数据源不一致，需要约业务方统一定义。',
      },
    ],
  },
  {
    id: 3,
    accessRole: 'owner',
    name: '内部知识库迁移',
    ownerName: 'Felix',
    ownerUserId: 1,
    status: 'paused',
    createdAt: '2026-05-08 10:15',
    updatedAt: '昨天 18:40',
    tags: ['知识库', '迁移'],
    risks: ['历史文档质量参差，自动整理前需要抽样检查'],
    riskJournalEntryIds: [301],
    modules: [],
    journals: [
      {
        id: 301,
        createdAt: '2026-05-14 19:06:00',
        authorUserId: 1,
        speakerName: 'Felix',
        visibility: 'private',
        content:
          '导入了第一批历史 Markdown。暂时不做结构化解析，先进入草稿箱，后续用 AI 帮助归类。',
      },
    ],
  },
  {
    id: 4,
    accessRole: 'owner',
    name: '支付链路稳定性',
    ownerName: 'Felix',
    ownerUserId: 1,
    status: 'completed',
    createdAt: '2026-05-01 16:30',
    updatedAt: '05-12 17:30',
    tags: ['交易', '稳定性'],
    risks: [],
    riskJournalEntryIds: [],
    modules: [],
    journals: [
      {
        id: 401,
        createdAt: '2026-05-12 17:30:00',
        authorUserId: 1,
        speakerName: 'Felix',
        visibility: 'private',
        content: '完成异常重试策略复盘，产出上线后监控清单。',
      },
    ],
  },
]

const initialTodos: Todo[] = [
  {
    id: 1,
    projectId: 1,
    createdAt: `${today} 16:10:00`,
    title: '整理内容模板的评估维度',
    dueDate: today,
    priority: 'high',
    done: false,
    confirmed: false,
    notes: [],
  },
  {
    id: 2,
    projectId: 2,
    createdAt: `${today} 11:40:00`,
    title: '约业务方确认转化漏斗口径',
    dueDate: today,
    priority: 'high',
    done: false,
    confirmed: false,
    notes: [],
  },
  {
    id: 3,
    projectId: 3,
    createdAt: '2026-05-15 09:30:00',
    title: '抽样检查 20 篇迁移文档',
    dueDate: '2026-05-17',
    priority: 'medium',
    done: false,
    confirmed: false,
    notes: [],
  },
  {
    id: 4,
    projectId: 4,
    createdAt: '2026-05-12 16:20:00',
    title: '补充监控清单归档链接',
    dueDate: '2026-05-13',
    priority: 'low',
    done: true,
    confirmed: true,
    notes: [],
  },
]

const initialMemberships: ProjectMembership[] = []
const emptyNotifications: NotificationCenterData = {
  assignedTodos: [],
  dueTomorrowTodos: [],
  noteMentions: [],
  invites: [],
}

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
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialTheme)
  const [loggedIn, setLoggedIn] = useState(Boolean(getAuthToken()))
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authError, setAuthError] = useState('')
  const [view, setView] = useState<View>('search')
  const [projects, setProjects] = useState(initialProjects)
  const [todos, setTodos] = useState(initialTodos)
  const [memberships, setMemberships] = useState(initialMemberships)
  const [notifications, setNotifications] = useState(emptyNotifications)
  const [inbox, setInbox] = useState(initialInbox)
  const [summaries, setSummaries] = useState(initialSummaries)
  const [projectPackageTimelines, setProjectPackageTimelines] = useState<Record<number, ProjectPackageTimeline>>({})
  const [selectedProjectId, setSelectedProjectId] = useState(1)
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false)
  const [workspaceError, setWorkspaceError] = useState('')
  const [projectDetailTab, setProjectDetailTab] = useState<ProjectDetailTab>('journal')
  const [journalDraft, setJournalDraft] = useState('')
  const [inboxDraft, setInboxDraft] = useState('')
  const [todoDraft, setTodoDraft] = useState('')
  const [todoDueDate, setTodoDueDate] = useState(today)
  const [todoPriority, setTodoPriority] = useState<Priority>('medium')
  const [todoAssigneeUserId, setTodoAssigneeUserId] = useState<number | null>(null)
  const [todoModuleId, setTodoModuleId] = useState<number | null>(null)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectTags, setNewProjectTags] = useState('')
  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false)
  const [isProjectMembersDialogOpen, setIsProjectMembersDialogOpen] = useState(false)
  const [isProjectModulesDialogOpen, setIsProjectModulesDialogOpen] = useState(false)
  const [projectModuleDraft, setProjectModuleDraft] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all')
  const [tagFilter, setTagFilter] = useState('全部')
  const initialAiMessages: DisplayAiChatMessage[] = []
  const [aiMessages, setAiMessages] = useState<DisplayAiChatMessage[]>(initialAiMessages)
  const [aiDraft, setAiDraft] = useState('')
  const [activeAiAgent, setActiveAiAgent] = useState<AiAgentType>('project-summary')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const packageWorkbenchRef = useRef<ProjectPackageWorkbenchHandle>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', themeMode === 'dark')
    document.documentElement.dataset.theme = themeMode

    try {
      window.localStorage.setItem(themeStorageKey, themeMode)
    } catch {
      // Ignore storage failures so theme switching still works for the session.
    }
  }, [themeMode])

  const applyWorkspace = useCallback((data: WorkspaceData) => {
    setProjects(data.projects)
    setTodos(data.todos)
    setMemberships(data.memberships)
    setInbox(data.inbox)
    setSummaries(data.summaries)
    setProjectPackageTimelines((current) => {
      const next: Record<number, ProjectPackageTimeline> = {}
      for (const project of data.projects) {
        if (current[project.id]) next[project.id] = current[project.id]
      }
      return next
    })
    setSelectedProjectId((current) => {
      if (data.projects.some((project) => project.id === current)) return current
      return data.projects[0]?.id ?? current
    })
  }, [])

  const refreshNotifications = useCallback(async () => {
    try {
      const result = await fetchNotifications()
      setNotifications(result.notifications)
      return result.notifications
    } catch {
      return emptyNotifications
    }
  }, [])

  useEffect(() => {
    if (!loggedIn) return

    fetchCurrentUser()
      .then((data) => {
        setAuthUser(data.user)
        applyWorkspace(data.workspace)
        void refreshNotifications()
        setWorkspaceError('')
      })
      .catch(() => {
        clearAuthToken()
        setLoggedIn(false)
        setWorkspaceError('')
        setAuthError('登录状态已失效，请重新登录。')
      })
      .finally(() => setWorkspaceLoaded(true))
  }, [applyWorkspace, loggedIn, refreshNotifications])

  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? projects[0]

  useEffect(() => {
    if (!loggedIn || !selectedProject || projectDetailTab !== 'packages') return
    if (projectPackageTimelines[selectedProject.id]) return

    fetchProjectPackageTimeline(selectedProject.id)
      .then((timeline) => {
        setProjectPackageTimelines((current) => ({
          ...current,
          [selectedProject.id]: timeline,
        }))
      })
      .catch(() => {
        setWorkspaceError('安装升级时间线读取失败，请确认后端服务和 OSS 配置正常。')
      })
  }, [loggedIn, projectDetailTab, projectPackageTimelines, selectedProject])

  const toggleThemeMode = useCallback(() => {
    setThemeMode((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  const projectTodos = selectedProject
    ? todos.filter((todo) => todo.projectId === selectedProject.id)
    : []
  const allTags = ['全部', ...Array.from(new Set(projects.flatMap((p) => p.tags)))]

  const filteredResults = useMemo(() => {
    const query = search.trim().toLowerCase()
    return projects
      .filter((project) => {
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
      .sort((left, right) => {
        const journalDiff = getProjectJournalSortKey(right).localeCompare(
          getProjectJournalSortKey(left),
        )
        if (journalDiff !== 0) return journalDiff
        return right.id - left.id
      })
  }, [projects, search, statusFilter, summaries, tagFilter, todos])

  const openNotificationCount = useMemo(
    () =>
      notifications.invites.filter((item) => !item.dismissedAt).length +
      notifications.assignedTodos.filter((item) => !item.dismissedAt && !item.done).length +
      notifications.dueTomorrowTodos.filter((item) => !item.dismissedAt).length,
    [notifications],
  )

  async function signIn(username: string, password: string, mode: 'login' | 'register') {
    setAuthError('')
    try {
      const result =
        mode === 'register'
          ? await registerAccount({ username, password })
          : await loginAccount({ username, password })
      setAuthToken(result.token)
      setAuthUser(result.user)
      applyWorkspace(result.workspace)
      setLoggedIn(true)
      setWorkspaceLoaded(true)
      void refreshNotifications()
    } catch {
      setAuthError(mode === 'register' ? '注册失败，请确认用户名未被使用且密码不少于 6 位。' : '登录失败，请检查用户名和密码。')
    }
  }

  function signOut() {
    clearAuthToken()
    setLoggedIn(false)
    setAuthUser(null)
    setAuthError('')
    setWorkspaceError('')
    setWorkspaceLoaded(false)
    setNotifications(emptyNotifications)
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
      void refreshNotifications()
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
    setProjectDetailTab('journal')
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
      createProject({
        name,
        tags: tags.length > 0 ? tags : ['新项目'],
      }),
    )
    if (!data) return
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
    setTodoModuleId(null)
    setView('project')
  }

  async function deleteJournalEntry(projectId: number, entryId: number) {
    await runMutation(() => removeJournalEntry(projectId, entryId))
  }

  async function editJournalEntry(projectId: number, entryId: number, content: string) {
    const nextContent = content.trim()
    if (!nextContent) return

    await runMutation(() => updateJournalEntry(projectId, entryId, { content: nextContent }))
  }

  async function updateJournalVisibility(
    projectId: number,
    entryId: number,
    visibility: JournalVisibility,
  ) {
    await runMutation(() => updateJournalEntry(projectId, entryId, { visibility }))
  }

  async function toggleJournalRisk(projectId: number, entryId: number, isRiskEntry: boolean) {
    await runMutation(() =>
      isRiskEntry
        ? resolveRiskFromJournal(projectId, entryId)
        : createRiskFromJournal(projectId, entryId),
    )
  }

  async function addInboxItem() {
    const content = inboxDraft.trim()
    if (!content) return
    await runMutation(() =>
      createDraft({ content, suggestedProjectId: selectedProject?.id }),
    )
    setInboxDraft('')
  }

  async function inviteMember(projectId: number, username: string) {
    const nextUsername = username.trim()
    if (!nextUsername) return
    await runMutation(() => inviteProjectMember(projectId, { username: nextUsername }))
  }

  async function deleteMember(projectId: number, membershipId: number) {
    await runMutation(() => removeProjectMember(projectId, membershipId))
  }

  async function addProjectModule(projectId: number) {
    const name = projectModuleDraft.trim()
    if (!name) return
    const data = await runMutation(() => createProjectModule(projectId, { name }))
    if (!data) return
    setProjectModuleDraft('')
  }

  async function deleteProjectModule(projectId: number, moduleId: number) {
    const data = await runMutation(() => removeProjectModule(projectId, moduleId))
    if (!data) return
    if (todoModuleId === moduleId) {
      setTodoModuleId(null)
    }
  }

  async function archiveInboxItem(item: InboxItem, projectId: number) {
    await runMutation(() => archiveDraft(item.id, projectId))
  }

  async function deleteInboxItem(itemId: number) {
    await runMutation(() => removeDraft(itemId))
  }

  async function addTodo(projectId?: number) {
    const targetProjectId = projectId ?? selectedProject?.id
    const title = stripTodoMentions(todoDraft, getProjectMentionOptions(targetProjectId, projects, memberships)).trim()
    if (!title || !targetProjectId) return
    await runMutation(() =>
      createTodo({
        assigneeUserId: todoAssigneeUserId ?? undefined,
        moduleId: todoModuleId ?? undefined,
        projectId: targetProjectId,
        title,
        dueDate: todoDueDate,
        priority: todoPriority,
      }),
    )
    setTodoDraft('')
    setTodoDueDate(today)
    setTodoPriority('medium')
    setTodoAssigneeUserId(null)
    setTodoModuleId(null)
  }

  async function toggleTodo(todoId: number) {
    const todo = todos.find((item) => item.id === todoId)
    if (!todo) return
    await runMutation(() => updateTodo(todoId, { done: !todo.done }))
  }

  async function updateTodoDetails(todoId: number, payload: TodoUpdatePayload) {
    await runMutation(() => updateTodo(todoId, payload))
  }

  async function addTodoNote(todoId: number, content: string) {
    await runMutation(() => createTodoNote(todoId, { content }))
  }

  async function editTodoNote(todoId: number, noteId: number, content: string) {
    await runMutation(() => updateTodoNote(todoId, noteId, { content }))
  }

  async function acceptInvitation(membershipId: number) {
    try {
      const result = await acceptProjectInvitation(membershipId)
      applyWorkspace(result.workspace)
      setNotifications(result.notifications)
      setWorkspaceError('')
    } catch {
      setWorkspaceError('邀请处理失败，请稍后再试。')
    }
  }

  async function declineInvitation(membershipId: number) {
    try {
      const result = await declineProjectInvitation(membershipId)
      applyWorkspace(result.workspace)
      setNotifications(result.notifications)
      setWorkspaceError('')
    } catch {
      setWorkspaceError('邀请处理失败，请稍后再试。')
    }
  }

  async function dismissNotification(
    kind: 'project_invite' | 'assigned_todo' | 'todo_due_tomorrow' | 'todo_note_mention',
    sourceId: number,
  ) {
    try {
      const result = await markNotificationRead(kind, sourceId, true)
      setNotifications(result.notifications)
      setWorkspaceError('')
    } catch {
      setWorkspaceError('通知状态更新失败，请稍后再试。')
    }
  }

  async function deleteTodo(todoId: number) {
    await runMutation(() => removeTodo(todoId))
  }

  async function generateSummary(projectId: number, type: Summary['type']) {
    await runMutation(() => createSummary(projectId, type))
    setView('summaries')
  }

  async function createInstallEvent(payload: {
    title: string
    type: ProjectPackageEventType
  }) {
    if (!selectedProject) return
    try {
      const timeline = await createProjectPackageEvent(selectedProject.id, payload)
      setProjectPackageTimelines((current) => ({
        ...current,
        [selectedProject.id]: timeline,
      }))
      setWorkspaceError('')
    } catch {
      setWorkspaceError('安装事件创建失败，请稍后再试。')
    }
  }

  async function updateInstallEvent(
    eventId: number,
    payload: Partial<{ title: string; type: ProjectPackageEventType }>,
  ) {
    if (!selectedProject) return
    try {
      const timeline = await updateProjectPackageEvent(selectedProject.id, eventId, payload)
      setProjectPackageTimelines((current) => ({
        ...current,
        [selectedProject.id]: timeline,
      }))
      setWorkspaceError('')
    } catch {
      setWorkspaceError('安装事件更新失败，请稍后再试。')
    }
  }

  async function deleteInstallEvent(eventId: number) {
    if (!selectedProject) return
    try {
      const timeline = await removeProjectPackageEvent(selectedProject.id, eventId)
      setProjectPackageTimelines((current) => ({
        ...current,
        [selectedProject.id]: timeline,
      }))
      setWorkspaceError('')
    } catch {
      setWorkspaceError('安装事件删除失败，请稍后再试。')
    }
  }

  async function addInstallItems(
    eventId: number,
    items: Array<{
      sourcePackageId: string
      sourcePackageName: string
      packageName: string
      channel: string
      channelLabel: string
      arch: string
      version: string
      objectKey: string
      objectLastModified?: string
      sizeBytes?: number
    }>,
  ) {
    if (!selectedProject) return
    try {
      const timeline = await addProjectPackageItems(selectedProject.id, eventId, { items })
      setProjectPackageTimelines((current) => ({
        ...current,
        [selectedProject.id]: timeline,
      }))
      setWorkspaceError('')
    } catch {
      setWorkspaceError('安装包记录保存失败，请稍后再试。')
    }
  }

  async function deleteInstallGroup(groupId: number) {
    if (!selectedProject) return
    try {
      const timeline = await removeProjectPackageGroup(selectedProject.id, groupId)
      setProjectPackageTimelines((current) => ({
        ...current,
        [selectedProject.id]: timeline,
      }))
      setWorkspaceError('')
    } catch {
      setWorkspaceError('安装包删除失败，请稍后再试。')
    }
  }

  async function createInstallOperation(payload: {
    eventId: number
    groupId?: number | null
    kind: ProjectPackageOperationKind
    title?: string
    label?: string
    content?: string
    completed?: boolean
    relatedTodoIds?: number[]
    relatedTodoNotes?: Record<number, string>
  }) {
    if (!selectedProject) return
    try {
      const timeline = await createProjectPackageOperation(selectedProject.id, payload)
      setProjectPackageTimelines((current) => ({
        ...current,
        [selectedProject.id]: timeline,
      }))
      setWorkspaceError('')
      try {
        const workspace = await fetchWorkspace()
        applyWorkspace(workspace)
      } catch {
        // The install record has already been persisted, so a follow-up
        // workspace refresh failure should not surface as a save failure.
      }
    } catch {
      setWorkspaceError('安装记录保存失败，请稍后再试。')
    }
  }

  async function updateInstallOperation(
    operationId: number,
    payload: Partial<{
      title: string
      label: string
      content: string
      completed: boolean
      relatedTodoIds: number[]
      relatedTodoNotes: Record<number, string>
    }>,
  ) {
    if (!selectedProject) return
    try {
      const timeline = await updateProjectPackageOperation(selectedProject.id, operationId, payload)
      setProjectPackageTimelines((current) => ({
        ...current,
        [selectedProject.id]: timeline,
      }))
      setWorkspaceError('')
      try {
        const workspace = await fetchWorkspace()
        applyWorkspace(workspace)
      } catch {
        // Keep the successful mutation result on screen even if the
        // background workspace sync temporarily fails.
      }
    } catch {
      setWorkspaceError('安装记录更新失败，请稍后再试。')
    }
  }

  async function deleteInstallOperation(operationId: number) {
    if (!selectedProject) return
    try {
      const timeline = await removeProjectPackageOperation(selectedProject.id, operationId)
      setProjectPackageTimelines((current) => ({
        ...current,
        [selectedProject.id]: timeline,
      }))
      setWorkspaceError('')
    } catch {
      setWorkspaceError('安装记录删除失败，请稍后再试。')
    }
  }

  async function exportInstallTimeline() {
    if (!selectedProject) return { fileName: '项目时间线.md', markdown: '' }
    try {
      const result = await exportProjectPackageTimeline(selectedProject.id)
      setWorkspaceError('')
      return result
    } catch {
      setWorkspaceError('安装升级时间线导出失败，请稍后再试。')
      throw new Error('安装升级时间线导出失败')
    }
  }

  async function loadPackageMarketRules(): Promise<{
    expireMinutes: number
    rules: PackageMarketRule[]
  }> {
    return fetchPackageMarketRules()
  }

  async function loadPackageMarketDetail(payload: {
    arch: string
    channel: PackageMarketChannel
    ciVersion?: string
    deployType?: 'pro' | 'oss'
    packageId: string
    releaseVersion?: string
  }): Promise<PackageMarketDetail> {
    if (payload.packageId === 'base-pro' || payload.packageId === 'base-oss') {
      return fetchPackageMarketBaseDetail({
        arch: payload.arch,
        channel: payload.channel,
        deployType: payload.packageId === 'base-oss' ? 'oss' : 'pro',
        releaseVersion: payload.releaseVersion,
      })
    }

    return fetchPackageMarketDetail(payload)
  }

  async function loadPackageMarketVersions(payload: {
    arch: string
    kind: 'ci' | 'release'
    deployType?: 'pro' | 'oss'
    packageId: string
  }): Promise<PackageMarketVersion[]> {
    if (payload.kind === 'ci') {
      return (await fetchPackageMarketCiVersions({
        arch: payload.arch,
        packageId: payload.packageId,
      })).versions
    }

    if (payload.packageId === 'base-pro' || payload.packageId === 'base-oss') {
      return (await fetchPackageMarketBaseReleaseVersions({
        arch: payload.arch,
        deployType: payload.packageId === 'base-oss' ? 'oss' : 'pro',
      })).versions
    }

    return (await fetchPackageMarketReleaseVersions(payload)).versions
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
	        activeAiAgent,
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
      setAiError('AI Agent 暂时没有响应，请先在左下角账号菜单的「AI 配置」里填写 Base URL、API Key 和模型。')
    } finally {
	    setAiBusy(false)
	  }
	}

	function changeActiveAiAgent(agentType: AiAgentType) {
	  setActiveAiAgent(agentType)
	  setAiMessages([])
	  setAiDraft('')
	  setAiError('')
	}

  async function exportMarkdown(projectId?: number) {
    const targets = projectId
      ? projects.filter((project) => project.id === projectId)
      : projects.filter((project) => project.accessRole === 'owner')
    const sections = await Promise.all(
      targets.map(async (project) => {
        const projectTodosText = todos
          .filter((todo) => todo.projectId === project.id)
          .map((todo) => `- [${todo.done ? 'x' : ' '}] ${todo.title}`)
          .join('\n')
        const journalsText = project.journals
          .map((entry) => `### ${entry.speakerName} · ${entry.createdAt} · ${entry.visibility === 'public' ? '公开' : '私有'}\n\n${entry.content}`)
          .join('\n\n')
        const summariesText = summaries
          .filter((summary) => summary.projectId === project.id)
          .map((summary) => `### ${summary.title}\n\n${summary.content}`)
          .join('\n\n')
        const packageTimelineText = await (async () => {
          try {
            return (await exportProjectPackageTimeline(project.id)).markdown.trim()
          } catch {
            return '安装升级时间线导出失败，请检查后端服务和 OSS 配置。'
          }
        })()

        return `# ${project.name}

状态：${statusCopy[project.status]}
标签：${project.tags.join('、')}
最近更新：${project.updatedAt}

## 日记

${journalsText || '暂无日记'}

## 待办

${projectTodosText || '暂无待办'}

## 总结

${summariesText || '暂无总结'}

## 安装升级时间线

${packageTimelineText}`
      }),
    )
    const body = sections.join('\n\n---\n\n')

    const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = projectId ? `${targets[0]?.name}.md` : 'Veges-个人项目驾驶舱导出.md'
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!loggedIn) {
    return <LoginScreen error={authError} onClearError={() => setAuthError('')} onSignIn={signIn} />
  }

  if (!workspaceLoaded && !authUser) {
    return <WorkspaceBootScreen />
  }

  const hideSidebar = view === 'project' && projectDetailTab === 'packages'

  return (
    <main className={hideSidebar ? 'app-shell sidebar-hidden' : 'app-shell'}>
      {!hideSidebar && (
        <aside className="sidebar" aria-label="主导航">
          <div className="brand-block">
            <img className="brand-mark" src="/favicon.svg" alt="Veges" />
            <div>
              <p className="eyebrow">Veges</p>
              <h1>项目篮子</h1>
            </div>
          </div>
          <nav className="nav-list">
            <NavButton active={view === 'search'} onClick={() => setView('search')}>
              <Target size={18} weight="duotone" /> 项目篮子
            </NavButton>
            <NavButton active={view === 'todos'} onClick={() => setView('todos')}>
              <ListChecks size={18} weight="duotone" /> 当前待办
            </NavButton>
            <NavButton active={view === 'notifications'} onClick={() => setView('notifications')}>
              <Bell size={18} weight="duotone" /> 通知中心
              {openNotificationCount > 0 && (
                <Badge className="nav-badge">{openNotificationCount}</Badge>
              )}
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
            themeMode={themeMode}
            onSaveAiSettings={updateAiSettings}
            onLoadAiSettings={fetchAiSettings}
            onRename={updateDisplayName}
            onSignOut={signOut}
            onToggleTheme={toggleThemeMode}
          />
        </aside>
      )}

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
                  aria-label={projectDetailTab === 'packages' ? '返回项目日记' : '返回项目篮子'}
                  title={projectDetailTab === 'packages' ? '返回项目日记' : '返回项目篮子'}
                  onClick={() => {
                    if (projectDetailTab === 'packages') {
                      setProjectDetailTab('journal')
                      return
                    }
                    setView('search')
                  }}
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
          <div className={view === 'project' ? 'topbar-actions project-topbar-actions' : 'topbar-actions'}>
            {view === 'project' && projectDetailTab === 'packages' ? (
              <>
                <Button
                  className="ghost-button"
                  variant="outline"
                  type="button"
                  onClick={() => packageWorkbenchRef.current?.exportTimeline()}
                >
                  <DownloadSimple size={17} /> 导出时间线
                </Button>
                {selectedProject && (
                  <Button
                    className="solid-button"
                    type="button"
                    disabled={
                      (projectPackageTimelines[selectedProject.id]?.events.length ?? 0) === 0
                    }
                    onClick={() => packageWorkbenchRef.current?.openPackageMarket()}
                  >
                    <ShoppingCartSimple size={17} /> 添加事件安装包
                  </Button>
                )}
              </>
            ) : (
              <>
                {view === 'project' && selectedProject && (
                  <Button
                    className="solid-button"
                    type="button"
                    onClick={() => setProjectDetailTab('packages')}
                  >
                    交付工作台
                  </Button>
                )}
                {view === 'project' && selectedProject?.accessRole === 'owner' && (
                  <Dialog
                    open={isProjectModulesDialogOpen}
                    onOpenChange={setIsProjectModulesDialogOpen}
                  >
                    <DialogTrigger asChild>
                      <Button className="ghost-button project-modules-trigger" type="button" variant="outline">
                        <ListChecks size={16} /> 项目模块
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>项目模块</DialogTitle>
                        <DialogDescription>
                          给当前项目配置自定义模块，后续新增或编辑待办时都可以直接归属到对应模块。
                        </DialogDescription>
                      </DialogHeader>
                      <ProjectModulesPanel
                        modules={selectedProject.modules}
                        onCreate={() => addProjectModule(selectedProject.id)}
                        onDelete={(moduleId) => deleteProjectModule(selectedProject.id, moduleId)}
                        onDraftChange={setProjectModuleDraft}
                        draft={projectModuleDraft}
                      />
                    </DialogContent>
                  </Dialog>
                )}
                {view === 'project' && selectedProject?.accessRole === 'owner' && (
                  <Dialog
                    open={isProjectMembersDialogOpen}
                    onOpenChange={setIsProjectMembersDialogOpen}
                  >
                    <DialogTrigger asChild>
                      <Button className="ghost-button project-members-trigger" type="button" variant="outline">
                        <AddressBook size={16} /> 项目成员
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>项目成员</DialogTitle>
                        <DialogDescription>
                          邀请成员加入后，TA 可以新增自己的日记和项目待办，但不能修改项目状态或名称。
                        </DialogDescription>
                      </DialogHeader>
                      <ProjectMembersPanel
                        memberships={memberships.filter(
                          (membership) => membership.projectId === selectedProject.id,
                        )}
                        onInvite={(email) => inviteMember(selectedProject.id, email)}
                        onRemove={(membershipId) => deleteMember(selectedProject.id, membershipId)}
                      />
                    </DialogContent>
                  </Dialog>
                )}
                <Button
                  className="ghost-button"
                  variant="outline"
                  type="button"
                  onClick={() =>
                    exportMarkdown(view === 'project' ? selectedProject?.id : undefined)
                  }
                >
                  <DownloadSimple size={17} /> 批量导出
                </Button>
              </>
            )}
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
                  <NewProjectForm
                    newProjectName={newProjectName}
                    newProjectTags={newProjectTags}
                    onCancel={() => changeNewProjectDialogOpen(false)}
                    onNewProjectNameChange={setNewProjectName}
                    onNewProjectTagsChange={setNewProjectTags}
                    onSubmit={addProject}
                  />
                </DialogContent>
              </Dialog>
            ) : null}
          </div>
        </header>

        {(!workspaceLoaded || workspaceError) && (
          <div className={workspaceError ? 'sync-banner error' : 'sync-banner'}>
            {workspaceError || '正在从数据库同步工作区...'}
          </div>
        )}

        {view === 'project' && selectedProject && (
          <ProjectDetail
            key={selectedProject.id}
            journalDraft={journalDraft}
            packageTimeline={projectPackageTimelines[selectedProject.id] ?? null}
            packageWorkbenchRef={packageWorkbenchRef}
            projectDetailTab={projectDetailTab}
            onAddTodo={addTodo}
            onCreateInstallEvent={createInstallEvent}
            onCreateInstallOperation={createInstallOperation}
            onDeleteInstallEvent={deleteInstallEvent}
            onDeleteInstallGroup={deleteInstallGroup}
            onDeleteInstallOperation={deleteInstallOperation}
            onDraftChange={setJournalDraft}
            onExportInstallTimeline={exportInstallTimeline}
            onInstallLoadMarketDetail={loadPackageMarketDetail}
            onInstallLoadMarketRules={loadPackageMarketRules}
            onInstallLoadMarketVersions={loadPackageMarketVersions}
            onInstallSelectPackages={addInstallItems}
            onUpdateInstallEvent={updateInstallEvent}
            onUpdateInstallOperation={updateInstallOperation}
            onSaveJournal={saveJournal}
            onDeleteJournalEntry={deleteJournalEntry}
            onEditJournalEntry={editJournalEntry}
            onToggleJournalRisk={toggleJournalRisk}
            onUpdateJournalVisibility={updateJournalVisibility}
            onDeleteTodo={deleteTodo}
            onCreateTodoNote={addTodoNote}
            onUpdateTodo={updateTodoDetails}
            onUpdateTodoNote={editTodoNote}
            onTodoAssigneeChange={setTodoAssigneeUserId}
            onTodoDueDateChange={setTodoDueDate}
            onTodoDraftChange={setTodoDraft}
            onTodoModuleChange={setTodoModuleId}
            onTodoPriorityChange={setTodoPriority}
            onToggleTodo={toggleTodo}
            project={selectedProject}
            currentUser={authUser}
            memberships={memberships}
            projects={projects}
            projectTodos={projectTodos}
            todoAssigneeUserId={todoAssigneeUserId}
            todoDueDate={todoDueDate}
            todoDraft={todoDraft}
            todoModuleId={todoModuleId}
            todoPriority={todoPriority}
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
            memberships={memberships}
            inbox={inbox}
            inboxDraft={inboxDraft}
            onAddInboxItem={addInboxItem}
            onDeleteInboxItem={deleteInboxItem}
            onDraftChange={setInboxDraft}
            projects={projects}
          />
        )}

        {view === 'todos' && (
          <CurrentTodosView
            memberships={memberships}
            onCreateTodoNote={addTodoNote}
            onDeleteTodo={deleteTodo}
            onProjectClick={selectProject}
            onToggleTodo={toggleTodo}
            onUpdateTodo={updateTodoDetails}
            onUpdateTodoNote={editTodoNote}
            currentUserId={authUser?.id}
            projects={projects}
            todos={todos}
          />
        )}

        {view === 'notifications' && (
          <NotificationCenterView
            currentUserId={authUser?.id}
            notifications={notifications}
            onAcceptInvitation={acceptInvitation}
            onDeclineInvitation={declineInvitation}
            onDismissNotification={dismissNotification}
            onProjectClick={selectProject}
            onToggleTodo={toggleTodo}
          />
        )}

        {view === 'search' && (
          <SearchView
            allTags={allTags}
            filteredResults={filteredResults}
            search={search}
            statusFilter={statusFilter}
            tagFilter={tagFilter}
            exportMarkdown={exportMarkdown}
            generateSummary={generateSummary}
            onDeleteProject={deleteProject}
            onProjectClick={selectProject}
            onRenameProject={renameProject}
            onSearchChange={setSearch}
            onStatusChange={setStatusFilter}
            onTagChange={setTagFilter}
            onUpdateProjectStatus={updateProjectStatus}
          />
        )}

	        {view === 'summaries' && (
	          <SummaryView
	            activeAiAgent={activeAiAgent}
	            aiBusy={aiBusy}
	            aiDraft={aiDraft}
	            aiError={aiError}
	            aiMessages={aiMessages}
	            onAiDraftChange={setAiDraft}
	            onAgentChange={changeActiveAiAgent}
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
        <img className="brand-mark" src="/favicon.svg" alt="Veges" />
        <div>
          <p className="eyebrow">Veges - 个人项目驾驶舱</p>
          <h1>正在同步工作区</h1>
          <p>稍等一下，正在连接线上数据。</p>
        </div>
      </div>
    </main>
  )
}

function LoginScreen({
  error,
  onClearError,
  onSignIn,
}: {
  error: string
  onClearError: () => void
  onSignIn: (username: string, password: string, mode: 'login' | 'register') => void
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState('')

  function switchMode(nextMode: 'login' | 'register') {
    if (nextMode === mode) return
    setMode(nextMode)
    setUsername('')
    setPassword('')
    setConfirmPassword('')
    setFormError('')
    onClearError()
  }

  function clearErrors() {
    setFormError('')
    onClearError()
  }

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
            if (mode === 'register' && password !== confirmPassword) {
              setFormError('两次输入的密码不一致。')
              return
            }
            onSignIn(username, password, mode)
          }}
        >
          <div className="auth-mode-switch">
            <Button
              className={mode === 'login' ? 'auth-mode active' : 'auth-mode'}
              type="button"
              variant="ghost"
              onClick={() => switchMode('login')}
            >
              登录
            </Button>
            <Button
              className={mode === 'register' ? 'auth-mode active' : 'auth-mode'}
              type="button"
              variant="ghost"
              onClick={() => switchMode('register')}
            >
              注册
            </Button>
          </div>
          <Label>
            用户名
            <Input
              autoComplete="username"
              placeholder="输入用户名"
              required
              type="text"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value)
                clearErrors()
              }}
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
              onChange={(event) => {
                setPassword(event.target.value)
                clearErrors()
              }}
            />
          </Label>
          {mode === 'register' && (
            <Label>
              确认密码
              <Input
                autoComplete="new-password"
                minLength={6}
                placeholder="再次输入密码"
                required
                type="password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value)
                  clearErrors()
                }}
              />
            </Label>
          )}
          {(formError || error) && <p className="form-error">{formError || error}</p>}
          <Button className="solid-button wide" type="submit">
            <SignIn size={18} /> {mode === 'register' ? '创建账号' : '进入驾驶舱'}
          </Button>
          <p className="form-note">
            {mode === 'register'
              ? '注册后会创建你的个人工作区，密码会加密保存。'
              : '使用你注册时设置的用户名和密码登录。'}
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
  return user.displayName || user.username
}

function AccountMenu({
  onLoadAiSettings,
  user,
  themeMode,
  onRename,
  onSaveAiSettings,
  onSignOut,
  onToggleTheme,
}: {
  onLoadAiSettings: () => Promise<{ settings: AiSettings }>
  user: AuthUser | null
  themeMode: ThemeMode
  onRename: (displayName: string) => void
  onSaveAiSettings: (payload: {
    apiKey?: string
    baseUrl: string
    model: string
  }) => Promise<{ settings: AiSettings }>
  onSignOut: () => void
  onToggleTheme: () => void
}) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [aiDialogOpen, setAiDialogOpen] = useState(false)
  const [displayNameDraft, setDisplayNameDraft] = useState(getUserDisplayName(user))
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)
  const [currentPasswordDraft, setCurrentPasswordDraft] = useState('')
  const [nextPasswordDraft, setNextPasswordDraft] = useState('')
  const [confirmPasswordDraft, setConfirmPasswordDraft] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [aiBaseUrlDraft, setAiBaseUrlDraft] = useState('')
  const [aiApiKeyDraft, setAiApiKeyDraft] = useState('')
  const [aiModelDraft, setAiModelDraft] = useState('')
  const [aiHasApiKey, setAiHasApiKey] = useState(false)
  const [aiSettingsBusy, setAiSettingsBusy] = useState(false)
  const [aiSettingsError, setAiSettingsError] = useState('')
  const displayName = getUserDisplayName(user)
  const accountMeta = user?.username ?? '尚未登录'

  function resetPasswordForm() {
    setCurrentPasswordDraft('')
    setNextPasswordDraft('')
    setConfirmPasswordDraft('')
    setPasswordError('')
    setPasswordBusy(false)
  }

  function changePasswordDialogOpen(open: boolean) {
    setPasswordDialogOpen(open)
    if (!open) resetPasswordForm()
  }

  async function savePasswordChange() {
    const currentPassword = currentPasswordDraft
    const nextPassword = nextPasswordDraft
    if (!currentPassword || nextPassword.length < 6) {
      setPasswordError('请输入旧密码，并确保新密码不少于 6 位。')
      return
    }
    if (nextPassword !== confirmPasswordDraft) {
      setPasswordError('两次输入的新密码不一致。')
      return
    }

    setPasswordBusy(true)
    setPasswordError('')
    try {
      await updateCurrentPassword({ currentPassword, nextPassword })
      setPasswordDialogOpen(false)
      resetPasswordForm()
    } catch {
      setPasswordError('修改失败，请确认旧密码是否正确。')
    } finally {
      setPasswordBusy(false)
    }
  }

  async function openAiSettingsDialog() {
    setAiSettingsError('')
    setAiDialogOpen(true)
    setAiSettingsBusy(true)
    try {
      const result = await onLoadAiSettings()
      setAiBaseUrlDraft(result.settings.baseUrl)
      setAiApiKeyDraft('')
      setAiModelDraft(result.settings.model)
      setAiHasApiKey(result.settings.hasApiKey)
    } catch {
      setAiSettingsError('AI 配置读取失败，请稍后重试。')
    } finally {
      setAiSettingsBusy(false)
    }
  }

  async function saveAiSettings() {
    const baseUrl = aiBaseUrlDraft.trim()
    const apiKey = aiApiKeyDraft.trim()
    const model = aiModelDraft.trim()
    if (!baseUrl || !model || (!apiKey && !aiHasApiKey)) {
      setAiSettingsError('请填写 Base URL、API Key 和模型。')
      return
    }

    setAiSettingsBusy(true)
    setAiSettingsError('')
    try {
      const result = await onSaveAiSettings({
        baseUrl,
        model,
        ...(apiKey ? { apiKey } : {}),
      })
      setAiBaseUrlDraft(result.settings.baseUrl)
      setAiApiKeyDraft('')
      setAiModelDraft(result.settings.model)
      setAiHasApiKey(result.settings.hasApiKey)
      setAiDialogOpen(false)
    } catch {
      setAiSettingsError('AI 配置保存失败，请确认信息后重试。')
    } finally {
      setAiSettingsBusy(false)
    }
  }

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
          <DropdownMenuItem
            className="theme-menu-item"
            onSelect={(event) => {
              event.preventDefault()
              onToggleTheme()
            }}
          >
            <span className="theme-menu-label">
              <Sun /> 亮色模式
            </span>
            <span
              className={themeMode === 'light' ? 'theme-toggle is-on' : 'theme-toggle'}
              aria-hidden
            />
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              openAiSettingsDialog()
            }}
          >
            <Sparkle /> AI 配置
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              changePasswordDialogOpen(true)
            }}
          >
            <Password /> 修改密码
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

      <Dialog open={passwordDialogOpen} onOpenChange={changePasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改密码</DialogTitle>
            <DialogDescription>
              先输入当前密码完成验证，再设置一个不少于 6 位的新密码。
            </DialogDescription>
          </DialogHeader>
          <form
            className="new-project-dialog-form"
            onSubmit={(event) => {
              event.preventDefault()
              savePasswordChange()
            }}
          >
            <Label>
              旧密码
              <Input
                autoFocus
                autoComplete="current-password"
                required
                type="password"
                value={currentPasswordDraft}
                onChange={(event) => setCurrentPasswordDraft(event.target.value)}
              />
            </Label>
            <Label>
              新密码
              <Input
                autoComplete="new-password"
                minLength={6}
                required
                type="password"
                value={nextPasswordDraft}
                onChange={(event) => setNextPasswordDraft(event.target.value)}
              />
            </Label>
            <Label>
              确认新密码
              <Input
                autoComplete="new-password"
                minLength={6}
                required
                type="password"
                value={confirmPasswordDraft}
                onChange={(event) => setConfirmPasswordDraft(event.target.value)}
              />
            </Label>
            {passwordError && <p className="form-error">{passwordError}</p>}
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => changePasswordDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={passwordBusy}>
                {passwordBusy ? '保存中...' : '保存新密码'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI 配置</DialogTitle>
            <DialogDescription>
              配置后才可以使用 AI 总结。API Key 只会保存在你的账号配置里，重新打开时不会明文展示。
            </DialogDescription>
          </DialogHeader>
          <form
            className="new-project-dialog-form ai-settings-form"
            onSubmit={(event) => {
              event.preventDefault()
              saveAiSettings()
            }}
          >
            <Label>
              Base URL
              <Input
                autoFocus
                placeholder="https://api.openai.com"
                required
                value={aiBaseUrlDraft}
                onChange={(event) => setAiBaseUrlDraft(event.target.value)}
              />
            </Label>
            <Label>
              API Key
              <Input
                placeholder={aiHasApiKey ? '已保存，留空则继续使用原 Key' : '请输入 API Key'}
                required={!aiHasApiKey}
                type="password"
                value={aiApiKeyDraft}
                onChange={(event) => setAiApiKeyDraft(event.target.value)}
              />
            </Label>
            <Label>
              模型
              <Input
                placeholder="例如：gpt-4.1-mini"
                required
                value={aiModelDraft}
                onChange={(event) => setAiModelDraft(event.target.value)}
              />
            </Label>
            {aiSettingsError && <p className="form-error">{aiSettingsError}</p>}
            {aiHasApiKey && !aiApiKeyDraft && (
              <p className="form-note">当前已有 API Key，保存时留空会继续使用原 Key。</p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => setAiDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={aiSettingsBusy}>
                {aiSettingsBusy ? '保存中...' : '保存配置'}
              </Button>
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
          <NewProjectForm
            newProjectName={newProjectName}
            newProjectTags={newProjectTags}
            onCancel={() => onNewProjectDialogOpenChange(false)}
            onNewProjectNameChange={onNewProjectNameChange}
            onNewProjectTagsChange={onNewProjectTagsChange}
            onSubmit={onAddProject}
          />
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function NewProjectForm({
  newProjectName,
  newProjectTags,
  onCancel,
  onNewProjectNameChange,
  onNewProjectTagsChange,
  onSubmit,
}: {
  newProjectName: string
  newProjectTags: string
  onCancel: () => void
  onNewProjectNameChange: (value: string) => void
  onNewProjectTagsChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <form
      className="new-project-dialog-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
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
        <Button className="ghost-button" variant="outline" type="button" onClick={onCancel}>
          取消
        </Button>
        <Button className="solid-button" type="submit">
          <Plus size={15} /> 创建项目
        </Button>
      </DialogFooter>
    </form>
  )
}

function ProjectDetail({
  journalDraft,
  packageTimeline,
  packageWorkbenchRef,
  projectDetailTab,
  onAddTodo,
  onCreateInstallEvent,
  onCreateInstallOperation,
  onDeleteInstallEvent,
  onDeleteInstallGroup,
  onDeleteInstallOperation,
  onDraftChange,
  onExportInstallTimeline,
  onInstallLoadMarketDetail,
  onInstallLoadMarketRules,
  onInstallLoadMarketVersions,
  onInstallSelectPackages,
  onUpdateInstallEvent,
  onUpdateInstallOperation,
  onSaveJournal,
  onDeleteJournalEntry,
  onEditJournalEntry,
  onToggleJournalRisk,
  onUpdateJournalVisibility,
  onCreateTodoNote,
  onDeleteTodo,
  onUpdateTodo,
  onUpdateTodoNote,
  onTodoAssigneeChange,
  onTodoDueDateChange,
  onTodoDraftChange,
  onTodoModuleChange,
  onTodoPriorityChange,
  onToggleTodo,
  project,
  currentUser,
  memberships,
  projects,
  projectTodos,
  todoAssigneeUserId,
  todoDueDate,
  todoDraft,
  todoModuleId,
  todoPriority,
}: {
  journalDraft: string
  packageTimeline: ProjectPackageTimeline | null
  packageWorkbenchRef: RefObject<ProjectPackageWorkbenchHandle | null>
  projectDetailTab: ProjectDetailTab
  onAddTodo: () => void
  onCreateInstallEvent: (payload: {
    title: string
    type: ProjectPackageEventType
  }) => Promise<void>
  onCreateInstallOperation: (payload: {
    eventId: number
    groupId?: number | null
    kind: ProjectPackageOperationKind
    title?: string
    label?: string
    content?: string
    completed?: boolean
    relatedTodoIds?: number[]
    relatedTodoNotes?: Record<number, string>
  }) => Promise<void>
  onDeleteInstallEvent: (eventId: number) => Promise<void>
  onDeleteInstallGroup: (groupId: number) => Promise<void>
  onDeleteInstallOperation: (operationId: number) => Promise<void>
  onDraftChange: (value: string) => void
  onExportInstallTimeline: () => Promise<{ fileName: string; markdown: string }>
  onInstallLoadMarketDetail: (payload: {
    arch: string
    channel: PackageMarketChannel
    ciVersion?: string
    deployType?: 'pro' | 'oss'
    packageId: string
    releaseVersion?: string
  }) => Promise<PackageMarketDetail>
  onInstallLoadMarketRules: () => Promise<{
    expireMinutes: number
    rules: PackageMarketRule[]
  }>
  onInstallLoadMarketVersions: (payload: {
    arch: string
    kind: 'ci' | 'release'
    deployType?: 'pro' | 'oss'
    packageId: string
  }) => Promise<PackageMarketVersion[]>
  onInstallSelectPackages: (
    eventId: number,
    items: Array<{
      sourcePackageId: string
      sourcePackageName: string
      packageName: string
      channel: string
      channelLabel: string
      arch: string
      version: string
      objectKey: string
      objectLastModified?: string
      sizeBytes?: number
    }>,
  ) => Promise<void>
  onUpdateInstallEvent: (
    eventId: number,
    payload: Partial<{ title: string; type: ProjectPackageEventType }>,
  ) => Promise<void>
  onUpdateInstallOperation: (
    operationId: number,
    payload: Partial<{
      title: string
      label: string
      content: string
      completed: boolean
      relatedTodoIds: number[]
      relatedTodoNotes: Record<number, string>
    }>,
  ) => Promise<void>
  onSaveJournal: () => void
  onDeleteJournalEntry: (projectId: number, entryId: number) => void
  onEditJournalEntry: (
    projectId: number,
    entryId: number,
    content: string,
  ) => void
  onToggleJournalRisk: (
    projectId: number,
    entryId: number,
    isRiskEntry: boolean,
  ) => void
  onUpdateJournalVisibility: (
    projectId: number,
    entryId: number,
    visibility: JournalVisibility,
  ) => void
  onCreateTodoNote: (todoId: number, content: string) => void
  onDeleteTodo: (todoId: number) => void
  onUpdateTodo: (id: number, payload: TodoUpdatePayload) => void
  onUpdateTodoNote: (todoId: number, noteId: number, content: string) => void
  onTodoAssigneeChange: (id: number | null) => void
  onTodoDueDateChange: (value: string) => void
  onTodoDraftChange: (value: string) => void
  onTodoModuleChange: (id: number | null) => void
  onTodoPriorityChange: (value: Priority) => void
  onToggleTodo: (id: number) => void
  project: Project
  currentUser: AuthUser | null
  memberships: ProjectMembership[]
  projects: Project[]
  projectTodos: Todo[]
  todoAssigneeUserId: number | null
  todoDueDate: string
  todoDraft: string
  todoModuleId: number | null
  todoPriority: Priority
}) {
  const [editingJournalId, setEditingJournalId] = useState<number | null>(null)
  const [journalEditDraft, setJournalEditDraft] = useState('')
  const [isJournalComposing, setIsJournalComposing] = useState(false)
  const journalDates = useMemo(
    () =>
      Array.from(new Set(project.journals.map((entry) => entry.createdAt.slice(0, 10))))
        .sort((left, right) => right.localeCompare(left)),
    [project.journals],
  )
  const defaultJournalDate = journalDates.includes(today)
    ? today
    : journalDates[0] ?? today
  const [selectedJournalDate, setSelectedJournalDate] = useState(defaultJournalDate)
  const activeJournalDate = journalDates.includes(selectedJournalDate)
    ? selectedJournalDate
    : defaultJournalDate
  const visibleJournals = project.journals.filter((entry) =>
    entry.createdAt.startsWith(activeJournalDate),
  )
  const selectedJournalDateIndex = journalDates.indexOf(activeJournalDate)
  const previousJournalDate =
    selectedJournalDateIndex >= 0
      ? journalDates[selectedJournalDateIndex + 1]
      : undefined
  const nextJournalDate =
    selectedJournalDateIndex > 0
      ? journalDates[selectedJournalDateIndex - 1]
      : undefined
  const projectMembers = getProjectAssignableUsers(project, memberships)
  const projectModules = project.modules
  const isOwner = project.accessRole === 'owner'
  const riskJournalEntryIds = useMemo(
    () => new Set(project.riskJournalEntryIds),
    [project.riskJournalEntryIds],
  )

  function handleJournalKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
    save: () => void,
  ) {
    const nativeEvent = event.nativeEvent as KeyboardEvent
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      isJournalComposing ||
      nativeEvent.isComposing
    ) {
      return
    }
    event.preventDefault()
    save()
  }

  return (
    <div className={projectDetailTab === 'packages' ? 'detail-layout packages-mode' : 'detail-layout'}>
      <div className="project-detail-main">
        {projectDetailTab === 'packages' ? (
          <ProjectPackageWorkbench
            ref={packageWorkbenchRef}
            onAddItems={onInstallSelectPackages}
            onCreateEvent={onCreateInstallEvent}
            onCreateOperation={onCreateInstallOperation}
            onDeleteEvent={onDeleteInstallEvent}
            onDeleteGroup={onDeleteInstallGroup}
            onDeleteOperation={onDeleteInstallOperation}
            onExportTimeline={onExportInstallTimeline}
            onLoadPackageMarketDetail={onInstallLoadMarketDetail}
            onLoadPackageMarketRules={onInstallLoadMarketRules}
            onLoadPackageMarketVersions={onInstallLoadMarketVersions}
            onUpdateEvent={onUpdateInstallEvent}
            onUpdateOperation={onUpdateInstallOperation}
            onUpdateTodo={onUpdateTodo}
            project={project}
            todos={projectTodos}
            timeline={packageTimeline}
          />
        ) : (
          <Card className="panel journal-panel">
            <PanelTitle icon={<FileText size={18} />} title="项目日记" />
            <Label className="textarea-label journal-entry-label">
              <MentionTextarea
                members={projectMembers}
                placeholder="记录今天的进展、决策、问题或方案..."
                value={journalDraft}
                onChange={onDraftChange}
                onCompositionEnd={() => setIsJournalComposing(false)}
                onCompositionStart={() => setIsJournalComposing(true)}
                onKeyDown={(event) => handleJournalKeyDown(event, onSaveJournal)}
              />
            </Label>
            <Button className="solid-button" type="button" onClick={onSaveJournal}>
              <NotePencil size={17} /> 保存到今日日记
            </Button>

            <div className="history-list">
              {visibleJournals.length > 0 ? (
                visibleJournals.map((entry) => {
                  const canEditEntry =
                    entry.authorUserId === currentUser?.id ||
                    (!entry.authorUserId && isOwner)
                  const canDeleteEntry = isOwner || canEditEntry
                  const isRiskEntry = riskJournalEntryIds.has(entry.id)
                  return (
                    <article
                      className={isRiskEntry ? 'history-item is-risk' : 'history-item'}
                      key={entry.id}
                    >
                      <div className="history-item-header">
                        <div className="history-speaker">
                          <time>{entry.createdAt}</time>
                          <span>{entry.speakerName}</span>
                          <Badge className={entry.visibility === 'public' ? 'visibility-pill public' : 'visibility-pill'}>
                            {entry.visibility === 'public' ? '公开' : '私有'}
                          </Badge>
                        </div>
                        <span className="history-actions">
                          {canEditEntry && (
                            <Button
                              className="history-visibility-button"
                              variant="ghost"
                              type="button"
                              aria-label={entry.visibility === 'public' ? '改为私有日记' : '公开日记'}
                              title={entry.visibility === 'public' ? '改为私有日记' : '公开日记'}
                              onClick={() =>
                                onUpdateJournalVisibility(
                                  project.id,
                                  entry.id,
                                  entry.visibility === 'public' ? 'private' : 'public',
                                )
                              }
                            >
                              {entry.visibility === 'public' ? '设私有' : '公开'}
                            </Button>
                          )}
                          {canEditEntry && (
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
                          )}
                          {canEditEntry && (
                            <Button
                              className={isRiskEntry ? 'history-risk-button is-active' : 'history-risk-button'}
                              variant="ghost"
                              size="icon"
                              type="button"
                              aria-pressed={isRiskEntry}
                              aria-label={isRiskEntry ? '取消风险标记' : '标记为项目风险'}
                              title={isRiskEntry ? '取消风险标记' : '标记为项目风险'}
                              onClick={() => onToggleJournalRisk(project.id, entry.id, isRiskEntry)}
                            >
                              <WarningCircle size={15} />
                            </Button>
                          )}
                          {canDeleteEntry && (
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
                          )}
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
                            onCompositionEnd={() => setIsJournalComposing(false)}
                            onCompositionStart={() => setIsJournalComposing(true)}
                            onKeyDown={(event) =>
                              handleJournalKeyDown(event, () => {
                                const nextContent = journalEditDraft.trim()
                                if (!nextContent) return
                                onEditJournalEntry(project.id, entry.id, nextContent)
                                setEditingJournalId(null)
                                setJournalEditDraft('')
                              })
                            }
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
                        <MarkdownPreview content={entry.content} compact />
                      )}
                    </article>
                  )
                })
              ) : (
                <p className="empty-state">这一天还没有日记记录。</p>
              )}
            </div>
            <div className="journal-pagination" aria-label="日记日期选择">
              <Button
                className="ghost-button"
                disabled={!previousJournalDate}
                type="button"
                variant="outline"
                onClick={() => {
                  if (!previousJournalDate) return
                  setSelectedJournalDate(previousJournalDate)
                  setEditingJournalId(null)
                  setJournalEditDraft('')
                }}
              >
                上一天
              </Button>
              <JournalDatePicker
                key={activeJournalDate}
                datesWithEntries={journalDates}
                value={activeJournalDate}
                onChange={(date) => {
                  setSelectedJournalDate(date)
                  setEditingJournalId(null)
                  setJournalEditDraft('')
                }}
              />
              <span>{visibleJournals.length} 条</span>
              <Button
                className="ghost-button"
                disabled={!nextJournalDate}
                type="button"
                variant="outline"
                onClick={() => {
                  if (!nextJournalDate) return
                  setSelectedJournalDate(nextJournalDate)
                  setEditingJournalId(null)
                  setJournalEditDraft('')
                }}
              >
                下一天
              </Button>
            </div>
          </Card>
        )}
      </div>

      {projectDetailTab === 'journal' ? (
        <Card className="panel side-panel">
          <PanelTitle icon={<Check size={18} />} title="项目待办" />
          <div className="todo-form">
            <MentionTextarea
              members={projectMembers}
              placeholder="添加一个下一步..."
              value={todoDraft}
              onChange={onTodoDraftChange}
            />
            <div className="todo-form-meta">
              <JournalDatePicker
                ariaLabel="待办截止日期"
                datesWithEntries={[]}
                value={todoDueDate}
                onChange={onTodoDueDateChange}
              />
              <div className="todo-form-tools">
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
                {projectModules.length > 0 ? (
                  <ProjectModulePicker
                    modules={projectModules}
                    value={todoModuleId}
                    onChange={onTodoModuleChange}
                  />
                ) : null}
                <ProjectMemberPicker
                  members={projectMembers}
                  value={todoAssigneeUserId}
                  onChange={onTodoAssigneeChange}
                />
              </div>
            </div>
            <Button className="solid-button wide" type="button" onClick={() => onAddTodo()}>
              <Plus size={17} /> 添加待办
            </Button>
          </div>
          <div className="side-panel-scroll-area">
            <TodoList
              currentUserId={currentUser?.id}
              memberships={memberships}
              onCreateTodoNote={onCreateTodoNote}
              todos={projectTodos}
              onUpdateTodo={onUpdateTodo}
              onUpdateTodoNote={onUpdateTodoNote}
              projects={projects}
              onDeleteTodo={onDeleteTodo}
              onToggleTodo={onToggleTodo}
              compact
            />
          </div>
        </Card>
      ) : null}
    </div>
  )
}

function ProjectMembersPanel({
  memberships,
  onInvite,
  onRemove,
}: {
  memberships: ProjectMembership[]
  onInvite: (username: string) => void
  onRemove: (membershipId: number) => void
}) {
  const [username, setUsername] = useState('')

  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextUsername = username.trim()
    if (!nextUsername) return
    onInvite(nextUsername)
    setUsername('')
  }

  return (
    <div className="project-members-panel">
      <PanelTitle icon={<AddressBook size={18} />} title="项目成员" />
      <form className="member-invite-form" onSubmit={submitInvite}>
        <Input
          autoComplete="username"
          type="text"
          placeholder="输入用户名邀请"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <Button className="solid-button" type="submit" disabled={!username.trim()}>
          邀请
        </Button>
      </form>
      <div className="member-list">
        {memberships.length === 0 ? (
          <p className="empty-state">还没有邀请成员。</p>
        ) : (
          memberships.map((membership) => (
            <article className="member-item" key={membership.id}>
              <span>
                <strong>{membership.memberName}</strong>
                <small>
                  {membership.invitedUsername} · {membership.status === 'pending'
                    ? '待确认'
                    : membership.status === 'declined'
                      ? '已拒绝'
                      : '已加入'}
                </small>
              </span>
              <Button
                className="todo-delete-button"
                variant="ghost"
                size="icon"
                type="button"
                aria-label="移除成员"
                title="移除成员"
                onClick={() => onRemove(membership.id)}
              >
                <Trash size={14} />
              </Button>
            </article>
          ))
        )}
      </div>
    </div>
  )
}

function ProjectModulesPanel({
  draft,
  modules,
  onCreate,
  onDelete,
  onDraftChange,
}: {
  draft: string
  modules: ProjectModule[]
  onCreate: () => void
  onDelete: (moduleId: number) => void
  onDraftChange: (value: string) => void
}) {
  return (
    <div className="project-members-panel">
      <form
        className="member-invite-form"
        onSubmit={(event) => {
          event.preventDefault()
          onCreate()
        }}
      >
        <Input
          type="text"
          placeholder="输入模块名称，例如：支付、登录、部署"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
        />
        <Button className="solid-button" type="submit" disabled={!draft.trim()}>
          新增
        </Button>
      </form>
      <div className="member-list">
        {modules.length === 0 ? (
          <p className="empty-state">还没有配置模块。</p>
        ) : (
          modules.map((module) => (
            <article className="member-item" key={module.id}>
              <span>
                <strong>{module.name}</strong>
                <small>创建于 {module.createdAt.slice(0, 16)}</small>
              </span>
              <ConfirmDialog
                confirmLabel="删除模块"
                description={`删除「${module.name}」后，已关联待办会保留，但模块归属会被清空。`}
                onConfirm={() => onDelete(module.id)}
                title="确认删除这个项目模块？"
                trigger={
                  <Button
                    className="todo-delete-button"
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label="删除模块"
                    title="删除模块"
                  >
                    <Trash size={14} />
                  </Button>
                }
              />
            </article>
          ))
        )}
      </div>
    </div>
  )
}

function JournalDatePicker({
  ariaLabel = '选择日期',
  className,
  datesWithEntries,
  disabled = false,
  onChange,
  value,
}: {
  ariaLabel?: string
  className?: string
  datesWithEntries: string[]
  disabled?: boolean
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
          className={className ? `journal-date-trigger ${className}` : 'journal-date-trigger'}
          disabled={disabled}
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

function CurrentTodosView({
  currentUserId,
  memberships,
  onCreateTodoNote,
  onDeleteTodo,
  onProjectClick,
  onToggleTodo,
  onUpdateTodoNote,
  onUpdateTodo,
  projects,
  todos,
}: {
  currentUserId?: number
  memberships: ProjectMembership[]
  onCreateTodoNote: (todoId: number, content: string) => void
  onDeleteTodo: (id: number) => void
  onProjectClick: (id: number) => void
  onToggleTodo: (id: number) => void
  onUpdateTodoNote: (todoId: number, noteId: number, content: string) => void
  onUpdateTodo: (id: number, payload: TodoUpdatePayload) => void
  projects: Project[]
  todos: Todo[]
}) {
  const [todoStatusFilter, setTodoStatusFilter] = useState<'all' | 'open' | 'done'>('all')
  const currentProjects = useMemo(
    () => projects.filter((project) => project.status !== 'archived'),
    [projects],
  )
  const currentProjectIds = useMemo(
    () => new Set(currentProjects.map((project) => project.id)),
    [currentProjects],
  )
  const currentTodos = useMemo(
    () => todos.filter((todo) => currentProjectIds.has(todo.projectId)),
    [currentProjectIds, todos],
  )
  const groupedTodos = useMemo(
    () =>
      currentProjects
        .map((project) => {
          const projectTodos = currentTodos
            .filter(
              (todo) =>
                todo.projectId === project.id &&
                (todoStatusFilter === 'all' ||
                  (todoStatusFilter === 'open' && !todo.done) ||
                  (todoStatusFilter === 'done' && todo.done)),
            )
            .sort(compareCreatedAtDesc)
          return {
            openCount: projectTodos.filter((todo) => !todo.done).length,
            project,
            todos: projectTodos,
          }
        })
        .filter((group) => group.todos.length > 0),
    [currentProjects, currentTodos, todoStatusFilter],
  )
  const openCount = currentTodos.filter((todo) => !todo.done).length
  const doneCount = currentTodos.length - openCount
  const toggleTodoStatusFilter = (status: 'open' | 'done') => {
    setTodoStatusFilter((current) => (current === status ? 'all' : status))
  }

  return (
      <Card className="panel current-todos-panel">
        <div className="current-todos-header">
          <PanelTitle icon={<ListChecks size={18} />} title="当前待办" />
          <div className="current-todos-tools">
            <div className="current-todos-metrics" aria-label="待办统计">
              <button
                className={
                  todoStatusFilter === 'open' ? 'todo-metric active' : 'todo-metric'
                }
                type="button"
                aria-pressed={todoStatusFilter === 'open'}
                onClick={() => toggleTodoStatusFilter('open')}
              >
                <strong>{openCount}</strong>
                未完成
              </button>
              <button
                className={
                  todoStatusFilter === 'done' ? 'todo-metric active' : 'todo-metric'
                }
                type="button"
                aria-pressed={todoStatusFilter === 'done'}
                onClick={() => toggleTodoStatusFilter('done')}
              >
                <strong>{doneCount}</strong>
                已完成
              </button>
              <span>
                <strong>{groupedTodos.length}</strong>
                关联项目
              </span>
            </div>
          </div>
        </div>

        {groupedTodos.length === 0 ? (
          <p className="empty-state">
            {todoStatusFilter === 'open'
              ? '当前没有未完成待办。'
              : todoStatusFilter === 'done'
                ? '当前没有已完成待办。'
                : '所有项目暂时都没有待办。'}
          </p>
        ) : (
          <div className="todo-board-table" role="table" aria-label="所有项目当前待办">
            <div className="todo-board-head" role="row">
              <span role="columnheader">项目/待办内容</span>
              <span role="columnheader">负责人</span>
              <span role="columnheader">是否确认</span>
              <span role="columnheader">截止</span>
              <span role="columnheader">状态</span>
              <span role="columnheader">操作</span>
            </div>

            {groupedTodos.map(({
              openCount: projectOpenCount,
              project,
              todos: projectTodos,
            }) => (
              <section className="todo-project-group" key={project.id}>
                <button
                  className="todo-project-group-header"
                  type="button"
                  onClick={() => onProjectClick(project.id)}
                >
                  <span>
                    <strong>{project.name}</strong>
                    <Badge className={`status-pill ${project.status}`}>
                      {statusCopy[project.status]}
                    </Badge>
                  </span>
                  <small>
                    {projectOpenCount} 未完成 / {projectTodos.length} 总计
                  </small>
                </button>
                <div className="todo-board-rows" role="rowgroup">
                  {projectTodos.map((todo) => {
                    const projectMembers = getProjectAssignableUsers(project, memberships)
                    const canManageTodo =
                      project.accessRole === 'owner' || todo.createdByUserId === currentUserId
                    const canConfirmTodo = project.accessRole === 'owner' || currentUserId != null
                    const canToggleTodo =
                      canManageTodo || todo.assigneeUserId === currentUserId
                    return (
                      <article
                        className={todo.done ? 'todo-board-row done' : 'todo-board-row'}
                        key={todo.id}
                        role="row"
                      >
                        <span className="todo-board-title-cell" role="cell">
                          <button
                            className="checkmark"
                            type="button"
                            disabled={!canToggleTodo}
                            onClick={() => onToggleTodo(todo.id)}
                            aria-label={todo.done ? '标记为未完成' : '标记为已完成'}
                          >
                            {todo.done ? <Check size={14} /> : null}
                          </button>
                          <span className="todo-board-title-content">
                            <span className="todo-board-title-line">
                              <strong>{todo.title}</strong>
                              <Badge className={`priority ${todo.priority}`}>
                                {priorityCopy[todo.priority]}
                              </Badge>
                              {todo.moduleName ? (
                                <Badge className="todo-module-badge">{todo.moduleName}</Badge>
                              ) : null}
                            </span>
                            <small>
                              {todo.creatorName
                                ? `${todo.creatorName} 创建于 ${todo.createdAt.slice(0, 16)}`
                                : `创建于 ${todo.createdAt.slice(0, 16)}`}
                            </small>
                          </span>
                        </span>
                        <span className="todo-board-assignee-cell" role="cell">
                          <ProjectMemberPicker
                            members={projectMembers}
                            value={todo.assigneeUserId ?? null}
                            compact
                            disabled={!canManageTodo}
                            onChange={(assigneeUserId) =>
                              onUpdateTodo(
                                todo.id,
                                assigneeUserId ? { assigneeUserId } : { assigneeUserId: null },
                              )
                            }
                          />
                        </span>
                        <span className="todo-board-priority-cell" role="cell">
                          <TodoConfirmSelect
                            confirmed={todo.confirmed}
                            disabled={!canConfirmTodo}
                            onChange={(confirmed) => onUpdateTodo(todo.id, { confirmed })}
                          />
                        </span>
                        <span className="todo-board-date-cell" role="cell">
                          <JournalDatePicker
                            ariaLabel="修改待办截止日期"
                            className="todo-board-date-trigger"
                            disabled={!canManageTodo}
                            datesWithEntries={[]}
                            value={todo.dueDate}
                            onChange={(dueDate) => onUpdateTodo(todo.id, { dueDate })}
                          />
                        </span>
                        <span
                          className={todo.done ? 'todo-status-chip done' : 'todo-status-chip'}
                          role="cell"
                        >
                          {todo.done ? '已完成' : '未完成'}
                        </span>
                        <span className="todo-board-action-cell" role="cell">
                          <TodoNotesDialog
                            currentUserId={currentUserId}
                            members={projectMembers}
                            onCreateNote={onCreateTodoNote}
                            onUpdateNote={onUpdateTodoNote}
                            todo={todo}
                            trigger={
                              <Button
                                className="todo-note-button"
                                variant="ghost"
                                size="icon"
                                type="button"
                                aria-label="查看待办备注"
                                title="查看待办备注"
                              >
                                <ChatTeardropText size={14} />
                              </Button>
                            }
                          />
                          {canManageTodo && (
                            <ConfirmDialog
                              confirmLabel="删除待办"
                              description={`删除「${todo.title}」后，这条待办将从「${project.name}」移除。`}
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
                          )}
                        </span>
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </Card>
  )
}

function NotificationCenterView({
  currentUserId,
  notifications,
  onAcceptInvitation,
  onDeclineInvitation,
  onDismissNotification,
  onProjectClick,
  onToggleTodo,
}: {
  currentUserId?: number
  notifications: NotificationCenterData
  onAcceptInvitation: (membershipId: number) => void
  onDeclineInvitation: (membershipId: number) => void
  onDismissNotification: (
    kind: 'project_invite' | 'assigned_todo' | 'todo_due_tomorrow' | 'todo_note_mention',
    sourceId: number,
  ) => void
  onProjectClick: (id: number) => void
  onToggleTodo: (todoId: number) => void
}) {
  const visibleInvites = notifications.invites.filter((item) => !item.dismissedAt)
  const visibleAssignedTodos = notifications.assignedTodos.filter(
    (item) => !item.dismissedAt && !item.done,
  )
  const visibleDueTomorrowTodos = notifications.dueTomorrowTodos.filter(
    (item) => !item.dismissedAt,
  )
  const visibleNoteMentions = notifications.noteMentions.filter(
    (item) => !item.dismissedAt,
  )
  const isEmpty =
    visibleInvites.length === 0 &&
    visibleAssignedTodos.length === 0 &&
    visibleDueTomorrowTodos.length === 0 &&
    visibleNoteMentions.length === 0

  return (
    <Card className="panel notification-center-panel">
      <div className="current-todos-header">
        <PanelTitle icon={<Bell size={18} />} title="通知中心" />
        <div className="current-todos-metrics" aria-label="通知统计">
          <span>
            <strong>{visibleInvites.length}</strong>
            邀请
          </span>
          <span>
            <strong>{visibleAssignedTodos.length}</strong>
            指派
          </span>
          <span>
            <strong>{visibleDueTomorrowTodos.length}</strong>
            明日到期
          </span>
          <span>
            <strong>{visibleNoteMentions.length}</strong>
            备注提及
          </span>
        </div>
      </div>

      {isEmpty ? (
        <p className="empty-state">暂时没有需要处理的通知。</p>
      ) : (
        <div className="notification-sections">
          {visibleInvites.length > 0 && (
            <section className="notification-section">
              <h3 className="notification-section-title">
                项目邀请
                <span className="notification-kind">邀请</span>
              </h3>
              <div className="notification-list">
                {visibleInvites.map((invite) => (
                  <article className="notification-item" key={invite.id}>
                    <div>
                      <strong>{invite.projectName}</strong>
                      <p>{invite.invitedByName} 邀请你加入项目。</p>
                      <small>{invite.createdAt}</small>
                    </div>
                    <div className="notification-actions">
                      <Button
                        className="ghost-button"
                        type="button"
                        variant="outline"
                        onClick={() => onDeclineInvitation(invite.id)}
                      >
                        拒绝
                      </Button>
                      <Button
                        className="solid-button"
                        type="button"
                        onClick={() => onAcceptInvitation(invite.id)}
                      >
                        接受
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {visibleAssignedTodos.length > 0 && (
            <section className="notification-section">
              <h3 className="notification-section-title">
                指派给我
                <span className="notification-kind">待办</span>
              </h3>
              <div className="notification-list">
                {visibleAssignedTodos.map((todo) => (
                  <article className="notification-item" key={todo.id}>
                    <div>
                      <strong>{todo.title}</strong>
                      <p className="notification-meta-line">
                        {todo.projectName} · 截止 {todo.dueDate}
                        {todo.assignedByName ? ` · ${todo.assignedByName} 指派` : ''}
                        <span className={`notification-priority ${todo.priority}`}>
                          {priorityCopy[todo.priority]}
                        </span>
                      </p>
                    </div>
                    <div className="notification-actions">
                      <Button
                        className="ghost-button"
                        type="button"
                        variant="outline"
                        onClick={() => onProjectClick(todo.projectId)}
                      >
                        查看项目
                      </Button>
                      <Button
                        className="solid-button"
                        type="button"
                        disabled={!currentUserId}
                        onClick={() => onToggleTodo(todo.id)}
                      >
                        完成
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {visibleDueTomorrowTodos.length > 0 && (
            <section className="notification-section">
              <h3 className="notification-section-title">
                明日到期
                <span className="notification-kind">提醒</span>
              </h3>
              <div className="notification-list">
                {visibleDueTomorrowTodos.map((todo) => (
                  <article className="notification-item" key={todo.id}>
                    <div>
                      <strong>{todo.title}</strong>
                      <p className="notification-meta-line">
                        {todo.projectName} · 明天截止
                        <span className={`notification-priority ${todo.priority}`}>
                          {priorityCopy[todo.priority]}
                        </span>
                      </p>
                    </div>
                    <div className="notification-actions">
                      <Button
                        className="ghost-button"
                        type="button"
                        variant="outline"
                        onClick={() => onDismissNotification('todo_due_tomorrow', todo.id)}
                      >
                        忽略
                      </Button>
                      <Button
                        className="solid-button"
                        type="button"
                        onClick={() => onProjectClick(todo.projectId)}
                      >
                        查看项目
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {visibleNoteMentions.length > 0 && (
            <section className="notification-section">
              <h3 className="notification-section-title">
                备注提及我
                <span className="notification-kind">备注</span>
              </h3>
              <div className="notification-list">
                {visibleNoteMentions.map((note) => (
                  <article className="notification-item" key={`note-${note.noteId}`}>
                    <div>
                      <div className="notification-title-line">
                        <strong>{note.title}</strong>
                        <p className="notification-meta-line">
                          {note.projectName}
                          {note.noteAuthorName ? ` · ${note.noteAuthorName} 提及了你` : ''}
                          <span className={`notification-priority ${note.priority}`}>
                            {priorityCopy[note.priority]}
                          </span>
                        </p>
                      </div>
                      {note.notePreview ? <p>{note.notePreview}</p> : null}
                      {note.createdAt ? <small>{note.createdAt}</small> : null}
                    </div>
                    <div className="notification-actions">
                      <Button
                        className="ghost-button"
                        type="button"
                        variant="outline"
                        onClick={() => note.noteId && onDismissNotification('todo_note_mention', note.noteId)}
                      >
                        忽略
                      </Button>
                      <Button
                        className="solid-button"
                        type="button"
                        onClick={() => onProjectClick(note.projectId)}
                      >
                        查看项目
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Card>
  )
}

function MentionTextarea({
  members,
  onChange,
  value,
  ...props
}: Omit<ComponentProps<typeof Textarea>, 'onChange' | 'value'> & {
  members?: Array<{ id: number; name: string }>
  onChange: (value: string) => void
  value: string
}) {
  return (
    <MentionInputShell
      members={members}
      multiline
      onChange={onChange}
      value={value}
      inputProps={props}
    />
  )
}

function MentionInputShell({
  inputProps,
  members = [],
  multiline = false,
  onChange,
  value,
}: {
  inputProps: Record<string, unknown>
  members?: Array<{ id: number; name: string }>
  multiline?: boolean
  onChange: (value: string) => void
  value: string
}) {
  const [open, setOpen] = useState(false)
  const [mentionRange, setMentionRange] = useState<{ caret: number; index: number } | null>(null)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const shellRef = useRef<HTMLSpanElement | null>(null)
  const mentionMembers = useMemo(() => {
    const seen = new Set<string>()
    return members
      .filter((member) => {
        const key = member.name.trim()
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map((member) => ({
        id: member.id,
        name: member.name,
        role: '项目成员',
      }))
  }, [members])
  const canMention = mentionMembers.length > 0
  const shouldShow = open && canMention

  function updateMentionMenu(
    element: HTMLInputElement | HTMLTextAreaElement,
    nextValue: string,
  ) {
    const caret = element.selectionStart ?? nextValue.length
    const mentionIndex = nextValue.slice(0, caret).endsWith('@') ? caret - 1 : -1
    const active = mentionIndex >= 0
    setOpen(active)
    setMentionRange(active ? { caret, index: mentionIndex } : null)
    if (active) {
      setMenuPosition(getCaretMenuPosition(element, shellRef.current, caret, nextValue))
    }
  }

  function updateValue(
    element: HTMLInputElement | HTMLTextAreaElement,
    nextValue: string,
  ) {
    onChange(nextValue)
    updateMentionMenu(element, nextValue)
  }

  function chooseMember(member: MentionOption) {
    const range = mentionRange
    const nextValue = range
      ? `${value.slice(0, range.index)}@${member.name} ${value.slice(range.caret)}`
      : `${value}@${member.name} `
    onChange(nextValue)
    setOpen(false)
    setMentionRange(null)
  }

  return (
    <span className="mention-input-shell" ref={shellRef}>
      {multiline ? (
        <Textarea
          {...(inputProps as ComponentProps<typeof Textarea>)}
          value={value}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => updateValue(event.currentTarget, event.target.value)}
          onFocus={(event) => updateMentionMenu(event.currentTarget, value)}
        />
      ) : (
        <Input
          {...(inputProps as ComponentProps<typeof Input>)}
          value={value}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => updateValue(event.currentTarget, event.target.value)}
          onFocus={(event) => updateMentionMenu(event.currentTarget, value)}
        />
      )}
      {shouldShow && (
        <span
          className="mention-menu"
          style={{
            left: menuPosition.left,
            top: menuPosition.top,
          } satisfies CSSProperties}
        >
          {mentionMembers.map((member) => (
            <button
              className="mention-option"
              key={member.id}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault()
                chooseMember(member)
              }}
            >
              <strong>@{member.name}</strong>
              <small>{member.role}</small>
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

function getCaretMenuPosition(
  element: HTMLInputElement | HTMLTextAreaElement,
  shell: HTMLSpanElement | null,
  caret: number,
  value: string,
) {
  if (!shell || typeof document === 'undefined') return { left: 0, top: 0 }

  const style = window.getComputedStyle(element)
  const mirror = document.createElement('div')
  const marker = document.createElement('span')
  const shellRect = shell.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  const lineHeight =
    Number.parseFloat(style.lineHeight) ||
    Number.parseFloat(style.fontSize) * 1.3 ||
    18

  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  mirror.style.left = '-9999px'
  mirror.style.top = '0'
  mirror.style.boxSizing = style.boxSizing
  mirror.style.width = `${element.clientWidth}px`
  mirror.style.padding = style.padding
  mirror.style.border = style.border
  mirror.style.font = style.font
  mirror.style.letterSpacing = style.letterSpacing
  mirror.style.textTransform = style.textTransform
  mirror.style.whiteSpace = element instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre'
  mirror.style.overflowWrap = element instanceof HTMLTextAreaElement ? 'break-word' : 'normal'
  mirror.textContent = value.slice(0, caret)
  marker.textContent = '\u200b'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const left =
    elementRect.left - shellRect.left + marker.offsetLeft - element.scrollLeft
  const top =
    elementRect.top - shellRect.top + marker.offsetTop - element.scrollTop + lineHeight + 4
  document.body.removeChild(mirror)

  return {
    left: Math.max(0, left),
    top: Math.max(0, top),
  }
}

function getProjectAssignableUsers(project: Project, memberships: ProjectMembership[]) {
  const users = new Map<number, string>()
  users.set(project.ownerUserId, `${project.ownerName}（Owner）`)
  memberships
    .filter(
      (membership) =>
        membership.projectId === project.id &&
        membership.status === 'active' &&
        membership.invitedUserId,
    )
    .forEach((membership) => {
      users.set(membership.invitedUserId!, membership.memberName)
    })
  return Array.from(users, ([id, name]) => ({ id, name }))
}

function dedupeMentionMembers(members: Array<{ id: number; name: string }>) {
  const seen = new Set<string>()
  return members.filter((member) => {
    const key = member.name.trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getProjectMentionOptions(
  projectId: number | undefined,
  projects: Project[],
  memberships: ProjectMembership[],
) {
  if (!projectId) return []
  const project = projects.find((item) => item.id === projectId)
  if (!project) return []
  return dedupeMentionMembers(getProjectAssignableUsers(project, memberships))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripTodoMentions(value: string, mentionOptions: Array<{ name: string }>) {
  return mentionOptions.reduce((current, option) => {
    const name = option.name.trim()
    if (!name) return current
    return current.replace(new RegExp(`(^|\\s)@${escapeRegExp(name)}(?=\\s|$)`, 'g'), '$1')
  }, value).replace(/\s{2,}/g, ' ')
}

function ProjectMemberPicker({
  compact = false,
  disabled = false,
  members,
  onChange,
  value,
}: {
  compact?: boolean
  disabled?: boolean
  members: Array<{ id: number; name: string }>
  onChange: (id: number | null) => void
  value: number | null
}) {
  const selectedMember = members.find((member) => member.id === value)
  return (
    <span className={compact ? 'member-picker compact' : 'member-picker'}>
      <Select
        disabled={disabled}
        value={value ? String(value) : 'none'}
        onValueChange={(nextValue) =>
          onChange(nextValue === 'none' ? null : Number(nextValue))
        }
      >
        <SelectTrigger aria-label="待办指派对象">
          <SelectValue placeholder="选择成员">
            {compact && selectedMember
              ? `@${selectedMember.name}`
              : compact
                ? '未指派'
                : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">未指派</SelectItem>
          {members.map((member) => (
            <SelectItem key={member.id} value={String(member.id)}>
              @{member.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  )
}

function ProjectModulePicker({
  compact = false,
  disabled = false,
  modules,
  onChange,
  value,
}: {
  compact?: boolean
  disabled?: boolean
  modules: ProjectModule[]
  onChange: (id: number | null) => void
  value: number | null
}) {
  const selectedModule = modules.find((module) => module.id === value)
  return (
    <span className={compact ? 'member-picker compact' : 'member-picker'}>
      <Select
        disabled={disabled}
        value={value ? String(value) : 'none'}
        onValueChange={(nextValue) => onChange(nextValue === 'none' ? null : Number(nextValue))}
      >
        <SelectTrigger aria-label="待办所属模块">
          <SelectValue placeholder="选择模块">
            {compact && selectedModule ? selectedModule.name : compact ? '无模块' : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">无模块</SelectItem>
          {modules.map((module) => (
            <SelectItem key={module.id} value={String(module.id)}>
              {module.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  )
}

function InboxView({
  archiveInboxItem,
  memberships,
  inbox,
  inboxDraft,
  onAddInboxItem,
  onDeleteInboxItem,
  onDraftChange,
  projects,
}: {
  archiveInboxItem: (item: InboxItem, projectId: number) => void
  memberships: ProjectMembership[]
  inbox: InboxItem[]
  inboxDraft: string
  onAddInboxItem: () => void
  onDeleteInboxItem: (itemId: number) => void
  onDraftChange: (value: string) => void
  projects: Project[]
}) {
  const [isComposing, setIsComposing] = useState(false)
  const mentionMembers = useMemo(
    () => dedupeMentionMembers(projects.flatMap((project) => getProjectAssignableUsers(project, memberships))),
    [memberships, projects],
  )

  function handleInboxKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const nativeEvent = event.nativeEvent as KeyboardEvent
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      isComposing ||
      nativeEvent.isComposing
    ) {
      return
    }
    event.preventDefault()
    onAddInboxItem()
  }

  return (
    <div className="inbox-layout">
      <Card className="panel capture-panel">
        <PanelTitle icon={<Tray size={18} />} title="快速捕捉" />
        <Label className="textarea-label capture-textarea-label">
          新线索
          <span className="capture-input-wrap">
            <MentionTextarea
              members={mentionMembers}
              placeholder="把会议记录、聊天片段、想法或解决方案先丢进来..."
              value={inboxDraft}
              onChange={onDraftChange}
              onCompositionEnd={() => setIsComposing(false)}
              onCompositionStart={() => setIsComposing(true)}
              onKeyDown={handleInboxKeyDown}
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
          {inbox.map((item) => {
            const isAiAnalyzing = item.content.includes('AI 分析中')
            return (
              <article
                className={
                  item.processed
                    ? 'inbox-item processed'
                    : isAiAnalyzing
                      ? 'inbox-item is-ai-analyzing'
                      : 'inbox-item'
                }
                key={item.id}
              >
                <div className="inbox-meta">
                  <span>{item.source === 'feishu' ? '飞书转发' : '手动记录'}</span>
                  <span className="inbox-meta-right">
                    {isAiAnalyzing && <Badge className="ai-analyzing-badge">AI 分析中</Badge>}
                    <span>{item.createdAt}</span>
                  </span>
                </div>
                <MarkdownPreview content={item.content} compact />
                {!item.processed && (
                  <ArchiveControl
                    item={item}
                    projects={projects}
                    onArchive={archiveInboxItem}
                    onDelete={onDeleteInboxItem}
                  />
                )}
              </article>
            )
          })}
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
  exportMarkdown,
  filteredResults,
  generateSummary,
  onDeleteProject,
  onProjectClick,
  onRenameProject,
  onSearchChange,
  onStatusChange,
  onTagChange,
  onUpdateProjectStatus,
  search,
  statusFilter,
  tagFilter,
}: {
  allTags: string[]
  exportMarkdown: (projectId?: number) => Promise<void>
  filteredResults: Project[]
  generateSummary: (projectId: number, type: Summary['type']) => void
  onDeleteProject: (projectId: number) => void
  onProjectClick: (id: number) => void
  onRenameProject: (projectId: number, name: string) => void
  onSearchChange: (value: string) => void
  onStatusChange: (value: ProjectStatus | 'all') => void
  onTagChange: (value: string) => void
  onUpdateProjectStatus: (projectId: number, status: ProjectStatus) => void
  search: string
  statusFilter: ProjectStatus | 'all'
  tagFilter: string
}) {
  const [renamingProject, setRenamingProject] = useState<Project | null>(null)
  const [projectNameDraft, setProjectNameDraft] = useState('')

  function openRenameDialog(project: Project) {
    setProjectNameDraft(project.name)
    setRenamingProject(project)
  }

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
          <article key={project.id} className="result-item">
            <button className="result-main" type="button" onClick={() => onProjectClick(project.id)}>
              <div>
                <div className="result-meta-row">
                  <Badge className={`status-pill ${project.status}`}>
                    {statusCopy[project.status]}
                  </Badge>
                  {project.accessRole === 'member' && (
                    <Badge className="access-pill">协作</Badge>
                  )}
                  <span>创建于 {project.createdAt}</span>
                </div>
                <div className="result-title-row">
                  <h3>{project.name}</h3>
                  <ProjectTags tags={project.tags} compact />
                </div>
                <p>{project.journals[0]?.content}</p>
              </div>
            </button>
            {project.accessRole === 'owner' && (
              <div className="result-actions">
                <div className="project-status-control result-status-control">
                  <span>项目状态</span>
                  <Select
                    value={project.status}
                    onValueChange={(value) =>
                      onUpdateProjectStatus(project.id, value as ProjectStatus)
                    }
                  >
                    <SelectTrigger aria-label={`修改「${project.name}」项目状态`}>
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
                  exportProject={() => void exportMarkdown(project.id)}
                  generateWeeklySummary={() => generateSummary(project.id, 'weekly')}
                  onDeleteProject={() => onDeleteProject(project.id)}
                  onRenameClick={() => openRenameDialog(project)}
                  projectName={project.name}
                />
              </div>
            )}
          </article>
        ))}
      </div>
      <Dialog
        open={Boolean(renamingProject)}
        onOpenChange={(open) => {
          if (!open) setRenamingProject(null)
        }}
      >
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
              if (!renamingProject) return
              onRenameProject(renamingProject.id, projectNameDraft)
              setRenamingProject(null)
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
                onClick={() => setRenamingProject(null)}
              >
                取消
              </Button>
              <Button type="submit">保存名称</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function SummaryView({
  activeAiAgent,
  aiBusy,
  aiDraft,
  aiError,
  aiMessages,
  onAiDraftChange,
  onAgentChange,
  onCreateSummaryFromAiMessage,
  onResetAiChat,
  onSendAgentMessage,
  projects,
  summaries,
}: {
  activeAiAgent: AiAgentType
  aiBusy: boolean
  aiDraft: string
  aiError: string
  aiMessages: DisplayAiChatMessage[]
  onAiDraftChange: (value: string) => void
  onAgentChange: (agentType: AiAgentType) => void
  onCreateSummaryFromAiMessage: (message: DisplayAiChatMessage) => void
  onResetAiChat: () => void
  onSendAgentMessage: () => void
  projects: Project[]
  summaries: Summary[]
}) {
  const [selectedSummaryId, setSelectedSummaryId] = useState<number | null>(null)
  const [isSummaryFullscreen, setIsSummaryFullscreen] = useState(false)
  const [isComposing, setIsComposing] = useState(false)
  const activeAgentMeta = aiAgentMeta[activeAiAgent]
  const selectedSummary =
    summaries.find((summary) => summary.id === selectedSummaryId) ?? null
  const selectedProject = selectedSummary
    ? projects.find((project) => project.id === selectedSummary.projectId)
    : null
  const selectedDocumentOwner = selectedProject?.name ?? selectedSummary?.period ?? 'AI 总结文档'

  useEffect(() => {
    if (!isSummaryFullscreen) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsSummaryFullscreen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSummaryFullscreen])

  return (
    <div className={isSummaryFullscreen ? 'summary-layout is-document-fullscreen' : 'summary-layout'}>
      <Card className="panel ai-agent-panel">
	        <div className="agent-hero">
	          <div className="agent-orb">
	            {activeAgentMeta.avatar}
	          </div>
	          <div>
	            <h3>{activeAgentMeta.title}</h3>
	            <p>{activeAgentMeta.subtitle}</p>
	          </div>
	          <DropdownMenu>
	            <DropdownMenuTrigger asChild>
	              <Button
	                className="agent-new-chat-button"
	                type="button"
	                variant="ghost"
	                size="icon"
	                aria-label="选择 AI 助理"
	                title="选择 AI 助理"
	              >
	                <Plus size={28} />
	              </Button>
	            </DropdownMenuTrigger>
	            <DropdownMenuContent align="end" className="agent-menu-content">
	              <DropdownMenuItem
	                data-selected={activeAiAgent === 'project-summary'}
	                onSelect={() => onAgentChange('project-summary')}
	              >
	                <span className="agent-menu-check">
	                  {activeAiAgent === 'project-summary' && <Check size={13} weight="bold" />}
	                </span>
	                <span>
	                  <strong>项目总结助理</strong>
	                  <small>整理项目、待办、风险与总结</small>
	                </span>
	              </DropdownMenuItem>
	              <DropdownMenuItem
	                data-selected={activeAiAgent === 'conversation-analysis'}
	                onSelect={() => onAgentChange('conversation-analysis')}
	              >
	                <span className="agent-menu-check">
	                  {activeAiAgent === 'conversation-analysis' && <Check size={13} weight="bold" />}
	                </span>
	                <span>
	                  <strong>对话分析助理</strong>
	                  <small>分析群聊中其他人的对话</small>
	                </span>
	              </DropdownMenuItem>
	              <DropdownMenuSeparator />
	              <DropdownMenuItem onSelect={onResetAiChat}>
	                <span className="agent-menu-spacer" />
	                <span>
	                  <strong>清空当前对话</strong>
	                  <small>保留当前助理类型</small>
	                </span>
	              </DropdownMenuItem>
	            </DropdownMenuContent>
	          </DropdownMenu>
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
      <Card className={isSummaryFullscreen ? 'panel summary-list is-fullscreen' : 'panel summary-list'}>
        {selectedSummary ? (
          <SummaryDocumentDetail
            isFullscreen={isSummaryFullscreen}
            projectName={selectedDocumentOwner}
            summary={selectedSummary}
            onBack={() => {
              setIsSummaryFullscreen(false)
              setSelectedSummaryId(null)
            }}
            onToggleFullscreen={() => setIsSummaryFullscreen((current) => !current)}
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
            const ownerName = project?.name ?? (summary.period === '飞书对话分析' ? '飞书对话分析' : 'AI 总结文档')
            return (
              <button
                className="summary-doc-item"
                key={summary.id}
                type="button"
                onClick={() => onSelect(summary.id)}
              >
                <span>{ownerName}</span>
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
  isFullscreen,
  onBack,
  onToggleFullscreen,
  projectName,
  summary,
}: {
  isFullscreen: boolean
  onBack: () => void
  onToggleFullscreen: () => void
  projectName: string
  summary: Summary
}) {
  return (
    <article className="summary-doc-detail">
      <div className="summary-doc-header">
        <div className="summary-doc-toolbar">
          <Button className="ghost-button summary-back-button" variant="outline" type="button" onClick={onBack}>
            <ArrowLeft size={15} /> 返回列表
          </Button>
          <Button
            className="summary-fullscreen-button"
            variant="ghost"
            size="icon"
            type="button"
            aria-label={isFullscreen ? '退出全屏展示总结文档' : '全屏展示总结文档'}
            aria-pressed={isFullscreen}
            title={isFullscreen ? '退出全屏' : '全屏展示'}
            onClick={onToggleFullscreen}
          >
            {isFullscreen ? <CornersIn size={17} /> : <CornersOut size={17} />}
          </Button>
        </div>
        <div className="summary-doc-meta">
          <span>{projectName}</span>
          <span>{summary.createdAt}</span>
        </div>
        <h3>{summary.title}</h3>
        <small>{summary.period}</small>
      </div>
      <div className="summary-doc-body">
        <MarkdownPreview content={summary.content} />
      </div>
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
  let nextOrderedListStart = 1
  let canContinueOrderedList = false

  function resetOrderedListSequence() {
    nextOrderedListStart = 1
    canContinueOrderedList = false
  }

  function parseTableCells(text: string) {
    if (!text.startsWith('|') || !text.endsWith('|')) return null
    const cells = text
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean)
    return cells.length >= 2 ? cells : null
  }

  function isMarkdownTableDivider(text: string) {
    return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(text)
  }

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
      resetOrderedListSequence()
      continue
    }

    const heading = text.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      blocks.push(renderHeading(heading[1].length, heading[2], index))
      index += 1
      resetOrderedListSequence()
      continue
    }

    const tableCells = parseTableCells(text)
    if (tableCells) {
      const tableItems: ReactNode[] = []
      while (index < lines.length) {
        const rowText = lines[index].trim()
        if (!rowText) {
          index += 1
          continue
        }
        if (isMarkdownTableDivider(rowText)) {
          index += 1
          continue
        }
        const rowCells = parseTableCells(rowText)
        if (!rowCells) break
        const item = rowCells.length >= 3
          ? `${rowCells[0]}：${rowCells[1]}；${rowCells.slice(2).join('；')}`
          : rowCells.join('：')
        tableItems.push(<li key={index}>{parseInline(item)}</li>)
        index += 1
      }
      blocks.push(<ul key={`table-${index}`}>{tableItems}</ul>)
      resetOrderedListSequence()
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

    const orderedListMatch = text.match(/^(\d+)[.)]\s+/)
    if (orderedListMatch) {
      const items: ReactNode[] = []
      const sourceStart = Number(orderedListMatch[1])
      const listStart = canContinueOrderedList && sourceStart === 1 ? nextOrderedListStart : sourceStart
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) {
        const item = lines[index].trim().replace(/^\d+[.)]\s+/, '')
        items.push(<li key={index}>{parseInline(item)}</li>)
        index += 1
      }
      blocks.push(
        <ol key={`ol-${index}`} start={listStart}>
          {items}
        </ol>,
      )
      nextOrderedListStart = listStart + items.length
      canContinueOrderedList = true
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
      resetOrderedListSequence()
      continue
    }

    blocks.push(<p key={index}>{parseInline(text)}</p>)
    index += 1
    resetOrderedListSequence()
  }

  return <div className={compact ? 'markdown-preview compact' : 'markdown-preview'}>{blocks}</div>
}

function TodoNotesDialog({
  currentUserId,
  members,
  onCreateNote,
  onUpdateNote,
  todo,
  trigger,
}: {
  currentUserId?: number
  members?: Array<{ id: number; name: string }>
  onCreateNote: (todoId: number, content: string) => void
  onUpdateNote: (todoId: number, noteId: number, content: string) => void
  todo: Todo
  trigger: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null)
  const [editingDrafts, setEditingDrafts] = useState<Record<number, string>>({})

  useEffect(() => {
    if (!open) {
      setDraft('')
      setEditingNoteId(null)
      setEditingDrafts({})
    }
  }, [open])

  const notes = useMemo(
    () => [...todo.notes].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [todo.notes],
  )

  function saveNewNote() {
    const content = draft.trim()
    if (!content) return
    onCreateNote(todo.id, content)
    setDraft('')
  }

  function saveExistingNote(note: TodoNote) {
    const nextContent = String(editingDrafts[note.id] ?? note.content).trim()
    if (!nextContent) return
    onUpdateNote(todo.id, note.id, nextContent)
    setEditingNoteId(null)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="todo-notes-dialog">
        <DialogHeader>
          <DialogTitle>待办备注</DialogTitle>
          <DialogDescription>
            查看并补充「{todo.title}」的备注记录，交付工作台里的备注也会同步显示在这里。
          </DialogDescription>
        </DialogHeader>
        <div className="todo-notes-list">
          {notes.length === 0 ? (
            <div className="todo-notes-empty">还没有备注，直接写第一条即可。</div>
          ) : (
            notes.map((note) => {
              const canEdit = currentUserId != null && (
                note.authorUserId === currentUserId || note.sourceOperationId != null
              )
              const isEditing = editingNoteId === note.id
              return (
                <article className="todo-note-card" key={note.id}>
                  <header className="todo-note-card-header">
                    <div className="todo-note-card-meta">
                      <div className="todo-note-card-heading">
                        <strong>{note.authorName}</strong>
                        <span>{note.createdAt}</span>
                      </div>
                    </div>
                    {canEdit ? (
                      <Button
                        className="todo-note-inline-edit"
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => {
                          setEditingNoteId(note.id)
                          setEditingDrafts((current) => ({
                            ...current,
                            [note.id]: note.content,
                          }))
                        }}
                      >
                        编辑
                      </Button>
                    ) : null}
                  </header>
                  {isEditing ? (
                    <div className="todo-note-editor">
                      <MentionTextarea
                        members={members}
                        value={editingDrafts[note.id] ?? note.content}
                        onChange={(event) =>
                          setEditingDrafts((current) => ({
                            ...current,
                            [note.id]: event,
                          }))
                        }
                      />
                      <div className="todo-note-editor-actions">
                        <Button variant="outline" type="button" onClick={() => setEditingNoteId(null)}>
                          取消
                        </Button>
                        <Button type="button" onClick={() => saveExistingNote(note)}>
                          保存
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p>{note.content}</p>
                  )}
                </article>
              )
            })
          )}
        </div>
        <Label className="todo-note-create">
          新增备注
          <MentionTextarea
            members={members}
            placeholder="记录确认结果、未完成原因或其他补充说明..."
            value={draft}
            onChange={setDraft}
          />
        </Label>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => setOpen(false)}>
            关闭
          </Button>
          <Button type="button" disabled={!draft.trim()} onClick={saveNewNote}>
            添加备注
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TodoList({
  compact = false,
  currentUserId,
  onCreateTodoNote,
  onDeleteTodo,
  onToggleTodo,
  onUpdateTodoNote,
  onUpdateTodo,
  memberships,
  projects,
  todos,
}: {
  compact?: boolean
  currentUserId?: number
  onCreateTodoNote: (todoId: number, content: string) => void
  onDeleteTodo: (id: number) => void
  onToggleTodo: (id: number) => void
  onUpdateTodoNote: (todoId: number, noteId: number, content: string) => void
  onUpdateTodo: (id: number, payload: TodoUpdatePayload) => void
  memberships: ProjectMembership[]
  projects: Project[]
  todos: Todo[]
}) {
  const [page, setPage] = useState(0)
  const [editingTodoId, setEditingTodoId] = useState<number | null>(null)
  const [todoEditDraft, setTodoEditDraft] = useState('')
  const [todoEditDueDate, setTodoEditDueDate] = useState(today)
  const [todoEditPriority, setTodoEditPriority] = useState<Priority>('medium')
  const [todoEditAssigneeUserId, setTodoEditAssigneeUserId] = useState<number | null>(null)
  const [todoEditModuleId, setTodoEditModuleId] = useState<number | null>(null)
  const { containerRef, itemsPerPage } = useAdaptivePageSize({
    compact,
    defaultPageSize: compact ? 6 : 6,
    itemHeight: 64,
    maxPageSize: compact ? 12 : 5,
    minPageSize: 2,
    pagerHeight: compact ? 54 : 0,
    reservedHeight: (viewportHeight) => {
      if (!compact) return viewportHeight < 820 ? 320 : 380
      if (viewportHeight < 820) return 92
      if (viewportHeight < 980) return 110
      return 132
    },
  })

  const sortedTodos = useMemo(
    () => [...todos].sort(compareCreatedAtDesc),
    [todos],
  )
  const totalPages = Math.max(1, Math.ceil(sortedTodos.length / itemsPerPage))
  const safePage = Math.min(page, totalPages - 1)
  const visibleTodos = compact
    ? sortedTodos.slice(safePage * itemsPerPage, safePage * itemsPerPage + itemsPerPage)
    : sortedTodos
  const editingTodo = editingTodoId
    ? sortedTodos.find((todo) => todo.id === editingTodoId) ?? null
    : null
  const editingProject = editingTodo
    ? projects.find((project) => project.id === editingTodo.projectId) ?? null
    : null
  const editingProjectMembers = editingProject
    ? getProjectAssignableUsers(editingProject, memberships)
    : []

  function closeEditDialog() {
    setEditingTodoId(null)
    setTodoEditDraft('')
    setTodoEditDueDate(today)
    setTodoEditPriority('medium')
    setTodoEditAssigneeUserId(null)
    setTodoEditModuleId(null)
  }

  function openTodoEditDialog(todo: Todo) {
    setEditingTodoId(todo.id)
    setTodoEditDraft(todo.title)
    setTodoEditDueDate(todo.dueDate)
    setTodoEditPriority(todo.priority)
    setTodoEditAssigneeUserId(todo.assigneeUserId ?? null)
    setTodoEditModuleId(todo.moduleId ?? null)
  }

  function saveTodoEdit() {
    if (!editingTodo || !editingProject) return
    const nextTitle = stripTodoMentions(
      todoEditDraft,
      getProjectMentionOptions(editingProject.id, projects, memberships),
    ).trim()
    if (!nextTitle) return
    onUpdateTodo(editingTodo.id, {
      title: nextTitle,
      dueDate: todoEditDueDate,
      priority: todoEditPriority,
      assigneeUserId: todoEditAssigneeUserId,
      moduleId: todoEditModuleId,
    })
    closeEditDialog()
  }

  if (sortedTodos.length === 0) {
    return <p className="empty-state">暂时没有待办。</p>
  }

  return (
    <div className={compact ? 'todo-list-shell compact' : 'todo-list-shell'} ref={containerRef}>
      <div className={compact ? 'todo-list compact' : 'todo-list'}>
      {visibleTodos.map((todo) => {
        const project = projects.find((item) => item.id === todo.projectId)
        const mentionMembers = project ? getProjectAssignableUsers(project, memberships) : []
        const canManageTodo =
          project?.accessRole === 'owner' || todo.createdByUserId === currentUserId
        const canConfirmTodo = Boolean(project && currentUserId != null)
        return (
          <article
            className={todo.done ? 'todo-item done' : 'todo-item'}
            key={todo.id}
          >
            <button
              className="checkmark"
              type="button"
              disabled={!canManageTodo}
              onClick={() => onToggleTodo(todo.id)}
              aria-label={todo.done ? '标记为未完成' : '标记为已完成'}
            >
              {todo.done ? <Check size={14} /> : null}
            </button>
            <span className="todo-main">
              <span className="todo-title-row">
                <strong>{todo.title}</strong>
                {todo.moduleName ? (
                  <Badge className="todo-module-badge">{todo.moduleName}</Badge>
                ) : null}
              </span>
              <small>
                <span className="todo-created-at">
                  {todo.creatorName
                    ? `${todo.creatorName} 创建于 ${todo.createdAt.slice(0, 16)}`
                    : `创建于 ${todo.createdAt.slice(0, 16)}`}
                </span>
                {compact ? `截止 ${todo.dueDate}` : `${project?.name} · 截止 ${todo.dueDate}`}
                {todo.assigneeName && (
                  <span className="todo-assignee-inline">@{todo.assigneeName}</span>
                )}
              </small>
            </span>
            <span className="todo-actions">
              <Badge className={`priority ${todo.priority}`}>
                {priorityCopy[todo.priority]}
              </Badge>
              <TodoConfirmSelect
                confirmed={todo.confirmed}
                disabled={!canConfirmTodo}
                onChange={(confirmed) => onUpdateTodo(todo.id, { confirmed })}
              />
              <TodoNotesDialog
                currentUserId={currentUserId}
                members={mentionMembers}
                onCreateNote={onCreateTodoNote}
                onUpdateNote={onUpdateTodoNote}
                todo={todo}
                trigger={
                  <Button
                    className="todo-note-button"
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label="查看待办备注"
                    title="查看待办备注"
                  >
                    <ChatTeardropText size={14} />
                  </Button>
                }
              />
              {canManageTodo && (
                <Button
                  className="todo-edit-button"
                  variant="ghost"
                  size="icon"
                  type="button"
                  aria-label="编辑待办"
                  title="编辑待办"
                  onClick={() => openTodoEditDialog(todo)}
                >
                  <PencilSimple size={14} />
                </Button>
              )}
              {canManageTodo && (
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
              )}
            </span>
          </article>
        )
      })}
      </div>
      {compact && totalPages > 1 && (
        <SidePager
          label="待办翻页"
          page={safePage}
          totalPages={totalPages}
          onPrevious={() => setPage((current) => Math.max(0, current - 1))}
          onNext={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
        />
      )}
      <Dialog open={Boolean(editingTodo)} onOpenChange={(open) => {
        if (!open) closeEditDialog()
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑待办</DialogTitle>
            <DialogDescription>
              {editingProject ? `修改「${editingProject.name}」里的这条待办。` : '修改这条待办。'}
            </DialogDescription>
          </DialogHeader>
          <form
            className="new-project-dialog-form"
            onSubmit={(event) => {
              event.preventDefault()
              saveTodoEdit()
            }}
          >
            <Label>
              待办内容
              <MentionTextarea
                autoFocus
                members={editingProjectMembers}
                placeholder="修改待办内容..."
                value={todoEditDraft}
                onChange={setTodoEditDraft}
              />
            </Label>
            <Label>
              截止日期
              <JournalDatePicker
                ariaLabel="编辑待办截止日期"
                className="todo-edit-date-trigger"
                datesWithEntries={[]}
                value={todoEditDueDate}
                onChange={setTodoEditDueDate}
              />
            </Label>
            <Label>
              优先级
              <Select
                value={todoEditPriority}
                onValueChange={(value) => setTodoEditPriority(value as Priority)}
              >
                <SelectTrigger aria-label="编辑待办优先级">
                  <SelectValue placeholder="优先级" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">高优先级</SelectItem>
                  <SelectItem value="medium">中优先级</SelectItem>
                  <SelectItem value="low">低优先级</SelectItem>
                </SelectContent>
              </Select>
            </Label>
            {editingProject?.modules.length ? (
              <Label>
                所属模块
                <ProjectModulePicker
                  modules={editingProject.modules}
                  value={todoEditModuleId}
                  onChange={setTodoEditModuleId}
                />
              </Label>
            ) : null}
            <Label>
              负责人
              <ProjectMemberPicker
                members={editingProjectMembers}
                value={todoEditAssigneeUserId}
                onChange={setTodoEditAssigneeUserId}
              />
            </Label>
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={closeEditDialog}
              >
                取消
              </Button>
              <Button type="submit" disabled={!todoEditDraft.trim()}>
                保存待办
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SidePager({
  label,
  onNext,
  onPrevious,
  page,
  totalPages,
}: {
  label: string
  onNext: () => void
  onPrevious: () => void
  page: number
  totalPages: number
}) {
  return (
    <div className="side-pager" aria-label={label}>
      <Button
        className="ghost-button side-pager-button"
        disabled={page === 0}
        type="button"
        variant="outline"
        onClick={onPrevious}
      >
        上一页
      </Button>
      <span>
        {page + 1} / {totalPages}
      </span>
      <Button
        className="ghost-button side-pager-button"
        disabled={page >= totalPages - 1}
        type="button"
        variant="outline"
        onClick={onNext}
      >
        下一页
      </Button>
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
  if (view === 'todos') return '当前待办'
  if (view === 'notifications') return '通知中心'
  if (view === 'inbox') return '草稿箱'
  if (view === 'search') return '项目篮子'
  return 'AI 总结文档'
}

export default App
