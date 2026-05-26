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
} from 'react'
import {
  Archive,
  AddressBook,
  Bell,
  ArrowRight,
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
  PaperPlaneTilt,
  Plus,
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
  archiveDraft,
  acceptProjectInvitation,
  createDraft,
  createCollaborator,
  createJournalEntry,
  createProject,
  createRiskFromJournal,
  createSummary,
  createSummaryFromContent,
  createTodo,
  fetchAiSettings,
  fetchCurrentUser,
  fetchNotifications,
  getAuthToken,
  inviteProjectMember,
  markNotificationRead,
  loginAccount,
  registerAccount,
  clearAuthToken,
  removeCollaborator,
  removeDraft,
  removeJournalEntry,
  removeProject,
  removeProjectMember,
  removeTodo,
  resolveRisk,
  declineProjectInvitation,
  updateJournalEntry,
  updateProject,
  updateCollaborator,
  updateTodo,
  updateAiSettings,
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
  Collaborator,
  InboxItem,
  JournalVisibility,
  NotificationCenterData,
  Priority,
  Project,
  ProjectMembership,
  ProjectStatus,
  Summary,
  Todo,
} from './types'
import './App.css'

type View = 'project' | 'collaborators' | 'inbox' | 'notifications' | 'search' | 'summaries' | 'todos'
type DisplayAiChatMessage = AiChatMessage & { createdAt: string }
type ThemeMode = 'dark' | 'light'
type TodoUpdatePayload = Omit<Partial<Todo>, 'assigneeUserId' | 'collaboratorId'> & {
  assigneeUserId?: number | null
  collaboratorId?: number | null
}
type AdaptivePageSizeOptions = {
  compact: boolean
  defaultPageSize: number
  itemHeight: number
  maxPageSize: number
  minPageSize: number
  reservedHeight: (viewportHeight: number) => number
}
type CollaboratorPerson = {
  name: string
  primaryId: number
  projects: Project[]
  roles: string[]
}
type MentionOption = {
  id: number
  name: string
  role: string
}

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
        viewportHeight - containerTop - reservedHeight(viewportHeight),
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
  }, [compact, itemHeight, maxPageSize, minPageSize, reservedHeight])

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

