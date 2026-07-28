import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'
import {
  ArrowLeft,
  Bell,
  Bug,
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretDown,
  CaretLeft,
  CaretRight,
  CheckCircle,
  ClipboardText,
  CopySimple,
  DownloadSimple,
  FileCsv,
  Flask,
  FolderPlus,
  GearSix,
  ListChecks,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  UploadSimple,
  UserPlus,
  WarningCircle,
  X,
  XCircle,
} from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { JournalDatePicker } from '@/components/journal-date-picker'
import { notificationRefreshIntervalMs } from '@/notifications'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { uploadWorkbenchAttachment } from '@/api'
import {
  addAssignedTestBugComment,
  addTestBugComment,
  acceptTestSpaceInvitation,
  acceptTestSpaceInviteLink,
  createTestBug,
  createTestCase,
  createTestCaseFolder,
  createTestPlan,
  createTestSpace,
  createTestSpaceInviteLink,
  createTestSubject,
  declineTestSpaceInvitation,
  deleteAssignedTestBugComment,
  deleteTestCaseFolder,
  deleteTestPlan,
  deleteTestSpace,
  deleteTestSubject,
  deleteTestBugComment,
  fetchAssignedTestBugs,
  fetchTestSpaceInviteLinkInfo,
  fetchTestSpaceSettings,
  fetchTestWorkbench,
  importTestCases,
  inviteTestSpaceMember,
  previewTestCaseImport,
  removeTestPlanCase,
  removeTestSpaceMember,
  updateTestSpace,
  updateAssignedTestBugComment,
  updateAssignedTestBug,
  updateTestBug,
  updateTestBugComment,
  updateTestCase,
  updateTestCaseFolder,
  updateTestPlan,
  updateTestPlanCase,
  updateTestPlanStatus,
  updateTestSpaceMember,
  verifyTestSpaceInviteLink,
} from '@/test-workbench-api'
import type {
  BugSeverity,
  BugStatus,
  TestBug,
  TestBugComment,
  TestCase,
  TestCaseType,
  TestCaseImportPreview,
  TestPlan,
  TestResult,
  TestSpaceInvitation,
  TestSpaceSettings,
  TestSubject,
  TestWorkbenchData,
  TestWorkbenchProjectOption,
} from '@/test-workbench-types'
import type { Priority } from '@/types'
import './test-workbench.css'

type WorkbenchTab = 'cases' | 'plans' | 'bugs' | 'notifications'

const emptyWorkbench: TestWorkbenchData = {
  bugs: [],
  cases: [],
  folders: [],
  planCases: [],
  plans: [],
  spaces: [],
  subjects: [],
  users: [],
}

const priorityLabel: Record<Priority, string> = { high: '高', low: '低', medium: '中' }
const caseLevelLabel: Record<Priority, 'P0' | 'P1' | 'P2'> = { high: 'P0', low: 'P2', medium: 'P1' }
const caseTypeLabel: Record<TestCaseType, string> = {
  functional: '功能',
  performance: '性能',
  regression: '回归',
  security: '安全',
  smoke: '冒烟',
}
const caseKindLabel: Record<TestCase['caseKind'], string> = {
  baseline: '基线用例',
  functional: '功能用例',
}
const testCaseCsvTemplateHeaders = [
  '用例名称',
  '所属模块',
  '前置条件',
  '步骤描述',
  '预期结果',
  '备注',
  '用例等级',
  '自定义标签',
]
const resultLabel: Record<TestResult, string> = {
  blocked: '阻塞',
  failed: '失败',
  passed: '通过',
  skipped: '跳过',
  untested: '未执行',
}
const planStatusLabel: Record<TestPlan['status'], string> = {
  aborted: '已终止',
  completed: '已完成',
  draft: '草稿',
  in_progress: '执行中',
}
const bugStatusLabel: Record<BugStatus, string> = {
  assigned: '待修复',
  closed: '已关闭',
  confirmed: '已确认',
  duplicate: '重复 Bug',
  in_progress: '修复中',
  new: '待确认',
  pending_verification: '待验证',
  rejected: '已拒绝',
  reopened: '重新打开',
}
const severityLabel: Record<BugSeverity, string> = {
  blocker: '阻断',
  critical: '严重',
  major: '主要',
  minor: '次要',
  trivial: '轻微',
}
const PLAN_EXECUTION_ROW_BLOCK_SIZE = 88
const emptyTestSpaceSettings: TestSpaceSettings = { invitations: [], organizations: [], spaces: [] }
const testSpaceInviteParam = 'testSpaceInvite'
const seenBugCommentStoragePrefix = 'veges.testWorkbench.seenBugComments.v1'
const readNotificationStoragePrefix = 'veges.testWorkbench.readNotifications.v1'

type BugCommentNotification = {
  bug: TestBug
  comment: TestBugComment
}

type PlanAssignmentNotification = {
  plan: TestPlan
}

function getTestSpaceInviteTokenFromUrl() {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get(testSpaceInviteParam)?.trim() ?? ''
}

function clearTestSpaceInviteTokenFromUrl() {
  const url = new URL(window.location.href)
  url.searchParams.delete(testSpaceInviteParam)
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

function buildTestSpaceInviteUrl(token: string) {
  const url = new URL(window.location.href)
  url.searchParams.set(testSpaceInviteParam, token)
  return url.toString()
}

function getTimestampMs(value?: string) {
  const timestamp = Date.parse(value ?? '')
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function getBugCommentTimestamp(comment: TestBugComment) {
  return getTimestampMs(comment.updatedAt || comment.createdAt)
}

function getLatestBugComment(bug: TestBug) {
  return bug.comments.slice().sort((left, right) => getBugCommentTimestamp(right) - getBugCommentTimestamp(left))[0]
}

function getSeenBugCommentStorageKey(currentUserId?: number) {
  return currentUserId ? `${seenBugCommentStoragePrefix}.${currentUserId}` : ''
}

function readSeenBugCommentIds(currentUserId?: number) {
  const storageKey = getSeenBugCommentStorageKey(currentUserId)
  if (typeof window === 'undefined' || !storageKey) return new Set<number>()
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return new Set<number>()
    return new Set(parsed.map((value) => Number(value)).filter(Number.isFinite))
  } catch {
    return new Set<number>()
  }
}

function writeSeenBugCommentIds(currentUserId: number | undefined, ids: Set<number>) {
  const storageKey = getSeenBugCommentStorageKey(currentUserId)
  if (typeof window === 'undefined' || !storageKey) return
  window.localStorage.setItem(storageKey, JSON.stringify(Array.from(ids)))
}

function getReadNotificationStorageKey(currentUserId?: number) {
  return currentUserId ? `${readNotificationStoragePrefix}.${currentUserId}` : ''
}

function loadReadNotificationKeys(currentUserId?: number) {
  const storageKey = getReadNotificationStorageKey(currentUserId)
  if (typeof window === 'undefined' || !storageKey) return new Set<string>()
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return new Set<string>()
    return new Set(parsed.map((value) => String(value)).filter(Boolean))
  } catch {
    return new Set<string>()
  }
}

function writeReadNotificationKeys(currentUserId: number | undefined, keys: Set<string>) {
  const storageKey = getReadNotificationStorageKey(currentUserId)
  if (typeof window === 'undefined' || !storageKey) return
  window.localStorage.setItem(storageKey, JSON.stringify(Array.from(keys)))
}

function getBugReturnNotificationKey(bug: TestBug) {
  return `bug-return:${bug.id}:${bug.status}:${bug.updatedAt}`
}

function getPlanAssignmentNotificationKey(plan: TestPlan) {
  return `plan-assignment:${plan.id}:${plan.ownerUserId ?? 'none'}:${plan.updatedAt}`
}

function generateTestSpaceInvitePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const values = globalThis.crypto.getRandomValues(new Uint8Array(10))
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('')
}

function formatInviteDuration(minutes: number) {
  if (minutes === 1440) return '24 小时'
  if (minutes === 240) return '4 小时'
  return `${minutes} 分钟`
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(new Date(value))
}

function WorkspaceError({ message }: { message: string }) {
  return message ? <div className="test-workbench-error"><WarningCircle /> {message}</div> : null
}

