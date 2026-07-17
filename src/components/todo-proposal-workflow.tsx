import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import {
  Check,
  FileMd,
  FilePlus,
  Sparkle,
  WarningCircle,
} from '@phosphor-icons/react'

import {
  confirmTodoProposals,
  createTodoProposals,
  type WorkspaceData,
} from '@/api'
import type {
  Priority,
  Project,
  ProjectMembership,
  TodoProposal,
} from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type EditableTodoProposal = TodoProposal & { clientId: string }

const priorityOptions: Array<{ label: string; value: Priority }> = [
  { label: '高', value: 'high' },
  { label: '中', value: 'medium' },
  { label: '低', value: 'low' },
]

function projectMembers(project: Project | undefined, memberships: ProjectMembership[]) {
  if (!project) return []
  const users = new Map<number, string>([[project.ownerUserId, `${project.ownerName}（Owner）`]])
  for (const membership of memberships) {
    if (
      membership.projectId === project.id &&
      membership.status === 'active' &&
      membership.invitedUserId
    ) {
      users.set(membership.invitedUserId, membership.memberName)
    }
  }
  return Array.from(users, ([id, name]) => ({ id, name }))
}

function confidenceLabel(value: number) {
  const normalized = value <= 1 ? value * 100 : value
  return `${Math.max(0, Math.min(100, Math.round(normalized)))}% 置信度`
}

export type TodoProposalWorkflowHandle = {
  analyzeContent: (content: string, fileName?: string) => Promise<boolean>
  openFilePicker: () => void
  reset: () => void
}

type TodoProposalWorkflowProps = {
  disabled?: boolean
  memberships: ProjectMembership[]
  onBusyChange?: (busy: boolean) => void
  onWorkspace: (workspace: WorkspaceData) => void
  projects: Project[]
  showLauncher?: boolean
}

export const TodoProposalWorkflow = forwardRef<
  TodoProposalWorkflowHandle,
  TodoProposalWorkflowProps
