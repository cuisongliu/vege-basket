import { Button } from './ui/button'

export type ExportScope = 'all' | 'filtered'

type Props = {
  open: boolean
  filteredCount?: number
  busy?: boolean
  onConfirm: (scope: ExportScope) => void
}

export function ExportScopeDialog({
  open,
  filteredCount,
  busy = false,
  onConfirm,
}: Props) {
  if (!open) return null
  return (
    <div className="export-scope-menu" role="menu" aria-label="导出范围">
      <Button type="button" variant="ghost" role="menuitem" disabled={busy} onClick={() => onConfirm('all')}>
        全部导出
      </Button>
      <Button type="button" variant="ghost" role="menuitem" disabled={busy || filteredCount === 0} onClick={() => onConfirm('filtered')}>
        筛选导出
      </Button>
    </div>
  )
}