export function TestWorkbench({
  accountMenu,
  currentUserId,
  projects,
}: {
  accountMenu: ReactNode
  currentUserId?: number
  projects: TestWorkbenchProjectOption[]
}) {
  const [data, setData] = useState<TestWorkbenchData>(emptyWorkbench)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<WorkbenchTab>('cases')
  const [spaceId, setSpaceId] = useState<number>()
  const [subjectId, setSubjectId] = useState<number>()
  const [selectedCaseId, setSelectedCaseId] = useState<number>()
  const [selectedPlanId, setSelectedPlanId] = useState<number>()
  const [selectedBugId, setSelectedBugId] = useState<number>()
  const [spaceSwitcherOpen, setSpaceSwitcherOpen] = useState(false)
  const [spaceAdministrationOpen, setSpaceAdministrationOpen] = useState(false)
  const [spaceCreateOpen, setSpaceCreateOpen] = useState(false)
  const [spaceSettings, setSpaceSettings] = useState<TestSpaceSettings>(emptyTestSpaceSettings)
  const [subjectDialogOpen, setSubjectDialogOpen] = useState(false)
  const [subjectPendingDelete, setSubjectPendingDelete] = useState<TestSubject>()
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [caseDialogOpen, setCaseDialogOpen] = useState(false)
  const [caseImportDialogOpen, setCaseImportDialogOpen] = useState(false)
  const [editingCase, setEditingCase] = useState<TestCase>()
  const [planDialogOpen, setPlanDialogOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<TestPlan>()
  const [planPendingDelete, setPlanPendingDelete] = useState<TestPlan>()
  const [bugDialogOpen, setBugDialogOpen] = useState(false)
  const [bugSeed, setBugSeed] = useState<Partial<TestBug>>({})
  const [inviteToken, setInviteToken] = useState(getTestSpaceInviteTokenFromUrl)
  const [invitePasswordChecking, setInvitePasswordChecking] = useState(false)
  const [invitePasswordDraft, setInvitePasswordDraft] = useState('')
  const [invitePasswordRequired, setInvitePasswordRequired] = useState(false)
  const [invitePasswordVerified, setInvitePasswordVerified] = useState(false)
  const [invitePasswordError, setInvitePasswordError] = useState('')
  const [seenBugCommentIds, setSeenBugCommentIds] = useState<Set<number>>(() => readSeenBugCommentIds(currentUserId))
  const [readNotificationKeySet, setReadNotificationKeySet] = useState<Set<string>>(() => loadReadNotificationKeys(currentUserId))
  const acceptingInviteTokenRef = useRef('')

  useEffect(() => {
    setSeenBugCommentIds(readSeenBugCommentIds(currentUserId))
    setReadNotificationKeySet(loadReadNotificationKeys(currentUserId))
  }, [currentUserId])

  useEffect(() => {
    let cancelled = false
    fetchTestWorkbench()
      .then((result) => {
        if (cancelled) return
        setData(result)
        setSpaceId(result.spaces[0]?.id)
        setLoading(false)
      })
      .catch((loadError) => {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : '测试工作台加载失败。')
        setLoading(false)
      })
    fetchTestSpaceSettings()
      .then((result) => {
        if (cancelled) return
        setSpaceSettings(result)
        if (result.spaces.length === 0 && result.invitations.length > 0) setTab('notifications')
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (loading) return
    let cancelled = false
    const refreshIfVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (busy) return
      fetchTestWorkbench()
        .then((result) => {
          if (!cancelled) setData(result)
        })
        .catch(() => undefined)
      fetchTestSpaceSettings()
        .then((result) => {
          if (!cancelled) setSpaceSettings(result)
        })
        .catch(() => undefined)
    }
    const interval = window.setInterval(refreshIfVisible, notificationRefreshIntervalMs)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [busy, loading])

  useEffect(() => {
    setInvitePasswordDraft('')
    setInvitePasswordError('')
    setInvitePasswordRequired(false)
    setInvitePasswordVerified(false)
    if (!inviteToken) {
      setInvitePasswordChecking(false)
      return
    }
    let cancelled = false
    setInvitePasswordChecking(true)
    fetchTestSpaceInviteLinkInfo(inviteToken)
      .then((result) => {
        if (cancelled) return
        setInvitePasswordRequired(result.passwordRequired)
        setInvitePasswordVerified(!result.passwordRequired)
      })
      .catch(() => {
        if (cancelled) return
        setError('测试空间邀请链接无效或已失效。')
        setInviteToken('')
        clearTestSpaceInviteTokenFromUrl()
      })
      .finally(() => {
        if (!cancelled) setInvitePasswordChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [inviteToken])

  useEffect(() => {
    if (!inviteToken || invitePasswordChecking) return
    if (invitePasswordRequired && !invitePasswordVerified) return
    if (acceptingInviteTokenRef.current === inviteToken) return
    acceptingInviteTokenRef.current = inviteToken
    acceptTestSpaceInviteLink(inviteToken, invitePasswordDraft.trim() || undefined)
      .then(({ workbench }) => {
        setData(workbench)
        setError('')
        setInviteToken('')
        clearTestSpaceInviteTokenFromUrl()
        void refreshSpaceSettings()
      })
      .catch(() => {
        setInvitePasswordError('测试空间邀请链接无效、已失效或密码不正确。')
        if (invitePasswordRequired) {
          setInvitePasswordVerified(false)
        } else {
          setInviteToken('')
          clearTestSpaceInviteTokenFromUrl()
        }
      })
      .finally(() => {
        acceptingInviteTokenRef.current = ''
      })
  }, [invitePasswordChecking, invitePasswordDraft, invitePasswordRequired, invitePasswordVerified, inviteToken])

  const activeSpace = data.spaces.find((space) => space.id === spaceId)
  const activeSpaceReadOnly = activeSpace?.accessLevel === 'viewer'
  const subjects = data.subjects.filter((subject) => subject.testSpaceId === spaceId)
  const activeSubject = subjects.find((subject) => subject.id === subjectId)
  const spaceCases = data.cases.filter((testCase) => testCase.testSpaceId === spaceId)
  const cases = spaceCases.filter(
    (testCase) => testCase.testSpaceId === spaceId && (!subjectId || testCase.testSubjectId === subjectId),
  )
  const plans = data.plans.filter(
    (plan) => plan.testSpaceId === spaceId,
  )
  const bugs = data.bugs.filter(
    (bug) => bug.testSpaceId === spaceId && (!subjectId || bug.testSubjectId === subjectId),
  )
  const returnedBugs = data.bugs.filter((bug) => bug.status === 'pending_verification' || bug.status === 'reopened')
  const bugCommentNotifications: BugCommentNotification[] = currentUserId
    ? data.bugs
      .map((bug) => {
        const latestComment = getLatestBugComment(bug)
        if (!latestComment?.authorUserId || latestComment.authorUserId === currentUserId) return undefined
        if (bug.status === 'closed' || bug.status === 'duplicate' || bug.status === 'rejected') return undefined
        return { bug, comment: latestComment }
      })
      .filter((item): item is BugCommentNotification => Boolean(item))
    : []
  const planAssignmentNotifications: PlanAssignmentNotification[] = currentUserId
    ? data.plans
      .filter((plan) =>
        plan.ownerUserId === currentUserId &&
        plan.createdByUserId !== currentUserId &&
        plan.status !== 'completed' &&
        plan.status !== 'aborted',
      )
      .map((plan) => ({ plan }))
    : []
  const returnedBugUnreadCount = returnedBugs.filter((bug) => !readNotificationKeySet.has(getBugReturnNotificationKey(bug))).length
  const planAssignmentUnreadCount = planAssignmentNotifications.filter(({ plan }) =>
    !readNotificationKeySet.has(getPlanAssignmentNotificationKey(plan)),
  ).length
  const bugCommentUnreadCount = bugCommentNotifications.filter(({ comment }) => !seenBugCommentIds.has(comment.id)).length
  const notificationTotalCount =
    spaceSettings.invitations.length +
    returnedBugs.length +
    bugCommentNotifications.length +
    planAssignmentNotifications.length
  const notificationUnreadCount =
    spaceSettings.invitations.length +
    returnedBugUnreadCount +
    bugCommentUnreadCount +
    planAssignmentUnreadCount

  function markBugCommentAsSeen(commentId?: number) {
    if (!commentId || !currentUserId) return
    setSeenBugCommentIds((current) => {
      if (current.has(commentId)) return current
      const next = new Set(current)
      next.add(commentId)
      writeSeenBugCommentIds(currentUserId, next)
      return next
    })
  }

  function markNotificationAsRead(key?: string) {
    if (!key || !currentUserId) return
    setReadNotificationKeySet((current) => {
      if (current.has(key)) return current
      const next = new Set(current)
      next.add(key)
      writeReadNotificationKeys(currentUserId, next)
      return next
    })
  }

  useEffect(() => {
    if (!spaceId || !data.spaces.some((space) => space.id === spaceId)) {
      setSpaceId(data.spaces[0]?.id)
      return
    }
    if (!subjectId || !subjects.some((subject) => subject.id === subjectId)) {
      setSubjectId(subjects[0]?.id)
    }
  }, [data.spaces, spaceId, subjectId, subjects])

  useEffect(() => {
    if (!cases.some((item) => item.id === selectedCaseId)) setSelectedCaseId(cases[0]?.id)
    if (!plans.some((item) => item.id === selectedPlanId)) setSelectedPlanId(plans[0]?.id)
    if (!bugs.some((item) => item.id === selectedBugId)) setSelectedBugId(bugs[0]?.id)
  }, [bugs, cases, plans, selectedBugId, selectedCaseId, selectedPlanId])

  async function mutate(operation: () => Promise<TestWorkbenchData>) {
    setBusy(true)
    setError('')
    try {
      const result = await operation()
      setData(result)
      return true
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : '保存失败，请稍后重试。')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function refreshSpaceSettings() {
    try {
      const result = await fetchTestSpaceSettings()
      setSpaceSettings(result)
      return result
    } catch {
      return undefined
    }
  }

  async function refreshWorkbench(preferredSpaceId?: number) {
    const result = await fetchTestWorkbench()
    setData(result)
    setSpaceId((current) => {
      if (preferredSpaceId && result.spaces.some((space) => space.id === preferredSpaceId)) return preferredSpaceId
      if (current && result.spaces.some((space) => space.id === current)) return current
      return result.spaces[0]?.id
    })
    return result
  }

  async function handleCreateSpace(name: string, organizationId?: number) {
    const normalizedName = name.trim()
    if (!normalizedName) return false
    setBusy(true)
    setError('')
    try {
      const result = await createTestSpace(normalizedName, organizationId)
      const createdSpace = result.spaces.find((space) => space.name === normalizedName) ?? result.spaces[0]
      setData(result)
      setSpaceId(createdSpace?.id)
      setTab('cases')
      setSpaceCreateOpen(false)
      await refreshSpaceSettings()
      return true
    } catch (creationError) {
      setError(creationError instanceof Error ? creationError.message : '测试空间创建失败。')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleAcceptInvitation(invitationSpaceId: number) {
    setBusy(true)
    setError('')
    try {
      const result = await acceptTestSpaceInvitation(invitationSpaceId)
      setSpaceSettings(result.settings)
      setData(result.workbench)
      setSpaceId(invitationSpaceId)
      setTab('cases')
      return true
    } catch (invitationError) {
      setError(invitationError instanceof Error ? invitationError.message : '邀请处理失败。')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleDeclineInvitation(invitationSpaceId: number) {
    setBusy(true)
    setError('')
    try {
      const result = await declineTestSpaceInvitation(invitationSpaceId)
      setSpaceSettings(result)
      return true
    } catch (invitationError) {
      setError(invitationError instanceof Error ? invitationError.message : '邀请处理失败。')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function verifyInvitePassword() {
    const password = invitePasswordDraft.trim()
    if (!inviteToken || !password) return
    setInvitePasswordChecking(true)
    setInvitePasswordError('')
    try {
      await verifyTestSpaceInviteLink(inviteToken, password)
      setInvitePasswordVerified(true)
    } catch {
      setInvitePasswordError('邀请密码不正确，请检查后重试。')
    } finally {
      setInvitePasswordChecking(false)
    }
  }

  return (
    <main className="test-workbench-shell">
      <aside className="test-workbench-nav">
        <div className="test-workbench-space-header">
          <div className="brand-block">
            <img className="brand-mark" src="/favicon.svg" alt="Veges" />
            <div>
              <p className="eyebrow">Veges</p>
              <h1>测试工作台</h1>
            </div>
          </div>
        </div>
        <div className="test-space-switcher">
          <Select
            open={spaceSwitcherOpen}
            value={spaceId ? String(spaceId) : ''}
            onOpenChange={setSpaceSwitcherOpen}
            onValueChange={(value) => setSpaceId(Number(value))}
          >
            <SelectTrigger aria-label="测试空间"><SelectValue placeholder="选择测试空间" /></SelectTrigger>
            <SelectContent
              footer={(
                <div className="test-space-manage-footer">
                  <button
                    type="button"
                    className="test-space-manage-option"
                    onClick={() => {
                      setSpaceSwitcherOpen(false)
                      setSpaceCreateOpen(true)
                    }}
                  >
                    <Plus />
                    <span>新建测试空间</span>
                  </button>
                  <button
                    type="button"
                    className="test-space-manage-option"
                    onClick={() => {
                      setSpaceSwitcherOpen(false)
                      setSpaceAdministrationOpen(true)
                    }}
                  >
                    <GearSix />
                    <span>管理测试空间</span>
                  </button>
                </div>
              )}
            >
              {data.spaces.length > 0
                ? data.spaces.map((space) => <SelectItem key={space.id} value={String(space.id)}>{space.name}</SelectItem>)
                : <SelectItem disabled value="__empty">暂无测试空间</SelectItem>}
            </SelectContent>
          </Select>
        </div>
          <div className="test-workbench-nav-main">
            <nav className="test-workbench-nav-actions" aria-label="测试工作台模块">
              <button className={tab === 'cases' ? 'active' : ''} onClick={() => setTab('cases')}><ClipboardText /><span className="test-nav-label">用例管理</span><span className="test-nav-count">{cases.length}</span></button>
              <button className={tab === 'plans' ? 'active' : ''} onClick={() => setTab('plans')}><ListChecks /><span className="test-nav-label">测试计划</span><span className="test-nav-count">{plans.length}</span></button>
              <button className={tab === 'bugs' ? 'active' : ''} onClick={() => setTab('bugs')}><Bug /><span className="test-nav-label">Bug 追踪</span><span className="test-nav-count">{bugs.length}</span></button>
              <button className={tab === 'notifications' ? 'active' : ''} onClick={() => setTab('notifications')}>
                <Bell />
                <span className="test-nav-label">通知中心</span>
                <span className={notificationUnreadCount > 0 ? 'test-nav-count unread' : 'test-nav-count'}>
                  {notificationUnreadCount > 0 ? notificationUnreadCount : notificationTotalCount}
                </span>
              </button>
            </nav>
            {activeSpace ? (
              <section className="test-subject-browser" aria-label="测试对象">
                <header className="test-subject-browser-header">
                  <span>测试对象</span>
                  {!activeSpaceReadOnly ? <Button className="test-subject-add" size="icon" variant="ghost" aria-label="新建测试对象" title="新建测试对象" onClick={() => setSubjectDialogOpen(true)}><Plus /></Button> : null}
                </header>
                <div className="test-subject-list">
                  {subjects.length ? subjects.map((subject) => (
                    <article key={subject.id} className={subject.id === subjectId ? 'active' : ''}>
                      <button
                        type="button"
                        className="test-subject-select"
                        aria-current={subject.id === subjectId ? 'true' : undefined}
                        onClick={() => setSubjectId(subject.id)}
                      >
                        <strong>{subject.name}</strong>
                        <small>{[subject.versionLabel, subject.environment].filter(Boolean).join(' / ') || '未设置版本与环境'}</small>
                      </button>
                      {subject.canDelete && !activeSpaceReadOnly ? (
                        <Button
                          className="test-subject-delete"
                          size="icon"
                          variant="ghost"
                          aria-label={`删除测试对象 ${subject.name}`}
                          title="删除测试对象"
                          onClick={() => setSubjectPendingDelete(subject)}
                        ><Trash /></Button>
                      ) : null}
                    </article>
                  )) : <p className="test-subject-list-empty">暂无测试对象</p>}
                </div>
              </section>
            ) : null}
          </div>
          <div className="test-workbench-account">{accountMenu}</div>
      </aside>

      <section className="test-workbench-content">
          {loading ? (
            <div className="test-workbench-loading">正在加载测试工作台...</div>
          ) : tab === 'notifications' ? (
            <>
              <WorkspaceError message={error} />
              <NotificationsView
                busy={busy}
                data={data}
                bugCommentNotifications={bugCommentNotifications}
                invitations={spaceSettings.invitations}
                planAssignmentNotifications={planAssignmentNotifications}
                readNotificationKeys={readNotificationKeySet}
                returnedBugs={returnedBugs}
                seenBugCommentIds={seenBugCommentIds}
                onAcceptInvitation={(invitation) => void handleAcceptInvitation(invitation.spaceId)}
                onDeclineInvitation={(invitation) => void handleDeclineInvitation(invitation.spaceId)}
                onOpenBug={(bug, commentId) => {
                  markNotificationAsRead(getBugReturnNotificationKey(bug))
                  markBugCommentAsSeen(commentId)
                  setSpaceId(bug.testSpaceId)
                  setSubjectId(bug.testSubjectId)
                  setSelectedBugId(bug.id)
                  setTab('bugs')
                }}
                onOpenPlan={(plan) => {
                  markNotificationAsRead(getPlanAssignmentNotificationKey(plan))
                  setSpaceId(plan.testSpaceId)
                  setSelectedPlanId(plan.id)
                  setTab('plans')
                }}
              />
            </>
          ) : data.spaces.length === 0 ? (
            <div className="test-workbench-empty">
              <Flask size={34} weight="duotone" />
              <h1>建立第一个测试空间</h1>
              <p>测试空间用于隔离测试对象、用例、计划和 Bug，不依赖现有项目。</p>
              <div className="test-empty-actions">
                <Button onClick={() => setSpaceCreateOpen(true)}><Plus /> 新增测试空间</Button>
              </div>
              <WorkspaceError message={error} />
            </div>
          ) : !activeSubject && tab !== 'plans' ? (
            <div className="test-inline-empty">
              <WorkspaceError message={error} />
              <Flask size={30} />
              <h2>{activeSpaceReadOnly ? '暂无测试对象' : '先创建测试对象'}</h2>
              <p>{activeSpaceReadOnly ? '当前测试空间还没有测试对象。' : '测试对象可以是应用、服务或产品，也可以选择性关联现有项目。'}</p>
              {!activeSpaceReadOnly ? <div className="test-empty-actions">
                <Button onClick={() => setSubjectDialogOpen(true)}><Plus /> 新建测试对象</Button>
              </div> : null}
            </div>
          ) : tab === 'cases' ? (
            <>
              <WorkspaceError message={error} />
              <CasesView
                key={subjectId}
                cases={cases}
                data={data}
                readOnly={activeSpaceReadOnly}
                selectedId={selectedCaseId}
                onSelect={setSelectedCaseId}
                onCreate={() => { setEditingCase(undefined); setCaseDialogOpen(true) }}
                onCreateFolder={() => setFolderDialogOpen(true)}
                onEdit={(testCase) => { setEditingCase(testCase); setCaseDialogOpen(true) }}
                onImport={() => setCaseImportDialogOpen(true)}
                onArchive={(testCase) => void mutate(() => updateTestCase(testCase.testSpaceId, testCase.id, { caseKind: 'baseline', status: 'active' }))}
              />
            </>
          ) : tab === 'plans' ? (
            <>
              <WorkspaceError message={error} />
              <PlansView
                busy={busy}
                data={data}
                plans={plans}
                projects={projects}
                readOnly={activeSpaceReadOnly}
                selectedId={selectedPlanId}
                onSelect={setSelectedPlanId}
                onCreate={() => { setEditingPlan(undefined); setPlanDialogOpen(true) }}
                onDelete={setPlanPendingDelete}
                onEdit={(plan) => { setEditingPlan(plan); setPlanDialogOpen(true) }}
                onRemoveCase={(plan, planCaseId) => void mutate(() => removeTestPlanCase(plan.testSpaceId, plan.id, planCaseId))}
                onStatus={(plan, status) => void mutate(() => updateTestPlanStatus(plan.testSpaceId, plan.id, status))}
                onResult={(planCaseId, result) => void mutate(() => updateTestPlanCase(spaceId!, planCaseId, { result }))}
                onCreateBug={(plan, planCase) => {
                  setBugSeed({
                    actualResult: planCase.resultNote,
                    environment: plan.environment,
                    expectedResult: planCase.snapshotExpectedResult,
                    reproductionSteps: planCase.snapshotSteps,
                    testPlanCaseId: planCase.id,
                    testPlanId: plan.id,
                    testSubjectId: planCase.testSubjectId ?? plan.testSubjectId,
                    title: planCase.snapshotTitle,
                  })
                  setBugDialogOpen(true)
                }}
              />
            </>
          ) : (
            <>
              <WorkspaceError message={error} />
              <BugsView
                bugs={bugs}
                busy={busy}
                data={data}
                readOnly={activeSpaceReadOnly}
                selectedId={selectedBugId}
                onSelect={setSelectedBugId}
                onCreate={() => { setBugSeed({ testSubjectId: subjectId }); setBugDialogOpen(true) }}
                onStatus={(bug, status) => void mutate(() => updateTestBug(bug.testSpaceId, bug.id, { assigneeUserId: bug.assigneeUserId, status }))}
                onAssignee={(bug, assigneeUserId) => void mutate(() => updateTestBug(bug.testSpaceId, bug.id, { assigneeUserId, status: assigneeUserId ? 'assigned' : 'new' }))}
                onComment={(bug, content) => mutate(() => addTestBugComment(bug.testSpaceId, bug.id, content))}
                onUpdateComment={(bug, comment, content) => mutate(() => updateTestBugComment(bug.testSpaceId, bug.id, comment.id, content))}
                onDeleteComment={(bug, comment) => mutate(() => deleteTestBugComment(bug.testSpaceId, bug.id, comment.id))}
              />
            </>
          )}
      </section>

      <TestSpaceSettingsDialog
        currentSpaceId={spaceId}
        open={spaceAdministrationOpen}
        onOpenChange={setSpaceAdministrationOpen}
        onCreateSpace={() => {
          setSpaceAdministrationOpen(false)
          setSpaceCreateOpen(true)
        }}
        onWorkbenchChange={async () => {
          await refreshWorkbench()
          await refreshSpaceSettings()
        }}
      />
      <TestSpaceCreateDialog
        busy={busy}
        organizations={spaceSettings.organizations}
        open={spaceCreateOpen}
        onOpenChange={setSpaceCreateOpen}
        onSubmit={handleCreateSpace}
      />
      <TestSpaceInvitePasswordDialog
        busy={invitePasswordChecking}
        error={invitePasswordError}
        open={Boolean(inviteToken && invitePasswordRequired && !invitePasswordVerified)}
        password={invitePasswordDraft}
        onCancel={() => {
          setInviteToken('')
          setInvitePasswordError('')
          clearTestSpaceInviteTokenFromUrl()
        }}
        onPasswordChange={(value) => {
          setInvitePasswordDraft(value)
          setInvitePasswordError('')
        }}
        onSubmit={() => void verifyInvitePassword()}
      />
      <SubjectDialog busy={busy} open={subjectDialogOpen} onOpenChange={setSubjectDialogOpen} onSubmit={async (payload) => {
        const saved = await mutate(() => createTestSubject(spaceId!, payload)); if (saved) setSubjectDialogOpen(false)
      }} />
      <Dialog open={Boolean(subjectPendingDelete)} onOpenChange={(nextOpen) => { if (!nextOpen) setSubjectPendingDelete(undefined) }}>
        <DialogContent fixedHeader className="test-workbench-dialog">
          <DialogHeader>
            <DialogTitle>删除测试对象</DialogTitle>
            <DialogDescription>
              删除“{subjectPendingDelete?.name}”后，其用例、测试计划、Bug 和评论也会永久删除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSubjectPendingDelete(undefined)}>取消</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || !subjectPendingDelete}
              onClick={async () => {
                if (!subjectPendingDelete) return
                const saved = await mutate(() => deleteTestSubject(subjectPendingDelete.testSpaceId, subjectPendingDelete.id))
                if (saved) setSubjectPendingDelete(undefined)
              }}
            ><Trash /> 删除测试对象</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FolderDialog
        busy={busy}
        cases={data.cases.filter((item) => item.testSpaceId === spaceId && item.testSubjectId === subjectId)}
        folders={data.folders.filter((folder) => folder.testSpaceId === spaceId && folder.testSubjectId === subjectId)}
        open={folderDialogOpen}
        subject={data.subjects.find((candidate) => candidate.id === subjectId)}
        onCreate={async (name) => mutate(() => createTestCaseFolder(spaceId!, { name, testSubjectId: subjectId! }))}
        onDelete={async (folder) => mutate(() => deleteTestCaseFolder(spaceId!, folder.id))}
        onOpenChange={setFolderDialogOpen}
        onRename={async (folder, name) => mutate(() => updateTestCaseFolder(spaceId!, folder.id, { name }))}
      />
      <CaseDialog
        busy={busy}
        data={data}
        open={caseDialogOpen}
        testCase={editingCase}
        subjectId={subjectId}
        spaceId={spaceId}
        onOpenChange={setCaseDialogOpen}
        onSubmit={async (payload) => {
          const saved = editingCase
            ? await mutate(() => updateTestCase(editingCase.testSpaceId, editingCase.id, payload))
            : await mutate(() => createTestCase(spaceId!, payload))
          if (saved) setCaseDialogOpen(false)
        }}
      />
      <ImportCasesDialog
        busy={busy}
        open={caseImportDialogOpen}
        spaceId={spaceId}
        subject={activeSubject}
        onOpenChange={setCaseImportDialogOpen}
        onSubmit={(csvText) => mutate(() => importTestCases(spaceId!, subjectId!, csvText))}
      />
      <PlanDialog
        key={`${planDialogOpen}-${editingPlan?.id ?? 'new'}`}
        busy={busy}
        cases={spaceCases}
        folders={data.folders}
        open={planDialogOpen}
        plan={editingPlan}
        planCases={data.planCases}
        projects={projects}
        subjects={subjects}
        users={data.users}
        onOpenChange={setPlanDialogOpen}
        onSubmit={async (payload) => {
          const saved = editingPlan
            ? await mutate(() => updateTestPlan(editingPlan.testSpaceId, editingPlan.id, payload))
            : await mutate(() => createTestPlan(spaceId!, payload))
          if (saved) setPlanDialogOpen(false)
        }}
      />
      <Dialog open={Boolean(planPendingDelete)} onOpenChange={(nextOpen) => { if (!nextOpen) setPlanPendingDelete(undefined) }}>
        <DialogContent fixedHeader className="test-workbench-dialog">
          <DialogHeader>
            <DialogTitle>删除测试计划</DialogTitle>
            <DialogDescription>
              删除“{planPendingDelete?.name}”后，执行快照将永久删除；已经创建的 Bug 会保留，但不再关联该计划。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPlanPendingDelete(undefined)}>取消</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || !planPendingDelete}
              onClick={async () => {
                if (!planPendingDelete) return
                const saved = await mutate(() => deleteTestPlan(planPendingDelete.testSpaceId, planPendingDelete.id))
                if (saved) setPlanPendingDelete(undefined)
              }}
            ><Trash /> 删除测试计划</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <BugDialog busy={busy} open={bugDialogOpen} seed={bugSeed} users={data.users} onOpenChange={setBugDialogOpen} onSubmit={async (payload) => {
        const saved = await mutate(() => createTestBug(spaceId!, payload)); if (saved) { setBugDialogOpen(false); setTab('bugs') }
      }} />
    </main>
  )
}

function NotificationsView({
  bugCommentNotifications,
  busy,
  data,
  invitations,
  onAcceptInvitation,
  onDeclineInvitation,
  onOpenBug,
  onOpenPlan,
  planAssignmentNotifications,
  readNotificationKeys,
  returnedBugs,
  seenBugCommentIds,
}: {
  bugCommentNotifications: BugCommentNotification[]
  busy: boolean
  data: TestWorkbenchData
  invitations: TestSpaceInvitation[]
  onAcceptInvitation: (invitation: TestSpaceInvitation) => void
  onDeclineInvitation: (invitation: TestSpaceInvitation) => void
  onOpenBug: (bug: TestBug, commentId?: number) => void
  onOpenPlan: (plan: TestPlan) => void
  planAssignmentNotifications: PlanAssignmentNotification[]
  readNotificationKeys: Set<string>
  returnedBugs: TestBug[]
  seenBugCommentIds: Set<number>
}) {
  const notificationItems = [
    ...invitations.map((invitation) => ({
      createdAt: invitation.createdAt,
      invitation,
      key: `invitation-${invitation.spaceId}`,
      kind: 'invitation' as const,
      sortAt: Date.parse(invitation.createdAt),
    })),
    ...returnedBugs.map((bug) => ({
      bug,
      createdAt: bug.updatedAt,
      key: `bug-${bug.id}`,
      kind: 'bug_return' as const,
      notificationKey: getBugReturnNotificationKey(bug),
      sortAt: Date.parse(bug.updatedAt),
    })),
    ...bugCommentNotifications.map(({ bug, comment }) => ({
      bug,
      comment,
      createdAt: comment.updatedAt || comment.createdAt,
      key: `bug-comment-${comment.id}`,
      kind: 'bug_comment' as const,
      notificationKey: `bug-comment:${comment.id}`,
      sortAt: getBugCommentTimestamp(comment),
    })),
    ...planAssignmentNotifications.map(({ plan }) => ({
      createdAt: plan.updatedAt || plan.createdAt,
      key: `plan-assignment-${plan.id}`,
      kind: 'plan_assignment' as const,
      notificationKey: getPlanAssignmentNotificationKey(plan),
      plan,
      sortAt: getTimestampMs(plan.updatedAt || plan.createdAt),
    })),
  ].sort((left, right) => {
    const rightTime = Number.isNaN(right.sortAt) ? 0 : right.sortAt
    const leftTime = Number.isNaN(left.sortAt) ? 0 : left.sortAt
    return rightTime - leftTime
  })
  const unreadCount = notificationItems.filter((item) => {
    if (item.kind === 'invitation') return true
    if (item.kind === 'bug_comment') return !seenBugCommentIds.has(item.comment.id)
    return !readNotificationKeys.has(item.notificationKey)
  }).length
  const readCount = Math.max(0, notificationItems.length - unreadCount)

  return (
    <div className="test-module-view test-notifications-view">
      <div className="test-module-toolbar">
        <div>
          <span>协作消息</span>
          <h1>通知中心</h1>
        </div>
      </div>
      <section className="test-notification-board">
        {notificationItems.length ? (
          <>
          <header>
            <div>
              <strong>待处理通知</strong>
              <small>测试空间邀请、测试计划指派、Bug 返回和协作回复会按时间倒序排列。</small>
            </div>
            <div className="test-notification-counts" aria-label="通知已读状态统计">
              {unreadCount > 0 ? <Badge className="test-notification-unread-badge">{unreadCount} 未读</Badge> : null}
              <Badge variant="outline">{readCount} 已读 / {notificationItems.length} 总计</Badge>
            </div>
          </header>
          <div className="test-notification-list">
            {notificationItems.map((item) => {
              if (item.kind === 'invitation') {
                const invitation = item.invitation
                return (
                  <article key={item.key} className="test-notification-card unread">
                    <div className="test-notification-copy">
                      <span className="test-notification-kind unread">邀请</span>
                      <div>
                        <strong>{invitation.spaceName}</strong>
                        <p>{invitation.invitedByName} 邀请你加入测试空间。</p>
                        <small>{invitation.accessLevel === 'editor' ? '可编辑' : '只读'} · {formatTimestamp(invitation.createdAt)}</small>
                      </div>
                    </div>
                    <div>
                      <Button variant="outline" disabled={busy} onClick={() => onDeclineInvitation(invitation)}><XCircle /> 拒绝</Button>
                      <Button disabled={busy} onClick={() => onAcceptInvitation(invitation)}><CheckCircle /> 接受</Button>
                    </div>
                  </article>
                )
              }
              if (item.kind === 'plan_assignment') {
                const plan = item.plan
                const spaceName = data.spaces.find((space) => space.id === plan.testSpaceId)?.name ?? '未知测试空间'
                const subjectNames = (plan.testSubjectIds.length ? plan.testSubjectIds : [plan.testSubjectId])
                  .map((id) => data.subjects.find((subject) => subject.id === id)?.name)
                  .filter(Boolean)
                  .join('、') || '未关联测试对象'
                const read = readNotificationKeys.has(item.notificationKey)
                return (
                  <article key={item.key} className={read ? 'test-notification-card read' : 'test-notification-card unread'}>
                    <div className="test-notification-copy">
                      <span className={read ? 'test-notification-kind' : 'test-notification-kind unread'}>计划指派</span>
                      <div>
                        <strong>PLAN-{plan.id} · {plan.name}</strong>
                        <p>这个测试计划已指派给你，需要跟进执行。</p>
                        <small>{spaceName} · {subjectNames} · {formatTimestamp(item.createdAt)}</small>
                      </div>
                    </div>
                    <div>
                      <Button variant="outline" onClick={() => onOpenPlan(plan)}><ListChecks /> 查看计划</Button>
                    </div>
                  </article>
                )
              }
              const bug = item.bug
              const spaceName = data.spaces.find((space) => space.id === bug.testSpaceId)?.name ?? '未知测试空间'
              const subjectName = data.subjects.find((subject) => subject.id === bug.testSubjectId)?.name ?? '未关联测试对象'
              if (item.kind === 'bug_comment') {
                const comment = item.comment
                const read = seenBugCommentIds.has(comment.id)
                return (
                  <article key={item.key} className={read ? 'test-notification-card read' : 'test-notification-card unread'}>
                    <div className="test-notification-copy">
                      <span className={read ? 'test-notification-kind' : 'test-notification-kind unread'}>Bug 回复</span>
                      <div>
                        <strong>BUG-{bug.id} · {bug.title}</strong>
                        <p>{comment.authorName} 添加了协作备注，需要测试侧查看。</p>
                        <small>{spaceName} · {subjectName} · {formatTimestamp(comment.updatedAt || comment.createdAt)}</small>
                      </div>
                    </div>
                    <div>
                      <Button variant="outline" onClick={() => onOpenBug(bug, comment.id)}><Bug /> 查看 Bug</Button>
                    </div>
                  </article>
                )
              }
              const read = readNotificationKeys.has(item.notificationKey)
              return (
                <article key={item.key} className={read ? 'test-notification-card read' : 'test-notification-card unread'}>
                  <div className="test-notification-copy">
                    <span className={read ? 'test-notification-kind' : 'test-notification-kind unread'}>Bug 返回</span>
                    <div>
                      <strong>BUG-{bug.id} · {bug.title}</strong>
                      <p>{bugStatusLabel[bug.status]}，需要测试侧回看。</p>
                      <small>{spaceName} · {subjectName} · {formatTimestamp(bug.updatedAt)}</small>
                    </div>
                  </div>
                  <div>
                    <Button variant="outline" onClick={() => onOpenBug(bug)}><Bug /> 查看 Bug</Button>
                  </div>
                </article>
              )
            })}
          </div>
          </>
        ) : (
          <div className="test-notification-empty">
            <Bell size={30} />
            <strong>暂时没有需要处理的通知。</strong>
            <p>收到测试空间邀请、Bug 返回或协作回复后，会在这里按时间展示。</p>
          </div>
        )}
      </section>
    </div>
  )
}

function CasesView({ cases, data, readOnly, selectedId, onArchive, onCreate, onCreateFolder, onEdit, onImport, onSelect }: {
  cases: TestCase[]
  data: TestWorkbenchData
  readOnly: boolean
  selectedId?: number
  onArchive: (testCase: TestCase) => void
  onCreate: () => void
  onCreateFolder: () => void
  onEdit: (testCase: TestCase) => void
  onImport: () => void
  onSelect: (id: number) => void
}) {
  const listPanelRef = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(6)
  const [searchQuery, setSearchQuery] = useState('')
  const [folderFilter, setFolderFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState('all')
  const availableFolders = useMemo(() => data.folders.filter((folder) => (
    cases.some((testCase) => testCase.folderId === folder.id)
  )), [cases, data.folders])
  const filteredCases = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('zh-CN')
    return cases.filter((item) => {
      const folder = data.folders.find((candidate) => candidate.id === item.folderId)
      const matchesSearch = !normalizedQuery || [
        `CASE-${item.id}`,
        item.title,
        folder?.name ?? '未分类',
        item.preconditions,
        item.steps,
        item.expectedResult,
        item.remarks,
        item.customTags.join(' '),
      ].some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedQuery))
      const matchesFolder = folderFilter === 'all'
        || (folderFilter === 'uncategorized' ? !item.folderId : String(item.folderId) === folderFilter)
      return matchesSearch
        && matchesFolder
        && (typeFilter === 'all' || item.caseType === typeFilter)
        && (priorityFilter === 'all' || item.priority === priorityFilter)
        && (kindFilter === 'all' || item.caseKind === kindFilter)
    })
  }, [cases, data.folders, folderFilter, kindFilter, priorityFilter, searchQuery, typeFilter])
  const selected = filteredCases.find((item) => item.id === selectedId)
  const selectedIndex = filteredCases.findIndex((item) => item.id === selectedId)
  const totalPages = Math.max(1, Math.ceil(filteredCases.length / pageSize))
  const visibleCases = filteredCases.slice(page * pageSize, (page + 1) * pageSize)
  const visibleStart = filteredCases.length === 0 ? 0 : page * pageSize + 1
  const visibleEnd = Math.min((page + 1) * pageSize, filteredCases.length)
  const hasFilters = Boolean(searchQuery.trim()) || folderFilter !== 'all' || typeFilter !== 'all' || priorityFilter !== 'all' || kindFilter !== 'all'

  useEffect(() => {
    const panel = listPanelRef.current
    if (!panel) return
    const updatePageSize = () => {
      const availableHeight = panel.getBoundingClientRect().height - 46
      const nextPageSize = Math.max(2, Math.min(20, Math.floor(availableHeight / 104)))
      setPageSize((current) => current === nextPageSize ? current : nextPageSize)
    }
    updatePageSize()
    const observer = new ResizeObserver(updatePageSize)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages - 1))
  }, [totalPages])

  useEffect(() => {
    setPage(0)
  }, [folderFilter, kindFilter, priorityFilter, searchQuery, typeFilter])

  useEffect(() => {
    if (filteredCases.length > 0 && selectedIndex < 0) onSelect(filteredCases[0].id)
  }, [filteredCases, onSelect, selectedIndex])

  useEffect(() => {
    if (selectedIndex < 0) return
    setPage(Math.floor(selectedIndex / pageSize))
  }, [pageSize, selectedIndex])

  function changePage(nextPage: number) {
    const normalizedPage = Math.max(0, Math.min(totalPages - 1, nextPage))
    setPage(normalizedPage)
    const firstCase = filteredCases[normalizedPage * pageSize]
    if (firstCase) onSelect(firstCase.id)
  }

  return (
    <div className="test-module-view test-cases-module-view">
      <div className="test-module-toolbar">
        <div><span>用例库</span><h1>用例管理</h1></div>
        {!readOnly ? <div><Button variant="outline" onClick={onImport}><UploadSimple /> 导入 CSV</Button><Button variant="outline" onClick={onCreateFolder}><FolderPlus /> 模块</Button><Button onClick={onCreate}><Plus /> 新建用例</Button></div> : null}
      </div>
      <div className="test-case-filters" aria-label="用例搜索与筛选">
        <label className="test-case-search">
          <MagnifyingGlass />
          <Input
            type="search"
            aria-label="搜索用例"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索编号、标题、模块或用例内容"
          />
        </label>
        <Select value={folderFilter} onValueChange={setFolderFilter}>
          <SelectTrigger aria-label="所属模块筛选"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部模块</SelectItem>
            <SelectItem value="uncategorized">未分类</SelectItem>
            {availableFolders.map((folder) => <SelectItem key={folder.id} value={String(folder.id)}>{folder.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger aria-label="用例类型筛选"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">全部类型</SelectItem>{Object.entries(caseTypeLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger aria-label="用例等级筛选"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">全部等级</SelectItem><SelectItem value="high">P0</SelectItem><SelectItem value="medium">P1</SelectItem><SelectItem value="low">P2</SelectItem></SelectContent>
        </Select>
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger aria-label="用例分类筛选"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">全部分类</SelectItem><SelectItem value="functional">功能用例</SelectItem><SelectItem value="baseline">基线用例</SelectItem></SelectContent>
        </Select>
        <Button
          className="test-case-clear-filters"
          variant="outline"
          aria-label="清除用例筛选"
          disabled={!hasFilters}
          onClick={() => {
            setSearchQuery('')
            setFolderFilter('all')
            setTypeFilter('all')
            setPriorityFilter('all')
            setKindFilter('all')
          }}
        ><XCircle /> 清除</Button>
      </div>
      <div className="test-split-view test-cases-split-view">
        <div ref={listPanelRef} className="test-record-list-panel">
          <div
            className="test-record-list test-case-record-list"
            style={{ gridTemplateRows: `repeat(${Math.max(visibleCases.length, 1)}, minmax(0, 1fr))` }}
          >
            {filteredCases.length ? visibleCases.map((item) => (
              <button key={item.id} className={item.id === selectedId ? 'active' : ''} onClick={() => onSelect(item.id)}>
                <div><code>CASE-{item.id}</code><Badge variant="outline">{caseTypeLabel[item.caseType]}</Badge></div>
                <strong>{item.title}</strong>
                <small>{caseLevelLabel[item.priority]} · {data.folders.find((folder) => folder.id === item.folderId)?.name || '未分类'} · {caseKindLabel[item.caseKind]}{item.customTags.length ? ` · ${item.customTags.join('、')}` : ''}</small>
              </button>
            )) : <p className="test-list-empty">{cases.length ? '没有符合条件的用例。' : '当前测试对象还没有用例。'}</p>}
          </div>
          <nav className="test-case-pagination" aria-label="用例分页">
            <span className="test-case-pagination-summary">
              <strong>{visibleStart}-{visibleEnd}</strong> / {filteredCases.length}
              <small>每页 {pageSize} 条</small>
            </span>
            <div>
              <Button aria-label="第一页" title="第一页" size="icon" variant="ghost" disabled={page === 0} onClick={() => changePage(0)}><CaretDoubleLeft /></Button>
              <Button aria-label="上一页" title="上一页" size="icon" variant="ghost" disabled={page === 0} onClick={() => changePage(page - 1)}><CaretLeft /></Button>
              <span className="test-case-page-index">{page + 1} / {totalPages}</span>
              <Button aria-label="下一页" title="下一页" size="icon" variant="ghost" disabled={page >= totalPages - 1} onClick={() => changePage(page + 1)}><CaretRight /></Button>
              <Button aria-label="最后一页" title="最后一页" size="icon" variant="ghost" disabled={page >= totalPages - 1} onClick={() => changePage(totalPages - 1)}><CaretDoubleRight /></Button>
            </div>
          </nav>
        </div>
        <div className="test-record-detail">
          {selected ? (
            <>
              <div className="test-detail-heading">
                <div>
                  <code>CASE-{selected.id}</code>
                  <h2>{selected.title}</h2>
                  <p className="test-case-folder">
                    <span>所属模块</span>
                    <strong>{data.folders.find((folder) => folder.id === selected.folderId)?.name || '未分类'}</strong>
                  </p>
                </div>
                {!readOnly ? <div><Button variant="outline" onClick={() => onEdit(selected)}>编辑</Button>{selected.caseKind !== 'baseline' ? <Button variant="destructive" onClick={() => onArchive(selected)}>归档为基线</Button> : null}</div> : null}
              </div>
              <div className="test-detail-meta test-case-detail-meta"><span>分类 <strong>{caseKindLabel[selected.caseKind]}</strong></span><span>类型 <strong>{caseTypeLabel[selected.caseType]}</strong></span><span>等级 <strong>{caseLevelLabel[selected.priority]}</strong></span></div>
              {selected.customTags.length ? <div className="test-case-tags">{selected.customTags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div> : null}
              <DetailBlock title="前置条件" content={selected.preconditions} />
              <DetailBlock title="测试步骤" content={selected.steps} />
              <DetailBlock title="预期结果" content={selected.expectedResult} />
              <DetailBlock title="备注" content={selected.remarks} />
            </>
          ) : <div className="test-detail-empty"><ClipboardText size={28} /><p>选择一个用例查看完整内容。</p></div>}
        </div>
      </div>
    </div>
  )
}

function PlansView({ busy, data, onCreate, onCreateBug, onDelete, onEdit, onRemoveCase, onResult, onSelect, onStatus, plans, projects, readOnly, selectedId }: {
  busy: boolean
  data: TestWorkbenchData
  onCreate: () => void
  onCreateBug: (plan: TestPlan, planCase: TestWorkbenchData['planCases'][number]) => void
  onDelete: (plan: TestPlan) => void
  onEdit: (plan: TestPlan) => void
  onRemoveCase: (plan: TestPlan, planCaseId: number) => void
  onResult: (planCaseId: number, result: TestResult) => void
  onSelect: (id: number) => void
  onStatus: (plan: TestPlan, status: TestPlan['status']) => void
  plans: TestPlan[]
  projects: TestWorkbenchProjectOption[]
  readOnly: boolean
  selectedId?: number
}) {
  const [executionPage, setExecutionPage] = useState(0)
  const [executionPageSize, setExecutionPageSize] = useState(6)
  const [detailExecutionId, setDetailExecutionId] = useState<number>()
  const executionListRef = useRef<HTMLDivElement>(null)
  const selected = plans.find((item) => item.id === selectedId)
  const executions = data.planCases.filter((item) => item.testPlanId === selectedId)
  const detailExecution = executions.find((item) => item.id === detailExecutionId)
  const passed = executions.filter((item) => item.result === 'passed').length
  const executionTotalPages = Math.max(1, Math.ceil(executions.length / executionPageSize))
  const visibleExecutions = executions.slice(
    executionPage * executionPageSize,
    (executionPage + 1) * executionPageSize,
  )
  const executionStart = executions.length === 0 ? 0 : executionPage * executionPageSize + 1
  const executionEnd = Math.min((executionPage + 1) * executionPageSize, executions.length)

  useEffect(() => {
    const list = executionListRef.current
    if (!list || !selectedId) return
    const updatePageSize = () => {
      if (window.matchMedia('(max-width: 760px)').matches) {
        setExecutionPageSize(5)
        return
      }
      const availableHeight = list.getBoundingClientRect().height
      const nextPageSize = Math.max(3, Math.min(20, Math.floor((availableHeight + 8) / PLAN_EXECUTION_ROW_BLOCK_SIZE)))
      setExecutionPageSize((current) => current === nextPageSize ? current : nextPageSize)
    }
    updatePageSize()
    const observer = new ResizeObserver(updatePageSize)
    observer.observe(list)
    return () => observer.disconnect()
  }, [selectedId])

  useEffect(() => {
    setExecutionPage(0)
  }, [selectedId])

  useEffect(() => {
    setExecutionPage((current) => Math.min(current, executionTotalPages - 1))
  }, [executionTotalPages])

  function changeExecutionPage(nextPage: number) {
    setExecutionPage(Math.max(0, Math.min(executionTotalPages - 1, nextPage)))
  }

  return (
    <div className="test-module-view">
      <div className="test-module-toolbar"><div><span>执行与回归</span><h1>测试计划</h1></div>{!readOnly ? <Button onClick={onCreate}><Plus /> 新建计划</Button> : null}</div>
      <div className="test-split-view">
        <div className="test-record-list">
          {plans.length ? plans.map((plan) => {
            const rows = data.planCases.filter((item) => item.testPlanId === plan.id)
            const complete = rows.filter((item) => item.result !== 'untested').length
            return <button key={plan.id} className={plan.id === selectedId ? 'active' : ''} onClick={() => onSelect(plan.id)}><div><code>PLAN-{plan.id}</code><Badge variant="outline">{planStatusLabel[plan.status]}</Badge></div><strong>{plan.name}</strong><small>{complete}/{rows.length} 已执行 · {plan.environment || '未设置环境'}</small></button>
          }) : <p className="test-list-empty">当前测试空间还没有测试计划。</p>}
        </div>
        <div className={selected ? 'test-record-detail test-plan-detail' : 'test-record-detail'}>
          {selected ? <>
            {(() => {
              const planSubjectNames = (selected.testSubjectIds.length ? selected.testSubjectIds : [selected.testSubjectId])
                .map((id) => data.subjects.find((subject) => subject.id === id)?.name)
                .filter(Boolean)
              const ownerName = data.users.find((user) => user.id === selected.ownerUserId)?.displayName || '未分配'
              const projectName = selected.projectId
                ? projects.find((project) => project.id === selected.projectId)?.name || '未知项目'
                : '未关联项目'
              return (
            <div className="test-detail-heading">
              <div>
                <code>PLAN-{selected.id}</code>
                <h2>{selected.name}</h2>
                <p className="test-plan-subtitle">
                  <span>{planSubjectNames.join('、') || '未关联测试对象'}</span>
                  <span>关联项目：{projectName}</span>
                  <span>负责人：{ownerName}</span>
                </p>
              </div>
              <div className="test-plan-heading-actions">
                <Select value={selected.status} onValueChange={(value) => onStatus(selected, value as TestPlan['status'])} disabled={busy || readOnly}>
                  <SelectTrigger className="test-status-select"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="draft">草稿</SelectItem><SelectItem value="in_progress">执行中</SelectItem><SelectItem value="completed">已完成</SelectItem><SelectItem value="aborted">已终止</SelectItem></SelectContent>
                </Select>
                {selected.canManage && !readOnly ? <>
                  <Button variant="outline" disabled={busy} onClick={() => onEdit(selected)}><PencilSimple /> 编辑</Button>
                  <Button variant="destructive" disabled={busy} onClick={() => onDelete(selected)}><Trash /> 删除</Button>
                </> : null}
              </div>
            </div>
              )
            })()}
            <div className="test-plan-progress"><div><strong>{passed}</strong><span>通过</span></div><div><strong>{executions.filter((item) => item.result === 'failed').length}</strong><span>失败</span></div><div><strong>{executions.filter((item) => item.result === 'blocked').length}</strong><span>阻塞</span></div><div><strong>{executions.length ? Math.round((executions.filter((item) => item.result !== 'untested').length / executions.length) * 100) : 0}%</strong><span>进度</span></div></div>
            <div ref={executionListRef} className="test-execution-list">
              {visibleExecutions.map((row) => <article key={row.id}>
                <div className="test-execution-copy"><code>CASE-{row.testCaseId ?? 'SNAPSHOT'}</code><strong>{row.snapshotTitle}</strong><small>{data.subjects.find((subject) => subject.id === row.testSubjectId)?.name || '未知测试对象'}</small></div>
                <Select value={row.result} onValueChange={(value) => onResult(row.id, value as TestResult)} disabled={busy || readOnly}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(resultLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
                <div className="test-execution-actions">
                  <Button variant="outline" onClick={() => setDetailExecutionId(row.id)}><ClipboardText /> 详情</Button>
                  {row.result === 'failed' && !readOnly ? <Button variant="outline" onClick={() => onCreateBug(selected, row)}><Bug /> 创建 Bug</Button> : null}
                  {selected.canManage && !readOnly && row.result === 'untested' ? <Button
                    aria-label={`从计划移除 ${row.snapshotTitle}`}
                    className="test-plan-case-remove"
                    disabled={busy}
                    size="icon"
                    title="从计划移除"
                    variant="ghost"
                    onClick={() => onRemoveCase(selected, row.id)}
                  ><Trash /></Button> : null}
                </div>
              </article>)}
            </div>
            <nav className="test-case-pagination test-plan-pagination" aria-label="计划用例分页">
              <span className="test-case-pagination-summary">
                <strong>{executionStart}-{executionEnd}</strong> / {executions.length}
                <small>每页 {executionPageSize} 条</small>
              </span>
              <div>
                <Button aria-label="第一页" title="第一页" size="icon" variant="ghost" disabled={executionPage === 0} onClick={() => changeExecutionPage(0)}><CaretDoubleLeft /></Button>
                <Button aria-label="上一页" title="上一页" size="icon" variant="ghost" disabled={executionPage === 0} onClick={() => changeExecutionPage(executionPage - 1)}><CaretLeft /></Button>
                <span className="test-case-page-index">{executionPage + 1} / {executionTotalPages}</span>
                <Button aria-label="下一页" title="下一页" size="icon" variant="ghost" disabled={executionPage >= executionTotalPages - 1} onClick={() => changeExecutionPage(executionPage + 1)}><CaretRight /></Button>
                <Button aria-label="最后一页" title="最后一页" size="icon" variant="ghost" disabled={executionPage >= executionTotalPages - 1} onClick={() => changeExecutionPage(executionTotalPages - 1)}><CaretDoubleRight /></Button>
              </div>
            </nav>
          </> : <div className="test-detail-empty"><ListChecks size={28} /><p>选择一个计划开始执行。</p></div>}
        </div>
      </div>
      <PlanCaseDetailDialog planCase={detailExecution} onClose={() => setDetailExecutionId(undefined)} />
    </div>
  )
}

function PlanCaseDetailDialog({ onClose, planCase }: {
  onClose: () => void
  planCase?: TestWorkbenchData['planCases'][number]
}) {
  if (!planCase) return null
  const caseCode = planCase.testCaseId ? `CASE-${planCase.testCaseId}` : `快照-${planCase.id}`
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent fixedHeader className="test-wide-dialog test-plan-case-detail-dialog">
        <DialogHeader>
          <DialogTitle>{caseCode} 用例详情</DialogTitle>
        <DialogDescription>计划创建时保存的执行快照，后续用例修改不会影响本次执行。</DialogDescription>
        </DialogHeader>
        <div className="test-plan-case-snapshot">
          <DetailBlock title="用例名称" content={planCase.snapshotTitle} />
          <DetailBlock title="前置条件" content={planCase.snapshotPreconditions} />
          <DetailBlock title="测试步骤" content={planCase.snapshotSteps} />
          <DetailBlock title="预期结果" content={planCase.snapshotExpectedResult} />
          {planCase.resultNote ? <DetailBlock title="执行备注" content={planCase.resultNote} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function BugsView({ bugs, busy, data, onAssignee, onComment, onCreate, onDeleteComment, onSelect, onStatus, onUpdateComment, readOnly, selectedId }: {
  bugs: TestBug[]
  busy: boolean
  data: TestWorkbenchData
  onAssignee: (bug: TestBug, assigneeUserId?: number) => void
  onComment?: (bug: TestBug, content: string) => Promise<boolean>
  onCreate: () => void
  onDeleteComment: (bug: TestBug, comment: TestBugComment) => Promise<boolean>
  onSelect: (id: number) => void
  onStatus: (bug: TestBug, status: BugStatus) => void
  onUpdateComment: (bug: TestBug, comment: TestBugComment, content: string) => Promise<boolean>
  readOnly: boolean
  selectedId?: number
}) {
  const selected = bugs.find((item) => item.id === selectedId)
  return (
    <div className="test-module-view">
      <div className="test-module-toolbar"><div><span>缺陷闭环</span><h1>Bug 追踪</h1></div>{!readOnly ? <Button onClick={onCreate}><Plus /> 新建 Bug</Button> : null}</div>
      <div className="test-split-view">
        <div className="test-record-list">
          {bugs.length ? bugs.map((bug) => <button key={bug.id} className={bug.id === selectedId ? 'active' : ''} onClick={() => onSelect(bug.id)}><div><code>BUG-{bug.id}</code><Badge className={`test-bug-status ${bug.status}`} variant="outline">{bugStatusLabel[bug.status]}</Badge></div><strong>{bug.title}</strong><small>{severityLabel[bug.severity]} · {data.users.find((user) => user.id === bug.assigneeUserId)?.displayName || '未分配'}</small></button>) : <p className="test-list-empty">当前测试对象还没有 Bug。</p>}
        </div>
        <div className="test-record-detail">
          {selected ? <BugDetail bug={selected} busy={busy} readOnly={readOnly} users={data.users} onAssignee={onAssignee} onComment={readOnly ? undefined : onComment} onDeleteComment={readOnly ? undefined : onDeleteComment} onStatus={onStatus} onUpdateComment={readOnly ? undefined : onUpdateComment} /> : <div className="test-detail-empty"><Bug size={28} /><p>选择一个 Bug 查看和流转。</p></div>}
        </div>
      </div>
    </div>
  )
}

function BugDetail({ bug, busy, onAssignee, onComment, onDeleteComment, onStatus, onUpdateComment, readOnly, users }: {
  bug: TestBug
  busy: boolean
  onAssignee: (bug: TestBug, assigneeUserId?: number) => void
  onComment?: (bug: TestBug, content: string) => Promise<boolean>
  onDeleteComment?: (bug: TestBug, comment: TestBugComment) => Promise<boolean>
  onStatus: (bug: TestBug, status: BugStatus) => void
  onUpdateComment?: (bug: TestBug, comment: TestBugComment, content: string) => Promise<boolean>
  readOnly: boolean
  users: TestWorkbenchData['users']
}) {
  const developers = users.filter((user) => user.roles.includes('developer'))
  return <>
    <div className="test-detail-heading"><div><code>BUG-{bug.id}</code><h2>{bug.title}</h2></div><Badge className={`test-bug-status ${bug.status}`} variant="outline">{bugStatusLabel[bug.status]}</Badge></div>
    <div className="test-bug-controls"><Label>状态<Select value={bug.status} onValueChange={(value) => onStatus(bug, value as BugStatus)} disabled={busy || readOnly}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(bugStatusLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Label><Label>负责人<Select value={bug.assigneeUserId ? String(bug.assigneeUserId) : 'none'} onValueChange={(value) => onAssignee(bug, value === 'none' ? undefined : Number(value))} disabled={busy || readOnly}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">未分配</SelectItem>{developers.map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.displayName}</SelectItem>)}</SelectContent></Select></Label></div>
    <div className="test-detail-meta"><span>严重程度 <strong>{severityLabel[bug.severity]}</strong></span><span>优先级 <strong>{priorityLabel[bug.priority]}</strong></span><span>环境 <strong>{bug.environment || '未记录'}</strong></span><span>更新时间 <strong>{formatTimestamp(bug.updatedAt)}</strong></span></div>
    <DetailBlock title="复现步骤" content={bug.reproductionSteps} /><DetailBlock title="预期结果" content={bug.expectedResult} /><DetailBlock title="实际结果" content={bug.actualResult} />
    <BugCommentsSection
      bug={bug}
      busy={busy}
      placeholder="补充验证信息或处理记录，支持粘贴、拖入或上传图片和视频。"
      onComment={onComment}
      onDeleteComment={onDeleteComment}
      onUpdateComment={onUpdateComment}
    />
  </>
}

function BugCommentsSection({ bug, busy, currentUserId, onComment, onDeleteComment, onUpdateComment, placeholder }: {
  bug: TestBug
  busy: boolean
  currentUserId?: number
  onComment?: (bug: TestBug, content: string) => Promise<boolean>
  onDeleteComment?: (bug: TestBug, comment: TestBugComment) => Promise<boolean>
  onUpdateComment?: (bug: TestBug, comment: TestBugComment, content: string) => Promise<boolean>
  placeholder: string
}) {
  const [comment, setComment] = useState('')
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    setComment('')
    setUploading(false)
  }, [bug.id])

  return (
    <section className="test-comments">
      <h3>协作记录</h3>
      {bug.comments.map((item) => (
        <BugCommentArticle
          key={item.id}
          bug={bug}
          busy={busy}
          comment={item}
          currentUserId={currentUserId}
          onDeleteComment={onDeleteComment}
          onUpdateComment={onUpdateComment}
        />
      ))}
      {onComment ? <form
        className="test-comment-composer"
        onSubmit={async (event) => {
          event.preventDefault()
          if (comment.trim() && await onComment(bug, comment)) setComment('')
        }}
      >
        <BugEvidenceEditor
          label="添加评论"
          value={comment}
          placeholder={placeholder}
          onChange={setComment}
          onUploadingChange={setUploading}
        />
        <Button disabled={busy || uploading || !comment.trim()}>{uploading ? '附件上传中...' : '添加评论'}</Button>
      </form> : null}
    </section>
  )
}

function BugCommentArticle({ bug, busy, comment, currentUserId, onDeleteComment, onUpdateComment }: {
  bug: TestBug
  busy: boolean
  comment: TestBugComment
  currentUserId?: number
  onDeleteComment?: (bug: TestBug, comment: TestBugComment) => Promise<boolean>
  onUpdateComment?: (bug: TestBug, comment: TestBugComment, content: string) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.content)
  const [uploading, setUploading] = useState(false)
  const canManage = Boolean((onUpdateComment || onDeleteComment) && (comment.canEdit || (
    currentUserId != null && comment.authorUserId === currentUserId
  )))
  const canEdit = Boolean(onUpdateComment && canManage)
  const canDelete = Boolean(onDeleteComment && canManage)
  const edited = comment.updatedAt
    ? new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 1000
    : false

  useEffect(() => {
    if (!editing) setDraft(comment.content)
  }, [comment.content, editing])

  return (
    <article className="test-comment-item">
      <div className="test-comment-header">
        <div className="test-comment-byline">
          <strong>{comment.authorName}</strong>
          <span aria-hidden="true">·</span>
          <time>{formatTimestamp(comment.createdAt)}{edited ? ` · 编辑于 ${formatTimestamp(comment.updatedAt)}` : ''}</time>
        </div>
        {(canEdit || canDelete) && !editing ? (
          <div className="test-comment-actions">
            {canEdit ? (
              <Button
                aria-label="编辑协作记录"
                size="icon"
                title="编辑协作记录"
                type="button"
                variant="outline"
                onClick={() => setEditing(true)}
              >
                <PencilSimple />
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                aria-label="删除协作记录"
                className="test-comment-delete-button"
                disabled={busy}
                size="icon"
                title="删除协作记录"
                type="button"
                variant="outline"
                onClick={() => {
                  if (!onDeleteComment) return
                  if (window.confirm('确定删除这条协作记录吗？')) {
                    void onDeleteComment(bug, comment)
                  }
                }}
              >
                <Trash />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {editing ? (
        <form
          className="test-comment-editor"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!onUpdateComment || !draft.trim()) return
            const saved = await onUpdateComment(bug, comment, draft)
            if (saved) setEditing(false)
          }}
        >
          <BugEvidenceEditor
            label="编辑评论"
            value={draft}
            placeholder="更新协作记录，支持粘贴、拖入或上传图片和视频。"
            onChange={setDraft}
            onUploadingChange={setUploading}
          />
          <div className="test-comment-editor-actions">
            <Button type="button" variant="outline" onClick={() => { setDraft(comment.content); setEditing(false) }}>取消</Button>
            <Button disabled={busy || uploading || !draft.trim()}>{uploading ? '附件上传中...' : '保存'}</Button>
          </div>
        </form>
      ) : (
        <BugEvidenceContent content={comment.content} emptyText="未填写" />
      )}
    </article>
  )
}

type BugEvidenceAttachment = {
  alt: string
  src: string
  type: 'image' | 'video'
  uploading?: boolean
}

const bugEvidenceAttachmentPattern = /!\[([^\]]*)\]\(([^)\n]+)\)|\[视频：([^\]]*)\]\(([^)\n]+)\)/g

function normalizeBugEvidenceAttachment(attachment: BugEvidenceAttachment, index: number) {
  const fallback = attachment.type === 'video' ? `录屏 ${index + 1}` : `截图 ${index + 1}`
  return {
    ...attachment,
    alt: sanitizeBugEvidenceAlt(attachment.alt) || fallback,
  }
}

function normalizeBugEvidenceAttachments(attachments: BugEvidenceAttachment[]) {
  return attachments
    .filter((attachment) => attachment.src.trim())
    .map(normalizeBugEvidenceAttachment)
}

function parseBugEvidenceContent(content: string) {
  const attachments: BugEvidenceAttachment[] = []
  const textParts: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null = bugEvidenceAttachmentPattern.exec(content)

  while (match) {
    textParts.push(content.slice(lastIndex, match.index))
    const imageAlt = match[1]
    const imageSrc = match[2]
    const videoAlt = match[3]
    const videoSrc = match[4]
    attachments.push({
      alt: imageAlt ?? videoAlt ?? '',
      src: imageSrc ?? videoSrc ?? '',
      type: imageSrc ? 'image' : 'video',
    })
    lastIndex = bugEvidenceAttachmentPattern.lastIndex
    match = bugEvidenceAttachmentPattern.exec(content)
  }

  textParts.push(content.slice(lastIndex))
  bugEvidenceAttachmentPattern.lastIndex = 0

  return {
    attachments: normalizeBugEvidenceAttachments(attachments),
    text: attachments.length > 0
      ? textParts.join('').replace(/\n{3,}/g, '\n\n').replace(/\n{2,}$/g, '')
      : textParts.join(''),
  }
}

function sanitizeBugEvidenceAlt(value: string) {
  return value.replace(/[\]\n\r]/g, ' ').trim()
}

function serializeBugEvidenceContent(text: string, attachments: BugEvidenceAttachment[]) {
  const normalizedAttachments = normalizeBugEvidenceAttachments(attachments)
  const attachmentMarkdown = normalizedAttachments
    .map((attachment) => attachment.type === 'video'
      ? `[视频：${attachment.alt}](${attachment.src})`
      : `![${attachment.alt}](${attachment.src})`)
    .join('\n\n')
  const hasText = text.trim().length > 0

  if (hasText && attachmentMarkdown) return `${text}\n\n${attachmentMarkdown}`
  return hasText ? text : attachmentMarkdown
}

function isSupportedBugEvidenceFile(file: File) {
  return file.type.startsWith('image/') || file.type.startsWith('video/')
}

function bugEvidenceFileType(file: File): BugEvidenceAttachment['type'] {
  return file.type.startsWith('video/') ? 'video' : 'image'
}

function BugEvidenceEditor({ label, onChange, onUploadingChange, placeholder, value }: {
  label: string
  onChange: (value: string) => void
  onUploadingChange?: (uploading: boolean) => void
  placeholder: string
  value: string
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { attachments, text } = useMemo(() => parseBugEvidenceContent(value), [value])
  const [textDraft, setTextDraft] = useState(text)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [uploadingAttachmentSrcs, setUploadingAttachmentSrcs] = useState<string[]>([])
  const latestValueRef = useRef(value)
  const lastSerializedValueRef = useRef<string | null>(null)
  const previewAttachment = previewIndex == null ? null : attachments[previewIndex] ?? null
  const uploadingSrcSet = useMemo(() => new Set(uploadingAttachmentSrcs), [uploadingAttachmentSrcs])

  useEffect(() => {
    latestValueRef.current = value
  }, [value])

  useEffect(() => {
    if (lastSerializedValueRef.current === value) return
    setTextDraft(text)
  }, [text, value])

  useEffect(() => {
    onUploadingChange?.(uploadingAttachmentSrcs.length > 0)
  }, [onUploadingChange, uploadingAttachmentSrcs.length])

  useEffect(() => {
    if (previewIndex != null && !attachments[previewIndex]) setPreviewIndex(null)
  }, [attachments, previewIndex])

  function commitValue(nextValue: string) {
    latestValueRef.current = nextValue
    lastSerializedValueRef.current = nextValue
    onChange(nextValue)
  }

  function updateEvidence(nextText: string, nextAttachments: BugEvidenceAttachment[]) {
    commitValue(serializeBugEvidenceContent(nextText, nextAttachments))
  }

  async function handleFiles(files: File[]) {
    const supportedFiles = files.filter(isSupportedBugEvidenceFile)
    if (supportedFiles.length === 0) {
      window.alert('仅支持上传图片或视频文件。')
      return
    }
    if (supportedFiles.length !== files.length) {
      window.alert('已忽略不支持的文件，仅保留图片和视频。')
    }

    const currentContent = parseBugEvidenceContent(latestValueRef.current)
    const pendingAttachments = supportedFiles.map((file, index) => ({
      alt: sanitizeBugEvidenceAlt(file.name) || (file.type.startsWith('video/') ? `录屏 ${currentContent.attachments.length + index + 1}` : `截图 ${currentContent.attachments.length + index + 1}`),
      src: URL.createObjectURL(file),
      type: bugEvidenceFileType(file),
      uploading: true,
    }))
    const pendingSrcs = pendingAttachments.map((attachment) => attachment.src)
    const pendingSrcSet = new Set(pendingSrcs)
    setUploadingAttachmentSrcs((current) => [...new Set([...current, ...pendingSrcs])])
    updateEvidence(currentContent.text, [...currentContent.attachments, ...pendingAttachments])

    try {
      const uploads = await Promise.all(supportedFiles.map(uploadWorkbenchAttachment))
      const uploadedAttachmentsByPendingSrc = new Map(
        pendingAttachments.map((pendingAttachment, index) => [
          pendingAttachment.src,
          {
            alt: pendingAttachment.alt,
            src: uploads[index]?.attachmentUrl ?? uploads[index]?.imageUrl ?? '',
            type: pendingAttachment.type,
          },
        ]),
      )
      const latestContent = parseBugEvidenceContent(latestValueRef.current)
      const nextAttachments = latestContent.attachments.flatMap((attachment) => {
        const uploadedAttachment = uploadedAttachmentsByPendingSrc.get(attachment.src)
        return uploadedAttachment?.src ? [uploadedAttachment] : [attachment]
      })
      updateEvidence(latestContent.text, nextAttachments)
    } catch (error) {
      const latestContent = parseBugEvidenceContent(latestValueRef.current)
      updateEvidence(
        latestContent.text,
        latestContent.attachments.filter((attachment) => !pendingSrcSet.has(attachment.src)),
      )
      console.error('Bug evidence attachment upload failed', error)
      window.alert(error instanceof Error && error.message
        ? `附件上传失败：${error.message}`
        : '附件上传失败，请稍后重试。')
    } finally {
      setUploadingAttachmentSrcs((current) => current.filter((src) => !pendingSrcSet.has(src)))
      pendingAttachments.forEach((attachment) => URL.revokeObjectURL(attachment.src))
    }
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/')))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    if (files.length === 0) return
    event.preventDefault()
    await handleFiles(files)
  }

  async function handleDrop(event: DragEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return
    event.preventDefault()
    await handleFiles(files)
  }

  return (
    <section className={attachments.length > 0 ? 'test-evidence-editor has-attachments' : 'test-evidence-editor'}>
      <div className="test-evidence-editor-header">
        <span>{label}</span>
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadSimple /> 上传图片/视频
        </Button>
      </div>
      <div className="test-evidence-composer">
        {attachments.length > 0 ? (
          <div className="test-evidence-attachments" aria-label={`${label}包含 ${attachments.length} 个附件`}>
            {attachments.map((attachment, index) => {
              const uploading = uploadingSrcSet.has(attachment.src) || attachment.uploading
              return (
                <figure className="test-evidence-attachment" key={`${attachment.src.slice(0, 48)}-${index}`}>
                  <button
                    aria-label={`查看${attachment.type === 'video' ? '视频' : '图片'} ${index + 1}`}
                    className={uploading ? 'test-evidence-attachment-preview uploading' : 'test-evidence-attachment-preview'}
                    disabled={uploading}
                    type="button"
                    onClick={() => setPreviewIndex(index)}
                  >
                    {attachment.type === 'video' ? (
                      <>
                        <video src={attachment.src} muted preload="metadata" />
                        <span className="test-evidence-video-chip">视频</span>
                      </>
                    ) : (
                      <img src={attachment.src} alt={attachment.alt} loading="lazy" />
                    )}
                    {uploading ? <span className="test-evidence-uploading-chip">上传中</span> : null}
                  </button>
                  <button
                    aria-label={`删除附件 ${index + 1}`}
                    className="test-evidence-attachment-remove"
                    type="button"
                    onClick={() => updateEvidence(
                      textDraft,
                      attachments.filter((_, attachmentIndex) => attachmentIndex !== index),
                  )}
                >
                    <X size={13} />
                  </button>
                </figure>
              )
            })}
          </div>
        ) : null}
        <Textarea
          className="test-evidence-textarea"
          placeholder={placeholder}
          value={textDraft}
          onChange={(event) => {
            const nextText = event.target.value
            setTextDraft(nextText)
            updateEvidence(nextText, attachments)
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) event.preventDefault()
          }}
          onDrop={(event) => {
            void handleDrop(event)
          }}
          onPaste={(event) => {
            void handlePaste(event)
          }}
        />
        <input
          ref={fileInputRef}
          accept="image/*,video/mp4,video/webm,video/quicktime"
          className="test-evidence-file-input"
          multiple
          type="file"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            void handleFiles(files)
          }}
        />
      </div>
      <EvidencePreviewDialog
        attachment={previewAttachment}
        onClose={() => setPreviewIndex(null)}
      />
    </section>
  )
}

function EvidencePreviewDialog({ attachment, onClose }: {
  attachment: BugEvidenceAttachment | null
  onClose: () => void
}) {
  return (
    <Dialog open={Boolean(attachment)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="test-evidence-preview-dialog" showCloseButton={false}>
        <DialogTitle className="test-evidence-preview-title">附件预览</DialogTitle>
        {attachment ? (
          <div className="test-evidence-preview-shell">
            {attachment.type === 'video' ? (
              <video className="test-evidence-preview-media" controls src={attachment.src} />
            ) : (
              <img className="test-evidence-preview-media" src={attachment.src} alt={attachment.alt} />
            )}
            <button
              aria-label="关闭附件预览"
              className="test-evidence-preview-close"
              type="button"
              onClick={onClose}
            >
              <XCircle size={18} weight="fill" />
            </button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function BugEvidenceContent({ content, emptyText = '未填写', title = '附件' }: {
  content: string
  emptyText?: string
  title?: string
}) {
  const { attachments, text } = useMemo(() => parseBugEvidenceContent(content), [content])
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const previewAttachment = previewIndex == null ? null : attachments[previewIndex] ?? null

  useEffect(() => {
    if (previewIndex != null && !attachments[previewIndex]) setPreviewIndex(null)
  }, [attachments, previewIndex])

  return (
    <div className="test-evidence-content">
      {text.trim() ? <p>{text}</p> : attachments.length === 0 ? <p>{emptyText}</p> : null}
      {attachments.length > 0 ? (
        <div className="test-evidence-viewer-attachments" aria-label={`${title}包含 ${attachments.length} 个附件`}>
          {attachments.map((attachment, index) => (
            <figure className="test-evidence-viewer-attachment" key={`${attachment.src.slice(0, 48)}-${index}`}>
              <button
                aria-label={`查看${attachment.type === 'video' ? '视频' : '图片'} ${index + 1}`}
                className="test-evidence-attachment-preview"
                type="button"
                onClick={() => setPreviewIndex(index)}
              >
                {attachment.type === 'video' ? (
                  <>
                    <video src={attachment.src} muted preload="metadata" />
                    <span className="test-evidence-video-chip">视频</span>
                  </>
                ) : (
                  <img src={attachment.src} alt={attachment.alt} loading="lazy" />
                )}
              </button>
            </figure>
          ))}
        </div>
      ) : null}
      <EvidencePreviewDialog attachment={previewAttachment} onClose={() => setPreviewIndex(null)} />
    </div>
  )
}

function DetailBlock({ content, title }: { content: string; title: string }) {
  return (
    <section className="test-detail-block">
      <h3>{title}</h3>
      <BugEvidenceContent content={content} title={title} />
    </section>
  )
}

function TestSpaceCreateDialog({ busy, onOpenChange, onSubmit, open, organizations }: {
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string, organizationId?: number) => Promise<boolean>
  open: boolean
  organizations: TestSpaceSettings['organizations']
}) {
  const [name, setName] = useState('')
  const [organizationValue, setOrganizationValue] = useState('none')

  useEffect(() => {
    if (!open) {
      setName('')
      setOrganizationValue('none')
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fixedHeader className="test-workbench-dialog">
        <DialogHeader>
          <DialogTitle>新建测试空间</DialogTitle>
          <DialogDescription>测试空间用于隔离测试对象、用例、计划和 Bug，也可以归属到你所在的组织。</DialogDescription>
        </DialogHeader>
        <form
          className="test-dialog-form"
          onSubmit={async (event) => {
            event.preventDefault()
            const saved = await onSubmit(
              name,
              organizationValue === 'none' ? undefined : Number(organizationValue),
            )
            if (saved) setName('')
          }}
        >
          <Label>
            空间名称
            <Input autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：Sealos Pro 测试组" />
          </Label>
          <Label>
            归属组织
            <Select value={organizationValue} onValueChange={setOrganizationValue}>
              <SelectTrigger aria-label="测试空间归属组织"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">不归属组织</SelectItem>
                {organizations.map((organization) => (
                  <SelectItem key={organization.id} value={String(organization.id)}>{organization.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button disabled={busy || !name.trim()}><Plus /> 创建空间</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TestSpaceSettingsDialog({ currentSpaceId, onCreateSpace, onOpenChange, onWorkbenchChange, open }: {
  currentSpaceId?: number
  onCreateSpace: () => void
  onOpenChange: (open: boolean) => void
  onWorkbenchChange: () => Promise<void>
  open: boolean
}) {
  const [settings, setSettings] = useState<TestSpaceSettings>(emptyTestSpaceSettings)
  const [selectedSpaceId, setSelectedSpaceId] = useState<number>()
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [organizationValue, setOrganizationValue] = useState('none')
  const [inviteUsername, setInviteUsername] = useState('')
  const [memberAccess, setMemberAccess] = useState<'editor' | 'viewer'>('editor')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [inviteLinkAccess, setInviteLinkAccess] = useState<'editor' | 'viewer'>('editor')
  const [inviteExpiresInMinutes, setInviteExpiresInMinutes] = useState(10)
  const [encryptedInviteShare, setEncryptedInviteShare] = useState(false)
  const [inviteLinkStatus, setInviteLinkStatus] = useState('')
  const selectedSpace = settings.spaces.find((space) => space.id === selectedSpaceId)
  const isOwner = selectedSpace?.accessLevel === 'owner'

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError('')
    fetchTestSpaceSettings()
      .then((result) => {
        setSettings(result)
        setSelectedSpaceId((current) => {
          if (result.spaces.some((space) => space.id === current)) return current
          if (result.spaces.some((space) => space.id === currentSpaceId)) return currentSpaceId
          return result.spaces[0]?.id
        })
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : '测试空间加载失败。'))
      .finally(() => setLoading(false))
  }, [currentSpaceId, open])

  useEffect(() => {
    setRenameValue(selectedSpace?.name ?? '')
    setOrganizationValue(selectedSpace?.organizationId ? String(selectedSpace.organizationId) : 'none')
    setDeleteConfirmation('')
    setInviteUsername('')
    setInviteLinkStatus('')
  }, [selectedSpace?.id, selectedSpace?.name, selectedSpace?.organizationId])

  async function mutateSettings(
    operation: () => Promise<TestSpaceSettings>,
    onSuccess?: (result: TestSpaceSettings) => void,
  ) {
    setBusy(true)
    setError('')
    try {
      const result = await operation()
      setSettings(result)
      onSuccess?.(result)
      await onWorkbenchChange()
      return true
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : '测试空间保存失败。')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function copyInviteLink() {
    if (!selectedSpace || !isOwner) return
    setBusy(true)
    setInviteLinkStatus('')
    try {
      const password = encryptedInviteShare ? generateTestSpaceInvitePassword() : undefined
      const inviteLink = await createTestSpaceInviteLink(selectedSpace.id, {
        accessLevel: inviteLinkAccess,
        expiresInMinutes: inviteExpiresInMinutes,
        password,
      })
      const inviteUrl = buildTestSpaceInviteUrl(inviteLink.token)
      const shareText = password
        ? `邀请你加入 ${selectedSpace.name} 测试空间，请点击此链接进入：${inviteUrl}，密码：${password}`
        : inviteUrl
      if (!navigator.clipboard) throw new Error('Clipboard is not available')
      await navigator.clipboard.writeText(shareText)
      setInviteLinkStatus(`已复制，${formatInviteDuration(inviteLink.expiresInMinutes)}内有效`)
    } catch {
      setInviteLinkStatus('复制失败，请稍后再试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fixedHeader className="test-space-admin-dialog">
        <DialogHeader>
          <DialogTitle>管理测试空间</DialogTitle>
          <DialogDescription>维护测试空间信息、组织归属、成员与协作权限。</DialogDescription>
        </DialogHeader>
        <WorkspaceError message={error} />
        {loading ? <p className="test-list-empty">正在加载测试空间...</p> : (
          <div className="test-space-admin-layout">
            <section className="test-space-admin-list-pane">
              <div className="test-space-admin-list-toolbar">
                <strong>我的测试空间</strong>
                <Button type="button" variant="outline" onClick={onCreateSpace}><Plus /> 新建</Button>
              </div>
              <div className="test-space-admin-list">
                {settings.spaces.map((space) => (
                  <button key={space.id} type="button" className={space.id === selectedSpaceId ? 'active' : ''} onClick={() => setSelectedSpaceId(space.id)}>
                    <strong>{space.name}</strong>
                    <small>{space.accessLevel === 'owner' ? '所有者' : space.accessLevel === 'editor' ? '可编辑' : '只读'} · {space.members.filter((member) => member.status === 'active').length} 位成员 · {space.organizationName ?? '无组织'}</small>
                  </button>
                ))}
                {settings.spaces.length === 0 ? <p className="test-list-empty">还没有已加入的测试空间。</p> : null}
              </div>
            </section>

            <section className="test-space-admin-detail">
              {selectedSpace ? (
                <>
                  {isOwner ? (
                    <form className="test-space-settings-row" onSubmit={(event) => {
                      event.preventDefault()
                      void mutateSettings(() => updateTestSpace(selectedSpace.id, {
                        name: renameValue,
                        organizationId: organizationValue === 'none' ? undefined : Number(organizationValue),
                      }))
                    }}>
                      <Label>空间名称<Input maxLength={80} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} /></Label>
                      <Label>归属组织
                        <Select value={organizationValue} onValueChange={setOrganizationValue}>
                          <SelectTrigger aria-label="测试空间归属组织"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">不归属组织</SelectItem>
                            {settings.organizations.map((organization) => (
                              <SelectItem key={organization.id} value={String(organization.id)}>{organization.name}</SelectItem>
                            ))}
                            {selectedSpace.organizationId && !settings.organizations.some((organization) => organization.id === selectedSpace.organizationId) ? (
                              <SelectItem disabled value={String(selectedSpace.organizationId)}>{selectedSpace.organizationName ?? '当前组织'}</SelectItem>
                            ) : null}
                          </SelectContent>
                        </Select>
                      </Label>
                      <Button variant="outline" disabled={busy || !renameValue.trim() || (
                        renameValue.trim() === selectedSpace.name
                        && organizationValue === (selectedSpace.organizationId ? String(selectedSpace.organizationId) : 'none')
                      )}><PencilSimple /> 保存修改</Button>
                    </form>
                  ) : <div className="test-space-readonly-heading">
                    <div><span>空间名称</span><strong>{selectedSpace.name}</strong></div>
                    <div><span>归属组织</span><strong>{selectedSpace.organizationName ?? '不归属组织'}</strong></div>
                    <Badge variant="outline">{selectedSpace.accessLevel === 'editor' ? '可编辑' : '只读'}</Badge>
                  </div>}

                  <section className="test-space-members-section">
                    <div className="test-space-admin-section-heading"><div><span>成员与邀请</span><strong>{selectedSpace.members.length}</strong></div></div>
                    {isOwner ? <form
                      className="test-space-member-add-row"
                      onSubmit={async (event) => {
                        event.preventDefault()
                        if (!inviteUsername.trim()) return
                        const saved = await mutateSettings(() => inviteTestSpaceMember(selectedSpace.id, inviteUsername.trim(), memberAccess))
                        if (saved) setInviteUsername('')
                      }}
                    >
                      <Input autoComplete="username" value={inviteUsername} onChange={(event) => setInviteUsername(event.target.value)} placeholder="输入测试工程师用户名" />
                      <Select value={memberAccess} onValueChange={(value) => setMemberAccess(value as 'editor' | 'viewer')}>
                        <SelectTrigger aria-label="成员权限"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="editor">可编辑</SelectItem><SelectItem value="viewer">只读</SelectItem></SelectContent>
                      </Select>
                      <Button size="icon" variant="outline" aria-label="邀请空间成员" title="邀请空间成员" disabled={busy || !inviteUsername.trim()}><UserPlus /></Button>
                    </form> : null}
                    <div className="test-space-member-list">
                      {selectedSpace.members.map((member) => (
                        <article key={member.userId}>
                          <div><strong>{member.displayName}</strong><small>{member.username} · {member.status === 'pending' ? '待接受' : '已加入'}</small></div>
                          {member.accessLevel === 'owner' ? <Badge variant="outline">所有者</Badge> : (
                            isOwner ? <Select value={member.accessLevel} onValueChange={(value) => void mutateSettings(() => updateTestSpaceMember(selectedSpace.id, member.userId, value as 'editor' | 'viewer'))} disabled={busy}>
                              <SelectTrigger aria-label={`${member.displayName}的空间权限`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="editor">可编辑</SelectItem><SelectItem value="viewer">只读</SelectItem></SelectContent>
                            </Select> : <Badge variant="outline">{member.accessLevel === 'editor' ? '可编辑' : '只读'}</Badge>
                          )}
                          {member.accessLevel === 'owner' || !isOwner ? <span /> : (
                            <Button size="icon" variant="ghost" aria-label={`移除成员${member.displayName}`} title="移除成员" disabled={busy} onClick={() => void mutateSettings(() => removeTestSpaceMember(selectedSpace.id, member.userId))}><Trash /></Button>
                          )}
                        </article>
                      ))}
                    </div>
                  </section>

                  {isOwner ? <section className="test-space-invite-link-section">
                    <div className="test-space-admin-section-heading"><div><span>邀请链接</span><strong>{inviteLinkAccess === 'editor' ? '可编辑' : '只读'}</strong></div></div>
                    <p>复制给测试工程师，对方登录并切换到测试工程师身份后即可加入。</p>
                    <div className="test-space-invite-link-controls">
                      <Select value={String(inviteExpiresInMinutes)} onValueChange={(value) => { setInviteExpiresInMinutes(Number(value)); setInviteLinkStatus('') }}>
                        <SelectTrigger aria-label="邀请链接有效时长"><SelectValue /></SelectTrigger>
                        <SelectContent>{[10, 30, 60, 240, 1440].map((minutes) => <SelectItem key={minutes} value={String(minutes)}>{formatInviteDuration(minutes)}</SelectItem>)}</SelectContent>
                      </Select>
                      <Select value={inviteLinkAccess} onValueChange={(value) => { setInviteLinkAccess(value as 'editor' | 'viewer'); setInviteLinkStatus('') }}>
                        <SelectTrigger aria-label="邀请链接成员权限"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="editor">可编辑</SelectItem><SelectItem value="viewer">只读</SelectItem></SelectContent>
                      </Select>
                      <label><input type="checkbox" checked={encryptedInviteShare} onChange={(event) => { setEncryptedInviteShare(event.target.checked); setInviteLinkStatus('') }} /> 加密分享</label>
                      <Button variant="outline" disabled={busy} onClick={() => void copyInviteLink()}><CopySimple /> {inviteLinkStatus.startsWith('已复制') ? '已复制' : '复制链接'}</Button>
                    </div>
                    {inviteLinkStatus ? <small>{inviteLinkStatus}</small> : null}
                  </section> : null}

                  {isOwner ? <form
                    className="test-space-danger-zone"
                    onSubmit={async (event) => {
                      event.preventDefault()
                      await mutateSettings(
                        () => deleteTestSpace(selectedSpace.id, deleteConfirmation),
                        (result) => setSelectedSpaceId(result.spaces[0]?.id),
                      )
                    }}
                  >
                    <div><strong>删除测试空间</strong><small>将永久删除空间内全部测试对象、用例、计划、Bug 和评论。</small></div>
                    <Input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder={`输入“${selectedSpace.name}”确认`} />
                    <Button variant="destructive" disabled={busy || deleteConfirmation !== selectedSpace.name}><Trash /> 删除</Button>
                  </form> : null}
                </>
              ) : <div className="test-detail-empty"><GearSix size={28} /><p>创建测试空间后即可维护成员和权限。</p></div>}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TestSpaceInvitePasswordDialog({ busy, error, onCancel, onPasswordChange, onSubmit, open, password }: {
  busy: boolean
  error: string
  onCancel: () => void
  onPasswordChange: (value: string) => void
  onSubmit: () => void
  open: boolean
  password: string
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel() }}>
      <DialogContent fixedHeader className="test-workbench-dialog">
        <DialogHeader><DialogTitle>输入测试空间邀请密码</DialogTitle><DialogDescription>该邀请链接已开启加密分享，验证后会加入测试空间。</DialogDescription></DialogHeader>
        <form className="test-dialog-form" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
          <Label>邀请密码<Input autoFocus type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} /></Label>
          {error ? <WorkspaceError message={error} /> : null}
          <DialogFooter><Button type="button" variant="outline" onClick={onCancel}>取消</Button><Button disabled={busy || !password.trim()}>{busy ? '验证中...' : '验证并加入'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SubjectDialog({
  busy,
  onOpenChange,
  onSubmit,
  open,
}: {
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: { description: string; environment: string; name: string; versionLabel: string }) => void
  open: boolean
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [versionLabel, setVersionLabel] = useState('')
  const [environment, setEnvironment] = useState('')
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent fixedHeader className="test-wide-dialog"><DialogHeader><DialogTitle>新建测试对象</DialogTitle><DialogDescription>测试对象独立存在，用于承载对象版本、环境和用例。</DialogDescription></DialogHeader><form className="test-dialog-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ description, environment, name, versionLabel }) }}><Label>名称<Input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></Label><Label>说明<Textarea value={description} onChange={(event) => setDescription(event.target.value)} /></Label><div className="test-form-grid"><Label>当前版本<Input value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} placeholder="v1.0.0" /></Label><Label>默认环境<Input value={environment} onChange={(event) => setEnvironment(event.target.value)} placeholder="测试环境" /></Label></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={busy || !name.trim()}>创建</Button></DialogFooter></form></DialogContent></Dialog>
}

function FolderDialog({
  busy,
  cases,
  folders,
  onCreate,
  onDelete,
  onOpenChange,
  onRename,
  open,
  subject,
}: {
  busy: boolean
  cases: TestCase[]
  folders: TestWorkbenchData['folders']
  onCreate: (name: string) => Promise<boolean>
  onDelete: (folder: TestWorkbenchData['folders'][number]) => Promise<boolean>
  onOpenChange: (open: boolean) => void
  onRename: (folder: TestWorkbenchData['folders'][number], name: string) => Promise<boolean>
  open: boolean
  subject?: TestSubject
}) {
  const [newName, setNewName] = useState('')
  const [drafts, setDrafts] = useState<Record<number, string>>({})

  useEffect(() => {
    if (!open) return
    setDrafts(Object.fromEntries(folders.map((folder) => [folder.id, folder.name])))
    setNewName('')
  }, [folders, open])

  const caseCountByFolder = useMemo(() => {
    const counts = new Map<number, number>()
    for (const item of cases) {
      if (item.folderId) counts.set(item.folderId, (counts.get(item.folderId) ?? 0) + 1)
    }
    return counts
  }, [cases])

  async function createFolder() {
    const saved = await onCreate(newName)
    if (saved) setNewName('')
  }

  async function renameFolder(folder: TestWorkbenchData['folders'][number]) {
    const nextName = (drafts[folder.id] ?? '').trim()
    if (!nextName || nextName === folder.name) return
    await onRename(folder, nextName)
  }

  async function deleteFolder(folder: TestWorkbenchData['folders'][number]) {
    const count = caseCountByFolder.get(folder.id) ?? 0
    const suffix = count > 0
      ? `该模块下 ${count} 条用例会变为“未分类”，用例本身不会删除。`
      : '该模块下没有用例。'
    if (!window.confirm(`确定删除模块“${folder.name}”吗？${suffix}`)) return
    await onDelete(folder)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fixedHeader className="test-wide-dialog test-folder-dialog">
        <DialogHeader>
          <DialogTitle>管理用例模块</DialogTitle>
          <DialogDescription>
            管理“{subject?.name || '当前测试对象'}”下的模块路径。删除模块不会删除用例，只会清空这些用例的模块归属。
          </DialogDescription>
        </DialogHeader>
        <div className="test-folder-create-row">
          <Input
            autoFocus
            maxLength={240}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (!busy && newName.trim()) void createFolder()
              }
            }}
            placeholder="例如：/DevBox/业务/创建"
          />
          <Button type="button" disabled={busy || !newName.trim()} onClick={() => void createFolder()}><Plus /> 新增模块</Button>
        </div>
        <div className="test-folder-list">
          {folders.length ? folders.map((folder) => {
            const draft = drafts[folder.id] ?? folder.name
            const unchanged = draft.trim() === folder.name
            return (
              <article key={folder.id} className="test-folder-row">
                <div className="test-folder-row-meta">
                  <Input
                    maxLength={240}
                    value={draft}
                    onChange={(event) => setDrafts((current) => ({ ...current, [folder.id]: event.target.value }))}
                  />
                  <small>{caseCountByFolder.get(folder.id) ?? 0} 条用例</small>
                </div>
                <div className="test-folder-row-actions">
                  <Button type="button" variant="outline" disabled={busy || !draft.trim() || unchanged} onClick={() => void renameFolder(folder)}><PencilSimple /> 保存</Button>
                  <Button type="button" variant="destructive" disabled={busy} onClick={() => void deleteFolder(folder)}><Trash /> 删除</Button>
                </div>
              </article>
            )
          }) : (
            <div className="test-folder-empty">当前测试对象还没有模块，创建用例或导入 CSV 时也会自动生成模块。</div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type TestCaseFormPayload = {
  caseKind?: TestCase['caseKind']
  caseType: TestCaseType
  customTags?: string[]
  expectedResult: string
  modulePath?: string
  preconditions: string
  priority: Priority
  remarks: string
  steps: string
  testSubjectId: number
  title: string
}

function CaseDialog({ busy, data, onOpenChange, onSubmit, open, spaceId, subjectId, testCase }: { busy: boolean; data: TestWorkbenchData; onOpenChange: (open: boolean) => void; onSubmit: (payload: TestCaseFormPayload) => void; open: boolean; spaceId?: number; subjectId?: number; testCase?: TestCase }) {
  const key = `${open}-${testCase?.id ?? 'new'}`
  return <CaseDialogForm key={key} {...{ busy, data, onOpenChange, onSubmit, open, spaceId, subjectId, testCase }} />
}

function CaseDialogForm({ busy, data, onOpenChange, onSubmit, open, spaceId, subjectId, testCase }: Parameters<typeof CaseDialog>[0]) {
  const folders = data.folders.filter((folder) => folder.testSpaceId === spaceId && folder.testSubjectId === subjectId)
  const initialModule = folders.find((folder) => folder.id === testCase?.folderId)?.name ?? ''
  const [title, setTitle] = useState(testCase?.title ?? '')
  const [modulePath, setModulePath] = useState(initialModule)
  const [preconditions, setPreconditions] = useState(testCase?.preconditions ?? '')
  const [steps, setSteps] = useState(testCase?.steps ?? '')
  const [expectedResult, setExpectedResult] = useState(testCase?.expectedResult ?? '')
  const [remarks, setRemarks] = useState(testCase?.remarks ?? '')
  const [priority, setPriority] = useState<Priority>(testCase?.priority ?? 'medium')
  const [caseKind, setCaseKind] = useState<TestCase['caseKind']>(testCase?.caseKind ?? 'functional')
  const [caseType, setCaseType] = useState<TestCaseType>(testCase?.caseType ?? 'functional')
  const [customTagsInput, setCustomTagsInput] = useState(testCase?.customTags.join('、') ?? '')
  const [modulePickerOpen, setModulePickerOpen] = useState(false)
  const moduleSuggestions = useMemo(() => {
    const keyword = modulePath.trim().toLowerCase()
    const matched = keyword
      ? folders.filter((folder) => folder.name.toLowerCase().includes(keyword))
      : folders
    return matched.slice(0, 12)
  }, [folders, modulePath])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fixedHeader className="test-wide-dialog test-case-dialog">
        <DialogHeader>
          <DialogTitle>{testCase ? `编辑 CASE-${testCase.id}` : '新建测试用例'}</DialogTitle>
          <DialogDescription>按执行顺序记录用例，加入测试计划后会保留不可变快照。</DialogDescription>
        </DialogHeader>
        <form
          className="test-dialog-form"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit({
              caseKind,
              caseType,
              customTags: Array.from(new Set(customTagsInput.split(/[,，;；、\s]+/).map((tag) => tag.trim()).filter(Boolean))).slice(0, 12),
              expectedResult,
              modulePath: modulePath.trim(),
              preconditions,
              priority,
              remarks,
              steps,
              testSubjectId: subjectId!,
              title,
            })
          }}
        >
          <fieldset className="test-dialog-section">
            <legend>基础信息</legend>
            <Label>用例名称<Input autoFocus maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></Label>
            <Label>
              所属模块
              <div className="test-module-combobox">
                <Input
                  maxLength={240}
                  value={modulePath}
                  onBlur={() => window.setTimeout(() => setModulePickerOpen(false), 120)}
                  onChange={(event) => {
                    setModulePath(event.target.value)
                    setModulePickerOpen(true)
                  }}
                  onFocus={() => setModulePickerOpen(true)}
                  placeholder="例如：/DevBox/业务/创建"
                />
                <button
                  type="button"
                  className="test-module-combobox-toggle"
                  aria-label={modulePickerOpen ? '收起模块列表' : '展开模块列表'}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setModulePickerOpen((current) => !current)}
                >
                  <CaretDown size={18} weight="bold" />
                </button>
                {modulePickerOpen && folders.length ? (
                  <div className="test-module-suggestions" role="listbox">
                    {moduleSuggestions.length ? moduleSuggestions.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        className="test-module-suggestion"
                        role="option"
                        aria-selected={folder.name === modulePath}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setModulePath(folder.name)
                          setModulePickerOpen(false)
                        }}
                      >
                        {folder.name}
                      </button>
                    )) : (
                      <div className="test-module-suggestion-empty">没有匹配的模块，可直接输入新模块。</div>
                    )}
                  </div>
                ) : null}
              </div>
            </Label>
            <div className="test-form-grid test-case-classification-grid">
              <Label>用例分类<Select value={caseKind} onValueChange={(value) => setCaseKind(value as TestCase['caseKind'])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="functional">功能用例</SelectItem><SelectItem value="baseline">基线用例</SelectItem></SelectContent></Select></Label>
              <Label>用例等级<Select value={priority} onValueChange={(value) => setPriority(value as Priority)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="high">P0</SelectItem><SelectItem value="medium">P1</SelectItem><SelectItem value="low">P2</SelectItem></SelectContent></Select></Label>
              <Label>类型<Select value={caseType} onValueChange={(value) => setCaseType(value as TestCaseType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(caseTypeLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Label>
            </div>
            <Label>自定义标签<Input maxLength={500} value={customTagsInput} onChange={(event) => setCustomTagsInput(event.target.value)} placeholder="例如：核心流程、兼容性、支付" /></Label>
          </fieldset>
          <fieldset className="test-dialog-section">
            <legend>执行内容</legend>
            <Label>前置条件<Textarea maxLength={5000} value={preconditions} onChange={(event) => setPreconditions(event.target.value)} /></Label>
            <Label>步骤描述<Textarea maxLength={10000} value={steps} onChange={(event) => setSteps(event.target.value)} /></Label>
            <Label>预期结果<Textarea maxLength={10000} value={expectedResult} onChange={(event) => setExpectedResult(event.target.value)} /></Label>
            <Label>备注<Textarea maxLength={5000} value={remarks} onChange={(event) => setRemarks(event.target.value)} /></Label>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={busy || !title.trim() || !modulePath.trim()}>{testCase ? '保存修改' : '创建用例'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function downloadTestCaseCsvTemplate() {
  const csvContent = `\uFEFF${testCaseCsvTemplateHeaders.join(',')}\r\n`
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = '测试用例导入模板.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function ImportCasesDialog({ busy, onOpenChange, onSubmit, open, spaceId, subject }: {
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (csvText: string) => Promise<boolean>
  open: boolean
  spaceId?: number
  subject?: TestWorkbenchData['subjects'][number]
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [csvText, setCsvText] = useState('')
  const [preview, setPreview] = useState<TestCaseImportPreview>()
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState('')

  function reset() {
    setFileName('')
    setCsvText('')
    setPreview(undefined)
    setPreviewing(false)
    setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !spaceId || !subject) return
    setError('')
    setPreview(undefined)
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('请选择 CSV 文件。')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('CSV 文件不能超过 2 MB。')
      return
    }
    setFileName(file.name)
    setPreviewing(true)
    try {
      const content = await file.text()
      const result = await previewTestCaseImport(spaceId, subject.id, content)
      setCsvText(content)
      setPreview(result.preview)
    } catch (previewError) {
      setCsvText('')
      setError(previewError instanceof Error ? previewError.message : 'CSV 校验失败。')
    } finally {
      setPreviewing(false)
    }
  }

  async function confirmImport() {
    if (!csvText || !preview) return
    const imported = await onSubmit(csvText)
    if (imported) changeOpen(false)
    else setError('导入失败，请根据工作台中的错误提示检查文件。')
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent fixedHeader className="test-wide-dialog test-import-dialog">
        <DialogHeader>
          <DialogTitle>导入测试用例</DialogTitle>
          <DialogDescription>CSV 中的用例将导入到“{subject?.name || '当前测试对象'}”，新模块会自动创建。</DialogDescription>
        </DialogHeader>
        <div className="test-import-picker">
          <input ref={fileInputRef} hidden accept=".csv,text/csv" type="file" onChange={(event) => void selectFile(event)} />
          <FileCsv size={28} weight="duotone" />
          <div className="test-import-picker-copy"><strong>{fileName || '选择 CSV 文件'}</strong><small>支持 UTF-8、最多 1000 条、文件不超过 2 MB</small></div>
          <div className="test-import-picker-actions">
            <Button type="button" variant="outline" onClick={downloadTestCaseCsvTemplate}><DownloadSimple /> 下载模板</Button>
            <Button type="button" variant="outline" disabled={previewing || busy} onClick={() => fileInputRef.current?.click()}><UploadSimple /> {fileName ? '重新选择' : '选择文件'}</Button>
          </div>
        </div>
        {previewing ? <p className="test-import-status">正在校验字段与内容...</p> : null}
        {error ? <div className="test-workbench-error"><WarningCircle /> {error}</div> : null}
        {preview ? (
          <div className="test-import-preview">
            <div className="test-import-metrics">
              <span><strong>{preview.rowCount}</strong> 条用例</span>
              <span><strong>{preview.moduleCount}</strong> 个模块</span>
              <span><strong>{preview.levelCounts.P0}</strong> P0</span>
              <span><strong>{preview.levelCounts.P1}</strong> P1</span>
              <span><strong>{preview.levelCounts.P2}</strong> P2</span>
            </div>
            <div className="test-import-samples">
              <span>内容预览</span>
              {preview.sampleTitles.map((title, index) => <p key={`${title}-${index}`}><code>{index + 1}</code>{title}</p>)}
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => changeOpen(false)}>取消</Button>
          <Button type="button" disabled={busy || previewing || !preview} onClick={() => void confirmImport()}>{busy ? '导入中...' : preview ? `导入 ${preview.rowCount} 条用例` : '确认导入'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type TestPlanFormPayload = {
  caseIds: number[]
  endsOn?: string
  environment: string
  name: string
  ownerUserId?: number
  projectId?: number
  startsOn?: string
  testSubjectIds: number[]
  versionLabel: string
}

function PlanDialog({ busy, cases, folders, onOpenChange, onSubmit, open, plan, planCases, projects, subjects, users }: {
  busy: boolean
  cases: TestCase[]
  folders: TestWorkbenchData['folders']
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: TestPlanFormPayload) => void
  open: boolean
  plan?: TestPlan
  planCases: TestWorkbenchData['planCases']
  projects: TestWorkbenchProjectOption[]
  subjects: TestWorkbenchData['subjects']
  users: TestWorkbenchData['users']
}) {
  const [name, setName] = useState(plan?.name ?? '')
  const [versionLabel, setVersionLabel] = useState(plan?.versionLabel ?? '')
  const [environment, setEnvironment] = useState(plan?.environment ?? '')
  const [startsOn, setStartsOn] = useState(plan?.startsOn?.slice(0, 10) ?? '')
  const [endsOn, setEndsOn] = useState(plan?.endsOn?.slice(0, 10) ?? '')
  const [ownerUserId, setOwnerUserId] = useState(plan?.ownerUserId ? String(plan.ownerUserId) : 'none')
  const [projectId, setProjectId] = useState(plan?.projectId ? String(plan.projectId) : 'none')
  const [subjectIds, setSubjectIds] = useState<number[]>(plan?.testSubjectIds ?? [])
  const [caseIds, setCaseIds] = useState<number[]>([])
  const [caseSearchQuery, setCaseSearchQuery] = useState('')
  const [caseFolderFilter, setCaseFolderFilter] = useState('all')
  const [caseTypeFilter, setCaseTypeFilter] = useState('all')
  const [casePriorityFilter, setCasePriorityFilter] = useState('all')
  const [caseKindFilter, setCaseKindFilter] = useState('all')
  const [step, setStep] = useState<1 | 2>(1)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const existingCaseIds = new Set(planCases
    .filter((item) => item.testPlanId === plan?.id && item.testCaseId)
    .map((item) => item.testCaseId as number))
  const available = cases.filter((item) => subjectIds.includes(item.testSubjectId) && item.status === 'active' && !existingCaseIds.has(item.id))
  const availableFolders = folders.filter((folder) => available.some((item) => item.folderId === folder.id))
  const normalizedCaseQuery = caseSearchQuery.trim().toLocaleLowerCase('zh-CN')
  const filteredAvailable = available.filter((item) => {
    const folder = folders.find((candidate) => candidate.id === item.folderId)
    const matchesSearch = !normalizedCaseQuery || [
      `CASE-${item.id}`,
      item.title,
      folder?.name ?? '未分类',
      item.preconditions,
      item.steps,
      item.expectedResult,
      item.remarks,
      item.customTags.join(' '),
    ].some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedCaseQuery))
    const matchesFolder = caseFolderFilter === 'all'
      || (caseFolderFilter === 'uncategorized' ? !item.folderId : String(item.folderId) === caseFolderFilter)
    return matchesSearch
      && matchesFolder
      && (caseTypeFilter === 'all' || item.caseType === caseTypeFilter)
      && (casePriorityFilter === 'all' || item.priority === casePriorityFilter)
      && (caseKindFilter === 'all' || item.caseKind === caseKindFilter)
  })
  const filteredCaseIds = filteredAvailable.map((item) => item.id)
  const selectedFilteredCount = filteredCaseIds.filter((id) => caseIds.includes(id)).length
  const allFilteredSelected = filteredCaseIds.length > 0 && selectedFilteredCount === filteredCaseIds.length
  const hasCaseFilters = Boolean(caseSearchQuery.trim())
    || caseFolderFilter !== 'all'
    || caseTypeFilter !== 'all'
    || casePriorityFilter !== 'all'
    || caseKindFilter !== 'all'
  const invalidDateRange = Boolean(startsOn && endsOn && startsOn > endsOn)
  const selectedSubjects = subjects.filter((subject) => subjectIds.includes(subject.id))

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedFilteredCount > 0 && !allFilteredSelected
    }
  }, [allFilteredSelected, selectedFilteredCount])

  useEffect(() => {
    if (open) setStep(1)
  }, [open, plan?.id])

  const canGoNext = name.trim().length > 0 && !invalidDateRange
  const canSubmit = canGoNext && subjectIds.length > 0 && (Boolean(plan) || caseIds.length > 0)

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent fixedHeader className={`test-wide-dialog test-plan-dialog ${step === 2 ? 'test-plan-dialog-fixed' : 'test-plan-dialog-auto'}`}>
      <DialogHeader>
        <DialogTitle>{plan ? `编辑 PLAN-${plan.id}` : '新建测试计划'}</DialogTitle>
        <DialogDescription>{plan ? '先修改计划基础信息，再追加测试对象或活动用例。已有快照不会改变。' : '先填写计划基础信息，再选择测试对象和要纳入计划的用例。'}</DialogDescription>
      </DialogHeader>
      <form className="test-dialog-form test-plan-dialog-form" onSubmit={(event) => {
        event.preventDefault()
        if (!canSubmit) return
        onSubmit({
          caseIds,
          endsOn: endsOn || undefined,
          environment,
          name,
          ownerUserId: ownerUserId === 'none' ? undefined : Number(ownerUserId),
          projectId: projectId === 'none' ? undefined : Number(projectId),
          startsOn: startsOn || undefined,
          testSubjectIds: subjectIds,
          versionLabel,
        })
      }}>
        <div className="test-plan-stepper" aria-label="新建测试计划步骤">
          <button className={step === 1 ? 'active' : 'done'} type="button" onClick={() => setStep(1)}>
            <span>1</span>
            <strong>基础信息</strong>
          </button>
          <i aria-hidden="true" />
          <button className={step === 2 ? 'active' : ''} type="button" disabled={!canGoNext} onClick={() => setStep(2)}>
            <span>2</span>
            <strong>测试对象与用例</strong>
          </button>
        </div>
        {step === 1 ? (
          <section className="test-plan-step-panel test-plan-basic-panel" aria-label="计划基础信息">
            <Label>计划名称<Input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></Label>
            <div className="test-form-grid test-plan-basic-grid">
              <Label>版本<Input value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} /></Label>
              <Label>环境<Input value={environment} onChange={(event) => setEnvironment(event.target.value)} /></Label>
              <Label>
                开始日期
                <JournalDatePicker
                  ariaLabel="选择测试计划开始日期"
                  datesWithEntries={[]}
                  displayValue={startsOn || '选择日期'}
                  value={startsOn}
                  onChange={setStartsOn}
                />
              </Label>
              <Label>
                结束日期
                <JournalDatePicker
                  ariaLabel="选择测试计划结束日期"
                  datesWithEntries={[]}
                  displayValue={endsOn || '选择日期'}
                  value={endsOn}
                  onChange={setEndsOn}
                />
              </Label>
            </div>
            <Label>负责人<Select value={ownerUserId} onValueChange={setOwnerUserId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">未分配</SelectItem>{users.filter((user) => user.roles.includes('tester')).map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.displayName}</SelectItem>)}</SelectContent></Select></Label>
            <Label>关联项目<Select value={projectId} onValueChange={setProjectId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">不关联项目</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></Label>
            {invalidDateRange ? <p className="test-form-error">结束日期不能早于开始日期。</p> : null}
          </section>
        ) : (
          <section className="test-plan-step-panel test-plan-scope-panel" aria-label="计划范围与用例">
            <div className="test-plan-scope-grid">
              <fieldset className="test-plan-subject-picker">
                <legend>测试对象</legend>
                <div className="test-plan-subject-list">
                  {subjects.length ? subjects.map((subject) => (
                    <label key={subject.id}>
                      <input
                        type="checkbox"
                        checked={subjectIds.includes(subject.id)}
                        onChange={(event) => {
                          setSubjectIds((current) => event.target.checked
                            ? Array.from(new Set([...current, subject.id]))
                            : current.filter((id) => id !== subject.id))
                          if (!event.target.checked) {
                            setCaseIds((current) => current.filter((id) => cases.find((testCase) => testCase.id === id)?.testSubjectId !== subject.id))
                          }
                        }}
                      />
                      <span>
                        <strong>{subject.name}</strong>
                        <small>{[subject.versionLabel, subject.environment].filter(Boolean).join(' / ') || '未设置版本与环境'}</small>
                      </span>
                    </label>
                  )) : <p className="test-list-empty">当前测试空间还没有测试对象。</p>}
                </div>
                {selectedSubjects.length ? <small className="test-plan-subject-summary">已选 {selectedSubjects.map((subject) => subject.name).join('、')}</small> : null}
              </fieldset>
              <fieldset className="test-plan-case-picker">
                <legend>{plan ? '追加用例' : '选择用例'}</legend>
                <div className="test-plan-case-tools">
                  <div className="test-plan-case-search-row">
                    <label className="test-case-search">
                      <MagnifyingGlass />
                      <Input
                        type="search"
                        aria-label="搜索计划用例"
                        value={caseSearchQuery}
                        onChange={(event) => setCaseSearchQuery(event.target.value)}
                        placeholder="搜索编号、标题、模块或用例内容"
                      />
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      aria-label="清除计划用例筛选"
                      disabled={!hasCaseFilters}
                      onClick={() => {
                        setCaseSearchQuery('')
                        setCaseFolderFilter('all')
                        setCaseTypeFilter('all')
                        setCasePriorityFilter('all')
                        setCaseKindFilter('all')
                      }}
                    ><XCircle /> 清除</Button>
                  </div>
                  <div className="test-plan-case-filter-row">
                    <Select value={caseFolderFilter} onValueChange={setCaseFolderFilter}>
                      <SelectTrigger aria-label="计划用例所属模块筛选"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部模块</SelectItem>
                        <SelectItem value="uncategorized">未分类</SelectItem>
                        {availableFolders.map((folder) => <SelectItem key={folder.id} value={String(folder.id)}>{folder.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={caseTypeFilter} onValueChange={setCaseTypeFilter}>
                      <SelectTrigger aria-label="计划用例类型筛选"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="all">全部类型</SelectItem>{Object.entries(caseTypeLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={casePriorityFilter} onValueChange={setCasePriorityFilter}>
                      <SelectTrigger aria-label="计划用例等级筛选"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="all">全部等级</SelectItem><SelectItem value="high">P0</SelectItem><SelectItem value="medium">P1</SelectItem><SelectItem value="low">P2</SelectItem></SelectContent>
                    </Select>
                    <Select value={caseKindFilter} onValueChange={setCaseKindFilter}>
                      <SelectTrigger aria-label="计划用例分类筛选"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="all">全部分类</SelectItem><SelectItem value="functional">功能用例</SelectItem><SelectItem value="baseline">基线用例</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="test-plan-case-selection-bar">
                    <label>
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allFilteredSelected}
                        disabled={filteredCaseIds.length === 0}
                        onChange={(event) => {
                          const filteredIds = new Set(filteredCaseIds)
                          setCaseIds((current) => event.target.checked
                            ? Array.from(new Set([...current, ...filteredCaseIds]))
                            : current.filter((id) => !filteredIds.has(id)))
                        }}
                      />
                      <span>{allFilteredSelected ? '取消全选当前结果' : '全选当前结果'}</span>
                    </label>
                    <small>{filteredAvailable.length} 条结果 · 已选 {caseIds.length} 条</small>
                  </div>
                </div>
                <div className="test-case-checklist" role="group" aria-label={plan ? '可追加用例' : '可选择用例'}>
                  {filteredAvailable.length ? filteredAvailable.map((item) => {
                    const folder = folders.find((candidate) => candidate.id === item.folderId)
                    return <label key={item.id}>
                      <input type="checkbox" checked={caseIds.includes(item.id)} onChange={(event) => setCaseIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />
                      <span className="test-plan-case-option">
                        <span><code>CASE-{item.id}</code><strong>{item.title}</strong></span>
                        <small>{subjects.find((subject) => subject.id === item.testSubjectId)?.name || '未知对象'} · {folder?.name || '未分类'} · {caseKindLabel[item.caseKind]} · {caseTypeLabel[item.caseType]} · {caseLevelLabel[item.priority]}</small>
                      </span>
                    </label>
                  }) : <p className="test-list-empty">{available.length ? '没有符合条件的可选用例。' : '没有可追加的活动用例。'}</p>}
                </div>
              </fieldset>
            </div>
          </section>
        )}
        <DialogFooter>
          {step === 1 ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button type="button" disabled={!canGoNext} onClick={() => setStep(2)}>下一步</Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setStep(1)}>上一步</Button>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button disabled={busy || !canSubmit}>{plan ? '保存修改' : '创建计划'}</Button>
            </>
          )}
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}

function BugDialog({ busy, onOpenChange, onSubmit, open, seed, users }: { busy: boolean; onOpenChange: (open: boolean) => void; onSubmit: (payload: { actualResult: string; assigneeUserId?: number; environment: string; expectedResult: string; priority: Priority; reproductionSteps: string; severity: BugSeverity; testPlanCaseId?: number; testPlanId?: number; testSubjectId: number; title: string }) => void; open: boolean; seed: Partial<TestBug>; users: TestWorkbenchData['users'] }) {
  return <BugDialogForm key={`${open}-${seed.testPlanCaseId ?? 'new'}`} {...{ busy, onOpenChange, onSubmit, open, seed, users }} />
}

function BugDialogForm({ busy, onOpenChange, onSubmit, open, seed, users }: Parameters<typeof BugDialog>[0]) {
  const [title, setTitle] = useState(seed.title ?? '')
  const [severity, setSeverity] = useState<BugSeverity>('major')
  const [priority, setPriority] = useState<Priority>('medium')
  const [environment, setEnvironment] = useState(seed.environment ?? '')
  const [reproductionSteps, setReproductionSteps] = useState(seed.reproductionSteps ?? '')
  const [expectedResult, setExpectedResult] = useState(seed.expectedResult ?? '')
  const [actualResult, setActualResult] = useState(seed.actualResult ?? '')
  const [assigneeUserId, setAssigneeUserId] = useState('none')
  const [reproductionUploading, setReproductionUploading] = useState(false)
  const [expectedUploading, setExpectedUploading] = useState(false)
  const [actualUploading, setActualUploading] = useState(false)
  const evidenceUploading = reproductionUploading || expectedUploading || actualUploading

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fixedHeader className="test-wide-dialog">
        <DialogHeader>
          <DialogTitle>创建 Bug</DialogTitle>
          <DialogDescription>{seed.testPlanCaseId ? '已从失败用例带入执行上下文。' : '记录可复现、可分派、可验证的缺陷。'}</DialogDescription>
        </DialogHeader>
        <form
          className="test-dialog-form"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit({
              actualResult,
              assigneeUserId: assigneeUserId === 'none' ? undefined : Number(assigneeUserId),
              environment,
              expectedResult,
              priority,
              reproductionSteps,
              severity,
              testPlanCaseId: seed.testPlanCaseId,
              testPlanId: seed.testPlanId,
              testSubjectId: seed.testSubjectId!,
              title,
            })
          }}
        >
          <Label>
            Bug 标题
            <Input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} />
          </Label>
          <div className="test-form-grid">
            <Label>
              严重程度
              <Select value={severity} onValueChange={(value) => setSeverity(value as BugSeverity)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(severityLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </Label>
            <Label>
              优先级
              <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="high">高</SelectItem><SelectItem value="medium">中</SelectItem><SelectItem value="low">低</SelectItem></SelectContent>
              </Select>
            </Label>
            <Label>
              负责人
              <Select value={assigneeUserId} onValueChange={setAssigneeUserId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">未分配</SelectItem>{users.filter((user) => user.roles.includes('developer')).map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.displayName}</SelectItem>)}</SelectContent>
              </Select>
            </Label>
            <Label>
              测试环境
              <Input value={environment} onChange={(event) => setEnvironment(event.target.value)} />
            </Label>
          </div>
          <BugEvidenceEditor
            label="复现步骤"
            onChange={setReproductionSteps}
            onUploadingChange={setReproductionUploading}
            placeholder="记录复现路径，支持粘贴、拖入或上传图片和视频。"
            value={reproductionSteps}
          />
          <BugEvidenceEditor
            label="预期结果"
            onChange={setExpectedResult}
            onUploadingChange={setExpectedUploading}
            placeholder="描述预期表现，支持补充截图或录屏。"
            value={expectedResult}
          />
          <BugEvidenceEditor
            label="实际结果"
            onChange={setActualResult}
            onUploadingChange={setActualUploading}
            placeholder="描述实际表现，支持补充截图或录屏。"
            value={actualResult}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button disabled={busy || evidenceUploading || !title.trim() || !seed.testSubjectId}>
              {evidenceUploading ? '附件上传中...' : '创建 Bug'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AssignedTestBugs({
  currentUserId,
  embedded = false,
  onBugSeen,
  onBugsChange,
  onExit,
}: {
  currentUserId?: number
  embedded?: boolean
  onBugSeen?: (bug: TestBug) => void
  onBugsChange?: (bugs: TestBug[]) => void
  onExit?: () => void
}) {
  const [bugs, setBugs] = useState<TestBug[]>([])
  const [selectedId, setSelectedId] = useState<number>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchAssignedTestBugs()
      .then((result) => {
        setBugs(result.bugs)
        onBugsChange?.(result.bugs)
        setSelectedId(result.bugs[0]?.id)
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Bug 加载失败。'))
      .finally(() => setLoading(false))
  }, [onBugsChange])

  const selected = useMemo(() => bugs.find((bug) => bug.id === selectedId), [bugs, selectedId])

  useEffect(() => {
    if (selected) onBugSeen?.(selected)
  }, [onBugSeen, selected])

  async function mutate(operation: () => Promise<{ bugs: TestBug[] }>) {
    setBusy(true)
    setError('')
    try {
      const result = await operation()
      setBugs(result.bugs)
      onBugsChange?.(result.bugs)
      return true
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : '操作失败。')
      return false
    } finally {
      setBusy(false)
    }
  }

  const Root = embedded ? 'section' : 'main'

  return (
    <Root className={embedded ? 'assigned-bugs-workspace' : 'assigned-bugs-shell'}>
      {!embedded ? (
        <header>
          <Button size="icon" variant="ghost" onClick={onExit}><ArrowLeft /></Button>
          <div><h1>Bug 工作台</h1></div>
        </header>
      ) : null}
      <WorkspaceError message={error} />
      {loading ? (
        <p className="test-list-empty">正在加载...</p>
      ) : bugs.length === 0 ? (
        <div className="test-inline-empty"><CheckCircle size={32} /><h2>没有可查看的 Bug</h2></div>
      ) : (
        <div className="test-split-view">
          <div className="test-record-list">
            {bugs.map((bug) => (
              <button key={bug.id} className={bug.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(bug.id)}>
                <div><code>BUG-{bug.id}</code><Badge variant="outline">{bugStatusLabel[bug.status]}</Badge></div>
                <strong>{bug.title}</strong>
                <small>{severityLabel[bug.severity]} · {formatTimestamp(bug.updatedAt)}</small>
              </button>
            ))}
          </div>
          <div className="test-record-detail">
            {selected ? (
              <>
                <div className="test-detail-heading">
                  <div><code>BUG-{selected.id}</code><h2>{selected.title}</h2></div>
                  <div>
                    {selected.canManage && (selected.status === 'assigned' || selected.status === 'reopened') ? (
                      <Button disabled={busy} onClick={() => void mutate(() => updateAssignedTestBug(selected.id, 'in_progress'))}>开始修复</Button>
                    ) : null}
                    {selected.canManage && selected.status === 'in_progress' ? (
                      <Button disabled={busy} onClick={() => void mutate(() => updateAssignedTestBug(selected.id, 'pending_verification'))}>提交验证</Button>
                    ) : null}
                  </div>
                </div>
                <DetailBlock title="复现步骤" content={selected.reproductionSteps} />
                <DetailBlock title="预期结果" content={selected.expectedResult} />
                <DetailBlock title="实际结果" content={selected.actualResult} />
                <BugCommentsSection
                  bug={selected}
                  busy={busy}
                  currentUserId={currentUserId}
                  placeholder="说明修复内容或提交版本，支持粘贴、拖入或上传图片和视频。"
                  onComment={selected.canManage
                    ? (bug, content) => mutate(() => addAssignedTestBugComment(bug.id, content))
                    : undefined}
                  onDeleteComment={selected.canManage
                    ? (bug, comment) => mutate(() => deleteAssignedTestBugComment(bug.id, comment.id))
                    : undefined}
                  onUpdateComment={selected.canManage
                    ? (bug, comment, content) => mutate(() => updateAssignedTestBugComment(bug.id, comment.id, content))
                    : undefined}
                />
              </>
            ) : null}
          </div>
        </div>
      )}
    </Root>
  )
}