>(function TodoProposalWorkflow({
  disabled = false,
  memberships,
  onBusyChange,
  onWorkspace,
  projects,
  showLauncher = true,
}, ref) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const analysisInFlightRef = useRef(false)
  const analysisRequestIdRef = useRef(0)
  const [fileName, setFileName] = useState('')
  const [batchId, setBatchId] = useState<number | null>(null)
  const [proposals, setProposals] = useState<EditableTodoProposal[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [reviewOpen, setReviewOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const selectedCount = selectedIds.size
  const allSelected = proposals.length > 0 && selectedCount === proposals.length
  const showWorkflowStatus = showLauncher || Boolean(fileName || proposals.length || error)

  useImperativeHandle(ref, () => ({
    analyzeContent,
    openFilePicker() {
      if (!disabled && !analysisInFlightRef.current) fileInputRef.current?.click()
    },
    reset: resetWorkflow,
  }))

  useEffect(() => {
    onBusyChange?.(generating || confirming)
  }, [confirming, generating, onBusyChange])

  useEffect(() => () => onBusyChange?.(false), [onBusyChange])

  const invalidSelectedProposal = useMemo(
    () => proposals.find((proposal) => selectedIds.has(proposal.clientId) && (
      !proposal.projectId || !proposal.title.trim() || !proposal.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(proposal.dueDate)
    )),
    [proposals, selectedIds],
  )

  function clearProposalReviewState() {
    setBatchId(null)
    setProposals([])
    setSelectedIds(new Set())
    setReviewOpen(false)
  }

  function resetWorkflow() {
    analysisRequestIdRef.current += 1
    analysisInFlightRef.current = false
    setGenerating(false)
    clearProposalReviewState()
    setFileName('')
    setError('')
  }

  async function runAnalysis(
    contentSource: string | Promise<string>,
    requestedFileName = '输入内容.md',
  ): Promise<boolean> {
    if (disabled || analysisInFlightRef.current) return false

    const trimmedFileName = requestedFileName.trim() || '输入内容.md'
    const markdownFileName = trimmedFileName.toLowerCase().endsWith('.md')
      ? trimmedFileName
      : `${trimmedFileName}.md`
    const requestId = analysisRequestIdRef.current + 1
    analysisRequestIdRef.current = requestId
    analysisInFlightRef.current = true
    clearProposalReviewState()
    setError('')
    setFileName(markdownFileName)
    setGenerating(true)
    try {
      const content = await contentSource
      if (requestId !== analysisRequestIdRef.current) return false
      if (!content.trim()) {
        setError('这个 Markdown 文件没有可分析的内容。')
        return false
      }
      const result = await createTodoProposals({ content, fileName: markdownFileName })
      if (requestId !== analysisRequestIdRef.current) return false
      const editable = result.proposals.map((proposal, index) => ({
        ...proposal,
        clientId: `${result.batchId}-${index}`,
      }))
      setBatchId(result.batchId)
      setProposals(editable)
      setSelectedIds(new Set(editable.map((proposal) => proposal.clientId)))
      setReviewOpen(true)
      return true
    } catch (generateError) {
      if (requestId !== analysisRequestIdRef.current) return false
      setError(
        generateError instanceof Error && generateError.message
          ? generateError.message
          : 'AI 无法分析这个 Markdown 文件，请稍后重试。',
      )
      return false
    } finally {
      if (requestId === analysisRequestIdRef.current) {
        analysisInFlightRef.current = false
        setGenerating(false)
      }
    }
  }

  function analyzeContent(content: string, requestedFileName?: string) {
    return runAnalysis(content, requestedFileName)
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.md')) {
      setError('只支持 Markdown 文件，请选择扩展名为 .md 的文件。')
      return
    }
    await runAnalysis(file.text(), file.name)
  }

  function updateProposal(clientId: string, patch: Partial<TodoProposal>) {
    setProposals((current) => current.map((proposal) =>
      proposal.clientId === clientId ? { ...proposal, ...patch } : proposal,
    ))
    setError('')
  }

  function toggleProposal(clientId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(clientId)) next.delete(clientId)
      else next.add(clientId)
      return next
    })
  }

  async function confirmSelected() {
    if (batchId == null || confirming || selectedCount === 0) return
    if (invalidSelectedProposal) {
      setError('请为选中的提案填写项目、标题和有效截止日期。')
      return
    }

    const selected = proposals
      .filter((proposal) => selectedIds.has(proposal.clientId))
      .map((proposal) => ({
        assigneeUserId: proposal.assigneeUserId,
        confidence: proposal.confidence,
        detail: proposal.detail,
        dueDate: proposal.dueDate,
        moduleId: proposal.moduleId,
        priority: proposal.priority,
        projectId: proposal.projectId,
        sourceExcerpt: proposal.sourceExcerpt,
        title: proposal.title,
      }))
    setConfirming(true)
    setError('')
    try {
      const workspace = await confirmTodoProposals(batchId, selected)
      onWorkspace(workspace)
      setReviewOpen(false)
      setBatchId(null)
      setProposals([])
      setSelectedIds(new Set())
      setFileName('')
    } catch (confirmError) {
      setError(
        confirmError instanceof Error && confirmError.message
          ? confirmError.message
          : '待办创建失败，已保留你的修改，请重试。',
      )
    } finally {
      setConfirming(false)
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        accept=".md,text/markdown"
        className="todo-proposal-file-input"
        type="file"
        onChange={(event) => void handleFile(event)}
      />
      {showWorkflowStatus ? (
        <section
          className="todo-proposal-workflow"
          aria-labelledby={showLauncher ? 'todo-proposal-title' : undefined}
        >
          {showLauncher ? (
            <div className="todo-proposal-heading">
              <span className="todo-proposal-icon" aria-hidden><FileMd size={18} weight="duotone" /></span>
              <div>
                <h4 id="todo-proposal-title">从 Markdown 提取待办</h4>
                <p>选择一个 .md 文件，AI 会先生成可编辑提案，确认后才会创建待办。</p>
              </div>
            </div>
          ) : null}
          {showLauncher ? (
            <Button
              className="ghost-button todo-proposal-upload"
              disabled={disabled || generating}
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              {generating ? <Sparkle className="is-pulsing" size={16} /> : <FilePlus size={16} />}
              {generating ? '正在分析文档' : '选择 Markdown 文件'}
            </Button>
          ) : null}
          {fileName ? <small className="todo-proposal-file-name">{fileName}</small> : null}
          {proposals.length > 0 && !reviewOpen ? (
            <Button
              disabled={generating || confirming}
              type="button"
              onClick={() => setReviewOpen(true)}
            >
              <Check size={16} weight="bold" />
              继续审核 {proposals.length} 项提案
            </Button>
          ) : null}
          {error && !reviewOpen ? <p className="form-error" role="alert">{error}</p> : null}
        </section>
      ) : null}

      <Dialog open={reviewOpen} onOpenChange={(open) => !confirming && setReviewOpen(open)}>
        <DialogContent
          aria-busy={confirming}
          className="todo-proposal-dialog"
          showCloseButton={!confirming}
        >
          <DialogHeader>
            <DialogTitle>确认 AI 待办提案</DialogTitle>
            <DialogDescription>
              已分析 {fileName}。检查归属和日期，只会创建你勾选的待办。
            </DialogDescription>
          </DialogHeader>

          <div className="todo-proposal-review-toolbar">
            <span>已选择 {selectedCount} / {proposals.length}</span>
            <Button
              disabled={confirming}
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => setSelectedIds(
                allSelected ? new Set() : new Set(proposals.map((proposal) => proposal.clientId)),
              )}
            >
              {allSelected ? '取消全选' : '全选'}
            </Button>
          </div>

          <div className="todo-proposal-list">
            {proposals.map((proposal, index) => {
              const project = projects.find((item) => item.id === proposal.projectId)
              const members = projectMembers(project, memberships)
              const selected = selectedIds.has(proposal.clientId)
              return (
                <article
                  className={selected ? 'todo-proposal-item is-selected' : 'todo-proposal-item'}
                  key={proposal.clientId}
                >
                  <div className="todo-proposal-item-header">
                    <label className="todo-proposal-selection">
                      <input
                        checked={selected}
                        disabled={confirming}
                        type="checkbox"
                        onChange={() => toggleProposal(proposal.clientId)}
                      />
                      <span>{selected ? <Check size={13} weight="bold" /> : null}</span>
                      提案 {index + 1}
                    </label>
                    <Badge variant="outline">{confidenceLabel(proposal.confidence)}</Badge>
                  </div>

                  <div className="todo-proposal-grid">
                    <Label>
                      项目
                      <Select
                        disabled={confirming}
                        value={proposal.projectId ? String(proposal.projectId) : 'none'}
                        onValueChange={(value) => updateProposal(proposal.clientId, {
                          assigneeUserId: null,
                          moduleId: null,
                          projectId: value === 'none' ? null : Number(value),
                        })}
                      >
                        <SelectTrigger><SelectValue placeholder="选择项目" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">请选择项目</SelectItem>
                          {projects.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Label>
                    <Label>
                      模块
                      <Select
                        disabled={confirming || !project}
                        value={proposal.moduleId ? String(proposal.moduleId) : 'none'}
                        onValueChange={(value) => updateProposal(proposal.clientId, {
                          moduleId: value === 'none' ? null : Number(value),
                        })}
                      >
                        <SelectTrigger><SelectValue placeholder="不指定模块" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">不指定模块</SelectItem>
                          {project?.modules.map((module) => <SelectItem key={module.id} value={String(module.id)}>{module.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Label>
                    <Label>
                      负责人
                      <Select
                        disabled={confirming || !project}
                        value={proposal.assigneeUserId ? String(proposal.assigneeUserId) : 'none'}
                        onValueChange={(value) => updateProposal(proposal.clientId, {
                          assigneeUserId: value === 'none' ? null : Number(value),
                        })}
                      >
                        <SelectTrigger><SelectValue placeholder="暂不指派" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">暂不指派</SelectItem>
                          {members.map((member) => <SelectItem key={member.id} value={String(member.id)}>{member.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Label>
                    <Label>
                      截止日期
                      <Input
                        disabled={confirming}
                        type="date"
                        value={proposal.dueDate ?? ''}
                        onChange={(event) => updateProposal(proposal.clientId, { dueDate: event.target.value || null })}
                      />
                    </Label>
                    <Label>
                      优先级
                      <Select
                        disabled={confirming}
                        value={proposal.priority}
                        onValueChange={(value) => updateProposal(proposal.clientId, { priority: value as Priority })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {priorityOptions.map((priority) => <SelectItem key={priority.value} value={priority.value}>{priority.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Label>
                    <Label className="todo-proposal-title-field">
                      标题
                      <Input
                        disabled={confirming}
                        maxLength={160}
                        value={proposal.title}
                        onChange={(event) => updateProposal(proposal.clientId, { title: event.target.value })}
                      />
                    </Label>
                    <Label className="todo-proposal-detail-field">
                      详情
                      <Textarea
                        disabled={confirming}
                        rows={3}
                        value={proposal.detail}
                        onChange={(event) => updateProposal(proposal.clientId, { detail: event.target.value })}
                      />
                    </Label>
                  </div>
                  {proposal.sourceExcerpt ? (
                    <blockquote className="todo-proposal-source">来源：{proposal.sourceExcerpt}</blockquote>
                  ) : null}
                </article>
              )
            })}
          </div>

          {error ? (
            <p className="form-error todo-proposal-error" role="alert">
              <WarningCircle size={16} weight="fill" /> {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button disabled={confirming} type="button" variant="outline" onClick={() => setReviewOpen(false)}>
              稍后处理
            </Button>
            <Button
              disabled={confirming || selectedCount === 0}
              type="button"
              onClick={() => void confirmSelected()}
            >
              {confirming ? '正在创建' : `确认创建 ${selectedCount} 项`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
})