const priorityRank: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
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
    collaboratorId: 1,
    title: '整理内容模板的评估维度',
    dueDate: today,
    priority: 'high',
    done: false,
  },
  {
    id: 2,
    projectId: 2,
    collaboratorId: 3,
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

const initialCollaborators: Collaborator[] = [
  {
    id: 1,
    name: '潘仪豪',
    role: '产品负责人',
    projectId: 1,
  },
  {
    id: 2,
    name: '谢金虎',
    role: '研发协作',
    projectId: 1,
  },
  {
    id: 3,
    name: '达梦',
    role: '数据口径确认',
    projectId: 2,
  },
]

const initialMemberships: ProjectMembership[] = []
const emptyNotifications: NotificationCenterData = {
  assignedTodos: [],
  dueTomorrowTodos: [],
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
  const [collaborators, setCollaborators] = useState(initialCollaborators)
  const [memberships, setMemberships] = useState(initialMemberships)
  const [notifications, setNotifications] = useState(emptyNotifications)
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
  const [todoCollaboratorId, setTodoCollaboratorId] = useState<number | null>(null)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectTags, setNewProjectTags] = useState('')
  const [newProjectCollaboratorIds, setNewProjectCollaboratorIds] = useState<number[]>([])
  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false)
  const [isNewCollaboratorDialogOpen, setIsNewCollaboratorDialogOpen] = useState(false)
  const [isProjectMembersDialogOpen, setIsProjectMembersDialogOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all')
  const [tagFilter, setTagFilter] = useState('全部')
  const initialAiMessages: DisplayAiChatMessage[] = []
  const [aiMessages, setAiMessages] = useState<DisplayAiChatMessage[]>(initialAiMessages)
  const [aiDraft, setAiDraft] = useState('')
  const [activeAiAgent, setActiveAiAgent] = useState<AiAgentType>('project-summary')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')

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
    setCollaborators(data.collaborators)
    setMemberships(data.memberships)
    setInbox(data.inbox)
    setSummaries(data.summaries)
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
      void refreshNotifications()
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
    setView('project')
  }

  function changeNewProjectDialogOpen(open: boolean) {
    setIsNewProjectDialogOpen(open)
    if (!open) {
      setNewProjectName('')
      setNewProjectTags('')
      setNewProjectCollaboratorIds([])
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
        collaboratorIds: newProjectCollaboratorIds,
        name,
        tags: tags.length > 0 ? tags : ['新项目'],
      }),
    )
    if (!data) return
    const createdProject = data?.projects.find((project) => project.name === name)
    if (createdProject) setSelectedProjectId(createdProject.id)
    setNewProjectName('')
    setNewProjectTags('')
    setNewProjectCollaboratorIds([])
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

    await runMutation(() => updateJournalEntry(projectId, entryId, { content: nextContent }))
  }

  async function updateJournalVisibility(
    projectId: number,
    entryId: number,
    visibility: JournalVisibility,
  ) {
    await runMutation(() => updateJournalEntry(projectId, entryId, { visibility }))
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

  async function addCollaborator(payload: {
    name: string
    projectIds: number[]
    role: string
  }) {
    const name = payload.name.trim()
    if (!name || payload.projectIds.length === 0) return
    await runMutation(() =>
      createCollaborator({
        name,
        projectIds: payload.projectIds,
        role: payload.role.trim(),
      }),
    )
  }

  async function editCollaborator(
    collaboratorId: number,
    payload: {
      name: string
      projectIds: number[]
      role: string
    },
  ) {
    const name = payload.name.trim()
    if (!name || payload.projectIds.length === 0) return
    await runMutation(() =>
      updateCollaborator(collaboratorId, {
        name,
        projectIds: payload.projectIds,
        role: payload.role.trim(),
      }),
    )
  }

  async function deleteCollaborator(collaboratorId: number) {
    await runMutation(() => removeCollaborator(collaboratorId))
  }

  async function inviteMember(projectId: number, email: string) {
    const nextEmail = email.trim()
    if (!nextEmail) return
    await runMutation(() => inviteProjectMember(projectId, { email: nextEmail }))
  }

  async function deleteMember(projectId: number, membershipId: number) {
    await runMutation(() => removeProjectMember(projectId, membershipId))
  }

  async function archiveInboxItem(item: InboxItem, projectId: number) {
    await runMutation(() => archiveDraft(item.id, projectId))
  }

  async function deleteInboxItem(itemId: number) {
    await runMutation(() => removeDraft(itemId))
  }

  async function addTodo(projectId?: number) {
    const targetProjectId = projectId ?? selectedProject?.id
    const targetProject = projects.find((project) => project.id === targetProjectId)
    const assigneeOptions = targetProject
      ? getProjectAssignableUsers(targetProject, memberships)
      : []
    const mentionAssignee = extractMentionAssignee(todoDraft, assigneeOptions)
    const assigneeUserId = todoCollaboratorId ?? mentionAssignee?.id
    const title = stripTodoMentions(todoDraft, assigneeOptions).trim()
    if (!title || !targetProjectId) return
    await runMutation(() =>
      createTodo({
        assigneeUserId: assigneeUserId ?? undefined,
        projectId: targetProjectId,
        title,
        dueDate: todoDueDate,
        priority: todoPriority,
      }),
    )
    setTodoDraft('')
    setTodoDueDate(today)
    setTodoPriority('medium')
    setTodoCollaboratorId(null)
  }

  async function toggleTodo(todoId: number) {
    const todo = todos.find((item) => item.id === todoId)
    if (!todo) return
    await runMutation(() => updateTodo(todoId, { done: !todo.done }))
  }

  async function updateTodoDetails(todoId: number, payload: TodoUpdatePayload) {
    await runMutation(() => updateTodo(todoId, payload))
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
    kind: 'project_invite' | 'assigned_todo' | 'todo_due_tomorrow',
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

  function exportMarkdown(projectId?: number) {
    const targets = projectId
      ? projects.filter((project) => project.id === projectId)
      : projects.filter((project) => project.accessRole === 'owner')
    const body = targets
      .map((project) => {
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
    link.download = projectId ? `${targets[0]?.name}.md` : 'Veges-个人项目驾驶舱导出.md'
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
          <img className="brand-mark" src="/favicon.svg" alt="Veges" />
          <div>
            <p className="eyebrow">Veges</p>
            <h1>个人项目驾驶舱</h1>
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
          <NavButton active={view === 'collaborators'} onClick={() => setView('collaborators')}>
            <AddressBook size={18} weight="duotone" /> 协作者
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
            {view === 'project' && selectedProject?.accessRole === 'owner' && (
              <Dialog
                open={isProjectMembersDialogOpen}
                onOpenChange={setIsProjectMembersDialogOpen}
              >
                <DialogTrigger asChild>
                  <Button className="ghost-button project-members-trigger" type="button" variant="outline">
                    <AddressBook size={16} /> 成员
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
                    collaborators={collaborators}
                    newProjectCollaboratorIds={newProjectCollaboratorIds}
                    newProjectName={newProjectName}
                    newProjectTags={newProjectTags}
                    onCancel={() => changeNewProjectDialogOpen(false)}
                    onNewProjectCollaboratorIdsChange={setNewProjectCollaboratorIds}
                    onNewProjectNameChange={setNewProjectName}
                    onNewProjectTagsChange={setNewProjectTags}
                    onSubmit={addProject}
                  />
                </DialogContent>
              </Dialog>
            ) : view === 'collaborators' ? (
              projects.some((project) => project.accessRole === 'owner') && (
                <Button
                  className="solid-button"
                  type="button"
                  onClick={() => setIsNewCollaboratorDialogOpen(true)}
                >
                  <Plus size={17} /> 新增协作者
                </Button>
              )
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
            collaborators={collaborators}
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
            onUpdateJournalVisibility={updateJournalVisibility}
            onDeleteTodo={deleteTodo}
            onTodoCollaboratorChange={setTodoCollaboratorId}
            onTodoDueDateChange={setTodoDueDate}
            onTodoDraftChange={setTodoDraft}
            onTodoPriorityChange={setTodoPriority}
            onToggleTodo={toggleTodo}
            project={selectedProject}
            currentUser={authUser}
            memberships={memberships}
            projects={projects}
            projectTodos={projectTodos}
            todoCollaboratorId={todoCollaboratorId}
            todoDueDate={todoDueDate}
            todoDraft={todoDraft}
            todoPriority={todoPriority}
          />
        )}

        {view === 'project' && !selectedProject && (
          <EmptyWorkspace
            collaborators={collaborators}
            isNewProjectDialogOpen={isNewProjectDialogOpen}
            newProjectCollaboratorIds={newProjectCollaboratorIds}
            newProjectName={newProjectName}
            newProjectTags={newProjectTags}
            onAddProject={addProject}
            onNewProjectCollaboratorIdsChange={setNewProjectCollaboratorIds}
            onNewProjectDialogOpenChange={changeNewProjectDialogOpen}
            onNewProjectNameChange={setNewProjectName}
            onNewProjectTagsChange={setNewProjectTags}
          />
        )}

        {view === 'inbox' && (
          <InboxView
            archiveInboxItem={archiveInboxItem}
            collaborators={collaborators}
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
            collaborators={collaborators}
            memberships={memberships}
            onDeleteTodo={deleteTodo}
            onProjectClick={selectProject}
            onToggleTodo={toggleTodo}
            onUpdateTodo={updateTodoDetails}
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

        {view === 'collaborators' && (
          <CollaboratorsPanel
            collaborators={collaborators}
            isNewCollaboratorDialogOpen={isNewCollaboratorDialogOpen}
            onAddCollaborator={addCollaborator}
            onDeleteCollaborator={deleteCollaborator}
            onEditCollaborator={editCollaborator}
            onNewCollaboratorDialogOpenChange={setIsNewCollaboratorDialogOpen}
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
  const [aiBaseUrlDraft, setAiBaseUrlDraft] = useState('')
  const [aiApiKeyDraft, setAiApiKeyDraft] = useState('')
  const [aiModelDraft, setAiModelDraft] = useState('')
  const [aiHasApiKey, setAiHasApiKey] = useState(false)
  const [aiSettingsBusy, setAiSettingsBusy] = useState(false)
  const [aiSettingsError, setAiSettingsError] = useState('')
  const displayName = getUserDisplayName(user)
  const accountMeta = user?.email ?? '尚未登录'

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
  collaborators,
  isNewProjectDialogOpen,
  newProjectCollaboratorIds,
  newProjectName,
  newProjectTags,
  onAddProject,
  onNewProjectCollaboratorIdsChange,
  onNewProjectDialogOpenChange,
  onNewProjectNameChange,
  onNewProjectTagsChange,
}: {
  collaborators: Collaborator[]
  isNewProjectDialogOpen: boolean
  newProjectCollaboratorIds: number[]
  newProjectName: string
  newProjectTags: string
  onAddProject: () => void
  onNewProjectCollaboratorIdsChange: (value: number[]) => void
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
            collaborators={collaborators}
            newProjectCollaboratorIds={newProjectCollaboratorIds}
            newProjectName={newProjectName}
            newProjectTags={newProjectTags}
            onCancel={() => onNewProjectDialogOpenChange(false)}
            onNewProjectCollaboratorIdsChange={onNewProjectCollaboratorIdsChange}
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
  collaborators,
  newProjectCollaboratorIds,
  newProjectName,
  newProjectTags,
  onCancel,
  onNewProjectCollaboratorIdsChange,
  onNewProjectNameChange,
  onNewProjectTagsChange,
  onSubmit,
}: {
  collaborators: Collaborator[]
  newProjectCollaboratorIds: number[]
  newProjectName: string
  newProjectTags: string
  onCancel: () => void
  onNewProjectCollaboratorIdsChange: (value: number[]) => void
  onNewProjectNameChange: (value: string) => void
  onNewProjectTagsChange: (value: string) => void
  onSubmit: () => void
}) {
  const collaboratorOptions = useMemo(() => {
    const collaboratorMap = new Map<string, Collaborator>()
    collaborators.forEach((collaborator) => {
      const key = collaborator.name.trim()
      if (!key) return
      const current = collaboratorMap.get(key)
      if (!current || collaborator.id < current.id) {
        collaboratorMap.set(key, collaborator)
      }
    })
    return Array.from(collaboratorMap.values()).sort((left, right) =>
      left.name.localeCompare(right.name, 'zh-Hans-CN'),
    )
  }, [collaborators])

  function toggleCollaborator(collaboratorId: number) {
    onNewProjectCollaboratorIdsChange(
      newProjectCollaboratorIds.includes(collaboratorId)
        ? newProjectCollaboratorIds.filter((id) => id !== collaboratorId)
        : [...newProjectCollaboratorIds, collaboratorId],
    )
  }

  const selectedCollaborators = collaboratorOptions.filter((collaborator) =>
    newProjectCollaboratorIds.includes(collaborator.id),
  )
  const collaboratorSummary =
    selectedCollaborators.length === 0
      ? '未指定'
      : selectedCollaborators.length <= 2
        ? selectedCollaborators.map((collaborator) => `@${collaborator.name}`).join('、')
        : `已选择 ${selectedCollaborators.length} 人`

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
      <div className="new-project-collaborators">
        <div className="new-project-collaborators-header">
          <span>指定协作者</span>
          {newProjectCollaboratorIds.length > 0 && (
            <button type="button" onClick={() => onNewProjectCollaboratorIdsChange([])}>
              清空
            </button>
          )}
        </div>
        {collaboratorOptions.length === 0 ? (
          <p>暂无已有协作者。</p>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="new-project-collaborator-trigger" type="button">
                <span>{collaboratorSummary}</span>
                <CaretDown size={18} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="new-project-collaborator-menu"
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              {collaboratorOptions.map((collaborator) => {
                const checked = newProjectCollaboratorIds.includes(collaborator.id)
                return (
                  <DropdownMenuItem
                    key={collaborator.id}
                    data-selected={checked}
                    onSelect={(event) => {
                      event.preventDefault()
                      toggleCollaborator(collaborator.id)
                    }}
                  >
                    <span className={checked ? 'dropdown-check selected' : 'dropdown-check'}>
                      {checked && <Check size={13} weight="bold" />}
                    </span>
                    <span className="new-project-collaborator-option">
                      <strong>@{collaborator.name}</strong>
                      <small>{collaborator.role || '协作者'}</small>
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
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
  collaborators,
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
  onUpdateJournalVisibility,
  onDeleteTodo,
  onTodoCollaboratorChange,
  onTodoDueDateChange,
  onTodoDraftChange,
  onTodoPriorityChange,
  onToggleTodo,
  project,
  currentUser,
  memberships,
  projects,
  projectTodos,
  todoCollaboratorId,
  todoDueDate,
  todoDraft,
  todoPriority,
}: {
  collaborators: Collaborator[]
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
  onUpdateJournalVisibility: (
    projectId: number,
    entryId: number,
    visibility: JournalVisibility,
  ) => void
  onDeleteTodo: (todoId: number) => void
  onTodoCollaboratorChange: (id: number | null) => void
  onTodoDueDateChange: (value: string) => void
  onTodoDraftChange: (value: string) => void
  onTodoPriorityChange: (value: Priority) => void
  onToggleTodo: (id: number) => void
  project: Project
  currentUser: AuthUser | null
  memberships: ProjectMembership[]
  projects: Project[]
  projectTodos: Todo[]
  todoCollaboratorId: number | null
  todoDueDate: string
  todoDraft: string
  todoPriority: Priority
}) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [projectNameDraft, setProjectNameDraft] = useState(project.name)
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
  const visibleJournals = project.journals.filter((entry) =>
    entry.createdAt.startsWith(selectedJournalDate),
  )
  const selectedJournalDateIndex = journalDates.indexOf(selectedJournalDate)
  const previousJournalDate =
    selectedJournalDateIndex >= 0
      ? journalDates[selectedJournalDateIndex + 1]
      : undefined
  const nextJournalDate =
    selectedJournalDateIndex > 0
      ? journalDates[selectedJournalDateIndex - 1]
      : undefined
  const projectCollaborators = collaborators.filter(
    (collaborator) => collaborator.projectId === project.id,
  )
  const projectMembers = getProjectAssignableUsers(project, memberships)
  const isOwner = project.accessRole === 'owner'

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
    <div className="detail-layout">
      <Card className="panel journal-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">项目日记</p>
            <div className="project-title-row">
              <h3>{project.name}</h3>
              <ProjectTags tags={project.tags} />
              {project.accessRole === 'member' && (
                <Badge className="access-pill">协作项目 · Owner {project.ownerName}</Badge>
              )}
            </div>
          </div>
          <div className="project-header-actions">
            {isOwner ? (
              <>
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
              </>
            ) : (
              <Badge className={`status-pill ${project.status}`}>
                {statusCopy[project.status]}
              </Badge>
            )}
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
        <Label className="textarea-label">
          追加今日记录
          <MentionTextarea
            collaborators={collaborators}
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
              return (
                <article className="history-item" key={entry.id}>
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
                          className="history-risk-button"
                          variant="ghost"
                          size="icon"
                          type="button"
                          aria-label="标记为项目风险"
                          title="标记为项目风险"
                          onClick={() => onMarkJournalAsRisk(project.id, entry.id)}
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

      <Card className="panel side-panel">
        <PanelTitle icon={<Check size={18} />} title="项目待办" />
        <div className="todo-form">
          <MentionTextarea
            collaborators={projectCollaborators}
            members={projectMembers}
            onSelectCollaborator={onTodoCollaboratorChange}
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
              <ProjectMemberPicker
                members={projectMembers}
                value={todoCollaboratorId}
                onChange={onTodoCollaboratorChange}
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
            todos={projectTodos}
            projects={projects}
            onDeleteTodo={onDeleteTodo}
            onToggleTodo={onToggleTodo}
            compact
          />
          <div className="side-section">
            <PanelTitle icon={<WarningCircle size={18} />} title="风险与阻塞" />
            <RiskList
              canResolve={isOwner}
              project={project}
              onResolveRisk={onResolveRisk}
            />
          </div>
        </div>
      </Card>
    </div>
  )
}

function ProjectMembersPanel({
  memberships,
  onInvite,
  onRemove,
}: {
  memberships: ProjectMembership[]
  onInvite: (email: string) => void
  onRemove: (membershipId: number) => void
}) {
  const [email, setEmail] = useState('')

  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextEmail = email.trim()
    if (!nextEmail) return
    onInvite(nextEmail)
    setEmail('')
  }

  return (
    <div className="project-members-panel">
      <PanelTitle icon={<AddressBook size={18} />} title="项目成员" />
      <form className="member-invite-form" onSubmit={submitInvite}>
        <Input
          type="email"
          placeholder="输入邮箱邀请"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button className="solid-button" type="submit" disabled={!email.trim()}>
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
                  {membership.invitedEmail} · {membership.status === 'pending'
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
  collaborators,
  currentUserId,
  memberships,
  onDeleteTodo,
  onProjectClick,
  onToggleTodo,
  onUpdateTodo,
  projects,
  todos,
}: {
  collaborators: Collaborator[]
  currentUserId?: number
  memberships: ProjectMembership[]
  onDeleteTodo: (id: number) => void
  onProjectClick: (id: number) => void
  onToggleTodo: (id: number) => void
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
            .sort((left, right) => {
              if (left.done !== right.done) return left.done ? 1 : -1
              const dueDiff = left.dueDate.localeCompare(right.dueDate)
              if (dueDiff !== 0) return dueDiff
              return priorityRank[left.priority] - priorityRank[right.priority]
            })
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
              <span role="columnheader">优先级</span>
              <span role="columnheader">截止</span>
              <span role="columnheader">状态</span>
              <span role="columnheader">操作</span>
            </div>

            {groupedTodos.map(({ openCount: projectOpenCount, project, todos: projectTodos }) => (
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
                    const projectCollaborators = collaborators.filter(
                      (collaborator) => collaborator.projectId === project.id,
                    )
                    const projectMembers = getProjectAssignableUsers(project, memberships)
                    const canManageTodo =
                      project.accessRole === 'owner' || todo.createdByUserId === currentUserId
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
                          <strong>{todo.title}</strong>
                        </span>
                        <span className="todo-board-assignee-cell" role="cell">
                          <ProjectMemberPicker
                            members={projectMembers}
                            value={todo.assigneeUserId ?? todo.collaboratorId ?? null}
                            compact
                            disabled={!canManageTodo}
                            onChange={(assigneeUserId) =>
                              onUpdateTodo(
                                todo.id,
                                assigneeUserId ? { assigneeUserId } : { assigneeUserId: null },
                              )
                            }
                          />
                          {!todo.assigneeUserId && todo.collaboratorId && (
                            <span className="todo-board-muted">
                              {projectCollaborators.find((item) => item.id === todo.collaboratorId)?.name ?? '旧协作者'}
                            </span>
                          )}
                        </span>
                        <span className="todo-board-priority-cell" role="cell">
                          <Select
                            value={todo.priority}
                            disabled={!canManageTodo}
                            onValueChange={(value) =>
                              onUpdateTodo(todo.id, { priority: value as Priority })
                            }
                          >
                            <SelectTrigger
                              aria-label="修改待办优先级"
                              className="todo-board-select-trigger"
                            >
                              <SelectValue placeholder="优先级" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="high">高</SelectItem>
                              <SelectItem value="medium">中</SelectItem>
                              <SelectItem value="low">低</SelectItem>
                            </SelectContent>
                          </Select>
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
    kind: 'project_invite' | 'assigned_todo' | 'todo_due_tomorrow',
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
  const isEmpty =
    visibleInvites.length === 0 &&
    visibleAssignedTodos.length === 0 &&
    visibleDueTomorrowTodos.length === 0

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
        </div>
      )}
    </Card>
  )
}

function CollaboratorsPanel({
  collaborators,
  isNewCollaboratorDialogOpen,
  onAddCollaborator,
  onDeleteCollaborator,
  onEditCollaborator,
  onNewCollaboratorDialogOpenChange,
  projects,
}: {
  collaborators: Collaborator[]
  isNewCollaboratorDialogOpen: boolean
  onAddCollaborator: (payload: {
    name: string
    projectIds: number[]
    role: string
  }) => void
  onDeleteCollaborator: (collaboratorId: number) => void
  onEditCollaborator: (
    collaboratorId: number,
    payload: {
      name: string
      projectIds: number[]
      role: string
    },
  ) => void
  onNewCollaboratorDialogOpenChange: (open: boolean) => void
  projects: Project[]
}) {
  const [editingPerson, setEditingPerson] = useState<CollaboratorPerson | null>(null)
  const collaboratorsByPerson = useMemo(() => {
    const personMap = new Map<string, CollaboratorPerson & { projectIds: Set<number> }>()

    collaborators.forEach((collaborator) => {
      const key = collaborator.name.trim() || String(collaborator.id)
      const current =
        personMap.get(key) ??
        {
          primaryId: collaborator.id,
          name: collaborator.name,
          projectIds: new Set<number>(),
          projects: [],
          roles: [],
        }
      const project = projects.find((item) => item.id === collaborator.projectId)
      current.primaryId = Math.min(current.primaryId, collaborator.id)
      if (project && !current.projectIds.has(project.id)) {
        current.projectIds.add(project.id)
        current.projects.push(project)
      }
      if (collaborator.role && !current.roles.includes(collaborator.role)) {
        current.roles.push(collaborator.role)
      }
      personMap.set(key, current)
    })

    return Array.from(personMap.values())
      .map((personWithProjectIds) => {
        const { name, primaryId, projects, roles } = personWithProjectIds
        return { name, primaryId, projects, roles }
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
  }, [collaborators, projects])

  return (
    <Card className="panel collaborators-panel">
      <div className="collaborators-header">
        <PanelTitle icon={<SignIn size={18} />} title="协作者" />
        <span>{collaboratorsByPerson.length} 人</span>
      </div>
      <NewCollaboratorDialog
        open={isNewCollaboratorDialogOpen}
        onAddCollaborator={onAddCollaborator}
        onOpenChange={onNewCollaboratorDialogOpenChange}
        projects={projects}
      />

      <div className="collaborator-groups">
        {collaboratorsByPerson.length === 0 ? (
          <p className="empty-state">还没有协作者。</p>
        ) : (
          collaboratorsByPerson.map((person) => (
            <article className="collaborator-person-card" key={person.primaryId}>
              <div className="collaborator-person-main">
                <strong>@{person.name}</strong>
                <small>
                  {person.roles.length > 0 ? person.roles.join('、') : '未设置角色'}
                </small>
              </div>
              <div className="collaborator-projects" aria-label={`${person.name} 参与的项目`}>
                {person.projects.length === 0 ? (
                  <span className="todo-board-muted">未关联项目</span>
                ) : (
                  person.projects.map((project) => (
                    <span className="collaborator-project-chip" key={project.id}>
                      {project.name}
                    </span>
                  ))
                )}
              </div>
              <div className="collaborator-actions">
                <Button
                  className="collaborator-edit-button"
                  variant="ghost"
                  size="icon"
                  type="button"
                  aria-label={`编辑 ${person.name}`}
                  title="编辑协作者"
                  onClick={() => setEditingPerson(person)}
                >
                  <PencilSimple size={16} />
                </Button>
                <ConfirmDialog
                  confirmLabel="删除协作者"
                  description={`删除「${person.name}」后，TA 会从所有关联项目中移除，相关待办的负责人会变为未指派。`}
                  onConfirm={() => onDeleteCollaborator(person.primaryId)}
                  title="确认删除这个协作者？"
                  trigger={
                    <Button
                      className="todo-delete-button"
                      variant="ghost"
                      size="icon"
                      type="button"
                      aria-label={`删除 ${person.name}`}
                      title="删除协作者"
                    >
                      <Trash size={16} />
                    </Button>
                  }
                />
              </div>
            </article>
          ))
        )}
      </div>
      <EditCollaboratorDialog
        person={editingPerson}
        onEditCollaborator={onEditCollaborator}
        onOpenChange={(open) => {
          if (!open) setEditingPerson(null)
        }}
        projects={projects}
      />
    </Card>
  )
}

function NewCollaboratorDialog({
  onAddCollaborator,
  onOpenChange,
  open,
  projects,
}: {
  onAddCollaborator: (payload: {
    name: string
    projectIds: number[]
    role: string
  }) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  projects: Project[]
}) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([])

  function resetForm() {
    setName('')
    setRole('')
    setSelectedProjectIds([])
  }

  function closeDialog() {
    resetForm()
    onOpenChange(false)
  }

  function submitCollaborator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || selectedProjectIds.length === 0) return
    onAddCollaborator({
      name,
      projectIds: selectedProjectIds,
      role,
    })
    resetForm()
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) resetForm()
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新增协作者</DialogTitle>
          <DialogDescription>
            添加协作者后，可以在日记、快速捕捉和待办里通过 @ 关联到对应的人。
          </DialogDescription>
        </DialogHeader>
        <form className="collaborator-form" onSubmit={submitCollaborator}>
          <Label>
            姓名
            <Input
              autoFocus
              placeholder="例如：张三"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Label>
          <Label>
            角色
            <Input
              placeholder="例如：产品负责人"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            />
          </Label>
          <Label>
            所属项目
            <ProjectMultiSelect
              projects={projects}
              selectedProjectIds={selectedProjectIds}
              onChange={setSelectedProjectIds}
            />
          </Label>
          <DialogFooter>
            <Button
              className="ghost-button"
              variant="outline"
              type="button"
              onClick={closeDialog}
            >
              取消
            </Button>
            <Button
              className="solid-button"
              type="submit"
              disabled={!name.trim() || selectedProjectIds.length === 0}
            >
              <Plus size={15} /> 添加协作者
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditCollaboratorDialog({
  onEditCollaborator,
  onOpenChange,
  person,
  projects,
}: {
  onEditCollaborator: (
    collaboratorId: number,
    payload: {
      name: string
      projectIds: number[]
      role: string
    },
  ) => void
  onOpenChange: (open: boolean) => void
  person: CollaboratorPerson | null
  projects: Project[]
}) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([])

  useEffect(() => {
    if (!person) return
    setName(person.name)
    setRole(person.roles[0] ?? '')
    setSelectedProjectIds(person.projects.map((project) => project.id))
  }, [person])

  function submitCollaborator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!person || !name.trim() || selectedProjectIds.length === 0) return
    onEditCollaborator(person.primaryId, {
      name,
      projectIds: selectedProjectIds,
      role,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={Boolean(person)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑协作者</DialogTitle>
          <DialogDescription>
            修改协作者信息和负责板块后，相关项目中的协作者信息会同步更新。
          </DialogDescription>
        </DialogHeader>
        <form className="collaborator-form" onSubmit={submitCollaborator}>
          <Label>
            姓名
            <Input
              autoFocus
              placeholder="例如：张三"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Label>
          <Label>
            角色
            <Input
              placeholder="例如：产品负责人"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            />
          </Label>
          <Label>
            负责板块
            <ProjectMultiSelect
              projects={projects}
              selectedProjectIds={selectedProjectIds}
              onChange={setSelectedProjectIds}
            />
          </Label>
          <DialogFooter>
            <Button
              className="ghost-button"
              variant="outline"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              className="solid-button"
              type="submit"
              disabled={!name.trim() || selectedProjectIds.length === 0}
            >
              保存修改
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProjectMultiSelect({
  onChange,
  projects,
  selectedProjectIds,
}: {
  onChange: (ids: number[]) => void
  projects: Project[]
  selectedProjectIds: number[]
}) {
  const selectedProjects = projects.filter((project) =>
    selectedProjectIds.includes(project.id),
  )
  const label =
    selectedProjects.length === 0
      ? '选择项目'
      : selectedProjects.length === 1
        ? selectedProjects[0].name
        : `已选 ${selectedProjects.length} 个项目`

  function toggleProject(projectId: number) {
    onChange(
      selectedProjectIds.includes(projectId)
        ? selectedProjectIds.filter((id) => id !== projectId)
        : [...selectedProjectIds, projectId],
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="project-multi-trigger" type="button">
          <span>{label}</span>
          <CaretDown size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="project-multi-menu">
        {projects.map((project) => {
          const checked = selectedProjectIds.includes(project.id)
          return (
            <button
              className={checked ? 'project-multi-option selected' : 'project-multi-option'}
              key={project.id}
              type="button"
              onClick={() => toggleProject(project.id)}
            >
              <span>{project.name}</span>
              {checked ? <Check size={16} /> : null}
            </button>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MentionTextarea({
  collaborators,
  members,
  onChange,
  onSelectCollaborator,
  value,
  ...props
}: Omit<ComponentProps<typeof Textarea>, 'onChange' | 'value'> & {
  collaborators: Collaborator[]
  members?: Array<{ id: number; name: string }>
  onChange: (value: string) => void
  onSelectCollaborator?: (id: number) => void
  value: string
}) {
  return (
    <MentionInputShell
      collaborators={collaborators}
      members={members}
      multiline
      onChange={onChange}
      onSelectCollaborator={onSelectCollaborator}
      value={value}
      inputProps={props}
    />
  )
}

function MentionInputShell({
  collaborators,
  inputProps,
  members = [],
  multiline = false,
  onChange,
  onSelectCollaborator,
  value,
}: {
  collaborators: Collaborator[]
  inputProps: Record<string, unknown>
  members?: Array<{ id: number; name: string }>
  multiline?: boolean
  onChange: (value: string) => void
  onSelectCollaborator?: (id: number) => void
  value: string
}) {
  const [open, setOpen] = useState(false)
  const [mentionRange, setMentionRange] = useState<{ caret: number; index: number } | null>(null)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const shellRef = useRef<HTMLSpanElement | null>(null)
  const mentionCollaborators = useMemo(() => {
    const seen = new Set<string>()
    if (members.length > 0) {
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
    }
    return collaborators.filter((collaborator) => {
      const key = collaborator.name.trim()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [collaborators, members])
  const canMention = mentionCollaborators.length > 0
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

  function chooseCollaborator(collaborator: MentionOption) {
    const range = mentionRange
    const nextValue = range
      ? `${value.slice(0, range.index)}@${collaborator.name} ${value.slice(range.caret)}`
      : `${value}@${collaborator.name} `
    onChange(nextValue)
    onSelectCollaborator?.(collaborator.id)
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
          {mentionCollaborators.map((collaborator) => (
            <button
              className="mention-option"
              key={collaborator.id}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault()
                chooseCollaborator(collaborator)
              }}
            >
              <strong>@{collaborator.name}</strong>
              <small>{collaborator.role || '协作者'}</small>
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripTodoMentions(
  value: string,
  members: Array<{ id: number; name: string }>,
) {
  return members.reduce((current, member) => {
    const name = member.name.trim()
    if (!name) return current
    return current.replace(new RegExp(`(^|\\s)@${escapeRegExp(name)}(?=\\s|$)`, 'g'), '$1')
  }, value).replace(/\s{2,}/g, ' ')
}

function extractMentionAssignee(
  value: string,
  members: Array<{ id: number; name: string }>,
) {
  return members.find((member) => {
    const name = member.name.trim()
    return name && new RegExp(`(^|\\s)@${escapeRegExp(name)}(?=\\s|$)`).test(value)
  })
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
    <span className={compact ? 'collaborator-picker compact' : 'collaborator-picker'}>
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

function InboxView({
  archiveInboxItem,
  collaborators,
  inbox,
  inboxDraft,
  onAddInboxItem,
  onDeleteInboxItem,
  onDraftChange,
  projects,
}: {
  archiveInboxItem: (item: InboxItem, projectId: number) => void
  collaborators: Collaborator[]
  inbox: InboxItem[]
  inboxDraft: string
  onAddInboxItem: () => void
  onDeleteInboxItem: (itemId: number) => void
  onDraftChange: (value: string) => void
  projects: Project[]
}) {
  const [isComposing, setIsComposing] = useState(false)

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
              collaborators={collaborators}
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
                {project.accessRole === 'member' && <Badge className="access-pill">协作</Badge>}
                <span>创建于 {project.createdAt}</span>
              </div>
              <div className="result-title-row">
                <h3>{project.name}</h3>
                <ProjectTags tags={project.tags} compact />
              </div>
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

function TodoList({
  compact = false,
  currentUserId,
  onDeleteTodo,
  onToggleTodo,
  projects,
  todos,
}: {
  compact?: boolean
  currentUserId?: number
  onDeleteTodo: (id: number) => void
  onToggleTodo: (id: number) => void
  projects: Project[]
  todos: Todo[]
}) {
  const [page, setPage] = useState(0)
  const { containerRef, itemsPerPage } = useAdaptivePageSize({
    compact,
    defaultPageSize: compact ? 3 : 6,
    itemHeight: 64,
    maxPageSize: 5,
    minPageSize: 2,
    reservedHeight: (viewportHeight) => (viewportHeight < 820 ? 320 : 380),
  })

  const totalPages = Math.max(1, Math.ceil(todos.length / itemsPerPage))
  const safePage = Math.min(page, totalPages - 1)
  const visibleTodos = compact
    ? todos.slice(safePage * itemsPerPage, safePage * itemsPerPage + itemsPerPage)
    : todos

  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(0, totalPages - 1)))
  }, [totalPages])

  useEffect(() => {
    setPage(0)
  }, [todos])

  if (todos.length === 0) {
    return <p className="empty-state">暂时没有待办。</p>
  }

  return (
    <div className={compact ? 'todo-list-shell compact' : 'todo-list-shell'} ref={containerRef}>
      <div className={compact ? 'todo-list compact' : 'todo-list'}>
      {visibleTodos.map((todo) => {
        const project = projects.find((item) => item.id === todo.projectId)
        const canManageTodo =
          project?.accessRole === 'owner' || todo.createdByUserId === currentUserId
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
              <strong>{todo.title}</strong>
              <small>
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
    </div>
  )
}

function RiskList({
  canResolve = true,
  onResolveRisk,
  project,
}: {
  canResolve?: boolean
  onResolveRisk: (projectId: number, risk: string) => void
  project: Project
}) {
  const [page, setPage] = useState(0)
  const { containerRef, itemsPerPage } = useAdaptivePageSize({
    compact: true,
    defaultPageSize: 2,
    itemHeight: 108,
    maxPageSize: 4,
    minPageSize: 1,
    reservedHeight: () => 104,
  })
  const totalPages = Math.max(1, Math.ceil(project.risks.length / itemsPerPage))
  const safePage = Math.min(page, totalPages - 1)
  const visibleRisks = project.risks.slice(
    safePage * itemsPerPage,
    safePage * itemsPerPage + itemsPerPage,
  )

  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(0, totalPages - 1)))
  }, [totalPages])

  useEffect(() => {
    setPage(0)
  }, [project.id, project.risks])

  if (project.risks.length === 0) {
    return <p className="empty-state">当前项目还没有记录风险。</p>
  }

  return (
    <div className="risk-list-shell" ref={containerRef}>
      <div className="risk-list">
        {visibleRisks.map((risk) => (
          <article key={risk} className="risk-item">
            <div className="risk-item-header">
              <strong>{project.name}</strong>
              {canResolve && (
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
              )}
            </div>
            <p>{risk}</p>
          </article>
        ))}
      </div>
      {totalPages > 1 && (
        <SidePager
          label="风险翻页"
          page={safePage}
          totalPages={totalPages}
          onPrevious={() => setPage((current) => Math.max(0, current - 1))}
          onNext={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
        />
      )}
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
  if (view === 'collaborators') return '协作者'
  if (view === 'inbox') return '草稿箱'
  if (view === 'search') return '项目篮子'
  return 'AI 总结文档'
}

export default App
