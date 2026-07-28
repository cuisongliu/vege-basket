import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  Buildings,
  Bug,
  CheckCircle,
  ClipboardText,
  Flask,
  FolderSimple,
  GearSix,
  Plus,
  Sparkle,
  Trash,
  Users,
  Warning,
} from '@phosphor-icons/react'
import {
  attachProjectToOrganization,
  attachTestSpaceToOrganization,
  createOrganization,
  deleteOrganization,
  fetchOrganization,
  fetchOrganizations,
  generateOrganizationWeeklySummary,
  inviteOrganizationMember,
  inviteOrganizationMemberByUsername,
  removeOrganizationMember,
  saveOrganizationWeeklyReport,
  updateOrganization,
  updateOrganizationWeekStart,
  updateOrganizationMemberRole,
  type AuthUser,
} from '../api'
import type {
  OrganizationDetail,
  OrganizationListItem,
  OrganizationTask,
} from '../organization-types'
import { userRoleLabel } from '../user-roles'
import { Button } from './ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { Textarea } from './ui/textarea'
import './organization-workbench.css'

type OrganizationTab = 'overview' | 'projects' | 'testSpaces' | 'members' | 'tasks' | 'reports'

const organizationTabs: Array<{
  icon: typeof Buildings
  id: OrganizationTab
  label: string
}> = [
  { icon: Buildings, id: 'overview', label: '概览' },
  { icon: FolderSimple, id: 'projects', label: '项目管理' },
  { icon: Flask, id: 'testSpaces', label: '测试空间管理' },
  { icon: Users, id: 'members', label: '成员' },
  { icon: ClipboardText, id: 'tasks', label: '任务' },
  { icon: Sparkle, id: 'reports', label: '周报' },
]

const organizationRoleLabel = {
  admin: '管理员',
  member: '成员',
  owner: '所有者',
} as const

const organizationWeekdayOptions = [
  { label: '周一', value: '1' },
  { label: '周二', value: '2' },
  { label: '周三', value: '3' },
  { label: '周四', value: '4' },
  { label: '周五', value: '5' },
  { label: '周六', value: '6' },
  { label: '周日', value: '7' },
] as const

const taskKindLabel: Record<OrganizationTask['kind'], string> = {
  bug: 'Bug',
  delivery: '交付',
  todo: '待办',
}

const taskStatusLabel: Record<string, string> = {
  assigned: '已指派',
  closed: '已关闭',
  completed: '已完成',
  confirmed: '已确认',
  delivered: '已交付',
  delivering: '交付中',
  draft: '草稿',
  duplicate: '重复',
  failed: '失败',
  in_progress: '进行中',
  new: '新建',
  open: '待处理',
  pending: '待处理',
  pending_verification: '待验证',
  rejected: '已拒绝',
  reopened: '重新打开',
  success: '成功',
}

