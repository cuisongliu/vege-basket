import { ArrowLeft, ClockCounterClockwise, SpinnerGap, WarningCircle } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import {
  fetchAiActivities,
  fetchAiActivityDetail,
  type AiActivityDetail,
  type AiActivityRecord,
} from '../api'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

const moduleLabels: Record<string, string> = {
  'bug-workbench': 'Bug 工作台',
  'conversation-analysis': '对话分析',
  'organization-weekly-summary': '组织周报汇总',
  'platform-management': '平台管理',
  'project-summary': '项目总结',
  'veges-ai': 'Veges AI',
  'weekly-report': '个人周报',
}

const operationLabels: Record<string, string> = {
  'bug-image-analysis': '图片证据识别',
  'bug-repair-prompt': 'Bug 修复提示词',
  'conversation-analysis': '对话分析',
  'daily-summary': '日报总结',
  'general': '普通对话',
  'intent-classification': '意图识别',
  'organization-weekly-summary': '组织周报汇总',
  'personal-weekly-report': '个人周报生成',
  'project-summary': '项目对话',
  'todo-extraction': '待办提取',
  'weekly-summary': '周报总结',
  'workspace-daily-review': '工作区日报',
  'workspace-weekly-review': '工作区周报',
}

const statusLabels: Record<AiActivityRecord['status'], string> = {
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

function displayTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(value))
}

function detailContent(value: string) {
  if (!value) return <span className="text-sm text-muted-foreground">无</span>
  return <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/55 p-3 text-xs leading-5 [letter-spacing:0]">{value}</pre>
}

export function AiActivityRecords() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AiActivityRecord[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [module, setModule] = useState('all')
  const [status, setStatus] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<AiActivityDetail | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)

  async function load(reset = true) {
    setBusy(true)
    setError('')
    try {
      const result = await fetchAiActivities({
        cursor: reset ? undefined : nextCursor ?? undefined,
        limit: 20,
        module: module === 'all' ? undefined : module,
        status: status === 'all' ? undefined : status as AiActivityRecord['status'],
      })
      setItems((current) => reset ? result.items : [...current, ...result.items])
      setNextCursor(result.nextCursor)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'AI 记录加载失败。')
    } finally {
      setBusy(false)
    }
  }

  async function openDetail(item: AiActivityRecord) {
    setDetailBusy(true)
    setError('')
    try {
      const result = await fetchAiActivityDetail(item.id)
      setDetail(result.activity)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'AI 记录详情加载失败。')
    } finally {
      setDetailBusy(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setDetail(null)
    void load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, module, status])

  const modules = [...new Set([...Object.keys(moduleLabels), ...items.map((item) => item.module)])]

  return <>
    <Button
      aria-label="AI 记录"
      className="fixed bottom-5 right-5 z-40 size-11 rounded-full shadow-lg"
      size="icon"
      title="查看 AI 记录"
      type="button"
      onClick={() => setOpen(true)}
    >
      <ClockCounterClockwise aria-hidden size={20} weight="duotone" />
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent fixedHeader className="max-h-[min(84vh,760px)] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <div className="flex items-center gap-2">
            {detail ? <Button aria-label="返回 AI 记录列表" size="icon-sm" variant="ghost" onClick={() => setDetail(null)}><ArrowLeft /></Button> : null}
            <div>
              <DialogTitle>{detail ? operationLabels[detail.operation] ?? detail.operation : 'AI 记录'}</DialogTitle>
              <DialogDescription>{detail ? `${moduleLabels[detail.module] ?? detail.module} · ${displayTime(detail.createdAt)}` : '当前账号在所有模块触发的 AI 请求。'}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {error ? <div className="mx-5 mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert"><WarningCircle className="mt-0.5 shrink-0" />{error}</div> : null}
        {detail ? (
          <div className="min-h-0 overflow-y-auto px-5 py-4">
            <dl className="mb-5 grid grid-cols-2 gap-x-5 gap-y-3 text-sm sm:grid-cols-4">
              <div><dt className="text-muted-foreground">状态</dt><dd className="m-0 mt-1 font-medium">{statusLabels[detail.status]}</dd></div>
              <div><dt className="text-muted-foreground">耗时</dt><dd className="m-0 mt-1 font-medium">{detail.durationMs == null ? '-' : `${detail.durationMs} ms`}</dd></div>
              <div><dt className="text-muted-foreground">模型</dt><dd className="m-0 mt-1 truncate font-medium" title={detail.model ?? ''}>{detail.model ?? '-'}</dd></div>
              <div><dt className="text-muted-foreground">图片</dt><dd className="m-0 mt-1 font-medium">{detail.imageCount} 张</dd></div>
            </dl>
            <section className="mb-5"><h3 className="mb-2 text-sm font-semibold">请求信息</h3>{detailContent(detail.request)}</section>
            <section className="mb-5"><h3 className="mb-2 text-sm font-semibold">返回信息</h3>{detailContent(detail.response)}</section>
            {detail.error ? <section><h3 className="mb-2 text-sm font-semibold text-destructive">错误信息</h3>{detailContent(detail.error)}</section> : null}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap gap-2 border-b px-5 py-3">
              <Select value={module} onValueChange={setModule}>
                <SelectTrigger className="w-44" aria-label="筛选 AI 模块"><SelectValue placeholder="全部模块" /></SelectTrigger>
                <SelectContent><SelectItem value="all">全部模块</SelectItem>{modules.map((value) => <SelectItem key={value} value={value}>{moduleLabels[value] ?? value}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-36" aria-label="筛选 AI 状态"><SelectValue placeholder="全部状态" /></SelectTrigger>
                <SelectContent><SelectItem value="all">全部状态</SelectItem>{Object.entries(statusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="min-h-0 overflow-y-auto px-3 py-2">
              {items.length === 0 && busy ? <div className="grid min-h-52 place-content-center justify-items-center gap-2 text-sm text-muted-foreground"><SpinnerGap className="animate-spin" size={22} />正在读取 AI 记录</div> : null}
              {items.length === 0 && !busy && !error ? <div className="grid min-h-52 place-content-center text-sm text-muted-foreground">暂无 AI 记录</div> : null}
              {items.map((item) => <button className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 border-b px-2 py-3 text-left transition-colors hover:bg-muted/50" key={item.id} type="button" onClick={() => void openDetail(item)}>
                <span className="min-w-0"><strong className="block truncate text-sm font-medium">{operationLabels[item.operation] ?? item.operation}</strong><small className="mt-1 block truncate text-xs text-muted-foreground">{moduleLabels[item.module] ?? item.module}{item.relatedId ? ` · ${item.relatedType ?? '资源'} ${item.relatedId}` : ''}</small></span>
                <span className="text-right"><span className={`block text-xs ${item.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{statusLabels[item.status]}</span><small className="mt-1 block text-xs text-muted-foreground">{displayTime(item.createdAt)}</small></span>
              </button>)}
              {detailBusy ? <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground"><SpinnerGap className="animate-spin" />正在加载详情</div> : null}
              {nextCursor ? <div className="flex justify-center py-3"><Button disabled={busy} size="sm" variant="outline" onClick={() => void load(false)}>{busy ? <SpinnerGap className="animate-spin" /> : null}加载更多</Button></div> : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  </>
}