function currentWeekStart(weekStartsOn = 1) {
  const date = new Date()
  const day = date.getDay()
  const startDay = weekStartsOn === 7 ? 0 : weekStartsOn
  date.setDate(date.getDate() - ((day - startDay + 7) % 7))
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function shiftDateOnly(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function formatWeekRange(weekStart: string) {
  const weekEnd = shiftDateOnly(weekStart, 6)
  return `${weekStart.replaceAll('-', '/')} - ${weekEnd.replaceAll('-', '/')}`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(new Date(value))
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请稍后重试。'
}

export function OrganizationWorkbench({ currentUser }: { currentUser: AuthUser }) {
  const [organizations, setOrganizations] = useState<OrganizationListItem[]>([])
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(0)
  const [detail, setDetail] = useState<OrganizationDetail | null>(null)
  const [canCreate, setCanCreate] = useState(false)
  const [tab, setTab] = useState<OrganizationTab>('overview')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [organizationSettingsError, setOrganizationSettingsError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [organizationName, setOrganizationName] = useState('')
  const [organizationRenameDraft, setOrganizationRenameDraft] = useState('')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [ownerUsername, setOwnerUsername] = useState(currentUser.username)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteUsername, setInviteUsername] = useState('')
  const [taskQuery, setTaskQuery] = useState('')
  const [taskKind, setTaskKind] = useState<'all' | OrganizationTask['kind']>('all')
  const [topbarActionHost, setTopbarActionHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setTopbarActionHost(document.getElementById('organization-topbar-actions'))
    return () => setTopbarActionHost(null)
  }, [])

  const loadOrganizations = useCallback(async (preferredId?: number) => {
    const result = await fetchOrganizations()
    setOrganizations(result.organizations)
    setCanCreate(result.canCreate)
    const nextId = preferredId && result.organizations.some((item) => item.id === preferredId)
      ? preferredId
      : result.organizations[0]?.id ?? 0
    setSelectedOrganizationId(nextId)
    return nextId
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    loadOrganizations()
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [loadOrganizations])

  useEffect(() => {
    if (!selectedOrganizationId) {
      setDetail(null)
      return
    }
    let active = true
    setLoading(true)
    fetchOrganization(selectedOrganizationId)
      .then((nextDetail) => {
        if (active) {
          setDetail(nextDetail)
          setError('')
        }
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [selectedOrganizationId])

  useEffect(() => {
    setOrganizationRenameDraft(detail?.name ?? '')
  }, [detail?.id, detail?.name])

  async function mutate(operation: () => Promise<OrganizationDetail>) {
    setBusy(true)
    setError('')
    setOrganizationSettingsError('')
    try {
      const nextDetail = await operation()
      setDetail(nextDetail)
      return true
    } catch (mutationError) {
      setError(errorMessage(mutationError))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function submitOrganization(event: FormEvent) {
    event.preventDefault()
    if (!organizationName.trim() || !ownerUsername.trim()) return
    setBusy(true)
    setError('')
    try {
      const created = await createOrganization({
        name: organizationName.trim(),
        ownerUsername: ownerUsername.trim(),
      })
      setOrganizationName('')
      setCreateOpen(false)
      await loadOrganizations(created.id)
      setDetail(created)
    } catch (createError) {
      setError(errorMessage(createError))
    } finally {
      setBusy(false)
    }
  }

  async function submitOrganizationRename(event: FormEvent) {
    event.preventDefault()
    const name = organizationRenameDraft.trim()
    if (!detail || !name || name === detail.name) return
    setBusy(true)
    setError('')
    setOrganizationSettingsError('')
    try {
      const nextDetail = await updateOrganization(detail.id, name)
      setDetail(nextDetail)
      setOrganizations((current) => current.map((organization) => (
        organization.id === nextDetail.id
          ? { ...organization, name: nextDetail.name }
          : organization
      )))
      setSettingsOpen(false)
    } catch (renameError) {
      setOrganizationSettingsError(errorMessage(renameError))
    } finally {
      setBusy(false)
    }
  }

  async function submitOrganizationDelete(event: FormEvent) {
    event.preventDefault()
    if (!detail || deleteConfirmation !== detail.name) return
    setBusy(true)
    setError('')
    setOrganizationSettingsError('')
    try {
      await deleteOrganization(detail.id, deleteConfirmation)
      setDeleteOpen(false)
      setDeleteConfirmation('')
      setDetail(null)
      setSelectedOrganizationId(0)
      await loadOrganizations()
    } catch (deleteError) {
      setOrganizationSettingsError(errorMessage(deleteError))
    } finally {
      setBusy(false)
    }
  }

  async function submitInvitation(event: FormEvent) {
    event.preventDefault()
    if (!detail || !inviteEmail.trim()) return
    const success = await mutate(() => inviteOrganizationMember(detail.id, inviteEmail.trim()))
    if (success) setInviteEmail('')
  }

  async function submitUsernameInvitation(event: FormEvent) {
    event.preventDefault()
    if (!detail || !inviteUsername.trim()) return
    const success = await mutate(() => inviteOrganizationMemberByUsername(detail.id, inviteUsername.trim()))
    if (success) setInviteUsername('')
  }

  const filteredTasks = useMemo(() => {
    if (!detail) return []
    const query = taskQuery.trim().toLowerCase()
    return detail.tasks.filter((task) => (
      (taskKind === 'all' || task.kind === taskKind) &&
      (!query || [task.title, task.projectName, task.assigneeName].some((value) => value.toLowerCase().includes(query)))
    ))
  }, [detail, taskKind, taskQuery])

  const weekStart = currentWeekStart(detail?.weekStartsOn ?? 1)
  const submittedReports = detail?.reports.filter((report) => (
    report.weekStart === weekStart && report.status === 'submitted'
  )) ?? []
  const currentSummary = detail?.summaries.find((summary) => summary.weekStart === weekStart)
  const organizationCreateAction = topbarActionHost
    && canCreate
    && currentUser.roles.includes('organization_admin')
    ? createPortal(
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger asChild>
          <Button className="solid-button" type="button">
            <Plus size={17} /> 新建组织
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建组织</DialogTitle>
          </DialogHeader>
          <OrganizationCreateForm
            busy={busy}
            name={organizationName}
            onNameChange={setOrganizationName}
            onOwnerChange={setOwnerUsername}
            onSubmit={submitOrganization}
            ownerUsername={ownerUsername}
          />
        </DialogContent>
      </Dialog>,
      topbarActionHost,
    )
    : null

  if (!currentUser.roles.includes('organization_admin')) {
    return (
      <div className="organization-state organization-empty-state">
        <Buildings size={30} weight="duotone" />
        <strong>当前账号没有组织管理员角色</strong>
        <span>组织管理看板仅对由系统 admin 指定的组织管理员开放。</span>
      </div>
    )
  }

  if (loading && !detail && organizations.length === 0) {
    return <>{organizationCreateAction}<div className="organization-state">正在加载组织...</div></>
  }

  if (!detail) {
    return (
      <>
        {organizationCreateAction}
        <div className="organization-state organization-empty-state">
          <Buildings size={30} weight="duotone" />
          <strong>当前账号还没有加入组织</strong>
        </div>
      </>
    )
  }

  return (
    <div className="organization-workbench">
      {organizationCreateAction}
      <div className="organization-toolbar">
        <div className="organization-switcher-group">
          <Select
            value={String(selectedOrganizationId)}
            onValueChange={(value) => setSelectedOrganizationId(Number(value))}
          >
            <SelectTrigger className="organization-switcher" aria-label="选择组织">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {organizations.map((organization) => (
                <SelectItem key={organization.id} value={String(organization.id)}>
                  {organization.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {detail.canManage ? (
            <Dialog open={settingsOpen} onOpenChange={(open) => {
              setSettingsOpen(open)
              setOrganizationSettingsError('')
              if (open) setOrganizationRenameDraft(detail.name)
            }}>
              <DialogTrigger asChild>
                <Button
                  aria-label="组织设置"
                  title="组织设置"
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <GearSix size={17} />
                </Button>
              </DialogTrigger>
              <DialogContent className="organization-settings-dialog">
                <DialogHeader>
                  <DialogTitle>组织设置</DialogTitle>
                  <DialogDescription>修改当前组织的名称，或处理不可逆的组织删除操作。</DialogDescription>
                </DialogHeader>
                {organizationSettingsError ? (
                  <div className="organization-error" role="alert">{organizationSettingsError}</div>
                ) : null}
                <form className="organization-settings-form" onSubmit={submitOrganizationRename}>
                  <Label htmlFor="organization-name-edit">组织名称</Label>
                  <div className="organization-settings-name-row">
                    <Input
                      id="organization-name-edit"
                      maxLength={80}
                      value={organizationRenameDraft}
                      onChange={(event) => setOrganizationRenameDraft(event.target.value)}
                    />
                    <Button
                      className="organization-settings-action"
                      disabled={busy || !organizationRenameDraft.trim() || organizationRenameDraft.trim() === detail.name}
                      size="lg"
                      type="submit"
                    >
                      保存名称
                    </Button>
                  </div>
                </form>
                <section className="organization-danger-zone" aria-labelledby="organization-danger-title">
                  <div>
                    <strong id="organization-danger-title">删除组织</strong>
                    <span>删除成员关系、邀请、组织周报与汇总，项目和测试空间将解除组织归属并保留。</span>
                  </div>
                  <Button
                    className="organization-settings-action"
                    disabled={busy}
                    size="lg"
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      setSettingsOpen(false)
                      setDeleteConfirmation('')
                      setOrganizationSettingsError('')
                      setDeleteOpen(true)
                    }}
                  >
                    <Trash size={16} /> 删除组织
                  </Button>
                </section>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
      </div>

      <Dialog open={deleteOpen} onOpenChange={(open) => {
        if (!busy) {
          setDeleteOpen(open)
          if (!open) {
            setDeleteConfirmation('')
            setOrganizationSettingsError('')
          }
        }
      }}>
        <DialogContent
          className="organization-delete-dialog"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault()
          }}
          onInteractOutside={(event) => {
            if (busy) event.preventDefault()
          }}
          showCloseButton={!busy}
        >
          <DialogHeader>
            <div className="organization-delete-heading-icon" aria-hidden="true">
              <Warning size={20} weight="fill" />
            </div>
            <DialogTitle>确认删除组织</DialogTitle>
            <DialogDescription>
              这是不可逆操作。组织成员关系、邀请、周报与汇总会被永久删除。
            </DialogDescription>
          </DialogHeader>
          {organizationSettingsError ? (
            <div className="organization-error" role="alert">{organizationSettingsError}</div>
          ) : null}
          <div className="organization-delete-impact">
            <strong>业务数据不会被删除</strong>
            <span>
              {detail.projects.length} 个项目和 {detail.testSpaces.length} 个测试空间会解除组织归属，
              其中的待办、交付、测试记录与 Bug 均会保留。
            </span>
          </div>
          <form className="organization-delete-form" onSubmit={submitOrganizationDelete}>
            <Label htmlFor="organization-delete-confirmation">
              输入完整组织名称 <strong>{detail.name}</strong> 以确认
            </Label>
            <Input
              id="organization-delete-confirmation"
              autoComplete="off"
              spellCheck={false}
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button disabled={busy} type="button" variant="outline">取消</Button>
              </DialogClose>
              <Button
                className="organization-delete-confirm-button"
                disabled={busy || deleteConfirmation !== detail.name}
                type="submit"
                variant="destructive"
              >
                <Trash size={16} /> {busy ? '正在删除...' : '永久删除组织'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="organization-tabs-row">
        <div className="organization-tabs" role="tablist" aria-label="组织模块">
          {organizationTabs.map((item) => {
            const Icon = item.icon
            return (
              <button
                className={tab === item.id ? 'active' : ''}
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
              >
                <Icon size={17} /> {item.label}
              </button>
            )
          })}
        </div>
        <span className="organization-access-badge">
          {organizationRoleLabel[detail.accessRole]}
        </span>
      </div>

      {error ? <div className="organization-error" role="alert">{error}</div> : null}

      <div className="organization-content">
        {tab === 'overview' ? (
          <div className="organization-overview">
            <div className="organization-metrics">
              <Metric label="成员" value={detail.members.length} />
              <Metric label="组织项目" value={detail.projects.length} />
              <Metric label="测试空间" value={detail.testSpaces.length} />
              <Metric label="未完成任务" value={detail.tasks.filter((task) => !['completed', 'closed', 'delivered'].includes(task.status)).length} />
            </div>
            <section className="organization-section">
              <header><h3>最近任务</h3></header>
              <TaskTable tasks={detail.tasks.slice(0, 8)} />
            </section>
          </div>
        ) : null}

        {tab === 'projects' ? (
          <section className="organization-section organization-resource-panel">
            <header><h3>组织项目</h3><span>{detail.projects.length}</span></header>
            <div className="organization-list">
              {detail.projects.map((project) => (
                <div className="organization-resource-row" key={project.id}>
                  <div><strong>{project.name}</strong><span>{project.ownerName}</span></div>
                  <div className="organization-resource-counts">
                    <span>{project.openTodoCount} 未完成</span><span>{project.todoCount} 待办</span>
                  </div>
                </div>
              ))}
              {detail.projects.length === 0 ? <EmptyRow text="暂无组织项目" /> : null}
            </div>
            {detail.attachableProjects.length > 0 ? (
              <div className="organization-attach-list">
                {detail.attachableProjects.map((project) => (
                  <Button
                    disabled={busy}
                    key={project.id}
                    type="button"
                    variant="outline"
                    onClick={() => void mutate(() => attachProjectToOrganization(detail.id, project.id))}
                  >
                    <Plus size={15} /> {project.name}
                  </Button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === 'testSpaces' ? (
          <section className="organization-section organization-resource-panel">
            <header><h3>组织测试空间</h3><span>{detail.testSpaces.length}</span></header>
            <div className="organization-list">
              {detail.testSpaces.map((space) => (
                <div className="organization-resource-row" key={space.id}>
                  <div><strong>{space.name}</strong><span>{space.ownerName}</span></div>
                  <div className="organization-resource-counts">
                    <span>{space.planCount} 计划</span><span>{space.bugCount} Bug</span>
                  </div>
                </div>
              ))}
              {detail.testSpaces.length === 0 ? <EmptyRow text="暂无组织测试空间" /> : null}
            </div>
            {detail.attachableTestSpaces.length > 0 ? (
              <div className="organization-attach-list">
                {detail.attachableTestSpaces.map((space) => (
                  <Button
                    disabled={busy}
                    key={space.id}
                    type="button"
                    variant="outline"
                    onClick={() => void mutate(() => attachTestSpaceToOrganization(detail.id, space.id))}
                  >
                    <Plus size={15} /> {space.name}
                  </Button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === 'members' ? (
          <section className="organization-section organization-members-section">
            <header><h3>组织成员</h3><span>{detail.members.length}</span></header>
            {detail.canManage ? (
              <div className="organization-invite-panel">
                <form className="organization-invite-form" onSubmit={submitUsernameInvitation}>
                  <Label>
                    通过用户名邀请
                    <Input
                      aria-label="组织成员用户名"
                      autoComplete="username"
                      placeholder="输入账号用户名"
                      value={inviteUsername}
                      onChange={(event) => setInviteUsername(event.target.value)}
                    />
                  </Label>
                  <Button disabled={busy || !inviteUsername.trim()} type="submit">
                    <Plus size={16} /> 直接加入
                  </Button>
                </form>
                <form className="organization-invite-form" onSubmit={submitInvitation}>
                  <Label>
                    通过飞书邀请
                    <Input
                      aria-label="飞书邮箱"
                      placeholder="飞书邮箱"
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                    />
                  </Label>
                  <Button disabled={busy || !inviteEmail.trim()} type="submit" variant="outline">
                    <Plus size={16} /> 发送飞书邀请
                  </Button>
                </form>
              </div>
            ) : null}
            <div className="organization-member-list">
              {detail.members.map((member) => (
                <div className="organization-member-row" key={member.id}>
                  <div className="organization-member-identity">
                    <strong>{member.displayName}</strong>
                    <span>{member.username}</span>
                  </div>
                  <div className="organization-professions">
                    {member.roles.map((role) => <span key={role}>{userRoleLabel[role]}</span>)}
                  </div>
                  {detail.canManage && member.accessRole !== 'owner' ? (
                    <Select
                      value={member.accessRole}
                      onValueChange={(value) => void mutate(() => updateOrganizationMemberRole(
                        detail.id,
                        member.id,
                        value as 'admin' | 'member',
                      ))}
                    >
                      <SelectTrigger className="organization-role-select" aria-label={`${member.displayName}的组织角色`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">成员</SelectItem>
                        <SelectItem value="admin">管理员</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : <span className="organization-owner-label">{organizationRoleLabel[member.accessRole]}</span>}
                  {detail.canManage && member.accessRole !== 'owner' ? (
                    <Button
                      aria-label={`移除${member.displayName}`}
                      disabled={busy}
                      size="icon"
                      type="button"
                      variant="ghost"
                      onClick={() => void mutate(() => removeOrganizationMember(detail.id, member.id))}
                    >
                      <Trash size={17} />
                    </Button>
                  ) : <span className="organization-row-spacer" />}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {tab === 'tasks' ? (
          <section className="organization-section organization-tasks-section">
            <header><h3>组织任务</h3><span>{filteredTasks.length}</span></header>
            <div className="organization-task-filters">
              <Input
                aria-label="搜索任务"
                placeholder="搜索标题、项目或负责人"
                value={taskQuery}
                onChange={(event) => setTaskQuery(event.target.value)}
              />
              <Select value={taskKind} onValueChange={(value) => setTaskKind(value as typeof taskKind)}>
                <SelectTrigger aria-label="任务类型"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部类型</SelectItem>
                  <SelectItem value="todo">待办</SelectItem>
                  <SelectItem value="delivery">交付</SelectItem>
                  <SelectItem value="bug">Bug</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <TaskTable tasks={filteredTasks} />
          </section>
        ) : null}

        {tab === 'reports' ? (
          <section className="organization-section organization-report-summary">
            <header>
              <h3>组织周报</h3>
              <div className="organization-report-header-actions">
                <div className="organization-week-picker">
                  <Label htmlFor="organization-summary-week">周起始日</Label>
                  <Select
                    disabled={busy || !detail.canManage}
                    value={String(detail.weekStartsOn)}
                    onValueChange={(value) => void mutate(() => (
                      updateOrganizationWeekStart(detail.id, Number(value))
                    ))}
                  >
                    <SelectTrigger id="organization-summary-week" aria-label="选择周起始日">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {organizationWeekdayOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  disabled={busy || submittedReports.length === 0 || !detail.canManage}
                  type="button"
                  onClick={() => void mutate(() => generateOrganizationWeeklySummary(detail.id, weekStart))}
                ><Sparkle size={16} /> AI 汇总</Button>
              </div>
            </header>
            <div className="organization-report-submission-count">
              已提交 {submittedReports.length} / {detail.members.length}
            </div>
            {currentSummary ? (
              <div className="organization-summary-content">{currentSummary.content}</div>
            ) : <EmptyRow text="本周暂无组织周报" />}
          </section>
        ) : null}
      </div>
    </div>
  )
}

export function OrganizationWeeklyReportView({ currentUser }: { currentUser: AuthUser }) {
  const [organizations, setOrganizations] = useState<OrganizationListItem[]>([])
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(0)
  const [detail, setDetail] = useState<OrganizationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reportDraft, setReportDraft] = useState('')
  const weekStart = currentWeekStart(detail?.weekStartsOn ?? 1)

  const loadOrganizations = useCallback(async () => {
    const result = await fetchOrganizations()
    setOrganizations(result.organizations)
    const nextId = result.organizations[0]?.id ?? 0
    setSelectedOrganizationId(nextId)
    return nextId
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    loadOrganizations()
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [loadOrganizations])

  useEffect(() => {
    if (!selectedOrganizationId) {
      setDetail(null)
      return
    }
    let active = true
    setLoading(true)
    fetchOrganization(selectedOrganizationId)
      .then((nextDetail) => {
        if (active) {
          setDetail(nextDetail)
          setError('')
        }
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [selectedOrganizationId])

  useEffect(() => {
    const ownReport = detail?.reports.find((report) => (
      report.userId === currentUser.id && report.weekStart === weekStart
    ))
    setReportDraft(ownReport?.content ?? '')
  }, [currentUser.id, detail, weekStart])

  async function saveReport(status: 'draft' | 'submitted') {
    if (!detail || (status === 'submitted' && !reportDraft.trim())) return
    setBusy(true)
    setError('')
    try {
      const nextDetail = await saveOrganizationWeeklyReport(
        detail.id,
        weekStart,
        { content: reportDraft, status },
      )
      setDetail(nextDetail)
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  const ownReport = detail?.reports.find((report) => (
    report.userId === currentUser.id && report.weekStart === weekStart
  ))

  if (loading && organizations.length === 0 && !detail) {
    return <div className="organization-state">正在加载组织...</div>
  }

  if (organizations.length === 0) {
    return (
      <div className="organization-state organization-empty-state">
        <ClipboardText size={30} weight="duotone" />
        <strong>当前账号还没有加入组织</strong>
        <span>加入组织后，就可以在这里提交个人周报。</span>
      </div>
    )
  }

  return (
    <div className="organization-workbench organization-weekly-submit">
      <div className="organization-toolbar">
        <Select
          value={String(selectedOrganizationId)}
          onValueChange={(value) => setSelectedOrganizationId(Number(value))}
        >
          <SelectTrigger className="organization-switcher" aria-label="选择组织">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {organizations.map((organization) => (
              <SelectItem key={organization.id} value={String(organization.id)}>
                {organization.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? <div className="organization-error" role="alert">{error}</div> : null}

      <section className="organization-section organization-report-editor organization-weekly-submit-panel">
        <header>
          <h3>提交周报</h3>
          {ownReport ? <span>{ownReport.status === 'submitted' ? '已提交' : '草稿'}</span> : null}
        </header>
        <div className="organization-report-period">
          <span>周报周期</span>
          <strong>{formatWeekRange(weekStart)}</strong>
        </div>
        <Textarea
          placeholder="写下本周完成事项、风险阻塞、协作事项和下周计划"
          value={reportDraft}
          onChange={(event) => setReportDraft(event.target.value)}
        />
        <div className="organization-report-actions">
          <Button
            disabled={busy}
            type="button"
            variant="outline"
            onClick={() => void saveReport('draft')}
          >保存草稿</Button>
          <Button
            disabled={busy || !reportDraft.trim()}
            type="button"
            onClick={() => void saveReport('submitted')}
          ><CheckCircle size={16} /> 提交周报</Button>
        </div>
      </section>
    </div>
  )
}

function OrganizationCreateForm(props: {
  busy: boolean
  name: string
  onNameChange: (value: string) => void
  onOwnerChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
  ownerUsername: string
}) {
  return (
    <form className="organization-create-form" onSubmit={props.onSubmit}>
      <Label>组织名称<Input autoFocus maxLength={80} value={props.name} onChange={(event) => props.onNameChange(event.target.value)} /></Label>
      <Label>所有者账号<Input value={props.ownerUsername} onChange={(event) => props.onOwnerChange(event.target.value)} /></Label>
      <DialogFooter>
        <Button disabled={props.busy || !props.name.trim() || !props.ownerUsername.trim()} type="submit">
          创建组织
        </Button>
      </DialogFooter>
    </form>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div><strong>{value}</strong><span>{label}</span></div>
}

function EmptyRow({ text }: { text: string }) {
  return <div className="organization-empty-row">{text}</div>
}

function TaskTable({ tasks }: { tasks: OrganizationTask[] }) {
  if (tasks.length === 0) return <EmptyRow text="暂无任务" />
  return (
    <div className="organization-task-table">
      {tasks.map((task) => (
        <div className="organization-task-row" key={`${task.kind}-${task.id}`}>
          <span className={`organization-task-kind ${task.kind}`}>
            {task.kind === 'bug' ? <Bug size={14} /> : null}{taskKindLabel[task.kind]}
          </span>
          <div><strong>{task.title}</strong><span>{task.projectName}</span></div>
          <span>{task.assigneeName || '未分配'}</span>
          <span>{taskStatusLabel[task.status] ?? task.status}</span>
          <time>{formatDateTime(task.updatedAt)}</time>
        </div>
      ))}
    </div>
  )
}
